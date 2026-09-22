// Run in an isolated Node process with --expose-gc.
import assert from 'node:assert/strict';
import * as iblt from 'iblt-wasm';
const nativeDestroy = iblt.wasm._iblt_destroy;
let frees = 0;
iblt.wasm._iblt_destroy = ptr => { frees++; nativeDestroy(ptr); };
const live = iblt.create(16, 12, 512);
function abandonTables() {
  const explicit = iblt.create(16, 12, 512);
  explicit.destroy(); explicit.destroy();
  const original = iblt.create(16, 12, 512);
  original.add([Uint8Array.of(7)]);
  original.clone();
  iblt.deserialize(16, 12, 512, original.serialize());
}
abandonTables();
assert.equal(frees, 1);
for (let i = 0; i < 200; i++) {
  globalThis.gc();
  await new Promise(resolve => setTimeout(resolve, 10));
  if (frees >= 4 && i >= 10) break;
}
assert.equal(frees, 4, 'one explicit release plus three GC releases');
live.add([Uint8Array.of(1)]);
assert.equal(live.serialize().length, 16384);
live.destroy();
assert.equal(frees, 5);
iblt.wasm._iblt_destroy = nativeDestroy;
