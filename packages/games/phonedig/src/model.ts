/* Shared simulation types.
 *
 * These describe the state the simulation actually builds — see `create()` and
 * `newPlayer()` in engine.ts, `newMonster()` in monsters.ts. They are written
 * as one place to change rather than as a specification: the source is still
 * the authority, and anything here that disagrees with it is a bug here.
 *
 * This file must stay importable from the BROWSER. Client code needs the level
 * generator to rebuild terrain from a seed, so it imports worldgen.ts, which
 * imports this. Nothing here may pull in engine/world/monsters.
 */

export type { Tune, Dir, Rng, LaneNode, Owned } from './worldgen';
import type { Dir, Rng, LaneNode, Tune } from './worldgen';
import type { PlayerId } from '../../../party-contract/src/index';

/* ── entities ─────────────────────────────────────────────────────────── */

/* One digger.
 *
 * Everything a shift is measured in lives here rather than on the state,
 * because a shared shaft has several of them: the haul at risk, the air, the
 * health, the harpoon, the relics carried and the tunables those relics fold
 * onto. What stays on the state is what the whole crew shares — the ground, the
 * monsters, the bank. */
export type Player = {
  id: number;
  /** The room seat this digger belongs to, or null for an unclaimed body. */
  seatId: PlayerId | null;
  x: number; y: number; px: number; py: number;
  dir: Dir; pendingDir: Dir; pendingT: number;
  digging: boolean; moving: boolean;
  invuln: number; dying: boolean; dyingT: number;
  releaseT: number;
  breachCd: number;
  drilling: boolean;

  hp: number; maxHp: number; helmet: number;
  air: number; airMax: number;

  /** This descent's haul, at risk until it is banked. */
  hopper: number; hopperFrac: number; hopperMax: number; hopperFull: boolean;
  oreHeld: number; oreFrac: number;

  /** Picked up this run and lost with it. Each digger carries their own. */
  relics: string[];
  /** Relic flags, mirrored out so hot paths test a boolean. */
  rockproof: boolean; fireproof: boolean; pierce: boolean; wide: boolean;
  breach: boolean; breachMax: number;
  /** The lamp's reach in FINE CELLS. The view turns it into pixels. */
  lightRadius: number;
  /** The effective tune this digger's relics produce. */
  tune: Tune;

  /* ── downed ──────────────────────────────────────────────────────────
   * A digger at zero health is DOWN, not dead: still in the shaft, out of
   * the fight, and reachable. See COOP in tuning.ts. */
  downed: boolean;
  /** Seconds left before a team life is spent getting them back. */
  downT: number;
  /** Pumps landed by teammates, banked toward standing up. Deflates like a
   *  monster does if everyone lets go. */
  revivePumps: number;
  /** Deflate cadence for those pumps, mirroring a monster's pumpT. */
  reviveT: number;

  harpoon: Harpoon;
  /** Metres below the surface, right now. */
  depth: number;
  /** Cells this digger cut themselves; the bonus reads it. */
  carved: number;
};

/** One row of the MONSTERS table, plus the fields mergeVariant folds on.
 *  The field list is the union of what the tables actually carry — see
 *  MONSTERS and VARIANTS in monsters.ts, and the header comment there. */
export type MonsterKind = {
  id: string;
  particle: string;
  speedMul: number;
  canGhost: boolean;
  alwaysGhost?: boolean;
  blastProof?: boolean;
  blocking?: boolean;
  breathes?: boolean;
  digs?: boolean;
  dropsRocks?: boolean;
  frenzies?: boolean;
  harpoonImmune?: boolean;
  preferAbove?: boolean;
  static?: boolean;
  pumpFixed?: number;
  pumpMul?: number;
  onDeath?: (state: State, m: Monster, byRock?: boolean) => void;
  /** A getter installed by makeKind; reads the current tune. */
  readonly pumpStages?: number;
  /* Added by mergeVariant, never present on a base row. */
  variant?: string | null;
  variantName?: string;
  tint?: string | null;
  ghostMul?: number;
  blastMul?: number;
  fireMul?: number;
};

/** A variant row: scales multiply onto the base kind, `over` replaces outright. */
export type Variant = {
  id: string; name: string; tint: string;
  minDepth: number; weight: number;
  speedScale?: number; pumpScale?: number; ghostScale?: number;
  blastScale?: number; fireScale?: number;
  over?: Partial<MonsterKind>;
};

