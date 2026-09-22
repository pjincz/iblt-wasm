# Why fewer hashes did not reliably produce a faster end-to-end result

The initial `study/hash-indexes` runs showed the split-hash candidate about 6–8% slower for a full 300k-record sync. This investigation **does not reproduce that as a stable property of the algorithm**. Re-running that exact harness with the original artifacts gave 63.71 ms for hash32x4 and 60.97 ms for split128. Do not treat the earlier slowdown as a proven hash-cost result.

Production code is unchanged by this investigation. Every alternative build is under `build/hash-analysis/`.

## Layered results

Linux x64 under WSL/virtualization, Intel Core Ultra 7 258V, Node v24.21.0, Emscripten 4.0.23 / Clang 22. Both native executables use the SDK's Clang with -O3. All outputs are consumed; native and WASM checksums match for every kernel, width and variant.

Median nanoseconds per 16-byte key, WASM kernels (32,768 keys × 9 passes per call, eight warmups, 21 measured rounds, rotating order):

- One hash32: 4.58 ns.
- One hash128: 5.17 ns.
- Four hash32 calls plus bucket modulo: 18.83 ns.
- One split hash128 plus bucket modulo: 8.06 ns.
- hash32 selection plus hash128 checksum: 23.85 ns.
- split128 selection plus hash128 checksum: 12.85 ns.

These are stage benchmarks, not additive decomposition of the real update; compilation context changes inlining and optimization. Still, they refute the explanation that a single hash128 necessarily costs more than four hash32 calls. For 32- and 64-byte keys even a single hash128 beat a single hash32 in these measurements. For 4-byte keys hash128 was relatively more expensive. Key length matters.

Native Clang corroborates the arithmetic direction for 16-byte keys: index+checksum 26.89 ns vs 14.46 ns; full inline-loop update kernel 85.38 ns vs 74.56 ns. The same WASM update kernels were 79.10 ns vs 71.72 ns. These kernels expose more optimization context than the production C ABI, so they are not substitutes for production measurements.

## Production C ABI and inlining experiment

The real bridge calls `dynamic_update`, which loops over `IBLT::update`. We built baseline, split128, and split128 with **only** an `always_inline` attribute added to the C++ hash128 helper. No hash formula, key encoding, bucket mapping or checksum changes between the latter two. Their serialized tables matched exactly in every production timing round. The forced-inline variant also passed the existing 48 width/checksum configurations, padding, overflow and checksum-prefix tests.

WASM disassembly shows:

- Baseline `IBLT::update` calls an `indexes` helper; its checksum calculation is inlined.
- Split128 `IBLT::update` calls the hash128 helper twice, with seeds 0 and 11.
- The helper returns its 16-byte `std::array` through a hidden pointer into WASM linear-memory stack space. The WAT contains result stores and caller loads.
- With Clang forced inlining, these hash helper calls disappear before V8 sees the module.

**This is not simply two extra machine-level calls.** V8's `--trace-wasm-inlining` showed TurboFan also inlining both hash128 calls (callee function 16 into caller function 15). Early Clang inlining and later V8 inlining do not produce identical optimized machine code. Captured TurboFan update instruction sizes were 5,100 bytes for split128 and 5,016 for early-inline split128, with differences in memory moves/spills. The exact cycle contribution of those changes has not been isolated; code size alone is not a speed metric.

To reduce scheduling and initial WASM tiering effects, two production rounds ran pinned to guest logical CPU 0 with `--no-liftoff` (TurboFan from the start). Each has 10 warmups and 30 measured rounds. A raw run inserts 300k keys into a fresh 5,000-bucket table with inputs already in WASM memory; creation, serialization and destruction are outside its timer. The API run includes JS validation, packing, allocation and free. Variant order rotates. Original non-profiled artifacts are included as controls.

First pinned run, production-style profiled builds:

- Baseline: raw insert 24.63 ms; public `add` 33.05 ms.
- Split128: raw insert 22.79 ms; public `add` 32.64 ms.
- Split128, early inline: raw insert 21.73 ms; public `add` 30.56 ms.

Second pinned run:

- Baseline: raw insert 32.92 ms; public `add` 42.94 ms.
- Split128: raw insert 30.76 ms; public `add` 41.43 ms.
- Split128, early inline: raw insert 28.69 ms; public `add` 40.31 ms.

Absolute times shifted substantially even with guest CPU affinity; the ordering held. Original non-profiled artifacts show the same ordering between the first two variants. CPU affinity does not eliminate frequency changes, host scheduling or all runtime effects. We have not isolated which environmental effect caused the older 6–8% reversal, so attributing it solely to CPU frequency, GC or JIT would be speculation.

The supported conclusions are:

1. Raw hash work favors split128 on this machine for 16-byte keys.
2. Complete updates contain substantial non-hash work, so the end-to-end benefit is much smaller than the isolated hash-stage benefit.
3. A one-line change to compile-time inlining measurably changes production performance without changing the algorithm; the benefit persisted across the controlled repeats.
4. The previous end-to-end slowdown is not stable enough to justify declaring split128 slower. No bucket-selection change has been merged into production.

## Reproduction

From the repository root (set `EMSDK` to your SDK path):

```sh
export EMSDK=/tmp/iblt-emsdk
make
make -C study/hash-indexes
make -C study/hash-analysis -j2
node study/hash-analysis/run.mjs
build/hash-analysis/base-native > study/hash-analysis/results-native-base.csv
build/hash-analysis/split-native > study/hash-analysis/results-native-split.csv
node study/hash-analysis/build-variants.mjs
node study/hash-analysis/production.mjs
OUTPUT=/tmp/hash-pinned.json taskset -c 0 node --no-liftoff study/hash-analysis/production.mjs
node --no-liftoff --trace-wasm-inlining study/hash-analysis/trace.mjs split
node --no-liftoff --print-wasm-code study/hash-analysis/trace.mjs split
node --no-liftoff --print-wasm-code study/hash-analysis/trace.mjs split-inline
```

`build-variants.mjs` is a diagnostic helper, not the package build system. It also writes named WAT disassemblies. The production package continues to use its Makefile. Captured WAT and machine code are in ignored `build/hash-analysis/`; raw timing results, scripts and source/artifact hashes are retained in this study directory. `results-production.json` is the initial three-variant run; `results-production-five.json` adds original artifact controls; the pinned files contain the two controlled repeats.

## Subsequent production adoption

After this investigation, production adopted split128 with early inlining. Historical baseline builds now read `study/hash-indexes/baseline.h` instead of the changing production header; the original-artifact control import points to its separately rebuilt module. The measurements above remain historical records.
