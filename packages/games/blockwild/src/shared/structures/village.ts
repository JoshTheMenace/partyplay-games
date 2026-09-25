/**
 * Villages: a well at the centre, 3-wide dirt-path streets (gravel over water) with branch streets, houses, a large
 * house, a blacksmith, a library, farms and lamp posts along the streets. Every building faces its street, is levelled
 * onto the terrain (foundation down to the ground, air cleared above) and uses its biome's palette: oak and cobblestone
 * (plains, forest), spruce (taiga) or sandstone with flat roofs (desert).
 */
import { B, blockOf, CHEST_LOOT, makeCell } from '../blocks';
import { SEA_LEVEL } from '../constants';
import { FACING, type Vec3 } from '../coords';
import { createRng, hash3, rngInt, type Rng } from '../noise';
import { biomeAt, surfaceHeight, type BiomeName } from '../worldgen';
import { Blueprint, Frame, heights, OP, overlaps, type Bounds, type Rect } from './builder';

/** `center`: a standable path cell beside the well; `bed`: each house bed's foot cell. */
export type Village = { center: Vec3; houses: { bed: Vec3; bounds: Bounds }[]; bounds: Bounds };
export type VillagePlan = { center: Vec3; bp: Blueprint; village: Village };

type Palette = {
  planks: number; log: number; base: number; floor: number; stairs: number; slab: number; roof: number; accent: number;
  ground: number; fill: number; well: number; wellSlab: number; rim: number; lamp: number; flat: boolean;
};
const OAK: Palette = {
  planks: B.oak_planks, log: B.oak_log, base: B.cobblestone, floor: B.oak_planks, stairs: B.oak_stairs, slab: B.oak_slab, roof: B.oak_planks, accent: B.oak_log,
  ground: B.grass_block, fill: B.dirt, well: B.cobblestone, wellSlab: B.cobblestone_slab, rim: B.oak_log, lamp: B.oak_log, flat: false,
};
const SPRUCE: Palette = {
  ...OAK, planks: B.spruce_planks, log: B.spruce_log, floor: B.spruce_planks, stairs: B.cobblestone_stairs, slab: B.cobblestone_slab, roof: B.cobblestone,
  accent: B.spruce_log, rim: B.spruce_log, lamp: B.spruce_log,
};
const SAND: Palette = {
  planks: B.sandstone, log: B.cut_sandstone, base: B.cut_sandstone, floor: B.cut_sandstone, stairs: B.sandstone_stairs, slab: B.sandstone_slab, roof: B.cut_sandstone,
  accent: B.chiseled_sandstone, ground: B.sand, fill: B.sandstone, well: B.cut_sandstone, wellSlab: B.sandstone_slab, rim: B.cut_sandstone, lamp: B.chiseled_sandstone, flat: true,
};
const PALETTES: Partial<Record<BiomeName, Palette>> = { plains: OAK, forest: OAK, taiga: SPRUCE, desert: SAND };

type Kind = 'house' | 'cottage' | 'large' | 'smith' | 'library' | 'farm' | 'big_farm';
/** Footprint per building: w along the street, d away from it (both include a one-block porch/eave margin). */
const SIZE: Record<Kind, [number, number]> = { house: [7, 7], cottage: [9, 6], large: [11, 9], smith: [11, 9], library: [11, 9], farm: [7, 9], big_farm: [13, 9] };
/** How far any piece may reach from the well, and the most a footprint's terrain may vary before it is refused. */
export const VILLAGE_REACH = 72;
const MAX_SLOPE = 3;

