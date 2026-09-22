import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import * as base from '../../build/hash-analysis/prod-base/index.mjs';
import * as split from '../../build/hash-analysis/prod-split/index.mjs';
import * as inline from '../../build/hash-analysis/prod-split-inline/index.mjs';
import * as originalBase from '../../build/hash-indexes-baseline/index.mjs';
import * as originalSplit from '../../build/hash-indexes/index.mjs';
const libs=[['base',base],['split',split],['split-inline',inline],['original-base',originalBase],['original-split',originalSplit]],rows=[];
for(const n of [10000,300000]) {
 const cells=n===10000?512:5000,packed=new Uint8Array(n*16),view=new DataView(packed.buffer);
 let random=42;
 for(let i=0;i<n;i++)for(let j=0;j<4;j++){random^=random<<13;random^=random>>>17;random^=random<<5;view.setUint32(i*16+j*4,j===0?i:random>>>0,true);}
 const keys=Array.from({length:n},(_,i)=>packed.subarray(i*16,(i+1)*16));
 const states=libs.map(([name,lib])=>{const ptr=lib.wasm._malloc(packed.length);lib.wasm.HEAPU8.set(packed,ptr);return{name,lib,ptr};});
 try {
  for(let r=-10;r<30;r++) {
   const wires=new Map();
   for(let j=0;j<states.length;j++) {
    const {name,lib,ptr}=states[(r+10+j)%states.length],w=lib.wasm;
    const raw=w._dynamic_create(cells,16,12);let t=performance.now();const ok=w._dynamic_update(raw,ptr,n,0);const rawMs=performance.now()-t;assert.equal(ok,1);
    const rawOut=w._malloc(cells*32);w._dynamic_serialize(raw,rawOut);const rawWire=w.HEAPU8.slice(rawOut,rawOut+cells*32);w._free(rawOut);w._dynamic_destroy(raw);
    const table=lib.create(16,12,cells);t=performance.now();table.add(keys);const apiMs=performance.now()-t;
    const wire=table.serialize();table.destroy();assert.deepEqual(wire,rawWire);wires.set(name,wire);
    if(r>=0)rows.push({name,n,rawMs,apiMs});
   }
   assert.deepEqual(wires.get('split'),wires.get('split-inline'));
  }
 }finally{states.forEach(({lib,ptr})=>lib.wasm._free(ptr));}
 console.error(`production n=${n} done`);
}
const summary=[];
for(const n of [10000,300000])for(const [name]of libs){const rs=rows.filter(r=>r.n===n&&r.name===name);const median=key=>rs.map(r=>r[key]).sort((a,b)=>a-b)[14];summary.push({n,name,rawMs:+median('rawMs').toFixed(4),apiMs:+median('apiMs').toFixed(4),nsPerKey:+(median('rawMs')*1e6/n).toFixed(2)});}
console.table(summary);
await writeFile(process.env.OUTPUT??new URL('./results-production.json',import.meta.url),JSON.stringify({node:process.version,flags:process.execArgv,summary,rows},null,2)+'\n');
