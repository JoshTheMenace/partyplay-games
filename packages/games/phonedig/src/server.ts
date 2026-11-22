/* Server-authoritative rules: the room runtime's view of the phonedig engine.
 *
 * This file never reaches the browser — the Vite import guard blocks any game's
 * `src/server.ts` from the client graph by filename. Shared types live in
 * model.ts and the level generator in worldgen.ts, both of which the client
 * does import.
 *
 * The engine below is the ported single-player simulation, unchanged. The whole
 * job here is the seam: fixed steps in, a serialisable projection out, and the
 * terrain sent as a delta against a level the client can rebuild itself.
 */

import type { GameRules, PlayerId, RoundContext, ViewContext } from '../../../party-contract/src/index';
import * as engine from './engine';
import { GRID, RELIC_IDS, idx, lanesFor, levelSeed } from './worldgen';
import { counts, pumpStages } from './monsters';
import { MODE_IDS, ROCK_STATE_IDS, kindIndex, variantIndex } from './bestiary';
import { COOP, PARTY_TUNE, SHIFT } from './tuning';
import { crewSizes } from './crews';
import { SUITS, defaultSuit, isSuit } from './suits';
import type {
  Action, Edit, Input, Monster, NetEvent, NetInput, Player, PrivateView, PublicView,
  RosterEntry, Settings, ShaftCuts, ShaftWire, SiteEvent, SiteWire, State,
} from './model';
import {
  CREW_STATE, SHIFT_AUTO, SHIFT_OPEN, packMonsters, packPlayers, packRocks,
} from './model';

const modeIndex = (mode: string) => Math.max(0, MODE_IDS.indexOf(mode as never));
const rockStateIndex = (s: string) => Math.max(0, ROCK_STATE_IDS.indexOf(s as never));
const relicBits = (p: Player) => p.relics.reduce((bits, id) => bits | (1 << Math.max(0, RELIC_IDS.indexOf(id))), 0);

const { GW, GH } = GRID;
const STEP_HZ = 60;

/** The engine-shaped input a seat contributes this tick. */
const NEUTRAL: Input = { dir: null, dirHeld: false, pumps: 0 };

/** At most this many taps are honoured per tick, however the counter jumped. */
const MAX_PUMPS_PER_TICK = 4;

type Seat = {
  id: PlayerId;
  name: string;
  color: string;
  connected: boolean;
  /** The suit they picked, or null until they do. */
  suit: string | null;
  /** Last cumulative pump counter seen from this client.
   *
   *  Starts at 0, matching a fresh client's own counter, so the first tap of a
   *  round counts. -1 means "this seat reconnected and is mid-count" — there,
   *  rebasing onto whatever arrives next is right, because the gap was taps we
   *  genuinely did not see rather than taps that never happened. */
  pumpSeq: number;
  input: Input;
  /** Which crew, and which digger in it. */
  crew: number;
  slot: number;
  /** Send this seat its whole cut ground with the next private view. */
  needBase: boolean;
  /* The shift's own record of this digger, for the results. The engine counts
   * `carved` per LEVEL, so the total is gathered here as it goes. */
  cut: number; cutSeen: number;
  pops: number;
  rescues: number;
  downs: number;
};

/** The kit-up's turn id. One per round, so a stale pick is simply not this. */
const KIT_TURN = 1;

/* How long an event rides along with snapshots.
 *
 * A quarter of a second is five snapshots, so one or two coalesced away by a
 * busy phone cost nothing, and a client replays by sequence so the repeats are
 * free to it — but not to the wire: four diggers cutting emit some forty `dig`s
 * a second, and every one is sent once per snapshot it rides in. The list used
 * to be "the last twenty-four, whenever they happened", which re-sent a quiet
 * shaft's whole recent history twenty times a second. Overflow still drops the
 * OLDEST: a sound whose moment has passed is worth less than the one that just
 * happened. */
const EVENT_TICKS = STEP_HZ / 4;
const EVENT_LIMIT = 32;
/** How long a freshly cut cell stays in a phone's ground journal. */
const CUT_TICKS = STEP_HZ;
const FEED_LIMIT = 8;

type StampedEvent = NetEvent & { at: number };

/* One crew and its shaft.
 *
 * The engine is the ported single-player game and knows nothing about rooms,
 * so a crew is simply one of its states plus everything the seam needs to send
 * it: the pristine ground to diff against, the journal of recent cuts, and the
 * tally the results are read from. */
export type Crew = {
  index: number;
  seats: Seat[];
  sim: State;
  /** Shafts this crew has started; a crew sent back to the top starts another. */
  run: number;
  state: 'dig' | 'wiped' | 'out';
  /** Seconds since the wipe. */
  wipedT: number;

  /* What earlier shafts of this shift banked, kept here because startGame
   * zeroes the engine's own counters. */
  bankedBefore: number;
  oreBefore: number;
  /** Paid at half for what the whistle caught in the hoppers. */
  salvage: number;
  /** What that was before the halving: the haul the whistle caught. */
  caught: number;
  deepest: number;
  levels: number;
  wipes: number;

  /** Recent events and the counter that lets a client replay only new ones. */
  events: StampedEvent[];
  eventSeq: number;

  /** The generated dirt for this level, before anyone cut into it. */
  pristineDirt: Uint8Array;
  /** Cached projection of every cell that has changed since generation. */
  edits: Edit[];
  /** sim.dirtRev when `edits` was last rebuilt, and a counter of rebuilds. */
  editsAt: number;
  editsRev: number;
  /** sim.levelSerial when the pristine copy was taken. */
  levelSerial: number;
  /** The column the previous level's shaft came down in; null on level 1. */
  entryLc: number | null;
  /** The id of the generator's first rock, and how many it seated. */
  rock0: number;
  seated: number;

  /* The ground journal for phones; see ShaftCuts in model.ts. `shadow` is the
   * dirt as of the last batch, so a batch is exactly what was cut since. */
  shadow: Uint8Array;
  shadowAt: number;
  cutSeq: number;
  tail: { seq: number; at: number; cells: number[] }[];
  cuts: Edit[];
  cutsKey: string;

  /** The packed shaft, built once per step and shared by every screen. */
  wire: ShaftWire | null;
  wireKey: string;
};

