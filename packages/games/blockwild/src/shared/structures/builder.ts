/**
 * Structure blueprints. A structure is planned once per seed into a list of paint operations, then bucketed by chunk,
 * so each chunk paints exactly its share and large structures cross chunk borders seamlessly. Every operation reads
 * at most its own column of the chunk being painted (never a neighbour chunk), so the result does not depend on which
 * chunk is generated first. Pieces are drawn in a rotated local frame (`Frame`): u runs left→right along the front,
 * v runs front→back, and the front faces local north; `r` quarter-turns clockwise put the front towards N, E, S or W.
 */
import { B, blockOf, cellId, DOOR_OPEN, DOOR_UPPER, isFullCube, isSolid, makeCell, SLAB_BOTTOM } from '../blocks';
import { CHUNK, HEIGHT } from '../constants';
import { cellIndex, chunkKey, FACING, localIndex, type Vec3 } from '../coords';
import { surfaceHeight } from '../worldgen';

/** Inclusive world-cell bounds [x0, y0, z0, x1, y1, z1]. */
export type Bounds = [number, number, number, number, number, number];

/**
 * Paint operations, 5 numbers each: [op, x, y, z, cell].
 * set: write. solid: write over solid cells only (dungeon walls keep their cave openings). air: write into air only.
 * fill: write into non-solid cells (floors over caves). foundation: write downwards until solid ground (max 24).
 * clear: air from y to the sky (levelling). path: pave the ground near y and clear the plants on it. fence: a fence whose
 * connections to cells in the same chunk are resolved after painting (connections across the border come from the plan).
 */
export const OP = { set: 0, solid: 1, air: 2, fill: 3, foundation: 4, clear: 5, path: 6, fence: 7 } as const;
const STRIDE = 5, FOUNDATION_DEPTH = 24;
const TREE = new Set<number>([B.oak_log, B.oak_leaves, B.birch_log, B.birch_leaves, B.spruce_log, B.spruce_leaves]);
const PAVABLE = new Set<number>([B.grass_block, B.dirt, B.snowy_grass, B.sand, B.gravel]);
/** Ground a foundation rests on: anything solid except trees. */
const isGround = (cell: number) => isSolid(cell) && !TREE.has(cellId(cell));
/** Loose cover a path clears: plants, cacti and stray tree blocks. */
const isCover = (cell: number) => {
  const shape = blockOf(cell).shape;
  return shape === 'cross' || shape === 'cactus' || TREE.has(cellId(cell));
};

export class Blueprint {
  readonly ops: number[] = [];
  private box: Bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  op(code: number, x: number, y: number, z: number, cell = 0) {
    if (y < 1 || y >= HEIGHT) return;
    this.ops.push(code, x, y, z, cell);
    const box = this.box;
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.min(box[2], z);
    box[3] = Math.max(box[3], x); box[4] = Math.max(box[4], y); box[5] = Math.max(box[5], z);
  }
  set(x: number, y: number, z: number, cell: number) { this.op(OP.set, x, y, z, cell); }
  get bounds(): Bounds { return [...this.box] as Bounds; }
  /** Resolve fence connections within the plan and bucket the operations by chunk key. */
  bake(): Map<number, Int32Array> {
    const placed = new Map<number, number>(), ops = this.ops;
    for (let i = 0; i < ops.length; i += STRIDE) if (ops[i] === OP.set || ops[i] === OP.fence) placed.set(cellIndex(ops[i + 1]!, ops[i + 2]!, ops[i + 3]!), ops[i + 4]!);
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < ops.length; i += STRIDE) {
      const [code, x, y, z] = [ops[i]!, ops[i + 1]!, ops[i + 2]!, ops[i + 3]!];
      let cell = ops[i + 4]!;
      if (code === OP.fence) {
        let bits = 0;
        FACING.forEach(([dx, dz], dir) => { if (joinsFence(placed.get(cellIndex(x + dx, y, z + dz)) ?? B.air)) bits |= 1 << dir; });
        cell = makeCell(B.oak_fence, bits);
      }
      const key = chunkKey(x >> 4, z >> 4);
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = []);
      bucket.push(code, x, y, z, cell);
    }
    return new Map([...buckets].map(([key, list]) => [key, Int32Array.from(list)]));
  }
}
const joinsFence = (cell: number) => cellId(cell) === B.oak_fence || isFullCube(cell) && cellId(cell) !== B.barrier;

