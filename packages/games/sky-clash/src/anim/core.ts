/**
 * Keyframed animation for the crew: readable pose channels, clips of keyed poses, and a solver that turns a pose into bone
 * rotations for a rig exported by tools/blender/crew. Dependency-free and deterministic, so the display poses fighters with it
 * and the server evaluates the very same clips to place hitboxes on hands, feet and weapons (src/crew/build.ts).
 *
 * Fighter space: +X the fighter's left, +Y up, +Z forward; meters and degrees. Rest frames of every bone are world-aligned, so a
 * bone's local rotation is simply what it adds to its parent. Right-hand rule throughout: rotating about +X tips +Y toward +Z
 * (a forward bend), about +Y turns +Z toward +X (toward the fighter's left), about +Z lifts +X toward +Y.
 */
export type V3 = [number, number, number];
export type Q = [number, number, number, number];
const RAD = Math.PI / 180, X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1], ID: Q = [0, 0, 0, 1];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
export const mul = (a: Q, b: Q): Q => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const inv = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export function rot(q: Q, v: V3): V3 {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
export const axis = (a: V3, deg: number): Q => { const h = deg * RAD / 2, s = Math.sin(h); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)]; };
/** XYZ bend/twist/side triple used by the spine chain: twist about Y, then bend about X, then side about Z. */
export const euler = (e: readonly number[]): Q => mul(mul(axis(Y, e[1] ?? 0), axis(X, e[0] ?? 0)), axis(Z, e[2] ?? 0));
/** Shortest rotation taking unit a onto unit b. */
export function arc(a: V3, b: V3): Q {
  const d = dot(a, b);
  if (d < -.99999) { const p = norm(cross(Math.abs(a[0]) < .9 ? X : Y, a)); return [p[0], p[1], p[2], 0]; }
  const c = cross(a, b), q: Q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(...q); return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/** Rotation taking the frame (d, p) onto (n, q): d lands exactly on n, p as near q as it can. */
export function frame(d: V3, p: V3, n: V3, q: V3): Q {
  const a = norm(sub(p, scale(d, dot(p, d)))), b = norm(sub(q, scale(n, dot(q, n)))), c = cross(d, a), e = cross(n, b);
  // R = [n b e] [d a c]^T
  const m = [n[0] * d[0] + b[0] * a[0] + e[0] * c[0], n[0] * d[1] + b[0] * a[1] + e[0] * c[1], n[0] * d[2] + b[0] * a[2] + e[0] * c[2],
    n[1] * d[0] + b[1] * a[0] + e[1] * c[0], n[1] * d[1] + b[1] * a[1] + e[1] * c[1], n[1] * d[2] + b[1] * a[2] + e[1] * c[2],
    n[2] * d[0] + b[2] * a[0] + e[2] * c[0], n[2] * d[1] + b[2] * a[1] + e[2] * c[1], n[2] * d[2] + b[2] * a[2] + e[2] * c[2]];
  const t = m[0] + m[4] + m[8]; let out: Q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; out = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4]; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; out = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; out = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; out = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s]; }
  return out;
}
export function slerp(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1; d = Math.abs(d);
  if (d > .9995) { const q: Q = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t], l = Math.hypot(...q); return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
  const th = Math.acos(d), k0 = Math.sin((1 - t) * th) / Math.sin(th), k1 = Math.sin(t * th) / Math.sin(th) * s;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1];
}

// ── Rig ──────────────────────────────────────────────────────────────────
/** Rig description written by the Blender pipeline (src/crew/<id>/rig.ts). */
export type Rig = {
  bones: readonly string[]; parents: Readonly<Record<string, string | null>>; joints: Readonly<Record<string, readonly number[]>>;
  chains: Readonly<Record<string, readonly string[]>>; anchors: Readonly<Record<string, { bone: string; at: readonly number[] }>>;
  /** Left hand's rest axes (finger direction, thumb side, palm normal) and whether the right hand is modelled as a closed fist round the prop. */
  hand: { along: readonly number[]; thumb: readonly number[]; palm: readonly number[] }; fist?: boolean;
};

