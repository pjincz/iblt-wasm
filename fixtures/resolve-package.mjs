import assert from 'node:assert/strict';
assert.equal(import.meta.resolve('iblt-wasm'), process.argv[2]);
