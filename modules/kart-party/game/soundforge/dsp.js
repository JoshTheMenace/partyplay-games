/* soundforge — synthesis primitives.
 *
 * Everything here is pure WebAudio node plumbing. No asset files, no fetches,
 * no DOM, no clock of its own: a voice built with these renders identically in
 * a live AudioContext and in an OfflineAudioContext, which is the whole reason
 * the measurement rig can claim to be measuring the thing that ships.
 *
 * The kit is created per context (makeKit) and closes over that context, the
 * shared noise buffer and the instance's random source. A voice table written
 * against the kit therefore never reaches for `Math.random` or a global, which
 * is what makes a seeded render reproducible to the last bit.
 */

const A4 = 440;
const EPS = 1e-4;

/** MIDI note number to Hz. */
export function mtof(m) { return A4 * Math.pow(2, (m - 69) / 12); }

/** Hz to the nearest MIDI note number (fractional). */
export function ftom(f) { return 69 + 12 * Math.log2(Math.max(1e-6, f) / A4); }

/* ── the shared noise buffer ──────────────────────────────────────────────
 *
 * Generated ONCE per context and shared by every voice that wants noise. The
 * naive alternative — allocate and fill an AudioBuffer per hit — is a
 * garbage-collector pacing problem dressed up as a sound, and it only shows up
 * on the device you cannot attach a profiler to. At 44.1 kHz two seconds is
 * 88 200 draws and under 2 ms, which is cheap enough to do synchronously inside
 * the unlock gesture (where it must happen: see engine.js).
 *
 * Slightly pink: a one-pole smoother mixed back over the white. Pure white
 * reads as hiss, and most physical sounds want weight under them. */
export function makeNoiseBuffer(ac, seconds, rng) {
  const rand = rng || Math.random;
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    last = 0.86 * last + 0.14 * w;
    d[i] = w * 0.7 + last * 2.2;
  }
  return buf;
}

/* ── waveshaper curves ────────────────────────────────────────────────────*/

/* Unity BELOW the knee, soft above it, and that distinction is the entire
 * point of the function.
 *
 * The obvious `tanh(x*k)/tanh(k)` has a small-signal slope of k/tanh(k) — at
 * k=1.35 that is 1.54x, so it quietly adds 3.8 dB to EVERYTHING and the
 * "protected" signal measures louder than the raw one. A safety net that raises
 * the level is not a safety net. This curve is exactly 1.0 below the knee,
 * monotonic above it, memoryless, and has no makeup gain to reason about.
 *
 * See also: assertSafetyDoesNotRaisePeak in rig/rig.js, which is the check that
 * catches the day someone puts a compressor back. */
export function softClipCurve(knee, n) {
  const N = n || 2048, k = knee == null ? 0.7 : knee;
  const c = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= k ? a : k + (1 - k) * Math.tanh((a - k) / (1 - k));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

/* Deliberate distortion, for voices that want to sound damaged. NOT a safety
 * device — this one does raise the level of small signals, on purpose. */
const hardCache = new Map();
export function hardCurve(drive, n) {
  const k = drive == null ? 4 : drive, N = n || 512;
  const key = k + ':' + N;
  if (hardCache.has(key)) return hardCache.get(key);
  const c = new Float32Array(N);
  for (let i = 0; i < N; i++) c[i] = Math.tanh(((i / (N - 1)) * 2 - 1) * k);
  hardCache.set(key, c);
  return c;
}

/* ── the kit ──────────────────────────────────────────────────────────────*/

/**
 * Build the primitive set for one AudioContext.
 *
 *   makeKit(ctx, noiseBuf, rng) -> { osc, noise, gain, filt, adsr, hit, sweep,
 *                                    lfo, metal, arp, rnd, vary, mtof, ctx, EPS }
 *
 * A project's voice table is normally written as `(k) => ({ ... })` so the
 * bodies can destructure this and read like the phonedig originals.
 */
export function makeKit(ctx, noiseBuf, rng) {
  const rand = rng || Math.random;

  function rnd(a, b) { return a + rand() * (b - a); }

  /* Pitch variation, in cents. Repeated digging with an identical fundamental
   * is the "machine gun of one sample" sound, and it is the single thing that
   * makes procedural audio read as cheap. Every percussive voice wants some. */
  function vary(f, cents) { return f * Math.pow(2, rnd(-cents, cents) / 1200); }

  function osc(type, f, t0, dur) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f), t0);
    o.start(t0);
    o.stop(t0 + dur);
    return o;
  }

  /* A window onto the shared buffer, starting at a random offset so two hits
   * never present the same noise. `rate` detunes it, which is most of what
   * makes one noise buffer sound like a dozen different materials. */
  function noise(t0, dur, rate) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.playbackRate.value = rate || 1;
    s.start(t0, rand() * Math.max(0.001, noiseBuf.duration - dur - 0.05));
    s.stop(t0 + dur);
    return s;
  }

  function gain(v) { const g = ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; }

  function filt(type, f, q) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = Math.max(10, f);
    if (q != null) b.Q.value = q;
    return b;
  }

  /* A real ADSR, not two exponential ramps.
   *   a   LINEAR attack. Linear, so a 1.2 ms attack is a click TRANSIENT and
   *       not a fade — an exponential ramp from EPS spends most of its length
   *       inaudible and then arrives all at once, which is a different sound
   *       and a worse one. Percussive layers live or die on this.
   *   d   exponential decay to the sustain level
   *   sus fraction of peak, held for `hold`
   *   r   exponential release
   * Returns the time the envelope reaches zero. */
  function adsr(p, t0, peak, a, d, sus, hold, r) {
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
  function hit(p, t0, peak, dur) {
    return adsr(p, t0, peak, 0.0012, dur * 0.5, 0.02, 0, dur * 0.5);
  }

  /* Filters that MOVE. A static filter is an EQ; a moving one is a gesture, and
   * it is the difference between "a noise burst" and "material being cut". */
  function sweep(p, t0, from, to, dur) {
    p.setValueAtTime(Math.max(1, from), t0);
    p.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  }

  /** An LFO wired to modulate a param by +/- amount. Returns the oscillator. */
  function lfo(param, t0, dur, rate, amount, type) {
    const o = osc(type || 'sine', rate, t0, dur);
    const g = gain(amount);
    o.connect(g); g.connect(param);
    return o;
  }

  /* Inharmonic partials — the difference between "metal" and "a beep". Upper
   * partials die first (decayShape < 1), which is what makes a struck object
   * sound struck rather than plucked. Simple ratios ring as a pitch; awkward
   * ones stay an object. */
  function metal(out, t0, base, ratios, peak, dur, decayShape) {
    for (let i = 0; i < ratios.length; i++) {
      const o = osc('sine', vary(base * ratios[i], 12), t0, dur);
      const g = gain(0);
      const d = dur * Math.pow(decayShape == null ? 0.62 : decayShape, i);
      hit(g.gain, t0, peak / (1 + i * 1.15), d);
      o.connect(g); g.connect(out);
    }
  }

  /** A run of notes (MIDI numbers) at a fixed spacing. Jingles built from real
   *  intervals sit together as one family; jingles built from round numbers of
   *  Hz do not. */
  function arp(out, t0, notes, step, peak, type) {
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

  return {
    ctx, noiseBuf, rand, EPS,
    osc, noise, gain, filt, adsr, hit, sweep, lfo, metal, arp,
    rnd, vary, mtof, ftom, hardCurve, softClipCurve,
  };
}
