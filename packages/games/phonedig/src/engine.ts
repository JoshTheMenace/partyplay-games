/* The simulation. Pure state; no DOM, no clock, no Math.random.
 *
 * This file may import content.js, world.js and monsters.js and nothing else.
 * Every source of randomness is state.rng, seeded from the run seed, so a level
 * is fully reproducible from `?seed=` — which is the only reason that debugging
 * tool is worth anything. A single stray Math.random() breaks that silently,
 * with no visible symptom until a bug refuses to recur, so there is a grep for
 * it in scripts/check-purity.sh.
 *
 * THE CAMERA IS NOT HERE AND MUST NEVER BE. The view scrolls; the simulation
 * does not know it. Four temptations to refuse, because each is the natural
 * thing to reach for once the whole field no longer fits on screen:
 *
 *   - do NOT skip stepping off-screen monsters (there are at most 12; skipping
 *     any would make the simulation depend on the size of the phone)
 *   - do NOT spawn "just off screen" — spawn by depth row, in generateLevel
 *   - the descend drill moves in CELLS per second, never screens per second
 *   - "is it visible" is a question only the view may ask
 */

import {
  GRID, TUNE, DX, DY,
  generateLevel, levelSeed, levelParams, makeRng, idx, skyRowsFor, depthOf,
  themeOf, lightRadiusFor, applyRelics, RELIC_BY_ID,
} from './worldgen';
import {
  setTune as setWorldTune, tune,
  clamp, overlaps, alignOffset, laneOf, dirtAt, diggingAhead, carve, breakTile,
  spawnedRocks,
  blockingRockAt, blockingActorAt, emit, drainEvents, particles, popup, addDirt,
  repath,
} from './world';
import {
  newMonster, stepMonster, popMonster, beginHunt, pumpStages, counts,
  fireRect, clipFire,
} from './monsters';
import type { State, Player, Input, Hazard, Wheel, Tune } from './model';
import type { PlayerId } from '../../../party-contract/src/index';
import { COOP } from './tuning';
import { lanesFor } from './worldgen';

/** What a fresh run is seeded with. */
export type CreateOpts = {
  runSeed?: number;
  level?: number;
  hopperMax?: number;
  maxHp?: number;
  /** Lane columns in play. Fixed for the run: every level regenerates, and a
   *  width that changed mid-shift would break the clients rebuilding terrain. */
  lanes?: number;
};

/** What a shift starts with. `lives` is the team pool; see COOP. */
export type StartOpts = { relics?: readonly string[]; lives?: number };

export { drainEvents, tune };

/* The run's BOUGHT tunables, kept so relics have something to fold onto.
 *
 * Relics are lost on death, so their effect has to be removable — and the only
 * way to remove a `*= 1.5` cleanly is never to have applied it to the stored
 * value in the first place. So the shop's output is held here untouched and the
 * effective tune is rebuilt from it every time the relic list changes. Rebuild,
 * never unwind. */
let baseTune: Tune = TUNE;

export function setTune(t: Tune | null | undefined) {
  baseTune = t || TUNE;
  setWorldTune(baseTune);
}

/* Rebuild the effective tune and the behaviour flags from the relics carried
 * right now, and push the consequences into the pieces of state that cache a
 * tunable rather than reading it every frame. */
function refreshRelics(state: State, p: Player) {
  const r = applyRelics(baseTune, p.relics);
  const prevAirMax = p.airMax;
  p.tune = r.tune;
  setWorldTune(r.tune);
  p.rockproof = r.flags.rockproof;
  p.fireproof = r.flags.fireproof;
  p.pierce = r.flags.pierce;
  p.wide = r.flags.wide;
  /* Not a relic flag — a bought upgrade — but mirrored here for the same reason
   * the relic flags are: the HUD needs to know whether to show the recharge pip
   * at all, and it may not reach into tune() itself. */
  p.breach = r.tune.BREACH > 0;
  p.breachMax = r.tune.BREACH_CD;
  p.hopperMax = Math.max(p.hopperMax, r.tune.HOPPER);
  p.airMax = r.tune.AIR_MAX;
  // Long Lungs has to feel like a lungful, not like a bigger empty bottle: the
  // headroom it adds is handed over as breath immediately.
  if (p.airMax > prevAirMax) p.air += p.airMax - prevAirMax;
  p.air = Math.min(p.air, p.airMax);
  p.lightRadius = lightRadiusFor(themeOf(state.level), r.tune.LANTERN);
  return r.tune;
}

export const DT = 1 / 60;

const { GW, GH, LW, LH } = GRID;

/* ── lifecycle ────────────────────────────────────────────────────────── */

export function create(opts?: CreateOpts): State {
  const runSeed = (opts?.runSeed ?? 0) >>> 0;
  const state: State = {
    phase: 'title',
    runSeed,
    level: (opts && opts.level) || 1,

    /* Identity and an integer sim clock. The ONLY concession the simulation
     * makes to the view's animation layer: a stable id per entity means the
     * view can hang an animation track off something that survives a frame,
     * without any animation state living on the simulation. */
    nextId: 1,
    tick: 0,

    /* Banked by the crew. A hopper is personal and at risk; the bank is not. */
    banked: 0,
    oreBanked: 0,

    lives: COOP.LIVES,
    livesMax: COOP.LIVES,

    relicTaken: false,        // whether THIS level's chamber is emptied
    crystalTaken: false,

    /* Cells cut this step, recorded by carve() and drained below in step().
     * Not state.events — that array belongs to the view. This one never leaves
     * the simulation. */
    carveEvents: [],

    hazardDrain: 1,           // this frame's air-drain multiplier from hazards

    levelSerial: 0,
    dirtRev: 0,
    rowRev: new Int32Array(GH),
    carved: 0,
    playerCarved: 0,      // ...of which the player cut themselves; see stepPlayer
    dirt: new Uint8Array(GW * GH),
    ore: new Uint8Array(GW * GH),
    pocketHint: new Uint8Array(GW * GH),
    activeGW: 0,              // set immediately below, from opts
    activeLanes: 0,
    skyRows: skyRowsFor(1),
    theme: 'topsoil',
    deepest: 0,               // the deepest any digger reached this run

    players: [],
    monsters: [],
    rocks: [],
    fire: [],
    wheels: [],
    particles: [],
    popups: [],
    bonus: { active: false, x: 0, y: 0, t: 0, value: 0, at: { lc: 0, lr: 0 } },
    pockets: [],
    relicSite: null,
    crystalAt: null,
    hazards: [],
    events: [],

    dist: new Int16Array(LW * LH),
    nearest: new Int8Array(LW * LH),
    seenScratch: new Uint8Array(LW * LH),
    repathT: 0,
    wokenAt: 0,
    caveinT: 0,
    caveinNext: 0,
    shake: 0,
    phaseT: 0,
    exitLc: null,             // the column the drill went down in
    params: levelParams(1),
    rng: makeRng(runSeed ^ 0x5bf03635),
    spawn: { lc: 0, lr: 0 },
  };
  state.activeLanes = Math.max(4, Math.min(GRID.LW, (opts?.lanes ?? lanesFor(1)) | 0));
  state.activeGW = state.activeLanes * 2;
  addPlayer(state, null, opts);
  return state;
}

/* A fresh digger.
 *
 * Takes no id: startLevel hands every digger one at the top of each level, and
 * a monster's id has to come after them all. Consuming one here would shift the
 * whole level's id sequence, which the seeded replay depends on. */
export function newPlayer(opts?: CreateOpts, seatId: PlayerId | null = null): Player {
  const T = tune();
  const x = 0, y = 0;
  return {
    id: 0,
    seatId,
    x, y, px: x, py: y,
    dir: 2, pendingDir: -1, pendingT: 0,
    digging: false, moving: false,
    invuln: 0, dying: false, dyingT: 0,
    releaseT: 0,
    /* Breaching Tip's cooldown lives on the PLAYER, not on state.harpoon.
     * The harpoon record is reset on every hit, on death and at level start, so
     * a cooldown kept there would be clear again on the very next throw and the
     * upgrade would be a free drill. */
    breachCd: 0,
    drilling: false,          // scripted descent; input is ignored while true

    hp: opts?.maxHp || T.MAX_HP,
    maxHp: opts?.maxHp || T.MAX_HP,
    helmet: T.HELMET,

    /* Air is the cave-in clock made visible. See TUNE.AIR_MAX. */
    air: T.AIR_MAX,
    airMax: T.AIR_MAX,

    /* The haul, at risk until it is banked. NOT `dirt` — that name is the grid
     * Uint8Array. Ore rides in its own purse and is not capped by the hopper. */
    hopper: 0,
    hopperFrac: 0,
    hopperMax: opts?.hopperMax || T.HOPPER,
    hopperFull: false,
    oreHeld: 0,
    oreFrac: 0,

    relics: [],               // ids picked up THIS RUN, lost on death
    /* Relic flags, mirrored out of applyRelics so the hot paths test a boolean
     * instead of walking the relic list every frame. */
    rockproof: false,
    fireproof: false,
    pierce: false,
    wide: false,
    breach: false,
    breachMax: T.BREACH_CD,
    lightRadius: lightRadiusFor(themeOf(1), T.LANTERN),
    tune: T,

    downed: false,
    downT: 0,
    revivePumps: 0,
    reviveT: 0,

    harpoon: { active: false, dir: 1, len: 0, state: 'idle', mon: null, ally: null },
    depth: 0,
    carved: 0,
  };
}

