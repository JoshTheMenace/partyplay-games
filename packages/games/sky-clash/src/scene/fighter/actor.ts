/**
 * One fighter on screen: a cloned GLB driven by the procedural pose system, with toon materials recolored per costume,
 * camera-scaled outlines, contact shadow, player ring, shield bubble, respawn halo and status effects (dizzy stars,
 * sleep Zs, intangibility shimmer, charge glow, hit flash, hitlag shake).
 *
 *   const actor = new FighterActor({ view, model: models, cache }); scene.add(actor.group);
 *   actor.update(view, prev, { dt, seconds, reduced, cameraDistance, platforms });
 */
import { AdditiveBlending, Color, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, ShaderMaterial, SkinnedMesh, Vector3, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FIGHTERS, type FighterView, type Limb } from '../../model';
import { PHYSICS } from '../../moveset';
import { animate, type Clock, type Meta } from './animate';
import type { FighterCache } from './cache';
import { showsProp, styleOf, type Style } from './library';
import { fighterUniforms, outlineMaterial, toonMaterial, type FighterUniforms } from './materials';
import { moveInfo } from './moves';
import { SCALAR, backOut, clamp, clamp01, dense, smooth } from './pose';
import { paletteFor, type FighterModel, type FighterModels } from './prepare';
import { HeldProps, heldOf } from './props';
import { Rig } from './rig';
import { SwingTrail } from './trail';
import { FX_FEED, type FxFeed } from '../fx';

/** A floor the renderer can drop a shadow onto: stageFrame() platforms ({y}) or blocks ({top}). */
export type Surface = { left: number; right: number; y?: number; top?: number };
export type ActorContext = { dt: number; seconds: number; reduced: boolean; cameraDistance: number; platforms: readonly Surface[] };
type Options = { view: FighterView; model: FighterModel | FighterModels; cache: FighterCache };

