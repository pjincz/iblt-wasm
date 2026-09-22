#include "key-only-iblt.h"
#include <cstring>

using namespace key_only;
struct Handle {
    unsigned checkBits;
    IBLT<1> *shortTable = nullptr;
    IBLT<3> *longTable = nullptr;
    std::vector<Entry> result;
    std::vector<uint8_t> keys;
    std::vector<int32_t> sides;
    ~Handle() { delete shortTable; delete longTable; }
};
extern "C" {
Handle *checked_create(unsigned bits, unsigned cells) {
    auto *h = new Handle(); h->checkBits = bits;
    if (bits == 32) h->shortTable = new IBLT<1>(cells);
    else if (bits == 96) h->longTable = new IBLT<3>(cells);
    else std::abort();
    return h;
}
void checked_destroy(Handle *h) { delete h; }
Handle *checked_clone(Handle *h) {
    auto *copy = new Handle(); copy->checkBits = h->checkBits;
    if (h->shortTable) copy->shortTable = new IBLT<1>(*h->shortTable);
    else copy->longTable = new IBLT<3>(*h->longTable);
    return copy;
}
int checked_update(Handle *h, const uint8_t *data, unsigned count, int remove) {
    for (unsigned i = 0; i < count; ++i) {
        Key key; std::memcpy(key.data(), data + i * 16, 16);
        bool ok = h->shortTable ? h->shortTable->update(key, remove ? -1 : 1) : h->longTable->update(key, remove ? -1 : 1);
        if (!ok) return 0;
    }
    return 1;
}
unsigned checked_cell_bytes(Handle *h) { return h->shortTable ? sizeof(Cell<1>) : sizeof(Cell<3>); }
unsigned checked_wire_size(Handle *h) {
    return h->shortTable ? h->shortTable->cells.size() * 24 : h->longTable->cells.size() * 32;
}
void checked_serialize(Handle *h, uint8_t *out) {
    if (h->shortTable) h->shortTable->serialize(out); else h->longTable->serialize(out);
}
void checked_deserialize(Handle *h, const uint8_t *in) {
    if (h->shortTable) h->shortTable->deserialize(in); else h->longTable->deserialize(in);
}
int checked_decode(Handle *a, Handle *b) {
    a->result.clear(); a->keys.clear(); a->sides.clear();
    if (a->checkBits != b->checkBits) return 0;
    bool ok;
    if (a->shortTable) {
        auto diff = *a->shortTable;
        ok = diff.subtract(*b->shortTable) && diff.peel(a->result);
    } else {
        auto diff = *a->longTable;
        ok = diff.subtract(*b->longTable) && diff.peel(a->result);
    }
    a->keys.resize(a->result.size() * 16); a->sides.resize(a->result.size());
    for (unsigned i = 0; i < a->result.size(); ++i) {
        std::memcpy(a->keys.data() + i * 16, a->result[i].key.data(), 16);
        a->sides[i] = a->result[i].side;
    }
    return ok;
}
unsigned checked_result_count(Handle *h) { return h->result.size(); }
const uint8_t *checked_result_keys(Handle *h) { return h->keys.data(); }
const int32_t *checked_result_sides(Handle *h) { return h->sides.data(); }
void checked_hash96(const uint8_t *in, uint8_t *out) {
    Key key; std::memcpy(key.data(), in, 16);
    const auto sum = IBLT<3>::checksum(key);
    for (unsigned i = 0; i < 3; ++i) store32(out + 4 * i, sum[i]);
}
}