export type MonsterMode =
  | 'patrol' | 'chase' | 'ghostwind' | 'ghost' | 'remat' | 'pumped' | 'dying';

export type Monster = {
  id: number;
  kind: string;
  variant: string | null;
  tint: string | null;
  k: MonsterKind;
  x: number; y: number; px: number; py: number;
  home: LaneNode;
  tc: number; tr: number;
  dir: Dir;
  mode: MonsterMode;
  hunting: boolean;
  markT: number;
  windT: number;
  /** Where a phasing monster is heading, in FINE cells — not a lane node. */
  ghostGoal: { x: number; y: number; d?: number } | null;
  /** The component it left, so it lands in a new one. Lane-node indices. */
  ghostFrom: Set<number> | null;
  /** A hunter's commute: the player's component, snapshotted at phase-out. */
  ghostComp: Set<number> | null;
  pump: number; pumpT: number;
  stun: number;
  ghostT: number; ghostTimer: number;
  stuckT: number;
  rematT: number;
  alpha: number;
  telegraph: number;
  fireCd: number;
  dropCd: number;
  surfaceT: number;
  frenzy: number;
  digging: boolean;
  breaching: boolean;
  dying: boolean; dyingT: number; dead: boolean;
  crushed: boolean;
  blastDepth: number;
  speedMul?: number;
  /** Last mode the canary announced, so it warns once per transition. */
  canaryMode?: MonsterMode;
};

export type MonsterSpec = {
  lc: number; lr: number;
  kind: string;
  variant?: string | null;
};

export type Rock = {
  id: number;
  x: number; y: number; px: number; py: number;
  state: 'idle' | 'wobble' | 'falling' | 'breaking';
  t: number; vy: number;
  chain: number; openRun: number; crushLeft: number; lastRow: number;
  fromHazard?: string;
  fromMonster?: number;
};

export type Harpoon = {
  active: boolean;
  dir: Dir;
  len: number;
  state: 'idle' | 'out' | 'hit' | 'back';
  /** What is on the end of the line: a monster to burst, or a friend to pull
   *  up. Never both, and the flight tests monsters first so one standing
   *  between you and them still takes the shot. */
  mon: Monster | null;
  ally: Player | null;
};

export type Fire = {
  x: number; y: number; w: number; h: number;
  dir: Dir; t: number;
  owner: Monster | null;
  /** A Sapper's blast: a fixed square, no growth. */
  blast?: boolean;
  /* A Fygar's jet, which grows from its mouth along a measured runway. */
  ox?: number; oy?: number; len?: number; grow?: number; growT?: number;
};

export type Wheel = {
  id: number;
  x: number; y: number; px: number; py: number; ox: number; oy: number;
  dir: Dir;
  travel: number; pTravel: number; left: number; cursor: number;
  life: number;
  src: Hazard;
};

export type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  kind: string;
};

export type Popup = { x: number; y: number; text: string; life: number; max: number };

export type Bonus = {
  active: boolean;
  x: number; y: number; t: number; value: number;
  at: LaneNode;
};

/** Hazard data from the generator, plus the runtime fields startLevel adds. */
export type Hazard = {
  kind: string;
  lc: number; lr: number;
  t: number; warnT: number; inside: boolean;
  dir: Dir; shots: number;
  count?: number;
  phase0?: number;
  radius?: number;
  drain?: number;
  every?: number;
  /** Telegraph duration for this hazard, in seconds. */
  warn?: number;
};

/** The sealed chamber: its lane footprint, its fine-cell centre, and the
 *  pre-shuffled pool the first arrival draws from. */
export type RelicSite = LaneNode & {
  nodes: LaneNode[];
  pool: string[];
  at: { x: number; y: number };
};

export type CrystalSite = LaneNode & { id: string; guard: string };

export type Pocket = LaneNode & {
  taken?: boolean;
  amount?: number;
  /** The damp surface mark above a sealed pocket. Read only by the renderer. */
  hint?: { up: number; w: number };
};

export type GameEvent = {
  type: string;
  x?: number; y?: number;
  /** Free-form payload: a magnitude for most events, an id for crystal/hazard. */
  value?: number | string;
};

/* ── the whole simulation ─────────────────────────────────────────────── */

export type Phase =
  | 'title' | 'play' | 'dying' | 'gameover' | 'paused' | 'levelclear' | 'descend';

