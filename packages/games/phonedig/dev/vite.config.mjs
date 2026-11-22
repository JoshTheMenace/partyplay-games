// Dev-only sandbox (not part of the platform build): the real rules, playing bots and every client view in one page, no room server.
//   npx vite --config packages/games/phonedig/dev/vite.config.mjs --host 127.0.0.1 --port 4411
// then open http://127.0.0.1:4411/?players=32&role=display   (see sandbox.tsx for the parameters)
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
const here = realpathSync(fileURLToPath(new URL('.', import.meta.url))), path = relative => fileURLToPath(new URL(relative, import.meta.url));
// Inside the platform checkout its public folder also carries the shell fonts; the games repository alone has the game assets.
const assets = existsSync(path('../../../../../public/fonts')) ? path('../../../../../public') : path('../../../../public');
export default defineConfig({ root: here, publicDir: assets, server: { fs: { strict: false } } });
