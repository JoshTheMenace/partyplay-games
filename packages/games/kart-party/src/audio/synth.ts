/* WebAudio synthesis: the mixer, the per-kart engine voice and every one-shot effect. No samples.
 *
 * Gain staging: effects peak around 0.2–0.5 into the sfx bus → a gentle bus compressor → master →
 * a brick-wall-ish limiter, so a pile-up (explosion + hit + honk) gets louder, never clips. Every
 * envelope starts from 0 and ends on an exponential tail at −80 dB before its source stops, so
 * nothing clicks. Frequency sweeps are exponential (they sound linear in pitch). Works with any
 * BaseAudioContext, so the effects can also be rendered offline for QA. */
import { clamp } from '../sim/math';
import type { SoundId } from './cues';

export type Mixer = { ctx: BaseAudioContext; master: GainNode; sfx: GainNode; engines: GainNode; music: GainNode; duck: GainNode; noise: AudioBuffer };

const SILENT = .0001;
let horizon = 0;                 // latest envelope end scheduled by the current playSound call
let noiseSeed = 0x2545f491;
const noiseRandom = () => { noiseSeed ^= noiseSeed << 13; noiseSeed ^= noiseSeed >>> 17; noiseSeed ^= noiseSeed << 5; return (noiseSeed >>> 0) / 4294967296; };

export function createMixer(ctx: BaseAudioContext, out: AudioNode = ctx.destination): Mixer {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .002; limiter.release.value = .12;
  const master = ctx.createGain(); master.gain.value = .9;
  const bus = ctx.createDynamicsCompressor();
  bus.threshold.value = -18; bus.knee.value = 12; bus.ratio.value = 4; bus.attack.value = .004; bus.release.value = .22;
  const sfx = ctx.createGain(), engines = ctx.createGain(), music = ctx.createGain(), duck = ctx.createGain();
  sfx.gain.value = .85; engines.gain.value = .26; music.gain.value = .34;   // engine ≈ −23 dBFS at speed: effects sit on top duck.gain.value = 1;
  sfx.connect(bus); engines.connect(bus); bus.connect(master);
  music.connect(duck).connect(master);                         // music skips the sfx compressor so effects never pump it
  master.connect(limiter).connect(out);
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate), data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = noiseRandom() * 2 - 1;
  return { ctx, master, sfx, engines, music, duck, noise };
}

/* ---------------- building blocks ---------------- */
type Wave = OscillatorType;
type ToneSpec = { type?: Wave; f0: number; f1?: number; at?: number; dur: number; peak: number; attack?: number; filter?: BiquadFilterType; cutoff?: number; q?: number; vibrato?: [rate: number, depth: number]; hold?: number };
type NoiseSpec = { at?: number; dur: number; peak: number; attack?: number; filter: BiquadFilterType; f0: number; f1?: number; q?: number; hold?: number };

/** 0 → peak (linear attack) → optional hold → exponential tail to −80 dB at t + dur. */
function envelope(g: AudioParam, t: number, peak: number, attack: number, dur: number, hold = 0) {
  const a = Math.min(attack, dur * .5), h = Math.min(hold, dur - a - .01);
  g.setValueAtTime(0, t); g.linearRampToValueAtTime(peak, t + a);
  if (h > 0) g.setValueAtTime(peak, t + a + h);
  g.exponentialRampToValueAtTime(SILENT, t + dur);
}
function sweep(p: AudioParam, t: number, f0: number, f1: number | undefined, dur: number) {
  p.setValueAtTime(f0, t); if (f1 !== undefined && f1 !== f0) p.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
}
function tone(m: Mixer, out: AudioNode, t0: number, s: ToneSpec) {
  const ctx = m.ctx, t = t0 + (s.at ?? 0), osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = s.type ?? 'sine'; sweep(osc.frequency, t, s.f0, s.f1, s.dur);
  envelope(g.gain, t, s.peak, s.attack ?? .005, s.dur, s.hold); horizon = Math.max(horizon, t + s.dur);
  let head: AudioNode = osc;
  if (s.filter) { const f = ctx.createBiquadFilter(); f.type = s.filter; f.frequency.value = s.cutoff ?? 2000; f.Q.value = s.q ?? .7; head.connect(f); head = f; }
  head.connect(g).connect(out);
  const nodes: AudioScheduledSourceNode[] = [osc];
  if (s.vibrato) { const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = s.vibrato[0]; depth.gain.value = s.vibrato[1]; lfo.connect(depth).connect(osc.frequency); nodes.push(lfo); }
  for (const n of nodes) { n.start(t); n.stop(t + s.dur + .03); }
  osc.onended = () => { g.disconnect(); };
}
function noise(m: Mixer, out: AudioNode, t0: number, s: NoiseSpec) {
  const ctx = m.ctx, t = t0 + (s.at ?? 0), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = m.noise; src.loop = true;
  f.type = s.filter; f.Q.value = s.q ?? .8; sweep(f.frequency, t, s.f0, s.f1, s.dur);
  envelope(g.gain, t, s.peak, s.attack ?? .004, s.dur, s.hold); horizon = Math.max(horizon, t + s.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, noiseRandom() * 1.5); src.stop(t + s.dur + .03);
  src.onended = () => { g.disconnect(); };
}
const arpeggio = (m: Mixer, out: AudioNode, t: number, notes: readonly number[], step: number, spec: Omit<ToneSpec, 'f0'>) =>
  notes.forEach((f0, i) => tone(m, out, t, { ...spec, f0, at: (spec.at ?? 0) + i * step }));

