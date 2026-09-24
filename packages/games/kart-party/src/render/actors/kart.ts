/* One racer on screen: kart + driver rig built from the karts.glb contract (or the primitive fallback),
 * animated every frame from its RacerPose. Visual-only offsets (drift yaw, spin, tumble, squash, lean)
 * live on child pivots so the root always sits exactly where the simulation says the kart is. */
import * as THREE from 'three';
import { angleDelta, approach, clamp, lerp, smoothstep, TAU, wrapAngle } from '../../sim/math';
import { CHARACTERS } from '../../sim/stats';
import { pointAt, queryTrack, sampleAt, type Track } from '../../sim/track';
import type { KartBodyId } from '../../sim/types';
import { kartLoop, loopFrame, type LoopFrame } from '../loop';
import type { KartAssets, RacerPose } from '../types';
import { compactTemplate, FALLBACK_LIBRARY, isRigMaterial, rigMaterial } from './compact';
import { fallbackTemplate } from './fallback';

const COM = .5;                          // centre-of-mass height used for tumbles/spins
const DRIFT_YAW = .44;                   // ~25° of visual slip while drifting
const RESPAWN = 1.6, LIFT = 11;
const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), m1 = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e1 = new THREE.Euler();
const box = new THREE.Box3(), size = new THREE.Vector3(), LF = {} as LoopFrame;

type Pivot = { node: THREE.Object3D; rest: THREE.Quaternion };
const pivot = (node: THREE.Object3D | null | undefined): Pivot | null => node ? { node, rest: node.quaternion.clone() } : null;
/** Rotate a pivot relative to its rest pose, about a LOCAL axis (wheel spin, steering wheel). */
const turnLocal = (p: Pivot | null, axis: THREE.Vector3, angle: number) => { if (p) p.node.quaternion.copy(p.rest).multiply(q1.setFromAxisAngle(axis, angle)); };
/** Rotate a pivot relative to its rest pose by an Euler in the PARENT frame (steer, head, arms, lean). */
const turnParent = (p: Pivot | null, x: number, y: number, z: number, order: THREE.EulerOrder = 'YXZ') => { if (p) p.node.quaternion.setFromEuler(e1.set(x, y, z, order)).multiply(p.rest); };

export type RigMaterial = { material: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number };

