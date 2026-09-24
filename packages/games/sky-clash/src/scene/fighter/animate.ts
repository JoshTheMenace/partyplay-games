/**
 * Snapshot state → pose. Pure and allocation-light: the actor owns the clock (smoothed frame counters and gait phase)
 * and the rig turns the dense pose into bone rotations. Every FighterState and every Pose family resolves here.
 */
import type { FighterView, Limb, Pose } from '../../model';
import { AIR_APEX, AIR_FALL, AIR_RISE, FAMILIES, FAST_FALL, HELPLESS, TAUNTS, handFamily, isPropPose, type Family, type Style } from './library';
import { BASE, SCALAR, VEC, add, apply, backOut, bump, clamp, clamp01, dense, easeIn, easeOut, fromKey, mirror, mix, settle, smooth, wave, type Dense, type Key } from './pose';

/**
 * Frame data the renderer needs for one move (see moves.ts). power (0–1, from hitbox damage) scales coil, overshoot and
 * trails; hold freezes a charge's wind-up or a reflector's strike; windup starts a release already wound; family
 * overrides the pose family with a fighter's signature motion (Link's bow, DK's windmill).
 */
export type MoveInfo = { pose: Pose; limb: Limb; total: number; start: number; end: number; charge: number | null; power?: number; hold?: 'wind' | 'strike'; windup?: boolean; family?: Family };
/** Local, smoothly advancing time. Frames are 60 Hz simulation frames (fractional between snapshots). */
export type Clock = { state: number; move: number; seconds: number; gait: number; airJump: number };
/** swing: 0–1 active-frame weight of the striking limb (drives swing trails), with the move's power. */
export type Meta = { key: string; blend: number; reach: Limb | null; reachW: number; ik: boolean; floor: boolean; fade: number; swing: number; power: number };
export type AnimView = Pick<FighterView, 'state' | 'move' | 'movePhase' | 'grounded' | 'vx' | 'vy' | 'facing' | 'charge' | 'launch' | 'shield' | 'intangible' | 'hitlag' | 'stateFrame'>;
export type Options = { weaponLeft?: boolean };

const W = dense(), S = dense(), F = dense(), B = dense(), C = dense(), T = Math.PI * 2;
const mirrored = new Map<Family, Family>();
/** Families are authored with one striking side (weapon = right hand); mirror them when the move strikes with the other. */
function sided(fam: Family, limb: Limb, weaponLeft: boolean): Family {
  const side = fam.side ?? 'body', left = (l: Limb) => l === 'handL' || l === 'footL', lateral = (l: Limb) => l !== 'body' && l !== 'head';
  const famLeft = side === 'weapon' ? false : left(side);
  const wantLeft = side === 'weapon' || limb === 'weapon' ? weaponLeft : lateral(limb) && lateral(side) ? left(limb) : famLeft;
  if (wantLeft === famLeft) return fam;
  let m = mirrored.get(fam);
  if (!m) {
    const s = fam.strike;
    m = { ...fam, wind: mirror(fam.wind), follow: fam.follow && mirror(fam.follow), strike: typeof s === 'function' ? (u: number, t: number) => mirror(s(u, t)) : mirror(s) };
    mirrored.set(fam, m);
  }
  return m;
}

export function familyFor(style: Style, info: MoveInfo): Family {
  if (style.body === 'hand') return handFamily(info.pose);
  if (info.family) return info.family;
  if (info.pose === 'taunt') return TAUNTS[style.family] ?? TAUNTS.plumber;
  return FAMILIES[info.pose] ?? FAMILIES.jab;
}