/** Paint one chunk's bucket of operations into `cells` (chunk origin x0, z0). */
export function paintOps(ops: Int32Array, x0: number, z0: number, cells: Uint16Array) {
  let fences = false;
  for (let i = 0; i < ops.length; i += STRIDE) {
    const code = ops[i]!, lx = ops[i + 1]! - x0, y = ops[i + 2]!, lz = ops[i + 3]! - z0, cell = ops[i + 4]!, at = localIndex(lx, y, lz), old = cells[at]!;
    switch (code) {
      case OP.set: cells[at] = cell; break;
      case OP.fence: cells[at] = cell; fences = true; break;
      case OP.solid: if (isSolid(old)) cells[at] = cell; break;
      case OP.air: if (old === B.air) cells[at] = cell; break;
      case OP.fill: if (!isSolid(old)) cells[at] = cell; break;
      case OP.foundation:
        for (let yy = y; yy > 0 && y - yy < FOUNDATION_DEPTH && !isGround(cells[localIndex(lx, yy, lz)]!); yy--) cells[localIndex(lx, yy, lz)] = cell;
        break;
      case OP.clear: for (let yy = y; yy < HEIGHT; yy++) cells[localIndex(lx, yy, lz)] = B.air; break;
      case OP.path: pave(cells, lx, y, lz, cell); break;
    }
  }
  if (fences) connectFences(ops, x0, z0, cells);
}

/** Pave the ground at the top of a column near `y` (water becomes gravel), clearing plants and cacti standing on it. */
function pave(cells: Uint16Array, lx: number, y: number, lz: number, path: number) {
  let g = Math.min(HEIGHT - 2, y + 2);
  while (g > y - 4 && (cells[localIndex(lx, g, lz)] === B.air || isCover(cells[localIndex(lx, g, lz)]!))) g--;
  const at = localIndex(lx, g, lz), ground = cellId(cells[at]!);
  if (ground === B.water) cells[at] = B.gravel;
  else if (PAVABLE.has(ground)) cells[at] = path;
  else if (!isSolid(cells[at]!)) return;
  for (let yy = g + 1; yy < HEIGHT && isCover(cells[localIndex(lx, yy, lz)]!); yy++) cells[localIndex(lx, yy, lz)] = B.air;
}

/** Connect painted fences to the fences and full cubes beside them in this chunk. */
function connectFences(ops: Int32Array, x0: number, z0: number, cells: Uint16Array) {
  for (let i = 0; i < ops.length; i += STRIDE) {
    if (ops[i] !== OP.fence) continue;
    const lx = ops[i + 1]! - x0, y = ops[i + 2]!, lz = ops[i + 3]! - z0, at = localIndex(lx, y, lz);
    if (cellId(cells[at]!) !== B.oak_fence) continue;
    let bits = cells[at]! >> 8;
    FACING.forEach(([dx, dz], dir) => {
      const nx = lx + dx, nz = lz + dz;
      if (nx < 0 || nz < 0 || nx >= CHUNK || nz >= CHUNK) return;
      bits = joinsFence(cells[localIndex(nx, y, nz)]!) ? bits | 1 << dir : bits & ~(1 << dir);
    });
    cells[at] = makeCell(B.oak_fence, bits);
  }
}

/** Log axis in a frame: along the vertical, the local u (width) or the local v (depth) direction. */
export type Axis = 'y' | 'u' | 'v';

