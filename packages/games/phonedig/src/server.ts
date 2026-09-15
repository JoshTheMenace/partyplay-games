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
import { GRID, lanesFor, levelSeed } from './worldgen';
import { pumpStages } from './monsters';
import { MODE_IDS, ROCK_STATE_IDS, kindIndex, variantIndex } from './bestiary';
import { COOP, PARTY_TUNE } from './tuning';
import { defaultSuit, isSuit } from './suits';
import type {
  Action, Edit, Input, NetEvent, NetInput, Player, PrivateView, PublicView, Settings,
  State,
} from './model';
import { packMonsters, packRocks } from './model';

const modeIndex = (mode: string) => Math.max(0, MODE_IDS.indexOf(mode as never));
const rockStateIndex = (s: string) => Math.max(0, ROCK_STATE_IDS.indexOf(s as never));

const { GW, GH } = GRID;

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
};

/** The kit-up's turn id. One per round, so a stale pick is simply not this. */
const KIT_TURN = 1;

/* How many recent events ride along with a snapshot.
 *
 * Three ticks happen per snapshot at 60/20, and a busy one — a Sapper chain
 * taking out its neighbours — emits a burst. This is generous enough to carry
 * that and small enough not to matter next to the entities. Overflow drops the
 * OLDEST, because a sound you have already missed the moment for is worth less
 * than the one that just happened. */
const EVENT_LIMIT = 24;

