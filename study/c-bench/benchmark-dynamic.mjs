import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import * as fixed from './checksum-bridge.mjs';
import * as dynamic from './dynamic-bridge.mjs';
const adapters = {};
for (const [id, checkBits, runtime] of [[1,32,false],[2,32,true],[3,96,false],[4,96,true]]) {
 const impl = runtime ? dynamic : fixed;
 adapters[id] = { ...impl,
   create: (_, cells) => runtime ? dynamic.create(16,checkBits/8,cells) : fixed.create(checkBits,cells),
   deserialize: (_, cells, bytes) => runtime ? dynamic.deserialize(16,checkBits/8,cells,bytes) : fixed.deserialize(checkBits,cells,bytes),
   input: keys => impl.input(keys,16), decode: (a,b) => impl.decode(a,b)
 };
}
let lib;
const labels = {8:'fixed128/check32',16:'dynamic128/check32',24:'fixed128/check96',32:'dynamic128/check96'};

const n = Number(process.env.N ?? 10000), diff = Number(process.env.DIFF ?? 100);
const cells = Number(process.env.CELLS ?? 512);
const trials = Number(process.env.TRIALS ?? 100), warmups = Number(process.env.WARMUPS ?? 20);
for (const x of [n, diff, cells, trials, warmups]) assert(Number.isSafeInteger(x) && x >= 0);
assert(n > 0 && diff % 2 === 0 && diff <= 2 * n && cells >= 4 && cells % 4 === 0 && trials > 0);
const half = diff / 2, widths = [1, 2, 3, 4], now = () => performance.now();
const hex = x => Buffer.from(x).toString('hex');
function hashes(prefix, count) {
  return Array.from({ length: count }, (_, i) => createHash('sha1').update(`wide-iblt:${prefix}:${i}`).digest());
}
function dataset(epoch) {
  const all = hashes(`fresh:${epoch}`, n + half);
  return { common: all.slice(0, n - half), onlyA: all.slice(n - half, n), onlyB: all.slice(n) };
}
function narrow(data, ignored) {
  const width = 16;
  const common = data.common.map(x => x.subarray(0, width));
  const onlyA = data.onlyA.map(x => x.subarray(0, width)), onlyB = data.onlyB.map(x => x.subarray(0, width));
  const a = [...common, ...onlyA], b = [...common, ...onlyB];
  assert.equal(new Set([...a, ...onlyB].map(hex)).size, n + half);
  return { a, b, onlyA, onlyB };
}
function check(result, data) {
  if (!result.success) return false;
  try {
    assert.deepEqual(result.onlyRemote.map(hex).sort(), data.onlyA.map(hex).sort());
    assert.deepEqual(result.onlyLocal.map(hex).sort(), data.onlyB.map(hex).sort());
    return true;
  } catch { return false; }
}
function sync(a, b, width, data) {
  let t = now();
  const wire = lib.serialize(a), received = lib.deserialize(width * 8, cells, wire);
  const wireCodecMs = now() - t;
  try {
    assert.deepEqual(lib.serialize(received), wire);
    t = now(); const result = lib.decode(received, b, width); const decodeMs = now() - t;
    const correct = check(result, data);
    return { success: result.success && correct, reportedSuccess: result.success, wrongResult: result.success && !correct,
      recovered: result.onlyRemote.length + result.onlyLocal.length, wireCodecMs, decodeMs,
      syncMs: wireCodecMs + decodeMs, wireBytes: wire.length };
  } finally { lib.destroy(received); }
}
function fresh(width, data) {
  lib = adapters[width];
  const ai = lib.input(data.a, width), bi = lib.input(data.b, width);
  let a = 0, b = 0;
  try {
    let t = now(); a = lib.create(width * 8, cells); lib.update(a, ai); const senderBuildMs = now() - t;
    t = now(); b = lib.create(width * 8, cells); lib.update(b, bi); const receiverBuildMs = now() - t;
    const result = sync(a, b, width, data);
    return { ...result, senderBuildMs, receiverBuildMs, totalMs: senderBuildMs + receiverBuildMs + result.syncMs };
  } finally { if (a) lib.destroy(a); if (b) lib.destroy(b); ai.free(); bi.free(); }
}
const runs = { fresh: {}, maintained: {} };
for (const width of widths) { runs.fresh[width * 8] = []; runs.maintained[width * 8] = []; }
for (let r = -warmups; r < trials; ++r) {
  const data = dataset(r);
  for (let j = 0; j < widths.length; ++j) {
    const width = widths[(r + warmups + j) % widths.length];
    const result = fresh(width, narrow(data, width));
    if (r >= 0) runs.fresh[width * 8].push(result);
  }
  if (r < 0 || (r + 1) % 10 === 0) console.error(`fresh ${r < 0 ? 'warmup' : 'trial'} ${r < 0 ? r + warmups + 1 : r + 1}`);
}

