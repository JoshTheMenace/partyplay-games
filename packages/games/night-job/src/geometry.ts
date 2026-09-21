import type { ObjectView, Point } from './model.js';

const closedDoor = (objects: readonly ObjectView[], x: number, y: number) => objects.some(o => o.kind === 'door' && o.state !== 'open' && Math.floor(o.x) === x && Math.floor(o.y) === y);
export function solid(tiles: string[], objects: readonly ObjectView[], x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  return !tiles[y]?.[x] || '#%=~'.includes(tiles[y][x]) || closedDoor(objects, x, y);
}
export function opaque(tiles: string[], objects: readonly ObjectView[], x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  return !tiles[y]?.[x] || '#%'.includes(tiles[y][x]) || closedDoor(objects, x, y);
}

// Supercover grid traversal visits both neighboring cells when a ray crosses a corner.
function trace(tiles: string[], objects: readonly ObjectView[], from: Point, to: Point, revealWall = false): boolean {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return false;
  let x = Math.floor(from.x), y = Math.floor(from.y);
  const endX = Math.floor(to.x), endY = Math.floor(to.y), dx = to.x - from.x, dy = to.y - from.y;
  const sx = Math.sign(dx), sy = Math.sign(dy), stepX = Math.abs(1 / dx), stepY = Math.abs(1 / dy);
  let nextX = dx ? (sx > 0 ? x + 1 - from.x : from.x - x) / Math.abs(dx) : Infinity;
  let nextY = dy ? (sy > 0 ? y + 1 - from.y : from.y - y) / Math.abs(dy) : Infinity;
  const blocked = (cx: number, cy: number) => opaque(tiles, objects, cx, cy);
  for (let n = 0; n <= (tiles[0]?.length ?? 0) + tiles.length + 2; n++) {
    if (x === endX && y === endY) return revealWall || !blocked(x, y);
    if (blocked(x, y)) return false;
    if (!dx && from.x === x && blocked(x - 1, y)) return false;
    if (!dy && from.y === y && blocked(x, y - 1)) return false;
    if (Math.abs(nextX - nextY) < 1e-10) {
      if (blocked(x + sx, y) || blocked(x, y + sy)) return false;
      x += sx; y += sy; nextX += stepX; nextY += stepY;
    } else if (nextX < nextY) { x += sx; nextX += stepX; }
    else { y += sy; nextY += stepY; }
  }
  return false;
}
export const lineOfSight = (tiles: string[], objects: readonly ObjectView[], from: Point, to: Point): boolean => trace(tiles, objects, from, to);

export function move(tiles: string[], objects: readonly ObjectView[], position: Point, dx: number, dy: number, radius = .28): Point {
  const result = { ...position };
  if (![position.x, position.y, dx, dy, radius].every(Number.isFinite) || radius <= 0) return result;
  const fits = (px: number, py: number) => {
    for (let y = Math.floor(py - radius); y <= Math.floor(py + radius); y++) {
      for (let x = Math.floor(px - radius); x <= Math.floor(px + radius); x++) {
        if (solid(tiles, objects, x, y) && Math.hypot(px - Math.max(x, Math.min(px, x + 1)), py - Math.max(y, Math.min(py, y + 1))) < radius - 1e-8) return false;
      }
    }
    return true;
  };
  const length = Math.hypot(dx, dy), limit = Math.hypot(tiles[0]?.length ?? 0, tiles.length);
  if (length > limit) { dx *= limit / length; dy *= limit / length; }
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / .1);
  for (let i = 0; i < steps; i++) {
    if (fits(result.x + dx / steps, result.y)) result.x += dx / steps;
    if (fits(result.x, result.y + dy / steps)) result.y += dy / steps;
  }
  return result;
}

export function visibleCells(tiles: string[], objects: readonly ObjectView[], origins: readonly Point[], radius = 8): number[] {
  const width = tiles[0]?.length ?? 0, cells = new Set<number>();
  if (!Number.isFinite(radius) || radius < 0) return [];
  for (const from of origins) {
    if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) continue;
    for (let y = Math.max(0, Math.floor(from.y - radius)); y < Math.min(tiles.length, Math.ceil(from.y + radius)); y++) {
      for (let x = Math.max(0, Math.floor(from.x - radius)); x < Math.min(width, Math.ceil(from.x + radius)); x++) {
        if (Math.hypot(x + .5 - from.x, y + .5 - from.y) <= radius && trace(tiles, objects, from, { x: x + .5, y: y + .5 }, true)) cells.add(y * width + x);
      }
    }
  }
  return [...cells].sort((a, b) => a - b);
}

export function findPath(tiles: string[], objects: readonly ObjectView[], from: Point, to: Point): Point[] {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite) || solid(tiles, objects, from.x, from.y) || solid(tiles, objects, to.x, to.y)) return [];
  const width = tiles[0].length, start = Math.floor(from.y) * width + Math.floor(from.x), end = Math.floor(to.y) * width + Math.floor(to.x);
  const queue = [start], previous = new Map<number, number>([[start, -1]]);
  for (let i = 0; i < queue.length && !previous.has(end); i++) {
    const cell = queue[i], x = cell % width, y = Math.floor(cell / width);
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      const next = ny * width + nx;
      if (!previous.has(next) && !solid(tiles, objects, nx, ny)) { previous.set(next, cell); queue.push(next); }
    }
  }
  if (!previous.has(end)) return [];
  const path: Point[] = [];
  for (let cell = end; cell !== start; cell = previous.get(cell)!) path.push({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });
  return path.reverse();
}
