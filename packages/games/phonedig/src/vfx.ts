/* Effects that are not simulation: sprite-backed particle emitters, decals,
 * shockwaves, screen-space flashes.
 *
 * Distinct from state.particles, which the ENGINE owns because those affect
 * nothing but must stay deterministic for replay. Anything in here is free to
 * use real time and may be dropped entirely on a slow frame without changing
 * the game.
 *
 * ── one table, keyed by event name ────────────────────────────────────────
 *
 * The same arrangement audio.js has with VOICES, and for the same reason: the
 * mapping from "what happened" to "what it looks like" has to be readable in
 * one place or it ends up smeared across the renderer as a dozen `if` branches
 * that nobody can audit against the event list. `emit(type, x, y, value)` takes
 * exactly what world.js's emit() produced, so adding a look to a new event is
 * one row here and nothing anywhere else.
 *
 * ── it is deterministic anyway ────────────────────────────────────────────
 *
 * Nothing here can affect play, so it does not have to be reproducible — but
 * tests/shots.html diffs two capture runs byte-for-byte, and a puff of smoke
 * seeded off Math.random makes every shot differ from every other shot and
 * throws the whole visual diff away. So it runs on its own xorshift, reseeded
 * from reset(), and takes its time from the dt the view hands it (which the
 * harness pins) rather than from a clock of its own.
 */

import * as sprites from './sprites';
import * as anim from './anim';
import type { Ctx, Palette, ViewBox } from './render';

/* Hard ceiling. Effects are the first thing to sacrifice on a slow frame, and
 * an uncapped emitter turns a Sapper chain into a stall. */
const MAX = 260;
let budget = MAX;
/** Lower the live-effect ceiling on a struggling phone. The oldest effects still go first. */
export function setBudget(n: number) { budget = Math.max(1, Math.min(MAX, Math.floor(n))); }

/* One live effect. The four shapes share a record rather than four types
 * because they live in one array and are stepped by one loop; `s` says which
 * fields matter. Optional throughout, since each shape uses a subset. */
type Part = {
  s: 'puff' | 'mote' | 'ring' | 'beam';
  x: number; y: number;
  life: number; max: number;
  a: number;
  vx: number; vy: number;
  clip?: string | null;
  size: number;
  grow: number;
  drag: number;
  colour: string | null;
  g: number;
  glow: boolean;
  /** Ring: current radius, target radius, stroke width. */
  r: number; r1: number; w: number;
  /** Ring: radius this frame, recomputed by tick(). */
  rNow: number;
  /** Beam: the far end. */
  x2: number; y2: number;
};

/** Every shape starts from this, so a field a shape does not use is still a
 *  number rather than undefined at the one place that reads it. */
const BLANK = {
  a: 1, vx: 0, vy: 0, size: 1, grow: 0, drag: 0, colour: null,
  g: 0, glow: false, r: 0, r1: 0, w: 0, rNow: 0, x2: 0, y2: 0,
};

const parts: Part[] = [];
let rngState = 0x9e3779b9;
let flashA = 0, flashR = 0, flashG = 0, flashB = 0;

function rnd() {
  let x = rngState;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  rngState = x;
  return x / 4294967296;
}
const rr = (a: number, b: number) => a + (b - a) * rnd();

export function reset() {
  parts.length = 0;
  rngState = 0x9e3779b9;
  flashA = 0;
}

/* ── the shapes ───────────────────────────────────────────────────────────
 *
 * Four, and no more. Every effect below is one of these with different numbers,
 * which is what keeps tick() and render() to one branch each.
 *
 *   puff   a sprite clip (vfx.dust / vfx.clod / vfx.spark) or a soft disc
 *   mote   a coloured dot with drag and gravity — smoke, grit, embers
 *   ring   an expanding stroked circle: shockwaves, pops, pickups
 *   beam   a fading line: harpoon trail, vent jets
 */

function push(p: Part) {
  while (parts.length >= budget) {
    // Drop the OLDEST, not the newest. A blast that arrives into a full buffer
    // must still be visible; the puff of dig dust it displaces will not be
    // missed by anyone.
    parts.shift();
  }
  parts.push(p);
  return p;
}

function puff(x: number, y: number, clip: string | null, size: number, life: number, opts?: Partial<Part>) {
  const o = opts || {};
  return push({
    ...BLANK, s: 'puff', x, y, clip, size, life, max: life,
    vx: o.vx || 0, vy: o.vy || 0, grow: o.grow || 0,
    a: o.a === undefined ? 1 : o.a, drag: o.drag === undefined ? 2.2 : o.drag,
    colour: o.colour || null,
  });
}