export type Round = {
  settings: Settings;
  seed: number;
  seats: Seat[];
  crews: Crew[];
  /** The first crew's shaft. With one crew that is the whole game. */
  readonly sim: State;

  /* ── kitting up ───────────────────────────────────────────────────────
   * The crew picks a suit before the shaft starts moving. This lives HERE and
   * not in the engine on purpose: the simulation is the ported single-player
   * game and every line of it is covered by a parity check against upstream.
   * A pre-round phase is a property of the room, not of the digging, so it sits
   * above the engine and simply does not step it. */
  stage: 'kitup' | 'dig' | 'whistle' | 'done';
  kitT: number;
  /** Seconds since the last seat picked, once they all have. */
  kitGrace: number;

  /** Every call to tick, whatever the stage: the cadence the views run on. */
  clock: number;
  /** Seconds left on the shift, or null when there is no clock. */
  shiftLeft: number | null;
  whistleT: number;

  /** The crew the television is on, and when it went there. */
  spot: number;
  spotAt: number;
  /** Monotonic, and bumped only when the published `edits` actually change. */
  revision: number;
  published: string;

  feed: SiteEvent[];
  feedSeq: number;
  /** `clock` when a suit last changed, so the roster goes out again. */
  rosterAt: number;
};

/* ── the module-global tune ───────────────────────────────────────────────
 *
 * The engine keeps its tunables in a module-level object because the original
 * hosts exactly one game at a time. A server does not: every room shares this
 * module, so each one reinstalls its base tune before it steps.
 *
 * Per-DIGGER tunes are the engine's business — it installs each player's own
 * around their step, because relics are carried rather than shared — but the
 * base it restores afterwards is this one. Do not drop this call on the grounds
 * that the preset is identical for every room: the engine's `baseTune` is what
 * the restore reads, and it belongs to whichever room set it last. */
function installTune() {
  engine.setTune(PARTY_TUNE);
}

/* ── terrain delta ────────────────────────────────────────────────────────
 *
 * A level is a pure function of (level, seed, entryLc, lanes), so the client
 * rebuilds it with the same generator and we send only what has changed since.
 * That is measured against a pristine copy rather than by hooking the places
 * that write to the grid: carve() and breakTile() are not the only writers —
 * the descent drill writes state.dirt directly — and a missed writer would
 * desync a client silently, one shaft per level, only after a descend.
 *
 * Two properties of the simulation make this cheap, and both are checked by a
 * test because the encoding is wrong the moment either stops holding:
 *
 *   Dirt only ever goes solid to carved. Nothing fills ground back in, so the
 *   delta is a SET of cut cells rather than a map of values.
 *
 *   Ore is cleared only inside a carve. Every ore clear in world.ts sits under
 *   a `dirt === 1` test, so a client that has a cell in the cut set knows its
 *   ore is gone without being told.
 *
 * So the whole delta is "which cells are cut", and a cut tunnel is contiguous —
 * which run-length encodes. Pairs are [firstCellIndex, runLength], which is
 * still the unique-nonnegative-key shape the transport diffs for us, so the
 * steady-state cost stays proportional to what changed rather than to what has
 * been dug.
 *
 * The scan is skipped entirely unless sim.dirtRev moved. Every writer bumps it;
 * that invariant already exists because the renderer's chunk cache depends on
 * it, and world.ts states it next to carve(). */
function refreshEdits(crew: Crew) {
  const sim = crew.sim;
  if (sim.dirtRev === crew.editsAt) return;
  const dirt = sim.dirt, was = crew.pristineDirt;
  const out: Edit[] = [];
  let start = -1;
  for (let i = 0; i < dirt.length; i++) {
    const cut = dirt[i] !== was[i];
    if (cut) { if (start < 0) start = i; continue; }
    if (start >= 0) { out.push([start, i - start]); start = -1; }
  }
  if (start >= 0) out.push([start, dirt.length - start]);
  crew.editsAt = sim.dirtRev;
  crew.edits = out;
  crew.editsRev++;
}

/* Take a fresh baseline after a descent.
 *
 * `entryLc` has to be passed in, read from before the step. startLevel consumes
 * state.exitLc to place the new shaft and then nulls it in the same call, so by
 * the time the level change is visible out here the column is already gone —
 * and publishing null instead would have the client generate a level whose
 * shaft is somewhere else. It desyncs only after a descend, and only in the
 * terrain, which is exactly the kind of fault that reaches a player as "the
 * ground looks wrong" rather than as an error. */
