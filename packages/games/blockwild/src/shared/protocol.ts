import { HEIGHT, HOTBAR_SIZE, INVENTORY_SIZE, MAX_CMDS, WORLD, type Dimension } from './constants';
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
  /** part: which of `mobBoxes(mob)` the crosshair hit (the dragon's head takes ×1.5); the server re-checks it. */
  | { t: 'attack'; id: number; part?: number }
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
  /** The newest `PrivateView.bag.rev` this client holds (absent or 0 = none): the server resends the bag until it matches. */
  bag?: number;
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
 * p: villager profession (0 farmer, 1 librarian, 2 armorer, 3 toolsmith, 4 cleric, 5 mason).
 * pt: pitch of flyers (radians, nose up > 0). ph: dragon phase (DRAGON_PHASE).
 */
export type PubMob = { id: number; t: number; x: number; y: number; z: number; yaw: number; hurt: number; a: number; s?: number; p?: number; pt?: number; ph?: number };
/** The Ender Dragon's `ph`. */
export const DRAGON_PHASE = { CIRCLING: 0, STRAFING: 1, LANDING: 2, PERCHED: 3, TAKING_OFF: 4, DYING: 5 } as const;
export type PubItem = { id: number; item: number; n: number; x: number; y: number; z: number };
/** Projectile kinds (`PubArrow.k`, omitted for arrows). Each moves in its owner's tick; `tickArrows` moves only arrows. */
export const PK = { ARROW: 0, GHAST_FIREBALL: 1, BLAZE_FIREBALL: 2, EYE: 3, DRAGON_FIREBALL: 4, PEARL: 5 } as const;
/** k: 1 ghast fireball, 2 small blaze fireball, 3 thrown eye of ender, 4 dragon fireball, 5 thrown ender pearl (PK). */
export type PubArrow = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; k?: number };
export const FX_KINDS = ['break', 'place', 'hit', 'explode', 'mob', 'hurtMob', 'die', 'pickup', 'eat', 'splash', 'bow', 'door', 'chest', 'furnace', 'craft', 'levelup',
  'portal', 'travel', 'ignite', 'fizz', 'lever', 'button', 'piston', 'tnt', 'trade', 'spawner', 'ghast', 'fireball', 'lamp',
  'eye', 'shatter', 'portalOpen', 'dragonDeath', 'acid', 'crystal', 'pearl', 'blazeShoot', 'scream', 'teleport', 'observer'] as const;
export type FxKind = typeof FX_KINDS[number];
/**
 * Monotonic id; clients play each once. a: cell value for break/place, mob type for mob; piston: the moved cells'
 * facing (0..5) + 8 × pushed count, so clients can animate the slide.
 * Endgame: 'eye' an eye inserted into a frame; 'shatter' a thrown eye breaking; 'portalOpen' an End portal lighting (at its
 * centre, loud within 64 blocks); 'dragonDeath' the death animation starting; 'acid' an acid cloud (a = radius); 'crystal'
 * a crystal destroyed; 'pearl' a pearl landing (the thrower arrives); 'blazeShoot' a blaze volley; 'scream' an enderman
 * provoked; 'teleport' an enderman or player vanishing/arriving here; 'observer' an observer pulse.
 */
export type Fx = { id: number; k: FxKind; x: number; y: number; z: number; a?: number };
/** World totals; `dragons` counts Ender Dragons slain (0 in worlds from before save v10). */
export type Stats = { mined: number; placed: number; crafted: number; mobs: number; deaths: number; days: number; dragons: number };
/** The boss bar: published while the dragon lives and a player is in the End (and briefly while it dies). */
export type BossView = { name: 'Ender Dragon'; health: number; max: number; crystals: number };
/** Set once the dragon falls, and saved: when, and who struck it (names; everyone in the End if nobody hit it lately). */
export type Victory = { day: number; tick: number; by: string[] };
/** One player's totals for the results journal (distance = blocks walked). */
export type JournalEntry = { id: string; mined: number; placed: number; crafted: number; mobs: number; deaths: number; distance: number };