function mote(x: number, y: number, colour: string, size: number, life: number, vx: number, vy: number, opts?: Partial<Part>) {
  const o = opts || {};
  return push({
    ...BLANK, s: 'mote', x, y, colour, size, life, max: life, vx, vy,
    g: o.g === undefined ? 7 : o.g, drag: o.drag === undefined ? 1.4 : o.drag,
    a: o.a === undefined ? 1 : o.a, glow: !!o.glow,
  });
}

function ring(x: number, y: number, colour: string, r0: number, r1: number, life: number, opts?: Partial<Part>) {
  const o = opts || {};
  return push({
    ...BLANK, s: 'ring', x, y, colour, r: r0, r1, life, max: life,
    w: o.w || 0.22, a: o.a === undefined ? 0.9 : o.a, glow: !!o.glow,
  });
}

function beam(x: number, y: number, x2: number, y2: number, colour: string, life: number, w?: number) {
  return push({ ...BLANK, s: 'beam', x, y, x2, y2, colour, life, max: life, w: w || 0.3 });
}

function flash(r: number, g: number, b: number, a: number) {
  if (a <= flashA) return;
  flashA = a; flashR = r; flashG = g; flashB = b;
}

/* Sprite clips, used when the sheet is present and quietly skipped when it is
 * not — the mote/ring shapes carry the effect on their own, which is what makes
 * a cold offline first launch still look like something happened. */
function clipFrame(clip: string, t: number) {
  const c = sprites.ready() ? anim.clips()[clip] : null;
  if (!c) return null;
  const n = c.frames.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
  return c.frames[i];
}

/* ── the table ────────────────────────────────────────────────────────────
 *
 * One row per engine event. `v` is the event's value where it has one.
 * Everything is in FINE CELLS and seconds; nothing here knows about pixels. */
/** One effect, in FINE CELLS and seconds. Nothing here knows about pixels. */
/* `v` is always a magnitude or a direction code here. A few events carry a
 * STRING instead — a crystal's id, a hazard's kind — and none of them has a
 * look keyed off it, so those arrive with v undefined rather than forcing every
 * handler to prove what it was given. */
type FxFn = (x: number, y: number, v?: number) => void;