function rebaseLevel(crew: Crew, entryLc: number | null) {
  const sim = crew.sim;
  crew.pristineDirt = sim.dirt.slice();
  crew.edits = [];
  crew.editsAt = sim.dirtRev;
  crew.editsRev++;
  crew.levelSerial = sim.levelSerial;
  crew.entryLc = entryLc;
  /* Rocks are numbered straight after the monsters, in the generator's order,
   * and nothing seats another one during the level — which is what lets a
   * seated rock travel as one bit. See packRocks. */
  crew.rock0 = sim.rocks[0]?.id ?? 0;
  crew.seated = sim.rocks.length;
  crew.shadow = sim.dirt.slice();
  crew.shadowAt = sim.dirtRev;
  crew.cutSeq = 0;
  crew.tail = [];
  crew.cuts = [];
  crew.cutsKey = '';
}

/* The journal: which cells were cut in the last second, as runs.
 *
 * Built at most once per step however many phones ask. A phone that has been
 * listening only ever needs the newest batch, and the tail is there so a
 * dropped snapshot or two costs nothing. */
function journal(round: Round, crew: Crew) {
  const sim = crew.sim;
  if (sim.dirtRev !== crew.shadowAt) {
    const dirt = sim.dirt, shadow = crew.shadow, cells: number[] = [];
    for (let r = 0; r < GH; r++) {
      for (let i = idx(0, r), end = i + sim.activeGW; i < end; i++) {
        if (dirt[i] !== shadow[i]) { shadow[i] = dirt[i]; cells.push(i); }
      }
    }
    crew.shadowAt = sim.dirtRev;
    if (cells.length) crew.tail.push({ seq: ++crew.cutSeq, at: round.clock, cells });
  }
  while (crew.tail.length && round.clock - crew.tail[0].at > CUT_TICKS) crew.tail.shift();
  const key = `${crew.tail[0]?.seq ?? 0}:${crew.cutSeq}`;
  if (key === crew.cutsKey) return;
  crew.cutsKey = key;
  const all = crew.tail.flatMap(batch => batch.cells).sort((a, b) => a - b);
  const runs: Edit[] = [];
  for (const cell of all) {
    const last = runs[runs.length - 1];
    if (last && cell < last[0] + last[1]) continue;           // cut twice in the tail
    if (last && cell === last[0] + last[1]) last[1]++; else runs.push([cell, 1]);
  }
  crew.cuts = runs;
}

/* ── crews ────────────────────────────────────────────────────────────── */

/* Put a crew at the top of a shaft: its first, or a fresh one after a wipe on
 * a clocked shift.
 *
 * Every crew's FIRST shaft is cut from the room's own seed, so equal crews race
 * over identical ground. A second shaft is not — the crew has already seen
 * that one. */
function launch(round: Round, crew: Crew) {
  engine.setTune(PARTY_TUNE);
  /* create() seats one digger; the rest of the crew joins before startGame so
   * every one of them is reset and given a level id in the same pass. Seat
   * order is crew order, which is what lets a step hand inputs out by index
   * rather than by lookup. */
  /* The shaft widens with the crew, on the same curve the monster count uses,
   * so four diggers get a field they can actually spread out in rather than
   * four bodies in a ten-lane corridor. Fixed for the run: every level
   * regenerates from it, and a width that changed mid-shift would break the
   * clients rebuilding terrain from the seed. */
  if (crew.run > 0) {
    // startGame zeroes the engine's own counters; the shift's total is ours.
    crew.bankedBefore += crew.sim.banked;
    crew.oreBefore += crew.sim.oreBanked;
    crew.deepest = Math.max(crew.deepest, crew.sim.deepest);
  }
  const runSeed = crew.run === 0 ? round.seed
    : levelSeed(round.seed ^ Math.imul(crew.index + 1, 0x9e3779b1), 1000 + crew.run);
  const sim = engine.create({ runSeed: runSeed >>> 0, lanes: lanesFor(crew.seats.length) });
  sim.players[0].seatId = crew.seats[0].id;
  for (let i = 1; i < crew.seats.length; i++) engine.addPlayer(sim, crew.seats[i].id);
  engine.startGame(sim, round.settings.startLevel, { lives: round.settings.lives });
  engine.drainEvents(sim);
  crew.sim = sim;
  crew.run++;
  crew.state = 'dig';
  crew.wipedT = 0;
  crew.wire = null;
  for (const seat of crew.seats) { seat.cutSeen = 0; seat.input = NEUTRAL; }
  rebaseLevel(crew, sim.exitLc);
}

/** What a crew has earned so far: banked dirt, ore at its weight, and salvage. */
function earned(crew: Crew) {
  return crew.bankedBefore + crew.sim.banked
    + SHIFT.ORE_PAY * (crew.oreBefore + crew.sim.oreBanked) + crew.salvage;
}
/** Each digger's share of it, which is what crews of different sizes are ranked on. */
const share = (crew: Crew) => Math.floor(earned(crew) / crew.seats.length);
const atRisk = (crew: Crew) => crew.sim.players.reduce((n, p) => n + p.hopper + SHIFT.ORE_PAY * p.oreHeld, 0);
const deepestOf = (crew: Crew) => Math.max(crew.deepest, crew.sim.deepest);
const leftIn = (sim: State) => sim.monsters.reduce((n, m) => n + (counts(m) && !m.dying ? 1 : 0), 0);

