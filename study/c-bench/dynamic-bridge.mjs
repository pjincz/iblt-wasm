import createModule from './build/dynamic/iblt-dynamic.mjs';
export const wasm = await createModule();
const configs = new Map();
function config(t) { const c=configs.get(t);if(!c) throw new Error('Unknown/destroyed table');return c; }
function aligned(n) { return Number.isSafeInteger(n) && n>=4 && n%4===0; }
export function create(keyBytes,checkBytes,cells=512) {
  if(!aligned(keyBytes)||!aligned(checkBytes)||checkBytes>16||!aligned(cells)||cells*(4+keyBytes+checkBytes)>0x7fffffff) throw new Error('Invalid configuration');
  const t=wasm._dynamic_create(cells,keyBytes,checkBytes);
  if(!t) throw new Error('Creation failed');
  configs.set(t,{keyBytes,checkBytes,cells});return t;
}
export function destroy(t) { config(t);wasm._dynamic_destroy(t);configs.delete(t); }
export function clone(t) { const c=config(t),copy=wasm._dynamic_clone(t);configs.set(copy,c);return copy; }
export function input(keys,keyBytes) {
  if(!aligned(keyBytes)||keys.some(k=>!(k instanceof Uint8Array)||k.byteLength!==keyBytes)||keys.length*keyBytes>0x7fffffff) throw new Error('Invalid key input');
  const ptr=wasm._malloc(Math.max(1,keys.length*keyBytes));
  keys.forEach((key,i)=>wasm.HEAPU8.set(key,ptr+i*keyBytes));
  const batch={ptr,length:keys.length,keyBytes,freed:false,free(){if(!this.freed){wasm._free(ptr);this.freed=true;}}};return batch;
}
export function update(t,keys,remove=false) {
  if(config(t).keyBytes!==keys.keyBytes||keys.freed) throw new Error('Invalid batch');
  if(!wasm._dynamic_update(t,keys.ptr,keys.length,Number(remove))) throw new Error('Counter overflow; preceding keys may have been applied');
}
export function serialize(t) {
  config(t);const length=wasm._dynamic_wire_size(t),ptr=wasm._malloc(length);
  try {wasm._dynamic_serialize(t,ptr);return wasm.HEAPU8.slice(ptr,ptr+length);}finally{wasm._free(ptr);}
}
export function deserialize(keyBytes,checkBytes,cells,bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length!==cells*(4+keyBytes+checkBytes)) throw new Error('Wrong payload size');
  const t=create(keyBytes,checkBytes,cells),ptr=wasm._malloc(bytes.length);
  try{wasm.HEAPU8.set(bytes,ptr);wasm._dynamic_deserialize(t,ptr);return t;}catch(e){destroy(t);throw e;}finally{wasm._free(ptr);}
}
export function decode(a,b) {
  const ca=config(a),cb=config(b);
  if(ca.keyBytes!==cb.keyBytes||ca.checkBytes!==cb.checkBytes||ca.cells!==cb.cells) throw new Error('Incompatible tables');
  const success=Boolean(wasm._dynamic_decode(a,b));
  const count=wasm._dynamic_result_count(a),keys=wasm._dynamic_result_keys(a),sides=wasm._dynamic_result_sides(a);
  const view=new DataView(wasm.HEAPU8.buffer),onlyRemote=[],onlyLocal=[];
  for(let i=0;i<count;i++) {
    const key=wasm.HEAPU8.slice(keys+i*ca.keyBytes,keys+(i+1)*ca.keyBytes);
    (view.getInt32(sides+i*4,true)===1?onlyRemote:onlyLocal).push(key);
  }
  return {success,onlyRemote,onlyLocal};
}
