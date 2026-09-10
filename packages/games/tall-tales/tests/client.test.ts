import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { FACTS } from '../src/content.server';
test('the real browser dependency graph and emitted bundle exclude the server fact bank', async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/client.tsx', import.meta.url))], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' } });
  const inputs = Object.keys(result.metafile!.inputs);
  assert.ok(!inputs.some(path => /tall-tales\/src\/(server|content\.server)\.ts$/.test(path)), inputs.join('\n'));
  const javascript = result.outputFiles.map(file => file.text).join('\n');
  for (const fact of FACTS) { assert.ok(!javascript.includes(fact.prompt)); assert.ok(!javascript.includes(fact.sourceUrl)); }
});
