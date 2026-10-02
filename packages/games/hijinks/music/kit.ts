/* Shared composition kit for Hijinks tracks: a Track type, phrase placement and extra instruments built on synth.ts. */
import { SR, TAU, attack, biquad, chord, clock, gate, len, mtof, put, seq, synth, taiko, white, type Bus } from './synth';

/** One seamless loop. `bars × beats × 60 / bpm` is its exact length; export.ts checks the render against it. */
export type Track = { id: string; title: string; mood: string; bpm: number; bars: number; beats?: number; /** Integrated loudness target (LUFS), default -16. */ lufs?: number; render(): Bus };
export const loopSeconds = (t: Track) => t.bars * (t.beats ?? 4) * 60 / t.bpm;
export type Clock = ReturnType<typeof clock>;
export type Play = (t: number, d: number, f: number, v: number) => void;

/** Places a seq() melody from a bar; jitter humanizes timing (seconds). */
export function melody(c: Clock, bar: number, s: string, play: Play, r: () => number, o: { vel?: number; jitter?: number; transpose?: number; legato?: number } = {}) {
  for (const n of seq(s)) if (n.m !== null) {
    const t = c.at(bar, n.at) + (r() - .5) * (o.jitter ?? .01), d = c.at(bar, n.at + n.d) - c.at(bar, n.at);
    play(t, d * (o.legato ?? .92), mtof(n.m + (o.transpose ?? 0)), (o.vel ?? .8) * (n.acc ? 1.15 : .9 + r() * .15));
  }
}
/** Lays phrases (one seq string per bar) end to end from a bar. */
export const phrase = (c: Clock, bar: number, bars: string[], play: Play, r: () => number, o?: Parameters<typeof melody>[5]) => bars.forEach((s, i) => melody(c, bar + i, s, play, r, o));
/** Each chord symbol with its bar and beat offset; a bar may hold one or two chords ("Cm7 F7"). */
export const chordsOf = (bars: string[]) => bars.flatMap((b, bar) => { const cs = b.split(' '); return cs.map((sym, k) => ({ sym, bar, beat: k * 4 / cs.length, beats: 4 / cs.length })); });

