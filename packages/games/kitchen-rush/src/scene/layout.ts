// Pure, DOM-free scene helpers: camera fit, placement heights and cooking readouts. Unit tested in tests/scene.test.ts.
import type { SnapshotBuffer } from '../../../../party-runtime/src/index';
import { BURN_AT, BURN_WARN, COUNTER_HEIGHT, cookSeconds, type GameEvent, type Item, type KitchenMap, type Part, type Tile, type TileKind } from '../model';

export const FOV = 34, TILT = 58 * Math.PI / 180;

export type FitOptions = {
  fov?: number; tilt?: number;
  /** Fractions of the view covered by HUD bands on each edge. */ hudTop?: number; hudBottom?: number; hudLeft?: number; hudRight?: number;
};
/** `shift` is the horizontal lens shift (NDC) that centres the kitchen between the left and right bands. */
export type CameraFit = { distance: number; targetZ: number; shift: number; position: [number, number, number] };

/**
 * Points that must stay on screen: the slab rim under the front counters, the front worktops, the back worktops and the
 * cooking gauges above them. The back wall and scenery may crop under the HUD so the kitchen itself fills the view.
 */
export function framingPoints(halfX: number, halfZ: number): [number, number, number][] {
  const x = halfX + .1;
  return [-x, x].flatMap(sx => [[sx, -.05, halfZ + .15], [sx, .95, halfZ + .05], [sx, .95, -halfZ], [sx * .5, 2.15, -halfZ + .5]] as [number, number, number][]);
}
/** Outer corners of the kitchen block (floor slab and worktops), used to measure how much of the view it fills. */
export const kitchenCorners = (halfX: number, halfZ: number) => [-halfX, halfX].flatMap(x => [[x, 0, halfZ], [x, .9, halfZ], [x, .9, -halfZ]]);

/** Project a world point for a camera looking at (0,0,targetZ) from `distance` along the tilt. Returns NDC x/y. */
export function project(point: readonly number[], distance: number, targetZ: number, aspect: number, fov = FOV, tilt = TILT, shift = 0) {
  const sin = Math.sin(tilt), cos = Math.cos(tilt), tan = Math.tan(fov * Math.PI / 360);
  const rx = point[0], ry = point[1] - sin * distance, rz = point[2] - targetZ - cos * distance;
  const depth = -ry * sin - rz * cos, up = ry * cos - rz * sin;
  return { x: rx / (depth * tan * aspect) + shift, y: up / (depth * tan), depth };
}

/** Smallest camera distance (with a vertical re-centre and a horizontal lens shift) that fits the kitchen between the HUD bands. */
export function fitCamera(halfX: number, halfZ: number, aspect: number, options: FitOptions = {}): CameraFit {
  const { fov = FOV, tilt = TILT, hudTop = 120 / 720, hudBottom = .02, hudLeft = 0, hudRight = 0 } = options;
  const points = framingPoints(halfX, halfZ), top = 1 - 2 * hudTop, bottom = -1 + 2 * hudBottom, edge = .99 * (1 - hudLeft - hudRight);
  const extent = (distance: number, targetZ: number) => {
    let minY = Infinity, maxY = -Infinity, maxX = 0;
    for (const point of points) { const p = project(point, distance, targetZ, aspect, fov, tilt); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); maxX = Math.max(maxX, Math.abs(p.x)); }
    return { minY, maxY, maxX };
  };
  // Moving the target toward the camera raises everything on screen, so centring is a monotonic bisection.
  const centre = (distance: number) => {
    let lo = -halfZ * 2 - 4, hi = halfZ * 2 + 4;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2, e = extent(distance, mid); if ((e.maxY + e.minY) / 2 > (top + bottom) / 2) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  };
  const fits = (distance: number) => { const targetZ = centre(distance), e = extent(distance, targetZ); return e.maxX <= edge && e.maxY <= top && e.minY >= bottom; };
  let lo = 2, hi = 400;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  const targetZ = centre(hi);
  return { distance: hi, targetZ, shift: hudLeft - hudRight, position: [0, Math.sin(tilt) * hi, targetZ + Math.cos(tilt) * hi] };
}

/** World metres covered by one screen pixel at the camera target, for constant-size labels. */
export const metresPerPixel = (distance: number, heightPx: number, fov = FOV) => 2 * distance * Math.tan(fov * Math.PI / 360) / Math.max(1, heightPx);

