/* Procedural WebAudio. No asset files, so nothing new for deploy.sh to precache
 * and nothing extra to download on a cold offline launch — which is exactly the
 * launch that most needs to work.
 *
 * ── the shape ─────────────────────────────────────────────────────────────
 * VOICES is still a map keyed by engine event name, and adding a sound is still
 * "add a key". What changed is what sits behind a key: an entry is now a
 * descriptor, not a bare function, because the mixer needs to know things about
 * a sound *before* it builds it — which bus it belongs on, how many may overlap,
 * whether it may steal from something already playing, and whether it ducks.
 *
 *   name: { bus, prio, poly, dur, duck, build(t0, out, o) }
 *
 * build() wires whatever it likes into `out`, a per-voice gain the mixer owns.
 *
 * ── the mix ───────────────────────────────────────────────────────────────
 *                sfx ─┐
 *                     ├─ duck ─┐
 *              music ─┘        ├─ mix ─ master ─ comp ─ softclip ─ out
 *              alert ──────────┘
 *
 * `music` is the ambient bed AND the generative score (see music.js) — one bus
 * for both, because from the mixer's point of view they are the same decision:
 * the thing that is always sounding, and therefore the thing that must get out
 * of the way first.
 *
 * ALERT IS NOT ON THE DUCK PATH, ON PURPOSE. hunt, wobble and airlow tell the
 * player about something they frequently cannot see — the field is 160 rows
 * deep and the view scrolls, so a monster entering hunt mode three screens down
 * is audible before it is visible, and the sound *is* the tell. Those three
 * therefore bypass ducking entirely and duck everything else on the way past.
 * Anything that can bury them is a bug, not a mix preference.
 *
 * ── cost ──────────────────────────────────────────────────────────────────
 * Twelve monsters and a cave-in can fire in the same step. Voices are pooled
 * and capped (MAX_VOICES), stolen per source id where the engine gives us one,
 * and the noise buffer is generated once at unlock and shared — the old code
 * allocated and filled a fresh AudioBuffer on every single dig, which at four
 * digs a second is a garbage-collector pacing problem dressed as a sound.
 */

import * as music from './music';
import { mtof } from './music';

/* ── types ────────────────────────────────────────────────────────────────

/** Which bus a voice lands on. `alert` bypasses ducking — see the header. */
type Bus = 'sfx' | 'alert';

/** The event a voice is built from. `play` accepts a bare value or the whole
 *  event; both arrive here as this shape. */
export type SoundEvent = {
  value?: number | string;
  /** The entity that made the sound, so a repeat steals its own voice. */
  id?: number | string;
  /** Seconds to postpone. The duck is scheduled at the sound's own start. */
  delay?: number;
  x?: number; y?: number;
};

/** One row of VOICES: what the mixer needs to know before it builds a sound. */
type VoiceSpec = {
  bus: Bus;
  prio: number;
  /** How many of this sound may overlap before the oldest is stolen. */
  poly: number;
  /** How long it occupies a slot. Not how long it is audible. */
  dur: number;
  duck?: { amount: number; hold: number; release: number };
  build(t0: number, out: GainNode, o: SoundEvent): AudioScheduledSourceNode[] | void;
};

/** A sound currently occupying a slot in the pool. */
type LiveVoice = {
  key: string;
  id: number | string | undefined;
  prio: number;
  t0: number;
  end: number;
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
};

/** Options the offline test rig passes to build(). */
type BuildOpts = { limiter?: boolean };

/* Set once by build(), and never cleared: a page has one context and it cannot
 * be detached. `ctx` stays nullable because `ready()` is a real question the
 * callers ask; the buses do not, because they exist exactly when it does. */
let ctx: BaseAudioContext | null = null;
let master!: GainNode;      // the mute control, and the only place level is set
let sfxDuck!: GainNode;
let musicDuck!: GainNode;
let sfxBus!: GainNode;
let musicBus!: GainNode;
let alertBus!: GainNode;
let noiseBuf!: AudioBuffer;
let muted = false;

const LEVEL = 0.24;
const MAX_VOICES = 24;
const NOISE_SECONDS = 2;

/* ── setup ────────────────────────────────────────────────────────────── */

/* MUST stay callable synchronously inside a real user gesture. An AudioContext
 * starts suspended and iOS only honours resume() from inside the gesture that
 * triggered it — not from a promise continuation, not from a later frame. So
 * everything here is synchronous, including filling the noise buffer (96k
 * Math.random calls, under 2ms, and far cheaper than paying for a buffer per
 * hit later).
 *
 * Note the phone's physical mute switch also silences WebAudio on some iOS
 * versions. A muted handset means silence, and that is not a bug to chase. */
export function unlock() {
  if (ctx) { resumeIfSuspended(ctx); return; }
  /* webkitAudioContext is still how older iOS Safari spells it, and iOS is
   * exactly the platform where a page is most likely to arrive suspended. */
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AC = window.AudioContext || w.webkitAudioContext;
  if (!AC) return;
  const made = new AC();
  build(made);
  resumeIfSuspended(made);
}

/* Only a live AudioContext can be resumed; an OfflineAudioContext, which is
 * what the test rig builds against, has no such state to be in. */
function resumeIfSuspended(c: BaseAudioContext) {
  if ('resume' in c && c.state === 'suspended') void (c as AudioContext).resume();
}

/* Shared by unlock() and by the offline renderer in tests/audio.mjs, so the
 * test measures the graph that actually ships rather than a copy of it. */
function build(audioCtx: BaseAudioContext, opts?: BuildOpts) {
  const o = opts || {};
  ctx = audioCtx;

  master = ctx.createGain();
  master.gain.value = muted ? 0 : LEVEL;

  let tail: AudioNode = master;
  if (o.limiter !== false) {
    /* A soft clipper and NOTHING ELSE. This was a DynamicsCompressor feeding a
     * shaper, and the offline rig caught the compressor adding 1.6 dB of RMS to
     * the worst-case burst: Chrome's DynamicsCompressorNode applies an internal
     * makeup gain, so the "safety net" was making the loudest moment in the game
     * louder still. A memoryless curve cannot do that — it is exactly unity
     * below the knee and monotonic above it, with no state, no pumping and no
     * gain to reason about. The mix is quiet enough (master 0.24) that this is
     * only ever reached by a genuine pile-up. */
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = '2x';
    master.connect(shaper);
    tail = shaper;
  }
  tail.connect(ctx.destination);

  const mix = ctx.createGain();
  mix.connect(master);

  sfxDuck = ctx.createGain(); sfxDuck.gain.value = 1;
  musicDuck = ctx.createGain(); musicDuck.gain.value = 1;
  sfxBus = ctx.createGain(); sfxBus.gain.value = 1;
  musicBus = ctx.createGain(); musicBus.gain.value = 1;
  alertBus = ctx.createGain(); alertBus.gain.value = 1;

  sfxBus.connect(sfxDuck); sfxDuck.connect(mix);
  musicBus.connect(musicDuck); musicDuck.connect(mix);
  alertBus.connect(mix);

  noiseBuf = makeNoise(ctx, NOISE_SECONDS);
  musicFloor = 1;
  musicFloorUntil = 0;
  voices.length = 0;
  music.attach(ctx, musicBus, noiseBuf);
}

function makeNoise(ac: BaseAudioContext, seconds: number) {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  // Slightly pink-ish: a one-pole smoother over white. Pure white noise reads
  // as hiss, and every earth sound in this game wants weight under it.
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = 0.86 * last + 0.14 * w;
    d[i] = w * 0.7 + last * 2.2;
  }
  return buf;
}

/* Unity BELOW the knee, soft above it. This matters more than it looks: the
 * obvious `tanh(x*k)/tanh(k)` curve has a small-signal slope of k/tanh(k) — at
 * k=1.35 that is 1.54x, so it quietly added 3.8 dB to everything and the
 * "shipped" burst measured LOUDER than the raw one it was supposed to be
 * protecting. A safety net that raises the level is not a safety net. */
