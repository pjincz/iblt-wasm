import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as iblt from '../../dist/index.mjs';

const cells = 100, keyBytes = 16, checksumBytes = 12, trials = 10_000;
const differences = [0, 1, 2, 5, 10, 20, 30, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100];
const patterns = ['random128', 'timestamp-pair'];
const seed = 0x19a7823d;
let state = seed;
function random() {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return state >>> 0;
}
const hex = key => Buffer.from(key).toString('hex');
const normalized = keys => keys.map(hex).sort();
const results = [];
const started = performance.now();
for (const difference of differences) {
  for (const pattern of patterns) {
    let success = 0, incorrectSuccess = 0;
    for (let trial = 0; trial < trials; ++trial) {
      const base = random();
      const keys = Array.from({length: difference}, (_,i) => {
        const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
        if (pattern === 'random128') {
          // Distinct within each trial; random remaining 96 bits.
          view.setUint32(0, (base + i) >>> 0, true);
          for (let offset = 4; offset < 16; offset += 4) view.setUint32(offset, random(), true);
        } else {
          const created = 1_700_000_000n + BigInt(base) + BigInt(i) * 86400n;
          view.setBigUint64(0, created, true);
          view.setBigUint64(8, created + BigInt(random() % (30 * 86400)), true);
        }
        return bytes;
      });
      const split = Math.ceil(difference / 2);
      const remoteKeys = keys.slice(0, split), localKeys = keys.slice(split);
      const remote = iblt.create(keyBytes, checksumBytes, cells);
      const local = iblt.create(keyBytes, checksumBytes, cells);
      try {
        // Common keys cancel exactly, so construct only the symmetric difference.
        remote.add(remoteKeys); local.add(localKeys);
        const result = remote.decode(local);
        if (result.success) {
          ++success;
          try {
            assert.deepEqual(normalized(result.onlyRemote), normalized(remoteKeys));
            assert.deepEqual(normalized(result.onlyLocal), normalized(localKeys));
          } catch { ++incorrectSuccess; }
        }
      } finally { remote.destroy(); local.destroy(); }
    }
    results.push({difference, pattern, trials, success, failed: trials-success,
      successPercent: success / trials * 100, incorrectSuccess});
  }
  const rows = results.slice(-patterns.length);
  console.log(`${difference} differences: ${rows.map(r => `${r.pattern} ${r.success}/${trials} (${r.successPercent.toFixed(2)}%)`).join('; ')}`);
}
const report = {date: new Date().toISOString(), node: process.version, cells, keyBytes,
  checksumBytes, countBits: 32, payloadBytes: cells * (4 + keyBytes + checksumBytes),
  trialsPerPattern: trials, seed, elapsedSeconds: (performance.now()-started)/1000,
  notes: 'Distinct keys; differences split approximately evenly between remote and local. Common keys omitted because they cancel. All successful outputs checked exactly, including sign and multiplicity. Trials are deterministic pseudorandom samples, not a capacity guarantee.', results};
writeFileSync(new URL('./capacity-100-results.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
assert.equal(results.reduce((n,r) => n+r.incorrectSuccess,0),0,'Incorrect successful decode');
console.log(`Completed in ${report.elapsedSeconds.toFixed(1)}s; no incorrect successful decodes.`);