/** Seat another digger. The crew is fixed for a run; call before startGame. */
export function addPlayer(state: State, seatId: PlayerId | null, opts?: CreateOpts) {
  const p = newPlayer(opts, seatId);
  state.players.push(p);
  return p;
}

export function startGame(state: State, level?: number, opts?: StartOpts) {
  /* Relics first, and BEFORE tune() is read: this is what unwinds whatever the
   * previous run picked up. Without it the second run of a session inherits the
   * first run's Wide Bore — which is exactly the "lost on death" promise,
   * broken silently.
   *
   * `opts.relics` is the Relic Cache's starting hand and is the ONE thing that
   * may survive into a fresh run. engine.js does not and must not import
   * save.js, so the caller reads it — see base.startRelic(). Filtered against
   * the real table and capped at RELIC_SLOTS here rather than trusted, because
   * this is the seam where a bad id would become a run-long mystery.
   *
   * Nothing else changes: refreshRelics() below already rebuilds the effective
   * tune, the flags, the air and the lamp from whatever this list holds, and
   * the chamber's own pickup already refuses to hand out a relic the player is
   * carrying, so a granted relic cannot be found again. */
  const want = (opts && opts.relics) || [];
  state.banked = 0;
  state.oreBanked = 0;
  state.deepest = 0;
  state.exitLc = null;
  state.livesMax = Math.max(1, (opts && opts.lives) || COOP.LIVES);
  state.lives = state.livesMax;
  for (const p of state.players) {
    p.relics = want.filter((id) => RELIC_BY_ID[id]).slice(0, TUNE.RELIC_SLOTS);
    p.airMax = TUNE.AIR_MAX;
    p.hopperMax = 0;
    refreshRelics(state, p);
    const pt = p.tune;
    p.hopper = 0;
    p.hopperFrac = 0;
    p.hopperFull = false;
    p.oreHeld = 0;
    p.oreFrac = 0;
    p.hp = p.maxHp;
    p.helmet = pt.HELMET;
  }
  startLevel(state, level || 1);
}

export function startLevel(state: State, level: number, opts?: { entryLc?: number | null }) {
  const lv = Math.max(1, level | 0);
  const entryLc = opts && opts.entryLc !== undefined ? opts.entryLc : state.exitLc;
  const data = generateLevel(lv, levelSeed(state.runSeed, lv),
                             { lanes: state.activeLanes,
                               ...(entryLc === null ? {} : { entryLc }) });

  state.level = lv;
  state.params = data.params;
  state.dirt = data.dirt;
  state.ore = data.ore;
  // The damp plume above each sealed air pocket. Read only by terrain.js —
  // carving never clears it, because a carved cell is not drawn from the dirt
  // layer at all.
  state.pocketHint = data.pocketHint || new Uint8Array(GW * GH);
  state.skyRows = data.skyRows;
  state.theme = data.theme;
  state.pockets = data.pockets;
  state.relicSite = data.relicSite;
  state.crystalAt = data.crystalAt;
  /* The generator hands over hazard DATA; the runtime fields live here, so
   * generateLevel stays a pure description of a level rather than a half-built
   * simulation. phase0 staggers the first firing. */
  state.hazards = data.hazards.map((h) => ({
    ...h, t: h.phase0 || 0, warnT: 0, inside: false,
    // The vent's chosen runway, decided at the START of the telegraph so the
    // warning and the wheel can never disagree, and a shot counter that walks
    // the exits round-robin. -1 is "not winding up".
    dir: -1, shots: 0,
  }));
  state.crystalTaken = false;
  state.relicTaken = false;
  state.rowRev = new Int32Array(GH);
  state.dirtRev++;
  state.levelSerial++;
  state.carved = 0;
  state.playerCarved = 0;
  state.spawn = data.playerStart;
  state.exitLc = null;
  state.rng = makeRng(levelSeed(state.runSeed, lv) ^ 0x9e3779b9);

  state.hazardDrain = 1;

  /* Every digger arrives together, in the same pocket, with a fresh breath.
   *
   * They are RESET rather than rebuilt: a descent is the middle of a run, and
   * the haul, the relics and the seat all have to survive it. Ids are reissued
   * here and consumed before any monster's, because the seeded replay depends
   * on that order. */
  for (const p of state.players) {
    p.id = state.nextId++;
    const pt = p.tune;
    /* Anyone still down when the level cleared is carried to the next one.
     * Their teammates killed the last monster with them lying there, which is
     * the crew doing the work — charging a life for it as well would punish the
     * success rather than the failure. */
    if (p.downed) { p.downed = false; p.hp = Math.max(p.hp, COOP.REVIVE_HP); }
    p.downT = 0;
    p.revivePumps = 0;
    p.reviveT = 0;
    p.x = data.playerStart.lc * 2; p.y = data.playerStart.lr * 2;
    p.px = p.x; p.py = p.y;
    p.dir = 2; p.pendingDir = -1; p.pendingT = 0;
    p.digging = false; p.moving = false;
    p.dying = false; p.dyingT = 0;
    p.releaseT = 0;
    p.breachCd = 0;
    p.drilling = false;
    p.carved = 0;
    p.harpoon = { active: false, dir: 1, len: 0, state: 'idle', mon: null, ally: null };
    /* Air refills on arrival. The descent is the breather: a level is a held
     * breath, and reaching the next one is what buys you another. */
    p.airMax = pt.AIR_MAX;
    p.air = pt.AIR_MAX;
    // The theme changed, so the dark did too. Recomputed here and not in the
    // view because the view is not allowed to be the thing that decides it.
    p.lightRadius = lightRadiusFor(themeOf(lv), pt.LANTERN);
    p.invuln = pt.HIT_INVULN;          // a beat of grace on arrival
  }

  state.monsters = data.monsters.map((m, i) => newMonster(state, m, i));
  state.rocks = data.rocks.map((r) => ({
    id: state.nextId++,
    x: r.lc * 2, y: r.lr * 2, px: r.lc * 2, py: r.lr * 2,
    state: 'idle', t: 0, vy: 0, chain: 0, openRun: 0, crushLeft: 0, lastRow: 0,
  }));

  state.fire = [];
  state.wheels = [];
  state.particles = [];
  state.popups = [];
  state.bonus = {
    active: false, x: data.bonusAt.lc * 2, y: data.bonusAt.lr * 2,
    t: 0, value: data.params.bonusDirt, at: data.bonusAt,
  };
  state.repathT = 0;
  state.wokenAt = 0;        // cells excavated when the last monster was woken
  state.caveinT = 0;        // seconds spent with the air run out
  state.caveinNext = 0;     // countdown to the next unaided rock
  state.shake = 0;
  state.phase = 'play';
  state.phaseT = 0;
  updateDepth(state);
  emit(state, 'level');
}

function updateDepth(state: State) {
  for (const p of state.players) {
    p.depth = depthOf(state.level, p.y);
    if (p.depth > state.deepest) state.deepest = p.depth;
  }
  const lead = state.players[0];
  if (lead && lead.depth > state.deepest) state.deepest = lead.depth;
}

/* ── player ───────────────────────────────────────────────────────────── */

