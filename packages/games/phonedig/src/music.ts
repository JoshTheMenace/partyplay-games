/* The ambient bed and the generative score.
 *
 * Owned by audio.js, which builds the AudioContext and hands us a bus. This
 * module never creates a context of its own and never touches the DOM, so it
 * renders identically inside an OfflineAudioContext in tests/audio.html.
 *
 * Two layers, and they answer two different complaints:
 *
 *   THE BED (build / set)      a drone that tracks depth and biome. It is the
 *                              floor. It never stops and it never plays a note.
 *   THE SCORE (buildScore …)   chords and a melodic line over the top, so the
 *                              only sound for the majority of an hour-long run
 *                              is not the sound of digging.
 *
 * ── WHY A FIXED GRAPH, TWICE ───────────────────────────────────────────────
 * The bed is built once and then *retuned* — set() ramps existing AudioParams
 * rather than tearing nodes down. A restart clicks, because an oscillator that
 * begins mid-cycle against another one that did not is a step discontinuity.
 * And the bed is the only thing in the mix that runs continuously, so it is the
 * only thing whose node cost is paid forever.
 *
 * The score follows the same rule for the same reason, and it is the reason it
 * is a NOTE POOL rather than a node per note. A phrase every ten seconds for an
 * hour is on the order of a thousand notes; at four nodes each that is four
 * thousand allocations and four thousand collections on a phone that is already
 * drawing a scrolling 20x160 field. Instead: eight pad voices (two banks of
 * four, so a chord can cross-fade into the next one without either bank ever
 * being retuned while it is audible), four melody voices round-robined, and one
 * feedback delay. Retuning happens while a voice's gain is at zero, which is
 * what makes it click-free.
 *
 *   bed        13 nodes
 *   score      42 nodes   (8x3 pad, 4x3 melody, bus, melBus, delay, damp,
 *                          feedback, wet)
 *   ────────────────────
 *   total      55 nodes, flat, for the whole session
 *
 * ── WHY SET() IS THE SCHEDULER'S PUMP ──────────────────────────────────────
 * app.js calls setAmbient() every frame. That is already a heartbeat, so the
 * score does not get a timer of its own: every call tops the schedule up to
 * LOOKAHEAD seconds ahead and returns. Notes are therefore committed to the
 * audio thread in blocks and nothing musical is ever decided inside a rAF
 * callback — a rAF that stalls for 200 ms cannot make the music stutter,
 * because the music was already scheduled 3 seconds ago.
 *
 * The cost of that is up to LOOKAHEAD seconds of latency between the game
 * getting tense and the harmony getting tense. For a score whose chords are ten
 * seconds long this is not a compromise, it is the correct resolution.
 *
 * ── WHY DEPTH DRIVES CHARACTER AND THE THEME ONLY DRIVES PITCH (BED) ───────
 * themes.js is filled in but audio must not import it — a theme id we have
 * never seen has to sound like *something* sensible on the day it lands. So an
 * unknown id is hashed to a stable root note, a stable detune AND a stable
 * mode, while everything that carries the emotional load of the bed (cutoff,
 * sub weight, wind, beating rate) is a function of depth. A new biome arrives
 * already in tune with itself; add a row to BEDS/SCORES only to override it.
 *
 * ── WHY THE SCORE IS SEEDED AND NOT WRITTEN ────────────────────────────────
 * A loop that plays for an hour stops being music and becomes a smell. So the
 * progression is seeded per RUN — consistent inside a descent, different next
 * time — and the melody is generated phrase by phrase from the same stream, so
 * it never repeats even inside one run. Drawing the seed from Math.random here
 * is legitimate: audio is outside the simulation (audio.js already varies pitch
 * with it), and tests/audio.mjs replaces Math.random for the length of a render
 * so the rig still measures one fixed score.
 *
 * ── WHY THE MELODY RESTS ───────────────────────────────────────────────────
 * Silence between phrases is not a gap in the composition, it IS the
 * composition. A line that never stops becomes wallpaper within a minute and an
 * irritation within five, and this plays for an hour. Phrases are two to five
 * notes; rests are six to nineteen seconds depending on the biome, shortening
 * as the air runs out. Measured over ten minutes the melody sounds for roughly
 * a fifth of the time. tests/out/music.png plots exactly this.
 *
 * ── WHY IT NEVER BURIES AN ALERT ───────────────────────────────────────────
 * hunt, wobble and airlow carry information the player cannot see, and they are
 * the only voices in the game that do. audio.js ducks this whole bus for them —
 * hard, and harder than it ducks sfx — and the score's own level is set so that
 * even undicked it is ~20 dB under the worst-case burst. See the alert-margin
 * check in tests/audio.mjs; the number in that report is the contract.
 */

/* ── types ────────────────────────────────────────────────────────────────
 *
 * The node bags below are built the way upstream builds them — an empty object
 * filled field by field — because the wiring reads as a signal chain that way
 * and rearranging it into one literal would obscure what connects to what. The
 * types name what each bag ends up holding, and the assertion where it is
 * created is the one place that is stated rather than proved. Everything
 * downstream of it is checked. */

/** A biome's ambient bed. */
type BedSpec = { root: number; detune: number; colour: number; wind: number };

/** A biome's score: which scale, which progressions, and how sparse. */
type ScoreSpec = {
  scale: string;
  progs: number[][];
  tense: number;
  rest: number[];
  hue: number;
  mel: number;
};

