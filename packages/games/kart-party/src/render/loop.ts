/* Loop-the-loop presentation helpers shared by the loop mesh, karts and cameras. Everything derives from
 * loopPose (sim/track.ts), so what is drawn is exactly what the physics drives. */
import { clamp, TAU } from '../sim/math';
import { forwardDistance, loopPose, sampleAt, signedDistance, type Track, type TrackLoop } from '../sim/track';

/** Ribbon frame at (θ, lateral): position, forward (loopPose tangent), right (the loop's lateral axis made ⟂ to
 * forward) and up (the ribbon's surface normal, on loopPose's "toward the centre" side). */
export type LoopFrame = { x: number; y: number; z: number; fx: number; fy: number; fz: number; rx: number; ry: number; rz: number; ux: number; uy: number; uz: number; dsdTheta: number };

export function loopFrame(loop: TrackLoop, theta: number, lateral: number, out = {} as LoopFrame): LoopFrame {
  const p = loopPose(loop, theta, lateral), d = loop.rx * p.tx + loop.rz * p.tz;
  let rx = loop.rx - d * p.tx, ry = -d * p.ty, rz = loop.rz - d * p.tz;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  // The ribbon is swept by (tangent, lateral axis), so its normal is their cross product — loopPose's up leans
  // `tilt` off it at the sides, which would roll a kart onto two wheels.
  let ux = ry * p.tz - rz * p.ty, uy = rz * p.tx - rx * p.tz, uz = rx * p.ty - ry * p.tx;
  if (ux * p.ux + uy * p.uy + uz * p.uz < 0) { ux = -ux; uy = -uy; uz = -uz; }
  Object.assign(out, { x: p.x, y: p.y, z: p.z, fx: p.tx, fy: p.ty, fz: p.tz, rx, ry, rz, ux, uy, uz, dsdTheta: p.dsdTheta });
  return out;
}

/** Half-width of the loop lane (the road's half-width at the entry). */
export const loopHalfWidth = (track: Track, loop: TrackLoop) => sampleAt(track, loop.d0).halfWidth;

/** Is d on a loop's footprint (where the ribbon is replaced by the loop)? */
export const onLoopFootprint = (track: Track, d: number) => track.loops.some(l => forwardDistance(track, l.d0, d) < forwardDistance(track, l.d0, l.d1));

/** The loop a kart is riding and its angle, or null. θ comes from the lap distance d (d = d0 + length·θ/2π), which is
 * interpolated smoothly for remote karts — their `loop` field is only the newer snapshot's value. */
export function kartLoop(track: Track, k: { loop: number; d: number }): { loop: TrackLoop; theta: number } | null {
  if (!(k.loop > 0)) return null;
  for (const loop of track.loops) {
    const len = forwardDistance(track, loop.d0, loop.d1) || 1, s = signedDistance(track, loop.d0, k.d);
    if (s > -len * .5 && s < len * 1.5) return { loop, theta: clamp(s / len, 0, 1) * TAU };
  }
  return track.loops[0] ? { loop: track.loops[0], theta: clamp(k.loop, 0, TAU) } : null;
}

const ARC = new WeakMap<TrackLoop, Float64Array>();
/** Fraction (0–1) of the loop's arc length ridden at θ, from a 64-step table cached per loop. */
export function loopArc(loop: TrackLoop, theta: number) {
  let t = ARC.get(loop);
  if (!t) {
    t = new Float64Array(65);
    for (let i = 1; i <= 64; i++) t[i] = t[i - 1] + loopPose(loop, (i - .5) * TAU / 64, 0).dsdTheta;
    for (let i = 1; i <= 64; i++) t[i] /= t[64];
    ARC.set(loop, t);
  }
  const x = clamp(theta / TAU, 0, 1) * 64, i = Math.min(63, Math.floor(x));
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}
