/** A tiny offline synthesizer: instruments write into stereo buses; a mix adds sends, ducking and a limiter. */
export const SR = 44100;
export type Bus = { l: Float32Array; r: Float32Array };
export const bus = (n: number): Bus => ({ l: new Float32Array(n), r: new Float32Array(n) });
const TAU = Math.PI * 2;

// ---------- theory ----------
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
export function midi(n: string) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n); if (!m) throw new Error(`Bad note ${n}`);
  return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
}
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
  '7': [0, 4, 7, 10], '9': [0, 4, 7, 10, 14], '13': [0, 4, 10, 14, 21], '7sus4': [0, 5, 7, 10], '9sus4': [0, 5, 7, 10, 14], m7b5: [0, 3, 6, 10],
  '7#9': [0, 4, 7, 10, 15], '7b9': [0, 4, 7, 10, 13], add9: [0, 4, 7, 14], sus2: [0, 2, 7],
};
/** Parses "Bbmaj9" into a root pitch class and intervals. */
export function chord(sym: string) {
  const m = /^([A-G])(#|b)?(.*)$/.exec(sym); if (!m || !(m[3] in QUALITY)) throw new Error(`Bad chord ${sym}`);
  return { root: PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), iv: QUALITY[m[3]] };
}
/** Voice-leads chords around a centre note; rootless drops the root from 4+ note chords (the bass has it). */
export function voicer(center: number, rootless = true) {
  let prev: number[] | null = null;
  return (sym: string) => {
    const { root, iv } = chord(sym), pcs = (rootless && iv.length > 3 ? iv.slice(1) : iv).map(i => (root + i) % 12);
    let best: number[] = [], score = Infinity;
    for (let r = 0; r < pcs.length; r++) for (const base of [center - 7, center - 2, center + 3]) {
      const notes: number[] = []; let last = base - 1;
      for (let k = 0; k < pcs.length; k++) { const pc = pcs[(r + k) % pcs.length]; let n = last + 1; while (((n % 12) + 12) % 12 !== pc) n++; notes.push(n); last = n; }
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      const s = prev ? notes.reduce((t, n, i) => t + Math.abs(n - (prev![i] ?? prev![prev!.length - 1])), 0) + Math.abs(mean - center) * 0.5 : Math.abs(mean - center);
      if (s < score) { score = s; best = notes; }
    }
    prev = best; return best;
  };
}
export const bassNote = (sym: string, octave = 2) => chord(sym).root + 12 * (octave + 1);
/** "A4:1 C5:.5 -:1" → notes in beats; ! accents, - rests, the duration carries over. */
export function seq(s: string) {
  let d = 1, at = 0; const out: { m: number | null; at: number; d: number; acc: boolean }[] = [];
  for (const tok of s.trim().split(/\s+/)) {
    const [n, dur] = tok.replace('!', '').split(':'); if (dur) d = Number(dur);
    out.push({ m: n === '-' ? null : midi(n), at, d, acc: tok.includes('!') }); at += d;
  }
  return out;
}

// ---------- randomness ----------
export function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let noise = rng(1);
export const seedNoise = (s: number) => { noise = rng(s); };
const white = () => noise() * 2 - 1;

// ---------- helpers ----------
/** Loop length in samples; notes that start before 0 (anticipations, humanized jitter) wrap to the loop's end. */
let loopN = 0;
function put(b: Bus, t: number, x: Float32Array, pan = 0, gain = 1) {
  const i0 = Math.round(t * SR), a = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4, gl = Math.cos(a) * gain * Math.SQRT2, gr = Math.sin(a) * gain * Math.SQRT2;
  for (let i = 0; i < x.length; i++) { let j = i0 + i; if (j < 0) j += loopN; if (j < 0 || j >= b.l.length) continue; b.l[j] += x[i] * gl; b.r[j] += x[i] * gr; }
}
const len = (s: number) => new Float32Array(Math.max(1, Math.round(s * SR)));
/** Release gate: 1 until dur, then an exponential fade. */
const gate = (s: number, dur: number, rel: number) => s < dur ? 1 : Math.exp(-(s - dur) / rel);
const attack = (s: number, a: number) => s < a ? s / a : 1;
function blep(t: number, dt: number) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }

