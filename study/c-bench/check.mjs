import assert from 'node:assert/strict';
import { libraries, create, destroy, clone, input, update, serialize, deserialize, decode } from './bridge.mjs';

for (const spec of libraries) {
  const high = (1700000000n << 32n) | 1700000300n;
  const aKeys = [1n, 2n, 0xffffffffffffffffn, high];
  const bKeys = [2n, 3n, 0xffffffffffffffffn, high];
  const a = create(spec), b = create(spec);
  const inputs = [input(aKeys), input(bKeys), input([1n]), input([3n])];
  let snapshot = 0, received = 0;
  try {
    update(a, inputs[0]); update(b, inputs[1]);
    snapshot = clone(a);
    const wire = serialize(a);
    received = deserialize(spec, wire);
    assert.deepEqual(serialize(received), wire);
    const result = decode(received, b, 100, new Set(bKeys));
    assert.equal(result.success, true);
    assert.deepEqual(result.onlyRemote, [1n]);
    assert.deepEqual(result.onlyLocal, [3n]);
    destroy(received); received = 0;
    // Transition A to B without rebuilding; verify original snapshot survived.
    update(a, inputs[2], true); update(a, inputs[3]);
    assert.deepEqual(serialize(a), serialize(b));
    assert.deepEqual(serialize(snapshot), wire);
    received = deserialize(spec, serialize(a));
    const equal = decode(received, b, 100, new Set(bKeys));
    assert.equal(equal.success, true);
    assert.deepEqual(equal.onlyRemote, []);
    assert.deepEqual(equal.onlyLocal, []);
    console.log(`${spec.name}: insert, delete, copy, binary roundtrip, signed diff, empty diff passed`);
  } finally {
    if (snapshot) destroy(snapshot);
    if (received) destroy(received);
    destroy(a); destroy(b);
    inputs.forEach(x => x.free());
  }
}
