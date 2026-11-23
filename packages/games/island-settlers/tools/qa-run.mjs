/**
 * Browser QA run: one real TV page, real phone pages that tap the DOM (tests/browser/driver.mjs) and CPUs or
 * socket bots for the rest, from join to results and Play again. Screenshots are taken at named moments.
 *
 *   node --import tsx packages/games/island-settlers/tools/qa-run.mjs --base http://127.0.0.1:4420 \
 *     --out output/settlers-pass/run --phones 2 --seats 4 --mode standard [--tv 1280x720] [--target 8]
 *     [--bots 30] [--think 600,1500] [--islands many] [--quick 1] [--reload 1] [--round 60] [--timer brisk]
 *     [--every 5] [--noreplay 1]
 *
 * PLAYWRIGHT_CORE names the folder that holds playwright-core (default ~/.local/opt/pw/node_modules).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { observe, play, until } from '../tests/browser/driver.mjs';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(a => {
  const [k, ...v] = a.trim().split(' ');
  return [k, v.join(' ') || '1'];
}));
const base = args.base ?? 'http://127.0.0.1:4420', out = args.out ?? 'output/settlers-pass/run';
const [tvW, tvH] = (args.tv ?? '1280x720').split('x').map(Number);
const phoneCount = Number(args.phones ?? 2), seats = Number(args.seats ?? 4);
const sizes = (args.sizes ?? '390x844,320x568').split(',').map(s => s.split('x').map(Number));
const pw = `${process.env.PLAYWRIGHT_CORE ?? `${homedir()}/.local/opt/pw/node_modules`}/playwright-core/index.mjs`;
const { chromium } = await import(pw);
mkdirSync(out, { recursive: true });

const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const tvBrowser = await chromium.launch({ headless: true, args: GL });
const phoneBrowser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
const started = Date.now(), notes = [];
const log = s => { const line = `[${((Date.now() - started) / 1000).toFixed(0)}s] ${s}`; notes.push(line); console.log(line); };
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` }).catch(e => log(`shot ${name} failed: ${e.message}`));

const hostPage = await (await tvBrowser.newContext({ viewport: { width: tvW, height: tvH } })).newPage();
const host = observe(hostPage, 'host');
host.page.setDefaultTimeout(30000);
await hostPage.goto(`${base}/?game=island-settlers`);
await hostPage.getByRole('button', { name: 'Add to library' }).first().click();
await hostPage.getByRole('button', { name: 'Play on this screen' }).click();
await hostPage.getByRole('button', { name: 'Watch only' }).click();
const code = (await hostPage.locator('.kp-code').first().textContent()).trim();
log(`room ${code}`);

const settings = {};
if (args.mode) settings.mode = args.mode;
if (args.target) settings.targetPoints = Number(args.target);
if (args.timer) settings.timer = args.timer;
if (args.round) settings.roundSeconds = Number(args.round);
if (args.set) Object.assign(settings, JSON.parse(args.set));
await hostPage.getByRole('button', { name: 'Settings', exact: true }).click();
await hostPage.getByRole('button', { name: 'Game rules' }).click();
await hostPage.locator('.island-settlers-settings select').first().selectOption(String(seats));
if (settings.mode === 'connect') await hostPage.locator('.island-settlers-settings').getByText('Connect rounds', { exact: true }).click();
if (args.islands === 'many') await hostPage.locator('.island-settlers-settings').getByText('Archipelago', { exact: true }).click();
if (args.quick) await hostPage.getByRole('switch', { name: /^Quick start/ }).click();
const rules = hostPage.locator('.island-settlers-settings');
if (settings.roundSeconds) await rules.getByText(`${settings.roundSeconds} s`, { exact: true }).first().click();
if (settings.targetPoints) await hostPage.getByLabel('Points to win').selectOption(String(settings.targetPoints));
if (settings.timer) await rules.getByText({ off: 'Off', relaxed: 'Relaxed', brisk: 'Brisk' }[settings.timer], { exact: true }).first().click();
for (const label of (args.click ?? '').split('|').filter(Boolean)) {
  await hostPage.getByText(label, { exact: false }).first().click().catch(e => log(`click ${label}: ${e.message}`));
}
await shot(hostPage, 'tv-00-settings');
await hostPage.getByRole('button', { name: 'Apply settings' }).click();

const phones = [];
const names = ['Ana Longname1234', 'Bo Navigator5678', 'Cy Wanderer 9012', 'Di Mapmaker 3456', 'Eli Shipwright78', 'Flo Lighthouse90'];
for (let i = 0; i < phoneCount; i++) {
  const [width, height] = sizes[i % sizes.length];
  const ctx = await phoneBrowser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), data = observe(page, names[i]);
  await page.goto(`${base}/?join=${code}`);
  await page.getByRole('textbox', { name: 'Your name' }).fill(names[i]);
  await page.getByRole('button', { name: 'Join the room' }).click();
  if (i === 0) await shot(page, 'phone-00-lobby');
  await page.getByRole('button', { name: 'Ready to play' }).click();
  phones.push(data);
}
// Socket bots fill the rest of the room (scripts/qa/room-bots.ts with this game's hook).
let bots = null;
if (Number(args.bots ?? 0) > 0) {
  const port = new URL(base).port;
  bots = spawn(process.execPath, ['--import', 'tsx', 'scripts/qa/room-bots.ts', '--port', port, '--code', code,
    '--players', String(args.bots), '--hook', 'packages/games/island-settlers/tools/room-bot.mjs', '--stats', '30'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SETTLERS_BOT_STATS: `${out}/bots.json`,
    ...(args.think ? { SETTLERS_BOT_THINK: args.think } : {}) } });
  bots.stdout.on('data', d => { const t = String(d).trim(); if (t) log(`bots: ${t.split('\n').pop()}`); });
  bots.stderr.on('data', d => log(`bots! ${String(d).trim().slice(0, 300)}`));
  await hostPage.waitForFunction(n => (document.body.innerText.match(/(\d+)\/(\d+) ready/i) ?? [])[1] >= n,
    Number(args.bots) + phoneCount, { timeout: 120000 }).catch(() => log('bots not all ready in time'));
}
await hostPage.waitForTimeout(500);
await shot(hostPage, 'tv-01-lobby');

/** Start a round and wait until every page shows it (setup, or the first roll with quick start). */
async function start() {
  const before = host.current?.roundId ?? null;
  await until(() => hostPage.getByRole('button', { name: 'Start game' }).isEnabled(), 'start enabled', 30000);
  await hostPage.getByRole('button', { name: 'Start game' }).click();
  const begun = p => p.current && p.current.roundId !== before && ['setup', 'roll'].includes(p.current.publicView?.turn?.stage)
    && p.current.publicView.turn.round <= 1;
  await until(() => [host, ...phones].every(begun), 'round started', 120000);
}
await start();
const round = host.current.roundId;
log(`started; seats ${host.current.publicView.seats.map(s => `${s.name}${s.cpu ? ' (CPU)' : ''}`).join(', ')}`);
await hostPage.waitForTimeout(3000);
await shot(hostPage, 'tv-02-setup');
await shot(phones[0].page, 'phone-02-setup');

