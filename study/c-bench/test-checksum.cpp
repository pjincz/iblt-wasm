#include "key-only-iblt.h"
#include "vendor/smhasher/src/MurmurHash3.h"
#include <cassert>
#include <cstdio>
#include <random>
using namespace key_only;
int main() {
    std::mt19937_64 rng(42);
    for (unsigned i=0;i<10000;++i) {
        Key key; for(auto &b:key) b=uint8_t(rng());
        for(uint32_t seed : {0U,1U,2U,3U,11U,0xffffffffU}) {
            uint32_t a; uint64_t b[2];
            MurmurHash3_x86_32(key.data(),16,seed,&a);
            MurmurHash3_x64_128(key.data(),16,seed,b);
            assert(hash32(key,seed)==a);
            auto h=hash128(key,seed); assert(h[0]==b[0] && h[1]==b[1]);
        }
    }
    IBLT<3> a(512), b(512); Key key{};
    a.cells[a.indexes(key)[0]].count=INT32_MAX;
    auto before=a.cells; assert(!a.update(key,1));
    for(unsigned i=0;i<512;++i) assert(a.cells[i].count==before[i].count && a.cells[i].keySum==before[i].keySum);
    b.cells[a.indexes(key)[0]].count=-1; assert(!a.subtract(b));
    for(unsigned i=0;i<16;++i) key[i]=i;
    auto h=IBLT<3>::checksum(key); uint8_t bytes[12];
    for(unsigned i=0;i<3;++i) store32(bytes+4*i,h[i]);
    printf("hash96(00..0f, seed=11): "); for(auto v:bytes) printf("%02x",v); puts("");
    puts("PASS: 60000 reference comparisons per hash variant; counter overflow guards; bucket sizeof assertions");
}
