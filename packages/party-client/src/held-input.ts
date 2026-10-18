/** Latest held state: a change leaves at once (at most one per `minGapMs`); an unchanged hold resends every `intervalMs`. Release bypasses both. */
export class HeldInputChannel {
  private value: unknown;
  private json = '';
  private sentJson = '';
  private active = false;
  private lastSend = -Infinity;
  private nextSend = -Infinity;
  constructor(private transmit: (kind: 'state' | 'release', value?: unknown) => void, readonly intervalMs = 50, readonly minGapMs = 25) { if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !(minGapMs >= 0 && minGapMs <= intervalMs)) throw new Error('Invalid input cadence.'); }
  set(value: unknown, now: number) { this.json = JSON.stringify(value); this.value = JSON.parse(this.json); this.active = true; this.flush(now); }
  flush(now: number) {
    if (!this.active || !(now >= this.nextSend || this.json !== this.sentJson && now - this.lastSend >= this.minGapMs)) return;
    this.nextSend = now >= this.nextSend && Number.isFinite(this.nextSend) ? this.nextSend + (Math.floor((now - this.nextSend) / this.intervalMs) + 1) * this.intervalMs : now + this.intervalMs;
    this.lastSend = now; this.sentJson = this.json; this.transmit('state', this.value);
  }
  release(send = true) { const active = this.active; this.active = false; this.value = undefined; this.sentJson = ''; this.lastSend = this.nextSend = -Infinity; if (active && send) this.transmit('release'); }
}
