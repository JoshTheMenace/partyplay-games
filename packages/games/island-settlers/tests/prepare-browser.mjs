import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const output = 'output/playwright/island-settlers';
mkdirSync(output, { recursive: true });
const result = await build({ entryPoints: [process.argv[2] === 'expansions' ? 'packages/games/island-settlers/tests/browser-expansions.js' : 'packages/games/island-settlers/tests/browser-flow.js'], bundle: true, format: 'iife', globalName: 'SettlersQA', write: false });
writeFileSync(`${output}/flow.js`, `async (page) => {\n${result.outputFiles[0].text}\nreturn await SettlersQA.default(page);\n}`);
console.log(`Prepared ${output}/flow.js for a named Playwright CLI session. Add Island Settlers to that browser library before the first run.`);
