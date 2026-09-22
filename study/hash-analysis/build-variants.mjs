// Diagnostic builds only; production sources and output are unchanged.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url);
const sdk=process.env.EMSDK ?? '/tmp/iblt-emsdk';
const names=['malloc','free','dynamic_create','dynamic_destroy','dynamic_clone','dynamic_update','dynamic_wire_size','dynamic_serialize','dynamic_deserialize','dynamic_decode','dynamic_result_count','dynamic_result_keys','dynamic_result_sides'];
for(const variant of ['base','split','split-inline']) {
 const dir=new URL(`build/hash-analysis/prod-${variant}/`,root);await mkdir(dir,{recursive:true});
 let header=await readFile(new URL(variant==='base'?'study/hash-indexes/baseline.h':'build/hash-indexes/dynamic-iblt.h',root),'utf8');
 if(variant==='split-inline')header=header.replace('inline std::array<uint64_t, 2> hash128','inline __attribute__((always_inline)) std::array<uint64_t, 2> hash128');
 await writeFile(new URL('dynamic-iblt.h',dir),header);
 await copyFile(new URL('study/hash-indexes/baseline-wrapper.cpp',root),new URL('dynamic-wrapper.cpp',dir));
 await copyFile(new URL('study/hash-indexes/baseline-bridge.mjs',root),new URL('index.mjs',dir));
 const args=['-O3','-DNDEBUG','-std=c++17',fileURLToPath(new URL('dynamic-wrapper.cpp',dir)),'-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=node,web,worker','-sALLOW_MEMORY_GROWTH=1','-sWASM_BIGINT=1','-sASSERTIONS=1','-sEXPORTED_RUNTIME_METHODS=HEAPU8',`-sEXPORTED_FUNCTIONS=${names.map(n=>'_'+n).join(',')}`,'--profiling-funcs','-o',fileURLToPath(new URL('iblt-dynamic.mjs',dir))];
 const result=spawnSync(`${sdk}/upstream/emscripten/em++`,args,{stdio:'inherit'});if(result.status!==0)throw new Error('Build failed');
 const dis=spawnSync(`${sdk}/upstream/bin/wasm-dis`,[fileURLToPath(new URL('iblt-dynamic.wasm',dir)),'-o',fileURLToPath(new URL('module.wat',dir))],{stdio:'inherit'});if(dis.status!==0)throw new Error('Disassembly failed');
 await writeFile(new URL('build-command.json',dir),JSON.stringify(args,null,2));
}
