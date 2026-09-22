import { readFile, mkdir, writeFile } from 'node:fs/promises';
const header = await readFile(new URL('./baseline.h', import.meta.url), 'utf8');
const original = 'for (unsigned i=0;i<4;++i) positions[i] = i*(count_/4) + hash32(key,keyBytes_,i) % (count_/4);';
if (!header.includes(original)) throw new Error('Baseline index implementation changed; review experiment');
const replacement = `const auto h = hash128(key,keyBytes_,0);
        const std::array<uint32_t,4> words{uint32_t(h[0]),uint32_t(h[0] >> 32),uint32_t(h[1]),uint32_t(h[1] >> 32)};
        for (unsigned i=0;i<4;++i) positions[i] = i*(count_/4) + words[i] % (count_/4);`;
await mkdir(new URL('../../build/hash-indexes/', import.meta.url), { recursive: true });
await writeFile(new URL('../../build/hash-indexes/dynamic-iblt.h', import.meta.url), header.replace(original, replacement));
