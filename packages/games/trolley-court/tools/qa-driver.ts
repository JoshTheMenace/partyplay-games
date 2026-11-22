/**
 * Trolley Court live QA driver (Node only, never imported by the client). One TV page, real phone pages that join and play
 * through the UI, and socket bots for the rest of the roster (3–64 seats).
 *
 *   node --import tsx packages/games/trolley-court/tools/qa-driver.ts --port 4381 --players 3 [--phones 3] [--long-names]
 *     [--settings '{"laps":1}'] [--pile] [--idle] [--replay] [--rounds N] [--shots output/playwright/trolley-court/<run>]
 *
 * - TV (headless, 1920×1080) adds the game to the library, plays on this screen, applies --settings and starts the room.
 * - Phones (390×844, touch) join through the join form, tap Ready to play and then play every turn with real taps: pick a
 *   card (the write-in first, typed in full), aim twists, Lock it in; as Conductor lean the lever, Next speaker, and
 *   press-and-hold a verdict; in the Gallery (11+ players) stand on a track, vote and aim the Gallery's twist, heckle and
 *   hop once during the pleas. Bots join over WebSockets and play with src/bot.ts after a short human beat, and heckle.
 * - log.json also records, per seat, the bytes received (average and busiest 5 s), the length of every case, and for each
 *   real phone the longest stretch with no enabled control on screen. lostTaps counts phone taps that gave up because
 *   the control had just gone away (a teammate locked first, the phase moved on); they are races, not errors.
 * - --pile aims every twist at North's Bystander (stress test). --idle: nobody acts in round 1 (every timer runs out, one
 *   phone only proposes); in round 2 one team phone goes offline for the Innocent pick and the Conductor's phone goes
 *   offline for the floors (24 s: the server notices a dead socket after 10–15 s). --rounds N stops after N rounds. --replay taps Play again on results and starts round 1 again.
 * - Every new phase key is shot on the TV (plus a 1280×720 sweep per phase kind) and on each phone (plus 320×568, 667×375 and
 *   844×390 sweeps per phase kind and role). log.json records phases, actions with acks, layout checks and page errors.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { SnapshotDecoder } from '../../../party-contract/src/snapshot-cache';
import { botAction } from '../src/bot';
import { manifest } from '../src/manifest';
import { courtIdFor, type Action, type PrivateView, type PublicView } from '../src/types';

const { values: args } = parseArgs({ options: {
  port: { type: 'string' }, players: { type: 'string', default: '3' }, phones: { type: 'string' }, 'long-names': { type: 'boolean', default: false },
  settings: { type: 'string', default: '{}' }, pile: { type: 'boolean', default: false }, idle: { type: 'boolean', default: false },
  replay: { type: 'boolean', default: false }, rounds: { type: 'string' }, shots: { type: 'string' }, 'max-minutes': { type: 'string', default: '30' },
} });
const count = Number(args.players), phoneCount = Math.min(count, Number(args.phones ?? Math.min(count, 3))), base = `http://127.0.0.1:${args.port}`, t0 = Date.now();
if (!args.port || !(count >= 3 && count <= manifest.players.max)) throw new Error('Usage: qa-driver.ts --port <port> --players <3-64> [...]');
const shots = args.shots ?? `output/playwright/trolley-court/qa-${new Date().toISOString().replace(/[:.]/g, '-')}`, stopAfter = Number(args.rounds ?? Infinity);
mkdirSync(shots, { recursive: true });
const { chromium } = createRequire(`${process.env.PLAYWRIGHT_CORE ?? `${process.env.HOME}/.local/opt/pw/node_modules`}/`)('playwright-core');
type Page = any; // Playwright is loaded untyped from outside the project.
type Snap = { roundId: string; serverTime: number; publicView: PublicView; privateView: PrivateView | null };
type Ack = { accepted: boolean; reason?: string };
type Seat = { label: string; page: Page | null; id: string; snap: Snap | null; at: number; room: string; busy: boolean; key: string; since: number; shot: string; mem: Record<string, unknown>; lock: Promise<unknown>; send?(a: Action): Promise<Ack>;
  decoder: SnapshotDecoder; resync?(roundId: string): void; bytes: number; frames: number; buckets: Map<number, number>; resultsAt: number; idle: { longest: number; from: string; to: string; total: number; watched: number } };

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const log = (...parts: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...parts);
const report = { base, players: count, phones: phoneCount, settings: JSON.parse(args.settings!), code: '', phases: [] as string[], times: [] as [string, number][], cases: [] as { round: number; seconds: number }[], lostTaps: 0, traffic: {} as Record<string, unknown>, idle: {} as Record<string, unknown>, actions: {} as Record<string, { accepted: Record<string, number>; rejected: Record<string, number> }>, errors: [] as string[], shots: [] as string[], layout: [] as unknown[], notes: [] as string[] };
const SHORT = ['Mika', 'Jonah', 'Ana', 'Sam', 'Lee', 'Rui', 'Ola', 'Kit', 'Bo', 'Zed'];
const LONG = ['Bartholomew Fizz', 'Gertrude Q. Hoot', 'Wilhelmina Wobb', 'Maximilian Moss', 'Ottoline Pepper', 'Barnaby Quibble', 'Clementine Zest', 'Percival Plonkk', 'Henrietta Huffy', 'Montgomery Mops'];
const WRITE_INS = ['A tap-dancing accountant who audits the moon every Tuesday', 'Gran, who knits scarves for lampposts', 'A pigeon with a law degree and no regrets at all whatsoever'];
const names = Array.from({ length: count }, (_, i) => i < 10 ? (args['long-names'] ? LONG : SHORT)[i] : args['long-names'] ? `${LONG[i % 10].slice(0, 14)}${String(i).padStart(2, '0')}` : `${SHORT[i % 10]} ${String.fromCharCode(64 + Math.floor(i / 10))}${i % 7}`);
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
const record = (label: string, kind: string, ack: Ack) => { const s = report.actions[label] ??= { accepted: {}, rejected: {} }; if (ack.accepted) bump(s.accepted, kind); else { bump(s.rejected, `${kind}: ${ack.reason}`); log(`${label} rejected ${kind}: ${ack.reason}`); } };
const seat = (label: string, page: Page | null): Seat => ({ label, page, id: '', snap: null, at: 0, room: '', busy: false, key: '', since: 0, shot: '', mem: {}, lock: Promise.resolve(), decoder: new SnapshotDecoder(), bytes: 0, frames: 0, buckets: new Map(), resultsAt: 0, idle: { longest: 0, from: '', to: '', total: 0, watched: 0 } });
const now = (s: Seat) => s.snap ? s.snap.serverTime + Date.now() - s.at : Date.now();
/** Runs work alone on a page: a viewport sweep never resizes a page under a tap. */
const hold = <T>(s: Seat, work: () => Promise<T>): Promise<T> => { const run = s.lock.then(work); s.lock = run.catch(() => undefined); return run; };
function onMessage(s: Seat, raw: string) {
  const m = JSON.parse(raw), bucket = Math.floor((Date.now() - t0) / 5000);
  s.bytes += raw.length; s.frames++; s.buckets.set(bucket, (s.buckets.get(bucket) ?? 0) + raw.length);
  if (m.type === 'room.welcome') { s.id = m.playerId ?? ''; s.room = m.room.phase; }
  else if (m.type === 'room.state') s.room = m.room.phase;
  else if (m.type === 'game.snapshot' || m.type === 'round.results') {
    if (m.type === 'round.results' && !s.resultsAt) s.resultsAt = Date.now();
    // The room sends the heavy public fields only when they change (manifest.snapshotCache); decode as a phone does.
    const full = s.decoder.decode(m, manifest.snapshotCache);
    if (full) { s.snap = full as Snap; s.at = Date.now(); } else s.resync?.(m.roundId);
    // Phase times come from the TV's own snapshots, so a slow screenshot never shifts them.
    const v = s === tv && m.type === 'game.snapshot' ? s.snap?.publicView : null, beat = v ? `r${v.round}-${v.phase}-${v.step}` : '';
    if (beat && beat !== lastBeat) { lastBeat = beat; report.times.push([beat, +((Date.now() - t0) / 1000).toFixed(1)]); }
  }
  return m;
}