// ── Poses ────────────────────────────────────────────────────────────────
/** Forward kinematics for an arm: swing forward (+) or back from hanging, lift out to the side, twist along the arm, bend the elbow. */
export type ArmFK = { fwd?: number; out?: number; twist?: number; bend?: number };
/** Inverse kinematics for an arm: put the wrist at a point in fighter space; `pole` is where the elbow points. */
export type ArmIK = { to: readonly number[]; pole?: readonly number[] };
/** The off hand holds the weapon this far along it from the grip (meters, toward the tip). */
export type ArmGrip = { grip: number; pole?: readonly number[] };
export type Arm = ArmFK | ArmIK | ArmGrip;
/** Ankle offset from its rest spot [x left, y up, z forward], then toe pitch (+ down) and toe yaw (+ out). */
export type Foot = readonly number[];
export type Pose = {
  /** Hips offset from rest [x left, y up, z forward] in meters. Legs follow through the foot targets. */
  hips?: readonly number[];
  /** Hips orientation: lean (+ forward), turn (+ toward the fighter's left), roll (+ lifts the left side). */
  lean?: number; turn?: number; roll?: number;
  /** [bend, twist, side] per spine bone. */
  spine?: readonly number[]; chest?: readonly number[]; neck?: readonly number[]; head?: readonly number[];
  armL?: Arm; armR?: Arm; shrugL?: number; shrugR?: number;
  /** [flex, side, twist] of a free hand, and how closed it is (0 open, 1 fist). */
  wristL?: readonly number[]; wristR?: readonly number[]; gripL?: number; gripR?: number;
  footL?: Foot; footR?: Foot; kneeL?: number; kneeR?: number;
  /** Weapon aim in fighter space: [pitch (0 forward, 90 up), yaw (+ toward the fighter's left), roll about itself]. */
  aim?: readonly number[];
  /** [blink 0..1, brow -1 frown .. 1 raised, jaw 0..1]. */
  face?: readonly number[];
  /** Whole-body stretch along the spine (+ taller and thinner, - squashed). Render only. */
  stretch?: number;
  /** The whole figure turned about its rest hip point [pitch (+ forward), yaw, roll] in degrees, then raised by `lift` meters: flips, rolls, tumbles, lying down. */
  spin?: readonly number[]; lift?: number;
};
export type Ease = 'lin' | 'in' | 'out' | 'io' | 'back' | 'hold' | 'snap' | 'anti';
/** A keyed pose at frame f. `e` is how the motion arrives at this key. */
export type Key = { f: number; p: Pose; e?: Ease };
/** Keys are merged over `base`. `loop` is the cycle length in frames. `drag` delays the upper body by that many frames for follow-through. */
export type Clip = { keys: readonly Key[]; base?: Pose; loop?: number; drag?: number };