function softClipCurve() {
  const n = 2048, knee = 0.7;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

export function setMuted(v: boolean) {
  muted = !!v;
  if (master) master.gain.value = muted ? 0 : LEVEL;
  // Silencing the bed is not the same as turning its oscillators off. A muted
  // game should not still be running a drone into a gain of zero for an hour.
  if (muted) music.stop(0.15);
  else if (ctx) music.restore();
}

export function isMuted() { return muted; }
export function ready() { return !!ctx; }

/* ── the ambient bed ──────────────────────────────────────────────────── */

/* opts: { theme, depth (0..1), intensity, fade }. See music.js. Cheap enough to
 * call every frame; it only schedules ramps. */
export function setAmbient(opts: music.Ambient) {
  if (!ctx || muted) return;
  music.set(opts);
}
export function stopAmbient(fade?: number) { music.stop(fade); }

/* ── ducking ──────────────────────────────────────────────────────────── */

/* Pull the sfx and music buses down so a big event lands. Music ducks harder
 * and recovers slower than sfx; the alert bus is not on this path at all.
 *
 * `t` is the voice's own start time, NOT now(). A sound scheduled with a delay
 * has to duck when it arrives — ducking at now() would drop the bus early and,
 * worse, the dip would have released again by the time the sound played.
 *
 * ALERTS DUCK THE MUSIC BUS TWICE AS DEEP AND FOUR TIMES AS LONG AS ANYTHING
 * ELSE DOES, and neither number is a taste decision. music.js now puts chords
 * and a melodic line on that bus, and both live partly in 250–1500 Hz — the
 * same band hunt, wobble and airlow have to cut through.
 *
 * The LENGTH is the part that is easy to get wrong, and the rig caught it. An
 * alert's own duck used to release about when the alert stopped sounding, which
 * is correct for sfx and useless here: the margin is measured over the 2.4 s a
 * player needs to locate the thing, and for most of that the music had already
 * swelled back. Holding it down for the whole of that window took the cost of
 * having music at all from 0.78 dB of the alert margin to under a tenth of a
 * dB. Musically it is free — this is a pad and a slow line, and a two-second
 * dip with a long recovery is not audible as pumping. It is also right: when
 * something you cannot see is hunting you, the score should get out of the way
 * and stay out of it. */
function duck(amount: number, hold: number, release: number, t: number, isAlert: boolean) {
  dip(sfxDuck.gain, amount, hold, release, t);
  if (isAlert) { musicDip(amount * 0.35, hold + 1.2, release * 3, t); return; }
  /* For everything else, how long the music stays down scales with how far it
   * was pushed — which is to say, with how big the event was. A pop dips it
   * half a dB's worth for under a second and reads as the kill getting a bit of
   * space; a cave-in holds it down for three, which is roughly how long a
   * cave-in takes to stop making noise.
   *
   * The old fixed release recovered in well under a second, so the music had
   * swelled back up while the cave-in was still collapsing. That was audible as
   * nothing in particular and measurable as most of a dB off the alert margin,
   * because the rig's 2.4 s window caught the music but not the alert. */
  const size = 1 - amount;
  musicDip(amount * 0.7, hold + size * 1.2, release * (1.6 + size * 3), t);
}

/* ON THE MUSIC BUS, THE DEEPEST DUCK WINS. Everywhere else the last one does,
 * and that is a bug the offline rig caught by measuring something it had no
 * reason to measure.
 *
 * dip() cancels whatever automation was pending and ramps to its own target, so
 * a burst of eighteen sounds leaves the bus wherever the LAST one it processed
 * asked for. In the worst-case burst that is `fire` at 0.8 — a shallow duck,
 * scheduled after the cave-in's deep one, quietly lifting the music back up
 * over the biggest event in the game. Inaudible; worth most of a dB of the
 * alert margin.
 *
 * `sfx` is deliberately left alone. The same argument applies to it in
 * principle, but its numbers are the ones the mixer's whole contract is written
 * against and changing them is a separate change with its own measurements.
 *
 * Only two pieces of state, and both reset with the graph: how far down the bus
 * is currently committed to going, and when that commitment expires. */
let musicFloor = 1;
let musicFloorUntil = 0;

function musicDip(amount: number, hold: number, release: number, t: number) {
  const end = t + 0.005 + hold + release;
  if (t < musicFloorUntil && amount > musicFloor) {
    // Shallower than what is already holding. Never lift it — either extend the
    // existing depth, or if this one is over first, ignore it entirely.
    if (end <= musicFloorUntil) return;
    amount = musicFloor;
  }
  musicFloor = amount;
  musicFloorUntil = end;
  dip(musicDuck.gain, amount, hold, release, t);
}

/* 5 ms of attack. Long enough not to step-click a decaying tail, short enough
 * to be most of the way down before the transients of a simultaneous burst have
 * finished — at 15 ms the duck arrived after the peak it existed to control. */
function dip(param: AudioParam, amount: number, hold: number, release: number, t: number) {
  // cancelAndHoldAtTime keeps whatever the automation had reached at t, which
  // is what makes overlapping ducks compose — a Sapper chain re-ducks every
  // 120 ms and each new dip must start from the bus's actual level, not from
  // param.value, which is only the last value explicitly set.
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
  param.linearRampToValueAtTime(amount, t + 0.005);
  param.setValueAtTime(amount, t + 0.005 + hold);
  param.linearRampToValueAtTime(1, t + 0.005 + hold + release);
}

/* ── voice pool ───────────────────────────────────────────────────────── */

const voices: LiveVoice[] = [];

/* Stealing order, tightest first:
 *   1. same event from the same entity id — a monster that re-telegraphs while
 *      its last telegraph is still ringing must replace it, not stack with it.
 *      This is the whole reason the engine's stable ids matter to audio.
 *   2. oldest voice of the same key, once that key is at its poly limit.
 *   3. globally: the oldest voice of strictly lower priority.
 * If nothing may be stolen the new sound is dropped, which is the correct
 * failure — a dropped dig is inaudible, an exhausted node graph is not. */
function alloc(spec: VoiceSpec, key: string, id: number | string | undefined, t0: number): LiveVoice | null {
  reap(t0);

  if (id !== undefined && id !== null) {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].key === key && voices[i].id === id) { kill(voices[i], t0); }
    }
  }

  let same = 0;
  for (const v of voices) if (v.key === key) same++;
  while (same >= spec.poly) {
    let oldest = null;
    for (const v of voices) if (v.key === key && (!oldest || v.t0 < oldest.t0)) oldest = v;
    if (!oldest) break;
    kill(oldest, t0);
    same--;
  }

  if (voices.length >= MAX_VOICES) {
    let victim = null;
    for (const v of voices) {
      if (v.prio >= spec.prio) continue;
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
    }
    if (!victim) return null;
    kill(victim, t0);
  }

  const out = ctx!.createGain();
  out.gain.value = 1;
  out.connect(spec.bus === 'alert' ? alertBus : sfxBus);
  const v = { key, id, prio: spec.prio, t0, end: t0 + spec.dur, out, srcs: [] };
  voices.push(v);
  return v;
}

/* A stolen voice is faded over 8ms rather than cut. Below about 5ms the fade is
 * itself an audible click, which is precisely the artefact stealing exists to
 * avoid. */
function kill(v: LiveVoice, t: number) {
  const g = v.out.gain;
  try {
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + 0.008);
  } catch { /* param already released */ }
  for (const s of v.srcs) { try { s.stop(t + 0.012); } catch { /* ended */ } }
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
}

function reap(t: number) {
  for (let i = voices.length - 1; i >= 0; i--) {
    if (voices[i].end <= t) voices.splice(i, 1);
  }
}

/* ── primitives ───────────────────────────────────────────────────────── */

function now() { return ctx!.currentTime; }
function rnd(a: number, b: number) { return a + Math.random() * (b - a); }
/* Pitch variation, in cents. Repeated digging with an identical fundamental is
 * the "machine gun of one sample" sound, and it is what makes procedural audio
 * read as cheap. */
function vary(f: number, cents: number) { return f * Math.pow(2, rnd(-cents, cents) / 1200); }
const EPS = 1e-4;

/* An event's `value` is whatever the simulation put there — a count, a depth, a
 * relic id. A voice that wants a number says so here rather than each of them
 * re-deciding what a string means. */
function num(v: number | string | undefined, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function osc(type: OscillatorType, f: number, t0: number, dur: number) {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f), t0);
  o.start(t0);
  o.stop(t0 + dur);
  return o;
}

function noise(t0: number, dur: number, rate?: number) {
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = rate || 1;
  s.start(t0, Math.random() * Math.max(0.001, noiseBuf.duration - dur - 0.05));
  s.stop(t0 + dur);
  return s;
}

