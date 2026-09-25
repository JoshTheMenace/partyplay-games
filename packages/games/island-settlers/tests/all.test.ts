/**
 * Single entry for the root `npm test`, whose glob only reaches top-level files (tests/NAME.test.ts).
 * It loads every suite in the tests subfolders.
 * The board matrix runs 50 seeds per map here; BOARD_SEEDS=500 runs the full acceptance sweep.
 * Focused runs still target one folder, e.g. `node --import tsx --test <game>/tests/ui/*.test.ts`.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.BOARD_SEEDS ??= '50';
const root = fileURLToPath(new URL('..', import.meta.url));
const suites = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? suites(join(dir, e.name)) : e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []);
const nested = readdirSync(join(root, 'tests'), { withFileTypes: true }).filter(e => e.isDirectory())
  .flatMap(e => suites(join(root, 'tests', e.name)));
for (const file of [...nested, ...suites(join(root, 'src'))].sort()) await import(pathToFileURL(file).href);
