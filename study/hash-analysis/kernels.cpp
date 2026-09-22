#ifndef IBLT_HEADER
#define IBLT_HEADER "../hash-indexes/baseline.h"
#endif
#include IBLT_HEADER
#include <chrono>
#include <cstdio>
#include <cstring>
using namespace dynamic_iblt;
#define NOINLINE __attribute__((noinline))
static uint32_t fold(const std::array<uint64_t,2> &h) { return uint32_t(h[0]) ^ uint32_t(h[0]>>32) ^ uint32_t(h[1]) ^ uint32_t(h[1]>>32); }
// All outputs are consumed. Width and section are runtime arguments.
extern "C" {
NOINLINE uint32_t hash32_once(const uint8_t *keys,unsigned n,unsigned width,unsigned reps,unsigned section) {
 uint32_t sink=0;for(unsigned r=0;r<reps;r++)for(unsigned i=0;i<n;i++)sink+=hash32(keys+size_t(i)*width,width,11);return sink;
}
NOINLINE uint32_t hash128_once(const uint8_t *keys,unsigned n,unsigned width,unsigned reps,unsigned section) {
 uint32_t sink=0;for(unsigned r=0;r<reps;r++)for(unsigned i=0;i<n;i++)sink+=fold(hash128(keys+size_t(i)*width,width,11));return sink;
}
NOINLINE uint32_t index32(const uint8_t *keys,unsigned n,unsigned width,unsigned reps,unsigned section) {
 uint32_t sink=0;for(unsigned r=0;r<reps;r++)for(unsigned i=0;i<n;i++)for(unsigned seed=0;seed<4;seed++)sink+=hash32(keys+size_t(i)*width,width,seed)%section;return sink;
}
NOINLINE uint32_t index128(const uint8_t *keys,unsigned n,unsigned width,unsigned reps,unsigned section) {
 uint32_t sink=0;for(unsigned r=0;r<reps;r++)for(unsigned i=0;i<n;i++) {
 auto h=hash128(keys+size_t(i)*width,width,0);
 sink+=uint32_t(h[0])%section+uint32_t(h[0]>>32)%section+uint32_t(h[1])%section+uint32_t(h[1]>>32)%section;
 }return sink;
}
NOINLINE uint32_t index32_check(const uint8_t *keys,unsigned n,unsigned width,unsigned reps,unsigned section) {
 uint32_t sink=0;for(unsigned r=0;r<reps;r++)for(unsigned i=0;i<n;i++) {
 const auto *key=keys+size_t(i)*width;for(unsigned seed=0;seed<4;seed++)sink+=hash32(key,width,seed)%section;
 sink+=fold(hash128(key,width,11));
 }return sink;
}
NOINLINE uint32_t index128_check(const uint8_t *keys,unsigned n,unsigned width,unsigned reps,unsigned section) {
 uint32_t sink=0;for(unsigned r=0;r<reps;r++)for(unsigned i=0;i<n;i++) {
 const auto *key=keys+size_t(i)*width;auto h=hash128(key,width,0);
 sink+=uint32_t(h[0])%section+uint32_t(h[0]>>32)%section+uint32_t(h[1])%section+uint32_t(h[1]>>32)%section;
 sink+=fold(hash128(key,width,11));
 }return sink;
}
NOINLINE uint32_t updates(const uint8_t *keys,unsigned n,unsigned width,unsigned reps,unsigned section) {
 IBLT table(section*4,width,12);
 for(unsigned r=0;r<reps;r++)for(unsigned i=0;i<n;i++)if(!table.update(keys+size_t(i)*width,r%2?-1:1))std::abort();
 std::vector<uint8_t> wire(table.wireBytes());table.serialize(wire.data());
 uint32_t sink=0;for(auto b:wire)sink+=b;return sink;
}
}
#ifndef __EMSCRIPTEN__
using Kernel=uint32_t(*)(const uint8_t*,unsigned,unsigned,unsigned,unsigned);
int main() {
 const char *names[]={"hash32_once","hash128_once","index32","index128","index32_check","index128_check","updates"};
 Kernel funcs[]={hash32_once,hash128_once,index32,index128,index32_check,index128_check,updates};
 for(unsigned width:{4U,16U,20U,32U,64U}) {
  const unsigned n=32768,reps=9,section=1250;
  std::vector<uint8_t> keys(size_t(n)*width);uint32_t random=42;
  for(auto &b:keys){random^=random<<13;random^=random>>17;random^=random<<5;b=uint8_t(random);}
  for(int r=-4;r<15;r++)for(unsigned j=0;j<7;j++) {
   unsigned k=(r+4+j)%7;
   auto start=std::chrono::steady_clock::now();auto sink=funcs[k](keys.data(),n,width,reps,section);auto end=std::chrono::steady_clock::now();
   if(r>=0)printf("%u,%s,%.6f,%u\n",width,names[k],std::chrono::duration<double,std::milli>(end-start).count(),sink);
  }
 }
}
#endif
