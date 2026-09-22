# Bucket selection experiment

Production now uses MurmurHash3_x64_128 (seed 11) for every checksum length. This experiment compares two bucket mappings, both with the same 12-byte checksum:

- `hash32x4`: production mapping; four x86_32 hashes with seeds 0–3, one per subtable.
- `hash128split`: candidate only; one x64_128 hash with seed 0, split into four little-endian uint32 words, one per subtable.

The candidate is generated under `build/hash-indexes/`; it does not modify production bucket selection. The distinct checksum seed remains 11. Hash outputs with different seeds are not a mathematical independence guarantee.

## Reproduce

From the repository root, using Emscripten 4.0.23 for the recorded run:

```sh
EMSDK=/tmp/iblt-emsdk make
EMSDK=/tmp/iblt-emsdk make -C study/hash-indexes
node study/hash-indexes/check.mjs
node study/hash-indexes/benchmark.mjs
PERFORMANCE_ONLY=1 OUTPUT=study/hash-indexes/results-performance-repeat.json node study/hash-indexes/benchmark.mjs
```

The Makefiles use identical optimization and WASM settings. `check.mjs` runs the production key-width/checksum-width, padding, overflow and checksum-prefix checks against the candidate module. Historical `study/c-bench/` code remains unchanged.

## Method

Performance compares 10,000 records / 100 differences / 512 buckets and 300,000 records / 1,000 differences / 5,000 buckets. Both endpoints contain the stated number of records. Every key is 16 bytes. There are 5 warmups and 30 timed rounds per variant, rotating execution order. Data generation is excluded, but **JS validation, packing, memory allocation and freeing are included**, unlike the early low-level benchmarks. The common dataset is reused across rounds; unique keys change each round.

Full time includes both builds, one table's serialization/copy/deserialization and decode. Maintained time includes both sides removing and adding `difference / 2` keys each, followed by the same sync. Initial maintained builds are excluded. Every maintained table is checked against a complete rebuild outside timing; all successful decodes are checked for exact positive and negative keys. No network, browser, database or record-content transfer is timed.

Capacity checks use 100 and 1,000 differences, three patterns (deterministic pseudorandom words with unique IDs, pairs of timestamps, and a common prefix with a changing last word), and target bucket/difference ratios of 1.2, 1.3, 1.4, 1.5, 2, 3 and 5. Bucket counts round upward to multiples of 4. Each configuration has 1,000 trials: 84,000 decodes across both variants. Common keys are omitted because their contributions cancel. No incorrect successful decode was observed; this does not measure the extremely small checksum collision probability or prove hash independence.

Capacity need not increase monotonically for individual datasets: a new bucket count rehashes every key and may create a different small unpeelable collision. Results aggregate the three input patterns below; per-pattern results are in `results.json`.

## Recorded performance

{"node":"v24.21.0","cpu":"Intel(R) Core(TM) Ultra 7 258V"}

| Run | Records | Mapping | Full median | Full p95 | Maintained median | Maintained p95 |
|---|---:|---|---:|---:|---:|---:|
| Initial | 10000 | hash32x4 | 1.9639 ms | 2.569 ms | 0.0768 ms | 0.1379 ms |
| Initial | 10000 | hash128split | 2.0959 ms | 2.8482 ms | 0.0772 ms | 0.1041 ms |
| Initial | 300000 | hash32x4 | 62.7395 ms | 66.7557 ms | 0.6082 ms | 0.8568 ms |
| Initial | 300000 | hash128split | 67.4517 ms | 71.6665 ms | 0.6123 ms | 0.8509 ms |
| Repeat | 10000 | hash32x4 | 1.952 ms | 2.4386 ms | 0.0822 ms | 0.2834 ms |
| Repeat | 10000 | hash128split | 2.1972 ms | 2.9322 ms | 0.0763 ms | 0.3518 ms |
| Repeat | 300000 | hash32x4 | 63.6078 ms | 66.7481 ms | 0.6008 ms | 0.7727 ms |
| Repeat | 300000 | hash128split | 67.7 ms | 71.7895 ms | 0.5523 ms | 0.8199 ms |

## Recorded capacity

| Differences | Buckets | hash32x4 successes | hash128split successes | Trials per variant |
|---:|---:|---:|---:|---:|
| 100 | 120 | 3 | 8 | 3000 |
| 100 | 132 | 1005 | 1004 | 3000 |
| 100 | 140 | 2495 | 2454 | 3000 |
| 100 | 152 | 2985 | 2977 | 3000 |
| 100 | 200 | 2999 | 2997 | 3000 |
| 100 | 300 | 3000 | 3000 | 3000 |
| 100 | 500 | 3000 | 3000 | 3000 |
| 1000 | 1200 | 0 | 0 | 3000 |
| 1000 | 1300 | 1147 | 1180 | 3000 |
| 1000 | 1400 | 3000 | 3000 | 3000 |
| 1000 | 1500 | 3000 | 3000 | 3000 |
| 1000 | 2000 | 3000 | 2999 | 3000 |
| 1000 | 3000 | 3000 | 3000 | 3000 |
| 1000 | 5000 | 3000 | 3000 | 3000 |

The observed capacity curves are broadly similar. The split candidate did not improve end-to-end speed in these measurements; fewer hash calls do not imply less generated WASM work. No profiling was performed to attribute the cost. Production retains hash32 bucket selection. The candidate remains available for further investigation.

## Follow-up investigation

The initial slowdown above did not reproduce reliably. The layered and controlled follow-up in [hash-analysis](../hash-analysis/README.md) found faster raw updates for split128, and an additional benefit from early C++ inlining. Treat this file as the original measurement record, not a stable performance ranking. Production bucket mapping remains unchanged.

## Production adoption

After the follow-up investigation, split hash128 with early C++ inlining was adopted in production. `baseline.h` preserves the old hash32 bucket implementation. The experiment Makefile builds that snapshot separately, so changing production no longer changes the historical baseline. Earlier descriptions of “production” above refer to the implementation at the time of the experiment.

Run `node study/hash-indexes/check-production.mjs` from the root to replay the 42,000 split-candidate capacity trials against current production. It requires the exact recorded success count for every configuration and checks every successful decoded set. Results are saved to `results-production-capacity.json`.

The native `check-production.cpp` compares production bucket positions and checksum words with the official SMHasher reference for 25,600 configurations/samples (key lengths 4..256 bytes; checksums 4/8/12/16 bytes). Reproduce from the root:

```sh
g++ -O2 -std=c++17 -fsanitize=undefined -fno-sanitize-recover=all study/hash-indexes/check-production.cpp study/c-bench/vendor/smhasher/src/MurmurHash3.cpp -o /tmp/iblt-production-hash-check
/tmp/iblt-production-hash-check
```

The original baseline and split mapping have similar empirical capacity curves; these samples cannot prove identical failure probabilities for all inputs. New production tables use different bucket positions from old hash32 tables; both endpoints must rebuild.
