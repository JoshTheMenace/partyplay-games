/** Interpolation helpers for remote entities (allocation-free per frame). */
import { SnapshotBuffer } from '../../../../../party-runtime/src/index';

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
/** Frame-rate independent exponential approach factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * Wraps a SnapshotBuffer and exposes the two bracketing snapshots plus the blend factor instead of building a
 * blended copy, so per-entity interpolation can run without allocating.
 */
export class Interpolator<T> {
  readonly buffer: SnapshotBuffer<T>;
  a: T | undefined;
  b: T | undefined;
  alpha = 0;
  private readonly pick = (a: T, b: T, alpha: number) => {
    this.a = a;
    this.b = b;
    this.alpha = alpha;
    return a;
  };
  constructor(delayMs = 100) {
    this.buffer = new SnapshotBuffer<T>(delayMs, 32, { adaptive: { minMs: 75, maxMs: 200 }, monotonic: true, resetGapMs: 2000 });
  }
  push(time: number, value: T, arrivalMs: number) { this.buffer.push(time, value, arrivalMs); }
  /** Returns false when nothing has arrived yet. */
  sample(nowMs: number): boolean {
    this.a = this.b = undefined;
    const value = this.buffer.sample(nowMs, this.pick);
    if (value === undefined) return false;
    if (this.a === undefined) {
      this.a = this.b = value;
      this.alpha = 0;
    }
    return true;
  }
}

const indexes = new WeakMap<readonly { id: number | string }[], Map<number | string, unknown>>();
/** Id → entity map for a snapshot list, built once per list and cached. */
export function byId<T extends { id: number | string }>(list: readonly T[]): ReadonlyMap<T['id'], T> {
  let map = indexes.get(list);
  if (!map) {
    map = new Map(list.map(item => [item.id, item]));
    indexes.set(list, map);
  }
  return map as Map<T['id'], T>;
}
