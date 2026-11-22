/**
 * World saves. Survival and creative worlds are written as format version 11 (versions 9 and 10 still load); a Caper
 * City world is written as version 12, which adds the `minutes` and `bonks` settings and one compact record per player
 * (`c`: coins, owned vehicles, flat, plot and nine career totals). The city, its residents and its vehicles come from
 * the seed and are never saved; a city save holds no animals or villagers.
 *
 * Since version 11: Everything bulky is binary in base64: the edit
 * journal is packed and deflated (sim/journal.ts), slot lists are 6-byte records (slot, item id, count, damage) and
 * the populated-chunk bitset is deflated. Versions 9 and 10 wrote 6-byte edits, [index, id, n, d?] slot tuples and a
 * raw bitset; `parseSave` reads both, validates everything and throws a readable message.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { B, BLOCKS, cellId } from '../shared/blocks';
import { CHEST_SIZE, DAY_TICKS, HEIGHT, inEnd, INVENTORY_SIZE, MAX_FOOD, MAX_HEALTH, WORLD } from '../shared/constants';
import { cellXYZ, isCellIndex, type Vec3 } from '../shared/coords';
import { emptySlots } from '../shared/inventory';
import { armorOf, durabilityOf, isItem, maxStack, type Slot } from '../shared/items';
import { MOB_TYPES, MS, q2, q3, validateSettings, type Settings, type Stats, type Victory } from '../shared/protocol';
import { PROFESSIONS } from '../shared/trades';
import { RIDES } from '../shared/city/vehicles';
import { STAT_KEYS as STAT_KEYS_CITY, type CityRecord } from './city-state';
import { MAX_CHESTS, MAX_FURNACES } from './containers';
import { packEdits, unpackEdits as unpackJournal } from './journal';
import type { Furnace, PlayerStats, SavedPlayerState } from './state';

export const SAVE_VERSION = 11;
/** Caper City saves: only city worlds are written (and read) as this version. */
export const CITY_SAVE_VERSION = 12;
/**
 * Oldest version that still loads. Edits only record differences from generated terrain, so a world saved before the
 * expansion generator (version 8) would silently grow lava caves and structures through its builds: it is refused.
 */
const MIN_VERSION = 9;
export const OLD_SAVE_MESSAGE = 'This world was made with the previous version of Blockwild and cannot be loaded.';
/** A full room of 64 and half as many again who played earlier and may come back for their things. */
export const MAX_SAVED_PLAYERS = 96, MAX_SAVED_ANIMALS = 160;
/** Names are the room's (16 characters at most there); a longer one could push a full save over its size limit. */
const CHUNK_BITS = (WORLD / 16) ** 2, MAX_NAME = 16;
export const MAX_SAVED_VILLAGERS = 64;
const MAX_OFFERS = 8;
/** The End (save v10): ten obsidian pillars (0..9) can hold a crystal; the dragon has 200 health. */
export const END_PILLARS = 10, DRAGON_HEALTH = 200;