/** Crews in finishing order: share first, then how deep they got. */
function standings(round: Round) {
  return [...round.crews].sort((a, b) =>
    share(b) - share(a) || deepestOf(b) - deepestOf(a) || a.index - b.index);
}

function say(round: Round, event: Omit<SiteEvent, 'seq'>) {
  round.feed.push({ seq: ++round.feedSeq, ...event });
  if (round.feed.length > FEED_LIMIT) round.feed.splice(0, round.feed.length - FEED_LIMIT);
}

/* One crew, one step: inputs in, the engine stepped, and the room's own
 * bookkeeping read off what changed. Nothing here reaches into the engine's
 * rules — the tallies are taken by looking at the state before and after. */
function stepCrew(round: Round, crew: Crew, inputs: ReadonlyMap<PlayerId, NetInput>, dt: number) {
  if (crew.state === 'out') return;
  if (crew.state === 'wiped') {
    crew.wipedT += dt;
    if (crew.wipedT >= SHIFT.WIPE_HOLD) launch(round, crew);
    return;
  }
  const sim = crew.sim;
  const frame: Input[] = crew.seats.map(seat => {
    const net = inputs.get(seat.id);
    if (!net) return (seat.input = NEUTRAL);
    let pumps = 0;
    if (net.pumpSeq >= 0) {
      // A counter that went backwards is a reloaded client starting over,
      // not a tap; rebase on it rather than replaying the gap.
      if (seat.pumpSeq < 0 || net.pumpSeq < seat.pumpSeq) seat.pumpSeq = net.pumpSeq;
      pumps = Math.min(MAX_PUMPS_PER_TICK, net.pumpSeq - seat.pumpSeq);
      seat.pumpSeq += pumps;
    }
    return (seat.input = { dir: net.dir, dirHeld: net.dirHeld, pumps });
  });

  // Read before stepping: startLevel clears it on the way past. See rebaseLevel.
  const exitBefore = sim.exitLc;
  const livesBefore = sim.lives;
  /* Who has a line on what. A burst or a rescue is credited to whoever was
   * holding the line when it happened, which only the moment before knows. */
  const lines = sim.players.map(p => ({
    mon: p.harpoon.state === 'hit' && p.harpoon.mon && !p.harpoon.mon.dying ? p.harpoon.mon : null as Monster | null,
    ally: p.harpoon.state === 'hit' && p.harpoon.ally?.downed ? p.harpoon.ally : null,
  }));

  engine.step(sim, dt, frame);

  const sameLevel = sim.levelSerial === crew.levelSerial;
  sim.players.forEach((p, i) => {
    const seat = crew.seats[i], line = lines[i];
    if (!seat) return;
    if (line.mon && (line.mon.dying || line.mon.dead) && !line.mon.crushed) seat.pops++;
    if (line.ally && sameLevel && !line.ally.downed && sim.lives === livesBefore && sim.phase === 'play') {
      seat.rescues++;
      say(round, { type: 'revive', crew: crew.index, who: round.seats.indexOf(crew.seats[sim.players.indexOf(line.ally)]) });
    }
    // `carved` restarts with each level; the shift's total does not.
    seat.cut += p.carved >= seat.cutSeen ? p.carved - seat.cutSeen : p.carved;
    seat.cutSeen = p.carved;
  });

  for (const e of engine.drainEvents(sim)) {
    const out: StampedEvent = { seq: ++crew.eventSeq, type: e.type, at: round.clock };
    if (e.x !== undefined) out.x = q2(e.x);
    if (e.y !== undefined) out.y = q2(e.y);
    // Omitted rather than set to undefined: assertSerializable rejects an
    // explicit undefined where JSON.stringify would quietly drop it.
    if (e.value !== undefined) out.value = typeof e.value === 'number' ? q2(e.value) : e.value;
    crew.events.push(out);

    const who = (index: unknown) => round.seats.indexOf(crew.seats[Number(index)]);
    if (e.type === 'down') {
      const seat = crew.seats[Number(e.value)];
      if (seat) { seat.downs++; say(round, { type: 'down', crew: crew.index, who: who(e.value) }); }
    } else if (e.type === 'bank') {
      crew.levels++;
      say(round, { type: 'bank', crew: crew.index, value: Number(e.value) || 0 });
    } else if (e.type === 'respawn') say(round, { type: 'life', crew: crew.index, value: sim.lives });
    else if (e.type === 'relic' || e.type === 'crystal') say(round, { type: e.type, crew: crew.index, value: String(e.value ?? '') });
    else if (e.type === 'level' && sim.level > round.settings.startLevel) say(round, { type: 'descend', crew: crew.index, value: sim.level });
  }
  while (crew.events.length && (round.clock - crew.events[0].at > EVENT_TICKS || crew.events.length > EVENT_LIMIT)) crew.events.shift();

  if (!sameLevel) rebaseLevel(crew, exitBefore);

  if (sim.phase === 'gameover') {
    /* Wiped. With no clock that is this crew's shift over, and its shaft is
     * left exactly as it ended. On a clock they keep what they banked, lose
     * what they carried, and go back to the top — see launch. */
    crew.wipes++;
    crew.state = round.shiftLeft === null ? 'out' : 'wiped';
    crew.wipedT = 0;
    say(round, { type: 'wipe', crew: crew.index });
  }
}

