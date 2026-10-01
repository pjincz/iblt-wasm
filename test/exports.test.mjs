import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Node and browser conditions resolve to their respective builds', () => {
  const root = new URL('../', import.meta.url);
  for (const [conditions, entry] of [[[], 'dist/index.mjs'], [['--conditions=browser'], 'dist/browser/index.mjs']]) {
    const result = spawnSync(process.execPath, [...conditions,
      fileURLToPath(new URL('fixtures/resolve-package.mjs', root)), new URL(entry, root).href], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(readFileSync(new URL('dist/browser/index.mjs', root)), readFileSync(new URL('src/index.mjs', root)));
  const browser = readFileSync(new URL('dist/browser/iblt.mjs', root), 'utf8');
  assert.doesNotMatch(browser, /\b(?:import|require)\s*\(\s*['"](?:node:)?(?:module|fs|path)['"]/);
});
