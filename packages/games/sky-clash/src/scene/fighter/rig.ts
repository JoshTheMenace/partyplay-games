/**
 * Procedural rig over the contract bones. Rest data is captured once per actor in model space (the fighter clone's own
 * frame), so the solve is independent of where the actor stands, how it faces or how it is squashed. Each frame:
 * torso FK in model axes, hips offset, two-bone IK with pole vectors for all four limbs (hands from the shoulder in the
 * chest frame, ankles from rest in the body frame), planted feet, an aimable prop, then optional reach toward a hitbox.
 * Master Hand and Crazy Hand skip limb IK and curl their chains instead. Springs on extra_* chains run in world space.
 */
import { Matrix4, Quaternion, Vector3, type Bone, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { BONES, EXTRA_BONE_PREFIX, type BoneName, type Limb } from '../../model';
import { SCALAR, TORSO, VEC, type Dense } from './pose';

type Chain = { upper: Bone; lower: Bone; end: Bone; l1: number; l2: number; dir1: Vector3; dir2: Vector3; pole: Vector3; side: 1 | -1 };
type Spring = { bone: Bone; tip: Vector3; pos: Vector3; prev: Vector3; len: number; stiff: number; fresh: boolean };
/** A reach request in model space: a hitbox point the named limb should touch, with 0–1 weight. */
export type Reach = { limb: Limb; target: Vector3; weight: number };
export type SolveOptions = { hand?: boolean; reach?: Reach | null; hands?: { target: Vector3; weight: number } | null };

const RAD = Math.PI / 180;
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), v4 = new Vector3(), v5 = new Vector3(), vt = new Vector3(), vp = new Vector3(), vd1 = new Vector3(), vd2 = new Vector3(), vn = new Vector3();
const q1 = new Quaternion(), q2 = new Quaternion(), q3 = new Quaternion(), q4 = new Quaternion(), qf = new Quaternion(), qt = new Quaternion();
const a1 = new Vector3(), a2 = new Vector3(), a3 = new Vector3(), a4 = new Vector3(), am1 = new Matrix4(), am2 = new Matrix4(), m1 = new Matrix4(), ws = new Vector3(), wp = new Vector3();
const X = new Vector3(1, 0, 0);

/** Rotation taking the orthonormalized frame (d, p) onto (n, q). */
export function align(out: Quaternion, d: Vector3, p: Vector3, n: Vector3, q: Vector3) {
  const a = a1.copy(p).addScaledVector(d, -p.dot(d)), b = a2.copy(q).addScaledVector(n, -q.dot(n));
  if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) return out.setFromUnitVectors(d, n);
  a.normalize(); b.normalize();
  am1.makeBasis(d, a, a3.crossVectors(d, a)); am2.makeBasis(n, b, a4.crossVectors(n, b));
  return out.setFromRotationMatrix(am2.multiply(am1.transpose()));
}

export class Rig {
  readonly bones: Partial<Record<BoneName, Bone>> = {};
  readonly missing: BoneName[] = [];
  readonly arms: (Chain | null)[]; readonly legs: (Chain | null)[];
  readonly legLen: number; readonly armLen: number; readonly hipY: number; readonly headY: number; readonly size: number;
  /** Prop tip in the weapon hand's rest frame (model units), when the prop has geometry. */
  readonly blade: Vector3 | null = null; readonly bladeLen: number = 0; readonly weaponLeft: boolean = false;
  private restQ = new Map<Object3D, Quaternion>(); private restP = new Map<Object3D, Vector3>();
  private restM = new Map<Object3D, Quaternion>(); private restMP = new Map<Object3D, Vector3>();
  private springs: Spring[] = [];
  private driven: Bone[] = [];
  private snapQ: Quaternion[] = []; private snapHips = new Vector3();
  /** Model-space matrix of the clone's parent chain inverse (world → model), set at the start of solve(). */
  private toModel = new Matrix4();

