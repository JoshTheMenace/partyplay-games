/* Deterministic noise and PRNG for world generation (same world on every screen, every load). */
export function seeded(seed: number) {
  let s = seed | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }
export function hash2(x: number, y: number, seed: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1]. */
export function noise2(x: number, y: number, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Fractal value noise in [0, 1]; octaves are rotated so no grid-aligned features show. */
export function fbm(x: number, y: number, seed = 0, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) { sum += noise2(x * f, y * f, seed + i * 17) * amp; norm += amp; amp *= 0.5; f *= 2.03; const t = x * 0.8 - y * 0.6; y = x * 0.6 + y * 0.8; x = t; }
  return sum / norm;
}
/** Ridged fractal noise in [0, 1] (sharp crests: mountains). */
export function ridged(x: number, y: number, seed = 0, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) { const n = 1 - Math.abs(noise2(x * f, y * f, seed + i * 31) * 2 - 1); sum += n * n * amp; norm += amp; amp *= 0.5; f *= 2.1; const t = x * 0.8 - y * 0.6; y = x * 0.6 + y * 0.8; x = t; }
  return sum / norm;
}