/* The whistle. Everything stops where it stands, and what the hoppers were
 * still carrying comes up at half pay. */
function blowWhistle(round: Round) {
  round.shiftLeft = 0;
  round.stage = 'whistle';
  round.whistleT = 0;
  for (const crew of round.crews) {
    if (crew.state !== 'dig') continue;
    crew.caught = atRisk(crew);
    crew.salvage = Math.floor(crew.caught * SHIFT.SALVAGE);
    for (const p of crew.sim.players) { p.hopper = 0; p.hopperFrac = 0; p.hopperFull = false; p.oreHeld = 0; p.oreFrac = 0; }
    crew.events.push({ seq: ++crew.eventSeq, type: 'whistle', at: round.clock, value: crew.salvage });
    crew.wire = null;
  }
}

/* Which shaft the television shows.
 *
 * It holds a shaft for a few seconds at least, then moves to whichever crew has
 * the most going on — somebody down, a level one monster from clear — and
 * otherwise to the one it has not looked at for longest. Decided here rather
 * than on the screen because the server has to know which shaft to send. */
function direct(round: Round) {
  if (round.crews.length < 2) return;
  const held = (round.clock - round.spotAt) / STEP_HZ;
  if (held < SHIFT.SPOT_MIN) return;
  const lead = standings(round)[0];
  let best = round.spot, bestScore = -Infinity;
  for (const crew of round.crews) {
    if (crew.index === round.spot || crew.state === 'out') continue;
    const sim = crew.sim;
    const score = (sim.players.some(p => p.downed) ? 5 : 0)
      + (crew.state === 'dig' && leftIn(sim) <= 2 ? 4 : 0)
      + (sim.phase === 'levelclear' || sim.phase === 'descend' ? 4 : 0)
      + (crew === lead ? 1.5 : 0)
      + (crew.state === 'wiped' ? -3 : 0)
      // Round robin underneath it all: the further back in the order, the keener.
      + ((crew.index - round.spot + round.crews.length) % round.crews.length) * -0.1;
    if (score > bestScore) { bestScore = score; best = crew.index; }
  }
  const now = round.crews[round.spot];
  const dull = now.state !== 'dig' || !now.sim.players.some(p => p.downed || p.harpoon.active);
  if (best !== round.spot && (held >= SHIFT.SPOT_MAX || bestScore >= 4 || dull)) {
    round.spot = best;
    round.spotAt = round.clock;
  }
}

/** Everyone gets a suit, chosen or not, and the drill starts. */
function startDigging(round: Round) {
  round.seats.forEach((seat, i) => { seat.suit ??= defaultSuit(i); });
  round.stage = 'dig';
  round.rosterAt = round.clock;
  round.spotAt = round.clock;
  // The terrain never moved while they were choosing, so nothing to rebase.
}

/* ── projections ──────────────────────────────────────────────────────────
 *
 * Everything here is built by hand. State holds typed arrays, a seeded RNG
 * closure and direct object references between monsters and the harpoon, none
 * of which survive assertSerializable — so nothing may be spread out of state
 * wholesale, however convenient it looks. */
const q2 = (v: number) => Math.round(v * 100) / 100;

/* One shaft, packed. Built once per step and handed to every screen that shows
 * it: the television when this crew is on it, and each of the crew's phones. */
function shaftOf(round: Round, crew: Crew): ShaftWire {
  const sim = crew.sim;
  const key = `${crew.run}:${sim.tick}:${sim.phase}:${round.stage}:${crew.eventSeq}`;
  if (crew.wire && crew.wireKey === key) return crew.wire;
  const { rocks, idle } = packRocks(sim.rocks, rockStateIndex, crew.rock0, crew.seated);
  crew.wireKey = key;
  return crew.wire = {
    crew: crew.index,
    run: crew.run,
    /* The client regenerates terrain from these, so the width has to travel
     * with the seed — a level built at the wrong width is a different level. */
    runSeed: sim.runSeed,
    level: sim.level,
    entryLc: crew.entryLc,
    lanes: sim.activeLanes,

    phase: sim.phase,
    deepest: sim.deepest,
    shake: q2(sim.shake),
    banked: sim.banked,
    oreBanked: sim.oreBanked,
    lives: sim.lives, livesMax: sim.livesMax,
    left: leftIn(sim),

    events: crew.events.map(({ at: _at, ...event }) => event),

    players: packPlayers(sim.players, COOP.REVIVE_PUMPS, relicBits),
    monsters: packMonsters(sim.monsters, pumpStages, kindIndex, variantIndex, modeIndex),
    rocks, rock0: crew.rock0, idle,

    fire: sim.fire.map(f => ({
      x: q2(f.x), y: q2(f.y), w: q2(f.w), h: q2(f.h), dir: f.dir,
      t: q2(f.t),
      ...(f.blast ? { blast: true } : {}),
      ...(f.ox === undefined ? {} : { ox: q2(f.ox) }),
      ...(f.oy === undefined ? {} : { oy: q2(f.oy) }),
      ...(f.growT === undefined ? {} : { growT: q2(f.growT) }),
      owner: f.owner ? f.owner.id : null,
    })),

    wheels: sim.wheels.map(w => ({
      id: w.id, x: q2(w.x), y: q2(w.y), dir: w.dir, travel: q2(w.travel),
    })),

    bonus: sim.bonus.active ? sim.bonus.value : 0,
    buried: (sim.relicSite && !sim.relicTaken ? 1 : 0) | (sim.crystalAt && !sim.crystalTaken ? 2 : 0),
  };
}

