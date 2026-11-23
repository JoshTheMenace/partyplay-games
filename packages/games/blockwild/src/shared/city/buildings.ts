/**
 * What stands on a lot. Every painter draws in the lot's own frame (u along the front, v from the front line inward,
 * y above the street) through a `Canvas` that clips to the chunk being generated, so a building is painted piece by
 * piece by the chunks it crosses and looks the same whichever comes first. Variety comes from `lot.style` (a hash).
 * Upper floors are solid behind their facades; ground floors of shops, lobbies and halls are real rooms.
 */
import { B, makeCell, SLAB_TOP } from '../blocks';
import { CHUNK, HEIGHT } from '../constants';
import { localIndex } from '../coords';
import { rampHeight, type Extras } from './extras';
import { footprint, GROUND, ISLE, layoutOf, lotCell, lotDepth, lotWidth, PIER, ROOM, SHORE, STOREY, type CityPlan, type Lot, type PlaceKind } from './plan';

/** Writes clipped to one chunk (world coordinates in, chunk cells out). */
export class Canvas {
  constructor(readonly cells: Uint16Array, readonly x0: number, readonly z0: number) {}
  set(x: number, y: number, z: number, cell: number) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK && y > 0 && y < HEIGHT) this.cells[localIndex(lx, y, lz)] = cell;
  }
  /** Fill an inclusive box; `soft` writes only into air (leaves around a lamp post). */
  box(xa: number, ya: number, za: number, xb: number, yb: number, zb: number, cell: number, soft = false) {
    const lx0 = Math.max(0, Math.min(xa, xb) - this.x0), lx1 = Math.min(CHUNK - 1, Math.max(xa, xb) - this.x0), lz0 = Math.max(0, Math.min(za, zb) - this.z0), lz1 = Math.min(CHUNK - 1, Math.max(za, zb) - this.z0);
    const y0 = Math.max(1, Math.min(ya, yb)), y1 = Math.min(HEIGHT - 1, Math.max(ya, yb)), cells = this.cells;
    if (lx0 > lx1 || lz0 > lz1) return;
    for (let y = y0; y <= y1; y++) for (let lz = lz0; lz <= lz1; lz++) {
      const row = localIndex(0, y, lz);
      if (soft) { for (let lx = lx0; lx <= lx1; lx++) if (!cells[row + lx]) cells[row + lx] = cell; }
      else cells.fill(cell, row + lx0, row + lx1 + 1);
    }
  }
}

/** A lot's drawing frame: local (u, y, v) with y = 0 at street level. */
class Frame {
  readonly w: number; readonly d: number;
  constructor(readonly c: Canvas, readonly lot: Lot) { this.w = lotWidth(lot); this.d = lotDepth(lot); }
  set(u: number, y: number, v: number, cell: number) { const [x, z] = lotCell(this.lot, u, v); this.c.set(x, GROUND + y, z, cell); }
  box(u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, cell: number, soft = false) {
    const [xa, za] = lotCell(this.lot, u0, v0), [xb, zb] = lotCell(this.lot, u1, v1);
    this.c.box(xa, GROUND + y0, za, xb, GROUND + y1, zb, cell, soft);
  }
  /** The four walls of a box, one cell thick. */
  walls(u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, cell: number) {
    this.box(u0, y0, v0, u1, y1, v0, cell);
    this.box(u0, y0, v1, u1, y1, v1, cell);
    this.box(u0, y0, v0, u0, y1, v1, cell);
    this.box(u1, y0, v0, u1, y1, v1, cell);
  }
  /** World facing (0..3 N, E, S, W) of a local one: 0 towards the street, 1 along +u, 2 into the lot, 3 along −u. */
  dir(local: number) { return this.lot.face + local & 3; }
  /** True when the chunk being painted cannot see any of the local box (skips whole painters early). */
  misses(u0: number, v0: number, u1: number, v1: number) {
    const [xa, za] = lotCell(this.lot, u0, v0), [xb, zb] = lotCell(this.lot, u1, v1), c = this.c;
    return Math.max(xa, xb) < c.x0 || Math.min(xa, xb) >= c.x0 + CHUNK || Math.max(za, zb) < c.z0 || Math.min(za, zb) >= c.z0 + CHUNK;
  }
}

const cell = makeCell, STUCCO = (n: number) => cell(B.stucco, n & 7), BRICK = (n: number) => n & 3 ? cell(B.city_bricks, (n & 3) - 1) : B.bricks, CONCRETE = (n: number) => cell(B.concrete, n % 3);
const WINDOW = (n: number) => cell(B.window, n & 3), LIT = (n: number) => cell(B.window_lit, n % 3), METAL = (n: number) => cell(B.metal_sheet, n % 6), SHELF = (n: number) => cell(B.shelf, n & 3);
const PLAZA = cell(B.pavement, 1), LAMP = cell(B.light_panel, SLAB_TOP), GLASS = B.glass;
/** The sign of each trade: its icon (a `shop_sign` state) and the colour of the band beside it. The map uses the same pair. */
export const SIGNS: Record<PlaceKind, readonly [icon: number, band: number]> = {
  food: [0, 0], gizmo: [1, 4], hardware: [2, 1], pawn: [3, 5], realtor: [4, 3], cabs: [5, 1], depot: [6, 2], dealer: [7, 0], scrap: [8, 6], clinic: [9, 7], watch: [10, 6], bank: [11, 3], hall: [12, 7], airfield: [13, 2],
  hats: [17, 4], fire: [19, 0], bus: [18, 6], bait: [16, 2],
};
const mix = (style: number, salt: number) => Math.imul(style ^ salt, 0x9e3779b1) >>> 0;

type Look = {
  wall: number; trim: number; floor: number;
  /** Window cells: `every` columns hold `run` windows, starting one column in. `lit`: share (0..100) of lit windows. */
  window: number; every: number; run: number; lit: number;
  /** Ground floor: a glass shopfront, a lobby with a wide doorway, a closed front with a door, or a wide open bay. */
  ground: 'shop' | 'lobby' | 'door' | 'bay';
  /** A room behind the door (else the ground floor is solid). `fit`: what stands in it. */
  room: boolean; fit: 'shop' | 'desk' | 'none';
  roof: 'flat' | 'gable';
  sign?: readonly [number, number];
};

/**
 * A building on local box [u0, v0, u1, v1]: a solid block of `floors` upper storeys over a ground floor, windows on all
 * four faces, a parapet and roof clutter, a doorway in the front and, if `look.room`, a room behind it.
 */