const seen = new Set();
const moment = async (key, fn) => { if (!seen.has(key)) { seen.add(key); await fn(); } };
const stage = () => host.current?.publicView?.turn?.stage;
const league = () => host.current?.room?.league;
let lastTv = 0;
const stats = await play(phones, {
  log,
  stop: async () => {
    const pub = host.current?.publicView;
    if (pub?.turn?.stage === 'main' || pub?.turn?.stage === 'round') await moment('main', async () => {
      await shot(hostPage, 'tv-03-first-turn'); await shot(phones[0].page, 'phone-03-first-turn');
    });
    if (pub?.offers?.length >= 1) await moment('offers', async () => {
      await shot(hostPage, 'tv-05-offers'); for (const [i, ph] of phones.entries()) await shot(ph.page, `phone-05-offer-${i}`);
    });
    if (pub?.prompts?.some(p => p.kind === 'discard')) await moment('seven', async () => {
      await shot(hostPage, 'tv-06-seven'); await shot(phones[0].page, 'phone-06-seven');
    });
    if (pub?.prompts?.some(p => p.kind === 'robber')) await moment('robber', async () => {
      await shot(hostPage, 'tv-07-robber'); await shot(phones[0].page, 'phone-07-robber');
    });
    const r = league()?.shared ? league().round : pub?.turn?.round ?? 0;
    // A phone reloaded mid-game must get its island and hand back by itself (the `sync` request).
    if (args.reload && r >= 3) await moment('reload', async () => {
      const ph = phones[phones.length - 1], before = JSON.stringify(ph.current.privateView.hand);
      await ph.page.reload();
      await until(async () => (await ph.page.locator('.island-settlers-hand').count()) > 0, 'hand after reload', 30000);
      await ph.page.waitForTimeout(800);
      await shot(ph.page, 'phone-11-after-reload');
      const syncs = [...ph.sent.values()].filter(a => a?.type === 'sync').length;
      log(`reloaded ${ph.name}: hand back (${before}), sync requests sent ${syncs}`);
      notes.push(`reload ok, syncs ${syncs}`);
    });
    if (league()?.hornAt) await moment('horn', async () => { await shot(hostPage, 'tv-09-horn'); await shot(phones[0].page, 'phone-09-horn'); });
    if (r > lastTv && r % Number(args.every ?? 5) === 0) {
      lastTv = r;
      await shot(hostPage, `tv-10-round-${String(r).padStart(2, '0')}`);
      await shot(phones[0].page, `phone-10-round-${String(r).padStart(2, '0')}`);
    }
    return stage() === 'finale' || stage() === 'ended' || host.current?.type === 'round.results';
  },
  onAction: async (ph, a, result) => {
    if (result === 'miss') return shot(ph.page, `miss-${Date.now()}`);
    if (a.type === 'roll') await moment('roll', async () => {
      await hostPage.waitForTimeout(600); await shot(hostPage, 'tv-04-roll'); await shot(ph.page, 'phone-04-roll');
    });
    if (a.type === 'build' && stage() !== 'setup') await moment('build', async () => {
      await hostPage.waitForTimeout(400); await shot(hostPage, 'tv-08-build'); await shot(ph.page, 'phone-08-build');
    });
    if (a.type === 'bank') await moment('bank', () => shot(ph.page, 'phone-09-bank'));
  },
});
log(`finale reached: ${JSON.stringify(stats)}`);
await hostPage.waitForTimeout(1500);
await shot(hostPage, 'tv-20-finale');
await shot(phones[0].page, 'phone-20-finale');
await until(() => host.current?.type === 'round.results', 'results', 60000);
await hostPage.waitForTimeout(2500);
await shot(hostPage, 'tv-21-results');
await shot(phones[0].page, 'phone-21-results');
const final = host.current.publicView, outcome = host.current.outcome;

