#include "../../src/cpp/iblt.h"
#include "../c-bench/vendor/smhasher/src/MurmurHash3.h"
#include <cassert>
#include <cstdio>
#include <random>
int main() {
 std::mt19937_64 rng(42);unsigned checks=0;
 for(unsigned width=4;width<=256;width+=4)for(unsigned sample=0;sample<100;++sample) {
  std::vector<uint8_t> key(width);for(auto &b:key)b=uint8_t(rng());
  uint64_t positionsHash[2],sumHash[2];
  MurmurHash3_x64_128(key.data(),width,0,positionsHash);
  MurmurHash3_x64_128(key.data(),width,11,sumHash);
  uint32_t words[]={uint32_t(positionsHash[0]),uint32_t(positionsHash[0]>>32),uint32_t(positionsHash[1]),uint32_t(positionsHash[1]>>32)};
  for(unsigned check:{4U,8U,12U,16U}) {
   iblt::IBLT table(512,width,check);
   auto positions=table.indexes(key.data()),sum=table.checksum(key.data());
   for(unsigned i=0;i<4;i++)assert(positions[i]==i*128+words[i]%128);
   for(unsigned i=0;i<check/4;i++)assert(sum[i]==uint32_t(sumHash[i/2]>>((i%2)*32)));
   ++checks;
  }
 }
 uint8_t key[16];for(unsigned i=0;i<16;i++)key[i]=i;
 uint64_t h[2];MurmurHash3_x64_128(key,16,0,h);
 printf("seed0 reference words: %u %u %u %u\n",uint32_t(h[0]),uint32_t(h[0]>>32),uint32_t(h[1]),uint32_t(h[1]>>32));
 printf("PASS: %u production mapping/checksum comparisons with SMHasher reference\n",checks);
}