/** Limb targets (hands about the shoulder, ankles about the hip, the prop direction) that swing along arcs. */
const ARCS = [[VEC.hL, 0], [VEC.hR, 0], [VEC.fL, -1], [VEC.fR, -1], [VEC.blade, 0]] as const;
/** Like mix(), but limbs sweep around their joint instead of cutting a straight line through the body. */
export function swing(out: Dense, a: Dense, b: Dense, t: number): Dense {
  mix(out, a, b, t);
  for (const [i, py] of ARCS) {
    const ax = a[i], ay = a[i + 1] + py, az = a[i + 2], bx = b[i], by = b[i + 1] + py, bz = b[i + 2], la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    if (la < .05 || lb < .05) continue;
    const th = Math.acos(clamp((ax * bx + ay * by + az * bz) / (la * lb), -1, 1)), s = Math.sin(th);
    if (th < .15 || s < .08) continue;
    const len = la + (lb - la) * t, wa = Math.sin((1 - t) * th) / s / la * len, wb = Math.sin(t * th) / s / lb * len;
    out[i] = ax * wa + bx * wb; out[i + 1] = ay * wa + by * wb - py; out[i + 2] = az * wa + bz * wb;
  }
  return out;
}

/** Anticipation → strike → follow-through against the move's own frame data. Returns the active-frame weight. */
export function evalMove(out: Dense, base: Dense, fam: Family, info: MoveInfo, f: number, seconds: number, charge: number): number {
  const start = Math.max(1, info.start), end = Math.max(start + 1, info.end), total = Math.max(end + 1, info.total), power = info.power ?? .4;
  const strike = fam.strike, held = info.hold === 'strike', u = held ? f / 24 % 1 : clamp01((f - start) / (end - start));
  apply(W, fam.wind, base);
  apply(S, typeof strike === 'function' ? strike(u, seconds) : strike, base);
  if (held) { swing(out, W, S, backOut((f + 1) / 2.6)); return 1; }
  // Coiled wind-up: past the wind key, deeper for long startups (a Falcon Punch pulls back far more than a jab); charges tremble.
  const coil = fam.coil ?? .06 + .16 * clamp01((start - 4) / 24);
  swing(C, base, W, 1 + coil);
  C[VEC.root + 1] -= .05 * (.4 + power); // sink into the legs
  // The blow leaves the coil a frame or two before the hitbox appears (as Melee's scripts do), so it reads as a swing.
  const lead = info.hold === 'wind' || info.windup ? 0 : Math.min(2, start * .3), pre = lead ? smooth((f - start + lead) / lead) * .4 : 0;
  if (info.hold === 'wind' || f < start) {
    const t = info.hold === 'wind' ? 1 : f / start, from = info.windup || info.hold ? W : base;
    swing(out, from, W, easeOut(t / .7));
    mix(out, out, C, smooth((t - .6) / .4));
    if (pre > 0) swing(out, out, S, pre);
    if (charge > 0) { out[VEC.chest + 1] += Math.sin(seconds * 70) * 2.5 * charge; out[VEC.root] += Math.sin(seconds * 53) * .01 * charge; }
    return 0;
  }
  if (f < end) {
    // Strike: snap out of the coil along arcs with a power-scaled overshoot, stretching into the blow, then hold.
    const snap = clamp((end - start) * .5, 1.6, 3.2), k = (f - start + 1) / snap;
    swing(out, C, S, pre + (1 - pre) * backOut(k, 1.2 + 2 * power));
    out[SCALAR.squash] += .05 * (.5 + power) * bump(clamp01(k * .7));
    return smooth(k * 1.3);
  }
  // Follow-through: carry past the strike into the follow key, then settle back to the base with a soft overshoot.
  apply(F, fam.follow ?? {}, S);
  const r = (f - end) / (total - end);
  if (r < .35) swing(out, S, F, easeOut(r / .35));
  else swing(out, F, base, settle((r - .35) / .65));
  return 1 - smooth((f - end) / 3);
}