export type LevelParams = {
  monsters: number; fygars: number; rocks: number;
  pocketBonus: number; hazardBonus: number; veinBonus: number;
  speedMul: number; ghostInterval: number; fireCooldown: number;
  bonusDirt: number; oreMul: number; airDrainMul: number;
};

export type State = {
  phase: Phase;
  runSeed: number;
  level: number;

  nextId: number;
  tick: number;

  /** Banked by the whole crew. Only what was banked survives a run. */
  banked: number;
  oreBanked: number;

  /** Team lives left. Spent when a downed digger is not reached in time. */
  lives: number;
  livesMax: number;

  /** Whether THIS level's chamber and crystal have been emptied. */
  relicTaken: boolean;
  crystalTaken: boolean;

  carveEvents: { x: number; y: number; cells: number; pay: boolean }[];

  hazardDrain: number;

  levelSerial: number;
  dirtRev: number;
  rowRev: Int32Array;
  carved: number;
  playerCarved: number;
  dirt: Uint8Array;
  ore: Uint8Array;
  pocketHint: Uint8Array;
  /** Fine columns actually in play; storage is always GRID.GW wide. */
  activeGW: number;
  /** ...and the same in lane nodes. Everything placed respects these. */
  activeLanes: number;
  skyRows: number;
  theme: string;
  /** The deepest any digger has reached this run. */
  deepest: number;

  players: Player[];
  monsters: Monster[];
  rocks: Rock[];
  fire: Fire[];
  wheels: Wheel[];
  particles: Particle[];
  popups: Popup[];
  bonus: Bonus;
  pockets: Pocket[];
  relicSite: RelicSite | null;
  crystalAt: CrystalSite | null;
  hazards: Hazard[];
  events: GameEvent[];

  /** Lane distance to the NEAREST living digger, from one multi-source flood. */
  dist: Int16Array;
  /** Which digger that shortest path leads to, by index. -1 where unreachable. */
  nearest: Int8Array;
  seenScratch: Uint8Array;
  repathT: number;
  wokenAt: number;
  caveinT: number;
  caveinNext: number;
  shake: number;
  phaseT: number;
  exitLc: number | null;
  params: LevelParams;
  rng: Rng;
  spawn: LaneNode;
};

/** What `step()` consumes each tick. Matches phonedig's input.snapshot(). */
export type Input = {
  dir: Dir | null;
  dirHeld: boolean;
  pumps: number;
};

/** The "can this actor enter that node" predicate componentOf floods with. */
export type Passable = (state: State, lc: number, lr: number) => boolean;

/* ── the wire ─────────────────────────────────────────────────────────────
 *
 * Everything below crosses the socket, so it must survive assertSerializable:
 * plain objects, arrays, finite numbers, strings and booleans only. No typed
 * arrays, no Maps, no undefined — an explicitly-undefined property throws
 * rather than being dropped the way JSON.stringify would drop it. Omit an
 * absent optional instead of assigning undefined to it.
 */

/** Host-facing settings. validateSettings({}) must return working defaults. */
export type Settings = {
  startLevel: number;
  /** Team lives. Spent only when nobody reaches a downed digger in time. */
  lives: number;
};

/** Held input, sampled at the server tick.
 *
 * `pumpSeq` is CUMULATIVE, not a per-frame count. Held state is coalesced at
 * 20 Hz and intermediate values are dropped by design, so a per-frame count
 * would silently lose taps; a running total lets the server take the difference
 * and recover every one of them. It also makes a resend idempotent. */
export type NetInput = {
  dir: Dir | null;
  dirHeld: boolean;
  pumpSeq: number;
};

/** Reliable, acknowledged actions. Kept for things that must not be lost and
 *  happen rarely — never for per-frame intent, which has a 256/round budget. */
/*  `turnId` is the game's own, alongside the platform's round id: it names the
 *  kit-up the pick belongs to, so a tap that arrives after the drill started is
 *  rejected rather than silently changing somebody mid-shift. */
export type Action =
  | { type: 'kit'; turnId: number; suit: string };

/** One run of cut ground: [first cell index, run length]. See refreshEdits. */
export type Edit = [number, number];

