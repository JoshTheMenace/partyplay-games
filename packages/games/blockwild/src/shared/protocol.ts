import { HEIGHT, HOTBAR_SIZE, INVENTORY_SIZE, MAX_CMDS, WORLD } from './constants';
import { wrapAngle } from './coords';
import type { Slot } from './items';
export type { Slot };

export type Mode = 'survival' | 'creative';
export type Difficulty = 'peaceful' | 'easy' | 'normal';
/** seed 0 = a random world each round (the server picks the real seed; View.seed always holds it). */
export type Settings = { mode: Mode; seed: number; difficulty: Difficulty; keepInventory: boolean };
/** Gameplay never uses reliable actions (256/round cap); everything rides in held input. */
export type Action = { type: 'noop' };

/** Input flags (`Input.f`). */
export const IF = { ON_GROUND: 1, SNEAK: 2, SPRINT: 4, FLYING: 8, USING: 16, SWINGING: 32, NO_POS: 64 } as const;
/** Public player flags (`PubPlayer.flags`). */
export const PF = { SNEAKING: 1, SLEEPING: 2, DEAD: 4, FLYING: 8, USING: 16, OFFLINE: 32, BURNING: 64 } as const;
/** Mob state bits (`PubMob.s`). ANGRY: provoked (zombified piglins). BURNING: on fire. */
export const MS = { SHEARED: 1, BABY: 2, ANGRY: 4, BURNING: 8 } as const;

/**
 * Container click targets: inventory, crafting grid, crafting output, open screen slots, worn armor (i = 0 head,
 * 1 chest, 2 legs, 3 feet). b: 0 left, 1 right, 2 shift.
 */
export type ClickTarget = 'inv' | 'grid' | 'out' | 'screen' | 'armor';
/** A command body without its sequence number. */
export type CmdBody =
  | { t: 'break'; x: number; y: number; z: number }
  /** x,y,z = the clicked block; face 0..5 = -X,+X,-Y,+Y,-Z,+Z; hy = vertical hit fraction 0..1 on the clicked face (slab/stair halves). */
  | { t: 'place'; x: number; y: number; z: number; face: number; slot: number; hy?: number }
  | { t: 'use'; x: number; y: number; z: number; face: number }
  | { t: 'useItem'; slot: number }
  | { t: 'attack'; id: number }
  | { t: 'interact'; id: number }
  | { t: 'click'; w: ClickTarget; i: number; b: 0 | 1 | 2 }
  | { t: 'craft'; r: string; max?: boolean }
  | { t: 'close' }
  | { t: 'drop'; slot: number; all?: boolean }
  | { t: 'respawn' }
  /** Leave a bed. */
  | { t: 'wake' }
  | { t: 'creative'; id: number; slot: number }
  /** Execute offer i on the open trade screen once, or as many times as possible with max. */
  | { t: 'trade'; i: number; max?: boolean };
export type Cmd = { n: number } & CmdBody;
export type CmdType = CmdBody['t'];

export type Input = {
  /** Feet position and velocity of the client-predicted body. */
  p: [number, number, number]; v: [number, number, number]; yaw: number; pitch: number;
  /** IF flags. With IF.NO_POS the server ignores p, v, yaw, pitch, slot and tpAck. */
  f: number;
  /** Selected hotbar slot 0..8. */
  slot: number;
  /** Block being mined, or null. */
  mine: [number, number, number] | null;
  /** Last server teleport sequence applied. */
  tpAck: number;
  /** Unacknowledged commands, ascending n, at most MAX_CMDS. */
  cmds: Cmd[];
};

export type PubPlayer = {
  id: string; name: string; color: string; x: number; y: number; z: number; yaw: number; pitch: number;
  /** Held item id (0 = empty hand). */
  held: number;
  /** Monotonic counters: increment to trigger one swing / hurt animation. */
  swing: number; hurt: number;
  health: number; flags: number;
  /** [x, y, z, crack stage 0..9] while mining. */
  mine?: [number, number, number, number];
  /** Worn armor item ids (0 = none): head, chest, legs, feet. */
  armor: [number, number, number, number];
};
/**
 * a: 0 idle, 1 walk, 2 attack, 3 fuse/charging (primed TNT: remaining fuse ticks / 4, for the flash). s: MS bits.
 * p: villager profession (0 farmer, 1 librarian, 2 armorer, 3 toolsmith, 4 cleric).
 */
