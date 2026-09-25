/**
 * M3 browser game (BUILD-PLAN §2): a watching host display (1920×1080) + 2 phones (390×844) joined by room
 * code + 2 Normal CPUs, Standard base, 10 VP, Relaxed. Join → setup → full game → finale → results
 * → Play again (fresh setup). Moves come from the CPU brain and go through the real phone UI (driver.mjs).
 *
 *   node --import tsx packages/games/island-settlers/tests/browser/m3.mjs <base url> <out dir> [solo]
 * PLAYWRIGHT (module path) and CHROME (executable) env vars pick the browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { observe, play, until } from './driver.mjs';

const [base = 'http://127.0.0.1:4393', out = 'output/settlers-v2/m3', mode = 'watch'] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const started = Date.now(), notes = [];
const log = s => {
  const line = `[${((Date.now() - started) / 1000).toFixed(0)}s] ${s}`;
  notes.push(line);
  console.log(line);
};
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });

const hostPage = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const host = observe(hostPage, 'host');
await hostPage.goto(`${base}/?game=island-settlers`);
await hostPage.getByRole('button', { name: 'Add to library' }).first().click();
await hostPage.getByRole('button', { name: 'Play on this screen' }).click();
const solo = mode === 'solo';
if (!solo) await hostPage.getByRole('button', { name: 'Watch only' }).click();
else {
  await hostPage.getByRole('button', { name: 'Settings', exact: true }).click();
  await hostPage.getByLabel('Seats').selectOption('3');
  await hostPage.getByRole('button', { name: 'Apply settings' }).click();
}
const code = (await hostPage.locator('.kp-code').first().textContent()).trim();
log(`room ${code}, ${solo ? 'host plays on this device' : 'host watches'}`);

const phones = solo ? [host] : [];
for (const name of solo ? [] : ['Ana Longname1234', 'Bo Navigator5678']) {
  const viewport = { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), data = observe(page, name);
  await page.goto(`${base}/?join=${code}`);
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: 'Join the room' }).click();
  await page.getByRole('button', { name: 'Ready to play' }).click();
  phones.push(data);
}
await shot(hostPage, 'a01-lobby');

async function start() {
  await until(() => hostPage.getByRole('button', { name: 'Start game' }).isEnabled(), 'start enabled');
  await hostPage.getByRole('button', { name: 'Start game' }).click();
  const inSetup = p => p.current?.publicView?.turn?.stage === 'setup';
  await until(() => [host, ...phones].every(inSetup), 'setup', 30000);
}
await start();
const round = host.current.roundId;
const names = host.current.publicView.seats.map(s => `${s.name}${s.cpu ? ' (CPU)' : ''}`);
log(`round ${round} started; seats ${names}`);
await hostPage.waitForTimeout(2500);
await shot(hostPage, 'a02-host-setup');
if (!solo) await shot(phones[0].page, 'a03-phone-setup');

const seen = new Set();
const moment = async (key, fn) => { if (!seen.has(key)) { seen.add(key); await fn(); } };
const stage = () => host.current?.publicView?.turn?.stage;
const stats = await play(phones, {
  log,
  stop: async () => {
    const pub = host.current?.publicView;
    if (pub?.offers?.length >= 1) await moment('offers', () => shot(hostPage, 'a06-host-offers'));
    const seven = pub?.prompts?.some(p => p.kind === 'discard');
    if (seven) await moment('discard', () => shot(hostPage, 'a07-host-seven'));
    if (pub?.turn?.round >= 6) await moment('mid', () => shot(hostPage, 'a08-host-midgame'));
    return stage() === 'finale' || stage() === 'ended' || host.current?.type === 'round.results';
  },
  onAction: async (ph, a, result) => {
    if (result === 'miss') return shot(ph.page, `miss-${Date.now()}`);
    if (a.type === 'roll' && ph === phones[0]) await moment('roll', async () => {
      await hostPage.waitForTimeout(700);
      await shot(hostPage, 'a04-host-roll');
      await shot(ph.page, 'a05-phone-roll');
    });
    if (a.type === 'offer') await moment('phone-offer', () => shot(ph.page, 'a09-phone-offer'));
    if (a.type === 'answer' && ph.current.privateView.prompts[0]?.kind === 'discard') {
      await moment('phone-discard', () => shot(ph.page, 'a10-phone-discard'));
    }
  },
});
log(`finale reached: ${JSON.stringify(stats)}`);
await hostPage.waitForTimeout(1600);
await shot(hostPage, 'a11-host-finale');
await hostPage.waitForTimeout(1600);
await shot(hostPage, 'a12-host-finale-sorted');
await until(() => host.current?.type === 'round.results', 'results', 30000);
await hostPage.waitForTimeout(1500);
const final = host.current.publicView, results = final.results, outcome = host.current.outcome;
await shot(hostPage, 'a13-host-results', true);
if (!solo) await shot(phones[0].page, 'a14-phone-results', true);

await hostPage.getByRole('button', { name: 'Play again' }).click();
for (const ph of phones.filter(p => p !== host)) {
  const ready = ph.page.getByRole('button', { name: 'Ready to play' });
  await until(() => ready.isVisible(), 'ready again', 15000).then(() => ready.click()).catch(() => {});
}
await start();
const fresh = host.current.publicView;
const replay = host.current.roundId !== round && fresh.turn.stage === 'setup'
  && !Object.keys(fresh.pieces.buildings).length && !Object.keys(fresh.pieces.routes).length
  && !fresh.results;
await hostPage.waitForTimeout(2000);
await shot(hostPage, 'a15-host-replay-setup');
const errors = [host, ...phones.filter(p => p !== host)].flatMap(p => p.errors.map(e => `${p.name}: ${e}`));
const summary = {
  scenario: solo ? 'B solo' : 'A watch', code, durationS: Math.round((Date.now() - started) / 1000),
  accepted: stats.accepted, rejected: stats.rejected, uiMisses: stats.uiMisses, types: stats.types,
  winners: results?.winners.map(id => final.seats.find(s => s.id === id)?.name ?? id),
  reason: results?.reason, rounds: results?.rounds, opportunities: results?.opportunities,
  standings: results?.standings.map(s => ({ seat: s.seat, vp: s.vp, rank: s.rank })),
  outcomeRows: outcome?.rows?.length, replayFresh: replay, errors,
};
writeFileSync(`${out}/summary-${solo ? 'b' : 'a'}.json`, JSON.stringify({ summary, notes }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
