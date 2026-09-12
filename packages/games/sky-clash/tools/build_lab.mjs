import { build } from 'vite';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const game = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = resolve(game, '../../../..'), run = process.argv[2];
if (!run || !/^[a-z0-9-]+$/.test(run)) throw new Error('Supply a unique lowercase run name');
const out = resolve(platform, 'output/builds', run);
await mkdir(dirname(out), { recursive: true });
await mkdir(out); // Refuse to mutate an existing build, including a live preview.
await build({ configFile: false, root: resolve(game, 'lab'), publicDir: false, build: { outDir: resolve(out, 'client'), emptyOutDir: false } });
await cp(resolve(platform, 'public/fonts'), resolve(out, 'client/fonts'), { recursive: true });
const indexSha256 = createHash('sha256').update(await readFile(resolve(out, 'client/index.html'))).digest('hex');
await writeFile(resolve(out, 'build.json'), JSON.stringify({ kind: 'melee-reference-lab', builtAt: new Date().toISOString(), indexSha256, playableCombat: false }, null, 2)+'\n');
console.log(`Reference viewer built at ${out}/client`);
