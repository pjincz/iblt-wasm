# Runtime-configurable key-only IBLT

Core: `dynamic-iblt.h`, self-contained C++17 header with MurmurHash3. The earlier fixed implementation is unchanged. `dynamic-wrapper.cpp` exposes a C ABI for WASM; `dynamic-bridge.mjs` provides JS input validation and memory management.

Configuration is chosen **when constructing each table**, not separately for each key:

- keyBytes: positive multiple of 4 (4, 8, 12, 16, 20, …); no finite list of template instantiations.
- checkBytes: 4, 8, 12 or 16 (32/64/96/128 bits).
- count: signed 32-bit, overflow-checked.
- cells: multiple of 4, at least 4. Total bucket payload must fit INT32_MAX bytes; available memory can impose a lower limit.

A contiguous uint32 array stores all buckets. Each bucket occupies exactly `4 + keyBytes + checkBytes` bytes, both in bucket storage and wire format. No per-bucket allocations and no per-update allocation. Decode uses one scratch key buffer and growing flat result arrays. Table metadata, allocator overhead and decode working copies are additional memory.

Bucket hash is MurmurHash3_x86_32 with seeds 0–3 in four disjoint subtables. A 4-byte checksum uses x86_32 seed 11; 8/12/16-byte checksums take the corresponding prefix of little-endian x64_128 seed 11. Thus a 4-byte checksum is **not** a prefix of the longer checksums. The general hash path handles 4/8/12-byte tails and multiple 16-byte blocks; it does not dispatch to the old fixed implementation for 16-byte keys.

Wire is count4 LE, keySum bytes, checksum words LE, with no header. For keyBytes=16 and checkBytes=4 or 12 it is byte-compatible with the fixed version, verified by tests. Endpoints must agree out of band on key length, checksum length, cell count, algorithm and key encoding. Decode/subtract rejects configuration mismatch. Tables have set semantics; checksum collision risk remains nonzero and MurmurHash is noncryptographic.

## Usage

```cpp
#include "dynamic-iblt.h"
dynamic_iblt::IBLT table(512, 16, 12); // cells, key bytes, checksum bytes
uint8_t key[16] = {}; // encode your two timestamps here
table.update(key, +1);
table.update(key, -1);
```

```js
import * as iblt from './dynamic-bridge.mjs';
const a = iblt.create(16, 12, 512); // key bytes, checksum bytes, cells
const b = iblt.create(16, 12, 512);
const key = new Uint8Array(16);
const view = new DataView(key.buffer);
view.setBigUint64(0, 1700000000000n, true);
view.setBigUint64(8, 1700000001000n, true);
const input = iblt.input([key], 16);
iblt.update(a, input);
input.free();
const wire = iblt.serialize(a);
const received = iblt.deserialize(16, 12, 512, wire);
const result = iblt.decode(received, b);
if (result.success) console.log(result.onlyRemote, result.onlyLocal);
for (const table of [received, a, b]) iblt.destroy(table);
```

Maintain tables across edits by removing the previous `(created, edited)` key and inserting the replacement. `decode` copies the difference and leaves input tables intact. Discard partial results on failure. Bulk update overflow may leave earlier keys from the batch applied. Native pointer APIs assume the caller provides the declared buffer sizes; JS validates widths and payload lengths. This is a benchmark prototype, not a published package.

## Reproduction and validation

Requires Node, Python, g++ and Emscripten (`EMSDK`, default `/tmp/iblt-emsdk`).

```sh
npm run bench:c:fetch
npm run bench:checksum:build
npm run bench:dynamic:build
npm run bench:dynamic:check
npm run bench:dynamic
# Preserve the recorded result when trying alternate settings:
TRIALS=100 CELLS=512 OUTPUT=/tmp/dynamic-repeat.json npm run bench:dynamic
```

Native tests compare both hash variants to the pinned SMHasher reference: lengths 4..256 in steps of 4, 100 random keys per length, 6 seeds, 38,400 comparisons per hash. Input is intentionally unaligned. ASan and UBSan cover our code; the reference TU is unsanitized because it uses native unaligned casts. LeakSanitizer is disabled because this environment runs under ptrace. Counter overflow and configuration limits are tested.

WASM tests cover 48 configurations: key bytes 4,8,12,16,20,24,28,32,36,64,128,256 × checksum bytes 4,8,12,16. They check every key byte, zero/ff keys, positive and negative differences, clone/remove, serialization, fixed-version wire compatibility, every checksum byte in a residual last bucket, overloaded decode failure and invalid JS inputs. These are correctness tests, not collision-rate estimates.

## Benchmark method

Fixed and dynamic modules run together under Node WASM, with identical compiler settings (-O3) and rotating execution order. Every endpoint has 10,000 keys, with symmetric difference 100 (50 only on each side), 512 buckets, 20 warmups and 100 measured rounds. Keys are the same 16-byte SHA-1 prefixes used in the previous comparison, not timestamp-distributed inputs. Key generation, JS→WASM input preparation, module startup, cleanup and correctness audits are excluded.

Full timing = both table builds + serialization/copy/deserialization + decode/result copies. Maintained timing = each endpoint removes 50 old keys and inserts 50 new keys, then wire codec and decode; initial build excluded. Maintained tables are independently rebuilt and byte-compared each round outside timing. All recovered keys are checked against the exact expected positive/negative sets.

Results compare these two implementations end to end, not a pure single-variable experiment: the dynamic version also uses runtime-stride storage and flat decode output. General hash loops, tail handling, dynamic XOR loops and index calculations can prevent the specialization/unrolling available to the fixed version; no profile attributes costs to individual operations. Local CPU timings include no network latency, and browsers have not been timed.

## Recorded result

Environment: v24.21.0, Intel(R) Core(TM) Ultra 7 258V, linux/x64.

| Variant | Full median | Full p95 | Maintained median | Maintained p95 | Wire |
|---|---:|---:|---:|---:|---:|
| fixed128/check32 | 0.9500 ms | 1.3868 ms | 0.0648 ms | 0.0902 ms | 12288 B |
| dynamic128/check32 | 1.2821 ms | 1.5470 ms | 0.0817 ms | 0.0983 ms | 12288 B |
| fixed128/check96 | 0.9743 ms | 1.5415 ms | 0.0675 ms | 0.0933 ms | 16384 B |
| dynamic128/check96 | 1.7227 ms | 2.2991 ms | 0.0925 ms | 0.1337 ms | 16384 B |

All four variants passed 100/100 rounds in both scenarios, with zero wrong results. Raw rounds and build metadata: `results-dynamic.json`.

Checksum 32: dynamic full time +35.0%; maintained time +26.1%.

Checksum 96: dynamic full time +76.8%; maintained time +37.0%.

Compiled artifact sizes (dynamic module supports every valid runtime configuration):

- `iblt-dynamic.mjs`: 34342 bytes; gzip 10500 bytes.

- `iblt-dynamic.wasm`: 30746 bytes; gzip 14473 bytes.