const RAD = Math.PI / 180, PROFILE = 70;
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), m1 = new Matrix4(), q1 = new Quaternion(), AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1), CHARGE = new Color(1, .86, .45), SHIMMER = new Color(.75, .9, 1), ARMOR = new Color(1, .55, .2);
const angleLerp = (a: number, b: number, t: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

const SHIELD_VERT = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() { vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const SHIELD_FRAG = `uniform vec3 uColor; uniform float uAlpha; uniform float uCrack; uniform float uHit; uniform float uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float bands = .5 + .5 * sin(vP.y * 14.0 + uTime * 3.0);
  float c = abs(sin(vP.x * 9.0 + sin(vP.y * 13.0) * 1.7) * sin(vP.y * 7.0 + vP.z * 11.0 + sin(vP.x * 5.0)));
  float crack = step(.93, c) * uCrack;
  vec3 col = uColor * (.55 + 1.1 * fres + .12 * bands) + vec3(1.0) * (crack * 1.2 + uHit * .6 * fres);
  gl_FragColor = vec4(col, clamp(uAlpha * (.22 + .78 * fres) + crack * .6 + uHit * .25, 0.0, 1.0));
}`;

export class FighterActor {
  readonly group = new Group();
  readonly height: number;
  readonly style: Style;
  readonly rig: Rig;
  private body = new Group();
  private model: Object3D;
  private uniforms: FighterUniforms = fighterUniforms();
  private owned: { dispose(): void }[] = [];
  private pose = dense();
  private clock: Clock = { state: 0, move: 0, seconds: 0, gait: 0, airJump: 99 };
  private last: { state: FighterView['state'] | ''; move: string | null; key: string; damage: number; jumps: number; costume: number; grounded: boolean } = { state: '', move: null, key: '', damage: 0, jumps: 0, costume: -1, grounded: true };
  private blend = { t: 1, dur: 1, spin: 0, yaw: 0, lean: 0, squash: 0, lift: 0 };
  private body0 = { spin: 0, yaw: 0, lean: 0, squash: 0, lift: 0 };
  private yaw = 0; private flash = 0; private floorLift = 0; private fresh = true;
  private shadow: Mesh; private ring: Mesh; private shield: Mesh; private shieldMat: ShaderMaterial; private halo: Group; private stars: Mesh[] = []; private zs: Mesh[] = [];
  private fighter: FighterModel;
  private scale: number;
  /** Every nth skinned vertex: lying poses rest the true lowest point of the mesh on the floor (bones sit inside round bodies). */
  private samples: { mesh: Mesh; stride: number }[] = [];
  private prop = 0;
  private held: HeldProps; private trail = new SwingTrail();

  constructor({ view, model, cache }: Options) {
    const m = (model as FighterModels).get ? (model as FighterModels).get(view.fighter) : model as FighterModel;
    if (!m) throw new Error(`The ${FIGHTERS[view.fighter]?.name ?? view.fighter} model is not loaded.`);
    this.fighter = m; this.style = styleOf(view.fighter);
    this.model = cloneSkinned(m.scene);
    const roster = FIGHTERS[view.fighter].height, ratio = roster / m.height;
    this.scale = ratio > .85 && ratio < 1.15 ? 1 : ratio;
    this.model.scale.setScalar(this.scale);
    if (this.style.body === 'flat') this.model.scale.x *= .16;
    this.height = m.height * this.scale;
    this.group.name = `fighter-${view.id}`;
    this.group.add(this.body); this.body.add(this.model);
    const wire = this.style.family === 'wire', u = this.uniforms;
    const toon = this.own(toonMaterial(u, cache.gradient, { translucent: wire })), line = this.own(outlineMaterial(u, { translucent: wire }));
    const meshes: Mesh[] = [];
    this.model.traverse(o => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
    for (const mesh of meshes) {
      mesh.material = toon; mesh.frustumCulled = false; mesh.renderOrder = 1;
      this.samples.push({ mesh, stride: Math.max(1, Math.ceil(mesh.geometry.getAttribute('position').count / 320)) });
      const skin = (mesh as SkinnedMesh).isSkinnedMesh ? mesh as SkinnedMesh : null, hull: Mesh = skin ? new SkinnedMesh(mesh.geometry, line) : new Mesh(mesh.geometry, line);
      if (skin && hull instanceof SkinnedMesh) hull.bind(skin.skeleton, skin.bindMatrix);
      hull.position.copy(mesh.position); hull.quaternion.copy(mesh.quaternion); hull.scale.copy(mesh.scale); hull.frustumCulled = false; hull.name = 'fighter-outline';
      mesh.parent!.add(hull);
    }
    m.slots.forEach((name, i) => { u.uGlow.value[i] = name === 'emissive' ? 1.1 : name === 'eye-white' ? .3 : 0; u.uEye.value[i] = name === 'eye' || name === 'eye-white' ? 1 : 0; });
    if (wire) { u.uRimColor.value.set('#8fe9ff'); u.uRim.value = .9; }
    this.rig = new Rig(this.model);
    this.held = new HeldProps(view.fighter, cache.gradient, clamp(this.height / 1.8, .55, 1.3));
    this.group.add(this.held.group, this.trail.mesh);

    const color = new Color(view.color);
    this.shadow = new Mesh(cache.plane, this.own(new MeshBasicMaterial({ map: cache.soft, color: 0x05030a, transparent: true, opacity: .45, depthWrite: false })));
    this.ring = new Mesh(cache.ring, this.own(new MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false, side: DoubleSide })));
    this.shadow.renderOrder = this.ring.renderOrder = 2;
    this.shieldMat = this.own(new ShaderMaterial({ vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG, transparent: true, depthWrite: false,
      uniforms: { uColor: { value: color.clone() }, uAlpha: { value: .5 }, uCrack: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } } }));
    this.shield = new Mesh(cache.sphere, this.shieldMat); this.shield.renderOrder = 5;
    const haloMat = this.own(new MeshBasicMaterial({ color, transparent: true, opacity: .9, blending: AdditiveBlending, depthWrite: false }));
    const discMat = this.own(new MeshBasicMaterial({ color: color.clone().lerp(WHITE, .5), map: cache.soft, transparent: true, opacity: .8, blending: AdditiveBlending, depthWrite: false }));
    this.halo = new Group(); this.halo.add(new Mesh(cache.halo, haloMat), new Mesh(cache.disc, discMat));
    const starMat = this.own(new MeshBasicMaterial({ color: '#ffe066', transparent: true, depthWrite: false, side: DoubleSide }));
    const zMat = this.own(new MeshBasicMaterial({ color: '#cfe4ff', transparent: true, depthWrite: false, side: DoubleSide }));
    for (let i = 0; i < 3; i++) { this.stars.push(new Mesh(cache.star, starMat)); this.zs.push(new Mesh(cache.zed, zMat.clone())); this.own(this.zs[i].material as MeshBasicMaterial); }
    for (const o of [this.shadow, this.ring, this.shield, this.halo, ...this.stars, ...this.zs]) { o.visible = false; this.group.add(o); }
    this.update(view, undefined, { dt: 0, seconds: 0, reduced: false, cameraDistance: 14, platforms: [] });
  }

  private own<T extends { dispose(): void }>(x: T): T { this.owned.push(x); return x; }
  /** Forget motion history: the next update poses exactly from the view (freeze frames, respawns, tools). */
  reset() { this.fresh = true; }

  update(view: FighterView, prev: FighterView | undefined, ctx: ActorContext) {
    const out = view.state === 'out';
    this.group.visible = !out;
    if (out) { this.fresh = true; this.last.state = 'out'; return; }
    const style = this.style, rig = this.rig, dtf = Math.min(6, ctx.dt * 60), flat = style.body === 'flat', u = this.uniforms;
    if (view.costume !== this.last.costume) { paletteFor(this.fighter, view.costume, u.uPalette.value); this.last.costume = view.costume; }

    // ── Local clocks: advance smoothly between 30 Hz snapshots, never drift far from the server's frame counters ──
    const c = this.clock, frozen = view.hitlag > 0;
    c.seconds = ctx.seconds;
    if (this.fresh || view.state !== this.last.state || view.stateFrame < c.state - 4) c.state = view.stateFrame;
    else if (!frozen) c.state = clamp(c.state + dtf, view.stateFrame - 1, view.stateFrame + 2.5);
    if (this.fresh || view.move !== this.last.move || view.moveFrame < c.move - 4) c.move = view.moveFrame;
    else if (!frozen) c.move = clamp(c.move + dtf, view.moveFrame - 1, view.moveFrame + 2.5);
    const speed = Math.abs(view.vx), running = view.state === 'run';
    if (!frozen) c.gait = (c.gait + speed * dtf / (rig.legLen * this.scale * (running ? 2.4 : 1.4))) % 1;
    c.airJump = !view.grounded && view.jumpsLeft < this.last.jumps && !this.fresh ? 0 : c.airJump + (frozen ? 0 : dtf);
    const step = flat ? (x: number) => Math.floor(x / 4) * 4 : (x: number) => x;
    const clock = flat ? { ...c, state: step(c.state), move: step(c.move), seconds: Math.floor(c.seconds * 15) / 15, gait: Math.floor(c.gait * 8) / 8 } : c;

    // ── Pose ──
    const info = view.move ? moveInfo(view.fighter, view.move, view.movePhase) : null, p = this.pose;
    const meta = animate(p, view, clock, style, info, { weaponLeft: rig.weaponLeft });
    if (meta.key !== this.last.key && !this.fresh) {
      rig.snapshot();
      Object.assign(this.blend, { t: 0, dur: meta.blend }, this.body0);
    }
    this.blend.t = Math.min(this.blend.dur, this.blend.t + dtf);
    const w = this.fresh ? 1 : smooth(this.blend.t / this.blend.dur), bl = this.blend;
    const spin = angleLerp(bl.spin, p[SCALAR.spin], w), yawAdd = angleLerp(bl.yaw, p[SCALAR.yaw], w), lean = angleLerp(bl.lean, p[SCALAR.lean], w);
    const squash = bl.squash + (p[SCALAR.squash] - bl.squash) * w, lift = bl.lift + (p[SCALAR.lift] - bl.lift) * w;
    Object.assign(this.body0, { spin, yaw: yawAdd, lean, squash, lift });

    // ── Facing: turn through the camera (never snap), except Game & Watch who flips like a paper cut-out ──
    const target = view.facing * (flat ? 90 : style.body === 'hand' ? 80 : style.body === 'round' ? 56 : PROFILE);
    if (this.fresh || flat) this.yaw = target;
    else this.yaw += clamp(target - this.yaw, -dtf * 34, dtf * 34);

    // ── Whole-body transform: spin/lean about the hips, volume-preserving squash about the feet ──
    const hipY = rig.hipY * this.scale, legLen = rig.legLen * this.scale;
    this.group.position.set(view.x, view.y, 0);
    if (frozen && (view.state === 'hitstun' || view.state === 'tumble' || view.state === 'shieldstun')) {
      // Hitlag shake along the launch line (Melee shakes the victim only).
      const amp = (ctx.reduced ? .02 : .07) * Math.min(1, .4 + view.hitlag / 10), a = Math.atan2(view.vy, view.vx);
      const j = Math.sin(ctx.seconds * 97) * amp, k = Math.sin(ctx.seconds * 71 + 1) * amp * .5;
      this.group.position.x += Math.cos(a) * j - Math.sin(a) * k; this.group.position.y += Math.sin(a) * j + Math.cos(a) * k;
    }
    this.group.rotation.set(0, this.yaw * RAD, 0);
    const sy = 1 + squash, sxz = 1 / Math.sqrt(Math.max(.2, sy));
    this.body.scale.set(sxz, sy, sxz);
    this.body.quaternion.setFromAxisAngle(AY, yawAdd * RAD).multiply(q1.setFromAxisAngle(AX, (spin + lean) * RAD));
    // Keep the hips pivot fixed under rotation: p' = R(S p) + T, so T = pivot − R·S·pivot (plus lift).
    v1.set(0, hipY, 0).multiply(this.body.scale).applyQuaternion(this.body.quaternion);
    this.body.position.set(-v1.x, hipY - v1.y + lift * legLen, -v1.z);
    this.floorLift += ((meta.floor ? this.floorLift : 0) - this.floorLift) * .5;
    this.body.position.y += this.floorLift;
    this.group.updateMatrixWorld(true);

    // ── Solve: IK toward live hitboxes (so the visible limb covers what actually hits) and ledge grips ──
    const toModel = m1.copy(this.model.matrixWorld).invert();
    const reach = meta.reach && view.hits?.length && meta.ik ? this.reachTarget(view, meta, toModel) : null;
    const hands = view.state === 'ledge' || view.state === 'ledgeclimb' ? this.ledgeTarget(view, ctx.platforms, toModel, view.state === 'ledge' ? 1 : 1 - smooth(c.state / (style.frames.climb * .5))) : null;
    // Props in 'move' mode pop out (small overshoot) for the moves that use them and tuck away after.
    const held = view.state === 'attack' ? heldOf(view.fighter, view.move) : undefined;
    const wantProp = !held?.hide && (this.fighter.prop === 'always' || (this.fighter.prop === 'move' && !!view.move && !!info && meta.key.includes(view.move) && showsProp(view.fighter, view.move, info)));
    this.prop = this.fresh ? +wantProp : clamp01(this.prop + (wantProp ? .34 : -.25) * dtf);
    rig.bones.prop?.scale.setScalar(Math.max(1e-3, this.prop >= 1 ? 1 : wantProp ? backOut(this.prop) : this.prop));
    rig.solve(p, toModel, { hand: style.body === 'hand', reach, hands });
    rig.blendFromSnapshot(w);
    this.model.updateMatrixWorld(true);
    if (meta.floor) {
      // Lying poses: rest the lowest body part on the floor.
      const low = this.lowest();
      if (low < Infinity) { const d = view.y + .01 - low; this.floorLift += d; this.body.position.y += d; this.group.updateMatrixWorld(true); }
    }
    rig.springsUpdate(this.fresh ? 0 : ctx.dt, frozen);
    if (this.fresh) rig.resetSprings();
    this.held.update(held, rig, { wind: info ? clamp01(c.move / Math.max(1, info.start)) : 0, struck: !!info && !info.hold && c.move >= Math.max(1, info.start), hits: view.hits, yaw: this.yaw * RAD, seconds: ctx.seconds });
    this.swingTrail(view, meta, info?.limb ?? null, ctx, frozen);

    // ── Surface effects ──
    const hit = view.damage > this.last.damage && !this.fresh;
    if (hit) this.flash = ctx.reduced ? .35 : .85;
    this.flash = Math.max(frozen && view.state === 'hitstun' ? .45 : 0, this.flash - dtf * .14);
    let flashAmt = this.flash, flashColor = WHITE, rim = style.family === 'wire' ? .9 : .22;
    // Charge glows warm from the rim inward and pulses faster as it fills; intangibility is a cool flickering rim.
    if (view.charge > 0) { u.uRimColor.value.copy(CHARGE); rim = .35 + .9 * view.charge * (.6 + .4 * Math.sin(ctx.seconds * (14 + 20 * view.charge))); flashAmt = Math.max(flashAmt, .08 * view.charge); flashColor = CHARGE; }
    else if (view.intangible) { u.uRimColor.value.copy(SHIMMER); rim = .55 + .3 * Math.sin(ctx.seconds * 34); flashAmt = Math.max(flashAmt, .04 + .04 * Math.sin(ctx.seconds * 34)); flashColor = SHIMMER; }
    else if (view.armored) { u.uRimColor.value.copy(ARMOR); rim = .8 + .3 * Math.sin(ctx.seconds * 18); }
    else u.uRimColor.value.set(style.family === 'wire' ? '#8fe9ff' : '#ffffff');
    u.uFlash.value.copy(flashColor); u.uFlashAmt.value = clamp01(flashAmt); u.uRim.value = rim; u.uFade.value = meta.fade;
    u.uOutline.value = clamp(ctx.cameraDistance * .0016, .006, .05) / this.scale * (flat ? 1.4 : 1);
    this.effects(view, ctx);

    for (let o = this.group.parent; o; o = o.parent) { const feed = o.userData[FX_FEED] as FxFeed | undefined; if (feed) { feed(view); break; } }
    Object.assign(this.last, { state: view.state, move: view.move, key: meta.key, damage: view.damage, jumps: view.jumpsLeft, grounded: view.grounded });
    this.fresh = false;
  }

  /** Smear the striking blade or limb through its active frames, sized by the move's power. */
  private swingTrail(view: FighterView, meta: Meta, limb: Limb | null, ctx: ActorContext, frozen: boolean) {
    const t = this.trail, rig = this.rig, b = rig.bones, mw = this.model.matrixWorld;
    if (this.fresh) t.clear();
    if (view.state === 'attack' && meta.swing > .05 && limb && limb !== 'body' && limb !== 'head' && !frozen) {
      const weapon = limb === 'weapon' && !!rig.blade, left = limb === 'handL' || limb === 'footL' || (limb === 'weapon' && rig.weaponLeft);
      const tip = rig.limbTip(weapon ? 'weapon' : limb === 'weapon' ? (left ? 'handL' : 'handR') : limb, v1).applyMatrix4(mw);
      const joint = limb.startsWith('foot') ? (left ? b.shin_L : b.shin_R) : left ? b.forearm_L : b.forearm_R;
      const base = weapon ? rig.limbTip(left ? 'handL' : 'handR', v2).applyMatrix4(mw).lerp(tip, .25) : joint ? v2.setFromMatrixPosition(joint.matrixWorld).lerp(tip, .55 - .3 * meta.power) : v2.copy(tip);
      const color = view.fighter === 'roy' ? '#ff9a4a' : weapon ? '#bfe4ff' : '#ffffff', root = limb.startsWith('foot') ? (left ? b.thigh_L : b.thigh_R) : left ? b.upperarm_L : b.upperarm_R;
      t.push(base, tip, root ? v3.setFromMatrixPosition(root.matrixWorld) : v3.copy(base), (ctx.reduced ? .5 : .85) * (.35 + .65 * meta.power) * meta.swing, color);
    }
    t.update(ctx.dt, frozen);
  }

  /** World y of the lowest sampled vertex in the current (skinned) pose. */
  private lowest() {
    let low = Infinity;
    for (const { mesh, stride } of this.samples) {
      const n = mesh.geometry.getAttribute('position').count;
      for (let i = 0; i < n; i += stride) { mesh.getVertexPosition(i, v1).applyMatrix4(mesh.matrixWorld); if (v1.y < low) low = v1.y; }
    }
    return low;
  }

  private reachTarget(view: FighterView, meta: Meta, toModel: Matrix4) {
    // The pose's own limb reaches for the farthest live hitbox (preferring hitboxes the engine tags with that limb).
    const hits = view.hits!, wanted = meta.reach!, tagged = hits.some(h => h.limb === wanted), cy = view.y + this.rig.hipY * this.scale;
    let best = hits[0], far = -1;
    for (const h of hits) if (!tagged || h.limb === wanted) { const d = (h.x - view.x) ** 2 + (h.y - cy) ** 2; if (d > far) { far = d; best = h; } }
    const anchor = this.anchorOf(wanted);
    return { limb: wanted as Limb, target: new Vector3(best.x, best.y, anchor).applyMatrix4(toModel), weight: meta.reachW };
  }
  /** World z of the joint the limb swings from, so reaches stay in that limb's own depth plane. */
  private anchorOf(limb: Limb) {
    const b = this.rig.bones, left = limb === 'handL' || limb === 'footL' || (limb === 'weapon' && this.rig.weaponLeft);
    const bone = limb.startsWith('hand') || limb === 'weapon' ? (left ? b.upperarm_L : b.upperarm_R) : limb.startsWith('foot') ? (left ? b.thigh_L : b.thigh_R) : b.chest;
    return bone ? v2.setFromMatrixPosition(bone.matrixWorld).z : 0;
  }
  private ledgeTarget(view: FighterView, platforms: readonly Surface[], toModel: Matrix4, weight: number) {
    if (weight <= 0) return null;
    const hx = view.x + view.facing * .2, hy = view.y + this.height * .95;
    let best: [number, number] | null = null, far = 1.6 ** 2;
    for (const s of platforms) {
      const top = s.top ?? s.y; if (top === undefined) continue;
      for (const x of [s.left, s.right]) { const d = (x - hx) ** 2 + (top - hy) ** 2; if (d < far) { far = d; best = [x, top]; } }
    }
    if (!best) return null;
    return { target: new Vector3(best[0], best[1] + .03, this.anchorOf('handR')).applyMatrix4(toModel), weight };
  }

  private effects(view: FighterView, ctx: ActorContext) {
    const s = ctx.seconds, r = FIGHTERS[view.fighter].radius;
    // Contact shadow and ring on the floor below (hidden over pits).
    let floor = -Infinity;
    for (const p of ctx.platforms) { const top = p.top ?? p.y; if (top !== undefined && top <= view.y + .08 && view.x >= p.left - .1 && view.x <= p.right + .1 && top > floor) floor = top; }
    const above = view.y - floor, show = floor > -Infinity && above < 12 && view.state !== 'respawn';
    const fade = show ? clamp01(1 - above / 8) : 0;
    this.shadow.visible = fade > .02; this.ring.visible = show && fade > .05;
    if (show) for (const o of [this.shadow, this.ring]) { o.position.set(0, floor - view.y + .012, 0); o.rotation.y = -this.yaw * RAD; }
    this.shadow.scale.setScalar(r * 2.6 * (1 - .4 * clamp01(above / 6)) * (view.state === 'knockdown' ? 1.5 : 1));
    (this.shadow.material as MeshBasicMaterial).opacity = .5 * fade;
    this.ring.scale.setScalar(r * 1.45); this.ring.position.y += .004;
    (this.ring.material as MeshBasicMaterial).opacity = .85 * fade;
    // Shield bubble: player color, shrinks with shield HP, cracks when low.
    const shielding = view.state === 'shield' || view.state === 'shieldstun';
    this.shield.visible = shielding;
    if (shielding) {
      const hp = clamp01(view.shield / 100), max = PHYSICS[view.fighter]?.shieldSize ?? .9;
      this.shield.scale.setScalar(max * (.3 + .7 * hp));
      this.shield.position.set(0, this.height * .48, 0);
      const mu = this.shieldMat.uniforms;
      mu.uCrack.value = hp < .3 ? (.3 - hp) / .3 : 0; mu.uTime.value = s; mu.uAlpha.value = .45 + (hp < .3 ? .15 * Math.sin(s * 20) : 0);
      mu.uHit.value = view.state === 'shieldstun' ? .8 : Math.max(0, mu.uHit.value - ctx.dt * 4);
    }
    // Respawn halo platform.
    this.halo.visible = view.state === 'respawn';
    if (this.halo.visible) { this.halo.position.set(0, -.05, 0); this.halo.scale.setScalar(r * 2.2); this.halo.rotation.y = s * 1.5; }
    // Dizzy stars orbit the head; sleep Zs drift up.
    const head = this.rig.bones.head, hy = head ? v1.setFromMatrixPosition(head.matrixWorld).y - view.y + .12 * this.height : this.height * 1.05;
    const asleep = !!view.asleep, dizzy = view.state === 'dizzy' && !asleep;
    this.stars.forEach((m, i) => {
      m.visible = dizzy; if (!dizzy) return;
      const a = s * 4 + i * Math.PI * 2 / 3; m.position.set(Math.cos(a) * r * 1.1, hy + .06 * Math.sin(a * 2), Math.sin(a) * r * .6); m.rotation.set(0, -this.yaw * RAD, s * 3 + i);
      m.scale.setScalar(this.height * .06);
    });
    this.zs.forEach((m, i) => {
      m.visible = asleep; if (!asleep) return;
      const t = (s * .5 + i / 3) % 1; m.position.set(r * (.3 + .5 * t) * (i % 2 ? 1 : .6), hy + t * this.height * .5, 0); m.rotation.set(0, -this.yaw * RAD, .3 * Math.sin(t * 6));
      m.scale.setScalar(this.height * (.05 + .06 * t)); (m.material as MeshBasicMaterial).opacity = 1 - t;
    });
  }

  dispose() {
    this.group.removeFromParent(); this.held.dispose(); this.trail.dispose();
    for (const x of this.owned.splice(0)) x.dispose();
  }
}