function gain(v?: number | null) { const g = ctx!.createGain(); g.gain.value = v == null ? 1 : v; return g; }

function filt(type: BiquadFilterType, f: number, q?: number | null) {
  const b = ctx!.createBiquadFilter();
  b.type = type;
  b.frequency.value = Math.max(10, f);
  if (q != null) b.Q.value = q;
  return b;
}

/* A real ADSR, not two exponential ramps.
 *   a   linear attack — linear, so a 1ms attack is a click transient and not a
 *       fade. Percussive layers live or die on this.
 *   d   exponential decay to sustain
 *   sus fraction of peak held for `hold`
 *   r   exponential release
 * Returns the time the envelope reaches zero. */
function adsr(
  p: AudioParam, t0: number, peak: number,
  a: number, d: number, sus: number, hold: number, r: number,
) {
  const s = Math.max(EPS, peak * sus);
  p.setValueAtTime(EPS, t0);
  p.linearRampToValueAtTime(Math.max(EPS, peak), t0 + a);
  p.exponentialRampToValueAtTime(s, t0 + a + d);
  const th = t0 + a + d + hold;
  if (hold > 0) p.setValueAtTime(s, th);
  p.exponentialRampToValueAtTime(EPS, th + r);
  p.setValueAtTime(0, th + r + 0.002);
  return th + r + 0.002;
}

/** Percussive shorthand: click transient, decay, gone. */
function hit(p: AudioParam, t0: number, peak: number, dur: number) { return adsr(p, t0, peak, 0.0012, dur * 0.5, 0.02, 0, dur * 0.5); }

function sweep(p: AudioParam, t0: number, from: number, to: number, dur: number) {
  p.setValueAtTime(Math.max(1, from), t0);
  p.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
}

/** An LFO wired to modulate a param by +/- amount. Returns the oscillator. */
function lfo(
  param: AudioParam, t0: number, dur: number,
  rate: number, amount: number, type?: OscillatorType,
) {
  const o = osc(type || 'sine', rate, t0, dur);
  const g = gain(amount);
  o.connect(g); g.connect(param);
  return o;
}

/** Inharmonic partials — the difference between "metal" and "a beep". */
function metal(
  out: AudioNode, t0: number, base: number, ratios: number[],
  peak: number, dur: number, decayShape?: number,
) {
  for (let i = 0; i < ratios.length; i++) {
    const o = osc('sine', vary(base * ratios[i], 12), t0, dur);
    const g = gain(0);
    // Upper partials die first, which is what makes a struck object sound
    // struck rather than plucked.
    const d = dur * Math.pow(decayShape == null ? 0.62 : decayShape, i);
    hit(g.gain, t0, peak / (1 + i * 1.15), d);
    o.connect(g); g.connect(out);
  }
}

/* ── voices ───────────────────────────────────────────────────────────── */

/* Levels are pre-master: the bus and master (LEVEL = 0.24) sit downstream, so a
 * peak of 1.0 here is nowhere near 0 dBFS. Ordinary sfx sit around 0.3, and
 * only the events the player must not miss go past 0.6. */

