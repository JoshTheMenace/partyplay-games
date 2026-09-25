/**
 * World saves (format version 9). Edits are packed little-endian
 * (uint32 cell index, uint16 value) and base64 encoded; slots are compact [index, id, n, d?] tuples. `parseSave`
 * validates everything and throws a readable message.
 */
import { B, BLOCKS, cellId } from '../shared/blocks';
import { CHEST_SIZE, DAY_TICKS, EDIT_LIMIT, HEIGHT, INVENTORY_SIZE, MAX_FOOD, MAX_HEALTH, WORLD } from '../shared/constants';
import { isCellIndex, type Vec3 } from '../shared/coords';
import { emptySlots } from '../shared/inventory';
import { armorOf, durabilityOf, isItem, maxStack, type Slot } from '../shared/items';
import { MOB_TYPES, MS, q2, q3, validateSettings, type Settings, type Stats } from '../shared/protocol';
import { PROFESSIONS } from '../shared/trades';
import { MAX_CHESTS, MAX_FURNACES } from './containers';
import type { Furnace, PlayerStats, SavedPlayerState } from './state';

export const SAVE_VERSION = 9;
/**
 * Oldest version that still loads. Edits only record differences from generated terrain, so a world saved before the
 * expansion generator (version 8) would silently grow lava caves and structures through its builds: it is refused.
 */
const MIN_VERSION = 9;
export const OLD_SAVE_MESSAGE = 'This world was made with the previous version of Blockwild and cannot be loaded.';
const MAX_SAVED_PLAYERS = 24, MAX_SAVED_ANIMALS = 48, CHUNK_BITS = (WORLD / 16) ** 2;
export const MAX_SAVED_VILLAGERS = 64;
const MAX_OFFERS = 8;

/** [slot index, item id, count] or [slot index, item id, count, damage]. */
export type SlotTuple = [number, number, number] | [number, number, number, number];
export type SavedPlayer = {
  name: string; x: number; y: number; z: number; yaw: number; pitch: number; health: number; food: number; saturation: number;
  inv: SlotTuple[];
  /** Worn armor (slot 0 head .. 3 feet); absent means none. */
  armor?: SlotTuple[];
  /** Bed cell used as the respawn point, or null for the world spawn. */
  spawn: Vec3 | null;
  stats: PlayerStats; milestones: number;
};
export type SavedFurnace = { i: number; slots: SlotTuple[]; burn: number; burnMax: number; cook: number };
export type SavedAnimal = { t: number; x: number; y: number; z: number; s: number };
/** A villager: profession, home bed cell (if any), uses per offer and the seed its offers derive from. */
export type SavedVillager = { x: number; y: number; z: number; p: number; home?: Vec3; uses: number[]; seed: number };
/** A villager in live shapes (home null when it has none). */
export type VillagerState = Omit<SavedVillager, 'home'> & { home: Vec3 | null };
export type SaveData = {
  format: 'blockwild'; version: 9; seed: number;
  /** Stable world identity (derived from the seed when missing). */
  worldId: string; mode: Settings['mode']; difficulty: Settings['difficulty']; keepInventory: boolean;
  time: number; day: number; edits: string;
  players: SavedPlayer[]; chests: { i: number; slots: SlotTuple[] }[]; furnaces: SavedFurnace[]; animals: SavedAnimal[]; villagers: SavedVillager[];
  /** Base64 bitset of chunks whose animals were already rolled (so loading does not repopulate them). */
  populated: string; stats: Stats;
};
/** Validated save contents in live-state shapes. */
export type ParsedSave = {
  settings: Settings; worldId: string; time: number; day: number; edits: Map<number, number>;
  players: SavedPlayerState[];
  chests: Map<number, (Slot | null)[]>; furnaces: Map<number, Furnace>; animals: SavedAnimal[]; villagers: VillagerState[]; populated: Set<number>; stats: Stats;
};
/** What exportSave reads from the live state (kept structural so this module stays independent of the tick code). */
export type SaveSource = {
  settings: Settings; worldId: string; time: number; day: number; edits: ReadonlyMap<number, number>;
  /** Session players first, then remembered absent ones; at most MAX_SAVED_PLAYERS are written. */
  players: readonly (SavedPlayerState & { dead?: boolean })[];
  chests: ReadonlyMap<number, readonly (Slot | null)[]>; furnaces: ReadonlyMap<number, Furnace>;
  animals: readonly SavedAnimal[]; villagers: readonly VillagerState[]; populated: ReadonlySet<number>; stats: Stats;
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

export function packEdits(edits: ReadonlyMap<number, number>): string {
  const bytes = new Uint8Array(edits.size * 6), view = new DataView(bytes.buffer);
  let offset = 0;
  for (const index of [...edits.keys()].sort((a, b) => a - b)) {
    view.setUint32(offset, index, true);
    view.setUint16(offset + 4, edits.get(index)!, true);
    offset += 6;
  }
  return toBase64(bytes);
}
export function unpackEdits(text: string): Map<number, number> {
  const bytes = fromBase64(text);
  if (bytes.length % 6 || bytes.length / 6 > EDIT_LIMIT) throw invalid('edits');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), edits = new Map<number, number>();
  for (let offset = 0; offset < bytes.length; offset += 6) {
    const index = view.getUint32(offset, true), value = view.getUint16(offset + 4, true), block = BLOCKS[cellId(value)];
    if (!isCellIndex(index) || edits.has(index) || !block || block.id === B.barrier) throw invalid('edits');
    edits.set(index, value);
  }
  return edits;
}

