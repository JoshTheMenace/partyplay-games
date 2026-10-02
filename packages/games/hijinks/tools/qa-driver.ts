/**
 * Hijinks live QA driver: one real TV page, one real phone page and N-1 socket bots play a night on a running server.
 *
 *   node --import tsx packages/games/hijinks/tools/qa-driver.ts --port 4421 --players 4 [--game quip-clash]
 *     [--shots output/playwright/hijinks/<run>] [--host localhost] [--keep-open] [--phone-viewports] [--tv-viewports] [--settled] [--stress-podium] [--max-minutes 30]
 *
 * - TV (headless Chromium, 1920×1080) opens /?game=hijinks, adds it to the library, taps Play on this screen and reads the code.
 * - Phone (390×844, touch) joins through the real form, keeps its auto-picked avatar and taps I’m ready!. It joins first, so it
 *   is the VIP and drives every pack step through its UI: vote, Lock it in, Skip intro, Continue, End the night.
 * - Bots join over raw WebSockets speaking the room protocol (windowed action ids), pick a free avatar, ready, vote --game and
 *   play the minigame with src/minis/<id>/bot.ts.
 * - The phone's minigame turns use the same bot policy. A generic UI mapping from bot actions is not possible, so the policy's
 *   action is injected into the phone page's own socket (Playwright routeWebSocket, ids renumbered so the page and the driver
 *   share one action window); the page still renders every accepted result. A minigame may opt into real UI driving with
 *   src/minis/<id>/qa.ts exporting `ui(page, action): Promise<boolean>` (true = handled through the UI).
 * - Without --game the night goes menu → End the night → results. With --game it plays through the podium, back to the menu, then ends.
 * - --settled adds a TV-only shot 4.5 s after each phase change (end-of-reveal states).
 * - Every shot waits for layout to settle after a viewport resize: two animation frames and, on the TV, a stage whose scale
 *   matches the viewport. Each phone shot also checks for horizontal overflow and pinch zoom (log.json `overflow`).
 * - --stress-podium rewrites the TV's podium snapshots to a worst case (long names, three-way ties, six long awards, a long
 *   headline) to check the layout; the server and the phones are untouched.
 * - Screenshots (TV + phone, plus 320×568 and 667×375 with --phone-viewports, TV 1280×720 with --tv-viewports) are taken on every pack/minigame phase change;
 *   log.json in --shots records phases, per-seat accepted/rejected actions and page errors. Everything started here is closed.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import type { MiniBot, PackAction, PackPrivateView, PackPublicView } from '../src/core/contract';
import { MINIS, eligible } from '../src/minis/catalog';

const { values: args } = parseArgs({ options: {
  port: { type: 'string' }, host: { type: 'string', default: 'localhost' }, players: { type: 'string', default: '4' }, game: { type: 'string' },
  shots: { type: 'string' }, 'keep-open': { type: 'boolean', default: false }, 'phone-viewports': { type: 'boolean', default: false }, 'tv-viewports': { type: 'boolean', default: false }, settled: { type: 'boolean', default: false }, 'stress-podium': { type: 'boolean', default: false }, 'max-minutes': { type: 'string', default: '30' },
} });
const count = Number(args.players), game = args.game, base = `http://${args.host}:${args.port}`, t0 = Date.now();
if (!args.port || !Number.isInteger(count) || count < 2 || count > 10) throw new Error('Usage: qa-driver.ts --port <port> --players <2-10> [--game <miniId>] [--shots <dir>] [--keep-open] [--phone-viewports] [--tv-viewports] [--settled] [--stress-podium]');
const info = game ? MINIS.find(m => m.id === game) : undefined;
if (game && !info) throw new Error(`Unknown minigame ${game}. Catalog: ${MINIS.map(m => m.id).join(', ')}`);
if (info && !eligible(info, count)) throw new Error(`${info.title} needs ${info.players.min}–${info.players.max} players.`);
const shots = args.shots ?? `output/playwright/hijinks/qa-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(shots, { recursive: true });

// Playwright is not a project dependency; HIJINKS_PLAYWRIGHT can point at another node_modules directory that contains it.
const { chromium } = createRequire(`${process.env.HIJINKS_PLAYWRIGHT ?? `${process.env.HOME}/.npm/_npx/e41f203b7505f1fb/node_modules`}/`)('playwright');
type Page = any; // Playwright is loaded untyped from outside the project.
type Snap = { roundId: string; serverTime: number; publicView: PackPublicView; privateView: PackPrivateView | null };
type Ack = { accepted: boolean; reason?: string };
type Agent = { label: string; playerId: string; snap: Snap | null; at: number; busy: boolean; fresh: boolean; nextAt: number; staleAt: number; send(action: PackAction): Promise<Ack> };
type Room = { phase: string; roundId: string | null; lobbyId?: string; players: { id: string; ready: boolean; lobbyChoice?: { avatar?: number } }[] };

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const log = (...parts: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...parts);
const report = { base, players: count, game: game ?? null, code: '', phoneDriving: 'socket', phases: [] as { t: number; key: string }[], actions: {} as Record<string, { accepted: number; rejected: Record<string, number> }>, errors: [] as string[], shots: [] as string[], overflow: [] as { shot: string; width: number; scrollWidth: number; zoom: number; offenders: string[] }[] };
const sockets: WebSocket[] = [];
let browser: { close(): Promise<void>; newContext(o: object): Promise<{ newPage(): Promise<Page> }> } | null = null, room: Room | null = null;

const bot: MiniBot | null = game ? await import(`../src/minis/${game}/bot.ts`).then(m => m.default ?? m.bot) : null;
const uiPath = game && new URL(`../src/minis/${game}/qa.ts`, import.meta.url);
const ui: ((page: Page, action: Record<string, unknown>) => Promise<boolean>) | null = uiPath && existsSync(uiPath) ? (await import(uiPath.href)).ui ?? null : null;
if (game && typeof bot !== 'function') throw new Error(`src/minis/${game}/bot.ts must export a MiniBot as default or \`bot\`.`);
if (ui) report.phoneDriving = 'ui (qa.ts) with socket fallback';

function record(agent: Agent, action: PackAction, ack: Ack) {
  const stats = report.actions[agent.label] ??= { accepted: 0, rejected: {} };
  const kind = action.k === 'mini' ? `mini:${String(action.a.type ?? action.a.k ?? action.a.kind ?? '?')}` : action.k;
  if (ack.accepted) stats.accepted++; else { const why = `${kind}: ${ack.reason}`; stats.rejected[why] = (stats.rejected[why] ?? 0) + 1; log(`${agent.label} rejected ${why}`); }
}
const agent = (label: string): Agent => ({ label, playerId: '', snap: null, at: 0, busy: false, fresh: false, nextAt: 0, staleAt: 0, send: async () => ({ accepted: false, reason: 'not connected' }) });
function observe(a: Agent, m: Snap) { a.snap = m; a.at = Date.now(); a.fresh = true; }

function plan(a: Agent, phone: Page | null): PackAction | null {
  const s = a.snap!, v = s.publicView, me = s.privateView;
  if (v.phase === 'menu' && game && !phone && me && me.vote !== game) return { k: 'vote', game };
  if (v.phase !== 'mini' || !bot || !v.current) return null;
  const a2 = bot({ view: v.mini, me: me?.mini, playerId: a.playerId, players: v.players, now: s.serverTime + Date.now() - a.at, random: Math.random });
  return a2 ? { k: 'mini', session: v.current.session, a: a2 } : null;
}
/** One policy for bots and the phone: vote the requested game (bots only; the phone votes through its UI), then play the minigame. */
async function step(a: Agent, phone: Page | null) {
  const s = a.snap;
  if (!s || a.busy || Date.now() < a.nextAt || (!a.fresh && Date.now() < a.staleAt)) return;
  let action = plan(a, phone);
  if (!action) return;
  a.busy = true; a.fresh = false; a.staleAt = Date.now() + 2500;
  try {
    if (phone && ui && action.k === 'mini') {
      if (await ui(phone, action.a)) { record(a, action, { accepted: true }); return; }
      // The tap may have landed before the UI moved on: only fall back to the socket if the move is still wanted.
      await sleep(400);
      const again = plan(a, phone);
      if (!again || again.k !== 'mini' || again.a.turn !== action.a.turn || again.a.k !== action.a.k) return;
      action = again;
    }
    const ack = await a.send(action);
    record(a, action, ack);
    if (!ack.accepted) a.fresh = true;
    if (!ack.accepted && action.k === 'vote') throw new Error(`Vote for ${game} was rejected: ${ack.reason}`);
    a.nextAt = Date.now() + (ack.accepted ? 250 + Math.random() * 650 : 1200); a.staleAt = Date.now() + 2500;
  } finally { a.busy = false; }
}