const VOICES: Record<string, VoiceSpec> = {

  /* Material being cut. A resonant bandpass falling from a bright scrape to a
   * dull one over 80ms, over a short low body so it has weight. Pitch and the
   * noise playback rate are both varied, which is what keeps a held dig from
   * turning into a buzz. */
  dig: {
    bus: 'sfx', prio: 1, poly: 3, dur: 0.2,
    build(t0, out) {
      const rate = rnd(0.82, 1.3);
      const n = noise(t0, 0.13, rate);
      const bp = filt('bandpass', 2000, 1.4);
      sweep(bp.frequency, t0, 2600 * rate, 480, 0.1);
      const g = gain(0);
      adsr(g.gain, t0, 0.55, 0.004, 0.05, 0.25, 0.01, 0.06);
      n.connect(bp); bp.connect(g); g.connect(out);

      const b = osc('triangle', vary(150, 90), t0, 0.12);
      sweep(b.frequency, t0, vary(150, 90), 68, 0.09);
      const bg = gain(0);
      hit(bg.gain, t0, 0.26, 0.1);
      b.connect(bg); bg.connect(out);
      return [n, b];
    },
  },

  /* Launch. A saw dropping two and a half octaves through a lowpass with real
   * resonance (Q 14) sweeping with it, so the formant reads as the shaft
   * extending. Chuff of air in front of it. */
  harpoon: {
    bus: 'sfx', prio: 2, poly: 3, dur: 0.26,
    build(t0, out) {
      const f = vary(880, 60);
      const s = osc('sawtooth', f, t0, 0.18);
      sweep(s.frequency, t0, f, 165, 0.14);
      const lp = filt('lowpass', 3000, 14);
      sweep(lp.frequency, t0, 3400, 420, 0.15);
      const g = gain(0);
      adsr(g.gain, t0, 0.4, 0.002, 0.05, 0.35, 0.02, 0.07);
      s.connect(lp); lp.connect(g); g.connect(out);

      const n = noise(t0, 0.09, 1.4);
      const hp = filt('highpass', 1400);
      const ng = gain(0);
      hit(ng.gain, t0, 0.22, 0.08);
      n.connect(hp); hp.connect(ng); ng.connect(out);
      return [s, n];
    },
  },

  /* The pump. Two bandpass formants over a saw give it a vocal, bellows-like
   * "wah" instead of a beep, and both formants and the fundamental climb with
   * the pump index so the fourth stroke sounds like effort. The wheeze layer is
   * the air, the click at the front is the plunger. */
  pump: {
    bus: 'sfx', prio: 3, poly: 2, dur: 0.3,
    build(t0, out, o) {
      const v = Math.max(1, Math.min(6, num(o.value, 1)));
      const f = vary(112 + v * 20, 35);
      const s = osc('sawtooth', f, t0, 0.2);
      sweep(s.frequency, t0, f, f * 1.35, 0.16);

      const f1 = filt('bandpass', 420 + v * 90, 2.5);
      sweep(f1.frequency, t0, 380 + v * 80, 620 + v * 120, 0.16);
      const f2 = filt('bandpass', 1250 + v * 150, 3);
      sweep(f2.frequency, t0, 1150 + v * 140, 1650 + v * 170, 0.16);
      // Levels here look high next to the rest of the file because two narrow
      // bandpasses throw most of a saw away — the measured peak is about a
      // seventh of the number written. This is the sound the player makes on
      // purpose, several times per kill, so it has to hold its own.
      const g1 = gain(0), g2 = gain(0);
      adsr(g1.gain, t0, 1.25, 0.006, 0.07, 0.5, 0.04, 0.08);
      adsr(g2.gain, t0, 0.72, 0.01, 0.07, 0.45, 0.04, 0.08);
      s.connect(f1); f1.connect(g1); g1.connect(out);
      s.connect(f2); f2.connect(g2); g2.connect(out);

      // Body. Formants alone are a vowel with no chest behind it; this is the
      // bellows itself, and it is what stops the pump reading as a beep.
      const bl = filt('lowpass', 400, 1.2);
      const bg = gain(0);
      adsr(bg.gain, t0, 0.45, 0.004, 0.06, 0.5, 0.04, 0.08);
      s.connect(bl); bl.connect(bg); bg.connect(out);

      const n = noise(t0, 0.18, 1.0);
      const bp = filt('bandpass', 900, 1.2);
      sweep(bp.frequency, t0, 700, 2200, 0.16);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.17, 0.008, 0.06, 0.4, 0.03, 0.07);
      n.connect(bp); bp.connect(ng); ng.connect(out);
      return [s, n];
    },
  },

  /* The kill. Three layers, in the order the physics would happen:
   * pressure release (a sharp hiss escaping), the shell letting go (a pitched
   * body dropping fast), and the shower of what is left. One noise burst was
   * never going to carry the best moment in the game. */
  pop: {
    bus: 'sfx', prio: 4, poly: 4, dur: 0.6, duck: { amount: 0.72, hold: 0.05, release: 0.2 },
    build(t0, out) {
      const r = noise(t0, 0.08, 1.6);
      const rhp = filt('highpass', 900);
      sweep(rhp.frequency, t0, 700, 3400, 0.07);
      const rg = gain(0);
      adsr(rg.gain, t0, 0.3, 0.003, 0.03, 0.2, 0, 0.04);
      r.connect(rhp); rhp.connect(rg); rg.connect(out);

      const f = vary(430, 70);
      const s = osc('sawtooth', f, t0, 0.22);
      sweep(s.frequency, t0, f, 78, 0.18);
      const lp = filt('lowpass', 2600, 5);
      sweep(lp.frequency, t0, 3000, 500, 0.18);
      const sg = gain(0);
      adsr(sg.gain, t0, 0.46, 0.0015, 0.08, 0.25, 0.01, 0.11);
      s.connect(lp); lp.connect(sg); sg.connect(out);

      const d = noise(t0 + 0.04, 0.34, 1.1);
      const dbp = filt('bandpass', 2200, 0.9);
      sweep(dbp.frequency, t0 + 0.04, 2600, 620, 0.32);
      const dg = gain(0);
      adsr(dg.gain, t0 + 0.04, 0.17, 0.012, 0.12, 0.3, 0.02, 0.2);
      d.connect(dbp); dbp.connect(dg); dg.connect(out);
      return [r, s, d];
    },
  },

  /* "Something is about to happen." Deliberately small and dry — two rising
   * ticks through a narrow band. It must read as information without competing
   * with the three alert voices below. */
  telegraph: {
    bus: 'sfx', prio: 3, poly: 3, dur: 0.36,
    build(t0, out) {
      for (let i = 0; i < 2; i++) {
        const t = t0 + i * 0.11;
        const f = vary(420 + i * 210, 25);
        const o1 = osc('square', f, t, 0.08);
        // Centred ON the fundamental. A narrow band parked between a square's
        // harmonics passes almost nothing — that is how this voice originally
        // measured at 0.007 peak, i.e. inaudible, while looking correct.
        const bp = filt('bandpass', f, 1.6);
        const g = gain(0);
        adsr(g.gain, t, 0.3, 0.004, 0.02, 0.4, 0.02, 0.04);
        o1.connect(bp); bp.connect(g); g.connect(out);
      }
    },
  },

  /* Fygar's flame. Rumble underneath, a broadband roar whose lowpass opens and
   * then closes over the half second, and a crackle layer tremolo'd fast enough
   * to read as combustion rather than as a filter. */
  fire: {
    bus: 'sfx', prio: 4, poly: 2, dur: 0.7, duck: { amount: 0.8, hold: 0.15, release: 0.25 },
    build(t0, out) {
      const n = noise(t0, 0.55, 1.0);
      const lp = filt('lowpass', 500, 2.5);
      lp.frequency.setValueAtTime(320, t0);
      lp.frequency.exponentialRampToValueAtTime(2400, t0 + 0.14);
      lp.frequency.exponentialRampToValueAtTime(700, t0 + 0.5);
      const g = gain(0);
      adsr(g.gain, t0, 0.42, 0.02, 0.1, 0.55, 0.18, 0.2);
      n.connect(lp); lp.connect(g); g.connect(out);

      const r = osc('sawtooth', vary(64, 40), t0, 0.5);
      const rlp = filt('lowpass', 180, 1);
      const rg = gain(0);
      adsr(rg.gain, t0, 0.3, 0.03, 0.12, 0.6, 0.16, 0.18);
      r.connect(rlp); rlp.connect(rg); rg.connect(out);

      const c = noise(t0, 0.5, 1.8);
      const cbp = filt('bandpass', 3200, 9);
      const cg = gain(0);
      adsr(cg.gain, t0, 0.12, 0.02, 0.1, 0.7, 0.2, 0.16);
      lfo(cg.gain, t0, 0.5, 24, 0.1, 'square');
      c.connect(cbp); cbp.connect(cg); cg.connect(out);
      return [n, r, c];
    },
  },

  /* ALERT — a rock overhead is about to go. Its identity is the warble: 11 Hz
   * on both pitch and amplitude, which nothing else in the mix does. Alert bus,
   * ducks everything, and is never a steal victim. */
  wobble: {
    bus: 'alert', prio: 8, poly: 2, dur: 0.6, duck: { amount: 0.32, hold: 0.3, release: 0.22 },
    build(t0, out) {
      const dur = 0.45;
      const f = 190;
      const s = osc('sawtooth', f, t0, dur);
      lfo(s.frequency, t0, dur, 11, 46);
      const lp = filt('lowpass', 900, 3);
      const g = gain(0);
      adsr(g.gain, t0, 0.62, 0.012, 0.06, 0.85, 0.28, 0.09);
      lfo(g.gain, t0, dur, 11, 0.2);
      s.connect(lp); lp.connect(g); g.connect(out);

      // A second voice a twelfth up, band-limited around its own fundamental.
      // A phone speaker rolls off hard below 300 Hz, so the low warble alone
      // would vanish on the device this game is actually played on.
      const f2 = f * 3;
      const s2 = osc('square', f2, t0, dur);
      lfo(s2.frequency, t0, dur, 11, 138);
      const bp2 = filt('bandpass', f2, 1.4);
      const g2 = gain(0);
      adsr(g2.gain, t0, 0.42, 0.012, 0.06, 0.85, 0.28, 0.09);
      lfo(g2.gain, t0, dur, 11, 0.14);
      s2.connect(bp2); bp2.connect(g2); g2.connect(out);
    },
  },

  /* Something heavy on its way down. Pitch and cutoff fall together so it reads
   * as receding as well as descending. */
  fall: {
    bus: 'sfx', prio: 3, poly: 3, dur: 0.6,
    build(t0, out) {
      const f = vary(340, 60);
      const s = osc('sine', f, t0, 0.5);
      sweep(s.frequency, t0, f, 72, 0.46);
      const g = gain(0);
      adsr(g.gain, t0, 0.34, 0.008, 0.1, 0.6, 0.16, 0.2);
      s.connect(g); g.connect(out);

      const n = noise(t0, 0.48, 0.9);
      const lp = filt('lowpass', 1200, 1.5);
      sweep(lp.frequency, t0, 1800, 260, 0.45);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.14, 0.02, 0.1, 0.6, 0.14, 0.2);
      n.connect(lp); lp.connect(ng); ng.connect(out);
      return [s, n];
    },
  },

  /* Rock landing: low thud + mid crack + debris tail. The crack is what makes
   * it stone; without it the thud alone is a dropped cushion. */
  rock: {
    bus: 'sfx', prio: 5, poly: 3, dur: 0.7, duck: { amount: 0.65, hold: 0.06, release: 0.25 },
    build(t0, out) {
      const f = vary(104, 80);
      const th = osc('sine', f, t0, 0.32);
      sweep(th.frequency, t0, f, 38, 0.28);
      const tg = gain(0);
      adsr(tg.gain, t0, 0.72, 0.0012, 0.1, 0.2, 0.02, 0.16);
      th.connect(tg); tg.connect(out);

      const c = noise(t0, 0.09, 1.2);
      const cbp = filt('bandpass', 1700, 2.4);
      sweep(cbp.frequency, t0, 2100, 900, 0.08);
      const cg = gain(0);
      hit(cg.gain, t0, 0.4, 0.08);
      c.connect(cbp); cbp.connect(cg); cg.connect(out);

      const d = noise(t0 + 0.05, 0.45, 1.0);
      const dlp = filt('lowpass', 2600, 1);
      sweep(dlp.frequency, t0 + 0.05, 3000, 420, 0.42);
      const dg = gain(0);
      adsr(dg.gain, t0 + 0.05, 0.2, 0.01, 0.14, 0.25, 0.02, 0.26);
      d.connect(dlp); dlp.connect(dg); dg.connect(out);

      // Three pebbles at irregular offsets. Regular ones sound like a delay.
      for (let i = 0; i < 3; i++) {
        const t = t0 + 0.12 + rnd(0, 0.28);
        const p = osc('triangle', rnd(300, 900), t, 0.06);
        const pg = gain(0);
        hit(pg.gain, t, 0.09, 0.05);
        p.connect(pg); pg.connect(out);
      }
      return [th, c, d];
    },
  },

  /* Phasing through dirt. Airy and slow-attacked so it never reads as an
   * impact: two detuned sines beating, plus a breath. */
  ghost: {
    bus: 'sfx', prio: 2, poly: 3, dur: 0.6,
    build(t0, out) {
      const f = vary(560, 80);
      for (const d of [-9, 9]) {
        const s = osc('sine', f, t0, 0.42);
        s.detune.value = d;
        sweep(s.frequency, t0, f, f * 1.5, 0.4);
        const g = gain(0);
        adsr(g.gain, t0, 0.13, 0.09, 0.1, 0.6, 0.08, 0.16);
        s.connect(g); g.connect(out);
      }
      const n = noise(t0, 0.42, 0.8);
      const bp = filt('bandpass', 1600, 1.4);
      sweep(bp.frequency, t0, 900, 2600, 0.4);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.09, 0.1, 0.12, 0.5, 0.06, 0.14);
      n.connect(bp); bp.connect(ng); ng.connect(out);
      return [n];
    },
  },

  /* A shark coming up through the floor. The only frame in its life it can be
   * hit, so it has to carry — but NOT on the alert bus.
   *
   * The three alerts below are separated on three axes and the comment there
   * says plainly that the space is full; a fourth would be merging a warning.
   * A breach is also an OPPORTUNITY as much as a threat — the surface test
   * refuses to land it on the player, so it cannot hurt you on the frame it
   * arrives — and "move now" is the one thing it must not say.
   *
   * So it buys its space on a fourth axis instead: everything on the alert bus
   * is tonal, and this is broadband. Nothing else in the mix is a rising noise
   * swell, which makes it unambiguous without competing for the alert register.
   *
   * prio 6 puts it over `rock` (5) and under `hurt` (7): a breach must not be
   * stolen by falling debris, and must never mask taking damage. */
  surface: {
    bus: 'sfx', prio: 6, poly: 2, dur: 0.7,
    duck: { amount: 0.35, hold: 0.08, release: 0.22 },
    build(t0, out) {
      /* The swell — a bandpass climbing through noise. The attack is slow on
       * purpose: fast, it is an impact, and the animal has not hit anything. */
      const n = noise(t0, 0.42, 1.2);
      const bp = filt('bandpass', 700, 1.1);
      sweep(bp.frequency, t0, 380, 3400, 0.38);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.5, 0.11, 0.08, 0.85, 0.16, 0.16);
      n.connect(bp); bp.connect(ng); ng.connect(out);

      // The break, at the top of the swell: the moment the fin clears the
      // floor. Without it the swell on its own is just wind.
      const t1 = t0 + 0.30;
      const c = noise(t1, 0.10, 1.6);
      const chp = filt('highpass', 2600);
      const cg = gain(0);
      hit(cg.gain, t1, 0.42, 0.10);
      c.connect(chp); chp.connect(cg); cg.connect(out);

      // A sub under it that rises. Everything else in this file with a sub —
      // rock, hurt, fall — sweeps DOWN, so up is available and means "arriving".
      const s = osc('sine', 62, t0 + 0.16, 0.34);
      sweep(s.frequency, t0 + 0.16, 62, 148, 0.30);
      const sg = gain(0);
      adsr(sg.gain, t0 + 0.16, 0.42, 0.05, 0.08, 0.8, 0.14, 0.14);
      s.connect(sg); sg.connect(out);
      return [n, c, s];
    },
  },

  /* The vent's wheel, launched. Not the `fire` roar, which is dur 0.7 with the
   * second-hardest duck in the game (0.8) — right for a lizard clearing a
   * corridor, absurd for a thing that happens every five seconds at up to six
   * places on one level.
   *
   * Its identity is a 30 Hz amplitude tremolo. Rotation is the one fact this
   * sound has to carry, and nothing else in the mix is amplitude-modulated. The
   * nearest neighbour is `wobble`'s 11 Hz warble, which is on the ALERT bus and
   * must stay unmistakable as "a rock is about to drop" — 30 Hz on the sfx bus
   * is far enough away in both rate and routing that the two can never be
   * confused, which matters because they mean opposite things about where to
   * stand. */
  wheel: {
    bus: 'sfx', prio: 4, poly: 3, dur: 0.45,
    duck: { amount: 0.55, hold: 0.05, release: 0.2 },
    build(t0, out) {
      // The whoosh: bandpassed noise sweeping up and back down, so it reads as
      // something passing rather than something arriving.
      const n = noise(t0, 0.4, 1.1);
      const bp = filt('bandpass', 700, 1.3);
      sweep(bp.frequency, t0, 700, 1800, 0.18);
      sweep(bp.frequency, t0 + 0.18, 1800, 900, 0.2);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.5, 0.02, 0.08, 0.7, 0.12, 0.16);
      lfo(ng.gain, t0, 0.4, 30, 0.22);
      n.connect(bp); bp.connect(ng); ng.connect(out);

      // A low body under it so it has weight on a phone speaker, which rolls
      // off hard below 300 Hz and would otherwise leave only the hiss.
      const o = osc('sawtooth', vary(150, 60), t0, 0.32);
      const lp = filt('lowpass', 700, 2);
      const og = gain(0);
      adsr(og.gain, t0, 0.3, 0.02, 0.08, 0.6, 0.08, 0.14);
      lfo(og.gain, t0, 0.32, 30, 0.16);
      o.connect(lp); lp.connect(og); og.connect(out);
      return [n];
    },
  },

  /* ALERT — a monster has seen you and is coming, and it may be two screens
   * away. A rising minor third, twice, through a resonant band with a growl of
   * FM on it.
   *
   * The three alerts are separated on all three axes a listener can use without
   * looking, because the field scrolls and these are the primary channel rather
   * than a garnish on a visual cue:
   *   wobble  ~500 Hz   continuous 11 Hz warble, sustained
   *   hunt    ~850 Hz   two discrete rising pairs, each attack-decay, growling
   *   airlow ~1300 Hz   two flat hollow beeps with a heartbeat under them
   * Register, rhythm and envelope all differ. Change one at your peril; change
   * two and you have merged two warnings. */
  hunt: {
    bus: 'alert', prio: 9, poly: 2, dur: 0.7, duck: { amount: 0.3, hold: 0.38, release: 0.25 },
    build(t0, out) {
      for (let i = 0; i < 2; i++) {
        const t = t0 + i * 0.22;
        const base = 392 * (i ? 1.19 : 1);
        const s = osc('sawtooth', base, t, 0.2);
        sweep(s.frequency, t, base, base * 1.19, 0.18);
        // Growl: a sub-audio FM sideband, the thing that separates a predator
        // from a doorbell.
        lfo(s.frequency, t, 0.2, 34, 26);
        // Q low enough to pass the first few harmonics of the saw as the band
        // moves — a resonant peak, not a keyhole.
        const bp = filt('bandpass', 1000, 1.6);
        sweep(bp.frequency, t, 820, 1700, 0.18);
        const g = gain(0);
        adsr(g.gain, t, 1.15, 0.01, 0.05, 0.75, 0.09, 0.07);
        s.connect(bp); bp.connect(g); g.connect(out);

        const sub = osc('triangle', base / 2, t, 0.2);
        const sg = gain(0);
        adsr(sg.gain, t, 0.3, 0.012, 0.05, 0.7, 0.08, 0.07);
        sub.connect(sg); sg.connect(out);
      }
    },
  },

  /* Taking damage. Deliberately ugly: a square through a hard waveshaper, a
   * broadband slap and a sub thump under it. */
  hurt: {
    bus: 'sfx', prio: 7, poly: 2, dur: 0.5, duck: { amount: 0.5, hold: 0.1, release: 0.3 },
    build(t0, out) {
      const s = osc('square', 250, t0, 0.26);
      sweep(s.frequency, t0, 250, 82, 0.24);
      const ws = ctx!.createWaveShaper();
      ws.curve = hardCurve();
      const g = gain(0);
      adsr(g.gain, t0, 0.5, 0.0015, 0.09, 0.3, 0.02, 0.14);
      s.connect(ws); ws.connect(g); g.connect(out);

      const n = noise(t0, 0.16, 1.1);
      const bp = filt('bandpass', 1100, 1.1);
      sweep(bp.frequency, t0, 1600, 400, 0.14);
      const ng = gain(0);
      hit(ng.gain, t0, 0.34, 0.14);
      n.connect(bp); bp.connect(ng); ng.connect(out);

      const sub = osc('sine', 90, t0, 0.3);
      sweep(sub.frequency, t0, 90, 45, 0.26);
      const sg = gain(0);
      hit(sg.gain, t0, 0.4, 0.26);
      sub.connect(sg); sg.connect(out);
      return [s, n, sub];
    },
  },

  /* Something bouncing off the helmet. Bright, short, metallic. */
  helmet: {
    bus: 'sfx', prio: 4, poly: 3, dur: 0.35,
    build(t0, out) {
      metal(out, t0, vary(1500, 50), [1, 1.72, 2.44, 3.31], 0.34, 0.22);
      const n = noise(t0, 0.05, 1.7);
      const hp = filt('highpass', 3000);
      const g = gain(0);
      hit(g.gain, t0, 0.18, 0.04);
      n.connect(hp); hp.connect(g); g.connect(out);
      return [n];
    },
  },

  /* Dirt into the hopper. A metallic ting plus a small shaker, two notes so it
   * reads as a transaction completing. */
  bank: {
    bus: 'sfx', prio: 4, poly: 3, dur: 0.45,
    build(t0, out) {
      metal(out, t0, 940, [1, 2.02, 3.03], 0.26, 0.16, 0.7);
      metal(out, t0 + 0.085, 1410, [1, 2.01, 2.98], 0.26, 0.22, 0.7);
      const n = noise(t0, 0.14, 1.5);
      const bp = filt('bandpass', 5200, 2);
      const g = gain(0);
      adsr(g.gain, t0, 0.1, 0.004, 0.05, 0.3, 0.01, 0.07);
      n.connect(bp); bp.connect(g); g.connect(out);
      return [n];
    },
  },

  /* The roof coming in. The biggest thing in the game and it ducks hardest: a
   * long sub rumble, a broadband collapse whose cutoff falls for half a second,
   * and five irregular slabs landing on top of it. */
  cavein: {
    bus: 'sfx', prio: 9, poly: 1, dur: 1.4, duck: { amount: 0.34, hold: 0.5, release: 0.5 },
    build(t0, out) {
      const sub = osc('sine', 70, t0, 1.1);
      sweep(sub.frequency, t0, 78, 32, 1.0);
      const sg = gain(0);
      adsr(sg.gain, t0, 0.85, 0.02, 0.2, 0.6, 0.35, 0.45);
      sub.connect(sg); sg.connect(out);

      const n = noise(t0, 1.0, 0.85);
      const lp = filt('lowpass', 900, 1.2);
      sweep(lp.frequency, t0, 2400, 260, 0.9);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.5, 0.015, 0.25, 0.5, 0.3, 0.4);
      n.connect(lp); lp.connect(ng); ng.connect(out);

      for (let i = 0; i < 5; i++) {
        const t = t0 + 0.03 + rnd(0, 0.6);
        const th = osc('sine', rnd(70, 150), t, 0.2);
        sweep(th.frequency, t, rnd(110, 160), 40, 0.18);
        const tg = gain(0);
        hit(tg.gain, t, 0.4, 0.18);
        th.connect(tg); tg.connect(out);

        // Mid-band cracks matter more than the sub does: a phone speaker
        // reproduces almost nothing below 200 Hz, so a cave-in carried only by
        // its rumble is a cave-in that a player on a handset does not hear.
        const c = noise(t, 0.08, rnd(0.9, 1.5));
        const cbp = filt('bandpass', rnd(900, 2200), 1.5);
        const cg = gain(0);
        hit(cg.gain, t, 0.26, 0.07);
        c.connect(cbp); cbp.connect(cg); cg.connect(out);
      }
      return [sub, n];
    },
  },

  /* A Sapper going off. Sibling to cavein — if you retune one, look at the
   * other, because they share the sfx bus and the same duck.
   *
   * `value` is SAPPER_RADIUS in cells (3.5): it drops the sub and lengthens the
   * tail, so a bigger crater is a bigger bang rather than the same bang with a
   * different number attached.
   *
   * poly 3 AND a hard duck, together, because a Sapper can chain three deep.
   * The duck is what makes the chain work: a blast pulls the whole sfx bus down
   * for 300 ms, which includes the two blasts behind it, so the first detonation
   * is the event and the rest are its consequences. Three at full level would
   * simply be a clipped mess — the worst-case burst test carries the chain on
   * top of a cave-in for exactly this reason. */
  blast: {
    bus: 'sfx', prio: 9, poly: 3, dur: 1.2, duck: { amount: 0.4, hold: 0.3, release: 0.4 },
    build(t0, out, o) {
      const r = Math.max(1, Math.min(6, num(o.value, 3.5)));
      const size = r / 3.5;                       // 1 at the standard radius

      // Low end. Two layers, because one is never enough: a sub that sags for
      // most of a second, and a fast punch on top so the hit has an edge on a
      // phone speaker that cannot reproduce the sub at all.
      const sub = osc('sine', 58 / size, t0, 0.75);
      sweep(sub.frequency, t0, 62 / size, 26, 0.7);
      const sg = gain(0);
      adsr(sg.gain, t0, 0.95, 0.004, 0.22, 0.35, 0.1, 0.4);
      sub.connect(sg); sg.connect(out);

      const p = osc('triangle', 190, t0, 0.14);
      sweep(p.frequency, t0, 200, 52, 0.12);
      const pg = gain(0);
      adsr(pg.gain, t0, 0.6, 0.0012, 0.05, 0.15, 0.01, 0.08);
      p.connect(pg); pg.connect(out);

      // The detonation itself: broadband, cutoff collapsing from wide open.
      const n = noise(t0, 0.5, 1.25);
      const lp = filt('lowpass', 3000, 1.4);
      sweep(lp.frequency, t0, 5200, 220, 0.45 * size);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.62, 0.0015, 0.14, 0.3, 0.04, 0.3);
      n.connect(lp); lp.connect(ng); ng.connect(out);

      // Snap. 25 ms of top end is the difference between an explosion and a
      // large soft thump.
      const c = noise(t0, 0.03, 1.9);
      const hp = filt('highpass', 3200);
      const cg = gain(0);
      hit(cg.gain, t0, 0.4, 0.028);
      c.connect(hp); hp.connect(cg); cg.connect(out);

      // Debris: dirt coming back down for as long as the crater is wide.
      const tail = 0.5 + 0.35 * size;
      const d = noise(t0 + 0.06, tail, 1.0);
      const dlp = filt('lowpass', 2200, 1);
      sweep(dlp.frequency, t0 + 0.06, 2600, 320, tail * 0.9);
      const dg = gain(0);
      adsr(dg.gain, t0 + 0.06, 0.24, 0.012, 0.18, 0.3, 0.06, tail * 0.55);
      d.connect(dlp); dlp.connect(dg); dg.connect(out);

      // Clods landing, irregularly. Count scales with the radius.
      const clods = Math.round(3 + size * 2);
      for (let i = 0; i < clods; i++) {
        const t = t0 + 0.14 + rnd(0, tail * 0.8);
        const k = osc('triangle', rnd(120, 420), t, 0.07);
        const kg = gain(0);
        hit(kg.gain, t, 0.11, 0.06);
        k.connect(kg); kg.connect(out);
      }
      return [sub, n, d];
    },
  },

  /* Death. Long, falling, with vibrato that widens as it goes — the sound of
   * something winding down rather than being switched off. */
  die: {
    bus: 'sfx', prio: 9, poly: 1, dur: 1.3, duck: { amount: 0.35, hold: 0.5, release: 0.5 },
    build(t0, out) {
      const s = osc('sawtooth', 400, t0, 1.0);
      sweep(s.frequency, t0, 400, 58, 0.95);
      lfo(s.frequency, t0, 1.0, 6.5, 22);
      const lp = filt('lowpass', 2400, 6);
      sweep(lp.frequency, t0, 2600, 300, 0.95);
      const g = gain(0);
      adsr(g.gain, t0, 0.62, 0.006, 0.2, 0.55, 0.4, 0.35);
      s.connect(lp); lp.connect(g); g.connect(out);

      const sub = osc('sine', 150, t0, 1.0);
      sweep(sub.frequency, t0, 150, 40, 0.95);
      const sg = gain(0);
      adsr(sg.gain, t0, 0.35, 0.02, 0.25, 0.5, 0.35, 0.35);
      sub.connect(sg); sg.connect(out);
      return [s, sub];
    },
  },

  /* ── jingles. Real intervals, so they sit together as one family. ─────── */

  bonus: {
    bus: 'sfx', prio: 5, poly: 2, dur: 0.6,
    build(t0, out) { arp(out, t0, [76, 80, 83], 0.075, 0.26, 'square'); },
  },

  extra: {
    bus: 'sfx', prio: 6, poly: 1, dur: 0.9, duck: { amount: 0.7, hold: 0.3, release: 0.3 },
    build(t0, out) {
      arp(out, t0, [72, 76, 79, 84], 0.09, 0.28, 'square');
      // Shimmer: the top note doubled a hair sharp and held.
      const s = osc('triangle', mtof(84) * 1.004, t0 + 0.27, 0.5);
      const g = gain(0);
      adsr(g.gain, t0 + 0.27, 0.14, 0.03, 0.12, 0.5, 0.15, 0.25);
      s.connect(g); g.connect(out);
    },
  },

  level: {
    bus: 'sfx', prio: 6, poly: 1, dur: 0.8,
    build(t0, out) { arp(out, t0, [67, 71, 74], 0.11, 0.28, 'square'); },
  },

  levelclear: {
    bus: 'sfx', prio: 7, poly: 1, dur: 1.3, duck: { amount: 0.6, hold: 0.5, release: 0.4 },
    build(t0, out) {
      arp(out, t0, [72, 74, 76, 79, 84], 0.085, 0.26, 'square');
      metal(out, t0 + 0.34, mtof(84), [1, 2.01, 3.02, 4.1], 0.2, 0.55, 0.8);
    },
  },

  gameover: {
    bus: 'sfx', prio: 9, poly: 1, dur: 2.0, duck: { amount: 0.4, hold: 0.9, release: 0.6 },
    build(t0, out) {
      const notes = [62, 58, 55, 50];
      for (let i = 0; i < notes.length; i++) {
        const t = t0 + i * 0.32;
        const f = mtof(notes[i]);
        const s = osc('sawtooth', f, t, 0.6);
        const lp = filt('lowpass', 1400, 3);
        sweep(lp.frequency, t, 1500, 420, 0.55);
        const g = gain(0);
        adsr(g.gain, t, 0.5, 0.02, 0.15, 0.5, 0.12, 0.3);
        s.connect(lp); lp.connect(g); g.connect(out);
      }
      const sub = osc('sine', mtof(38), t0, 1.6);
      const sg = gain(0);
      adsr(sg.gain, t0, 0.45, 0.08, 0.4, 0.5, 0.5, 0.6);
      sub.connect(sg); sg.connect(out);
      return [sub];
    },
  },

  /* Chained kills. value is the combo count and walks the note up a pentatonic
   * ladder, so the reward is legible without looking at the HUD. */
  combo: {
    bus: 'sfx', prio: 6, poly: 3, dur: 0.5,
    build(t0, out, o) {
      const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const i = Math.max(0, Math.min(steps.length - 1, num(o.value, 1) - 1));
      const f = mtof(72 + steps[i]);
      const s = osc('square', f, t0, 0.14);
      const lp = filt('lowpass', f * 3.5, 3);
      const g = gain(0);
      adsr(g.gain, t0, 0.42, 0.004, 0.04, 0.4, 0.03, 0.07);
      s.connect(lp); lp.connect(g); g.connect(out);
      // A quiet octave echo, so a long chain builds a shimmer of its own.
      const e = osc('triangle', f * 2, t0 + 0.07, 0.2);
      const eg = gain(0);
      adsr(eg.gain, t0 + 0.07, 0.16, 0.006, 0.06, 0.3, 0.02, 0.1);
      e.connect(eg); eg.connect(out);
    },
  },

  /* ── new in this rebuild ─────────────────────────────────────────────── */

  /* A vein pays out. Crystal, not coin: bell partials (the 2.76/5.40 ratios are
   * the classic struck-bar set) with a rising shimmer over the top and a
   * sparkle of high noise. value is the grade and adds partials, so a rich vein
   * genuinely sounds richer. */
  ore: {
    bus: 'sfx', prio: 6, poly: 3, dur: 0.9,
    build(t0, out, o) {
      const grade = Math.max(1, Math.min(3, num(o.value, 1)));
      const base = mtof(84);
      metal(out, t0, base, [1, 2.76, 5.4].slice(0, 1 + grade), 0.3, 0.55, 0.75);
      const s = osc('triangle', base, t0 + 0.05, 0.35);
      sweep(s.frequency, t0 + 0.05, base, base * 1.5, 0.3);
      const g = gain(0);
      adsr(g.gain, t0 + 0.05, 0.16, 0.02, 0.1, 0.5, 0.08, 0.18);
      s.connect(g); g.connect(out);

      const n = noise(t0, 0.4, 1.9);
      const hp = filt('highpass', 5000);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.08, 0.01, 0.08, 0.35, 0.06, 0.24);
      n.connect(hp); hp.connect(ng); ng.connect(out);
      return [n];
    },
  },

  /* An air pocket refills. The relief sound: a filtered inhale opening from a
   * mutter to wide open, with a rising sine inside it. Nothing percussive. */
  air: {
    bus: 'sfx', prio: 6, poly: 2, dur: 0.9,
    build(t0, out) {
      const n = noise(t0, 0.6, 1.0);
      const lp = filt('lowpass', 400, 2);
      lp.frequency.setValueAtTime(240, t0);
      lp.frequency.exponentialRampToValueAtTime(3600, t0 + 0.34);
      lp.frequency.exponentialRampToValueAtTime(900, t0 + 0.58);
      const g = gain(0);
      adsr(g.gain, t0, 0.3, 0.06, 0.16, 0.6, 0.14, 0.24);
      n.connect(lp); lp.connect(g); g.connect(out);

      const s = osc('sine', 240, t0, 0.5);
      sweep(s.frequency, t0, 240, 700, 0.45);
      const sg = gain(0);
      adsr(sg.gain, t0, 0.22, 0.05, 0.14, 0.5, 0.12, 0.2);
      s.connect(sg); sg.connect(out);
      return [n, s];
    },
  },

  /* ALERT — air is running out and the gauge may be off-screen. Two hollow
   * beeps through a fixed formant pair, with a heartbeat under each. The
   * hollowness is the identity: it is the only voice in the game with a
   * resonant *pair* of narrow bands and no noise at all. */
  airlow: {
    bus: 'alert', prio: 9, poly: 1, dur: 0.8, duck: { amount: 0.3, hold: 0.42, release: 0.3 },
    build(t0, out) {
      const f = 262;
      for (let i = 0; i < 2; i++) {
        const t = t0 + i * 0.26;
        const s = osc('square', f, t, 0.13);
        // Formants on the 5th and 7th harmonics of the square. Sitting them on
        // real partials is what makes this hollow rather than merely quiet — a
        // narrow band parked between harmonics passes almost nothing. Skipping
        // the 3rd puts this a register above hunt.
        const f1 = filt('bandpass', f * 5, 3.5);
        const f2 = filt('bandpass', f * 7, 4);
        const g1 = gain(0), g2 = gain(0);
        adsr(g1.gain, t, 1.6, 0.006, 0.03, 0.8, 0.06, 0.05);
        adsr(g2.gain, t, 1.1, 0.006, 0.03, 0.8, 0.06, 0.05);
        s.connect(f1); f1.connect(g1); g1.connect(out);
        s.connect(f2); f2.connect(g2); g2.connect(out);

        const h = osc('sine', 62, t, 0.16);
        sweep(h.frequency, t, 68, 40, 0.14);
        const hg = gain(0);
        hit(hg.gain, t, 0.45, 0.14);
        h.connect(hg); hg.connect(out);
      }
    },
  },

  /* Out of air. The same formant pair as airlow so the player hears it as the
   * same system, but falling, three times, with the floor dropping out. */
  airout: {
    bus: 'alert', prio: 10, poly: 1, dur: 1.2, duck: { amount: 0.35, hold: 0.6, release: 0.4 },
    build(t0, out) {
      for (let i = 0; i < 3; i++) {
        const t = t0 + i * 0.2;
        const f = 262 * Math.pow(0.84, i);
        const s = osc('square', f, t, 0.17);
        sweep(s.frequency, t, f, f * 0.88, 0.16);
        const f1 = filt('bandpass', f * 3, 3.5);
        const f2 = filt('bandpass', f * 5, 4);
        const g1 = gain(0), g2 = gain(0);
        adsr(g1.gain, t, 1.0, 0.006, 0.04, 0.8, 0.08, 0.06);
        adsr(g2.gain, t, 0.5, 0.006, 0.04, 0.8, 0.08, 0.06);
        s.connect(f1); f1.connect(g1); g1.connect(out);
        s.connect(f2); f2.connect(g2); g2.connect(out);
      }
      const sub = osc('sine', 110, t0 + 0.5, 0.6);
      sweep(sub.frequency, t0 + 0.5, 110, 34, 0.55);
      const sg = gain(0);
      adsr(sg.gain, t0 + 0.5, 0.5, 0.01, 0.2, 0.5, 0.15, 0.28);
      sub.connect(sg); sg.connect(out);

      const n = noise(t0 + 0.45, 0.4, 0.9);
      const bp = filt('bandpass', 900, 1.2);
      sweep(bp.frequency, t0 + 0.45, 1400, 300, 0.38);
      const ng = gain(0);
      adsr(ng.gain, t0 + 0.45, 0.16, 0.03, 0.12, 0.4, 0.06, 0.2);
      n.connect(bp); bp.connect(ng); ng.connect(out);
      return [sub, n];
    },
  },

  /* The harpoon bouncing off a Geode — and this is the ONLY thing that teaches
   * "not this one, use a rock", so it has to read as a refusal rather than as a
   * quieter kind of hit. Three things do that work:
   *
   *   Inharmonic. The ratios are deliberately not simple, so no two partials
   *   beat into a pitch. It is struck metal, never a note.
   *
   *   DAMPED. The partial decay is fast and gets faster up the stack — metal
   *   that is stopped dead by stone, not metal that rings. A ring reads as
   *   "hit registered"; this must read as "absorbed".
   *
   *   Stone underneath. A dry mid knock with no tail at all is what makes the
   *   thing being struck a rock rather than a bell.
   *
   * If a general "you missed" sound ever gets added, keep it well away from
   * this one in both register and decay, or the lesson stops landing. */
  clang: {
    bus: 'sfx', prio: 5, poly: 3, dur: 0.4,
    build(t0, out) {
      const base = vary(1240, 90);
      metal(out, t0, base, [1, 1.51, 2.13, 2.79, 3.41], 0.46, 0.13, 0.5);

      const n = noise(t0, 0.04, 1.8);
      const hp = filt('highpass', 2600);
      const g = gain(0);
      hit(g.gain, t0, 0.34, 0.03);
      n.connect(hp); hp.connect(g); g.connect(out);

      // Stone. Narrow, dry, over in 50 ms.
      const k = noise(t0, 0.06, 0.85);
      const kb = filt('bandpass', 520, 2.2);
      sweep(kb.frequency, t0, 620, 340, 0.05);
      const kg = gain(0);
      hit(kg.gain, t0, 0.34, 0.05);
      k.connect(kb); kb.connect(kg); kg.connect(out);

      const th = osc('sine', 160, t0, 0.09);
      sweep(th.frequency, t0, 170, 80, 0.08);
      const tg = gain(0);
      hit(tg.gain, t0, 0.26, 0.08);
      th.connect(tg); tg.connect(out);
      return [n, k, th];
    },
  },

  /* The drill down to the next level. A motor: a saw through a lowpass that
   * opens as the pitch climbs, amplitude-modulated at 26 Hz so it reads as
   * rotating machinery, with grit on top and a thunk when it seats. */
  descend: {
    bus: 'sfx', prio: 8, poly: 1, dur: 1.5, duck: { amount: 0.5, hold: 0.8, release: 0.4 },
    build(t0, out) {
      const dur = 1.15;
      const s = osc('sawtooth', 72, t0, dur);
      sweep(s.frequency, t0, 66, 132, dur * 0.85);
      const lp = filt('lowpass', 500, 5);
      sweep(lp.frequency, t0, 380, 1900, dur * 0.85);
      const g = gain(0);
      adsr(g.gain, t0, 0.44, 0.06, 0.15, 0.85, 0.72, 0.18);
      lfo(g.gain, t0, dur, 26, 0.13, 'triangle');
      s.connect(lp); lp.connect(g); g.connect(out);

      const n = noise(t0, dur, 1.0);
      const bp = filt('bandpass', 1400, 1.6);
      sweep(bp.frequency, t0, 900, 3000, dur * 0.85);
      const ng = gain(0);
      adsr(ng.gain, t0, 0.18, 0.08, 0.15, 0.8, 0.7, 0.18);
      lfo(ng.gain, t0, dur, 26, 0.06, 'triangle');
      n.connect(bp); bp.connect(ng); ng.connect(out);

      const t = t0 + dur - 0.05;
      const th = osc('sine', 120, t, 0.3);
      sweep(th.frequency, t, 130, 42, 0.26);
      const tg = gain(0);
      hit(tg.gain, t, 0.6, 0.26);
      th.connect(tg); tg.connect(out);
      return [s, n];
    },
  },
};