/** The ambient bed's nodes. */
type Bed = {
  a: OscillatorNode; b: OscillatorNode; sub: OscillatorNode;
  voiceMix: GainNode; lp: BiquadFilterNode; subGain: GainNode;
  wind: AudioBufferSourceNode; windBp: BiquadFilterNode; windGain: GainNode;
  bed: GainNode;
  lfoF: OscillatorNode; lfoFAmt: GainNode;
  lfoA: OscillatorNode; lfoAAmt: GainNode;
};

/** One pad or melody voice: an oscillator, its filter and its envelope. */
type Voice = { o: OscillatorNode; lp: BiquadFilterNode; g: GainNode };

/** The generative score's nodes. */
type ScoreNodes = {
  pad: Voice[];
  mel: Voice[];
  /** When each melody voice is next free, in context time. */
  melFree: number[];
  bus: GainNode;
  melBus: GainNode;
  delay: DelayNode; damp: BiquadFilterNode; fb: GainNode; wet: GainNode;
};

/** Where the score has got to. Advanced only by pump(). */
type ScoreState = {
  seed: number;
  rnd: () => number;
  /** Context time the next chord and the next phrase are due. */
  chordT: number; melT: number;
  chordN: number;
  step: number;
  prog: number[] | null;
  cfg: ScoreSpec | null;
  theme: string | null;
  inv: number;
  mdeg: number;
  cadence: number;
  cadenceMel: boolean;
  tension: number;
  depth: number;
  bedRoot: number;
  /** The bed's current level, so the score can sit a fixed amount under it. */
  bedTarget: number;
  /** The last chord's bank, so the melody knows what is sounding under it. */
  lastPad: { bank: number; count: number; peak: number } | null;
  /** The last few chords, newest last. A phrase snaps its first note to one. */
  recent: Chord[];
};

/** One scheduled chord: when it lands, and what it is made of. */
type Chord = { t: number; root: number; notes: number[]; base: number };

/** What set() was last asked for, so an unmute can rebuild it. */
export type Ambient = {
  theme?: string;
  /** 0..1 of the whole shaft, not of the level. */
  depth?: number;
  intensity?: number;
  fade?: number;
};

/** One logged note, when a test asks for the trace. */
type TraceNote = {
  /** Context time, MIDI note, duration, part ('p' pad / 'm' melody), peak. */
  t: number; m: number; d: number; k: string; v: number;
};

const A4 = 440;
const EPS = 1e-4;

/** MIDI note number to Hz. Exported because the jingles in audio.js want it. */
export function mtof(m: number) { return A4 * Math.pow(2, (m - 69) / 12); }

/* Per-biome overrides. root is a MIDI note for the drone fundamental; colour
 * nudges the timbre away from the depth-derived default. Anything not listed
 * is derived from a hash of its id (see bedFor). */
const BEDS: Record<string, BedSpec> = {
  // Warm, almost pleasant. This is the band a player learns the game in and it
  // should not sound like a threat.
  topsoil: { root: 33, detune: 6, colour: 1.25, wind: 0.7 },
};

/* A small stable string hash. Same id, same bed, every launch — an ambient bed
 * that reshuffled between sessions would read as a bug in the mix. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function bedFor(theme: string | undefined | null): BedSpec {
  const id = theme || 'topsoil';
  if (BEDS[id]) return BEDS[id];
  const h = hash(id);
  // Roots spread over an octave from A0-ish upward, in fourths and fifths so
  // consecutive biomes never land a semitone apart and beat against memory.
  const steps = [0, 7, 5, 10, 3, 8, 2];
  /* UNSIGNED shifts. hash() returns a value up to 2^32-1; `>>` would coerce
   * that to a signed int32, so any hash with the top bit set comes out
   * negative and `negative % n` is negative in JavaScript. Here that only
   * skews a colour; in scoreFor it indexes an array out of range. */
  return {
    root: 31 + steps[h % steps.length],
    detune: 4 + (h >>> 3) % 12,
    colour: 0.8 + ((h >>> 7) % 100) / 200,
    wind: 0.5 + ((h >>> 11) % 100) / 140,
  };
}

/* ── the material ─────────────────────────────────────────────────────────
 *
 * A mode, not a key. Every chord is built by stacking scale thirds off a
 * degree, so the mode decides the QUALITY of every chord for free and a biome
 * cannot be given a progression that contradicts its own scale. That is why
 * whole-tone crystal produces nothing but augmented triads (no leading tone
 * anywhere, so nothing ever resolves and the seam always sounds like it is
 * about to do something) and why locrian basalt produces a diminished tonic —
 * the one mode in common practice whose home chord is itself unstable. Basalt
 * is not meant to be pleasant to sit in.
 */