let replay = null;
if (!args.noreplay) {
  await hostPage.getByRole('button', { name: 'Play again' }).click();
  for (const ph of phones) {
    const ready = ph.page.getByRole('button', { name: 'Ready to play' });
    await until(() => ready.isVisible(), 'ready again', 20000).then(() => ready.click()).catch(() => {});
  }
  await start();
  const fresh = host.current.publicView;
  replay = host.current.roundId !== round && fresh.turn.round <= 1 && !fresh.results;
  await hostPage.waitForTimeout(2500);
  await shot(hostPage, 'tv-22-replay');
}
const errors = [host, ...phones].flatMap(p => p.errors.map(e => `${p.name}: ${e}`));
const traffic = [host, ...phones].map(p => ({
  page: p.name, kibPerSecond: +(p.bytes / 1024 / ((Date.now() - p.since) / 1000)).toFixed(1), largestMessage: p.largest,
}));
const summary = {
  code, traffic, islands: league()?.islands.length, leagueRounds: league()?.results?.rounds, leagueWinners: league()?.results?.winners, tv: `${tvW}x${tvH}`, seats, phones: phoneCount, settings, durationS: Math.round((Date.now() - started) / 1000),
  accepted: stats.accepted, rejected: stats.rejected, uiMisses: stats.uiMisses, types: stats.types,
  winners: outcome?.winners, rows: outcome?.rows?.length, rounds: final?.results?.rounds, replayFresh: replay, errors,
};
writeFileSync(`${out}/summary.json`, JSON.stringify({ summary, notes }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await tvBrowser.close();
await phoneBrowser.close();
if (bots) { bots.kill('SIGINT'); await new Promise(r => setTimeout(r, 500)); }