let browser: Page = null, tv = seat('tv', null), failure: Error | null = null, lastBeat = '';
const sockets: WebSocket[] = [], seats: Seat[] = [];
async function newPage(viewport: { width: number; height: number }, label: string, mobile: boolean) {
  const page = await (await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })).newPage();
  page.setDefaultTimeout(60000);
  page.on('console', (m: Page) => { if (m.type() === 'error') report.errors.push(`${label} console: ${m.text()}`); });
  page.on('pageerror', (e: Error) => { report.errors.push(`${label} pageerror: ${e.message}`); log(`${label} pageerror: ${e.message}`); });
  return page;
}
/** Watches a page's own socket: snapshots and acks for the actions its UI sent. */
function tap(s: Seat) {
  const kinds = new Map<string, string>();
  s.page.on('websocket', (ws: Page) => {
    ws.on('framesent', (f: Page) => { try { const m = JSON.parse(f.payload); if (m.type === 'game.action') kinds.set(m.actionId, m.payload.kind); } catch { /* not JSON */ } });
    ws.on('framereceived', (f: Page) => { try { const m = onMessage(s, f.payload); if (m.type === 'action.ack' && kinds.has(m.actionId)) { record(s.label, kinds.get(m.actionId)!, m); kinds.delete(m.actionId); } } catch { /* not JSON */ } });
  });
}
async function joinBot(i: number, name: string, code: string) {
  const s = seat(`bot${i}`, null), ws = new WebSocket(`ws://127.0.0.1:${args.port}/ws`), acks = new Map<string, (a: Ack) => void>();
  sockets.push(ws);
  const wire = (type: string, payload: object = {}) => ws.send(JSON.stringify({ v: '1.0', type, ...payload }));
  let seq = 0, round = '', readied = false;
  s.resync = roundId => wire('snapshot.sync', { roundId });
  ws.on('message', data => {
    const m = onMessage(s, String(data));
    // Ready once per lobby, so a replay readies again and a refusal never becomes a retry loop.
    if (m.type === 'room.welcome' || m.type === 'room.state') { if (m.room.phase !== 'lobby') readied = false; else if (!readied && !m.room.players.find((p: Page) => p.id === s.id)?.ready) { readied = true; wire('room.ready', { ready: true, lobbyId: m.room.lobbyId }); } }
    if (m.type === 'round.prepare') { wire('round.ready', { roundId: m.roundId }); round = m.roundId; seq = 0; s.decoder.reset(); }
    if (m.type === 'action.ack') { acks.get(m.actionId)?.(m); acks.delete(m.actionId); }
    if (m.type === 'error') report.errors.push(`${s.label}: ${m.reason}`);
  });
  s.send = action => new Promise(done => { const actionId = String(++seq); acks.set(actionId, done); wire('game.action', { roundId: s.snap?.roundId ?? round, actionId, retireThrough: seq - 1, payload: action }); });
  await new Promise((done, fail) => { ws.once('open', done); ws.once('error', fail); });
  wire('room.join', { code, role: 'controller', name });
  return s;
}

