import createModule from './build/wide/iblt-wide.mjs';

export const wasm = await createModule();
export function input(keys, width) {
  if (keys.some(k => k.byteLength !== width)) throw new Error('Wrong key width');
  const ptr = wasm._malloc(Math.max(1, keys.length * width));
  keys.forEach((key, i) => wasm.HEAPU8.set(key, ptr + i * width));
  return { ptr, length: keys.length, free() { wasm._free(ptr); } };
}
export const create = (bits, cells) => wasm._wide_create(bits, cells);
export const destroy = t => wasm._wide_destroy(t);
export const clone = t => wasm._wide_clone(t);
export const update = (t, keys, remove = false) => wasm._wide_update(t, keys.ptr, keys.length, Number(remove));
export function serialize(table) {
  const length = wasm._wide_wire_size(table), ptr = wasm._malloc(length);
  try { wasm._wide_serialize(table, ptr); return wasm.HEAPU8.slice(ptr, ptr + length); }
  finally { wasm._free(ptr); }
}
export function deserialize(bits, cells, bytes) {
  if (bytes.length !== cells * (bits / 8 + 8)) throw new Error('Wrong payload size');
  const table = create(bits, cells), ptr = wasm._malloc(bytes.length);
  try {
    wasm.HEAPU8.set(bytes, ptr); wasm._wide_deserialize(table, ptr); return table;
  } catch (error) { destroy(table); throw error; }
  finally { wasm._free(ptr); }
}
export function decode(remote, local, width) {
  const success = Boolean(wasm._wide_decode(remote, local));
  const count = wasm._wide_result_count(remote), keys = wasm._wide_result_keys(remote), sides = wasm._wide_result_sides(remote);
  const view = new DataView(wasm.HEAPU8.buffer), onlyRemote = [], onlyLocal = [];
  for (let i = 0; i < count; ++i) {
    const key = wasm.HEAPU8.slice(keys + i * width, keys + (i + 1) * width);
    (view.getInt32(sides + i * 4, true) === 1 ? onlyRemote : onlyLocal).push(key);
  }
  return { success, onlyRemote, onlyLocal };
}