async function joinBot(index: number, name: string, code: string): Promise<Agent> {
  const a = agent(`bot${index}`), ws = new WebSocket(`ws://${args.host}:${args.port}/ws`);
  sockets.push(ws);
  const acks = new Map<string, (ack: Ack) => void>(), wire = (type: string, payload: object = {}) => ws.send(JSON.stringify({ v: '1.0', type, ...payload }));
  let seq = 0, round: string | null = null, readied = '';
  const onRoom = (r: Room) => {
    if (r.roundId !== round) { round = r.roundId; seq = 0; }
    const mine = r.players.find(p => p.id === a.playerId);
    if (r.phase === 'lobby' && r.lobbyId && mine && !mine.ready && readied !== r.lobbyId) {
      const taken = new Set(r.players.filter(p => p !== mine).map(p => p.lobbyChoice?.avatar));
      readied = r.lobbyId;
      wire('lobby.choice', { lobbyId: r.lobbyId, payload: { avatar: Array.from({ length: 16 }, (_, k) => k).find(k => !taken.has(k)) ?? 0 } });
      wire('room.ready', { ready: true, lobbyId: r.lobbyId });
    }
    if (index === 1) room = r;
  };
  const welcomed = new Promise<void>((done, fail) => {
    ws.on('message', data => {
      const m = JSON.parse(String(data));
      if (m.type === 'room.welcome') { a.playerId = m.playerId; onRoom(m.room); done(); }
      else if (m.type === 'room.state') onRoom(m.room);
      else if (m.type === 'round.prepare') wire('round.ready', { roundId: m.roundId });
      else if (m.type === 'game.snapshot') observe(a, m);
      else if (m.type === 'action.ack') { acks.get(m.actionId)?.(m); acks.delete(m.actionId); }
      else if (m.type === 'error') { report.errors.push(`${a.label}: ${m.reason}`); log(`${a.label} error: ${m.reason}`); fail(new Error(m.reason)); }
    });
    ws.once('error', fail);
  });
  a.send = action => new Promise(done => { const actionId = String(++seq); acks.set(actionId, done); wire('game.action', { roundId: a.snap!.roundId, actionId, retireThrough: seq - 1, payload: action }); });
  await new Promise((done, fail) => { ws.once('open', done); ws.once('error', fail); });
  wire('room.join', { code, role: 'controller', name });
  await welcomed;
  return a;
}

