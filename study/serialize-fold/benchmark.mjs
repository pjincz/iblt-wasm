import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import * as iblt from '../../dist/index.mjs';

// Run from any directory: node study/serialize-fold/benchmark.mjs
const records = 300_000, sourceCells = 4096, targetCells = 512;
const keyBytes = 16, checksumBytes = 12;
const warmup = 2000, rounds = 31, batch = 500;
const source = iblt.create(keyBytes, checksumBytes, sourceCells);
let small;
let sink = 0;
try {
  // Dataset construction and population are outside the timed region.
  const keys = Array.from({ length: records }, (_, i) => {
    const bytes = new Uint8Array(keyBytes);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, 1_700_000_000_000n + BigInt(i), true);
    view.setBigUint64(8, 1_700_100_000_000n + BigInt(i), true);
    return bytes;
  });
  source.add(keys);
  small = source.fold(targetCells);
  const original = source.serialize();
  const expected = small.serialize();
  assert.deepEqual(source.serialize(targetCells), expected);
  // Independent reference: build at the target size from the original keys.
  const direct = iblt.create(keyBytes, checksumBytes, targetCells);
  try { direct.add(keys); assert.deepEqual(expected, direct.serialize()); }
  finally { direct.destroy(); }
  keys.length = 0;

  const cases = [
    { name: 'serialize(512)', run: () => source.serialize(targetCells) },
    { name: 'fold(512).serialize() + destroy', run: () => {
      const folded = source.fold(targetCells);
      try { return folded.serialize(); } finally { folded.destroy(); }
    } },
    { name: 'serialize() 4096 cells', run: () => source.serialize() },
    { name: 'serialize() existing 512 cells', run: () => small.serialize() },
  ].map(c => ({ ...c, samples: [] }));
  function runBatch(c, count) {
    const start = performance.now();
    for (let i = 0; i < count; ++i) {
      const bytes = c.run();
      sink = (sink + bytes[i % bytes.length] + bytes.length) >>> 0;
    }
    return (performance.now() - start) * 1000 / count;
  }
  for (const c of cases) runBatch(c, warmup);
  // Rotate order to reduce systematic warmup/temperature/order bias.
  for (let round = 0; round < rounds; ++round) {
    for (let i = 0; i < cases.length; ++i) {
      const c = cases[(round + i) % cases.length];
      c.samples.push(runBatch(c, batch));
    }
  }
  assert.deepEqual(source.serialize(), original);
  const results = cases.map(c => {
    const sorted = [...c.samples].sort((a,b) => a-b);
    return {
      name: c.name,
      medianUs: sorted[Math.floor(sorted.length / 2)],
      minUs: sorted[0],
      p95BatchMeanUs: sorted[Math.ceil(sorted.length * .95) - 1],
      samplesUs: c.samples,
    };
  });
  const report = {
    node: process.version, cpu: cpus()[0]?.model, date: new Date().toISOString(),
    records, keyBytes, checksumBytes, countBits: 32, sourceCells, targetCells,
    sourceBytes: original.length, targetBytes: expected.length,
    warmup, rounds, batch, sink,
    timing: 'Public JS API, including WASM allocation, output copy and JS allocation. Temporary folded tables explicitly destroyed. Population and correctness checks excluded. Each sample is a batch mean; p95 is not per-call latency.',
    results,
  };
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(`${process.version}; ${report.cpu}`);
  console.log(`${records} records; ${sourceCells} -> ${targetCells} cells; ${original.length} -> ${expected.length} bytes`);
  console.table(results.map(({name, medianUs, minUs, p95BatchMeanUs}) => ({
    name, medianUs: +medianUs.toFixed(2), minUs: +minUs.toFixed(2), p95BatchMeanUs: +p95BatchMeanUs.toFixed(2),
  })));
  console.log(`Direct serialization speedup over fold+serialize: ${(results[1].medianUs/results[0].medianUs).toFixed(2)}x`);
} finally {
  small?.destroy();
  source.destroy();
}
