import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const walk = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
});
/** Every static, dynamic, side-effect and `new URL(…, import.meta.url)` specifier in a source file. */
const specifiersIn = (source: string) => {
  const found: string[] = [];
  for (const pattern of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
};
const specifiers = (file: string) => specifiersIn(readFileSync(file, 'utf8'));
const target = (file: string, spec: string) => spec.startsWith('.') ? relative(root, resolve(dirname(file), spec)).replace(/\\/g, '/') : null;
const serverOnly = (path: string | null) => path !== null && (path === 'server' || path === 'server.ts' || path === 'sim' || path.startsWith('sim/') || path === 'content' || path === 'content.ts');

test('browser code never imports server-only modules (src/sim, src/server.ts)', () => {
  const files = [...walk(join(root, 'client')), ...walk(join(root, 'shared')), join(root, 'client.tsx')].filter(existsSync);
  assert(files.length > 3);
  for (const file of files) for (const spec of specifiers(file)) {
    assert(!serverOnly(target(file, spec)), `${relative(root, file)} imports server-only ${spec}`);
  }
});

test('src/shared stays renderer- and framework-free', () => {
  for (const file of walk(join(root, 'shared'))) for (const spec of specifiers(file)) {
    assert(!/^(three|react|react-dom)(\/|$)/.test(spec), `${relative(root, file)} imports ${spec}`);
    const path = target(file, spec);
    assert(path === null || path.startsWith('shared/'), `${relative(root, file)} reaches outside src/shared: ${spec}`);
  }
});

test('the import scanner sees every import form', () => {
  const file = join(root, 'client', 'probe.ts');
  const sample = `import a from '../sim/x'; import('../server'); import '../sim'; new Worker(new URL('../sim/w.ts', import.meta.url));`;
  const specs = specifiersIn(sample);
  assert.equal(specs.length, 4);
  assert(specs.every(spec => serverOnly(target(file, spec))));
});