/** Proxies the phone page's socket: observes its snapshots and lets the driver inject actions into the same action window. */
async function tapPhone(page: Page, a: Agent) {
  const ids = new Map<string, string>(), back = new Map<string, string>(), next = new Map<string, number>(), pending = new Map<string, Set<number>>();
  const injected = new Map<string, (ack: Ack) => void>();
  const claim = (round: string) => { const n = (next.get(round) ?? 0) + 1, open = pending.get(round) ?? new Set<number>(); next.set(round, n); open.add(n); pending.set(round, open); return { n, retire: Math.min(...open) - 1 }; };
  let server: { send(m: string): void } | null = null;
  await page.routeWebSocket(/\/ws(\?|$)/, (route: Page) => {
    const upstream = route.connectToServer(); server = upstream;
    route.onMessage((raw: string) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'game.action') {
        const key = `${m.roundId}:${m.actionId}`;
        if (!ids.has(key)) { const { n } = claim(m.roundId); ids.set(key, String(n)); back.set(`${m.roundId}:${n}`, m.actionId); }
        m.actionId = ids.get(key); m.retireThrough = Math.min(...pending.get(m.roundId)!) - 1;
      }
      upstream.send(JSON.stringify(m));
    });
    upstream.onMessage((raw: string) => {
      const m = JSON.parse(String(raw)), key = `${m.roundId}:${m.actionId}`;
      if (m.type === 'action.ack') {
        pending.get(m.roundId)?.delete(Number(m.actionId));
        if (injected.has(key)) { injected.get(key)!(m); injected.delete(key); return; }
        m.actionId = back.get(key) ?? m.actionId;
      }
      if (m.type === 'room.welcome') { a.playerId = m.playerId; if (m.nextActionSequence && m.room.roundId) next.set(m.room.roundId, Math.max(next.get(m.room.roundId) ?? 0, m.nextActionSequence - 1)); }
      if (m.type === 'game.snapshot') observe(a, m);
      route.send(JSON.stringify(m));
    });
  });
  a.send = action => new Promise(done => {
    const round = a.snap!.roundId, { n, retire } = claim(round);
    injected.set(`${round}:${n}`, done);
    server!.send(JSON.stringify({ v: '1.0', type: 'game.action', roundId: round, actionId: String(n), retireThrough: retire, payload: action }));
  });
}

