/** Server-only game state: types, construction and small shared helpers. */
import type { RoundContext } from '../../../../party-contract/src/index';
import type { CellReader, ChunkSource, VoxelWorld } from '../shared/chunk';
import type { Vec3 } from '../shared/coords';
import type { Slot } from '../shared/items';
import { q2, type Fx, type FxKind, type ScreenKind, type Settings, type Stats } from '../shared/protocol';
import type { FireState } from './fire';
import type { NetherState } from './nether-mobs';
import type { PortalState } from './portals';
import type { RedstoneState } from './redstone';
import type { StructureState } from './structures';
import type { VillageState } from './villagers';

export type PlayerStats = { mined: number; placed: number; crafted: number; mobs: number; deaths: number; distance: number };
/** An open screen at a block (or, for 'trade', at the villager's cell with its mob id). */
export type OpenScreen = { kind: ScreenKind; x: number; y: number; z: number; villager?: number };
/** Why a player takes damage: armor reduces the combat and heat causes (see sim/armor.ts), never fall/drown/starve/magma. */
export type DamageCause = 'mob' | 'arrow' | 'fireball' | 'explosion' | 'cactus' | 'fire' | 'lava' | 'fall' | 'drown' | 'starve' | 'magma' | 'other';

export type Player = {
  id: string; name: string; color: string; connected: boolean;
  /** Last accepted position and look. */
  x: number; y: number; z: number; yaw: number; pitch: number;
  sneaking: boolean; flying: boolean; slot: number; onGround: boolean; inWater: boolean; eyeInWater: boolean;
  /**
   * Movement validation: the last accepted position moved at `movedAt` (sim seconds). Horizontal moves spend
   * `walkBudget` (metres, refilled over time); survival players cannot rise more than a jump above `supportY`,
   * the height they last stood, swam, climbed or flew at.
   */
  movedAt: number; walkBudget: number; supportY: number;
  /** Extra movement allowance from server impulses, valid until `slackUntil`. */
  slack: number; slackUntil: number;
  tp: { n: number; x: number; y: number; z: number; yaw?: number };
  imp: { n: number; vx: number; vy: number; vz: number };
  /** Highest y since last supported (fall damage). */
  fallPeak: number;
  health: number; food: number; saturation: number; exhaustion: number; air: number;
  regenAt: number; starveAt: number; drownAt: number;
  /** Damage invulnerability until this time; `lastDamage` is the hit that started it (MC: only bigger hits land). */
  invulnUntil: number; lastDamage: number;
  /** Spawn/respawn protection until this time: no damage and hostiles ignore the player. */
  protectedUntil: number;
  dead: boolean; deathMessage: string;
  /** Bed cell (foot or head) or null; respawn uses it while the bed exists. */
  bed: Vec3 | null;
  sleeping: boolean; sleepSince: number;
  inv: (Slot | null)[]; cursor: Slot | null; grid: (Slot | null)[]; out: Slot | null; screen: OpenScreen | null;
  /** Worn armor: head, chest, legs, feet. */
  armor: (Slot | null)[];
  /** Seconds of burning left (fire.ts). */
  fire: number;
  /** Portal charge 0..1 while standing in a portal; `portalLock` blocks re-entry until the player steps out (portals.ts). */
  portal: number; portalLock: boolean;
  ack: number;
  /** Block being mined and when mining started. */
  mine: { x: number; y: number; z: number; start: number } | null;
  /** Creative instant-break token bucket (5/s). */
  breakTokens: number;
  attackAt: number;
  /** When the current USING hold started (eating / drawing a bow), or -1. */
  useStart: number;
  swing: number; hurt: number; swingAt: number;
  toast: { n: number; text: string } | null;
  stats: PlayerStats;
  /** Bitmask of one-off milestones already celebrated (first tool of each tier...). */
  milestones: number;
};

export type Mob = {
  id: number; t: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number;
  health: number; onGround: boolean; inWater: boolean; fallPeak: number;
  hurt: number; invulnUntil: number; lastDamage: number;
  /** Animation: 0 idle, 1 walk, 2 attack (until attackUntil), 3 fuse / charging. */
  a: number; attackUntil: number;
  /** Seconds until a baby grows up (0 = adult). */
  baby: number; sheared: boolean;
  target: string | null; aggroUntil: number; thinkAt: number;
  /** Current path waypoints (cell coordinates) and the next index. */
  path: Vec3[] | null; pathIndex: number; repathAt: number; goal: Vec3 | null;
  stuck: number; lastX: number; lastZ: number;
  fuse: number; cooldown: number; charge: number;
  panicUntil: number; loveUntil: number; breedAt: number; eggAt: number; ambientAt: number;
  /** Seconds of burning left from daylight (zombies, skeletons), fire, lava or fireballs (fire.ts). */
  fire: number;
  /** Animals and villagers persist; monsters despawn. */
  persistent: boolean;
  /** Stable random 31-bit seed (saved for villagers: their offers derive from it). */
  seed: number;
  /** Villagers: profession (PubMob.p), home bed cell and uses per offer. */
  p: number; home: Vec3 | null; uses: number[];
  /** A mob this monster hunts when it has no player target (zombies chasing villagers), by id. */
  prey: number | null;
};

