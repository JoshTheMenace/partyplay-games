// Drives a real Ichi match through the shared launcher: one TV page, real phone pages that tap the DOM, and optional socket bots.
// Run from the platform root:
//   node packages/games/ichi/tools/qa-driver.mjs --base http://127.0.0.1:4431 --out output/ichi-pass/run --players 2
//     [--bots 30] [--think 300,900] [--preset Chaos] [--select "Match length=One hand"] [--toggle "Echo"] [--viewports 390x844,320x568]
//     [--tv 1280x720] [--hoard 22 [--hoardall]] [--replay] [--limit 900] [--shots 4] [--reload 40] [--late 25]
// --reduced runs every page with prefers-reduced-motion. --reload N reloads the last phone N seconds into the match and checks its hand came back; --late N joins one more phone N seconds in, which must only watch.
// PLAYWRIGHT_CORE names the directory that holds playwright-core (default ~/.local/opt/pw/node_modules).
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: arg } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string' }, players: { type: 'string' }, bots: { type: 'string' }, think: { type: 'string' }, preset: { type: 'string' }, select: { type: 'string', multiple: true }, toggle: { type: 'string', multiple: true }, viewports: { type: 'string' }, tv: { type: 'string' }, hoard: { type: 'string' }, replay: { type: 'boolean' }, limit: { type: 'string' }, shots: { type: 'string' }, pace: { type: 'string' }, reload: { type: 'string' }, late: { type: 'string' }, hoardall: { type: 'boolean' }, reduced: { type: 'boolean' } } });
const base = arg.base ?? 'http://127.0.0.1:4431', out = arg.out ?? 'output/ichi-pass/run', players = Number(arg.players ?? 2), botCount = Number(arg.bots ?? 0);
const size = text => { const [width, height] = text.split('x').map(Number); return { width, height }; };
const viewports = (arg.viewports ?? '390x844').split(',').map(size), tvSize = size(arg.tv ?? '1280x720'), hoard = Number(arg.hoard ?? 0), limitMs = Number(arg.limit ?? 900) * 1000, perState = Number(arg.shots ?? 2), pace = Number(arg.pace ?? 250);
const { chromium } = await import(`${process.env.PLAYWRIGHT_CORE ?? `${process.env.HOME}/.local/opt/pw/node_modules`}/playwright-core/index.mjs`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const wait = ms => new Promise(r => setTimeout(r, ms)), pick = list => list[Math.floor(Math.random() * list.length)], bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const stats = { base, players, bots: botCount, started: new Date().toISOString(), sent: {}, accepted: {}, rejected: {}, ui: {}, console: [], layout: [], shots: [], hands: 0, turnWaitsMs: [], notes: [] };
const kinds = new Map(), acked = new Set(), taken = {};

function track(page, label) {
  page.on('console', m => { if (m.type() === 'error') stats.console.push(`${label}: ${m.text()}`); });
  page.on('pageerror', e => stats.console.push(`${label} pageerror: ${e.message}`));
  page.on('websocket', ws => {
    ws.on('close', () => bump(stats, 'socketCloses'));
    ws.on('framesent', f => { try { const m = JSON.parse(f.payload); if (m.type === 'game.action' && !kinds.has(`${label}:${m.actionId}`)) { kinds.set(`${label}:${m.actionId}`, m.payload.kind); bump(stats.sent, m.payload.kind); } } catch { /* Not JSON. */ } });
    ws.on('framereceived', f => { try { const m = JSON.parse(f.payload), id = `${label}:${m.actionId}`; if (m.type !== 'action.ack' || acked.has(id)) return; acked.add(id); const k = kinds.get(id) ?? '?'; if (m.accepted) bump(stats.accepted, k); else bump(stats.rejected, `${k}: ${m.reason}`); } catch { /* Not JSON. */ } });
  });
}
/** Screenshot plus layout metrics. `key` limits how many shots one state gets. */
async function shot(page, name, key = name) {
  taken[key] = (taken[key] ?? 0) + 1; if (taken[key] > perState) return;
  const file = `${out}/${name}${taken[key] > 1 ? `-${taken[key]}` : ''}.png`;
  await page.screenshot({ path: file }).catch(() => {});
  const m = await page.evaluate(() => {
    const d = document.documentElement, rows = [...document.querySelectorAll('.ichi-hand-row')];
    const small = [...document.querySelectorAll('.ichi button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.height && !b.classList.contains('ichi-card-button') && (r.height < 44 || r.width < 44); }).map(b => `${(b.getAttribute('aria-label') || b.textContent).trim().slice(0, 20)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
    const box = document.querySelector('.ichi-display')?.getBoundingClientRect();
    const clipped = [...document.querySelectorAll('.ichi-seat,.ichi-fan .ichi-back,.ichi-tiles>li,.ichi-leaders li,.ichi-seating li,.ichi-tally,.ichi-splash,.ichi-window,.ichi-lap,.ichi-hud,.ichi-ticker li')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && box && (r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1 || r.top < box.top - 1); }).map(e => e.className.toString().split(' ')[0] || e.tagName).join(',');
    return { w: innerWidth, h: innerHeight, overflowX: d.scrollWidth > innerWidth + 1, scrollH: d.scrollHeight, small, clipped, handRows: rows.length, handScroll: rows.some(r => r.scrollWidth > r.clientWidth + 1), cards: document.querySelectorAll('.ichi-card-button').length };
  }).catch(() => ({}));
  stats.shots.push(file); stats.layout.push({ name, ...m });
}
async function newPage(viewport, label, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, ...(arg.reduced ? { reducedMotion: 'reduce' } : {}) });
  const page = await context.newPage(); page.setDefaultTimeout(90000); track(page, label); return page;
}
const names16 = ['Aurelia Blossoms', 'Bartholomew Keys', 'Constantina Moon', 'Dmitri Vasquezzz', 'Evangeline Frost', 'Fitzgerald Dunne', 'Guinevere Stokes', 'Horatio Pemberly', 'Isadora Whitlock', 'Jebediah Hawkins'];
const short = ['Mika', 'Jonah', 'Priya', 'Teo', 'Wren', 'Sol', 'Ines', 'Kofi', 'Lena', 'Abe'];