function rosterOf(round: Round): RosterEntry[] {
  return round.seats.map(seat => ({
    id: seat.id, name: seat.name, color: seat.color, suit: seat.suit ?? '', crew: seat.crew,
  }));
}

function siteOf(round: Round, results = false): SiteWire {
  const crews: number[] = [];
  for (const crew of round.crews) {
    const sim = crew.sim;
    crews.push(
      sim.level, Math.round(sim.deepest), share(crew), atRisk(crew), sim.lives,
      leftIn(sim),
      crew.state === 'out' ? CREW_STATE.out : crew.state === 'wiped' ? CREW_STATE.wiped
        : sim.phase === 'levelclear' || sim.phase === 'descend' ? CREW_STATE.clearing : CREW_STATE.dig,
      crew.seats.length,
    );
  }
  return {
    crews,
    // Nobody is hurt and nothing is happening at the results.
    feed: results ? [] : round.feed,
    marks: results ? [] : round.seats.map(seat => {
      const p = round.crews[seat.crew].sim.players[seat.slot];
      return p ? Math.max(0, Math.min(15, p.hp)) | (p.downed || p.dying ? 16 : 0) : 0;
    }),
    /* The shift's tallies, for the results screen. They ride here, once per
     * crew and once per digger, rather than as a label on each row of the outcome: the room
     * re-sends the whole outcome to every phone with every results frame, and
     * at sixty-four diggers the labels alone were three kilobytes of it. */
    ...(results ? {
      tallies: round.crews.flatMap(crew =>
        [earned(crew), crew.levels, crew.wipes, crew.caught, crew.salvage, Math.round(deepestOf(crew))]),
      diggers: round.seats.flatMap(seat => [seat.cut, seat.pops, seat.rescues, seat.downs]),
    } : {}),
  };
}

/* What every screen is sent. One crew: this is the whole game, exactly as it
 * always was. Several: this is the shaft the television is on, plus the few
 * numbers that are the race, and each phone's own shaft rides in its private
 * view instead. */
function publicOf(round: Round, results: boolean): PublicView {
  const crew = round.crews[round.spot];
  refreshEdits(crew);
  /* The cache's revision has to move whenever the published list is a
   * different list — the same crew's ground cut further, or another crew's. */
  const published = `${crew.index}:${crew.run}:${crew.editsRev}`;
  if (published !== round.published) { round.published = published; round.revision++; }
  const fresh = round.clock - round.rosterAt < STEP_HZ / 2;
  const view: PublicView = {
    ...shaftOf(round, crew),
    /* The results screen is a table, not a shaft, and the room goes on sending
     * snapshots while people read it: nothing that moved needs to keep going out. */
    ...(results ? { events: [], players: [], monsters: [], rocks: [], idle: [], fire: [], wheels: [] } : {}),
    revision: round.revision,
    edits: crew.edits,
    tick: crew.sim.tick,
    crewCount: round.crews.length,
    kitup: round.stage === 'kitup'
      ? {
          secondsLeft: q2(Math.max(0, COOP.KIT_SECONDS - round.kitT)),
          everyonePicked: round.seats.filter(s => s.connected).every(s => !!s.suit),
        }
      : null,
    shiftLeft: round.shiftLeft === null ? null : Math.max(0, Math.ceil(round.shiftLeft)),
    whistle: round.stage === 'whistle' || (round.stage === 'done' && round.shiftLeft !== null),
  };
  if (results) {
    /* The results are one frame, projected once and re-sent as it stands, so it
     * is complete and as small as it can be made: see `cast` in model.ts. */
    view.cast = {
      names: round.seats.map(seat => seat.name),
      suits: round.seats.map(seat => Math.max(0, SUITS.findIndex(suit => suit.id === seat.suit))),
    };
    view.site = siteOf(round, true);
    return view;
  }
  /* Names, colours and suits change only during the kit-up, so they go out
   * when they change and every couple of seconds after that, never per frame:
   * sixty-four of them are four and a half kilobytes. */
  if (fresh || round.clock % (2 * STEP_HZ) < 3) view.roster = rosterOf(round);
  if (round.clock % 12 < 3) view.site = siteOf(round);
  return view;
}

function seatOf(round: Round, playerId: PlayerId) {
  return round.seats.find(s => s.id === playerId);
}

