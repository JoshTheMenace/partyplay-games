/* Shared collision, sight and navigation. The server decides; the renderer draws the same answers. */
import { RADIUS, type HeistMap, type MapObject, type Point, type Smoke } from './model';

/** Dynamic occupancy for one moment: solid blocks movement, opaque blocks sight. */
export type Grid = { width: number; height: number; solid: Uint8Array; opaque: Uint8Array };
const SOLID_TILES = '#%=~ w', OPAQUE_TILES = '#% ';
const SOLID_OBJECTS: readonly MapObject['kind'][] = ['safe', 'terminal', 'objective'];

/** Door and window objects in map order; View.doors has one char per entry. */
export const doorObjects = (map: HeistMap) => map.objects.filter(o => o.kind === 'door' || o.kind === 'window');
export const cellIndex = (map: { width: number }, p: Point) => Math.floor(p.y) * map.width + Math.floor(p.x);

/** doors: View.doors string (c closed, o open, l locked, b broken). broken: cells turned to floor. */
export function buildGrid(map: HeistMap, doors: string, broken: Iterable<number> = []): Grid {
  const { width, height } = map, solid = new Uint8Array(width * height), opaque = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = map.tiles[y][x], i = y * width + x;
    solid[i] = +SOLID_TILES.includes(c); opaque[i] = +OPAQUE_TILES.includes(c);
  }
  for (const p of map.props) if (p.solid) for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) solid[(p.y + dy) * width + p.x + dx] = 1;
  for (const o of map.objects) if (SOLID_OBJECTS.includes(o.kind)) solid[cellIndex(map, o)] = 1;
  doorObjects(map).forEach((o, n) => {
    const i = cellIndex(map, o), state = doors[n] ?? 'c';
    if (o.kind === 'door') { solid[i] = opaque[i] = +(state === 'c' || state === 'l'); }
    else solid[i] = +(state !== 'b');
  });
  for (const i of broken) { solid[i] = 0; opaque[i] = 0; }
  return { width, height, solid, opaque };
}

const blocked = (cells: Uint8Array, g: Grid, x: number, y: number) => x < 0 || y < 0 || x >= g.width || y >= g.height || cells[y * g.width + x] === 1;
export const isSolid = (g: Grid, x: number, y: number) => blocked(g.solid, g, Math.floor(x), Math.floor(y));
export const isOpaque = (g: Grid, x: number, y: number) => blocked(g.opaque, g, Math.floor(x), Math.floor(y));

/** Exact grid ray (Amanatides–Woo): distance to the first opaque cell, or maxDist. The origin cell never blocks. */
export function castRay(g: Grid, ox: number, oy: number, dx: number, dy: number, maxDist: number, cells = g.opaque): number {
  let x = Math.floor(ox), y = Math.floor(oy);
  const sx = Math.sign(dx), sy = Math.sign(dy), tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity;
  let tx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity, ty = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
  for (let n = 0; n < 256; n++) {
    const t = Math.min(tx, ty);
    if (t >= maxDist) return maxDist;
    if (Math.abs(tx - ty) < 1e-9) {
      // Exactly through a corner: two touching opaque cells seal it.
      if (blocked(cells, g, x + sx, y) && blocked(cells, g, x, y + sy)) return t;
      x += sx; y += sy; tx += tdx; ty += tdy;
    } else if (tx < ty) { x += sx; tx += tdx; } else { y += sy; ty += tdy; }
    if (blocked(cells, g, x, y)) return t;
  }
  return maxDist;
}

/** Distance along a ray to the nearest active smoke cloud, or Infinity. */
export function smokeHit(smoke: readonly Smoke[], now: number, ox: number, oy: number, dx: number, dy: number): number {
  let best = Infinity;
  for (const s of smoke) {
    if (s.until <= now) continue;
    const fx = ox - s.x, fy = oy - s.y, b = fx * dx + fy * dy, c = fx * fx + fy * fy - s.radius * s.radius;
    if (c <= 0) return 0;
    const disc = b * b - c;
    if (disc >= 0 && -b - Math.sqrt(disc) > 0) best = Math.min(best, -b - Math.sqrt(disc));
  }
  return best;
}

/** True when nothing opaque (or smoke, if given) lies between a and b. */
export function lineOfSight(g: Grid, a: Point, b: Point, smoke: readonly Smoke[] = [], now = 0): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 1e-6) return true;
  const dx = (b.x - a.x) / d, dy = (b.y - a.y) / d;
  return castRay(g, a.x, a.y, dx, dy, d) >= d - 1e-6 && smokeHit(smoke, now, a.x, a.y, dx, dy) >= d;
}

/** Can a circle travel straight from a to b without touching solid cells? */
export function clearPath(g: Grid, a: Point, b: Point, radius: number = RADIUS.actor): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(d / .15));
  for (let i = 0; i <= steps; i++) if (!fits(g, a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, radius)) return false;
  return true;
}

export function fits(g: Grid, px: number, py: number, radius: number = RADIUS.actor): boolean {
  for (let y = Math.floor(py - radius); y <= Math.floor(py + radius); y++) for (let x = Math.floor(px - radius); x <= Math.floor(px + radius); x++) {
    if (blocked(g.solid, g, x, y) && Math.hypot(px - Math.max(x, Math.min(px, x + 1)), py - Math.max(y, Math.min(py, y + 1))) < radius - 1e-9) return false;
  }
  return true;
}

