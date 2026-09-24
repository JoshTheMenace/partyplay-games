/** Small shared helpers: deterministic RNG, events, stick/press reading with the phone-friendly buffer. */
import type { EventKind, GameEvent, Input } from '../model';
import { BUFFER, PRESS_KEYS, type Fighter, type PressKey, type State } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const approach = (v: number, target: number, step: number) => v + clamp(target - v, -step, step);
export const sign = (v: number): 1 | -1 => (v < 0 ? -1 : 1);
/** mulberry32 over the state's seed: the only randomness in the simulation. */
export function random(s: State): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const EVENT_WINDOW = 60, EVENT_CAP = 48;
export function emit(s: State, kind: EventKind, x: number, y: number, extra: Omit<Partial<GameEvent>, 'id' | 'kind' | 'frame' | 'x' | 'y'> = {}) {
  const e: GameEvent = { id: ++s.eventId, kind, frame: s.frame, x, y };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (e as Record<string, unknown>)[k] = v;
  s.events.push(e);
}
export function pruneEvents(s: State) {
  const from = s.frame - EVENT_WINDOW; let i = 0;
  while (i < s.events.length && (s.events[i]!.frame < from || s.events.length - i > EVENT_CAP)) i++;
  if (i) s.events.splice(0, i);
}
const dead = (v: number) => (Math.abs(v) < .18 ? 0 : clamp(v, -1, 1));
/** Fold one input sample into the fighter: stick history, press counters → buffered press frames, captured aim. */
export function readInput(s: State, f: Fighter, input: Input) {
  f.hist.unshift([f.sx, f.sy]); if (f.hist.length > 6) f.hist.length = 6;
  f.sx = dead(input.x); f.sy = -dead(input.y);
  for (const k of PRESS_KEYS) {
    const v = input.presses[k];
    // Counters never go down: a release (all zeros) or a reconnect is ignored until the client, which syncs to the presses echo, counts past it.
    if (v > f.seen[k]) { f.seen[k] = v; f.buf[k] = s.frame; if (k !== 'jump' && k !== 'shield') f.aim = { x: dead(input.aim.x), y: -dead(input.aim.y) }; }
  }
  f.held = { ...input.held };
}
export const pressed = (s: State, f: Fighter, k: PressKey) => s.frame - f.buf[k] <= BUFFER;
export const consume = (f: Fighter, ...keys: PressKey[]) => { for (const k of keys) f.buf[k] = -1e9; };
/** A smash flick: the axis crossed from near neutral to beyond .75 within the last few frames. */
export function flick(f: Fighter, axis: 0 | 1, frames = 3): number {
  const v = axis ? f.sy : f.sx; if (Math.abs(v) < .75) return 0;
  return f.hist.slice(0, frames).some(h => Math.abs(h[axis]) < .35 || Math.sign(h[axis]) !== Math.sign(v)) ? Math.sign(v) : 0;
}
/** Direction for a button press: the captured aim when it is a real direction (swipes, a stick that recentered), else the live stick. */
export const aimDir = (f: Fighter): { x: number; y: number } => (Math.hypot(f.aim.x, f.aim.y) >= .3 ? f.aim : { x: f.sx, y: f.sy });
export type Dir = 'neutral' | 'up' | 'down' | 'forward' | 'back';
/** `generousUp` (party specials): up whenever y > .3 and y ≥ .5·|x|. */
export function classify(f: Fighter, d = aimDir(f), generousUp = false): Dir {
  if (Math.hypot(d.x, d.y) < .3) return 'neutral';
  if (generousUp && d.y > .3 && d.y >= .5 * Math.abs(d.x)) return 'up';
  if (Math.abs(d.y) > Math.abs(d.x)) return d.y > 0 ? 'up' : 'down';
  return Math.sign(d.x) === f.facing ? 'forward' : 'back';
}
