import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const tests = [];
for (const name of ['iblt', 'padding', 'checksum']) {
  const source = await readFile(new URL(`../../test/${name}.test.mjs`, import.meta.url), 'utf8');
  const destination = new URL(`../../build/hash-indexes/${name}.check.mjs`, import.meta.url);
  await writeFile(destination, source.replace("'iblt-wasm'", "'./index.mjs'").replaceAll("_iblt_", "_dynamic_"));
  tests.push(fileURLToPath(destination));
}
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