const FX: Readonly<Record<string, FxFn>> = {
  /* Digging is continuous, so it must stay nearly free — one grain, sometimes a
   * clod. This fires on every carved cell. */
  dig(x, y) {
    if (rnd() < 0.45) {
      puff(x + 1, y + 1, 'vfx.clod', rr(0.7, 1.1), 0.28,
           { vx: rr(-1.4, 1.4), vy: rr(-2.6, -0.6), grow: 0.6, a: 0.75 });
    }
  },

  harpoon(x, y) {
    ring(x, y, 'harpoon', 0.3, 1.5, 0.16, { w: 0.16, a: 0.55 });
  },

  /* Each pump is a beat the player is counting. A tick of grit off the monster
   * and a tight ring so the count is visible as well as audible. */
  pump(x, y, v) {
    ring(x, y, 'text', 1.0, 1.9 + (v || 1) * 0.12, 0.2, { w: 0.14, a: 0.4 });
    for (let i = 0; i < 3; i++) {
      mote(x, y, 'text', rr(0.2, 0.4), rr(0.2, 0.4),
           rr(-3, 3), rr(-4, -1), { a: 0.7 });
    }
  },

  pop(x, y) {
    anim.hold(0.045);
    ring(x, y, 'text', 0.6, 3.4, 0.3, { w: 0.3, a: 0.85 });
    puff(x, y, 'vfx.ring', 3.2, 0.26, { grow: 2.4, a: 0.9 });
    for (let i = 0; i < 9; i++) {
      const a = rr(0, Math.PI * 2);
      mote(x, y, 'text', rr(0.25, 0.5), rr(0.3, 0.6),
           Math.cos(a) * rr(2, 7), Math.sin(a) * rr(2, 7) - 2, { a: 0.8 });
    }
  },

  /* The wind-up. This is the warning the whole fairness argument rests on, so
   * it gets a mark that grows — a static one reads as decoration. */
  telegraph(x, y) {
    ring(x, y, 'danger', 2.6, 1.0, 0.42, { w: 0.2, a: 0.8 });
    for (let i = 0; i < 4; i++) {
      mote(x, y, 'danger', rr(0.2, 0.35), rr(0.25, 0.5),
           rr(-2, 2), rr(-3, 0), { a: 0.8, glow: true, g: 2 });
    }
  },

  fire(x, y) {
    for (let i = 0; i < 7; i++) {
      puff(x, y, 'vfx.dust', rr(1.0, 2.0), rr(0.2, 0.4),
           { vx: rr(-2, 2), vy: rr(-3.5, -0.5), grow: 1.6, a: 0.55, colour: 'fire' });
    }
    flash(255, 140, 43, 0.10);
  },

  /* A Sapper crater. Round and brief — it is a detonation, not breath. */
  blast(x, y, v) {
    const R = v || 3.5;
    anim.hold(0.06);
    flash(255, 190, 120, 0.34);
    ring(x, y, 'fire', R * 0.3, R * 1.5, 0.30, { w: 0.5, a: 1, glow: true });
    ring(x, y, 'text', R * 0.2, R * 1.9, 0.44, { w: 0.22, a: 0.5 });
    puff(x, y, 'vfx.ring', R * 2, 0.24, { grow: R * 1.4, a: 1, colour: 'fire' });
    for (let i = 0; i < 16; i++) {
      const a = rr(0, Math.PI * 2), sp = rr(3, 11);
      mote(x, y, i % 3 ? 'fire' : 'rock', rr(0.3, 0.7), rr(0.35, 0.75),
           Math.cos(a) * sp, Math.sin(a) * sp, { a: 0.9, glow: i % 3 !== 0 });
    }
    for (let i = 0; i < 5; i++) {
      puff(x + rr(-R, R), y + rr(-R, R), 'vfx.dust', rr(2, 3.4), rr(0.4, 0.7),
           { vy: rr(-1.6, -0.4), grow: 2.2, a: 0.5 });
    }
  },

  /* The harpoon coming off a Geode. The clang is the ONLY thing that teaches
   * "not this one, use a rock", so it gets sparks, not a shrug. */
  clang(x, y) {
    anim.hold(0.035);
    for (let i = 0; i < 8; i++) {
      const a = rr(-Math.PI, Math.PI);
      mote(x, y, 'harpoon', rr(0.18, 0.34), rr(0.15, 0.35),
           Math.cos(a) * rr(4, 10), Math.sin(a) * rr(4, 10),
           { a: 1, glow: true, g: 14 });
    }
    puff(x, y, 'vfx.spark', 2.2, 0.18, { grow: 1.2, a: 1, colour: 'harpoon' });
    ring(x, y, 'harpoon', 0.4, 2.2, 0.18, { w: 0.2, a: 0.7, glow: true });
  },

  wobble(x, y) {
    if (rnd() < 0.5) {
      mote(x, y + 1, 'rock', rr(0.2, 0.35), rr(0.3, 0.6), rr(-1, 1), rr(0.5, 2));
    }
  },

  fall(x, y) {
    for (let i = 0; i < 5; i++) {
      mote(x, y, 'rock', rr(0.25, 0.45), rr(0.25, 0.5), rr(-3, 3), rr(-2, 0.5));
    }
  },

  /* A boulder landing. The heaviest single impact in the game — the only one
   * that gets both a hold and a dust sheet. */
  rock(x, y) {
    anim.hold(0.05);
    ring(x, y + 1, 'rock', 0.5, 4.2, 0.3, { w: 0.28, a: 0.7 });
    for (let i = 0; i < 10; i++) {
      const dir = i % 2 ? 1 : -1;
      mote(x + dir * rr(0.3, 1), y + 1, 'rock', rr(0.3, 0.6), rr(0.3, 0.6),
           dir * rr(2, 8), rr(-5, -1));
    }
    for (let i = 0; i < 4; i++) {
      puff(x + rr(-2, 2), y + 1, 'vfx.dust', rr(2, 3), rr(0.35, 0.6),
           { vy: rr(-1.2, -0.3), grow: 2, a: 0.45 });
    }
  },

  ghost(x, y) {
    ring(x, y, 'pooka', 2.4, 0.4, 0.35, { w: 0.24, a: 0.7 });
    for (let i = 0; i < 6; i++) {
      mote(x, y, 'pooka', rr(0.2, 0.4), rr(0.3, 0.6),
           rr(-2, 2), rr(-2, 2), { a: 0.6, g: 0, glow: true });
    }
  },

  /* A shark coming up through the floor.
   *
   * This is the ONLY moment a shark can be harpooned, and it emitted nothing at
   * all — the event was raised and no table had a row for it, so the one beat
   * the whole kind is built around happened in silence with no dirt moved.
   *
   * Deliberately the mirror of `ghost` above: that ring IMPLODES (r0 > r1)
   * because something is going under, this one erupts. Same grammar, opposite
   * sign, so a player who has watched one dive reads the breach without being
   * taught it. The debris throws UPWARD only — it came through the floor, not
   * out of the air — and it is drawn in the shark's own palette entries so the
   * breach reads as this animal rather than as a generic pop. */
  surface(x, y) {
    anim.hold(0.035);
    ring(x, y, 'sharkBelly', 0.4, 4.0, 0.30, { w: 0.32, a: 0.95, glow: true });
    ring(x, y, 'shark', 0.6, 6.4, 0.48, { w: 0.16, a: 0.45 });
    for (let i = 0; i < 10; i++) {
      const a = rr(-Math.PI, 0);                       // upper half only
      mote(x, y, i % 3 ? 'rock' : 'sharkBelly', rr(0.25, 0.5), rr(0.3, 0.6),
           Math.cos(a) * rr(2, 6), Math.sin(a) * rr(3, 8), { a: 0.85 });
    }
    for (let i = 0; i < 4; i++) {
      puff(x + rr(-1.6, 1.6), y, 'vfx.clod', rr(1.4, 2.4), rr(0.3, 0.55),
           { vy: rr(-2.4, -0.8), grow: 1.6, a: 0.7 });
    }
  },

  /* ── the vent's wheel ──
   *
   * Three rows for one hazard, because a travelling threat has three moments
   * and only the middle one is obvious. The wind is what makes it FAIR: it
   * draws the corridor the wheel is about to occupy, 0.9s before it does, so
   * the player is told which way to move rather than merely that something is
   * coming. */
  wheelwind(x, y, v) {
    /* Deliberately vfx-only, no voice. `telegraph` fires on the same frame at
     * the same node and is already the sound; two ticks for one warning is
     * worse than one. This is the exception to "a new event gets a row in both
     * tables", and it is an exception on purpose. */
    const dx = v === 1 ? 1 : v === 3 ? -1 : 0;
    const dy = v === 2 ? 1 : v === 0 ? -1 : 0;
    const L = 10;
    beam(x, y, x + dx * L, y + dy * L, 'fire', 0.55, 0.16);
    for (let i = 0; i < 4; i++) {
      const t = rr(0.2, 1);
      mote(x + dx * L * t, y + dy * L * t, 'fire', rr(0.2, 0.4), rr(0.3, 0.6),
           dx * rr(1, 3), dy * rr(1, 3) - 1, { a: 0.55, g: 2 });
    }
  },

  wheel(x, y, v) {
    const dx = v === 1 ? 1 : v === 3 ? -1 : 0;
    const dy = v === 2 ? 1 : v === 0 ? -1 : 0;
    // Half the flash `fire` uses. Six vents on one level, every five seconds
    // each, is a strobe if this is not restrained.
    flash(255, 140, 43, 0.08);
    ring(x, y, 'fire', 0.4, 2.6, 0.26, { w: 0.28, a: 0.9, glow: true });
    // Sparks thrown BACKWARDS out of the launch, the way a wheel throws grit.
    for (let i = 0; i < 8; i++) {
      mote(x, y, i % 3 ? 'fire' : 'rock', rr(0.25, 0.5), rr(0.3, 0.55),
           -dx * rr(2, 6) + rr(-1.5, 1.5), -dy * rr(2, 6) + rr(-1.5, 1.5),
           { a: 0.85 });
    }
  },

  // It burns out against a wall. A wheel that simply stops existing reads as a
  // dropped frame rather than as an ending.
  wheelout(x, y) {
    for (let i = 0; i < 5; i++) {
      const a = rr(0, Math.PI * 2);
      mote(x, y, 'fire', rr(0.2, 0.45), rr(0.25, 0.5),
           Math.cos(a) * rr(1, 4), Math.sin(a) * rr(1, 4) - 1, { a: 0.7 });
    }
    puff(x, y, 'vfx.dust', rr(1.6, 2.4), 0.4, { vy: -0.8, grow: 1.8, a: 0.4 });
  },

  hunt(x, y) {
    flash(255, 84, 112, 0.16);
    ring(x, y, 'danger', 1.0, 7, 0.6, { w: 0.35, a: 0.9 });
    ring(x, y, 'danger', 1.0, 4.5, 0.45, { w: 0.2, a: 0.6 });
  },

  hurt(x, y) {
    anim.hold(0.055);
    flash(255, 84, 112, 0.4);
    ring(x, y, 'danger', 0.6, 4, 0.28, { w: 0.4, a: 1 });
    for (let i = 0; i < 8; i++) {
      const a = rr(0, Math.PI * 2);
      mote(x, y, 'danger', rr(0.25, 0.5), rr(0.25, 0.5),
           Math.cos(a) * rr(3, 8), Math.sin(a) * rr(3, 8), { a: 0.9, glow: true });
    }
  },

  die(x, y) {
    anim.hold(0.06);
    flash(255, 84, 112, 0.5);
    ring(x, y, 'danger', 0.5, 9, 0.7, { w: 0.5, a: 1 });
  },

  cavein(x, y) {
    flash(120, 80, 60, 0.22);
    for (let i = 0; i < 8; i++) {
      puff(x + rr(-6, 6), y - rr(2, 10), 'vfx.dust', rr(2, 4), rr(0.5, 0.9),
           { vy: rr(0.5, 2), grow: 2.6, a: 0.4 });
    }
  },

  /* Pickups. All four share a shape — a ring and a lift of glowing motes —
   * because they are the same verb, and differ only in colour and scale. */
  ore(x, y, v) { pickup(x, y, 'ore', 0.8 + Math.min(3, v || 1) * 0.4); },
  bonus(x, y) { pickup(x, y, 'fygarBelly', 2.2); flash(216, 240, 160, 0.12); },
  crystal(x, y) { pickup(x, y, 'ore', 3.4); flash(127, 227, 255, 0.3); },
  relic(x, y) { pickup(x, y, 'harpoon', 3.0); flash(255, 216, 138, 0.26); },
  helmet(x, y) { pickup(x, y, 'accent', 1.6); },
  extra(x, y) { pickup(x, y, 'fygarBelly', 2.4); },

  air(x, y) { pickup(x, y, 'air', 1.8); },
  airlow(x, y) { ring(x, y, 'danger', 1, 5, 0.5, { w: 0.2, a: 0.5 }); },
  airout(x, y) {
    flash(255, 84, 112, 0.28);
    ring(x, y, 'danger', 1, 8, 0.6, { w: 0.4, a: 0.9 });
  },

  combo(x, y, v) {
    ring(x, y, 'accent', 0.8, 3 + (v || 1), 0.4, { w: 0.3, a: 0.9, glow: true });
    for (let i = 0; i < 6 + (v || 1) * 2; i++) {
      const a = rr(0, Math.PI * 2);
      mote(x, y, 'accent', rr(0.2, 0.45), rr(0.4, 0.8),
           Math.cos(a) * rr(2, 6), Math.sin(a) * rr(2, 6) - 2,
           { a: 0.9, glow: true });
    }
  },

  bank() { flash(224, 122, 47, 0.1); },
  level() { reset(); },
  levelclear() { flash(255, 216, 138, 0.2); },
  gameover() { flash(0, 0, 0, 0.35); },

  /* The drill. Fires once when the descent starts; the continuous dust comes
   * from entities.js, which can see that state.phase is 'descend'. */
  descend(x, y) {
    for (let i = 0; i < 10; i++) {
      puff(x + rr(-1.5, 1.5), y + rr(0, 2), 'vfx.dust', rr(1.6, 3), rr(0.4, 0.8),
           { vx: rr(-3, 3), vy: rr(-2.5, -0.5), grow: 2, a: 0.5 });
    }
  },
};

