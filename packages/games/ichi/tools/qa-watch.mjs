// A second display for a room that is already running: joins by code, then screenshots each phase it sees (seating, bell, results) and one a minute.
//   node packages/games/ichi/tools/qa-watch.mjs --base http://127.0.0.1:4431 --code ABCDEF --out output/ichi-pass/run/tv1080 [--tv 1920x1080] [--minutes 20]
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
const { values: arg } = parseArgs({ options: { base: { type: 'string' }, code: { type: 'string' }, out: { type: 'string' }, tv: { type: 'string' }, minutes: { type: 'string' } } });
const [width, height] = (arg.tv ?? '1920x1080').split('x').map(Number), out = arg.out ?? 'output/ichi-pass/watch', until = Date.now() + Number(arg.minutes ?? 20) * 60000;
const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE ?? `${process.env.HOME}/.local/opt/pw/node_modules`}/playwright-core/index.mjs`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true }), page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(90000);
await page.goto(`${arg.base}/?join=${arg.code}&display`);
await page.getByRole('button', { name: 'Join as display' }).click();
const seen = {}; let last = 0;
const shot = async name => { seen[name] = (seen[name] ?? 0) + 1; if (seen[name] <= 3) await page.screenshot({ path: `${out}/${name}${seen[name] > 1 ? `-${seen[name]}` : ''}.png` }); };
while (Date.now() < until) {
  const s = await page.evaluate(() => { const d = document.querySelector('.ichi-display'); return { phase: document.querySelector('.kp-round-results') ? 'results' : d?.dataset.phase ?? 'none', bell: d?.dataset.bell === 'true', cut: !!d?.querySelector('.ichi-cut'), race: !!d?.querySelector('.ichi-spot'), tally: !!d?.querySelector('.ichi-tally') }; }).catch(() => ({ phase: 'none' }));
  if (s.phase === 'seating') { await page.waitForTimeout(1800); await shot('seating'); await page.waitForTimeout(2500); }
  else if (s.phase === 'complete') { await page.waitForTimeout(2600); await shot('finale'); }
  else if (s.phase === 'results') { await page.waitForTimeout(1500); await shot('results'); break; }
  else if (s.race) await shot('race');
  else if (s.bell) { await shot('bell'); await page.waitForTimeout(3000); }
  else if (s.tally) { await page.waitForTimeout(2400); await shot('tally'); }
  else if (s.phase === 'playing' && Date.now() - last > 60000 && !s.cut) { last = Date.now(); await shot('playing'); }
  await page.waitForTimeout(250);
}
console.log(JSON.stringify(seen));
await browser.close();