export type Round = {
  sim: State;
  settings: Settings;
  seats: Seat[];

  /* ── kitting up ───────────────────────────────────────────────────────
   * The crew picks a suit before the shaft starts moving. This lives HERE and
   * not in the engine on purpose: the simulation is the ported single-player
   * game and every line of it is covered by a parity check against upstream.
   * A pre-round phase is a property of the room, not of the digging, so it sits
   * above the engine and simply does not step it. */
  stage: 'kitup' | 'dig';
  kitT: number;
  /** Seconds since the last seat picked, once they all have. */
  kitGrace: number;

  /** Recent events and the counter that lets a client replay only new ones. */
  events: NetEvent[];
  eventSeq: number;

  /** The generated dirt for this level, before anyone cut into it. */
  pristineDirt: Uint8Array;
  /** Cached projection of every cell that has changed since generation. */
  edits: Edit[];
  /** sim.dirtRev when `edits` was last rebuilt. */
  editsAt: number;
  /** Monotonic, and bumped only when `edits` actually changes. */
  revision: number;
  /** sim.levelSerial when the pristine copy was taken. */
  levelSerial: number;
  /** The column the previous level's shaft came down in; null on level 1. */
  entryLc: number | null;

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
function refreshEdits(round: Round) {
  const sim = round.sim;
  if (sim.dirtRev === round.editsAt) return;
  const dirt = sim.dirt, was = round.pristineDirt;
  const out: Edit[] = [];
  let start = -1;
  for (let i = 0; i < dirt.length; i++) {
    const cut = dirt[i] !== was[i];
    if (cut) { if (start < 0) start = i; continue; }
    if (start >= 0) { out.push([start, i - start]); start = -1; }
  }
  if (start >= 0) out.push([start, dirt.length - start]);
  round.editsAt = sim.dirtRev;
  round.edits = out;
  round.revision++;
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
function rebaseLevel(round: Round, entryLc: number | null) {
  const sim = round.sim;
  round.pristineDirt = sim.dirt.slice();
  round.edits = [];
  round.editsAt = sim.dirtRev;
  round.levelSerial = sim.levelSerial;
  round.entryLc = entryLc;
  round.revision++;
}

/** Everyone gets a suit, chosen or not, and the drill starts. */
function startDigging(round: Round) {
  round.seats.forEach((seat, i) => { seat.suit ??= defaultSuit(i); });
  round.stage = 'dig';
  // The terrain never moved while they were choosing, so nothing to rebase.
}

/* ── projections ──────────────────────────────────────────────────────────
 *
 * Everything here is built by hand. State holds typed arrays, a seeded RNG
 * closure and direct object references between monsters and the harpoon, none
 * of which survive assertSerializable — so nothing may be spread out of state
 * wholesale, however convenient it looks. */
const q2 = (v: number) => Math.round(v * 100) / 100;

function publicOf(round: Round): PublicView {
  const sim = round.sim;
  refreshEdits(round);
  const lead = sim.players[0];
  return {
    revision: round.revision,
    edits: round.edits,

    runSeed: sim.runSeed,
    level: sim.level,
    entryLc: round.entryLc,
    /* The client regenerates terrain from these, so the width has to travel
     * with the seed — a level built at the wrong width is a different level. */
    lanes: sim.activeLanes,
    activeGW: sim.activeGW,

    phase: sim.phase,
    tick: sim.tick,
    skyRows: sim.skyRows,
    theme: sim.theme,
    depth: lead ? lead.depth : 0,
    deepest: sim.deepest,
    carved: sim.carved,

    /* The crew-wide readouts a watching screen wants. Per-digger air, haul and
     * health ride on each player below, and again in their own private view. */
    air: q2(lead ? lead.air : 0), airMax: lead ? lead.airMax : 0,
    hopper: sim.players.reduce((n, q) => n + q.hopper, 0),
    hopperMax: sim.players.reduce((n, q) => n + q.hopperMax, 0),
    hopperFull: sim.players.some(q => q.hopperFull),
    banked: sim.banked,
    oreHeld: sim.players.reduce((n, q) => n + q.oreHeld, 0),
    oreBanked: sim.oreBanked,
    relics: lead ? [...lead.relics] : [],
    lives: sim.lives, livesMax: sim.livesMax,
    kitup: round.stage === 'kitup'
      ? {
          secondsLeft: q2(Math.max(0, COOP.KIT_SECONDS - round.kitT)),
          everyonePicked: round.seats.filter(s => s.connected).every(s => !!s.suit),
        }
      : null,
    events: round.events.map(e => ({ ...e })),
    lightRadius: q2(lead ? lead.lightRadius : 0),
    shake: q2(sim.shake),

    players: sim.players.map((q, i) => ({
      id: q.seatId ?? '',
      name: round.seats[i]?.name ?? 'Digger',
      color: round.seats[i]?.color ?? '#8b8378',
      x: q2(q.x), y: q2(q.y),
      dir: q.dir,
      digging: q.digging, moving: q.moving,
      dying: q.dying, dyingT: q2(q.dyingT),
      invuln: q2(q.invuln),
      drilling: q.drilling,
      hp: q.hp, maxHp: q.maxHp,
      air: q2(q.air), airMax: q.airMax,
      hopper: q.hopper, hopperMax: q.hopperMax,
      relics: [...q.relics],
      lightRadius: q2(q.lightRadius),
      suit: round.seats[i]?.suit ?? null,
      downed: q.downed,
      downT: q2(Math.max(0, q.downT)),
      reviveProgress: q2(Math.max(0, Math.min(1, q.revivePumps / COOP.REVIVE_PUMPS))),
    })),

    monsters: packMonsters(sim.monsters, pumpStages, kindIndex, variantIndex, modeIndex),
    rocks: packRocks(sim.rocks, rockStateIndex),

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

    hazards: sim.hazards.map(z => ({
      kind: z.kind, lc: z.lc, lr: z.lr, warnT: q2(z.warnT), dir: z.dir,
    })),

    harpoons: sim.players.flatMap(q => (q.harpoon.active ? [{
      ownerId: q.seatId ?? '',
      x: q2(q.x), y: q2(q.y), dir: q.harpoon.dir,
      len: q2(q.harpoon.len), state: q.harpoon.state,
    }] : [])),

    bonus: sim.bonus.active
      ? { x: q2(sim.bonus.x), y: q2(sim.bonus.y), value: sim.bonus.value }
      : null,

    pockets: sim.pockets.filter(q => !q.taken).map(q => ({ lc: q.lc, lr: q.lr })),

    relicSite: sim.relicSite && !sim.relicTaken
      ? { x: sim.relicSite.at.x, y: sim.relicSite.at.y, pool: sim.relicSite.pool }
      : null,

    crystalAt: sim.crystalAt && !sim.crystalTaken
      ? { lc: sim.crystalAt.lc, lr: sim.crystalAt.lr, id: sim.crystalAt.id }
      : null,
  };
}

function digger(round: Round, playerId: PlayerId): Player | undefined {
  return round.sim.players.find(q => q.seatId === playerId);
}

function privateOf(round: Round, playerId: PlayerId): PrivateView {
  const sim = round.sim;
  const p = digger(round, playerId);
  if (!p) {
    return {
      playing: false, hp: 0, maxHp: 0, air: 0, hopper: 0, breachCd: 0,
      downed: false, downT: 0, beingRevived: false,
      message: 'Watching this shaft.',
    };
  }
  const beingRevived = p.downed && p.revivePumps > 0;
  /* Is there anybody who could come for them? The same question the engine asks
   * before it skips the downed window, and for the same reason: alone, or as
   * the last one standing, the next hit costs a life outright, and telling
   * someone they are about to be "put down" would be telling them to expect a
   * rescue that cannot arrive. */
  const rescuable = sim.players.some(q => q !== p && !q.downed && !q.dying);
  return {
    playing: true,
    hp: p.hp,
    maxHp: p.maxHp,
    air: q2(p.air),
    hopper: p.hopper,
    breachCd: q2(p.breachCd),
    downed: p.downed,
    downT: q2(Math.max(0, p.downT)),
    beingRevived,
    message: sim.phase === 'gameover' ? 'The shift is over.'
      : beingRevived ? 'Someone has you. Hold on.'
      : p.downed ? 'You are down. Someone has to reach you.'
      : p.hp <= 1 ? (rescuable ? 'One more hit puts you down.'
                   : sim.lives > 0 ? 'One more hit costs a life.'
                   : 'One more hit ends the shift.')
      : p.hopperFull ? 'Hopper full — descend to bank it.'
      : 'Dig.',
  };
}

/* ── rules ────────────────────────────────────────────────────────────── */

export const rules: GameRules<Round, NetInput, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw): Settings {
    const v = (raw ?? {}) as Partial<Settings>;
    const startLevel = Math.min(30, Math.max(1, Math.floor(Number(v.startLevel ?? 1)) || 1));
    const lives = Math.min(9, Math.max(1, Math.floor(Number(v.lives ?? COOP.LIVES)) || COOP.LIVES));
    return { startLevel, lives };
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
    const v = raw as Partial<Action> | null;
    if (!v || typeof v !== 'object' || v.type !== 'kit') throw new Error('Unknown action.');
    if (v.turnId !== KIT_TURN) throw new Error('That kit-up is over.');
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
    engine.setTune(PARTY_TUNE);
    /* create() seats one digger; the rest of the crew joins before startGame so
     * every one of them is reset and given a level id in the same pass. Seat
     * order is roster order, which is what lets tick() hand inputs out by
     * index rather than by lookup. */
    /* The shaft widens with the crew, on the same curve the monster count
     * uses, so ten diggers get a field they can actually spread out in rather
     * than ten bodies in a ten-lane corridor. Fixed for the run: every level
     * regenerates from it, and a width that changed mid-shift would break the
     * clients rebuilding terrain from the seed. */
    const sim = engine.create({
      runSeed: ctx.seed >>> 0,
      lanes: lanesFor(ctx.players.length),
    });
    sim.players[0].seatId = ctx.players[0]?.id ?? null;
    for (let i = 1; i < ctx.players.length; i++) engine.addPlayer(sim, ctx.players[i].id);
    engine.startGame(sim, settings.startLevel, { lives: settings.lives });
    engine.drainEvents(sim);

    const round: Round = {
      sim,
      settings,
      seats: ctx.players.map(p => ({
        id: p.id, name: p.name, color: p.color, suit: null,
        connected: true, pumpSeq: 0, input: NEUTRAL,
      })),
      pristineDirt: sim.dirt.slice(),
      edits: [],
      editsAt: sim.dirtRev,
      stage: 'kitup',
      kitT: 0,
      kitGrace: 0,
      events: [],
      eventSeq: 0,
      revision: 1,
      levelSerial: sim.levelSerial,
      entryLc: sim.exitLc,
    };
    return round;
  },

  applyAction(round, playerId, action) {
    if (round.stage !== 'kitup') throw new Error('The drill has already started.');
    const seat = round.seats.find(s => s.id === playerId);
    if (!seat) throw new Error('Only a seated digger can kit up.');
    seat.suit = action.suit;
    // Changing your mind restarts the grace, so the crew is never started by a
    // countdown that began before the last person had settled.
    round.kitGrace = 0;
  },

  tick(round, inputs, dtSeconds) {
    installTune();
    const sim = round.sim;

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

    const frame: Input[] = round.seats.map(seat => {
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

    engine.step(sim, dtSeconds, frame);
    for (const e of engine.drainEvents(sim)) {
      const out: NetEvent = { seq: ++round.eventSeq, type: e.type };
      if (e.x !== undefined) out.x = q2(e.x);
      if (e.y !== undefined) out.y = q2(e.y);
      // Omitted rather than set to undefined: assertSerializable rejects an
      // explicit undefined where JSON.stringify would quietly drop it.
      if (e.value !== undefined) out.value = typeof e.value === 'number' ? q2(e.value) : e.value;
      round.events.push(out);
    }
    if (round.events.length > EVENT_LIMIT) {
      round.events.splice(0, round.events.length - EVENT_LIMIT);
    }

    if (sim.levelSerial !== round.levelSerial) rebaseLevel(round, exitBefore);
  },

  onPresenceChange(round, playerId, connected) {
    const seat = round.seats.find(s => s.id === playerId);
    if (!seat) return;
    seat.connected = connected;
    // A returning client restarts its own counter, so forget the old one.
    if (!connected) seat.pumpSeq = -1;
  },

  publicView(round, _ctx: ViewContext) { return publicOf(round); },
  playerView(round, playerId, _ctx: ViewContext) { return privateOf(round, playerId); },

  outcome(round) {
    const sim = round.sim;
    // A crew still choosing suits has not finished anything.
    if (round.stage === 'kitup') return { complete: false, winners: [], rows: [] };
    /* Cooperative, so nobody wins: the run is the score. The bank is shared, so
     * every row reports the same banked figure and differs in what that digger
     * personally cut and carried. */
    return {
      complete: sim.phase === 'gameover',
      winners: [],
      rows: round.seats.map(seat => {
        const p = sim.players.find(q => q.seatId === seat.id);
        return {
          playerId: seat.id,
          score: sim.banked,
          label: `${seat.name} · ${Math.round(sim.deepest)} m · ${p ? p.carved : 0} cut`,
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