/** A stereo placement feeding the sfx bus (StereoPanner where available). */
export function panned(m: Mixer, pan: number, gain: number, dest: AudioNode = m.sfx): AudioNode {
  const g = m.ctx.createGain(); g.gain.value = gain;
  if (pan !== 0 && typeof m.ctx.createStereoPanner === 'function') { const p = m.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p).connect(dest); }
  else g.connect(dest);
  return g;
}

/* ---------------- one-shot effects ---------------- */
const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, A4: 440, A5: 880, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637.02 };
const HONK = [440, 392, 349.23, 493.88, 466.16, 523.25, 415.3, 329.63];

/** Schedule one effect at context time `t` into `out`; returns how many seconds it lasts. */
export function playSound(m: Mixer, out: AudioNode, t: number, sound: SoundId, value: number | string = 0): number {
  horizon = t; schedule(m, out, t, sound, value); return horizon - t;
}
function schedule(m: Mixer, out: AudioNode, t: number, sound: SoundId, value: number | string): void {
  const v = typeof value === 'number' ? value : 0;
  switch (sound) {
    case 'countdown':
      tone(m, out, t, { type: 'triangle', f0: NOTE.A4, dur: .26, peak: .34, hold: .08 });
      tone(m, out, t, { type: 'square', f0: NOTE.A4, dur: .22, peak: .05, filter: 'lowpass', cutoff: 1800, hold: .06 });
      return;
    case 'go':
      tone(m, out, t, { type: 'triangle', f0: NOTE.A5, dur: .8, peak: .36, hold: .25 });
      tone(m, out, t, { type: 'square', f0: NOTE.A5, dur: .6, peak: .06, filter: 'lowpass', cutoff: 3000, hold: .2 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.E6, dur: .7, peak: .1, hold: .2 });
      return;
    case 'tier': {
      const f = [NOTE.D6, NOTE.D6, NOTE.G6, NOTE.C7][clamp(v, 0, 3)];
      tone(m, out, t, { f0: f, dur: .4, peak: .22 });
      tone(m, out, t, { f0: f * 2.76, dur: .16, peak: .045 });          // bell partial
      if (v >= 3) tone(m, out, t, { f0: f * 1.5, at: .07, dur: .45, peak: .16 });
      return;
    }
    case 'mini-turbo': {
      const k = clamp(v, 1, 3);
      noise(m, out, t, { filter: 'bandpass', f0: 450, f1: 3200 + 400 * k, q: 1.1, dur: .4 + .12 * k, peak: .18 + .05 * k, attack: .02 });
      tone(m, out, t, { f0: 120, f1: 45, dur: .2, peak: .4 });
      tone(m, out, t, { type: 'sawtooth', f0: 90, f1: 170, dur: .35 + .1 * k, peak: .07, filter: 'lowpass', cutoff: 900, attack: .02 });
      return;
    }
    case 'boost-pad':
      tone(m, out, t, { type: 'sawtooth', f0: 520, f1: 1700, dur: .32, peak: .14, filter: 'lowpass', cutoff: 3200 });
      tone(m, out, t, { f0: 1700, f1: 2600, at: .05, dur: .3, peak: .12 });
      noise(m, out, t, { filter: 'bandpass', f0: 800, f1: 4200, q: 1.2, dur: .5, peak: .3, attack: .02 });
      return;
    case 'rocket-start':
      noise(m, out, t, { filter: 'bandpass', f0: 300, f1: 4200, q: 1, dur: .95, peak: .32, attack: .03 });
      tone(m, out, t, { f0: 95, f1: 40, dur: .28, peak: .5 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.C6, f1: NOTE.C7, at: .05, dur: .5, peak: .1 });
      return;
    case 'stall':
      for (const at of [0, .13, .29]) noise(m, out, t, { at, filter: 'lowpass', f0: 420, q: 1.5, dur: .1, peak: .36 });
      tone(m, out, t, { type: 'sawtooth', f0: 110, f1: 42, dur: .55, peak: .16, filter: 'lowpass', cutoff: 600 });
      return;
    case 'slipstream':
      noise(m, out, t, { filter: 'bandpass', f0: 1400, f1: 2900, q: 2, dur: .75, peak: .28, attack: .12 });
      tone(m, out, t, { f0: 660, f1: 990, dur: .35, peak: .07 });
      return;
    case 'trick':
      tone(m, out, t, { type: 'square', f0: 660, f1: 990, dur: .1, peak: .1, filter: 'lowpass', cutoff: 3000 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.E6, at: .07, dur: .22, peak: .17 });
      tone(m, out, t, { f0: NOTE.E7, at: .1, dur: .18, peak: .045 });
      return;
    case 'wall':
      tone(m, out, t, { f0: 125, f1: 48, dur: .17, peak: .5 });
      noise(m, out, t, { filter: 'lowpass', f0: 1300, f1: 400, dur: .1, peak: .3 });
      return;
    case 'bump':
      tone(m, out, t, { f0: 190, f1: 85, dur: .11, peak: .32 });
      tone(m, out, t, { type: 'triangle', f0: 340, dur: .06, peak: .1 });
      noise(m, out, t, { filter: 'lowpass', f0: 2200, dur: .05, peak: .12 });
      return;
    case 'ring':        // sparkly chime: a fast rising bell arpeggio over a whoosh and a high shimmer
      arpeggio(m, out, t, [NOTE.E6, NOTE.G6, NOTE.B6, NOTE.E7], .045, { dur: .5, peak: .09 });
      arpeggio(m, out, t, [NOTE.E6 * 2.76, NOTE.G6 * 2.76, NOTE.B6 * 2.76], .045, { dur: .16, peak: .025 });
      noise(m, out, t, { filter: 'bandpass', f0: 1200, f1: 5000, q: 1.2, dur: .45, peak: .16, attack: .03 });
      noise(m, out, t, { filter: 'highpass', f0: 7000, at: .08, dur: .6, peak: .06, attack: .02 });
      return;
    case 'spring':      // springy boing: a thump, a fast upward bend, then a wobbling settle
      tone(m, out, t, { f0: 95, f1: 50, dur: .12, peak: .3 });
      tone(m, out, t, { type: 'triangle', f0: 120, f1: 460, dur: .13, peak: .22 });
      tone(m, out, t, { type: 'triangle', f0: 460, f1: 330, at: .1, dur: .55, peak: .22, vibrato: [15, 38] });
      return;
    case 'bumper':      // pinball ding: two bright bell tones and a woody knock
      tone(m, out, t, { f0: 210, f1: 105, dur: .08, peak: .25 });
      noise(m, out, t, { filter: 'lowpass', f0: 1800, dur: .04, peak: .16 });
      tone(m, out, t, { type: 'triangle', f0: 1244.5, dur: .38, peak: .17 });
      tone(m, out, t, { type: 'triangle', f0: 1661.2, at: .04, dur: .42, peak: .14 });
      tone(m, out, t, { f0: 1661.2 * 2.76, at: .04, dur: .14, peak: .03 });
      return;
    case 'loop':        // up and over: a swoosh that climbs to the top, a sparkle as the world flips, then the rush back down
      noise(m, out, t, { filter: 'bandpass', f0: 300, f1: 3600, q: 1.4, dur: 1, peak: .22, attack: .55 });
      noise(m, out, t, { filter: 'bandpass', f0: 3600, f1: 700, q: 1.2, at: .6, dur: .9, peak: .14, attack: .15 });
      tone(m, out, t, { type: 'sawtooth', f0: 110, f1: 330, dur: .9, peak: .06, attack: .3, filter: 'lowpass', cutoff: 1400 });
      arpeggio(m, out, t, [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7], .07, { type: 'triangle', at: .4, dur: .45, peak: .07 });
      return;
    case 'pickup':
      noise(m, out, t, { filter: 'highpass', f0: 3000, dur: .18, peak: .22 });
      for (let i = 0; i < 5; i++) tone(m, out, t, { f0: 2200 + noiseRandom() * 2600, at: i * .016, dur: .14, peak: .07 });
      return;
    case 'roulette-tick':
      tone(m, out, t, { type: 'square', f0: 1850, dur: .03, peak: .07, attack: .002, filter: 'lowpass', cutoff: 4200 });
      return;
    case 'item-ready':
      tone(m, out, t, { type: 'triangle', f0: NOTE.G6, dur: .14, peak: .18 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.C7, at: .07, dur: .24, peak: .18 });
      return;
    case 'item': return playItem(m, out, t, String(value));
    case 'hit': {
      const kind = String(value);
      if (kind === 'shock') { tone(m, out, t, { type: 'square', f0: 1300, f1: 180, dur: .4, peak: .08, filter: 'lowpass', cutoff: 3500 }); noise(m, out, t, { filter: 'highpass', f0: 2500, dur: .3, peak: .15 }); return; }
      if (kind === 'ink') { noise(m, out, t, { filter: 'lowpass', f0: 900, f1: 260, q: 3, dur: .35, peak: .3 }); tone(m, out, t, { f0: 320, f1: 110, dur: .3, peak: .14, vibrato: [22, 30] }); return; }
      noise(m, out, t, { filter: 'bandpass', f0: 1500, f1: 700, q: .8, dur: .26, peak: .36 });
      tone(m, out, t, { type: 'triangle', f0: 340, f1: 70, dur: .55, peak: .22, vibrato: [11, 25] });
      if (kind === 'tumble') tone(m, out, t, { f0: 95, f1: 38, dur: .32, peak: .45 });
      return;
    }
    case 'hit-dealt':
      tone(m, out, t, { type: 'triangle', f0: NOTE.E6, dur: .1, peak: .15 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.A6, at: .07, dur: .16, peak: .15 });
      return;
    case 'shield-pop':
      tone(m, out, t, { f0: 1150, f1: 230, dur: .13, peak: .28 });
      noise(m, out, t, { filter: 'highpass', f0: 4000, dur: .05, peak: .14 });
      return;
    case 'explode':
      noise(m, out, t, { filter: 'lowpass', f0: 2600, f1: 110, q: .9, dur: 1.35, peak: .5, attack: .004 });
      noise(m, out, t, { filter: 'bandpass', f0: 700, dur: .12, peak: .28 });
      tone(m, out, t, { f0: 72, f1: 28, dur: .95, peak: .45 });
      return;
    case 'thunder':
      noise(m, out, t, { filter: 'highpass', f0: 2600, dur: .07, peak: .4, attack: .002 });
      noise(m, out, t, { filter: 'bandpass', f0: 3200, f1: 700, q: 1.2, dur: .35, peak: .22 });
      noise(m, out, t, { filter: 'lowpass', f0: 170, f1: 90, q: 1, at: .04, dur: 2.3, peak: .42, attack: .06, hold: .3 });
      tone(m, out, t, { f0: 55, f1: 32, at: .04, dur: 1.6, peak: .24, attack: .05 });
      return;
    case 'comet':
      tone(m, out, t, { type: 'sawtooth', f0: 240, f1: 1500, dur: 1.4, peak: .12, attack: .5, filter: 'bandpass', cutoff: 1200, q: 1.2 });
      noise(m, out, t, { filter: 'bandpass', f0: 600, f1: 3600, q: 1.4, dur: 1.4, peak: .4, attack: .6 });
      return;
    case 'lap':
      tone(m, out, t, { type: 'triangle', f0: NOTE.C6, dur: .2, peak: .18 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.G6, at: .12, dur: .4, peak: .18 });
      tone(m, out, t, { f0: NOTE.G6 * 2, at: .12, dur: .25, peak: .035 });
      return;
    case 'final-lap':
      arpeggio(m, out, t, [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], .075, { type: 'triangle', dur: .2, peak: .14 });
      arpeggio(m, out, t, [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], .075, { type: 'square', dur: .16, peak: .035, filter: 'lowpass', cutoff: 2500 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.E6, at: .3, dur: .75, peak: .15, hold: .2 });
      tone(m, out, t, { type: 'triangle', f0: NOTE.C6, at: .3, dur: .75, peak: .1, hold: .2 });
      noise(m, out, t, { filter: 'highpass', f0: 6500, at: .3, dur: .8, peak: .06, attack: .01 });
      return;
    case 'finish':
      if (v <= 3) {
        arpeggio(m, out, t, [NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6], .09, { type: 'triangle', dur: .22, peak: .15 });
        for (const f of [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7]) tone(m, out, t, { type: 'triangle', f0: f, at: .38, dur: 1.6, peak: .08, attack: .02, hold: .5 });
        tone(m, out, t, { type: 'square', f0: NOTE.C5, at: .38, dur: 1.4, peak: .03, filter: 'lowpass', cutoff: 2000, hold: .4 });
        noise(m, out, t, { filter: 'highpass', f0: 6000, at: .38, dur: 1.2, peak: .07, attack: .01 });
        return;
      }
      arpeggio(m, out, t, [NOTE.E5, NOTE.G5, NOTE.C6], .11, { type: 'triangle', dur: .5, peak: .12 });
      return;
    case 'respawn':
      tone(m, out, t, { f0: 420, f1: 900, dur: .9, peak: .1, attack: .08, vibrato: [9, 30] });
      tone(m, out, t, { type: 'triangle', f0: 840, f1: 1800, at: .2, dur: .6, peak: .04 });
      return;
    case 'fall':
      tone(m, out, t, { f0: 1400, f1: 220, dur: .9, peak: .12, attack: .02 });
      return;
    case 'honk': {
      const f = HONK[clamp(Math.round(v), 0, HONK.length - 1)];
      for (const [mult, peak] of [[1, .08], [1.26, .07]] as const) tone(m, out, t, { type: 'square', f0: f * mult, f1: f * mult * .97, dur: .3, peak, attack: .012, hold: .16, filter: 'lowpass', cutoff: 2300, q: 2 });
      return;
    }
    case 'overtake':
      tone(m, out, t, { f0: 990, f1: 1480, dur: .09, peak: .05 });
      return;
  }
}

