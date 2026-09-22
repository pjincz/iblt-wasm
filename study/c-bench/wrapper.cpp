#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>
#include <set>
#include "iblt.h"
#include "ibf.h"
#include "minisketch.h"

// Access-only friend added to a build-directory copy of upstream iblt.h.
// No upstream hashing, insertion or decoding algorithms are changed.
struct IBLTBenchAccess {
  static auto &cells(IBLT &x) { return x.hashTable; }
};

struct Table {
  int type; // 0 GNUnet, 1 IBLT_Cplusplus, 2 minisketch
  unsigned size;
  InvertibleBloomFilter *gn = nullptr;
  IBLT *cpp = nullptr;
  minisketch *mini = nullptr;
  std::vector<uint64_t> keys;
  std::vector<int32_t> sides;
  ~Table() {
    if (gn) ibf_destroy(gn);
    delete cpp;
    if (mini) minisketch_destroy(mini);
  }
};

static void put(uint8_t *&p, uint64_t x, unsigned bytes) {
  for (unsigned i = 0; i < bytes; ++i) { *p++ = uint8_t(x); x >>= 8; }
}
static uint64_t get(const uint8_t *&p, unsigned bytes) {
  uint64_t x = 0;
  for (unsigned i = 0; i < bytes; ++i) x |= uint64_t(*p++) << (i * 8);
  return x;
}

extern "C" {
Table *bench_create(int type, unsigned size) {
  auto *t = new Table(); t->type = type; t->size = size;
  if (type == 0) t->gn = ibf_create(size, 4);
  else if (type == 1) {
    // Upstream takes expectedEntries and rounds 1.5x to a multiple of four.
    unsigned expected = 1;
    while (((expected + expected / 2 + 3) / 4) * 4 < size) ++expected;
    t->cpp = new IBLT(expected, 0); // set of keys, no associated value
    if (IBLTBenchAccess::cells(*t->cpp).size() != size) abort();
  } else if (type == 2) t->mini = minisketch_create(64, 0, size);
  else abort();
  if (type == 0 && !t->gn) abort();
  if (type == 2 && !t->mini) abort();
  return t;
}
void bench_destroy(Table *t) { delete t; }
void bench_update(Table *t, const uint64_t *keys, unsigned count, int remove) {
  for (unsigned i = 0; i < count; ++i) {
    if (t->gn) {
      if (remove) ibf_remove(t->gn, IBF_Key{keys[i]});
      else ibf_insert(t->gn, IBF_Key{keys[i]});
    } else if (t->cpp) {
      if (remove) t->cpp->erase(keys[i], {});
      else t->cpp->insert(keys[i], {});
    } else {
      // minisketch uses symmetric difference: inserting a present key removes it.
      minisketch_add_uint64(t->mini, keys[i]);
    }
  }
}
Table *bench_clone(Table *t) {
  auto *c = new Table(); c->type = t->type; c->size = t->size;
  if (t->gn) c->gn = ibf_dup(t->gn);
  if (t->cpp) c->cpp = new IBLT(*t->cpp);
  if (t->mini) c->mini = minisketch_clone(t->mini);
  return c;
}
unsigned bench_wire_size(Table *t) {
  if (t->gn) return t->size * 20; // i64 count, u64 key, u32 check
  if (t->cpp) return t->size * 16; // i32 count, u64 key, u32 check
  return minisketch_serialized_size(t->mini);
}
void bench_serialize(Table *t, uint8_t *out) {
  if (t->gn) {
    for (unsigned i = 0; i < t->size; ++i) {
      put(out, uint64_t(t->gn->count[i].count_val), 8);
      put(out, t->gn->key_sum[i].key_val, 8);
      put(out, t->gn->key_hash_sum[i].key_hash_val, 4);
    }
  } else if (t->cpp) {
    for (const auto &c : IBLTBenchAccess::cells(*t->cpp)) {
      put(out, uint32_t(c.count), 4); put(out, c.keySum, 8); put(out, c.keyCheck, 4);
    }
  } else minisketch_serialize(t->mini, out);
}
void bench_deserialize(Table *t, const uint8_t *in) {
  if (t->gn) {
    for (unsigned i = 0; i < t->size; ++i) {
      t->gn->count[i].count_val = int64_t(get(in, 8));
      t->gn->key_sum[i].key_val = get(in, 8);
      t->gn->key_hash_sum[i].key_hash_val = uint32_t(get(in, 4));
    }
  } else if (t->cpp) {
    for (auto &c : IBLTBenchAccess::cells(*t->cpp)) {
      c.count = int32_t(get(in, 4)); c.keySum = get(in, 8); c.keyCheck = uint32_t(get(in, 4));
    }
  } else minisketch_deserialize(t->mini, in);
}
int bench_decode(Table *remote, Table *local, unsigned maxOutput) {
  remote->keys.clear(); remote->sides.clear();
  if (remote->type != local->type || remote->size != local->size) abort();
  if (remote->gn) {
    ibf_subtract(remote->gn, local->gn);
    for (unsigned i = 0; i <= maxOutput; ++i) {
      int side; IBF_Key key;
      const int r = ibf_decode(remote->gn, &side, &key);
      if (r == GNUNET_NO) return 1;
      if (r == GNUNET_SYSERR) return 0;
      if (i == maxOutput) return 0;
      remote->keys.push_back(key.key_val); remote->sides.push_back(side);
    }
  } else if (remote->cpp) {
    IBLT difference = *remote->cpp - *local->cpp;
    std::set<std::pair<uint64_t, std::vector<uint8_t>>> positive, negative;
    const bool success = difference.listEntries(positive, negative);
    for (const auto &entry : positive) { remote->keys.push_back(entry.first); remote->sides.push_back(1); }
    for (const auto &entry : negative) { remote->keys.push_back(entry.first); remote->sides.push_back(-1); }
    return success;
  } else {
    minisketch_merge(remote->mini, local->mini);
    remote->keys.resize(maxOutput);
    const auto count = minisketch_decode(remote->mini, maxOutput, remote->keys.data());
    if (count < 0) { remote->keys.clear(); return 0; }
    remote->keys.resize(count); remote->sides.resize(count, 0);
    return 1;
  }
  return 0;
}
unsigned bench_result_count(Table *t) { return t->keys.size(); }
const uint64_t *bench_result_keys(Table *t) { return t->keys.data(); }
const int32_t *bench_result_sides(Table *t) { return t->sides.data(); }
}