const packSlots = (slots: readonly (Slot | null)[]): SlotTuple[] =>
  slots.flatMap((slot, i): SlotTuple[] => !slot ? [] : slot.d ? [[i, slot.id, slot.n, slot.d]] : [[i, slot.id, slot.n]]);
const packBits = (keys: ReadonlySet<number>) => {
  const bytes = new Uint8Array(CHUNK_BITS / 8);
  for (const key of keys) if (key >= 0 && key < CHUNK_BITS) bytes[key >> 3]! |= 1 << (key & 7);
  return toBase64(bytes);
};

export function exportSave(source: SaveSource): SaveData {
  const { settings } = source;
  return {
    format: 'blockwild', version: SAVE_VERSION, seed: settings.seed, worldId: source.worldId, mode: settings.mode, difficulty: settings.difficulty, keepInventory: settings.keepInventory,
    time: Math.floor(source.time), day: source.day, edits: packEdits(source.edits),
    players: source.players.slice(0, MAX_SAVED_PLAYERS).map(p => ({
      name: p.name, x: q2(p.x), y: q2(p.y), z: q2(p.z), yaw: q3(p.yaw), pitch: q3(p.pitch),
      // Dead players come back at full health (respawned on load); their items were already dropped or kept.
      // Armor makes health fractional: a sliver of health still loads (at least half a heart).
      health: p.dead ? MAX_HEALTH : Math.max(0.5, q2(p.health)), food: p.dead ? MAX_FOOD : p.food, saturation: q2(p.dead ? 5 : p.saturation),
      inv: packSlots(p.inv), armor: packSlots(p.armor), spawn: p.bed ? [...p.bed] : null, stats: { ...p.stats, distance: Math.round(p.stats.distance) }, milestones: p.milestones,
    })),
    chests: [...source.chests].map(([i, slots]) => ({ i, slots: packSlots(slots) })),
    furnaces: [...source.furnaces].map(([i, f]) => ({ i, slots: packSlots(f.slots), burn: q2(f.burn), burnMax: q2(f.burnMax), cook: q2(f.cook) })),
    animals: source.animals.slice(0, MAX_SAVED_ANIMALS).map(a => ({ t: a.t, x: q2(a.x), y: q2(a.y), z: q2(a.z), s: a.s })),
    villagers: source.villagers.slice(0, MAX_SAVED_VILLAGERS).map(v => {
      const saved: SavedVillager = { x: q2(v.x), y: q2(v.y), z: q2(v.z), p: v.p, uses: v.uses.slice(0, MAX_OFFERS), seed: v.seed };
      if (v.home) saved.home = [...v.home];
      return saved;
    }),
    populated: packBits(source.populated), stats: { ...source.stats },
  };
}

