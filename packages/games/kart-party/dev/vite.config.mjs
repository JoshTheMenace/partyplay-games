// Dev-only render sandbox (not part of the platform build):
//   npx vite --config packages/games/kart-party/dev/vite.config.mjs --port 5190
// then open http://localhost:5190/?track=palm-bay&players=1&view=split&cpus=7
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
const here = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
export default defineConfig({ root: here, publicDir: realpathSync(fileURLToPath(new URL('../public', import.meta.url))), base: '/games/kart-party/', server: { fs: { strict: false } } });