// ---------- policies ----------
const idleNow = (v: PublicView) => args.idle && v.round <= 2;
async function botStep(s: Seat) {
  const v = s.snap?.publicView, mine = s.snap?.privateView;
  if (!v || !mine || s.room !== 'playing' || idleNow(v)) return;
  const beat = `${v.turnId}:${v.step}`;
  if (s.mem.beat !== beat) { s.mem.beat = beat; s.mem.wait = Date.now() + 1200 + Math.random() * 3500; }
  if (Date.now() < (s.mem.wait as number)) return;
  let a = botAction(v, mine, s.id, Math.random, now(s));
  // Bots heckle now and then during the pleas and the decision.
  if (!a && mine.role !== 'conductor' && (v.phase === 'plead' || v.phase === 'lever') && Math.random() < .12) a = { kind: 'shout', turnId: courtIdFor(v.round), shout: pick(['hear', 'objection', 'boo', 'mercy'] as const) };
  if (!a) { s.mem.wait = Date.now() + 700; return; }
  if (args.pile && 'target' in a && a.target) a = { ...a, target: { side: 'north', slot: 0 } };
  const ack = await s.send!(a); record(s.label, a.kind, ack);
  s.mem.wait = Date.now() + (ack.accepted ? 400 + Math.random() * 900 : 1500);
}
const enabled = async (loc: Page) => await loc.count() > 0 && await loc.first().isEnabled().catch(() => false);
/** Optional taps (heckles, hops, ballots) give up quickly if the control has just gone away. */
const quick = { timeout: 3000 };
/** One real UI step per call on a phone page. */
async function phoneStep(s: Seat) {
  const v = s.snap?.publicView, mine = s.snap?.privateView, p = s.page;
  if (!v || !mine || s.room !== 'playing') return;
  const beat = `${v.turnId}:${v.step}`, t = now(s);
  if (s.mem.beat !== beat) { const { offline, offAt, dropped, proposed, leaned, voted, hopped, heckled, early } = s.mem; s.mem = { beat, wait: Date.now() + 1500 + Math.random() * 1500, offline, offAt, dropped, proposed, voted, hopped, heckled, early, leaned: leaned === v.round ? leaned : 0 }; }
  if (Date.now() < (s.mem.wait as number) || t >= v.deadline - 600) return;
  const later = (ms: number) => { s.mem.wait = Date.now() + ms; };
  if (args.idle && v.round === 1) {
    // Round 1: one phone suggests a card and never locks (auto-pick prefers it); everyone else lets the timers run out.
    if (s === seats.find(x => x.page && x.snap?.privateView?.role === 'team') && v.phase === 'innocent' && !s.mem.proposed) { s.mem.proposed = true; await p.locator('.tc-hand-card:not([disabled])').first().click(); await extra(s, 'proposed-only'); }
    return;
  }
  if (args.idle && v.round === 2) return idleRound2(s, v, mine);
  if (mine.role === 'team' && mine.slots.some(x => !x.locked) && ['innocent', 'guilty', 'modifier'].includes(v.phase)) {
    const chosen = p.locator('.tc-hand-card[aria-pressed="true"]');
    if (!await chosen.count()) {
      const cards = p.locator('.tc-hand-card:not([disabled])'), blank = p.locator('.tc-hand-card:not([disabled]):has(.tc-card[data-blank])');
      if (!await cards.count()) return later(500);
      await (await blank.count() ? blank.first() : cards.nth(Math.floor(Math.random() * await cards.count()))).click();
      await extra(s, 'chosen'); return later(900 + Math.random() * 900);
    }
    const input = p.locator('.tc-write input');
    if (await input.count() && !(await input.inputValue())) { await input.pressSequentially(pick(WRITE_INS), { delay: 8 }); await extra(s, 'write-in'); return later(900); }
    const targets = p.locator('.tc-target:not([disabled])');
    if (await targets.count() && !await p.locator('.tc-target[aria-pressed="true"]').count()) {
      await (args.pile ? p.locator('.tc-target-row[data-side="north"] .tc-target').first() : targets.nth(Math.floor(Math.random() * await targets.count()))).click();
      await extra(s, 'aimed'); return later(800);
    }
    const lock = p.getByRole('button', { name: 'Lock it in', exact: true });
    if (await enabled(lock)) { await lock.click(); await sleep(700); await extra(s, 'locked'); return later(1200); }
    return later(500);
  }
  if (mine.role === 'gallery') {
    // The Gallery: take a track, vote for a twist, aim it, heckle, and hop once while the teams plead.
    const ballot = p.locator(v.phase === 'guilty' ? '.tc-ballot .tc-hand-card:not([disabled])' : '.tc-ballot .tc-target:not([disabled])');
    if ((v.phase === 'guilty' || v.phase === 'modifier') && s.mem.voted !== v.turnId && await ballot.count()) { s.mem.voted = v.turnId; await ballot.nth(Math.floor(Math.random() * await ballot.count())).click(quick).catch(() => undefined); await extra(s, 'voted'); return later(900); }
    const stand = p.locator('.tc-stand-btn:not([disabled])');
    if (!mine.side && !args.idle && await stand.count()) { await stand.nth(Math.floor(Math.random() * 2)).click(quick).catch(() => undefined); await extra(s, 'stood'); return later(900); }
    if (v.phase === 'plead' && s.mem.hopped !== v.round && t > v.startedAt + 2500) { s.mem.hopped = v.round; const other = p.locator('.tc-stand-btn[aria-pressed="false"]:not([disabled])'); if (await other.count()) { await other.first().click(quick).catch(() => undefined); await extra(s, 'hopped'); } return later(1200); }
    const shout = p.locator('.tc-shoutbar button:not([disabled])');
    if ((v.phase === 'plead' || v.phase === 'lever') && await shout.count() && Math.random() < .5) { await shout.nth(Math.floor(Math.random() * 4)).click(quick).catch(() => undefined); await extra(s, 'heckled'); return later(2500); }
    return later(700);
  }
  if (mine.role === 'team' && v.phase === 'plead' && s.mem.heckled !== v.turnId + v.step) { s.mem.heckled = v.turnId + v.step; const shout = p.locator('.tc-shoutbar button:not([disabled])'); if (await shout.count()) { await shout.nth(1).click(quick).catch(() => undefined); await extra(s, 'heckled'); } return later(1500); }
  if (mine.role !== 'conductor') return;
  if (v.phase === 'innocentReveal' && s.mem.early !== v.round) { s.mem.early = v.round; await p.locator('.tc-switch').click(quick).catch(() => undefined); await extra(s, 'early-lean'); return later(1500); }
  if (v.phase === 'plead') {
    if (v.step === 0 && s.mem.leaned !== v.round) { s.mem.leaned = v.round; await p.locator('.tc-switch').click(); await extra(s, 'leaned'); return later(2500 + Math.random() * 3000); }
    const next = p.getByRole('button', { name: /^(Next speaker|To the lever)/ });
    if (await enabled(next) && t > v.startedAt + 6500 + Math.random() * 2000) { await next.click(); return later(1500); }
  }
  if (v.phase === 'lever' && !v.lever.decided && t > v.startedAt + 3000) {
    const button = p.getByRole('button', { name: Math.random() < .5 ? /^Pull the lever/ : /^Do nothing/ });
    if (!await enabled(button)) return later(500);
    const box = await button.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await sleep(450);
    await extra(s, 'holding'); await sleep(900); await p.mouse.up(); return later(3000);
  }
}
/** --idle round 2: a team phone drops for the Innocent pick (its team auto-picks, the other team's lock ends the phase early); the Conductor drops during the floors. */
async function idleRound2(s: Seat, v: PublicView, mine: PrivateView) {
  const ctx = s.page.context(), offline = (on: boolean, why: string) => { s.mem.offline = on; s.mem.offAt = Date.now(); report.notes.push(`${s.label} ${on ? 'offline' : 'online'} at ${v.turnId}: ${why}`); log(`${s.label} ${on ? 'offline' : 'online'}`); return ctx.setOffline(on); };
  const teamPhones = seats.filter(x => x.page && x.snap?.privateView?.role === 'team'), dropper = teamPhones[0];
  if (v.phase === 'innocent' && s === dropper && !s.mem.dropped) { s.mem.dropped = true; return offline(true, 'team phone leaves before the Innocent pick'); }
  if (v.phase === 'innocent' && s !== dropper && mine.role === 'team') {
    if (!await s.page.locator('.tc-hand-card[aria-pressed="true"]').count()) return void await s.page.locator('.tc-hand-card:not([disabled])').first().click();
    const lock = s.page.getByRole('button', { name: 'Lock it in', exact: true });
    if (await enabled(lock)) { await lock.click(); await sleep(600); await extra(s, 'locked-alone'); }
  }
  // Offline pages see no new snapshots, so they come back on a timer.
  if (s.mem.offline && Date.now() - (s.mem.offAt as number) > (mine.role === 'team' ? 16000 : 24000)) await offline(false, 'back online');
  if (v.phase === 'plead' && mine.role === 'conductor' && !s.mem.offline && s.mem.dropped !== 'conductor') { s.mem.dropped = 'conductor'; await offline(true, 'Conductor leaves during the first floor'); }
}

