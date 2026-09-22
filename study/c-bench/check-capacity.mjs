// Capacity-only experiment: common keys cancel exactly, so build only differences.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import * as lib from './dynamic-bridge.mjs';
const trials=100, diff=1000, sizes=[1500,2000,3000,5000];
const rows=sizes.map(cells=>({cells,wireBytes:cells*32,success:0,wrongResults:0,trials}));
const hex=k=>Buffer.from(k).toString('hex');
for(let r=0;r<trials;r++) {
 const keys=Array.from({length:diff},(_,i)=>createHash('sha1').update(`capacity:${r}:${i}`).digest().subarray(0,16));
 const ka=keys.slice(0,diff/2),kb=keys.slice(diff/2),ai=lib.input(ka,16),bi=lib.input(kb,16);
 try {
  for(const row of rows) {
   const a=lib.create(16,12,row.cells),b=lib.create(16,12,row.cells);
   try {
    lib.update(a,ai);lib.update(b,bi);const result=lib.decode(a,b);
    if(result.success) {
     try {assert.deepEqual(result.onlyRemote.map(hex).sort(),ka.map(hex).sort());assert.deepEqual(result.onlyLocal.map(hex).sort(),kb.map(hex).sort());row.success++;}
     catch {row.wrongResults++;}
    }
   } finally {lib.destroy(a);lib.destroy(b);}
  }
 } finally {ai.free();bi.free();}
}
console.table(rows);
await writeFile(new URL('./results-capacity-1000.json',import.meta.url),JSON.stringify({diff,trials,description:'Capacity only: 500 unique keys per endpoint; common records omitted because they cancel; no build timing',rows},null,2)+'\n');
if(rows.some(r=>r.wrongResults))process.exitCode=1;