export type PubMob = { id: number; t: number; x: number; y: number; z: number; yaw: number; hurt: number; a: number; s?: number; p?: number };
export type PubItem = { id: number; item: number; n: number; x: number; y: number; z: number };
/** k: 1 = ghast fireball (omitted for arrows). */
export type PubArrow = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; k?: number };
export const FX_KINDS = ['break', 'place', 'hit', 'explode', 'mob', 'hurtMob', 'die', 'pickup', 'eat', 'splash', 'bow', 'door', 'chest', 'furnace', 'craft', 'levelup',
  'portal', 'travel', 'ignite', 'fizz', 'lever', 'button', 'piston', 'tnt', 'trade', 'spawner', 'ghast', 'fireball', 'lamp'] as const;
export type FxKind = typeof FX_KINDS[number];
/**
 * Monotonic id; clients play each once. a: cell value for break/place, mob type for mob; piston: the moved cells'
 * facing (0..5) + 8 × pushed count, so clients can animate the slide.
 */
export type Fx = { id: number; k: FxKind; x: number; y: number; z: number; a?: number };
export type Stats = { mined: number; placed: number; crafted: number; mobs: number; deaths: number; days: number };
/** One player's totals for the results journal (distance = blocks walked). */
export type JournalEntry = { id: string; mined: number; placed: number; crafted: number; mobs: number; deaths: number; distance: number };

export type View = {
  /** The real world seed (never 0) and a world identity that stays stable across saves and loads. */
  seed: number; worldId: string; mode: Mode; difficulty: Difficulty; time: number; day: number;
  revision: number; edits: [number, number][];
  players: PubPlayer[]; mobs: PubMob[]; items: PubItem[]; arrows: PubArrow[]; fx: Fx[];
  /** Players currently in bed. */
  sleeping: number;
  stats: Stats;
  /** Per-player totals, published once the host finishes the session. */
  journal?: JournalEntry[];
};

export type ScreenKind = 'table' | 'furnace' | 'chest' | 'trade';
/** One villager offer: pay `buy` (+ `buyB`) from the inventory for `sell`; `left` uses remain until the next restock. */
export type TradeOffer = { buy: Slot; buyB?: Slot; sell: Slot; left: number };
/** The open screen. Trade screens have no slots; x, y, z is the villager's cell. */
export type Screen = {
  kind: ScreenKind; x: number; y: number; z: number; slots: (Slot | null)[]; burn?: number; burnMax?: number; cook?: number; cookMax?: number;
  offers?: TradeOffer[]; villager?: number; profession?: number;
};
export type PrivateView = {
  ack: number;
  /** Server teleport, applied once per new n; `yaw` (portal arrivals) also turns the view. */
  tp: { n: number; x: number; y: number; z: number; yaw?: number };
  imp: { n: number; vx: number; vy: number; vz: number };
  /** 36 slots: 0..8 hotbar, 9..35 main. */
  inv: (Slot | null)[];
  cursor: Slot | null;
  /** 4 (2×2 inventory grid) or 9 (crafting table). */
  grid: (Slot | null)[];
  out: Slot | null;
  screen: Screen | null;
  health: number; food: number; saturation: number;
  /** 0..300 ticks. */
  air: number;
  dead: boolean; deathMessage?: string;
  spawn: [number, number, number];
  toast?: { n: number; text: string };
  mode: Mode; keepInventory: boolean;
  /** Spawn/respawn protection ticks remaining (no damage, hostiles ignore you); omitted when 0. */
  protectedTicks?: number;
  /** Worn armor: head, chest, legs, feet. */
  armor: (Slot | null)[];
  /** Sum of worn armor points (0..20). */
  armorPoints: number;
  /** Burning ticks left; omitted at 0. */
  burning?: number;
  /** Portal charge 0..1 while standing in a nether portal; omitted at 0. */
  portal?: number;
  dimension: 'overworld' | 'nether';
};

