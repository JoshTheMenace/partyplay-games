/**
 * One crew fighter on screen: a cloned textured GLB posed from keyframed clips (src/anim), with cross-fades between clips, damped
 * springs on coat tails, scarf, hair and gear, weapon smears, a contact shadow, the player ring, shield bubble, respawn halo, hit flash,
 * hitlag shake and charge tremble. Same surface as the legacy FighterActor, so the scene treats both alike.
 */
import { AdditiveBlending, Color, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, ShaderMaterial, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Quality } from '../../../../../party-3d/src/index';
import { anchor, lerpPose, sample, slerp, solve, type Pose, type Q, type Solved, type V3 } from '../../anim/core';
import type { CrewDef, CrewTrail } from '../../crew/types';
import { FIGHTERS, type FighterView } from '../../model';
import type { ActorContext } from '../fighter/actor';
import type { FighterCache } from '../fighter/cache';
import { SwingTrail } from '../fighter/trail';
import { FX_CUE, FX_FEED, type Fx, type FxFeed } from '../fx';
import { applyCostume, crewMaterial, crewUniforms, type CrewModel, type CrewUniforms } from './model';
import { trackOf, type Clock, type Track } from './tracks';

const RAD = Math.PI / 180, PROFILE = 72;
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), q1 = new Quaternion(), m1 = new Matrix4();
const WHITE = new Color(1, 1, 1), CHARGE = new Color(1, .82, .4), SHIMMER = new Color(.75, .9, 1), ARMOR = new Color(1, .55, .2), HURT = new Color(1, .96, .88);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n)), clamp01 = (n: number) => clamp(n, 0, 1), smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
type Spring = { bone: Bone; rest: Vector3; len: number; tip: Vector3; vel: Vector3; cfg: readonly [number, number, number, number]; fresh: boolean };
const SHIELD_VERT = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() { vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const SHIELD_FRAG = `uniform vec3 uColor; uniform float uAlpha; uniform float uCrack; uniform float uHit; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
  float hex = abs(sin(vP.x * 11.0 + vP.y * 6.0) * sin(vP.y * 12.0 - vP.x * 5.0 + uTime * .8));
  float c = abs(sin(vP.x * 9.0 + sin(vP.y * 13.0) * 1.7) * sin(vP.y * 7.0 + vP.z * 11.0 + sin(vP.x * 5.0)));
  float crack = step(.93, c) * uCrack;
  vec3 col = uColor * (.5 + 1.6 * fres + .25 * smoothstep(.9, 1.0, hex)) + vec3(1.0) * (crack * 1.4 + uHit * .8 * fres);
  gl_FragColor = vec4(col * 1.4, clamp(uAlpha * (.16 + .84 * fres) + crack * .6 + uHit * .25, 0.0, 1.0));
}`;

export class CrewActor {
  readonly group = new Group();
  readonly height: number;
  private body = new Group(); private model: Object3D; private mesh: SkinnedMesh; private bones = new Map<string, Bone>();
  private uniforms: CrewUniforms; private owned: { dispose(): void }[] = [];
  private clock: Clock = { state: 0, move: 0, seconds: 0, gait: 0, airJump: 99 };
  private last = { state: '' as FighterView['state'] | '', move: null as string | null, key: '', damage: 0, jumps: 0, costume: -1, x: 0, y: 0 };
  private from: Solved | null = null; private now: Solved | null = null; private blend = { t: 1, dur: 1 };
  private yaw = 0; private flash = 0; private fresh = true; private cued = 0;
  private springs: Spring[] = []; private trails: SwingTrail[] = []; private seed = Math.random();
  private shadow: Mesh; private ring: Mesh; private shield: Mesh; private shieldMat: ShaderMaterial; private halo: Group; private stars: Mesh[] = []; private zs: Mesh[] = [];
  /** Hips height of the rest pose and the last solved pose (fighter space), for tools. */
  solved: Solved | null = null;

  constructor(private o: { view: FighterView; model: CrewModel; def: CrewDef; cache: FighterCache; quality?: Quality }) {
    const { view, model, def, cache } = o;
    this.model = cloneSkinned(model.scene); this.height = FIGHTERS[view.fighter].height;
    this.group.name = `fighter-${view.id}`; this.group.add(this.body); this.body.add(this.model);
    this.uniforms = crewUniforms(model);
    const mat = this.own(crewMaterial(model, this.uniforms, o.quality));
    let mesh: SkinnedMesh | null = null;
    this.model.traverse(n => { if ((n as SkinnedMesh).isSkinnedMesh) mesh = n as SkinnedMesh; if ((n as Bone).isBone) this.bones.set(n.name, n as Bone); });
    if (!mesh) throw new Error('Crew model without a mesh.');
    this.mesh = mesh as SkinnedMesh; this.mesh.material = mat; this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    // Spring chains: every extra_ bone swings from its joint toward where its child (or its own rest offset) hangs.
    for (const [name, chain] of Object.entries(def.rig.chains)) {
      const cfg = Object.entries(def.springs ?? {}).find(([prefix]) => name.startsWith(prefix))?.[1] ?? [.08, .85, 12, 70];
      chain.forEach((b, i) => {
        const bone = this.bones.get(b); if (!bone) return;
        const J = def.rig.joints, child = chain[i + 1], a = def.rig.anchors[name], tip = child ? J[child] : a?.bone === b ? [J[b][0] + a.at[0], J[b][1] + a.at[1], J[b][2] + a.at[2]] : [J[b][0] * 2 - J[def.rig.parents[b]!][0], J[b][1] * 2 - J[def.rig.parents[b]!][1], J[b][2] * 2 - J[def.rig.parents[b]!][2]];
        const rest = new Vector3(tip[0] - J[b][0], tip[1] - J[b][1], tip[2] - J[b][2]), len = rest.length() || .1;
        this.springs.push({ bone, rest: rest.normalize(), len, tip: new Vector3(), vel: new Vector3(), cfg, fresh: true });
      });
    }
    const color = new Color(view.color);
    this.shadow = new Mesh(cache.plane, this.own(new MeshBasicMaterial({ map: cache.soft, color: 0x05030a, transparent: true, opacity: .4, depthWrite: false })));
    this.ring = new Mesh(cache.ring, this.own(new MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false, side: DoubleSide })));
    this.shadow.renderOrder = this.ring.renderOrder = 2;
    this.shieldMat = this.own(new ShaderMaterial({ vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG, transparent: true, depthWrite: false,
      uniforms: { uColor: { value: color.clone() }, uAlpha: { value: .5 }, uCrack: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } } }));
    this.shield = new Mesh(cache.sphere, this.shieldMat); this.shield.renderOrder = 5;
    const haloMat = this.own(new MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, opacity: .9, blending: AdditiveBlending, depthWrite: false }));
    const discMat = this.own(new MeshBasicMaterial({ color: color.clone().lerp(WHITE, .5), map: cache.soft, transparent: true, opacity: .8, blending: AdditiveBlending, depthWrite: false }));
    this.halo = new Group(); this.halo.add(new Mesh(cache.halo, haloMat), new Mesh(cache.disc, discMat));
    const starMat = this.own(new MeshBasicMaterial({ color: new Color('#ffe066').multiplyScalar(1.8), transparent: true, depthWrite: false, side: DoubleSide }));
    const zMat = this.own(new MeshBasicMaterial({ color: '#cfe4ff', transparent: true, depthWrite: false, side: DoubleSide }));
    for (let i = 0; i < 3; i++) { this.stars.push(new Mesh(cache.star, starMat)); this.zs.push(new Mesh(cache.zed, zMat.clone())); this.own(this.zs[i].material as MeshBasicMaterial); }
    for (const m of [this.shadow, this.ring, this.shield, this.halo, ...this.stars, ...this.zs]) { m.visible = false; this.group.add(m); }
    this.update(view, undefined, { dt: 0, seconds: 0, reduced: false, cameraDistance: 14, platforms: [] });
  }
  private own<T extends { dispose(): void }>(x: T): T { this.owned.push(x); return x; }
  reset() { this.fresh = true; }
  /** World position of a rig anchor (after update). */
  anchorWorld(name: string, out = new Vector3()) { const a = this.o.def.rig.anchors[name] ?? { bone: name, at: [0, 0, 0] }, b = this.bones.get(a.bone); return b ? out.set(a.at[0], a.at[1], a.at[2]).applyMatrix4(b.matrixWorld) : out.copy(this.group.position); }

  update(view: FighterView, _prev: FighterView | undefined, ctx: ActorContext & { win?: boolean; pose?: Pose; lift?: number }) {
    const out = view.state === 'out'; this.group.visible = !out;
    if (out) { this.fresh = true; this.last.state = 'out'; return; }
    const def = this.o.def, u = this.uniforms, dtf = Math.min(6, ctx.dt * 60), frozen = view.hitlag > 0, c = this.clock;
    if (view.costume !== this.last.costume) { applyCostume(this.o.model, u, view.costume); this.last.costume = view.costume; }
    // Local clocks run smoothly between snapshots and never stray far from the server's counters.
    c.seconds = ctx.seconds;
    if (this.fresh || view.state !== this.last.state || view.stateFrame < c.state - 4) c.state = view.stateFrame;
    else if (!frozen) c.state = clamp(c.state + dtf, view.stateFrame - 1, view.stateFrame + 2.5);
    if (this.fresh || view.move !== this.last.move || view.moveFrame < c.move - 4) c.move = view.moveFrame;
    else if (!frozen) c.move = clamp(c.move + dtf, view.moveFrame - 1, view.moveFrame + 2.5);
    if (!frozen && view.grounded) c.gait = (c.gait + Math.abs(view.vx) * dtf / (view.state === 'run' ? def.stride.run : def.stride.walk)) % 1;
    c.airJump = !view.grounded && view.jumpsLeft < this.last.jumps && !this.fresh ? 0 : c.airJump + (frozen ? 0 : dtf);

    // Pose: sample the clip, tremble while charging, then cross-fade from the previous clip's last pose.
    const track: Track = ctx.pose ? { key: 'pose', clip: { keys: [{ f: 0, p: ctx.pose }] }, frame: 0, blend: 1 } : trackOf(def, view, c, ctx.win);
    let pose = sample(track.clip, track.frame);
    if (view.charge > 0 && !ctx.reduced) { const k = view.charge * .9, t = ctx.seconds * 50; pose = lerpPose(pose, { ...pose, chest: [(pose.chest?.[0] ?? 0) + Math.sin(t) * k, (pose.chest?.[1] ?? 0) + Math.sin(t * 1.3) * k, pose.chest?.[2] ?? 0], hips: [(pose.hips?.[0] ?? 0), (pose.hips?.[1] ?? 0) - .012 * view.charge, pose.hips?.[2] ?? 0] }, 1); }
    // Blink now and then unless the clip is already doing something with the eyes.
    const blink = (ctx.seconds * .31 + this.seed) % 1; if (!ctx.pose && blink > .965 && (pose.face?.[0] ?? 0) < .3) pose = { ...pose, face: [1 - Math.abs(blink - .982) / .018 * .6, pose.face?.[1] ?? 0, pose.face?.[2] ?? 0] };
    const solved = solve(def.rig, pose); this.solved = solved;
    if (track.key !== this.last.key && !this.fresh && this.now) { this.from = this.now; this.blend = { t: 0, dur: Math.max(1, track.blend) }; }
    this.blend.t = Math.min(this.blend.dur, this.blend.t + (frozen ? 0 : dtf));
    const w = this.fresh || !this.from ? 1 : smooth(this.blend.t / this.blend.dur), shown = w >= 1 ? solved : mixSolved(this.from!, solved, w);
    this.now = shown;
    for (const [name, bone] of this.bones) {
      const q = shown.local[name]; if (q) bone.quaternion.set(q[0], q[1], q[2], q[3]);
      const p = shown.moved[name]; if (p) bone.position.set(p[0], p[1], p[2]);
    }

    // Facing turns through the camera; the whole figure can spin about its hips (tumbles, flips) and stretch along its spine.
    const target = view.facing * PROFILE;
    if (this.fresh) this.yaw = target; else this.yaw += clamp(target - this.yaw, -dtf * 30, dtf * 30);
    this.group.position.set(view.x, view.y, 0);
    if (frozen && (view.state === 'hitstun' || view.state === 'tumble' || view.state === 'shieldstun')) {
      const amp = (ctx.reduced ? .02 : .075) * Math.min(1, .4 + view.hitlag / 10), a = Math.atan2(view.vy, view.vx), j = Math.sin(ctx.seconds * 97) * amp, k = Math.sin(ctx.seconds * 71 + 1) * amp * .5;
      this.group.position.x += Math.cos(a) * j - Math.sin(a) * k; this.group.position.y += Math.sin(a) * j + Math.cos(a) * k;
    }
    this.group.rotation.set(0, this.yaw * RAD, 0);
    const sy = 1 + shown.stretch, sxz = 1 / Math.sqrt(Math.max(.3, sy));
    this.body.scale.set(sxz, sy, sxz);   // squash and stretch about the feet
    this.group.updateMatrixWorld(true);
    this.stepSprings(this.fresh ? 0 : ctx.dt, frozen);
    this.smear(view, track, ctx, frozen);

    // Surface: hit flash, charge and intangibility glows, dithered fade for dodges.
    if (view.damage > this.last.damage && !this.fresh) this.flash = ctx.reduced ? .3 : .7;
    this.flash = Math.max(frozen && (view.state === 'hitstun' || view.state === 'tumble') ? .4 : 0, this.flash - dtf * .13);
    let flashAmt = this.flash, flashColor = HURT, rim = .5; u.uRimColor.value.set('#bcd9ff');
    if (view.charge > 0) { u.uRimColor.value.copy(CHARGE); rim = .6 + 1.6 * view.charge * (.6 + .4 * Math.sin(ctx.seconds * (14 + 20 * view.charge))); flashAmt = Math.max(flashAmt, .1 * view.charge); flashColor = CHARGE; }
    else if (view.intangible) { u.uRimColor.value.copy(SHIMMER); rim = 1 + .5 * Math.sin(ctx.seconds * 34); flashAmt = Math.max(flashAmt, .05 + .05 * Math.sin(ctx.seconds * 34)); flashColor = SHIMMER; }
    else if (view.armored) { u.uRimColor.value.copy(ARMOR); rim = 1.4 + .5 * Math.sin(ctx.seconds * 18); }
    u.uFlash.value.copy(flashColor).multiplyScalar(1.05); u.uFlashAmt.value = clamp01(flashAmt); u.uRim.value = rim;
    u.uFade.value = view.state === 'spotdodge' || view.state === 'airdodge' || view.state === 'roll' ? .45 : 0;
    u.uGlow.value = 1 + .12 * Math.sin(ctx.seconds * 5.3) + (view.state === 'attack' ? .35 : 0);
    u.uLift.value = ctx.lift ?? 1;   // legacy stages light for toon shading, far dimmer than an arena's rig: lift the crew to match
    this.trim(view, ctx, track);
    for (let p = this.group.parent; p; p = p.parent) {
      const feed = p.userData[FX_FEED] as FxFeed | undefined; if (!feed) continue;
      feed(view);
      // Authored accents fire once as the move's clock crosses their frame.
      const cue = p.userData[FX_CUE] as Fx['cue'] | undefined, same = track.key === this.last.key;
      if (cue && track.move?.cues) for (const q of track.move.cues) if (c.move >= q.f && (!same || this.cued < q.f)) { const at = q.at ? this.anchorWorld(q.at, v1) : v1.set(view.x, view.y, 0); cue(q.kind, at.x, at.y, q.power ?? 1, def.element.color); }
      this.cued = track.move ? c.move : 0; break;
    }
    Object.assign(this.last, { state: view.state, move: view.move, key: track.key, damage: view.damage, jumps: view.jumpsLeft, x: view.x, y: view.y });
    this.fresh = false;
  }

  /** Damped pendulums in world space: the fighter moves, turns and stops; cloth, scarf and lantern follow late and settle. */
  private stepSprings(dt: number, frozen: boolean) {
    for (const s of this.springs) {
      const parent = s.bone.parent!; parent.updateWorldMatrix(false, false);
      s.bone.quaternion.identity(); s.bone.updateMatrix(); s.bone.matrixWorld.multiplyMatrices(parent.matrixWorld, s.bone.matrix);
      const p = v1.setFromMatrixPosition(s.bone.matrixWorld), qp = q1.setFromRotationMatrix(m1.extractRotation(parent.matrixWorld)), want = v2.copy(s.rest).applyQuaternion(qp), [stiff, damp, gravity, maxDeg] = s.cfg;
      if (s.fresh || dt <= 0) { s.tip.copy(want).multiplyScalar(s.len).add(p); s.vel.set(0, 0, 0); s.fresh = false; }
      else if (!frozen) {
        const steps = Math.max(1, Math.round(dt * 120));
        for (let i = 0; i < steps; i++) {
          const h = dt / steps, k = 1 - Math.pow(1 - stiff, h * 60);
          s.vel.multiplyScalar(Math.pow(damp, h * 60)); s.vel.y -= gravity * h * .02;
          s.tip.add(v3.copy(s.vel).multiplyScalar(h * 60)); const before = v3.copy(s.tip);
          s.tip.lerp(v3.copy(want).multiplyScalar(s.len).add(p), k);
          // Keep the bone length and the swing cone, and fold the correction into the velocity so the motion stays continuous.
          let dir = v3.copy(s.tip).sub(p).normalize(); const ang = dir.angleTo(want), max = maxDeg * RAD;
          if (ang > max) dir = dir.lerp(want, 1 - max / ang).normalize();
          const next = dir.multiplyScalar(s.len).add(p); s.vel.add(next.clone().sub(before).multiplyScalar(.5)); s.tip.copy(next);
        }
      }
      const local = v3.copy(s.tip).sub(p).normalize().applyQuaternion(qp.invert());
      s.bone.quaternion.setFromUnitVectors(s.rest, local); s.bone.updateMatrix(); s.bone.matrixWorld.multiplyMatrices(parent.matrixWorld, s.bone.matrix);
      for (const child of s.bone.children) child.updateMatrixWorld(true);
    }
  }

  /** Weapon and limb smears during a move's trail frames, tinted with the fighter's element. */
  private smear(view: FighterView, track: Track, ctx: ActorContext, frozen: boolean) {
    const list: readonly CrewTrail[] = track.move?.trail ? (Array.isArray(track.move.trail) ? track.move.trail : [track.move.trail as CrewTrail]) : [];
    while (this.trails.length < list.length) { const t = new SwingTrail(); this.trails.push(t); (this.group.parent ?? this.group).add(t.mesh); }
    this.trails.forEach((t, i) => {
      if (!t.mesh.parent && this.group.parent) this.group.parent.add(t.mesh);
      const spec = list[i], f = this.clock.move;
      if (this.fresh) t.clear();
      if (spec && view.state !== 'hitstun' && f >= spec.frames[0] && f <= spec.frames[1] && !frozen) {
        const tip = this.anchorWorld(spec.tip, v1), base = this.anchorWorld(spec.base, v2), pivot = v3.setFromMatrixPosition(this.bones.get('chest')!.matrixWorld);
        t.push(base.clone().lerp(tip, 1 - (spec.width ?? .6)), tip.clone(), pivot.clone(), ctx.reduced ? .3 : .55, spec.color ?? this.o.def.element.color);
      }
      t.update(ctx.dt, frozen);
    });
  }

  private trim(view: FighterView, ctx: ActorContext, track?: Track) {
    const s = ctx.seconds, r = FIGHTERS[view.fighter].radius;
    let floor = -Infinity;
    for (const p of ctx.platforms) { const top = p.top ?? p.y; if (top !== undefined && top <= view.y + .08 && view.x >= p.left - .1 && view.x <= p.right + .1 && top > floor) floor = top; }
    const above = view.y - floor, show = floor > -Infinity && above < 12 && view.state !== 'respawn', fade = show ? clamp01(1 - above / 8) : 0;
    this.shadow.visible = fade > .02; this.ring.visible = show && fade > .05;
    if (show) for (const m of [this.shadow, this.ring]) { m.position.set(0, floor - view.y + .014, 0); m.rotation.y = -this.yaw * RAD; }
    this.shadow.scale.setScalar(r * 2.4 * (1 - .4 * clamp01(above / 6)) * (view.state === 'knockdown' ? 1.5 : 1)); (this.shadow.material as MeshBasicMaterial).opacity = .42 * fade;
    this.ring.scale.setScalar(r * 1.5); this.ring.position.y += .004; (this.ring.material as MeshBasicMaterial).opacity = .8 * fade;
    const shielding = view.state === 'shield' || view.state === 'shieldstun', aura = !shielding && track?.move?.aura && this.clock.move >= track.move.aura.frames[0] && this.clock.move < track.move.aura.frames[1] ? track.move.aura : null; this.shield.visible = shielding || !!aura;
    if (aura) {
      // The shield's fresnel sphere doubles as blown glass: it swells from the anchor as the move's frames pass, in the fighter's element colour.
      const at = this.anchorWorld(aura.at, v1), mu = this.shieldMat.uniforms, grow = smooth((this.clock.move - aura.frames[0]) / Math.min(10, aura.frames[1] - aura.frames[0]));
      this.shield.position.set(at.x - view.x + (aura.off?.[0] ?? 0) * view.facing, at.y - view.y + (aura.off?.[1] ?? 0), at.z); this.shield.scale.setScalar(aura.r * (.25 + .75 * grow));
      (mu.uColor.value as Color).set(this.o.def.element.color); mu.uCrack.value = 0; mu.uTime.value = s; mu.uAlpha.value = .6; mu.uHit.value = .15;
    }
    if (shielding) {
      (this.shieldMat.uniforms.uColor.value as Color).set(view.color);
      const hp = clamp01(view.shield / 100), mu = this.shieldMat.uniforms;
      this.shield.scale.setScalar(this.o.def.physics.shieldSize * (.3 + .7 * hp)); this.shield.position.set(0, this.height * .48, 0);
      mu.uCrack.value = hp < .3 ? (.3 - hp) / .3 : 0; mu.uTime.value = s; mu.uAlpha.value = .5 + (hp < .3 ? .15 * Math.sin(s * 20) : 0); mu.uHit.value = view.state === 'shieldstun' ? .8 : Math.max(0, mu.uHit.value - ctx.dt * 4);
    }
    this.halo.visible = view.state === 'respawn';
    if (this.halo.visible) { this.halo.position.set(0, -.05, 0); this.halo.scale.setScalar(r * 2.4); this.halo.rotation.y = s * 1.5; }
    const head = this.bones.get('head'), hy = head ? v1.setFromMatrixPosition(head.matrixWorld).y - view.y + .2 * this.height : this.height * 1.05, asleep = !!view.asleep, dizzy = view.state === 'dizzy' && !asleep;
    this.stars.forEach((m, i) => {
      m.visible = dizzy; if (!dizzy) return;
      const a = s * 4 + i * Math.PI * 2 / 3; m.position.set(Math.cos(a) * r * 1.1, hy + .06 * Math.sin(a * 2), Math.sin(a) * r * .6); m.rotation.set(0, -this.yaw * RAD, s * 3 + i); m.scale.setScalar(this.height * .06);
    });
    this.zs.forEach((m, i) => {
      m.visible = asleep; if (!asleep) return;
      const t = (s * .5 + i / 3) % 1; m.position.set(r * (.3 + .5 * t) * (i % 2 ? 1 : .6), hy + t * this.height * .5, 0); m.rotation.set(0, -this.yaw * RAD, .3 * Math.sin(t * 6));
      m.scale.setScalar(this.height * (.05 + .06 * t)); (m.material as MeshBasicMaterial).opacity = 1 - t;
    });
  }
  dispose() { this.group.removeFromParent(); for (const t of this.trails) t.dispose(); for (const x of this.owned.splice(0)) x.dispose(); }
}
/** Blend two solved poses joint by joint (cross-fades between clips). */
function mixSolved(a: Solved, b: Solved, t: number): Solved {
  const local: Record<string, Q> = {}, moved: Record<string, V3> = {};
  for (const k of Object.keys(b.local)) local[k] = a.local[k] ? slerp(a.local[k], b.local[k], t) : b.local[k];
  for (const k of Object.keys(b.moved)) { const p = a.moved[k] ?? b.moved[k], q = b.moved[k]; moved[k] = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; }
  return { ...b, local, moved, stretch: a.stretch + (b.stretch - a.stretch) * t };
}
export { anchor };
