/** Standalone preview of the Island Settlers client views on fixtures. See README.md. */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = realpathSync(dirname(fileURLToPath(import.meta.url)));
/** Real path: <platform>/game-modules/packages/games/island-settlers/tests/fixtures/preview. */
const games = resolve(here, '../../../../../..'), platform = resolve(games, '..');
const fonts = existsSync(resolve(platform, 'public/fonts'));

export default defineConfig({
  root: here,
  // Fonts (/fonts) and game assets (/games/island-settlers) resolve exactly as in the platform build.
  publicDir: fonts ? resolve(platform, 'public') : resolve(games, 'public'),
  server: { host: '127.0.0.1', port: 5390, strictPort: true, fs: { allow: [fonts ? platform : games] } },
  plugins: [{
    name: 'server-secrets-stay-server-side',
    moduleParsed(info) {
      if (/packages\/games\/[^/]+\/src\/(?:server|content(?:\.server)?)\.tsx?$/.test(info.id)) {
        throw new Error('Server-only game module entered the browser graph: ' + info.id);
      }
    },
  }],
});