function pickup(x: number, y: number, colour: string, scale = 1) {
  ring(x, y, colour, 0.3, scale * 1.4, 0.34, { w: 0.2, a: 0.9, glow: true });
  for (let i = 0; i < 6; i++) {
    mote(x + rr(-0.5, 0.5), y, colour, rr(0.2, 0.4), rr(0.4, 0.8),
         rr(-1.5, 1.5), rr(-5, -2), { a: 1, glow: true, g: 1.5, drag: 0.8 });
  }
}

/* Spawn from an engine event. `type` is the event name, so the mapping from
 * "what happened" to "what it looks like" lives here and nowhere else — the
 * same arrangement audio.js has with its VOICES table.
 *
 * Silently ignores an event with no look. That is deliberate: the event list
 * grows from the simulation side, and a renderer that threw on an unknown name
 * would turn "someone added an event" into a crash. */
export function emit(type: string, x?: number, y?: number, value?: number | string) {
  const fn = FX[type];
  if (!fn) return;
  const v = typeof value === 'number' ? value : undefined;
  if (x === undefined || y === undefined) { fn(0, 0, v); return; }
  fn(x, y, v);
}

export function tick(dt: number) {
  const d = dt > 0 ? Math.min(dt, 0.1) : 0;
  if (d === 0) return;

  flashA -= d * 3.2;
  if (flashA < 0) flashA = 0;

  let w = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    p.life -= d;
    if (p.life <= 0) continue;

    if (p.s === 'ring') {
      const t = 1 - p.life / p.max;
      p.rNow = p.r + (p.r1 - p.r) * (1 - (1 - t) * (1 - t));
    } else if (p.s !== 'beam') {
      const drag = Math.exp(-p.drag * d);
      p.vx *= drag;
      p.vy = p.vy * drag + (p.g === undefined ? 0 : p.g) * d;
      p.x += p.vx * d;
      p.y += p.vy * d;
      if (p.grow) p.size += p.grow * d;
    }
    parts[w++] = p;
  }
  parts.length = w;
}