/**
 * Entities on the wire are number tuples (see the encode/decode pairs below); `Scene` is what a screen draws after decoding.
 * p players, m mobs, i items, a arrows, f effects. A scene holds only what is near its viewer.
 */
export type WireScene = { p: number[][]; m: number[][]; i: number[][]; a: number[][]; f: number[][] };
export type Scene = { players: PubPlayer[]; mobs: PubMob[]; items: PubItem[]; arrows: PubArrow[]; fx: Fx[] };
/** A seat's identity; `View.who` lists every player of the round in seat order (the index is the seat number). */
export type Who = [id: string, name: string, color: string];
/** One player on the TV's roster: where they are and how they are doing, without the per-frame detail. */
export type RosterEntry = { seat: number; x: number; y: number; z: number; health: number; held: number; flags: number; armor: number };

export type View = {
  /** The real world seed (never 0) and a world identity that stays stable across saves and loads. */
  seed: number; worldId: string; mode: Mode; difficulty: Difficulty; time: number; day: number;
  /**
   * The edit journal in two tiers. `edits` is the consolidated journal and `revision` its revision (the snapshot cache
   * key, so it changes only when the server folds the tail in); `recent` holds what changed since as flat
   * [cellIndex, value, …] pairs (value −1: back to generated terrain) and `er` counts every change.
   */
  revision: number; edits: [number, number][]; recent: number[]; er: number;
  /** Seat identities (cached with `edits`): tuples everywhere else refer to players by seat. */
  who: Who[];
  /** Everyone's whereabouts as [seat, x, y, z, health, held, flags, armor points] (whole blocks), a few times a second. */
  roster?: number[][];
  /** The watching display's feed: what is around the player its camera follows (`focus` is a seat, −1 for nobody). */
  tv?: WireScene & { focus: number };
  /** Players currently in bed, and how many must be for the night to pass. */
  sleeping: number; sleepNeed: number;
  stats: Stats;
  /** Per-player totals, published once the dragon falls or the host finishes the session. */
  journal?: JournalEntry[];
  boss?: BossView;
  victory?: Victory;
};

export type ScreenKind = 'table' | 'furnace' | 'chest' | 'trade';
/** One villager offer: pay `buy` (+ `buyB`) from the inventory for `sell`; `left` uses remain until the next restock. */
export type TradeOffer = { buy: Slot; buyB?: Slot; sell: Slot; left: number };
/** The open screen. Trade screens have no slots; x, y, z is the villager's cell. */
export type Screen = {
  kind: ScreenKind; x: number; y: number; z: number; slots: (Slot | null)[]; burn?: number; burnMax?: number; cook?: number; cookMax?: number;
  offers?: TradeOffer[]; villager?: number; profession?: number;
};
/** Everything a player carries or has open. It is sent only while the client's `Input.bag` lags behind `rev`. */
export type Bag = {
  rev: number;
  /** 36 slots: 0..8 hotbar, 9..35 main. */
  inv: (Slot | null)[];
  cursor: Slot | null;
  /** 4 (2×2 inventory grid) or 9 (crafting table). */
  grid: (Slot | null)[];
  out: Slot | null;
  screen: Screen | null;
  /** Worn armor: head, chest, legs, feet. */
  armor: (Slot | null)[];
};
export type PrivateView = {
  ack: number;
  /** Server teleport, applied once per new n; `yaw` (portal arrivals) also turns the view. */
  tp: { n: number; x: number; y: number; z: number; yaw?: number };
  imp: { n: number; vx: number; vy: number; vz: number };
  /** The current bag revision, and the bag itself while this client has not confirmed it. */
  bagRev: number; bag?: Bag;
  /** What is around this player (the player's own tuple included), in the snapshots that carry a scene (`nearEvery`). */
  near?: WireScene;
  health: number; food: number; saturation: number;
  /** 0..300 ticks. */
  air: number;
  dead: boolean; deathMessage?: string;
  toast?: { n: number; text: string };
  mode: Mode; keepInventory: boolean;
  /** Spawn/respawn protection ticks remaining (no damage, hostiles ignore you); omitted when 0. */
  protectedTicks?: number;
  /** Sum of worn armor points (0..20). */
  armorPoints: number;
  /** Burning ticks left; omitted at 0. */
  burning?: number;
  /** Portal charge 0..1 while standing in a nether portal; omitted at 0. */
  portal?: number;
  dimension: Dimension;
};