/** Slides a circle along walls, one axis at a time, in small substeps. */
export function moveCircle(g: Grid, p: Point, dx: number, dy: number, radius: number = RADIUS.actor): Point {
  const out = { x: p.x, y: p.y };
  if (![p.x, p.y, dx, dy].every(Number.isFinite)) return out;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / .08));
  for (let i = 0; i < steps; i++) {
    if (fits(g, out.x + dx / steps, out.y, radius)) out.x += dx / steps;
    if (fits(g, out.x, out.y + dy / steps, radius)) out.y += dy / steps;
  }
  return out;
}

/**
 * Sight polygon around origin, clipped by opaque cells and smoke. With from/to it is a cone and starts at the origin.
 * Rays go to a uniform fan plus both sides of every nearby opaque corner, so shadow edges are exact.
 */
export function sightPolygon(g: Grid, origin: Point, radius: number, smoke: readonly Smoke[] = [], now = 0, from = -Math.PI, to = Math.PI, rays = 240): Point[] {
  const cone = to - from < Math.PI * 2 - 1e-6, angles: number[] = [];
  for (let i = 0; i <= rays; i++) angles.push(from + (to - from) * i / rays);
  const x0 = Math.max(0, Math.floor(origin.x - radius)), x1 = Math.min(g.width, Math.ceil(origin.x + radius)), y0 = Math.max(0, Math.floor(origin.y - radius)), y1 = Math.min(g.height, Math.ceil(origin.y + radius));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    // A lattice point is a corner when its four surrounding cells are not all alike.
    const n = +isOpaque(g, x - 1, y - 1) + +isOpaque(g, x, y - 1) + +isOpaque(g, x - 1, y) + +isOpaque(g, x, y);
    if (n === 0 || n === 4 || Math.hypot(x - origin.x, y - origin.y) > radius) continue;
    const a = Math.atan2(y - origin.y, x - origin.x);
    for (const e of [-1e-4, 1e-4]) {
      let t = a + e;
      if (cone) { while (t < from) t += Math.PI * 2; while (t > to) t -= Math.PI * 2; if (t < from) continue; }
      angles.push(t);
    }
  }
  angles.sort((a, b) => a - b);
  const points: Point[] = cone ? [{ x: origin.x, y: origin.y }] : [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a), d = Math.min(castRay(g, origin.x, origin.y, dx, dy, radius), smokeHit(smoke, now, origin.x, origin.y, dx, dy));
    points.push({ x: origin.x + dx * d, y: origin.y + dy * d });
  }
  return points;
}

/**
 * A* over cells (8-way, no corner cutting) on a blocked mask, then string-pulled with clearPath.
 * Returns waypoints after `from`, ending at `to`; empty when unreachable.
 */
export function findPath(g: Grid, blockedCells: Uint8Array, from: Point, to: Point, limit = 2400): Point[] {
  const w = g.width, start = Math.floor(from.y) * w + Math.floor(from.x), goal = Math.floor(to.y) * w + Math.floor(to.x);
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < g.height && !blockedCells[y * w + x];
  if (!free(goal % w, Math.floor(goal / w))) return [];
  if (start === goal) return [{ x: to.x, y: to.y }];
  const cost = new Float32Array(w * g.height).fill(Infinity), prev = new Int32Array(w * g.height).fill(-1), open: number[] = [start], score = new Float32Array(w * g.height);
  const h = (i: number) => { const dx = Math.abs(i % w - goal % w), dy = Math.abs(Math.floor(i / w) - Math.floor(goal / w)); return Math.max(dx, dy) + .414 * Math.min(dx, dy); };
  cost[start] = 0; score[start] = h(start);
  for (let n = 0; open.length && n < limit; n++) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (score[open[i]] < score[open[best]]) best = i;
    const cur = open.splice(best, 1)[0];
    if (cur === goal) break;
    const cx = cur % w, cy = Math.floor(cur / w);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || !free(cx + dx, cy + dy) || (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy)))) continue;
      const next = (cy + dy) * w + cx + dx, c = cost[cur] + (dx && dy ? 1.414 : 1);
      if (c < cost[next]) { cost[next] = c; prev[next] = cur; score[next] = c + h(next); if (!open.includes(next)) open.push(next); }
    }
  }
  if (prev[goal] < 0) return [];
  const cells: Point[] = [];
  for (let i = goal; i !== start; i = prev[i]) cells.push({ x: i % w + .5, y: Math.floor(i / w) + .5 });
  cells.reverse(); cells[cells.length - 1] = { x: to.x, y: to.y };
  const path: Point[] = [];
  let anchor = from;
  for (let i = 0; i < cells.length; i++) {
    let j = i;
    while (j + 1 < cells.length && clearPathMask(g, blockedCells, anchor, cells[j + 1])) j++;
    path.push(cells[j]); anchor = cells[j]; i = j;
  }
  return path;
}

function clearPathMask(g: Grid, cells: Uint8Array, a: Point, b: Point) {
  return clearPath({ ...g, solid: cells }, a, b, RADIUS.actor + .02);
}