/* ── shared voice helpers ─────────────────────────────────────────────── */

let hardCurveCache: Float32Array<ArrayBuffer> | null = null;
function hardCurve() {
  if (hardCurveCache) return hardCurveCache;
  const n = 512;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 4);
  }
  hardCurveCache = c;
  return c;
}

/** A run of notes (MIDI numbers) at a fixed spacing. */
function arp(
  out: AudioNode, t0: number, notes: number[], step: number,
  peak: number, type?: OscillatorType,
) {
  for (let i = 0; i < notes.length; i++) {
    const t = t0 + i * step;
    const f = mtof(notes[i]);
    const s = osc(type || 'square', f, t, step + 0.22);
    const lp = filt('lowpass', f * 5, 1.2);
    const g = gain(0);
    adsr(g.gain, t, peak, 0.004, 0.05, 0.45, step * 0.5, 0.14);
    s.connect(lp); lp.connect(g); g.connect(out);
  }
}

/* ── play ─────────────────────────────────────────────────────────────── */

/* value may be the engine's plain number (`play(e.type, e.value)`) or the whole
 * event object (`play(e.type, e)`). The object form is what lets a repeated
 * event from one entity steal its own voice instead of stacking — see alloc().
 * Both forms are supported so this module never blocks on app.js changing. */
