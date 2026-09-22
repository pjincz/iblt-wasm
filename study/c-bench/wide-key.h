#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <ostream>

// Fixed-width, lossless key. All N bytes participate in hashing and XOR.
template<size_t N> struct WideKey {
    std::array<uint8_t, N> bytes{};
    WideKey(uint64_t value = 0) {
        for (size_t i = 0; i < 8; ++i) { bytes[i] = uint8_t(value); value >>= 8; }
    }
    WideKey &operator^=(const WideKey &other) {
        for (size_t i = 0; i < N; ++i) bytes[i] ^= other.bytes[i];
        return *this;
    }
    bool operator==(const WideKey &other) const { return bytes == other.bytes; }
    bool operator<(const WideKey &other) const { return bytes < other.bytes; }
};
template<size_t N> std::ostream &operator<<(std::ostream &out, const WideKey<N> &key) {
    const char *hex = "0123456789abcdef";
    for (const auto byte : key.bytes) out << hex[byte >> 4] << hex[byte & 15];
    return out;
}
using Key128 = WideKey<16>;
using Key160 = WideKey<20>;
static_assert(sizeof(Key128) == 16 && sizeof(Key160) == 20, "Key must have no padding");