/**
 * Mob types; `t` in PubMob indexes this list (append only). w/h = AABB width/height in blocks. `kind`: monsters are
 * hostile (despawn, cap, peaceful removal, block sleep; zombified piglins and endermen are monsters that wait to be
 * provoked), animals are saved with the world, villagers are saved in their own list, objects (primed TNT, end crystals)
 * are neither, and the boss (the Ender Dragon) never despawns, thinks wherever it is and is saved by sim/end.ts.
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
  { key: 'blaze', hostile: true, kind: 'monster', w: 0.6, h: 1.8, health: 20 },
  { key: 'enderman', hostile: true, kind: 'monster', w: 0.6, h: 2.9, health: 40 },
  { key: 'ender_dragon', hostile: false, kind: 'boss', w: 8, h: 4, health: 200 },
  { key: 'end_crystal', hostile: false, kind: 'object', w: 2, h: 2, health: 1 },
  { key: 'silverfish', hostile: true, kind: 'monster', w: 0.4, h: 0.3, health: 8 },
] as const;
export type MobKind = typeof MOB_TYPES[number]['kind'];
export type MobKey = typeof MOB_TYPES[number]['key'];
export const MOB = Object.fromEntries(MOB_TYPES.map((mob, index) => [mob.key, index])) as { readonly [K in MobKey]: number };
/** World AABB of a mob (babies are half size). */
export function mobBox(mob: Pick<PubMob, 't' | 'x' | 'y' | 'z' | 's'>): [number, number, number, number, number, number] {
  const type = MOB_TYPES[mob.t] ?? MOB_TYPES[0], scale = (mob.s ?? 0) & MS.BABY ? 0.5 : 1, half = type.w * scale / 2;
  return [mob.x - half, mob.y, mob.z - half, mob.x + half, mob.y + type.h * scale, mob.z + half];
}

export type MobBox = [number, number, number, number, number, number];
/**
 * The Ender Dragon's hit boxes in `mobBoxes` order (`attack.part` indexes them): [forward, right, up] offset of the centre
 * from the body's centre in the dragon's frame, then half width and half height. Parts follow yaw; the head, neck and
 * tail also follow pitch (`pt`). The head takes ×1.5 damage.
 */
export const DRAGON_PARTS = [
  { key: 'head', at: [10, 0, 0.5], w: 1.5, h: 1.25 }, { key: 'neck', at: [6.5, 0, 0.25], w: 1.5, h: 1.5 }, { key: 'body', at: [0, 0, 0], w: 4, h: 2 },
  { key: 'wing_left', at: [0, -8, 0.75], w: 4, h: 0.75 }, { key: 'wing_right', at: [0, 8, 0.75], w: 4, h: 0.75 },
  { key: 'tail_0', at: [-5.5, 0, 0], w: 1.25, h: 1.25 }, { key: 'tail_1', at: [-8, 0, 0], w: 1, h: 1 }, { key: 'tail_2', at: [-10.5, 0, 0], w: 0.75, h: 0.75 },
] as const;
export const DRAGON_HEAD = 0;
/**
 * Every hit box of a mob as world AABBs: one (mobBox) for normal mobs; the dragon's eight posed parts (DRAGON_PARTS), whose
 * body box is centred 2 blocks above the dragon's position. Client targeting and server hits both test all of them.
 */
export function mobBoxes(mob: Pick<PubMob, 't' | 'x' | 'y' | 'z' | 's' | 'yaw' | 'pt'>): MobBox[] {
  if (mob.t !== MOB.ender_dragon) return [mobBox(mob)];
  const pitch = mob.pt ?? 0, sin = Math.sin(mob.yaw), cos = Math.cos(mob.yaw), flat = Math.cos(pitch), rise = Math.sin(pitch), cy = mob.y + 2;
  return DRAGON_PARTS.map(({ at: [f, r, u], w, h }) => {
    // Forward (-sin, 0, -cos) tilted by pitch for the spine; right (cos, 0, -sin) stays level (wings bank with yaw only).
    const x = mob.x - sin * f * flat + cos * r, y = cy + (r ? 0 : f * rise) + u, z = mob.z - cos * f * flat - sin * r;
    return [x - w, y - h, z - w, x + w, y + h, z + w];
  });
}

