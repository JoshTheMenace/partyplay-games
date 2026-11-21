// Dev-only render sandbox (not part of the platform build):
//   npx vite --config packages/games/blockwild/dev/vite.config.mjs --host 127.0.0.1 --port 4418 --strictPort
// then open http://127.0.0.1:4418/games/blockwild/?scene=pasture&time=6000
// The simulation normally runs only on the server; here it runs in the page, so node:zlib (saves) is stubbed out.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
const here = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
export default defineConfig({
  root: here, publicDir: realpathSync(fileURLToPath(new URL('../../../../public', import.meta.url))), base: '/', server: { fs: { strict: false } },
  resolve: { alias: { 'node:zlib': `${here}/zlib-stub.ts` } },
});
