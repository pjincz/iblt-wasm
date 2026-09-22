import createModule from './build/libraries.mjs';

export const wasm = await createModule();
export const libraries = [
  { name: 'GNUnet IBF', type: 0, size: 200 },
  { name: 'IBLT_Cplusplus', type: 1, size: 200 },
  { name: 'minisketch', type: 2, size: 100 },
];

export function input(keys) {
  const ptr = wasm._malloc(Math.max(8, keys.length * 8));
  const view = new DataView(wasm.HEAPU8.buffer);
  keys.forEach((key, i) => view.setBigUint64(ptr + i * 8, key, true));
  return { ptr, length: keys.length, free() { wasm._free(ptr); } };
}
export const create = spec => wasm._bench_create(spec.type, spec.size);
export const destroy = table => wasm._bench_destroy(table);
export const clone = table => wasm._bench_clone(table);
export const update = (table, keys, remove = false) => wasm._bench_update(table, keys.ptr, keys.length, Number(remove));

export function serialize(table) {
  const length = wasm._bench_wire_size(table);
  const ptr = wasm._malloc(Math.max(1, length));
  try {
    wasm._bench_serialize(table, ptr);
    return wasm.HEAPU8.slice(ptr, ptr + length);
  } finally { wasm._free(ptr); }
}
export function deserialize(spec, bytes) {
  const table = create(spec);
  if (wasm._bench_wire_size(table) !== bytes.length) {
    destroy(table); throw new Error('Wrong payload size');
  }
  const ptr = wasm._malloc(Math.max(1, bytes.length));
  try {
    wasm.HEAPU8.set(bytes, ptr);
    wasm._bench_deserialize(table, ptr);
    return table;
  } catch (error) { destroy(table); throw error; }
  finally { wasm._free(ptr); }
}
export function decode(remote, local, maxOutput, localKeys) {
  const success = Boolean(wasm._bench_decode(remote, local, maxOutput));
  const count = wasm._bench_result_count(remote);
  const keys = wasm._bench_result_keys(remote), sides = wasm._bench_result_sides(remote);
  const view = new DataView(wasm.HEAPU8.buffer);
  const onlyRemote = [], onlyLocal = [];
  for (let i = 0; i < count; ++i) {
    const key = view.getBigUint64(keys + i * 8, true);
    let side = view.getInt32(sides + i * 4, true);
    // minisketch returns the symmetric difference, without direction.
    if (side === 0) side = localKeys.has(key) ? -1 : 1;
    (side === 1 ? onlyRemote : onlyLocal).push(key);
  }
  return { success, onlyRemote, onlyLocal };
}