export type BiquadType = 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf';
/** RBJ biquad, in place. */
export function biquad(x: Float32Array, type: BiquadType, f: number, q = 0.707, db = 0) {
  const w = TAU * Math.min(f, SR * 0.49) / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), A = 10 ** (db / 40);
  let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  if (type === 'lowshelf' || type === 'highshelf') {
    const s = type === 'lowshelf' ? 1 : -1, r = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) - s * (A - 1) * cw + r); b1 = s * 2 * A * ((A - 1) - s * (A + 1) * cw); b2 = A * ((A + 1) - s * (A - 1) * cw - r);
    a0 = (A + 1) + s * (A - 1) * cw + r; a1 = -s * 2 * ((A - 1) + s * (A + 1) * cw); a2 = (A + 1) + s * (A - 1) * cw - r;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const x0 = x[i], y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0; }
  return x;
}
export const filterBus = (b: Bus, type: BiquadType, f: number, q = 0.707, db = 0) => { biquad(b.l, type, f, q, db); biquad(b.r, type, f, q, db); return b; };

// ---------- instruments ----------
/** FM electric piano (Rhodes-like): bell-bright attack that mellows; low notes ring longer. */
export function ep(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0) {
  const tau = Math.max(0.7, Math.min(4, 2.4 * Math.sqrt(220 / f))), x = len(dur + 0.4);
  for (let i = 0; i < x.length; i++) {
    const s = i / SR, idx = (0.6 + 1.6 * vel) * Math.exp(-s / 0.22) + 0.22, env = attack(s, 0.003) * Math.exp(-s / tau) * gate(s, dur, 0.09);
    const car = Math.sin(TAU * f * s + idx * Math.sin(TAU * f * s)), tine = Math.sin(TAU * f * 7.02 * s) * 0.12 * vel * Math.exp(-s / 0.04);
    x[i] = (car + tine) * env * vel * 0.32;
  }
  put(b, t, x, pan);
}
/** Karplus-Strong string: bright = pick hardness, decay = seconds to fade, mute = damping after dur. */
export function pluck(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, o: { bright?: number; decay?: number; pick?: number; body?: number } = {}) {
  const bright = o.bright ?? 0.6, decay = o.decay ?? 1.6, pickPos = o.pick ?? 0.13, x = len(Math.min(dur + 0.25, decay * 1.6 + 0.1));
  const period = SR / f - 0.5, D = Math.floor(period), fr = period - D, g = 0.001 ** (1 / (f * decay)), gMute = 0.001 ** (1 / (f * 0.08));
  const ex = new Float32Array(D + 2); let lp = 0;
  for (let i = 0; i < ex.length; i++) { lp += (white() - lp) * (0.15 + 0.85 * bright); ex[i] = lp; }
  const pk = Math.max(1, Math.round(D * pickPos));
  for (let i = 0; i < x.length; i++) {
    const s = i / SR, fb = i > D ? (1 - fr) * x[i - D] + fr * x[i - D - 1] : 0, fb2 = i > D + 1 ? (1 - fr) * x[i - D - 1] + fr * x[i - D - 2] : 0;
    const exc = i < ex.length ? ex[i] - (i >= pk ? ex[i - pk] : 0) : 0;
    x[i] = exc + (s < dur ? g : gMute) * 0.5 * (fb + fb2);
  }
  if (o.body) biquad(x, 'peak', o.body, 1.2, 5);
  for (let i = 0; i < x.length; i++) x[i] *= vel * 0.45 * gate(i / SR, dur + 0.1, 0.06);
  put(b, t, x, pan);
}
/** Round sine bass with a little grit and a finger attack. */
export function bass(b: Bus, t: number, dur: number, f: number, vel: number, o: { drive?: number; bright?: number } = {}) {
  const drive = o.drive ?? 1.6, bright = o.bright ?? 0.3, x = len(dur + 0.08); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const s = i / SR; ph += f / SR;
    const env = attack(s, 0.006) * (0.75 + 0.25 * Math.exp(-s / 0.25)) * gate(s, dur, 0.05);
    const v = Math.sin(TAU * ph) + 0.28 * Math.sin(2 * TAU * ph) + bright * Math.sin(3 * TAU * ph) * Math.exp(-s / 0.06);
    x[i] = Math.tanh(v * drive) / Math.tanh(drive) * env * vel * 0.42;
  }
  put(b, t, x);
}
export type SynthOpts = { wave?: 'saw' | 'square' | 'pulse' | 'tri'; pw?: number; voices?: number; detune?: number; cutoff?: number; env?: number; envDecay?: number; res?: number; a?: number; d?: number; s?: number; r?: number; vib?: number; vibRate?: number; chip?: boolean; spread?: number };
/** Subtractive voice: PolyBLEP oscillators into a resonant state-variable low-pass. */
export function synth(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, o: SynthOpts = {}) {
  const wave = o.wave ?? 'saw', voices = o.voices ?? 1, det = o.detune ?? 0, cutoff = o.cutoff ?? 20000, envAmt = o.env ?? 0, envDecay = o.envDecay ?? 0.2;
  const A = o.a ?? 0.005, Dd = o.d ?? 0.2, S = o.s ?? 0.8, R = o.r ?? 0.1, k = 2 - 2 * Math.min(0.97, o.res ?? 0.1), vib = o.vib ?? 0, vr = o.vibRate ?? 5.5;
  const xl = len(dur + R * 5), xr = len(dur + R * 5), ph = Array.from({ length: voices }, (_, v) => (v * 0.37) % 1);
  let ic1l = 0, ic2l = 0, ic1r = 0, ic2r = 0;
  for (let i = 0; i < xl.length; i++) {
    const s = i / SR, adsr = (s < A ? s / A : S + (1 - S) * Math.exp(-(s - A) / Dd)) * gate(s, dur, R);
    let l = 0, r = 0;
    for (let v = 0; v < voices; v++) {
      const cents = voices > 1 ? (v / (voices - 1) - 0.5) * det : 0, fv = f * 2 ** (cents / 1200) * (1 + vib * Math.sin(TAU * vr * s) * Math.min(1, s / 0.3)), dt = fv / SR;
      ph[v] = (ph[v] + dt) % 1; const p = ph[v];
      let y: number;
      if (wave === 'saw') y = 2 * p - 1 - blep(p, dt);
      else if (wave === 'tri') { y = 4 * Math.abs(p - 0.5) - 1; if (o.chip) y = Math.round(y * 7.5) / 7.5; }
      else { const pw = wave === 'square' ? 0.5 : o.pw ?? 0.25; y = (p < pw ? 1 : -1) + (o.chip ? 0 : blep(p, dt) - blep((p + 1 - pw) % 1, dt)); }
      const w = voices > 1 ? v / (voices - 1) : 0.5; l += y * (1 - w * (o.spread ?? 0.8)); r += y * (1 - (1 - w) * (o.spread ?? 0.8));
    }
    l /= Math.sqrt(voices); r /= Math.sqrt(voices);
    if (cutoff < 19000 || envAmt) {
      const fc = Math.min(SR * 0.45, cutoff + envAmt * Math.exp(-s / envDecay)), g = Math.tan(Math.PI * fc / SR), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      let v3 = l - ic2l, v1 = a1 * ic1l + a2 * v3, v2 = ic2l + a2 * ic1l + a3 * v3; ic1l = 2 * v1 - ic1l; ic2l = 2 * v2 - ic2l; l = v2;
      v3 = r - ic2r; v1 = a1 * ic1r + a2 * v3; v2 = ic2r + a2 * ic1r + a3 * v3; ic1r = 2 * v1 - ic1r; ic2r = 2 * v2 - ic2r; r = v2;
    }
    xl[i] = l * adsr * vel * 0.22; xr[i] = r * adsr * vel * 0.22;
  }
  const a = (pan + 1) * Math.PI / 4; put(b, t, xl, -1, Math.cos(a) * Math.SQRT1_2 * 2); put(b, t, xr, 1, Math.sin(a) * Math.SQRT1_2 * 2);
}
/** Breathy wooden flute (shinobue / shakuhachi flavour) with delayed vibrato and a chiff. */
export function flute(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, o: { breath?: number; vib?: number } = {}) {
  const x = len(dur + 0.25), n = new Float32Array(x.length), breath = o.breath ?? 0.12, vib = o.vib ?? 0.006;
  for (let i = 0; i < n.length; i++) n[i] = white();
  biquad(n, 'bp', f * 2, 1.5);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const s = i / SR, env = (1 - Math.exp(-s / 0.045)) * gate(s, dur, 0.09), v = 1 + vib * Math.sin(TAU * 5.2 * s) * Math.min(1, Math.max(0, (s - 0.2) / 0.4));
    ph += f * v / SR;
    const tone = Math.sin(TAU * ph) + 0.22 * Math.sin(2 * TAU * ph) + 0.06 * Math.sin(3 * TAU * ph);
    x[i] = (tone * env + n[i] * (breath * env + 0.6 * Math.exp(-s / 0.03))) * vel * 0.3;
  }
  put(b, t, x, pan);
}
/** Mallet percussion from decaying sine partials: vibes (with motor tremolo), marimba, bell. */
const MALLETS = { vibes: [[1, 1, 2.4], [4, 0.22, 0.5], [10.2, 0.05, 0.12]], marimba: [[1, 1, 0.55], [3.99, 0.28, 0.12], [10.6, 0.05, 0.03]], bell: [[1, 1, 1.6], [2.76, 0.5, 0.8], [5.4, 0.28, 0.35], [8.93, 0.14, 0.15]], kane: [[1, 1, 0.22], [1.52, 0.7, 0.18], [2.33, 0.5, 0.1], [3.9, 0.3, 0.06]] } as const;
export function mallet(b: Bus, t: number, dur: number, f: number, vel: number, pan = 0, kind: keyof typeof MALLETS = 'vibes') {
  const parts = MALLETS[kind], x = len(Math.min(dur + 0.3, parts[0][2] * 3));
  for (let i = 0; i < x.length; i++) {
    const s = i / SR; let v = 0;
    for (const [ratio, amp, dec] of parts) if (f * ratio < SR * 0.45) v += Math.sin(TAU * f * ratio * s) * amp * Math.exp(-s / dec);
    const trem = kind === 'vibes' ? 1 - 0.28 * (0.5 + 0.5 * Math.sin(TAU * 5.3 * s)) : 1;
    x[i] = v * trem * attack(s, 0.001) * gate(s, dur + 0.15, 0.12) * vel * 0.3;
  }
  put(b, t, x, pan);
}

