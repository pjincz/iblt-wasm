import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import * as lib from '../../dist/index.mjs';
const hex=key=>Buffer.from(key).toString('hex');
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

const recorded=JSON.parse(await readFile(new URL('./results.json',import.meta.url)));
const rows=recorded.capacity.filter(row=>row.name==='hash128split').map(row=>({...row,success:0,expectedSuccess:row.success}));
for(const diff of [100,1000])for(const pattern of ['random','timestamps','prefix']) {
 const group=rows.filter(row=>row.diff===diff&&row.pattern===pattern);
 for(let r=0;r<1000;r++) {
  const keys=makeKeys(diff,r*diff,16,pattern),ka=keys.slice(0,diff/2),kb=keys.slice(diff/2);
  const expectedA=ka.map(hex).sort(),expectedB=kb.map(hex).sort();
  for(const row of group) {
   const a=lib.create(16,12,row.cells),b=lib.create(16,12,row.cells);
   try {
    a.add(ka);b.add(kb);const result=a.decode(b);
    if(result.success){assert.deepEqual(result.onlyRemote.map(hex).sort(),expectedA);assert.deepEqual(result.onlyLocal.map(hex).sort(),expectedB);row.success++;}
   }finally{a.destroy();b.destroy();}
  }
 }
 for(const row of group)assert.equal(row.success,row.expectedSuccess);
 console.error(`Production capacity matches: diff=${diff}, pattern=${pattern}`);
}
await writeFile(new URL('./results-production-capacity.json',import.meta.url),JSON.stringify({description:'Production hash128 with early inlining: exact success counts match recorded split candidate; every successful decode checked against true differences',decodes:42000,rows},null,2)+'\n');
console.log('PASS: 42000 decodes; all 42 configurations match recorded candidate success counts; zero incorrect successful decodes');