/**
 * Mob types; `t` in PubMob indexes this list (append only). w/h = AABB width/height in blocks. `kind`: monsters are
 * hostile (despawn, cap, peaceful removal, block sleep; zombified piglins are monsters that wait to be provoked),
 * animals are saved with the world, villagers are saved in their own list, objects (primed TNT) are neither.
 */
export const MOB_TYPES = [
  { key: 'zombie', hostile: true, kind: 'monster', w: 0.6, h: 1.95, health: 20 },
  { key: 'skeleton', hostile: true, kind: 'monster', w: 0.6, h: 1.99, health: 20 },
  { key: 'spider', hostile: true, kind: 'monster', w: 1.4, h: 0.9, health: 16 },
  { key: 'creeper', hostile: true, kind: 'monster', w: 0.6, h: 1.7, health: 20 },
  { key: 'cow', hostile: false, kind: 'animal', w: 0.9, h: 1.4, health: 10 },
  { key: 'pig', hostile: false, kind: 'animal', w: 0.9, h: 0.9, health: 10 },
  { key: 'sheep', hostile: false, kind: 'animal', w: 0.9, h: 1.3, health: 8 },
  { key: 'chicken', hostile: false, kind: 'animal', w: 0.4, h: 0.7, health: 4 },
  { key: 'villager', hostile: false, kind: 'villager', w: 0.6, h: 1.95, health: 20 },
  { key: 'zombified_piglin', hostile: true, kind: 'monster', w: 0.6, h: 1.95, health: 20 },
  { key: 'ghast', hostile: true, kind: 'monster', w: 4, h: 4, health: 10 },
  { key: 'tnt', hostile: false, kind: 'object', w: 0.98, h: 0.98, health: 1 },
] as const;
export type MobKind = typeof MOB_TYPES[number]['kind'];
export type MobKey = typeof MOB_TYPES[number]['key'];
export const MOB = Object.fromEntries(MOB_TYPES.map((mob, index) => [mob.key, index])) as { readonly [K in MobKey]: number };
/** World AABB of a mob (babies are half size). */
export function mobBox(mob: Pick<PubMob, 't' | 'x' | 'y' | 'z' | 's'>): [number, number, number, number, number, number] {
  const type = MOB_TYPES[mob.t] ?? MOB_TYPES[0], scale = (mob.s ?? 0) & MS.BABY ? 0.5 : 1, half = type.w * scale / 2;
  return [mob.x - half, mob.y, mob.z - half, mob.x + half, mob.y + type.h * scale, mob.z + half];
}

export const q2 = (n: number) => Math.round(n * 100) / 100 + 0;
export const q3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

const MODES: readonly Mode[] = ['survival', 'creative'], DIFFICULTIES: readonly Difficulty[] = ['peaceful', 'easy', 'normal'];
const pick = <T>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;
/** Deterministic defaults: survival, seed 0 (random world), normal, keepInventory. */
export function validateSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const seed = typeof r.seed === 'number' && Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 999999 ? r.seed : 0;
  return { mode: pick(r.mode, MODES, 'survival'), seed, difficulty: pick(r.difficulty, DIFFICULTIES, 'normal'), keepInventory: typeof r.keepInventory === 'boolean' ? r.keepInventory : true };
}

export const neutralInput = (): Input => ({ p: [0, 0, 0], v: [0, 0, 0], yaw: 0, pitch: 0, f: IF.NO_POS, slot: 0, mine: null, tpAck: 0, cmds: [] });
export const parseAction = (): Action => ({ type: 'noop' });

const num = (value: unknown, min: number, max: number, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const int = (value: unknown, min: number, max: number): number | null => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
const vec = (value: unknown, limits: readonly [number, number][]): [number, number, number] | null => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  return value.map((v: number, i) => Math.min(limits[i]![1], Math.max(limits[i]![0], v))) as [number, number, number];
};
const POS: readonly [number, number][] = [[0, WORLD], [-64, HEIGHT + 64], [0, WORLD]], VEL: readonly [number, number][] = [[-100, 100], [-100, 100], [-100, 100]];
const CLICK_TARGETS: readonly ClickTarget[] = ['inv', 'grid', 'out', 'screen', 'armor'];
const SLOT_MAX = INVENTORY_SIZE - 1, COORD = WORLD - 1, ITEM_MAX = 1023, ID_MAX = 2 ** 31 - 1;

