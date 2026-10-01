import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import * as iblt from '../../dist/index.mjs';

const records = 300_000, keyBytes = 16, checksumBytes = 12;
const warmup = 2000, rounds = 31, batch = 500;
const tables = [], cases = [], originals = [];
let sink = 0;
try {
  const keys = Array.from({length: records}, (_,i) => {
    const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
    view.setBigUint64(0, 1_700_000_000_000n + BigInt(i), true);
    view.setBigUint64(8, 1_700_100_000_000n + BigInt(i), true);
    return bytes;
  });
  for (const [sourceCells, targetCells] of [[4096,512], [5000,500]]) {
    const source = iblt.create(keyBytes,checksumBytes,sourceCells);
    tables.push(source);
    source.add(keys);
    originals.push(source.serialize());
    const direct = iblt.create(keyBytes,checksumBytes,targetCells);
    const folded = source.fold(targetCells);
    try {
      direct.add(keys);
      assert.deepEqual(source.serialize(targetCells),direct.serialize());
      assert.deepEqual(folded.serialize(),direct.serialize());
    } finally { direct.destroy(); folded.destroy(); }
    cases.push({sourceCells,targetCells,method:'serialize(cells)',run:()=>source.serialize(targetCells),samples:[]});
    cases.push({sourceCells,targetCells,method:'fold + serialize + destroy',run:()=>{
      const t=source.fold(targetCells);
      try {return t.serialize();} finally {t.destroy();}
    },samples:[]});
  }
  keys.length=0;
  function measure(c,n) {
    const start=performance.now();
    for(let i=0;i<n;i++) {
      const bytes=c.run();
      sink=(sink+bytes.length+bytes[i%bytes.length])>>>0;
    }
    return (performance.now()-start)*1000/n;
  }
  for(const c of cases) measure(c,warmup);
  for(let r=0;r<rounds;r++) for(let i=0;i<cases.length;i++) {
    const c=cases[(i+r)%cases.length];
    c.samples.push(measure(c,batch));
  }
  tables.forEach((t,i)=>assert.deepEqual(t.serialize(),originals[i]));
  const results=cases.map(({sourceCells,targetCells,method,samples})=>{
    const sorted=[...samples].sort((a,b)=>a-b);
    return {sourceCells,targetCells,method,sourceBytes:sourceCells*32,targetBytes:targetCells*32,
      medianUs:sorted[Math.floor(rounds/2)],p95BatchMeanUs:sorted[Math.ceil(rounds*.95)-1],samplesUs:samples};
  });
  const report={date:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,
    records,keyBytes,checksumBytes,countBits:32,warmup,rounds,batch,sink,
    timing:'Interleaved public API calls; includes allocation and output copy, excludes table population. Median of batch means, not individual call latency.',results};
  writeFileSync(new URL('./comparison-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.table(results.map(({sourceCells,targetCells,method,medianUs,p95BatchMeanUs})=>({
    cells:`${sourceCells} -> ${targetCells}`,method,medianUs:+medianUs.toFixed(2),p95BatchMeanUs:+p95BatchMeanUs.toFixed(2)})));
  console.log(`5000->500 / 4096->512 direct time ratio: ${(results[2].medianUs/results[0].medianUs).toFixed(3)}`);
} finally {tables.forEach(t=>t.destroy());}
