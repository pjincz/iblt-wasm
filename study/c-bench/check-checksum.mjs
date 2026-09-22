import assert from 'node:assert/strict';
import * as lib from './checksum-bridge.mjs';
import * as old from './wide-bridge.mjs';
const hex = k => Buffer.from(k).toString('hex');
const keys = [new Uint8Array(16),new Uint8Array(16).fill(255),...Array.from({length:16},(_,i)=>{const k=new Uint8Array(16);k[i]=1;return k;})];
const input=lib.input(keys), oi=old.input(keys,16);
const ptr=lib.wasm._malloc(28);
lib.wasm.HEAPU8.set(Uint8Array.from({length:16},(_,i)=>i),ptr);
lib.wasm._checked_hash96(ptr,ptr+16);
assert.equal(hex(lib.wasm.HEAPU8.slice(ptr+16,ptr+28)),'409bf1ed862b82df7d98d374');lib.wasm._free(ptr);
for(const bits of [32,96]) {
 const a=lib.create(bits,512), b=lib.create(bits,512);
 assert.equal(lib.wasm._checked_cell_bytes(a),20+bits/8);
 lib.update(a,input);
 const wire=lib.serialize(a); assert.equal(wire.length,512*(20+bits/8));
 const restored=lib.deserialize(bits,512,wire), copy=lib.clone(a);
 assert.deepEqual(lib.serialize(restored),wire);
 const result=lib.decode(restored,b); assert(result.success); assert.deepEqual(result.onlyRemote.map(hex).sort(),keys.map(hex).sort());assert.equal(result.onlyLocal.length,0);
 assert(lib.decode(a,copy).success);assert.equal(lib.decode(a,copy).onlyRemote.length,0);
 assert.deepEqual(lib.serialize(a),wire);
 const negative=lib.decode(b,a);assert(negative.success);assert.deepEqual(negative.onlyLocal.map(hex).sort(),keys.map(hex).sort());
 lib.update(copy,input,true);assert.deepEqual(lib.serialize(copy),lib.serialize(b));
 if(bits===32){const t=old.create(128,512);old.update(t,oi);assert.deepEqual(old.serialize(t),wire);old.destroy(t);}
 // Every checksum byte, including the high 64 bits, must affect residual checks.
 for(let i=20;i<20+bits/8;i++) {
   const corrupt=lib.serialize(b);corrupt[511*(20+bits/8)+i]=1;
   const t=lib.deserialize(bits,512,corrupt);assert.equal(lib.decode(t,b).success,false);lib.destroy(t);
 }
 const small=lib.create(bits,4),empty=lib.create(bits,4);lib.update(small,input);assert.equal(lib.decode(small,empty).success,false);
 for(const t of [a,b,restored,copy,small,empty])lib.destroy(t);
}
input.free();oi.free();
console.log('PASS: WASM hash vector, every key byte, zero/ff keys, positive/negative differences, clone/remove, roundtrip, legacy32 wire equality, checksum residuals, overloaded decode');
