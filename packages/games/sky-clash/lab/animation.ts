// Authored presentation poses for the replacement Fox rig. These are not recovered game animations
// and never feed physics: root lift is a visual offset only.
import { Bone, PropertyBinding, Quaternion, Vector3, type Object3D } from 'three';
export type PoseId = 'idle' | 'run' | 'airborne';
export const POSES: { id: PoseId; label: string; note: string }[] = [
  { id: 'idle', label: 'Idle', note: 'Standing loop with breathing and tail sway.' },
  { id: 'run', label: 'Run', note: 'Stride cycle. Speed is a presentation choice, not run_animation_scaling.' },
  { id: 'airborne', label: 'Airborne', note: 'Held jump pose lifted above the pedestal for silhouette review.' },
];
export const BONE_NAMES = ['root', 'pelvis', 'chest', 'neck', 'head', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R', 'tail.01', 'tail.02', 'tail.03'] as const;
export type BoneName = typeof BONE_NAMES[number];
/** Degrees of right-hand rotation about the WORLD axes as they sit at rest (+X model left, +Y up, +Z forward), re-expressed in each bone's own frame.
 * Positive X tilts upright bones (spine, tail base) forward/up and swings hanging limbs backward; a knee or elbow bend is therefore +X. */
export type Offset = { x?: number; y?: number; z?: number };
export type Pose = { bones: Partial<Record<BoneName, Offset>>; rootLift: number };
type Rest = { bone: Bone; position: Vector3; quaternion: Quaternion; axes: [Vector3, Vector3, Vector3] };
export type Rig = { bones: Map<BoneName, Rest>; missing: string[] };
/** GLTFLoader strips [ ] . : / from node names (PropertyBinding.sanitizeNodeName), so 'upper_arm.L' loads as 'upper_armL'. Canonical keys stay intact; lookup compares sanitized forms. */
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
export function resetRig(rig: Rig) { for (const rest of rig.bones.values()) { rest.bone.position.copy(rest.position); rest.bone.quaternion.copy(rest.quaternion); } }
const spin = new Quaternion(), RAD = Math.PI / 180;
/** Preserves exported rest transforms: each offset is composed after the rest quaternion around the bone-local image of a world axis. */
export function applyPose(rig: Rig, pose: Pose) {
  resetRig(rig);
  for (const [name, offset] of Object.entries(pose.bones) as [BoneName, Offset][]) {
    const rest = rig.bones.get(name); if (!rest || !offset) continue;
    const q = rest.bone.quaternion;
    if (offset.x) q.multiply(spin.setFromAxisAngle(rest.axes[0], offset.x * RAD));
    if (offset.z) q.multiply(spin.setFromAxisAngle(rest.axes[2], offset.z * RAD));
    if (offset.y) q.multiply(spin.setFromAxisAngle(rest.axes[1], offset.y * RAD));
  }
  const root = rig.bones.get('root'); if (root) root.bone.position.y = root.position.y + pose.rootLift;
}
const tail = (lift: number, sway: number, phase: number): Pick<Pose['bones'], 'tail.01' | 'tail.02' | 'tail.03'> => ({
  'tail.01': { x: lift, y: sway * Math.sin(phase) }, 'tail.02': { x: lift * .45, y: sway * .9 * Math.sin(phase - .8) }, 'tail.03': { x: lift * .3, y: sway * .8 * Math.sin(phase - 1.6) },
});
/** Time-driven pose. Reduced motion freezes cycles at a readable frame and removes bobbing. */
export function poseAt(id: PoseId, seconds: number, reduced: boolean): Pose {
  const t = reduced ? 0 : seconds;
  if (id === 'run') {
    const phase = reduced ? .9 : t * Math.PI * 2 * 1.5, s = Math.sin(phase), c = Math.cos(phase);
    const knee = (swing: number) => 16 + 42 * (1 - swing) / 2 + 12 * Math.max(0, -c * swing);
    return { rootLift: reduced ? 0 : .03 * Math.abs(s), bones: {
      pelvis: { x: 9, y: 5 * s }, chest: { x: 7, y: -7 * s }, neck: { x: -8 }, head: { x: -5 },
      'thigh.L': { x: -40 * s }, 'shin.L': { x: knee(s) }, 'foot.L': { x: -12 * s }, 'thigh.R': { x: 40 * s }, 'shin.R': { x: knee(-s) }, 'foot.R': { x: 12 * s },
      'upper_arm.L': { x: 38 * s, z: 10 }, 'forearm.L': { x: -72 }, 'hand.L': { x: -12 }, 'upper_arm.R': { x: -38 * s, z: -10 }, 'forearm.R': { x: -72 }, 'hand.R': { x: -12 },
      ...tail(22, 9, phase - .5) } };
  }
  if (id === 'airborne') {
    const bob = reduced ? 0 : Math.sin(t * 2) * .03, sway = reduced ? 0 : 6;
    return { rootLift: .38 + bob, bones: {
      pelvis: { x: -6 }, chest: { x: -4 }, neck: { x: 5 }, head: { x: 4 },
      'thigh.L': { x: -32, z: 7 }, 'shin.L': { x: 58 }, 'foot.L': { x: -22 }, 'thigh.R': { x: 8, z: -7 }, 'shin.R': { x: 36 }, 'foot.R': { x: -26 },
      'upper_arm.L': { x: 22, z: 58 }, 'forearm.L': { x: -38 }, 'hand.L': { x: -8 }, 'upper_arm.R': { x: 22, z: -58 }, 'forearm.R': { x: -38 }, 'hand.R': { x: -8 },
      ...tail(34, sway, t * 1.4) } };
  }
  const breathe = reduced ? 0 : Math.sin(t * 1.6), look = reduced ? 0 : Math.sin(t * .45) * 7;
  return { rootLift: 0, bones: {
    pelvis: { z: reduced ? 0 : Math.sin(t * .8) * 1.5 }, chest: { x: 1.6 * breathe }, neck: { x: -1.2 * breathe }, head: { y: look, x: -.6 * breathe },
    'upper_arm.L': { z: 4 + 1.5 * breathe }, 'forearm.L': { x: -9 }, 'upper_arm.R': { z: -4 - 1.5 * breathe }, 'forearm.R': { x: -9 },
    ...tail(4 + 2 * breathe, reduced ? 0 : 12, t * 1.3) } };
}