// ---------- drums ----------
export function kick(b: Bus, t: number, vel: number, o: { f0?: number; f1?: number; decay?: number; click?: number } = {}) {
  const f0 = o.f0 ?? 150, f1 = o.f1 ?? 48, decay = o.decay ?? 0.32, click = o.click ?? 0.25, x = len(decay * 4); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const s = i / SR; ph += (f1 + (f0 - f1) * Math.exp(-s / 0.04)) / SR;
    x[i] = Math.tanh((Math.sin(TAU * ph) * Math.exp(-s / decay) + white() * click * Math.exp(-s / 0.003)) * 1.6) * vel * 0.6;
  }
  put(b, t, x);
}
export function snare(b: Bus, t: number, vel: number, pan = 0, o: { tone?: number; snappy?: number; decay?: number } = {}) {
  const tone = o.tone ?? 190, x = len(0.35), n = new Float32Array(x.length);
  for (let i = 0; i < n.length; i++) n[i] = white();
  biquad(n, 'hp', 1500); biquad(n, 'peak', 5000, 1, 4);
  for (let i = 0; i < x.length; i++) {
    const s = i / SR;
    x[i] = ((Math.sin(TAU * tone * s) + 0.5 * Math.sin(TAU * tone * 1.74 * s)) * Math.exp(-s / 0.05) * 0.6 + n[i] * (o.snappy ?? 0.9) * Math.exp(-s / (o.decay ?? 0.13))) * vel * 0.4;
  }
  put(b, t, x, pan);
}
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
export function hat(b: Bus, t: number, vel: number, pan = 0, decay = 0.035) {
  const x = len(decay * 6 + 0.01);
  for (let i = 0; i < x.length; i++) { const s = i / SR; let v = 0; for (const m of METAL) v += (((m * 1.7 * s) % 1) < 0.5 ? 1 : -1); x[i] = (v / 6 * 0.6 + white() * 0.5) * Math.exp(-s / decay); }
  biquad(x, 'hp', 7000); biquad(x, 'peak', 10000, 1, 3); biquad(x, 'lp', 14000);
  for (let i = 0; i < x.length; i++) x[i] *= vel * 0.35;
  put(b, t, x, pan);
}
export function ride(b: Bus, t: number, vel: number, pan = 0.3) {
  const x = len(1.8);
  for (let i = 0; i < x.length; i++) { const s = i / SR; let v = 0; for (const [k, m] of METAL.entries()) v += Math.sin(TAU * m * 2.3 * s + k) * Math.exp(-s / (0.9 - k * 0.1)); x[i] = (v / 6 + white() * 0.1 * Math.exp(-s / 0.35)) * attack(s, 0.001); }
  biquad(x, 'hp', 2500); biquad(x, 'peak', 6500, 0.8, 5); biquad(x, 'lp', 10000);
  for (let i = 0; i < x.length; i++) x[i] *= vel * 0.22;
  put(b, t, x, pan);
}
export function clap(b: Bus, t: number, vel: number, pan = 0) {
  const x = len(0.3);
  for (let i = 0; i < x.length; i++) { const s = i / SR, burst = [0, 0.011, 0.022].reduce((v, d) => v + (s >= d ? Math.exp(-(s - d) / 0.006) : 0), 0); x[i] = white() * (burst * 0.7 + (s > 0.022 ? Math.exp(-(s - 0.022) / 0.11) * 0.5 : 0)); }
  biquad(x, 'bp', 1300, 0.9); biquad(x, 'hp', 600);
  for (let i = 0; i < x.length; i++) x[i] *= vel * 1.1;
  put(b, t, x, pan);
}
export function rim(b: Bus, t: number, vel: number, pan = 0) {
  const x = len(0.06);
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = (Math.sin(TAU * 1700 * s) * 0.6 + Math.sin(TAU * 520 * s) * 0.4 + white() * Math.exp(-s / 0.002)) * Math.exp(-s / 0.012) * vel * 0.4; }
  put(b, t, x, pan);
}
export function shaker(b: Bus, t: number, vel: number, pan = 0) {
  const x = len(0.12);
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = white() * (s < 0.012 ? s / 0.012 : Math.exp(-(s - 0.012) / 0.035)); }
  biquad(x, 'bp', 6500, 0.9);
  for (let i = 0; i < x.length; i++) x[i] *= vel * 0.7;
  put(b, t, x, pan);
}
/** Brush: a soft swish (long) or tap (short). */
export function brush(b: Bus, t: number, vel: number, pan = 0, sweep = 0.22) {
  const x = len(sweep + 0.15);
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = white() * (s < sweep * 0.4 ? s / (sweep * 0.4) : Math.exp(-(s - sweep * 0.4) / (sweep * 0.5))); }
  biquad(x, 'bp', 3800, 0.6); biquad(x, 'lp', 7000);
  for (let i = 0; i < x.length; i++) x[i] *= vel * 0.5;
  put(b, t, x, pan);
}
/** Taiko: deep membrane with a pitch drop and a skin slap; shime is the small tight drum. */
export function taiko(b: Bus, t: number, vel: number, pan = 0, o: { f?: number; decay?: number } = {}) {
  const f = o.f ?? 78, decay = o.decay ?? 0.55, x = len(decay * 4), n = new Float32Array(x.length); let p1 = 0, p2 = 0;
  for (let i = 0; i < n.length; i++) n[i] = white();
  biquad(n, 'lp', 900);
  for (let i = 0; i < x.length; i++) {
    const s = i / SR, fr = f * (1 + 0.35 * Math.exp(-s / 0.05)); p1 += fr / SR; p2 += fr * 1.59 / SR;
    x[i] = Math.tanh((Math.sin(TAU * p1) * Math.exp(-s / decay) + 0.35 * Math.sin(TAU * p2) * Math.exp(-s / (decay * 0.3)) + n[i] * 0.6 * Math.exp(-s / 0.02)) * 1.4) * vel * 0.55;
  }
  put(b, t, x, pan);
}
export function shime(b: Bus, t: number, vel: number, pan = 0) {
  const x = len(0.2), n = new Float32Array(x.length);
  for (let i = 0; i < n.length; i++) n[i] = white();
  biquad(n, 'bp', 2400, 1.2);
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = (Math.sin(TAU * 420 * (1 + 0.1 * Math.exp(-s / 0.01)) * s) * Math.exp(-s / 0.06) + n[i] * Math.exp(-s / 0.025)) * vel * 0.3; }
  put(b, t, x, pan);
}
export function woodblock(b: Bus, t: number, vel: number, pan = 0, f = 950) {
  const x = len(0.08);
  for (let i = 0; i < x.length; i++) { const s = i / SR; x[i] = (Math.sin(TAU * f * s) + 0.4 * Math.sin(TAU * f * 2.6 * s)) * Math.exp(-s / 0.018) * vel * 0.35; }
  put(b, t, x, pan);
}
/** 8-bit noise drums from a 15-bit LFSR; short = metallic hats. */
export function chipNoise(b: Bus, t: number, vel: number, dur: number, rate = 8000, short = false, pan = 0) {
  const x = len(dur); let reg = 1, v = 1, acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += rate / SR; while (acc >= 1) { acc--; const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1; reg = (reg >> 1) | (bit << 14); v = reg & 1 ? 1 : -1; }
    x[i] = v * Math.round(15 * Math.exp(-(i / SR) / (dur / 3))) / 15 * vel * 0.18;
  }
  put(b, t, x, pan);
}
/** Record-player surface: sparse crackles over a faint hiss. */
export function vinyl(b: Bus, level = 1, r = rng(9)) {
  for (let i = 0; i < b.l.length; i++) { const h = white() * 0.004 * level; b.l[i] += h; b.r[i] += h; }
  for (let s = 0; s < b.l.length / SR; s += r() * 0.35) {
    const i = Math.round(s * SR), a = (r() * 0.08 + 0.01) * level, side = r() < 0.5 ? b.l : b.r;
    for (let k = 0; k < 40 && i + k < side.length; k++) side[i + k] += a * (r() * 2 - 1) * Math.exp(-k / 6);
  }
  filterBus(b, 'lp', 7000);
}