/** Parse one command; null when malformed. */
export function parseCmd(raw: unknown): Cmd | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>, n = int(r.n, 1, Number.MAX_SAFE_INTEGER);
  if (n === null) return null;
  const x = int(r.x, 0, COORD), y = int(r.y, 0, HEIGHT - 1), z = int(r.z, 0, COORD), face = int(r.face, 0, 5);
  const at = x !== null && y !== null && z !== null;
  switch (r.t) {
    case 'break': return at ? { n, t: 'break', x, y, z } : null;
    case 'place': {
      const slot = int(r.slot, 0, HOTBAR_SIZE - 1);
      if (!at || face === null || slot === null) return null;
      return typeof r.hy === 'number' && Number.isFinite(r.hy) ? { n, t: 'place', x, y, z, face, slot, hy: num(r.hy, 0, 1) } : { n, t: 'place', x, y, z, face, slot };
    }
    case 'use': return at && face !== null ? { n, t: 'use', x, y, z, face } : null;
    case 'useItem': { const slot = int(r.slot, 0, HOTBAR_SIZE - 1); return slot === null ? null : { n, t: 'useItem', slot }; }
    case 'attack': case 'interact': { const id = int(r.id, 0, ID_MAX); return id === null ? null : { n, t: r.t, id }; }
    case 'click': {
      const i = int(r.i, 0, 63), b = int(r.b, 0, 2);
      return i === null || b === null || !CLICK_TARGETS.includes(r.w as ClickTarget) ? null : { n, t: 'click', w: r.w as ClickTarget, i, b: b as 0 | 1 | 2 };
    }
    case 'craft': {
      if (typeof r.r !== 'string' || !/^[a-z0-9_:]{1,48}$/.test(r.r)) return null;
      return r.max === true ? { n, t: 'craft', r: r.r, max: true } : { n, t: 'craft', r: r.r };
    }
    case 'close': return { n, t: 'close' };
    case 'drop': { const slot = int(r.slot, 0, SLOT_MAX); return slot === null ? null : r.all === true ? { n, t: 'drop', slot, all: true } : { n, t: 'drop', slot }; }
    case 'respawn': return { n, t: 'respawn' };
    case 'wake': return { n, t: 'wake' };
    case 'creative': { const id = int(r.id, 1, ITEM_MAX), slot = int(r.slot, 0, SLOT_MAX); return id === null || slot === null ? null : { n, t: 'creative', id, slot }; }
    case 'trade': { const i = int(r.i, 0, 15); return i === null ? null : r.max === true ? { n, t: 'trade', i, max: true } : { n, t: 'trade', i }; }
    default: return null;
  }
}

/**
 * Tolerant input parser: never throws. Non-objects become neutral input; a missing/invalid position sets IF.NO_POS;
 * every field is clamped; malformed commands are dropped; commands are sorted by n, deduplicated and capped.
 */
export function parseInput(raw: unknown): Input {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return neutralInput();
  const r = raw as Record<string, unknown>, p = vec(r.p, POS);
  let f = int(r.f, 0, 127) ?? 0;
  if (!p) f |= IF.NO_POS;
  const mine = vec(r.mine, [[0, COORD], [0, HEIGHT - 1], [0, COORD]]);
  const seen = new Set<number>(), cmds: Cmd[] = [];
  if (Array.isArray(r.cmds)) for (const item of r.cmds.slice(0, MAX_CMDS * 2)) {
    const cmd = parseCmd(item);
    if (cmd && !seen.has(cmd.n)) { seen.add(cmd.n); cmds.push(cmd); }
  }
  cmds.sort((a, b) => a.n - b.n);
  return {
    p: p ?? [0, 0, 0], v: vec(r.v, VEL) ?? [0, 0, 0], yaw: wrapAngle(num(r.yaw, -1e6, 1e6)), pitch: num(r.pitch, -Math.PI / 2, Math.PI / 2), f,
    slot: int(r.slot, 0, HOTBAR_SIZE - 1) ?? 0, mine: mine && mine.every(Number.isInteger) ? mine : null, tpAck: int(r.tpAck, 0, ID_MAX) ?? 0,
    cmds: cmds.slice(0, MAX_CMDS),
  };
}