function airBase(out: Dense, style: Style, v: AnimView, clock: Clock) {
  const rise = clamp01(v.vy / (style.terminal * 1.2)), fall = clamp01(-v.vy / style.terminal);
  apply(out, AIR_APEX, BASE);
  if (v.vy > 0) mix(out, out, apply(B, AIR_RISE, BASE), smooth(rise));
  else mix(out, out, apply(B, AIR_FALL, BASE), smooth(fall));
  if (v.vy < -style.fastFall * .92) mix(out, out, apply(B, FAST_FALL, BASE), smooth((-v.vy - style.fastFall * .92) / (style.fastFall * .08)));
  // Drift lean: tip into horizontal motion.
  out[SCALAR.lean] += clamp(v.vx * v.facing / style.runSpeed, -1, 1) * 8;
  const j = clock.airJump;
  if (j < 26) {
    const t = j / 26;
    if (style.airJump === 'flip') { out[SCALAR.spin] -= 360 * easeOut(t); add(out, { fL: [0, .35, .15], fR: [0, .35, .1], hL: [0, .1, .2], hR: [0, .1, .2], chest: [20, 0, 0] }, bump(t * 1.2)); }
    else if (style.airJump === 'puff') add(out, { squash: .22, hL: [.4, .6, 0], hR: [.4, .6, 0], chest: [-12, 0, 0] }, bump(t * 1.4) * (1 + .3 * Math.sin(j * .9)));
    else if (style.airJump === 'kick') add(out, { fL: [0, .3, .35], fR: [0, .5, -.3], hL: [0, .5, 0], hR: [0, .5, 0], squash: .08 }, bump(t));
    else add(out, { hL: [.2, .6, 0], hR: [.2, .6, 0], chest: [-8, 0, 0], head: [-10, 0, 0] }, bump(t));
  }
}

function stance(out: Dense, style: Style) { return apply(out, style.stance, BASE); }
function idle(out: Dense, style: Style, s: number): Dense {
  stance(out, style);
  const b = style.bounce, r = style.rate, breath = Math.sin(s * T * .45 * r), bob = Math.sin(s * T * 1.1 * r);
  add(out, { chest: [-1.8 * breath, 0, 0], head: [1.2 * breath, 0, 0], root: [0, -.018 * b * (.5 + .5 * bob), 0], hL: [0, .02 * b * bob, 0], hR: [0, .02 * b * Math.sin(s * T * 1.1 * r + .6), 0] });
  if (style.body === 'round') out[SCALAR.squash] += .035 * breath;
  if (style.body === 'hand') add(out, { lift: .05 * Math.sin(s * T * .5), lean: 4 * Math.sin(s * T * .31), curl: .05 * breath });
  return out;
}