// Persist tables across all incremental rounds, including warmups.
const common = hashes('maintained:common', n - half);
let oldA = hashes('maintained:initialA', half), oldB = hashes('maintained:initialB', half);
const states = widths.map(width => {
  lib = adapters[width];
  const a = lib.create(width * 8, cells), b = lib.create(width * 8, cells);
  const data = narrow({ common, onlyA: oldA, onlyB: oldB }, width);
  const ai = lib.input(data.a, width), bi = lib.input(data.b, width);
  try { lib.update(a, ai); lib.update(b, bi); } finally { ai.free(); bi.free(); }
  return { width, a, b };
});
try {
  for (let r = -warmups; r < trials; ++r) {
    const onlyA = hashes(`maintained:${r}:A`, half), onlyB = hashes(`maintained:${r}:B`, half);
    for (let j = 0; j < states.length; ++j) {
      const { width, a, b } = states[(r + warmups + j) % states.length];
      lib = adapters[width];
      const data = narrow({ common, onlyA, onlyB }, width);
      const inputs = [oldA, oldB, onlyA, onlyB].map(keys => lib.input(keys.map(x => x.subarray(0, 16)), width));
      try {
        let t = now(); lib.update(a, inputs[0], true); lib.update(a, inputs[2]); const senderUpdateMs = now() - t;
        t = now(); lib.update(b, inputs[1], true); lib.update(b, inputs[3]); const receiverUpdateMs = now() - t;
        const result = sync(a, b, width, data);
        if (r >= 0) runs.maintained[width * 8].push({ ...result, senderUpdateMs, receiverUpdateMs,
          totalMs: senderUpdateMs + receiverUpdateMs + result.syncMs });
        // Correctness audit outside timing: incremental == fresh, every round.
        const ai = lib.input(data.a, width), bi = lib.input(data.b, width);
        const ca = lib.create(width * 8, cells), cb = lib.create(width * 8, cells);
        try {
          lib.update(ca, ai); lib.update(cb, bi);
          assert.deepEqual(lib.serialize(a), lib.serialize(ca));
          assert.deepEqual(lib.serialize(b), lib.serialize(cb));
        } finally { lib.destroy(ca); lib.destroy(cb); ai.free(); bi.free(); }
      } finally { inputs.forEach(x => x.free()); }
    }
    oldA = onlyA; oldB = onlyB;
    if (r < 0 || (r + 1) % 10 === 0) console.error(`maintained ${r < 0 ? 'warmup' : 'trial'} ${r < 0 ? r + warmups + 1 : r + 1}`);
  }
} finally { states.forEach(({ width, a, b }) => { adapters[width].destroy(a); adapters[width].destroy(b); }); }

function percentile(xs, q) { return xs.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * q) - 1)]; }
const summary = {};
for (const [scenario, cases] of Object.entries(runs)) {
  summary[scenario] = Object.entries(cases).map(([bits, rows]) => {
    const out = { variant: labels[bits], success: `${rows.filter(x => x.success).length}/${rows.length}`, wrongResults: rows.filter(x => x.wrongResult).length };
    for (const field of ['senderBuildMs', 'receiverBuildMs', 'senderUpdateMs', 'receiverUpdateMs', 'wireCodecMs', 'decodeMs', 'syncMs', 'totalMs', 'wireBytes']) {
      if (rows.every(x => field in x)) out[field] = +percentile(rows.map(x => x[field]), 0.5).toFixed(4);
    }
    out.p95TotalMs = +percentile(rows.map(x => x.totalMs), 0.95).toFixed(4);
    return out;
  });
  console.log(scenario); console.table(summary[scenario]);
}
const report = { environment: { node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch },
  config: { n, diff, cells, hashCount: 4, keyBits: 128, trials, warmups,
    dataset: 'identical first 16 bytes of SHA-1 digests for all four variants; key generation excluded',
    maintained: 'each side deletes 50 and inserts 50 when DIFF=100; persistent tables; initial build excluded' },
  source: JSON.parse(await readFile(new URL('./sources.json', import.meta.url))).iblt,
  fixedBuild: JSON.parse(await readFile(new URL('./build/checksum/build-info.json', import.meta.url))),
  hashReference: JSON.parse(await readFile(new URL('./sources.json', import.meta.url))).smhasher,
  build: JSON.parse(await readFile(new URL('./build/dynamic/build-info.json', import.meta.url))), summary, runs };
await writeFile(process.env.OUTPUT ?? new URL('./results-dynamic.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
if (Object.values(runs).some(cases => Object.values(cases).some(rows => rows.some(x => !x.success)))) process.exitCode = 1;
