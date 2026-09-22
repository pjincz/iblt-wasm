#!/usr/bin/env python3
"""Build a wasm32 module from pinned upstream sources; no global SDK activation."""
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
SDK = Path(os.environ.get('EMSDK', '/tmp/iblt-emsdk'))
EMCC = SDK / 'upstream/emscripten/emcc'
EMXX = SDK / 'upstream/emscripten/em++'
BUILD = ROOT / 'build'
BUILD.mkdir(exist_ok=True)
if not EMCC.exists():
    raise SystemExit('Missing Emscripten. Set EMSDK to an installed SDK; see README.')

iblt = BUILD / 'iblt'
iblt.mkdir(exist_ok=True)
for name in ['iblt.cpp', 'iblt.h', 'murmurhash3.cpp', 'murmurhash3.h']:
    shutil.copyfile(ROOT / 'vendor/iblt' / name, iblt / name)
header = iblt / 'iblt.h'
s = header.read_text()
assert s.count('private:') == 1
header.write_text(s.replace('private:', 'private:\n    friend struct IBLTBenchAccess;'))

flags = ['-O3', '-DNDEBUG', '-I' + str(ROOT / 'compat'), '-I' + str(ROOT / 'vendor/gnunet')]
objects = []
for name in ['ibf', 'crypto_crc']:
    out = BUILD / (name + '.o')
    subprocess.run([str(EMCC), *flags, '-std=c11', '-c', str(ROOT / 'vendor/gnunet' / (name + '.c')), '-o', str(out)], check=True)
    objects.append(str(out))

mini = ROOT / 'vendor/minisketch'
exports = ['malloc', 'free', 'bench_create', 'bench_destroy', 'bench_update', 'bench_clone',
           'bench_wire_size', 'bench_serialize', 'bench_deserialize', 'bench_decode',
           'bench_result_count', 'bench_result_keys', 'bench_result_sides']
command = [str(EMXX), *flags, '-std=c++17', '-DDISABLE_DEFAULT_FIELDS', '-DENABLE_FIELD_64', '-DHAVE_CLZ',
           '-I' + str(iblt), '-I' + str(mini / 'include'), str(ROOT / 'wrapper.cpp'),
           str(iblt / 'iblt.cpp'), str(iblt / 'murmurhash3.cpp'),
           str(mini / 'src/minisketch.cpp'), *map(str, sorted((mini / 'src/fields').glob('generic_*.cpp'))),
           *objects, '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node,web,worker',
           '-sALLOW_MEMORY_GROWTH=1', '-sWASM_BIGINT=1', '-sASSERTIONS=1',
           '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
           '-sEXPORTED_FUNCTIONS=' + json.dumps(['_' + s for s in exports]),
           '-o', str(BUILD / 'libraries.mjs')]
print('Building WASM: GNUnet IBF, IBLT_Cplusplus, minisketch (generic 64-bit).', flush=True)
subprocess.run(command, check=True)
version = subprocess.check_output([str(EMCC), '--version'], text=True).splitlines()[0]
(BUILD / 'build-info.json').write_text(json.dumps({'compiler': version, 'command': command}, indent=2) + '\n')