function playItem(m: Mixer, out: AudioNode, t: number, item: string): void {
  switch (item) {
    case 'nitro': case 'triple-nitro':
      noise(m, out, t, { filter: 'bandpass', f0: 380, f1: 3200, q: 1, dur: .65, peak: .5, attack: .02 });
      tone(m, out, t, { type: 'sawtooth', f0: 75, f1: 150, dur: .6, peak: .18, filter: 'lowpass', cutoff: 700 });
      return;
    case 'peel':
      tone(m, out, t, { f0: 540, f1: 170, dur: .15, peak: .22 });
      noise(m, out, t, { filter: 'lowpass', f0: 800, dur: .06, peak: .08 });
      return;
    case 'bouncer': case 'seeker':
      tone(m, out, t, { f0: 230, f1: 70, dur: .24, peak: .42 });
      noise(m, out, t, { filter: 'bandpass', f0: 1300, f1: 300, dur: .22, peak: .18 });
      if (item === 'seeker') { tone(m, out, t, { type: 'square', f0: 1400, at: .12, dur: .07, peak: .04, filter: 'lowpass', cutoff: 3000 }); tone(m, out, t, { type: 'square', f0: 1100, at: .22, dur: .07, peak: .04, filter: 'lowpass', cutoff: 3000 }); }
      return;
    case 'shield':
      tone(m, out, t, { f0: 300, f1: 900, dur: .45, peak: .18, attack: .03, vibrato: [18, 40] });
      tone(m, out, t, { f0: 600, f1: 1800, dur: .3, peak: .05 });
      return;
    case 'super':
      arpeggio(m, out, t, [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7, NOTE.E7], .045, { type: 'triangle', dur: .18, peak: .14 });
      noise(m, out, t, { filter: 'highpass', f0: 5000, dur: .5, peak: .07, attack: .05 });
      return;
    case 'ink':
      noise(m, out, t, { filter: 'lowpass', f0: 900, f1: 300, q: 3, dur: .3, peak: .36 });
      tone(m, out, t, { f0: 300, f1: 120, dur: .26, peak: .16 });
      return;
    case 'bomb':
      tone(m, out, t, { type: 'triangle', f0: 300, f1: 760, dur: .26, peak: .2 });
      noise(m, out, t, { filter: 'bandpass', f0: 2000, dur: .15, peak: .1 });
      return;
    default:
      tone(m, out, t, { type: 'triangle', f0: 600, f1: 900, dur: .15, peak: .1 });
      return;
  }
}

