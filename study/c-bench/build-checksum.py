#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
out = root / 'build/checksum'
out.mkdir(parents=True, exist_ok=True)
compiler = Path(os.environ.get('EMSDK', '/tmp/iblt-emsdk')) / 'upstream/emscripten/em++'
names = ['malloc', 'free', 'checked_create', 'checked_destroy', 'checked_clone', 'checked_update',
         'checked_cell_bytes', 'checked_wire_size', 'checked_serialize', 'checked_deserialize', 'checked_decode',
         'checked_result_count', 'checked_result_keys', 'checked_result_sides', 'checked_hash96']
command = [str(compiler), '-O3', '-DNDEBUG', '-std=c++17', str(root / 'checksum-wrapper.cpp'),
           '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node,web,worker', '-sALLOW_MEMORY_GROWTH=1',
           '-sWASM_BIGINT=1', '-sASSERTIONS=1', '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
           '-sEXPORTED_FUNCTIONS=' + json.dumps(['_' + name for name in names]), '-o', str(out / 'iblt-checksum.mjs')]
subprocess.run(command, check=True)
(out / 'build-info.json').write_text(json.dumps({
    'compiler': subprocess.check_output([str(compiler), '--version'], text=True).splitlines()[0],
    'command': command,
    'checksums': {'32': 'MurmurHash3_x86_32 seed 11', '96': 'first 96 LE output bits of MurmurHash3_x64_128 seed 11'}
}, indent=2) + '\n')