function privateOf(round: Round, playerId: PlayerId, results = false): PrivateView {
  const seat = seatOf(round, playerId);
  const crew = seat ? round.crews[seat.crew] : undefined;
  const p = seat && crew ? crew.sim.players[seat.slot] : undefined;
  if (!seat || !crew || !p) {
    return {
      pumpSeq: 0, playing: false, hp: 0, maxHp: 0, air: 0, hopper: 0, breachCd: 0,
      downed: false, downT: 0, beingRevived: false,
      message: 'Watching this shaft.', crew: -1,
    };
  }
  const sim = crew.sim;
  const beingRevived = p.downed && p.revivePumps > 0;
  /* Is there anybody who could come for them? The same question the engine asks
   * before it skips the downed window, and for the same reason: alone, or as
   * the last one standing, the next hit costs a life outright, and telling
   * someone they are about to be "put down" would be telling them to expect a
   * rescue that cannot arrive. */
  const rescuable = sim.players.some(q => q !== p && !q.downed && !q.dying);
  const left = leftIn(sim);
  const view: PrivateView = {
    pumpSeq: seat.pumpSeq,
    playing: true,
    hp: p.hp,
    maxHp: p.maxHp,
    air: q2(p.air),
    hopper: p.hopper,
    breachCd: q2(p.breachCd),
    downed: p.downed,
    downT: q2(Math.max(0, p.downT)),
    beingRevived,
    message: round.stage === 'whistle' || round.stage === 'done' && round.shiftLeft !== null ? 'Whistle! Tools down.'
      : crew.state === 'wiped' ? 'Crew wiped. Back to the top…'
      : sim.phase === 'gameover' ? 'The shift is over.'
      : sim.phase === 'levelclear' || sim.phase === 'descend' ? 'Level clear. Haul banked!'
      : beingRevived ? 'Someone has you. Hold on.'
      : p.downed ? 'You are down. Someone has to reach you.'
      : p.hp <= 1 ? (rescuable ? 'One more hit puts you down.'
                   : sim.lives > 0 ? 'One more hit costs a life.'
                   : 'One more hit ends the shift.')
      : sim.players.every(q => q.downed || q.air <= 0) ? 'No air left. The roof is coming in!'
      : p.air > 0 && p.air <= PARTY_TUNE.AIR_LOW ? 'Air is low. Dig for a damp patch.'
      : p.hopperFull ? `Hopper full. Clear the last ${left} to bank it.`
      : left === 1 ? 'One left. Burst it to bank the haul.'
      : 'Dig.',
    crew: crew.index,
  };
  /* With rival crews the public view is the television's shaft, so this seat's
   * own comes here — with the ground as a journal, because nothing caches a
   * private view for us. See ShaftCuts. Not at the results: nobody is looking
   * at a shaft any more. */
  if (round.crews.length > 1 && !results) {
    journal(round, crew);
    const cuts: ShaftCuts = {
      cutTo: crew.cutSeq, cutFrom: crew.tail[0]?.seq ?? crew.cutSeq + 1, cuts: crew.cuts,
    };
    if (seat.needBase) { refreshEdits(crew); cuts.base = crew.edits; seat.needBase = false; }
    view.shaft = { ...shaftOf(round, crew), ...cuts };
  }
  return view;
}

/* ── rules ────────────────────────────────────────────────────────────── */

const clampInt = (raw: unknown, lo: number, hi: number, fallback: number) =>
  Math.min(hi, Math.max(lo, Math.floor(Number(raw ?? fallback)) || fallback));