// ---------- cameras ----------
const PHONE_SIZES = [[320, 568], [667, 375], [844, 390]], swept = new Set<string>();
const keyOf = (s: Seat) => {
  const v = s.snap?.publicView;
  if (s.room !== 'playing' || !v) return s.room;
  const role = s.page && s !== tv ? `-${s.snap?.privateView?.role ?? 'none'}` : '';
  const progress = s === tv && ['innocent', 'guilty', 'modifier'].includes(v.phase) ? `-${v.progress.north.locked}${v.progress.south.locked}` : '';
  return `r${v.round}-${v.phase}-${v.step}${progress}${role}`;
};
const kindOf = (s: Seat, key: string) => `${s === tv ? 'tv' : 'phone'} ${key.replace(/^r\d+-/, '').replace(/-\d+(-\d\d)?(?=-|$)/, '')}`;
const wanted = (s: Seat) => {
  const v = s.snap?.publicView; if (!v || s.room !== 'playing') return true;
  return v.round <= Math.min(3, v.rounds) || v.round === v.rounds || v.phase === 'crash' || (s === tv && v.phase === 'complete');
};
/** Layout checks on the current page: overflow, small targets and clipped TV text. No named inner functions: tsx would inject __name. */
const CHECKS = () => {
  const root = document.documentElement, out: string[] = [];
  if (root.scrollWidth > root.clientWidth + 1) out.push(`page overflows horizontally ${root.scrollWidth}>${root.clientWidth}`);
  for (const b of document.querySelectorAll('.tc button, .tc [role=switch]')) { const r = b.getBoundingClientRect(); if (r.width && r.height && (r.height < 44 || r.width < 44) && !b.closest('.tc-stage')) out.push(`small target "${(b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`); }
  const stage = document.querySelector('.tc-stage');
  if (stage) for (const el of stage.querySelectorAll('.tc-slot .tc-card-text, .tc-mods, .tc-plate, .tc-board, .tc-tally, .tc-strip>p, .tc-top-judge, .tc-banner>p')) {
    const e = el as HTMLElement;
    if (e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY !== 'auto') out.push(`clipped ${e.className} "${(e.textContent ?? '').slice(0, 30)}" ${e.scrollHeight}>${e.clientHeight}`);
    if (e.scrollWidth > e.clientWidth + 2 && !e.querySelector('.tc-floor-flag')) out.push(`wide ${e.className} "${(e.textContent ?? '').slice(0, 30)}" ${e.scrollWidth}>${e.clientWidth}`);
  }
  if (stage && (stage as HTMLElement).dataset.phase !== 'crash') for (const row of stage.querySelectorAll('.tc-row')) for (const slot of row.querySelectorAll('.tc-slot')) { const a = slot.getBoundingClientRect(), b = row.querySelector('.tc-band')?.getBoundingClientRect() ?? row.getBoundingClientRect(), edge = row.querySelector('.tc-band') ? b.top : b.bottom; if (a.bottom > edge + 4) out.push(`slot spills below its row by ${Math.round(a.bottom - edge)}px (${(row as HTMLElement).dataset.side})`); }
  return out;
};
async function snap(s: Seat, name: string, fullPage = false) {
  const file = `${shots}/${name}.png`;
  await s.page.screenshot({ path: file, fullPage });
  const issues = await s.page.evaluate(CHECKS).catch(() => []);
  // Privacy: no other team's hand card (any hand, on the TV, a Conductor's or a Gallery phone) may appear in this page's text, and the Gallery's ballot only on Gallery phones.
  // Read the page first: a snapshot that lands during the read must not make a seat's own hand look foreign.
  const text: string = await s.page.evaluate(() => document.body.innerText).catch(() => ''), own = s === tv ? null : s.snap?.privateView ?? null, side = own?.role === 'team' ? own.side : null;
  const tracks = Object.values((s.snap ?? tv.snap)?.publicView.tracks ?? {}).flatMap(t => t.slots.flatMap(c => c ? [c.card.text, ...c.mods.map(m => m.card.text)] : []));
  if (s === tv || own) for (const x of seats) if (x.snap?.privateView?.role === 'team' && x.snap.privateView.side !== side) for (const c of Object.values(x.snap.privateView.hands).flat()) if (c.text.length > 8 && !tracks.includes(c.text) && text.includes(c.text)) issues.push(`PRIVACY: ${x.label}'s hand card "${c.text.slice(0, 30)}" is visible`);
  const jury = seats.find(x => x.snap?.privateView?.jury)?.snap?.privateView?.jury;
  if (jury && own?.role !== 'gallery') for (const c of [...jury.options, ...(jury.card ? [jury.card] : [])]) if (!tracks.includes(c.text) && text.includes(c.text)) issues.push(`PRIVACY: the Gallery's ballot card "${c.text.slice(0, 30)}" is visible`);
  report.shots.push(file); if (issues.length) report.layout.push({ file, issues });
}
let n = 0;
const stem = (s: Seat, key: string) => `${String(++n).padStart(3, '0')}-${key}-${s.label}`;
async function capture(s: Seat, key: string, live = true) {
  const name = stem(s, key), kind = kindOf(s, key);
  await snap(s, name);
  const sizes = s === tv ? [[1280, 720]] : s.page ? PHONE_SIZES : [];
  if (swept.has(kind) || !sizes.length) return;
  swept.add(kind);
  const vp = s.page.viewportSize();
  for (const [w, h] of sizes) { await s.page.setViewportSize({ width: w, height: h }); await sleep(350); if (live && keyOf(s) !== key) break; await snap(s, `${name}-${w}x${h}`); }
  await s.page.setViewportSize(vp); await sleep(200);
}
async function extra(s: Seat, suffix: string) { const v = s.snap?.publicView; if (v && v.round <= 3) await snap(s, `${stem(s, keyOf(s))}-${suffix}`); }
let filming = true;
async function film(s: Seat) {
  while (filming) {
    const key = keyOf(s);
    if (key !== s.key) { s.key = key; s.since = Date.now(); if (s === tv) { report.phases.push(key); log(`phase ${key}`); } }
    if (key && s.shot !== key && Date.now() - s.since > 800) { s.shot = key; if (wanted(s)) await hold(s, () => capture(s, key)).catch(e => log(`${s.label} shot failed: ${e.message}`));
      // The crash is choreographed: shoot the trolley run and the tally too.
      if (s === tv && key.includes('-crash-') && wanted(s)) for (const at of [3200, 5900]) { while (Date.now() - s.since < at && keyOf(s) === key) await sleep(80); if (keyOf(s) === key) await snap(s, `${stem(s, key)}-t${at}`); }
    }
    await sleep(120);
  }
}
/** Samples a real phone four times a second: how long does it go with no enabled control on screen? */
async function idleWatch(s: Seat) {
  let since = 0, from = '';
  while (filming) {
    const live = s.room !== 'playing' ? 1 : await s.page.evaluate(() => document.querySelectorAll('.tc button:not([disabled]), .tc [role=switch]:not([disabled]), .tc input:not([disabled])').length).catch(() => 1);
    const key = `${keyOf(s)}`, at = Date.now();
    if (s.room === 'playing') { s.idle.watched += 250; if (!live) s.idle.total += 250; }
    if (live) since = 0; else { if (!since) { since = at; from = key; } if (at - since > s.idle.longest) Object.assign(s.idle, { longest: at - since, from, to: key }); }
    await sleep(250);
  }
}
async function until(test: () => boolean, ms: number, what: string) {
  for (const end = Date.now() + ms; !test();) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`); if (failure) throw failure; await sleep(150); }
}

const loop = setInterval(() => {
  for (const s of seats) if (!s.busy) { s.busy = true; void hold(s, () => s.page ? phoneStep(s) : botStep(s)).catch(e => { if (/Timeout/.test(e.message)) report.lostTaps++; else report.errors.push(`${s.label} step: ${String(e.message).split('\n')[0]}`); s.mem.wait = Date.now() + 1500; }).finally(() => { s.busy = false; }); }
}, 150);
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  tv = seat('tv', await newPage({ width: 1920, height: 1080 }, 'tv', false)); tap(tv);
  await tv.page.goto(`${base}/?game=trolley-court`);
  await tv.page.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  await tv.page.getByRole('button', { name: 'Play on this screen', exact: true }).first().click();
  const code = report.code = (await tv.page.locator('.kp-code').first().textContent({ timeout: 20000 })).trim();
  log(`room ${code} on ${base}`);
  if (Object.keys(report.settings).length) {
    await tv.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await tv.page.getByRole('button', { name: 'Game rules', exact: true }).click();
    const LABEL: Record<string, string> = { laps: 'Length', pickSeconds: 'Innocent & Guilty timer', modifierSeconds: 'Twist timer', floorSeconds: 'Each team’s floor', leverSeconds: 'Lever decision', accomplices: 'Accomplices', catchUp: 'Underdog', blanks: 'Write-ins', family: 'Milder deck', readAloud: 'Read cards aloud' };
    for (const [k, value] of Object.entries(report.settings)) {
      if (typeof value === 'boolean') { const sw = tv.page.getByRole('switch', { name: LABEL[k], exact: true }); if ((await sw.getAttribute('aria-checked')) !== String(value)) await sw.click(); }
      else await tv.page.locator('.tc-options label', { hasText: LABEL[k] }).locator('select').selectOption(String(value));
    }
    await snap(tv, '000-settings-tv');
    await tv.page.getByRole('button', { name: 'Apply settings', exact: true }).click();
  }
  for (let i = 0; i < phoneCount; i++) {
    const s = seat(`phone${i + 1}`, await newPage({ width: 390, height: 844 }, `phone${i + 1}`, true)); tap(s);
    await s.page.goto(`${base}/?join=${code}`);
    await s.page.getByRole('textbox', { name: 'Your name' }).fill(names[i]);
    await s.page.getByRole('button', { name: 'Join the room', exact: true }).click();
    await s.page.getByRole('button', { name: 'Ready to play', exact: true }).click({ timeout: 20000 });
    s.page.setDefaultTimeout(8000); // Joined: from here a tap on a control that has just gone away gives up quickly.
    seats.push(s);
  }
  for (let i = phoneCount; i < count; i++) seats.push(await joinBot(i + 1, names[i], code));
  await until(() => seats.every(s => s.id), 20000, 'every seat to join');
  await sleep(1500);
  await snap(tv, '000-lobby-tv'); await snap(seats[0], '000-lobby-phone1');
  await tv.page.getByRole('button', { name: 'Start game', exact: true }).click({ timeout: 20000 });
  const cameras = [...[tv, ...seats.filter(s => s.page)].map(film), ...seats.filter(s => s.page).map(idleWatch)];
  const deadline = Date.now() + Number(args['max-minutes']) * 60000;
  await until(() => tv.room === 'results' || (tv.snap?.publicView.round ?? 0) > stopAfter, deadline - Date.now(), 'results');
  if (tv.room === 'results') {
    log('results'); await sleep(2500);
    report.notes.push(`winners: ${tv.snap?.publicView.winners.map(id => tv.snap!.publicView.players.find(p => p.id === id)?.name).join(', ')}`);
    report.notes.push(`deaths: ${tv.snap?.publicView.players.map(p => `${p.name} ${p.deaths}/${p.spared}/${p.conducted}`).join('; ')}`);
    for (const s of [tv, ...seats.filter(x => x.page)]) await hold(s, () => capture(s, 'results-final', false));
    await snap(tv, 'zzz-results-tv-full', true); await snap(seats[0], 'zzz-results-phone1-full', true);
    if (args.replay) {
      await tv.page.getByRole('button', { name: 'Play again', exact: true }).click();
      for (const s of seats.filter(x => x.page)) await s.page.getByRole('button', { name: 'Ready to play', exact: true }).click({ timeout: 20000 });
      await sleep(1500); await snap(tv, 'zzz-replay-lobby-tv');
      await tv.page.getByRole('button', { name: 'Start game', exact: true }).click({ timeout: 20000 });
      await until(() => tv.room === 'playing' && tv.snap?.publicView.round === 1 && tv.snap.publicView.phase === 'innocent', 60000, 'the replay to reach its first pick');
      const v = tv.snap!.publicView;
      report.notes.push(`replay: round ${v.round}/${v.rounds}, deaths ${v.players.map(p => p.deaths).join(',')}, history ${v.history.length}`);
      await sleep(1000); await snap(tv, 'zzz-replay-round1-tv'); await snap(seats[0], 'zzz-replay-round1-phone1');
    }
  }
  filming = false; await Promise.all(cameras);
} catch (error) {
  failure = error as Error; log(`FAILED: ${failure.message}`);
  if (tv?.page) await snap(tv, 'zzz-error-tv').catch(() => undefined);
} finally {
  clearInterval(loop); filming = false;
  // Case lengths from the TV's phase log, traffic per seat (average and the busiest 5 s), and each phone's longest stretch with nothing to tap.
  const deals = report.times.filter(([k]) => /^r\d+-deal-0$/.test(k));
  report.cases = deals.slice(0, -1).map(([k, at], i) => ({ round: Number(k.slice(1).split('-')[0]), seconds: +(deals[i + 1][1] - at).toFixed(1) }));
  const playing = report.times.find(([k]) => k.startsWith('r1-'))?.[1] ?? 0, span = Math.max(1, (Date.now() - t0) / 1000 - playing);
  // The results screen is counted apart: there the platform attaches the outcome rows to every snapshot.
  const done = report.times.length && tv.room === 'results' ? Math.floor((tv.resultsAt - t0) / 5000) : Infinity;
  const rate = (s: Seat) => { const from = Math.ceil(playing / 5), all = [...s.buckets].filter(([b]) => b >= from), buckets = all.map(([, n]) => n), play = all.filter(([b]) => b < done).map(([, n]) => n), after = all.filter(([b]) => b > done).map(([, n]) => n);
    return { kbPerSecond: +(buckets.reduce((a, b) => a + b, 0) / 1024 / span).toFixed(1), peakKbPerSecond: +(Math.max(0, ...buckets) / 5 / 1024).toFixed(1), peakInPlayKbPerSecond: +(Math.max(0, ...play) / 5 / 1024).toFixed(1), resultsKbPerSecond: +(Math.max(0, ...after) / 5 / 1024).toFixed(1), frames: s.frames }; };
  for (const s of [tv, ...seats.filter(x => x.page), ...seats.filter(x => !x.page).slice(0, 2)]) report.traffic[s.label] = rate(s);
  const all = seats.map(s => rate(s).kbPerSecond); report.traffic.everySeat = { meanKbPerSecond: +(all.reduce((a, b) => a + b, 0) / Math.max(1, all.length)).toFixed(1), maxKbPerSecond: Math.max(0, ...all), roomKbPerSecond: +all.reduce((a, b) => a + b, 0).toFixed(0) };
  for (const s of seats.filter(x => x.page)) report.idle[s.label] = { longestSeconds: +(s.idle.longest / 1000).toFixed(1), from: s.idle.from, to: s.idle.to, idleShare: +(s.idle.total / Math.max(1, s.idle.watched)).toFixed(2) };
  log(`cases ${JSON.stringify(report.cases)}`); log(`traffic ${JSON.stringify(report.traffic)}`); log(`idle ${JSON.stringify(report.idle)}`);
  writeFileSync(`${shots}/log.json`, JSON.stringify({ ...report, failure: failure?.message ?? null, minutes: +((Date.now() - t0) / 60000).toFixed(1) }, null, 1));
  log(`actions ${JSON.stringify(report.actions)}`);
  log(`${report.shots.length} shots, ${report.layout.length} with layout issues, ${report.errors.length} errors → ${shots}`);
  for (const ws of sockets) ws.terminate();
  await browser?.close().catch(() => undefined);
}
process.exit(failure ? 1 : 0);