function stepPlayer(state: State, p: Player, dt: number, input: Input) {
  const T = tune();
  p.px = p.x; p.py = p.y;

  if (p.invuln > 0) p.invuln -= dt;
  if (p.breachCd > 0) p.breachCd -= dt;
  if (p.pendingT > 0) { p.pendingT -= dt; if (p.pendingT <= 0) p.pendingDir = -1; }

  const attached = p.harpoon.state === 'hit';
  const locked = p.harpoon.active;      // firing or reeling in freezes the player

  // Voluntary release. Non-negotiable on a two-thumb interface: you must be able
  // to abandon a pump when a rock starts wobbling over your head.
  if (attached) {
    if (input.dirHeld) {
      p.releaseT += dt;
      if (p.releaseT >= T.RELEASE_HOLD) { detachHarpoon(state, p); p.releaseT = 0; }
    } else p.releaseT = 0;
  } else p.releaseT = 0;

  const want = input.dir;
  if (want !== null && want !== undefined) {
    const sameAxis = (want & 1) === (p.dir & 1);
    if (sameAxis) {
      p.dir = want;
      p.pendingDir = -1;
    } else {
      // Perpendicular turns need the actor to be on a lane boundary. Buffer the
      // request until it gets there — a thumb never releases exactly on one, and
      // without this the stick feels broken rather than strict.
      const along = (p.dir & 1) === 1 ? p.x : p.y;
      if (Math.abs(alignOffset(along)) <= T.SNAP_TOL) {
        if ((p.dir & 1) === 1) p.x = 2 * Math.round(p.x / 2);
        else p.y = 2 * Math.round(p.y / 2);
        p.dir = want;
        p.pendingDir = -1;
      } else {
        p.pendingDir = want;
        p.pendingT = T.TURN_BUFFER;
      }
    }
  }

  if (p.pendingDir >= 0) {
    const along = (p.dir & 1) === 1 ? p.x : p.y;
    if (Math.abs(alignOffset(along)) <= T.SNAP_TOL) {
      if ((p.dir & 1) === 1) p.x = 2 * Math.round(p.x / 2);
      else p.y = 2 * Math.round(p.y / 2);
      p.dir = p.pendingDir;
      p.pendingDir = -1;
    }
  }

  p.moving = false;
  p.digging = false;
  if (!input.dirHeld || locked) return;

  const dx = DX[p.dir], dy = DY[p.dir];
  const digging = diggingAhead(state, p.x, p.y, p.dir);
  const speed = digging ? T.SPEED_DIG : T.SPEED_TUNNEL;
  const step = speed * dt;

  let nx = p.x + dx * step;
  let ny = p.y + dy * step;
  nx = clamp(nx, 0, state.activeGW - 2);
  /* state.skyRows, not 0: on level 1 the sky band is pre-carved, so without this
   * the player walks straight up out of the ground and then travels the full
   * width of the map carving nothing — digging becomes optional. Both clamp
   * sites need it; leaving the one below at 0 lets you reach the sky by shoving
   * into a rock.
   *
   * Below level 1 skyRows is 0 and the clamp is a no-op, which is correct: there
   * is no pre-carved band up there to escape into, only more dirt. The
   * generator fills row 0 solid apart from the arrival pocket, so travelling
   * along the top costs exactly as much digging as anywhere else. */
  ny = clamp(ny, state.skyRows, GH - 2);

  // Cross-axis stays pinned to the lane so the player can never drift off-grid.
  if (dx !== 0) ny = 2 * Math.round(p.y / 2);
  else nx = 2 * Math.round(p.x / 2);

  const solid = blockingRockAt(state, nx, ny, 2, 2, null) ||
                blockingActorAt(state, nx, ny, 2, 2, null);
  if (solid) {
    if (dx > 0) nx = solid.x - 2; else if (dx < 0) nx = solid.x + 2;
    if (dy > 0) ny = solid.y - 2; else if (dy < 0) ny = solid.y + 2;
    nx = clamp(nx, 0, state.activeGW - 2);
    ny = clamp(ny, state.skyRows, GH - 2);
    if (blockingRockAt(state, nx, ny, 2, 2, null) ||
        blockingActorAt(state, nx, ny, 2, 2, null)) { nx = p.x; ny = p.y; }
  }

  p.x = nx; p.y = ny;
  p.moving = true;
  p.digging = digging;

  /* state.carved counts every cell ANYTHING removes — the player, a falling
   * rock, a tunnelling Grub. That is right for the hunter clock: the level
   * noticing that something is digging is the reading we want, and a Grub loose
   * in a level making the hunt arrive sooner is a fair consequence of it.
   *
   * It is wrong for the vegetable, which is a reward for YOUR excavation. A
   * Grub summoning the bonus early is not a consequence, it is noise. So the
   * player's own carving is counted separately here and stepBonus reads that. */
  const cut = carve(state, p.x, p.y, p.dir, p);
  if (cut) {
    /* Two counters, deliberately. state.playerCarved is the CREW's digging and
     * is what summons the bonus — a shared prize for shared work. p.carved is
     * what this digger personally cut, which is what the results screen credits
     * them with. Summing the second to get the first would drift the moment a
     * digger leaves. */
    state.playerCarved += cut;
    p.carved += cut;
    emit(state, 'dig', p.x, p.y);
    if (state.rng() < 0.35) particles(state, p.x + 1, p.y + 1, 'dirt', 1, 2);
  }

  /* Wide Bore. Two more carves offset perpendicular to travel, which widens the
   * tunnel from one lane to two — wide enough to sidestep in, to line up a shot
   * across, and to let a rock fall past you.
   *
   * Offset carves rather than a wider carve(): carve() lives in world.js and is
   * shared with rocks, the drill and every digging monster, so a relic must not
   * be able to reach into it. Three calls to a function that already does
   * exactly the right thing is the cheaper seam.
   *
   * It also digs half again as much ground, which pays half again as much AND
   * wakes monsters half again as fast — the relic is a bet, not a gift. */
  if (p.wide) {
    const ox = (p.dir & 1) === 1 ? 0 : 0.75;
    const oy = (p.dir & 1) === 1 ? 0.75 : 0;
    const wideCut = carve(state, p.x + ox, p.y + oy, p.dir, p)
                  + carve(state, p.x - ox, p.y - oy, p.dir, p);
    state.playerCarved += wideCut;
    p.carved += wideCut;
  }
}

/* ── harpoon ──────────────────────────────────────────────────────────── */

function fireHarpoon(state: State, p: Player) {
  const h = p.harpoon;
  h.active = true;
  h.state = 'out';
  h.len = 0;
  h.dir = p.dir;
  h.mon = null;
  emit(state, 'harpoon', p.x + 1, p.y + 1);
}

function detachHarpoon(state: State, p: Player) {
  const h = p.harpoon;
  h.ally = null;
  if (h.mon) {
    h.mon.mode = 'patrol';
    h.mon.pump = 0;
    h.mon.pumpT = 0;
    h.mon.stun = tune().DETACH_STUN;
    h.mon = null;
  }
  h.state = 'back';
}

function stepHarpoon(state: State, p: Player, dt: number, pumps: number) {
  const T = tune();
  const h = p.harpoon;

  if (!h.active) {
    if (pumps > 0 && !p.dying && !p.downed && !p.drilling) fireHarpoon(state, p);
    return;
  }

  if (h.state === 'out') {
    h.len += T.HARPOON_OUT * dt;
    const cx = p.x + 1 + DX[h.dir] * h.len;
    const cy = p.y + 1 + DY[h.dir] * h.len;

    for (const m of state.monsters) {
      if (m.dead || m.dying) continue;
      // A ghost is immune and the harpoon passes straight through it. That's the
      // tension of the whole game: your only weapon is useless until it lands.
      if (m.mode === 'ghost' || m.mode === 'remat') continue;
      if (cx >= m.x && cx < m.x + 2 && cy >= m.y && cy < m.y + 2) {
        /* Some things the harpoon simply cannot bite. It STOPS on them rather
         * than passing through — passing through would read as a miss and
         * teach nothing, where a clang teaches "not this one, use a rock". */
        if (m.k && m.k.harpoonImmune && !p.pierce) {
          h.state = 'back';
          emit(state, 'clang', m.x + 1, m.y + 1);
          return;
        }
        h.state = 'hit';
        h.mon = m;
        m.mode = 'pumped';
        m.pump = 1;
        m.pumpT = 0;
        m.telegraph = 0;
        emit(state, 'pump', m.x + 1, m.y + 1, 1);
        return;
      }
    }

    /* A downed teammate is a legitimate target, and the nicest one.
     *
     * Tested AFTER the monsters, so something standing between you and them
     * takes the shot instead — which is correct, and occasionally the reason
     * you cannot get them up yet. The line still stops on dirt, so reaching
     * somebody is digging to them; the harpoon only saves you the last few
     * cells and lets you do it without standing in whatever put them there. */
    for (const q of state.players) {
      if (q === p || !q.downed || q.dying) continue;
      if (cx >= q.x && cx < q.x + 2 && cy >= q.y && cy < q.y + 2) {
        h.state = 'hit';
        h.ally = q;
        q.revivePumps = Math.max(1, q.revivePumps);
        q.reviveT = 0;
        emit(state, 'grab', q.x + 1, q.y + 1, q.revivePumps);
        return;
      }
    }

    /* Barbed Head passes through DIRT but never through a boulder. Dirt is the
     * thing the relic is interesting against — it lets you kill down a seam you
     * have not cut yet — where a harpoon that slid through a falling rock would
     * just make rock play stop meaning anything. */
    const tc = Math.floor(cx), tr = Math.floor(cy);
    const stopped = p.pierce ? false : dirtAt(state, tc, tr) === 1;

    /* Breaching Tip: the tip punches the ONE fine cell it actually hit, then
     * reels in as normal. breakTile() clears the whole aligned TILE, not the
     * single fine cell the tip happened to touch — see breakTile() for the bug
     * that distinction fixes. It pays nothing, matching the rock-crush path:
     * this is a hole punched by a harpoon, not ground you dug, and paying for
     * it would make the upgrade a dirt printer.
     *
     * Barbed Head supersedes this with no guard needed: pierce forces `stopped`
     * false, so a piercing harpoon never reaches here. That is intentional —
     * the relic already does this better and without a cooldown. Do not "fix"
     * it by testing dirtAt directly. */
    if (stopped && T.BREACH > 0 && p.breachCd <= 0) {
      breakTile(state, tc, tr);
      p.breachCd = T.BREACH_CD;
      emit(state, 'breach', tc + 0.5, tr + 0.5);
      h.state = 'back';
      return;
    }

    if (h.len >= T.HARPOON_MAX || stopped ||
        blockingRockAt(state, cx - 0.1, cy - 0.1, 0.2, 0.2, null)) {
      h.state = 'back';
    }
    return;
  }

  if (h.state === 'hit' && h.ally) {
    const q = h.ally;
    // Let go the moment they are no longer a rescue: revived by someone else,
    // respawned by the clock, or the run ended around you.
    if (!q.downed || q.dying) { h.state = 'back'; h.ally = null; return; }
    h.len = Math.max(0.6, Math.abs(DX[h.dir] * (q.x + 1 - p.x - 1) + DY[h.dir] * (q.y + 1 - p.y - 1)));

    if (pumps > 0) {
      q.revivePumps = Math.min(COOP.REVIVE_PUMPS, q.revivePumps + pumps);
      q.reviveT = 0;
      pumps = 0;
      emit(state, 'pump', q.x + 1, q.y + 1, q.revivePumps);
      if (q.revivePumps >= COOP.REVIVE_PUMPS) {
        standUp(state, q);
        h.state = 'back';
        h.ally = null;
        return;
      }
    }
    return;
  }

  if (h.state === 'hit') {
    const m = h.mon;
    if (!m || m.dead) { h.state = 'back'; h.mon = null; return; }
    // Keep the harpoon visually attached as the monster swells.
    h.len = Math.max(0.6, Math.abs(DX[h.dir] * (m.x + 1 - p.x - 1) + DY[h.dir] * (m.y + 1 - p.y - 1)));

    const stages = pumpStages(m);
    if (pumps > 0) {
      m.pump = Math.min(stages, m.pump + pumps);
      m.pumpT = 0;
      pumps = 0;
      emit(state, 'pump', m.x + 1, m.y + 1, m.pump);
      if (m.pump >= stages) {
        popMonster(state, m, false);
        h.state = 'back';
        h.mon = null;
        return;
      }
    } else {
      m.pumpT += dt;
      if (m.pumpT > T.DEFLATE_DELAY + T.DEFLATE_STEP) {
        m.pump--;
        m.pumpT = T.DEFLATE_DELAY;
        if (m.pump <= 0) { detachHarpoon(state, p); }
      }
    }
    return;
  }

  // 'back'
  h.len -= T.HARPOON_BACK * dt;
  if (h.len <= 0) { h.len = 0; h.active = false; h.state = 'idle'; }
}

