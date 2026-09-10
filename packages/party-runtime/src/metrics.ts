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
export class SnapshotBuffer<T> {
  private frames: { time: number; value: T }[] = [];
  constructor(readonly delayMs = 100, readonly capacity = 32) { if (delayMs < 0 || !Number.isFinite(delayMs) || !Number.isInteger(capacity) || capacity < 2) throw new Error('Invalid snapshot buffer.'); }
  push(time: number, value: T) { if (!Number.isFinite(time) || time <= (this.frames.at(-1)?.time ?? -Infinity)) return; this.frames.push({ time, value }); if (this.frames.length > this.capacity) this.frames.shift(); }
  sample(now: number, interpolate: (a: T, b: T, alpha: number) => T): T | undefined {
    const time = now - this.delayMs, first = this.frames[0], last = this.frames.at(-1);
    if (!first || !last) return;
    if (time <= first.time) return first.value;
    for (let i = 1; i < this.frames.length; i++) { const b = this.frames[i], a = this.frames[i - 1]; if (time <= b.time) return interpolate(a.value, b.value, (time - a.time) / (b.time - a.time)); }
    return last.value;
  }
  clear() { this.frames = []; }
}