// ---------- effects ----------
/** Freeverb (Jezar): 8 damped combs + 4 allpasses per side. */
export function reverb(input: Bus, room = 0.82, damp = 0.35, wet = 1, predelay = 0.02): Bus {
  const out = bus(input.l.length), combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225], pd = Math.round(predelay * SR);
  for (const [ch, spread] of [[0, 0], [1, 23]] as const) {
    const x = ch ? input.r : input.l, y = ch ? out.r : out.l;
    const cb = combs.map(n => ({ buf: new Float32Array(n + spread), i: 0, st: 0 })), ab = aps.map(n => ({ buf: new Float32Array(n + spread), i: 0 }));
    for (let n = 0; n < x.length; n++) {
      const inp = (n >= pd ? x[n - pd] : 0) * 0.015; let s = 0;
      for (const c of cb) { const o = c.buf[c.i]; c.st = o * (1 - damp) + c.st * damp; c.buf[c.i] = inp + c.st * room; c.i = (c.i + 1) % c.buf.length; s += o; }
      for (const a of ab) { const o = a.buf[a.i]; a.buf[a.i] = s + o * 0.5; a.i = (a.i + 1) % a.buf.length; s = o - s; }
      y[n] = s * wet * 3;
    }
  }
  return out;
}
/** Ping-pong echo with a darkening feedback loop. */
export function echo(input: Bus, time: number, fb = 0.35, tone = 0.3): Bus {
  const out = bus(input.l.length), d = Math.round(time * SR); let lpL = 0, lpR = 0;
  for (let n = 0; n < input.l.length; n++) {
    const dl = n >= d ? out.l[n - d] : 0, dr = n >= d ? out.r[n - d] : 0;
    lpL += (dr - lpL) * (1 - tone); lpR += (dl - lpR) * (1 - tone);
    out.l[n] = (input.l[n] + input.r[n]) * 0.5 + lpL * fb; out.r[n] = lpR * fb;
  }
  for (let n = 0; n < out.l.length; n++) out.l[n] -= (input.l[n] + input.r[n]) * 0.5; // wet only
  return out;
}
/** Slow stereo chorus: two modulated delay taps. */
export function chorus(b: Bus, depth = 0.003, rate = 0.35, mixAmt = 0.5) {
  const base = Math.round(0.012 * SR), dep = depth * SR, src = { l: b.l.slice(), r: b.r.slice() };
  for (let n = 0; n < b.l.length; n++) for (const [ch, phase] of [[0, 0], [1, Math.PI]] as const) {
    const d = base + dep * (1 + Math.sin(TAU * rate * n / SR + phase)), p = n - d, i = Math.floor(p), f = p - i, s = ch ? src.r : src.l;
    const v = i >= 0 ? s[i] * (1 - f) + s[i + 1] * f : 0; (ch ? b.r : b.l)[n] = s[n] * (1 - mixAmt) + v * mixAmt;
  }
  return b;
}
/** Tremolo/autopan, like a Rhodes suitcase amp. */
export function autopan(b: Bus, rate: number, depth: number) {
  for (let n = 0; n < b.l.length; n++) { const m = Math.sin(TAU * rate * n / SR) * depth; b.l[n] *= 1 - m; b.r[n] *= 1 + m; }
  return b;
}

