#!/usr/bin/env python3
"""Mechanically widen upstream IBLT keys; preserve its hash/peeling algorithms."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
SDK = Path(os.environ.get('EMSDK', '/tmp/iblt-emsdk'))
EMXX = SDK / 'upstream/emscripten/em++'
OUT = ROOT / 'build/wide'
OUT.mkdir(parents=True, exist_ok=True)
UPSTREAM = ROOT / 'vendor/iblt'
header = (UPSTREAM / 'iblt.h').read_text()
source = (UPSTREAM / 'iblt.cpp').read_text()
assert header.count('private:') == 1
header = header.replace('private:', 'private:\n    friend struct IBLTBenchAccess;')
(OUT / 'iblt.h').write_text(header)
(OUT / 'iblt.cpp').write_text(source)
for name in ['murmurhash3.cpp', 'murmurhash3.h']:
    shutil.copyfile(UPSTREAM / name, OUT / name)

for bits in [128, 160]:
    wide_header = re.sub(r'\bIBLT\b', f'IBLT{bits}', header)
    wide_header = wide_header.replace('IBLT_H', f'IBLT_{bits}_H').replace('uint64_t', f'Key{bits}')
    wide_header = '#include "wide-key.h"\n' + wide_header
    (OUT / f'iblt{bits}.h').write_text(wide_header)
    wide_source = re.sub(r'\bIBLT\b', f'IBLT{bits}', source)
    wide_source = wide_source.replace('"iblt.h"', f'"iblt{bits}.h"').replace('uint64_t', f'Key{bits}')
    start = wide_source.index('template<typename T>')
    end = wide_source.index('\n\nbool ', start)
    wide_source = wide_source[:start] + f'''std::vector<uint8_t> ToVec(Key{bits} key)
{{
    return std::vector<uint8_t>(key.bytes.begin(), key.bytes.end());
}}
''' + wide_source[end:]
    (OUT / f'iblt{bits}.cpp').write_text(wide_source)

exports = ['malloc', 'free', 'wide_create', 'wide_destroy', 'wide_clone', 'wide_update',
           'wide_wire_size', 'wide_serialize', 'wide_deserialize', 'wide_decode',
           'wide_result_count', 'wide_result_keys', 'wide_result_sides']
command = [str(EMXX), '-O3', '-DNDEBUG', '-std=c++17', '-I' + str(ROOT), '-I' + str(OUT),
           str(ROOT / 'wide-wrapper.cpp'), *[str(OUT / s) for s in ['iblt.cpp', 'iblt128.cpp', 'iblt160.cpp', 'murmurhash3.cpp']],
           '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=node,web,worker',
           '-sALLOW_MEMORY_GROWTH=1', '-sWASM_BIGINT=1', '-sASSERTIONS=1',
           '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
           '-sEXPORTED_FUNCTIONS=' + json.dumps(['_' + name for name in exports]),
           '-o', str(OUT / 'iblt-wide.mjs')]
print('Building original 64-bit and widened 128/160-bit IBLT_Cplusplus.', flush=True)
subprocess.run(command, check=True)
(OUT / 'build-info.json').write_text(json.dumps({
    'compiler': subprocess.check_output([str(EMXX), '--version'], text=True).splitlines()[0],
    'command': command,
    'adaptation': 'key/keySum widened; full-byte ToVec; friend for serialization; unchanged 4 hashes and 32-bit checksum'
}, indent=2) + '\n')