function building(f: Frame, [u0, v0, u1, v1]: readonly number[], floors: number, look: Look, style: number) {
  if (f.misses(u0! - 1, v0! - 2, u1! + 1, v1! + 2)) return;
  const a = u0!, b = v0!, c = u1!, d = v1!, top = STOREY.ground + floors * STOREY.upper, door = a + c >> 1;
  f.box(a, -1, b, c, -1, d, look.floor);
  f.box(a, 0, b, c, top - 1, d, look.wall);
  // Trim: a band over the ground floor, the corners, and the parapet around a flat roof.
  f.walls(a, STOREY.ground - 1, b, c, STOREY.ground - 1, d, look.trim);
  for (const [u, v] of [[a, b], [c, b], [a, d], [c, d]] as const) f.box(u, 0, v, u, top - 1, v, look.trim);
  // Windows, two cells tall on every upper storey; the ground floor gets them on the sides and back.
  const pane = (u: number, v: number, storey: number, i: number) => {
    const lit = mix(style, i * 31 + storey * 7 + u * 3 + v) % 100 < look.lit, y = storey < 0 ? 1 : STOREY.ground + storey * STOREY.upper + 1;
    f.box(u, y, v, u, y + 1, v, lit ? LIT(style >>> 3) : look.window);
  };
  for (let storey = -1; storey < floors; storey++) {
    for (let u = a + 1, i = 0; u < c; u++, i++) if (i % look.every < look.run) { if (storey >= 0) pane(u, b, storey, i); pane(u, d, storey, i + 50); }
    for (let v = b + 1, i = 0; v < d; v++, i++) if (i % look.every < look.run) { pane(a, v, storey, i + 100); pane(c, v, storey, i + 150); }
  }
  if (look.roof === 'flat') {
    f.walls(a, top, b, c, top, d, look.trim);
    const h = mix(style, 0x700f);
    // Roof clutter: a water tank on stilts, vents, or a mast on the tall ones.
    if (c - a > 8 && d - b > 8) {
      const u = a + 2 + h % (c - a - 6), v = b + 2 + (h >>> 8) % (d - b - 6);
      if (h & 1) { f.box(u, top, v, u + 2, top, v + 2, B.steel_post); f.box(u, top + 1, v, u + 2, top + 2, v + 2, B.oak_planks); f.box(u, top + 3, v, u + 2, top + 3, v + 2, B.oak_slab); }
      else f.box(u, top, v, u + 1, top, v + 2, B.steel);
      if (floors > 8) f.box(c - 2, top, d - 2, c - 2, top + 5, d - 2, B.steel_post);
    }
  } else {
    // A gable along u: each course steps in one cell from the front and the back.
    const tiles = cell(B.roof_tiles, style >>> 5);
    for (let k = 0; b - 1 + k <= d + 1 - k; k++) f.box(a - 1, top + k, b - 1 + k, c + 1, top + k, d + 1 - k, tiles);
    for (let k = 1; b + k <= d - k; k++) for (const u of [a, c]) f.box(u, top + k - 1, b + k, u, top + k - 1, d - k, look.wall);
  }
  // The ground floor front.
  const wide = look.ground === 'bay' ? 3 : 1, y1 = look.ground === 'bay' ? 3 : 2;
  if (look.room) {
    const back = Math.min(d - 1, b + ROOM - 1);
    f.box(a + 1, 0, b + 1, c - 1, STOREY.ground - 2, back, B.air);
    for (let u = a + 2; u < c - 1; u += 4) for (let v = b + 2; v < back; v += 4) f.set(u, STOREY.ground - 2, v, LAMP);
    if (look.fit === 'shop' || look.fit === 'desk') {
      const row = b + 7, shelves = SHELF(style >>> 9);
      f.box(a + 2, 0, row, c - 2, 0, row, B.counter);
      f.set(c - 2, 0, row, B.air);
      f.set(door + 1, 1, row, B.till);
      if (look.fit === 'shop') {
        f.box(a + 1, 0, back, c - 1, 2, back, shelves);
        for (const u of [a + 1, c - 1]) f.box(u, 0, b + 2, u, 2, b + 5, shelves);
      }
    }
  }
  if (look.ground === 'shop') f.box(a + 1, 0, b, c - 1, 2, b, GLASS);
  else if (look.ground === 'lobby') { f.box(door - 3, 0, b, door + 4, 2, b, GLASS); }
  if (look.ground !== 'door' || look.room) f.box(door - wide + 1, 0, b, door + wide, y1, b, B.air);
  else { f.set(door, 0, b, cell(B.oak_door, f.dir(0))); f.set(door, 1, b, cell(B.oak_door, f.dir(0) | 8)); }
  if (look.sign) {
    const [icon, band] = look.sign, y = STOREY.ground - 2;
    f.box(a + 1, y, b, c - 1, y, b, cell(B.sign_band, band));
    for (const u of [door, door + 1]) f.set(u, y, b, cell(B.shop_sign, icon));
  }
}

/** A fire escape: a ladder up the back wall to the roof. */
function ladder(f: Frame, u: number, v: number, top: number) { f.box(u, 0, v, u, top, v, cell(B.ladder, f.dir(2))); }
/** A lamp post with its lantern. */
function lamp(f: Frame, u: number, v: number, height = 4) { f.box(u, 0, v, u, height - 1, v, B.steel_post); f.set(u, height, v, B.lantern); }
/** A small tree: `tall` trunk cells under a two-tier crown. */
function tree(f: Frame, u: number, v: number, tall: number, birch = false) {
  const leaves = birch ? B.birch_leaves : B.oak_leaves;
  f.set(u, -1, v, B.dirt);
  f.box(u, 0, v, u, tall, v, birch ? B.birch_log : B.oak_log);
  f.box(u - 2, tall, v - 2, u + 2, tall + 1, v + 2, leaves, true);
  f.box(u - 1, tall + 2, v - 1, u + 1, tall + 3, v + 1, leaves, true);
}
const FLOWERS = [B.dandelion, B.poppy, B.cornflower];