/* ── rocks ────────────────────────────────────────────────────────────── */

function stepRocks(state: State, dt: number) {
  const T = tune();
  for (let i = state.rocks.length - 1; i >= 0; i--) {
    const r = state.rocks[i];
    r.px = r.x; r.py = r.y;

    if (r.state === 'idle') {
      const c = Math.round(r.x), row = Math.round(r.y);
      const unsupported = dirtAt(state, c, row + 2) === 0 && dirtAt(state, c + 1, row + 2) === 0;
      const actorUnder = state.players.some((q) => overlaps(r.x, r.y + 2, 2, 1, q.x, q.y, 2, 2)) ||
        state.monsters.some((m) => !m.dead && m.mode !== 'ghost' &&
          overlaps(r.x, r.y + 2, 2, 1, m.x, m.y, 2, 2));
      if (unsupported || actorUnder) {
        r.state = 'wobble';
        r.t = T.ROCK_WOBBLE;
        emit(state, 'wobble', r.x + 1, r.y + 1);
      }
      continue;
    }

    if (r.state === 'wobble') {
      r.t -= dt;
      if (r.t <= 0) { r.state = 'falling'; r.vy = 0; r.chain = 0; r.openRun = 0; r.crushLeft = 0; r.lastRow = Math.floor(r.y + 2) - 1; emit(state, 'fall', r.x + 1, r.y + 1); }
      continue;
    }

    if (r.state === 'falling') {
      r.vy = Math.min(T.ROCK_VMAX, r.vy + T.ROCK_G * dt);

      /* Resolve the fall a row at a time rather than by raw distance.
       *
       * Open ground under the rock is always free travel; ground is not. Every
       * ROCK_BUILDUP rows of open air banks ROCK_BREAKTHROUGH rows of boring,
       * so a rock dropped down a long shaft punches deep and one nudged off a
       * ledge barely dents the floor. Break through into open air and the
       * count starts over, which is what lets a single rock chain through
       * several layers if the shaft under it is long enough. */
      let ny = Math.min(GH - 2, r.y + r.vy * dt);
      const col = Math.round(r.x);
      let landed = false;
      // r.lastRow is the deepest row already accounted for. Carrying it on the
      // rock rather than deriving it from r.y each frame is what stops a row
      // being skipped on entry or counted twice across two frames.
      while (Math.floor(ny + 2) > r.lastRow) {
        const row = ++r.lastRow;
        if (row >= GH) { ny = GH - 2; landed = true; break; }
        const solid = dirtAt(state, col, row) === 1 || dirtAt(state, col + 1, row) === 1;
        if (!solid) {
          r.openRun++;
          if (r.openRun >= T.ROCK_BUILDUP) {
            r.openRun = 0;
            r.crushLeft += T.ROCK_BREAKTHROUGH;
          }
        } else if (r.crushLeft > 0) {
          r.crushLeft--;
          r.openRun = 0;
          if (dirtAt(state, col, row) === 1) { state.dirt[idx(col, row)] = 0; state.carved++; }
          if (dirtAt(state, col + 1, row) === 1) { state.dirt[idx(col + 1, row)] = 0; state.carved++; }
          state.dirtRev++;
          state.rowRev[row]++;
        } else {
          ny = row - 2;                 // comes to rest on top of that row
          r.lastRow = row - 1;          // that row is still solid; don't consume it
          landed = true;
          break;
        }
      }
      r.y = ny;
      // dir -1 so carve() adds no lead: the rock must not eat the ground it is
      // about to be stopped by.
      carve(state, r.x, r.y, -1);

      for (const q of state.players) {
        if (q.dying || q.downed || q.invuln > 0) continue;
        if (overlaps(r.x, r.y, 2, 2, q.x, q.y, 2, 2)) hurtPlayer(state, q, r.x, r.y, 'rock');
      }
      for (const m of state.monsters) {
        if (m.dead || m.dying) continue;
        if (m.mode === 'ghost') continue;                // a ghost passes under a rock
        if (!overlaps(r.x, r.y, 2, 2, m.x, m.y, 2, 2)) continue;
        m.crushed = true;
        popMonster(state, m, true);
        r.chain++;
        // No dirt for the kill. The payday already arrived as the shaft this
        // rock bored on its way down, which carve() paid out cell by cell.
        if (r.chain > 1) popup(state, m.x + 1, m.y + 1, 'x' + r.chain);
        emit(state, 'combo', m.x + 1, m.y + 1, r.chain);
      }

      if (landed) {
        r.state = 'breaking';
        r.t = T.ROCK_BREAK;
        state.shake = 0.28;
        particles(state, r.x + 1, r.y + 1, 'rock', 14, 7);
        emit(state, 'rock', r.x + 1, r.y + 1);
      }
      continue;
    }

    if (r.state === 'breaking') {
      r.t -= dt;
      if (r.t <= 0) state.rocks.splice(i, 1);
    }
  }
}

/* ── pressure ─────────────────────────────────────────────────────────── */

/* Digging is what pays, so digging is what costs.
 *
 * Every WAKE_PER_CELLS excavated, the monster nearest the player stops sitting
 * in its cavity and comes for you. Greed summons the threat directly, which is
 * the whole reason the economy is paid per cell rather than per kill.
 *
 * Then the roof. The air you arrive with is the whole budget for the level;
 * when it runs out, the level starts dropping rocks unaided, on a shortening
 * interval. It reuses the rock system, so the warning is the wobble the player
 * already knows.
 *
 * Air replaced an invisible 75-second timer and reproduces it exactly:
 * AIR_MAX / AIR_DRAIN is CAVEIN_AT. On a level where you find no pockets
 * nothing about the pressure curve has changed — the player can just see it
 * now, and can buy time by digging toward one. */
