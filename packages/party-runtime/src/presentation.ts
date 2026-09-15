/* How far behind the newest snapshot a client presents.
 *
 * Starts at a fixed delay and adapts, within bounds, to the arrival gaps this
 * client actually sees: modest delivery jitter should not freeze motion, and a
 * clean link should not pay for the worst one. The estimate is a high
 * percentile rather than the maximum, so an isolated stall is ridden out rather
 * than learned. Changes are slewed against elapsed time, so a presentation
 * clock built on this never runs backward. */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export type PresentationDelayOptions = {
  initialMs?: number; minMs?: number; maxMs?: number;
  /** Arrival gaps remembered. */
  windowSize?: number;
  /** Headroom added to the observed gap percentile. */
  marginMs?: number;
  /** Largest delay change per millisecond elapsed; .05 keeps presentation within 95–105% speed. */
  slew?: number;
};

export class PresentationDelay {
  readonly minMs: number;
  readonly maxMs: number;
  private readonly windowSize: number;
  private readonly marginMs: number;
  private readonly slew: number;
  private gaps: number[] = [];
  private lastArrival: number | null = null;
  private current: number;
  private target: number;

  constructor(options: PresentationDelayOptions = {}) {
    this.minMs = options.minMs ?? 75;
    this.maxMs = options.maxMs ?? 150;
    this.windowSize = options.windowSize ?? 40;
    this.marginMs = options.marginMs ?? 15;
    this.slew = options.slew ?? .05;
    if (!(this.minMs >= 0) || !(this.maxMs >= this.minMs) || !Number.isFinite(this.maxMs) || !Number.isInteger(this.windowSize) || this.windowSize < 4 || !(this.marginMs >= 0) || !(this.slew > 0 && this.slew < 1)) throw new Error('Invalid presentation delay.');
    this.current = this.target = clamp(options.initialMs ?? 100, this.minMs, this.maxMs);
  }

  get ms() { return this.current; }
  get targetMs() { return this.target; }

  /** Record a snapshot arrival on the local monotonic clock. */
  arrival(atMs: number) {
    if (!Number.isFinite(atMs)) return;
    if (this.lastArrival !== null) {
      const gap = atMs - this.lastArrival;
      if (gap >= 0 && gap <= 1000) { this.gaps.push(gap); if (this.gaps.length > this.windowSize) this.gaps.shift(); }
    }
    this.lastArrival = atMs;
    if (this.gaps.length >= 8) {
      const sorted = [...this.gaps].sort((a, b) => a - b);
      this.target = clamp(sorted[Math.floor((sorted.length - 1) * .95)] + this.marginMs, this.minMs, this.maxMs);
    }
  }

  /** Move toward the target by at most `slew` of the elapsed time. */
  advance(elapsedMs: number) {
    const step = (Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0) * this.slew;
    this.current += clamp(this.target - this.current, -step, step);
  }

  /** Forget the last arrival, so a suspension or reconnect gap is not learned as jitter. */
  resume() { this.lastArrival = null; }
}