function invalid(what: string) { return new Error(`This Blockwild save is damaged (${what}).`); }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function number(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid(what);
  return value;
}
const integer = (value: unknown, min: number, max: number, what: string) => {
  const n = number(value, min, max, what);
  if (!Number.isInteger(n)) throw invalid(what);
  return n;
};
function list(value: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid(what);
  return value;
}
function slots(value: unknown, size: number, what: string): (Slot | null)[] {
  const out = emptySlots(size);
  for (const raw of list(value, size, what)) {
    const tuple = list(raw, 4, what);
    if (tuple.length < 3) throw invalid(what);
    const i = integer(tuple[0], 0, size - 1, what), id = integer(tuple[1], 1, 65535, what);
    if (!isItem(id) || out[i]) throw invalid(what);
    const n = integer(tuple[2], 1, maxStack(id), what), d = tuple.length === 4 ? integer(tuple[3], 1, Math.max(1, durabilityOf(id) - 1), what) : 0;
    if (d && !durabilityOf(id)) throw invalid(what);
    out[i] = d ? { id, n, d } : { id, n };
  }
  return out;
}
const vec3 = (value: unknown, what: string): Vec3 => {
  const v = list(value, 3, what);
  if (v.length !== 3) throw invalid(what);
  return [integer(v[0], 0, WORLD - 1, what), integer(v[1], 0, HEIGHT - 1, what), integer(v[2], 0, WORLD - 1, what)];
};
const STAT_KEYS = ['mined', 'placed', 'crafted', 'mobs', 'deaths', 'days'] as const;
const PLAYER_STAT_KEYS = ['mined', 'placed', 'crafted', 'mobs', 'deaths', 'distance'] as const;
function statsOf<K extends string>(value: unknown, keys: readonly K[]): Record<K, number> {
  if (!isObject(value)) throw invalid('stats');
  return Object.fromEntries(keys.map(key => [key, integer(value[key], 0, 1e12, 'stats')])) as Record<K, number>;
}
/** A container cell is either an edit of that block or unedited (a worldgen chest or furnace; createState checks the terrain). */
const placedOrGenerated = (edits: ReadonlyMap<number, number>, index: number, block: number) => !edits.has(index) || cellId(edits.get(index)!) === block;

