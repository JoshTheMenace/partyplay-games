/* Automatic graphics quality for phones.
 *
 * Tier 0 is full quality; each higher tier is cheaper. Only sustained frame
 * time moves it: a tier is dropped after consecutive windows whose p95 frame
 * interval misses the budget, and restored only after a long calm stretch, so a
 * single hitch never changes the picture and the two thresholds cannot chase
 * each other. Snapshot underruns are a network symptom and are deliberately not
 * an input — rendering less cannot make packets arrive sooner. */

export type QualityGovernorOptions = {
  windowMs?: number;
  /** A window whose p95 interval exceeds this counts against the current tier. */
  downP95Ms?: number;
  /** Consecutive over-budget windows before dropping one tier. */
  downWindows?: number;
  /** Continuous time with every window's p95 below `upP95Ms` before restoring one tier. */
  upAfterMs?: number;
  upP95Ms?: number;
};

export class QualityGovernor {
  private tierIndex = 0;
  private samples: number[] = [];
  private windowStart: number | null = null;
  private overWindows = 0;
  private calmSince: number | null = null;
  private readonly windowMs: number;
  private readonly downP95Ms: number;
  private readonly downWindows: number;
  private readonly upAfterMs: number;
  private readonly upP95Ms: number;

  constructor(readonly tiers: number, options: QualityGovernorOptions = {}) {
    this.windowMs = options.windowMs ?? 3000;
    this.downP95Ms = options.downP95Ms ?? 20;
    this.downWindows = options.downWindows ?? 2;
    this.upAfterMs = options.upAfterMs ?? 15000;
    this.upP95Ms = options.upP95Ms ?? 14;
    if (!Number.isInteger(tiers) || tiers < 1 || !(this.windowMs > 0) || !(this.upP95Ms <= this.downP95Ms) || !Number.isInteger(this.downWindows) || this.downWindows < 1 || !(this.upAfterMs >= this.windowMs)) throw new Error('Invalid quality governor.');
  }

  get tier() { return this.tierIndex; }

  /** Record one frame interval ending at `nowMs`; returns the tier to render the next frame at. */
  frame(intervalMs: number, nowMs: number): number {
    // A gap this long is a suspended tab or a debugger, not a slow frame.
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 1000 || !Number.isFinite(nowMs)) return this.tierIndex;
    this.windowStart ??= nowMs - intervalMs;
    this.samples.push(intervalMs);
    if (nowMs - this.windowStart < this.windowMs) return this.tierIndex;

    const sorted = this.samples.sort((a, b) => a - b), p95 = sorted[Math.floor((sorted.length - 1) * .95)];
    const started = this.windowStart;
    this.samples = []; this.windowStart = nowMs;
    if (p95 > this.downP95Ms) {
      this.calmSince = null;
      if (++this.overWindows >= this.downWindows) { this.overWindows = 0; if (this.tierIndex < this.tiers - 1) this.tierIndex++; }
      return this.tierIndex;
    }
    this.overWindows = 0;
    if (p95 >= this.upP95Ms) { this.calmSince = null; return this.tierIndex; }
    this.calmSince ??= started;
    if (this.tierIndex > 0 && nowMs - this.calmSince >= this.upAfterMs) { this.tierIndex--; this.calmSince = null; }
    return this.tierIndex;
  }

  /** Discard the partial window, e.g. after a scene remount or a suspended tab. The tier is kept. */
  reset() { this.samples = []; this.windowStart = null; this.overWindows = 0; this.calmSince = null; }
}
