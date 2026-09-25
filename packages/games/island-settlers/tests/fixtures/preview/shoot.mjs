// Headless screenshots of preview URLs. Usage (preview server running on 5390):
//   node shoot.mjs <out-dir> "<query>[@WxH]" ...    e.g. "view=display&fixture=max-10@1920x1080"
// Env: PLAYWRIGHT (package path if not resolvable from here), CHROME (browser binary), WAIT (ms per shot).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const [dir, ...shots] = process.argv.slice(2);
if (!dir || !shots.length) throw new Error('usage: node shoot.mjs <out-dir> "<query>[@WxH]" ...');
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = false;
for (const shot of shots) {
  const [query, size = '1280x720'] = shot.split('@'), [width, height] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5390}/?${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
  const file = resolve(dir, `${query.replace(/[^a-z0-9-]+/gi, '_')}_${size}.png`);
  await page.screenshot({ path: file });
  console.log(errors.length ? 'ERR' : 'ok ', file, errors.join(' | '));
  failed ||= errors.length > 0;
  await page.close();
}
await browser.close();
process.exitCode = failed ? 1 : 0;
