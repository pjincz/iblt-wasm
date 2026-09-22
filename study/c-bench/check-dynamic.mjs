import assert from 'node:assert/strict';
import * as d from './dynamic-bridge.mjs';
import * as fixed from './checksum-bridge.mjs';
const hex=k=>Buffer.from(k).toString('hex');
let configs=0;
for(const width of [4,8,12,16,20,24,28,32,36,64,128,256]) for(const check of [4,8,12,16]) {
 const keys=[new Uint8Array(width),new Uint8Array(width).fill(255),...Array.from({length:width},(_,i)=>{const k=new Uint8Array(width);k[i]=1;return k;})];
 const a=d.create(width,check,2048),b=d.create(width,check,2048),batch=d.input(keys,width);
 d.update(a,batch);const wire=d.serialize(a);assert.equal(wire.length,2048*(4+width+check));
 const c=d.deserialize(width,check,2048,wire),copy=d.clone(a);
 const result=d.decode(c,b);assert(result.success);assert.deepEqual(result.onlyRemote.map(hex).sort(),keys.map(hex).sort());assert.equal(result.onlyLocal.length,0);
 const neg=d.decode(b,a);assert(neg.success);assert.deepEqual(neg.onlyLocal.map(hex).sort(),keys.map(hex).sort());
 assert.deepEqual(d.serialize(c),wire);assert.deepEqual(d.decode(a,copy),{success:true,onlyRemote:[],onlyLocal:[]});
 d.update(copy,batch,true);assert.deepEqual(d.serialize(copy),d.serialize(b));
 if(width===16 && [4,12].includes(check)) {
  const f=fixed.create(check*8,2048),fi=fixed.input(keys);fixed.update(f,fi);assert.deepEqual(fixed.serialize(f),wire);
  const received=fixed.deserialize(check*8,2048,wire),empty=fixed.create(check*8,2048);
  assert.deepEqual(fixed.decode(received,empty).onlyRemote.map(hex).sort(),keys.map(hex).sort());
  for(const t of [f,received,empty])fixed.destroy(t);fi.free();
 }
 for(let offset=0;offset<check;offset++) {
  const corrupt=d.serialize(b);corrupt[(2048-1)*(4+width+check)+4+width+offset]=1;
  const t=d.deserialize(width,check,2048,corrupt);assert.equal(d.decode(t,b).success,false);d.destroy(t);
 }
 const small=d.create(width,check,4),empty=d.create(width,check,4);d.update(small,batch);assert.equal(d.decode(small,empty).success,false);
 for(const t of [a,b,c,copy,small,empty])d.destroy(t);batch.free();configs++;
}
for(const args of [[0,12,512],[5,12,512],[16,0,512],[16,20,512],[16,12,511],[16,12,0],[16,12,2**32]]) assert.throws(()=>d.create(...args));
const a=d.create(16,12),b=d.create(20,12),batch=d.input([new Uint8Array(20)],20);
assert.throws(()=>d.update(a,batch));assert.throws(()=>d.decode(a,b));assert.throws(()=>d.deserialize(16,12,512,new Uint8Array(3)));
batch.free();assert.throws(()=>d.update(b,batch));d.destroy(a);assert.throws(()=>d.serialize(a));d.destroy(b);
console.log(`PASS: ${configs} WASM configurations; every key byte, +/- differences, clone/remove, roundtrip, fixed wire compatibility, every checksum byte, overloaded decode, invalid inputs`);
