import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import createBase from '../../build/hash-analysis/base.mjs';
import createSplit from '../../build/hash-analysis/split.mjs';
const base=await createBase(),split=await createSplit();
const names=['hash32_once','hash128_once','index32','index128','index32_check','index128_check','updates'];
const rows=[];
for(const width of [4,16,20,32,64]) {
 const n=32768,reps=9,section=1250,keys=new Uint8Array(n*width);
 let random=42;
 for(let i=0;i<keys.length;i++){random^=random<<13;random^=random>>>17;random^=random<<5;keys[i]=random&255;}
 const tasks=[];
 for(const [variant,lib] of [['base',base],['split',split]]) {
  const ptr=lib._malloc(keys.length);lib.HEAPU8.set(keys,ptr);
  for(const name of names) tasks.push({variant,lib,ptr,name});
 }
 try {
  for(let r=-8;r<21;r++)for(let j=0;j<tasks.length;j++) {
   const t=tasks[(r+8+j)%tasks.length],start=performance.now();
   const sink=t.lib['_'+t.name](t.ptr,n,width,reps,section)>>>0,ms=performance.now()-start;
   if(r>=0) rows.push({width,variant:t.variant,name:t.name,ms,sink});
  }
 }finally{base._free(tasks[0].ptr);split._free(tasks[7].ptr);}
 console.error(`kernels width ${width} done`);
}
const summary=[];
for(const width of [4,16,20,32,64])for(const variant of ['base','split'])for(const name of names) {
 const selected=rows.filter(r=>r.width===width&&r.variant===variant&&r.name===name),times=selected.map(r=>r.ms).sort((a,b)=>a-b);
 if(new Set(selected.map(r=>r.sink)).size!==1)throw new Error('Inconsistent output');
 summary.push({width,variant,name,ms:+times[Math.floor(times.length/2)].toFixed(4),nsPerKey:+(times[Math.floor(times.length/2)]*1e6/(32768*9)).toFixed(2),sink:selected[0].sink});
}
console.table(summary.filter(r=>r.width===16));
await writeFile(process.env.OUTPUT ?? new URL('./results-wasm.json',import.meta.url),JSON.stringify({node:process.version,flags:process.execArgv,n:32768,reps:9,section:1250,summary,rows},null,2)+'\n');
