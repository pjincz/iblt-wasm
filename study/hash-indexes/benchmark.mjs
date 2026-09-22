import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
import * as baseline from '../../build/hash-indexes-baseline/index.mjs';
import * as split from '../../build/hash-indexes/index.mjs';
const variants = [['hash32x4', baseline], ['hash128split', split]];
const hex = key => Buffer.from(key).toString('hex');
const now = () => performance.now();
function makeKeys(count, offset, width = 16, pattern = 'random') {
  return Array.from({ length: count }, (_, i) => {
    const bytes = new Uint8Array(width), view = new DataView(bytes.buffer), id = offset + i;
    let state = (id + 1) >>> 0;
    for (let j = 0; j < width; j += 4) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      view.setUint32(j, state >>> 0, true);
    }
    if (pattern === 'prefix') { bytes.fill(0x61); view.setUint32(width - 4, id, true); }
    else if (pattern === 'timestamps') { view.setBigUint64(0, 1700000000000n + BigInt(id), true); view.setBigUint64(8, 1700000001000n + BigInt(id), true); }
    else view.setUint32(0, Math.imul(id, 2654435761) >>> 0, true); // unique IDs modulo 2^32
    return bytes;
  });
}
function expected(a, b) { return [a.map(hex).sort(), b.map(hex).sort()]; }
function verify(result, want) {
  if (!result.success) return false;
  assert.deepEqual(result.onlyRemote.map(hex).sort(), want[0]);
  assert.deepEqual(result.onlyLocal.map(hex).sort(), want[1]);
  return true;
}
function sync(lib, a, b, cells, want) {
  let t = now(); const wire = a.serialize(), received = lib.deserialize(16, 12, cells, wire); const codecMs = now() - t;
  try {
    t = now(); const result = received.decode(b); const decodeMs = now() - t;
    assert(verify(result, want));
    return { codecMs, decodeMs, wireBytes: wire.length };
  } finally { received.destroy(); }
}
const performanceRuns = [];
for (const [n, diff, cells] of [[10000,100,512],[300000,1000,5000]]) {
  const half = diff / 2, common = makeKeys(n-half, 0), trials = 30, warmups = 5;
  let oldA = makeKeys(half, n), oldB = makeKeys(half, n+half);
  const states = variants.map(([name, lib]) => {
    const a=lib.create(16,12,cells), b=lib.create(16,12,cells);
    a.add([...common,...oldA]);b.add([...common,...oldB]);
    return {name,lib,a,b,fresh:[],maintained:[]};
  });
  try {
    for(let r=0;r<trials+warmups;r++) {
      const onlyA=makeKeys(half,n+(r+1)*diff),onlyB=makeKeys(half,n+(r+1)*diff+half);
      const keysA=[...common,...onlyA],keysB=[...common,...onlyB],want=expected(onlyA,onlyB);
      for(let j=0;j<states.length;j++) {
        const state=states[(r+j)%states.length],{lib,a,b}=state;
        let t=now();const fa=lib.create(16,12,cells);fa.add(keysA);const fb=lib.create(16,12,cells);fb.add(keysB);const buildMs=now()-t;
        try {
          const fresh=sync(lib,fa,fb,cells,want);fresh.buildMs=buildMs;fresh.totalMs=buildMs+fresh.codecMs+fresh.decodeMs;
          t=now();a.remove(oldA);a.add(onlyA);b.remove(oldB);b.add(onlyB);const updateMs=now()-t;
          const maintained=sync(lib,a,b,cells,want);maintained.updateMs=updateMs;maintained.totalMs=updateMs+maintained.codecMs+maintained.decodeMs;
          assert.deepEqual(a.serialize(),fa.serialize());assert.deepEqual(b.serialize(),fb.serialize());
          if(r>=warmups){state.fresh.push(fresh);state.maintained.push(maintained);}
        } finally {fa.destroy();fb.destroy();}
      }
      oldA=onlyA;oldB=onlyB;
    }
    for(const {name,fresh,maintained} of states) performanceRuns.push({name,n,diff,cells,trials,warmups,fresh,maintained});
  } finally {states.forEach(({a,b})=>{a.destroy();b.destroy();});}
  console.error(`Performance complete: n=${n}, diff=${diff}`);
}
const capacity=[];
const trials=1000;
for(const diff of (process.env.PERFORMANCE_ONLY ? [] : [100,1000])) for(const pattern of ['random','timestamps','prefix']) {
  const rows=[];
  for(const ratio of [1.2,1.3,1.4,1.5,2,3,5]) for(const [name] of variants) rows.push({name,diff,pattern,cells:Math.ceil(diff*ratio/4)*4,trials,success:0});
  for(let r=0;r<trials;r++) {
    const keys=makeKeys(diff,r*diff,16,pattern),aKeys=keys.slice(0,diff/2),bKeys=keys.slice(diff/2),want=expected(aKeys,bKeys);
    for(const row of rows) {
      const lib=row.name==='hash32x4'?baseline:split,a=lib.create(16,12,row.cells),b=lib.create(16,12,row.cells);
      try {a.add(aKeys);b.add(bKeys);if(verify(a.decode(b),want))row.success++;}
      finally {a.destroy();b.destroy();}
    }
  }
  capacity.push(...rows);
  console.error(`Capacity complete: diff=${diff}, pattern=${pattern}`);
}
function p(rows,field,q=0.5) {const xs=rows.map(r=>r[field]).sort((a,b)=>a-b);return +xs[Math.ceil(xs.length*q)-1].toFixed(4);}
const summary=performanceRuns.map(r=>({name:r.name,n:r.n,diff:r.diff,cells:r.cells,freshMs:p(r.fresh,'totalMs'),freshP95Ms:p(r.fresh,'totalMs',.95),buildMs:p(r.fresh,'buildMs'),maintainedMs:p(r.maintained,'totalMs'),maintainedP95Ms:p(r.maintained,'totalMs',.95),updateMs:p(r.maintained,'updateMs'),decodeMs:p(r.maintained,'decodeMs')}));
console.table(summary);console.table(capacity);
await writeFile(process.env.OUTPUT ?? new URL('./results.json',import.meta.url),JSON.stringify({environment:{node:process.version,cpu:cpus()[0].model},checksum:'MurmurHash3_x64_128 seed 11 first 12 bytes in both variants',notes:'Performance includes JS validation/packing/free; no network; capacity omits common keys because they cancel. All successful results verified exactly; false success asserts. No changes to production bucket mapping.',summary,performanceRuns,capacity},null,2)+'\n');