export const q2 = (n: number) => Math.round(n * 100) / 100 + 0;
export const q3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/**
 * Wire tuples. Positions keep 2 decimals, angles 2 (about half a degree). Counters wrap at 256 (clients only test for change).
 * Player: [seat, x, y, z, yaw, pitch, held, swing, hurt, health, flags] (+ 4 worn armor ids, + mine x, y, z, stage).
 * Mob: [id, t, x, y, z, yaw, hurt, a, s, p, pt, ph], trailing zeros dropped. Item: [id, item, n, x, y, z].
 * Arrow: [id, x, y, z, vx, vy, vz, k] (k dropped for arrows). Effect: [id, kind index, x, y, z, a?].
 */
const trim = (tuple: number[], min: number) => {
  let length = tuple.length;
  while (length > min && !tuple[length - 1]) length--;
  tuple.length = length;
  return tuple;
};
export function encodePlayer(seat: number, p: Omit<PubPlayer, 'id' | 'name' | 'color'>): number[] {
  const tuple = [seat, q2(p.x), q2(p.y), q2(p.z), q2(p.yaw), q2(p.pitch), p.held, p.swing & 255, p.hurt & 255, q2(p.health), p.flags];
  const worn = p.armor.some(Boolean);
  if (worn || p.mine) tuple.push(...p.armor);
  if (p.mine) tuple.push(...p.mine);
  return tuple;
}
const NOBODY: Who = ['', 'Explorer', '#ffffff'];
export function decodePlayer(t: readonly number[], who: readonly Who[]): PubPlayer {
  const [id, name, color] = who[t[0]!] ?? NOBODY;
  const player: PubPlayer = {
    id: id || `seat-${t[0]}`, name, color, x: t[1]!, y: t[2]!, z: t[3]!, yaw: t[4]!, pitch: t[5]!, held: t[6]!, swing: t[7]!, hurt: t[8]!, health: t[9]!, flags: t[10]!,
    armor: [t[11] ?? 0, t[12] ?? 0, t[13] ?? 0, t[14] ?? 0],
  };
  if (t.length >= 19) player.mine = [t[15]!, t[16]!, t[17]!, t[18]!];
  return player;
}
export const encodeMob = (m: PubMob): number[] => trim([m.id, m.t, q2(m.x), q2(m.y), q2(m.z), q2(m.yaw), m.hurt & 255, m.a, m.s ?? 0, m.p ?? 0, q2(m.pt ?? 0), m.ph ?? 0], 8);
export function decodeMob(t: readonly number[]): PubMob {
  const mob: PubMob = { id: t[0]!, t: t[1]!, x: t[2]!, y: t[3]!, z: t[4]!, yaw: t[5]!, hurt: t[6]!, a: t[7]! };
  if (t[8]) mob.s = t[8];
  if (t[9] || t[1] === MOB.villager) mob.p = t[9] ?? 0;
  if (t[10]) mob.pt = t[10];
  if (t[11] || t[1] === MOB.ender_dragon) mob.ph = t[11] ?? 0;
  return mob;
}
export const encodeItem = (i: PubItem): number[] => [i.id, i.item, i.n, q2(i.x), q2(i.y), q2(i.z)];
export const decodeItem = (t: readonly number[]): PubItem => ({ id: t[0]!, item: t[1]!, n: t[2]!, x: t[3]!, y: t[4]!, z: t[5]! });
export const encodeArrow = (a: PubArrow): number[] => trim([a.id, q2(a.x), q2(a.y), q2(a.z), q2(a.vx), q2(a.vy), q2(a.vz), a.k ?? 0], 7);
export function decodeArrow(t: readonly number[]): PubArrow {
  const arrow: PubArrow = { id: t[0]!, x: t[1]!, y: t[2]!, z: t[3]!, vx: t[4]!, vy: t[5]!, vz: t[6]! };
  if (t[7]) arrow.k = t[7];
  return arrow;
}
export const encodeFx = (fx: Fx): number[] => fx.a === undefined ? [fx.id, FX_KINDS.indexOf(fx.k), fx.x, fx.y, fx.z] : [fx.id, FX_KINDS.indexOf(fx.k), fx.x, fx.y, fx.z, fx.a];
export function decodeFx(t: readonly number[]): Fx {
  const fx: Fx = { id: t[0]!, k: FX_KINDS[t[1]!] ?? 'hit', x: t[2]!, y: t[3]!, z: t[4]! };
  if (t.length > 5) fx.a = t[5]!;
  return fx;
}
export const decodeScene = (wire: WireScene, who: readonly Who[]): Scene =>
  ({ players: wire.p.map(t => decodePlayer(t, who)), mobs: wire.m.map(decodeMob), items: wire.i.map(decodeItem), arrows: wire.a.map(decodeArrow), fx: wire.f.map(decodeFx) });