export const rules: GameRules<Round, NetInput, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw): Settings {
    const v = (raw ?? {}) as Partial<Settings>;
    const shift = Math.floor(Number(v.shift ?? SHIFT_AUTO)) || SHIFT_AUTO;
    return {
      startLevel: clampInt(v.startLevel, 1, 30, 1),
      lives: clampInt(v.lives, 1, 9, COOP.LIVES),
      crewSize: clampInt(v.crewSize, 1, 4, 4),
      shift: shift === SHIFT_OPEN || shift === SHIFT_AUTO ? shift : Math.min(15, Math.max(2, shift)),
    };
  },

  parseInput(raw): NetInput {
    const v = raw as Partial<NetInput> | null;
    if (!v || typeof v !== 'object') throw new Error('Input must be an object.');
    const dir = v.dir === null || v.dir === undefined ? null : Number(v.dir);
    if (dir !== null && (!Number.isInteger(dir) || dir < 0 || dir > 3)) {
      throw new Error('Direction must be 0-3 or null.');
    }
    const pumpSeq = Number(v.pumpSeq);
    if (!Number.isSafeInteger(pumpSeq) || pumpSeq < 0) {
      throw new Error('Pump counter must be a nonnegative integer.');
    }
    return { dir, dirHeld: !!v.dirHeld, pumpSeq };
  },

  parseAction(raw): Action {
    const v = raw as { type?: unknown; turnId?: unknown; suit?: unknown } | null;
    if (!v || typeof v !== 'object' || (v.type !== 'kit' && v.type !== 'sync')) throw new Error('Unknown action.');
    if (v.turnId !== KIT_TURN) throw new Error('That kit-up is over.');
    if (v.type === 'sync') return { type: 'sync', turnId: KIT_TURN };
    if (!isSuit(v.suit)) throw new Error('No such suit.');
    return { type: 'kit', turnId: KIT_TURN, suit: v.suit };
  },

  /* pumpSeq -1 is reachable only from here, and means "this seat told us
   * nothing". Resetting it to 0 instead would make the next real value look
   * like a burst of taps the player never made. */
  neutralInput(): NetInput {
    return { dir: null, dirHeld: false, pumpSeq: -1 };
  },

  create(ctx: RoundContext, settings: Settings): Round {
    const sizes = crewSizes(ctx.players.length, settings.crewSize);
    const seats: Seat[] = [];
    const crews: Crew[] = sizes.map((size, index) => {
      const mine = ctx.players.slice(seats.length, seats.length + size).map((p, slot): Seat => ({
        id: p.id, name: p.name, color: p.color, suit: null,
        connected: true, pumpSeq: 0, input: NEUTRAL,
        crew: index, slot, needBase: false,
        cut: 0, cutSeen: 0, pops: 0, rescues: 0, downs: 0,
      }));
      seats.push(...mine);
      return {
        index, seats: mine, sim: null as unknown as State, run: 0, state: 'dig', wipedT: 0,
        bankedBefore: 0, oreBefore: 0, salvage: 0, caught: 0, deepest: 0, levels: 0, wipes: 0,
        events: [], eventSeq: 0,
        pristineDirt: new Uint8Array(0), edits: [], editsAt: -1, editsRev: 0,
        levelSerial: 0, entryLc: null, rock0: 0, seated: 0,
        shadow: new Uint8Array(0), shadowAt: -1, cutSeq: 0, tail: [], cuts: [], cutsKey: '',
        wire: null, wireKey: '',
      };
    });
    /* A clock when the host set one, or when there is somebody to race. One
     * crew left to itself keeps the original rule: dig until you are wiped. */
    const minutes = settings.shift === SHIFT_OPEN ? 0
      : settings.shift === SHIFT_AUTO ? (crews.length > 1 ? SHIFT.AUTO_MINUTES : 0)
      : settings.shift;
    const round: Round = {
      settings,
      seed: ctx.seed >>> 0,
      seats, crews,
      get sim() { return this.crews[0].sim; },
      stage: 'kitup',
      kitT: 0,
      kitGrace: 0,
      clock: 0,
      shiftLeft: minutes > 0 ? minutes * 60 : null,
      whistleT: 0,
      spot: 0, spotAt: 0,
      revision: 1, published: '',
      feed: [], feedSeq: 0,
      rosterAt: 0,
    };
    for (const crew of crews) launch(round, crew);
    return round;
  },

  applyAction(round, playerId, action) {
    const seat = seatOf(round, playerId);
    if (action.type === 'sync') { if (seat) seat.needBase = true; return; }
    if (round.stage !== 'kitup') throw new Error('The drill has already started.');
    if (!seat) throw new Error('Only a seated digger can kit up.');
    seat.suit = action.suit;
    round.rosterAt = round.clock;
    // Changing your mind restarts the grace, so the crew is never started by a
    // countdown that began before the last person had settled.
    round.kitGrace = 0;
  },

  tick(round, inputs, dtSeconds) {
    installTune();
    round.clock++;

    if (round.stage === 'kitup') {
      round.kitT += dtSeconds;
      /* Only connected seats hold the crew up. A phone that dropped during the
       * picker would otherwise stall everyone for the full half minute, and the
       * seat still gets a suit when the drill starts. */
      const waiting = round.seats.filter(s => s.connected);
      const everyonePicked = waiting.length > 0 && waiting.every(s => s.suit);
      round.kitGrace = everyonePicked ? round.kitGrace + dtSeconds : 0;
      if (round.kitT >= COOP.KIT_SECONDS || round.kitGrace >= COOP.KIT_GRACE) {
        startDigging(round);
      }
      return;                       // the shaft holds still while they choose
    }
    if (round.stage === 'whistle') {
      round.whistleT += dtSeconds;
      if (round.whistleT >= SHIFT.WHISTLE_HOLD) round.stage = 'done';
      return;
    }
    if (round.stage === 'done') return;

    if (round.shiftLeft !== null) {
      round.shiftLeft -= dtSeconds;
      if (round.shiftLeft <= 0) { blowWhistle(round); return; }
    }
    for (const crew of round.crews) stepCrew(round, crew, inputs, dtSeconds);
    if (round.crews.every(crew => crew.state === 'out')) round.stage = 'done';
    direct(round);
  },

  onPresenceChange(round, playerId, connected) {
    const seat = seatOf(round, playerId);
    if (!seat) return;
    seat.connected = connected;
    // A phone coming back has an empty ground; hand it the whole of its shaft's.
    if (connected) seat.needBase = true;
    // Keep the acknowledged counter: a returning controller resumes from its private view.
  },

  publicView(round, ctx: ViewContext) { return publicOf(round, ctx.phase === 'results'); },
  playerView(round, playerId, ctx: ViewContext) { return privateOf(round, playerId, ctx.phase === 'results'); },

  outcome(round) {
    // A crew still choosing suits has not finished anything.
    if (round.stage === 'kitup') return { complete: false, winners: [], rows: [] };
    const order = standings(round);
    /* One crew is cooperative, so nobody wins: the run is the score. Several
     * are a race, and the crew with the biggest share takes it — every digger
     * in it, and every crew level with it. */
    const top = order.length > 1 ? share(order[0]) : -1;
    const complete = round.stage === 'done'
      || (round.shiftLeft === null && round.crews.every(crew => crew.sim.phase === 'gameover'));
    return {
      complete,
      winners: top > 0 ? order.filter(crew => share(crew) === top).flatMap(crew => crew.seats.map(seat => seat.id)) : [],
      rows: round.seats.map(seat => {
        const crew = round.crews[seat.crew];
        return {
          playerId: seat.id,
          score: share(crew),
          rank: 1 + order.findIndex(other => share(other) === share(crew)),
        };
      }),
    };
  },

  dispose() { /* Plain data; nothing to release. */ },
};

export default rules;

/** Exported for tests: the field size the projection is built against. */
export const FIELD = { GW, GH, cells: GW * GH };

/** Exported for tests: rebuild a level the way a client would. */
export function levelSeedFor(runSeed: number, level: number) {
  return levelSeed(runSeed, level);
}
