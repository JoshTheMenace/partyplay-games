// Screenshots stages through the running Stage Lab (port 5192) with headless Chromium.
// From the repo root: node packages/games/sky-clash/tools/stage-lab/shoot.mjs [stage,...|all] [variant,...]
// Variant "card" writes 640x360 WebP map cards to public/games/sky-clash/maps/<id>.webp (override with CARDS=dir).
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const out = resolve(process.env.OUT ?? 'output/sky-clash-v2/stages'), cards = resolve(process.env.CARDS ?? 'public/games/sky-clash/maps');
mkdirSync(out, { recursive: true });
const ALL = ['cloudbreak', 'peach-castle', 'rainbow-cruise', 'kongo-jungle', 'jungle-japes', 'great-bay', 'temple', 'brinstar', 'brinstar-depths', 'yoshi-story', 'yoshi-island', 'fountain', 'green-greens', 'corneria', 'venom', 'stadium', 'poke-floats', 'mute-city', 'big-blue', 'onett', 'fourside', 'icicle-mountain', 'mushroom-kingdom', 'mushroom-kingdom-ii', 'flat-zone', 'dream-land', 'yoshi-island-64', 'kongo-jungle-64', 'battlefield', 'final-destination'];
const stages = !process.argv[2] || process.argv[2] === 'all' ? ALL : process.argv[2].split(',');
const VARIANTS = { spawn: 'view=spawn', debug: 'view=ledge&debug=1', ledge: 'view=ledge', max: 'view=max&compact=1', wide: 'view=wide&debug=1', warn: 'view=spawn&hazard=warn', active: 'view=spawn&hazard=active&debug=1', low: 'view=spawn&quality=low', reduced: 'view=spawn&reduced=1', offscreen: 'view=offscreen&compact=1', card: 'view=card' };
const variants = (process.argv[3] ?? 'spawn,debug').split(',');
/** Software GL occasionally stalls one frame for a long time; one retry keeps a 30-stage batch going. */
const shot = (page, o) => page.screenshot({ timeout: 45000, ...o }).catch(() => page.screenshot({ timeout: 45000, ...o }));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const v of variants) {
    const [width, height] = v === 'card' ? [640, 360] : (process.env.SIZE ?? '1280x720').split('x').map(Number);
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', e => console.error('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error') console.error('console', m.text()); });
    for (const stage of stages) {
      await page.goto(`http://127.0.0.1:5192/?stage=${stage}&${VARIANTS[v] ?? v}`);
      await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 90000 });
      const error = await page.evaluate(() => document.body.dataset.error); if (error) console.error(stage, v, error);
      await page.waitForTimeout(1500);
      const m = JSON.parse(await page.evaluate(() => document.body.dataset.metrics ?? '{}'));
      if (v === 'card') {
        const png = await shot(page);
        const webp = await page.evaluate(async b64 => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/webp', .8).split(',')[1]; }, png.toString('base64'));
        mkdirSync(cards, { recursive: true }); const file = resolve(cards, `${stage}.webp`); writeFileSync(file, Buffer.from(webp, 'base64'));
        console.log(file.replace(process.cwd() + '/', ''), `${Math.round(webp.length * .75 / 1024)} KB`);
      } else {
        const file = resolve(out, `${stage}-${v}.png`); await shot(page, { path: file });
        console.log(file.replace(process.cwd() + '/', ''), `calls=${m.calls} tris=${m.triangles}`);
      }
    }
    await page.close();
  }
} finally { await browser.close(); }
