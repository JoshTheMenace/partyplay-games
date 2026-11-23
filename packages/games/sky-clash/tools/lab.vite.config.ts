import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
/**
 * One dev server for every Sky Clash lab (fixtures only, never part of a game build). From the PartyPlay root:
 *   npx vite --config packages/games/sky-clash/tools/lab.vite.config.ts --port 4430 --strictPort
 * Pages: /pose-lab/, /stage-lab/scene.html, /stage-lab/, /ui-lab/?screen=<name>. The dep cache stays under output/ so labs never touch a shared one.
 */
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), publicDir: repo + 'public', cacheDir: repo + 'output/skyclash-pass/.vite',
  server: { host: '127.0.0.1', fs: { allow: [repo] } }, esbuild: { jsx: 'automatic' } });
