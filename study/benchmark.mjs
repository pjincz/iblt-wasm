import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
import bloom from 'bloom-filters';

// This package replaces global fetch during initialization. Restore it afterwards.
const originalFetch = globalThis.fetch;
const { ready, EncoderWrapper, DecoderWrapper } = await import('@peerbit/riblt');
try { await ready; } finally { globalThis.fetch = originalFetch; }
const { InvertibleBloomFilter } = bloom;

const n = Number(process.env.N ?? 10000);
const differences = Number(process.env.DIFF ?? 100);
const trials = Number(process.env.TRIALS ?? 10);
const warmups = Number(process.env.WARMUPS ?? 2);
const cells = Number(process.env.CELLS ?? Math.max(20, differences * 2));
for (const x of [n, differences, trials, warmups, cells]) assert(Number.isSafeInteger(x) && x >= 0);
assert(n > 0 && trials > 0 && cells >= 3 && differences % 2 === 0 && differences <= 2 * n);

function dataset(round) {
  const hash = label => createHash('sha1').update(`iblt-bench:${round}:${label}`).digest();
  const common = Array.from({ length: n - differences / 2 }, (_, i) => hash(`common:${i}`));
  const onlyA = Array.from({ length: differences / 2 }, (_, i) => hash(`A:${i}`));
  const onlyB = Array.from({ length: differences / 2 }, (_, i) => hash(`B:${i}`));
  const all = [...common, ...onlyA, ...onlyB];
  // Refuse to benchmark a dataset with collisions, including truncated SHA-1.
  assert.equal(new Set(all.map(x => x.toString('hex'))).size, all.length);
  assert.equal(new Set(all.map(x => x.subarray(0, 8).toString('hex'))).size, all.length);
  return { a: [...common, ...onlyA], b: [...common, ...onlyB], onlyA, onlyB };
}

function verify(actual, expected, normalize) {
  assert.deepEqual(actual.map(normalize).sort(), expected.map(normalize).sort());
}

function packBloom(table) {
  const size = 16 + table.elements.reduce((n, c) => n + 8 + c.idSum.length + c.hashSum.length, 0);
  const wire = Buffer.allocUnsafe(size);
  wire.writeUInt32BE(table.size, 0);
  wire.writeUInt32BE(table.hashCount, 4);
  wire.writeDoubleBE(table.seed, 8);
  let offset = 16;
  for (const cell of table.elements) {
    wire.writeInt32BE(cell.count, offset);
    wire.writeUInt16BE(cell.idSum.length, offset + 4);
    wire.writeUInt16BE(cell.hashSum.length, offset + 6);
    offset += 8;
    for (const value of [cell.idSum, cell.hashSum]) {
      value.copy(wire, offset);
      offset += value.length;
    }
  }
  assert.equal(offset, wire.length);
  return wire;
}

function unpackBloom(wire) {
  const json = { type: 'InvertibleBloomFilter', _size: wire.readUInt32BE(0),
    _hashCount: wire.readUInt32BE(4), _seed: wire.readDoubleBE(8), _elements: [] };
  let offset = 16;
  for (let i = 0; i < json._size; i++) {
    const count = wire.readInt32BE(offset);
    const idLength = wire.readUInt16BE(offset + 4);
    const hashLength = wire.readUInt16BE(offset + 6);
    offset += 8;
    const id = wire.subarray(offset, offset + idLength);
    offset += idLength;
    const hash = wire.subarray(offset, offset + hashLength);
    offset += hashLength;
    json._elements.push({ type: 'Cell', _idSum: id, _hashSum: hash, _count: count, _seed: json._seed });
  }
  assert.equal(offset, wire.length);
  return InvertibleBloomFilter.fromJSON(json);
}

function benchBloom(data, bytes) {
  // Input conversion, like SHA-1 generation, is outside the timed section.
  // xorBuffer strips leading zeros. A fixed nonzero prefix preserves SHA-1 keys.
  const encode = x => Buffer.concat([Buffer.from([1]), x.subarray(0, bytes)]);
  const aKeys = data.a.map(encode);
  const bKeys = data.b.map(encode);
  const start = performance.now();
  const a = new InvertibleBloomFilter(cells, 3);
  for (const key of aKeys) a.add(key);
  const senderBuilt = performance.now();
  const b = new InvertibleBloomFilter(cells, 3);
  for (const key of bKeys) b.add(key);
  const receiverBuilt = performance.now();
  const wire = packBloom(a);
  const received = unpackBloom(wire);
  const transported = performance.now();
  const result = received.substract(b).decode();
  const end = performance.now();
  // Outside timing: ensure our wire codec preserves the library's exact table.
  assert(received.equals(a), 'Binary round trip changed the IBLT');
  if (result.success) {
    verify(result.additional, data.onlyA.map(encode), x => x.toString('hex'));
    verify(result.missing, data.onlyB.map(encode), x => x.toString('hex'));
  } else {
    assert.equal(a.substract(b).decode().success, false, 'Failure was introduced by transport');
  }
  return { success: result.success, recovered: result.additional.length + result.missing.length, senderBuildMs: senderBuilt - start,
    receiverBuildMs: receiverBuilt - senderBuilt, encodeMs: 0,
    wireCodecMs: transported - receiverBuilt, decodeMs: end - transported,
    totalMs: end - start, wireBytes: Buffer.byteLength(wire), symbols: cells };
}