/** Walk/run cycle: foot targets travel ±stride at ground speed, arms counter-swing, torso bobs twice per cycle. */
function gait(out: Dense, style: Style, v: AnimView, clock: Clock, run: boolean) {
  const p = clock.gait * T, speed = Math.abs(v.vx), k = clamp(speed / (run ? style.runSpeed : style.walkSpeed), .25, 1.3);
  const stride = (run ? .62 : .35) * Math.min(1, .45 + .55 * k), lift = (run ? .5 : .16) * Math.min(1, .5 + .5 * k), c = Math.cos(p), sn = Math.sin(p);
  if (run) apply(out, { root: [0, -.12, .06], hips: [16, 0, 0], spine: [6, 0, 0], chest: [20, 0, 0], neck: [-12, 0, 0], head: [-16, 0, 0], eL: [.3, -.2, -1], eR: [.3, -.2, -1], kL: [.2, .3, 1], kR: [.2, .3, 1], lean: 6 }, BASE);
  else apply(out, { root: [0, -.04, 0], hips: [3, 0, 0], chest: [2, 0, 0], head: [-2, 0, 0] }, BASE);
  const swing = (x: number) => Math.max(0, x);
  out[VEC.fL + 2] = stride * c; out[VEC.fL + 1] = lift * swing(sn); out[VEC.fL] = .04;
  out[VEC.fR + 2] = -stride * c; out[VEC.fR + 1] = lift * swing(-sn); out[VEC.fR] = .04;
  out[SCALAR.tL] = 30 * swing(sn); out[SCALAR.tR] = 30 * swing(-sn);
  const bob = run ? -.03 - .07 * Math.abs(c) + .05 : -.015 - .03 * Math.abs(c) + .03;
  out[VEC.root + 1] += bob * (.6 + .4 * k); out[VEC.hips + 1] = 10 * c * (run ? 1 : .6); out[VEC.chest + 1] = -12 * c * (run ? 1 : .5);
  out[VEC.hips + 2] = 3 * sn;
  if (run) { out[VEC.hL] = .22; out[VEC.hL + 1] = -.5 + .35 * swing(-c); out[VEC.hL + 2] = -.62 * c + .05; out[VEC.hR] = .22; out[VEC.hR + 1] = -.5 + .35 * swing(c); out[VEC.hR + 2] = .62 * c + .05; }
  else { out[VEC.hL] = .16; out[VEC.hL + 1] = -.9; out[VEC.hL + 2] = -.32 * c; out[VEC.hR] = .16; out[VEC.hR + 1] = -.9; out[VEC.hR + 2] = .32 * c; }
  if (style.quad && run) {
    // Pikachu and Pichu drop to all fours: torso pitched over, hands pace like front legs.
    add(out, { hips: [30, 0, 0], chest: [30, 0, 0], neck: [-30, 0, 0], head: [-26, 0, 0], root: [0, -.12, 0] });
    out[VEC.hL] = .05; out[VEC.hL + 1] = -.95 + .25 * swing(-sn); out[VEC.hL + 2] = .1 - .5 * c;
    out[VEC.hR] = .05; out[VEC.hR + 1] = -.95 + .25 * swing(sn); out[VEC.hR + 2] = .1 + .5 * c;
  }
  if (style.body === 'round') { out[SCALAR.squash] = .08 * (Math.abs(c) - .5) * (run ? 1.4 : .8); out[SCALAR.lean] += run ? 10 : 3; }
  if (style.body === 'hand') { apply(out, { lift: .08 + .04 * Math.sin(p * 2), lean: run ? 18 : 8, curl: .2 + .2 * Math.abs(sn) }); }
  if (style.grip === 'sword' || style.grip === 'hammer') { out[VEC.hR] = -.05; out[VEC.hR + 1] = -.55; out[VEC.hR + 2] = run ? -.35 : .1; apply(out, { blade: run ? [0, .2, -1] : [0, .3, 1], bw: 1 }); }
}

function flinch(out: Dense, style: Style, v: AnimView, clock: Clock) {
  // Launch direction relative to facing: behind (hit from the front) arches back, ahead folds forward, up/down stretch/curl.
  const ang = Math.atan2(v.vy, v.vx * v.facing), back = -Math.cos(ang), upw = Math.sin(ang), power = clamp01((v.launch || Math.hypot(v.vx, v.vy)) / .12);
  const t = clamp01(clock.state / 12), w = (.55 + .45 * power) * (1 - .35 * smooth(t));
  if (v.grounded) stance(out, style); else airBase(out, style, v, clock);
  add(out, { chest: [-28 * back + 12 * Math.min(0, upw), 0, 0], spine: [-10 * back, 0, 0], neck: [-14 * back, 0, 0], head: [-20 * back - 10 * upw, 0, 0],
    hL: [.25, .5 * back + .25, .45 * back], hR: [.3, .4 * back + .2, .35 * back], fL: [0, .18, .2 * back], fR: [0, .3, .3 * back], root: [0, -.04, -.08 * back], squash: .06 * upw, lean: -10 * back }, w);
  if (!v.grounded) out[VEC.root + 1] += .03;
}

