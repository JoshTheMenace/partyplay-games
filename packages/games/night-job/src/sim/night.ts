/* A night: every crew's heist, plus what the whole room shares on a crew night (two or more crews): the sunrise
 * clock, the board, the news ticker and the director who picks the crew on the shared screen. Server-only. */
import type { Outcome, RoundContext } from '../../../../party-contract/src/index';
import { CREWS, NIGHT, RADIUS, TIMING, crewStarts, neutralInput, scoreSeconds, type CrewLine, type Input, type News, type Phase, type Settings, type View } from '../model';
import type { ServerLevel } from '../server-levels';
import { packLine, packStats, pack, type Base, type Final, type Live, type Own, type Wire } from '../wire';
import { create, dist, drop, effect, mapOf, playing, say, type State } from './state';
import { tickCrew } from './crew';
import { tickNpcs, toPatrol } from './npc';
import { tickSecurity } from './security';
import { project } from './view';

export type Night = {
  heists: State[]; crewOf: Map<string, number>; rival: boolean; base: Base; final: Final | null;
  now: number; ends: number;
  /** The crew on the shared screen, since when, and when each crew was last on it. */
  cast: number; castAt: number; aired: number[];
  news: News[]; seen: { phase: Phase; alarmAt: number; bails: number; taken: boolean }[];
  /** Bumped by everything that changes state, so one snapshot projects each crew once however many seats ask. */
  stamp: number; frame: { stamp: number; views: (View | undefined)[]; lives: (Live | undefined)[] };
};
/** The TV holds the getaway or the bust on screen this long before results. */
export const OUTRO_MS = 3500;
const NEWS_MS = 9000;

export function createNight(ctx: RoundContext, settings: Settings, level?: ServerLevel): Night {
  const starts = crewStarts(ctx.players.length), rival = starts.length > 2;
  const heists = starts.slice(0, -1).map((seat, crew) => create({ ...ctx, players: ctx.players.slice(seat, starts[crew + 1]), seed: ctx.seed + crew * 7919 }, settings, level, { crew, seat, rival }));
  return {
    heists, rival, crewOf: new Map(heists.flatMap((s, crew) => s.crew.map(p => [p.id, crew] as const))), final: null,
    base: { mission: settings.mission, difficulty: settings.difficulty, roster: heists.flatMap(s => s.crew.map(p => [p.id, p.name, p.color, p.role, p.tool] as Base['roster'][number])) },
    now: ctx.nowMs, ends: rival ? ctx.nowMs + NIGHT.cap * 1000 : 0, cast: 0, castAt: ctx.nowMs, aired: heists.map(() => ctx.nowMs),
    news: [], seen: heists.map(s => ({ phase: s.phase, alarmAt: 0, bails: 0, taken: false })), stamp: 0, frame: { stamp: -1, views: [], lives: [] },
  };
}