function benchRateless(data) {
  const aKeys = data.a.map(x => x.readBigUInt64BE());
  const bKeys = data.b.map(x => x.readBigUInt64BE());
  let encoder, decoder;
  try {
    const start = performance.now();
    encoder = new EncoderWrapper();
    for (const key of aKeys) encoder.add_symbol(key);
    const senderBuilt = performance.now();
    decoder = new DecoderWrapper();
    for (const key of bKeys) decoder.add_symbol(key);
    const receiverBuilt = performance.now();
    let encodeMs = 0, wireCodecMs = 0, decodeMs = 0, symbols = 0;
    const maxSymbols = Math.max(1000, differences * 20);
    for (; symbols < maxSymbols;) {
      let t = performance.now();
      const symbol = encoder.produce_next_coded_symbol();
      encodeMs += performance.now() - t;
      t = performance.now();
      // Explicit portable wire format: u64 symbol, u64 hash, i64 count, big endian.
      const wire = Buffer.allocUnsafe(24);
      wire.writeBigUInt64BE(symbol.symbol, 0);
      wire.writeBigUInt64BE(symbol.hash, 8);
      wire.writeBigInt64BE(symbol.count, 16);
      const received = { symbol: wire.readBigUInt64BE(0), hash: wire.readBigUInt64BE(8), count: wire.readBigInt64BE(16) };
      wireCodecMs += performance.now() - t;
      t = performance.now();
      decoder.add_coded_symbol(received);
      decoder.try_decode();
      const success = decoder.decoded();
      decodeMs += performance.now() - t;
      symbols++;
      if (success) break;
    }
    const success = decoder.decoded();
    const remote = decoder.get_remote_symbols();
    const local = decoder.get_local_symbols();
    const end = performance.now();
    if (success) {
      verify(remote, data.onlyA.map(x => x.readBigUInt64BE()), String);
      verify(local, data.onlyB.map(x => x.readBigUInt64BE()), String);
    }
    return { success, senderBuildMs: senderBuilt - start, receiverBuildMs: receiverBuilt - senderBuilt,
      encodeMs, wireCodecMs, decodeMs, totalMs: end - start, wireBytes: symbols * 24, symbols };
  } finally { encoder?.free(); decoder?.free(); }
}

const cases = [
  ['bloom-filters SHA1-160', d => benchBloom(d, 20)],
  ['bloom-filters SHA1-prefix64', d => benchBloom(d, 8)],
  ['@peerbit/riblt SHA1-prefix64', benchRateless],
];
const rows = Object.fromEntries(cases.map(([name]) => [name, []]));
for (let round = -warmups; round < trials; round++) {
  const data = dataset(round);
  // Rotate execution order to reduce systematic ordering bias.
  const offset = (round + warmups) % cases.length;
  for (let j = 0; j < cases.length; j++) {
    const [name, run] = cases[(j + offset) % cases.length];
    const result = run(data);
    if (round >= 0) rows[name].push(result);
  }
  console.error(`${round < 0 ? 'warmup' : 'trial'} ${round < 0 ? round + warmups + 1 : round + 1}/${round < 0 ? warmups : trials}`);
}
function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
const summary = Object.entries(rows).map(([name, runs]) => {
  const result = { name, success: `${runs.filter(r => r.success).length}/${runs.length}` };
  for (const field of ['senderBuildMs', 'receiverBuildMs', 'encodeMs', 'wireCodecMs', 'decodeMs', 'totalMs', 'wireBytes', 'symbols']) {
    result[field] = Number(percentile(runs.map(r => r[field]), 0.5).toFixed(3));
  }
  result.p95TotalMs = Number(percentile(runs.map(r => r.totalMs), 0.95).toFixed(3));
  return result;
});
const report = { environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
  config: { n, differences, onlyEachSide: differences / 2, trials, warmups, cells, hashCount: 3 },
  versions: { 'bloom-filters': '3.0.4', '@peerbit/riblt': '1.2.0' }, summary, runs: rows };
console.log(JSON.stringify({ environment: report.environment, config: report.config }, null, 2));
console.table(summary);
await writeFile(process.env.OUTPUT ?? 'results.json', JSON.stringify(report, null, 2) + '\n');
if (Object.values(rows).some(runs => runs.some(r => !r.success))) process.exitCode = 1;
