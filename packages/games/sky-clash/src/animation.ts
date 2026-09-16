// Authored fight animation for the replacement rigs. Poses are presentation only; timing follows the authoritative
// move frames. Convention (verified against the exported rest pose): degrees of right-hand rotation about the WORLD
// axes at rest, re-expressed per bone. +X tilts upright bones forward and swings hanging limbs backward, so knee bends
// are +X and elbow bends are -X. "Outward" z is positive for the left side and mirrored for the right.
import { Bone, PropertyBinding, Quaternion, Vector3, type Object3D } from 'three';
import { FIGHTERS, getMove, type Fighter, type Move } from './model';
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
// ---- Pose vocabulary. Limbs are "near" (toward camera) / "far", or explicit "right" / "left" for hand-held weapons. z is outward.
type Limb = { ua?: [number, number?, number?]; fa?: number; hd?: number; th?: [number, number?]; sh?: number; ft?: number };
type Pose = { pelvis?: [number, number?, number?]; chest?: [number, number?, number?]; neck?: [number, number?]; head?: [number, number?, number?]; near?: Limb; far?: Limb; right?: Limb; left?: Limb; tail?: [number, number?]; lift?: number; spin?: number; yaw?: number };
const index = (name: BoneName) => BONE_NAMES.indexOf(name) * AXES;
function set(flat: Flat, name: BoneName, x = 0, y = 0, z = 0) { const i = index(name); flat.bones[i] = x; flat.bones[i + 1] = y; flat.bones[i + 2] = z; }
/** near/far → L/R by facing (facing +X puts the model's right side toward the camera); yaw/roll mirror with facing so the torso turns toward the near side. */
export function flatten(pose: Pose, facing: number, out = emptyFlat()): Flat {
  const m = pose.right || pose.left ? 1 : facing > 0 ? 1 : -1; // weapon poses keep the torso turned toward hand.R on either facing
  out.bones.fill(0); out.lift = pose.lift ?? 0; out.spin = pose.spin ?? 0; out.yaw = pose.yaw ?? 0;
  if (pose.pelvis) set(out, 'pelvis', pose.pelvis[0], (pose.pelvis[1] ?? 0) * m, (pose.pelvis[2] ?? 0) * m); if (pose.chest) set(out, 'chest', pose.chest[0], (pose.chest[1] ?? 0) * m, (pose.chest[2] ?? 0) * m);
  if (pose.neck) set(out, 'neck', pose.neck[0], (pose.neck[1] ?? 0) * m); if (pose.head) set(out, 'head', pose.head[0], (pose.head[1] ?? 0) * m, (pose.head[2] ?? 0) * m);
  if (pose.tail) { set(out, 'tail.01', pose.tail[0], (pose.tail[1] ?? 0) * m); set(out, 'tail.02', pose.tail[0] * .45, (pose.tail[1] ?? 0) * .8 * m); set(out, 'tail.03', pose.tail[0] * .3, (pose.tail[1] ?? 0) * .6 * m); }
  const side = (limb: Limb | undefined, suffix: 'L' | 'R') => {
    if (!limb) return; const s = suffix === 'L' ? 1 : -1;
    if (limb.ua) set(out, `upper_arm.${suffix}`, limb.ua[0], limb.ua[2] ?? 0, (limb.ua[1] ?? 0) * s); if (limb.fa) set(out, `forearm.${suffix}`, limb.fa); if (limb.hd) set(out, `hand.${suffix}`, limb.hd);
    if (limb.th) set(out, `thigh.${suffix}`, limb.th[0], 0, (limb.th[1] ?? 0) * s); if (limb.sh) set(out, `shin.${suffix}`, limb.sh); if (limb.ft) set(out, `foot.${suffix}`, limb.ft);
  };
  side(pose.near, facing > 0 ? 'R' : 'L'); side(pose.far, facing > 0 ? 'L' : 'R'); side(pose.right, 'R'); side(pose.left, 'L');
  return out;
}
const both = (limb: Limb): Pick<Pose, 'near' | 'far'> => ({ near: limb, far: limb });
const ease = (t: number) => 1 - (1 - t) * (1 - t);
// ---- Shared body states.
export const IDLE: Pose = { pelvis: [2], chest: [1], ...both({ ua: [8, 6], fa: -25, th: [0, 3], sh: 6 }), tail: [4] };
const GUARD: Pose = { chest: [4], near: { ua: [-20, 8], fa: -80, th: [-6], sh: 14 }, far: { ua: [-5, 10], fa: -95, th: [6], sh: 14 }, tail: [8] };
const SWORD_IDLE: Pose = { chest: [3, 8], right: { ua: [-30, 12], fa: -35, hd: 10 }, left: { ua: [10, 10], fa: -40 }, near: { th: [-4], sh: 10 }, far: { th: [6], sh: 10 } };
const WIDE: Pose = { chest: [6], ...both({ ua: [10, 22], fa: -30, th: [0, 12], sh: 12 }), tail: [4] };
export const FALL: Pose = { chest: [6], ...both({ ua: [-10, 70], fa: -20, th: [-8, 6], sh: 30, ft: -10 }), tail: [20] };
const RISE_POSE: Pose = { chest: [-6], near: { ua: [-10, 40], fa: -30, th: [-20], sh: 40 }, far: { ua: [-10, 40], fa: -30, th: [5], sh: 25 }, tail: [30], head: [-4] };
const SQUAT: Pose = { chest: [18], neck: [-6], ...both({ ua: [25, 10], fa: -30, th: [-40], sh: 75, ft: -20 }), lift: -.12, tail: [12] };
const LAND: Pose = { chest: [12], ...both({ ua: [-20, 12], fa: -35, th: [-25], sh: 50, ft: -15 }), lift: -.06, tail: [10] };
const HURT: Pose = { chest: [-25], neck: [-15], head: [-10], near: { ua: [-60, 30], fa: -20, th: [-30], sh: 40 }, far: { ua: [-60, 30], fa: -20, th: [20], sh: 40 }, tail: [40] };
const SHIELD: Pose = { chest: [10], head: [5], ...both({ ua: [-50, -25], fa: -90, th: [-15], sh: 35 }), tail: [6] };
const DODGE: Pose = { chest: [25], head: [10], ...both({ ua: [-40, 30], fa: -60, th: [-60], sh: 100 }), tail: [30] };
// Body-only variants for the hand and sandbag rigs (limbs exist but read as fingers/cloth).
const BODY = { idle: { lift: .28 } as Pose, fall: { chest: [-12], lift: .1, ...both({ ua: [0, 40] }) } as Pose, hurt: { chest: [-40], spin: 25, lift: .2 } as Pose, shield: { chest: [20], lift: .15, ...both({ ua: [-30, -20] }) } as Pose, dodge: { chest: [30], lift: .25 } as Pose, squat: { chest: [15], lift: -.05 } as Pose, land: { chest: [10], lift: -.04 } as Pose };
// ---- Strike families. wind = startup pose, hit = active pose (or a function of active progress).
type Strike = { wind: Pose; hit: Pose | ((p: number) => Pose) };
type Family = Record<Move, Strike>;
const KICK: Family = {
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
const PUNCH: Family = {
  ...KICK,
  side: { wind: { chest: [6, -20], near: { ua: [40, 12], fa: -90 }, far: { ua: [-20, 10], fa: -60 }, tail: [8] }, hit: { chest: [12, 30], near: { ua: [-95, 0], fa: -4, th: [-20], sh: 14 }, far: { ua: [20, 12], fa: -70, th: [18], sh: 14 }, tail: [16] } },
  upper: { wind: { chest: [18], near: { ua: [50, 10], fa: -110 }, far: { ua: [-10, 12], fa: -50 }, ...both({ th: [-20], sh: 40 }), lift: -.1 }, hit: { chest: [-18], neck: [-8], near: { ua: [-175, 6], fa: -10, th: [-10], sh: 10 }, far: { ua: [20, 14], fa: -60, th: [10], sh: 20 }, lift: .08, tail: [20] } },
  smash: { wind: { chest: [-12, -35], near: { ua: [75, 20], fa: -120 }, far: { ua: [-40, 20], fa: -60 }, ...both({ th: [-15], sh: 30 }), tail: [10] }, hit: { chest: [22, 40], near: { ua: [-100, -4], fa: -2, hd: -10 }, far: { ua: [40, 14], fa: -60 }, lift: .04, tail: [26] } },
  downsmash: { wind: { chest: [15], ...both({ ua: [-120, 30], fa: -60, th: [-30], sh: 60 }), lift: -.1 }, hit: { chest: [45], neck: [-10], ...both({ ua: [-20, 40], fa: -20, th: [-50], sh: 100 }), lift: -.28, tail: [10] } },
  forwardair: { wind: { chest: [-10], ...both({ ua: [-160, 30], fa: -60, th: [-20], sh: 50 }) }, hit: p => ({ chest: [20 + 10 * p], near: { ua: [-70 + 30 * p, 10], fa: -10, th: [-15], sh: 30 }, far: { ua: [-140, 30], fa: -50, th: [10], sh: 40 }, tail: [20] }) },
  downair: { wind: { chest: [10], ...both({ ua: [-60, 50], fa: -40, th: [-40], sh: 80 }) }, hit: { chest: [6], ...both({ ua: [-120, 60], fa: -30, th: [0], sh: 4, ft: 30 }), lift: -.02, tail: [10] } },
  rise: { wind: { chest: [20], ...both({ ua: [40, 10], fa: -100, th: [-40], sh: 80 }), lift: -.08 }, hit: { chest: [-10], near: { ua: [-178, 4], fa: -6, th: [-30], sh: 60 }, far: { ua: [30, 12], fa: -60, th: [10], sh: 40 }, tail: [30] } },
  laser: { wind: { chest: [4, -15], near: { ua: [30, 10], fa: -110 }, far: { ua: [-10, 12], fa: -50 } }, hit: p => ({ chest: [8, 20 * (1 - p)], near: { ua: [-105 + 15 * p, 4], fa: -12, hd: -20 }, far: { ua: [10, 12], fa: -50 }, tail: [8] }) },
  reflect: { wind: { chest: [10], ...both({ ua: [-30, 40], fa: -60, th: [-20], sh: 40 }) }, hit: p => ({ chest: [8], ...both({ ua: [-40, 85], fa: -20, th: [-15], sh: 30 }), yaw: 720 * p, tail: [10] }) },
};
const SWORD: Family = {
  ...KICK,
  jab: { wind: { chest: [4, -20], right: { ua: [45, 15], fa: -60, hd: 10 }, left: { ua: [-20, 10], fa: -70 } }, hit: { chest: [10, 25], right: { ua: [-95, 5], fa: -4, hd: -10 }, left: { ua: [15, 14], fa: -60 }, near: { th: [-15], sh: 12 }, far: { th: [15], sh: 12 } } },
  side: { wind: { chest: [0, -30], right: { ua: [-30, 80], fa: -30 }, left: { ua: [-10, 20], fa: -60 } }, hit: { chest: [12, 30], right: { ua: [-100, -10], fa: -2, hd: -15 }, left: { ua: [30, 12], fa: -50 }, near: { th: [-25], sh: 20 }, far: { th: [20], sh: 16 }, lift: .02 } },
  upper: { wind: { chest: [14], right: { ua: [35, 10], fa: -20 }, left: { ua: [-10, 14], fa: -60 }, ...both({ th: [-15], sh: 30 }), lift: -.06 }, hit: { chest: [-14], neck: [-6], right: { ua: [-172, 8], fa: -4 }, left: { ua: [20, 14], fa: -60 }, near: { th: [-8], sh: 10 }, far: { th: [8], sh: 10 } } },
  sweep: { wind: { chest: [22], right: { ua: [-20, 20], fa: -20 }, left: { ua: [-20, 30], fa: -60 }, ...both({ th: [-55], sh: 105 }), lift: -.22 }, hit: { chest: [30], right: { ua: [-70, -10], fa: 0, hd: -10 }, left: { ua: [-30, 40], fa: -50 }, near: { th: [-85], sh: 4 }, far: { th: [-50], sh: 115 }, lift: -.28 } },
  smash: { wind: { chest: [-16, -20], neck: [4], right: { ua: [-165, 20], fa: -40 }, left: { ua: [-60, 30], fa: -60 }, ...both({ th: [-12], sh: 24 }) }, hit: { chest: [22, 30], right: { ua: [-82, -8], fa: 0, hd: -12 }, left: { ua: [40, 14], fa: -50 }, near: { th: [-30], sh: 18 }, far: { th: [22], sh: 12 }, lift: .05 } },
  upsmash: { wind: { chest: [20], right: { ua: [40, 12], fa: -30 }, left: { ua: [10, 14], fa: -60 }, ...both({ th: [-35], sh: 80 }), lift: -.12 }, hit: p => ({ chest: [-18 + 6 * Math.sin(p * Math.PI)], right: { ua: [-178, 4 - 20 * Math.sin(p * Math.PI)], fa: -2 }, left: { ua: [20, 14], fa: -50 }, ...both({ th: [-10], sh: 14 }), lift: .06 }) },
  downsmash: { wind: { chest: [18], right: { ua: [-40, 30], fa: -30 }, left: { ua: [-20, 30], fa: -60 }, ...both({ th: [-40], sh: 90 }), lift: -.16 }, hit: p => ({ chest: [26, 60 - 120 * p], right: { ua: [-80, -6], fa: 0, hd: -10 }, left: { ua: [-30, 40], fa: -40 }, ...both({ th: [-45], sh: 95 }), lift: -.2 }) },
  aerial: { wind: { chest: [6, -30], right: { ua: [-40, 60], fa: -30 } }, hit: p => ({ chest: [-4], right: { ua: [-95, 10], fa: -4 }, left: { ua: [-20, 40], fa: -40 }, ...both({ th: [-20], sh: 40 }), yaw: 360 * p }) },
  forwardair: { wind: { chest: [-12], right: { ua: [-170, 20], fa: -30 }, left: { ua: [-30, 40], fa: -50 }, ...both({ th: [-25], sh: 50 }) }, hit: p => ({ chest: [10 + 12 * p], right: { ua: [-140 + 90 * p, 4], fa: -2, hd: -8 }, left: { ua: [-20, 40], fa: -50 }, near: { th: [-30], sh: 40 }, far: { th: [10], sh: 40 } }) },
  backair: { wind: { chest: [8, 30], head: [0, -25], right: { ua: [-60, 30], fa: -60 }, ...both({ th: [-20], sh: 50 }) }, hit: { chest: [-6, -40], head: [0, -35], right: { ua: [115, 10], fa: -4, hd: 10 }, left: { ua: [-40, 20], fa: -40 }, near: { th: [20], sh: 30 }, far: { th: [-15], sh: 40 } } },
  upair: { wind: { chest: [12], right: { ua: [30, 40], fa: -40 }, ...both({ th: [-30], sh: 60 }) }, hit: p => ({ chest: [-20], right: { ua: [-175, 50 - 100 * p], fa: -2 }, left: { ua: [-20, 40], fa: -40 }, ...both({ th: [-25], sh: 50 }) }) },
  downair: { wind: { chest: [4], right: { ua: [-150, 10], fa: -40 }, ...both({ th: [-30], sh: 60 }) }, hit: { chest: [8], right: { ua: [2, 0], fa: 0, hd: 5 }, left: { ua: [-40, 60], fa: -30 }, ...both({ th: [-10], sh: 20, ft: 20 }), lift: -.02 } },
  dash: { wind: { chest: [16], right: { ua: [30, 20], fa: -60 }, left: { ua: [40, 20], fa: -20 }, ...both({ th: [10], sh: 30 }) }, hit: p => ({ chest: [36, 10], neck: [-10], right: { ua: [-90 + 30 * p, 0], fa: -4 }, left: { ua: [60, 12], fa: -10 }, ...both({ th: [30], sh: 8, ft: 20 }), lift: .08 }) },
  rise: { wind: { chest: [20], right: { ua: [40, 12], fa: -20 }, ...both({ th: [-45], sh: 90 }), lift: -.08 }, hit: { chest: [-12], right: { ua: [-178, 4], fa: -2 }, left: { ua: [30, 12], fa: -50 }, ...both({ th: [-30], sh: 60 }) } },
  laser: { wind: { chest: [-6, -15], right: { ua: [-70, 20], fa: -40 }, left: { ua: [-10, 12], fa: -60 } }, hit: p => ({ chest: [16 * p, 25 * p], right: { ua: [-90, 0], fa: -4, hd: -10 }, left: { ua: [20, 12], fa: -60 }, ...both({ th: [-12], sh: 16 }) }) },
  reflect: { wind: { chest: [-4], right: { ua: [-55, 25], fa: -80, hd: -10 }, left: { ua: [-30, 20], fa: -70 }, ...both({ th: [-12], sh: 24 }) }, hit: { chest: [-6], right: { ua: [-60, 25], fa: -85, hd: -10 }, left: { ua: [-35, 20], fa: -70 }, ...both({ th: [-14], sh: 28 }) } },
};
const ROUND: Family = {
  ...PUNCH,
  jab: { wind: { pelvis: [-8], chest: [-6], near: { ua: [30, 10] } }, hit: { pelvis: [14], chest: [10], near: { ua: [-80, 4], fa: -6 }, far: { ua: [20, 10] }, lift: .02 } },
  side: { wind: { chest: [-12], lift: -.04, ...both({ th: [-10], sh: 30 }) }, hit: { chest: [30], near: { th: [-70], sh: 10, ft: 10 }, far: { th: [15], sh: 20 }, lift: .08 } },
  upper: { wind: { chest: [15], lift: -.08, ...both({ th: [-30], sh: 60 }) }, hit: p => ({ chest: [-20], spin: -50 * Math.sin(p * Math.PI), lift: .18 * Math.sin(p * Math.PI), ...both({ ua: [-40, 50], th: [-20], sh: 40 }) }) },
  sweep: { wind: { chest: [15], lift: -.15 }, hit: p => ({ chest: [20], yaw: 360 * p, lift: -.18, ...both({ th: [-50], sh: 20, ft: 10 }) }) },
  smash: { wind: { chest: [-20], lift: -.05, ...both({ ua: [40, 20], th: [-10], sh: 30 }) }, hit: { chest: [34], near: { th: [-95], sh: 6, ft: 12, ua: [-30, 40] }, far: { th: [20], sh: 20, ua: [50, 20] }, lift: .1 } },
  upsmash: { wind: { chest: [18], lift: -.14, ...both({ th: [-35], sh: 80 }) }, hit: p => ({ chest: [-10], spin: -360 * p, lift: .25 * Math.sin(p * Math.PI), ...both({ ua: [-60, 60], th: [-30], sh: 60 }) }) },
  downsmash: { wind: { chest: [10], lift: -.12 }, hit: p => ({ chest: [6], yaw: 720 * p, lift: -.14, ...both({ th: [-85], sh: 4, ft: 15, ua: [-20, 80] }) }) },
  aerial: { wind: { chest: [6], ...both({ th: [-20], sh: 50 }) }, hit: p => ({ chest: [4], yaw: 360 * p, ...both({ ua: [-30, 75], th: [-30], sh: 20, ft: 10 }) }) },
  forwardair: { wind: { chest: [-10], ...both({ ua: [-40, 40] }) }, hit: p => ({ chest: [20], spin: -360 * p, ...both({ ua: [-60, 40], th: [-40], sh: 70 }) }) },
  backair: { wind: { chest: [10, 20], ...both({ th: [-15], sh: 40 }) }, hit: { chest: [-20, -20], near: { th: [95], sh: 6, ft: -10, ua: [-40, 30] }, far: { th: [-15], sh: 30, ua: [-40, 30] } } },
  upair: { wind: { chest: [12], ...both({ th: [-30], sh: 60 }) }, hit: p => ({ chest: [-24], spin: -360 * ease(p), ...both({ ua: [-30, 60], th: [-20], sh: 40 }) }) },
  downair: { wind: { chest: [8], ...both({ th: [-30], sh: 60 }) }, hit: p => ({ chest: [4], yaw: 900 * p, ...both({ th: [-6], sh: 8, ft: 25, ua: [-70, 60] }) }) },
  dash: { wind: { chest: [20], lift: -.04 }, hit: p => ({ chest: [30], spin: -720 * p, lift: .1, ...both({ ua: [-30, 20], th: [-40], sh: 80 }) }) },
  rise: { wind: { chest: [15], lift: -.06, ...both({ th: [-40], sh: 80 }) }, hit: p => ({ chest: [-6], yaw: 360 * p, lift: .06, ...both({ ua: [-80, 70], fa: -20, th: [-20], sh: 40 }) }) },
  laser: { wind: { chest: [-14], neck: [-10], head: [-8], lift: .02 }, hit: p => ({ chest: [12 - 8 * p], neck: [8], head: [10], ...both({ ua: [-20, 40] }) }) },
  reflect: { wind: { chest: [20], lift: -.1, ...both({ th: [-40], sh: 80, ua: [-30, 20], fa: -60 }) }, hit: { chest: [26], lift: -.16, ...both({ th: [-70], sh: 120, ua: [-50, 10], fa: -100 }) } },
};
const HAND: Family = {
  jab: { wind: { chest: [-20], lift: .3 }, hit: { chest: [35], lift: .22, ...both({ ua: [-20, 0] }) } },
  side: { wind: { chest: [0, 50], lift: .3 }, hit: p => ({ chest: [10, 50 - 110 * p], lift: .28, ...both({ ua: [-10, 20] }) }) },
  upper: { wind: { chest: [30], lift: .15 }, hit: { chest: [-45], lift: .55, ...both({ ua: [-40, 30] }) } },
  sweep: { wind: { chest: [20], lift: .1 }, hit: p => ({ chest: [40], yaw: 200 * p, lift: -.02 }) },
  smash: { wind: { chest: [-30, -30], spin: 40, lift: .35 }, hit: { chest: [50, 20], spin: -30, lift: .18, ...both({ ua: [-30, 0] }) } },
  upsmash: { wind: { chest: [25], lift: .05 }, hit: p => ({ chest: [-30], spin: -90 * Math.sin(p * Math.PI), lift: .2 + .55 * Math.sin(p * Math.PI) }) },
  downsmash: { wind: { chest: [-20], lift: .7 }, hit: p => ({ chest: [60], lift: .7 - .75 * ease(p), ...both({ ua: [-20, 30] }) }) },
  aerial: { wind: { lift: .3 }, hit: p => ({ yaw: 360 * p, lift: .3, ...both({ ua: [0, 45] }) }) },
  forwardair: { wind: { chest: [-20], lift: .3 }, hit: p => ({ chest: [30], spin: -360 * p, lift: .3 }) },
  backair: { wind: { chest: [0, 40], lift: .3 }, hit: { chest: [-20, -80], lift: .3, ...both({ ua: [30, 0] }) } },
  upair: { wind: { chest: [20], lift: .3 }, hit: p => ({ chest: [-50], spin: -360 * ease(p), lift: .4 }) },
  downair: { wind: { chest: [-10], lift: .4 }, hit: { chest: [70], lift: .1, ...both({ ua: [-30, 20] }) } },
  dash: { wind: { chest: [10], lift: .3 }, hit: { chest: [60], lift: .3, ...both({ ua: [20, 0] }) } },
  rise: { wind: { chest: [20], lift: .1 }, hit: { chest: [-30], lift: .6, ...both({ ua: [-30, 40] }) } },
  laser: { wind: { chest: [-10], lift: .3, near: { ua: [-90, 0], fa: -4 } }, hit: p => ({ chest: [4 * (1 - p)], lift: .3, near: { ua: [-92, 0], fa: -10 * (1 - p) } }) },
  reflect: { wind: { chest: [-30], lift: .6 }, hit: { chest: [70], lift: -.02, ...both({ ua: [-20, 40] }) } },
};
const BAG: Family = {
  jab: { wind: { chest: [-10] }, hit: { chest: [26], lift: .02 } },
  side: { wind: { chest: [-16], lift: -.02 }, hit: { chest: [42], lift: .1 } },
  upper: { wind: { chest: [15], lift: -.08 }, hit: { chest: [-22], lift: .22 } },
  sweep: { wind: { chest: [10], lift: -.1 }, hit: p => ({ chest: [28], yaw: 180 * p, lift: -.16 }) },
  smash: { wind: { chest: [-35], lift: -.04 }, hit: { chest: [62], lift: .06 } },
  upsmash: { wind: { chest: [20], lift: -.14 }, hit: p => ({ chest: [-10], lift: .4 * Math.sin(p * Math.PI), spin: -20 * Math.sin(p * Math.PI) }) },
  downsmash: { wind: { chest: [-10], lift: .1 }, hit: { chest: [6], lift: -.26 } },
  aerial: { wind: {}, hit: p => ({ spin: -360 * p }) },
  forwardair: { wind: { chest: [-15] }, hit: p => ({ chest: [35], spin: -180 * p }) },
  backair: { wind: { chest: [10] }, hit: p => ({ chest: [-40], spin: 200 * p }) },
  upair: { wind: { chest: [15] }, hit: p => ({ chest: [-30], spin: -360 * ease(p) }) },
  downair: { wind: { chest: [-10], lift: .05 }, hit: { chest: [45], lift: -.04 } },
  dash: { wind: { chest: [15] }, hit: p => ({ chest: [30], spin: -720 * p, lift: .08 }) },
  rise: { wind: { chest: [12], lift: -.1 }, hit: p => ({ chest: [-10], lift: .35 + .1 * Math.sin(p * Math.PI * 3) }) },
  laser: { wind: { chest: [-8] }, hit: p => ({ chest: [10 * Math.sin(p * Math.PI * 4)], lift: .02 }) },
  reflect: { wind: { chest: [-12], lift: .12 }, hit: { chest: [20], lift: -.2 } },
};
const MAGIC: Family = {
  ...KICK,
  jab: { wind: { chest: [0, -15], near: { ua: [30, 20], fa: -70, hd: -20 } }, hit: { chest: [6, 20], near: { ua: [-85, 15], fa: -20, hd: -20 }, far: { ua: [10, 20], fa: -40 } } },
  side: { wind: { chest: [-8, -25], ...both({ ua: [40, 30], fa: -50 }) }, hit: { chest: [14, 25], near: { th: [-30], sh: 20, ua: [-70, 30], fa: -20, hd: -10 }, far: { th: [15], sh: 15, ua: [-70, 30], fa: -20, hd: -10 } } },
  upper: { wind: { chest: [10], ...both({ ua: [20, 30], fa: -60 }) }, hit: p => ({ chest: [-6], yaw: 360 * p, ...both({ ua: [-120, 70], fa: -30 }) }) },
  smash: { wind: { chest: [-14, -40], near: { ua: [80, 30], fa: -60 }, far: { ua: [-40, 30], fa: -60 } }, hit: p => ({ chest: [16, 30], near: { ua: [-130 + 60 * p, 10], fa: -8, hd: -10 }, far: { ua: [30, 20], fa: -50 } }) },
  upsmash: { wind: { chest: [15], ...both({ ua: [30, 30], fa: -80, th: [-25], sh: 50 }), lift: -.1 }, hit: { chest: [-16], ...both({ ua: [-175, 15], fa: -6, th: [-8], sh: 10 }), lift: .06 } },
  downsmash: { wind: { chest: [10], ...both({ ua: [-40, 20], fa: -60, th: [-30], sh: 60 }), lift: -.1 }, hit: p => ({ chest: [8], yaw: 360 * p, ...both({ ua: [-40, 88], fa: -10, th: [-20], sh: 40 }), lift: -.12 }) },
  dash: { wind: { chest: [10], ...both({ ua: [30, 40], fa: -30 }) }, hit: { chest: [26], ...both({ ua: [70, 30], fa: -10, th: [20], sh: 10, ft: 20 }), lift: .12 } },
  rise: { wind: { chest: [10], ...both({ ua: [-40, 40], fa: -60, th: [-30], sh: 60 }) }, hit: p => ({ chest: [-8], ...both({ ua: [-150, 60], fa: -20, th: [-15], sh: 30, ft: 20 }), lift: .04 + .03 * Math.sin(p * Math.PI * 4) }) },
  laser: { wind: { chest: [-6, -10], ...both({ ua: [20, 20], fa: -90 }) }, hit: p => ({ chest: [10 - 6 * p, 6], ...both({ ua: [-92, 12], fa: -6, hd: -12 }) }) },
  reflect: { wind: { chest: [4], ...both({ ua: [-40, -10], fa: -80 }) }, hit: p => ({ chest: [2], ...both({ ua: [-60, -25 + 40 * Math.sin(p * Math.PI)], fa: -90 }), lift: .04 }) },
};
/** Signature specials that read differently from the family default. Slots: laser=neutral, dash=side, rise=up, reflect=down. */
const OVERRIDES: Record<string, Partial<Family>> = {
  brawler: { laser: { wind: { chest: [-14, -45], near: { ua: [95, 25], fa: -130 }, far: { ua: [-40, 20], fa: -60 }, ...both({ th: [-15], sh: 30 }), lift: -.04 }, hit: { chest: [26, 45], near: { ua: [-100, -6], fa: -2, hd: -10 }, far: { ua: [40, 14], fa: -60 } } },
    reflect: { wind: { chest: [10], ...both({ th: [-30], sh: 60 }) }, hit: { chest: [-10], near: { th: [-95], sh: 4, ft: 15, ua: [-30, 30], fa: -40 }, far: { th: [30], sh: 10, ua: [40, 20], fa: -30 }, lift: .06 } } },
  armored: { laser: { wind: { chest: [2, 10], right: { ua: [-80, 6], fa: -10 }, left: { ua: [20, 12], fa: -60 } }, hit: p => ({ chest: [-4 * (1 - p), 10], right: { ua: [-86, 4], fa: -6 - 10 * (1 - p) }, left: { ua: [20, 12], fa: -60 } }) },
    rise: { wind: { chest: [15], ...both({ th: [-40], sh: 80, ua: [-40, 60], fa: -40 }), lift: -.08 }, hit: p => ({ chest: [-4], yaw: 720 * p, ...both({ ua: [-120, 85], fa: -10, th: [-20], sh: 40 }) }) } },
  heavy: { sweep: { wind: { chest: [20], near: { th: [-80], sh: 100 }, far: { th: [-10], sh: 20 }, lift: -.1 }, hit: { chest: [30], near: { th: [-10], sh: 10, ft: 30, ua: [-40, 40], fa: -40 }, far: { th: [-20], sh: 40, ua: [-40, 40], fa: -40 }, lift: -.16 } },
    reflect: { wind: { chest: [-10], ...both({ ua: [-150, 30], fa: -30, th: [-30], sh: 60 }), lift: .1 }, hit: { chest: [40], ...both({ ua: [-30, 40], fa: -20, th: [-60], sh: 110 }), lift: -.3 } },
    rise: { wind: { chest: [15], ...both({ ua: [20, 40], fa: -40, th: [-30], sh: 60 }) }, hit: p => ({ chest: [-6], yaw: 540 * p, ...both({ ua: [-95, 88], fa: -10, th: [-10], sh: 20 }) }) } },
  alien: { laser: { wind: { chest: [-8, -10], ...both({ ua: [-60, 30], fa: -100 }) }, hit: p => ({ chest: [6, 10], ...both({ ua: [-92, 18 - 10 * p], fa: -10 }), lift: .05 }) },
    rise: { wind: { chest: [10], ...both({ ua: [-40, 60], fa: -60 }), lift: .05 }, hit: p => ({ chest: [-10], ...both({ ua: [-140, 70], fa: -40, th: [-25], sh: 50 }), lift: .1, yaw: 180 * Math.sin(p * Math.PI) }) },
    reflect: { wind: { chest: [-6], near: { ua: [-70, 10], fa: -60, hd: -20 } }, hit: { chest: [8], neck: [10], head: [12], near: { ua: [-95, 6], fa: -6, hd: -30 }, far: { ua: [20, 14], fa: -60 } } } },
  plumber: { reflect: { wind: { chest: [8], ...both({ ua: [-30, 40], fa: -60, th: [-20], sh: 40 }) }, hit: p => ({ chest: [6], yaw: 900 * p, ...both({ ua: [-40, 88], fa: -15, th: [-10], sh: 20 }), lift: .03 * Math.sin(p * Math.PI * 6) }) } },
  doctor: { reflect: { wind: { chest: [8], ...both({ ua: [-30, 40], fa: -60, th: [-20], sh: 40 }) }, hit: p => ({ chest: [6], yaw: 900 * p, ...both({ ua: [-40, 88], fa: -15, th: [-10], sh: 20 }), lift: .03 * Math.sin(p * Math.PI * 6) }) } },
  ninja: { rise: { wind: { chest: [30], ...both({ ua: [-60, -20], fa: -100, th: [-60], sh: 110 }), lift: -.05 }, hit: p => ({ chest: [-10], ...both({ ua: [-100, 70], fa: -20, th: [-20], sh: 40 }), lift: .08, spin: -60 * Math.sin(p * Math.PI) }) } },
  child: { laser: { wind: { chest: [-10], ...both({ ua: [-40, 20], fa: -90 }) }, hit: p => ({ chest: [4], neck: [-10], head: [-12], ...both({ ua: [-160, 30 * p], fa: -20 }) }) },
    rise: { wind: { chest: [10], near: { ua: [-90, 20], fa: -40 } }, hit: p => ({ chest: [-8], near: { ua: [-170, 20 * Math.sin(p * Math.PI * 4)], fa: -10 }, far: { ua: [20, 12], fa: -60 }, ...both({ th: [-15], sh: 30 }) }) } },
  dinosaur: { laser: { wind: { chest: [-6], neck: [-14], head: [-10] }, hit: p => ({ chest: [14 - 6 * p], neck: [14], head: [12], ...both({ ua: [-20, 30] }) }) },
    dash: { wind: { chest: [20], ...both({ th: [-30], sh: 70 }) }, hit: p => ({ chest: [30], spin: -720 * p, ...both({ ua: [-30, 20], fa: -60, th: [-60], sh: 110 }), lift: .1 }) } },
  wire: { laser: { wind: { chest: [-10, -30], near: { ua: [60, 20], fa: -110 } }, hit: { chest: [20, 35], near: { ua: [-100, -4], fa: -2 }, far: { ua: [40, 14], fa: -60 } } } },
};
const FAMILY: Record<string, Family> = { pilot: KICK, brawler: KICK, ninja: KICK, dinosaur: KICK, plumber: PUNCH, doctor: PUNCH, heavy: PUNCH, armored: PUNCH, alien: PUNCH, wire: PUNCH, flat: PUNCH, child: PUNCH, sword: SWORD, climber: SWORD, royal: MAGIC, round: ROUND, rodent: ROUND, hand: HAND, bag: BAG };
export const strikeFor = (style: string, move: Move): Strike => OVERRIDES[style]?.[move] ?? (FAMILY[style] ?? KICK)[move];
/** Blend responsiveness per style: ninja and flat snap, heavies settle. */
export const blendRate = (style: string) => style === 'ninja' || style === 'flat' ? 1.6 : style === 'heavy' ? .75 : 1;
export type ActorClock = { modeSince: number; landing: number };
const merge = (a: Pose, b: Pose, t: number, facing: number, scratch: [Flat, Flat, Flat]) => mixFlat(scratch[2], flatten(a, facing, scratch[0]), flatten(b, facing, scratch[1]), t);
const CHARGE_SHAKE = 1.5;
/** Authoritative fighter state → target flat pose. `seconds` only drives cycles and flourishes. */
export function targetPose(f: Fighter, clock: ActorClock, seconds: number, reduced: boolean, scratch: [Flat, Flat, Flat]): Flat {
  const facing = f.facing < 0 ? -1 : 1, meta = FIGHTERS[f.kind], style = meta.style, t = reduced ? 0 : seconds, body = style === 'hand' || style === 'bag', sword = style === 'sword' || style === 'climber';
  const stance: Pose = body ? BODY.idle : f.grounded ? (sword ? SWORD_IDLE : style === 'heavy' || style === 'armored' ? WIDE : style === 'pilot' && f.kind === 'falco' ? GUARD : IDLE) : (body ? BODY.fall : FALL);
  if (f.mode === 'attack' && f.move) {
    const m = getMove(f.kind, f.move), s = strikeFor(style, f.move), frame = f.moveFrame;
    if (frame < m.startup) {
      const wind = flatten(s.wind, facing, scratch[1]);
      if (f.charge > 0) { const shake = reduced ? 0 : Math.sin(seconds * 40) * CHARGE_SHAKE * (f.charge / 60); wind.bones[index('chest')] += shake; wind.lift -= .04 * f.charge / 60; return mixFlat(scratch[2], wind, wind, 0); }
      return mixFlat(scratch[2], flatten(stance, facing, scratch[0]), wind, ease(Math.min(1, (frame + 1) / Math.max(1, m.startup))));
    }
    const hit = typeof s.hit === 'function' ? s.hit(Math.min(1, (frame - m.startup) / Math.max(1, m.active))) : s.hit;
    if (frame < m.startup + m.active) return flatten(hit, facing, scratch[2]);
    return merge(hit, stance, ease(Math.min(1, (frame - m.startup - m.active + 1) / Math.max(1, m.end - m.startup - m.active))), facing, scratch);
  }
  if (f.mode === 'hurt') return flatten(body ? BODY.hurt : HURT, facing, scratch[2]);
  if (f.mode === 'shield') return flatten(body ? BODY.shield : SHIELD, facing, scratch[2]);
  if (f.mode === 'dodge') { const p = Math.min(1, (seconds - clock.modeSince) / .45); const out = flatten(body ? BODY.dodge : DODGE, facing, scratch[2]); if (!f.grounded) out.spin = -360 * ease(p) * facing; return out; }
  if (f.mode === 'jumpsquat') return flatten(body ? BODY.squat : SQUAT, facing, scratch[2]);
  if (f.mode === 'landing') return merge(body ? BODY.land : LAND, stance, ease(Math.min(1, (seconds - clock.modeSince) / .2)), facing, scratch);
  if (f.mode === 'respawn') return flatten(body ? { ...BODY.idle, chest: [reduced ? 0 : 4 * Math.sin(seconds * 2)] } : { ...both({ ua: [-20, 20], fa: -50, th: [-8], sh: 20 }), chest: [4], tail: [15, reduced ? 0 : 10 * Math.sin(seconds * 3)] }, facing, scratch[2]);
  if (f.mode === 'air' || !f.grounded) { if (body) return flatten({ ...BODY.fall, lift: BODY.fall.lift! + Math.max(0, Math.min(.15, f.vy * .02)) }, facing, scratch[2]); return merge(FALL, RISE_POSE, Math.max(0, Math.min(1, f.vy / 6)), facing, scratch); }
  if (f.mode === 'run' || Math.abs(f.vx) > .8) {
    const heavy = style === 'heavy', hop = style === 'round' || style === 'rodent' || style === 'bag', rate = heavy ? .75 : hop ? 1.15 : 1, phase = reduced ? .9 : t * Math.PI * 2 * Math.min(3.2, 1.2 + Math.abs(f.vx) * .18) * rate, s = Math.sin(phase), c = Math.cos(phase);
    if (body) return flatten({ chest: [style === 'hand' ? 20 : 18 + 6 * s], lift: (style === 'hand' ? .32 : 0) + (reduced ? 0 : Math.abs(s) * .12) }, facing, scratch[2]);
    const knee = (swing: number) => 16 + 42 * (1 - swing) / 2 + 12 * Math.max(0, -c * swing), swing = hop ? 24 : 40;
    return flatten({ pelvis: [heavy ? 12 : 8, 5 * s], chest: [heavy ? 12 : 7, -7 * s], neck: [-8], head: [-5],
      near: { th: [-swing * s], sh: knee(s), ft: -12 * s, ua: [sword ? 10 : 38 * s, 10], fa: sword ? -40 : -72, hd: -12 }, far: { th: [swing * s], sh: knee(-s), ft: 12 * s, ua: [-38 * s, 10], fa: -72, hd: -12 },
      right: sword ? { ua: [-20, 14], fa: -40, hd: 10 } : undefined, tail: [22, 9 * Math.sin(phase - .5)], lift: reduced ? 0 : (heavy ? .06 : hop ? .09 : .03) * Math.abs(s) }, facing, scratch[2]);
  }
  const breathe = reduced ? 0 : Math.sin(t * 1.6);
  const out = flatten(stance, facing, scratch[2]);
  if (body) { out.lift += reduced ? 0 : Math.sin(t * 1.4) * (style === 'hand' ? .05 : .015); out.bones[index('chest')] += 3 * breathe; return out; }
  out.bones[index('chest')] += 1.6 * breathe; out.bones[index('head') + 1] = reduced ? 0 : Math.sin(t * .45) * 6; out.bones[index('tail.01') + 1] = reduced ? 0 : 12 * Math.sin(t * 1.3);
  return out;
}
