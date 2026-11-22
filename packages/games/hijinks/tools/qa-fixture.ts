/**
 * Hijinks layout fixtures: every phase of a minigame at any roster size, rendered by the real TV and phone pages.
 *
 *   node --import tsx packages/games/hijinks/tools/qa-fixture.ts --port 4431 --game ballpark --players 32
 *     [--shots output/hijinks/fixtures/<run>] [--seed 5] [--seat p1] [--host 127.0.0.1] [--tv-small] [--phone-small] [--all] [--only reveal,scores] [--reduced-motion] [--long-night]
 *
 * A live game at 32 or 64 players takes minutes per phase and 64 real pages would flatten the machine, so this tool separates
 * the two halves. First the rules run in-process (tests/harness.ts, the minigame's own bot, a fake clock) and the public
 * view plus one seat's private view are kept for each phase kind: the fullest snapshot of that kind (--all keeps every
 * phase key). Then one real TV page and one real phone page join a real room on a running server with one socket bot, the
 * host starts Hijinks, and each kept snapshot is delivered to both pages through their own sockets in place of the server's
 * (Playwright routeWebSocket), with its timestamps moved to the server's clock so reveals stand on their last beat.
 *
 * What this is: pixel-true layout evidence for the densest states (every name is sixteen characters). What it is not: a
 * played game. Nothing here proves joins, timing, votes or scoring; tools/qa-driver.ts and the tests do that.
 * `menu`, `intro` and `podium` are captured too. log.json lists each shot with its phase key, roster and JSON size.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import type { PackPrivateView, PackPublicView } from '../src/core/contract';
import { MINIS, eligible } from '../src/minis/catalog';
import { createNight, loadBot } from '../tests/harness';

const { values: args } = parseArgs({ options: {
  port: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, players: { type: 'string', default: '32' }, game: { type: 'string' }, seed: { type: 'string', default: '5' },
  seat: { type: 'string', default: 'p1' }, shots: { type: 'string' }, 'tv-small': { type: 'boolean', default: false }, 'phone-small': { type: 'boolean', default: false }, all: { type: 'boolean', default: false }, only: { type: 'string' },
  'reduced-motion': { type: 'boolean', default: false }, 'long-night': { type: 'boolean', default: false },
} });
const count = Number(args.players), game = args.game ?? '', info = MINIS.find(m => m.id === game), base = `http://${args.host}:${args.port}`;
if (!args.port || !info || !Number.isInteger(count) || !eligible(info, count)) throw new Error(`Usage: qa-fixture.ts --port <port> --game <miniId> --players <n within the minigame's range> [--seat p1] [--shots <dir>]`);
const shots = args.shots ?? `output/hijinks/fixtures/${game}-p${count}`, seat = args.seat!;
mkdirSync(shots, { recursive: true });

// ---------- 1. play it in-process and keep the fullest snapshot of every phase kind ----------
type Kept = { key: string; kind: string; now: number; view: PackPublicView; me: PackPrivateView; size: number };
const miniKey = (mini: unknown) => mini && typeof mini === 'object' ? ['phase', 'stage', 'round', 'turn'].map(k => (mini as Record<string, unknown>)[k]).filter(x => typeof x === 'string' || typeof x === 'number').join('/') : '';
const keyOf = (v: PackPublicView) => v.phase === 'mini' ? `mini ${miniKey(v.mini)}` : v.phase, kindOf = (key: string) => key.replace(/\/.*$/, '');
const night = createNight({ players: count, seed: Number(args.seed) }), kept = new Map<string, Kept>();
let last: Kept | null = null;
/** Files the previous snapshot under its phase kind when it is the fullest of that kind so far. */
function keep() { if (!last) return; const slot = args.all ? last.key : last.kind, old = kept.get(slot); if (!old || last.size >= old.size) kept.set(slot, last); }
function look() {
  const view = night.view(), key = keyOf(view);
  if (last && last.key !== key) keep();
  const me = night.me(seat);
  last = { key, kind: kindOf(key), now: night.now, view, me, size: JSON.stringify(view).length + JSON.stringify(me).length };
}
const rival = MINIS.find(m => m !== info && eligible(m, count))?.id ?? game;
night.ids.slice(1).forEach((id, i) => night.act(id, { k: 'vote', game: i % 4 === 3 ? rival : game })); look();
night.act('p0', { k: 'lock' }); night.advance(2500); look();
night.act('p0', { k: 'skip', session: night.state.current!.session });
const bot = await loadBot(game), advance = night.advance.bind(night);
night.advance = (ms: number) => { advance(ms); look(); };
night.runMini(bot);
night.advance(6000); keep();
// The end of the night: the results the platform shows after the VIP ends it.
night.advance = advance; night.endNight();
const finale = { view: night.view(), outcome: night.rules.outcome(night.state) };
// --long-night: the densest end screen a night produces, seven games and seven champions with a trophy each.
if (args['long-night']) {
  const ids = finale.outcome.rows.map(r => r.playerId).slice(0, 7);
  Object.assign(finale.view, { played: MINIS.slice(0, 7).map(m => m.id), champions: ids.map(id => [id]), trophies: Object.fromEntries(ids.map(id => [id, 1])) });
  finale.outcome.winners = ids;
}
const only = args.only?.split(',');
const frames = [...kept.values()].filter(f => !only || only.some(word => f.key.includes(word))).sort((a, b) => a.now - b.now);
console.log(`${game} at ${count} players: ${frames.length} phase kinds kept, ${Math.round((night.now - 1000) / 1000)} s of game time`);