/** Validate a raw save; throws a player-facing message. Never touches live state. */
export function parseSave(raw: unknown): ParsedSave {
  if (!isObject(raw) || raw.format !== 'blockwild') throw new Error('This is not a Blockwild world save.');
  if (typeof raw.version !== 'number' || raw.version < MIN_VERSION) throw new Error(OLD_SAVE_MESSAGE);
  if (raw.version > SAVE_VERSION) throw new Error('This world was saved by a newer version of Blockwild.');
  const settings = validateSettings(raw);
  if (settings.seed < 1 || settings.seed !== raw.seed || settings.mode !== raw.mode || settings.difficulty !== raw.difficulty || settings.keepInventory !== raw.keepInventory) throw invalid('settings');
  if (raw.worldId !== undefined && (typeof raw.worldId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(raw.worldId))) throw invalid('settings');
  if (typeof raw.edits !== 'string' || typeof raw.populated !== 'string') throw invalid('edits');
  const edits = unpackEdits(raw.edits);

  const players = list(raw.players, MAX_SAVED_PLAYERS, 'players').map(value => {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length > 64) throw invalid('players');
    return {
      name: value.name, x: number(value.x, 0, WORLD, 'players'), y: number(value.y, -64, HEIGHT + 64, 'players'), z: number(value.z, 0, WORLD, 'players'),
      yaw: number(value.yaw, -10, 10, 'players'), pitch: number(value.pitch, -2, 2, 'players'),
      health: number(value.health, 0.5, MAX_HEALTH, 'players'), food: integer(value.food, 0, MAX_FOOD, 'players'), saturation: number(value.saturation, 0, MAX_FOOD, 'players'),
      inv: slots(value.inv, INVENTORY_SIZE, 'inventory'), armor: armorSlots(value.armor), bed: value.spawn === null ? null : vec3(value.spawn, 'spawn'),
      stats: statsOf(value.stats, PLAYER_STAT_KEYS), milestones: integer(value.milestones, 0, 2 ** 30, 'players'),
    };
  });
  const chests = new Map<number, (Slot | null)[]>();
  for (const value of list(raw.chests, MAX_CHESTS, 'chests')) {
    if (!isObject(value)) throw invalid('chests');
    const i = integer(value.i, 0, 2 ** 31, 'chests');
    if (chests.has(i) || !placedOrGenerated(edits, i, B.chest)) throw invalid('chests');
    chests.set(i, slots(value.slots, CHEST_SIZE, 'chests'));
  }
  const furnaces = new Map<number, Furnace>();
  for (const value of list(raw.furnaces, MAX_FURNACES, 'furnaces')) {
    if (!isObject(value)) throw invalid('furnaces');
    const i = integer(value.i, 0, 2 ** 31, 'furnaces');
    if (furnaces.has(i) || !placedOrGenerated(edits, i, B.furnace) && !placedOrGenerated(edits, i, B.furnace_lit)) throw invalid('furnaces');
    const burnMax = number(value.burnMax, 0, 1000, 'furnaces');
    furnaces.set(i, { slots: slots(value.slots, 3, 'furnaces'), burn: number(value.burn, 0, burnMax, 'furnaces'), burnMax, cook: number(value.cook, 0, 10, 'furnaces') });
  }
  const animals = list(raw.animals, MAX_SAVED_ANIMALS, 'animals').map(value => {
    if (!isObject(value)) throw invalid('animals');
    const t = integer(value.t, 0, MOB_TYPES.length - 1, 'animals');
    if (MOB_TYPES[t]!.hostile) throw invalid('animals');
    return { t, x: number(value.x, 0, WORLD, 'animals'), y: number(value.y, 0, HEIGHT, 'animals'), z: number(value.z, 0, WORLD, 'animals'), s: integer(value.s, 0, MS.SHEARED | MS.BABY, 'animals') };
  });
  const villagers = list(raw.villagers, MAX_SAVED_VILLAGERS, 'villagers').map((value): VillagerState => {
    if (!isObject(value)) throw invalid('villagers');
    return {
      x: number(value.x, 0, WORLD, 'villagers'), y: number(value.y, 0, HEIGHT, 'villagers'), z: number(value.z, 0, WORLD, 'villagers'), p: integer(value.p, 0, PROFESSIONS.length - 1, 'villagers'),
      home: value.home === undefined ? null : vec3(value.home, 'villagers'), uses: list(value.uses, MAX_OFFERS, 'villagers').map(n => integer(n, 0, 1e6, 'villagers')),
      seed: integer(value.seed, 0, 2 ** 31 - 1, 'villagers'),
    };
  });
  const bits = fromBase64(raw.populated), populated = new Set<number>();
  if (bits.length !== CHUNK_BITS / 8) throw invalid('chunks');
  bits.forEach((byte, i) => { for (let b = 0; b < 8; b++) if (byte & (1 << b)) populated.add(i * 8 + b); });
  return {
    settings, worldId: typeof raw.worldId === 'string' ? raw.worldId : String(settings.seed), time: integer(raw.time, 0, DAY_TICKS - 1, 'time'), day: integer(raw.day, 0, 1e9, 'day'), edits,
    players, chests, furnaces, animals, villagers, populated, stats: statsOf(raw.stats, STAT_KEYS),
  };
}

/** Worn armor from a saved player (absent before version 9); each piece must sit in its own slot. */
function armorSlots(value: unknown): (Slot | null)[] {
  if (value === undefined) return emptySlots(4);
  const armor = slots(value, 4, 'armor');
  if (armor.some((slot, i) => slot && armorOf(slot.id)?.slot !== i)) throw invalid('armor');
  return armor;
}
