import { resolve } from 'node:path';
import { defineConfig } from 'vite';
// Standalone Pose Lab: `npx vite --config packages/games/sky-clash/tools/pose-lab/vite.config.ts` from the repo root.
export default defineConfig({ root: import.meta.dirname, server: { port: 5191, strictPort: true, host: '127.0.0.1', fs: { allow: [resolve(import.meta.dirname, '../../../../../..')] } }, logLevel: 'warn' });