/** Slots as base64 of 6-byte records: slot index, item id (16 bits), count, damage (16 bits), little-endian. */
export type PackedSlots = string;
export type SavedPlayer = {
  name: string; x: number; y: number; z: number; yaw: number; pitch: number; health: number; food: number; saturation: number;
  inv: PackedSlots;
  /** Worn armor (slot 0 head .. 3 feet). */
  armor: PackedSlots;
  /** Bed cell used as the respawn point, or null for the world spawn. */
  spawn: Vec3 | null;
  stats: PlayerStats; milestones: number;
  /** Caper City (v12, city saves only): [coins, owned vehicles (bitmask), flat lot + 1, plot + 1, then STAT_KEYS in order]. */
  c?: number[];
};
export type SavedFurnace = { i: number; slots: PackedSlots; burn: number; burnMax: number; cook: number };
export type SavedAnimal = { t: number; x: number; y: number; z: number; s: number };
/** A villager: profession, home bed cell (if any), uses per offer and the seed its offers derive from. */
export type SavedVillager = { x: number; y: number; z: number; p: number; home?: Vec3; uses: number[]; seed: number };
/** A villager in live shapes (home null when it has none). */
export type VillagerState = Omit<SavedVillager, 'home'> & { home: Vec3 | null };
/** The End's progress (v10): the dragon's life and health, pillars (0..9) that still hold crystals, the exit portal and the egg. */
export type SavedEnd = { dragon: 'alive' | 'dead'; health: number; crystals: number[]; portalActive: boolean; egg: boolean };
export type SaveData = {
  format: 'blockwild'; version: 11 | 12; seed: number;
  /** Stable world identity (derived from the seed when missing). */
  worldId: string; mode: Settings['mode']; difficulty: Settings['difficulty']; keepInventory: boolean;
  /** Caper City settings (city saves only). */
  minutes?: Settings['minutes']; bonks?: boolean;
  time: number; day: number; edits: string;
  players: SavedPlayer[]; chests: { i: number; slots: PackedSlots }[]; furnaces: SavedFurnace[]; animals: SavedAnimal[]; villagers: SavedVillager[];
  /** Deflated bitset (base64) of chunks whose animals were already rolled (so loading does not repopulate them). */
  populated: string; stats: Stats;
  /** v10: the End, the victory (null until the dragon dies) and the ender pearl pity counter. */
  end: SavedEnd; victory: Victory | null; pearlPity: number;
};
/** Validated save contents in live-state shapes. */
export type ParsedSave = {
  settings: Settings; worldId: string; time: number; day: number; edits: Map<number, number>;
  players: SavedPlayerState[];
  chests: Map<number, (Slot | null)[]>; furnaces: Map<number, Furnace>; animals: SavedAnimal[]; villagers: VillagerState[]; populated: Set<number>; stats: Stats;
  /** Absent in version 9 saves (a fresh End). */
  end?: SavedEnd; victory: Victory | null; pearlPity: number;
};
/** What exportSave reads from the live state (kept structural so this module stays independent of the tick code). */
export type SaveSource = {
  settings: Settings; worldId: string; time: number; day: number; edits: ReadonlyMap<number, number>;
  /** Session players first, then remembered absent ones; at most MAX_SAVED_PLAYERS are written. */
  players: readonly (SavedPlayerState & { dead?: boolean })[];
  chests: ReadonlyMap<number, readonly (Slot | null)[]>; furnaces: ReadonlyMap<number, Furnace>;
  animals: readonly SavedAnimal[]; villagers: readonly VillagerState[]; populated: ReadonlySet<number>; stats: Stats;
  /** Absent: a fresh End, no victory, no pity. */
  end?: SavedEnd; victory?: Victory | null; pearlPity?: number;
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

/** The journal of a version 11 save. */
export function unpackEdits(text: string): Map<number, number> {
  try { return unpackJournal(fromBase64(text)); } catch { throw invalid('edits'); }
}
/** Versions 9 and 10: little-endian (uint32 cell index, uint16 value) records, at most 16,384 of them. */
function unpackOldEdits(text: string): Map<number, number> {
  const bytes = fromBase64(text);
  if (bytes.length % 6 || bytes.length / 6 > 16384) throw invalid('edits');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), edits = new Map<number, number>();
  for (let offset = 0; offset < bytes.length; offset += 6) {
    const index = view.getUint32(offset, true), value = view.getUint16(offset + 4, true), block = BLOCKS[cellId(value)];
    if (!isCellIndex(index) || edits.has(index) || !block || block.id === B.barrier) throw invalid('edits');
    edits.set(index, value);
  }
  return edits;
}

function packSlots(slots: readonly (Slot | null)[]): PackedSlots {
  const filled = slots.flatMap((slot, i) => slot ? [[i, slot] as const] : []), bytes = new Uint8Array(filled.length * 6);
  filled.forEach(([i, slot], k) => bytes.set([i, slot.id & 255, slot.id >> 8, slot.n, (slot.d ?? 0) & 255, (slot.d ?? 0) >> 8], k * 6));
  return toBase64(bytes);
}
const packBits = (keys: ReadonlySet<number>) => {
  const bytes = new Uint8Array(CHUNK_BITS / 8);
  for (const key of keys) if (key >= 0 && key < CHUNK_BITS) bytes[key >> 3]! |= 1 << (key & 7);
  return toBase64(deflateRawSync(bytes));
};

