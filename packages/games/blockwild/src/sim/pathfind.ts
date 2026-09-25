/** Bounded A* over walkable cells for mobs: walk, jump one block, drop up to three, swim, 8-way with corner checks. */
import { B, cellId, cellState, isLava, isWater } from '../shared/blocks';
import type { CellReader } from '../shared/chunk';
import type { Vec3 } from '../shared/coords';
import { collisionBoxes, doorSide } from '../shared/shapes';

export type PathOptions = { height: number; maxNodes: number; range: number };
export type PathResult = { path: Vec3[]; reached: boolean; expanded: number };

const key = (x: number, y: number, z: number) => x + 4096 * (z + 4096 * y);
const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const isDoor = (cell: number) => cellId(cell) === B.oak_door || cellId(cell) === B.iron_door;
/** A mob body can occupy the cell: no collision, or a door (its thin panel only blocks crossing its own side; see `doorBlocks`). */
export const passable = (cell: number) => collisionBoxes(cell).length === 0 || isDoor(cell);
/** Side (0 N, 1 E, 2 S, 3 W) a one-cell step of (dx, dz) leaves through. */
const sideOf = (dx: number, dz: number) => dz < 0 ? 0 : dx > 0 ? 1 : dz > 0 ? 2 : 3;
/** A door panel (open or closed) at levels y..y+levels-1 blocks the step from (x, z) to (x + dx, z + dz). */
function doorBlocks(get: CellReader, x: number, y: number, z: number, dx: number, dz: number, levels: number) {
  const out = sideOf(dx, dz);
  for (let i = 0; i < levels; i++) {
    const here = get(x, y + i, z), there = get(x + dx, y + i, z + dz);
    if (isDoor(here) && doorSide(cellState(here)) === out || isDoor(there) && doorSide(cellState(there)) === (out + 2) % 4) return true;
  }
  return false;
}

/** Min-heap of node keys ordered by f score. */
class Heap {
  keys: number[] = [];
  scores: number[] = [];
  get size() { return this.keys.length; }
  push(k: number, score: number) {
    let i = this.keys.length;
    this.keys.push(k);
    this.scores.push(score);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[parent]! <= score) break;
      this.keys[i] = this.keys[parent]!;
      this.scores[i] = this.scores[parent]!;
      i = parent;
    }
    this.keys[i] = k;
    this.scores[i] = score;
  }
  pop(): number {
    const top = this.keys[0]!, lastKey = this.keys.pop()!, lastScore = this.scores.pop()!;
    const n = this.keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, ms = lastScore;
        if (l < n && this.scores[l]! < ms) { m = l; ms = this.scores[l]!; }
        if (r < n && this.scores[r]! < ms) m = r;
        if (m === i) break;
        this.keys[i] = this.keys[m]!;
        this.scores[i] = this.scores[m]!;
        i = m;
      }
      this.keys[i] = lastKey;
      this.scores[i] = lastScore;
    }
    return top;
  }
}

/**
 * Path from the start cell (the mob's feet cell) towards the goal cell. When the goal is not reached within the node
 * budget or range, returns the path to the explored cell closest to the goal (good enough to keep chasing).
 */
export function findPath(get: CellReader, start: Vec3, goal: Vec3, options: PathOptions): PathResult {
  const { height, maxNodes, range } = options, [sx, sy, sz] = start, [gx, gy, gz] = goal;
  const standMemo = new Map<number, boolean>();
  const clear = (x: number, y: number, z: number) => passable(get(x, y, z));
  const standable = (x: number, y: number, z: number): boolean => {
    const k = key(x, y, z);
    let ok = standMemo.get(k);
    if (ok !== undefined) return ok;
    ok = true;
    for (let i = 0; i < height && ok; i++) ok = clear(x, y + i, z);
    if (ok) {
      const below = get(x, y - 1, z), feet = get(x, y, z);
      ok = !isLava(feet) && (isWater(feet) || collisionBoxes(below).length > 0 && cellId(below) !== B.cactus && cellId(below) !== B.barrier);
    }
    standMemo.set(k, ok);
    return ok;
  };
  const h = (x: number, y: number, z: number) => {
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(y - gy);
  };
  const g = new Map<number, number>(), parent = new Map<number, number>(), closed = new Set<number>(), open = new Heap();
  const startKey = key(sx, sy, sz);
  g.set(startKey, 0);
  open.push(startKey, h(sx, sy, sz));
  let best = startKey, bestH = h(sx, sy, sz), expanded = 0, reached = false;
  const decode = (k: number): Vec3 => { const x = k % 4096, rest = (k - x) / 4096, z = rest % 4096; return [x, (rest - z) / 4096, z]; };

  while (open.size && expanded < maxNodes) {
    const current = open.pop();
    if (closed.has(current)) continue;
    closed.add(current);
    expanded++;
    const [x, y, z] = decode(current), here = h(x, y, z);
    if (here < bestH) { best = current; bestH = here; }
    if (Math.abs(x - gx) <= 1 && Math.abs(z - gz) <= 1 && Math.abs(y - gy) <= 1) { best = current; reached = true; break; }
    const base = g.get(current)!, headroom = clear(x, y + height, z);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz, diagonal = dx !== 0 && dz !== 0;
      if (Math.abs(nx - sx) > range || Math.abs(nz - sz) > range) continue;
      if (diagonal && !(standable(x + dx, y, z) && standable(x, y, z + dz))) continue;
      let ny = -1;
      if (standable(nx, y, nz)) ny = y;
      else if (!diagonal && headroom && standable(nx, y + 1, nz)) ny = y + 1;
      else if (!diagonal && clear(nx, y, nz) && clear(nx, y + height - 1, nz)) {
        for (let drop = 1; drop <= 3 && ny < 0; drop++) {
          if (!clear(nx, y - drop, nz)) break;
          if (standable(nx, y - drop, nz)) ny = y - drop;
        }
      }
      if (ny < 0) continue;
      // Diagonals brush both orthogonal neighbours, so both L-shaped routes must be free of door panels.
      const blocked = diagonal
        ? doorBlocks(get, x, y, z, dx, 0, height) || doorBlocks(get, x + dx, y, z, 0, dz, height) || doorBlocks(get, x, y, z, 0, dz, height) || doorBlocks(get, x, y, z + dz, dx, 0, height)
        : doorBlocks(get, x, Math.min(y, ny), z, dx, dz, height + Math.abs(ny - y));
      if (blocked) continue;
      const next = key(nx, ny, nz);
      if (closed.has(next)) continue;
      const cost = base + (diagonal ? 1.414 : 1) + (ny > y ? 0.5 : 0) + (isWater(get(nx, ny, nz)) ? 2 : 0);
      if (cost >= (g.get(next) ?? Infinity)) continue;
      g.set(next, cost);
      parent.set(next, current);
      open.push(next, cost + h(nx, ny, nz));
    }
  }
  const path: Vec3[] = [];
  for (let k: number | undefined = best; k !== undefined && k !== startKey; k = parent.get(k)) path.push(decode(k));
  path.reverse();
  return { path, reached, expanded };
}
