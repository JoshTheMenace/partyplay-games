/* Race orchestration: grid, countdown, per-tick order, laps, ranks and the finish.
 * The mechanics live in physics.ts (driving), items.ts (items/boxes) and ai.ts (CPUs). */
import { clamp, nextRandom, signedWrap } from './math';
import { CHECKPOINTS, gridSlot, type Track } from './track';
import { CHARACTERS, CPU_SKILL, KART_BODIES } from './stats';
import { beginRespawn, collideKarts, createKartState, kartParams, speedOf, stepKart, type Drafter, type KartParams } from './physics';
import { collectBoxes, handleItemInput, stepItems, strike } from './items';
import { botInput, botSkill } from './ai';
import { getTrack } from '../tracks/index';
import type { Input, KartBodyId, LobbyChoice, Race, RaceEvent, Racer, RacerStats, Settings } from './types';

export const COUNTDOWN_SECONDS = 3.5;      // time starts at -3.5: "Ready", then 3, 2, 1 on whole seconds, GO at 0
export const FINISH_CELEBRATION = 3.5;     // seconds of scene time after the last human finishes
export const MAX_EVENTS = 40;
export const MAX_RACERS = 10;
const HOP_AIR = .5;                        // longer than any drift hop: only real jumps count as airtime
export const NEUTRAL_INPUT: Input = { steer: 0, drift: false, brake: false, item: false, hop: 0, fire: 0, seq: 0 };

export type RacePlayer = { id: string; name: string; color: string; lobbyChoice?: unknown };
const emptyStats = (): RacerStats => ({ miniTurbos: 0, purpleTurbos: 0, tricks: 0, itemsUsed: 0, hitsDealt: 0, hitsTaken: 0, wallHits: 0, airTime: 0, topSpeed: 0, overtakes: 0, rocketStart: false });

export function createRace(settings: Settings, players: readonly RacePlayer[], seed: number, viewMode: 'tv' | 'personal'): Race {
  const track = getTrack(settings.track), rng = { rng: seed | 0 };
  const humans = players.slice(0, MAX_RACERS), taken = new Set<number>();
  const picks = humans.map(p => { const c = p.lobbyChoice as LobbyChoice | undefined; return c && Number.isInteger(c.character) ? c : null; });
  picks.forEach(c => { if (c) taken.add(c.character); });
  const freeCharacter = () => { const free = CHARACTERS.map((_, i) => i).filter(i => !taken.has(i)); const pool = free.length ? free : CHARACTERS.map((_, i) => i); const pick = pool[Math.floor(nextRandom(rng) * pool.length)]; taken.add(pick); return pick; };
  const randomKart = (): KartBodyId => KART_BODIES[Math.floor(nextRandom(rng) * KART_BODIES.length)].id;
  const cpuCount = clamp(settings.gridSize - humans.length, 0, MAX_RACERS - humans.length);
  // Humans start behind the CPUs (more to chase); their order is shuffled per race.
  const order = humans.map((p, i) => ({ p, i, key: nextRandom(rng) })).sort((a, b) => a.key - b.key);
  const entrants: { id: string; name: string; color: string; bot: boolean; character: number; kart: KartBodyId }[] = [];
  for (let i = 0; i < cpuCount; i++) {
    // Grids beyond eight racers reuse characters; number the repeats so standings stay readable.
    const character = freeCharacter(), twin = entrants.filter(e => e.character === character).length;
    entrants.push({ id: `cpu-${i}`, name: CHARACTERS[character].name + (twin ? ` ${twin + 1}` : ''), color: CHARACTERS[character].color, bot: true, character, kart: randomKart() });
  }
  for (const { p, i } of order) { const c = picks[i]; entrants.push({ id: p.id, name: p.name, color: p.color, bot: false, character: c ? c.character : freeCharacter(), kart: c?.kart ?? 'zoomer' }); }
  const racers: Racer[] = entrants.map((e, slot) => {
    const g = gridSlot(track, slot);
    return { ...createKartState(g.x, g.y, g.z, g.heading, track), ...e, connected: true, lap: 0, checkpoint: 0, progress: -track.length + g.d, rank: slot + 1,
      finishTime: null, lapTimes: [], lapStart: 0, item: null, itemCount: 0, rollT: 0, trailing: false, lastSeq: 0, honkT: 0, stats: emptyStats(),
      ai: e.bot ? { lane: 0, mistakeT: 0, itemDelay: 0, driftHold: 0, targetD: 0 } : null };
  });
  return { track: settings.track, laps: settings.laps, speedClass: settings.speedClass, difficulty: settings.difficulty, items: settings.items, viewMode,
    phase: 'countdown', time: -COUNTDOWN_SECONDS, racers, entities: [], boxes: track.boxes.map(() => 0), events: [], serial: 0, rng: rng.rng,
    firstFinish: null, endAt: null, cooldowns: { thunder: 0, comet: 0 } };
}

