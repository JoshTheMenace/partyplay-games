/* Animation clocks.
 *
 * THESE LIVE IN THE VIEW, NOT THE ENGINE, and that is a decision rather than a
 * convenience. Four reasons, in order of weight:
 *
 *  1. Animation must run at RENDER rate. loop.js steps the simulation at
 *     exactly 1/60 and hands the view an interpolation alpha precisely so a
 *     120 Hz panel looks smooth. An engine-side frame counter advances in whole
 *     1/60 steps and would stutter at the exact place interpolation exists to
 *     prevent stutter.
 *  2. Animation must run when the simulation does NOT. step() returns
 *     immediately for 'title', 'gameover' and 'paused'. The animated camp
 *     behind the menu, idle breathing on the title card and the drill-down dust
 *     all need a clock that keeps going. Engine counters freeze.
 *  3. Hit-stop must not touch the timestep. Implemented via loop.setPaused() it
 *     would reset the accumulator and silently drop simulated time — invisible
 *     in play, fatal to `?seed=` reproduction and to the harness's "exactly N
 *     steps" contract. Hit-stop is render-only. See hold() below.
 *  4. Every field on `state` is a field the determinism story has to carry.
 *     Animation phase provably cannot affect outcomes, so putting it there
 *     widens the reproducibility surface for nothing.
 *
 * The one thing the engine does provide is a stable `id` per entity, which is
 * what a track can be keyed on across a frame.
 *
 * ── walk cycles are driven by DISTANCE, not by time ───────────────────────
 *
 * A time-driven walk cycle foot-slides the moment anything changes speed, and
 * this game changes speed constantly: SPEED_DIG is 5.0 against SPEED_TUNNEL's
 * 8.0, BOOTS and the relics move both, and every monster kind carries its own
 * speedMul. Driving the cycle off distance travelled makes all of that read for
 * free — a Warden at half speed plants its feet half as often, and buying BOOTS
 * visibly speeds the player's legs up rather than just teleporting them faster.
 *
 * ONE CYCLE PER LANE, i.e. per 2 fine cells. That constant is not arbitrary:
 * every actor in this game is 2x2 fine cells and moves between lane nodes 2
 * cells apart, so a cycle per lane means feet land on lane boundaries. It also
 * happens to reproduce the authored `fps` almost exactly at each kind's own
 * speed — pooka 4.6 c/s over 4 frames is 9.2 fps against an authored 9, mite
 * 7.36 is 14.7 against 16, warden 2.3 is 4.6 against 5 — which is the strongest
 * evidence available that the sheet was drawn against this rule.
 *
 * Non-walk clips (pop, windup, ghost, jet) are time-driven at the authored fps,
 * because none of them are locomotion.
 */

import { CLIPS } from './sprites';

/* Anything the animation layer can drive. Deliberately loose: it is handed
 * diggers, monsters, rocks and wheels, and reads only what each happens to
 * carry. `suit` is the cosmetic a digger wears; nothing else has one. */
export type Drawable = {
  id?: number;
  x?: number;
  y?: number;
  kind?: string;
  variant?: string | null;
  dir?: number;
  dying?: boolean;
  digging?: boolean;
  moving?: boolean;
  mode?: string;
  pump?: number;
  telegraph?: number;
  hunting?: boolean;
  suit?: string | null;
  downed?: boolean;
};

/** Per-frame context the caller knows and the entity does not. */
export type ClipCtx = {
  firing?: boolean;
  jetting?: boolean;
  alpha?: number;
  /** 0..1 driven by the simulation rather than a timer — an inflate clip is
   *  the pump count, or the sprite disagrees with how many have landed. */
  phase?: number | null;
};

/** One entity's animation state, kept between frames and keyed by its id. */
type Track = {
  clip: string | null;
  /** Seconds into the clip, and the distance walked since the last frame. */
  t: number;
  d: number;
  /** Last known position, for measuring that distance. */
  hx: number | null;
  hy: number | null;
  /** Squash impulse and its remaining life. */
  sq: number;
  sqT: number;
  /** The frame number this was last drawn on; stale tracks are dropped. */
  seen: number;
};