// ── Placement ───────────────────────────────────────────────────────────────
/** Height of an item's base when it rests on a tile of this kind. */
export const SURFACE_Y: Partial<Record<TileKind, number>> = { counter: COUNTER_HEIGHT, board: COUNTER_HEIGHT + .04, stove: COUNTER_HEIGHT + .03, sink: COUNTER_HEIGHT - .12, belt: COUNTER_HEIGHT + .025, oven: .5, rack: COUNTER_HEIGHT, return: COUNTER_HEIGHT };
/** The authored oven bakes on the landing in front of its dome; the fallback oven has a low shelf at its mouth. */
export function itemAnchor(kind: TileKind, authoredOven = false) {
  if (kind === 'oven') return authoredOven ? { y: COUNTER_HEIGHT, z: .12, scale: .85 } : { y: .5, z: .3, scale: .78 };
  return { y: SURFACE_Y[kind] ?? COUNTER_HEIGHT, z: 0, scale: 1 };
}
/** Plate stacks show at most `max` plates so a big stack never towers over the counter. */
export const stackHeights = (count: number, step = .045, max = 8) => Array.from({ length: Math.min(max, Math.max(0, count)) }, (_, i) => i * step);
/** Offsets of loose parts on a plate (no recipe match): a small ring with the first part centred. */
export function plateOffsets(count: number, radius = .085): [number, number][] {
  if (count <= 1) return count ? [[0, 0]] : [];
  return Array.from({ length: count }, (_, i) => [Math.cos(i / count * Math.PI * 2 + .6) * radius, Math.sin(i / count * Math.PI * 2 + .6) * radius]);
}
/** Split the opening plate stack across racks the same way the rules do (players + 3, earlier racks first). */
export function initialRackCounts(racks: number, players: number) {
  const total = players + 3;
  return Array.from({ length: racks }, (_, i) => Math.floor(total / racks) + (i < total % racks ? 1 : 0));
}
export function spawnFor(map: KitchenMap, index: number) { return map.spawns[index % Math.max(1, map.spawns.length)] ?? { x: 0, z: 0 }; }

// ── Cooking readouts ────────────────────────────────────────────────────────
export type CookReadout = { state: 'idle' | 'cooking' | 'done' | 'warn' | 'burnt'; progress: number };
// Module-level predicates keep the per-frame readout free of closure allocations.
const isBurnt = (part: Part) => part.state === 'burnt', isCooked = (part: Part) => part.state === 'cooked', isChopped = (part: Part) => part.state === 'chopped';
const isRawDough = (part: Part) => part.food === 'dough' && part.state === 'raw';
const put = (out: CookReadout, state: CookReadout['state'], progress: number) => { out.state = state; out.progress = progress; return out; };
/** What a pot, pan or baking plate shows above its station. Heat is `item.cook` seconds. Pass `out` to reuse one object in the frame loop. */
export function cookReadout(item: Item | undefined, relaxed: boolean, out: CookReadout = { state: 'idle', progress: 0 }): CookReadout {
  if (!item || !item.parts.length || (item.kind !== 'pot' && item.kind !== 'pan' && item.kind !== 'plate')) return put(out, 'idle', 0);
  if (item.parts.some(isBurnt)) return put(out, 'burnt', 1);
  const need = cookSeconds(item.kind);
  // Plates only bake raw dough; pots and pans cook chopped food.
  if (item.parts.some(item.kind === 'plate' ? isRawDough : isChopped)) return put(out, 'cooking', Math.min(1, item.cook / need));
  if (!item.parts.some(isCooked)) return put(out, 'idle', 0);
  const over = item.cook - need;
  if (!relaxed && over >= BURN_WARN) return put(out, 'warn', Math.min(1, (over - BURN_WARN) / (BURN_AT - BURN_WARN)));
  return put(out, 'done', 1);
}
/** Soup colour family and fill fraction (0–1) for a pot. */
export function soupOf(item: Item) {
  const foods = new Set(item.parts.map(part => part.food));
  return { kind: foods.size > 1 ? 'mixed' : foods.has('onion') ? 'onion' : 'tomato', fill: Math.min(1, item.parts.length / 3), burnt: item.parts.some(part => part.state === 'burnt') } as const;
}
/** Stable key of what an item looks like (not its heat), so meshes rebuild only when contents change. */
export const itemLook = (item: Item) => `${item.kind}:${item.count ?? 0}:${item.parts.map(part => `${part.food}.${part.state}`).join(',')}`;