export function pushEvent(race: Race, event: Omit<RaceEvent, 'id' | 't'>) {
  race.events.push({ id: ++race.serial, t: Math.round(race.time * 1000) / 1000, ...event });
  if (race.events.length > MAX_EVENTS) race.events.splice(0, race.events.length - MAX_EVENTS);
}
/** Deterministic random number from the race's PRNG state. */
export const raceRandom = (race: Race) => nextRandom(race);

export function paramsFor(race: Race, racer: Racer): KartParams {
  return kartParams(racer.character, racer.kart, race.speedClass, racer.bot ? CPU_SKILL[race.difficulty] * botSkill(race, racer) : 1);
}

export function honk(race: Race, id: string) {
  const racer = race.racers.find(r => r.id === id);
  if (!racer || racer.honkT > 0 || race.phase === 'results') return;
  racer.honkT = 1.5; pushEvent(race, { type: 'honk', racer: id });
}

export function stepRace(race: Race, inputs: ReadonlyMap<string, Input>, dt: number) {
  if (race.phase === 'results') return;
  const track = getTrack(race.track);
  race.time += dt;
  if (race.phase === 'countdown' && race.time >= 0) race.phase = 'racing';
  const drafters: Drafter[] = race.racers.map(r => ({ x: r.x, z: r.z, heading: r.heading, speed: speedOf(r) }));
  const params = race.racers.map(r => paramsFor(race, r)), finished: Racer[] = [];
  race.racers.forEach((racer, i) => {
    const autopilot = racer.bot || !racer.connected || racer.finishTime !== null;
    // seq 0 = missing input or the platform's release/stale neutral: keep the counters so it never reads as a press.
    const given = inputs.get(racer.id), input = autopilot ? botInput(race, racer) : given?.seq ? given : { ...NEUTRAL_INPUT, hop: racer.prevHop, fire: racer.prevFire, seq: racer.lastSeq };
    // Back from autopilot (reconnected): adopt the new controller's counters so its first input isn't read as a press.
    if (!autopilot && racer.ai && given?.seq) { racer.prevHop = given.hop; racer.prevFire = given.fire; racer.ai = null; }
    if (!racer.bot) racer.lastSeq = input.seq;
    if (race.phase === 'racing' && racer.finishTime === null) handleItemInput(race, racer, input, track);
    const beforeD = racer.d, wasRespawning = racer.respawnT > 0;
    for (const e of stepKart(racer, input, params[i], track, dt, { time: race.time, phase: race.phase, drafters: drafters.filter((_, j) => j !== i) })) {
      pushEvent(race, { type: e.type, racer: racer.id, ...(e.value !== undefined ? { value: e.value } : {}) });
      if (e.type === 'fall') beginRespawn(racer);
      if (e.type === 'mini-turbo') { racer.stats.miniTurbos++; if (e.value === 3) racer.stats.purpleTurbos++; }
      if (e.type === 'trick') racer.stats.tricks++;
      if (e.type === 'wall') racer.stats.wallHits++;
      if (e.type === 'rocket-start') racer.stats.rocketStart = true;
    }
    if (advanceProgress(race, track, racer, beforeD, wasRespawning && racer.respawnT <= 0, dt)) finished.push(racer);
    racer.stats.topSpeed = Math.max(racer.stats.topSpeed, speedOf(racer));
    // Whole flights longer than a hop (credited once they pass HOP_AIR); tumbles and respawn lifts don't count.
    if (!racer.grounded && racer.air > HOP_AIR && racer.tumbleT <= 0 && racer.respawnT <= 0) racer.stats.airTime += racer.air - dt > HOP_AIR ? dt : racer.air;
    racer.honkT = Math.max(0, racer.honkT - dt);
  });
  if (race.phase === 'racing') {
    for (const [a, b] of collideKarts(race.racers, params, (v, s) => strike(race, race.racers[v], 'tumble', race.racers[s].id))) pushEvent(race, { type: 'bump', racer: race.racers[a].id, other: race.racers[b].id });
    stepItems(race, track, dt);
    collectBoxes(race, track, dt);
  }
  rankRacers(race);
  for (const r of finished) pushEvent(race, { type: 'finish', racer: r.id, value: r.rank });   // after ranking: this tick's place
  finishCheck(race, track);
}