export type ItemEntity = {
  id: number; item: number; n: number; d?: number; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; pickupAt: number; owner: string | null; ownerAt: number; onGround: boolean; resting: boolean;
};
export type Arrow = {
  id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; stuck: boolean;
  damage: number; shooter: string | number | null; pickup: boolean;
  /** 0 arrow, 1 ghast fireball (moved by nether-mobs.ts tickFireballs, skipped by tickArrows). */
  k: number;
};
export type Furnace = { slots: (Slot | null)[]; burn: number; burnMax: number; cook: number };
type FxEntry = { fx: Fx; at: number };

export type State = {
  /** Settings with the real seed (a random-world seed 0 is resolved at creation). */
  settings: Settings; world: VoxelWorld;
  /** Stable world identity across saves and loads. */
  worldId: string;
  /** Fast cell reader (generates missing chunks). */
  get: CellReader;
  /** Cell reader that returns barrier for chunks that are not loaded (AI, spawning). */
  getLoaded: CellReader;
  rand: () => number;
  /** Sim seconds since the round started. */
  clock: number;
  /** Day time in ticks (0..DAY_TICKS, fractional) and the day counter. */
  time: number; day: number;
  /** Bumped on every edit change (snapshot cache key). */
  revision: number;
  players: Player[]; mobs: Mob[]; items: ItemEntity[]; arrows: Arrow[]; fx: FxEntry[];
  nextId: number; fxId: number;
  chests: Map<number, (Slot | null)[]>; furnaces: Map<number, Furnace>;
  /** Light sources by chunk key → cell index → emission: player edits plus worldgen torches and lit furnaces (structures.onChunkGenerated). */
  lights: Map<number, Map<number, number>>;
  /** Cells that receive growth ticks (crops, saplings, sugar cane, farmland). */
  growables: Set<number>;
  /** Chunks already populated with animals. */
  animalChunks: Set<number>;
  spawn: Vec3; stats: Stats; finished: boolean; ticks: number;
  /** Remaining A* node budget this tick. */
  pathBudget: number;
  editsCache: { revision: number; list: [number, number][] };
  source: ChunkSource;
  /** Saved players who are not in this session: kept so their inventories survive the next save. */
  absent: SavedPlayerState[];
  /** Per-feature server state, each owned and shaped by its module (created with the world, not saved unless noted there). */
  structures: StructureState; portals: PortalState; fire: FireState; nether: NetherState; redstone: RedstoneState; villages: VillageState;
};
/** A player as stored in a save, in live shapes. */
export type SavedPlayerState = {
  name: string; x: number; y: number; z: number; yaw: number; pitch: number; health: number; food: number; saturation: number;
  inv: (Slot | null)[]; armor: (Slot | null)[]; bed: Vec3 | null; stats: PlayerStats; milestones: number;
};

export type NewGame = { ctx: RoundContext; settings: Settings; source?: ChunkSource };

export function nextId(state: State) { return ++state.nextId; }
export const playerById = (state: State, id: string) => state.players.find(player => player.id === id);
export function addFx(state: State, k: FxKind, x: number, y: number, z: number, a?: number) {
  const fx: Fx = a === undefined ? { id: ++state.fxId, k, x: q2(x), y: q2(y), z: q2(z) } : { id: ++state.fxId, k, x: q2(x), y: q2(y), z: q2(z), a };
  state.fx.push({ fx, at: state.clock });
  if (state.fx.length > 64) state.fx.shift();
}
/** Drop effects older than 1.5 s. */
export function pruneFx(state: State) {
  while (state.fx.length && state.clock - state.fx[0]!.at > 1.5) state.fx.shift();
}
export const fxList = (state: State): Fx[] => state.fx.map(entry => entry.fx);
export function toast(player: Player, text: string) { player.toast = { n: (player.toast?.n ?? 0) + 1, text }; }
/** Players who count for sleeping, spawning and AI targets. */
export const activePlayers = (state: State) => state.players.filter(player => player.connected && !player.dead);
export const dist2 = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
/** Squared distance from a point to the nearest point of a world box. */
export function boxDist2(px: number, py: number, pz: number, box: readonly number[]): number {
  const dx = Math.max(box[0]! - px, 0, px - box[3]!), dy = Math.max(box[1]! - py, 0, py - box[4]!), dz = Math.max(box[2]! - pz, 0, pz - box[5]!);
  return dx * dx + dy * dy + dz * dz;
}
/** Seconds of spawn/respawn protection. */
export const PROTECT_SECONDS = 5;
export const isProtected = (state: State, player: Player) => state.clock < player.protectedUntil;
export const isNight = (time: number) => time >= 13000 && time < 23000;
/** Beds work from dusk until dawn (MC 12542..23459). */
export const canSleep = (time: number) => time >= 12542 && time < 23460;