const PAINTERS: Record<Lot['kind'], (f: Frame, plan: CityPlan, lot: Lot) => void> = {
  shop(f, plan, lot) {
    const s = lot.style, box = footprint(lot)!, top = STOREY.ground + lot.floors * STOREY.upper, place = plan.places[lot.place];
    building(f, box, lot.floors, { wall: s & 4 ? BRICK(s >>> 4) : STUCCO(s >>> 4), trim: CONCRETE(s >>> 8), floor: B.oak_planks, window: WINDOW(s >>> 10), every: 3, run: 2, lit: 30, ground: 'shop', room: true, fit: 'shop', roof: 'flat',
      ...place ? { sign: SIGNS[place.kind] } : {} }, s);
    // The porch under an awning, the job board on the front wall, and the yard behind with its fire escape.
    f.box(0, 3, 0, f.w - 1, 3, 0, cell(B.awning, 0));
    if (place?.board) { const board = layoutOf(lot).board; f.set(board[0], 1, board[1], B.job_board); }
    f.set(1, 0, box[3]! + 2, B.bin);
    if (s & 32) f.box(f.w - 3, 0, box[3]! + 2, f.w - 2, s & 64 ? 1 : 0, box[3]! + 3, B.crate);
    ladder(f, box[2]! - 2, box[3]! + 1, top);
  },
  boutique(f, _plan, lot) {
    const s = lot.style, box = footprint(lot)!, top = STOREY.ground + lot.floors * STOREY.upper, [u0, v0, u1] = box;
    building(f, box, lot.floors, { wall: s & 4 ? STUCCO(s >>> 4) : BRICK(s >>> 4), trim: CONCRETE(s >>> 8), floor: B.oak_planks, window: WINDOW(s >>> 10), every: 3, run: 2, lit: 30, ground: 'shop', room: false, fit: 'none', roof: 'flat', sign: [0, 7] }, s);
    // A closed shop: goods behind the glass, a plain coloured band where a trade's sign would be, and a door.
    f.box(u0! + 1, 0, v0! + 1, u1! - 1, 2, v0! + 1, SHELF(s >>> 9));
    f.box(u0! + 1, 3, v0!, u1! - 1, 3, v0!, cell(B.sign_band, s >>> 12 & 7));
    const door = u0! + u1! >> 1;
    f.set(door, 0, v0!, cell(B.oak_door, f.dir(0)));
    f.set(door, 1, v0!, cell(B.oak_door, f.dir(0) | 8));
    f.set(door, 2, v0!, CONCRETE(s >>> 8));
    f.box(0, 3, 0, f.w - 1, 3, 0, cell(B.awning, 0));
    if (s & 16) ladder(f, box[2]! - 2, box[3]! + 1, top);
  },
  office(f, _plan, lot) {
    const s = lot.style, box = footprint(lot)!, glassy = (s & 3) !== 0;
    building(f, box, lot.floors, { wall: glassy ? CONCRETE(s >>> 2) : STUCCO(7 - (s >>> 2 & 1)), trim: CONCRETE(1 + (s >>> 4 & 1)), floor: PLAZA, window: WINDOW(s >>> 6), every: glassy ? 4 : 3, run: glassy ? 3 : 2, lit: 22, ground: 'lobby', room: true, fit: 'desk', roof: 'flat' }, s);
    // Planters either side of the entrance.
    const door = box[0]! + box[2]! >> 1;
    for (const u of [door - 6, door + 7]) if (u > 0 && u < f.w - 1) { f.set(u, 0, 0, B.oak_leaves); f.set(u, 0, 1, B.oak_leaves); }
  },
  flats(f, _plan, lot) {
    const s = lot.style, box = footprint(lot)!, [u0, v0, u1] = box, top = STOREY.ground + lot.floors * STOREY.upper;
    building(f, box, lot.floors, { wall: s & 1 ? BRICK(s >>> 1) : STUCCO(s >>> 1), trim: CONCRETE(s >>> 4), floor: PLAZA, window: WINDOW(3), every: 3, run: 2, lit: 45, ground: 'door', room: false, fit: 'none', roof: 'flat' }, s);
    // Balconies on the front of every other storey, a hedge along the front and a fire escape behind.
    for (let storey = 0; storey < lot.floors; storey += 2) for (let u = u0! + 3; u + 2 < u1!; u += 6) {
      const y = STOREY.ground + storey * STOREY.upper;
      f.box(u, y, v0! - 1, u + 2, y, v0! - 1, cell(B.oak_slab, SLAB_TOP));
    }
    const door = u0! + u1! >> 1;
    for (let u = u0!; u <= u1!; u++) if (Math.abs(u - door) > 1) f.set(u, 0, 0, B.oak_leaves);
    ladder(f, u1! - 2, box[3]! + 1, top);
  },
  house(f, _plan, lot) {
    const s = lot.style, box = footprint(lot)!, [u0, v0, u1, v1] = box, door = u0! + u1! >> 1;
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, B.grass_block);
    building(f, box, lot.floors, { wall: STUCCO(s), trim: s & 8 ? B.oak_planks : CONCRETE(2), floor: B.oak_planks, window: WINDOW(3), every: 4, run: 2, lit: 40, ground: 'door', room: false, fit: 'none', roof: 'gable' }, s);
    // A path to the door, a low hedge along the street, flowers, a mailbox and sometimes a tree in the back garden.
    f.box(door, -1, 0, door, -1, v0! - 1, B.pavement);
    for (let u = 0; u < f.w; u++) if (u !== door && u !== door + 1) f.set(u, 0, 0, B.oak_leaves);
    f.set(door + 1, 0, 0, B.mailbox);
    for (let k = 0; k < 6; k++) { const h = mix(s, k * 77); f.set(1 + h % (f.w - 2), 0, 2 + (h >>> 8) % Math.max(1, v0! - 3), FLOWERS[k % 3]!); }
    if (s & 16 && v1! + 4 < f.d) tree(f, 3 + (s >>> 6) % (f.w - 6), v1! + 3, 3, (s & 128) !== 0);
    f.set(u0! + 1, 0, v0! - 1, B.oak_slab);
  },
  warehouse(f, _plan, lot) {
    const s = lot.style, box = footprint(lot)!, [u0, v0, u1, v1] = box, door = u0! + u1! >> 1;
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, B.asphalt);
    if (f.misses(u0!, v0!, u1!, v1!) && f.misses(0, 0, f.w - 1, v0!)) return;
    // One tall hall of corrugated metal with a wide door and crates inside and out.
    f.box(u0!, -1, v0!, u1!, -1, v1!, CONCRETE(1));
    f.walls(u0!, 0, v0!, u1!, 7, v1!, METAL(s));
    f.box(u0!, 8, v0!, u1!, 8, v1!, METAL(0));
    f.walls(u0!, 3, v0!, u1!, 3, v1!, CONCRETE(1));
    f.box(door - 2, 0, v0!, door + 3, 4, v0!, B.air);
    for (let u = u0! + 3; u < u1!; u += 6) for (let v = v0! + 3; v < v1!; v += 5) f.set(u, 6, v, LAMP);
    for (let k = 0; k < 14; k++) {
      const h = mix(s, k * 131), u = u0! + 1 + h % (u1! - u0! - 1), v = v0! + 1 + (h >>> 8) % (v1! - v0! - 1);
      if (Math.abs(u - door) > 3 || v > v0! + 4) f.box(u, 0, v, u, (h >>> 16) % 3, v, k % 4 ? B.crate : METAL(1 + k));
    }
    for (let k = 0; k < 4; k++) { const h = mix(s, k * 59 + 7); f.box(2 + h % 10, 0, 1 + (h >>> 8) % 3, 2 + h % 10, (h >>> 12) & 1, 1 + (h >>> 8) % 3, B.crate); }
    lamp(f, 1, 1, 5);
    lamp(f, f.w - 2, 1, 5);
  },
  plot(f, plan, lot) {
    // Open lawn with corner posts round the build area and a path in from the street.
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, B.grass_block);
    const plot = plan.plots.find(p => p.lot === lot.i)!, c = f.c;
    for (const x of [plot.x0 - 1, plot.x1 + 1]) for (const z of [plot.z0 - 1, plot.z1 + 1]) { c.set(x, GROUND, z, B.steel_post); c.set(x, GROUND + 1, z, B.lantern); }
    c.box(plot.x0, GROUND - 1, plot.z0, plot.x1, GROUND - 1, plot.z1, B.dirt);
    f.box(f.w >> 1, -1, 0, f.w >> 1, -1, 3, B.pavement);
    f.set((f.w >> 1) + 1, 0, 1, cell(B.shop_sign, SIGNS.realtor[0]));
  },
  park(f, _plan, lot) {
    const s = lot.style, w = f.w, d = f.d, mid = w >> 1;
    f.box(0, -1, 0, w - 1, -1, d - 1, B.grass_block);
    // Paths cross in the middle around a pond; trees, flowers, benches and lamps fill the lawns.
    f.box(mid - 1, -1, 0, mid, -1, d - 1, B.pavement);
    f.box(0, -1, mid - 1, w - 1, -1, mid, B.pavement);
    f.box(mid - 8, -1, mid - 8, mid + 7, -1, mid + 7, B.pavement);
    f.box(mid - 6, -1, mid - 6, mid + 5, -1, mid + 5, B.water);
    f.box(mid - 6, -2, mid - 6, mid + 5, -2, mid + 5, B.sand);
    f.box(mid - 1, -1, mid - 1, mid, 0, mid, B.stone_bricks);
    f.set(mid, 1, mid, B.lantern);
    for (let k = 0; k < 22; k++) {
      const h = mix(s, k * 211), u = 3 + h % (w - 6), v = 3 + (h >>> 8) % (d - 6);
      if (Math.abs(u - mid) < 11 && Math.abs(v - mid) < 11 || Math.abs(u - mid) < 4 || Math.abs(v - mid) < 4) continue;
      tree(f, u, v, 3 + (h >>> 16) % 3, (h & 1 << 20) !== 0);
    }
    for (let k = 0; k < 60; k++) { const h = mix(s, k * 97 + 5), u = 1 + h % (w - 2), v = 1 + (h >>> 8) % (d - 2); if (Math.abs(u - mid) > 9 || Math.abs(v - mid) > 9) f.box(u, 0, v, u, 0, v, k % 3 ? FLOWERS[k % 3]! : B.short_grass, true); }
    for (const [u, v] of [[mid - 9, mid - 3], [mid - 9, mid + 2], [mid + 8, mid - 3], [mid + 8, mid + 2], [mid - 3, mid - 9], [mid + 2, mid - 9], [mid - 3, mid + 8], [mid + 2, mid + 8]] as const) f.set(u, 0, v, B.oak_slab);
    for (const [u, v] of [[mid - 2, 4], [mid + 1, d - 5], [4, mid - 2], [w - 5, mid + 1], [mid - 9, mid - 9], [mid + 8, mid + 8]] as const) lamp(f, u, v);
  },
  hall(f, plan, lot) {
    const s = lot.style, box = footprint(lot)!, [u0, v0, u1] = box, door = u0! + u1! >> 1, place = plan.places[lot.place]!;
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, PLAZA);
    building(f, box, lot.floors + 1, { wall: CONCRETE(2), trim: CONCRETE(0), floor: PLAZA, window: WINDOW(0), every: 4, run: 2, lit: 30, ground: 'lobby', room: true, fit: 'desk', roof: 'flat', sign: SIGNS.hall }, s);
    // A colonnade, a fountain on the plaza, trees in planters, benches and the job board beside the entrance.
    for (let u = u0! + 1; u < u1!; u += 4) if (Math.abs(u - door) > 2) f.box(u, 0, v0! - 2, u, STOREY.ground - 1, v0! - 2, CONCRETE(2));
    f.box(u0!, STOREY.ground, v0! - 2, u1!, STOREY.ground, v0! - 1, CONCRETE(2));
    f.box(20, -1, 16, 27, -1, 23, B.stone_bricks);
    f.box(21, -1, 17, 26, -1, 22, B.water);
    f.walls(20, 0, 16, 27, 0, 23, cell(B.stone_brick_slab, 0));
    f.box(23, -1, 19, 24, 1, 20, B.stone_bricks);
    f.set(23, 2, 19, B.lantern);
    for (const [u, v] of [[6, 6], [41, 6], [6, 20], [41, 20]] as const) { f.walls(u - 1, 0, v - 1, u + 1, 0, v + 1, B.stone_bricks); tree(f, u, v, 4); }
    for (const u of [14, 33]) { lamp(f, u, 2); f.box(u, 0, 12, u + 1, 0, 12, B.oak_slab); }
    if (place.board) f.c.set(place.board[0], place.board[1], place.board[2], B.job_board);
    f.set(layoutOf(lot).board[0] + 1, 0, v0! - 3, B.mailbox);
  },
  bank(f, plan, lot) { landmark(f, plan, lot, { wall: CONCRETE(2), trim: CONCRETE(1), window: WINDOW(1), ground: 'lobby' }); },
  hotel(f, _plan, lot) {
    const box = footprint(lot)!, door = box[0]! + box[2]! >> 1;
    landmark(f, _plan, lot, { wall: STUCCO(1), trim: CONCRETE(2), window: WINDOW(3), ground: 'lobby', lit: 55 });
    f.box(door - 3, 3, box[1]! - 3, door + 4, 3, box[1]! - 1, cell(B.awning, 0));
    for (const u of [door - 3, door + 4]) f.box(u, 0, box[1]! - 3, u, 2, box[1]! - 3, B.steel_post);
  },
  clinic(f, plan, lot) { landmark(f, plan, lot, { wall: CONCRETE(2), trim: STUCCO(4), window: WINDOW(0), ground: 'lobby', lit: 60 }); },
  watch(f, plan, lot) { landmark(f, plan, lot, { wall: BRICK(2), trim: CONCRETE(1), window: WINDOW(0), ground: 'lobby', lit: 50 }); },
  school(f, plan, lot) { landmark(f, plan, lot, { wall: BRICK(0), trim: CONCRETE(2), window: WINDOW(3), ground: 'door' }); },
  cinema(f, plan, lot) {
    const box = footprint(lot)!, [u0, v0, u1] = box;
    landmark(f, plan, lot, { wall: STUCCO(6), trim: CONCRETE(1), window: WINDOW(2), ground: 'lobby', lit: 0, every: 99 });
    // The marquee: a band of bulbs over the entrance and a tall lit fin.
    f.box(u0! + 4, STOREY.ground - 1, v0! - 2, u1! - 4, STOREY.ground - 1, v0! - 1, LIT(0));
    f.box(u0! + 4, STOREY.ground, v0! - 2, u1! - 4, STOREY.ground, v0! - 2, cell(B.sign_band, 0));
    f.box(u0! + 2, 0, v0! - 1, u0! + 2, STOREY.ground + 9, v0! - 1, LIT(2));
  },
  market(f, plan, lot) {
    // An open square of stalls: four posts, a striped canopy and a counter each; the cook's stall stands in the middle.
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, PLAZA);
    const layout = layoutOf(lot), place = plan.places[lot.place]!;
    const stall = (u: number, v: number, s: number) => {
      for (const [du, dv] of [[0, 0], [4, 0], [0, 3], [4, 3]] as const) f.box(u + du, 0, v + dv, u + du, 2, v + dv, B.oak_fence);
      f.box(u, 3, v, u + 4, 3, v + 3, cell(B.awning, 0));
      f.box(u, 0, v + 1, u + 4, 0, v + 1, B.counter);
      f.box(u + 1, 0, v + 3, u + 3, mix(s, 3) & 1, v + 3, s & 1 ? B.crate : B.hay_bale);
      f.set(u + 1 + (s >>> 2) % 3, 1, v + 1, s & 2 ? B.melon : B.pumpkin);
    };
    for (const [u, v] of [[5, 6], [16, 6], [29, 6], [39, 6], [5, 36], [16, 36], [29, 36], [39, 36]] as const) stall(u, v, mix(lot.style, u * 7 + v));
    const [ku, kv] = layout.keeper;
    for (const [du, dv] of [[-3, -2], [3, -2], [-3, 2], [3, 2]] as const) f.box(ku + du, 0, kv + dv, ku + du, 3, kv + dv, B.oak_fence);
    f.box(ku - 3, 4, kv - 2, ku + 3, 4, kv + 2, cell(B.awning, 0));
    f.box(ku - 3, 0, layout.counterV, ku + 3, 0, layout.counterV, B.counter);
    f.set(layout.till[0], 1, layout.till[1], B.till);
    f.set(ku - 2, 4, layout.counterV - 1, cell(B.shop_sign, SIGNS.food[0]));
    if (place.board) f.c.set(place.board[0], place.board[1], place.board[2], B.job_board);
    for (const [u, v] of [[2, 2], [45, 2], [2, 45], [45, 45], [24, 14], [24, 40]] as const) lamp(f, u, v);
  },
  fair(f, _plan, lot) {
    const s = lot.style;
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, B.grass_block);
    f.box(0, -1, 20, f.w - 1, -1, 27, PLAZA);
    // The big wheel: a ring of steel on an A-frame, with a coloured gondola at each of eight points.
    const cu = 24, cy = 17, v = 36, r = 13;
    for (let dx = 0; dx <= 9; dx++) {
      const dy = Math.round(Math.sqrt(r * r - dx * dx));
      for (const [x, y] of [[dx, dy], [dy, dx]] as const) for (const sx of [-1, 1]) for (const sy of [-1, 1]) f.set(cu + sx * x, cy + sy * y, v, B.steel);
    }
    for (const [du, dy] of [[0, r], [9, 9], [r, 0], [9, -9], [0, -r], [-9, -9], [-r, 0], [-9, 9]] as const) {
      f.box(cu + du - 1, cy + dy - 2, v - 1, cu + du + 1, cy + dy - 1, v + 1, METAL(1 + Math.abs(du + dy * 3)));
      for (let k = 1; k < 4; k++) f.set(cu + Math.round(du * k / 4), cy + Math.round(dy * k / 4), v, B.steel_post);
    }
    for (let y = 0; y <= cy; y++) for (const side of [-1, 1]) f.set(cu + side * Math.round((cy - y) * 0.45), y, v + 1, B.steel);
    f.box(cu - 1, cy - 1, v - 1, cu + 1, cy + 1, v + 1, B.steel);
    // A striped tent and a row of game stalls.
    f.walls(6, 0, 8, 14, 2, 16, B.white_wool);
    f.box(10, 0, 8, 10, 1, 8, B.air);
    for (let k = 0; k < 5; k++) f.box(5 + k, 3 + k, 7 + k, 15 - k, 3 + k, 17 - k, k % 2 ? B.white_wool : B.red_wool);
    for (const u of [30, 36, 42]) { f.box(u, 0, 6, u + 3, 0, 6, B.counter); f.box(u, 3, 5, u + 3, 3, 8, cell(B.awning, 0)); for (const du of [0, 3]) f.box(u + du, 0, 8, u + du, 2, 8, B.oak_fence); f.set(u + 1, 1, 6, METAL(s + u)); }
    for (const [u, w] of [[3, 23], [44, 23], [20, 3], [28, 44]] as const) lamp(f, u, w, 5);
  },
  garage(f, plan, lot) {
    const box = footprint(lot)!;
    f.box(0, -1, 0, f.w - 1, -1, box[1]! - 1, B.asphalt);
    landmark(f, plan, lot, { wall: METAL(5), trim: METAL(1), window: WINDOW(2), ground: 'shop' });
    // Bunting poles over the forecourt.
    for (const u of [2, 16, 31, 45]) { f.box(u, 0, 1, u, 4, 1, B.steel_post); f.set(u, 5, 1, cell(B.sign_band, u & 7)); }
  },
  depot(f, plan, lot) {
    const box = footprint(lot)!, place = plan.places[lot.place]!;
    f.box(0, -1, 0, f.w - 1, -1, box[1]! - 1, B.asphalt);
    landmark(f, plan, lot, { wall: BRICK(1), trim: METAL(2), window: WINDOW(0), ground: 'lobby' });
    if (place.board) f.c.set(place.board[0], place.board[1], place.board[2], B.job_board);
    for (let k = 0; k < 6; k++) f.box(30 + k % 3 * 2, 0, 3 + (k / 3 | 0) * 2, 30 + k % 3 * 2, k % 2, 3 + (k / 3 | 0) * 2, B.crate);
    for (const u of [20, 26]) f.set(u, 0, box[1]! - 1, B.mailbox);
  },
  scrap(f, plan, lot) {
    const s = lot.style, box = footprint(lot)!;
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, B.gravel);
    // A fenced yard of junk piles round an office hut and a crusher.
    for (let u = 0; u < f.w; u++) if (Math.abs(u - (f.w >> 1)) > 3) { f.set(u, 0, 0, METAL(0)); f.set(u, 1, 0, METAL(0)); }
    for (const u of [0, f.w - 1]) f.box(u, 0, 0, u, 1, f.d - 1, METAL(0));
    f.box(0, 0, f.d - 1, f.w - 1, 1, f.d - 1, METAL(0));
    building(f, box, 0, { wall: METAL(4), trim: METAL(0), floor: CONCRETE(1), window: WINDOW(2), every: 4, run: 2, lit: 40, ground: 'shop', room: true, fit: 'desk', roof: 'flat', sign: SIGNS[plan.places[lot.place]!.kind] }, s);
    for (let k = 0; k < 40; k++) {
      const h = mix(s, k * 173), u = 2 + h % (f.w - 4), v = 22 + (h >>> 8) % (f.d - 25), tall = (h >>> 16) % 3;
      f.box(u, 0, v, u + (h >>> 20 & 1), tall, v + (h >>> 21 & 1), [B.crate, METAL(1), METAL(2), B.steel, METAL(3), B.iron_block][k % 6]!);
    }
    f.walls(34, 0, 6, 40, 4, 12, B.steel);
    f.box(35, 0, 6, 39, 3, 6, B.air);
    f.box(34, 5, 6, 40, 5, 12, METAL(4));
    lamp(f, 3, 3, 5);
    lamp(f, f.w - 4, 3, 5);
  },
  firehouse(f, plan, lot) {
    const [u0, v0, u1, v1] = footprint(lot)!, place = plan.places[lot.place]!, door = u0 + u1 >> 1;
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, B.asphalt);
    if (f.misses(0, 0, f.w - 1, f.d - 1)) return;
    // A red brick engine house: two tall bays either side of the watch room, a hose tower on the corner.
    f.box(u0, -1, v0, u1, -1, v1, CONCRETE(1));
    f.walls(u0, 0, v0, u1, 6, v1, B.bricks);
    f.walls(u0, 4, v0, u1, 4, v1, CONCRETE(2));
    f.box(u0, 7, v0, u1, 7, v1, CONCRETE(1));
    for (const u of [u0 + 3, u1 - 10]) { f.box(u, 0, v0, u + 7, 3, v0, B.air); f.box(u + 3, 5, v0 + 4, u + 4, 5, v0 + 4, LAMP); }
    f.box(door, 0, v0, door + 1, 2, v0, B.air);
    f.box(door - 2, 5, v0, door + 3, 5, v0, cell(B.sign_band, 0));
    for (const u of [door, door + 1]) f.set(u, 5, v0, cell(B.shop_sign, SIGNS.fire[0]));
    f.box(door - 3, 0, v0 + 7, door + 4, 0, v0 + 7, B.counter);
    f.set(door + 1, 1, v0 + 7, B.till);
    f.box(door, 6, v0 + 3, door + 1, 6, v0 + 3, LAMP);
    f.box(u1 - 3, 8, v1 - 3, u1 - 1, 13, v1 - 1, B.bricks);
    f.box(u1 - 3, 14, v1 - 3, u1 - 1, 14, v1 - 1, CONCRETE(2));
    f.set(u1 - 2, 15, v1 - 2, B.lantern);
    if (place.board) f.c.set(place.board[0], place.board[1], place.board[2], B.job_board);
    lamp(f, 1, 1, 5);
    lamp(f, f.w - 2, 1, 5);
  },
  busdepot(f, plan, lot) {
    const box = footprint(lot)!, place = plan.places[lot.place]!;
    f.box(0, -1, 0, f.w - 1, -1, f.d - 1, B.asphalt);
    // A yard of buses round a small ticket office, with a shelter for whoever is waiting.
    building(f, box, 0, { wall: STUCCO(5), trim: METAL(2), floor: PLAZA, window: WINDOW(1), every: 3, run: 2, lit: 50, ground: 'shop', room: true, fit: 'desk', roof: 'flat', sign: SIGNS.bus }, lot.style);
    if (place.board) f.c.set(place.board[0], place.board[1], place.board[2], B.job_board);
    for (const u of [36, 44]) f.box(u, 0, 4, u, 2, 4, B.steel_post);
    f.box(35, 3, 3, 45, 3, 5, cell(B.awning, 0));
    f.box(37, 0, 5, 43, 0, 5, B.oak_slab);
    for (let u = 2; u < 13; u += 6) for (const v of [4, 16]) f.set(u, -1, v, cell(B.asphalt, 5));
    lamp(f, 1, 1, 5);
    lamp(f, f.w - 2, 1, 5);
  },
  pier(f, plan, lot) {
    const c = f.c, TOP = GROUND - 1, end = SHORE + PIER.d, layout = layoutOf(lot);
    // Planks on posts out over the water, with a rail and a lamp every eight blocks.
    for (let z = Math.max(SHORE, c.z0); z < Math.min(end, c.z0 + CHUNK); z++) {
      c.box(PIER.x0, TOP, z, PIER.x0 + PIER.w - 1, TOP, z, B.oak_planks);
      if (z % 6 === 0) for (const x of [PIER.x0, PIER.x0 + PIER.w - 1]) c.box(x, SEABED, z, x, TOP - 1, z, B.oak_log);
      for (const x of [PIER.x0, PIER.x0 + PIER.w - 1]) c.set(x, GROUND, z, z % 8 === 4 ? B.oak_log : cell(B.oak_fence, 1 | 4));
      if (z % 8 === 4) for (const x of [PIER.x0, PIER.x0 + PIER.w - 1]) c.set(x, GROUND + 1, z, B.lantern);
    }
    // The head of the pier: a wide deck with the bait hut in the middle, open to the sea for fishing on three sides.
    const z0 = end - 10, z1 = lot.z1;
    c.box(lot.x0, TOP, z0, lot.x1, TOP, z1, B.oak_planks);
    for (const x of [lot.x0, lot.x1]) for (const z of [z0, z1]) { c.box(x, SEABED, z, x, TOP - 1, z, B.oak_log); c.box(x, GROUND, z, x, GROUND + 1, z, B.oak_log); c.set(x, GROUND + 2, z, B.lantern); }
    for (const x of [PIER.x0, PIER.x0 + PIER.w - 1]) c.box(x, GROUND, z0, x, GROUND + 1, z0 + 1, B.air);
    const [ku, kv] = layout.keeper;
    for (const [du, dv] of [[-3, -1], [3, -1], [-3, 2], [3, 2]] as const) f.box(ku + du, 0, kv + dv, ku + du, 3, kv + dv, B.oak_fence);
    f.box(ku - 3, 4, kv - 2, ku + 3, 4, kv + 2, cell(B.awning, 0));
    f.box(ku - 3, 0, layout.counterV, ku + 3, 0, layout.counterV, B.counter);
    f.set(ku - 2, 4, layout.counterV - 2, cell(B.shop_sign, SIGNS.bait[0]));
    f.box(ku + 2, 0, kv + 2, ku + 3, 0, kv + 2, B.crate);
    void plan;
  },
  isle(f, _plan, lot) {
    const c = f.c, x = ISLE.x, z = ISLE.z, top = GROUND + 2;
    if (lot.x1 < c.x0 || lot.x0 >= c.x0 + CHUNK) return;
    // The lighthouse: a banded tower on the summit with a lamp room and a gallery, a ladder up its lee side.
    for (let y = 0; y < 16; y++) c.box(x - 2, top + y, z - 2, x + 2, top + y, z + 2, y % 6 < 3 ? STUCCO(7) : STUCCO(4));
    c.box(x - 1, top, z - 1, x + 1, top + 15, z + 1, B.air);
    c.box(x, top, z - 2, x, top + 1, z - 2, B.air);
    c.box(x - 3, top + 16, z - 3, x + 3, top + 16, z + 3, CONCRETE(1));
    c.box(x - 1, top + 17, z - 1, x + 1, top + 19, z + 1, LIT(1));
    c.box(x - 2, top + 20, z - 2, x + 2, top + 20, z + 2, cell(B.roof_tiles, 0));
    c.box(x, top, z + 1, x, top + 16, z + 1, cell(B.ladder, 0));
    c.set(x, top + 16, z + 1, cell(B.ladder, 0));
    c.set(x, top + 16, z, B.air);
    // A shack, a jetty to the north, a landing pad and a few trees bent by the wind.
    c.box(x + 6, top - 1, z - 4, x + 10, top + 2, z, B.oak_planks);
    c.box(x + 7, top - 1 + 1, z - 3, x + 9, top + 1, z - 1, B.air);
    c.box(x + 6, top, z - 2, x + 6, top + 1, z - 2, B.air);
    c.box(x + 5, top + 3, z - 5, x + 11, top + 3, z + 1, cell(B.roof_tiles, 1));
    c.set(x + 8, top + 2, z - 2, B.lantern);
    c.box(x - 1, GROUND - 1, z - ISLE.r - 10, x + 1, GROUND - 1, z - 20, B.oak_planks);
    for (const dz of [-ISLE.r - 10, -ISLE.r - 4]) for (const dx of [-1, 1]) c.box(x + dx, SEABED, z + dz, x + dx, GROUND - 2, z + dz, B.oak_log);
    c.box(x - 15, GROUND, z + 2, x - 9, GROUND, z + 8, CONCRETE(2));
    c.box(x - 13, GROUND, z + 4, x - 11, GROUND, z + 6, cell(B.concrete, 1));
    for (const [dx, dz, tall] of [[-8, -9, 4], [9, 8, 5], [3, 12, 3], [-14, -4, 3]] as const) {
      const h = isleHeight(x + dx, z + dz) ?? 0, y = GROUND + h;
      c.box(x + dx, y, z + dz, x + dx, y + tall, z + dz, B.oak_log);
      c.box(x + dx - 2, y + tall, z + dz - 2, x + dx + 2, y + tall + 1, z + dz + 2, B.oak_leaves, true);
    }
  },
  hangar(f, plan, lot) {
    const s = lot.style, w = f.w, d = f.d, box = footprint(lot)!;
    // The airfield runs along u: the terminal by the gate, two helipads, two open hangars and the runway down the far side.
    f.box(0, -1, 0, w - 1, -1, d - 1, CONCRETE(0));
    f.box(4, -1, 44, w - 5, -1, 64, B.asphalt);
    for (let u = 8; u < w - 8; u += 6) f.box(u, -1, 54, u + 2, -1, 54, cell(B.concrete, 2));
    for (const u of [14, 44]) { f.box(u - 4, -1, 20, u + 4, -1, 28, B.asphalt); f.walls(u - 4, -1, 20, u + 4, -1, 28, cell(B.concrete, 2)); f.box(u - 1, -1, 23, u + 1, -1, 25, cell(B.concrete, 2)); }
    building(f, box, 1, { wall: CONCRETE(2), trim: METAL(2), floor: PLAZA, window: WINDOW(1), every: 3, run: 2, lit: 50, ground: 'lobby', room: true, fit: 'desk', roof: 'flat', sign: SIGNS[plan.places[lot.place]!.kind] }, s);
    // The control tower stands on the terminal's corner.
    f.box(box[2]! - 3, 9, box[1]! + 1, box[2]! - 1, 15, box[1]! + 3, CONCRETE(2));
    f.walls(box[2]! - 4, 16, box[1]!, box[2]!, 17, box[1]! + 4, WINDOW(1));
    f.box(box[2]! - 4, 18, box[1]!, box[2]!, 18, box[1]! + 4, CONCRETE(1));
    for (const u of [120, 200]) {
      f.walls(u, 0, 8, u + 30, 9, 30, METAL(u === 120 ? 2 : 3));
      f.box(u, 10, 8, u + 30, 10, 30, METAL(0));
      f.box(u + 3, 0, 30, u + 27, 7, 30, B.air);
      for (let k = u + 5; k < u + 30; k += 8) f.set(k, 9, 19, LAMP);
    }
    for (let u = 6; u < w - 6; u += 24) { lamp(f, u, 40, 5); lamp(f, u, 68, 5); }
  },
};