/** Progress accumulates the signed along-track motion each tick, so laps can't be skipped by
 * jumping across the infield and driving backwards over the line un-counts it. */
function advanceProgress(race: Race, track: Track, racer: Racer, beforeD: number, teleported: boolean, dt: number) {
  if (racer.finishTime !== null) return false;
  const delta = signedWrap(racer.d - beforeD, track.length);
  if (teleported || Math.abs(delta) < 6) racer.progress += delta;
  racer.checkpoint = Math.floor(racer.d / (track.length / CHECKPOINTS));
  const lap = Math.floor(racer.progress / track.length) + 1;
  const crossed = lap === racer.lapTimes.length + 2 && lap <= race.laps + 1 && race.phase === 'racing';
  if (crossed) {
    // Sub-tick crossing time, shared by the lap split and the finish so the laps add up to the race time.
    const at = race.time - clamp((racer.progress - (lap - 1) * track.length) / Math.max(1, speedOf(racer)), 0, dt);
    racer.lapTimes.push(Math.round((at - racer.lapStart) * 1000) / 1000); racer.lapStart = at;
    if (lap === race.laps + 1) { racer.finishTime = Math.round(at * 1000) / 1000; race.firstFinish ??= racer.finishTime; }
    else pushEvent(race, { type: lap === race.laps ? 'final-lap' : 'lap', racer: racer.id, value: lap });
  }
  racer.lap = racer.finishTime !== null ? race.laps + 1 : Math.max(0, Math.min(lap, race.laps));
  return crossed && racer.finishTime !== null;
}

function rankRacers(race: Race) {
  const sorted = [...race.racers].sort((a, b) => a.finishTime !== null || b.finishTime !== null
    ? (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity) : b.progress - a.progress);
  sorted.forEach((r, i) => {
    if (race.phase === 'racing' && i + 1 < r.rank && r.finishTime === null) { r.stats.overtakes += r.rank - (i + 1); pushEvent(race, { type: 'overtake', racer: r.id, value: i + 1 }); }
    r.rank = i + 1;
  });
}

function finishCheck(race: Race, track: Track) {
  if (race.phase !== 'racing') return;
  const humans = race.racers.filter(r => !r.bot);
  const humansDone = humans.length > 0 && humans.every(r => r.finishTime !== null);   // disconnected humans are autopiloted home
  if (humansDone) race.endAt = Math.min(race.endAt ?? Infinity, race.time + FINISH_CELEBRATION);
  if (race.firstFinish !== null) race.endAt = Math.min(race.endAt ?? Infinity, race.firstFinish + Math.max(30, race.firstFinish * .4));
  const cap = COUNTDOWN_SECONDS + race.laps * track.length / 8 + 60;          // safety net: walking pace
  if (race.time >= cap) race.endAt = race.time;
  if (race.endAt === null || race.time < race.endAt) return;
  race.phase = 'results';
  // Unfinished CPUs get an estimated time so the table stays complete; unfinished humans are DNF.
  for (const r of race.racers) if (r.finishTime === null && r.bot) {
    const remaining = race.laps * track.length - r.progress, pace = Math.max(8, paramsFor(race, r).topSpeed * .85);
    r.finishTime = Math.round((race.time + remaining / pace) * 1000) / 1000;
  }
  rankRacers(race);
}

export function racerOutcome(race: Race) {
  return { complete: race.phase === 'results', winners: race.racers.filter(r => !r.bot && r.rank === 1).map(r => r.id),
    rows: race.racers.filter(r => !r.bot).sort((a, b) => a.rank - b.rank).map(r => ({ playerId: r.id, rank: r.rank, label: r.finishTime === null ? 'Did not finish' : formatTime(r.finishTime) })) };
}
export const formatTime = (seconds: number) => { const cs = Math.round(Math.max(0, seconds) * 100); return `${Math.floor(cs / 6000)}:${(cs % 6000 / 100).toFixed(2).padStart(5, '0')}`; };