function tumble(out: Dense, style: Style, v: AnimView, clock: Clock) {
  airBase(out, style, v, clock);
  const speed = Math.max(v.launch, Math.hypot(v.vx, v.vy)), dir = v.vx * v.facing < 0 ? 1 : -1;
  apply(out, { hL: [.8, .35, .2], hR: [.75, .2, -.2], fL: [.25, .3, .3], fR: [.2, .1, -.35], chest: [-10, 0, 10], head: [-14, 0, 0], kL: [.3, 0, 1], kR: [.3, 0, 1] });
  out[SCALAR.spin] = dir * clock.state * clamp(speed / .05, .6, 3) * 11;
  add(out, { hL: [0, .15 * Math.sin(clock.seconds * 13), 0], hR: [0, .15 * Math.sin(clock.seconds * 11 + 1), 0], fL: [0, .1 * Math.sin(clock.seconds * 9), 0] });
}

const LIE: Key = { spin: -90, root: [0, 0, 0], chest: [-6, 0, 0], head: [-18, 0, 0], hL: [.55, -.4, -.2], hR: [.5, -.5, -.1], fL: [.1, .05, .1], fR: [.12, .25, -.05], kL: [.3, 1, .4], kR: [.3, 1, .2], tL: -20, tR: -20 };
const TUCK: Key = { root: [0, -.35, 0], hips: [34, 0, 0], chest: [36, 0, 0], neck: [10, 0, 0], head: [20, 0, 0], hL: [-.2, -.55, .55], hR: [-.2, -.6, .5], fL: [.05, .4, .35], fR: [.05, .4, .3], kL: [.2, .3, 1], kR: [.2, .3, 1], tL: 30, tR: 30, squash: -.08 };

const KNEEL: Key = { root: [0, -.42, .02], hips: [22, 0, 0], chest: [26, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0], hL: [.1, -.95, .5], hR: [.22, -.95, .25],
  fL: [.1, 0, .3], fR: [.1, .06, -.3], kL: [.3, 0, 1], kR: [.2, -1, .3], tR: -30 };