/** Resolve the kart + driver models and build the pivot hierarchy. Exported for tests. */
export function buildKartModel(assets: KartAssets, kart: KartBodyId, character: number) {
  const find = (root: THREE.Object3D, name: string) => root.getObjectByName(name) ?? null;
  const kartOk = (o: THREE.Object3D | null) => !!o && ['body', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].every(n => find(o, `kart_${kart}_${n}`));
  const ci = clamp(Math.round(character) || 0, 0, CHARACTERS.length - 1), kn = `kart_${kart}`, cn = `char_${ci}`;
  const glbKart = assets.karts ? compactTemplate(assets.karts, kn, () => { const o = assets.clone(kn); return kartOk(o) ? o : null; }) : null;
  const model = (glbKart ?? compactTemplate(FALLBACK_LIBRARY, kn, () => fallbackTemplate(kn))!).clone(true), fromGlb = !!glbKart;
  const glbDriver = assets.karts ? compactTemplate(assets.karts, cn, () => { const o = assets.clone(cn); return o && find(o, `${cn}_head`) ? o : null; }) : null;
  const driver = (glbDriver ?? compactTemplate(FALLBACK_LIBRARY, cn, () => fallbackTemplate(cn))!).clone(true);
  model.position.set(0, 0, 0); model.updateMatrixWorld(true);
  const n = (s: string) => find(model, `kart_${kart}_${s}`);
  const body = n('body')!;
  // Seat, steering wheel and exhausts ride on the body so suspension roll carries them.
  for (const part of [n('steering'), n('seat'), n('exhaust_l'), n('exhaust_r')]) if (part && !isDescendant(part, body)) body.attach(part);
  model.updateMatrixWorld(true);
  const seat = n('seat'), seatPos = seat ? body.worldToLocal(seat.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, .72, -.3);
  driver.position.copy(seatPos); body.add(driver);
  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(s => n(s)!);
  const radius = wheels.map(w => { box.setFromObject(w).getSize(size); return clamp(size.y / 2, .15, .8) || .35; });
  const contacts = wheels.map(w => { const p = w.getWorldPosition(new THREE.Vector3()); p.y = 0; return p; });
  // Steering wheel spin axis = thinnest extent of its mesh; sign chosen so +angle turns the rim's top to driver-right (−X).
  const steeringNode = n('steering'), steerAxis = new THREE.Vector3(0, 0, 1);
  let steerSign = 1;
  const rim = steeringNode?.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
  if (steeringNode && rim) {
    rim.geometry.computeBoundingBox(); rim.geometry.boundingBox!.getSize(size);
    steerAxis.set(size.x <= size.y && size.x <= size.z ? 1 : 0, size.y < size.x && size.y <= size.z ? 1 : 0, size.z < size.x && size.z < size.y ? 1 : 0);
    const a = steerAxis.clone().applyQuaternion(steeringNode.getWorldQuaternion(new THREE.Quaternion())), top = new THREE.Vector3(0, 1, 0).addScaledVector(a, -a.y);
    if (a.cross(top).x > 0) steerSign = -1;
  }
  const exhausts = [n('exhaust_l'), n('exhaust_r')].map((e, i) => e ? body.worldToLocal(e.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(i ? -.3 : .3, .6, -1.45));
  return {
    model, driver, body, fromGlb, seatPos, radius, contacts, exhausts, steerAxis, steerSign,
    steerL: pivot(n('steer_fl')), steerR: pivot(n('steer_fr')), wheels: wheels.map(w => pivot(w)!), steering: pivot(n('steering')),
    head: pivot(find(driver, `char_${ci}_head`)), armL: pivot(find(driver, `char_${ci}_arm_l`)), armR: pivot(find(driver, `char_${ci}_arm_r`)),
    driverPivot: pivot(driver)!, bodyRest: body.quaternion.clone(), bodyPos: body.position.clone(),
  };
}
/** Shadow-only stand-in: the rest-pose kart + driver merged into one mesh. three.js has no shadow-only
 * flag, so its draw range is empty except inside the shadow pass (and its own material writes nothing).
 * Geometry is cached per kart/character. */
const proxyGeometry = new Map<string, THREE.BufferGeometry>(), proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function shadowProxy(model: THREE.Object3D, key: string) {
  let geo = proxyGeometry.get(key);
  if (!geo) {
    const pos: number[] = [], idx: number[] = [], inv = new THREE.Matrix4();
    model.updateMatrixWorld(true); inv.copy(model.matrixWorld).invert();
    model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const P = o.geometry.getAttribute('position'), I = o.geometry.index, base = pos.length / 3; m1.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < P.count; i++) { v1.fromBufferAttribute(P, i).applyMatrix4(m1); pos.push(v1.x, v1.y, v1.z); }
      if (I) for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i)); else for (let i = 0; i < P.count; i++) idx.push(base + i);
    });
    geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeBoundingSphere();
    proxyGeometry.set(key, geo);
  }
  const mesh = new THREE.Mesh(geo, proxyMaterial); mesh.name = 'shadow_proxy'; mesh.castShadow = true;
  geo.setDrawRange(0, 0);
  mesh.onBeforeShadow = () => geo!.setDrawRange(0, Infinity); mesh.onAfterShadow = () => geo!.setDrawRange(0, 0);
  return mesh;
}
const isDescendant = (o: THREE.Object3D, ancestor: THREE.Object3D) => { for (let p = o.parent; p; p = p.parent) if (p === ancestor) return true; return false; };

/** Per-frame context shared by every kart. */
export type KartFrame = { dt: number; time: number; track: Track; reducedMotion: boolean };

