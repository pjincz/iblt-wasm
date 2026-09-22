import assert from 'node:assert/strict';
import * as wide from './wide-bridge.mjs';
import * as original from './bridge.mjs';

const hex = key => Buffer.from(key).toString('hex');
for (const bits of [64, 128, 160]) {
  const width = bits / 8;
  const zero = Buffer.alloc(width), ones = Buffer.alloc(width, 255);
  const left = Buffer.alloc(width, 7), right = Buffer.from(left);
  left[width - 1] = 31; right[width - 1] = 32;
  const a = wide.create(bits, 200), b = wide.create(bits, 200);
  const inputs = [[zero, ones, left], [zero, ones, right], [left], [right]].map(x => wide.input(x, width));
  let received = 0, snapshot = 0;
  try {
    wide.update(a, inputs[0]); wide.update(b, inputs[1]); snapshot = wide.clone(a);
    const wire = wide.serialize(a);
    assert.equal(wire.length, 200 * (width + 8));
    received = wide.deserialize(bits, 200, wire);
    assert.deepEqual(wide.serialize(received), wire);
    const result = wide.decode(received, b, width);
    assert(result.success);
    assert.deepEqual(result.onlyRemote.map(hex), [hex(left)]);
    assert.deepEqual(result.onlyLocal.map(hex), [hex(right)]);
    wide.destroy(received); received = 0;
    wide.update(a, inputs[2], true); wide.update(a, inputs[3]);
    assert.deepEqual(wide.serialize(a), wide.serialize(b));
    assert.deepEqual(wide.serialize(snapshot), wire);
    const empty = wide.decode(a, b, width);
    assert(empty.success); assert.equal(empty.onlyRemote.length + empty.onlyLocal.length, 0);
    if (bits === 64) {
      const old = original.create({ type: 1, size: 200 });
      const oldInput = original.input([zero, ones, left].map(x => x.readBigUInt64LE()));
      try { original.update(old, oldInput); assert.deepEqual(original.serialize(old), wire); }
      finally { original.destroy(old); oldInput.free(); }
    }
    console.log(`${bits}-bit: full-width distinction, zero/all-one keys, roundtrip, deletion, clone and empty diff passed`);
  } finally {
    if (received) wide.destroy(received);
    if (snapshot) wide.destroy(snapshot);
    wide.destroy(a); wide.destroy(b); inputs.forEach(x => x.free());
  }
}

// Every byte position (including all bytes above 64 bits) is distinguished.
for (const bits of [128, 160]) {
  const width = bits / 8;
  const keys = Array.from({ length: width }, (_, i) => { const b = Buffer.alloc(width); b[i] = 1; return b; });
  const a = wide.create(bits, 200), b = wide.create(bits, 200), data = wide.input(keys, width);
  try {
    wide.update(a, data);
    const result = wide.decode(a, b, width);
    assert(result.success);
    assert.deepEqual(result.onlyRemote.map(hex).sort(), keys.map(hex).sort());
    assert.equal(result.onlyLocal.length, 0);
    wide.update(a, data, true);
    assert.deepEqual(wide.serialize(a), wide.serialize(b));
  } finally { wide.destroy(a); wide.destroy(b); data.free(); }
}
console.log('128/160-bit: all byte positions participate, deletion restores empty table');
