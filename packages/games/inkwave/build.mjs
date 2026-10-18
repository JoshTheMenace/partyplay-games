import { build } from 'esbuild';
import { resolve } from 'node:path';

// Keep bundled entries two directories below the asset root, like the original engine modules.
await build({ entryPoints: ['platform', 'menus', 'sound'].map(name => resolve(import.meta.dirname, `public/${name}.js`)), outdir: resolve(process.argv[2], 'engine/built'), bundle: true, splitting: true, format: 'esm', minify: true, external: ['three', 'three/*'], target: 'es2022', logLevel: 'warning' });