async function newPage(viewport: { width: number; height: number }, label: string, mobile: boolean): Promise<Page> {
  const page = await (await browser!.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: 'no-preference' })).newPage();
  page.on('console', (m: Page) => { if (m.type() === 'error') report.errors.push(`${label} console: ${m.text()}`); });
  page.on('pageerror', (e: Error) => { report.errors.push(`${label} pageerror: ${e.message}`); log(`${label} pageerror: ${e.message}`); });
  return page;
}

/** Two animation frames, then true once a filling TV stage (if any) is scaled to the current viewport. */
const LAYOUT_SETTLED = () => new Promise<boolean>(done => requestAnimationFrame(() => requestAnimationFrame(() => {
  const stage = document.querySelector('.hj-stage-fill .hj-stage'), w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  if (!stage) return done(true);
  const box = stage.getBoundingClientRect(), scale = Math.min(w / 1920, h / 1080);
  done(Math.abs(box.width - 1920 * scale) < 1.5 && Math.abs(box.height - 1080 * scale) < 1.5);
})));
/** Horizontal overflow (which makes mobile browsers zoom out) and the deepest elements sticking out on the right. No named inner functions: tsx would inject __name. */
const OVERFLOW = () => {
  const root = document.documentElement, width = root.clientWidth, zoom = window.visualViewport?.scale ?? 1, offenders: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    const right = el.getBoundingClientRect().right;
    if (offenders.length < 6 && right > width + 1 && getComputedStyle(el).position !== 'fixed' && ![...el.children].some(child => child.getBoundingClientRect().right > width + 1))
      offenders.push(`${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} → ${Math.round(right)}px`);
  }
  return root.scrollWidth > width + 1 || zoom < .99 ? { width, scrollWidth: root.scrollWidth, zoom, offenders } : null;
};
async function resize(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  for (const end = Date.now() + 3000; !(await page.evaluate(LAYOUT_SETTLED));) if (Date.now() > end) { log(`layout did not settle at ${width}×${height}`); break; }
}
async function phoneShot(phone: Page, path: string) {
  await phone.screenshot({ path });
  const overflow = await phone.evaluate(OVERFLOW);
  if (overflow) { report.overflow.push({ shot: path, ...overflow }); log(`phone overflow in ${path}: ${JSON.stringify(overflow)}`); }
}

