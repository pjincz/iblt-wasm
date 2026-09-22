#!/usr/bin/env python3
"""Fetch pinned sources without installing system packages or running upstream scripts."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent
sources = json.loads((ROOT / 'sources.json').read_text())

def download(url):
    print('Downloading', url, flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()

def unpack(data, dest, selected=None):
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            if not member.isfile():
                continue
            path = Path(*Path(member.name).parts[1:])
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe archive path')
            if selected is not None:
                if str(path) not in selected:
                    continue
                path = Path(path.name)
            target = dest / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())

for name, repo, required in [('iblt', 'gavinandresen/IBLT_Cplusplus', 'iblt.cpp'),
                             ('minisketch', 'bitcoin-core/minisketch', 'src/minisketch.cpp'),
                             ('smhasher', 'aappleby/smhasher', 'src/MurmurHash3.cpp')]:
    dest = ROOT / 'vendor' / name
    if (dest / required).exists():
        print('Already present:', dest)
        continue
    unpack(download(f'https://codeload.github.com/{repo}/tar.gz/{sources[name]}'), dest)

dest = ROOT / 'vendor/gnunet'
if not (dest / 'ibf.c').exists():
    data = download(sources['gnunet']['url'])
    assert hashlib.sha256(data).hexdigest() == sources['gnunet']['sha256']
    unpack(data, dest, {'COPYING', 'src/service/setu/ibf.c', 'src/service/setu/ibf.h', 'src/lib/util/crypto_crc.c'})
else:
    print('Already present:', dest)
