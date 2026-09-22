import assert from 'node:assert/strict';
import * as d from 'iblt-wasm';
const hex=k=>Buffer.from(k).toString('hex');
let configs=0;
for(const width of [4,8,12,16,20,24,28,32,36,64,128,256]) for(const check of [4,8,12,16]) {
 const keys=[new Uint8Array(width),new Uint8Array(width).fill(255),...Array.from({length:width},(_,i)=>{const k=new Uint8Array(width);k[i]=1;return k;})];
 const a=d.create(width,check,2048),b=d.create(width,check,2048);
 d.add(a,keys);const wire=d.serialize(a);assert.equal(wire.length,2048*(4+width+check));
 const c=d.deserialize(width,check,2048,wire),copy=d.clone(a);
 const result=d.decode(c,b);assert(result.success);assert.deepEqual(result.onlyRemote.map(hex).sort(),keys.map(hex).sort());assert.equal(result.onlyLocal.length,0);
 const neg=d.decode(b,a);assert(neg.success);assert.deepEqual(neg.onlyLocal.map(hex).sort(),keys.map(hex).sort());
 assert.deepEqual(d.serialize(c),wire);assert.deepEqual(d.decode(a,copy),{success:true,onlyRemote:[],onlyLocal:[]});
 d.remove(copy,keys);assert.deepEqual(d.serialize(copy),d.serialize(b));
 for(let offset=0;offset<check;offset++) {
  const corrupt=d.serialize(b);corrupt[(2048-1)*(4+width+check)+4+width+offset]=1;
  const t=d.deserialize(width,check,2048,corrupt);assert.equal(d.decode(t,b).success,false);d.destroy(t);
 }
 const small=d.create(width,check,4),empty=d.create(width,check,4);d.add(small,keys);assert.equal(d.decode(small,empty).success,false);
 for(const t of [a,b,c,copy,small,empty])d.destroy(t);configs++;
}
for(const args of [[16,12],[16,12,undefined],[0,12,512],[5,12,512],[16,0,512],[16,20,512],[16,12,511],[16,12,0],[16,12,2**32]]) assert.throws(()=>d.create(...args));
const a=d.create(16,12,512),b=d.create(20,12,512);
assert.throws(()=>d.add(a,[new Uint8Array(20)]));assert.throws(()=>d.remove(a,[new Uint8Array(20)]));
assert.throws(()=>d.decode(a,b));assert.throws(()=>d.deserialize(16,12,512,new Uint8Array(3)));
d.destroy(a);assert.throws(()=>d.add(a,[]));assert.throws(()=>d.remove(a,[]));assert.throws(()=>d.serialize(a));d.destroy(b);
console.log(`PASS: ${configs} WASM configurations; every key byte, +/- differences, clone/remove, roundtrip, every checksum byte, overloaded decode, invalid inputs`);