/* Fine cells per full walk cycle. See the header. */
const CYCLE_CELLS = 2;

/* Squash-and-stretch: a damped cosine, applied about the sprite CENTRE so a
 * pop or a landing bulges in place rather than sliding off its own feet. */
const SQ_DECAY = 9;
const SQ_FREQ = 34;          // rad/s — a little under 5.5 Hz
const SQ_LIFE = 0.55;
const SQ_TRANSITION = 0.10;  // impulse on any change of clip
const SQ_MAX = 0.34;

/* Past 60 ms the lag on the primary verb becomes perceptible. */
const HOLD_MAX = 0.06;

const DIRC = ['U', 'R', 'D', 'L'];
const hdir = (d: number) => (d === 3 ? 'L' : 'R');

/* Which clip a kind dies on. Every kind has one and they are not all the same
 * verb — a Mite is squashed, a Warden breaks, a Geode shatters and a Sapper
 * detonates — so this is a table rather than a suffix.
 *
 * EVERY kind must appear here. A missing row does not degrade, it resolves to
 * null and drops the monster onto the procedural silhouette for the whole death
 * — so it visibly stops being made of sheet art at the exact moment the player
 * is looking at it. The Shark and the Mole shipped missing and their perfectly
 * good `shark.pop`/`mole.pop` rows sat in the atlas unreachable. */
const DEATH: Readonly<Record<string, string>> = {
  pooka: 'pooka.pop', fygar: 'fygar.pop', grub: 'grub.pop',
  mite: 'mite.squash', sapper: 'sapper.boom', warden: 'warden.break',
  geode: 'geode.shatter', shark: 'shark.pop', mole: 'mole.pop',
};

/* What a kind does while the harpoon is in it. Most inflate; a Sapper primes
 * (which is what it is actually doing) and a Geode cracks — reachable only with
 * the Barbed Head relic, which is the one thing that gets past harpoonImmune.
 *
 * Same completeness rule as DEATH above, and the same two kinds were missing. */
const INFLATE: Readonly<Record<string, string>> = {
  pooka: 'pooka.inflate', fygar: 'fygar.inflate', warden: 'warden.inflate',
  sapper: 'sapper.prime', geode: 'geode.crack', grub: 'grub.lunge',
  mite: 'mite.squash', shark: 'shark.inflate', mole: 'mole.inflate',
};

/* id -> track */
const tracks = new Map<number, Track>();
let frameNo = 0;
let holdT = 0;
let heldAlpha = -1;
let dtNow = 0;          // this frame's advance; zero while held
const EMPTY = {};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
function has(name: string | null | undefined) { return !!(name && CLIPS[name]); }
/* First candidate the sheet actually has, VARIADIC.
 *
 * It used to take exactly (a, b) while every caller passed three — variant,
 * then kind, then a last-resort like 'pooka.pop'. The third was silently
 * dropped, so the fallback chain the callers were written against stopped one
 * link early and a kind missing from DEATH/INFLATE returned null instead of
 * degrading to the Pooka art. Two bugs had to line up for that to show, which
 * is exactly why it survived. */
function pick(...names: (string | null | undefined)[]) {
  for (const n of names) if (has(n)) return n;
  return null;
}

/* Which clip an entity should be playing.
 *
 * A PURE FUNCTION of engine state — mode, dir, moving, pump, dying, telegraph.
 * Because the clip carries no memory the engine does not already have, it can
 * never desync from the simulation. Keep it that way.
 *
 * `ctx` carries the two facts that live on `state` rather than on the entity —
 * whether the harpoon is out, and whether a Fygar's fire is currently alight —
 * and nothing else. They are read off engine state by the caller, so this stays
 * a pure function of the simulation. */
