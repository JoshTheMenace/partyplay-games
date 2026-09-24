/* Snapshot interpolation for other racers, entities and the race clock.
 *
 * Snapshots are keyed by server time. The buffer maps the local clock onto server time with the
 * "lead" of the fastest recent arrival (snapshotTime − arrivalMs, max over ~2 s), so the mapping
 * never depends on clock sync and packet jitter only ever makes frames early, never late. It then
 * presents `delay` ms behind that (party-runtime PresentationDelay, 75–150 ms, adapted to arrival
 * gaps) on a monotonic clock that runs at 95–105% speed to absorb corrections — it never jumps
 * back. Past the newest snapshot it extrapolates at most `maxExtrapolateMs`, then holds. Events come
 * from the newer snapshot once the presented clock reaches their time.
 *
 * Returned views share unchanged objects with the snapshots: treat them as read-only. */
import { PresentationDelay } from '../../../../party-runtime/src/index';
import { angleDelta, clamp, signedWrap, wrap } from '../sim/math';
import { getTrack } from '../tracks/index';
import type { Entity, KartState, RaceView, RacerView } from '../sim/types';

/** Continuous KartState fields; everything else (flags, tiers, counters) comes from the newer state. */
export const KART_LERP_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'steer', 'air', 'lateral', 'driftCharge', 'hopT', 'boostT', 'boostPower', 'slipT', 'slipCharge',
  'trickT', 'spinT', 'tumbleT', 'starT', 'shieldT', 'inkT', 'shockT', 'respawnT', 'invulnT', 'stallT'] as const satisfies readonly (keyof KartState)[];