const EASE: Record<Ease, (t: number) => number> = {
  lin: t => t, in: t => t * t, out: t => 1 - (1 - t) * (1 - t), io: t => t * t * (3 - 2 * t), hold: t => (t < 1 ? 0 : 1),
  back: t => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }, snap: t => 1 - (1 - t) ** 4, anti: t => { const c = 1.6; return (c + 1) * t ** 3 - c * t * t; },
};
const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpA = (a: readonly number[] | undefined, b: readonly number[] | undefined, t: number, n: number): number[] => Array.from({ length: n }, (_, i) => lerpN(a?.[i] ?? 0, b?.[i] ?? 0, t));
const kind = (a: Arm | undefined) => (!a ? 'fk' : 'to' in a ? 'ik' : 'grip' in a ? 'grip' : 'fk');
type Mixed = { mix: [Arm | undefined, Arm | undefined, number] };
function lerpArm(a: Arm | undefined, b: Arm | undefined, t: number): Arm | Mixed {
  const ka = kind(a), kb = kind(b);
  if (ka !== kb) return t <= 0 ? a ?? {} : t >= 1 ? b ?? {} : { mix: [a, b, t] };
  if (ka === 'ik') { const x = a as ArmIK, y = b as ArmIK; return { to: lerpA(x.to, y.to, t, 3), pole: x.pole || y.pole ? lerpA(x.pole ?? y.pole, y.pole ?? x.pole, t, 3) : undefined }; }
  if (ka === 'grip') { const x = a as ArmGrip, y = b as ArmGrip; return { grip: lerpN(x.grip, y.grip, t), pole: x.pole || y.pole ? lerpA(x.pole ?? y.pole, y.pole ?? x.pole, t, 3) : undefined }; }
  const x = (a ?? {}) as ArmFK, y = (b ?? {}) as ArmFK;
  return { fwd: lerpN(x.fwd ?? 0, y.fwd ?? 0, t), out: lerpN(x.out ?? 0, y.out ?? 0, t), twist: lerpN(x.twist ?? 0, y.twist ?? 0, t), bend: lerpN(x.bend ?? 0, y.bend ?? 0, t) };
}
/** Channel-wise blend of two full poses (feet stay planted because targets, not joints, are blended). */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a; if (t >= 1) return b;
  const n = (k: 'lean' | 'turn' | 'roll' | 'shrugL' | 'shrugR' | 'gripL' | 'gripR' | 'kneeL' | 'kneeR' | 'stretch' | 'lift') => lerpN(a[k] ?? 0, b[k] ?? 0, t);
  const v = (k: 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'wristL' | 'wristR' | 'aim' | 'face' | 'spin', size = 3) => lerpA(a[k], b[k], t, size);
  return { hips: v('hips'), lean: n('lean'), turn: n('turn'), roll: n('roll'), spine: v('spine'), chest: v('chest'), neck: v('neck'), head: v('head'),
    armL: lerpArm(a.armL, b.armL, t) as Arm, armR: lerpArm(a.armR, b.armR, t) as Arm, shrugL: n('shrugL'), shrugR: n('shrugR'), wristL: v('wristL'), wristR: v('wristR'),
    gripL: lerpN(a.gripL ?? .3, b.gripL ?? .3, t), gripR: lerpN(a.gripR ?? .3, b.gripR ?? .3, t), footL: lerpA(a.footL, b.footL, t, 5), footR: lerpA(a.footR, b.footR, t, 5), kneeL: n('kneeL'), kneeR: n('kneeR'),
    aim: a.aim || b.aim ? v('aim') : undefined, face: v('face'), stretch: n('stretch'), spin: v('spin'), lift: n('lift') };
}
function at(clip: Clip, f: number): Pose {
  const keys = clip.keys, base = clip.base ?? {}, L = clip.loop;
  if (L) f = ((f % L) + L) % L;
  let i = 0; while (i < keys.length - 1 && keys[i + 1]!.f <= f) i++;
  const a = keys[i]!, b = keys[i + 1] ?? (L ? { ...keys[0]!, f: keys[0]!.f + L } : undefined);
  if (!b || f <= a.f) return { ...base, ...a.p };
  return lerpPose({ ...base, ...a.p }, { ...base, ...b.p }, EASE[b.e ?? 'io'](Math.min(1, (f - a.f) / Math.max(1e-6, b.f - a.f))));
}
/** Pose of a clip at a (fractional) frame. The torso, head and free arm sample slightly late, which gives drag and follow-through for free. */
export function sample(clip: Clip, f: number): Pose {
  const d = clip.drag ?? 1, now = at(clip, f);
  if (!d) return now;
  const a = at(clip, f - .35 * d), b = at(clip, f - .7 * d), c = at(clip, f - 1.1 * d);
  return { ...now, spine: a.spine, chest: b.chest, neck: c.neck, head: c.head, armL: kind(now.armL) === 'fk' && !('mix' in (now.armL ?? {})) ? b.armL : now.armL, gripL: b.gripL, face: now.face };
}

