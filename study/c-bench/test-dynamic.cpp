#include "dynamic-iblt.h"
#include "vendor/smhasher/src/MurmurHash3.h"
#include <cassert>
#include <cstdio>
#include <random>
using namespace dynamic_iblt;
int main() {
 std::mt19937_64 rng(42);unsigned comparisons=0;
 for(unsigned bytes=4;bytes<=256;bytes+=4) {
  std::vector<uint8_t> key(bytes+1); // intentionally unaligned
  for(unsigned sample=0;sample<100;++sample) {
   for(auto &v:key)v=uint8_t(rng());
   for(uint32_t seed:{0U,1U,2U,3U,11U,0xffffffffU}) {
    uint32_t ref32;uint64_t ref128[2];
    // SMHasher reference uses native unaligned casts: don't sanitize that TU.
    MurmurHash3_x86_32(key.data()+1,bytes,seed,&ref32);
    MurmurHash3_x64_128(key.data()+1,bytes,seed,ref128);
    assert(hash32(key.data()+1,bytes,seed)==ref32);
    auto h=hash128(key.data()+1,bytes,seed);assert(h[0]==ref128[0]&&h[1]==ref128[1]);++comparisons;
   }
  }
 }
 assert(!IBLT::valid(512,0,12));assert(!IBLT::valid(512,5,12));assert(!IBLT::valid(512,16,20));assert(!IBLT::valid(511,16,12));assert(!IBLT::valid(0xfffffffcU,0xfffffffcU,16));
 for(unsigned keyBytes:{4U,12U,16U,20U,32U,64U,256U}) for(unsigned checkBytes:{4U,8U,12U,16U}) {
  IBLT a(512,keyBytes,checkBytes),b(512,keyBytes,checkBytes);
  std::vector<uint8_t> key(keyBytes),wire(a.wireBytes()),out;std::vector<int32_t>sides;
  assert(a.update(key.data(),1));assert(a.peel(out,sides));assert(out==key&&sides==std::vector<int32_t>{1});
  auto pos=a.indexes(key.data())[0];
  store32(wire.data()+pos*a.cellBytes(),INT32_MAX);a.deserialize(wire.data());assert(!a.update(key.data(),1));
  std::vector<uint8_t> after(wire.size());a.serialize(after.data());assert(wire==after);
  std::fill(after.begin(),after.end(),0);store32(after.data()+pos*a.cellBytes(),UINT32_MAX);b.deserialize(after.data());
  assert(!a.subtract(b));a.serialize(after.data());assert(wire==after);
 }
 printf("PASS: %u reference comparisons per hash; lengths 4..256 step4; unaligned keys; 28 overflow/layout configurations\n",comparisons);
}