const RACER_EXTRA = ['progress', 'rollT', 'honkT'] as const satisfies readonly (keyof RacerView)[];
const ENTITY_LERP = ['x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'fuse'] as const satisfies readonly (keyof Entity)[];
/** Fields that may be negative; every other lerped field is a timer/charge and is clamped at 0 when extrapolating. */
const SIGNED = new Set<string>(['x', 'y', 'z', 'vx', 'vy', 'vz', 'steer', 'lateral', 'progress']);

function blendFields<T extends object>(out: T, a: T, b: T, t: number, fields: readonly string[]) {
  const o = out as Record<string, number>, x = a as Record<string, number>, y = b as Record<string, number>;
  for (const f of fields) { const v = x[f] + (y[f] - x[f]) * t; o[f] = t > 1 && !SIGNED.has(f) ? Math.max(0, v) : v; }
}
/** Lerp a kart state (angle-aware heading, lap-wrapped d). Discrete fields come from `b`. */
export function lerpKart<T extends KartState>(a: T, b: T, t: number, trackLength: number, extra: readonly string[] = []): T {
  const out = { ...b };
  blendFields(out, a, b, t, KART_LERP_FIELDS); if (extra.length) blendFields(out, a, b, t, extra);
  out.heading = a.heading + angleDelta(a.heading, b.heading) * t;
  out.d = wrap(a.d + signedWrap(b.d - a.d, trackLength) * t, trackLength);
  return out;
}
/** A jump no kart can drive in `gapSeconds` (respawn placement, reset) — show it, don't sweep across it. */
export function teleported(a: { x: number; y: number; z: number; respawnT?: number }, b: typeof a, gapSeconds: number) {
  if ((a.respawnT ?? 0) > 0 !== (b.respawnT ?? 0) > 0) return true;
  const limit = 6 + 90 * Math.max(0, gapSeconds);
  return (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2 > limit * limit;
}

export type RaceBufferOptions = {
  initialDelayMs?: number; minDelayMs?: number; maxDelayMs?: number;
  /** Longest time presented past the newest snapshot (default 60 ms). */
  maxExtrapolateMs?: number;
  /** Arrival silence that clears the buffer: a suspended tab or reconnect (default 1000 ms). */
  resetGapMs?: number;
  capacity?: number;
};
type Frame = { time: number; view: RaceView };
const LEAD_WINDOW = 40, JUMP_MS = 250;

export class RaceBuffer {
  private frames: Frame[] = [];
  private leads: number[] = [];
  private readonly delay: PresentationDelay;
  private presented: number | null = null;
  private lastNow: number | null = null;
  private lastArrival: number | null = null;
  private cached: RaceView | null = null;
  private readonly maxExtrapolateMs: number;
  private readonly resetGapMs: number;
  private readonly capacity: number;
  constructor(options: RaceBufferOptions = {}) {
    this.delay = new PresentationDelay({ initialMs: options.initialDelayMs ?? 100, minMs: options.minDelayMs ?? 75, maxMs: options.maxDelayMs ?? 150 });
    this.maxExtrapolateMs = options.maxExtrapolateMs ?? 60; this.resetGapMs = options.resetGapMs ?? 1000; this.capacity = Math.max(4, options.capacity ?? 32);
  }
  /** Current presentation delay (ms behind the fastest arrival). */
  get delayMs() { return this.delay.ms; }
  /** Server time (ms) presented by the last sample, or null. */
  get presentedTime() { return this.presented; }
  /** The newest snapshot received, uninterpolated. */
  get latest(): RaceView | null { return this.frames.at(-1)?.view ?? null; }

  /** snapshotTime: server ms of the snapshot (SceneViewProps.snapshotTime); arrivalMs: local performance.now() at receipt.
   * Safe to call every frame with the same props: repeated or older snapshot times are ignored. */
  push(view: RaceView, snapshotTime: number, arrivalMs: number = performance.now()) {
    if (!Number.isFinite(snapshotTime) || !Number.isFinite(arrivalMs)) return;
    const last = this.frames.at(-1);
    if (last && snapshotTime <= last.time) { if (last.time - snapshotTime < 3000) return; this.clear(); }   // duplicate, or a restarted server clock
    else if (last && (last.view.track !== view.track || (this.lastArrival !== null && arrivalMs - this.lastArrival > this.resetGapMs))) this.clear();
    this.lastArrival = arrivalMs; this.delay.arrival(arrivalMs);
    this.leads.push(snapshotTime - arrivalMs); if (this.leads.length > LEAD_WINDOW) this.leads.shift();
    this.frames.push({ time: snapshotTime, view }); if (this.frames.length > this.capacity) this.frames.shift();
    this.cached = null;
  }

  /** Interpolated view for local time `nowMs` (performance.now()); null before the first snapshot.
   * Calling it again with the same `nowMs` (several viewports per frame) returns the same object. */
  sample(nowMs: number = performance.now()): RaceView | null {
    const n = this.frames.length;
    if (!n) return null;
    if (nowMs === this.lastNow && this.cached) return this.cached;
    const elapsed = this.lastNow === null ? 0 : clamp(nowMs - this.lastNow, 0, 1000); this.lastNow = nowMs;
    this.delay.advance(elapsed);
    let lead = -Infinity; for (const l of this.leads) if (l > lead) lead = l;
    const target = nowMs + lead - this.delay.ms, p = this.presented;
    const t = this.presented = p === null || target - p > JUMP_MS || p - target > 4 * JUMP_MS ? target : clamp(target, p + elapsed * .95, p + elapsed * 1.05);
    const first = this.frames[0];
    if (n === 1 || t <= first.time) return this.cached = first.view;
    for (let i = 1; i < n; i++) { const b = this.frames[i]; if (t <= b.time) { const a = this.frames[i - 1]; return this.cached = blend(a, b, (t - a.time) / (b.time - a.time)); } }
    const a = this.frames[n - 2], b = this.frames[n - 1];
    return this.cached = blend(a, b, 1 + Math.min(t - b.time, this.maxExtrapolateMs) / (b.time - a.time));
  }
  reset() { this.clear(); }
  private clear() { this.frames = []; this.leads = []; this.presented = null; this.lastNow = null; this.lastArrival = null; this.cached = null; this.delay.resume(); }
}

function blend(fa: Frame, fb: Frame, alpha: number): RaceView {
  const a = fa.view, b = fb.view, gap = (fb.time - fa.time) / 1000 * Math.max(1, alpha), length = getTrack(b.track).length;
  const racers = b.racers.map((rb, i) => {
    const ra = a.racers[i]?.id === rb.id ? a.racers[i] : a.racers.find(r => r.id === rb.id);
    return !ra || teleported(ra, rb, gap) ? rb : lerpKart(ra, rb, alpha, length, RACER_EXTRA);
  });
  const before = a.entities.length ? new Map(a.entities.map(e => [e.id, e])) : null;
  const entities = b.entities.map(eb => {
    const ea = before?.get(eb.id);
    if (!ea || ea.kind !== eb.kind || teleported(ea, eb, gap)) return eb;
    const out = { ...eb }; blendFields(out, ea, eb, alpha, ENTITY_LERP);
    out.d = wrap(ea.d + signedWrap(eb.d - ea.d, length) * alpha, length);
    return out;
  });
  const time = a.phase === 'results' ? b.time : a.time + (b.time - a.time) * alpha;
  // Events wait until the presented clock reaches them, so sounds and effects land with the motion they belong to.
  const events = b.events.length && b.events[b.events.length - 1].t > time + 1e-6 ? b.events.filter(e => e.t <= time + 1e-6) : b.events;
  return { ...b, time, racers, entities, events };
}