// ── Solve ────────────────────────────────────────────────────────────────
/** `local` rotations and `world` rotations and positions (fighter space) per bone; `moved` holds local positions for the few bones a pose translates (hips, brows). */
export type Solved = { local: Record<string, Q>; world: Record<string, Q>; pos: Record<string, V3>; moved: Record<string, V3>; stretch: number };
const v3 = (a: readonly number[] | undefined, d: V3 = [0, 0, 0]): V3 => (a ? [a[0] ?? d[0], a[1] ?? d[1], a[2] ?? d[2]] : d);
/** Two-bone IK: world rotations of the upper and lower bone that put the end at `target`, elbow or knee toward `pole`. */
function limb(root: V3, target: V3, l1: number, l2: number, rest1: V3, rest2: V3, hinge: V3, pole: V3): [Q, Q] {
  let to = sub(target, root), d = len(to); const max = (l1 + l2) * .999, min = Math.abs(l1 - l2) + .01;
  if (d > max) { to = scale(to, max / d); d = max; } else if (d < min) { to = scale(norm(to), min); d = min; }
  const dir = norm(to), a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let perp = sub(pole, scale(dir, dot(pole, dir))); if (len(perp) < 1e-5) perp = sub(Y, scale(dir, dot(Y, dir))); perp = norm(perp);
  const joint = add(add(root, scale(dir, a)), scale(perp, h)), d1 = norm(sub(joint, root)), d2 = norm(sub(add(root, to), joint));
  let n = cross(d1, d2); n = len(n) < 1e-4 ? norm(cross(perp, d1)) : norm(n);
  return [frame(rest1, hinge, d1, n), frame(rest2, hinge, d2, n)];
}
const mirror = (v: readonly number[]): V3 => [-(v[0] ?? 0), v[1] ?? 0, v[2] ?? 0];
export function solve(rig: Rig, pose: Pose): Solved {
  const J = rig.joints as Record<string, V3>, L: Record<string, Q> = {}, W: Record<string, Q> = {}, P: Record<string, V3> = {}, M: Record<string, V3> = {};
  const put = (b: string, local: Q, at?: V3) => {
    const p = rig.parents[b]; L[b] = local; W[b] = p ? mul(W[p]!, local) : local; P[b] = at ?? (p ? add(P[p]!, rot(W[p]!, sub(J[b]!, J[p]!))) : [...J[b]!] as V3);
    if (at && p) M[b] = rot(inv(W[p]!), sub(at, P[p]!));
  };
  const world = (b: string, q: Q) => put(b, mul(inv(W[rig.parents[b]!]!), q));
  // Whole-figure spin about the rest hip point, then lift: the root bone carries it, so hands, feet and weapons (and their hitboxes) follow.
  const sp = pose.spin ?? [], spin = mul(mul(axis(Y, sp[1] ?? 0), axis(X, sp[0] ?? 0)), axis(Z, sp[2] ?? 0)), pivot = J.hips!;
  L.root = W.root = spin; P.root = add(sub(pivot, rot(spin, pivot)), [0, pose.lift ?? 0, 0]); M.root = P.root;
  put('hips', mul(mul(axis(Y, pose.turn ?? 0), axis(X, pose.lean ?? 0)), axis(Z, pose.roll ?? 0)), add(P.root, rot(spin, add(J.hips!, v3(pose.hips)))));
  for (const b of ['spine', 'chest', 'neck', 'head'] as const) put(b, euler(pose[b] ?? []));
  const aim = pose.aim, aimDir: V3 | null = aim ? rot(spin, [Math.sin((aim[1] ?? 0) * RAD) * Math.cos((aim[0] ?? 0) * RAD), Math.sin((aim[0] ?? 0) * RAD), Math.cos((aim[1] ?? 0) * RAD) * Math.cos((aim[0] ?? 0) * RAD)]) : null;
  const along0 = v3(rig.hand.along), palm0 = v3(rig.hand.palm), toWorld = (p: V3): V3 => add(P.root!, rot(spin, p));
  const arm = (s: 1 | -1, n: 'L' | 'R', spec: Arm | Mixed | undefined, gripAt: V3 | null): [Q, Q] => {
    const sh = `shoulder_${n}`, ua = `upperarm_${n}`, fa = `forearm_${n}`, hd = `hand_${n}`;
    const rest = norm(sub(J[fa]!, J[ua]!)), rest2 = norm(sub(J[hd]!, J[fa]!)), hinge = norm(cross(rest, Z)), root = P[ua] ?? add(P[sh]!, rot(W[sh]!, sub(J[ua]!, J[sh]!)));
    if (spec && 'mix' in spec) { const [a, b, t] = spec.mix, x = arm(s, n, a, gripAt), y = arm(s, n, b, gripAt); return [slerp(x[0], y[0], t), slerp(x[1], y[1], t)]; }
    const k = kind(spec as Arm | undefined);
    if (k === 'fk') {
      const a = (spec ?? {}) as ArmFK, o = (a.out ?? 12) * RAD * s, f = (a.fwd ?? 0) * RAD, dir: V3 = [Math.sin(o), -Math.cos(o) * Math.cos(f), Math.cos(o) * Math.sin(f)];
      const ua_w = mul(W[sh]!, mul(axis(dir, a.twist ?? 0), arc(rest, dir)));
      return [ua_w, mul(ua_w, axis(hinge, a.bend ?? 12))];
    }
    const target = k === 'grip' ? gripAt ?? add(root, [0, -.4, .2]) : toWorld(v3((spec as ArmIK).to)), pole = rot(spin, v3((spec as ArmIK | ArmGrip).pole, [s * .35, -.7, -.6]));
    return limb(root, target, len(sub(J[fa]!, J[ua]!)), len(sub(J[hd]!, J[fa]!)), rest, rest2, hinge, pole);
  };
  const hand = (s: 1 | -1, n: 'L' | 'R', weapon: boolean) => {
    const fa = `forearm_${n}`, along = s > 0 ? along0 : mirror(along0), palm = s > 0 ? palm0 : mirror(palm0), curl = norm(cross(along, palm));
    if (weapon && aimDir) {
      const f = rot(W[fa]!, norm(sub(J[`hand_${n}`]!, J[fa]!))); let side = sub(f, scale(aimDir, dot(f, aimDir))); if (len(side) < 1e-4) side = cross(aimDir, X);
      world(`hand_${n}`, mul(axis(aimDir, aim![2] ?? 0), frame(Z, along, aimDir, norm(side))));
    } else { const w = pose[`wrist${n}`] ?? []; put(`hand_${n}`, mul(mul(axis(curl, w[0] ?? 0), axis(palm, w[1] ?? 0)), axis(along, w[2] ?? 0))); }
    const g = weapon && rig.fist ? 0 : pose[`grip${n}`] ?? .3;
    if (rig.parents[`fingers1_${n}`]) { put(`fingers1_${n}`, axis(curl, 72 * g)); put(`fingers2_${n}`, axis(curl, 88 * g)); put(`thumb_${n}`, axis(norm(cross(Z, palm)), 34 * g * s)); }
  };
  for (const [s, n] of [[-1, 'R'], [1, 'L']] as const) {
    put(`shoulder_${n}`, axis(Z, s * (pose[`shrug${n}`] ?? 0)));
    // The off hand may hold the weapon: its target is a point along the aim line from the grip.
    const gripAt = n === 'L' && aimDir && P.prop ? add(P.prop, scale(aimDir, (pose.armL as ArmGrip | undefined)?.grip ?? 0)) : null;
    const [u, f] = arm(s, n, pose[`arm${n}`], gripAt);
    world(`upperarm_${n}`, u); world(`forearm_${n}`, f); hand(s, n, n === 'R' && !!rig.parents.prop);
    if (n === 'R' && rig.parents.prop) put('prop', ID);
  }
  for (const [s, n] of [[1, 'L'], [-1, 'R']] as const) {
    const th = `thigh_${n}`, sh = `shin_${n}`, ft = `foot_${n}`, f = pose[`foot${n}`] ?? [], k = (6 + (pose[`knee${n}`] ?? 0)) * RAD * s, root = add(P.hips!, rot(W.hips!, sub(J[th]!, J.hips!)));
    const [u, l] = limb(root, toWorld(add(J[ft]!, v3(f))), len(sub(J[sh]!, J[th]!)), len(sub(J[ft]!, J[sh]!)), norm(sub(J[sh]!, J[th]!)), norm(sub(J[ft]!, J[sh]!)), X, rot(spin, [Math.sin(k), 0, Math.cos(k)]));
    world(th, u); world(sh, l); world(ft, mul(spin, mul(axis(Y, s * (f[4] ?? 0)), axis(X, f[3] ?? 0))));
  }
  const face = pose.face ?? [];
  for (const [s, n] of [[1, 'L'], [-1, 'R']] as const) {
    if (rig.parents[`lid_${n}`]) put(`lid_${n}`, axis(X, 40 * (face[0] ?? 0)));
    if (rig.parents[`brow_${n}`]) { const b = face[1] ?? 0, p = rig.parents[`brow_${n}`]!; put(`brow_${n}`, axis(Z, -12 * b * s), add(add(P[p]!, rot(W[p]!, sub(J[`brow_${n}`]!, J[p]!))), rot(W[p]!, [0, .007 * b, 0]))); }
  }
  if (rig.parents.jaw) put('jaw', axis(X, 17 * (face[2] ?? 0)));
  for (const b of rig.bones) if (!L[b]) put(b, ID);   // spring chains and anything unposed stay at rest
  return { local: L, world: W, pos: P, moved: M, stretch: pose.stretch ?? 0 };
}
/** A named point on the rig (weapon tip, lantern, fist) in fighter space for a solved pose. */
export function anchor(rig: Rig, s: Solved, name: string): V3 {
  const a = rig.anchors[name] ?? { bone: name, at: [0, 0, 0] }; return add(s.pos[a.bone]!, rot(s.world[a.bone]!, v3(a.at)));
}
/** Last keyed frame of a clip (its length for one-shots). */
export const clipEnd = (clip: Clip) => clip.loop ?? clip.keys[clip.keys.length - 1]!.f;
