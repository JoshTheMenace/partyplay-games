/* soundforge — the mixer, the voice pool and the safety chain.
 *
 * createAudio(config) returns one self-contained audio instance. Nothing here
 * is module state, which matters more than it sounds: the offline rig builds a
 * fresh instance per render, and a module-level `ctx` would leak one render's
 * automation into the next and make an A/B meaningless.
 *
 * ── the shape of a voice ──────────────────────────────────────────────────
 * A project supplies a VOICE TABLE. Adding a sound is "add a key". An entry is
 * a descriptor rather than a bare function, because the mixer needs to know
 * things about a sound BEFORE it builds it: which bus it belongs on, how many
 * may overlap, whether it may steal from something already playing, and whether
 * it ducks.
 *
 *   name: { bus, prio, poly, dur, duck, resolve, build(t0, out, o, k) }
 *
 * build() wires whatever it likes into `out`, a per-voice gain the mixer owns,
 * and returns the array of sources it started (so stealing can stop them).
 * `k` is the primitive kit from dsp.js. Write the table as `(k) => ({...})` and
 * the bodies can destructure it once at the top.
 *
 * ── the mix ───────────────────────────────────────────────────────────────
 *              sfx-role ─┐
 *                        ├─ duck ─┐
 *            music-role ─┘        ├─ mix ─ master ─ safety ─ destination
 *            alert-role ──────────┘
 *
 * A bus has a ROLE, and the roles are what the default duck plan is written
 * against. 'sfx' and 'music' sit behind duck gains; 'alert' does not, on
 * purpose — an alert carries information the player cannot see, so it ducks
 * everything on the way past and nothing may duck it. Anything that can bury an
 * alert is a bug, not a mix preference.
 */

import { makeKit, makeNoiseBuffer, softClipCurve } from './dsp.js';

const DEFAULT_BUSES = {
  sfx: { role: 'sfx' },
  music: { role: 'music' },
  alert: { role: 'alert' },
};

/* How one voice's duck request becomes a dip on every bus.
 *
 * `d` is the voice's own { amount, hold, release } — amount is a MULTIPLIER, so
 * 0.34 is a deep duck and 0.9 is a shallow one. `v` describes the voice.
 *
 * MUSIC DUCKS HARDER AND LONGER THAN SFX, AND FOR AN ALERT IT DUCKS HARDER AND
 * LONGER AGAIN. Neither number is a taste decision. A generative score lives
 * partly in 250–1500 Hz, which is the same band an alert has to cut through,
 * and the LENGTH is the part that is easy to get wrong: an alert's duck used to
 * release about when the alert stopped sounding, which is right for sfx and
 * useless here, because the margin is measured over the seconds a player needs
 * to LOCATE the thing and for most of that the music had already swelled back.
 *
 * For everything else, how long the music stays down scales with how big the
 * event was: a small pop dips it for under a second and reads as the kill
 * getting some space; a cave-in holds it down for three, which is roughly how
 * long a cave-in takes to stop making noise. */
export function defaultDuckPlan(d, v) {
  const plan = { sfx: { amount: d.amount, hold: d.hold, release: d.release } };
  if (v.isAlert) {
    plan.music = { amount: d.amount * 0.35, hold: d.hold + 1.2, release: d.release * 3 };
  } else {
    const size = 1 - d.amount;
    plan.music = { amount: d.amount * 0.7, hold: d.hold + size * 1.2, release: d.release * (1.6 + size * 3) };
  }
  return plan;
}

