// Headless screenshots of any lab page. From the PartyPlay root, with the lab server running (tools/lab.vite.config.ts):
//   node packages/games/sky-clash/tools/lab-shoot.mjs <out-dir> 'name|/path?query|1280x720[|ready|600,1900][|m]' ...
// Field 4 is `ready` (wait for body[data-ready], WebGL pages) or milliseconds; field 5 lists capture times after that (one file each);
// `m` emulates a touch phone. BASE (default http://127.0.0.1:4430), PLAYWRIGHT (module path) and SCALE (device pixel ratio) are env overrides.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
const [outDir, ...specs] = process.argv.slice(2), base = process.env.BASE ?? 'http://127.0.0.1:4430';
const { chromium } = await import(process.env.PLAYWRIGHT ?? `${homedir()}/.local/opt/pw/node_modules/playwright-core/index.mjs`);
const out = resolve(outDir); mkdirSync(out, { recursive: true });
const gl = specs.some(s => s.split('|')[3] === 'ready');
const browser = await chromium.launch({ args: gl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-gpu'] });
let failed = false;
try {
  for (const spec of specs) {
    const [name, path, size = '1280x720', wait = '700', times = '0', mobile] = spec.split('|'), [width, height] = size.split('x').map(Number);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(process.env.SCALE ?? 1), isMobile: !!mobile, hasTouch: !!mobile });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(240000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 600)); });
    page.on('requestfailed', r => errors.push('request failed: ' + r.url().slice(-80)));
    await page.goto(base + path);
    if (wait === 'ready') await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: Number(process.env.WAIT ?? 240000) }).catch(e => errors.push('not ready: ' + e.message.split('\n')[0]));
    else await page.waitForTimeout(Number(wait));
    const error = await page.evaluate(() => document.body.dataset.error); if (error) errors.push(error);
    const t0 = Date.now(), list = times.split(',').map(Number);
    for (const ms of list) {
      await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
      const file = resolve(out, `${name}${list.length > 1 ? '-' + ms : ''}.png`);
      await page.screenshot({ path: file, omitBackground: !!process.env.ALPHA });
      const metrics = await page.evaluate(() => document.querySelector('canvas')?.dataset.sceneMetrics ?? '');
      console.log(file.replace(process.cwd() + '/', ''), metrics && (m => `calls=${m.calls} tris=${m.triangles}`)(JSON.parse(metrics)));
    }
    if (errors.length) { failed = true; console.error(name, 'errors:', [...new Set(errors)].slice(0, 6)); }
    await context.close();
  }
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