/** Game time: wall time minus every stretch when the whole crew was away (a crew with rivals never pauses). */
export function clock(s: State, wall: number) {
  s.wallAt = Math.max(s.wallAt, wall);
  s.now = (s.pauseAt ?? s.wallAt) - s.paused;
  if (playing(s)) s.elapsed = Math.max(0, (s.now - s.startedAt) / 1000);
}
/** The van drops a wiped crew back at the start: on its feet, guards calmed, the clock a little worse. */
function bail(s: State) {
  const spawns = mapOf(s).spawns;
  s.bails++; s.wipedAt = null; s.alarm = null;
  s.crew.forEach((p, i) => {
    if (p.suspended) return;
    Object.assign(p, { x: spawns[i % spawns.length].x, y: spawns[i % spawns.length].y, down: false, health: NIGHT.bailHealth, hidden: false, hideLatch: false, hideSpot: null, witnesses: [], work: null, seenAt: s.now });
    effect(s, p, 'bail', 'Bailed out');
  });
  for (const n of s.npcs) if (n.state !== 'stunned' && n.state !== 'patrol') toPatrol(n);
  say(s, `The van hauled the crew out. Back at the start, +${NIGHT.bailPenalty} s.`);
}
function finishCheck(s: State) {
  const required = s.crew.filter(p => !p.suspended), exit = mapOf(s).objects.find(o => o.kind === 'exit')!;
  if (!required.length) { if (s.rival) { s.phase = 'failed'; s.endedAt = s.now; say(s, 'The crew left the job.'); } return; }
  // A lone thief with a second wind left is not finished yet (see crew.ts secondWind).
  const wiped = required.every(p => p.down) && !(required.length === 1 && required[0].wind);
  if (wiped && s.rival) {
    if (s.wipedAt === null) { s.wipedAt = s.now; say(s, 'The whole crew is down. The van is coming to haul you out.'); }
    else if (s.now - s.wipedAt >= NIGHT.bailAfter) bail(s);
    return;
  }
  s.wipedAt = null;
  if (wiped) { s.phase = 'failed'; say(s, 'The whole crew is down. Job failed.'); }
  else if (s.objective.carrier && required.every(p => !p.down && dist(p, exit) <= RADIUS.exit)) { s.phase = 'clear'; say(s, 'Clean getaway! The whole crew made it out.'); effect(s, exit, 'escape', 'Getaway!'); }
  if (!playing(s)) s.endedAt = s.now;
}
export function tickHeist(s: State, inputs: ReadonlyMap<string, Input>, dt: number, wall: number) {
  clock(s, wall);
  if (!playing(s)) return;
  for (const p of s.crew) if (!p.connected && p.absentAt !== null && s.now - p.absentAt >= TIMING.suspend && !p.suspended) {
    p.suspended = true; p.work = null;
    drop(s, p);
  }
  if (s.pauseAt !== null) return;
  dt = Math.max(0, Math.min(.1, dt));
  for (const p of s.crew) p.input = inputs.get(p.id) ?? neutralInput();
  tickCrew(s, dt);
  tickNpcs(s, dt);
  tickSecurity(s, dt);
  finishCheck(s);
}
export function presence(s: State, id: string, connected: boolean, wall: number) {
  const p = s.crew.find(q => q.id === id);
  if (!p || p.connected === connected) return;
  if (playing(s)) clock(s, wall);
  p.connected = connected; p.work = null; p.input = neutralInput();
  if (connected) {
    p.absentAt = null; p.suspended = false;
    if (s.pauseAt !== null) { s.paused += Math.max(0, wall - s.pauseAt); s.pauseAt = null; if (playing(s)) clock(s, wall); }
  } else {
    p.absentAt = s.now;
    if (!s.rival && !s.crew.some(q => q.connected)) s.pauseAt = s.wallAt;
  }
}