function stepPressure(state: State, dt: number) {
  const T = tune();

  /* Greed summons the threat, and it is the CREW's greed: every cell anyone
   * cuts counts toward the same wake. The monster that comes is the one nearest
   * to any digger, so the crew that spreads out wakes the whole level faster —
   * which is the cost of covering more ground. */
  while (state.carved - state.wokenAt >= T.WAKE_PER_CELLS) {
    state.wokenAt += T.WAKE_PER_CELLS;
    let best = null;
    for (const m of state.monsters) {
      if (m.dead || m.dying || m.hunting || !counts(m)) continue;
      for (const q of state.players) {
        if (q.dying || q.downed) continue;
        const d = Math.hypot(m.x - q.x, m.y - q.y);
        if (!best || d < best.d) best = { d, m };
      }
    }
    if (best) beginHunt(state, best.m);
    else break;                       // everything already hunting
  }

  /* Each digger holds their own breath, but the roof is the level's. It starts
   * coming in only once NOBODY still has air: one digger who found a pocket
   * holds it off for the whole crew, which is what makes "go and find one"
   * worth saying out loud. Pockets are finite, so this still terminates. */
  const p = state.players[0];
  let anyAir = false;
  for (const q of state.players) {
    if (q.downed || q.air <= 0) continue;
    const was = q.air;
    q.air = Math.max(0, q.air -
      q.tune.AIR_DRAIN * state.params.airDrainMul * state.hazardDrain * dt);
    if (q.air > 0) anyAir = true;
    if (was > T.AIR_LOW && q.air <= T.AIR_LOW) {
      emit(state, 'airlow', q.x + 1, q.y + 1);
      /* The canary, finally doing something. It is worth more now than it would
       * have been before the camera scrolled: the gauge is on screen, but the
       * player's eyes are on a tunnel face two hundred cells down, and a sound
       * reaches them where a red bar in the corner does not. */
      if (T.CANARY > 0) emit(state, 'canary', q.x + 1, q.y + 1, 'air');
    }
    if (q.air <= 0) emit(state, 'airout', q.x + 1, q.y + 1);
  }
  if (anyAir || !p) return;

  state.caveinT += dt;
  if (state.caveinNext <= 0) {
    // Shorten the fuse each time, so a level always ends up untenable.
    state.caveinNext = Math.max(T.CAVEIN_MIN, T.CAVEIN_EVERY - state.caveinT * 0.05);
    const idle = state.rocks.filter((r) => r.state === 'idle');
    if (idle.length) {
      const r = idle[Math.floor(state.rng() * idle.length)];
      r.state = 'wobble';
      r.t = T.ROCK_WOBBLE;
      emit(state, 'wobble', r.x + 1, r.y + 1);
    }
    state.shake = Math.max(state.shake, 0.2);
    emit(state, 'cavein', p.x + 1, p.y + 1);
  }
  state.caveinNext -= dt;
}

/* Wheels this particular vent is responsible for.
 *
 * Identity on the hazard object, never a scan of wheels.length, and the reason
 * is the one written on spawnedRocks() in world.js: a flat "no more than N in
 * the array" ceiling quietly tightens the moment a second producer shares the
 * array, and by the time it has become "never" it stopped being a budget
 * without anything failing. state.wheels has exactly one producer today. The
 * tag is what stops that being an assumption. */
function wheelsFrom(state: State, h: Hazard) {
  let n = 0;
  for (const w of state.wheels) if (w.src === h) n++;
  return n;
}

/* The level-wide ceiling, counting only what a hazard put there — same argument
 * as wheelsFrom above — PLUS the vents currently winding up.
 *
 * The reservation is the whole point. A vent that has telegraphed is committed:
 * it will launch in `warn` seconds. Counting only what is already in the air
 * meant six vents could all pass the gate inside one telegraph window and two
 * of them would then find the budget full and silently drop their wheel — a
 * warning with nothing behind it, which is the one thing this hazard is not
 * allowed to produce. Measured at 68 wheels for 70 wind-ups before this.
 *
 * Because each reservation becomes exactly one wheel and live count only falls
 * between gate and launch, live + reserved <= WHEEL_MAX is invariant, so the
 * launch site needs no ceiling check of its own. */
function countWheels(state: State) {
  let n = 0;
  for (const w of state.wheels) if (w.src) n++;
  for (const h of state.hazards) if (h.warnT > 0 && h.dir >= 0) n++;
  return n;
}

/* Which way this vent can throw, and which way it will.
 *
 * clipFire() answers "how far is the ground clear along dir", on both axes, for
 * anything {x,y}-shaped — so a wheel's runway and a Fygar's jet are measured by
 * one function. That is also what makes it impossible for a wheel to enter
 * ground the player has not cut: every cell it will ever occupy was counted
 * open here, before it launched.
 *
 * Round-robin on a per-vent shot counter, and NO rng at all. Picking the
 * longest run means a vent at a T-junction fires the same way for the whole
 * level; picking the direction of the player turns a piece of terrain into a
 * turret and deletes the counterplay, which is to walk round it. Round-robin
 * varies, starves no exit, and keeps stepHazards' zero-rng property — which is
 * cheap to keep and pinned by tests/hazards.mjs. */
function ventRunway(state: State, h: Hazard, c: number, r: number) {
  const T = tune();
  const cands = [];
  for (let d = 0; d < 4; d++) {
    const len = Math.min(clipFire(state, { x: c, y: r }, d), T.WHEEL_RANGE);
    if (len >= T.WHEEL_MIN_RUN) cands.push({ dir: d, len });
  }
  if (!cands.length) return null;
  return cands[h.shots % cands.length];
}

/* ── the vent's wheel ─────────────────────────────────────────────────────
 *
 * A 2x2 of fire travelling in a straight line down a corridor that was clear
 * when it launched. Its own array rather than a fourth shape in state.fire,
 * because stepFire is a grow-then-count-down machine and stakes its fairness
 * argument on that order — where a wheel ends when it meets a wall, not when a
 * timer runs out.
 *
 * Position is a pure function of `travel` from the launch node, which is what
 * lets the view derive the spin angle from it without reading a clock.
 *
 * It never carves, never touches a monster, and appears in no occupancy helper,
 * so passable() and every path in world.js are untouched by it: a wheel can
 * never strand the player or block the descent. */
function stepWheels(state: State, dt: number) {
  const T = tune();
  for (let i = state.wheels.length - 1; i >= 0; i--) {
    const w = state.wheels[i];
    w.px = w.x; w.py = w.y; w.pTravel = w.travel;

    w.life -= dt;
    if (w.life <= 0) { retireWheel(state, w, i); continue; }

    const want = Math.min(w.left, w.travel + T.WHEEL_SPEED * dt);
    /* `cursor` is the furthest whole cell already terrain-tested, carried on
     * the wheel for exactly the reason stepRocks carries r.lastRow: a fast
     * mover must not skip a cell on the way in nor count one twice across two
     * frames. The only thing this can find that clipFire did not is a boulder
     * that landed during the flight — dirt never closes — but a guard that is
     * only occasionally needed is still the guard. */
    let blocked = false;
    /* ceil, NOT floor: the cell being tested is the one the wheel is about to
     * ENTER, not the one it has reached. Sampling at floor(travel) tests the box
     * where the wheel already is, so contact was only noticed a whole cell after
     * it happened — measured, a wheel sat a full cell inside a boulder for
     * ninety frames before the next integer came round. With ceil the invariant
     * is `cursor >= ceil(travel), and every integer travel up to cursor is
     * clear`, and because the box moves linearly it cannot dip into a rock
     * between two clear integer samples. */
    while (Math.ceil(want) > w.cursor) {
      const n = ++w.cursor;
      const cc = w.ox + DX[w.dir] * n, rr = w.oy + DY[w.dir] * n;
      if (blockingRockAt(state, cc, rr, 2, 2, null)) {
        // Flush against it, and never further forward than it had already got.
        w.travel = Math.max(0, Math.min(want, n - 1));
        blocked = true;
        break;
      }
    }
    if (!blocked) w.travel = want;
    w.x = w.ox + DX[w.dir] * w.travel;
    w.y = w.oy + DY[w.dir] * w.travel;

    if (blocked || w.travel >= w.left) { retireWheel(state, w, i); continue; }

    /* Emberproof Hide covers a Fygar's breath, a Sapper's crater and a wheel
     * alike. Now that this lives outside state.fire that is an explicit line
     * rather than something inherited, which is why there is a test for it. */
    for (const q of state.players) {
      if (q.fireproof || q.dying || q.downed || q.invuln > 0) continue;
    /* touching(), not overlaps(): the wheel is the only fire in the game that
     * is 2x2 like an actor, so it is the only one the corner-clip margin makes
     * sense for. It does NOT stop on contact — HIT_INVULN is 1.6s and a pass
     * takes about 0.6s, so one pass is one hit, and a wheel that died on you
     * would reward standing in the corridor. */
      if (touching(q.x, q.y, w.x, w.y)) hurtPlayer(state, q, w.x, w.y);
    }
  }
}

function retireWheel(state: State, w: Wheel, i: number) {
  state.wheels.splice(i, 1);
  emit(state, 'wheelout', w.x + 1, w.y + 1);
}

/* ── theme hazards ────────────────────────────────────────────────────────
 *
 * One kind per biome, and all five are built out of machinery the player has
 * already been taught to read. Nothing here invents a new warning:
 *
 *   seep / gas          drain air while you stand in them. No damage at all —
 *                       they spend the resource the level is already spending,
 *                       so they shorten your stay rather than ending it.
 *   dripstone/shardfall push a rock into state.rocks and let stepRocks own it.
 *                       That buys the wobble, the boring, the chain kills, the
 *                       helmet and the seismograph for free, and a falling rock
 *                       is the one danger in this game every player understands
 *                       within ten seconds.
 *   vent                throws a spinning wheel of fire down a corridor it has
 *                       already telegraphed, at a speed between digging and
 *                       running. See stepWheels().
 *
 * Every hazard is seeded in solid ground and stays inert until the player's
 * digging exposes it — a vent firing inside sealed rock would be a noise with
 * no cause, and a dripstone with no shaft under it would drop two cells and
 * shatter. "Exposed" is checked against the terrain each frame rather than
 * latched, so backfilling is not a thing that has to be thought about.
 *
 * Sets state.hazardDrain for stepPressure to consume, which is why this runs
 * first. */