function state(out: Dense, style: Style, v: AnimView, c: Clock, meta: Meta) {
  const t = c.state, s = c.seconds;
  switch (v.state) {
    case 'idle': case 'attack': idle(out, style, s); break;
    case 'respawn': idle(out, style, s); add(out, { hL: [-.35, .45, .1], hR: [-.35, .45, .1], chest: [-6, 0, 0] }, .6); break;
    case 'walk': gait(out, style, v, c, false); break;
    case 'run': {
      gait(out, style, v, c, true);
      // Initial dash: a quick forward lunge that eases into the run cycle.
      const d = 1 - smooth(t / 10);
      if (d > 0) add(out, { chest: [14, 0, 0], hips: [10, 0, 0], root: [0, -.08, .08], fL: [0, 0, .25], fR: [0, .15, -.3], hL: [0, 0, -.2], hR: [0, 0, .3], lean: 8 }, d);
      break;
    }
    case 'turn': stance(out, style); add(out, { root: [0, -.16, -.05], hips: [-14, 0, 0], chest: [-12, 0, 0], head: [8, 0, 0], fL: [0, 0, .28], fR: [0, 0, -.1], hL: [.45, .3, .1], hR: [.45, .25, .1], lean: -10, kL: [.2, 0, 1] }, bump(t / 8 + .15)); break;
    case 'crouch': stance(out, style); apply(out, { root: [0, -.38 - .06 * (1 - settle(t / 6)), .04], hips: [30, -10, 0], chest: [18, 0, 0], neck: [-10, 0, 0], head: [-22, 0, 0], hL: [-.05, -.62, .52], hR: [0, -.66, .42], fL: [.14, 0, .1], fR: [.14, 0, -.12], kL: [.6, 0, 1], kR: [.6, 0, 1], squash: -.06 * (1 - settle(t / 6)) }); add(out, { chest: [1.5 * Math.sin(s * 2.8), 0, 0] }); break;
    case 'teeter': {
      stance(out, style); const a = s * T * 1.7;
      apply(out, { hL: [.75, .35 * Math.sin(a), .35 * Math.cos(a)], hR: [.75, .35 * Math.sin(a + 2), .35 * Math.cos(a + 2)], fL: [.04, 0, .06], fR: [.04, .18 + .08 * Math.sin(a), -.2], root: [0, -.04, 0], chest: [8 + 10 * Math.sin(a * .5), 0, 0], head: [-10, 0, 0], lean: 10 * Math.sin(a * .5), eL: [.2, 1, 0], eR: [.2, 1, 0] });
      break;
    }
    case 'jumpsquat': stance(out, style); add(out, { root: [0, -.22, .02], hips: [16, 0, 0], chest: [12, 0, 0], head: [-10, 0, 0], hL: [.1, -.3, -.3], hR: [.1, -.3, -.3], kL: [.3, 0, 0], kR: [.3, 0, 0], squash: -.16 }, easeOut((t + 1) / style.frames.jumpsquat)); break;
    case 'air': airBase(out, style, v, c); break;
    case 'land': {
      stance(out, style); const k = 1 - settle(t / 7);
      add(out, { root: [0, -.3 - .06 * style.heavy, .02], hips: [18, 0, 0], chest: [16, 0, 0], head: [-12, 0, 0], hL: [.2, .15, .1], hR: [.2, .12, .1], kL: [.4, 0, 0], kR: [.4, 0, 0], squash: -.16 - .06 * style.heavy }, k);
      break;
    }
    case 'hitstun': flinch(out, style, v, c); break;
    case 'tumble': case 'thrown': tumble(out, style, v, c); if (v.state === 'thrown') out[SCALAR.spin] *= 1.6; break;
    case 'shield': case 'shieldstun': {
      stance(out, style);
      apply(out, { root: [0, -.16, -.02], hips: [12, -10, 0], chest: [14, -6, 0], head: [-10, 6, 0], hL: [-.38, -.18, .42], hR: [-.34, -.26, .36], eL: [.8, -.4, -.2], eR: [.8, -.4, -.2], fL: [.1, 0, .14], fR: [.1, 0, -.14], kL: [.45, 0, 1], kR: [.45, 0, 1] });
      if (v.state === 'shieldstun') add(out, { chest: [-10, 0, 0], head: [-6, 0, 0], root: [0, -.03, -.08] }, 1 - smooth(t / 8));
      break;
    }
    case 'dizzy': {
      stance(out, style); const a = s * 2.4;
      apply(out, { root: [0, -.12, 0], hips: [6, 0, 6 * Math.sin(a)], chest: [16, 0, 8 * Math.sin(a + .6)], neck: [10, 0, 0], head: [18 + 6 * Math.sin(a * 2), 20 * Math.sin(a), 18 * Math.sin(a + 1)], hL: [.1, -.8, .35], hR: [.08, -.82, .32], eL: [.3, -.5, -1], eR: [.3, -.5, -1], fL: [.1, 0, .08], fR: [.1, 0, -.08], lean: 6 * Math.sin(a) });
      break;
    }
    case 'roll': {
      const dir = v.vx * v.facing >= 0 ? 1 : -1, r = clamp01(t / style.frames.roll);
      stance(out, style); mix(out, out, apply(B, TUCK, BASE), bump(r * 1.05)); out[SCALAR.spin] = dir * 360 * smooth(r); meta.floor = true;
      break;
    }
    case 'spotdodge': { const r = bump(t / style.frames.spot); stance(out, style); add(out, { root: [.3, -.1, 0], chest: [6, 0, -14], head: [0, 0, -10], hL: [-.3, 0, .1], hR: [-.3, 0, .1], squash: -.05 }, r); meta.fade = .35 * r; break; }
    case 'airdodge': {
      airBase(out, style, v, c); const r = bump(t / style.frames.airdodge);
      mix(out, out, apply(B, TUCK, BASE), .7 * r); out[SCALAR.spin] += 60 * r * Math.sign(-v.vy || 1) * (v.vx * v.facing >= 0 ? 1 : -1) * .5; meta.fade = .25 * r;
      break;
    }
    case 'helpless': apply(out, HELPLESS, BASE); add(out, { hL: [0, .12 * Math.sin(s * 5), 0], hR: [0, .12 * Math.sin(s * 5 + 2), 0], fL: [0, .06 * Math.sin(s * 4), 0], lean: 5 * Math.sin(s * 2) }); break;
    case 'ledge': {
      apply(out, { root: [0, 0, -.1], hips: [-6, 0, 0], chest: [-12, 0, 0], neck: [-14, 0, 0], head: [-20, 0, 0], hL: [-.08, .98, .22], hR: [-.1, .98, .2], eL: [.4, 0, -1], eR: [.4, 0, -1],
        fL: [.04, .04, .2], fR: [.04, .12, .1], kL: [.1, 0, 1], kR: [.1, 0, 1], tL: 30, tR: 30 }, BASE);
      add(out, { fL: [0, .04 * Math.sin(s * 2), 0], fR: [0, .04 * Math.sin(s * 2 + 1.4), 0] });
      break;
    }
    case 'ledgeclimb': {
      const r = clamp01(t / style.frames.climb);
      apply(out, { root: [0, -.1 * (1 - r), -.1], chest: [20, 0, 0], hL: [-.1, .98, .22], hR: [-.1, .98, .2] }, BASE);
      mix(out, out, stance(B, style), smooth((r - .35) / .65));
      if (r < .6) add(out, { fR: [0, .55, .3], kR: [0, .5, 1] }, bump(r / .6));
      break;
    }
    case 'grab': stance(out, style); apply(out, { hL: [-.28, -.1, .66], hR: [-.3, -.1, .66], chest: [8, 0, 0], root: [0, -.1, 0] }); add(out, { chest: [1.5 * Math.sin(s * 3), 0, 0] }); break;
    case 'grabbed': {
      // Held up by the collar: toes off the floor, chest arched back, arms pushing at the grabber, legs kicking.
      const k = Math.sin(s * 10), j = Math.sin(s * 8 + 2);
      apply(out, { root: [0, .02, -.04], hips: [-6, 0, 0], chest: [-16, 0, 4 * k], neck: [-6, 0, 0], head: [18, 8 * j, 0], hL: [-.2, .1 + .18 * k, .62], hR: [-.1, -.05 + .18 * j, .55], eL: [.6, -.6, -.3], eR: [.6, -.6, -.3],
        fL: [.04, .22 + .14 * k, .16], fR: [.04, .12 - .1 * k, -.14], kL: [.2, 0, 1], kR: [.2, 0, 1], tL: 40, tR: 40, lift: .1, lean: -8 }, BASE);
      break;
    }
    case 'knockdown': {
      const r = clamp01(t / Math.max(6, style.frames.bound)); apply(out, LIE, BASE); meta.floor = true;
      if (r < 1) { out[VEC.root + 1] += .2 * bump(r); out[SCALAR.spin] = -90 * easeIn(Math.min(1, r * 2)); }
      add(out, { chest: [2 * Math.sin(s * 2.6), 0, 0] });
      break;
    }
    case 'getup': {
      // Lying → push up to one knee → stand, with a little settle at the end.
      const r = clamp01(t / style.frames.getup); apply(out, LIE, BASE); meta.floor = r < .7;
      mix(out, out, apply(F, KNEEL, BASE), smooth(r / .5));
      mix(out, out, stance(B, style), settle((r - .5) / .5) * (r > .5 ? 1 : 0)); out[SCALAR.spin] = -90 * (1 - smooth(r / .55));
      if (v.vx) out[SCALAR.spin] -= Math.sign(v.vx * v.facing) * 360 * smooth(r);
      break;
    }
    case 'tech': {
      const r = clamp01(t / style.frames.tech), rolling = Math.abs(v.vx) > .005;
      stance(out, style); mix(out, out, apply(B, TUCK, BASE), bump(r)); meta.floor = true;
      out[SCALAR.spin] = (rolling ? Math.sign(v.vx * v.facing) : -1) * 360 * smooth(r);
      break;
    }
    case 'out': idle(out, style, s); meta.fade = 1; break;
    default: idle(out, style, s);
  }
}

