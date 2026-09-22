import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { libraries, create, destroy, input, update, serialize, deserialize, decode } from './bridge.mjs';

const originalFetch = globalThis.fetch;
const riblt = await import('@peerbit/riblt');
try { await riblt.ready; } finally { globalThis.fetch = originalFetch; }

const n = Number(process.env.N ?? 10000), diff = Number(process.env.DIFF ?? 100);
const trials = Number(process.env.TRIALS ?? 10), warmups = Number(process.env.WARMUPS ?? 2);
const cells = Number(process.env.CELLS ?? Math.max(20, diff * 2));
const capacity = Number(process.env.CAPACITY ?? Math.max(1, diff));
for (const x of [n, diff, trials, warmups, cells, capacity]) assert(Number.isSafeInteger(x) && x >= 0);
assert(n > 0 && trials > 0 && diff % 2 === 0 && diff <= 2 * n && cells >= 4 && cells % 4 === 0 && capacity > 0);
for (const spec of libraries) spec.size = spec.type === 2 ? capacity : cells;
const half = diff / 2;
const now = () => performance.now();

// Unique first timestamp; deterministic varying duration [0, 86400).
// No prehash/truncation; both uint32 timestamps are preserved in one uint64.
function makeKeys(start, count) {
  return Array.from({ length: count }, (_, i) => {
    const id = start + i;
    let x = Math.imul(id + 1, 0x9e3779b1) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13;
    const first = 1700000000 + id, second = first + ((x >>> 0) % 86400);
    assert(first > 0 && second <= 0xffffffff);
    return (BigInt(first) << 32n) | BigInt(second);
  });
}
function dataset(round) {
  const keys = makeKeys((round + warmups) * (n + half), n + half);
  const common = keys.slice(0, n - half), onlyA = keys.slice(n - half, n), onlyB = keys.slice(n);
  return { a: [...common, ...onlyA], b: [...common, ...onlyB], onlyA, onlyB };
}
function check(result, onlyA, onlyB) {
  if (!result.success) return false;
  // Count and sorted comparison detect duplicates, wrong sides and invented IDs.
  try {
    assert.deepEqual(result.onlyRemote.map(String).sort(), onlyA.map(String).sort());
    assert.deepEqual(result.onlyLocal.map(String).sort(), onlyB.map(String).sort());
    return true;
  } catch { return false; }
}
function sync(spec, a, b, data) {
  const localKeys = new Set(data.b); // existing local set/index; outside sync timing
  let t = now();
  const wire = serialize(a);
  const received = deserialize(spec, wire);
  const wireCodecMs = now() - t;
  try {
    assert.deepEqual(serialize(received), wire, 'Binary roundtrip failed');
    t = now();
    const result = decode(received, b, Math.max(capacity, diff * 2 + 100), localKeys);
    const decodeMs = now() - t;
    const correct = check(result, data.onlyA, data.onlyB);
    return { success: result.success && correct, reportedSuccess: result.success,
      wrongResult: result.success && !correct, recovered: result.onlyRemote.length + result.onlyLocal.length,
      wireCodecMs, decodeMs, syncMs: wireCodecMs + decodeMs, wireBytes: wire.length };
  } finally { destroy(received); }
}
function fresh(spec, data) {
  const ai = input(data.a), bi = input(data.b);
  let a = 0, b = 0;
  try {
    let t = now(); a = create(spec); update(a, ai); const senderBuildMs = now() - t;
    t = now(); b = create(spec); update(b, bi); const receiverBuildMs = now() - t;
    const result = sync(spec, a, b, data);
    return { ...result, senderBuildMs, receiverBuildMs,
      totalMs: senderBuildMs + receiverBuildMs + result.syncMs };
  } finally {
    if (a) destroy(a); if (b) destroy(b); ai.free(); bi.free();
  }
}
function freshRiblt(data) {
  let a, b;
  try {
    let t = now();
    a = new riblt.EncoderWrapper();
    for (const key of data.a) a.add_symbol(key);
    const senderBuildMs = now() - t;
    t = now(); b = new riblt.DecoderWrapper();
    for (const key of data.b) b.add_symbol(key);
    const receiverBuildMs = now() - t;
    const begin = now();
    let symbols = 0;
    for (; symbols < Math.max(1000, diff * 20);) {
      const c = a.produce_next_coded_symbol();
      const wire = Buffer.allocUnsafe(24);
      wire.writeBigUInt64LE(c.symbol, 0); wire.writeBigUInt64LE(c.hash, 8); wire.writeBigInt64LE(c.count, 16);
      b.add_coded_symbol({ symbol: wire.readBigUInt64LE(0), hash: wire.readBigUInt64LE(8), count: wire.readBigInt64LE(16) });
      b.try_decode(); ++symbols;
      if (b.decoded()) break;
    }
    const result = { success: b.decoded(), onlyRemote: b.get_remote_symbols(), onlyLocal: b.get_local_symbols() };
    const syncMs = now() - begin;
    const correct = check(result, data.onlyA, data.onlyB);
    return { senderBuildMs, receiverBuildMs, syncMs, totalMs: senderBuildMs + receiverBuildMs + syncMs,
      wireBytes: symbols * 24, symbols, success: result.success && correct, reportedSuccess: result.success,
      wrongResult: result.success && !correct, recovered: result.onlyRemote.length + result.onlyLocal.length };
  } finally { a?.free(); b?.free(); }
}