function stepHazards(state: State, dt: number) {
  const T = tune();
  let drain = 1;

  for (const h of state.hazards) {
    const c = h.lc * 2, r = h.lr * 2;

    if (h.kind === 'seep' || h.kind === 'gas') {
      // Dormant until cut open. dirtAt is the only thing that decides it.
      const open = dirtAt(state, c, r) === 0 && dirtAt(state, c + 1, r) === 0;
      if (!open) { h.inside = false; continue; }
      let inside = false;
      for (const q of state.players) {
        if (q.dying || q.downed) continue;
        const d = Math.hypot(q.x + 1 - (c + 1), q.y + 1 - (r + 1));
        if (d <= (h.radius || 3)) { inside = true; break; }
      }
      if (inside && !h.inside) emit(state, 'hazard', c + 1, r + 1, h.kind);
      h.inside = inside;
      if (inside) drain = Math.max(drain, h.drain || 2);
      continue;
    }

    if (h.kind === 'dripstone' || h.kind === 'shardfall') {
      h.t -= dt;
      if (h.t > 0) continue;
      h.t = h.every || 6;
      /* Only if there is open ground directly beneath — i.e. the player has cut
       * a tunnel under it. The rock is then dropped into that tunnel, which is
       * the whole hazard: the corridor you made is the corridor it falls down. */
      const below = dirtAt(state, c, r + 2) === 0 && dirtAt(state, c + 1, r + 2) === 0;
      if (!below) continue;
      // Not while the player is standing where it would land on frame one.
      if (state.players.some((q) => overlaps(c, r, 2, 2, q.x, q.y, 2, 2))) continue;
      if (blockingRockAt(state, c, r, 2, 2, null)) continue;
      if (spawnedRocks(state) >= T.ROCK_SPAWN_MAX) continue;     // a hard ceiling on the array
      state.rocks.push({
        id: state.nextId++,
        x: c, y: r, px: c, py: r,
        state: 'wobble', t: T.ROCK_WOBBLE, vy: 0,
        chain: 0, openRun: 0, crushLeft: 0, lastRow: 0,
        fromHazard: h.kind,
      });
      emit(state, 'wobble', c + 1, r + 1);
      continue;
    }

    if (h.kind === 'vent') {
      // Dormant until cut open, and re-checked rather than latched — see above.
      const open = dirtAt(state, c, r) === 0 && dirtAt(state, c + 1, r) === 0;
      if (!open) { h.warnT = 0; h.dir = -1; h.t = h.phase0 || 0; continue; }

      if (h.warnT > 0) {
        h.warnT -= dt;
        if (h.warnT > 0) continue;
        /* Re-measure at the moment of launch. Terrain only ever opens, so the
         * runway cannot have shortened by digging — but a boulder can have
         * landed in it during the wind-up, and firing into that would break the
         * promise the telegraph made 0.9s ago. */
        const run = Math.min(clipFire(state, { x: c, y: r }, h.dir), T.WHEEL_RANGE);
        const dir = h.dir;
        h.dir = -1;
        if (run < T.WHEEL_MIN_RUN) continue;
        state.wheels.push({
          id: state.nextId++,
          x: c, y: r, px: c, py: r, ox: c, oy: r,
          dir, travel: 0, pTravel: 0, left: run, cursor: 0,
          life: T.WHEEL_LIFE, src: h,
        });
        emit(state, 'wheel', c + 1, r + 1, dir);
        continue;
      }

      h.t -= dt;
      if (h.t > 0) continue;

      /* The gate and the shot ask the SAME question, and the telegraph is only
       * emitted once a wheel is certain to follow. A Fygar shipped with these
       * two disagreeing and it measured seventy wind-ups to two jets — a
       * telegraph that usually means nothing is worse than no telegraph, so
       * this fails quietly and retries rather than warning into a wall. */
      if (wheelsFrom(state, h) >= T.WHEEL_PER_VENT) { h.t = T.WHEEL_RETRY; continue; }
      if (countWheels(state) >= T.WHEEL_MAX) { h.t = T.WHEEL_RETRY; continue; }
      const pick = ventRunway(state, h, c, r);
      if (!pick) { h.t = T.WHEEL_RETRY; continue; }
      h.shots++;
      h.dir = pick.dir;
      h.t = h.every || 5;
      h.warnT = h.warn || T.FIRE_TELEGRAPH;
      emit(state, 'telegraph', c + 1, r + 1);
      emit(state, 'wheelwind', c + 1, r + 1, pick.dir);
    }
  }

  state.hazardDrain = drain;
}

/* ── the two things you carry out ─────────────────────────────────────────
 *
 * Both are picked up by walking onto them, and both are guarded by a monster
 * rather than by a lock, because the only currency this game has for "you have
 * to earn this" is ground you had to dig and something you had to kill. */
function stepPickups(state: State, p: Player) {
  const T = tune();

  const cr = state.crystalAt;
  if (cr && !state.crystalTaken &&
      overlaps(cr.lc * 2, cr.lr * 2, 2, 2, p.x, p.y, 2, 2)) {
    state.crystalTaken = true;
    particles(state, cr.lc * 2 + 1, cr.lr * 2 + 1, 'bonus', 18, 6);
    // The id travels on the event so app.js can bank it without having to
    // re-derive the theme from the level number.
    emit(state, 'crystal', cr.lc * 2 + 1, cr.lr * 2 + 1, cr.id);
  }

  const rs = state.relicSite;
  if (rs && !state.relicTaken && p.relics.length < T.RELIC_SLOTS &&
      overlaps(rs.at.x, rs.at.y, 2, 2, p.x, p.y, 2, 2)) {
    /* First id in the chamber's pre-shuffled pool that this run is not already
     * carrying. Choosing here rather than in the generator is what stops a
     * second chamber handing out a duplicate, and the pool is deterministic, so
     * the choice still is. */
    const id = rs.pool.find((x) => !p.relics.includes(x));
    if (id) {
      state.relicTaken = true;
      p.relics.push(id);
      refreshRelics(state, p);
      particles(state, rs.at.x + 1, rs.at.y + 1, 'bonus', 20, 6);
      /* SAY WHAT IT WAS.
       *
       * Until this line the entire player-facing announcement of a relic was a
       * burst of particles identical to eating a vegetable — and four of the
       * twelve change a rule rather than a number. Picking up Barbed Head made
       * the harpoon start ignoring dirt with no explanation whatsoever, which
       * reads as a bug rather than as a reward. The name is the cheapest
       * possible fix and it belongs here, at the one place that knows which id
       * was actually taken. */
      const relic = RELIC_BY_ID[id];
      if (relic) popup(state, rs.at.x + 1, rs.at.y + 1, relic.name);
      emit(state, 'relic', rs.at.x + 1, rs.at.y + 1, id);
    }
  }
}

/* ── hazards and death ────────────────────────────────────────────────── */

/* Take a hit: 1 HP, mercy frames, and a shove to break contact.
 *
 * No respawn, no monster reset, no losing the level. You keep your position,
 * your tunnels and your hopper — the cost is the point of health, and a run
 * that resets the board on every hit is an arcade game, not a roguelike.
 *
 * The knockback is not decoration. Without it a monster standing on the player
 * re-hits the instant mercy frames lapse, and one contact drains the whole bar. */
export function hurtPlayer(state: State, p: Player, fromX: number, fromY: number, kind?: string) {
  const T = tune();
  if (p.dying || p.downed || p.invuln > 0 || p.drilling) return;

  /* Iron Skull is the helmet that is never spent. Checked first so a run
   * carrying it never burns a bought helmet charge it did not need — the
   * charges are still there if the relic is lost with the run. */
  if (kind === 'rock' && p.rockproof) {
    p.invuln = T.HIT_INVULN;
    state.shake = 0.3;
    emit(state, 'helmet', p.x + 1, p.y + 1, p.helmet);
    return;
  }

  // Helmet soaks falling rock specifically, and is spent doing it.
  if (kind === 'rock' && p.helmet > 0) {
    p.helmet--;
    p.invuln = T.HIT_INVULN;
    state.shake = 0.3;
    emit(state, 'helmet', p.x + 1, p.y + 1, p.helmet);
    return;
  }

  p.hp -= 1;
  p.invuln = T.HIT_INVULN;
  state.shake = 0.35;
  p.harpoon = { active: false, dir: 1, len: 0, state: 'idle', mon: null, ally: null };

  if (fromX !== undefined) {
    const dx = p.x - fromX, dy = p.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    p.x = clamp(p.x + (dx / len) * T.HIT_KNOCKBACK, 0, state.activeGW - 2);
    p.y = clamp(p.y + (dy / len) * T.HIT_KNOCKBACK, state.skyRows, GH - 2);
    p.px = p.x; p.py = p.y;
    carve(state, p.x, p.y, -1, p);   // never leave the digger embedded in dirt
  }

  emit(state, 'hurt', p.x + 1, p.y + 1, p.hp);

  if (p.hp <= 0) downPlayer(state, p);
}