export function clipFor(entity: Drawable, ctx: ClipCtx = {}) {
  if (!entity) return null;
  const c = ctx || EMPTY;
  return entity.kind === undefined ? playerClip(entity, c) : monsterClip(entity, c);
}

/* The worn suit comes off the DIGGER, not off this module.
 *
 * Upstream kept it module-level because exactly one player existed and
 * threading a cosmetic down four call layers was ceremony. A crew makes that
 * wrong: one module-level suit would put four diggers in the same costume. It
 * is still a cosmetic and still cannot reach the simulation — it just travels
 * on the entity that wears it. */
function playerClip(p: Drawable, c: ClipCtx) {
  const skin = p.suit ?? null;
  /* Skin first, default suit second — the same three-level fallback the monster
   * variants use, and for the same reason. A skin whose sheet is missing a
   * single clip must fall back to the default for THAT clip rather than
   * disappear, or the player visibly changes costume mid-death-animation. */
  const s = skin ? 'player.' + skin + '.' : null;
  const spick = (suffix: string, ...rest: (string | null | undefined)[]) => pick(
    s ? s + suffix : null, 'player.' + suffix, ...rest);

  if (p.dying) return spick('death');
  /* Down is two clips. 'down' is a one-shot that ends flat on the floor; the
   * caller switches to 'inflate' once it has played or the first pump lands,
   * passing banked pumps as the phase so the suit swells pump by pump and sags
   * back if the line comes off. Their shared frames make the handover seamless. */
  if (p.downed) {
    const h = hdir(p.dir ?? 1);
    return c.phase === null || c.phase === undefined
      ? spick('down.' + h, 'player.walk.' + h) : spick('inflate.' + h, 'player.walk.' + h);
  }
  const d = DIRC[(p.dir ?? 2) & 3];
  if (c.firing) return spick('fire.' + d, 'player.walk.' + d);
  if (p.digging) return spick('dig.' + d, 'player.walk.' + d);
  return spick('walk.' + d);
}