/** Body-specific finishing touches: round fighters rock their whole body; hands keep their pose in the whole-body channels. */
function finish(out: Dense, style: Style) {
  if (style.body === 'round') {
    // One ball: pitch becomes a whole-body rock, and torso twist stays small so the face keeps reading.
    out[SCALAR.lean] += (out[VEC.chest] + out[VEC.hips] + out[VEC.spine]) * .45;
    out[VEC.chest] *= .5; out[VEC.hips] *= .4; out[VEC.spine] *= .4; out[SCALAR.squash] *= 1.5;
    for (const i of [VEC.hips, VEC.spine, VEC.chest]) out[i + 1] *= .3;
  } else if (style.body === 'hand') {
    out[SCALAR.lean] += out[VEC.chest] * .5; out[SCALAR.yaw] += out[VEC.chest + 1] * .5;
  }
  out[SCALAR.squash] = clamp(out[SCALAR.squash], -.35, .45); out[SCALAR.fade] = clamp01(out[SCALAR.fade]);
}

const BLEND: Partial<Record<FighterView['state'], number>> = { attack: 4, hitstun: 4, tumble: 5, land: 4, jumpsquat: 4, shield: 4, shieldstun: 4, grabbed: 4, thrown: 4, roll: 4, spotdodge: 4, airdodge: 4 };
export const HOLD_STATES = new Set<FighterView['state']>(['hitstun', 'tumble', 'shieldstun', 'grabbed', 'thrown', 'knockdown', 'dizzy', 'out', 'respawn', 'ledge']);