export class KartActor {
  readonly root = new THREE.Group();          // simulation position + ground-aligned heading
  readonly pivot = new THREE.Group();         // visual offsets about the centre of mass
  readonly parts: ReturnType<typeof buildKartModel>;
  readonly materials: RigMaterial[] = [];
  private readonly owned: THREE.Material[] = [];
  /** World-space outputs for effects (updated each frame). */
  readonly contact = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  readonly exhaust = [new THREE.Vector3(), new THREE.Vector3()];
  readonly forward = new THREE.Vector3(); readonly right = new THREE.Vector3(); readonly up = new THREE.Vector3();
  readonly center = new THREE.Vector3();
  /** Root up axis (road normal, the loop's ribbon normal while looping): name tags and effects hang off it. */
  readonly normal = new THREE.Vector3(0, 1, 0);
  /** Riding a loop-the-loop this frame; loopEntered is the entry edge. */
  looping = false; loopEntered = false;
  groundY = 0; groundNormal = new THREE.Vector3(0, 1, 0); airHeight = 0;
  /** Edge flags for this frame. */
  landed = 0; hopped = false; boostStarted = 0; respawning = false; hidden = false;
  // animation state
  private readonly q = new THREE.Quaternion(); private first = true;
  private yawOff = 0; private lean = 0; private roll = 0; private pitch = 0; private headYaw = 0; private wheelSteer = 0;
  private sy = 1; private syV = 0; private readonly spin = [0, 0, 0, 0]; private yawRate = 0; private accel = 0; private prevSpeed = 0;
  private prevHeading = 0; private prevGrounded = true; private prevVy = 0; private prevBoost = 0;
  private spinAccum = 0; private spinOff = 0; private spinning = false; private tumble = 0; private trickT = 0; private trickKind = 0;
  private cheer = 0; private shrink = 1; private readonly fall = new THREE.Vector3(); private respawnPrev = 0;
  private readonly respawnPos = new THREE.Vector3(); private respawnHeading = 0; private dropT = 0;
  starT = 0; shieldT = 0; inkT = 0; shockT = 0; drift: -1 | 0 | 1 = 0; driftTier = 0; speed = 0; releaseT = 0;

