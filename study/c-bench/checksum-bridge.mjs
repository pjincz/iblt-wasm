import createModule from './build/checksum/iblt-checksum.mjs';

export const wasm = await createModule();
export function input(keys, width = 16) {
  if (width !== 16) throw new Error('Keys must be 128 bits');
  if (keys.some(k => k.byteLength !== width)) throw new Error('Wrong key width');
  const ptr = wasm._malloc(Math.max(1, keys.length * width));
  keys.forEach((key, i) => wasm.HEAPU8.set(key, ptr + i * width));
  return { ptr, length: keys.length, free() { wasm._free(ptr); } };
}
export const create = (bits, cells) => {
  if (![32, 96].includes(bits) || !Number.isSafeInteger(cells) || cells < 4 || cells % 4 || cells > 0x7fffffff / 32) throw new Error('Invalid table configuration');
  return wasm._checked_create(bits, cells);
};
export const destroy = t => wasm._checked_destroy(t);
export const clone = t => wasm._checked_clone(t);
export const update = (t, keys, remove = false) => {
  if (!wasm._checked_update(t, keys.ptr, keys.length, Number(remove))) throw new Error('Counter overflow (earlier keys in this batch may have been applied)');
};
export function serialize(table) {
  const length = wasm._checked_wire_size(table), ptr = wasm._malloc(length);
  try { wasm._checked_serialize(table, ptr); return wasm.HEAPU8.slice(ptr, ptr + length); }
  finally { wasm._free(ptr); }
}
export function deserialize(bits, cells, bytes) {
  if (bytes.length !== cells * (20 + bits / 8)) throw new Error('Wrong payload size');
  const table = create(bits, cells), ptr = wasm._malloc(bytes.length);
  try {
    wasm.HEAPU8.set(bytes, ptr); wasm._checked_deserialize(table, ptr); return table;
  } catch (error) { destroy(table); throw error; }
  finally { wasm._free(ptr); }
}
export function decode(remote, local, width = 16) {
  const success = Boolean(wasm._checked_decode(remote, local));
  const count = wasm._checked_result_count(remote), keys = wasm._checked_result_keys(remote), sides = wasm._checked_result_sides(remote);
  const view = new DataView(wasm.HEAPU8.buffer), onlyRemote = [], onlyLocal = [];
  for (let i = 0; i < count; ++i) {
    const key = wasm.HEAPU8.slice(keys + i * width, keys + (i + 1) * width);
    (view.getInt32(sides + i * 4, true) === 1 ? onlyRemote : onlyLocal).push(key);
  }
  return { success, onlyRemote, onlyLocal };
}
