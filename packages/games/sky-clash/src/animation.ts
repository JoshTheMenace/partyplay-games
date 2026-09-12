// Authored fight animation for the replacement Fox/Falco rigs. Poses are presentation only; timing follows the
// authoritative move frames. Convention (verified against the exported rest pose): degrees of right-hand rotation
// about the WORLD axes at rest, re-expressed per bone. +X tilts upright bones forward and swings hanging limbs
// backward, so knee bends are +X and elbow bends are -X. "Outward" z is positive for the left side; mirrored for right.
import { Bone, PropertyBinding, Quaternion, Vector3, type Object3D } from 'three';
import { getMove, type Fighter, type Move } from './model';
export const BONE_NAMES = ['root', 'pelvis', 'chest', 'neck', 'head', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R', 'tail.01', 'tail.02', 'tail.03'] as const;
export type BoneName = typeof BONE_NAMES[number];
type Rest = { bone: Bone; position: Vector3; quaternion: Quaternion; axes: [Vector3, Vector3, Vector3] };
export type Rig = { bones: Map<BoneName, Rest>; missing: string[] };
/** GLTFLoader strips [ ] . : / from node names; compare sanitized forms so canonical keys survive. */
export function captureRig(root: Object3D): Rig {
  root.updateWorldMatrix(true, true);
  const bones = new Map<BoneName, Rest>(), missing: string[] = [], world = new Quaternion(), loaded = new Map<string, Bone>();
  root.traverse(object => { if (object instanceof Bone) { const key = PropertyBinding.sanitizeNodeName(object.name); if (!loaded.has(key)) loaded.set(key, object); } });
  for (const name of BONE_NAMES) {
    const bone = loaded.get(PropertyBinding.sanitizeNodeName(name));
    if (!bone) { missing.push(name); continue; }
    const inverse = bone.getWorldQuaternion(world).clone().invert();
    bones.set(name, { bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), axes: [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(inverse).normalize()) as Rest['axes'] });
  }
  return { bones, missing };
}
export type Flat = { bones: Float32Array; lift: number; spin: number; yaw: number };
const AXES = 3, spinQ = new Quaternion(), RAD = Math.PI / 180;
export const emptyFlat = (): Flat => ({ bones: new Float32Array(BONE_NAMES.length * AXES), lift: 0, spin: 0, yaw: 0 });
export function mixFlat(out: Flat, a: Flat, b: Flat, t: number) {
  for (let i = 0; i < out.bones.length; i++) out.bones[i] = a.bones[i] + (b.bones[i] - a.bones[i]) * t;
  out.lift = a.lift + (b.lift - a.lift) * t; out.spin = a.spin + (b.spin - a.spin) * t; out.yaw = a.yaw + (b.yaw - a.yaw) * t; return out;
}
/** Rest transforms are restored first, then each offset composes after the rest quaternion around the bone-local image of a world axis. */
export function applyFlat(rig: Rig, flat: Flat) {
  BONE_NAMES.forEach((name, index) => {
    const rest = rig.bones.get(name); if (!rest) return;
    const q = rest.bone.quaternion.copy(rest.quaternion), x = flat.bones[index * AXES], y = flat.bones[index * AXES + 1], z = flat.bones[index * AXES + 2];
    rest.bone.position.copy(rest.position);
    if (x) q.multiply(spinQ.setFromAxisAngle(rest.axes[0], x * RAD));
    if (z) q.multiply(spinQ.setFromAxisAngle(rest.axes[2], z * RAD));
    if (y) q.multiply(spinQ.setFromAxisAngle(rest.axes[1], y * RAD));
  });
  const root = rig.bones.get('root'); if (root) root.bone.position.y = root.position.y + flat.lift;
}
// ---- Authored pose vocabulary. Limb sides are "near" (toward camera) and "far"; z is outward.
type Limb = { ua?: [number, number?, number?]; fa?: number; hd?: number; th?: [number, number?]; sh?: number; ft?: number };
type Pose = { pelvis?: [number, number?, number?]; chest?: [number, number?, number?]; neck?: [number, number?]; head?: [number, number?, number?]; near?: Limb; far?: Limb; tail?: [number, number?]; lift?: number; spin?: number; yaw?: number };
const index = (name: BoneName) => BONE_NAMES.indexOf(name) * AXES;
function set(flat: Flat, name: BoneName, x = 0, y = 0, z = 0) { const i = index(name); flat.bones[i] = x; flat.bones[i + 1] = y; flat.bones[i + 2] = z; }
/** near/far → L/R by facing (facing +X puts the model's right side toward the camera). Outward z flips for the right side. */
export function flatten(pose: Pose, facing: number, out = emptyFlat()): Flat {
  const m = facing > 0 ? 1 : -1; // yaw and roll mirror with facing so the torso always turns toward the near side
  out.bones.fill(0); out.lift = pose.lift ?? 0; out.spin = pose.spin ?? 0; out.yaw = pose.yaw ?? 0;
  if (pose.pelvis) set(out, 'pelvis', pose.pelvis[0], (pose.pelvis[1] ?? 0) * m, (pose.pelvis[2] ?? 0) * m); if (pose.chest) set(out, 'chest', pose.chest[0], (pose.chest[1] ?? 0) * m, (pose.chest[2] ?? 0) * m);
  if (pose.neck) set(out, 'neck', pose.neck[0], (pose.neck[1] ?? 0) * m); if (pose.head) set(out, 'head', pose.head[0], (pose.head[1] ?? 0) * m, (pose.head[2] ?? 0) * m);
  if (pose.tail) { set(out, 'tail.01', pose.tail[0], (pose.tail[1] ?? 0) * m); set(out, 'tail.02', pose.tail[0] * .45, (pose.tail[1] ?? 0) * .8 * m); set(out, 'tail.03', pose.tail[0] * .3, (pose.tail[1] ?? 0) * .6 * m); }
  const side = (limb: Limb | undefined, suffix: 'L' | 'R') => {
    if (!limb) return; const s = suffix === 'L' ? 1 : -1;
    if (limb.ua) set(out, `upper_arm.${suffix}`, limb.ua[0], limb.ua[2] ?? 0, (limb.ua[1] ?? 0) * s); if (limb.fa) set(out, `forearm.${suffix}`, limb.fa); if (limb.hd) set(out, `hand.${suffix}`, limb.hd);
    if (limb.th) set(out, `thigh.${suffix}`, limb.th[0], 0, (limb.th[1] ?? 0) * s); if (limb.sh) set(out, `shin.${suffix}`, limb.sh); if (limb.ft) set(out, `foot.${suffix}`, limb.ft);
  };
  side(pose.near, facing > 0 ? 'R' : 'L'); side(pose.far, facing > 0 ? 'L' : 'R');
  return out;
}
const both = (limb: Limb): Pick<Pose, 'near' | 'far'> => ({ near: limb, far: limb });
export const IDLE: Pose = { pelvis: [2], chest: [1], ...both({ ua: [8, 6], fa: -25, th: [0, 3], sh: 6 }), tail: [4] };
const GUARD: Pose = { chest: [4], near: { ua: [-20, 8], fa: -80, th: [-6], sh: 14 }, far: { ua: [-5, 10], fa: -95, th: [6], sh: 14 }, tail: [8] };
export const FALL: Pose = { chest: [6], ...both({ ua: [-10, 70], fa: -20, th: [-8, 6], sh: 30, ft: -10 }), tail: [20] };
const RISE_POSE: Pose = { chest: [-6], near: { ua: [-10, 40], fa: -30, th: [-20], sh: 40 }, far: { ua: [-10, 40], fa: -30, th: [5], sh: 25 }, tail: [30], head: [-4] };
const SQUAT: Pose = { chest: [18], neck: [-6], ...both({ ua: [25, 10], fa: -30, th: [-40], sh: 75, ft: -20 }), lift: -.12, tail: [12] };
const LAND: Pose = { chest: [12], ...both({ ua: [-20, 12], fa: -35, th: [-25], sh: 50, ft: -15 }), lift: -.06, tail: [10] };
const HURT: Pose = { chest: [-25], neck: [-15], head: [-10], near: { ua: [-60, 30], fa: -20, th: [-30], sh: 40 }, far: { ua: [-60, 30], fa: -20, th: [20], sh: 40 }, tail: [40] };
const SHIELD: Pose = { chest: [10], head: [5], ...both({ ua: [-50, -25], fa: -90, th: [-15], sh: 35 }), tail: [6] };
const DODGE: Pose = { chest: [25], head: [10], ...both({ ua: [-40, 30], fa: -60, th: [-60], sh: 100 }), tail: [30] };
const CHARGE_SHAKE = 1.5;
type Strike = { wind: Pose; hit: Pose | ((p: number) => Pose) };
const STRIKES: Record<Move, Strike> = {
  jab: { wind: { chest: [4, -12], near: { ua: [20, 8], fa: -95 }, far: { ua: [-15, 10], fa: -80 }, tail: [6] }, hit: { chest: [8, 18], near: { ua: [-85, 4], fa: -8, th: [-15], sh: 12 }, far: { ua: [15, 10], fa: -80, th: [15], sh: 12 }, tail: [10] } },
  side: { wind: { chest: [10], near: { th: [25], sh: 60, ua: [-20, 12], fa: -50 }, far: { th: [-10], sh: 20, ua: [20, 8], fa: -40 }, tail: [12] }, hit: { chest: [-6], near: { th: [-88], sh: 4, ft: 10, ua: [35, 14], fa: -25 }, far: { th: [12], sh: 18, ua: [-25, 10], fa: -45 }, tail: [24] } },
  upper: { wind: { chest: [15], near: { th: [20], sh: 70, ua: [20, 14], fa: -40 }, far: { th: [-10], sh: 30, ua: [20, 14], fa: -40 }, lift: -.08, tail: [10] }, hit: { chest: [-22], neck: [-8], near: { th: [-150], sh: 8, ft: 20, ua: [30, 12], fa: -20 }, far: { th: [-8], sh: 20, ua: [30, 12], fa: -20 }, tail: [40] } },
  sweep: { wind: { chest: [25], ...both({ th: [-60], sh: 110, ua: [-20, 20], fa: -60 }), lift: -.25, tail: [15] }, hit: { chest: [28], head: [-6], near: { th: [-90], sh: 2, ft: 15, ua: [-30, 40], fa: -30 }, far: { th: [-50], sh: 120, ua: [-30, 40], fa: -30 }, lift: -.3, tail: [30, 20] } },
  smash: { wind: { chest: [-15], neck: [4], near: { th: [35], sh: 80, ua: [-70, 40], fa: -50 }, far: { th: [-12], sh: 25, ua: [-70, 40], fa: -50 }, tail: [16] }, hit: { chest: [16], near: { th: [-100], sh: 4, ft: 12, ua: [45, 20], fa: -20 }, far: { th: [15], sh: 20, ua: [45, 20], fa: -20 }, lift: .05, tail: [34] } },
  upsmash: { wind: { chest: [22], ...both({ th: [-35], sh: 90, ua: [15, 16], fa: -50 }), lift: -.14, tail: [12] }, hit: p => ({ chest: [-35], neck: [-10], near: { th: [-165], sh: 4, ft: 25, ua: [40, 20], fa: -15 }, far: { th: [-40], sh: 90, ua: [40, 20], fa: -15 }, spin: -30 * Math.sin(p * Math.PI), tail: [45] }) },
  downsmash: { wind: { chest: [20], ...both({ th: [-45], sh: 100, ua: [-30, 60], fa: -40 }), lift: -.22, tail: [10] }, hit: { chest: [10], near: { th: [-95], sh: 4, ft: 10, ua: [-60, 70], fa: -20 }, far: { th: [95], sh: -4, ft: -10, ua: [-60, 70], fa: -20 }, lift: -.26, tail: [20] } },
  aerial: { wind: { near: { th: [-40], sh: 90 }, far: { th: [5], sh: 30 }, chest: [8], tail: [20] }, hit: { chest: [-4], near: { th: [-75], sh: 6, ft: 8, ua: [-20, 50], fa: -30 }, far: { th: [12], sh: 40, ua: [-20, 50], fa: -30 }, tail: [30] } },
  forwardair: { wind: { chest: [10], ...both({ th: [-30], sh: 70, ua: [-30, 40], fa: -40 }), tail: [20] }, hit: p => { const k = Math.sin(p * Math.PI * 5); return { chest: [-18], near: { th: [-30 - 65 * Math.max(0, k)], sh: 10 + 40 * Math.max(0, -k), ua: [-25, 40], fa: -35 }, far: { th: [-30 - 65 * Math.max(0, -k)], sh: 10 + 40 * Math.max(0, k), ua: [-25, 40], fa: -35 }, tail: [35, 15 * k], spin: -25 * p }; } },
  backair: { wind: { chest: [12, 20], head: [0, -25], near: { th: [-20], sh: 60, ua: [-30, 20], fa: -60 }, far: { th: [5], sh: 25 }, tail: [16] }, hit: { chest: [-16, 25], head: [0, -35], near: { th: [100], sh: 4, ft: -10, ua: [-45, 15], fa: -30 }, far: { th: [-10], sh: 30, ua: [-45, 15], fa: -30 }, tail: [40] } },
  upair: { wind: { chest: [15], near: { th: [-45], sh: 100 }, far: { th: [0], sh: 30 }, tail: [20] }, hit: p => ({ chest: [-30], neck: [-6], near: { th: [-170], sh: 2, ft: 25, ua: [35, 20], fa: -20 }, far: { th: [-30], sh: 80, ua: [35, 20], fa: -20 }, spin: p > .45 ? -360 * (p - .45) / .55 : 0, tail: [45] }) },
  downair: { wind: { chest: [6], ...both({ th: [-25], sh: 60, ua: [-40, 50], fa: -40 }), tail: [20] }, hit: p => ({ chest: [4], ...both({ th: [-4], sh: 6, ft: 25, ua: [-60, 70], fa: -30 }), yaw: 720 * p, tail: [10] }) },
  dash: { wind: { chest: [18], ...both({ ua: [50, 20], fa: -20, th: [10], sh: 30 }), tail: [20] }, hit: { chest: [42], neck: [-10], head: [-14], ...both({ ua: [65, 12], fa: -10, th: [32], sh: 8, ft: 20 }), lift: .08, tail: [30] } },
  rise: { wind: { chest: [30], head: [20], ...both({ ua: [-60, 30], fa: -100, th: [-70], sh: 120 }), tail: [20] }, hit: { chest: [32], head: [24], ...both({ ua: [-65, 25], fa: -105, th: [-72], sh: 125 }), tail: [10] } },
  laser: { wind: { chest: [0, -10], near: { ua: [-88, 6], fa: -6, hd: -10 }, far: { ua: [20, 10], fa: -45 }, tail: [8] }, hit: p => ({ chest: [-3 * (1 - p), -8], near: { ua: [-84 - 14 * (1 - p), 6], fa: -22 * (1 - p) - 4, hd: -10 }, far: { ua: [20, 10], fa: -45 }, tail: [8] }) },
  reflect: { wind: { chest: [12], near: { ua: [-40, 10], fa: -10, th: [-20], sh: 40 }, far: { ua: [10, 12], fa: -40, th: [-20], sh: 40 }, lift: -.05, tail: [6] }, hit: { chest: [12], near: { ua: [-45, 10], fa: -8, th: [-20], sh: 42 }, far: { ua: [12, 12], fa: -40, th: [-20], sh: 42 }, lift: -.05, tail: [6] } },
};
const ease = (t: number) => 1 - (1 - t) * (1 - t);
/** Time-based state info the server does not send: how long the current mode has been shown. */
export type ActorClock = { modeSince: number; landing: number };
const merge = (a: Pose, b: Pose, t: number, facing: number, scratch: [Flat, Flat, Flat]) => mixFlat(scratch[2], flatten(a, facing, scratch[0]), flatten(b, facing, scratch[1]), t);
/** Authoritative fighter state → target flat pose. `seconds` only drives cycles and flourishes. */
export function targetPose(f: Fighter, clock: ActorClock, seconds: number, reduced: boolean, scratch: [Flat, Flat, Flat]): Flat {
  const facing = f.facing < 0 ? -1 : 1, falco = f.kind === 'falco', t = reduced ? 0 : seconds, stance = f.grounded ? (falco ? GUARD : IDLE) : FALL;
  if (f.mode === 'attack' && f.move) {
    const m = getMove(f.kind, f.move), s = STRIKES[f.move], frame = f.moveFrame;
    if (frame < m.startup) {
      const wind = flatten(s.wind, facing, scratch[1]);
      if (f.charge > 0) { const shake = reduced ? 0 : Math.sin(seconds * 40) * CHARGE_SHAKE * (f.charge / 60); wind.bones[index('chest')] += shake; wind.lift -= .04 * f.charge / 60; return mixFlat(scratch[2], wind, wind, 0); }
      return mixFlat(scratch[2], flatten(stance, facing, scratch[0]), wind, ease(Math.min(1, (frame + 1) / Math.max(1, m.startup))));
    }
    const hit = typeof s.hit === 'function' ? s.hit(Math.min(1, (frame - m.startup) / Math.max(1, m.active))) : s.hit;
    if (frame < m.startup + m.active) { const out = flatten(hit, facing, scratch[2]); if (falco && (f.move === 'upper' || f.move === 'upair' || f.move === 'aerial')) out.bones[index('chest')] -= 6; return out; }
    return merge(hit, stance, ease(Math.min(1, (frame - m.startup - m.active + 1) / Math.max(1, m.end - m.startup - m.active))), facing, scratch);
  }
  if (f.mode === 'hurt') return flatten(HURT, facing, scratch[2]);
  if (f.mode === 'shield') return flatten(SHIELD, facing, scratch[2]);
  if (f.mode === 'dodge') { const p = Math.min(1, (seconds - clock.modeSince) / .45); const out = flatten(DODGE, facing, scratch[2]); if (!f.grounded) out.spin = -360 * ease(p) * facing; return out; }
  if (f.mode === 'jumpsquat') return flatten(SQUAT, facing, scratch[2]);
  if (f.mode === 'landing') return merge(LAND, IDLE, ease(Math.min(1, (seconds - clock.modeSince) / .2)), facing, scratch);
  if (f.mode === 'respawn') return flatten({ ...both({ ua: [-20, 20], fa: -50, th: [-8], sh: 20 }), chest: [4], tail: [15, reduced ? 0 : 10 * Math.sin(seconds * 3)] }, facing, scratch[2]);
  if (f.mode === 'air' || !f.grounded) { const up = Math.max(0, Math.min(1, f.vy / 6)); return merge(FALL, RISE_POSE, up, facing, scratch); }
  if (f.mode === 'run' || Math.abs(f.vx) > .8) {
    const phase = reduced ? .9 : t * Math.PI * 2 * Math.min(3.2, 1.2 + Math.abs(f.vx) * .18), s = Math.sin(phase), c = Math.cos(phase);
    const knee = (swing: number) => 16 + 42 * (1 - swing) / 2 + 12 * Math.max(0, -c * swing);
    return flatten({ pelvis: [8, 5 * s], chest: [falco ? 10 : 7, -7 * s], neck: [-8], head: [-5],
      near: { th: [-40 * s], sh: knee(s), ft: -12 * s, ua: [38 * s, 10], fa: -72, hd: -12 }, far: { th: [40 * s], sh: knee(-s), ft: 12 * s, ua: [-38 * s, 10], fa: -72, hd: -12 },
      tail: [22, 9 * Math.sin(phase - .5)], lift: reduced ? 0 : .03 * Math.abs(s) }, facing, scratch[2]);
  }
  const breathe = reduced ? 0 : Math.sin(t * 1.6);
  const out = flatten(falco ? GUARD : IDLE, facing, scratch[2]); out.bones[index('chest')] += 1.6 * breathe; out.bones[index('head') + 1] = reduced ? 0 : Math.sin(t * .45) * 6; out.bones[index('tail.01') + 1] = reduced ? 0 : 12 * Math.sin(t * 1.3);
  return out;
}
