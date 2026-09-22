#pragma once
#include <array>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <vector>

// Key-only IBLT. Bucket mapping matches IBLT_Cplusplus (4 disjoint subtables).
// MurmurHash3 routines below specialize Austin Appleby's public-domain
// reference algorithms to exactly 16 input bytes, with explicit LE loads.
namespace key_only {
using Key = std::array<uint8_t, 16>;
inline uint32_t load32(const uint8_t *p) {
    return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
inline uint64_t load64(const uint8_t *p) { return uint64_t(load32(p)) | (uint64_t(load32(p + 4)) << 32); }
inline void store32(uint8_t *p, uint32_t x) {
    for (unsigned i = 0; i < 4; ++i) p[i] = uint8_t(x >> (8 * i));
}
inline uint32_t rot32(uint32_t x, unsigned n) { return (x << n) | (x >> (32 - n)); }
inline uint64_t rot64(uint64_t x, unsigned n) { return (x << n) | (x >> (64 - n)); }
inline uint32_t hash32(const Key &key, uint32_t seed) {
    uint32_t h = seed;
    for (unsigned i = 0; i < 4; ++i) {
        uint32_t k = load32(key.data() + i * 4);
        k *= 0xcc9e2d51U; k = rot32(k, 15); k *= 0x1b873593U;
        h ^= k; h = rot32(h, 13); h = h * 5 + 0xe6546b64U;
    }
    h ^= 16; h ^= h >> 16; h *= 0x85ebca6bU; h ^= h >> 13; h *= 0xc2b2ae35U; h ^= h >> 16;
    return h;
}
inline uint64_t fmix64(uint64_t x) {
    x ^= x >> 33; x *= UINT64_C(0xff51afd7ed558ccd);
    x ^= x >> 33; x *= UINT64_C(0xc4ceb9fe1a85ec53); x ^= x >> 33; return x;
}
inline std::array<uint64_t, 2> hash128(const Key &key, uint32_t seed) {
    constexpr uint64_t c1 = UINT64_C(0x87c37b91114253d5), c2 = UINT64_C(0x4cf5ad432745937f);
    uint64_t h1 = seed, h2 = seed, k1 = load64(key.data()), k2 = load64(key.data() + 8);
    k1 *= c1; k1 = rot64(k1, 31); k1 *= c2; h1 ^= k1;
    h1 = rot64(h1, 27); h1 += h2; h1 = h1 * 5 + 0x52dce729U;
    k2 *= c2; k2 = rot64(k2, 33); k2 *= c1; h2 ^= k2;
    h2 = rot64(h2, 31); h2 += h1; h2 = h2 * 5 + 0x38495ab5U;
    h1 ^= 16; h2 ^= 16; h1 += h2; h2 += h1;
    h1 = fmix64(h1); h2 = fmix64(h2); h1 += h2; h2 += h1;
    return {h1, h2};
}
template<unsigned Words> struct Cell {
    Key keySum{};
    std::array<uint32_t, Words> keyChecksum{};
    int32_t count = 0;
    bool empty() const { return count == 0 && keySum == Key{} && keyChecksum == std::array<uint32_t, Words>{}; }
};
static_assert(sizeof(Cell<3>) == 32, "128 key + 96 checksum + 32 count must occupy 32 bytes");
static_assert(sizeof(Cell<1>) == 24, "128 key + 32 checksum + 32 count must occupy 24 bytes");
struct Entry { Key key; int32_t side; };

template<unsigned Words> class IBLT {
    static_assert(Words == 1 || Words == 3, "Only 32-bit and 96-bit checksums supported");
public:
    using Bucket = Cell<Words>;
    std::vector<Bucket> cells;
    explicit IBLT(unsigned size): cells(size) { if (size < 4 || size % 4) std::abort(); }
    static auto checksum(const Key &key) {
        std::array<uint32_t, Words> result;
        if constexpr (Words == 1) result[0] = hash32(key, 11);
        else {
            const auto h = hash128(key, 11);
            result = {uint32_t(h[0]), uint32_t(h[0] >> 32), uint32_t(h[1])};
        }
        return result;
    }
    auto indexes(const Key &key) const {
        std::array<unsigned, 4> result;
        const unsigned section = cells.size() / 4;
        for (unsigned i = 0; i < 4; ++i) result[i] = i * section + hash32(key, i) % section;
        return result;
    }
    static bool fits(int64_t value) {
        return value >= std::numeric_limits<int32_t>::min() && value <= std::numeric_limits<int32_t>::max();
    }
    bool update(const Key &key, int delta) {
        if (delta != 1 && delta != -1) return false;
        const auto positions = indexes(key);
        const auto check = checksum(key); // once per key, not once per bucket
        for (const auto index : positions) if (!fits(int64_t(cells[index].count) + delta)) return false;
        for (const auto index : positions) {
            auto &cell = cells[index]; cell.count += delta;
            for (unsigned i = 0; i < 16; ++i) cell.keySum[i] ^= key[i];
            for (unsigned i = 0; i < Words; ++i) cell.keyChecksum[i] ^= check[i];
        }
        return true;
    }
    bool subtract(const IBLT &other) {
        if (cells.size() != other.cells.size()) return false;
        for (unsigned j = 0; j < cells.size(); ++j)
            if (!fits(int64_t(cells[j].count) - other.cells[j].count)) return false;
        for (unsigned j = 0; j < cells.size(); ++j) {
            auto &a = cells[j]; const auto &b = other.cells[j];
            a.count = int32_t(int64_t(a.count) - b.count);
            for (unsigned i = 0; i < 16; ++i) a.keySum[i] ^= b.keySum[i];
            for (unsigned i = 0; i < Words; ++i) a.keyChecksum[i] ^= b.keyChecksum[i];
        }
        return true;
    }
    bool peel(std::vector<Entry> &out) {
        out.clear();
        bool progress;
        do {
            progress = false;
            for (unsigned j = 0; j < cells.size(); ++j) {
                const auto &cell = cells[j];
                if (cell.count != 1 && cell.count != -1) continue;
                if (checksum(cell.keySum) != cell.keyChecksum) continue;
                const auto positions = indexes(cell.keySum);
                bool hits = false;
                for (auto p : positions) if (p == j) hits = true;
                if (!hits) continue;
                if (out.size() >= cells.size() * 4) return false;
                const Entry entry{cell.keySum, cell.count};
                if (!update(entry.key, -entry.side)) return false;
                out.push_back(entry); progress = true;
            }
        } while (progress);
        // Check ALL buckets, including checksum-only residuals.
        for (const auto &cell : cells) if (!cell.empty()) return false;
        return true;
    }
    static constexpr unsigned wireCellBytes = 20 + Words * 4;
    void serialize(uint8_t *out) const {
        for (const auto &cell : cells) {
            store32(out, uint32_t(cell.count)); out += 4;
            for (auto b : cell.keySum) *out++ = b;
            for (auto word : cell.keyChecksum) { store32(out, word); out += 4; }
        }
    }
    void deserialize(const uint8_t *in) {
        for (auto &cell : cells) {
            cell.count = int32_t(load32(in)); in += 4;
            for (auto &b : cell.keySum) b = *in++;
            for (auto &word : cell.keyChecksum) { word = load32(in); in += 4; }
        }
    }
};
} // namespace key_only