const score = (s: State) => scoreSeconds(s.elapsed, s.totalLoot - s.collected, s.bails);
/** The board: crews that got away rank by adjusted time, then crews holding the goods, then by loot. Ties share a place. */
export function standings(night: Night): CrewLine[] {
  const keys = night.heists.map(s => s.phase === 'clear' ? score(s) : 1e6 - (s.objective.taken ? 1e5 : 0) - s.collected);
  return night.heists.map((s, crew) => ({
    crew, size: s.crew.length, phase: s.phase, collected: s.collected, seconds: Math.round(s.elapsed), bails: s.bails, alarm: !!s.alarm, chased: s.npcs.some(n => n.state === 'chase'),
    taken: s.objective.taken, down: s.crew.filter(p => p.down && !p.suspended).length, place: 1 + keys.filter(key => key < keys[crew]).length,
  }));
}
/** How much is happening to a crew right now; a crew that has been off the screen for a while slowly earns a look. */
function drama(night: Night, s: State, crew: number) {
  if (!playing(s)) return s.endedAt !== null && s.now - s.endedAt < OUTRO_MS ? 9 : -1;
  const carrier = s.crew.find(p => p.id === s.objective.carrier), exit = mapOf(s).objects.find(o => o.kind === 'exit')!;
  return Math.min(3, (night.now - night.aired[crew]) / 15000) + (s.npcs.some(n => n.state === 'chase') ? 3 : 0) + (s.alarm ? 2 : 0) + (s.crew.some(p => p.down && !p.suspended) ? 2 : 0)
    + (s.phase === 'escape' ? 2 : 0) + (carrier && dist(carrier, exit) < 9 ? 3 : 0) + (s.crew.some(p => p.work?.target === 'objective') ? 3 : 0);
}
/** Cuts the shared screen to the liveliest crew: never sooner than five seconds (a getaway cuts in at once, see report), never later than twelve while another crew waits. */
function direct(night: Night) {
  const scores = night.heists.map((s, crew) => drama(night, s, crew)), on = scores[night.cast], held = night.now - night.castAt;
  night.aired[night.cast] = night.now;
  if (held < 5000) return;
  let best = night.cast;
  scores.forEach((value, crew) => { if (crew !== night.cast && value >= 0 && (best === night.cast || value > scores[best])) best = crew; });
  if (best !== night.cast && (on < 0 || held >= 12000 || scores[best] >= on + 3)) { night.cast = best; night.castAt = night.now; }
}
function report(night: Night) {
  const post = (crew: number, text: string) => { night.news.push({ at: night.now, crew, text }); };
  night.heists.forEach((s, crew) => {
    const was = night.seen[crew], name = `The ${CREWS[crew].name}`, noun = mapOf(s).objectiveKind;
    if (s.phase === 'clear' && was.phase !== 'clear') {
      const first = night.heists.every((o, c) => c === crew || o.phase !== 'clear');
      post(crew, first ? `${name} are away first! Sunrise is coming.` : `${name} are away!`);
      night.ends = Math.min(night.ends, night.now + NIGHT.lastCall * 1000);
      night.cast = crew; night.castAt = night.now;   // a getaway always makes the shared screen
    } else if (s.phase === 'failed' && was.phase !== 'failed') post(crew, `${name} are out of the night.`);
    else if (s.bails !== was.bails) post(crew, `${name} got hauled out by the van.`);
    else if (s.objective.taken && !was.taken) post(crew, `${name} have the ${noun}!`);
    else if (s.alarm && s.alarmAt !== was.alarmAt) post(crew, `${name} tripped an alarm.`);
    night.seen[crew] = { phase: s.phase, alarmAt: s.alarmAt, bails: s.bails, taken: s.objective.taken };
  });
  night.news = night.news.filter(n => night.now - n.at < NEWS_MS).slice(-4);
}
export function tickNight(night: Night, inputs: ReadonlyMap<string, Input>, dt: number, wall: number) {
  night.now = Math.max(night.now, wall); night.stamp++;
  for (const s of night.heists) tickHeist(s, inputs, dt, wall);
  if (night.rival) {
    report(night);
    if (night.now >= night.ends) for (const s of night.heists) if (playing(s)) { s.phase = 'failed'; s.endedAt = s.now; say(s, 'Sunrise. The crew is still inside.'); }
    direct(night);
  }
  if (!night.final && night.heists.every(s => !playing(s))) night.final = { stats: night.heists.flatMap(s => s.crew.map(p => packStats(s.stats[p.id]))), left: night.heists.flatMap(s => s.crew.filter(p => p.suspended).map(p => p.seat)) };
}

function frame(night: Night, crew: number) {
  if (night.frame.stamp !== night.stamp) night.frame = { stamp: night.stamp, views: [], lives: [] };
  const view = night.frame.views[crew] ??= project(night.heists[crew]);
  return { view, live: night.frame.lives[crew] ??= pack(view) };
}
export function publicNight(night: Night): Wire {
  return {
    rev: night.final ? 2 : 1, base: night.base, final: night.final, now: night.now, ends: night.ends,
    board: standings(night).map(packLine), news: night.news.map(n => [n.at, n.crew, n.text]), cast: night.cast, live: frame(night, night.cast).live,
  };
}
/** A seat is told its own hint, and its own crew's view unless the shared screen already carries it. */
export function ownNight(night: Night, id: string): Own | null {
  const crew = night.crewOf.get(id);
  if (crew === undefined) return null;
  const { view, live } = frame(night, crew);
  return { hint: view.players.find(p => p.id === id)!.hint, live: crew === night.cast ? null : live };
}
export function outcome(night: Night): Outcome {
  const lines = standings(night);
  return {
    complete: night.heists.every(s => s.endedAt !== null && s.now - s.endedAt >= OUTRO_MS),
    winners: night.heists.flatMap((s, crew) => s.phase === 'clear' && lines[crew].place === 1 ? s.crew.map(p => p.id) : []),
    // Rows repeat in every results snapshot for every socket, so their labels stay short; the game's own results screen has the detail.
    rows: night.heists.flatMap((s, crew) => s.crew.map(p => ({ playerId: p.id, rank: lines[crew].place, score: score(s), label: `${night.rival ? `${CREWS[crew].name} · ` : ''}${s.phase === 'clear' ? 'Escaped' : s.phase === 'failed' ? 'Caught' : 'On the job'} · ${p.coins} coins` }))),
  };
}
