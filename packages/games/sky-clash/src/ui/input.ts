import { neutralInput, type Buttons, type Input, type Presses } from '../model';
/**
 * Pure controller encoder: complete held state, monotonic press counters and aim (DESIGN.md "Controls").
 * A flick is the stick going from under .3 to over .85 within 80 ms while a thumb slides on the pad.
 * Attack up to 150 ms after a flick, or Attack pressed while the thumb is still sliding outward that becomes
 * a flick within 80 ms, counts as presses.smash. Attack while Shield is held counts as presses.grab.
 * A swipe on the phone's Attack or Special button is a press aimed along the swipe: Attack → presses.smash, Special → presses.special.
 */
export type Button = keyof Buttons;
/** 'touch' is the landing sample of a new thumb (never a flick), 'slide' a moving thumb, 'key' the keyboard. */
export type StickSource = 'touch' | 'slide' | 'key';
export const FLICK = { low: .3, high: .85, window: 80, after: 150, before: 80, moving: 40 } as const;
const BUTTONS: Button[] = ['attack', 'special', 'jump', 'shield', 'smash'];
const round = (v: number) => Math.round(v * 1000) / 1000;
type Sample = { at: number; x: number; y: number };
export class InputEncoder {
  private x = 0; private y = 0; private mag = 0; private lowAt = -Infinity; private movedAt = -Infinity;
  private flick: Sample | null = null; private pending: Sample | null = null;
  private sources: Record<Button, Set<string>> = { attack: new Set(), special: new Set(), jump: new Set(), shield: new Set(), smash: new Set() };
  private aim = { x: 0, y: 0 };
  readonly presses: Presses = { ...neutralInput().presses };
  constructor(initial?: Partial<Presses>) { this.sync(initial); }
  /** Raise counters to a server echo or a saved value; counters never decrease. */
  sync(echo?: Partial<Presses>) {
    if (echo) for (const k of Object.keys(this.presses) as (keyof Presses)[]) { const v = echo[k]; if (typeof v === 'number' && Number.isFinite(v)) this.presses[k] = Math.max(this.presses[k], Math.floor(v)); }
  }
  held(name: Button) { return this.sources[name].size > 0; }
  /** When a deferred Attack resolves; the caller runs tick() then. */
  get deferredUntil() { return this.pending && this.pending.at + FLICK.before; }
  private count(name: keyof Presses, x = this.x, y = this.y) { this.presses[name] += 1; if (name !== 'jump' && name !== 'shield') this.aim = { x: round(x), y: round(y) }; }
  stick(x: number, y: number, now: number, source: StickSource = 'slide') {
    const m = Math.hypot(x, y);
    if (this.mag < FLICK.low) this.lowAt = now; // It rested low until this sample.
    if (source === 'slide' && m >= FLICK.high && this.mag < FLICK.high && now - this.lowAt <= FLICK.window) {
      if (this.pending && now - this.pending.at <= FLICK.before) { this.pending = null; this.count('smash', x, y); }
      else this.flick = { at: now, x, y };
    }
    if (m < FLICK.low) this.lowAt = now;
    if (source === 'slide' && m > this.mag + .02) this.movedAt = now;
    this.x = x; this.y = y; this.mag = m;
  }
  /** `swipe` is a unit direction (pad axes) from a swipe on the button: it replaces the stick as aim and skips the flick and grab rules. */
  button(name: Button, down: boolean, now: number, source = 'touch', swipe?: { x: number; y: number }) {
    const was = this.held(name);
    if (down) this.sources[name].add(source); else this.sources[name].delete(source);
    if (!down || was) return;
    if (swipe) { this.count(name === 'attack' ? 'smash' : name, swipe.x, swipe.y); return; }
    if (name !== 'attack') { this.count(name); return; }
    if (this.held('shield')) { this.count('grab'); return; }
    if (this.flick && now - this.flick.at <= FLICK.after) { const f = this.flick; this.flick = null; this.count('smash', f.x, f.y); return; }
    // The thumb is still sliding outward: wait briefly in case this becomes a flick.
    if (this.mag >= FLICK.low / 2 && this.mag < FLICK.high && now - this.movedAt <= FLICK.moving) { this.pending = { at: now, x: this.x, y: this.y }; return; }
    this.count('attack');
  }
  /** Dedicated grab key: a press only, never held. */
  grab() { this.count('grab'); }
  /** Resolve a deferred Attack that did not become a flick (aimed where the stick was at the press). True when the input changed. */
  tick(now: number) {
    const p = this.pending; if (!p || now - p.at < FLICK.before) return false;
    this.pending = null; this.count('attack', p.x, p.y); return true;
  }
  input(): Input {
    const held = {} as Buttons; for (const b of BUTTONS) held[b] = this.held(b);
    return { x: round(this.x), y: round(this.y), held, presses: { ...this.presses }, aim: { ...this.aim } };
  }
  neutral() { return !this.x && !this.y && BUTTONS.every(b => !this.held(b)) && !this.pending; }
  /** Cancel every hold (blur, hidden tab, unmount, disabled). Counters are kept; a deferred Attack is dropped. */
  release() { for (const b of BUTTONS) this.sources[b].clear(); this.x = this.y = this.mag = 0; this.pending = this.flick = null; this.lowAt = -Infinity; }
}
/** Swipe gestures on a button: px travel, flick (short fast release) px and px/ms, and ms a still thumb waits before it is a tap. */
export const SWIPE = { distance: 28, flick: 14, speed: .35, tap: 60, still: 8, max: 220 } as const;
/**
 * Classifies a thumb on a gesture button from its travel (screen px, +y down) after `ms`: a unit swipe direction, 'tap',
 * or null while undecided. `up` is the release, which always decides.
 */
export function readSwipe(dx: number, dy: number, ms: number, up = false): { x: number; y: number } | 'tap' | null {
  const d = Math.hypot(dx, dy), dir = { x: round(dx / d), y: round(dy / d) };
  if (d >= SWIPE.distance || up && d >= SWIPE.flick && d / Math.max(1, ms) >= SWIPE.speed) return dir;
  return up || ms >= SWIPE.max || ms >= SWIPE.tap && d < SWIPE.still ? 'tap' : null;
}
/** Laptop layout. Movement keys follow the pad axes (+y down). */
export const KEY_BUTTONS: Record<string, Button | 'grab'> = { j: 'attack', k: 'jump', ' ': 'jump', l: 'special', i: 'smash', shift: 'shield', u: 'grab' };
export const MOVE_KEYS: Record<string, [number, number]> = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1] };
export function keyStick(keys: Iterable<string>) {
  let x = 0, y = 0; const seen = new Set<string>();
  for (const k of keys) { const v = MOVE_KEYS[k]; if (!v || seen.has(`${v}`)) continue; seen.add(`${v}`); x += v[0]; y += v[1]; }
  const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l };
}
