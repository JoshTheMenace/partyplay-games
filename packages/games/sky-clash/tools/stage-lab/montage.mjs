// Tiles screenshots into one labeled contact sheet for review: node montage.mjs out.png cols a.png b.png ...
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const [out, cols, ...files] = process.argv.slice(2), n = Number(cols) || 3, w = 640, h = 360;
const images = files.map(f => ({ name: basename(f, '.png'), src: `data:image/png;base64,${readFileSync(f).toString('base64')}` }));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: n * w, height: Math.ceil(images.length / n) * h } });
  await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${n},${w}px);background:#000">${images.map(i => `<div style="position:relative;width:${w}px;height:${h}px"><img src="${i.src}" style="width:100%;height:100%"><b style="position:absolute;left:6px;top:4px;font:bold 18px sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000">${i.name}</b></div>`).join('')}</body>`);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));
  await page.screenshot({ path: resolve(out) });
} finally { await browser.close(); }