export function createAudio(config) {
  const cfg = config || {};
  const LEVEL = cfg.level == null ? 0.24 : cfg.level;
  const MAX_VOICES = cfg.maxVoices == null ? 24 : cfg.maxVoices;
  const NOISE_SECONDS = cfg.noiseSeconds == null ? 2 : cfg.noiseSeconds;
  const duckPlan = cfg.duckPlan || defaultDuckPlan;
  const score = cfg.score || null;
  const busCfg = normaliseBuses(cfg.buses || DEFAULT_BUSES);
  const defaultBus = cfg.defaultBus || firstOfRole(busCfg, 'sfx') || Object.keys(busCfg)[0];
  const rng = cfg.rng || Math.random;

  let ctx = null;
  let master = null;
  let mix = null;
  let kit = null;
  let noiseBuf = null;
  let VOICES = null;
  let muted = !!cfg.muted;

  const bus = {};        // name -> { in, duckGain|null, role, policy, floor, until }
  const voices = [];

  /* ── setup ──────────────────────────────────────────────────────────── */

  /* MUST stay callable synchronously inside a real user gesture. An
   * AudioContext starts suspended and iOS only honours resume() from inside the
   * gesture that triggered it — not from a promise continuation, not from a
   * later frame, not from an `await`. So everything in here is synchronous,
   * including filling the noise buffer.
   *
   * The phone's physical mute switch also silences WebAudio on some iOS
   * versions. A muted handset means silence and that is not a bug to chase. */
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    attach(new AC());
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* Shared by unlock() and by the offline rig, so the rig measures the graph
   * that actually ships rather than a copy of it.
   *
   * opts.safety:
   *   undefined | true | 'softclip'   the soft clipper (default)
   *   false | 'none'                  bypassed — what the rig uses to see a
   *                                   voice's true peak
   *   function(ctx) -> node|{in,out}  your own. Read the throw below first. */
  function attach(audioCtx, opts) {
    const o = opts || {};
    ctx = audioCtx;

    master = ctx.createGain();
    master.gain.value = muted ? 0 : LEVEL;

    let tail = master;
    const safety = buildSafety(ctx, o.safety === undefined ? cfg.safety : o.safety, cfg.unsafe);
    if (safety) { master.connect(safety.in); tail = safety.out; }
    tail.connect(ctx.destination);

    mix = ctx.createGain();
    mix.connect(master);

    for (const name of Object.keys(busCfg)) {
      const b = busCfg[name];
      const input = ctx.createGain(); input.gain.value = 1;
      let duckGain = null;
      if (b.ducked) {
        duckGain = ctx.createGain(); duckGain.gain.value = 1;
        input.connect(duckGain); duckGain.connect(mix);
      } else {
        input.connect(mix);
      }
      bus[name] = { name, in: input, duckGain, role: b.role, policy: b.policy, floor: 1, until: 0 };
    }

    noiseBuf = makeNoiseBuffer(ctx, NOISE_SECONDS, rng);
    kit = makeKit(ctx, noiseBuf, rng);
    VOICES = typeof cfg.voices === 'function' ? cfg.voices(kit) : (cfg.voices || {});
    voices.length = 0;

    if (score) score.attach(ctx, bus[firstOfRole(busCfg, 'music') || defaultBus].in, noiseBuf, rng);
    return ctx;
  }

  /* THE ONE THING THE SAFETY CHAIN MAY NOT DO IS RAISE THE LEVEL.
   *
   * A DynamicsCompressorNode applies an internal makeup gain, so the node most
   * people reach for to "protect" a mix makes the loudest moment in the game
   * louder still — measured, on the way in here, at +1.6 dB of RMS on the
   * worst-case burst. It is refused by name. If you genuinely want one, pass
   * `unsafe: true` and then watch rig.js fail the assertion, which is the
   * demonstration this refusal exists to save you from needing. */
  function buildSafety(ac, kind, allowUnsafe) {
    if (kind === false || kind === 'none') return null;
    if (kind === undefined || kind === true || kind === 'softclip') {
      const shaper = ac.createWaveShaper();
      shaper.curve = softClipCurve();
      shaper.oversample = '2x';
      return { in: shaper, out: shaper };
    }
    if (typeof kind !== 'function') throw new Error('soundforge: safety must be false, "softclip", or a function(ctx)');
    const made = kind(ac);
    const node = made && made.in ? made : { in: made, out: made };
    if (!allowUnsafe && looksLikeCompressor(node.in)) {
      throw new Error(
        'soundforge: a DynamicsCompressorNode applies internal makeup gain, so it can RAISE ' +
        'the peak it is supposed to protect. Use the soft clipper, or pass unsafe:true and ' +
        'prove it with rig.assertSafetyDoesNotRaisePeak().');
    }
    return node;
  }

  function looksLikeCompressor(n) {
    if (!n) return false;
    if (typeof DynamicsCompressorNode !== 'undefined' && n instanceof DynamicsCompressorNode) return true;
    return !!(n.reduction !== undefined && n.threshold && n.knee && n.ratio);
  }

  /* ── mute ───────────────────────────────────────────────────────────── */

  function setMuted(v) {
    muted = !!v;
    if (master) master.gain.value = muted ? 0 : LEVEL;
    // Silencing the bed is not the same as turning its oscillators off. A muted
    // game should not still be running a drone into a gain of zero for an hour.
    if (score) { if (muted) score.stop(0.15); else if (ctx) score.restore(); }
  }
  function isMuted() { return muted; }
  function ready() { return !!ctx; }

  /* ── ducking ────────────────────────────────────────────────────────── */

  /* `t` is the VOICE'S OWN START TIME, never now().
   *
   * Two bugs live in that sentence. A sound scheduled with a delay has to duck
   * when it ARRIVES: ducking at currentTime drops the bus early and, worse, the
   * dip has released again by the time the sound plays. And even for an
   * immediate sound, a live context's currentTime is the start of the
   * last-rendered quantum and is therefore already in the PAST, so a ramp
   * scheduled there does not get its attack at all — the transient goes through
   * at unity and the duck only catches the tail. That is not a thing you can
   * fix by ducking earlier; it is a thing you must MEASURE honestly, which is
   * why the rig's canonical burst is at t=0. See rig/rig.js.
   *
   * There is deliberately no public duck-at-now() entry point. duckBus()
   * requires an explicit `at`. */
  function duckBus(name, d, at) {
    if (at === undefined || at === null) {
      throw new Error('soundforge: duckBus needs an explicit `at` — pass the voice\'s own start time, not ctx.currentTime');
    }
    const b = bus[name];
    if (!b || !b.duckGain) return;
    dipBus(b, d.amount, d.hold, d.release, at);
  }

  function applyDuck(spec, t0, name) {
    const isAlert = (busCfg[spec.bus || defaultBus] || {}).role === 'alert';
    const plan = duckPlan(spec.duck, { bus: spec.bus || defaultBus, isAlert, name });
    for (const role of Object.keys(plan)) {
      const d = plan[role];
      if (!d) continue;
      for (const bn of Object.keys(bus)) {
        const b = bus[bn];
        if (b.role !== role || !b.duckGain) continue;
        dipBus(b, d.amount, d.hold, d.release, t0);
      }
    }
  }

  /* THE DEEPEST DUCK WINS, and that is a bug fix rather than a preference.
   *
   * dip() cancels whatever automation was pending and ramps to its own target,
   * so a burst of eighteen sounds leaves the bus wherever the LAST one it
   * processed asked for. In a real worst case that is a small sound with a
   * shallow duck, scheduled after a cave-in's deep one, quietly lifting the bus
   * back up over the biggest event in the game. Inaudible; worth most of a dB
   * of alert margin. Two pieces of state per bus: how far down it is currently
   * committed to going, and when that commitment expires.
   *
   * policy:'last' restores the old behaviour for a bus whose numbers are
   * already tuned against it. It is not the default and it is not recommended. */
  function dipBus(b, amount, hold, release, t) {
    if (b.policy === 'last') { dip(b.duckGain.gain, amount, hold, release, t); return; }
    const end = t + 0.005 + hold + release;
    if (t < b.until && amount > b.floor) {
      // Shallower than what is already holding. Never lift it — either extend
      // the existing depth, or if this one is over first, ignore it entirely.
      if (end <= b.until) return;
      amount = b.floor;
    }
    b.floor = amount;
    b.until = end;
    dip(b.duckGain.gain, amount, hold, release, t);
  }

  /* 5 ms of attack. Long enough not to step-click a decaying tail, short enough
   * to be most of the way down before the transients of a simultaneous burst
   * have finished — at 15 ms the duck arrived after the peak it existed to
   * control.
   *
   * cancelAndHoldAtTime keeps whatever the automation had reached at t, which
   * is what makes overlapping ducks compose at all: a chain re-ducking every
   * 120 ms must start each new dip from the bus's ACTUAL level, not from
   * param.value, which is only the last value explicitly set. */
  function dip(param, amount, hold, release, t) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
    param.linearRampToValueAtTime(amount, t + 0.005);
    param.setValueAtTime(amount, t + 0.005 + hold);
    param.linearRampToValueAtTime(1, t + 0.005 + hold + release);
  }

  /* ── voice pool ─────────────────────────────────────────────────────── */

  /* Stealing order, tightest first:
   *   1. same event from the same entity id — a monster that re-telegraphs
   *      while its last telegraph is still ringing must REPLACE it, not stack
   *      with it. This is the whole reason stable entity ids matter to audio.
   *   2. oldest voice of the same key, once that key is at its poly limit.
   *   3. globally: the oldest voice of strictly lower priority.
   * If nothing may be stolen the new sound is dropped, which is the correct
   * failure — a dropped footstep is inaudible, an exhausted node graph is not. */
  function alloc(spec, key, id, t0) {
    reap(t0);

    if (id !== undefined && id !== null) {
      for (let i = voices.length - 1; i >= 0; i--) {
        if (voices[i].key === key && voices[i].id === id) kill(voices[i], t0);
      }
    }

    const poly = spec.poly == null ? 3 : spec.poly;
    let same = 0;
    for (const v of voices) if (v.key === key) same++;
    while (same >= poly) {
      let oldest = null;
      for (const v of voices) if (v.key === key && (!oldest || v.t0 < oldest.t0)) oldest = v;
      if (!oldest) break;
      kill(oldest, t0);
      same--;
    }

    const prio = spec.prio == null ? 1 : spec.prio;
    if (voices.length >= MAX_VOICES) {
      let victim = null;
      for (const v of voices) {
        if (v.prio >= prio) continue;
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
      }
      if (!victim) return null;
      kill(victim, t0);
    }

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect((bus[spec.bus] || bus[defaultBus]).in);
    const v = { key, id, prio, t0, end: t0 + (spec.dur == null ? 1 : spec.dur), out, srcs: [] };
    voices.push(v);
    return v;
  }

  /* A stolen voice is faded over 8 ms rather than cut. Below about 5 ms the
   * fade is itself an audible click, which is precisely the artefact stealing
   * exists to avoid. */
  function kill(v, t) {
    const g = v.out.gain;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + 0.008);
    } catch (e) { /* param already released */ }
    for (const s of v.srcs) { try { s.stop(t + 0.012); } catch (e) { /* ended */ } }
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
  }

  function reap(t) {
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= t) voices.splice(i, 1);
  }

  /* ── play ───────────────────────────────────────────────────────────── */

  /* `value` may be a plain number (`play('combo', 5)`) or the whole event
   * object (`play(e.type, e)`). The object form is what lets a repeated event
   * from one entity steal its own voice instead of stacking:
   *
   *   { id, value, delay }
   *
   * Both forms are supported so the caller never has to change to adopt ids. */
  function play(name, value) {
    if (!ctx || muted) return null;
    const spec = VOICES[name];
    if (!spec) return null;
    const o = (value !== null && typeof value === 'object') ? value : { value: value };
    const t0 = ctx.currentTime + (o.delay || 0);

    const v = alloc(spec, name, o.id, t0);
    if (!v) return null;
    if (spec.duck) applyDuck(spec, t0, name);
    const srcs = spec.build(t0, v.out, o, kit);
    if (srcs) v.srcs = srcs;

    /* A voice may be marked `resolve: true`, which asks the score for a cadence
     * at the same instant. That keeps the app from having to know the music has
     * a harmony at all — the event that says "the level is over" is already
     * being played, so it is also the event that ends the phrase. Note it is
     * passed t0, not now(): same rule as ducking. */
    if (spec.resolve && score) score.resolve(t0);
    return v;
  }

  /** Silence everything sounding right now. For hard resets and for tests. */
  function panic() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = voices.length - 1; i >= 0; i--) kill(voices[i], t);
    for (const bn of Object.keys(bus)) {
      const b = bus[bn];
      if (!b.duckGain) continue;
      b.duckGain.gain.cancelScheduledValues(t);
      b.duckGain.gain.setValueAtTime(1, t);
      b.floor = 1; b.until = 0;
    }
  }

  /* ── ambient / score passthrough ────────────────────────────────────── */

  function setAmbient(opts) { if (ctx && !muted && score) score.set(opts); }
  function stopAmbient(fade) { if (score) score.stop(fade); }

  return {
    unlock, attach, play, panic, duckBus,
    setMuted, isMuted, ready,
    setAmbient, stopAmbient,
    get context() { return ctx; },
    get kit() { return kit; },
    get score() { return score; },
    get master() { return master; },
    bus(name) { return bus[name]; },
    voiceNames() { return Object.keys(VOICES || {}); },
    spec(name) { return (VOICES || {})[name]; },
    activeVoices() { return voices.length; },
  };
}

function normaliseBuses(src) {
  const out = {};
  for (const name of Object.keys(src)) {
    const b = src[name] || {};
    const role = b.role || name;
    const ducked = b.ducked === undefined ? role !== 'alert' : !!b.ducked;
    out[name] = { role, ducked, policy: b.policy || 'deepest' };
  }
  return out;
}

function firstOfRole(buses, role) {
  for (const name of Object.keys(buses)) if (buses[name].role === role) return name;
  return null;
}