/* ── instruments ───────────────────────────────────────────────────────── */
/** Upright piano: inharmonic partials on two slightly detuned strings, hammer thump, damper on release. */
export function piano(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, honky = 4) {
  const tau = Math.max(.5, Math.min(4, 2.8 * Math.sqrt(262 / f))), x = len(Math.min(dur, tau * 3) + .25);
  for (const cents of [-honky, honky]) for (let n = 1; n <= 9; n++) {
    const fn = n * f * 2 ** (cents / 1200) * Math.sqrt(1 + .0004 * n * n); if (fn > SR * .4) break;
    const amp = n ** -1.15 * (n === 1 ? 1 : .35 + .65 * vel), decay = Math.exp(-1 / (tau / n ** .7 * SR)), k = 2 * Math.cos(TAU * fn / SR);
    let y1 = 0, y2 = -Math.sin(TAU * fn / SR), e = amp;
    for (let i = 0; i < x.length && e > 1e-4; i++) { const y = k * y1 - y2; y2 = y1; y1 = y; x[i] += y * e; e *= decay; }
  }
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = x[i] * attack(s, .002) * gate(s, dur, .1) * vel * .11 + white() * .05 * vel * Math.exp(-s / .005); }
  put(b, t, x, pan);
}
/** Cup-muted trumpet. */
export const horn = (b: Bus, t: number, d: number, f: number, v: number, pan = 0) => synth(b, t, d, f, v, pan, { wave: 'saw', cutoff: 700, env: 2400, envDecay: .12, res: .2, a: .035, d: .3, s: .75, r: .09, vib: .005, vibRate: 5.2 });
/** Bright brass section: three detuned saws with a filter blat. */
export const brass = (b: Bus, t: number, d: number, f: number, v: number, pan = 0) => synth(b, t, d, f, v, pan, { wave: 'saw', voices: 3, detune: 14, cutoff: 1100, env: 3800, envDecay: .14, res: .12, a: .018, d: .25, s: .8, r: .1, vib: .004, spread: .6 });
/** Funky clavinet: a thin pulse with a snappy filter. */
export const clav = (b: Bus, t: number, d: number, f: number, v: number, pan = 0) => synth(b, t, Math.min(d, .3), f, v, pan, { wave: 'pulse', pw: .2, cutoff: 700, env: 5200, envDecay: .06, res: .35, a: .001, d: .14, s: .35, r: .04 });
/** Warm string section with a slow bow. */
export const strings = (b: Bus, t: number, d: number, f: number, v: number, pan = 0, a = .25) => synth(b, t, d, f, v, pan, { wave: 'saw', voices: 4, detune: 16, cutoff: 2600, a, d: .6, s: .85, r: .45, vib: .003, spread: .9 });
/** Square-wave lead with a touch of vibrato, for hooks. */
export const lead = (b: Bus, t: number, d: number, f: number, v: number, pan = 0) => synth(b, t, d, f, v, pan, { wave: 'pulse', pw: .32, voices: 2, detune: 7, cutoff: 2600, env: 2600, envDecay: .1, a: .004, d: .2, s: .7, r: .08, vib: .006, vibRate: 5.6, spread: .5 });
/** Tonewheel organ: drawbar sines with a slow chorus wobble. */
export function organ(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, bars: readonly number[] = [.6, 1, .5, .55, .25, .2]) {
  const ratios = [.5, 1, 1.5, 2, 3, 4], x = len(dur + .1);
  for (let i = 0; i < x.length; i++) {
    const s = i / SR, w = 1 + .0025 * Math.sin(TAU * 6.4 * s); let v = 0;
    for (let k = 0; k < ratios.length; k++) if (bars[k]) v += Math.sin(TAU * f * ratios[k] * w * s) * bars[k];
    x[i] = v * attack(s, .008) * gate(s, dur, .05) * vel * .09 + (s < .006 ? white() * .02 * vel : 0);
  }
  put(b, t, x, pan);
}
/** Theremin: a sine that glides in from `from` Hz, with a wide, singing vibrato. */
export function theremin(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, from = f) {
  const x = len(dur + .3); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const s = i / SR, g = from + (f - from) * (1 - Math.exp(-s / .07)), fv = g * (1 + .018 * Math.sin(TAU * 6.2 * s) * Math.min(1, s / .25));
    ph += fv / SR; x[i] = (Math.sin(TAU * ph) + .12 * Math.sin(2 * TAU * ph)) * (1 - Math.exp(-s / .06)) * gate(s, dur, .12) * vel * .3;
  }
  put(b, t, x, pan);
}
/** Crash cymbal: bright noise and metal partials with a long shimmer. */
export function crash(b: Bus, t: number, vel: number, pan = 0, decay = 1.1) {
  const x = len(decay * 3.5);
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = (white() + .4 * Math.sin(TAU * 3260 * s + 3 * Math.sin(TAU * 1100 * s))) * (Math.exp(-s / decay) * .8 + Math.exp(-s / .05) * .6) * attack(s, .002); }
  biquad(x, 'hp', 3500); biquad(x, 'peak', 7000, .7, 4); biquad(x, 'lp', 13000);
  for (let i = 0; i < x.length; i++) x[i] *= vel * .2;
  put(b, t, x, pan);
}
/** Tom: a pitched membrane with a short drop. */
export function tom(b: Bus, t: number, vel: number, f = 140, pan = 0) {
  const x = len(.5); let ph = 0;
  for (let i = 0; i < x.length; i++) { const s = i / SR; ph += f * (1 + .5 * Math.exp(-s / .03)) / SR; x[i] = Math.tanh((Math.sin(TAU * ph) * Math.exp(-s / .18) + white() * .3 * Math.exp(-s / .01)) * 1.5) * vel * .45; }
  put(b, t, x, pan);
}
/** Timpani: a long low taiko-style hit tuned to f. */
export const timpani = (b: Bus, t: number, vel: number, f: number, pan = 0) => taiko(b, t, vel, pan, { f, decay: 1.1 });
/** Noise swell that rises into a downbeat (section transitions). */
export function riser(b: Bus, t: number, dur: number, vel: number) {
  const x = len(dur); let lp = 0;
  for (let i = 0; i < x.length; i++) { const k = i / x.length, a = .02 + .5 * k * k; lp += (white() - lp) * a; x[i] = (white() - lp) * k * k * vel * .25; }
  put(b, t, x, 0);
}
/** Swing walking bass for one chord span: root, chord tones, then a chromatic step into the next chord. */
export function walk(sym: string, next: string, beats: number, r: () => number) {
  const { root, iv } = chord(sym), base = 40 + ((root - 4 + 12) % 12), to = 40 + ((chord(next).root - 4 + 12) % 12);
  const tones = [base, base + iv[1], base + iv[2], iv[3] !== undefined && r() < .5 ? base + iv[3] : base + 12], approach = to + (r() < .5 ? -1 : 1);
  return beats === 2 ? [base, approach] : [tones[0], tones[1 + Math.floor(r() * 2)], tones[2 + Math.floor(r() * 2) % 2], approach];
}