  constructor(assets: KartAssets, readonly id: string, kart: KartBodyId, character: number, shadows: boolean) {
    this.parts = buildKartModel(assets, kart, character);
    const paint = new THREE.Color(CHARACTERS[clamp(character, 0, CHARACTERS.length - 1)]?.color ?? '#ffffff');
    // One tinted rig material per racer (compacted meshes); other materials are cloned only if painted.
    const rig = rigMaterial(paint), cloned = new Map<THREE.Material, THREE.Material>([[rig, rig]]);
    this.owned.push(rig); this.materials.push({ material: rig, emissive: rig.emissive.clone(), intensity: rig.emissiveIntensity });
    const own = (m: THREE.Material) => {
      if (isRigMaterial(m)) return rig;
      let c = cloned.get(m);
      if (!c) {
        c = m.name.startsWith('kart_paint') ? m.clone() : m; cloned.set(m, c);
        if (c !== m) { this.owned.push(c); (c as THREE.MeshStandardMaterial).color?.copy(paint); }
        if (c instanceof THREE.MeshStandardMaterial && c !== m) this.materials.push({ material: c, emissive: c.emissive.clone(), intensity: c.emissiveIntensity });
      }
      return c;
    };
    this.parts.model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      o.castShadow = false; o.receiveShadow = false;
    });
    // One merged silhouette casts the shadow instead of ~10 animated parts (a tenth of the shadow draws).
    if (shadows) this.parts.model.add(shadowProxy(this.parts.model, `${kart}:${character}`));
    this.pivot.position.y = COM; this.parts.model.position.y = -COM;
    this.pivot.add(this.parts.model); this.root.add(this.pivot);
    this.root.name = `racer:${id}`;
  }

  update(pose: RacerPose, f: KartFrame) {
    const k = pose.kart, r = pose.view, dt = f.dt, P = this.parts, lp = kartLoop(f.track, k), wasLooping = this.looping;
    this.looping = !!lp; this.loopEntered = !!lp && !wasLooping && !this.first;
    // In a loop the velocity turns vertical and the heading flips over the top: use the 3D speed, no yaw rate.
    const speed = lp ? Math.hypot(k.vx, k.vy, k.vz) : Math.hypot(k.vx, k.vz), fwdSpeed = lp ? speed : k.vx * Math.sin(k.heading) + k.vz * Math.cos(k.heading);
    this.speed = speed; this.starT = k.starT; this.shieldT = k.shieldT; this.inkT = k.inkT; this.shockT = k.shockT; this.drift = k.drift; this.driftTier = k.driftTier;
    // Edges: hop, landing, boost start.
    this.landed = !this.first && k.grounded && !this.prevGrounded ? Math.max(1, -this.prevVy) : 0;
    this.hopped = !this.first && !k.grounded && this.prevGrounded && k.vy > 1;
    this.boostStarted = !this.first && k.boostT > this.prevBoost + .15 ? k.boostPower || .3 : 0;
    const dh = this.first || lp || wasLooping ? 0 : angleDelta(this.prevHeading, k.heading);
    this.yawRate = lerp(this.yawRate, dt > 0 ? clamp(dh / dt, -8, 8) : 0, approach(10, dt));
    this.accel = lerp(this.accel, dt > 0 ? (speed - this.prevSpeed) / dt : 0, approach(6, dt));

    // ---- Root: ground-aligned basis at the simulated position (the ribbon frame from loopPose while looping).
    if (lp) {
      const F = loopFrame(lp.loop, lp.theta, k.lateral, LF), up = this.groundNormal.set(F.ux, F.uy, F.uz), fwd = v1.set(F.fx, F.fy, F.fz);
      this.groundY = k.y - 30; this.airHeight = 0;         // no floor under a looping kart (effects, shadow)
      q2.setFromRotationMatrix(m1.makeBasis(v2.crossVectors(up, fwd), up, fwd));
      // Ease into the ribbon frame at the entry, then follow it tightly (it spins ~5 rad/s through the top curl).
      this.loopT = wasLooping ? this.loopT + dt : 0;
      if (this.first) this.q.copy(q2); else this.q.slerp(q2, approach(20 + this.loopT * 500, dt));
    } else this.groundBasis(k, f, speed, dt);
    // Respawn: carried up by the drone at the fall point, lowered onto the respawn point.
    const respawnT = k.respawnT;
    if (respawnT > 0 && this.respawnPrev <= 0) {
      this.fall.set(k.x, k.y, k.z);
      const s = sampleAt(f.track, k.lastSafeD), p = pointAt(f.track, k.lastSafeD, s.line);
      this.respawnPos.set(p.x, p.y, p.z); this.respawnHeading = s.heading;
    }
    if (respawnT <= 0 && this.respawnPrev > 0) this.dropT = .35;
    this.respawnPrev = respawnT; this.respawning = respawnT > 0;
    let lift = 0;
    if (respawnT > 0) {
      const u = 1 - respawnT / RESPAWN;                       // 0 → 1
      if (u < .5) { this.root.position.copy(this.fall); lift = LIFT * smoothstep(.12, .5, u) ** 1.6; }
      else { this.root.position.copy(this.respawnPos); lift = LIFT * (1 - smoothstep(.5, 1, u)) ** 1.4 + .9 * smoothstep(.85, 1, u); q2.setFromAxisAngle(UP, this.respawnHeading); this.q.copy(q2); }
      this.root.position.y += lift;
    } else {
      // Looping: sit on the ribbon at (θ(d), lateral) — flat x/z collision pushes can leave the raw position ~1 m off it.
      if (lp) this.root.position.set(LF.x, LF.y, LF.z); else this.root.position.set(k.x, k.y, k.z);
      if (this.dropT > 0) { this.dropT = Math.max(0, this.dropT - dt); this.root.position.y += .9 * (this.dropT / .35) ** 2; if (this.dropT === 0) this.syV -= 2.5; }
    }
    this.root.quaternion.copy(this.q); this.normal.set(0, 1, 0).applyQuaternion(this.q);

    // ---- Squash & stretch spring (hops, landings, bumps).
    if (this.hopped) this.syV += 3.2;
    if (this.landed) this.syV -= Math.min(7, this.landed * .45 + 1.2);
    this.syV += (-(this.sy - 1) * 320 - this.syV * 15) * dt; this.sy = clamp(this.sy + this.syV * dt, .7, 1.3);

    // ---- Visual yaw: drift slip, hit spin, trick spin.
    const velH = Math.atan2(k.vx, k.vz), slip = speed > 3 ? angleDelta(velH, k.heading) : 0;
    let wantYaw = 0;
    if (k.drift) {
      const tight = clamp(k.steer * k.drift, -1, 1), want = -k.drift * DRIFT_YAW * (.8 + .25 * tight);
      wantYaw = want - slip; if (wantYaw * k.drift > 0) wantYaw = 0;
      wantYaw = clamp(wantYaw, -DRIFT_YAW, DRIFT_YAW);
    }
    this.yawOff = lerp(this.yawOff, wantYaw, approach(k.drift ? 9 : 6, dt));
    const spinTimer = k.spinT > 0 ? k.spinT : k.shockT > 2.4 ? k.shockT - 2.4 : 0, spinDur = k.spinT > 0 ? 1 : .6;
    if (spinTimer > 0) {
      if (!this.spinning) { this.spinning = true; this.spinAccum = 0; }
      this.spinAccum += dh;
      const p = 1 - clamp(spinTimer / spinDur, 0, 1);
      this.spinOff = TAU * (1 - (1 - p) ** 2.2) - this.spinAccum;
    } else {
      if (this.spinning) { this.spinning = false; this.spinOff = wrapAngle(this.spinOff); }
      this.spinOff = lerp(this.spinOff, 0, approach(10, dt));
    }
    // Tumble: forward flip over the first ~80% of the tumble.
    this.tumble = k.tumbleT > 0 ? TAU * (1 - (1 - clamp((1 - k.tumbleT / 1.4) / .8, 0, 1)) ** 2.4) : lerp(this.tumble % TAU, 0, approach(12, dt));
    if (this.trickT > 0) this.trickT = Math.max(0, this.trickT - dt);
    const tp = 1 - this.trickT / .5, trick = this.trickT > 0 ? TAU * smoothstep(0, 1, tp) : 0;
    // Lean from lateral acceleration (into the turn for the driver, out of it for the body).
    const lat = clamp(-this.yawRate * speed / 38, -1, 1);
    this.lean = lerp(this.lean, lat * .2 + k.drift * .12, approach(8, dt));
    this.roll = lerp(this.roll, -lat * .06 - k.drift * .05, approach(10, dt));
    this.pitch = lerp(this.pitch, clamp(-this.accel / 45, -.06, .05) - (k.boostT > 0 ? .03 : 0), approach(8, dt));
    this.shrink = lerp(this.shrink, k.shockT > 0 ? .72 : 1, approach(k.shockT > 0 ? 14 : 5, dt));
    const sx = this.shrink / Math.sqrt(this.sy), sy = this.shrink * this.sy;
    this.pivot.scale.set(sx, sy, sx);
    this.pivot.position.y = COM * sy;
    this.parts.model.position.y = -COM;
    this.pivot.quaternion.setFromEuler(e1.set(this.tumble + (this.trickKind === 1 ? trick : 0), this.yawOff + this.spinOff + (this.trickKind === 2 ? trick : 0), this.trickKind === 0 ? trick * (this.trickSide) : 0, 'YXZ'));
    // Suspension: body rolls/pitches over the wheels, with a little speed buzz.
    const buzz = k.grounded ? Math.sin(f.time * 47 + this.id.length) * .004 * clamp(speed / 20, 0, 1) : 0;
    P.body.quaternion.setFromEuler(e1.set(this.pitch, 0, this.roll)).multiply(P.bodyRest);
    P.body.position.set(P.bodyPos.x, P.bodyPos.y + buzz + (this.sy - 1) * -.05, P.bodyPos.z);

    // ---- Wheels and steering.
    const counter = k.drift ? k.drift * (.34 - .22 * Math.max(0, k.steer * k.drift)) : 0;
    const wantSteer = k.drift ? counter : -k.steer * .42 * (1 - smoothstep(24, 40, speed) * .35);
    this.wheelSteer = lerp(this.wheelSteer, k.spinT > 0 || k.tumbleT > 0 ? 0 : wantSteer, approach(14, dt));
    turnParent(P.steerL, 0, this.wheelSteer, 0); turnParent(P.steerR, 0, this.wheelSteer, 0);
    for (let i = 0; i < 4; i++) {
      const slipBoost = i >= 2 && k.boostT > 0 && speed < 12 ? 8 : 0;              // burnout on launch
      this.spin[i] = (this.spin[i] + (fwdSpeed / P.radius[i] + slipBoost) * dt) % TAU;
      turnLocal(P.wheels[i], X, this.spin[i]);
    }
    const wheelZ = -this.wheelSteer * 3.2;
    turnLocal(P.steering, P.steerAxis, wheelZ * P.steerSign);

    // ---- Driver: lean, head look, arms (steering or cheering).
    const finished = r.finishTime !== null;
    this.cheer = lerp(this.cheer, finished ? 1 : 0, approach(finished ? 4 : 8, dt));
    const hit = k.spinT > 0 || k.tumbleT > 0;
    const flail = hit ? Math.sin(f.time * 22) * .5 : 0;
    turnParent(P.driverPivot, -this.pitch * 2 + (k.boostT > 0 ? .1 : 0), 0, this.lean * (1 - this.cheer), 'XYZ');
    this.headYaw = lerp(this.headYaw, -k.steer * .3 - k.drift * .3 + (hit ? Math.sin(f.time * 17) * .5 : 0), approach(7, dt));
    const bounce = this.cheer * Math.sin(f.time * 7);
    turnParent(P.head, lerp(0, -.25 + bounce * .08, this.cheer), this.headYaw * (1 - this.cheer), -this.lean * .5 + bounce * .12);
    const armSteer = wheelZ * .2, wave = Math.sin(f.time * 9) * .22 * this.cheer;
    turnParent(P.armL, lerp(-armSteer + flail, -2.05 + wave, this.cheer), 0, -.8 * this.cheer - flail * .5, 'ZYX');
    turnParent(P.armR, lerp(armSteer - flail, -2.05 - wave, this.cheer), 0, .8 * this.cheer + flail * .5, 'ZYX');

    // ---- Star shimmer (rainbow emissive), invulnerability blink.
    if (k.starT > 0 || this.starWas) {
      const on = k.starT > 0, fade = on ? Math.min(1, k.starT / .6) : 0;
      for (let i = 0; i < this.materials.length; i++) {
        const m = this.materials[i], u = m.material.userData;
        if (u.star) { u.star.value = fade; u.time.value = f.time; continue; }
        if (on) { m.material.emissive.setHSL((f.time * 2.2 + i * .13) % 1, 1, .5); m.material.emissiveIntensity = .5 * fade + .1; }
        else { m.material.emissive.copy(m.emissive); m.material.emissiveIntensity = m.intensity; }
      }
      this.starWas = on;
    }
    const blink = k.invulnT > 0 && k.starT <= 0 && respawnT <= 0 && Math.sin(f.time * 50) > .2;
    this.hidden = blink; this.pivot.visible = !blink;

    // ---- World-space outputs.
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 4; i++) this.contact[i].copy(P.contacts[i]).applyMatrix4(P.model.matrixWorld);
    for (let i = 0; i < 2; i++) this.exhaust[i].copy(P.exhausts[i]).applyMatrix4(P.body.matrixWorld);
    this.forward.set(0, 0, 1).applyQuaternion(this.pivot.getWorldQuaternion(q2));
    this.right.set(-1, 0, 0).applyQuaternion(q2); this.up.set(0, 1, 0).applyQuaternion(q2);
    this.center.set(0, COM, 0).applyMatrix4(this.root.matrixWorld);
    if (this.releaseT > 0) this.releaseT = Math.max(0, this.releaseT - dt);
    this.prevHeading = k.heading; this.prevGrounded = k.grounded; this.prevVy = k.vy; this.prevBoost = k.boostT; this.prevSpeed = speed; this.first = false;
  }
  private starWas = false; private trickSide = 1; private loopT = 0;
  private groundBasis(k: RacerPose['kart'], f: KartFrame, speed: number, dt: number) {
    const qy = queryTrack(f.track, k.x, k.z, k.hint, k.y);
    const ground = qy.ground ?? k.y - 20;
    this.groundY = ground; this.airHeight = Math.max(0, k.y - ground);
    const onRoad = Math.abs(qy.lateral) <= qy.halfWidth, bank = onRoad ? qy.bank : 0;
    const t = v1.set(qy.tx, qy.slope, qy.tz).normalize(), b = v2.set(qy.rx * Math.cos(bank), -Math.sin(bank), qy.rz * Math.cos(bank));
    const n = this.groundNormal.crossVectors(b, t).normalize();
    const up = k.grounded || this.airHeight < .4 ? n : v3.copy(n).lerp(UP, smoothstep(.4, 3, this.airHeight));
    const fwd = v1.set(Math.sin(k.heading), 0, Math.cos(k.heading));
    if (!k.grounded) fwd.y = clamp(k.vy / Math.max(8, speed), -.6, .45) * .5;
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const side = v2.crossVectors(up, fwd).normalize();
    q2.setFromRotationMatrix(m1.makeBasis(side, up, fwd));
    if (this.first) this.q.copy(q2); else this.q.slerp(q2, approach(k.grounded ? 14 : 5, dt));
  }
  /** Trick event: a quick barrel roll / flip / spin, alternating. */
  trick() { this.trickT = .5; this.trickKind = (this.trickKind + 1) % 3; this.trickSide = Math.random() < .5 ? 1 : -1; }
  /** Dithered fade for the next viewport (1 = solid); only the per-racer rig material supports it. */
  fade(f: number) { const u = this.materials[0].material.userData.fade; if (u) u.value = f; }
  /** Nudge the squash spring (bumps, pickups). */
  kick(amount: number) { this.syV += amount; }
  dispose() { for (const m of this.owned) m.dispose(); this.root.removeFromParent(); }
}