/* ---------------- engine ---------------- */
export type EngineState = {
  speed: number;        // 0..~1.4 of the class top speed
  boost: boolean; air: boolean; drift: -1 | 0 | 1; tier: number; surface: 'road' | 'offroad' | 'water' | 'ice' | 'other';
  hurt: boolean;        // spinning, tumbling, stalled or shocked
  muffled: boolean;     // respawning
  gain: number; pan: number;
};
const shaperCurve = (() => { let curve: Float32Array<ArrayBuffer> | null = null; return () => {
  if (curve) return curve;
  curve = new Float32Array(1024); const k = 2.2, norm = Math.tanh(k);
  for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / norm; }
  return curve;
}; })();

/** One kart engine: saw + square sub through a speed-tracking low-pass, amplitude "putter" at the firing
 * rate (rough at idle, a growl at speed), intake hiss that roars on boost, tyre screech while drifting
 * (noise band + wobbling tone, pitch rising with the mini-turbo tier) and an off-road rumble. ~19 native
 * nodes, updated ≤ 60/s. */
export class EngineVoice {
  private readonly out: GainNode;
  private readonly pan: StereoPannerNode | null;
  private readonly main: OscillatorNode; private readonly sub: OscillatorNode; private readonly putter: OscillatorNode;
  private readonly putterDepth: GainNode; private readonly body: GainNode; private readonly tone: BiquadFilterNode;
  private readonly intake: BiquadFilterNode; private readonly intakeGain: GainNode;
  private readonly screech: BiquadFilterNode; private readonly screechGain: GainNode;
  private readonly squeal: OscillatorNode; private readonly squealGain: GainNode; private readonly wobble: OscillatorNode;
  private readonly rumbleGain: GainNode;
  private readonly noiseSrc: AudioBufferSourceNode;
  private stopped = false;
  private lastSet = -1;
  constructor(private readonly m: Mixer) {
    const ctx = m.ctx, now = ctx.currentTime;
    this.out = ctx.createGain(); this.out.gain.setValueAtTime(0, now);
    this.pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (this.pan) this.out.connect(this.pan).connect(m.engines); else this.out.connect(m.engines);
    this.main = ctx.createOscillator(); this.main.type = 'sawtooth'; this.main.frequency.value = 45;
    this.sub = ctx.createOscillator(); this.sub.type = 'square'; this.sub.frequency.value = 22.5;
    const subGain = ctx.createGain(); subGain.gain.value = .42;
    this.body = ctx.createGain(); this.body.gain.value = .75;
    this.putter = ctx.createOscillator(); this.putter.frequency.value = 22; this.putterDepth = ctx.createGain(); this.putterDepth.gain.value = .25;
    this.putter.connect(this.putterDepth).connect(this.body.gain);
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 400; this.tone.Q.value = 1.2;
    const shaper = ctx.createWaveShaper(); shaper.curve = shaperCurve();
    const level = ctx.createGain(); level.gain.value = .5;
    this.main.connect(this.body); this.sub.connect(subGain).connect(this.body);
    this.body.connect(this.tone).connect(shaper).connect(level).connect(this.out);
    this.noiseSrc = ctx.createBufferSource(); this.noiseSrc.buffer = m.noise; this.noiseSrc.loop = true;
    this.intake = ctx.createBiquadFilter(); this.intake.type = 'bandpass'; this.intake.Q.value = .9; this.intake.frequency.value = 700;   // band-limited noise is quiet (~0.1–0.2 RMS), hence gains near 1
    this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
    this.screech = ctx.createBiquadFilter(); this.screech.type = 'bandpass'; this.screech.Q.value = 3.5; this.screech.frequency.value = 2200;
    this.screechGain = ctx.createGain(); this.screechGain.gain.value = 0;
    const rumble = ctx.createBiquadFilter(); rumble.type = 'lowpass'; rumble.frequency.value = 170; rumble.Q.value = 1.4;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.noiseSrc.connect(this.intake).connect(this.intakeGain).connect(this.out);
    this.noiseSrc.connect(this.screech).connect(this.screechGain).connect(this.out);
    this.noiseSrc.connect(rumble).connect(this.rumbleGain).connect(this.out);
    // The tonal part of a tyre squeal: a triangle whose pitch wobbles like rubber skipping on asphalt.
    this.squeal = ctx.createOscillator(); this.squeal.type = 'triangle'; this.squeal.frequency.value = 1150;
    this.wobble = ctx.createOscillator(); this.wobble.frequency.value = 7.5; const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 45;
    this.wobble.connect(wobbleDepth).connect(this.squeal.frequency);
    this.squealGain = ctx.createGain(); this.squealGain.gain.value = 0;
    this.squeal.connect(this.squealGain).connect(this.out);
    for (const s of [this.main, this.sub, this.putter, this.squeal, this.wobble]) s.start(now);
    this.noiseSrc.start(now, noiseRandom());
  }
  /** Glide toward a new state. Updates closer than 30 ms apart are skipped (the glides are ~60 ms anyway). */
  set(s: EngineState) {
    const t = this.m.ctx.currentTime;
    if (this.stopped || t - this.lastSet < .03) return;
    this.lastSet = t;
    const v = clamp(s.speed, 0, 1.5), smooth = (p: AudioParam, value: number, tau = .06) => p.setTargetAtTime(value, t, tau);
    let f = 50 + 140 * v ** .85;
    if (s.boost) f *= 1.1;
    if (s.air) f *= 1.07;
    if (s.hurt) f *= .82;
    smooth(this.main.frequency, f); smooth(this.sub.frequency, f / 2); smooth(this.putter.frequency, f / 2);
    smooth(this.putterDepth.gain, .26 - .13 * Math.min(1, v));
    smooth(this.tone.frequency, 330 + 2500 * v ** 1.2 + (s.boost ? 1700 : 0) + (s.air ? 400 : 0));
    smooth(this.tone.Q, s.boost ? 3 : 1.2);
    smooth(this.intake.frequency, 600 + 1900 * v);
    smooth(this.intakeGain.gain, .1 + .45 * v + (s.boost ? .7 : 0));
    const drifting = s.drift !== 0 && !s.air && v > .2;
    smooth(this.screechGain.gain, drifting ? .8 + .6 * v : 0, drifting ? .04 : .07);
    smooth(this.screech.frequency, 2000 + 260 * clamp(s.tier, 0, 3) + 120 * Math.sin(t * 31));
    smooth(this.squealGain.gain, drifting ? .12 + .1 * v : 0, drifting ? .05 : .07);
    smooth(this.squeal.frequency, 1100 + 130 * clamp(s.tier, 0, 3) + 60 * v);
    smooth(this.rumbleGain.gain, s.air ? 0 : s.surface === 'offroad' ? 5.5 * Math.sqrt(v) : s.surface === 'water' ? 3.5 * Math.sqrt(v) : 0, .08);
    smooth(this.out.gain, s.gain * (s.muffled ? .12 : 1) * (.55 + .45 * Math.min(1, v)) * (s.boost ? 1.2 : 1), .08);   // louder with speed: idle ≈ −5 dB
    if (this.pan) smooth(this.pan.pan, clamp(s.pan, -1, 1), .1);
  }
  /** Fade out and release every node. Idempotent. */
  stop(fade = .25) {
    if (this.stopped) return; this.stopped = true;
    const t = this.m.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(0, t, fade / 4);
    for (const s of [this.main, this.sub, this.putter, this.squeal, this.wobble, this.noiseSrc]) { try { s.stop(t + fade + .05); } catch { /* already stopped */ } }
    this.noiseSrc.onended = () => { this.out.disconnect(); this.pan?.disconnect(); };
  }
}