export function exportSave(source: SaveSource): SaveData {
  const { settings } = source;
  return {
    format: 'blockwild', version: settings.mode === 'city' ? CITY_SAVE_VERSION : SAVE_VERSION, seed: settings.seed, worldId: source.worldId, mode: settings.mode, difficulty: settings.difficulty, keepInventory: settings.keepInventory,
    ...settings.mode === 'city' ? { minutes: settings.minutes ?? 0, bonks: settings.bonks ?? true } : {},
    time: Math.floor(source.time), day: source.day, edits: toBase64(packEdits(source.edits)),
    players: source.players.slice(0, MAX_SAVED_PLAYERS).map(p => ({
      name: p.name, x: q2(p.x), y: q2(p.y), z: q2(p.z), yaw: q3(p.yaw), pitch: q3(p.pitch),
      // Dead players come back at full health (respawned on load); their items were already dropped or kept.
      // Armor makes health fractional: a sliver of health still loads (at least half a heart).
      health: p.dead ? MAX_HEALTH : Math.max(0.5, q2(p.health)), food: p.dead ? MAX_FOOD : p.food, saturation: q2(p.dead ? 5 : p.saturation),
      inv: packSlots(p.inv), armor: packSlots(p.armor), spawn: p.bed ? [...p.bed] : null, stats: { ...p.stats, distance: Math.round(p.stats.distance) }, milestones: p.milestones,
      ...settings.mode === 'city' && p.city ? { c: [p.city.coins, p.city.own, p.city.flat + 1, p.city.plot + 1, ...STAT_KEYS_CITY.map(key => Math.round(p.city!.stats[key]))] } : {},
    })),
    chests: [...source.chests].map(([i, slots]) => ({ i, slots: packSlots(slots) })),
    furnaces: [...source.furnaces].map(([i, f]) => ({ i, slots: packSlots(f.slots), burn: q2(f.burn), burnMax: q2(f.burnMax), cook: q2(f.cook) })),
    animals: (settings.mode === 'city' ? [] : source.animals).slice(0, MAX_SAVED_ANIMALS).map(a => ({ t: a.t, x: q2(a.x), y: q2(a.y), z: q2(a.z), s: a.s })),
    villagers: (settings.mode === 'city' ? [] : source.villagers).slice(0, MAX_SAVED_VILLAGERS).map(v => {
      const saved: SavedVillager = { x: q2(v.x), y: q2(v.y), z: q2(v.z), p: v.p, uses: v.uses.slice(0, MAX_OFFERS), seed: v.seed };
      if (v.home) saved.home = [...v.home];
      return saved;
    }),
    populated: packBits(source.populated), stats: { ...source.stats },
    end: source.end ? endRecord(source.end) : freshEnd(),
    victory: source.victory ? { ...source.victory, by: [...source.victory.by] } : null, pearlPity: source.pearlPity ?? 0,
  };
}
/** Only the saved fields (the live End state carries runtime fields too). */
const endRecord = ({ dragon, health, crystals, portalActive, egg }: SavedEnd): SavedEnd => ({ dragon, health: q2(health), crystals: [...crystals], portalActive, egg });
/** A new world's End: the dragon alive at full health, a crystal on every pillar. */
export const freshEnd = (): SavedEnd => ({ dragon: 'alive', health: DRAGON_HEALTH, crystals: Array.from({ length: END_PILLARS }, (_, i) => i), portalActive: false, egg: false });

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
/** Slots from packed records (version 11) or [index, id, n, d?] tuples (older saves). */
function slots(value: unknown, size: number, what: string): (Slot | null)[] {
  const out = emptySlots(size);
  let tuples: unknown[];
  if (typeof value === 'string') {
    const bytes = fromBase64(value);
    if (bytes.length % 6 || bytes.length / 6 > size) throw invalid(what);
    tuples = Array.from({ length: bytes.length / 6 }, (_, k) => { const o = k * 6, d = bytes[o + 4]! | bytes[o + 5]! << 8; return [bytes[o]!, bytes[o + 1]! | bytes[o + 2]! << 8, bytes[o + 3]!, ...d ? [d] : []]; });
  } else tuples = list(value, size, what);
  for (const raw of tuples) {
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
const STAT_KEYS = ['mined', 'placed', 'crafted', 'mobs', 'deaths', 'days', 'dragons'] as const;
const PLAYER_STAT_KEYS = ['mined', 'placed', 'crafted', 'mobs', 'deaths', 'distance'] as const;
/** Stat totals; keys missing from an older save (v9 has no `dragons`) count as 0. */
function statsOf<K extends string>(value: unknown, keys: readonly K[], optional: readonly K[] = []): Record<K, number> {
  if (!isObject(value)) throw invalid('stats');
  return Object.fromEntries(keys.map(key => [key, value[key] === undefined && optional.includes(key) ? 0 : integer(value[key], 0, 1e12, 'stats')])) as Record<K, number>;
}
/** A container cell is either an edit of that block or unedited (a worldgen chest or furnace; createState checks the terrain). */
const placedOrGenerated = (edits: ReadonlyMap<number, number>, index: number, block: number) => !edits.has(index) || cellId(edits.get(index)!) === block;

/** Validate a raw save; throws a player-facing message. Never touches live state. */
export function parseSave(raw: unknown): ParsedSave {
  if (!isObject(raw) || raw.format !== 'blockwild') throw new Error('This is not a Blockwild world save.');
  if (typeof raw.version !== 'number' || raw.version < MIN_VERSION) throw new Error(OLD_SAVE_MESSAGE);
  // Version 12 is the city's: any other world claiming it comes from a build newer than this one.
  if (raw.version > CITY_SAVE_VERSION || raw.version > SAVE_VERSION && raw.mode !== 'city') throw new Error('This world was saved by a newer version of Blockwild.');
  const settings = validateSettings(raw);
  if (settings.seed < 1 || settings.seed !== raw.seed || settings.mode !== raw.mode || settings.difficulty !== raw.difficulty || settings.keepInventory !== raw.keepInventory) throw invalid('settings');
  const city = settings.mode === 'city';
  // The city arrived with version 12; its settings are written out in full.
  if (city && (raw.version < CITY_SAVE_VERSION || settings.minutes !== raw.minutes || settings.bonks !== raw.bonks)) throw invalid('settings');
  if (raw.worldId !== undefined && (typeof raw.worldId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(raw.worldId))) throw invalid('settings');
  if (typeof raw.edits !== 'string' || typeof raw.populated !== 'string') throw invalid('edits');
  const edits = raw.version >= 11 ? unpackEdits(raw.edits) : unpackOldEdits(raw.edits);
  // Before v10 the End's corner was ordinary overworld: whatever was built or left there does not come along.
  const legacy = raw.version < 10, stale = (x: number, z: number) => legacy && inEnd(x, z);
  for (const index of legacy ? edits.keys() : []) {
    const [x, , z] = cellXYZ(index);
    if (inEnd(x, z)) edits.delete(index);
  }

  const players = list(raw.players, MAX_SAVED_PLAYERS, 'players').map(value => {
    if (!isObject(value) || typeof value.name !== 'string' || value.name.length > MAX_NAME) throw invalid('players');
    // y −1 means "no usable spot" (saved falling through the void, or inside a pre-End save's End): they load at the world spawn.
    const x = number(value.x, 0, WORLD, 'players'), z = number(value.z, 0, WORLD, 'players'), bed = value.spawn === null ? null : vec3(value.spawn, 'spawn');
    return {
      name: value.name, x, y: stale(x, z) ? -1 : Math.max(-1, Math.min(HEIGHT + 64, number(value.y, -1e6, 1e6, 'players'))), z,
      yaw: number(value.yaw, -10, 10, 'players'), pitch: number(value.pitch, -2, 2, 'players'),
      health: number(value.health, 0.5, MAX_HEALTH, 'players'), food: integer(value.food, 0, MAX_FOOD, 'players'), saturation: number(value.saturation, 0, MAX_FOOD, 'players'),
      inv: slots(value.inv, INVENTORY_SIZE, 'inventory'), armor: armorSlots(value.armor), bed: bed && !stale(bed[0], bed[2]) ? bed : null,
      stats: statsOf(value.stats, PLAYER_STAT_KEYS), milestones: integer(value.milestones, 0, 2 ** 30, 'players'),
      ...cityOf(value.c, city),
    };
  });
  // Animals and villagers do not exist in the city: their room in the file is what the city records use.
  if (city && (list(raw.animals, 0, 'animals').length || list(raw.villagers, 0, 'villagers').length)) throw invalid('animals');
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
  const animals = list(raw.animals, MAX_SAVED_ANIMALS, 'animals').map((value): SavedAnimal => {
    if (!isObject(value)) throw invalid('animals');
    const t = integer(value.t, 0, MOB_TYPES.length - 1, 'animals');
    if (MOB_TYPES[t]!.hostile) throw invalid('animals');
    return { t, x: number(value.x, 0, WORLD, 'animals'), y: number(value.y, 0, HEIGHT, 'animals'), z: number(value.z, 0, WORLD, 'animals'), s: integer(value.s, 0, MS.SHEARED | MS.BABY, 'animals') };
  }).filter(a => !stale(a.x, a.z));
  const villagers = list(raw.villagers, MAX_SAVED_VILLAGERS, 'villagers').map((value): VillagerState => {
    if (!isObject(value)) throw invalid('villagers');
    return {
      x: number(value.x, 0, WORLD, 'villagers'), y: number(value.y, 0, HEIGHT, 'villagers'), z: number(value.z, 0, WORLD, 'villagers'), p: integer(value.p, 0, PROFESSIONS.length - 1, 'villagers'),
      home: value.home === undefined ? null : vec3(value.home, 'villagers'), uses: list(value.uses, MAX_OFFERS, 'villagers').map(n => integer(n, 0, 1e6, 'villagers')),
      seed: integer(value.seed, 0, 2 ** 31 - 1, 'villagers'),
    };
  }).filter(v => !stale(v.x, v.z));
  const populated = new Set<number>();
  let bits = fromBase64(raw.populated);
  try { if (raw.version >= 11) bits = inflateRawSync(bits, { maxOutputLength: CHUNK_BITS / 8 }); } catch { throw invalid('chunks'); }
  if (bits.length !== CHUNK_BITS / 8) throw invalid('chunks');
  bits.forEach((byte, i) => { for (let b = 0; b < 8; b++) if (byte & (1 << b)) populated.add(i * 8 + b); });
  return {
    settings, worldId: typeof raw.worldId === 'string' ? raw.worldId : String(settings.seed), time: integer(raw.time, 0, DAY_TICKS - 1, 'time'), day: integer(raw.day, 0, 1e9, 'day'), edits,
    players, chests, furnaces, animals, villagers, populated, stats: statsOf(raw.stats, STAT_KEYS, ['dragons']),
    ...raw.version >= 10 ? { end: endOf(raw.end) } : {}, victory: raw.version >= 10 ? victoryOf(raw.victory) : null,
    pearlPity: raw.version >= 10 ? integer(raw.pearlPity, 0, 1e6, 'pearls') : 0,
  };
}

/** A player's city record (only city saves carry one; coins and totals are bounded so the file's size is too). */
function cityOf(value: unknown, city: boolean): { city?: CityRecord } {
  if (value === undefined) return {};
  if (!city) throw invalid('players');
  const c = list(value, 4 + STAT_KEYS_CITY.length, 'city').map(n => integer(n, 0, 99_999_999, 'city'));
  if (c.length !== 4 + STAT_KEYS_CITY.length || c[1]! >= 2 ** RIDES.length || c[2]! > 4096 || c[3]! > 64) throw invalid('city');
  return { city: { coins: c[0]!, own: c[1]!, flat: c[2]! - 1, plot: c[3]! - 1, stats: Object.fromEntries(STAT_KEYS_CITY.map((key, k) => [key, c[4 + k]!])) as CityRecord['stats'] } };
}
function endOf(value: unknown): SavedEnd {
  if (!isObject(value) || (value.dragon !== 'alive' && value.dragon !== 'dead') || typeof value.portalActive !== 'boolean' || typeof value.egg !== 'boolean') throw invalid('end');
  const crystals = list(value.crystals, END_PILLARS, 'end').map(n => integer(n, 0, END_PILLARS - 1, 'end'));
  if (new Set(crystals).size !== crystals.length) throw invalid('end');
  return { dragon: value.dragon, health: number(value.health, 0, DRAGON_HEALTH, 'end'), crystals, portalActive: value.portalActive, egg: value.egg };
}
function victoryOf(value: unknown): Victory | null {
  if (value === null) return null;
  if (!isObject(value)) throw invalid('victory');
  const by = list(value.by, MAX_SAVED_PLAYERS, 'victory').map(name => {
    if (typeof name !== 'string' || name.length > MAX_NAME) throw invalid('victory');
    return name;
  });
  return { day: integer(value.day, 0, 1e9, 'victory'), tick: integer(value.tick, 0, DAY_TICKS - 1, 'victory'), by };
}

/** Worn armor from a saved player (absent before version 9); each piece must sit in its own slot. */
function armorSlots(value: unknown): (Slot | null)[] {
  if (value === undefined) return emptySlots(4);
  const armor = slots(value, 4, 'armor');
  if (armor.some((slot, i) => slot && armorOf(slot.id)?.slot !== i)) throw invalid('armor');
  return armor;
}