const SCALES: Record<string, number[]> = {
  lydian:    [0, 2, 4, 6, 7, 9, 11],
  ionian:    [0, 2, 4, 5, 7, 9, 11],
  dorian:    [0, 2, 3, 5, 7, 9, 10],
  aeolian:   [0, 2, 3, 5, 7, 8, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  wholetone: [0, 2, 4, 6, 8, 10],
  locrian:   [0, 1, 3, 5, 6, 8, 10],
};

/* progs  candidate skeletons, in scale degrees. The run seed picks ONE and then
 *        rotates its starting point, so a descent has an identity and the next
 *        descent has a different one.
 * tense  semitones above the chord root for the tension tone that gets stacked
 *        on as the air runs out. Chosen per biome rather than taken from the
 *        scale, because the point of it is to be slightly outside.
 * rest   [min, max] seconds of silence between melodic phrases, before tension
 *        shortens it.
 * hue    pad brightness multiplier. mel is melody level.
 */
const SCORES: Record<string, ScoreSpec> = {
  // Pastoral. A raised fourth over major, moving I–IV–vi–V: this is the only
  // biome in the game that is allowed to sound like a nice place.
  topsoil: { scale: 'lydian', progs: [[0, 3, 5, 4], [0, 4, 5, 3], [0, 5, 3, 4]], tense: 14, rest: [8, 19], hue: 1.55, mel: 0.95 },
  // Earth, not menace. Dorian's major sixth over a minor triad is warm without
  // being comfortable.
  clay: { scale: 'dorian', progs: [[0, 3, 6, 4], [0, 6, 3, 4], [0, 4, 6, 3]], tense: 10, rest: [7, 16], hue: 1.15, mel: 0.9 },
  // Plain minor. The middle of the run, and it should read as work.
  stone: { scale: 'aeolian', progs: [[0, 5, 3, 6], [0, 2, 5, 4], [0, 6, 4, 5]], tense: 13, rest: [7, 16], hue: 0.95, mel: 0.85 },
  // Whole tone: six equal steps, no tonic, no cadence possible. Beautiful and
  // wrong, which is what a crystal seam is.
  crystal: { scale: 'wholetone', progs: [[0, 2, 4, 1], [0, 3, 1, 5], [0, 4, 2, 3]], tense: 8, rest: [9, 20], hue: 1.75, mel: 0.8 },
  // Locrian, and the tension tone is a tritone off the root of an already
  // diminished chord. This is the one you do not want to be listening to.
  basalt: { scale: 'locrian', progs: [[0, 4, 1, 3], [0, 1, 4, 6], [0, 3, 6, 1]], tense: 6, rest: [6, 14], hue: 0.75, mel: 0.75 },
};

/* Unknown biomes get a mode by hash, weighted dark — anything shipped after
 * these five is deeper than these five. */
const MODE_BY_HASH = ['dorian', 'aeolian', 'phrygian', 'aeolian', 'locrian', 'wholetone'];

function scoreFor(theme: string | undefined | null): ScoreSpec {
  const id = theme || 'topsoil';
  if (SCORES[id]) return SCORES[id];
  const h = hash('score:' + id);
  /* UNSIGNED shifts, and this is the one that bit.
   *
   * `(h >> 4) % 4` is NEGATIVE for any hash with the top bit set, so
   * `[6, 10, 13, 14][-3]` is `undefined` and `tense` comes back undefined. A
   * biome whose id hashes that way then builds its tension tone as
   * `root + undefined`, which is NaN, which reaches an AudioParam, which
   * throws — out of the render loop, killing the canvas for the rest of the
   * round while the rest of the page carries on. Karst is such a biome, which
   * is why the game froze around level 20 and never at level 1.
   *
   * The tension tone is also stacked more often as the air runs out, so it
   * took a while to appear even once you were down there. */
  return {
    scale: MODE_BY_HASH[h % MODE_BY_HASH.length],
    progs: [[0, 3, 5, 4], [0, 5, 3, 6], [0, 4, 6, 3]],
    tense: [6, 10, 13, 14][(h >>> 4) % 4],
    rest: [6 + (h >>> 8) % 3, 14 + (h >>> 12) % 5],
    hue: 0.8 + ((h >>> 16) % 100) / 110,
    mel: 0.75 + ((h >>> 21) % 25) / 100,
  };
}

/* mulberry32. Small, fast, and good enough that a listener will never hear the
 * period — which for a generator that draws maybe ten thousand times an hour is
 * the only quality bar that matters. */
function prng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── module state ─────────────────────────────────────────────────────────*/

const LOOKAHEAD = 3.0;    // seconds of score committed ahead of the clock
const PAD_VOICES = 8;     // two banks of four
const MEL_VOICES = 4;

/* Set once by attach(), and never cleared: a context cannot be detached and
 * there is exactly one per page. `attached` is what every entry point guards
 * on, so these three do not have to be re-proved at each of their ninety-odd
 * uses inside the schedulers. */
let attached = false;
let ctx!: BaseAudioContext;
let out!: AudioNode;
let noiseBuf!: AudioBuffer;
let n: Bed | null = null;          // bed nodes, or null when the bed is not running
let sn: ScoreNodes | null = null;  // score nodes, or null
let q: ScoreState | null = null;   // score state (progression cursor, PRNG, clocks)
let want: Ambient | null = null;   // last requested settings, so unmute can rebuild
let runSeed = 0;
let trace: TraceNote[] | null = null;  // note log, only when a test asks for it

export function attach(audioCtx: BaseAudioContext, dest: AudioNode, noiseBuffer: AudioBuffer) {
  attached = true;
  ctx = audioCtx;
  out = dest;
  noiseBuf = noiseBuffer;
  n = null;
  sn = null;
  q = null;
  trace = null;
  runSeed = (Math.random() * 4294967296) >>> 0;
}

/* ── the bed ──────────────────────────────────────────────────────────────*/

function build(t0: number): Bed {
  const g = {} as Bed;

  // Two saws a hair apart. The beat between them is the bed's slow "breathing"
  // and it is what stops a static drone from reading as a stuck buzzer.
  g.a = ctx.createOscillator(); g.a.type = 'sawtooth';
  g.b = ctx.createOscillator(); g.b.type = 'sawtooth';
  g.sub = ctx.createOscillator(); g.sub.type = 'sine';

  g.voiceMix = ctx.createGain(); g.voiceMix.gain.value = 0.5;
  g.lp = ctx.createBiquadFilter(); g.lp.type = 'lowpass'; g.lp.Q.value = 3.5;
  g.subGain = ctx.createGain(); g.subGain.gain.value = 0.3;

  // Wind: a looping slice of the shared noise buffer, band-limited. Cheap, and
  // it is what makes the deep beds feel like a space rather than a chord.
  g.wind = ctx.createBufferSource();
  g.wind.buffer = noiseBuf; g.wind.loop = true;
  g.wind.playbackRate.value = 0.6;
  g.windBp = ctx.createBiquadFilter();
  g.windBp.type = 'bandpass'; g.windBp.frequency.value = 380; g.windBp.Q.value = 0.8;
  g.windGain = ctx.createGain(); g.windGain.gain.value = 0.0;

  g.bed = ctx.createGain(); g.bed.gain.value = 0.0001;

  // Two free-running LFOs, both far below 0.1 Hz and deliberately not in any
  // integer ratio, so the bed never repeats an audible cycle.
  g.lfoF = ctx.createOscillator(); g.lfoF.type = 'sine'; g.lfoF.frequency.value = 0.061;
  g.lfoFAmt = ctx.createGain(); g.lfoFAmt.gain.value = 90;
  g.lfoA = ctx.createOscillator(); g.lfoA.type = 'sine'; g.lfoA.frequency.value = 0.043;
  g.lfoAAmt = ctx.createGain(); g.lfoAAmt.gain.value = 0.02;

  g.a.connect(g.voiceMix); g.b.connect(g.voiceMix);
  g.voiceMix.connect(g.lp); g.lp.connect(g.bed);
  g.sub.connect(g.subGain); g.subGain.connect(g.bed);
  g.wind.connect(g.windBp); g.windBp.connect(g.windGain); g.windGain.connect(g.bed);
  g.lfoF.connect(g.lfoFAmt); g.lfoFAmt.connect(g.lp.frequency);
  g.lfoA.connect(g.lfoAAmt); g.lfoAAmt.connect(g.bed.gain);
  g.bed.connect(out);

  g.a.start(t0); g.b.start(t0); g.sub.start(t0);
  g.lfoF.start(t0); g.lfoA.start(t0);
  g.wind.start(t0, Math.random() * Math.max(0.001, noiseBuf.duration - 0.5));
  return g;
}

/* NaN-safe, and it has to be: the plain comparison form returns NaN unchanged
 * (NaN < lo and NaN > hi are both false), so a single bad input upstream passes
 * straight through every derived value and into a parameter ramp. */
function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/* opts: { theme, depth (0..1 of the shaft), intensity (0..1), fade (seconds) }
 *
 * Safe to call every frame — it schedules ramps and tops the score's schedule
 * up, and identical values ramp to where they already are. */
export function set(opts: Ambient | null | undefined) {
  if (!attached) return;
  const o = opts || {};
  want = o;
  const t = ctx.currentTime;
  if (!n) n = build(t);

  const bed = bedFor(o.theme);
  const depth = clamp(o.depth == null ? 0 : o.depth, 0, 1);
  const level = clamp(o.intensity == null ? 1 : o.intensity, 0, 1);
  const fade = o.fade == null ? 3.5 : o.fade;

  // Colder and more oppressive as you descend: the fundamental sags a whole
  // tone, the lowpass closes to a mutter, the sub takes over from the saws and
  // the wind comes up. All four move together — one parameter would read as an
  // effect, four reads as pressure.
  const root = mtof(bed.root - depth * 2);
  const cut = (700 * bed.colour) * Math.pow(0.26, depth);
  const detune = bed.detune * (1 + depth * 2.2);

  ramp(n.a.frequency, root, fade, t);
  ramp(n.b.frequency, root, fade, t);
  ramp(n.a.detune, -detune, fade, t);
  ramp(n.b.detune, detune, fade, t);
  ramp(n.sub.frequency, root / 2, fade, t);
  ramp(n.lp.frequency, cut, fade, t);
  ramp(n.lfoFAmt.gain, cut * 0.3, fade, t);
  ramp(n.subGain.gain, 0.22 + depth * 0.5, fade, t);
  ramp(n.windGain.gain, (0.03 + depth * 0.11) * bed.wind, fade, t);
  ramp(n.windBp.frequency, 420 - depth * 250, fade, t);

  // Deliberately quiet. The bed is a floor for everything else to stand on; if
  // a player can pick it out as "the music" it is too loud.
  const bedTarget = 0.085 * level;
  ramp(n.bed.gain, bedTarget, fade, t);

  /* ── the score follows ────────────────────────────────────────────────
   * A DESCENT RESTARTING IS THE ONE THING WE CAN SEE FROM HERE. depth is a
   * fraction of the whole shaft and only ever climbs inside a run, so a large
   * step backwards is a new run and nothing else — which lets the score reseed
   * without app.js having to grow a parameter it would then have to remember to
   * pass. Muting and unmuting does not come through here, so it cannot reseed
   * by accident. */
  if (!sn || !q) {
    sn = buildScore(t);
    q = newScore(t, runSeed);
  } else if (depth < q.depth - 0.2) {
    runSeed = (Math.random() * 4294967296) >>> 0;
    q = newScore(t, runSeed);
  }

  q.depth = depth;
  q.bedRoot = bed.root;
  q.bedTarget = bedTarget;
  /* app.js sends 0.55 while there is air and 1.0 when there is none, so the
   * useful part of the range is the top 45%. Normalise it here rather than
   * making every musical decision below repeat the arithmetic. */
  q.tension = clamp((level - 0.55) / 0.45, 0, 1);

  const id = o.theme || 'topsoil';
  if (q.theme !== id) {
    q.theme = id;
    q.cfg = scoreFor(id);
    // Seeded, so a run has one identity per biome and the next run has another.
    const progs = q.cfg.progs;
    q.prog = progs[Math.floor(q.rnd() * progs.length) % progs.length];
    q.step = Math.floor(q.rnd() * q.prog.length);
  }

  ramp(sn.bus.gain, 1, Math.max(fade, 4), t);
  pump(t + LOOKAHEAD);
}

/* Ramp a parameter from wherever it is to `to`.
 *
 * BOTH values are checked, and that is not defensive programming for its own
 * sake. A Web Audio parameter throws on a non-finite float, this is called ten
 * times per frame from the render loop, and an exception here does not stop the
 * music — it stops the GAME, because it unwinds out of requestAnimationFrame
 * and the loop never reschedules. The canvas then freezes on its last frame
 * while the rest of the page carries on, which is the least debuggable failure
 * this code can produce. Silence is the correct response to a bad number.
 *
 * `param.value` is read back rather than tracked, so it is the one that goes
 * bad in practice: a param carrying an a-rate connection can report something
 * unusable, and once it does, every later ramp on it throws. */
function ramp(param: AudioParam, to: number, secs: number, t: number) {
  if (!Number.isFinite(to)) { warnOnce('ramp target', to); return; }
  const from = param.value;
  param.cancelScheduledValues(t);
  if (Number.isFinite(from)) param.setValueAtTime(from, t);
  else warnOnce('ramp source', from);
  param.linearRampToValueAtTime(to, t + Math.max(0.01, secs));
}

/* Every scheduler bails on a non-finite input rather than passing it to a
 * parameter, which throws — and a throw here does not stop the music, it stops
 * the GAME, because it unwinds out of requestAnimationFrame. The site name is
 * part of the message because these numbers are derived through several steps
 * and knowing which schedule went bad is most of the diagnosis. */
function ok(where: string, ...values: number[]) {
  for (const v of values) {
    if (!Number.isFinite(v)) { warnOnce(where, v); return false; }
  }
  return true;
}

/* Which guards have fired this session. The guards keep a player's game alive;
 * this is how a TEST refuses to let the thing that tripped them ship — a guard
 * that fires is a bug that was caught, not a bug that was fixed. */
export function _faults() { return [...warned]; }
export function _clearFaults() { warned.clear(); }

/* One line per distinct problem, ever. A per-frame fault would otherwise post
 * sixty identical lines a second and bury whatever came before it. */
const warned = new Set<string>();
function warnOnce(what: string, value: number) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[music] skipped: non-finite value at ${what}: ${value}`);
}

/* ── the score: nodes ─────────────────────────────────────────────────────*/

function buildScore(t0: number): ScoreNodes {
  const g = { pad: [], mel: [], melFree: [] } as unknown as ScoreNodes;

  g.bus = ctx.createGain(); g.bus.gain.value = 0.0001;
  g.bus.connect(out);

  /* Eight pad voices in two banks of four. A chord takes a whole bank, the next
   * chord takes the other one, so a bank is silent for a full bar before it is
   * retuned — the retune therefore never happens under a sounding note, and
   * consecutive chords overlap into a cross-fade instead of gapping. */
  for (let i = 0; i < PAD_VOICES; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 110;
    // A few cents of spread across the chord. Not vibrato and not a chorus —
    // just enough that three saws read as three players rather than one organ.
    o.detune.value = ((i % 4) - 1.5) * 5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.9;
    const gg = ctx.createGain(); gg.gain.value = 0;
    o.connect(lp); lp.connect(gg); gg.connect(g.bus);
    o.start(t0);
    g.pad.push({ o, lp, g: gg });
  }

  g.melBus = ctx.createGain(); g.melBus.gain.value = 1;
  g.melBus.connect(g.bus);

  /* One feedback delay, shared. A sparse line in a dry field sounds like a test
   * tone; the same line with a tail sounds like a space with something in it,
   * and it costs four nodes once rather than a reverb convolution we would have
   * to ship an impulse response for — which would be an asset file, which is
   * the one thing this whole module exists to avoid. */
  g.delay = ctx.createDelay(2);
  g.delay.delayTime.value = 0.41;
  g.damp = ctx.createBiquadFilter();
  g.damp.type = 'lowpass'; g.damp.frequency.value = 1700;
  g.fb = ctx.createGain(); g.fb.gain.value = 0.34;
  g.wet = ctx.createGain(); g.wet.gain.value = 0.3;
  g.melBus.connect(g.delay);
  g.delay.connect(g.damp); g.damp.connect(g.fb); g.fb.connect(g.delay);
  g.damp.connect(g.wet); g.wet.connect(g.bus);

  for (let i = 0; i < MEL_VOICES; i++) {
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = 440;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 1.1;
    const gg = ctx.createGain(); gg.gain.value = 0;
    o.connect(lp); lp.connect(gg); gg.connect(g.melBus);
    o.start(t0);
    g.mel.push({ o, lp, g: gg });
    g.melFree.push(0);
  }
  return g;
}

function newScore(t0: number, seed: number): ScoreState {
  return {
    seed,
    rnd: prng(seed),
    // The bed alone for a few seconds. Music that starts the instant the game
    // does reads as a title screen; music that arrives reads as a place.
    chordT: t0 + 1.5,
    melT: t0 + 9,
    chordN: 0,
    step: 0,
    prog: null,
    cfg: null,
    theme: null,
    inv: 0,
    mdeg: 0,
    cadence: 0,
    bedTarget: 0,
    lastPad: null,
    cadenceMel: false,
    tension: 0,
    depth: 0,
    bedRoot: 33,
    recent: [],
  };
}

/* ── the score: scheduling ────────────────────────────────────────────────*/

/* Chords first, then melody, because a phrase snaps its first note to the chord
 * that will be sounding underneath it and therefore has to be able to look that
 * chord up. The guards are for the offline rig, which asks for ten minutes in
 * one call; in the game each pump does at most one of each. */
function pump(horizon: number) {
  if (!sn || !q || !q.cfg) return;
  let guard = 4000;
  while (q.chordT < horizon && guard-- > 0) scheduleChord();
  guard = 4000;
  while (q.melT < horizon && guard-- > 0) schedulePhrase();
}

/* Stack scale thirds. Degrees run off the end of the scale on purpose — the
 * modulo wraps the pitch class and the floor adds the octave, which is what
 * makes a triad on the sixth degree voice upward instead of collapsing. */
function stack(sc: number[], d: number, count: number) {
  const L = sc.length;
  const outv = [];
  for (let i = 0; i < count; i++) {
    const g = d + i * 2;
    outv.push(sc[((g % L) + L) % L] + 12 * Math.floor(g / L));
  }
  return outv;
}

function scheduleChord() {
  /* Only ever called from pump(), which has already established all three.
   * Restated here because a guard in the caller narrows nothing in the callee. */
  if (!sn || !q || !q.cfg) return;
  const cfg = q.cfg;
  const sc = SCALES[cfg.scale];
  const t0 = q.chordT;
  const ten = q.tension;

  /* Harmonic rhythm tightens as the air goes. Eleven seconds a chord when there
   * is air, under seven when there is not — slow enough either way that the
   * player never hears a "beat", fast enough that the difference is felt as
   * something closing in. */
  let bar = (11 - 4.2 * ten) * (0.9 + q.rnd() * 0.22);

  let deg;
  const cadencing = q.cadence > 0;
  if (q.cadence === 2) {
    // Penultimate: the fifth degree. In whole tone and locrian this is not a
    // dominant and will not resolve, which is the honest answer for those two.
    deg = 4 % sc.length;
    bar = 3.2;
    q.cadence = 1;
  } else if (q.cadence === 1) {
    deg = 0;
    bar = 9;
    q.cadence = 0;
  } else {
    // set() installs a progression the moment it installs a cfg, and this is
    // only reached with a cfg, so the two are never out of step.
    const prog = q.prog ?? [0];
    deg = prog[q.step % prog.length];
    q.step++;
  }

  const root = sc[((deg % sc.length) + sc.length) % sc.length];
  let notes = stack(sc, deg, 3);

  /* THE HARMONY TIGHTENS WITH THE AIR. A fourth tone, sitting a deliberately
   * awkward interval above the chord root, fades in as tension rises — always
   * present in basalt, never in a calm topsoil. It is one note and it changes
   * the entire colour of the bar, which is the cheapest dramatic lever in the
   * whole module. A cadence chord never gets one: the whole job of those two
   * bars is to sound like an answer. */
  const sour = ten * 0.85 + (cfg.tense <= 8 ? 0.3 : 0);
  if (!cadencing && q.rnd() < sour) notes = notes.concat([root + cfg.tense]);

  // Inversion walk. The same chord twice in a run should not be the same voicing
  // twice; rotating the bottom note up an octave is the smallest change that
  // makes a repeat sound like a development.
  q.inv = (q.inv + (q.rnd() < 0.55 ? 1 : 0)) % 3;
  const voiced = notes.slice();
  for (let i = 0; i < q.inv && i < voiced.length; i++) voiced[i] += 12;
  voiced.sort((a, b) => a - b);

  /* Pads sit an octave under the melody and two above the drone, so the three
   * layers occupy three registers and none of them masks another. Following the
   * bed's depth sag keeps the score in tune with the drone as it sinks; the sag
   * is continuous and the score steps with it once a bar, which is a few cents
   * of drift inside a chord and inaudible. */
  const base = q.bedRoot + 12 - q.depth * 2;
  const bank = (q.chordN % 2) * 4;
  const peak = 0.052 * (0.85 + 0.25 * ten);

  if (!ok('chord', t0, bar, base, peak, ten)) return;
  for (let i = 0; i < voiced.length && i < 4; i++) {
    const v = sn.pad[bank + i];
    const f = mtof(base + voiced[i]);
    if (!ok('chord voice', f)) continue;
    v.o.frequency.setValueAtTime(f, t0);
    // Brightness is the biome's, opened a little by tension. A dark pad under a
    // bright melody is what keeps the chord from competing with the line.
    v.lp.frequency.setValueAtTime(clamp(f * (2.4 + 2.0 * cfg.hue) * (0.85 + 0.5 * ten), 90, 6000), t0);
    padEnv(v.g.gain, t0, peak, bar);
    if (trace) trace.push({ t: t0, m: base + voiced[i], d: bar * 0.98, k: 'p', v: peak });
  }

  q.lastPad = { bank, count: Math.min(voiced.length, 4), peak };
  q.recent.push({ t: t0, root, notes, base });
  if (q.recent.length > 6) q.recent.shift();
  q.chordN++;
  q.chordT = t0 + bar;
}

/* Long in, held, long out, and finished before the bank is needed again. The
 * release is exponential because a linear fade on a sustained pad is audible as
 * a fade; the swell is linear because an exponential attack from EPS spends
 * most of its length inaudible and then arrives all at once. */
function padEnv(p: AudioParam, t0: number, peak: number, bar: number) {
  if (!ok('pad envelope', t0, peak, bar)) return;
  const a = bar * 0.34, hold = bar * 0.22, r = bar * 0.42;
  p.cancelScheduledValues(t0);
  p.setValueAtTime(EPS, t0);
  p.linearRampToValueAtTime(peak, t0 + a);
  p.setValueAtTime(peak, t0 + a + hold);
  p.exponentialRampToValueAtTime(EPS, t0 + a + hold + r);
  p.setValueAtTime(0, t0 + a + hold + r + 0.005);
}

function chordAt(t: number) {
  if (!q || !q.cfg) return null;
  let best = null;
  for (const c of q.recent) if (c.t <= t + 0.001 && (!best || c.t > best.t)) best = c;
  return best || q.recent[0] || null;
}

function schedulePhrase() {
  if (!sn || !q || !q.cfg) return;
  const cfg = q.cfg;
  const sc = SCALES[cfg.scale];
  const ten = q.tension;
  let t = q.melT;

  const c = chordAt(t);
  if (!c) { q.melT = t + 2; return; }

  /* Two to five notes. Five is already a long sentence for something that has
   * to bear an hour of listening; the cadence figure is allowed one more. */
  const cadencing = q.cadence > 0 || q.cadenceMel;
  q.cadenceMel = false;
  const count = cadencing ? 4 : 2 + Math.floor(q.rnd() * 4);
  /* Slow. The piano roll is what settled this: at a third of a second a note
   * the phrases drew as vertical specks, which is what they sounded like too —
   * a figure being flicked off rather than a line being sung. Nearly a second a
   * note over four notes is a phrase you can follow, and it is the difference
   * between a melodic voice and an arpeggio. */
  const step = 0.38 + q.rnd() * 0.5;

  /* Start on a chord tone. The line can wander after that — the wandering is
   * what stops it sounding quantised — but landing off the chord on the first
   * note of a phrase reads as a mistake rather than as colour. */
  const tones = c.notes.map((x) => ((x % 12) + 12) % 12);
  let deg = q.mdeg;
  for (let i = 0; i < sc.length * 2; i++) {
    if (tones.indexOf(sc[(deg + i) % sc.length]) >= 0) { deg += i; break; }
  }

  /* Register falls with depth: the top of the shaft sings, the bottom mutters.
   * Melody lives a fifth to two octaves over the pads. */
  const base = q.bedRoot + 24 - q.depth * 2 - Math.round(q.depth * 5);

  for (let i = 0; i < count; i++) {
    const L = sc.length;
    const midi = base + sc[((deg % L) + L) % L] + 12 * Math.floor(deg / L);
    // Notes overlap their neighbour slightly and the last one hangs. Capped
    // under 4 x step so the round-robin never has to retune a sounding voice.
    const dur = Math.min(1.9, step * (i === count - 1 ? 2.8 : 1.9));
    // The last note of a phrase leans slightly louder, which is what makes a
    // phrase sound ended rather than interrupted.
    const peak = 0.10 * cfg.mel * (i === count - 1 ? 1.1 : 0.82 + q.rnd() * 0.3);
    note(t, midi, dur, peak, ten);
    t += step * (q.rnd() < 0.22 ? 2 : 1);

    // Random walk, weighted to steps over leaps and biased to fall as it goes.
    const r = q.rnd();
    if (cadencing) deg += (i < count - 1 ? 1 : -1);
    else if (r < 0.34) deg += 1;
    else if (r < 0.62) deg -= 1;
    else if (r < 0.76) deg += 2;
    else if (r < 0.88) deg -= 2;
    else deg += q.rnd() < 0.5 ? 3 : -3;
    if (deg > 11) deg -= 7;
    if (deg < -2) deg += 7;
  }
  q.mdeg = deg;

  /* THE REST IS THE POINT. Six to twenty seconds of nothing, per biome, cut by
   * up to 45% as the air runs out — so the line crowds in as things get bad and
   * leaves you alone when they are not. The floor of 2.6 s exists because
   * anything shorter stops reading as a rest and starts reading as a longer
   * phrase with a gap in it. */
  const rest = (cfg.rest[0] + q.rnd() * (cfg.rest[1] - cfg.rest[0])) * (1 - 0.45 * ten);
  q.melT = t + Math.max(2.6, rest);
}

/* Round-robin over the pool, preferring a voice that has actually finished. The
 * pool is sized so this never has to steal in practice; the fallback exists so
 * that if it ever did, it takes the oldest rather than whichever index we were
 * on, which is the difference between a dropped note and a click. */
function note(t: number, midi: number, dur: number, peak: number, ten: number) {
  if (!sn || !q) return;
  let idx = 0, oldest = Infinity;
  for (let i = 0; i < sn.mel.length; i++) {
    if (sn.melFree[i] <= t) { idx = i; oldest = -Infinity; break; }
    if (sn.melFree[i] < oldest) { oldest = sn.melFree[i]; idx = i; }
  }
  const v = sn.mel[idx];
  const f = mtof(midi);
  if (!ok('note', t, dur, peak, ten, f)) return;
  // Set while the gain is at zero. This is the entire reason for the pool: a
  // frequency step on a silent oscillator is free, on a sounding one it is a
  // glitch.
  v.o.frequency.setValueAtTime(f, t);
  v.lp.frequency.setValueAtTime(clamp(f * (2.6 + 2.4 * ten), 200, 7000), t);

  // Soft attack, and softer the calmer it is. A hard attack up here would read
  // as an alert, and there are three of those already.
  const a = 0.045 + 0.10 * (1 - ten);
  const p = v.g.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(EPS, t + dur);
  p.setValueAtTime(0, t + dur + 0.004);
  sn.melFree[idx] = t + dur + 0.01;
  if (trace) trace.push({ t, m: midi, d: dur, k: 'm', v: peak });
}

/* ── level clear ──────────────────────────────────────────────────────────
 *
 * Called from audio.js when the levelclear jingle fires, so app.js needs to
 * know nothing about it: the same engine event that pays the player drives the
 * harmony. Whatever the progression was doing is abandoned, the pads are faded
 * over half a second, and the next two chords are a cadence with a rising
 * melodic figure over them. In topsoil that is a real V–I and it lands; in
 * whole-tone crystal there is no dominant to be had and it deliberately does
 * not, which is the correct amount of reward for surviving a crystal seam.
 *
 * `at` is for the offline rig only. In the game the cadence starts now, because
 * now is when the level was cleared. */
export function resolve(at?: number) {
  if (!attached || !sn || !q) return;
  const t = (at == null ? ctx.currentTime : at) + 0.02;
  for (const v of sn.pad) {
    const p = v.g.gain;
    try {
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
      else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
      p.linearRampToValueAtTime(0, t + 0.5);
    } catch { /* param already released */ }
  }
  q.cadence = 2;
  q.cadenceMel = true;
  q.chordN++;                 // force the other bank, the current one is fading
  q.chordT = t + 0.55;
  q.melT = t + 0.9;
  pump(Math.max(ctx.currentTime, t) + LOOKAHEAD);
}

/* ── stop / restore ───────────────────────────────────────────────────────*/

/** Fade out and release every node. Called on mute and on teardown. */
export function stop(fade?: number) {
  if (!attached) return;
  const t = ctx.currentTime;
  const f = fade == null ? 0.6 : fade;

  if (n) {
    ramp(n.bed.gain, 0.0001, f, t);
    const dead = n;
    n = null;
    const sources = [dead.a, dead.b, dead.sub, dead.lfoF, dead.lfoA, dead.wind];
    for (const src of sources) {
      try { src.stop(t + f + 0.05); } catch { /* already stopped */ }
    }
  }
  if (sn) {
    ramp(sn.bus.gain, 0.0001, f, t);
    const dead = sn;
    sn = null;
    q = null;
    for (const v of dead.pad.concat(dead.mel)) {
      try { v.o.stop(t + f + 0.05); } catch { /* already stopped */ }
    }
  }
  // Nothing disconnects here: the nodes free themselves once their sources
  // have ended, and disconnecting mid-fade would cut the tail.
}

/* Rebuild the bed and the score with the last settings, for coming back from
 * mute. The run seed is deliberately NOT redrawn — a player who muted to take a
 * phone call should come back to the same piece. */
export function restore() { if (want) set(Object.assign({}, want, { fade: 1.5 })); }

export function running() { return !!n; }

/* ── test hooks ───────────────────────────────────────────────────────────*/

/* Absolute context time, not a duration. tests/audio.mjs uses this to commit
 * ten minutes of score into an OfflineAudioContext in one call — and, because
 * scheduling costs nothing whether or not the render is long enough to reach
 * it, to read the note log out of a 0.2 s render. */
export function _scheduleUntil(t: number) { pump(t); }

/** Turn the note log on (and clear it) or off. Off in the game, always. */
export function _trace(on: boolean) { trace = on ? [] : null; return trace; }
export function _traceData() { return trace || []; }

/** What the score decided, for the report. */
export function _info() {
  if (!q) return null;
  return {
    theme: q.theme, seed: q.seed, scale: q.cfg && q.cfg.scale,
    prog: q.prog, tense: q.cfg && q.cfg.tense, rest: q.cfg && q.cfg.rest,
  };
}

/** Force a specific run seed so the rig can compare two runs. */
export function _seed(v: number) { runSeed = v >>> 0; if (q) q = newScore(attached ? ctx.currentTime : 0, runSeed); }

/* Test-only: bring the score to full level AT currentTime, as if it had been
 * playing for a minute already.
 *
 * The rig needs this and there is no way to fake it from outside. The worst-
 * case burst has to be measured at t=0, because an AudioParam ramp scheduled at
 * currentTime does not get its attack — offline OR live, since in a live
 * context currentTime is the start of the last-rendered quantum and therefore
 * already in the past. That is why a burst at t=0 measures 0.93 and the same
 * burst at t=10 measures 0.61: the delayed one was met by a duck that had
 * already faded in. t=0 is the honest number, and it is the one the mixer's
 * contract is written against.
 *
 * But a score at t=0 is at the bottom of its fade and its first chord is at the
 * bottom of a swell, so "burst at t=0 with music playing" would be measuring no
 * music at all. This pins the bed, the score bus and the sounding bank of pads
 * at full level from now, which is the alignment the assertion is about.
 *
 * `part` solos one half: 'bed' for the drone that was already shipping, 'score'
 * for what this module added. The rig needs the split to attribute the cost of
 * the alert margin honestly — the drone has been on that bus the whole time and
 * was never in the burst measurement, so a raw before/after comparison would
 * bill the score for both. */
export function _prime(part: string) {
  if (!attached || !sn || !q || !q.cfg) return;
  const t = ctx.currentTime;
  if (n && q.bedTarget != null) {
    n.bed.gain.cancelScheduledValues(t);
    n.bed.gain.setValueAtTime(part === 'score' ? 0 : q.bedTarget, t);
  }
  sn.bus.gain.cancelScheduledValues(t);
  sn.bus.gain.setValueAtTime(part === 'bed' ? 0 : 1, t);
  q.chordT = t;
  q.melT = t;
  pump(t + LOOKAHEAD);
  const lp = q.lastPad;
  if (!lp) return;
  for (let i = 0; i < lp.count; i++) {
    const p = sn.pad[lp.bank + i].g.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(lp.peak, t);
  }
}