export function play(name: string, value?: SoundEvent | number | string | null) {
  if (!ctx || muted) return;
  const spec = VOICES[name];
  if (!spec) return;
  const o: SoundEvent = (value !== null && value !== undefined && typeof value === 'object')
    ? value
    : { value: value ?? undefined };
  const t0 = ctx.currentTime + (o.delay || 0);

  const v = alloc(spec, name, o.id, t0);
  if (!v) return;
  if (spec.duck) duck(spec.duck.amount, spec.duck.hold, spec.duck.release, t0, spec.bus === 'alert');
  const srcs = spec.build(t0, v.out, o);
  if (srcs) v.srcs = srcs;

  /* The score answers the game here rather than in app.js. `levelclear` is
   * already the engine event that says the level is over, so routing it into
   * music.resolve() gives the harmony a cadence without app.js learning that
   * the music has a harmony at all — the same reason the mixer reads `id` off
   * the event instead of asking for it. */
  if (name === 'levelclear') music.resolve();
}

/** For tests and for hard resets: silence everything sounding right now. */
export function panic() {
  if (!ctx) return;
  const t = now();
  for (let i = voices.length - 1; i >= 0; i--) kill(voices[i], t);
  sfxDuck.gain.cancelScheduledValues(t); sfxDuck.gain.setValueAtTime(1, t);
  musicDuck.gain.cancelScheduledValues(t); musicDuck.gain.setValueAtTime(1, t);
  musicFloor = 1; musicFloorUntil = 0;
}

/* Test-only entry point. tests/audio.mjs renders every voice through an
 * OfflineAudioContext with this, so the numbers in the report describe the
 * graph that ships rather than a re-implementation of it. `limiter: false`
 * removes the safety compressor so a voice's true peak is measurable instead of
 * being flattered by it. */
export function _attachForTest(offlineCtx: BaseAudioContext, opts?: BuildOpts) {
  muted = false;
  build(offlineCtx, opts);
}

export function _voiceNames() { return Object.keys(VOICES); }
export function _spec(name: string) { return VOICES[name]; }
