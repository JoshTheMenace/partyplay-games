/** Wall-clock deadlines advance across stalls; physics never receives an oversized dt. */
export class FixedStepClock {
  private last: number;
  private accumulated = 0;
  simulatedAt: number;
  droppedMs = 0;
  readonly stepMs: number;
  constructor(startAt: number, hz = 60, readonly maxCatchUpSteps = 6) {
    if (!Number.isFinite(startAt) || !Number.isInteger(hz) || hz < 1 || hz > 120 || !Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps < 1 || maxCatchUpSteps > 12) throw new Error('Invalid simulation clock.');
    this.last = this.simulatedAt = startAt; this.stepMs = 1000 / hz;
  }
  advance(now: number, tick: (dtSeconds: number, nowMs: number) => void): number {
    if (!Number.isFinite(now) || now <= this.last) return 0;
    this.accumulated += now - this.last; this.last = now;
    const available = Math.floor((this.accumulated + 1e-7) / this.stepMs), count = Math.min(available, this.maxCatchUpSteps);
    const skipped = (available - count) * this.stepMs;
    this.droppedMs += skipped; this.simulatedAt += skipped; this.accumulated -= available * this.stepMs;
    for (let i = 0; i < count; i++) { this.simulatedAt += this.stepMs; tick(this.stepMs / 1000, this.simulatedAt); }
    return count;
  }
}