/** Plan a village around (x, z), or null when the biome or terrain cannot hold one. */
export function planVillage(seed: number, x: number, z: number): VillagePlan | null {
  const pal = PALETTES[biomeAt(seed, x, z)];
  if (!pal || surfaceHeight(seed, x, z) <= SEA_LEVEL) return null;
  const rng = createRng(hash3(seed, x, z, 0x7111a6e)), bp = new Blueprint(), rects: Rect[] = [], houses: Village['houses'] = [];
  const layout: Layout = { seed, cx: x, cz: z, rng, bp, pal, rects, houses, streetRects: [] };

  // The well, levelled on a 6 × 6 pad with a path ring.
  const wellY = floorOf(heights(seed, x - 2, z - 2, x + 3, z + 3).mean);
  well(new Frame(bp, x - 2, wellY, z - 2, 6, 6, 0), pal);
  rects.push([x - 2, z - 2, x + 3, z + 3]);

  // Main streets leave the well ring towards 3–4 directions; branches split off them sideways.
  const streets: Street[] = [];
  const dirs = shuffle([0, 1, 2, 3], rng).slice(0, 3 + (rng() < 0.5 ? 1 : 0));
  const starts: Record<number, [number, number]> = { 0: [x, z - 3], 1: [x + 4, z], 2: [x, z + 4], 3: [x - 3, z] };
  for (const dir of dirs) addStreet(layout, streets, starts[dir]![0], starts[dir]![1], dir, rngInt(rng, 18, 36));
  // Branch off the main streets only (addStreet appends the branches to the same list).
  for (const street of streets.slice()) if (street.len >= 16 && rng() < 0.75) {
    const t = rngInt(rng, 6, street.len - 6), side = rng() < 0.5 ? 1 : 3, [px, pz] = FACING[(street.dir + side) & 3]!;
    const [sx, sz] = streetAt(street, t);
    addStreet(layout, streets, sx + px * 2, sz + pz * 2, (street.dir + side) & 3, rngInt(rng, 10, 22));
  }

  // Buildings along both sides of every street, in queue order (the special buildings early so they always appear).
  const queue: Kind[] = Array.from({ length: rngInt(rng, 3, 6) }, (): Kind => rng() < 0.55 ? 'house' : 'cottage');
  for (let i = rngInt(rng, 2, 3); i > 0; i--) queue.splice(Math.floor(rng() * (queue.length + 1)), 0, rng() < 0.6 ? 'farm' : 'big_farm');
  queue.splice(1, 0, 'large');
  queue.splice(3, 0, 'smith');
  queue.splice(5, 0, 'library');
  let buildings = 0;
  for (const street of streets) for (const side of [1, 3]) {
    for (let t = 1; t < street.len && queue.length;) {
      const placed = queue.slice(0, 3).find(kind => tryBuilding(layout, street, side, t, kind));
      if (!placed) { t += 2; continue; }
      queue.splice(queue.indexOf(placed), 1);
      buildings++;
      t += SIZE[placed][0] + 1 + (rng() < 0.5 ? 1 : 0);
    }
  }
  if (buildings < 5 || houses.length < 3) return null;

  // Lamp posts at the street edges wherever there is room.
  for (const street of streets) for (let t = 3; t < street.len; t += 9) {
    const side = t % 2 ? 1 : 3, [px, pz] = FACING[(street.dir + side) & 3]!, [sx, sz] = streetAt(street, t), lx = sx + px * 2, lz = sz + pz * 2;
    const rect: Rect = [lx, lz, lx, lz], ground = surfaceHeight(seed, lx, lz);
    if (ground <= SEA_LEVEL || rects.some(other => overlaps(rect, other, layout.streetRects.includes(other) ? 0 : 1))) continue;
    lampPost(new Frame(bp, lx, ground, lz, 1, 1, 0), pal);
    rects.push(rect);
  }
  for (const street of streets) paveStreet(layout, street);
  // The centre villagers roam around: standing room on the path ring beside the well.
  const center: Vec3 = [x - 2, wellY + 1, z];
  return { center, bp, village: { center, houses, bounds: bp.bounds } };
}

type Layout = { seed: number; cx: number; cz: number; rng: Rng; bp: Blueprint; pal: Palette; rects: Rect[]; houses: Village['houses']; streetRects: Rect[] };
type Street = { x: number; z: number; dir: number; len: number };
const floorOf = (mean: number) => Math.floor(mean + 0.5);
/** Fisher–Yates with the plan's own generator (Array.sort with a random comparator differs between engines). */
function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
const streetAt = (street: Street, t: number): [number, number] => [street.x + FACING[street.dir]![0] * t, street.z + FACING[street.dir]![1] * t];
const within = (layout: Layout, r: Rect) => r[0] >= layout.cx - VILLAGE_REACH && r[2] <= layout.cx + VILLAGE_REACH && r[1] >= layout.cz - VILLAGE_REACH && r[3] <= layout.cz + VILLAGE_REACH;