/** Gull Rock's ground at (x, z): how far its top stands above the street's level (−1: a sandbar under the waves; null: open sea). */
export function isleHeight(x: number, z: number): number | null {
  const d = Math.sqrt((x - ISLE.x) * (x - ISLE.x) + (z - ISLE.z) * (z - ISLE.z));
  return d > ISLE.r ? null : d > 23 ? -2 : d > 20 ? -1 : d > 15 ? 0 : d > 9 ? 1 : 2;
}
const BARS_X = cell(B.iron_bars, 2 | 8), BARS_Z = cell(B.iron_bars, 1 | 4), SEABED = 56;
/** A sign on a post: what marks a spot where something can be done. */
function signPost(c: Canvas, x: number, z: number, icon: number, height = 2) { c.box(x, GROUND, z, x, GROUND + height - 1, z, B.steel_post); c.set(x, GROUND + height, z, cell(B.shop_sign, icon)); }
/**
 * The small things that stand where the extras are: race flag posts on their corners, the stunt ramps, the lock-up cage,
 * the alarm bell post and the spray pad's sign. Painted into whichever chunk each cell falls in.
 */
export function paintExtras(c: Canvas, extras: Extras) {
  const near = (x: number, z: number, reach: number) => x + reach >= c.x0 && x - reach < c.x0 + CHUNK && z + reach >= c.z0 && z - reach < c.z0 + CHUNK;
  for (const spot of extras.spots) {
    if (!near(spot.x, spot.z, 14)) continue;
    const x = Math.floor(spot.x), z = Math.floor(spot.z);
    // A race starts in the middle of a crossing: its flag stands on the corner pavement, tall enough to find.
    if (spot.kind === 'race') { c.box(x + 6, GROUND, z - 6, x + 6, GROUND + 4, z - 6, B.steel_post); c.box(x + 6, GROUND + 5, z - 6, x + 6, GROUND + 6, z - 6, cell(B.shop_sign, 21)); }
    else if (spot.kind === 'alarm') signPost(c, x, z, 26);
    else if (spot.kind === 'lock') signPost(c, x, z, 25);
    else if (spot.kind === 'paint') { signPost(c, x + 3, z - 3, 23, 3); c.box(x - 2, GROUND - 1, z - 2, x + 2, GROUND - 1, z + 2, cell(B.asphalt, 5)); }
    else if (spot.kind === 'stall') c.set(x, GROUND + 4, z + 2, cell(B.shop_sign, 30));
    else if (spot.kind === 'prize') c.set(x, GROUND + 3, z + 2, cell(B.shop_sign, 24));
  }
  const cage = extras.cage;
  if (near((cage.x0 + cage.x1) / 2, (cage.z0 + cage.z1) / 2, 5)) {
    c.box(cage.x0, GROUND - 1, cage.z0, cage.x1, GROUND - 1, cage.z1, CONCRETE(1));
    for (let y = GROUND; y < GROUND + 3; y++) {
      c.box(cage.x0, y, cage.z0, cage.x1, y, cage.z0, BARS_X);
      c.box(cage.x0, y, cage.z1, cage.x1, y, cage.z1, BARS_X);
      c.box(cage.x0, y, cage.z0, cage.x0, y, cage.z1, BARS_Z);
      c.box(cage.x1, y, cage.z0, cage.x1, y, cage.z1, BARS_Z);
      for (const x of [cage.x0, cage.x1]) for (const z of [cage.z0, cage.z1]) c.set(x, y, z, B.steel);
    }
    c.box(cage.x0, GROUND + 3, cage.z0, cage.x1, GROUND + 3, cage.z1, METAL(0));
    c.set(cage.x0 + 2, GROUND, cage.z0 + 2, B.oak_slab);
  }
  for (const ramp of extras.ramps) {
    if (!near(ramp.x + ramp.dx * ramp.long / 2, ramp.z + ramp.dz * ramp.long / 2, ramp.long)) continue;
    for (let k = 0; k < ramp.long; k++) for (let w = 0; w < ramp.wide; w++) {
      // `wide` lies to the right of the way it climbs.
      const x = ramp.x + ramp.dx * k - ramp.dz * w, z = ramp.z + ramp.dz * k + ramp.dx * w, h = rampHeight(k);
      c.box(x, GROUND, z, x, GROUND + h - 2, z, CONCRETE(1));
      c.set(x, GROUND + h - 1, z, w === 1 ? cell(B.asphalt, ramp.dx ? 2 : 1) : B.asphalt);
    }
  }
}