// ---------- mixing ----------
export type Send = { gain?: number; reverb?: number; echo?: number; duck?: number };
export class Mix {
  static last: Record<string, number> = {};
  readonly n: number; private master: Bus; private rev: Bus; private dly: Bus; private kicks: number[] = []; readonly levels: Record<string, number> = {};
  constructor(readonly seconds: number, readonly tail = 4) { this.n = Math.round((seconds + tail) * SR); loopN = Math.round(seconds * SR); this.master = bus(this.n); this.rev = bus(this.n); this.dly = bus(this.n); }
  bus() { return bus(this.n); }
  /** Registers kick hits for sidechain ducking. */
  kickAt(t: number) { this.kicks.push(t); }
  add(name: string, b: Bus, s: Send = {}) {
    const g = s.gain ?? 1, duck = s.duck ? this.duckCurve(s.duck) : null; let e = 0;
    for (let i = 0; i < this.n; i++) {
      const d = duck ? duck[i] : 1, l = b.l[i] * g * d, r = b.r[i] * g * d; e += l * l + r * r;
      this.master.l[i] += l; this.master.r[i] += r;
      if (s.reverb) { this.rev.l[i] += l * s.reverb; this.rev.r[i] += r * s.reverb; }
      if (s.echo) { this.dly.l[i] += l * s.echo; this.dly.r[i] += r * s.echo; }
    }
    this.levels[name] = 10 * Math.log10(e / this.n / 2 + 1e-12); Mix.last = this.levels;
  }
  private duckCurve(depth: number) {
    const c = new Float32Array(this.n).fill(1);
    for (const t of this.kicks) { const i0 = Math.round(t * SR); for (let k = 0; k < SR * 0.3 && i0 + k < this.n; k++) { const s = k / SR, g = 1 - depth * (s < 0.005 ? s / 0.005 : Math.exp(-(s - 0.005) / 0.09)); if (i0 + k >= 0) c[i0 + k] = Math.min(c[i0 + k], g); } }
    return c;
  }
  /** Renders sends, wraps the tail into the start (seamless loop), and masters to a loudness target. */
  finish(o: { room?: number; damp?: number; reverbGain?: number; echoTime?: number; echoFb?: number; lofi?: number; target?: number } = {}) {
    const m = this.master;
    filterBus(this.rev, 'hp', 250);
    const r = reverb(this.rev, o.room ?? 0.82, o.damp ?? 0.4, o.reverbGain ?? 1);
    const d = o.echoTime ? echo(this.dly, o.echoTime, o.echoFb ?? 0.35) : null;
    for (let i = 0; i < this.n; i++) { m.l[i] += r.l[i] + (d ? d.l[i] : 0); m.r[i] += r.r[i] + (d ? d.r[i] : 0); }
    filterBus(m, 'hp', 28);
    if (o.lofi) { filterBus(m, 'lp', o.lofi, 0.6); }
    const loop = Math.round(this.seconds * SR), out = bus(loop);
    for (let i = 0; i < this.n; i++) { out.l[i % loop] += m.l[i]; out.r[i % loop] += m.r[i]; }
    // Loudness: scale RMS to target, then a smooth look-ahead limiter at -1 dBFS.
    let e = 0; for (let i = 0; i < loop; i++) e += out.l[i] ** 2 + out.r[i] ** 2;
    const rms = Math.sqrt(e / loop / 2), gain = (o.target ?? 0.14) / (rms || 1), ceil = 0.89, look = Math.round(0.004 * SR), rel = Math.exp(-1 / (0.12 * SR));
    const need = new Float32Array(loop);
    for (let i = 0; i < loop; i++) { const p = Math.max(Math.abs(out.l[i]), Math.abs(out.r[i])) * gain; need[i] = p > ceil ? ceil / p : 1; }
    // Min over the next `look` samples (monotonic deque, wrapping), then a trailing box average: smooth, and never above need at a peak.
    const ahead = new Float32Array(loop), q = new Int32Array(loop + look); let h = 0, tl = 0;
    for (let j = 0; j < loop + look; j++) {
      while (tl > h && need[q[tl - 1] % loop] >= need[j % loop]) tl--; q[tl++] = j;
      const i = j - look; if (i < 0) continue; while (q[h] < i) h++; ahead[i] = need[q[h] % loop];
    }
    let g = 1, sum = 0;
    for (let i = 0; i < loop; i++) {
      sum += ahead[i] - (i >= look ? ahead[i - look] : 0); const box = (sum + Math.max(0, look - 1 - i)) / look;
      g = box < g ? box : box + (g - box) * rel; out.l[i] *= gain * g; out.r[i] *= gain * g;
    }
    return out;
  }
}
/** 16-bit stereo PCM WAV. */
export function wav(b: Bus) {
  const n = b.l.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.l[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.r[i])) * 32767), 46 + i * 4); }
  return buf;
}
/** Beat clock with optional swing on a subdivision (0.5 = 8ths, 0.25 = 16ths). */
export function clock(bpm: number, swing = 0.5, unit = 0.5, beatsPerBar = 4) {
  const spb = 60 / bpm;
  return {
    spb, bar: spb * beatsPerBar,
    at(bar: number, beat: number) {
      const pos = bar * beatsPerBar + beat, u = pos / (2 * unit), k = Math.floor(u + 1e-9), f = u - k;
      const fs = f < 0.5 ? f * swing / 0.5 : swing + (f - 0.5) * (1 - swing) / 0.5;
      return (k + fs) * 2 * unit * spb;
    },
  };
}