/* ── down, and getting back up ────────────────────────────────────────────
 *
 * Zero health is not the end of a run any more; it is the start of a clock.
 * A downed digger is out of the fight — no input, no harpoon, no target for
 * anything — and stays where they fell. A teammate who reaches them brings them
 * back for nothing but the walk. Nobody reaching them in time costs the crew a
 * life and puts them back at the entry pocket.
 *
 * The revive is deliberately quick once you arrive. The cost is the journey:
 * crossing a level you have not cut yet, with whatever put them down still in
 * it. Making the kneeling slow as well would just add waiting to a decision
 * that has already been made. */
function downPlayer(state: State, p: Player) {
  p.downed = true;
  p.downT = COOP.DOWN_WINDOW;
  p.revivePumps = 0;
  p.reviveT = 0;
  p.hp = 0;
  p.moving = false;
  p.digging = false;
  p.pendingDir = -1;
  p.harpoon = { active: false, dir: 1, len: 0, state: 'idle', mon: null, ally: null };
  emit(state, 'down', p.x + 1, p.y + 1);
  endRunIfWiped(state);
  // Not when the wipe above already ended the run: they are dying, not down.
  if (p.downed && !p.dying && !canBeReached(state, p)) spendLife(state, p);
}

/* Is there anybody who could actually come for them?
 *
 * The downed window is a clock on a rescue, and a clock nobody can beat is not
 * a mechanic — it is twenty-five seconds of watching. Solo it is the whole of
 * the death; as the last one standing it is the same thing with extra steps.
 * So when there is no possible rescuer the window is skipped outright and the
 * life is spent there and then.
 *
 * A DISCONNECTED teammate counts as a rescuer, and that is deliberate. They are
 * standing in the simulation and the window is shorter than most reconnects are
 * long, but the alternative is teaching the engine about presence — which would
 * put a network fact inside the deterministic step and break the parity
 * harness. Dropping Wi-Fi should not spend somebody else's life either. */
function canBeReached(state: State, p: Player) {
  return state.players.some((q) => q !== p && !q.downed && !q.dying);
}

/** The run ends when the crew is down with no lives left to spend. */
function endRunIfWiped(state: State) {
  if (state.lives > 0) return;
  if (state.players.some((q) => !q.downed)) return;
  const T = tune();
  for (const q of state.players) { q.dying = true; q.dyingT = T.DEATH_TIME; }
  state.phase = 'dying';
  state.phaseT = T.DEATH_TIME;
  const lead = state.players[0];
  emit(state, 'die', lead ? lead.x + 1 : undefined, lead ? lead.y + 1 : undefined);
}

/** Back on their feet, with a beat of grace to work out where they are. */
function standUp(state: State, p: Player) {
  p.downed = false;
  p.hp = COOP.REVIVE_HP;
  p.invuln = COOP.REVIVE_INVULN;
  p.downT = 0;
  p.revivePumps = 0;
  p.reviveT = 0;
  emit(state, 'revive', p.x + 1, p.y + 1, p.hp);
}

function stepDowned(state: State, dt: number) {
  const T = tune();
  for (const p of state.players) {
    if (!p.downed) continue;

    /* Banked pumps deflate exactly the way a monster's do when the line comes
     * off — same delay, same step. That is the point of reviving this way: it
     * is the fight's own verb, so it has the fight's own feel, including the
     * part where letting go costs you. */
    const held = state.players.some((q) => q !== p && q.harpoon.ally === p);
    if (!held && p.revivePumps > 0) {
      p.reviveT += dt;
      if (p.reviveT > T.DEFLATE_DELAY + T.DEFLATE_STEP) {
        p.revivePumps--;
        p.reviveT = T.DEFLATE_DELAY;
      }
    }

    p.downT -= dt;
    if (p.downT > 0) continue;

    spendLife(state, p);
  }
}

/* Nobody came, or nobody could. A team life buys them back at the entry pocket.
 *
 * Reached two ways — the window running out, and there never having been a
 * window — and it must be the same code both times, because the difference
 * between them is one of timing and the crew should not be able to tell which
 * happened by what it cost them. */
function spendLife(state: State, p: Player) {
  if (state.lives <= 0) { endRunIfWiped(state); return; }
  state.lives--;
  p.downed = false;
  p.hp = COOP.RESPAWN_HP;
  p.invuln = COOP.REVIVE_INVULN;
  p.downT = 0;
  p.revivePumps = 0;
  p.reviveT = 0;
  /* Back at the pocket everyone arrived in. Their hopper goes with them —
   * it was never banked, and that is the bet the whole game is built on. */
  p.hopper = 0;
  p.hopperFrac = 0;
  p.hopperFull = false;
  p.oreHeld = 0;
  p.oreFrac = 0;
  p.x = state.spawn.lc * 2; p.y = state.spawn.lr * 2;
  p.px = p.x; p.py = p.y;
  p.dir = 2; p.pendingDir = -1;
  carve(state, p.x, p.y, -1, null);   // never respawn inside dirt
  emit(state, 'respawn', p.x + 1, p.y + 1, state.lives);
}

/* Contact needs REAL overlap, not a shared edge.
 *
 * Both actors are 2x2 cells, and a bare AABB test counts a corner clip of a
 * hundredth of a cell as a hit. On a phone one cell is 16 CSS pt, so an overlap
 * of 0.08 is about a pixel and a half — the monster is visibly diagonal, beside
 * you rather than on you, and you lose a point of health. That is the "hit me
 * around a corner" report, and it is unfalsifiable from the player's side
 * because there is nothing on screen to see.
 *
 * I could not reproduce it from a scripted tape — the tapes never engage a
 * monster closely enough — so this is not a fix for a confirmed sequence. It
 * makes the whole CLASS impossible instead, which is the right trade: the
 * margin can only ever remove a hit that looked unfair, and it costs nothing
 * when the two are genuinely on top of each other.
 *
 * CONTACT_BITE is a third of a cell on BOTH axes. Small enough that a real
 * collision still registers on the frame it happens — actors close at up to
 * 8 cells/second, which is 0.13 of a cell per step, so a genuine approach
 * crosses this margin in under three frames. Large enough that a corner clip
 * never counts.
 *
 * Deliberately NOT applied to falling rocks. A rock that grazes your shoulder
 * should still hurt: it is a lump of stone with momentum, the wobble told you
 * it was coming, and the helmet exists precisely to absorb it. */
const CONTACT_BITE = 0.34;

function touching(px: number, py: number, mx: number, my: number) {
  const ox = Math.min(px + 2, mx + 2) - Math.max(px, mx);
  if (ox < CONTACT_BITE) return false;
  const oy = Math.min(py + 2, my + 2) - Math.max(py, my);
  return oy >= CONTACT_BITE;
}

function stepFire(state: State, dt: number) {
  for (let i = state.fire.length - 1; i >= 0; i--) {
    const f = state.fire[i];
    /* A Fygar's jet extends before it holds; a vent and a Sapper blast do not
     * (no `grow` field) and fall straight through to the countdown. Growing
     * comes BEFORE the overlap test below, so the flame can only ever hurt you
     * as far as it has actually reached — which is the whole reason the range
     * could be tripled. FIRE_ACTIVE does not start ticking until it is out. */
    const grow = f.grow ?? 0;
    if (grow > 0 && (f.growT ?? 0) < grow) {
      f.growT = (f.growT ?? 0) + dt;
      const k = Math.min(1, f.growT / grow);
      const r = fireRect({ x: f.ox ?? 0, y: f.oy ?? 0 }, f.dir,
                         Math.max(0.001, (f.len ?? 0) * k));
      f.x = r.x; f.y = r.y; f.w = r.w; f.h = r.h;
    } else {
      f.t -= dt;
      if (f.t <= 0) { state.fire.splice(i, 1); continue; }
    }
    // Emberproof Hide covers a Fygar's breath and a basalt vent alike: they are
    // the same box in the same array, and a relic that only worked on one of
    // them would be a rule the player has to be told rather than shown.
    for (const q of state.players) {
      if (q.fireproof || q.dying || q.downed || q.invuln > 0) continue;
      if (overlaps(f.x, f.y, f.w, f.h, q.x, q.y, 2, 2)) hurtPlayer(state, q, f.x, f.y);
    }
  }
}

function stepEphemera(state: State, dt: number) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const q = state.particles[i];
    q.life -= dt;
    if (q.life <= 0) { state.particles.splice(i, 1); continue; }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vy += 14 * dt;
  }
  for (let i = state.popups.length - 1; i >= 0; i--) {
    state.popups[i].life -= dt;
    if (state.popups[i].life <= 0) state.popups.splice(i, 1);
  }
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 1.5);
}

function stepBonus(state: State, dt: number) {
  const T = tune();
  const b = state.bonus;
  if (!b.active) {
    if (b.t < 0) return;                                  // already taken this level
    if (state.playerCarved >= T.BONUS_CARVE_REQ) { b.active = true; b.t = T.BONUS_TIME; }
    return;
  }
  b.t -= dt;
  if (b.t <= 0) { b.active = false; b.t = -1; return; }
  const taker = state.players.find((q) => !q.dying && !q.downed && overlaps(b.x, b.y, 2, 2, q.x, q.y, 2, 2));
  if (taker) {
    addDirt(state, taker, b.value, b.x + 1, b.y + 1);
    particles(state, b.x + 1, b.y + 1, 'bonus', 12, 5);
    emit(state, 'bonus', b.x + 1, b.y + 1, b.value);
    b.active = false; b.t = -1;
  }
}