/**
 * Snapshots between entity feeds. Rooms of up to 16 get a scene in every snapshot; bigger rooms get one in every
 * second snapshot (seats take turns, so the work and the traffic stay even) and draw a little further behind.
 */
export const nearEvery = (players: number) => players <= 16 ? 1 : 2;
/** Snapshots between the watching display's feeds, and between roster updates: live in small rooms, a few a second in big ones. */
export const tvEvery = (players: number) => players <= 8 ? 1 : players <= 16 ? 2 : 4;
export const rosterEvery = (players: number) => players <= 10 ? 4 : 10;
export const encodeRoster = (e: RosterEntry): number[] => [e.seat, Math.round(e.x), Math.round(e.y), Math.round(e.z), Math.ceil(e.health), e.held, e.flags, e.armor];
/** Seat identities as objects (id, name, colour). */
export const seatsOf = (who: readonly Who[]) => who.map(([id, name, color]) => ({ id, name, color }));
export const decodeRoster = (t: readonly number[]): RosterEntry => ({ seat: t[0]!, x: t[1]!, y: t[2]!, z: t[3]!, health: t[4]!, held: t[5]!, flags: t[6]!, armor: t[7]! });

const MODES: readonly Mode[] = ['survival', 'creative'], DIFFICULTIES: readonly Difficulty[] = ['peaceful', 'easy', 'normal'];
const pick = <T>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;
/** Deterministic defaults: survival, seed 0 (random world), normal, keepInventory. */
export function validateSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const seed = typeof r.seed === 'number' && Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 999999 ? r.seed : 0;
  return { mode: pick(r.mode, MODES, 'survival'), seed, difficulty: pick(r.difficulty, DIFFICULTIES, 'normal'), keepInventory: typeof r.keepInventory === 'boolean' ? r.keepInventory : true };
}

export const neutralInput = (): Input => ({ p: [0, 0, 0], v: [0, 0, 0], yaw: 0, pitch: 0, f: IF.NO_POS, slot: 0, mine: null, tpAck: 0, cmds: [], bag: 0 });
export const parseAction = (): Action => ({ type: 'noop' });

const num = (value: unknown, min: number, max: number, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const int = (value: unknown, min: number, max: number): number | null => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
const vec = (value: unknown, limits: readonly [number, number][]): [number, number, number] | null => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  return value.map((v: number, i) => Math.min(limits[i]![1], Math.max(limits[i]![0], v))) as [number, number, number];
};
const POS: readonly [number, number][] = [[0, WORLD], [-192, HEIGHT + 64], [0, WORLD]], VEL: readonly [number, number][] = [[-100, 100], [-100, 100], [-100, 100]];
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
    case 'attack': {
      const id = int(r.id, 0, ID_MAX), part = int(r.part, 0, DRAGON_PARTS.length - 1);
      return id === null ? null : part === null ? { n, t: 'attack', id } : { n, t: 'attack', id, part };
    }
    case 'interact': { const id = int(r.id, 0, ID_MAX); return id === null ? null : { n, t: 'interact', id }; }
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
    cmds: cmds.slice(0, MAX_CMDS), bag: int(r.bag, 0, ID_MAX) ?? 0,
  };
}