const tv = await newPage(tvSize, 'tv', false);
await tv.goto(`${base}/?game=ichi`);
await tv.getByRole('button', { name: 'Add to library', exact: true }).first().click();
await tv.getByRole('button', { name: 'Play on this screen', exact: true }).first().click();
const code = (await tv.locator('.kp-code').first().textContent()).trim();
console.log(`room ${code}`);
if (arg.preset || arg.select || arg.toggle) {
  await tv.getByRole('button', { name: 'Settings', exact: true }).click();
  await tv.getByRole('button', { name: 'Game rules', exact: true }).click();
  if (arg.preset) await tv.locator('.ichi-preset', { hasText: arg.preset }).click();
  for (const pair of arg.select ?? []) { const [label, value] = pair.split('='); await tv.getByLabel(label).selectOption({ label: value }); }
  for (const label of arg.toggle ?? []) await tv.getByRole('switch', { name: label }).click();
  await shot(tv, 'tv-settings');
  await tv.getByRole('button', { name: 'Apply settings', exact: true }).click();
}
const phones = [];
for (let i = 0; i < players; i++) {
  const page = await newPage(viewports[i % viewports.length], `p${i}`, true), name = players + botCount > 6 ? names16[i % 10] : short[i % 10];
  await page.goto(`${base}/?join=${code}`);
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: 'Join the room', exact: true }).click();
  phones.push({ page, name, i, tag: `${viewports[i % viewports.length].width}x${viewports[i % viewports.length].height}`, bot: {} });
}
let bots = null;
if (botCount) {
  const port = new URL(base).port;
  bots = spawn(process.execPath, ['--import', 'tsx', 'scripts/qa/room-bots.ts', '--host', '127.0.0.1', '--port', port, '--code', code, '--players', String(botCount), '--stats', '5', '--hook', 'packages/games/ichi/tools/room-bot.mjs'], { env: { ...process.env, ICHI_BOT_THINK: arg.think ?? '300,900', ICHI_BOT_STATS: `${out}/bot-stats.json` }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(`${out}/bots.log`); bots.stdout.pipe(log); bots.stderr.pipe(log);
  await new Promise((done, fail) => { const t = setTimeout(() => fail(new Error('bots did not join')), 180000); bots.stdout.on('data', d => { if (String(d).includes('bots joined')) { clearTimeout(t); done(); } }); bots.once('exit', c => fail(new Error(`bots exited ${c}`))); });
}
await wait(1500);
await shot(tv, 'tv-lobby'); if (phones[0]) await shot(phones[0].page, `phone-${phones[0].tag}-lobby`);

async function ready() { for (const p of phones) await p.page.getByRole('button', { name: 'Ready to play', exact: true }).click(); }
async function start() {
  await tv.getByRole('button', { name: 'Start game', exact: true }).click();
  await tv.locator('.ichi-display').waitFor();
  await Promise.all(phones.map(p => p.page.locator('.ichi-phone').waitFor()));
}
const readPhone = page => page.evaluate(() => {
  const root = document.querySelector('.ichi-phone');
  if (!root) return { phase: document.querySelector('.kp-round-results') ? 'results' : 'none' };
  const named = b => (b.getAttribute('aria-label') || b.textContent).trim();
  return {
    phase: root.dataset.phase, myTurn: root.dataset.myTurn === 'true', busy: root.querySelector('.ichi-actions')?.getAttribute('aria-busy') === 'true',
    cards: [...root.querySelectorAll('.ichi-card-button')].map(b => ({ id: b.dataset.cardId, playable: b.dataset.playable === 'true', jumpable: b.dataset.jumpable === 'true', label: named(b), selected: b.getAttribute('aria-pressed') === 'true' })),
    buttons: [...root.querySelectorAll('button:not(.ichi-card-button)')].filter(b => !b.disabled).map(named),
    urgent: !!root.querySelector('.ichi-shout[data-urgent="true"]'), sheet: root.querySelector('.ichi-colors') ? 'colors' : root.querySelector('.ichi-gift') ? 'gift' : root.querySelector('.ichi-targets') ? 'targets' : '', lap: root.querySelector('.ichi-strip')?.dataset.lap === 'true',
  };
}).catch(() => ({ phase: 'none' }));
const has = (s, name) => s.buttons?.includes(name);
const press = (page, name) => page.getByRole('button', { name, exact: true }).first().click({ timeout: 4000 });
// Tap the top-left corner: in a two-row hand the lower half of a first-row card sits under the second row.
const tapCard = (page, id) => page.locator(`.ichi-card-button[data-card-id="${id}"]`).click({ timeout: 4000, position: { x: 8, y: 10 } });

async function act(phone, now) {
  const { page, bot, tag } = phone, s = await readPhone(page), hoards = hoard && (arg.hoardall || phone.i === 0);
  if (s.phase === 'none' || !s.phase) return;
  if (s.myTurn && !bot.turnAt) { bot.turnAt = now; if (bot.lastTurnEnd) stats.turnWaitsMs.push(now - bot.lastTurnEnd); }
  if (!s.myTurn && bot.turnAt) { bot.turnAt = 0; bot.lastTurnEnd = now; }
  if (s.phase === 'playing') {
    const n = s.cards?.length ?? 0;
    if (s.sheet) await shot(page, `phone-${tag}-${s.sheet}`);
    else if (has(s, 'Catch!')) await shot(page, `phone-${tag}-catch`);
    else if (s.urgent) await shot(page, `phone-${tag}-ichi`);
    else if (s.lap) await shot(page, `phone-${tag}-lap`);
    else if (n >= 20) await shot(page, `phone-${tag}-hand20`);
    else if (n > 10) await shot(page, `phone-${tag}-hand11`);
    else if (s.myTurn && s.cards.some(c => c.selected)) await shot(page, `phone-${tag}-selected`);
    else if (s.myTurn) await shot(page, `phone-${tag}-turn`);
    else await shot(page, `phone-${tag}-waiting`);
  } else await shot(page, `phone-${tag}-${s.phase}`);
  if (s.busy) return;
  const breakButton = s.buttons?.find(b => /^(Next hand|Ready)/.test(b));
  if (s.phase !== 'playing') { bot.nextAt ??= now + 1500 + Math.random() * 2500; if (now > bot.nextAt && breakButton) { bot.nextAt = undefined; await press(page, breakButton); } return; }
  bot.nextAt = undefined;
  if (has(s, 'Catch!')) { bot.catchAt ??= now + 600 + Math.random() * 2500; if (now > bot.catchAt) { bot.catchAt = undefined; return press(page, 'Catch!'); } } else bot.catchAt = undefined;
  if (s.urgent && has(s, 'Ichi!')) { bot.callAt ??= now + (Math.random() < 0.6 ? 500 + Math.random() * 2500 : 99999); if (now > bot.callAt) { bot.callAt = undefined; return press(page, 'Ichi!'); } } else bot.callAt = undefined;
  const choices = s.buttons.filter(b => ['Coral', 'Sky', 'Lime', 'Sun'].includes(b) || /^(Swap with|Send|Give) /.test(b));
  if (has(s, 'Play Gift')) return press(page, 'Play Gift');
  if (s.sheet && choices.length) return press(page, pick(choices));
  // A Gift first needs the card to hand over: any card but the Gift itself.
  if (s.sheet === 'gift') { const spare = s.cards.filter(c => !c.selected); return spare.length ? tapCard(page, pick(spare).id) : undefined; }
  const selected = s.cards.find(c => c.selected);
  if (!s.myTurn) { const jump = s.cards.find(c => c.jumpable); if (selected?.jumpable) return press(page, `Play ${selected.label.replace(/, bluff$/, '')}`).catch(() => tapCard(page, selected.id)); if (jump && Math.random() < 0.6) return tapCard(page, jump.id); return; }
  if (now - bot.turnAt < pace) return; // A human beat; also lets the TV animate.
  const drawButton = s.buttons.find(b => b.startsWith('Draw'));
  if (hoards && s.cards.length < hoard && drawButton && !has(s, 'Keep card')) return press(page, drawButton);
  if (has(s, 'Challenge') && Math.random() < 0.4) return press(page, 'Challenge');
  if (selected?.playable) return tapCard(page, selected.id);
  const playable = s.cards.filter(c => c.playable);
  if (has(s, 'Keep card')) return playable.length && !(hoards && s.cards.length < hoard) ? tapCard(page, playable[0].id) : press(page, 'Keep card');
  if (playable.length) return tapCard(page, pick(playable).id);
  if (drawButton) return press(page, drawButton);
}
const tvState = () => tv.evaluate(() => {
  const d = document.querySelector('.ichi-display'), results = !!document.querySelector('.kp-round-results');
  return { phase: results ? 'results' : d?.dataset.phase ?? 'none', stack: !!d?.querySelector('.ichi-stack'), window: !!d?.querySelector('.ichi-window'), splash: d?.querySelector('.ichi-splash strong')?.textContent ?? '', overlay: !!d?.querySelector('.ichi-overlay'), mode: d?.dataset.mode ?? '', bell: d?.dataset.bell === 'true' };
}).catch(() => ({ phase: 'none' }));

async function match(label) {
  const began = Date.now(); let phase = '', lastMid = 0, ticks = 0;
  while (Date.now() - began < limitMs) {
    const t = await tvState(), now = Date.now();
    if (t.phase !== phase) {
      if ((t.phase === 'intermission' || t.phase === 'break') && phase === 'playing') stats.hands++;
      if (t.phase === 'playing' && phase !== 'playing') { await wait(900); await shot(tv, `${label}tv-deal`); }
      phase = t.phase;
    }
    if (t.phase === 'results') { await wait(1200); await shot(tv, `${label}tv-results`); for (const p of phones.slice(0, 2)) await shot(p.page, `${label}phone-${p.tag}-results`); return Date.now() - began; }
    if (t.phase === 'seating') { await wait(1500); await shot(tv, `${label}tv-seating`); }
    if (arg.reload && !label && !stats.reload && now - began > Number(arg.reload) * 1000) {
      const p = phones[players - 1], before = await readPhone(p.page);
      if (before.phase === 'playing') {
        await p.page.reload(); await p.page.locator('.ichi-phone').waitFor(); await wait(2000);
        const after = await readPhone(p.page); await shot(p.page, `phone-${p.tag}-reloaded`);
        stats.reload = { before: [before.phase, before.cards.length], after: [after.phase, after.cards?.length ?? 0], kept: after.phase === 'playing' && Math.abs((after.cards?.length ?? 0) - before.cards.length) <= 2 };
      }
    }
    if (arg.late && !label && !stats.late && now - began > Number(arg.late) * 1000) {
      const page = await newPage(viewports[0], 'late', true);
      await page.goto(`${base}/?join=${code}`); await page.getByRole('textbox', { name: 'Your name' }).fill('Latecomer'); await page.getByRole('button', { name: 'Join the room', exact: true }).click();
      // The shell may keep a late phone on its own waiting screen; either way it must hold no cards.
      await wait(5000); await shot(page, 'phone-late-watching');
      stats.late = await page.evaluate(() => ({ phase: document.querySelector('.ichi-phone')?.dataset.phase ?? 'shell', text: (document.querySelector('.ichi-break h2, .kp-notice, .kp-waiting-copy, main h1, main h2')?.textContent ?? '').slice(0, 90), cards: document.querySelectorAll('.ichi-card-button').length }));
      // The latecomer is a seat from now on: it readies up and plays in a rematch.
      phones.push({ page, name: 'Latecomer', i: phones.length, tag: 'late', bot: {} });
    }
    if (t.splash) await shot(tv, `${label}tv-splash-${t.splash.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`);
    if (t.window) await shot(tv, `${label}tv-window`);
    if (t.stack) await shot(tv, `${label}tv-stack`);
    if (t.bell) await shot(tv, `${label}tv-bell`);
    if (t.overlay) { if (t.phase === 'playing') await shot(tv, `${label}tv-overlay-playing`); else { await wait(2200); await shot(tv, `${label}tv-${t.phase}`); } }
    if (t.phase === 'playing' && now - lastMid > 20000 && ++ticks > 4) { lastMid = now; await shot(tv, `${label}tv-mid`, `${label}tv-mid`); }
    for (const p of phones) await act(p, Date.now()).catch(e => bump(stats.ui, `${e.message.split('\n')[0].slice(0, 60)} | ${e.message.split('\n').filter(l => /intercepts|stable|visible|enabled|detached|outside|waiting for/.test(l)).at(-1)?.trim().slice(0, 110) ?? ''}`));
    await wait(60);
  }
  stats.notes.push(`${label || 'match'} hit the ${limitMs / 1000}s limit in phase ${phase}`); await shot(tv, `${label}tv-timeout`); return null;
}
try {
  await ready(); await wait(800); await shot(tv, 'tv-ready'); await start();
  stats.matchMs = await match('');
  if (arg.replay && stats.matchMs !== null) {
    await tv.getByRole('button', { name: 'Play again', exact: true }).click();
    await tv.getByRole('button', { name: 'Start game', exact: true }).waitFor(); await wait(800);
    await ready(); await wait(800); await start(); await wait(2500);
    await shot(tv, 'replay-tv-deal');
    stats.replayScores = await tv.evaluate(() => [...document.querySelectorAll('.ichi-seat-text b, .ichi-rank b')].map(b => b.textContent));
    stats.replaySeats = await tv.evaluate(() => [...document.querySelectorAll('.ichi-seat-text strong')].map(e => e.textContent));
    stats.replayMs = await match('replay-');
  }
} catch (error) { stats.notes.push(`driver error: ${error.message}`); await shot(tv, 'tv-error').catch(() => {}); console.error(error); }
stats.turnWait = (() => { const w = [...stats.turnWaitsMs].sort((a, b) => a - b); return w.length ? { n: w.length, medianMs: w[w.length >> 1], p90Ms: w[Math.floor(w.length * .9)], maxMs: w.at(-1) } : null; })();
delete stats.turnWaitsMs;
if (bots) { bots.kill('SIGTERM'); await wait(1500); }
writeFileSync(`${out}/stats.json`, JSON.stringify(stats, null, 2));
console.log(JSON.stringify({ code, matchMs: stats.matchMs, replayMs: stats.replayMs, replaySeats: stats.replaySeats, hands: stats.hands, reload: stats.reload, late: stats.late, clipped: [...new Set(stats.layout.map(l => l.clipped).filter(Boolean))], overflowX: stats.layout.filter(l => l.overflowX).map(l => l.name), accepted: stats.accepted, rejected: stats.rejected, ui: stats.ui, console: stats.console.slice(0, 5), notes: stats.notes, turnWait: stats.turnWait }, null, 1));
await browser.close();
