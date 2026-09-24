/**
 * Pose channels. A pose is a dense Float32Array so sampling, mixing and mirroring stay allocation-free and testable.
 * All channels are offsets from the T-pose rest (model facing +Z, left side at +X):
 * - Torso joints (hips, spine, chest, neck, head): Euler degrees [pitch, yaw, roll] in the model axes carried by the parent.
 *   +pitch leans forward, +yaw turns the front toward the model's left, +roll tips the top toward its right.
 * - hL/hR: hand targets from the shoulder joint in the chest frame, in arm lengths [out, up, fwd] ("out" = away from the
 *   midline on that side, so both sides read the same). eL/eR: elbow bend directions [out, up, fwd].
 * - fL/fR: ankle targets from the rest ankle in the body frame, in leg lengths [out, up, fwd]; up = 0 plants the foot.
 *   kL/kR: knee bend directions. tL/tR: toe pitch in degrees (+ points the toes down).
 * - root: hips offset in leg lengths [left, up, fwd] (feet stay planted). blade: prop direction [out, up, fwd] in the
 *   chest frame, applied with weight bw.
 * - Whole body (applied to the root bone around the hips): spin (degrees, + is a forward flip), yaw (degrees, + turns
 *   toward the camera), lean (degrees, + tips forward in the screen plane without the flip pivot), squash (+ stretches,
 *   volume preserving), lift (leg lengths up), fade (0 visible → 1 vanished), curl (0–1 finger/limb curl for hands).
 */
export const VEC = { hips: 0, spine: 3, chest: 6, neck: 9, head: 12, root: 15, hL: 18, hR: 21, fL: 24, fR: 27, eL: 30, eR: 33, kL: 36, kR: 39, blade: 42 } as const;
export const SCALAR = { tL: 45, tR: 46, spin: 47, yaw: 48, lean: 49, squash: 50, lift: 51, bw: 52, fade: 53, curl: 54 } as const;
export const SIZE = 55;
export type VecChannel = keyof typeof VEC;
export type ScalarChannel = keyof typeof SCALAR;
export type V3 = readonly [number, number, number];
export type Key = { [K in VecChannel]?: V3 } & { [K in ScalarChannel]?: number };
export type Dense = Float32Array;
export const TORSO = ['hips', 'spine', 'chest', 'neck', 'head'] as const;

/** Relaxed standing pose; every channel a key leaves out falls back to its base. */
export const NEUTRAL: Key = {
  hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], root: [0, 0, 0],
  hL: [.16, -.94, .06], hR: [.16, -.94, .06], fL: [.02, 0, 0], fR: [.02, 0, 0],
  eL: [.35, -.35, -1], eR: [.35, -.35, -1], kL: [.12, 0, 1], kR: [.12, 0, 1], blade: [0, -.2, 1],
  tL: 0, tR: 0, spin: 0, yaw: 0, lean: 0, squash: 0, lift: 0, bw: 0, fade: 0, curl: 0,
};

export const dense = () => new Float32Array(SIZE);
/** out = base with every channel named in key replaced (w < 1 moves those channels only part way). */
export function apply(out: Dense, key: Key, base?: Dense, w = 1): Dense {
  if (base && base !== out) out.set(base);
  for (const name in key) {
    const value = key[name as keyof Key];
    if (typeof value === 'number') { const i = SCALAR[name as ScalarChannel]; out[i] += (value - out[i]) * w; }
    else if (value) { const i = VEC[name as VecChannel]; for (let k = 0; k < 3; k++) out[i + k] += (value[k] - out[i + k]) * w; }
  }
  return out;
}
export const fromKey = (key: Key, base?: Dense) => apply(dense(), key, base);
export const BASE = fromKey(NEUTRAL);

/** Linear blend of every channel; t outside [0, 1] extrapolates (small overshoots). */
export function mix(out: Dense, a: Dense, b: Dense, t: number): Dense {
  for (let i = 0; i < SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
/** Adds a key's channels on top of a pose, scaled by w (breathing, tremble, flinches). */
export function add(out: Dense, key: Key, w = 1): Dense {
  for (const name in key) {
    const value = key[name as keyof Key];
    if (typeof value === 'number') out[SCALAR[name as ScalarChannel]] += value * w;
    else if (value) { const i = VEC[name as VecChannel]; out[i] += value[0] * w; out[i + 1] += value[1] * w; out[i + 2] += value[2] * w; }
  }
  return out;
}
const SWAP = [['hL', 'hR'], ['fL', 'fR'], ['eL', 'eR'], ['kL', 'kR'], ['tL', 'tR']] as const;
/** Swap the body's sides: limb channels trade places; torso yaw/roll and the lateral root offset flip sign. */
export function mirror(key: Key): Key {
  const out: Record<string, unknown> = { ...key };
  for (const [a, b] of SWAP) { out[a] = key[b]; out[b] = key[a]; }
  for (const joint of TORSO) { const v = key[joint]; if (v) out[joint] = [v[0], -v[1], -v[2]]; }
  if (key.root) out.root = [-key.root[0], key.root[1], key.root[2]];
  if (key.yaw !== undefined) out.yaw = -key.yaw;
  for (const name in out) if (out[name] === undefined) delete out[name];
  return out as Key;
}
export const finite = (p: Dense) => p.every(Number.isFinite);

// ── Easing ────────────────────────────────────────────────────────────────
export const clamp = (x: number, lo: number, hi: number) => x < lo ? lo : x > hi ? hi : x;
export const clamp01 = (t: number) => t < 0 ? 0 : t > 1 ? 1 : t;
export const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const easeOut = (t: number) => { t = clamp01(t); return 1 - (1 - t) ** 3; };
export const easeIn = (t: number) => { t = clamp01(t); return t * t * t; };
/** Overshoots by about 10% before settling at 1. */
export const backOut = (t: number, s = 1.7) => { t = clamp01(t) - 1; return 1 + t * t * ((s + 1) * t + s); };
/** A damped settle: 0 → 1 with one soft overshoot, for landings and recoveries. */
export const settle = (t: number) => { t = clamp01(t); return 1 - Math.exp(-6 * t) * Math.cos(9 * t) * (1 - t); };
export const wave = (t: number) => Math.sin(t * Math.PI * 2);
export const bump = (t: number) => Math.sin(clamp01(t) * Math.PI);
