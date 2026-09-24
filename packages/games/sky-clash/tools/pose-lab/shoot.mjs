// Contact sheets from the running Pose Lab (port 5191):
//   PARTY_PLAYWRIGHT=<path to playwright/index.mjs> node shoot.mjs <out-dir> name='kind=mario&sheet=states' ...
// Uses the `playwright` package when resolvable, else PARTY_PLAYWRIGHT; PARTY_CHROMIUM overrides the browser binary. Headless Chromium only; closes its own browser.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PARTY_PLAYWRIGHT ?? 'playwright');
const [out, ...shots] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PARTY_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  for (const shot of shots) {
    const [name, query] = shot.split(/=(.*)/s);
    await page.goto(`http://127.0.0.1:5191/?${query}`);
    const state = await page.waitForFunction(() => window.__poseLab, null, { timeout: 120000 }).then(h => h.jsonValue());
    if (state !== 'ready') { console.error(name, state); continue; }
    await page.waitForTimeout(q(query).has('live') ? 1500 : 100);
    await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
    console.log('saved', name);
  }
} finally { await browser.close(); }
function q(s) { return new URLSearchParams(s); }
