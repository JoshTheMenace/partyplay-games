/**
 * Deterministic hashing, random numbers and simplex noise for world generation.
 * Only + - * /, Math.floor, Math.sqrt, Math.imul and bit operations are used, so results are
 * bit-identical in every JavaScript engine (V8 on the server, JavaScriptCore on iPhones).
 */

/** Well-mixed 32-bit unsigned hash of up to three integers and a seed. */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export const hash2 = (seed: number, x: number, z: number) => hash3(seed, x, 0x5bd1e995, z);
/** Hash mapped to [0, 1). */
export const rand2 = (seed: number, x: number, z: number) => hash2(seed, x, z) / 4294967296;
export const rand3 = (seed: number, x: number, y: number, z: number) => hash3(seed, x, y, z) / 4294967296;
/** Independent sub-seed for a named purpose. */
export const subSeed = (seed: number, salt: number) => hash3(seed, salt, 0x68e31da4, 0x1b56c4e9);

/** Random number source returning [0, 1). */
export type Rng = () => number;
/** Small, fast deterministic generator (mulberry32). */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Integer in [min, max]. */
export const rngInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

export const clamp = (v: number, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Hermite smoothstep of `v` between edges `a` and `b`. */
export function smoothstep(a: number, b: number, v: number) {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
/** Piecewise-linear curve through [x, y] control points sorted by x. */
export function curve(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return points[points.length - 1]![1];
}

// Gradient tables written as literals (never computed with trig) so every engine agrees.
const G2X = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071, 0.9239, -0.9239, 0.3827, -0.3827, 0.9239, -0.9239, 0.3827, -0.3827];
const G2Y = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071, 0.3827, 0.3827, 0.9239, 0.9239, -0.3827, -0.3827, -0.9239, -0.9239];
const G3 = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  1, 1, 0, -1, 1, 0, 0, -1, 1, 0, -1, -1];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3, G3F = 1 / 6;

function corner2(seed: number, i: number, j: number, x: number, y: number) {
  let t = 0.5 - x * x - y * y;
  if (t <= 0) return 0;
  const g = hash3(seed, i, j, 0) & 15;
  t *= t;
  return t * t * (G2X[g]! * x + G2Y[g]! * y);
}
/** 2D simplex noise, roughly [-1, 1]. */
export function simplex2(seed: number, x: number, y: number): number {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
  const x0 = x - i + t, y0 = y - j + t, i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  return 70 * (corner2(seed, i, j, x0, y0)
    + corner2(seed, i + i1, j + j1, x0 - i1 + G2, y0 - j1 + G2)
    + corner2(seed, i + 1, j + 1, x0 - 1 + 2 * G2, y0 - 1 + 2 * G2));
}

function corner3(seed: number, i: number, j: number, k: number, x: number, y: number, z: number) {
  let t = 0.6 - x * x - y * y - z * z;
  if (t <= 0) return 0;
  const g = (hash3(seed, i, j, k) & 15) * 3;
  t *= t;
  return t * t * (G3[g]! * x + G3[g + 1]! * y + G3[g + 2]! * z);
}
/** 3D simplex noise, roughly [-1, 1]. */
export function simplex3(seed: number, x: number, y: number, z: number): number {
  const s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s), t = (i + j + k) * G3F;
  const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
  else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
  else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  return 32 * (corner3(seed, i, j, k, x0, y0, z0)
    + corner3(seed, i + i1, j + j1, k + k1, x0 - i1 + G3F, y0 - j1 + G3F, z0 - k1 + G3F)
    + corner3(seed, i + i2, j + j2, k + k2, x0 - i2 + 2 * G3F, y0 - j2 + 2 * G3F, z0 - k2 + 2 * G3F)
    + corner3(seed, i + 1, j + 1, k + 1, x0 - 1 + 3 * G3F, y0 - 1 + 3 * G3F, z0 - 1 + 3 * G3F));
}

/**
 * Fractal 2D noise: `octaves` layers of simplex noise, each at double frequency and `gain` amplitude,
 * normalised to roughly [-1, 1]. `scale` is the feature size of the first octave in blocks.
 */
export function fbm2(seed: number, x: number, z: number, scale: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = 1 / scale;
  for (let o = 0; o < octaves; o++) {
    sum += amp * simplex2(seed + o * 0x3c6ef372, x * f + o * 17.31, z * f - o * 9.73);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Ridged multifractal 2D noise in [0, 1]: sharp crests along noise zero lines, rougher where crests are high. */
export function ridged2(seed: number, x: number, z: number, scale: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = 1 / scale, weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(simplex2(seed + o * 0x3c6ef372, x * f + o * 17.31, z * f - o * 9.73));
    n *= n * weight;
    weight = clamp(n * 2);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}
