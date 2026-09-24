import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
/** Fixture-only UI lab for Sky Clash screens. Never part of a game or collection build. */
const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), publicDir: repo + 'public', server: { fs: { allow: [repo] } }, esbuild: { jsx: 'automatic' } });