function monsterClip(m: Drawable, c: ClipCtx) {
  const k = m.kind || 'pooka';
  /* Three levels of fallback, and the order is the point.
   *
   * A monster now carries a VARIANT — an azure Pooka, an ember Fygar — which is
   * a row of stat overrides on its base kind. The art generator emits tinted
   * sheets at `<kind>.<variant>.<clip>` for whichever subset it can afford, so
   * the resolution has to try the variant, then the plain kind, then pooka.
   *
   * Falling straight through to the base kind is the CORRECT degradation and
   * not a stopgap: an azure Pooka drawn as a plain Pooka is a monster with the
   * wrong tint, where an azure Pooka drawn as nothing is a monster that hits
   * you from empty space. The variant sheet is allowed to be partial. */
  const v = m.variant ? k + '.' + m.variant + '.' : null;
  const vpick = (suffix: string, ...rest: (string | null | undefined)[]) => pick(
    v ? v + suffix : null, k + '.' + suffix, ...rest);

  const d = hdir(m.dir ?? 1);
  const walk = vpick('walk.' + d, 'pooka.walk.' + d);

  if (m.dying || m.mode === 'dying') {
    return pick(v ? v + tail(DEATH[k]) : null, DEATH[k], 'pooka.pop');
  }
  /* 'ghostwind' deliberately keeps the SOLID clip: during the wind-up it is
   * still tangible and still killable, and swapping to the ghost shape early
   * would say otherwise. The engine pulses m.alpha; that is the whole tell. */
  if (m.mode === 'ghost') return vpick('ghost', 'ghost');
  if ((m.pump ?? 0) > 0 || m.mode === 'pumped') {
    return pick(v ? v + tail(INFLATE[k]) : null, INFLATE[k], walk);
  }
  /* Breathing HOLDS the rear-up pose. It must not select the 'jet' clip.
   *
   * `fygar.jet*` is a horizontal band of FLAME, drawn by the generator to be
   * repeated along a corridor — it is not a pose of the animal. Handing it to
   * an actor draw turned the Fygar itself into a 32px tile of fire for as long
   * as its jet was alive, so the monster vanished and a swirling vortex stood
   * where it had been. It went unnoticed for a long time because the old jet
   * only lived 0.55s and a Fygar usually charges straight down its own flame;
   * lengthening the fire to make it dodgeable is what made it visible.
   *
   * `windup` is the right clip and it costs nothing to reuse: it does not loop,
   * so anim holds its final frame — fully reared, mouth open — which is exactly
   * the pose to stay in while the fire is out. It is also already the clip
   * playing during the telegraph, so the track simply continues instead of
   * cutting. The flame itself is drawn by entities.drawFire().
   *
   * DIRECTIONAL, since the atlas grew windup.L/.R. It was one non-directional
   * row for a long time and selected here with no direction at all, so a Fygar
   * breathing west reared to face EAST and then breathed backwards past its own
   * tail. Nobody reported it, which is its own lesson: the wind-up is 0.9s and
   * the flame that follows is unmistakable, so the eye reads the fire and
   * forgives the animal. The Emberfin Shark is what forced it — a new
   * firebreather would have inherited the same bug on day one. */
  if (c.jetting || (m.telegraph ?? 0) > 0) return vpick('windup.' + d, walk);
  /* A digger cutting fresh ground. `digging` is set by monsters.js only on the
   * frames carve() actually bit, so crossing a tunnel it already opened walks.
   *
   * RIGHT-FACING ONLY, and that is the sheet's shape rather than a preference.
   * The generator emits one `mole.dig` cycle with no .L/.R split — unlike the
   * player, which has dig.U/D/L/R — and nothing in actor() mirrors a frame
   * horizontally, because every directional row on this sheet is drawn twice
   * instead. Handing that single right-facing cycle to a mole walking west
   * turns it around mid-tunnel, which is a worse bug than the one being fixed:
   * these clips were unreachable before because nothing set `digging` at all.
   *
   * So a westward mole keeps its walk cycle. The real fix is an L row from the
   * generator, at which point this becomes vpick('dig.' + d, walk). */
  if (m.digging && d === 'R') return vpick('dig', walk);
  if (k === 'geode') return vpick('idle', walk);
  // A Grub does not walk at you, it lunges. Its chase pose is a held clip.
  if (k === 'grub' && (m.hunting || m.mode === 'chase')) return vpick('lunge', walk);
  return walk;
}

/* The clip name past its kind prefix — 'pooka.pop' -> 'pop' — so a variant can
 * reuse the DEATH and INFLATE tables rather than duplicating them per tint. */
function tail(name: string) {
  if (!name) return '';
  const i = name.indexOf('.');
  return i < 0 ? name : name.slice(i + 1);
}

function trackFor(id: number) {
  let t = tracks.get(id);
  if (!t) {
    t = { clip: null, t: 0, d: 0, hx: null, hy: null, sq: 0, sqT: 0, seen: -1 };
    tracks.set(id, t);
  }
  return t as Track;
}

/* Advance every track by real elapsed time and drop anything not seen for two
 * frames — which handles a level change, a death and a pop for free, without
 * anyone having to remember to clear the map. */
export function tick(dt: number) {
  const d = dt > 0 ? Math.min(dt, 0.1) : 0;
  if (holdT > 0) {
    holdT -= d;
    if (holdT < 0) holdT = 0;
    dtNow = 0;              // hit-stop freezes the ANIMATION, never the loop
  } else {
    dtNow = d;
    heldAlpha = -1;
  }

  for (const [id, t] of tracks) {
    if (t.seen < frameNo - 1) tracks.delete(id);
  }
  frameNo++;
}

/* The frame to blit, plus the squash-and-stretch to apply about its centre.
 *
 * Returns null when the sheet has no clip for this entity, which is the signal
 * for the caller to take its procedural path. Never throws on a kind the sheet
 * has never heard of. */