export type NetPlayer = {
  id: PlayerId;
  /* Carried here rather than looked up from the room: only SceneView is handed
   * the roster, and the HUD needs to say who is who too. */
  name: string;
  color: string;
  x: number; y: number;
  dir: Dir;
  digging: boolean; moving: boolean;
  /** `dyingT` counts DOWN through DEATH_TIME; the silhouette spins on it. */
  dying: boolean; dyingT: number;
  invuln: number;
  drilling: boolean;
  hp: number; maxHp: number;
  /* Public because the watching screen has to show the crew at a glance —
   * whose air is going, who is carrying too much to risk another cell, and
   * above all who is on the floor waiting for someone. */
  air: number; airMax: number;
  hopper: number; hopperMax: number;
  relics: string[];
  /** This digger's lamp reach in fine cells, with their relics folded in. */
  lightRadius: number;
  /** The suit they are wearing, or null while they are still choosing. */
  suit: string | null;
  downed: boolean;
  /** Seconds left to reach them, and how much of the hold is banked (0..1). */
  downT: number;
  reviveProgress: number;
};

export type NetMonster = {
  id: number;
  kind: string;
  variant: string | null;
  x: number; y: number;
  dir: Dir;
  mode: MonsterMode;
  pump: number; stages: number;
  hunting: boolean;
  /** Countdown on the hunter ring's arrival pulse. See drawHunterMark. */
  markT: number;
  alpha: number;
  telegraph: number;
  dying: boolean;
};

export type NetRock = {
  id: number; x: number; y: number; state: Rock['state']; t: number;
};

/* ── packed entities ──────────────────────────────────────────────────────
 *
 * Monsters and rocks go over the wire as flat number arrays rather than as
 * objects, because at four diggers on a deep level they are most of the
 * snapshot and the envelope is 32 KiB. A JSON object repeats its key names once
 * per entity; a hundred monsters is a hundred copies of "telegraph".
 *
 * The layout is defined here, once, and both sides use these functions — the
 * server to pack and the renderer to unpack. Editing one half of a pair by hand
 * is how an encoding like this goes wrong, so there is no other half to edit.
 * Positions are quantised to a hundredth of a cell, which is a fifth of a pixel
 * at the largest scale anyone plays at.
 */
export const MONSTER_STRIDE = 13;
export const ROCK_STRIDE = 5;

const q = (v: number) => Math.round(v * 100);
const u = (v: number) => v / 100;

export function packMonsters(
  list: readonly Monster[],
  stagesOf: (m: Monster) => number,
  kindIndex: (id: string) => number,
  variantIndex: (kind: string, variant: string | null) => number,
  modeIndex: (mode: string) => number,
): number[] {
  const out: number[] = [];
  for (const m of list) {
    if (m.dead) continue;
    out.push(
      m.id,
      kindIndex(m.kind),
      variantIndex(m.kind, m.variant),
      q(m.x), q(m.y),
      m.dir,
      modeIndex(m.mode),
      m.pump, stagesOf(m),
      q(m.alpha), q(m.telegraph), q(m.markT),
      (m.hunting ? 1 : 0) | (m.dying ? 2 : 0),
    );
  }
  return out;
}

export function readMonsters(
  flat: readonly number[],
  kindName: (i: number) => string,
  variantName: (kind: string, i: number) => string | null,
  modeName: (i: number) => MonsterMode,
): NetMonster[] {
  const out: NetMonster[] = [];
  for (let i = 0; i + MONSTER_STRIDE <= flat.length; i += MONSTER_STRIDE) {
    const kind = kindName(flat[i + 1]);
    out.push({
      id: flat[i],
      kind,
      variant: variantName(kind, flat[i + 2]),
      x: u(flat[i + 3]), y: u(flat[i + 4]),
      dir: flat[i + 5],
      mode: modeName(flat[i + 6]),
      pump: flat[i + 7], stages: flat[i + 8],
      alpha: u(flat[i + 9]), telegraph: u(flat[i + 10]), markT: u(flat[i + 11]),
      hunting: (flat[i + 12] & 1) !== 0,
      dying: (flat[i + 12] & 2) !== 0,
    });
  }
  return out;
}

export function packRocks(list: readonly Rock[], stateIndex: (s: string) => number): number[] {
  const out: number[] = [];
  for (const r of list) out.push(r.id, q(r.x), q(r.y), stateIndex(r.state), q(r.t));
  return out;
}

export function readRocks(flat: readonly number[], stateName: (i: number) => Rock['state']): NetRock[] {
  const out: NetRock[] = [];
  for (let i = 0; i + ROCK_STRIDE <= flat.length; i += ROCK_STRIDE) {
    out.push({
      id: flat[i], x: u(flat[i + 1]), y: u(flat[i + 2]),
      state: stateName(flat[i + 3]), t: u(flat[i + 4]),
    });
  }
  return out;
}

