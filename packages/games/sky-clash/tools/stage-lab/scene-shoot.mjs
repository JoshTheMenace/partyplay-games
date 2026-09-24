// Screenshots the SceneView harness (scene.html) at moments of its scripted 6 s loop, with headless Chromium.
// From the repo root: node packages/games/sky-clash/tools/stage-lab/scene-shoot.mjs <stage,...> [ms after ready,...] [extra query]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const out = resolve(process.env.OUT ?? 'output/sky-clash-v2/stages/scene'), [stages = 'battlefield', times = '600,1900,2600,4200', extra = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.error('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('Sky Clash')) console.error('console', m.text().slice(0, 300)); });
  for (const stage of stages.split(',')) {
    await page.goto(`http://127.0.0.1:5192/scene.html?stage=${stage}&${extra}`);
    const t0 = Date.now();
    await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 90000 });
    const error = await page.evaluate(() => document.body.dataset.error); if (error) { console.error(stage, error); continue; }
    for (const ms of times.split(',').map(Number)) {
      await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
      const file = resolve(out, `${stage}-${ms}.png`); await page.screenshot({ path: file });
      const m = JSON.parse(await page.evaluate(() => document.querySelector('canvas')?.dataset.sceneMetrics ?? '{}'));
      console.log(file.replace(process.cwd() + '/', ''), `calls=${m.calls} tris=${m.triangles} p95=${m.p95Ms?.toFixed?.(1)}`);
    }
  }
} finally { await browser.close(); }
