import { PresentationDelay, type PresentationDelayOptions } from './presentation';

export class FrameMetrics {
  private samples: number[] = [];
  private cursor = 0;
  frames = 0;
  slowFrames = 0;
  constructor(readonly capacity = 600) { if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid sample capacity.'); }
  record(ms: number) { if (!Number.isFinite(ms) || ms < 0) return; this.samples[this.cursor++ % this.capacity] = ms; this.frames++; if (ms > 50) this.slowFrames++; }
  snapshot() { const sorted = [...this.samples].sort((a, b) => a - b); return { frames: this.frames, slowFrames: this.slowFrames, sampleCount: sorted.length, p50Ms: sorted[Math.floor((sorted.length - 1) * .5)] ?? 0, p95Ms: sorted[Math.floor((sorted.length - 1) * .95)] ?? 0, maxMs: sorted.at(-1) ?? 0 }; }
}
/** Interpolate authoritative snapshots; never extrapolate hits or game outcomes. */
export type SnapshotBufferOptions = {
  /** Adapt the delay to observed arrival gaps (pass arrival times to push); the constructor delay becomes the starting delay. */
  adaptive?: Omit<PresentationDelayOptions, 'initialMs'>;
  /** Never present an earlier moment than already shown: clock corrections and delay changes run presentation at 95–105% speed instead. */
  monotonic?: boolean;
  /** Clear buffered frames when arrivals stop for this long — a suspended tab or a reconnect. */
  resetGapMs?: number;
};
/** A forward clock correction larger than this is a jump, not drift, and is taken at once. */
const PRESENTATION_JUMP_MS = 250;
export class SnapshotBuffer<T> {
  private frames: { time: number; value: T }[] = [];
  private readonly delay: PresentationDelay | null;
  private presented: number | null = null;
  private lastNow: number | null = null;
  private lastArrival: number | null = null;
  constructor(private readonly initialDelayMs = 100, readonly capacity = 32, private readonly options: SnapshotBufferOptions = {}) {
    if (initialDelayMs < 0 || !Number.isFinite(initialDelayMs) || !Number.isInteger(capacity) || capacity < 2 || (options.resetGapMs !== undefined && !(options.resetGapMs > 0))) throw new Error('Invalid snapshot buffer.');
    this.delay = options.adaptive ? new PresentationDelay({ ...options.adaptive, initialMs: initialDelayMs }) : null;
  }
  get delayMs() { return this.delay ? this.delay.ms : this.initialDelayMs; }
  push(time: number, value: T, arrivalMs?: number) {
    if (!Number.isFinite(time)) return;
    if (arrivalMs !== undefined && Number.isFinite(arrivalMs)) {
      if (this.options.resetGapMs !== undefined && this.lastArrival !== null && arrivalMs - this.lastArrival > this.options.resetGapMs) this.clear();
      this.lastArrival = arrivalMs; this.delay?.arrival(arrivalMs);
    }
    if (time <= (this.frames.at(-1)?.time ?? -Infinity)) return;
    this.frames.push({ time, value }); if (this.frames.length > this.capacity) this.frames.shift();
  }
  sample(now: number, interpolate: (a: T, b: T, alpha: number) => T): T | undefined {
    const first = this.frames[0], last = this.frames.at(-1);
    if (!first || !last) return;
    const elapsed = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow); this.lastNow = now;
    this.delay?.advance(elapsed);
    const time = this.options.monotonic ? this.presentAt(now - this.delayMs, elapsed) : now - this.delayMs;
    if (time <= first.time) return first.value;
    for (let i = 1; i < this.frames.length; i++) { const b = this.frames[i], a = this.frames[i - 1]; if (time <= b.time) return interpolate(a.value, b.value, (time - a.time) / (b.time - a.time)); }
    return last.value;
  }
  private presentAt(target: number, elapsed: number) {
    if (this.presented === null || target - this.presented > PRESENTATION_JUMP_MS) return this.presented = target;
    return this.presented = Math.max(this.presented, Math.min(this.presented + elapsed * 1.05, Math.max(this.presented + elapsed * .95, target)));
  }
  clear() { this.frames = []; this.presented = null; this.lastNow = null; this.lastArrival = null; this.delay?.resume(); }
}