let chain: Promise<unknown> = Promise.resolve(), shotCount = 0;
/** Serialises every screenshot step, so a delayed shot never lands mid-resize. */
const enqueue = (step: () => Promise<void>, what: string) => (chain = chain.then(step).catch(error => log(`screenshot ${what} failed: ${(error as Error).message}`)));
function shoot(tv: Page, phone: Page, label: string, settle = 900) {
  const name = `${String(++shotCount).padStart(3, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
  return enqueue(async () => {
    await sleep(settle);
    const paths = [`${shots}/${name}-tv.png`, `${shots}/${name}-phone.png`];
    await tv.screenshot({ path: paths[0] }); await phoneShot(phone, paths[1]!);
    if (args['phone-viewports']) {
      for (const [width, height] of [[320, 568], [667, 375]] as const) { await resize(phone, width, height); paths.push(`${shots}/${name}-phone-${width}x${height}.png`); await phoneShot(phone, paths.at(-1)!); }
      await resize(phone, 390, 844);
    }
    if (args['tv-viewports']) { await resize(tv, 1280, 720); paths.push(`${shots}/${name}-tv-1280x720.png`); await tv.screenshot({ path: paths.at(-1) }); await resize(tv, 1920, 1080); }
    report.shots.push(...paths);
  }, name);
}
/** A TV-only shot `delay` ms from now, queued behind any running viewport sweep. */
function shootTvLater(tv: Page, path: string, delay: number) {
  setTimeout(() => void enqueue(async () => { await resize(tv, 1920, 1080); await tv.screenshot({ path }); report.shots.push(path); }, path), delay);
}

const LONG_NAMES = ['Bartholomew Fizz', 'Gertrude Q. Hoot', 'Wilhelmina Wobb', 'Maximilian Moss', 'Ottoline Pepper', 'Barnaby Quibble', 'Clementine Zest', 'Percival Plonk', 'Henrietta Huff', 'Montgomery Mop'];
const LONG_AWARDS = ['Most Likely To Bring A Kazoo To A Funeral', 'Unshakeable Champion Of Terrible Ideas', 'Biggest Comeback Since The Dinosaurs',
  'Fastest Thumbs In The Whole Wild West', 'Certified Professional Overthinker', 'Most Suspiciously Innocent Face Tonight'];
/** QA worst case for the podium: long names, three-way ties on every step, six long awards and a long headline. */
function stressPodium(view: PackPublicView) {
  if (!view.podium) return;
  const ids = view.players.map(p => p.id), points = [900, 900, 900, 700, 700, 700, 500, 500, 500, 100];
  view.players.forEach((p, i) => { p.name = LONG_NAMES[i % LONG_NAMES.length]!; });
  view.podium.result = { scores: Object.fromEntries(ids.map((id, i) => [id, points[i] ?? 0])), winners: ids.slice(0, 3),
    awards: LONG_AWARDS.map((title, i) => ({ title, playerId: ids[(i * 3) % ids.length]! })), headline: 'A three-way photo finish! Nobody saw that coming, least of all the judges' };
}
/** Rewrites the TV's own snapshots (Playwright routeWebSocket) with `edit`. */
async function tapTv(page: Page, edit: (view: PackPublicView) => void) {
  await page.routeWebSocket(/\/ws(\?|$)/, (route: Page) => {
    const upstream = route.connectToServer();
    route.onMessage((raw: string) => upstream.send(raw));
    upstream.onMessage((raw: string) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'game.snapshot' && m.publicView?.podium) { edit(m.publicView); return route.send(JSON.stringify(m)); }
      route.send(raw);
    });
  });
}
const miniKey = (mini: unknown) => mini && typeof mini === 'object' ? ['phase', 'stage', 'round', 'turn'].map(k => (mini as Record<string, unknown>)[k]).filter(x => typeof x === 'string' || typeof x === 'number').join('/') : '';
const phaseKey = (v: PackPublicView) => `${v.phase}${v.current ? `#${v.current.session} ${v.current.id}` : ''}${v.phase === 'mini' ? ` ${miniKey(v.mini)}` : ''}`;
async function until(test: () => boolean, ms: number, what: string) {
  for (const end = Date.now() + ms; !test();) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`); await sleep(100); }
}

async function cleanup() {
  for (const ws of sockets) ws.terminate();
  await browser?.close().catch(() => undefined); browser = null;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });

let tv: Page = null, phone: Page = null, failure: Error | null = null, lastKey = '';
const agents: Agent[] = [], you = agent('phone');
const loop = setInterval(() => { for (const a of agents) void step(a, a === you ? phone : null).catch(error => { failure ??= error; }); }, 100);
try {
  browser = await chromium.launch({ headless: true });
  tv = await newPage({ width: 1920, height: 1080 }, 'tv', false);
  if (args['stress-podium']) await tapTv(tv, stressPodium);
  await tv.goto(`${base}/?game=hijinks`);
  await tv.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  await tv.getByRole('button', { name: 'Play on this screen', exact: true }).first().click();
  const code = report.code = (await tv.locator('.kp-code').first().textContent({ timeout: 20000 })).trim();
  log(`room ${code} on ${base}`);

  phone = await newPage({ width: 390, height: 844 }, 'phone', true);
  await tapPhone(phone, you); agents.push(you);
  await phone.goto(`${base}/?join=${code}`);
  await phone.getByRole('textbox', { name: 'Your name' }).fill('Phone Tester');
  await phone.getByRole('button', { name: 'Join the room', exact: true }).click();
  await phone.getByRole('button', { name: 'I’m ready!', exact: true }).click({ timeout: 20000 });
  const names = ['Captain Pickles', 'Bartholomew Fizz', 'Ms. Wobbleton', 'Zed', 'Agent Sprinkles', 'Gertrude Q. Hoot', 'Noodle', 'Mo', 'Dot'];
  for (let i = 1; i < count; i++) agents.push(await joinBot(i, names[i - 1]!, code));
  await until(() => !!room && room.players.length === count && room.players.every(p => p.ready), 20000, 'every seat to be ready');
  await shoot(tv, phone, 'lobby-ready', 600);
  await tv.getByRole('button', { name: 'Start game', exact: true }).click({ timeout: 20000 });

  const view = () => you.snap?.publicView;
  const watch = setInterval(() => {
    const v = view(); if (!v) return;
    const key = phaseKey(v);
    if (key !== lastKey) {
      lastKey = key; report.phases.push({ t: Date.now() - t0, key }); log(`phase ${key}`); void shoot(tv, phone, key);
      if (args.settled) shootTvLater(tv, `${shots}/settled-${String(report.phases.length).padStart(3, '0')}-${key.replace(/[^a-z0-9]+/gi, '-')}-tv.png`, 4500);
    }
  }, 100);
  try {
    await until(() => view()?.phase === 'menu', 30000, 'the game menu');
    if (info) {
      await chain;
      await phone.getByRole('radio', { name: new RegExp(`^${info.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`) }).first().click(); // 7+ games: it can also sit under Room favourites
      await until(() => view()?.phase !== 'menu' || Object.keys(view()?.menu?.votes ?? {}).length === count, 15000, 'everyone to vote');
      if (view()?.phase === 'menu') await phone.getByRole('button', { name: 'Lock it in', exact: true }).click().catch(() => log('lock: the countdown won'));
      await until(() => view()?.phase === 'intro', 15000, 'the intro');
      await sleep(3000); await chain;
      if (view()?.phase === 'intro') await phone.getByRole('button', { name: 'Skip intro for everyone', exact: true }).click().catch(() => log('skip: intro already over'));
      await until(() => view()?.phase === 'mini', 30000, 'the minigame');
      await until(() => !!failure || view()?.phase === 'podium', Number(args['max-minutes']) * 60000, 'the podium');
      if (failure) throw failure;
      await sleep(5000); await chain; await shoot(tv, phone, 'podium settled', 0); // after the last award row lands (~4.8 s)
      if (view()?.phase === 'podium') await phone.getByRole('button', { name: 'Continue to the menu', exact: true }).click().catch(() => log('continue: podium already over'));
      await until(() => view()?.phase === 'menu', 30000, 'the menu after the podium');
    }
    await sleep(1500); await chain;
    await phone.getByRole('button', { name: 'End the night', exact: true }).click();
    await phone.getByRole('button', { name: 'Tap again to end the night', exact: true }).click();
    await until(() => room?.phase === 'results', 20000, 'results');
    log('night over: results');
    await shoot(tv, phone, 'results', 2500);
  } finally { clearInterval(watch); }
  if (args['keep-open']) { log(`keeping room ${code} open on ${base}; press Ctrl+C to close everything`); await new Promise(() => undefined); }
} catch (error) {
  failure = error as Error;
  if (tv && phone) await shoot(tv, phone, 'error', 0);
} finally {
  clearInterval(loop);
  await chain;
  writeFileSync(`${shots}/log.json`, JSON.stringify({ ...report, failure: failure?.message ?? null }, null, 2));
  log(`actions ${JSON.stringify(report.actions)}`);
  log(`${report.shots.length} screenshots and log.json in ${shots}${report.errors.length ? `; ${report.errors.length} page/socket errors` : ''}`);
  await cleanup();
}
if (failure) { console.error(failure); process.exit(1); }
process.exit(0);