/** A landmark building: the generic block with a sign over the door, a counter inside and lamps on the forecourt. */
function landmark(f: Frame, plan: CityPlan, lot: Lot, o: { wall: number; trim: number; window: number; ground: Look['ground']; lit?: number; every?: number }) {
  const box = footprint(lot)!, place = plan.places[lot.place];
  if (lot.kind !== 'garage' && lot.kind !== 'depot') f.box(0, -1, 0, f.w - 1, -1, f.d - 1, PLAZA);
  building(f, box, lot.floors, { wall: o.wall, trim: o.trim, floor: PLAZA, window: o.window, every: o.every ?? 3, run: 2, lit: o.lit ?? 35, ground: o.ground, room: !!place || o.ground === 'lobby', fit: 'desk', roof: 'flat',
    ...place ? { sign: SIGNS[place.kind] } : {} }, lot.style);
  if (lot.kind === 'bank') {
    // The vault: a steel room behind the counter, its round door facing the hall.
    const [u0, v0, u1] = box, door = u0! + u1! >> 1, back = v0! + ROOM;
    f.box(door - 2, 0, back, door + 3, 3, back + 5, B.steel);
    f.box(door - 1, 0, back + 1, door + 2, 2, back + 4, B.air);
    f.box(door, 0, back, door + 1, 1, back, cell(B.vault_door, f.dir(0)));
    f.box(door - 1, 0, back + 4, door + 2, 0, back + 4, B.gold_block);
    for (let u = u0! + 3; u < u1! - 1; u += 5) if (Math.abs(u - door) > 3) f.box(u, 0, v0! - 2, u, STOREY.ground - 1, v0! - 2, CONCRETE(2));
  }
  if (place?.board && lot.kind !== 'depot') f.c.set(place.board[0], place.board[1], place.board[2], B.job_board);
  for (const u of [3, f.w - 4]) lamp(f, u, 2);
}

/** Paint the part of a lot that lies in the canvas's chunk. */
export function paintLot(canvas: Canvas, plan: CityPlan, lot: Lot) {
  if (lot.x1 < canvas.x0 || lot.x0 >= canvas.x0 + CHUNK || lot.z1 < canvas.z0 || lot.z0 >= canvas.z0 + CHUNK) return;
  PAINTERS[lot.kind](new Frame(canvas, lot), plan, lot);
}
