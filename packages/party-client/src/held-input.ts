/** One latest state at 20 Hz, regardless of pointer event frequency. Release bypasses coalescing. */
export class HeldInputChannel {
  private value: unknown;
  private active = false;
  private nextSend = -Infinity;
  constructor(private transmit: (kind: 'state' | 'release', value?: unknown) => void, readonly intervalMs = 50) { if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('Invalid input cadence.'); }
  set(value: unknown, now: number) { this.value = JSON.parse(JSON.stringify(value)); this.active = true; this.flush(now); }
  flush(now: number) { if (this.active && now >= this.nextSend) { this.nextSend = Number.isFinite(this.nextSend) ? this.nextSend + (Math.floor((now - this.nextSend) / this.intervalMs) + 1) * this.intervalMs : now + this.intervalMs; this.transmit('state', this.value); } }
  release(send = true) { const active = this.active; this.active = false; this.value = undefined; this.nextSend = -Infinity; if (active && send) this.transmit('release'); }
}