/* World-space pass. `view` is entities.js's transform: { ox, oy, scale, top }.
 *
 * CULLING IS THE VIEW'S BUSINESS and is computed from world coordinates, never
 * fed back anywhere — an effect that scrolls off the top simply stops being
 * drawn and keeps ticking. */
export function render(g: Ctx, view: ViewBox, palette: Palette) {
  if (!parts.length) return;
  const sc = view.scale;
  const sx = (x: number) => view.ox + x * sc;
  const sy = (y: number) => view.oy + (y - view.top) * sc;
  const botRow = view.top + (view.visRows || 200);

  g.save();
  for (const p of parts) {
    if (p.y < view.top - 8 || p.y > botRow + 8) continue;
    const t = 1 - p.life / p.max;
    const fade = p.life / p.max;
    const col = colour(palette, p.colour ?? 'text');
    const x = sx(p.x), y = sy(p.y);

    if (p.s === 'ring') {
      const r = (p.rNow === undefined ? p.r : p.rNow) * sc;
      if (r <= 0) continue;
      g.globalAlpha = p.a * fade;
      g.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
      g.strokeStyle = col;
      g.lineWidth = Math.max(1, p.w * sc * (0.4 + fade));
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    } else if (p.s === 'beam') {
      g.globalAlpha = fade;
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = col;
      g.lineWidth = Math.max(1, p.w * sc);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(sx(p.x2), sy(p.y2));
      g.stroke();
    } else if (p.s === 'puff') {
      if (p.size <= 0 || p.a <= 0) continue;
      const d = p.size * sc;
      g.globalAlpha = p.a * fade;
      g.globalCompositeOperation = p.colour ? 'lighter' : 'source-over';
      const f = p.clip ? clipFrame(p.clip, t) : null;
      if (f) {
        sprites.draw(g, f, x - d / 2, y - d / 2, d, d);
      } else {
        g.fillStyle = col;
        g.globalAlpha *= 0.5;
        g.beginPath();
        g.arc(x, y, d / 2, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      if (p.a <= 0) continue;
      const d = Math.max(1, p.size * sc);
      g.globalAlpha = p.a * fade;
      g.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
      g.fillStyle = col;
      g.fillRect(x - d / 2, y - d / 2, d, d);
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.restore();
}

/* Screen-space tint. Drawn last, outside the shake, so a hit does not also
 * shear the flash. */
export function overlay(g: Ctx, w: number, h: number) {
  if (flashA <= 0.002) return;
  g.save();
  g.globalAlpha = Math.min(0.6, flashA);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = `rgb(${flashR},${flashG},${flashB})`;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/* Resolve a palette accent by name, falling back to the name itself so a
 * handler can pass a literal colour where the theme has nothing to say. */
function colour(palette: Palette, name: string): string {
  if (!palette) return '#f5ece0';
  if (!name) return (palette.text as string) || '#f5ece0';
  return (palette[name] as string) || name;
}

export function count() { return parts.length; }
