// Dev-only: the sandbox config without HMR, so screenshots aren't interrupted by other agents' edits.
//   npx vite --config packages/games/kart-party/dev/actors-harness.vite.mjs --port 5206 --strictPort
import base from './vite.config.mjs';
export default { ...base, server: { ...base.server, hmr: false } };
