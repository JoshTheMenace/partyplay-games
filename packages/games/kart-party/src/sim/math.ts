/* Small deterministic helpers shared by the server simulation, client prediction and renderer.
 * World axes: +Y up, metres. Heading h is a yaw angle; forward = (sin h, cos h) on XZ and the
 * driver's right = (-cos h, sin h). Steering right (steer > 0) therefore DECREASES heading. */
export const TAU = Math.PI * 2;
export const clamp = (n: number, lo: number, hi: number) => n < lo ? lo : n > hi ? hi : n;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, n: number) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential approach: fraction of the gap closed after dt at `rate` per second. */
export const approach = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
export const angleDelta = (from: number, to: number) => wrapAngle(to - from);
export const forwardX = (h: number) => Math.sin(h);
export const forwardZ = (h: number) => Math.cos(h);
export const rightX = (h: number) => -Math.cos(h);
export const rightZ = (h: number) => Math.sin(h);
export const headingOf = (x: number, z: number) => Math.atan2(x, z);
export const moveToward = (value: number, target: number, maxDelta: number) => Math.abs(target - value) <= maxDelta ? target : value + Math.sign(target - value) * maxDelta;
/** Round for snapshots; keeps views small and finite. */
export const round = (n: number, places = 3) => { const f = 10 ** places, v = Math.round(n * f) / f; return Number.isFinite(v) ? v + 0 : 0; };
export const wrap = (n: number, length: number) => ((n % length) + length) % length;
/** Wrap a difference into [-length/2, length/2). */
export const signedWrap = (n: number, length: number) => wrap(n + length / 2, length) - length / 2;

/** mulberry32: tiny deterministic PRNG whose whole state is one integer (serializable in Race). */
export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