/* ── the descent ──────────────────────────────────────────────────────── */

/* Banking is the whole risk curve: everything in the hopper is at stake until
 * you clear the level, and safe the moment you drop to the next. Greedy digging
 * before the last kill is the bet. */
function bankHaul(state: State) {
  let haul = 0;
  for (const p of state.players) {
    state.banked += p.hopper;
    state.oreBanked += p.oreHeld;
    haul += p.hopper;
    p.hopper = 0;
    p.hopperFrac = 0;
    p.hopperFull = false;
    p.oreHeld = 0;
    p.oreFrac = 0;
  }
  emit(state, 'bank', undefined, undefined, haul);
}

/* The drill. The player is scripted straight down through whatever is under
 * them, carving as they go, until they punch out the bottom of the level.
 *
 * Speed is CELLS per second and the exit is a ROW, so this frames itself
 * correctly on every phone without the engine knowing anything about the
 * viewport — the camera already follows the player, so the shaft flies past
 * for free. That is the entire reason the transition is expressed this way. */
function stepDescend(state: State, p: Player, dt: number) {
  const T = tune();
  p.px = p.x; p.py = p.y;
  p.dir = 2;
  p.digging = true;
  p.moving = true;
  p.invuln = Math.max(p.invuln, 0.2);
  p.y = Math.min(GH - 2, p.y + T.DESCEND_SPEED * dt);
  // Not paid for: this is a cutscene, not a shift. Paying for it would make the
  // last two seconds of every level the most profitable digging in the game.
  carve(state, p.x, p.y, 2, null);   // the drill bores, it does not pay
  if (state.rng() < 0.9) particles(state, p.x + 1, p.y, 'dirt', 2, 4);
  updateDepth(state);
}

/* ── step ─────────────────────────────────────────────────────────────── */

const NEUTRAL_INPUT: Input = { dir: null, dirHeld: false, pumps: 0 };

export function step(state: State, dt: number, input: Input | readonly Input[]) {
  const inputs: readonly Input[] = Array.isArray(input) ? input : [input as Input];
  const T = tune();
  if (state.phase === 'title' || state.phase === 'gameover' || state.phase === 'paused') return;

  state.tick++;

  if (state.phase === 'dying') {
    state.phaseT -= dt;
    for (const p of state.players) p.dyingT = Math.max(0, p.dyingT - dt);
    stepEphemera(state, dt);
    if (state.phaseT <= 0) {
      // A run is one shift. The hopper goes down with you; only what was banked
      // on the way past each descent survives.
      state.phase = 'gameover';
      emit(state, 'gameover');
    }
    return;
  }

  /* Two beats, not one. The hold lets the last kill land and the popups settle;
   * the drill is the descent itself. Banking happens at the START of the hold
   * so the HUD can count the haul up while the shaft goes by. */
  if (state.phase === 'levelclear') {
    state.phaseT -= dt;
    stepRocks(state, dt);
    stepEphemera(state, dt);
    if (state.phaseT <= 0) {
      state.phase = 'descend';
      state.phaseT = T.DESCEND_TIME;
      const lead = state.players[0];
      for (const p of state.players) p.drilling = true;
      // The shaft comes down where the crew's first digger is standing.
      state.exitLc = lead ? laneOf(lead.x) : null;
      if (lead) emit(state, 'descend', lead.x + 1, lead.y + 1);
    }
    return;
  }

  if (state.phase === 'descend') {
    state.phaseT -= dt;
    for (const p of state.players) stepDescend(state, p, dt);
    stepRocks(state, dt);
    stepEphemera(state, dt);
    if (state.phaseT <= 0 || state.players.some((p) => p.y >= GH - 2)) {
      startLevel(state, state.level + 1);
    }
    return;
  }

  state.repathT -= dt;
  if (state.repathT <= 0) { repath(state); state.repathT = T.REPATH_EVERY; }
  // Before stepPressure: it sets the air-drain multiplier that stepPressure
  // then spends.
  stepHazards(state, dt);
  stepPressure(state, dt);

  /* Each digger steps with their OWN tune installed, because relics are
   * carried rather than shared: Wide Bore reshapes one player's tunnel, not
   * everyone's. The tune is a module-level object, so the only way to give a
   * digger their own is to install it around their step and put the base back
   * afterwards for everything the world does on its own. */
  state.players.forEach((q, i) => {
    const inp = q.downed ? NEUTRAL_INPUT : (inputs[i] ?? NEUTRAL_INPUT);
    setWorldTune(q.tune);
    stepPlayer(state, q, dt, inp);
    // All taps that arrived this step are consumed here, whether they fired,
    // pumped, or hit nothing. Carrying a surplus forward would let a burst of
    // taps queue into a second shot the player never asked for.
    stepHarpoon(state, q, dt, inp.pumps | 0);
  });
  setWorldTune(baseTune);
  stepDowned(state, dt);

  /* Digging is what wakes a shark, and this is where the two meet.
   *
   * carve() cannot do it itself: world.js may not import monsters.js, so it
   * records where the ground was cut and the coupling is made here, between the
   * player's dig this frame and the monsters stepping on it. Draining before
   * stepMonster means a shark reacts on the same frame you cut, not the next.
   *
   * The loop is 16 monsters against a handful of carve events, so it is left
   * plain rather than indexed — and it must not be skipped for off-screen
   * sharks, per the field-wide simulation rule in CLAUDE.md. */
  if (state.carveEvents.length) {
    for (const m of state.monsters) {
      if (m.dead || !m.k || !m.k.frenzies) continue;
      for (const ev of state.carveEvents) {
        /* Only ground the PLAYER cut and was paid for. `pay` is false for a
         * Grub's own tunnel and for the descent drill, and a shark roused by
         * another monster's digging would be reacting to something the player
         * neither did nor can stop doing — the counterplay is "stop cutting",
         * so the trigger has to be cutting. */
        if (!ev.pay) continue;
        const dx = ev.x - m.x, dy = ev.y - m.y;
        if (Math.hypot(dx, dy) > T.SHARK_FRENZY_RADIUS) continue;
        m.frenzy = Math.min(T.SHARK_FRENZY_MAX, m.frenzy + 1);
      }
    }
    state.carveEvents.length = 0;
  }

  for (const m of state.monsters) stepMonster(state, m, dt);

  /* The canary's second job: one warning per monster, on the frame it starts
   * winding up to phase.
   *
   * Detected here rather than inside monsters.js because the mode change is
   * that file's business and the upgrade is this one's — and because the
   * previous mode is the only thing needed, which is cheap to carry. GHOST_WIND
   * is 0.45s of wind-up, so the cue lands with time to move.
   *
   * This matters more than it used to. The field is 160 rows deep and the view
   * scrolls, so the monster that is about to come through the wall at you is
   * very often nowhere on screen. */
  if (T.CANARY > 0) {
    for (const m of state.monsters) {
      if (m.mode === 'ghostwind' && m.canaryMode !== 'ghostwind') {
        emit(state, 'canary', m.x + 1, m.y + 1, 'phase');
      }
      m.canaryMode = m.mode;
    }
  }

  stepRocks(state, dt);
  stepFire(state, dt);
  // After stepFire and after stepHazards, so a wheel launched this frame moves
  // and can land its hit on the frame it appears — the same as a jet.
  stepWheels(state, dt);
  stepBonus(state, dt);
  for (const q of state.players) stepPickups(state, q);
  stepEphemera(state, dt);
  updateDepth(state);

  /* Contact kills — but intangible means intangible in BOTH directions.
   *
   * A monster that is phasing through rock cannot be harpooned, so it must not
   * be able to kill either. Leaving it lethal produced the worst death in the
   * game: the escapee climbing through solid ground straight over a player who
   * had no move available and no way to retaliate. Since ghosts now migrate
   * toward open ground rather than hunting, such a contact is pure accident.
   *
   * Rematerialising is excluded for the same reason — a ghost must not be able
   * to solidify on top of you and take a life you had no way to avoid. */
  for (const p of state.players) {
    if (p.dying || p.downed || p.invuln > 0) continue;
    for (const m of state.monsters) {
      if (m.dead || m.dying) continue;
      if (m.mode === 'pumped' || m.mode === 'remat') continue;
      if (m.mode === 'ghost') continue;
      if (touching(p.x, p.y, m.x, m.y)) { hurtPlayer(state, p, m.x, m.y); break; }
    }
  }

  /* Only monsters that COUNT gate the descent. A static kind guards ground
   * rather than blocking the way down; leaving one alive must never strand the
   * player, and it must never be elected hunter — an immobile hunter can reach
   * nobody and the level would stall with nothing on screen to explain it. */
  const alive = state.monsters.filter(counts);
  if (state.phase === 'play') {
    if (alive.length === 0) {
      bankHaul(state);
      state.phase = 'levelclear';
      state.phaseT = T.CLEAR_HOLD;
      emit(state, 'levelclear');
    } else if (alive.length === 1 && !alive[0].hunting) {
      beginHunt(state, alive[0]);
    }
  }
}
