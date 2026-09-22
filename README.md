# iblt-wasm

A WebAssembly-powered Invertible Bloom Lookup Table (IBLT) library for efficient set reconciliation in Node.js and browsers.

This project began with [IBLT_Cplusplus](https://github.com/gavinandresen/IBLT_Cplusplus) by Gavin Andresen as its prototype and reference implementation. It has since evolved into a key-only implementation with configurable key and checksum lengths, WebAssembly support, and a JavaScript API.

## Build and test

Building requires GNU Make 4.3+, a POSIX shell, Node.js and Emscripten. Activate the Emscripten environment so `em++` is on `PATH`, or set `EMSDK` to its installation directory:

```sh
export EMSDK=/path/to/emsdk
npm run build
npm test
npm pack
```

`npm run build` calls `make`; unchanged outputs are reused. You can also run `make -j` or `make test` directly. To override the compiler, use `make EMXX=/path/to/em++`. After changing compiler options or SDK versions, use `make -B` to force a rebuild.

`npm pack` builds the package through `prepack`. The package includes the generated JavaScript and WASM in `dist/`; consumers do not need a compiler. There is no project-specific Python build script; Python remains an internal dependency of Emscripten itself.

## Usage

The client has `alice` and `bob`; the server has `bob` and `oscar`.

```js
import * as iblt from 'iblt-wasm';

const key_encoder = new TextEncoder();
const key_decoder = key => (new TextDecoder()).decode(key).replace(/\0+$/, '');

////////////////////////////////////////////////////////////////////////////////
// --- Server side: prepare payload, and pass to client ---
const server_table = iblt.create(16, 12, 512); // key length, checksum length (bytes), buckets
server_table.add(['bob', 'oscar'].map(name => key_encoder.encode(name)));
const payload = server_table.serialize();  // Pass this to the client via HTTP, WebSocket, etc.

////////////////////////////////////////////////////////////////////////////////
// --- Client side: receive the payload and find differences ---
const client_table = iblt.create(16, 12, 512); // arguments must exactly match the server side
client_table.add(['alice', 'bob'].map(name => key_encoder.encode(name)));

const received_table = iblt.deserialize(16, 12, 512, payload);
const result = received_table.decode(client_table);

if (result.success) {
  console.log('server side only:', result.onlyRemote.map(key_decoder)); // ['oscar']
  console.log('client side only:', result.onlyLocal.map(key_decoder));  // ['alice']
} else {
  // Discard partial results and rebuild both tables with more buckets.
  console.log('Could not decode the differences; retry with more buckets.');
}
```

`bob` is shared and cancels out. `decode(remote, local)` leaves both tables unchanged. The text conversion above assumes names do not contain trailing NUL characters; binary keys should stay as bytes.

## API

### Creating and restoring tables

- `iblt.create(keyLength, checksumLength, buckets)` → Table

  Create an empty table. All three arguments are required. Lengths are in bytes.

- `iblt.deserialize(keyLength, checksumLength, buckets, payload)` → Table

  Restore a table from a `Uint8Array` payload using the sender's exact configuration.

### Table methods

- `table.add(keys)` → `undefined`

  Insert a single `Uint8Array` key or an array of keys. Short keys are zero-padded; oversized keys throw.

  **Do not add a key that is already present.** Unlike `Set.add()`, every call contributes to the bucket counts and XOR sums; keys are not deduplicated. Adding the same key twice can make the difference table impossible to decode: a remaining multiplicity of two cannot be peeled as a single key. Equal duplicate counts on both sides can still cancel, so failure is not guaranteed. The library stores an aggregate table, not the full key set, and does not detect or reject duplicate insertions. Your application must enforce uniqueness, including across keys that become identical after zero-padding.

- `table.remove(keys)` → `undefined`

  Remove a single `Uint8Array` key or an array of previously inserted keys, using the same padding rules.

- `table.serialize()` → `Uint8Array`

  Return an independent copy of the table's binary payload.

- `remoteTable.decode(localTable)` → Decode result

  Find the differences without modifying either table. Configurations must match.

- `table.clone()` → Table

  Create an independent copy with the same configuration and contents.

- `table.destroy()` → `undefined`

  Optionally release WASM resources immediately instead of waiting for GC. Repeated calls are safe; other operations after destruction throw.

`decode()` returns `{ success, onlyRemote, onlyLocal }`. When `success` is `true`, `onlyRemote` contains keys present only in the receiver of the method call (`remoteTable`), and `onlyLocal` contains keys present only in its argument (`localTable`). Both are arrays of padded `Uint8Array` keys; ordering is unspecified. When `success` is `false`, discard both arrays because they may contain partial results.

Function-style equivalents are also available: `iblt.add(table, keys)`, `iblt.remove(table, keys)`, `iblt.serialize(table)`, `iblt.decode(remoteTable, localTable)`, `iblt.clone(table)` and `iblt.destroy(table)`.

## Maintaining a table across syncs

Build a table from your full dataset once, then keep it up to date as records change:

- When a record is created, call `table.add(key)`.
- When a record is deleted, call `table.remove(oldKey)`.
- When a record's key changes, call `table.remove(oldKey)`, then `table.add(newKey)`.

`remove()` reverses a previous insertion; it lets the table continue to represent the current dataset without rebuilding it. If edits should appear as differences, encode the record's version or a content hash in its key. Changing content while keeping the same key is invisible to the table.

At the next sync, just call `table.serialize()` and compare against the other side's maintained table. Adding or removing each key touches four buckets, regardless of the total record count, so you do not need to scan the full list on every sync. Decoding leaves both tables unchanged, ready for future updates.

Apply every change exactly once and retain the old key until it has been removed. If the table is lost, updates are missed, or its configuration changes, rebuild it from the current dataset. This tracks the current set, not an edit history.

## Choosing parameters

Both endpoints must use the same parameters and key encoding. Lengths below are in **bytes**, not bits or character counts.

### Key length

Choose the **smallest multiple of 4 bytes that fits every key your application needs**. For example, a 64-bit ID needs 8 bytes, a 128-bit ID needs 16, and a SHA-1 digest needs 20. Shorter keys save space in every bucket and reduce transfer size. For strings, measure UTF-8 byte length, not JavaScript string length. The example uses 16 bytes, but 8 would fit all three sample names.

`add(table, keys)` and `remove(table, keys)` automatically pad shorter `Uint8Array` keys with trailing zero bytes. Keys longer than the configured length throw `Invalid key input`; they are never truncated. Returned keys always have the configured length, and original lengths are not stored. Consequently, `[1]` and `[1, 0]` represent the same padded key. If trailing zeros distinguish your application's keys, include the original length in your key encoding.

### Checksum length

The checksum helps the decoder check whether a bucket contains a single recoverable key. It is separate from the key and does not carry application data. Supported lengths are **4, 8, 12 and 16 bytes** (32, 64, 96 and 128 bits). All lengths use the corresponding prefix of MurmurHash3_x64_128 (seed 11), encoded little-endian. Bucket selection uses another MurmurHash3_x64_128 result (seed 0), split into four 32-bit words, one for each disjoint subtable.

Longer checksums reduce accidental false matches at the cost of more bytes per bucket. **12 bytes is a reasonable starting point** and is used in our examples; 4 saves the most space but provides less protection, while 8 and 16 offer intermediate and stronger protection respectively. Increasing this value does not fix insufficient bucket capacity or collisions in your application's own key encoding. Checksums use noncryptographic MurmurHash3, so they are not authentication and do not guarantee correct decoding.

### Bucket count

Size the table for the **expected number of differences**, not the total number of records. Count keys unique to either side: replacing one old key with a new key contributes two differences. The sample above has two differences, `alice` and `oscar`.

A practical starting point for this implementation is **2–3 buckets per expected difference**, rounded up to a multiple of 4, with a minimum of 4 buckets. This is a starting point to test with your data, not a guarantee. Use extra headroom when the difference count is uncertain. `buckets` must be provided explicitly. The example uses `512`, which is much more than this tiny example needs.

If decoding fails, discard partial results and retry with more buckets. Changing bucket count changes key placement, so both endpoints must rebuild from their keys; an existing table cannot simply be extended with empty buckets. With the current mapping, our mixed-input capacity experiment recovered 1,000 differences with 3,000 buckets in 3,000/3,000 trials, but finite samples do not establish a guaranteed capacity.

### Transfer size

The serialized size of **one table payload** is exactly:

```text
bytes = (4 + key_length + checksum_length) * buckets
```

The `4` is the signed 32-bit count stored in each bucket. For the example:

```text
(4 + 16 + 12) * 512 = 16,384 bytes = 16 KiB
```

This excludes transport headers, retries, additional table transfers and any actual records exchanged after finding the differences. The payload does not include the configuration; agree on it separately. Total bucket storage is limited to `INT32_MAX` bytes.

## Layout

- `src/cpp/iblt.h`: self-contained C++17 core, including hashes.
- `src/cpp/iblt-wrapper.cpp`: C ABI for WebAssembly.
- `src/index.mjs`: JavaScript bridge, copied alongside the generated module during build.
- `Makefile`: incremental Emscripten build and test targets.
- `test/iblt.test.mjs`: integration checks through the package entry point.
- `study/`: independent historical experiments and benchmarks, excluded from the npm package.

See the [benchmark](study/c-bench/README-dynamic.md) and [300,000-record benchmark](study/c-bench/README-300k.md).

## Acknowledgments

Special thanks to Gavin Andresen and the contributors to [IBLT_Cplusplus](https://github.com/gavinandresen/IBLT_Cplusplus). Its concise C++ implementation provided the starting point for this project's experiments and helped make the IBLT algorithm accessible. This project builds on that work with gratitude.

Thanks also to Austin Appleby for [MurmurHash3 and SMHasher](https://github.com/aappleby/smhasher). Our hashing code is adapted from his public-domain reference implementation, which we also use to verify correctness.

## License

[BSD-3-Clause](LICENSE). Third-party code under `study/` retains its original licenses. The embedded MurmurHash3 implementation is adapted from Austin Appleby's public-domain reference implementation.