/* Fire is a handful of rectangles at most, so unlike monsters it goes over as
 * objects. The extra fields are all the jet's: the renderer draws it in its own
 * space from the mouth outward, and reproduces its wobble from the same values
 * the simulation owns rather than from a clock. See jetNoise in entities.ts. */
export type NetFire = {
  x: number; y: number; w: number; h: number; dir: Dir;
  /** Seconds left. Drives the fade, and half of the wobble. */
  t: number;
  /** A Sapper's blast: a fixed square, drawn as a burst rather than a jet. */
  blast?: boolean;
  /** The mouth it grew from, and how far into the growth it is. */
  ox?: number; oy?: number; growT?: number;
  /** Monster id, so the breather's own animation knows it is breathing. */
  owner: number | null;
};

export type NetWheel = {
  id: number; x: number; y: number; dir: Dir;
  /** Cells rolled. The rim's rotation is derived from it, never from a clock. */
  travel: number;
};

export type NetHazard = {
  kind: string; lc: number; lr: number; warnT: number; dir: Dir;
};

/* One thing that happened, for the ears and the eyes.
 *
 * Events are how the simulation tells a client that a cell was cut, a monster
 * burst, a rock let go. Upstream drives both the sound and the effect layer
 * from the same list in the same loop, and an event with no entry in either
 * table is silently ignored — so they cross the wire whole rather than being
 * filtered to what today's client happens to use.
 *
 * `seq` is monotonic for the round. The client replays anything newer than the
 * last one it saw, which makes a resent snapshot harmless and a dropped one
 * cost only the effects it carried. They are cosmetic: nothing in the
 * simulation depends on a client having heard them. */
export type NetEvent = {
  seq: number;
  type: string;
  x?: number;
  y?: number;
  value?: number | string;
};

export type PublicView = {
  /** Bumps whenever `edits` changes; the snapshot cache diffs against it. */
  revision: number;
  edits: Edit[];

  /* Everything the client needs to regenerate this level's terrain locally. */
  runSeed: number;
  level: number;
  entryLc: number | null;
  /** Lane columns in play, and the same in fine cells. Fixed for the run. */
  lanes: number;
  activeGW: number;

  phase: Phase;
  tick: number;
  skyRows: number;
  theme: string;
  depth: number;
  deepest: number;
  carved: number;

  air: number; airMax: number;
  hopper: number; hopperMax: number; hopperFull: boolean;
  banked: number; oreHeld: number; oreBanked: number;
  relics: string[];
  lives: number; livesMax: number;

  /* Non-null while the crew is kitting up and the shaft is holding still.
   * The suit catalogue is not sent — it never changes, so the picker imports
   * it directly from suits.ts. */
  kitup: { secondsLeft: number; everyonePicked: boolean } | null;
  lightRadius: number;
  shake: number;

  /** Newest last, bounded. See EVENT_LIMIT in server.ts. */
  events: NetEvent[];

  players: NetPlayer[];
  /** Packed; see packMonsters / readMonsters above. */
  monsters: number[];
  rocks: number[];
  fire: NetFire[];
  wheels: NetWheel[];
  hazards: NetHazard[];
  /** One per digger currently firing; absent diggers simply are not listed. */
  harpoons: {
    ownerId: PlayerId; x: number; y: number; dir: Dir;
    len: number; state: Harpoon['state'];
  }[];
  bonus: { x: number; y: number; value: number } | null;
  /** Only the untaken ones; a taken pocket is just terrain again. */
  pockets: LaneNode[];
  /* `pool` is this chamber's pre-shuffled candidates. Sent so the view can ask
   * the same question the engine will ask on pickup — "the first of these the
   * finder is not already carrying" — and draw the relic that will actually be
   * handed over. Showing one object and giving another is worse than the
   * generic disc. */
  relicSite: { x: number; y: number; pool: string[] } | null;
  crystalAt: (LaneNode & { id: string }) | null;
};

/** Per-player, never cached or delta'd by the transport. */
export type PrivateView = {
  /** False for a spectator, or a seat the simulation has not taken up. */
  playing: boolean;
  hp: number;
  maxHp: number;
  air: number;
  hopper: number;
  breachCd: number;
  downed: boolean;
  /** Seconds left before a team life is spent getting you back. */
  downT: number;
  /** Someone is with you and the hold is running. */
  beingRevived: boolean;
  message: string;
};