/** Writes the pose for this frame into out and returns metadata for the actor. info is the current move, if any. */
export function animate(out: Dense, v: AnimView, clock: Clock, style: Style, info: MoveInfo | null, opts: Options = {}): Meta {
  const moving = !!(v.move && info && !HOLD_STATES.has(v.state));
  const meta: Meta = { key: `${v.state}:${moving ? v.move : ''}:${v.grounded ? 'g' : 'a'}`, blend: BLEND[v.state] ?? 6, reach: null, reachW: 0, ik: true, floor: false, fade: 0, swing: 0, power: 0 };
  if (moving && info) {
    const fam = sided(familyFor(style, info), info.limb, !!opts.weaponLeft);
    const base = v.grounded && !fam.air ? idle(B, style, clock.seconds) : (airBase(B, style, v, clock), B);
    const charging = info.hold === 'wind' ? Math.max(.3, v.charge) : info.charge !== null && v.charge > 0 ? v.charge : 0;
    const f = charging && info.charge !== null && clock.move >= info.charge ? Math.min(clock.move, info.charge) : clock.move;
    const aim = evalMove(out, base, fam, info, f, clock.seconds, charging);
    // Trails open a frame before the active window so they catch the snap out of the wind-up.
    meta.swing = info.hold ? aim : f >= info.start - 1.5 && f < info.end ? Math.max(aim, .7) : aim; meta.power = info.power ?? .4;
    if (isPropPose(info.pose)) out[SCALAR.bw] = 1; // prop families always steer the prop, whatever the stance
    // Fists and feet land on their hitboxes; weapons only lean toward them so the authored arc still sweeps through.
    meta.reachW = fam.ik === false ? 0 : aim * (info.limb === 'weapon' ? .4 : .85);
    meta.reach = meta.reachW > 0 ? info.limb : null; meta.ik = fam.ik !== false; meta.blend = 4;
  } else state(out, style, v, clock, meta);
  meta.fade = Math.max(meta.fade, out[SCALAR.fade]);
  finish(out, style);
  return meta;
}

/** Fresh pose buffer plus a one-shot sampler, handy for tests and tools. */
export const pose = (v: AnimView, clock: Clock, style: Style, info: MoveInfo | null, opts?: Options) => { const out = dense(); return { pose: out, meta: animate(out, v, clock, style, info, opts) }; };
export { fromKey, wave };