  constructor(readonly model: Object3D) {
    model.updateWorldMatrix(true, true);
    const toModel = m1.copy(model.matrixWorld).invert(), byName = new Map<string, Bone>();
    model.traverse(o => {
      if ((o as Bone).isBone && !byName.has(o.name)) byName.set(o.name, o as Bone);
      this.restQ.set(o, o.quaternion.clone()); this.restP.set(o, o.position.clone());
      const m = new Matrix4().multiplyMatrices(toModel, o.matrixWorld), q = new Quaternion(), p = new Vector3();
      m.decompose(p, q, ws); this.restM.set(o, q); this.restMP.set(o, p);
    });
    for (const name of BONES) { const bone = byName.get(name); if (bone) this.bones[name] = bone; else this.missing.push(name); }
    const b = this.bones, P = (o?: Object3D) => o ? this.restMP.get(o)! : new Vector3();
    const chain = (upper: BoneName, lower: BoneName, end: BoneName, pole: Vector3, side: 1 | -1): Chain | null => {
      const u = b[upper], l = b[lower], e = b[end];
      if (!u || !l || !e) return null;
      const d1 = P(l).clone().sub(P(u)), d2 = P(e).clone().sub(P(l));
      if (d1.lengthSq() < 1e-8 || d2.lengthSq() < 1e-8) return null;
      return { upper: u, lower: l, end: e, l1: d1.length(), l2: d2.length(), dir1: d1.normalize(), dir2: d2.normalize(), pole, side };
    };
    this.arms = [chain('upperarm_L', 'forearm_L', 'hand_L', new Vector3(0, 0, -1), 1), chain('upperarm_R', 'forearm_R', 'hand_R', new Vector3(0, 0, -1), -1)];
    this.legs = [chain('thigh_L', 'shin_L', 'foot_L', new Vector3(0, 0, 1), 1), chain('thigh_R', 'shin_R', 'foot_R', new Vector3(0, 0, 1), -1)];
    const len = (list: (Chain | null)[], fallback: number) => { const ok = list.filter((c): c is Chain => !!c); return ok.length ? ok.reduce((s, c) => s + c.l1 + c.l2, 0) / ok.length : fallback; };
    this.hipY = P(b.hips).y || .5; this.legLen = Math.max(.05, len(this.legs, this.hipY * .9)); this.armLen = Math.max(.05, len(this.arms, this.legLen * .8));
    this.headY = P(b.head).y || this.hipY * 1.8; this.size = Math.max(this.headY, this.hipY * 1.6);
    // The prop follows whichever hand is its ancestor (Link and Young Link are left-handed).
    let owner: Object3D | null = b.prop?.parent ?? null;
    while (owner && owner !== b.hand_L && owner !== b.hand_R) owner = owner.parent;
    this.weaponLeft = !!owner && owner === b.hand_L;
    const hand = this.weaponLeft ? b.hand_L : b.hand_R, tip = b.prop && hand ? this.propTip(model, b.prop, toModel) : null;
    if (tip && hand) {
      const dir = tip.clone().sub(P(hand));
      if (dir.length() > this.armLen * .25) { this.bladeLen = dir.length(); this.blade = dir.applyQuaternion(this.restM.get(hand)!.clone().invert()); }
    }
    this.driven = ([...TORSO, 'shoulder_L', 'shoulder_R', 'upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'prop'] as BoneName[])
      .map(n => b[n]).filter((x): x is Bone => !!x);
    this.snapQ = this.driven.map(() => new Quaternion());
    this.captureSprings(byName);
  }

  get springCount() { return this.springs.length; }
  get bonesDriven(): readonly Bone[] { return this.driven; }
  restPosition(name: BoneName) { const bone = this.bones[name]; return bone ? this.restMP.get(bone)! : null; }

  private mq(o: Object3D, out: Quaternion) { m1.multiplyMatrices(this.toModel, o.matrixWorld).decompose(wp, out, ws); return out; }
  private mp(o: Object3D, out: Vector3) { return out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(this.toModel); }
  /** Rotation mapping model rest axes onto a bone's current carried frame (model space). */
  private carried(o: Object3D, out: Quaternion) { return this.mq(o, out).multiply(q4.copy(this.restM.get(o)!).invert()); }
  private update(o: Object3D) { o.updateWorldMatrix(false, true); }

  /** Farthest prop-weighted vertex from the prop bone (bind pose, model space): the blade/hammer tip. */
  private propTip(model: Object3D, prop: Bone, toModel: Matrix4): Vector3 | null {
    const origin = this.restMP.get(prop)!, best = new Vector3(); let far = 0;
    model.traverse(o => {
      const mesh = o as Mesh; if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position'); if (!pos) return;
      const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? mesh as SkinnedMesh : null;
      let owned = false; for (let p = mesh.parent; !skinned && p; p = p.parent) if (p === prop) { owned = true; break; }
      const index = skinned ? skinned.skeleton.bones.indexOf(prop) : -1;
      if (skinned ? index < 0 : !owned) return;
      const si = mesh.geometry.getAttribute('skinIndex'), sw = mesh.geometry.getAttribute('skinWeight');
      m1.multiplyMatrices(toModel, mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        if (skinned) { let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === index) w += sw.getComponent(i, k); if (w < .5) continue; }
        v1.fromBufferAttribute(pos, i).applyMatrix4(m1);
        const d = v1.distanceToSquared(origin); if (d > far) { far = d; best.copy(v1); }
      }
    });
    return far > 0 ? best : null;
  }

  private captureSprings(byName: Map<string, Bone>) {
    const depth = (o: Object3D) => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
    const extras = [...byName.values()].filter(bone => bone.name.startsWith(EXTRA_BONE_PREFIX)).sort((a, b) => depth(a) - depth(b));
    for (const bone of extras) {
      const child = bone.children.find(c => (c as Bone).isBone) as Bone | undefined;
      // A chain's last bone has no child: extend it along its own direction from its parent.
      const tip = child ? child.position.clone() : this.restP.get(bone)!.clone().applyQuaternion(this.restQ.get(bone)!.clone().invert());
      const len = tip.length(); if (len < 1e-4) continue;
      let index = 0; for (let p = bone.parent; p && p.name.startsWith(EXTRA_BONE_PREFIX); p = p.parent) index++;
      this.springs.push({ bone, tip, pos: new Vector3(), prev: new Vector3(), len, stiff: Math.max(.1, .32 - index * .06), fresh: true });
    }
  }

  private fk(bone: Bone | undefined, x: number, y: number, z: number) {
    if (!bone) return;
    const m = this.restM.get(bone)!;
    // Rotation in model axes carried by the bone: local = rest · (M⁻¹ · R · M).
    q2.setFromAxisAngle(v5.set(0, 1, 0), y * RAD).multiply(q3.setFromAxisAngle(v5.set(1, 0, 0), x * RAD)).multiply(q3.setFromAxisAngle(v5.set(0, 0, 1), z * RAD));
    bone.quaternion.copy(this.restQ.get(bone)!).multiply(q1.copy(m).invert().multiply(q2).multiply(m));
  }

  /** Writes the pose into the bones. world→model must be current: pass the clone's inverse world matrix. */
  solve(p: Dense, toModel: Matrix4, opts: SolveOptions = {}) {
    const b = this.bones, reach = opts.reach && opts.reach.weight > 0 ? opts.reach : null;
    this.toModel.copy(toModel);
    for (const bone of this.driven) bone.quaternion.copy(this.restQ.get(bone)!);
    // Head/body reaches lean the torso toward the hitbox; limb reaches are solved by IK below.
    let pitchAdd = 0, rx = 0, ry = 0, rz = 0;
    if (reach && (reach.limb === 'head' || reach.limb === 'body')) {
      const from = this.restPosition(reach.limb === 'head' ? 'head' : 'chest') ?? v2.set(0, this.hipY, 0);
      const d = v1.copy(reach.target).sub(from), w = reach.weight, cap = this.legLen * .3;
      // Head strikes steer the whole torso's pitch toward the hitbox direction (straight up → upright, forward → bow).
      if (reach.limb === 'head') { const want = Math.max(-40, Math.min(60, Math.atan2(reach.target.z, Math.max(.05, reach.target.y - this.hipY)) / RAD)); pitchAdd = w * (want - p[VEC.hips] - p[VEC.spine] - p[VEC.chest]); }
      const s = Math.min(1, cap / Math.max(d.length(), 1e-4)) * w * (reach.limb === 'body' ? .6 : .3);
      rx = d.x * s; ry = d.y * s * .5; rz = d.z * s;
    }
    const hips = b.hips;
    if (hips) {
      const off = v1.set(p[VEC.root] * this.legLen + rx, p[VEC.root + 1] * this.legLen + ry, p[VEC.root + 2] * this.legLen + rz);
      const parent = hips.parent && this.restM.get(hips.parent);
      if (parent) off.applyQuaternion(q1.copy(parent).invert());
      hips.position.copy(this.restP.get(hips)!).add(off);
    }
    for (const name of TORSO) { const i = VEC[name]; this.fk(b[name], p[i] + (name === 'chest' ? pitchAdd : 0), p[i + 1], p[i + 2]); }
    if (b.root) this.update(b.root); else this.model.updateMatrixWorld(true);
    if (opts.hand) { this.curl(p[SCALAR.curl]); return; }

    // Legs: ankle targets in the body frame; a foot whose target sits on the ground stays flat.
    for (let s = 0; s < 2; s++) {
      const leg = this.legs[s]; if (!leg) continue;
      const fi = s ? VEC.fR : VEC.fL, ki = s ? VEC.kR : VEC.kL, rest = this.restMP.get(leg.end)!;
      const target = v1.set(rest.x + leg.side * p[fi] * this.legLen, rest.y + p[fi + 1] * this.legLen, rest.z + p[fi + 2] * this.legLen);
      if (reach && reach.limb === (s ? 'footR' : 'footL')) target.lerp(reach.target, reach.weight);
      this.chain(leg, target, v2.set(leg.side * p[ki], p[ki + 1], p[ki + 2]));
      this.plantFoot(leg, 1 - Math.min(1, Math.max(0, p[fi + 1]) * 4), s ? p[SCALAR.tR] : p[SCALAR.tL]);
    }
    // Arms: hand targets from the shoulder joint in the chest's frame.
    const chestFrame = b.chest ? this.carried(b.chest, qf) : qf.identity();
    for (let s = 0; s < 2; s++) {
      const arm = this.arms[s]; if (!arm) continue;
      const hi = s ? VEC.hR : VEC.hL, ei = s ? VEC.eR : VEC.eL, a = this.mp(arm.upper, v3), weaponArm = (s === 0) === this.weaponLeft;
      const target = v1.set(arm.side * p[hi], p[hi + 1], p[hi + 2]).applyQuaternion(chestFrame).multiplyScalar(this.armLen).add(a);
      let aim: Vector3 | null = null, aimW = 0;
      if (opts.hands && opts.hands.weight > 0) target.lerp(opts.hands.target, opts.hands.weight);
      if (reach && reach.limb === (s ? 'handR' : 'handL')) target.lerp(reach.target, reach.weight);
      if (reach && reach.limb === 'weapon' && weaponArm) {
        // Put the hand where the blade's middle-to-tip covers the hitbox, then point the blade at it.
        const to = v2.copy(reach.target).sub(a), dist = to.length(), want = Math.max(this.armLen * .55, Math.min(this.armLen * .97, dist - this.bladeLen * .6));
        target.lerp(to.multiplyScalar(want / Math.max(dist, 1e-4)).add(a), reach.weight);
        aim = reach.target; aimW = reach.weight;
      }
      this.chain(arm, target, v2.set(arm.side * p[ei], p[ei + 1], p[ei + 2]).applyQuaternion(chestFrame));
      if (weaponArm) this.aimProp(arm, p, chestFrame, aim, aimW);
    }
  }

  /** Hands: arm/leg chains are fingers, curled together (0 open palm → 1 fist). */
  private curl(amount: number) {
    for (const c of [...this.arms, ...this.legs]) {
      if (!c) continue;
      for (const bone of [c.upper, c.lower, c.end]) bone.quaternion.multiply(q1.setFromAxisAngle(v1.copy(X).applyQuaternion(q2.copy(this.restM.get(bone)!).invert()), amount * 55 * RAD));
    }
    this.model.updateMatrixWorld(true);
  }

  /** Two-bone IK in model space; the end stays inside the reachable shell. */
  private chain(c: Chain, target: Vector3, pole: Vector3) {
    const parent = c.upper.parent!, F = this.carried(parent, q3), a = this.mp(c.upper, v3);
    const along = vt.copy(target).sub(a), raw = along.length();
    const D = Math.min((c.l1 + c.l2) * .9995, Math.max(Math.abs(c.l1 - c.l2) + 1e-4, raw));
    if (raw < 1e-6) along.copy(c.dir1).applyQuaternion(F); else along.divideScalar(raw);
    const cosA = Math.min(1, Math.max(-1, (c.l1 * c.l1 + D * D - c.l2 * c.l2) / (2 * c.l1 * D))), sinA = Math.sqrt(1 - cosA * cosA);
    const restPole = vp.copy(c.pole).applyQuaternion(F), bend = v2.copy(pole).addScaledVector(along, -pole.dot(along));
    if (bend.lengthSq() < 1e-8) bend.copy(restPole).addScaledVector(along, -restPole.dot(along));
    if (bend.lengthSq() < 1e-8) bend.set(0, 1, 0).addScaledVector(along, -along.y);
    bend.normalize();
    const elbow = v1.copy(a).addScaledVector(along, c.l1 * cosA).addScaledVector(bend, c.l1 * sinA), end = v4.copy(a).addScaledVector(along, D);
    const n1 = vn.copy(end).sub(elbow).normalize(), n0 = elbow.sub(a).normalize();
    const d1 = vd1.copy(c.dir1).applyQuaternion(F), d2 = vd2.copy(c.dir2).applyQuaternion(F);
    const upperM = align(q1, d1, restPole, n0, bend).multiply(F).multiply(this.restM.get(c.upper)!);
    c.upper.quaternion.copy(this.mq(parent, q2).invert()).multiply(upperM);
    const lowerM = align(q2, d2, restPole, n1, bend).multiply(F).multiply(this.restM.get(c.lower)!);
    c.lower.quaternion.copy(upperM.invert()).multiply(lowerM);
    this.update(c.upper);
  }

  /** Blend the foot between following the shin and lying flat in the body frame, then pitch the toes. */
  private plantFoot(c: Chain, plant: number, toe: number) {
    const foot = c.end, rest = this.restM.get(foot)!, shin = this.mq(c.lower, q1);
    const carried = q2.copy(shin).multiply(this.restQ.get(foot)!);
    carried.slerp(rest, plant).multiply(q4.copy(rest).invert().multiply(qt.setFromAxisAngle(X, toe * RAD)).multiply(rest));
    foot.quaternion.copy(shin.invert()).multiply(carried);
    this.update(foot);
  }

  private aimProp(arm: Chain, p: Dense, chestFrame: Quaternion, target: Vector3 | null, targetW: number) {
    const hand = arm.end; if (!this.blade) return;
    const bw = p[SCALAR.bw]; if (bw <= 0 && targetW <= 0) return;
    const handM = this.mq(hand, q1), cur = v1.copy(this.blade).applyQuaternion(handM).normalize();
    const want = v2.set(-arm.side * p[VEC.blade], p[VEC.blade + 1], p[VEC.blade + 2]).applyQuaternion(chestFrame).normalize();
    if (target && targetW > 0) want.lerp(v3.copy(target).sub(this.mp(hand, v4)).normalize(), targetW).normalize();
    q2.setFromUnitVectors(cur, want); q3.identity().slerp(q2, Math.min(1, Math.max(bw, targetW)));
    hand.quaternion.copy(this.mq(hand.parent!, q4).invert()).multiply(q3.multiply(handM));
    this.update(hand);
  }

  /** Current tip of a limb in model space (tests and debugging). */
  limbTip(limb: Limb, out: Vector3) {
    const b = this.bones, bone = limb === 'handL' ? b.hand_L : limb === 'handR' ? b.hand_R : limb === 'footL' ? b.foot_L : limb === 'footR' ? b.foot_R : limb === 'head' ? b.head : limb === 'weapon' ? (this.weaponLeft ? b.hand_L : b.hand_R) : b.chest;
    if (!bone) return out.set(0, 0, 0);
    this.mp(bone, out);
    if (limb === 'weapon' && this.blade) out.add(v1.copy(this.blade).applyQuaternion(this.mq(bone, q1)));
    return out;
  }

  // ── Cross-fades: remember the last rendered pose, then slerp from it toward each new solve ──
  snapshot() { this.driven.forEach((bone, i) => this.snapQ[i].copy(bone.quaternion)); if (this.bones.hips) this.snapHips.copy(this.bones.hips.position); }
  blendFromSnapshot(w: number) {
    if (w >= 1) return;
    this.driven.forEach((bone, i) => bone.quaternion.slerpQuaternions(this.snapQ[i], q1.copy(bone.quaternion), w));
    if (this.bones.hips) this.bones.hips.position.lerpVectors(this.snapHips, v1.copy(this.bones.hips.position), w);
  }

  /** Spring secondary motion in world space; call after the final pose. still freezes springs (hitlag). */
  springsUpdate(dt: number, still: boolean) {
    const k = Math.min(3, dt * 60);
    for (const s of this.springs) {
      const bone = s.bone; bone.quaternion.copy(this.restQ.get(bone)!); bone.updateWorldMatrix(false, false);
      const origin = v1.setFromMatrixPosition(bone.matrixWorld), goal = v2.copy(s.tip).applyMatrix4(bone.matrixWorld);
      const scale = ws.setFromMatrixScale(bone.matrixWorld).x || 1, len = s.len * scale;
      if (s.fresh || s.pos.distanceToSquared(goal) > (len * 8) ** 2) { s.pos.copy(goal); s.prev.copy(goal); s.fresh = false; }
      if (!still) {
        const vel = v3.copy(s.pos).sub(s.prev).multiplyScalar(Math.pow(.84, k)); s.prev.copy(s.pos);
        s.pos.add(vel).addScaledVector(v4.copy(goal).sub(s.pos), 1 - Math.pow(1 - s.stiff, k));
        s.pos.y -= .006 * k * len;
      }
      const want = v4.copy(s.pos).sub(origin), cur = v5.copy(goal).sub(origin).normalize();
      if (want.lengthSq() < 1e-12) continue;
      want.normalize();
      const cos = want.dot(cur), limit = Math.cos(70 * RAD);
      if (cos < limit) want.lerp(cur, (limit - cos) / (1 - cos + 1e-6)).normalize();
      s.pos.copy(origin).addScaledVector(want, len);
      q1.setFromUnitVectors(cur, want);
      bone.matrixWorld.decompose(wp, q2, ws); bone.parent!.matrixWorld.decompose(wp, q3, ws);
      bone.quaternion.copy(q3.invert()).multiply(q1.multiply(q2));
      bone.updateWorldMatrix(false, true);
    }
  }
  resetSprings() { for (const s of this.springs) s.fresh = true; }
}