/** A 3-wide street from (x, z) heading `dir`, cut short where it would run into another piece or out of reach. */
function addStreet(layout: Layout, streets: Street[], x: number, z: number, dir: number, len: number) {
  const street: Street = { x, z, dir, len: 0 };
  for (let t = 0; t < len; t++) {
    const [sx, sz] = streetAt(street, t), cell: Rect = [sx - 1, sz - 1, sx + 1, sz + 1];
    if (!within(layout, cell) || (t > 0 && layout.rects.some(r => overlaps(cell, r)))) break;
    street.len = t + 1;
  }
  if (street.len < 8) return;
  const [ex, ez] = streetAt(street, street.len - 1), rect: Rect = [Math.min(x, ex) - 1, Math.min(z, ez) - 1, Math.max(x, ex) + 1, Math.max(z, ez) + 1];
  layout.rects.push(rect);
  layout.streetRects.push(rect);
  streets.push(street);
}
/**
 * Pave a street on the natural ground, built up by a block wherever its row, the verges or the next rows stand higher,
 * so lanes never sink below each other or the grass beside them (deeper hollows and water keep the plain paving).
 */
function paveStreet(layout: Layout, street: Street) {
  const [px, pz] = FACING[(street.dir + 1) & 3]!, { seed, bp } = layout;
  const at = (t: number, o: number): [number, number] => { const [sx, sz] = streetAt(street, t); return [sx + px * o, sz + pz * o]; };
  for (let t = 0; t < street.len; t++) {
    let level = -1;
    for (let dt = -1; dt <= 1; dt++) for (let o = -2; o <= 2; o++) level = Math.max(level, surfaceHeight(seed, ...at(t + dt, o)));
    for (let o = -1; o <= 1; o++) {
      const [x, z] = at(t, o), ground = surfaceHeight(seed, x, z), raise = ground === level - 1 && ground >= SEA_LEVEL;
      if (raise) bp.op(OP.foundation, x, level, z, B.dirt);
      bp.op(OP.path, x, raise ? level : ground, z, B.dirt_path);
    }
  }
}