/** A rotated local drawing frame of w × d columns whose floor is at world y0 (local y 0). */
export class Frame {
  constructor(readonly bp: Blueprint, readonly x0: number, readonly y0: number, readonly z0: number, readonly w: number, readonly d: number, readonly r: number) {}
  /** World column of local (u, v). */
  x(u: number, v: number) { return this.x0 + [u, this.d - 1 - v, this.w - 1 - u, v][this.r & 3]!; }
  z(u: number, v: number) { return this.z0 + [v, u, this.d - 1 - v, this.w - 1 - u][this.r & 3]!; }
  /** World facing (0..3 N, E, S, W) of a local facing. */
  dir(f: number) { return (f + this.r) & 3; }
  at(u: number, y: number, v: number): Vec3 { return [this.x(u, v), this.y0 + y, this.z(u, v)]; }
  op(code: number, u: number, y: number, v: number, cell = 0) { this.bp.op(code, this.x(u, v), this.y0 + y, this.z(u, v), cell); }
  set(u: number, y: number, v: number, cell: number) { this.op(OP.set, u, y, v, cell); }
  box(u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, cell: number, code: number = OP.set) {
    for (let y = y0; y <= y1; y++) for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) this.op(code, u, y, v, cell);
  }
  /** The border of a rectangle at one height. */
  ring(u0: number, y: number, v0: number, u1: number, v1: number, cell: number) {
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) if (u === u0 || u === u1 || v === v0 || v === v1) this.set(u, y, v, cell);
  }
  /**
   * Level a rectangle onto the terrain: `fill` from the floor down to solid ground, `top` as the floor (local y 0) and
   * air above it to the sky, so no hill cuts through the piece and nothing floats.
   */
  level(u0: number, v0: number, u1: number, v1: number, top: number, fill: number) {
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      this.op(OP.foundation, u, -1, v, fill);
      this.set(u, 0, v, top);
      this.op(OP.clear, u, 1, v);
    }
  }
  /** A block with a horizontal facing (stairs, chests, furnaces...) given in local terms, plus extra state bits. */
  facing(id: number, u: number, y: number, v: number, f: number, extra = 0) { this.set(u, y, v, makeCell(id, this.dir(f) | extra)); }
  stairs(id: number, u: number, y: number, v: number, f: number, upsideDown = false) { this.facing(id, u, y, v, f, upsideDown ? 4 : 0); }
  slab(id: number, u: number, y: number, v: number, state = SLAB_BOTTOM) { this.set(u, y, v, makeCell(id, state)); }
  log(id: number, u: number, y: number, v: number, axis: Axis = 'y') {
    const alongX = (axis === 'u') === (this.r % 2 === 0);
    this.set(u, y, v, makeCell(id, axis === 'y' ? 0 : alongX ? 1 : 2));
  }
  /** An open two-block door (villagers walk only through open doors) whose lower half is at (u, y, v); f is the way it faces. */
  door(id: number, u: number, y: number, v: number, f: number) {
    this.facing(id, u, y, v, f, DOOR_OPEN);
    this.facing(id, u, y + 1, v, f, DOOR_OPEN | DOOR_UPPER);
  }
  /** A bed with its foot at (u, y, v) and its head one step towards local facing f. Returns the foot's world cell. */
  bed(u: number, y: number, v: number, f: number): Vec3 {
    const [du, dv] = FACING[f]!;
    this.facing(B.bed, u, y, v, f);
    this.facing(B.bed, u + du, y, v + dv, f, 4);
    return this.at(u, y, v);
  }
  /** A wall torch pointing towards local facing f (it hangs on the block behind it). */
  torch(u: number, y: number, v: number, f: number) { this.set(u, y, v, makeCell(B.torch, 1 + this.dir(f))); }
  fence(u: number, y: number, v: number) { this.op(OP.fence, u, y, v, B.oak_fence); }
  /** World bounds of the frame's footprint between local heights y0 and y1. */
  bounds(y0: number, y1: number): Bounds {
    const xs = [this.x(0, 0), this.x(this.w - 1, this.d - 1)], zs = [this.z(0, 0), this.z(this.w - 1, this.d - 1)];
    return [Math.min(...xs), this.y0 + y0, Math.min(...zs), Math.max(...xs), this.y0 + y1, Math.max(...zs)];
  }
}

/** World footprint size (x extent, z extent) of a w × d frame turned r quarter-turns. */
export const footprint = (w: number, d: number, r: number): [number, number] => r % 2 ? [d, w] : [w, d];

/** Terrain heights (before caves) over a world rectangle, sampled every `step` blocks plus the far edges. */
export function heights(seed: number, x0: number, z0: number, x1: number, z1: number, step = 2): { min: number; max: number; mean: number } {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (let z = z0; ; z = Math.min(z1, z + step)) {
    for (let x = x0; ; x = Math.min(x1, x + step)) {
      const h = surfaceHeight(seed, x, z);
      min = Math.min(min, h);
      max = Math.max(max, h);
      sum += h;
      n++;
      if (x === x1) break;
    }
    if (z === z1) break;
  }
  return { min, max, mean: sum / n };
}

/** Axis-aligned world rectangles [x0, z0, x1, z1] (inclusive) for layout overlap tests. */
export type Rect = [number, number, number, number];
export const overlaps = (a: Rect, b: Rect, gap = 0) => a[0] <= b[2] + gap && b[0] <= a[2] + gap && a[1] <= b[3] + gap && b[1] <= a[3] + gap;
export const boundsRect = (b: Bounds): Rect => [b[0], b[2], b[3], b[5]];
export const boxesTouch = (a: Bounds, b: Bounds) => a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];