const runs = { fresh: {}, maintained: {} };
for (const spec of libraries) { runs.fresh[spec.name] = []; runs.maintained[spec.name] = []; }
runs.fresh['@peerbit/riblt'] = [];
for (let round = -warmups; round < trials; round++) {
  const data = dataset(round);
  assert.equal(new Set([...data.a, ...data.b]).size, n + half);
  const jobs = [...libraries.map(spec => [spec.name, () => fresh(spec, data)]), ['@peerbit/riblt', () => freshRiblt(data)]];
  const offset = (round + warmups) % jobs.length;
  for (let i = 0; i < jobs.length; ++i) {
    const [name, run] = jobs[(offset + i) % jobs.length];
    const result = run();
    if (round >= 0) runs.fresh[name].push(result);
  }
  console.error(`fresh ${round < 0 ? 'warmup' : 'trial'} ${round < 0 ? round + warmups + 1 : round + 1}`);
}

// Build once. Thereafter keep both tables alive across all rounds.
// Each round removes the previous 50 unique entries and adds 50 new ones per side.
const common = makeKeys(10000000, n - half);
let oldA = makeKeys(11000000, half), oldB = makeKeys(12000000, half);
const states = libraries.map(spec => {
  const a = create(spec), b = create(spec);
  const ai = input([...common, ...oldA]), bi = input([...common, ...oldB]);
  try { update(a, ai); update(b, bi); } finally { ai.free(); bi.free(); }
  return { spec, a, b };
});
try {
  for (let round = -warmups; round < trials; round++) {
    const epoch = round + warmups;
    const onlyA = makeKeys(13000000 + epoch * diff, half);
    const onlyB = makeKeys(13000000 + epoch * diff + half, half);
    const data = { a: [...common, ...onlyA], b: [...common, ...onlyB], onlyA, onlyB };
    const inputs = [input(oldA), input(oldB), input(onlyA), input(onlyB)];
    try {
      for (let j = 0; j < states.length; j++) {
        const { spec, a, b } = states[(epoch + j) % states.length];
        let t = now(); update(a, inputs[0], true); update(a, inputs[2]); const senderUpdateMs = now() - t;
        t = now(); update(b, inputs[1], true); update(b, inputs[3]); const receiverUpdateMs = now() - t;
        const result = sync(spec, a, b, data);
        if (round >= 0) runs.maintained[spec.name].push({ ...result, senderUpdateMs, receiverUpdateMs,
          totalMs: senderUpdateMs + receiverUpdateMs + result.syncMs });
        // Independent rebuild outside timing proves incremental state correctness.
        const ai = input(data.a), bi = input(data.b), checkA = create(spec), checkB = create(spec);
        try {
          update(checkA, ai); update(checkB, bi);
          assert.deepEqual(serialize(a), serialize(checkA));
          assert.deepEqual(serialize(b), serialize(checkB));
        } finally { destroy(checkA); destroy(checkB); ai.free(); bi.free(); }
      }
    } finally { inputs.forEach(x => x.free()); }
    oldA = onlyA; oldB = onlyB;
    console.error(`maintained ${round < 0 ? 'warmup' : 'trial'} ${round < 0 ? round + warmups + 1 : round + 1}`);
  }
} finally { states.forEach(({ a, b }) => { destroy(a); destroy(b); }); }

function percentile(values, p) {
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.max(0, Math.ceil(a.length * p) - 1)];
}
const summary = {};
for (const [scenario, cases] of Object.entries(runs)) {
  summary[scenario] = Object.entries(cases).map(([name, rows]) => {
    const result = { name, success: `${rows.filter(x => x.success).length}/${rows.length}`,
      wrongResults: rows.filter(x => x.wrongResult).length };
    for (const field of ['senderBuildMs', 'receiverBuildMs', 'senderUpdateMs', 'receiverUpdateMs', 'wireCodecMs', 'decodeMs', 'syncMs', 'totalMs', 'wireBytes']) {
      if (rows.every(row => field in row)) result[field] = +percentile(rows.map(x => x[field]), 0.5).toFixed(4);
    }
    result.p95TotalMs = +percentile(rows.map(x => x.totalMs), 0.95).toFixed(4);
    return result;
  });
  console.log(scenario); console.table(summary[scenario]);
}
const report = { environment: { node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch },
  config: { n, symmetricDifference: diff, uniqueEachSide: half, trials, warmups, cells, hashCount: 4, minisketchCapacity: capacity,
    key: 'two uint32 Unix timestamps, (first << 32) | second', target: 'wasm32, generic minisketch; no native CLMUL' },
  sources: JSON.parse(await readFile(new URL('./sources.json', import.meta.url))),
  build: JSON.parse(await readFile(new URL('./build/build-info.json', import.meta.url))), summary, runs };
await writeFile(process.env.OUTPUT ?? new URL('./results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
if (Object.values(runs).some(cases => Object.values(cases).some(rows => rows.some(x => !x.success)))) process.exitCode = 1;