/** Place a building of `kind` beside the street at position t on `side` (1 right, 3 left) if its plot is free and flat. */
function tryBuilding(layout: Layout, street: Street, side: number, t: number, kind: Kind): boolean {
  const [w, d] = SIZE[kind], toSide = (street.dir + side) & 3, [px, pz] = FACING[toSide]!, r = (toSide + 2) & 3;
  if (t + w > street.len + 1) return false;
  const [ax, az] = streetAt(street, t), [bx, bz] = streetAt(street, t + w - 1);
  const rect: Rect = [Math.min(ax + px * 2, bx + px * (d + 1)), Math.min(az + pz * 2, bz + pz * (d + 1)), Math.max(ax + px * 2, bx + px * (d + 1)), Math.max(az + pz * 2, bz + pz * (d + 1))];
  if (!within(layout, rect) || layout.rects.some(other => overlaps(rect, other, layout.streetRects.includes(other) ? 0 : 1))) return false;
  const h = heights(layout.seed, rect[0], rect[1], rect[2], rect[3]);
  if (h.max - h.min > MAX_SLOPE || h.min < SEA_LEVEL) return false;
  const f = new Frame(layout.bp, rect[0], floorOf(h.mean), rect[1], w, d, r);
  const beds = BUILD[kind](f, layout.pal, layout.rng), top = kind === 'farm' || kind === 'big_farm' ? 1 : 10;
  for (const bed of beds) layout.houses.push({ bed, bounds: f.bounds(0, top) });
  layout.rects.push(rect);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Buildings. Local frame: u along the front (0..w-1), v from the front (0) to the back (d-1), y 0 = floor; the front
// faces local north (facing 0), so a door faces 2 (the way someone walking in looks). Returns the beds' foot cells.

/** Level the plot: the walls' rectangle gets a stone base and a floor, the margin becomes ground with a path to the door. */
function plot(f: Frame, pal: Palette, door: number) {
  for (let v = 0; v < f.d; v++) for (let u = 0; u < f.w; u++) {
    const inside = u > 0 && v > 0 && u < f.w - 1 && v < f.d - 1, edge = inside && (u === 1 || v === 1 || u === f.w - 2 || v === f.d - 2);
    const porch = v === 0 && Math.abs(u - door) <= 1;
    f.op(OP.foundation, u, -1, v, inside ? pal.base : pal.fill);
    f.set(u, 0, v, inside ? edge ? pal.base : pal.floor : porch ? B.dirt_path : pal.ground);
    f.op(OP.clear, u, 1, v);
  }
}
const post = (f: Frame, pal: Palette, u: number, y: number, v: number) => blockOf(pal.log).state === 'axis' ? f.log(pal.log, u, y, v) : f.set(u, y, v, pal.log);
/** Walls of height h around the plot's inner rectangle: pillars at the corners, `lower` as the bottom course. */
function walls(f: Frame, pal: Palette, h: number, lower = pal.planks) {
  const u1 = f.w - 2, v1 = f.d - 2;
  for (let y = 1; y <= h; y++) for (let v = 1; v <= v1; v++) for (let u = 1; u <= u1; u++) {
    if (u !== 1 && u !== u1 && v !== 1 && v !== v1) continue;
    if ((u === 1 || u === u1) && (v === 1 || v === v1)) post(f, pal, u, y, v);
    else f.set(u, y, v, y === 1 ? lower : pal.planks);
  }
}
/**
 * The roof over walls of height h. Gabled palettes: stairs rows rising from both eaves (overhanging the margin) to a ridge
 * along u (`ridgeU`) or along v, with the gable triangles filled in. Flat palettes: a slab-rimmed flat roof.
 */
function roof(f: Frame, pal: Palette, h: number, ridgeU: boolean) {
  const u1 = f.w - 2, v1 = f.d - 2;
  if (pal.flat) {
    f.box(1, h + 1, 1, u1, h + 1, v1, pal.roof);
    f.ring(1, h + 2, 1, u1, v1, pal.slab);
    return;
  }
  const span = ridgeU ? f.d : f.w, length = ridgeU ? f.w : f.d;
  for (let k = 0; k <= span - 1 - k; k++) for (let s = 0; s < length; s++) {
    const y = h + 1 + k, [a, b] = [k, span - 1 - k];
    if (a === b) {
      if (ridgeU) f.slab(pal.slab, s, y, a); else f.slab(pal.slab, a, y, s);
      continue;
    }
    if (ridgeU) { f.stairs(pal.stairs, s, y, a, 2); f.stairs(pal.stairs, s, y, b, 0); }
    else { f.stairs(pal.stairs, a, y, s, 1); f.stairs(pal.stairs, b, y, s, 3); }
  }
  // Gable triangles on the two end walls, and a wall plate under the second stairs row along the eave walls.
  for (let k = 0; 1 + k <= span - 2 - k; k++) for (const end of ridgeU ? [1, u1] : [1, v1]) for (let s = 1 + k; s <= span - 2 - k; s++) {
    if (ridgeU) f.set(end, h + 1 + k, s, pal.planks); else f.set(s, h + 1 + k, end, pal.planks);
  }
  for (let s = 1; s <= (ridgeU ? u1 : v1); s++) for (const eave of ridgeU ? [1, v1] : [1, u1]) {
    if (ridgeU) f.set(s, h + 1, eave, pal.planks); else f.set(eave, h + 1, s, pal.planks);
  }
}
const glass = (f: Frame, cells: readonly [number, number, number][]) => { for (const [u, y, v] of cells) f.set(u, y, v, B.glass); };
const lootChest = (f: Frame, u: number, y: number, v: number, facing: number, loot: number) => f.facing(B.chest, u, y, v, facing, loot << 2);

const BUILD: Record<Kind, (f: Frame, pal: Palette, rng: Rng) => Vec3[]> = {
  /** 5 × 5 gabled house, door under the front gable, porch under the eave. */
  house(f, pal, rng) {
    plot(f, pal, 3);
    walls(f, pal, 3);
    roof(f, pal, 3, false);
    f.door(B.oak_door, 3, 1, 1, 2);
    if (pal.flat) f.set(3, 3, 1, pal.accent);
    glass(f, [[1, 2, 3], [5, 2, 3], [3, 2, 5]]);
    if (!pal.flat) f.set(3, 5, 5, B.glass);
    f.torch(4, 2, 2, 2);
    f.torch(2, 2, 0, 0);
    if (rng() < 0.5) lootChest(f, 4, 1, 4, 3, CHEST_LOOT.village_house);
    else f.set(4, 1, 4, B.crafting_table);
    return [f.bed(2, 1, 3, 2)];
  },
  /** 7 × 4 cottage with its ridge along the street and the door in the long side. */
  cottage(f, pal, rng) {
    plot(f, pal, 4);
    walls(f, pal, 3, pal.base);
    roof(f, pal, 3, true);
    f.door(B.oak_door, 4, 1, 1, 2);
    if (pal.flat) f.set(4, 3, 1, pal.accent);
    glass(f, [[2, 2, 1], [6, 2, 1], [3, 2, 4], [5, 2, 4], [1, 2, 2], [7, 2, 3]]);
    f.torch(4, 2, 3, 0);
    f.set(6, 1, 3, B.crafting_table);
    if (rng() < 0.4) lootChest(f, 5, 1, 3, 0, CHEST_LOOT.village_house);
    return [f.bed(2, 1, 2, 2)];
  },
  /** 9 × 7 house with a stone course, tall windows, two beds, a kitchen corner and a chest. */
  large(f, pal) {
    plot(f, pal, 5);
    walls(f, pal, 4, pal.base);
    roof(f, pal, 4, true);
    f.door(B.oak_door, 5, 1, 1, 2);
    if (pal.flat) f.set(5, 3, 1, pal.accent);
    for (const [u, v] of [[3, 1], [7, 1], [3, 7], [5, 7], [7, 7], [1, 3], [1, 5], [9, 3], [9, 5]] as const) glass(f, [[u, 2, v], [u, 3, v]]);
    if (!pal.flat) glass(f, [[1, 6, 4], [9, 6, 4]]);
    f.torch(2, 3, 2, 2);
    f.torch(8, 3, 4, 3);
    f.torch(4, 2, 0, 0);
    f.torch(6, 2, 0, 0);
    f.set(8, 1, 2, B.crafting_table);
    f.facing(B.furnace, 8, 1, 3, 3);
    lootChest(f, 8, 1, 6, 3, CHEST_LOOT.village_house);
    return [f.bed(2, 1, 5, 2), f.bed(4, 1, 5, 2)];
  },
  /** Bookshelves lining the walls under high windows, a reading table in the middle. */
  library(f, pal) {
    plot(f, pal, 5);
    walls(f, pal, 4, pal.base);
    roof(f, pal, 4, true);
    f.door(B.oak_door, 5, 1, 1, 2);
    if (pal.flat) f.set(5, 3, 1, pal.accent);
    for (const [u, v] of [[3, 1], [7, 1], [3, 7], [5, 7], [7, 7], [1, 4], [9, 4]] as const) glass(f, [[u, 3, v]]);
    f.box(2, 1, 6, 8, 2, 6, B.bookshelf);
    f.box(2, 1, 3, 2, 2, 5, B.bookshelf);
    f.box(8, 1, 3, 8, 2, 5, B.bookshelf);
    f.set(5, 1, 4, B.crafting_table);
    f.torch(4, 3, 2, 2);
    f.torch(6, 3, 2, 2);
    f.torch(4, 2, 0, 0);
    f.torch(6, 2, 0, 0);
    return [];
  },
  /** A stone workshop: a closed room with the smith's bed and chest, and an open forge under the roof with furnaces. */
  smith(f, pal) {
    plot(f, pal, 3);
    for (let v = 1; v <= 7; v++) for (let u = 1; u <= 9; u++) f.set(u, 0, v, pal.base);
    for (let y = 1; y <= 3; y++) for (let v = 1; v <= 7; v++) for (let u = 1; u <= 6; u++) {
      if (u !== 1 && u !== 6 && v !== 1 && v !== 7) continue;
      if ((u === 1 || u === 6) && (v === 1 || v === 7)) post(f, pal, u, y, v);
      else f.set(u, y, v, pal.base);
    }
    for (let y = 1; y <= 3; y++) for (const v of [1, 4, 7]) f.fence(9, y, v);
    f.box(1, 4, 1, 9, 4, 7, pal.roof);
    f.ring(0, 4, 0, 10, 8, pal.slab);
    f.ring(1, 5, 1, 9, 7, pal.slab);
    f.door(B.oak_door, 3, 1, 1, 2);
    f.box(6, 1, 4, 6, 2, 4, B.air);
    glass(f, [[5, 2, 1], [1, 2, 4], [3, 2, 7]]);
    f.facing(B.furnace_lit, 7, 1, 7, 0);
    f.facing(B.furnace, 8, 1, 7, 0);
    f.set(7, 1, 1, B.crafting_table);
    f.set(8, 1, 4, makeCell(B.stone_brick_slab, 2));
    f.torch(4, 3, 2, 2);
    f.torch(7, 3, 3, 1);
    lootChest(f, 2, 1, 6, 1, CHEST_LOOT.village_smith);
    return [f.bed(2, 1, 3, 2)];
  },
  farm: (f, pal, rng) => farm(f, pal, rng, [3]),
  big_farm: (f, pal, rng) => farm(f, pal, rng, [3, 9]),
};

/** A field in a rim of logs: water channels between rows of ripe crops (wheat, carrots or potatoes). */
function farm(f: Frame, pal: Palette, rng: Rng, channels: readonly number[]): Vec3[] {
  const crops = [B.wheat, B.wheat, B.carrots, B.potatoes], crop = crops[Math.floor(rng() * crops.length)]!;
  const second = channels.length > 1 ? crops[Math.floor(rng() * crops.length)]! : crop;
  for (let v = 0; v < f.d; v++) for (let u = 0; u < f.w; u++) {
    f.op(OP.foundation, u, -1, v, pal.fill);
    f.op(OP.clear, u, 1, v);
    const rim = u === 0 || v === 0 || u === f.w - 1 || v === f.d - 1;
    if (rim) {
      if (blockOf(pal.rim).state === 'axis') f.log(pal.rim, u, 0, v, (u === 0 || u === f.w - 1) && v !== 0 && v !== f.d - 1 ? 'v' : 'u');
      else f.set(u, 0, v, pal.rim);
    } else if (channels.includes(u)) f.set(u, 0, v, B.water);
    else {
      f.set(u, 0, v, makeCell(B.farmland, 1));
      f.set(u, 1, v, makeCell(u < f.w / 2 ? crop : second, rng() < 0.75 ? 7 : 5 + Math.floor(rng() * 2)));
    }
  }
  return [];
}

/** The well: a stone basin of water with a rim, four fence posts and a little roof, on a path-paved pad. */
function well(f: Frame, pal: Palette) {
  f.level(0, 0, 5, 5, B.dirt_path, pal.fill);
  f.box(1, -4, 1, 4, 0, 4, pal.well);
  f.box(2, -3, 2, 3, 0, 3, B.water);
  f.ring(1, 1, 1, 4, 4, pal.well);
  for (const [u, v] of [[1, 1], [4, 1], [1, 4], [4, 4]] as const) { f.fence(u, 2, v); f.fence(u, 3, v); }
  f.ring(1, 4, 1, 4, 4, pal.wellSlab);
  f.box(2, 4, 2, 3, 4, 3, pal.well);
}

/** A lamp post: two fence posts under a lamp block with a torch on each side. */
function lampPost(f: Frame, pal: Palette) {
  f.level(0, 0, 0, 0, pal.ground, pal.fill);
  f.fence(0, 1, 0);
  f.fence(0, 2, 0);
  f.set(0, 3, 0, pal.lamp);
  f.torch(0, 3, -1, 0);
  f.torch(1, 3, 0, 1);
  f.torch(0, 3, 1, 2);
  f.torch(-1, 3, 0, 3);
}