/** Seconds until thrown food (height y, rising at vy) comes back down to worktop height. Mirrors the rules' throw gravity. */
export const THROW_GRAVITY = 18;
export const landingIn = (y: number, vy: number, land = COUNTER_HEIGHT) => (vy + Math.sqrt(vy * vy + 2 * THROW_GRAVITY * Math.max(0, y - land))) / THROW_GRAVITY;
/** Squash-and-stretch wobble for a pop that started `age` seconds ago: 0 at rest, positive = taller. */
export const popWobble = (age: number, strength = .3) => age < 0 || age > .6 ? 0 : strength * Math.exp(-age * 9) * Math.sin(age * 32);

// ── Events ──────────────────────────────────────────────────────────────────
/** Events older than this (server ms) are skipped, as in audio.ts: a tab coming back from hidden must not replay a backlog. */
export const FRESH_MS = 1500;
/** Delivers each fresh event once. The first batch only records the cursor, so a late-joining display skips old effects. */
export class EventCursor {
  private last: number | null = null;
  take(events: readonly GameEvent[], handle: (event: GameEvent) => void, now = -Infinity) {
    if (this.last === null) { this.last = events.reduce((max, event) => Math.max(max, event.id), 0); return; }
    for (const event of events) if (event.id > this.last && now - event.at < FRESH_MS) handle(event);
    for (const event of events) if (event.id > this.last) this.last = event.id;
  }
}

// ── Snapshots ───────────────────────────────────────────────────────────────
/**
 * Samples the buffer into a reused (a, b, k) pair. Before the first or after the last snapshot the buffer returns that
 * frame without interpolating; it then comes back as a still pair instead of leaving the previous pair on screen.
 */
export function pairSampler<T>(buffer: Pick<SnapshotBuffer<T>, 'sample'>) {
  const pair = { a: null as T | null, b: null as T | null, k: 0 };
  const capture = (a: T, b: T, k: number) => { pair.a = a; pair.b = b; pair.k = k; return b; };
  return (now: number) => {
    pair.b = null;
    const sampled = buffer.sample(now, capture);
    if (sampled === undefined) return null;
    if (pair.b === null) { pair.a = pair.b = sampled; pair.k = 1; }
    return pair as { a: T; b: T; k: number };
  };
}

// ── Drawbridges ─────────────────────────────────────────────────────────────
/** Each gate tile hinges at the nearer end of its run, so a bridge opens in the middle like a bascule. */
export function gateHinges(map: KitchenMap) {
  const at = (col: number, row: number) => col < 0 || row < 0 || col >= map.cols || row >= map.rows ? undefined : map.tiles[row * map.cols + col];
  const run = (tile: Tile, dc: number, dr: number) => { let n = 0; while (at(tile.col + dc * (n + 1), tile.row + dr * (n + 1))?.kind === 'gate') n++; return n; };
  const lands = (tile: Tile, dc: number, dr: number, n: number) => { const end = at(tile.col + dc * (n + 1), tile.row + dr * (n + 1)); return !!end && end.kind !== 'void'; };
  return map.tiles.filter(tile => tile.kind === 'gate').map(tile => {
    const xs = [run(tile, -1, 0), run(tile, 1, 0)], zs = [run(tile, 0, -1), run(tile, 0, 1)];
    const byX = lands(tile, -1, 0, xs[0]) && lands(tile, 1, 0, xs[1]), byZ = lands(tile, 0, -1, zs[0]) && lands(tile, 0, 1, zs[1]);
    // The bridge runs along the axis that reaches solid ground at both ends (ties: the longer run).
    const alongX = byX !== byZ ? byX : xs[0] + xs[1] >= zs[0] + zs[1];
    const [start, end] = alongX ? xs : zs, fromStart = start <= end;
    const reach = fromStart ? start + .5 : end + .5, sign = fromStart ? -1 : 1;
    const side = (offset: number) => at(tile.col + (alongX ? 0 : offset), tile.row + (alongX ? offset : 0))?.kind !== 'gate';
    return { tile, alongX, hinge: { x: tile.x + (alongX ? sign * reach : 0), z: tile.z + (alongX ? 0 : sign * reach) }, sign, reach, edges: [side(-1), side(1)] };
  });
}
