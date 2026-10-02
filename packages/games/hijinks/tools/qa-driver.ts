/**
 * Hijinks live QA driver: one real TV page, one real phone page and N-1 socket bots play a night on a running server.
 *
 *   node --import tsx packages/games/hijinks/tools/qa-driver.ts --port 4421 --players 4 [--game quip-clash]
 *     [--shots output/playwright/hijinks/<run>] [--host localhost] [--keep-open] [--phone-viewports] [--tv-viewports] [--settled]
 *     [--stress-podium] [--audio <file.wav>] [--read-aloud] [--max-minutes 30]
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
 * - Screenshots never queue. Each page has a camera that watches the snapshots its own socket delivered and shoots the state it
 *   is showing now: every phase key once it has been on screen 0.9 s (a key that is replaced sooner is logged as `missed`),
 *   viewport sweeps (phone 320×568 + 667×375 with --phone-viewports, TV 1280×720 with --tv-viewports) once per phase kind,
 *   and with --settled a TV shot once a key has been on screen 4.5 s. A shot whose page moved on during capture is deleted
 *   (log.json `discarded`), so every file name is the phase key the page showed. Cameras learn how long each kind lasts and
 *   only start a sweep or settled shot that should finish in time (log.json `unswept`). Bots never wait for cameras.
 * - Every resize waits for layout to settle: two animation frames and, on the TV, a stage whose scale matches the viewport.
 *   Each phone shot also checks for horizontal overflow and pinch zoom (log.json `overflow`).
 * - --stress-podium rewrites the TV's podium snapshots to a worst case (long names, three-way ties, six long awards, a long
 *   headline) to check the layout; the server and the phones are untouched.
 * - --audio <file.wav> records the TV's host-display audio (see AUDIO_TAP) to a float WAV, music/sfx/vo stems to
 *   <file>.stems.wav and the cue, source-start, speech and phase log to <file>.cues.json, all on the recording's clock.
 *   It lets the intro and the podium play out instead of skipping them. Frames the recorder skipped are written as silence
 *   (`gaps` in the cue log) so the file stays aligned. --read-aloud turns on the TV's read-aloud setting before anyone joins.
 * - log.json in --shots records phases, shots with their on-screen lag, per-seat accepted/rejected actions and page errors.
 *   Everything started here is closed.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import type { MiniBot, PackAction, PackPrivateView, PackPublicView } from '../src/core/contract';
import { MINIS, eligible } from '../src/minis/catalog';

const { values: args } = parseArgs({ options: {
  port: { type: 'string' }, host: { type: 'string', default: 'localhost' }, players: { type: 'string', default: '4' }, game: { type: 'string' },
  shots: { type: 'string' }, 'keep-open': { type: 'boolean', default: false }, 'phone-viewports': { type: 'boolean', default: false }, 'tv-viewports': { type: 'boolean', default: false }, settled: { type: 'boolean', default: false }, 'stress-podium': { type: 'boolean', default: false }, 'max-minutes': { type: 'string', default: '30' },
  audio: { type: 'string' }, 'read-aloud': { type: 'boolean', default: false },
} });
const count = Number(args.players), game = args.game, base = `http://${args.host}:${args.port}`, t0 = Date.now();
if (!args.port || !Number.isInteger(count) || count < 2 || count > 10) throw new Error('Usage: qa-driver.ts --port <port> --players <2-10> [--game <miniId>] [--shots <dir>] [--keep-open] [--phone-viewports] [--tv-viewports] [--settled] [--stress-podium] [--audio <file.wav>] [--read-aloud]');
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
/** One page's camera: the phase key its own socket last delivered, and what has been shot of it. */
type Lens = { name: 'tv' | 'phone'; page: Page; cdp: Page; size: [number, number]; sweeps: number[]; room: string; snap: PackPublicView | null; key: string; since: number; shot: string; settled: string; extras: { suffix: string; done(): void }[]; hold: Promise<unknown> };

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const log = (...parts: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...parts);
const report = { base, players: count, game: game ?? null, code: '', phoneDriving: 'socket', phases: [] as { t: number; key: string }[], actions: {} as Record<string, { accepted: number; rejected: Record<string, number> }>, errors: [] as string[],
  shots: [] as { t: number; file: string; page: string; key: string; role: string; onScreenMs: number; captureMs: number }[], missed: [] as { page: string; key: string; onScreenMs: number }[], discarded: [] as { file: string; nowShowing: string }[], unswept: [] as { page: string; kind: string; medianPhaseMs: number; medianSweepMs: number }[],
  lag: {} as Record<string, { shots: number; p50: number; p95: number; max: number; missed: number }>, resizeMs: [] as number[], overflow: [] as { shot: string; width: number; scrollWidth: number; zoom: number; offenders: string[] }[], audio: null as unknown };
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
      const move = action.a;
      if (await hold(phoneLens, () => ui(phone, move))) { record(a, action, { accepted: true }); return; }
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
async function tapPhone(page: Page, a: Agent, l: Lens) {
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
      see(l, m);
      route.send(JSON.stringify(m));
    });
  });
  a.send = action => new Promise(done => {
    const round = a.snap!.roundId, { n, retire } = claim(round);
    injected.set(`${round}:${n}`, done);
    server!.send(JSON.stringify({ v: '1.0', type: 'game.action', roundId: round, actionId: String(n), retireThrough: retire, payload: action }));
  });
}
/** Proxies the TV page's socket: the camera watches its snapshots; --stress-podium rewrites podium snapshots with `edit`. */
async function tapTv(page: Page, l: Lens, edit: ((view: PackPublicView) => void) | null) {
  await page.routeWebSocket(/\/ws(\?|$)/, (route: Page) => {
    const upstream = route.connectToServer();
    route.onMessage((raw: string) => upstream.send(raw));
    upstream.onMessage((raw: string) => {
      const m = JSON.parse(String(raw));
      if (edit && m.type === 'game.snapshot' && m.publicView?.podium) { edit(m.publicView); raw = JSON.stringify(m); }
      see(l, m); route.send(raw);
    });
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
  const started = Date.now();
  await page.setViewportSize({ width, height });
  for (const end = Date.now() + 3000; !(await page.evaluate(LAYOUT_SETTLED));) if (Date.now() > end) { log(`layout did not settle at ${width}×${height}`); break; }
  report.resizeMs.push(Date.now() - started);
}

// ---------- cameras ----------
const SETTLE_MS = 900, SETTLED_MS = 4500;
const miniKey = (mini: unknown) => mini && typeof mini === 'object' ? ['phase', 'stage', 'round', 'turn'].map(k => (mini as Record<string, unknown>)[k]).filter(x => typeof x === 'string' || typeof x === 'number').join('/') : '';
const phaseKey = (v: PackPublicView) => `${v.phase}${v.current ? `#${v.current.session} ${v.current.id}` : ''}${v.phase === 'mini' ? ` ${miniKey(v.mini)}` : ''}`;
/** A phase key without its session, round and turn: viewport sweeps run once per kind. */
const kindOf = (key: string) => key.replace(/#\d+/, '').replace(/\/.*$/, '');
const slug = (text: string) => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
const ordinals = new Map<string, number>(), swept = new Set<string>(), lifetimes: Record<string, number[]> = {};
const sweepMs = (l: Lens) => [...l.sweeps].sort((a, b) => a - b)[l.sweeps.length >> 1] ?? 0;
/** Whether `ms` more of capture work should finish before this key's phase ends, judged by how long its kind has lasted so far. */
function fits(l: Lens, key: string, ms: number) {
  const seen = [...lifetimes[kindOf(key)] ?? []].sort((a, b) => a - b);
  return !seen.length || seen[seen.length >> 1]! - (Date.now() - l.since) > ms;
}
/** Phase keys are numbered in order of first appearance on any page; TV and phone files of one key share the number. */
function ordinal(key: string) {
  let n = ordinals.get(key);
  if (!n) { ordinals.set(key, n = ordinals.size + 1); report.phases.push({ t: Date.now() - t0, key }); log(`phase ${key}`); }
  return n;
}
const lens = async (name: Lens['name'], page: Page, size: [number, number]): Promise<Lens> => ({ name, page, cdp: await page.context().newCDPSession(page), size, sweeps: [], room: '', snap: null, key: '', since: Date.now(), shot: '', settled: '', extras: [], hold: Promise.resolve() });
function see(l: Lens, m: { type: string; room?: Room; publicView?: PackPublicView }) {
  if ((m.type === 'room.welcome' || m.type === 'room.state') && m.room) l.room = m.room.phase;
  else if (m.type === 'game.snapshot' && m.publicView) l.snap = m.publicView;
  else return;
  const key = l.room === 'playing' && l.snap ? phaseKey(l.snap) : l.room;
  if (key === l.key) return;
  if (l.key && !report.shots.some(x => x.page === l.name && x.key === l.key && x.role !== 'sweep')) report.missed.push({ page: l.name, key: l.key, onScreenMs: Date.now() - l.since });
  if (l.name === 'phone') (lifetimes[kindOf(l.key)] ??= []).push(Date.now() - l.since);
  l.key = key; l.since = Date.now(); ordinal(key);
}
/** Runs `work` alone on that page: viewport sweeps never resize a page under a UI tap. */
function hold<T>(l: Lens, work: () => Promise<T>): Promise<T> {
  const run = l.hold.then(work); l.hold = run.catch(() => undefined); return run;
}
/** Shoots `key` if the page still shows it afterwards; a capture overtaken by a new phase is deleted. */
async function snap(l: Lens, key: string, file: string, role: string) {
  const started = Date.now(), onScreenMs = started - l.since;
  // CDP with optimizeForSpeed: a faster PNG encode than page.screenshot, which matters on a busy 10-player TV.
  writeFileSync(file, Buffer.from((await l.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64'));
  if (l.key !== key) { rmSync(file, { force: true }); report.discarded.push({ file, nowShowing: l.key }); log(`discarded ${file}: the ${l.name} moved on to ${l.key}`); return false; }
  report.shots.push({ t: started - t0, file, page: l.name, key, role, onScreenMs, captureMs: Date.now() - started });
  if (l.name === 'phone') {
    const overflow = await l.page.evaluate(OVERFLOW);
    if (overflow) { report.overflow.push({ shot: file, ...overflow }); log(`phone overflow in ${file}: ${JSON.stringify(overflow)}`); }
  }
  return true;
}
async function capture(l: Lens, key: string, suffix: string, sweep: boolean) {
  const stem = `${shots}/${String(ordinal(key)).padStart(3, '0')}-${slug(key)}${suffix ? `-${suffix}` : ''}`;
  if (!await snap(l, key, `${stem}-${l.name}.png`, suffix || 'phase') || !sweep) return;
  const sizes = l.name === 'tv' ? args['tv-viewports'] ? [[1280, 720]] : [] : args['phone-viewports'] ? [[320, 568], [667, 375]] : [], kind = `${l.name} ${kindOf(key)}`;
  if (!sizes.length || swept.has(kind) || !fits(l, key, sweepMs(l))) return;
  await hold(l, async () => {
    let ok = true;
    const started = Date.now();
    for (const [width, height] of sizes) if (ok) { await resize(l.page, width!, height!); ok = await snap(l, key, `${stem}-${l.name}-${width}x${height}.png`, 'sweep'); }
    await resize(l.page, ...l.size);
    l.sweeps.push(Date.now() - started);
    if (ok) swept.add(kind); // An overtaken sweep is retried on a later key of this kind that is expected to last long enough.
  });
}
let filming = true;
/** The camera loop: extras first, then the current key once settled, then (TV, --settled) its settled shot. Never queues a stale state. */
async function film(l: Lens) {
  while (filming) {
    const extra = l.extras.shift(), key = l.key, age = Date.now() - l.since;
    try {
      if (extra) await capture(l, key, extra.suffix, false).finally(extra.done);
      else if (key !== l.shot && age >= SETTLE_MS) { l.shot = key; await capture(l, key, '', true); }
      else if (args.settled && l.name === 'tv' && key === l.shot && l.settled !== key && age >= SETTLED_MS) { l.settled = key; if (fits(l, key, 1500)) await capture(l, key, 'settled', false); }
      else await sleep(100);
    } catch (error) { log(`${l.name} screenshot failed: ${(error as Error).message}`); await sleep(500); }
  }
}
/** An extra shot of whatever every page shows now (named `<key>-<suffix>`); resolves when taken or after `ms`. */
const extra = (suffix: string, ms = 10000) => Promise.all(lenses.map(l => new Promise<void>(done => { l.extras.push({ suffix, done }); setTimeout(done, ms); })));
/** Waits (at most `ms`) until every camera has shot the key its page shows. */
async function caughtUp(ms = 5000) { for (const end = Date.now() + ms; Date.now() < end && lenses.some(l => l.shot !== l.key);) await sleep(100); }
function lagSummary() {
  for (const name of ['tv', 'phone']) {
    const lags = report.shots.filter(s => s.page === name && s.role === 'phase').map(s => s.onScreenMs).sort((a, b) => a - b);
    const at = (q: number) => lags[Math.min(lags.length - 1, Math.floor(q * lags.length))] ?? 0;
    report.lag[name] = { shots: lags.length, p50: at(.5), p95: at(.95), max: lags.at(-1) ?? 0, missed: report.missed.filter(m => m.page === name).length };
  }
  const sizes = { tv: args['tv-viewports'], phone: args['phone-viewports'] };
  for (const l of lenses) if (sizes[l.name]) for (const kind of new Set(report.phases.map(p => kindOf(p.key)).filter(k => /^(menu|intro|mini|podium)/.test(k)))) if (!swept.has(`${l.name} ${kind}`)) {
    const seen = [...lifetimes[kind] ?? []].sort((a, b) => a - b);
    report.unswept.push({ page: l.name, kind, medianPhaseMs: seen[seen.length >> 1] ?? 0, medianSweepMs: sweepMs(l) });
  }
  log(`camera lag (ms on screen before the shot): ${JSON.stringify(report.lag)}; ${report.discarded.length} overtaken shots discarded${report.unswept.length ? `; phase kinds that never left time for a viewport sweep after their first shot: ${report.unswept.map(u => `${u.page} ${u.kind} (lasts ~${u.medianPhaseMs} ms; a sweep takes ~${u.medianSweepMs} ms)`).join(', ')}` : ''}`);
}

// ---------- audio ----------
/**
 * TV init script for --audio (a string, so tsx adds no helpers). Before the app loads it wraps fetch/decodeAudioData to tag
 * each AudioBuffer with its /music|sfx|vo/ URL and AudioNode.connect to track the graph. The first AudioContext that connects
 * to its destination gets an AudioWorklet recorder fed by everything connected to the destination (the mix) and by the deepest
 * node carrying only music, only sfx or only vo (stems). Chunks of [mixL, mixR, music, sfx, vo] float frames go to the driver
 * through __hjAudio; cues (from the page's own game snapshots), buffer starts/stops, speechSynthesis.speak calls and phases are
 * logged with the context clock, which is the recording's clock.
 */
const AUDIO_TAP = String.raw`(() => {
  const Native = window.AudioContext; if (!Native) return;
  const rec = window.__hjRec = { ctx: null, node: null, first: null, rate: 0, chunks: 0, events: [], pending: [], stems: {}, mix: new Set(), lastSeq: 0, key: '' };
  const urls = new WeakMap(), outs = new WeakMap(), ins = new WeakMap(), peaks = new WeakMap();
  const note = e => rec.events.push({ c: rec.ctx ? rec.ctx.currentTime : null, ...e });
  const kindOfUrl = url => (/\/(music|sfx|vo)\/[^/]+\.mp3/.exec(url || '') || [])[1] || '';
  const bucket = (map, key) => map.get(key) || (map.set(key, new Set()), map.get(key));
  const fetch0 = window.fetch;
  window.fetch = async function (...a) {
    const res = await fetch0.apply(this, a), url = res.url || String(a[0]);
    if (kindOfUrl(url)) { const read = res.arrayBuffer.bind(res); res.arrayBuffer = async () => { const data = await read(); urls.set(data, url); return data; }; }
    return res;
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ...rest) {
    const url = urls.get(data);
    return decode.call(this, data, ...rest).then(buffer => { if (url) urls.set(buffer, url); return buffer; });
  };
  const category = (node, path = new Set()) => {
    if (node instanceof AudioBufferSourceNode) return kindOfUrl(urls.get(node.buffer));
    if (path.has(node)) return ''; path.add(node);
    const kinds = new Set([...(ins.get(node) || [])].map(n => category(n, new Set(path))));
    return kinds.size === 1 ? [...kinds][0] : '';
  };
  const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
  const feed = (node, input) => { try { connect.call(node, rec.node, 0, input); } catch (e) { note({ type: 'tap-error', message: String(e) }); } };
  const watch = (from, to) => {
    if (to === from.context.destination) { start(from.context); if (from.context === rec.ctx && !rec.mix.has(from)) { rec.mix.add(from); if (rec.node) feed(from, 0); } }
    const kind = category(from);
    if (!kind || rec.stems[kind] || from.context !== rec.ctx) return;
    let node = from;
    for (let next; (next = [...(outs.get(node) || [])].find(n => category(n) === kind));) node = next;
    if (node instanceof AudioBufferSourceNode || ![...(outs.get(node) || [])].some(n => category(n) !== kind)) return;
    rec.stems[kind] = node; if (rec.node) feed(node, { music: 1, sfx: 2, vo: 3 }[kind]);
    note({ type: 'stem', kind });
  };
  AudioNode.prototype.connect = function (to, ...rest) {
    const result = connect.call(this, to, ...rest);
    try { if (to instanceof AudioNode) { bucket(outs, this).add(to); bucket(ins, to).add(this); watch(this, to); } } catch (e) { note({ type: 'tap-error', message: String(e) }); }
    return result;
  };
  AudioNode.prototype.disconnect = function (...a) {
    const result = disconnect.apply(this, a);
    for (const to of a[0] instanceof AudioNode ? [a[0]] : a.length ? [] : [...(outs.get(this) || [])]) { ins.get(to)?.delete(this); outs.get(this)?.delete(to); }
    return result;
  };
  const peakOf = buffer => {
    if (!peaks.has(buffer)) { let p = 0; for (let ch = 0; ch < buffer.numberOfChannels; ch++) for (const x of buffer.getChannelData(ch)) if (Math.abs(x) > p) p = Math.abs(x); peaks.set(buffer, p); }
    return peaks.get(buffer);
  };
  const play = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    const url = urls.get(this.buffer);
    if (url && this.context === rec.ctx) note({ type: 'start', at: Math.max(when, this.context.currentTime), offset: rest[0] ?? 0, url, kind: kindOfUrl(url), dur: this.buffer.duration, loop: this.loop, peak: peakOf(this.buffer) });
    return play.call(this, when, ...rest);
  };
  AudioBufferSourceNode.prototype.stop = function (when = 0) {
    const url = urls.get(this.buffer);
    if (url && this.context === rec.ctx) note({ type: 'stop', at: Math.max(when, this.context.currentTime), url, kind: kindOfUrl(url) });
    return stop.call(this, when);
  };
  if (window.speechSynthesis) { const speak = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = u => { note({ type: 'speak', text: u.text }); return speak(u); }; }
  const WORKLET = 'class T extends AudioWorkletProcessor { constructor() { super(); this.size = 8192; this.buf = new Float32Array(this.size * 5); this.n = 0; this.at = -1; this.port.onmessage = () => this.flush(); }' +
    ' flush() { if (!this.n) return; const out = this.buf.slice(0, this.n * 5); this.port.postMessage({ at: this.at, frames: this.n, data: out.buffer }, [out.buffer]); this.n = 0; this.at = -1; }' +
    ' process(inputs) { const len = 128; if (this.at < 0) this.at = currentFrame; const ch = i => inputs[i] || [], mono = (i, k) => { const c = ch(i); return c.length ? (c.length > 1 ? (c[0][k] + c[1][k]) / 2 : c[0][k]) : 0; };' +
    ' const L = ch(0)[0], R = ch(0)[1] || L; for (let k = 0; k < len; k++) { const o = (this.n + k) * 5; this.buf[o] = L ? L[k] : 0; this.buf[o + 1] = R ? R[k] : 0; this.buf[o + 2] = mono(1, k); this.buf[o + 3] = mono(2, k); this.buf[o + 4] = mono(3, k); }' +
    ' this.n += len; if (this.n >= this.size) this.flush(); return true; } } registerProcessor("hj-tap", T);';
  const start = ctx => {
    if (rec.ctx) return; rec.ctx = ctx; rec.rate = ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    ctx.audioWorklet.addModule(url).then(() => {
      const node = rec.node = new AudioWorkletNode(ctx, 'hj-tap', { numberOfInputs: 4, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
      node.port.onmessage = e => {
        const { at, frames, data } = e.data;
        if (rec.first === null) rec.first = at;
        const bytes = new Uint8Array(data); let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        rec.pending.push(window.__hjAudio(rec.chunks++, at, frames, btoa(text)));
      };
      for (const n of rec.mix) feed(n, 0);
      for (const [kind, n] of Object.entries(rec.stems)) feed(n, { music: 1, sfx: 2, vo: 3 }[kind]);
      note({ type: 'recorder', state: ctx.state, rate: ctx.sampleRate });
    }, e => note({ type: 'tap-error', message: 'worklet: ' + e }));
  };
  rec.flush = async () => { rec.node?.port.postMessage('flush'); await new Promise(r => setTimeout(r, 400)); await Promise.all(rec.pending); return { first: rec.first, rate: rec.rate, chunks: rec.chunks, state: rec.ctx?.state ?? 'none', events: rec.events }; };
  const seeView = v => {
    if (!v) return;
    for (const cue of [...(v.cues || [])].sort((a, b) => a.seq - b.seq)) if (cue.seq > rec.lastSeq) { rec.lastSeq = cue.seq; note({ type: 'cue', seq: cue.seq, kind: cue.kind, id: cue.id, serverAt: cue.at }); }
    const mini = v.mini && typeof v.mini === 'object' ? v.mini.phase || v.mini.stage || '' : '';
    const key = v.phase + (v.current ? ' ' + v.current.id : '') + (v.phase === 'mini' && mini ? ' ' + mini : '') + ' | music ' + v.music;
    if (key !== rec.key) { rec.key = key; note({ type: 'phase', phase: v.phase, game: v.current?.id ?? null, mini, music: v.music }); }
  };
  const WS = window.WebSocket;
  window.WebSocket = class extends WS { constructor(...a) { super(...a); this.addEventListener('message', e => { try { const m = JSON.parse(e.data); if (m.type === 'game.snapshot') seeView(m.publicView); else if ((m.type === 'room.state' || m.type === 'room.welcome') && m.room?.phase !== rec.room) note({ type: 'room', phase: rec.room = m.room?.phase }); } catch {} }); } };
})();`;

/** Streams the TV recorder's chunks into a raw float file; finish() writes the WAV, the stems WAV and the cue log. */
async function recordAudio(page: Page, wav: string) {
  mkdirSync(dirname(wav), { recursive: true });
  const raw = `${wav}.raw`, out = createWriteStream(raw), waiting = new Map<number, { at: number; n: number; data: Buffer }>();
  let next = 0, frames = 0, expected: number | null = null;
  const gaps: { at: number; frames: number }[] = [];
  // Chunks are written in order; frames the worklet skipped become silence, so the file stays on the context clock.
  await page.exposeFunction('__hjAudio', (seq: number, at: number, n: number, data: string) => {
    waiting.set(seq, { at, n, data: Buffer.from(data, 'base64') });
    for (let chunk; (chunk = waiting.get(next));) {
      if (expected !== null && chunk.at > expected) { gaps.push({ at: expected, frames: chunk.at - expected }); out.write(Buffer.alloc((chunk.at - expected) * 20)); frames += chunk.at - expected; }
      out.write(chunk.data); frames += chunk.n; expected = chunk.at + chunk.n; waiting.delete(next++);
    }
  });
  await page.addInitScript({ content: AUDIO_TAP });
  return {
    frames: () => frames,
    async finish() {
      const tap = await page.evaluate('window.__hjRec ? window.__hjRec.flush() : null').catch(() => null) as { first: number | null; rate: number; chunks: number; state: string; events: { c: number | null; type: string; at?: number }[] } | null;
      await new Promise(done => out.end(done));
      if (!tap?.rate || !frames) { rmSync(raw, { force: true }); throw new Error(`No audio was recorded (AudioContext ${tap?.state ?? 'missing'}).`); }
      const first = tap.first! / tap.rate, base = wav.replace(/\.wav$/i, '');
      // Every event is placed on the recording's clock: context seconds minus the first recorded frame.
      const events = tap.events.filter(e => e.c !== null).map(e => ({ t: +(e.c! - first).toFixed(3), ...e, c: undefined, ...(e.at !== undefined ? { at: +(e.at - first).toFixed(3) } : {}) }));
      const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(tap.rate), '-ac', '5', '-i', raw,
        '-filter_complex', '[0]pan=stereo|c0=c0|c1=c1[mix];[0]pan=3.0|c0=c2|c1=c3|c2=c4[stems]', '-map', '[mix]', '-c:a', 'pcm_f32le', wav, '-map', '[stems]', '-c:a', 'pcm_f32le', `${base}.stems.wav`], { encoding: 'utf8' });
      if (ff.status !== 0) throw new Error(`ffmpeg could not write ${wav}: ${ff.stderr}`);
      rmSync(raw, { force: true });
      const summary = { wav, stems: `${base}.stems.wav`, cues: `${base}.cues.json`, rate: tap.rate, seconds: +(frames / tap.rate).toFixed(2), gaps, stemChannels: ['music', 'sfx', 'vo'] };
      writeFileSync(summary.cues, JSON.stringify({ ...summary, game, players: count, events }, null, 1));
      log(`audio: ${summary.seconds} s at ${tap.rate} Hz → ${wav} (+ stems, cue log; ${events.filter(e => e.type === 'cue').length} cues, ${gaps.length} frame gaps)`);
      return summary;
    },
  };
}

// ---------- podium stress ----------
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
async function until(test: () => boolean, ms: number, what: string) {
  for (const end = Date.now() + ms; !test();) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`); await sleep(100); }
}

async function cleanup() {
  for (const ws of sockets) ws.terminate();
  await browser?.close().catch(() => undefined); browser = null;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });

let tv: Page = null, phone: Page = null, failure: Error | null = null, tvLens: Lens, phoneLens: Lens, recorder: Awaited<ReturnType<typeof recordAudio>> | null = null;
const lenses: Lens[] = [], cameras: Promise<void>[] = [];
const agents: Agent[] = [], you = agent('phone');
const loop = setInterval(() => { for (const a of agents) void step(a, a === you ? phone : null).catch(error => { failure ??= error; }); }, 100);
/** A real tap on the phone that never lands mid-sweep. */
const tap = (work: () => Promise<unknown>) => hold(phoneLens, work);
try {
  browser = await chromium.launch({ headless: true, args: args.audio ? ['--autoplay-policy=no-user-gesture-required'] : [] });
  tv = await newPage({ width: 1920, height: 1080 }, 'tv', false);
  tvLens = await lens('tv', tv, [1920, 1080]);
  await tapTv(tv, tvLens, args['stress-podium'] ? stressPodium : null);
  if (args.audio) recorder = await recordAudio(tv, args.audio);
  await tv.goto(`${base}/?game=hijinks`);
  await tv.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  await tv.getByRole('button', { name: 'Play on this screen', exact: true }).first().click();
  const code = report.code = (await tv.locator('.kp-code').first().textContent({ timeout: 20000 })).trim();
  log(`room ${code} on ${base}`);
  if (args['read-aloud']) { // Before anyone joins: applying settings re-selects the game.
    await tv.getByRole('button', { name: 'Settings', exact: true }).click();
    await tv.getByRole('switch', { name: 'Read answers aloud on the TV', exact: true }).click();
    await tv.getByRole('button', { name: 'Apply settings', exact: true }).click();
  }
  if (recorder) {
    await tv.locator('.kp-code').first().click(); // A real gesture, so the mixer would unlock even without the autoplay flag.
    await until(() => recorder!.frames() > 0, 15000, 'TV audio to start recording');
  }

  phone = await newPage({ width: 390, height: 844 }, 'phone', true);
  phoneLens = await lens('phone', phone, [390, 844]);
  await tapPhone(phone, you, phoneLens); agents.push(you);
  await phone.goto(`${base}/?join=${code}`);
  await phone.getByRole('textbox', { name: 'Your name' }).fill('Phone Tester');
  await phone.getByRole('button', { name: 'Join the room', exact: true }).click();
  await phone.getByRole('button', { name: 'I’m ready!', exact: true }).click({ timeout: 20000 });
  lenses.push(tvLens, phoneLens); cameras.push(film(tvLens), film(phoneLens));
  const names = ['Captain Pickles', 'Bartholomew Fizz', 'Ms. Wobbleton', 'Zed', 'Agent Sprinkles', 'Gertrude Q. Hoot', 'Noodle', 'Mo', 'Dot'];
  for (let i = 1; i < count; i++) agents.push(await joinBot(i, names[i - 1]!, code));
  await until(() => !!room && room.players.length === count && room.players.every(p => p.ready), 20000, 'every seat to be ready');
  await extra('ready');
  await hold(tvLens, () => tv.getByRole('button', { name: 'Start game', exact: true }).click({ timeout: 20000 }));

  const view = () => you.snap?.publicView;
  await until(() => view()?.phase === 'menu', 30000, 'the game menu');
  if (info) {
    await caughtUp();
    await tap(() => phone.getByRole('radio', { name: new RegExp(`^${info.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`) }).first().click()); // 7+ games: it can also sit under Room favourites
    await until(() => view()?.phase !== 'menu' || Object.keys(view()?.menu?.votes ?? {}).length === count, 15000, 'everyone to vote');
    if (view()?.phase === 'menu') await tap(() => phone.getByRole('button', { name: 'Lock it in', exact: true }).click()).catch(() => log('lock: the countdown won'));
    await until(() => view()?.phase === 'intro', 15000, 'the intro');
    if (!recorder) { // A recording keeps the whole narrated intro.
      await sleep(3000); await caughtUp();
      if (view()?.phase === 'intro') await tap(() => phone.getByRole('button', { name: 'Skip intro for everyone', exact: true }).click()).catch(() => log('skip: intro already over'));
    }
    await until(() => view()?.phase === 'mini', 60000, 'the minigame');
    await until(() => !!failure || view()?.phase === 'podium', Number(args['max-minutes']) * 60000, 'the podium');
    if (failure) throw failure;
    await sleep(5000); await extra('settled'); // after the last award row lands (~4.8 s)
    if (!recorder && view()?.phase === 'podium') await tap(() => phone.getByRole('button', { name: 'Continue to the menu', exact: true }).click()).catch(() => log('continue: podium already over'));
    await until(() => view()?.phase === 'menu', 30000, 'the menu after the podium');
  }
  await sleep(1500); await caughtUp();
  await tap(() => phone.getByRole('button', { name: 'End the night', exact: true }).click());
  await tap(() => phone.getByRole('button', { name: 'Tap again to end the night', exact: true }).click());
  await until(() => room?.phase === 'results', 20000, 'results');
  log('night over: results');
  await sleep(2500); await extra('results');
  if (recorder) await sleep(5000); // the finale theme
  if (args['keep-open']) { log(`keeping room ${code} open on ${base}; press Ctrl+C to close everything`); await new Promise(() => undefined); }
} catch (error) {
  failure = error as Error;
  if (lenses.length) await extra('error', 5000);
} finally {
  clearInterval(loop);
  filming = false; await Promise.all(cameras);
  if (recorder) report.audio = await recorder.finish().catch(error => { failure ??= error; return null; });
  lagSummary();
  writeFileSync(`${shots}/log.json`, JSON.stringify({ ...report, failure: failure?.message ?? null }, null, 2));
  log(`actions ${JSON.stringify(report.actions)}`);
  log(`${report.shots.length} screenshots and log.json in ${shots}${report.errors.length ? `; ${report.errors.length} page/socket errors` : ''}`);
  await cleanup();
}
if (failure) { console.error(failure); process.exit(1); }
process.exit(0);
