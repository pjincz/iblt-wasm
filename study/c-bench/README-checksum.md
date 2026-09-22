# 128-bit key / 32-bit count / 96-bit checksum

`key-only-iblt.h` is a new key-only C++ implementation. No value vector. Key and keySum are exactly 16 bytes, XOR aggregated; count is signed int32. The requested `IBLT<3>` uses three uint32 checksum words; `sizeof(Cell<3>) == 32` is compile-time asserted. A comparison `IBLT<1>` has a 32-bit checksum and 24-byte cells. Four disjoint subtables use MurmurHash3_x86_32 seeds 0–3, matching the existing locally widened IBLT_Cplusplus mapping.

96-bit checksum = first 12 bytes of canonical little-endian MurmurHash3_x64_128 output, seed 11. This is not a padded 32-bit hash. MurmurHash is noncryptographic; a longer checksum does not give a mathematical guarantee of correct decoding. Tests verify actual recovered keys against expected sets, not the probability of checksum collisions.

Wire format per cell: signed count (4 bytes LE), keySum (16 raw bytes), checksum (12 bytes LE). Exactly 512 × 32 = 16,384 bytes; excludes protocol headers. In-memory field order differs; serialization is explicit, not a struct memory dump. Bucket storage excludes vector/handle metadata and decode scratch space. Tables must agree on bucket count, key encoding, hash seeds and checksum mode. This 96-bit wire format is incompatible with upstream.

## Measured results

Node v24.21.0, Linux x64, Intel Core Ultra 7 258V; Emscripten WASM, -O3. Each endpoint has 10,000 keys; symmetric difference 100 = 50 keys unique to each side. 512 buckets, 4 hashes, 5 warmups, 30 measured rounds, rotated variant order. All variants use identical 128-bit keys (first 16 bytes of deterministic SHA-1 digests); this run does not use timestamp-distributed inputs. Key generation and JS→WASM input preparation are outside timers.

| Variant | Full sync median | Full p95 | Maintained median | Maintained p95 | Wire |
|---|---:|---:|---:|---:|---:|
| Existing widened IBLT_Cplusplus, checksum32 | 2.6431 ms | 3.1988 ms | 0.1156 ms | 0.1438 ms | 12 KiB |
| New key-only, checksum32 | 0.9808 ms | 1.7713 ms | 0.0551 ms | 0.0645 ms | 12 KiB |
| New key-only, checksum96 | 0.9709 ms | 1.4373 ms | 0.0575 ms | 0.0932 ms | 16 KiB |

Every variant passed 30/30 full and 30/30 maintained rounds, with zero incorrect results. See `results-checksum.json` for per-round data and breakdown.

Full sync includes both table constructions, wire serialization/copy/deserialization and decoding/copying results to JS. Maintained sync includes each endpoint removing 50 previous unique keys and inserting 50 new keys, then the same wire/decode work; initial 10k builds excluded. Tables persist across rounds. Every maintained state is independently rebuilt and byte-compared outside timing. These are local CPU times, not network latency or browser measurements.

New32 vs new96 isolates the checksum implementation choice: performance is close in this run, with 33% larger payload. Do not interpret the small full-sync median difference as a reliable speed advantage for checksum96. Speedup over the old implementation also includes removing value storage, specializing hashes to fixed 16-byte keys, computing checksum once per key and avoiding std::set for decode output.

## Build and reproduce

Requires g++, Python, Node, Emscripten (`EMSDK`, defaults `/tmp/iblt-emsdk`). The existing wide module is needed only for comparisons.

```sh
npm run bench:c:fetch
npm run bench:wide:build
npm run bench:checksum:build
npm run bench:checksum:check
npm run bench:checksum
# Optional separate run, preserving the recorded result:
CELLS=512 TRIALS=100 OUTPUT=/tmp/checksum-100.json npm run bench:checksum
```

Native tests compare both specialized hash functions against the pinned public-domain SMHasher reference for 10,000 keys × 6 seeds each, with undefined-behavior sanitizer enabled; also check counter overflow guards. WASM tests cover the known hash vector, all 16 key bytes, zero/ff keys, positive/negative differences, clone/remove, wire roundtrips, byte equality with the legacy32 table, checksum-only residuals in the last bucket, and insufficient-capacity failure.

## Minimal JS usage

```js
import * as iblt from './checksum-bridge.mjs';
const a = iblt.create(96, 512);
const b = iblt.create(96, 512);
const key = new Uint8Array(16);
const view = new DataView(key.buffer);
view.setBigUint64(0, 1700000000000n, true); // creation timestamp
view.setBigUint64(8, 1700000001000n, true); // edit timestamp
const batch = iblt.input([key]);
iblt.update(a, batch);
batch.free();
const payload = iblt.serialize(a);
const received = iblt.deserialize(96, 512, payload);
const result = iblt.decode(received, b);
if (result.success) console.log(result.onlyRemote, result.onlyLocal);
for (const table of [received, a, b]) iblt.destroy(table);
```

Keep `a`/`b` alive to maintain tables; on edit remove the old `(creation, edit)` key, then insert the new key. `decode` works on a copy and does not consume the maintained table. Inputs must follow set semantics: don't insert the same entry twice unintentionally. Decode failure may return partial entries; discard those and retry with more buckets. This is a benchmark prototype with manual WASM memory lifecycle, not a published npm package. Bulk update overflow may leave earlier keys in that batch applied.
