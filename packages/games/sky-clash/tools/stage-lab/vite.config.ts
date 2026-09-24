import { resolve } from 'node:path';
import { defineConfig } from 'vite';
// Standalone QA page for stage art: `npx vite --config packages/games/sky-clash/tools/stage-lab/vite.config.ts` from the repo root.
const root = resolve(import.meta.dirname);
export default defineConfig({ root, publicDir: false, server: { port: 5192, strictPort: true, host: '127.0.0.1', fs: { allow: [resolve(root, '../../../../..'), resolve(root, '../../../../../..')] } } });
