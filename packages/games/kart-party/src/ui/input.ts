/* Held-input composition shared by touch, keyboard and gamepad. Pure (no DOM) so it is unit-tested.
 * Every source (a pointer, a key, a stick) registers what it holds; the composer folds them into ONE
 * complete Input and emits it only when something changed. Presses are counters: hop increments when
 * drift goes from released to held, fire when item does. seq increments on every emitted change and
 * is always ≥ 1 (seq 0 is reserved for the platform's release/stale neutral; see sim/race.ts). */
import type { Input } from '../sim/types';

export type HoldKind = 'drift' | 'brake' | 'item';
const wrap256 = (n: number) => (n + 1) % 256;
const round2 = (n: number) => Math.round(n * 100) / 100 + 0;

export class InputComposer {
  input: Input = { steer: 0, drift: false, brake: false, item: false, hop: 0, fire: 0, seq: 0 };
  private holds: Record<HoldKind, Set<string>> = { drift: new Set(), brake: new Set(), item: new Set() };
  private steers = new Map<string, number>();
  private sent = false;
  constructor(private emit: (input: Input) => void) {}
  /** Continue the server's counters (after a reload) so the first input is never read as a press. */
  seed(hop: number, fire: number, seq: number) { if (!this.sent) this.input = { ...this.input, hop: hop & 255, fire: fire & 255, seq: Math.max(0, Math.floor(seq)) }; }
  hold(kind: HoldKind, source: string, down: boolean) {
    const set = this.holds[kind];
    if (down === set.has(source)) return;
    if (down) set.add(source); else set.delete(source);
    this.commit(down && set.size === 1 ? kind : null);
  }
  /** value in [-1, 1]; 0 removes the source. Sources sum (left + right keys cancel out). */
  steer(source: string, value: number) {
    const v = round2(Math.max(-1, Math.min(1, value)));
    if ((this.steers.get(source) ?? 0) === v) return;
    if (v) this.steers.set(source, v); else this.steers.delete(source);
    this.commit(null);
  }
  /** Drop every source whose id starts with `prefix` (all sources when omitted). Counters are kept. */
  clear(prefix = '') {
    for (const set of Object.values(this.holds)) for (const s of set) if (s.startsWith(prefix)) set.delete(s);
    for (const s of this.steers.keys()) if (s.startsWith(prefix)) this.steers.delete(s);
    this.commit(null);
  }
  get neutral() { const i = this.input; return !i.steer && !i.drift && !i.brake && !i.item; }
  /** Re-send the current state (e.g. on mount) without changing it. */
  flush() { this.input = { ...this.input, seq: this.input.seq + 1 }; this.sent = true; this.emit(this.input); }
  private commit(pressed: HoldKind | null) {
    let steer = 0; for (const v of this.steers.values()) steer += v;
    const cur = this.input, next: Input = { steer: round2(Math.max(-1, Math.min(1, steer))), drift: this.holds.drift.size > 0, brake: this.holds.brake.size > 0, item: this.holds.item.size > 0,
      hop: pressed === 'drift' ? wrap256(cur.hop) : cur.hop, fire: pressed === 'item' ? wrap256(cur.fire) : cur.fire, seq: cur.seq };
    if (next.steer === cur.steer && next.drift === cur.drift && next.brake === cur.brake && next.item === cur.item && next.hop === cur.hop && next.fire === cur.fire) return;
    next.seq = cur.seq + 1; this.input = next; this.sent = true; this.emit(next);
  }
}

/** Horizontal thumb travel → steer, with a small dead zone and a soft curve so small movements make small corrections. */
export function steerFromDrag(dx: number, radius: number) {
  const x = Math.max(-1, Math.min(1, dx / Math.max(1, radius))), a = Math.abs(x);
  return a < .08 ? 0 : round2(Math.sign(x) * ((a - .08) / .92) ** 1.7);
}
/** A held steering key eases in: a tap is a gentle correction, holding builds to full lock over 0.4 s. */
export const keySteer = (heldMs: number) => round2(Math.min(1, .35 + .65 * Math.max(0, heldMs) / 400));
export type KeyBinding = { steer: -1 | 1 } | { hold: HoldKind } | { honk: true };
/** Arrows/A-D steer, Space or Shift drift/hop, E or Enter item, S/Down brake, H honk. */
export function keyBinding(key: string): KeyBinding | null {
  switch (key.length === 1 ? key.toLowerCase() : key) {
    case 'ArrowLeft': case 'a': return { steer: -1 };
    case 'ArrowRight': case 'd': return { steer: 1 };
    case ' ': case 'Shift': return { hold: 'drift' };
    case 'e': case 'Enter': return { hold: 'item' };
    case 's': case 'ArrowDown': return { hold: 'brake' };
    case 'h': return { honk: true };
    default: return null;
  }
}
/** Standard-mapping gamepad → steer and holds. Left stick / d-pad steer, A drift, X or RB item, B brake, Y honk. */
export function readPad(pad: { axes: readonly number[]; buttons: readonly { pressed: boolean; value?: number }[] }) {
  const b = (i: number) => !!pad.buttons[i]?.pressed, raw = pad.axes[0] ?? 0, a = Math.abs(raw);
  const stick = a < .15 ? 0 : Math.sign(raw) * ((a - .15) / .85) ** 1.7, dpad = Number(b(15)) - Number(b(14));
  return { steer: round2(Math.max(-1, Math.min(1, stick + dpad))), drift: b(0), item: b(2) || b(5), brake: b(1), honk: b(3) };
}
