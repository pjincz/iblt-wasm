import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as iblt from 'iblt-wasm';

test('short keys match explicitly padded keys, including removals', () => {
  for (const width of [4, 16, 20, 32]) {
    const keys = [new Uint8Array(), Uint8Array.of(1), new Uint8Array(width - 1).fill(2), new Uint8Array(width).fill(3)];
    const padded = keys.map(key => { const out = new Uint8Array(width); out.set(key); return out; });
    const a = iblt.create(width, 12, 512), b = iblt.create(width, 12, 512);
    try {
      iblt.add(a, keys); iblt.add(b, padded);
      assert.deepEqual(iblt.serialize(a), iblt.serialize(b));
      assert.deepEqual(iblt.decode(a, b), { success: true, onlyRemote: [], onlyLocal: [] });
      iblt.remove(a, padded); iblt.remove(b, keys);
      assert(iblt.serialize(a).every(byte => byte === 0));
      assert(iblt.serialize(b).every(byte => byte === 0));
    } finally {
      iblt.destroy(a); iblt.destroy(b);
    }
  }
});

test('server/client example recovers oscar and alice through serialized payload', () => {
  const encode = text => new TextEncoder().encode(text);
  const text = key => new TextDecoder().decode(key).replace(/\0+$/, '');
  const server = iblt.create(16, 12, 512), client = iblt.create(16, 12, 512);
  let received;
  try {
    iblt.add(server, ['bob', 'oscar'].map(encode)); iblt.add(client, ['alice', 'bob'].map(encode));
    const payload = iblt.serialize(server);
    assert.equal(payload.length, (4 + 16 + 12) * 512);
    received = iblt.deserialize(16, 12, 512, payload);
    const result = iblt.decode(received, client);
    assert(result.success);
    assert.deepEqual(result.onlyRemote.map(text), ['oscar']);
    assert.deepEqual(result.onlyLocal.map(text), ['alice']);
    assert(result.onlyRemote.every(key => key.length === 16));
    assert(result.onlyLocal.every(key => key.length === 16));
  } finally {
    for (const table of [received, server, client]) if (table !== undefined) iblt.destroy(table);
  }
});

test('add/remove validate the entire array before changing the table', () => {
  const table = iblt.create(16, 12, 512);
  try {
    const before = iblt.serialize(table);
    for (const mutate of [iblt.add, iblt.remove]) {
      mutate(table, []);
      for (const keys of [new Array(1), [[1, 2]], null, new Uint8Array(17), [Uint8Array.of(1), new Uint8Array(17)]]) {
        assert.throws(() => mutate(table, keys), /Invalid key input/);
        assert.deepEqual(iblt.serialize(table), before);
      }
    }
    assert.equal('input' in iblt, false);
    assert.equal('update' in iblt, false);
  } finally { iblt.destroy(table); }
});

test('single keys and batches are interchangeable, including empty and offset keys', () => {
  const single = iblt.create(16, 12, 512), batch = iblt.create(16, 12, 512);
  const keys = [new Uint8Array(), Uint8Array.of(9, 1, 2, 9).subarray(1, 3), new Uint8Array(16).fill(3), Buffer.from([4, 5])];
  try {
    for (const key of keys) single.add(key);
    batch.add(keys);
    assert.deepEqual(single.serialize(), batch.serialize());
    single.remove(keys);
    for (const key of keys) iblt.remove(batch, key);
    assert(single.serialize().every(byte => byte === 0));
    assert(batch.serialize().every(byte => byte === 0));
    iblt.add(single, keys[1]);
    batch.add([keys[1]]);
    assert.deepEqual(single.serialize(), batch.serialize());
  } finally { single.destroy(); batch.destroy(); }
});

test('temporary input memory is released when native update rejects overflow', () => {
  const cells = 4, stride = 32, wire = new Uint8Array(cells * stride);
  const view = new DataView(wire.buffer);
  for (const [mutate, count] of [[iblt.add, 2147483647], [iblt.remove, -2147483648]]) {
    for (let i = 0; i < cells; i++) view.setInt32(i * stride, count, true);
    const table = iblt.deserialize(16, 12, cells, wire);
    const malloc = iblt.wasm._malloc, free = iblt.wasm._free;
    let allocated, freed;
    try {
      iblt.wasm._malloc = size => (allocated = malloc(size));
      iblt.wasm._free = ptr => { freed = ptr; free(ptr); };
      assert.throws(() => mutate(table, [Uint8Array.of(1)]), /Counter overflow/);
      assert(allocated);
      assert.equal(freed, allocated);
    } finally {
      iblt.wasm._malloc = malloc; iblt.wasm._free = free;
    }
    try { assert.deepEqual(iblt.serialize(table), wire); }
    finally { iblt.destroy(table); }
  }
});