export function frame(entity: Drawable, ctx: ClipCtx = {}) {
  if (!entity) return null;
  const c = ctx || EMPTY;
  const name = clipFor(entity, c);
  const tr = trackFor(entity.id === undefined ? -1 : entity.id);
  tr.seen = frameNo;

  /* Distance travelled since the last render, in fine cells. Read off the
   * simulation's own x/y rather than the interpolated position: interpolation
   * is a presentation detail and feeding it back in here would make the cycle
   * jitter with the alpha. */
  let dist = 0;
  const ex = entity.x ?? 0, ey = entity.y ?? 0;
  if (tr.hx !== null && tr.hy !== null) dist = Math.abs(ex - tr.hx) + Math.abs(ey - tr.hy);
  tr.hx = ex; tr.hy = ey;
  // A rematerialising ghost and a level change both TELEPORT. Counting that as
  // walking would spin the legs through several cycles in one frame.
  if (!(dist >= 0) || dist > 4) dist = 0;
  if (dtNow === 0) dist = 0;

  if (name !== tr.clip) {
    tr.clip = name ?? null;
    tr.t = 0;
    tr.d = 0;
    impulse(tr, SQ_TRANSITION);
  }

  let s = 0;
  if (tr.sq !== 0) {
    tr.sqT += dtNow;
    if (tr.sqT >= SQ_LIFE) tr.sq = 0;
    else s = tr.sq * Math.exp(-SQ_DECAY * tr.sqT) * Math.cos(SQ_FREQ * tr.sqT);
  }
  const sq = clamp(s, -SQ_MAX, SQ_MAX);

  const clip = name ? CLIPS[name] : null;
  if (!clip) return null;

  const n = clip.frames.length;
  let i;
  if (c.phase !== undefined && c.phase !== null) {
    // Driven by the simulation itself — an inflate clip is the pump count, not
    // a timer, or the sprite would disagree with how many pumps have landed.
    i = clamp(Math.round(c.phase * (n - 1)), 0, n - 1);
  } else if (name!.indexOf('.walk.') >= 0) {
    tr.d += dist;
    i = Math.floor((tr.d / CYCLE_CELLS) * n) % n;
    if (i < 0) i += n;
  } else {
    tr.t += dtNow;
    const f = Math.floor(tr.t * (clip.fps || 12));
    i = clip.loop ? ((f % n) + n) % n : clamp(f, 0, n - 1);
  }

  return { name: clip.frames[i], sx: 1 - sq, sy: 1 + sq, index: i, last: i === n - 1 };
}

function impulse(tr: Track, amount: number) {
  const a = Math.max(Math.abs(tr.sq), Math.abs(amount));
  tr.sq = a;
  tr.sqT = 0;
}

/* A hit, a landing, a pop. Bulges the sprite about its centre without touching
 * anything the simulation can see. */
export function impact(entity: Drawable, amount: number) {
  if (!entity) return;
  impulse(trackFor(entity.id === undefined ? -1 : entity.id),
          clamp(amount || 0.2, 0, SQ_MAX));
}

/* Render-time freeze on impact. Holds interpolation and suppresses camera
 * smoothing; never pauses the loop. 60 ms is the ceiling — past that the lag on
 * the primary verb becomes perceptible. */
export function hold(seconds: number) {
  holdT = Math.max(holdT, Math.min(HOLD_MAX, seconds || 0));
}

export function holding() { return holdT > 0; }

/* Interpolation alpha, frozen for the duration of a hold.
 *
 * Freezing at 0 instead would snap every actor back to its previous simulated
 * position for the length of the stop, which reads as a stutter rather than as
 * an impact. Latching the alpha the stop began on holds everything exactly
 * where it was when the hit landed. */
export function lerpAlpha(alpha: number) {
  if (holdT > 0) {
    if (heldAlpha < 0) heldAlpha = alpha;
    return heldAlpha;
  }
  return alpha;
}

export function reset() {
  tracks.clear();
  holdT = 0;
  heldAlpha = -1;
  dtNow = 0;
}

export function count() { return tracks.size; }

export function clips() { return CLIPS; }
