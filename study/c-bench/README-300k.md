# 300,000 keys per endpoint / 1,000 differences / 5,000 buckets

Run using the unchanged dynamic benchmark harness:

```sh
N=300000 DIFF=1000 CELLS=5000 TRIALS=30 WARMUPS=5 OUTPUT=c-bench/results-dynamic-300k.json node c-bench/benchmark-dynamic.mjs
```

128-bit keys, fixed and runtime-configured implementations, with both 32- and 96-bit checksum controls. Each endpoint has 300,000 keys: 299,500 shared, 500 unique on each side. Keys are deterministic SHA-1 prefixes, matching earlier measurements; key generation is outside timing. These are set reconciliation CPU costs, not database scanning, note content transfer, network delay or a browser benchmark.

Full sync includes building both tables, serializing/copying/deserializing one payload, and decoding/results copied to JS. Maintained sync persists tables across rounds; each endpoint removes 500 old unique keys and inserts 500 new unique keys, then performs the same sync. Initial 300k builds excluded. Thus it times 2,000 total key updates, not 500 single-endpoint note edits. Inputs are prepacked outside timing. Every recovered key is checked, and maintained tables are byte-compared against a complete rebuild each round outside timing.

For 128-bit key + 96-bit checksum, every bucket is 32 bytes. 5,000 buckets = 160,000 bytes = 156.25 KiB of payload per transferred table (no headers). Storage scales with bucket count; full build CPU scales with total records. A larger bucket count must be chosen before building or maintaining a table; increasing it requires rehashing original keys.

A separate capacity-only experiment (`node c-bench/check-capacity.mjs`) tries 1,500/2,000/3,000/5,000 buckets on 100 sets with 1,000 differences. It omits common keys because their bucket contributions cancel exactly. This tests decode success, not the cost of building 300k tables, and observed success does not guarantee success for all future sets.

600 distinct note edits can yield 1,200 set differences when each edit replaces one old key with one new key. Repeated edits to the same note can collapse to only its two endpoint versions; creation/deletion generally contributes one difference. The requested measured case uses 1,000 total differences.

## Recorded results

Environment: v24.21.0, Intel(R) Core(TM) Ultra 7 258V, linux/x64. Five warmups, 30 measured rounds per scenario and variant.

| Variant | Sender build | Receiver build | Full sync median | Full p95 | Maintained median | Maintained p95 |
|---|---:|---:|---:|---:|---:|---:|
| fixed128/check32 | 22.0066 ms | 22.0850 ms | 45.0265 ms | 57.7238 ms | 0.5239 ms | 0.8704 ms |
| dynamic128/check32 | 27.5255 ms | 27.3929 ms | 55.3409 ms | 75.4975 ms | 0.6422 ms | 1.1631 ms |
| fixed128/check96 | 22.1364 ms | 21.9103 ms | 44.8446 ms | 54.4256 ms | 0.5720 ms | 0.8314 ms |
| dynamic128/check96 | 37.3038 ms | 37.0454 ms | 75.2975 ms | 89.2680 ms | 0.8184 ms | 1.0061 ms |

All configurations recovered the exact differences in 30/30 full and 30/30 maintained rounds; zero wrong results. Individual column medians need not add to the total median.

Capacity-only results (128-bit keys, 96-bit checksum):

| Buckets | Payload | Exact successes |
|---|---:|---:|
| 1500 | 48000 bytes | 100/100 |
| 2000 | 64000 bytes | 100/100 |
| 3000 | 96000 bytes | 100/100 |
| 5000 | 160000 bytes | 100/100 |

Even 1,500 buckets succeeded in these 100 samples, so 5,000 is not a demonstrated minimum. These finite samples do not establish a guaranteed capacity or failure probability. Raw results: `results-dynamic-300k.json`, `results-capacity-1000.json`.
