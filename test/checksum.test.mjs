import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as iblt from 'iblt-wasm';

test('all checksum lengths are prefixes of the same hash128 output', () => {
  for (const width of [4, 8, 12, 16, 20, 32, 64]) {
    const key = Uint8Array.from({ length: width }, (_, i) => i);
    const tables = [4, 8, 12, 16].map(check => iblt.create(width, check, 4));
    try {
      for (const table of tables) table.add([key]);
      const wires = tables.map(table => table.serialize());
      for (let bucket = 0; bucket < 4; bucket++) {
        const sum = wires[3].slice(bucket * (4 + width + 16) + 4 + width, (bucket + 1) * (4 + width + 16));
        for (const [i, bytes] of [4, 8, 12, 16].entries()) {
          const actual = wires[i].slice(bucket * (4 + width + bytes) + 4 + width, (bucket + 1) * (4 + width + bytes));
          assert.deepEqual(actual, sum.slice(0, bytes));
        }
        // Previously checked against the official SMHasher reference (seed 11).
        if (width === 16) assert.equal(Buffer.from(sum.slice(0, 12)).toString('hex'), '409bf1ed862b82df7d98d374');
      }
    } finally { tables.forEach(table => table.destroy()); }
  }
});

test('bucket selection uses the four seed-0 hash128 words', () => {
  const key = Uint8Array.from({ length: 16 }, (_, i) => i);
  // SMHasher x64_128 reference output, as four little-endian uint32 words.
  const words = [2442149680, 1145644213, 1982851141, 2878366806];
  const table = iblt.create(16, 12, 512);
  try {
    table.add([key]);
    const wire = table.serialize(), view = new DataView(wire.buffer);
    const occupied = [];
    for (let i = 0; i < 512; i++) if (view.getInt32(i * 32, true)) occupied.push(i);
    assert.deepEqual(occupied, words.map((word, i) => i * 128 + word % 128));
  } finally { table.destroy(); }
});
