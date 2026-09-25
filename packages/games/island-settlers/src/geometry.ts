/**
 * Browser-safe hex math shared by the engine (board generation), the TV scene and the phone map.
 * Pointy-top axial coordinates with circumradius 1, so a hex is √3 wide flat-to-flat.
 * World x grows east, world y grows south (the scene maps y to -z).
 */

export type Axial = { q: number; r: number };
export type Point = { x: number; y: number };

export const SQRT3 = Math.sqrt(3);
export const HEX_RADIUS = 1;
export const HEX_WIDTH = SQRT3;

/**
 * Number tokens lie flat at the hex centre. 0.29 × radius ≈ 33% of the flat width, which leaves
 * ≈0.49 between the token rim and each settlement plinth (EXPERIENCE.md §1.4). Tokens never scale.
 */
export const TOKEN_RADIUS = 0.29;

/**
 * Plan-view clearance radii (EXPERIENCE.md §1.5), before pieceScale (≤ 1.2; robber unscaled).
 * The robber stands ROBBER_OFFSET toward the 120° edge midpoint, so it clears tokens and corners.
 */
export const FOOTPRINT = {
  settlement: 0.22, city: 0.36, roadLength: 0.54, roadWidth: 0.12, robber: 0.17,
} as const;
export const ROBBER_OFFSET = 0.5;

/** Neighbour order: E, SE, SW, W, NW, NE. The edge between corners i-1 and i faces neighbour i. */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
  { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
];

export const axialKey = ({ q, r }: Axial) => `${q}:${r}`;

export const axialToPoint = ({ q, r }: Axial): Point => ({ x: SQRT3 * (q + r / 2), y: 1.5 * r });

export const neighbor = (a: Axial, direction: number): Axial => {
  const d = DIRECTIONS[((direction % 6) + 6) % 6];
  return { q: a.q + d.q, r: a.r + d.r };
};

export const neighbors = (a: Axial): Axial[] => DIRECTIONS.map((_, i) => neighbor(a, i));

export const hexDistance = (a: Axial, b: Axial) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/** Cells at exactly `radius` from `center`, clockwise from the north-west corner cell. */
export function ring(center: Axial, radius: number): Axial[] {
  if (radius === 0) return [center];
  const cells: Axial[] = [];
  let cell = { q: center.q + DIRECTIONS[4].q * radius, r: center.r + DIRECTIONS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      cells.push(cell);
      cell = neighbor(cell, side);
    }
  }
  return cells;
}

/** Every cell within `radius` of `center`, centre first, then ring by ring. */
export function spiral(center: Axial, radius: number): Axial[] {
  const cells: Axial[] = [];
  for (let k = 0; k <= radius; k++) cells.push(...ring(center, k));
  return cells;
}

/** Corner i sits at angle 30° + 60°·i (i = 1 is the south point, i = 4 the north point). */
export function corner(center: Point, i: number, radius = HEX_RADIUS): Point {
  const angle = ((30 + 60 * i) * Math.PI) / 180;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

export const corners = (center: Point, radius = HEX_RADIUS) =>
  Array.from({ length: 6 }, (_, i) => corner(center, i, radius));

/** Stable key for merging shared corners of neighbouring hexes. */
export const pointKey = ({ x, y }: Point) => `${Math.round(x * 1e4) / 1e4}:${Math.round(y * 1e4) / 1e4}`;

export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Angle of segment a→b in radians, for orienting roads and ports. */
export const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Move `p` toward `target` by fraction t (0 = p, 1 = target). */
export const toward = (p: Point, target: Point, t: number): Point =>
  ({ x: p.x + (target.x - p.x) * t, y: p.y + (target.y - p.y) * t });

/** Dots on a number token: 6 and 8 have 5, 2 and 12 have 1, 7 and 0 have none. */
export const pips = (n: number) => (n >= 2 && n <= 12 && n !== 7 ? 6 - Math.abs(7 - n) : 0);

export function bounds(points: readonly Point[], pad = HEX_RADIUS) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad,
  };
}
