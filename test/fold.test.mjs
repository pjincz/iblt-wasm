import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as iblt from 'iblt-wasm';

const key = n => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
};
const ids = keys => keys.map(bytes => new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)).sort((a,b) => a-b);

test('fold is byte-identical to direct construction for different widths and factors', () => {
  for (const width of [4, 16, 20, 32]) for (const checksum of [4, 8, 12, 16]) {
    const tables = [];
    const create = cells => { const t = iblt.create(width, checksum, cells); tables.push(t); return t; };
    const track = t => { tables.push(t); return t; };
    const keys = Array.from({length: 200}, (_, n) => {
      const bytes = new Uint8Array(width);
      for (let offset = 0; offset < width; offset += 4) new DataView(bytes.buffer).setUint32(offset, n * 37 + offset, true);
      return bytes;
    });
    const populate = t => { t.add(keys); t.remove(keys.slice(0, 30)); t.remove([new Uint8Array(width).fill(255)]); };
    try {
      const large = create(240);
      populate(large);
      const original = large.serialize();
      for (const cells of [240, 120, 80, 48, 4]) {
        const direct = create(cells);
        populate(direct);
        const folded = track(large.fold(cells));
        assert.deepEqual(folded.serialize(), direct.serialize());
        assert.deepEqual(large.serialize(), original);
        folded.add(key(10000));
        assert.deepEqual(large.serialize(), original);
      }
      assert.deepEqual(track(track(large.fold(80)).fold(16)).serialize(), track(iblt.fold(large, 16)).serialize());
    } finally { tables.forEach(t => t.destroy()); }
  }
});

test('folded payload decodes against a directly constructed small table', () => {
  const tables = [];
  const track = t => { tables.push(t); return t; };
  try {
    const server = track(iblt.create(16,12,5000));
    const client = track(iblt.create(16,12,1000));
    server.add(Array.from({length:1000}, (_,i) => key(i)));
    client.add(Array.from({length:1000}, (_,i) => key(i+20)));
    const small = track(server.fold(1000));
    const wire = small.serialize();
    assert.equal(wire.length, 32000);
    const received = track(iblt.deserialize(16,12,1000,wire));
    const result = received.decode(client);
    assert.equal(result.success,true);
    assert.deepEqual(ids(result.onlyRemote),Array.from({length:20},(_,i)=>i));
    assert.deepEqual(ids(result.onlyLocal),Array.from({length:20},(_,i)=>1000+i));
    assert.deepEqual(small.serialize(),wire);
    const sameSize = track(server.fold(5000));
    server.destroy();
    assert.equal(sameSize.decode(sameSize).success,true);
  } finally { tables.forEach(t => t.destroy()); }
});

test('fold validates target sizes and table lifecycle', () => {
  const table = iblt.create(16,12,512);
  try {
    for (const cells of [undefined,0,-4,2,6,12,1024,4.5,NaN,Infinity,'128',2**32+128]) {
      assert.throws(() => table.fold(cells), /Fold cells/);
    }
    const empty = table.fold(4);
    try { assert.deepEqual(empty.serialize(),new Uint8Array(128)); } finally { empty.destroy(); }
    assert.throws(() => iblt.fold({},4), /Unknown\/destroyed/);
  } finally { table.destroy(); }
  assert.throws(() => table.fold(4), /Unknown\/destroyed/);
});

test('fold wraps counts without changing the source', () => {
  // Synthetic payloads exercise int32 limits without billions of updates.
  for (const counts of [[2147483647,1,0],[-2147483648,-1,0],[2147483647,1,-1]]) {
    const payload = new Uint8Array(12 * 32);
    const view = new DataView(payload.buffer);
    counts.forEach((count,i) => view.setInt32(i*32,count,true));
    const source = iblt.deserialize(16,12,12,payload);
    try {
      const folded = source.fold(4);
      try { assert.equal(new DataView(folded.serialize().buffer).getInt32(0,true),counts.reduce((a,b) => a+b,0) | 0); }
      finally { folded.destroy(); }
      assert.deepEqual(source.serialize(),payload);
    } finally { source.destroy(); }
  }
});
