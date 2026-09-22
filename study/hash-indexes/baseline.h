#pragma once
#include <array>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>
#include <algorithm>

// MurmurHash3 (Austin Appleby, public domain), for lengths divisible by 4.
namespace dynamic_iblt {
inline uint32_t load32(const uint8_t *p) {
    return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
inline uint64_t load64(const uint8_t *p) { return uint64_t(load32(p)) | (uint64_t(load32(p + 4)) << 32); }
inline void store32(uint8_t *p, uint32_t x) {
    for (unsigned i = 0; i < 4; ++i) p[i] = uint8_t(x >> (8 * i));
}
inline uint32_t rot32(uint32_t x, unsigned n) { return (x << n) | (x >> (32 - n)); }
inline uint64_t rot64(uint64_t x, unsigned n) { return (x << n) | (x >> (64 - n)); }
inline uint32_t hash32(const uint8_t *key, unsigned bytes, uint32_t seed) {
    uint32_t h = seed;
    for (unsigned i = 0; i < bytes / 4; ++i) {
        uint32_t k = load32(key + i * 4);
        k *= 0xcc9e2d51U; k = rot32(k, 15); k *= 0x1b873593U;
        h ^= k; h = rot32(h, 13); h = h * 5 + 0xe6546b64U;
    }
    h ^= bytes; h ^= h >> 16; h *= 0x85ebca6bU; h ^= h >> 13; h *= 0xc2b2ae35U; h ^= h >> 16;
    return h;
}
inline uint64_t fmix64(uint64_t x) {
    x ^= x >> 33; x *= UINT64_C(0xff51afd7ed558ccd);
    x ^= x >> 33; x *= UINT64_C(0xc4ceb9fe1a85ec53); x ^= x >> 33; return x;
}
inline std::array<uint64_t, 2> hash128(const uint8_t *key, unsigned bytes, uint32_t seed) {
    constexpr uint64_t c1 = UINT64_C(0x87c37b91114253d5), c2 = UINT64_C(0x4cf5ad432745937f);
    uint64_t h1 = seed, h2 = seed;
    for (unsigned i = 0; i < bytes / 16; ++i) {
        uint64_t k1 = load64(key + i * 16), k2 = load64(key + i * 16 + 8);
        k1 *= c1; k1 = rot64(k1,31); k1 *= c2; h1 ^= k1;
        h1 = rot64(h1,27); h1 += h2; h1 = h1 * 5 + 0x52dce729U;
        k2 *= c2; k2 = rot64(k2,33); k2 *= c1; h2 ^= k2;
        h2 = rot64(h2,31); h2 += h1; h2 = h2 * 5 + 0x38495ab5U;
    }
    const uint8_t *tail = key + (bytes / 16) * 16;
    const unsigned rest = bytes % 16;
    if (rest == 12) {
        uint64_t k2 = load32(tail + 8);
        k2 *= c2; k2 = rot64(k2,33); k2 *= c1; h2 ^= k2;
    }
    if (rest) {
        uint64_t k1 = rest >= 8 ? load64(tail) : load32(tail);
        k1 *= c1; k1 = rot64(k1,31); k1 *= c2; h1 ^= k1;
    }
    h1 ^= bytes; h2 ^= bytes; h1 += h2; h2 += h1;
    h1 = fmix64(h1); h2 = fmix64(h2); h1 += h2; h2 += h1;
    return {h1,h2};
}

class IBLT {
    unsigned keyBytes_, checkBytes_, count_, stride_;
    std::vector<uint32_t> data_;
    static int64_t signedCount(uint32_t x) { return x <= INT32_MAX ? int64_t(x) : int64_t(x) - (INT64_C(1) << 32); }
    static bool fits(int64_t x) { return x >= INT32_MIN && x <= INT32_MAX; }
public:
    static bool valid(unsigned cells, unsigned keyBytes, unsigned checkBytes) {
        const uint64_t stride = uint64_t(keyBytes) + checkBytes + 4;
        return cells >= 4 && cells % 4 == 0 && keyBytes >= 4 && keyBytes % 4 == 0 &&
            checkBytes >= 4 && checkBytes <= 16 && checkBytes % 4 == 0 &&
            stride <= uint64_t(INT32_MAX) / cells; // bounded to portable WASM32 payload sizes
    }
    IBLT(unsigned cells, unsigned keyBytes, unsigned checkBytes)
        : keyBytes_(keyBytes), checkBytes_(checkBytes), count_(cells), stride_(0) {
        if (!valid(cells,keyBytes,checkBytes)) throw std::invalid_argument("Invalid IBLT configuration");
        stride_ = 1 + keyBytes / 4 + checkBytes / 4;
        data_.resize(size_t(cells) * stride_);
    }
    unsigned keyBytes() const { return keyBytes_; }
    unsigned checkBytes() const { return checkBytes_; }
    unsigned cellCount() const { return count_; }
    unsigned cellBytes() const { return stride_ * 4; }
    unsigned wireBytes() const { return data_.size() * 4; }
    bool compatible(const IBLT &b) const { return keyBytes_ == b.keyBytes_ && checkBytes_ == b.checkBytes_ && count_ == b.count_; }
    auto checksum(const uint8_t *key) const {
        const auto h = hash128(key,keyBytes_,11);
        return std::array<uint32_t,4>{uint32_t(h[0]),uint32_t(h[0] >> 32),uint32_t(h[1]),uint32_t(h[1] >> 32)};
    }
    auto indexes(const uint8_t *key) const {
        std::array<unsigned,4> positions;
        for (unsigned i=0;i<4;++i) positions[i] = i*(count_/4) + hash32(key,keyBytes_,i) % (count_/4);
        return positions;
    }
    // Input points to keyBytes() bytes; byte alignment is sufficient.
    bool update(const uint8_t *key, int delta) {
        if (delta != 1 && delta != -1) return false;
        auto positions = indexes(key); auto sum = checksum(key);
        for (auto p: positions) if (!fits(signedCount(data_[size_t(p)*stride_]) + delta)) return false;
        for (auto p: positions) {
            auto *cell = data_.data() + size_t(p)*stride_;
            cell[0] = uint32_t(signedCount(cell[0]) + delta);
            for (unsigned i=0;i<keyBytes_/4;++i) cell[1+i] ^= load32(key+4*i);
            for (unsigned i=0;i<checkBytes_/4;++i) cell[1+keyBytes_/4+i] ^= sum[i];
        }
        return true;
    }
    bool subtract(const IBLT &b) {
        if (!compatible(b)) return false;
        for (size_t i=0;i<data_.size();i+=stride_)
            if (!fits(signedCount(data_[i])-signedCount(b.data_[i]))) return false;
        for (size_t i=0;i<data_.size();i+=stride_) {
            data_[i] = uint32_t(signedCount(data_[i])-signedCount(b.data_[i]));
            for (unsigned j=1;j<stride_;++j) data_[i+j] ^= b.data_[i+j];
        }
        return true;
    }
    // Mutates this difference table. On failure, outputs may be partial: discard them.
    bool peel(std::vector<uint8_t> &keys, std::vector<int32_t> &sides) {
        keys.clear(); sides.clear();
        std::vector<uint8_t> key(keyBytes_); // one scratch allocation per decode
        bool progress;
        do {
            progress = false;
            for (unsigned j=0;j<count_;++j) {
                const auto *cell = data_.data() + size_t(j)*stride_;
                const int64_t side = signedCount(cell[0]);
                if (side != 1 && side != -1) continue;
                for (unsigned i=0;i<keyBytes_/4;++i) store32(key.data()+4*i,cell[1+i]);
                const auto sum = checksum(key.data());
                bool pure = true;
                for (unsigned i=0;i<checkBytes_/4;++i) if (sum[i] != cell[1+keyBytes_/4+i]) pure = false;
                if (!pure) continue;
                auto positions = indexes(key.data());
                if (std::find(positions.begin(),positions.end(),j) == positions.end()) continue;
                if (sides.size() >= uint64_t(count_)*4 || !update(key.data(),-int(side))) return false;
                keys.insert(keys.end(),key.begin(),key.end()); sides.push_back(int32_t(side));
                progress = true;
            }
        } while (progress);
        for (auto word: data_) if (word) return false;
        return true;
    }
    void serialize(uint8_t *out) const { for (auto word: data_) { store32(out,word); out+=4; } }
    void deserialize(const uint8_t *in) { for (auto &word: data_) { word=load32(in); in+=4; } }
};
} // namespace dynamic_iblt
