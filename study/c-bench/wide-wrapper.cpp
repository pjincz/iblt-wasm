#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <set>
#include <vector>
#include "iblt.h"
#include "iblt128.h"
#include "iblt160.h"

struct IBLTBenchAccess {
    template<class T> static auto &cells(T &table) { return table.hashTable; }
};
static unsigned expectedEntries(unsigned cells) {
    if (cells < 4 || cells % 4) abort();
    unsigned n = 1;
    while (((n + n / 2 + 3) / 4) * 4 < cells) ++n;
    return n;
}
template<class K> K readKey(const uint8_t *p) {
    K key; memcpy(key.bytes.data(), p, sizeof(K)); return key;
}
template<> uint64_t readKey(const uint8_t *p) {
    uint64_t key = 0;
    for (unsigned i = 0; i < 8; ++i) key |= uint64_t(p[i]) << (8 * i);
    return key;
}
template<class K> void writeKey(uint8_t *p, const K &key) { memcpy(p, key.bytes.data(), sizeof(K)); }
template<> void writeKey(uint8_t *p, const uint64_t &key) {
    for (unsigned i = 0; i < 8; ++i) p[i] = uint8_t(key >> (8 * i));
}
static void put32(uint8_t *p, uint32_t x) {
    for (unsigned i = 0; i < 4; ++i) p[i] = uint8_t(x >> (i * 8));
}
static uint32_t get32(const uint8_t *p) {
    uint32_t x = 0;
    for (unsigned i = 0; i < 4; ++i) x |= uint32_t(p[i]) << (i * 8);
    return x;
}
struct AnyTable {
    unsigned width, cells;
    std::vector<uint8_t> keys;
    std::vector<int32_t> sides;
    AnyTable(unsigned w, unsigned c): width(w), cells(c) {}
    virtual ~AnyTable() = default;
    virtual AnyTable *clone() = 0;
    virtual void update(const uint8_t *p, unsigned n, bool remove) = 0;
    virtual void serialize(uint8_t *p) = 0;
    virtual void deserialize(const uint8_t *p) = 0;
    virtual bool decode(AnyTable *other) = 0;
};
template<class T, class K> struct TypedTable : AnyTable {
    T table;
    TypedTable(unsigned cells): AnyTable(sizeof(K), cells), table(expectedEntries(cells), 0) {
        if (IBLTBenchAccess::cells(table).size() != cells) abort();
    }
    TypedTable(const TypedTable &other): AnyTable(other.width, other.cells), table(other.table) {}
    AnyTable *clone() override { return new TypedTable(*this); }
    void update(const uint8_t *p, unsigned n, bool remove) override {
        for (unsigned i = 0; i < n; ++i, p += sizeof(K)) {
            const K key = readKey<K>(p);
            if (remove) table.erase(key, {});
            else table.insert(key, {});
        }
    }
    void serialize(uint8_t *p) override {
        for (const auto &cell : IBLTBenchAccess::cells(table)) {
            put32(p, uint32_t(cell.count)); p += 4;
            writeKey(p, cell.keySum); p += sizeof(K);
            put32(p, cell.keyCheck); p += 4;
        }
    }
    void deserialize(const uint8_t *p) override {
        for (auto &cell : IBLTBenchAccess::cells(table)) {
            cell.count = int32_t(get32(p)); p += 4;
            cell.keySum = readKey<K>(p); p += sizeof(K);
            cell.keyCheck = get32(p); p += 4;
        }
    }
    bool decode(AnyTable *other) override {
        if (other->width != width || other->cells != cells) abort();
        T difference = table - static_cast<TypedTable *>(other)->table;
        std::set<std::pair<K, std::vector<uint8_t>>> positive, negative;
        const bool success = difference.listEntries(positive, negative);
        keys.resize((positive.size() + negative.size()) * sizeof(K));
        sides.clear(); sides.reserve(positive.size() + negative.size());
        size_t offset = 0;
        for (const auto &entry : positive) {
            writeKey(keys.data() + offset, entry.first); offset += sizeof(K); sides.push_back(1);
        }
        for (const auto &entry : negative) {
            writeKey(keys.data() + offset, entry.first); offset += sizeof(K); sides.push_back(-1);
        }
        return success;
    }
};
extern "C" {
AnyTable *wide_create(unsigned bits, unsigned cells) {
    if (bits == 64) return new TypedTable<IBLT, uint64_t>(cells);
    if (bits == 128) return new TypedTable<IBLT128, Key128>(cells);
    if (bits == 160) return new TypedTable<IBLT160, Key160>(cells);
    abort();
}
void wide_destroy(AnyTable *t) { delete t; }
AnyTable *wide_clone(AnyTable *t) { return t->clone(); }
void wide_update(AnyTable *t, const uint8_t *p, unsigned n, int remove) { t->update(p, n, remove); }
unsigned wide_wire_size(AnyTable *t) { return t->cells * (t->width + 8); }
void wide_serialize(AnyTable *t, uint8_t *p) { t->serialize(p); }
void wide_deserialize(AnyTable *t, const uint8_t *p) { t->deserialize(p); }
int wide_decode(AnyTable *remote, AnyTable *local) { return remote->decode(local); }
unsigned wide_result_count(AnyTable *t) { return t->sides.size(); }
const uint8_t *wide_result_keys(AnyTable *t) { return t->keys.data(); }
const int32_t *wide_result_sides(AnyTable *t) { return t->sides.data(); }
}