// ---------- 2. show each one on a real TV page and a real phone page ----------
const pwRequire = createRequire(`${process.env.HIJINKS_PLAYWRIGHT ?? `${process.env.HOME}/.local/opt/pw/node_modules`}/`);
const { chromium } = (() => { try { return pwRequire('playwright'); } catch { return pwRequire('playwright-core'); } })();
type Page = any; // Playwright is loaded untyped from outside the project.
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const TIMES = new Set(['at', 'deadline', 'endsAt', 'startedAt', 'lockAt']);
/** Moves every server timestamp by `delta` and renames the fixture seat to the phone's real player id. */
function adapt<T>(value: T, delta: number, rename: [string, string] | null): T {
  const walk = (x: unknown, key = ''): unknown => typeof x === 'number' ? (TIMES.has(key) ? x + delta : x)
    : typeof x === 'string' ? (rename && x === rename[0] ? rename[1] : x)
    : Array.isArray(x) ? x.map(item => walk(item, key))
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [rename && k === rename[0] ? rename[1] : k, walk(v, k)])) : x;
  return walk(value) as T;
}
/** One page's socket: real traffic passes through; `show` delivers a fixture snapshot with a revision the page accepts. */
async function tap(page: Page) {
  const link = { playerId: '', envelope: null as Record<string, unknown> | null, seen: 0, send: (() => undefined) as (text: string) => void, toServer: (() => undefined) as (text: string) => void, frozen: false, results: null as ((m: Record<string, unknown>) => void) | null };
  await page.routeWebSocket(/\/ws(\?|$)/, (route: Page) => {
    const upstream = route.connectToServer();
    link.send = (text: string) => route.send(text); link.toServer = (text: string) => upstream.send(text);
    route.onMessage((raw: string) => upstream.send(raw));
    upstream.onMessage((raw: string) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'room.welcome') link.playerId = m.playerId ?? '';
      if (m.type === 'game.snapshot') { link.envelope = m; link.seen = Date.now(); if (link.frozen) return; }
      if (m.type === 'round.results' && link.results) { link.results(m); route.send(JSON.stringify(m)); return; }
      route.send(raw);
    });
  });
  return link;
}
let revision = 1e6;
function show(link: Awaited<ReturnType<typeof tap>>, frame: Kept, phone: boolean) {
  const env = link.envelope!, serverNow = Number(env.serverTime) + Date.now() - link.seen, delta = serverNow - frame.now, rename: [string, string] | null = phone ? [seat, link.playerId] : null;
  const view = { ...adapt(frame.view, delta, rename), cues: [], mediaRev: ++revision };
  link.frozen = true;
  link.send(JSON.stringify({ ...env, revision, serverTime: serverNow, publicView: view, publicCache: { revision, reused: false }, privateView: phone ? adapt(frame.me, delta, rename) : null }));
}
const browser = await chromium.launch({ headless: true }), sockets: WebSocket[] = [], log: object[] = [], errors: string[] = [];
try {
  const open = async (viewport: { width: number; height: number }, mobile: boolean, label: string) => {
    const page = await (await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: args['reduced-motion'] ? 'reduce' : 'no-preference' })).newPage();
    page.on('pageerror', (e: Error) => errors.push(`${label}: ${e.message}`));
    return page;
  };
  const tv = await open({ width: 1920, height: 1080 }, false, 'tv'), tvLink = await tap(tv);
  await tv.goto(`${base}/?game=hijinks`);
  await tv.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  await tv.getByRole('button', { name: 'Play on this screen', exact: true }).first().click();
  const code = (await tv.locator('.kp-code').first().textContent({ timeout: 20000 })).trim();
  const phone = await open({ width: 390, height: 844 }, true, 'phone'), phoneLink = await tap(phone);
  await phone.goto(`${base}/?join=${code}`);
  await phone.getByRole('textbox', { name: 'Your name' }).fill('Fixture Phone');
  await phone.getByRole('button', { name: 'Join the room', exact: true }).click();
  await phone.getByRole('button', { name: 'I’m ready!', exact: true }).click({ timeout: 20000 });
  // One socket bot fills the second seat.
  await new Promise<void>((done, fail) => {
    const ws = new WebSocket(`ws://${args.host}:${args.port}/ws`), wire = (type: string, payload: object = {}) => ws.send(JSON.stringify({ v: '1.0', type, ...payload }));
    let readied = false;
    sockets.push(ws); ws.once('error', fail);
    ws.on('open', () => wire('room.join', { code, role: 'controller', name: 'Fixture Bot' }));
    ws.on('message', data => {
      const m = JSON.parse(String(data)), room = m.room;
      if (m.type === 'round.prepare') wire('round.ready', { roundId: m.roundId });
      if (room?.phase === 'lobby' && room.lobbyId && !readied) { readied = true; wire('lobby.choice', { lobbyId: room.lobbyId, payload: { avatar: 9 } }); wire('room.ready', { ready: true, lobbyId: room.lobbyId }); }
      if (room?.players?.length === 2 && room.players.every((p: { ready: boolean }) => p.ready)) done();
    });
  });
  await tv.getByRole('button', { name: 'Start game', exact: true }).click({ timeout: 20000 });
  for (const end = Date.now() + 30000; !tvLink.envelope || !phoneLink.envelope;) { if (Date.now() > end) throw new Error('The round never started.'); await sleep(100); }
  await sleep(1500);
  const sizes = { tv: [[1920, 1080], ...(args['tv-small'] ? [[1280, 720]] : [])], phone: [[390, 844], ...(args['phone-small'] ? [[320, 568], [667, 375]] : [])] };
  for (const [i, frame] of frames.entries()) {
    show(tvLink, frame, false); show(phoneLink, frame, true);
    await sleep(frame.kind === 'podium' ? 5200 : 2600); // entrances and the minigame chunk (first frame) settle
    const stem = `${shots}/${String(i + 1).padStart(2, '0')}-${frame.key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
    for (const [name, page, list] of [['tv', tv, sizes.tv], ['phone', phone, sizes.phone]] as const) for (const [w, h] of list) {
      if (w !== list[0]![0]) { await page.setViewportSize({ width: w, height: h }); await sleep(500); }
      const file = `${stem}-${name}${w === list[0]![0] ? '' : `-${w}x${h}`}.png`;
      await page.screenshot({ path: file });
      // Anything wider than the page (phones) or outside the 1920×1080 stage (TV) is a layout defect worth a look.
      const overflow = await page.evaluate(() => { const root = document.documentElement; return root.scrollWidth > root.clientWidth + 1 ? root.scrollWidth - root.clientWidth : 0; });
      log.push({ file, key: frame.key, page: name, viewport: `${w}x${h}`, players: count, bytes: frame.size, ...(overflow ? { overflowX: overflow } : {}) });
      if (w !== list[0]![0]) { await page.setViewportSize({ width: list[0]![0]!, height: list[0]![1]! }); await sleep(300); }
    }
    console.log(`shot ${frame.key}`);
  }
  if (!only || only.includes('results')) {
    // The real VIP (the phone's seat) ends the real night; both pages get the fixture night's table instead of the two-seat one.
    for (const [link, phoneSide] of [[tvLink, false], [phoneLink, true]] as const) link.results = m => {
      const rename: [string, string] | null = phoneSide ? [seat, link.playerId] : null;
      Object.assign(m, { revision: ++revision, publicView: { ...adapt(finale.view, 0, rename), cues: [], mediaRev: revision }, publicCache: { revision, reused: false }, outcome: adapt(finale.outcome, 0, rename) });
    };
    phoneLink.toServer(JSON.stringify({ v: '1.0', type: 'game.action', roundId: phoneLink.envelope!.roundId, actionId: '1', retireThrough: 0, payload: { k: 'end' } }));
    await sleep(4500);
    for (const [name, page] of [['tv', tv], ['phone', phone]] as const) { const file = `${shots}/${String(frames.length + 1).padStart(2, '0')}-results-${name}.png`; await page.screenshot({ path: file }); log.push({ file, key: 'results', page: name, players: count }); }
    console.log('shot results');
  }
} finally {
  writeFileSync(`${shots}/log.json`, JSON.stringify({ base, game, players: count, seat, fixture: true, errors, shots: log }, null, 2));
  for (const ws of sockets) ws.terminate();
  await browser.close();
}
console.log(`${log.length} fixture screenshots in ${shots}${errors.length ? `; ${errors.length} page errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
process.exit(errors.length ? 1 : 0);
