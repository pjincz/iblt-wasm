import createModule from './iblt.mjs';
export const wasm = await createModule();
// Weak keys allow unreachable table objects to be collected.
const states = new WeakMap();
const finalizer = new FinalizationRegistry(state => {
  if (state.ptr) {
    wasm._iblt_destroy(state.ptr);
    state.ptr = 0;
  }
});
function config(table) {
  const state = states.get(table);
  if (!state?.ptr) throw new Error('Unknown/destroyed table');
  return state;
}
class Table {
  add(keys) { add(this, keys); }
  remove(keys) { remove(this, keys); }
  serialize() { return serialize(this); }
  decode(local) { return decode(this, local); }
  clone() { return clone(this); }
  destroy() { destroy(this); }
}
function wrap(ptr, keyBytes, checkBytes, cells) {
  if (!ptr) throw new Error('Table allocation failed');
  const table = new Table();
  const state = { ptr, keyBytes, checkBytes, cells };
  states.set(table, state);
  // Neither the held state nor the callback retains the table object.
  finalizer.register(table, state, table);
  return table;
}
function aligned(n) { return Number.isSafeInteger(n) && n>=4 && n%4===0; }
export function create(keyBytes,checkBytes,cells) {
  if(!aligned(keyBytes)||!aligned(checkBytes)||checkBytes>16||!aligned(cells)||cells*(4+keyBytes+checkBytes)>0x7fffffff) throw new Error('Invalid configuration');
  const t=wasm._iblt_create(cells,keyBytes,checkBytes);
  if(!t) throw new Error('Creation failed');
  return wrap(t, keyBytes, checkBytes, cells);
}
export function destroy(table) {
  const state = states.get(table);
  if (!state) throw new Error('Unknown table');
  if (!state.ptr) return; // Safe to call more than once.
  finalizer.unregister(table);
  wasm._iblt_destroy(state.ptr);
  state.ptr = 0;
}
export function clone(table) {
  const { ptr, keyBytes, checkBytes, cells } = config(table);
  return wrap(wasm._iblt_clone(ptr), keyBytes, checkBytes, cells);
}
function change(table, keys, remove) {
  const { ptr: tablePtr, keyBytes } = config(table);
  if (!Array.isArray(keys) || keys.length * keyBytes > 0x7fffffff) throw new Error('Invalid key input');
  for (const key of keys) {
    if (!(key instanceof Uint8Array) || key.byteLength > keyBytes) throw new Error('Invalid key input');
  }
  if (keys.length === 0) return;
  const ptr = wasm._malloc(keys.length * keyBytes);
  if (!ptr) throw new Error('Input allocation failed');
  try {
    keys.forEach((key, i) => {
      const start = ptr + i * keyBytes;
      wasm.HEAPU8.set(key, start);
      // malloc may reuse nonzero memory; explicitly clear each short key's tail.
      if (key.byteLength < keyBytes) wasm.HEAPU8.fill(0, start + key.byteLength, start + keyBytes);
    });
    if (!wasm._iblt_update(tablePtr, ptr, keys.length, Number(remove))) {
      throw new Error('Counter overflow; preceding keys may have been applied');
    }
  } finally {
    wasm._free(ptr);
  }
}
export function add(table, keys) { change(table, keys, false); }
export function remove(table, keys) { change(table, keys, true); }
export function serialize(t) {
  const tablePtr=config(t).ptr;const length=wasm._iblt_wire_size(tablePtr),ptr=wasm._malloc(length);
  try {wasm._iblt_serialize(tablePtr,ptr);return wasm.HEAPU8.slice(ptr,ptr+length);}finally{wasm._free(ptr);}
}
export function deserialize(keyBytes,checkBytes,cells,bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length!==cells*(4+keyBytes+checkBytes)) throw new Error('Wrong payload size');
  const t=create(keyBytes,checkBytes,cells),ptr=wasm._malloc(bytes.length);
  try{wasm.HEAPU8.set(bytes,ptr);wasm._iblt_deserialize(config(t).ptr,ptr);return t;}catch(e){destroy(t);throw e;}finally{wasm._free(ptr);}
}
export function decode(a,b) {
  const ca=config(a),cb=config(b);
  if(ca.keyBytes!==cb.keyBytes||ca.checkBytes!==cb.checkBytes||ca.cells!==cb.cells) throw new Error('Incompatible tables');
  const success=Boolean(wasm._iblt_decode(ca.ptr,cb.ptr));
  const count=wasm._iblt_result_count(ca.ptr),keys=wasm._iblt_result_keys(ca.ptr),sides=wasm._iblt_result_sides(ca.ptr);
  const view=new DataView(wasm.HEAPU8.buffer),onlyRemote=[],onlyLocal=[];
  for(let i=0;i<count;i++) {
    const key=wasm.HEAPU8.slice(keys+i*ca.keyBytes,keys+(i+1)*ca.keyBytes);
    (view.getInt32(sides+i*4,true)===1?onlyRemote:onlyLocal).push(key);
  }
  return {success,onlyRemote,onlyLocal};
}
