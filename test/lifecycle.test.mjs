import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as iblt from 'iblt-wasm';

test('object methods interoperate with functions and reject use after destroy', () => {
  const a = iblt.create(16, 12, 512), b = iblt.create(16, 12, 512);
  assert.equal(typeof a, 'object');
  const keys = [Uint8Array.of(1, 2)];
  a.add(keys);
  const copy = a.clone();
  try {
    assert.deepEqual(copy.serialize(), iblt.serialize(a));
    assert(a.decode(b).success);
    assert.equal(a.decode(b).onlyRemote.length, 1);
    iblt.remove(copy, keys);
    assert.deepEqual(copy.serialize(), b.serialize());
    a.remove(keys);
    assert.deepEqual(a.serialize(), b.serialize());
  } finally { a.destroy(); b.destroy(); copy.destroy(); }
  a.destroy(); iblt.destroy(a);
  for (const action of [() => a.add([]), () => a.remove([]), () => a.clone(), () => a.serialize(), () => a.decode(b)]) {
    assert.throws(action, /destroyed table/);
  }
  assert.throws(() => iblt.add({}, keys), /Unknown/);
});

test('GC releases abandoned tables and explicit destroy does not double-free', () => {
  const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('../fixtures/gc-check.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(child.status, 0, child.error?.message ?? child.stderr + child.stdout);
});
