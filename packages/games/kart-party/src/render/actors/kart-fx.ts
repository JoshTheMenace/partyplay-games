/* Per-kart attachments (boost flames, shield bubble, respawn drone, trailing item, ink blobs) and the
 * particle effects a kart emits every frame (drift sparks, dust, wind lines, star sparkles, zaps...). */
import * as THREE from 'three';
import { approach, clamp, lerp, smoothstep } from '../../sim/math';
import type { ItemId, ThemeId } from '../../sim/types';
import type { KartAssets, RacerPose } from '../types';
import { compactTemplate, FALLBACK_LIBRARY } from './compact';
import { fallbackTemplate } from './fallback';
import type { KartActor } from './kart';
import type { Fx } from './particles';
import { COLORS, DUST, FX, rainbow, rnd, TIER } from './presets';

/* ---------- shared geometry/material templates (built lazily, shared by every kart) ---------- */
let flameGeo: THREE.BufferGeometry | null = null, bubbleGeo: THREE.BufferGeometry | null = null, inkGeo: THREE.BufferGeometry | null = null, inkMat: THREE.Material | null = null;
function flameGeometry() {
  if (!flameGeo) { flameGeo = new THREE.ConeGeometry(.15, 1, 14, 1, true); flameGeo.rotateX(-Math.PI / 2); flameGeo.translate(0, 0, -.5); }
  return flameGeo;
}
const flameMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV; uniform float uTime;
    void main() { vAlong = clamp(-position.z, 0.0, 1.0); vec3 p = position; p.xy *= 1.0 + 0.18 * sin(uTime * 60.0 + position.z * 9.0) * vAlong;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vAlong; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uAlpha;
    void main() { float edge = pow(abs(dot(vN, vV)), 0.8); vec3 core = vec3(1.0, 0.95, 0.8) * 1.6;
      vec3 col = mix(core, uColor, smoothstep(0.02, 0.3, vAlong) * (1.0 - edge * 0.25));
      float a = uAlpha * pow(1.0 - vAlong, 1.2) * (0.35 + 0.65 * edge);
      gl_FragColor = vec4(col * a, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const bubbleMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime;
    void main() { vec3 p = position * (1.0 + 0.025 * sin(uTime * 7.0 + position.y * 3.0 + position.x * 2.0));
      vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uAlpha; uniform float uTime;
    vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
    void main() { float rim = pow(1.0 - abs(dot(vN, vV)), 2.4);
      vec3 col = mix(vec3(0.45, 0.9, 1.0), hue(rim * 0.8 + vP.y * 0.15 + uTime * 0.3), 0.45) * (0.5 + rim * 2.2);
      float glint = pow(max(0.0, dot(vN, normalize(vec3(-0.4, 0.8, 0.45)))), 40.0) * 2.0;
      float a = uAlpha * (0.1 + rim * 0.9 + glint);
      gl_FragColor = vec4((col + glint) * a, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
function inkBlobs() {
  if (!inkGeo) {
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, y, z, s] of [[.1, .78, .95, .28], [-.35, .72, .55, .2], [.55, .66, -.1, .22], [-.5, .66, -.2, .18], [.2, .95, -1.05, .24], [-.15, .64, 1.35, .16]]) {
      const g = new THREE.SphereGeometry(s, 10, 7); g.scale(1, .32, 1.15); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g);
    }
    inkGeo = mergeSimple(parts);
    inkMat = new THREE.MeshStandardMaterial({ color: 0x160c26, roughness: .12, metalness: .1 });
  }
  return new THREE.Mesh(inkGeo, inkMat!);
}
function mergeSimple(parts: THREE.BufferGeometry[]) {
  let n = 0; for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const p of parts) { pos.set(p.getAttribute('position').array as Float32Array, o * 3); nor.set(p.getAttribute('normal').array as Float32Array, o * 3); o += p.getAttribute('position').count; p.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.computeBoundingSphere(); return g;
}
/** Clone a (compacted) props.glb node or its primitive fallback. */
export const cloneProp = (assets: KartAssets, name: string) =>
  ((assets.props && compactTemplate(assets.props, name, () => assets.clone(name))) || compactTemplate(FALLBACK_LIBRARY, name, () => fallbackTemplate(name)))?.clone(true) ?? null;
const TRAIL_PROP: Partial<Record<ItemId, string>> = { peel: 'peel', bouncer: 'bouncer_shell', seeker: 'seeker_shell' };

export type FxEnv = { fx: Fx; dt: number; time: number; theme: ThemeId; reducedMotion: boolean };

export class KartExtras {
  private flames: THREE.Mesh[] = []; private flameMat: THREE.ShaderMaterial | null = null; private flameLevel = 0;
  private bubble: THREE.Mesh | null = null; private bubbleMat: THREE.ShaderMaterial | null = null; private bubbleScale = 0;
  private drone: THREE.Object3D | null = null; private rotors: THREE.Object3D[] = []; private droneAway = 0; private readonly droneFrom = new THREE.Vector3();
  private held: { item: string; obj: THREE.Object3D } | null = null; private readonly heldCache = new Map<string, THREE.Object3D>();
  private ink: THREE.Mesh | null = null; private inkScale = 0;
  readonly flameColor = new THREE.Color().copy(COLORS.flame); private flameHold = 0;
  private readonly group: THREE.Group;
  constructor(private readonly kart: KartActor, private readonly assets: KartAssets, world: THREE.Group) { this.group = world; }

  /** Tint the next boost flame (mini-turbo tier, pad, star...). */
  tint(color: THREE.Color, hold = .6) { this.flameColor.copy(color); this.flameHold = hold; }

  update(pose: RacerPose, env: FxEnv) {
    const k = pose.kart, r = pose.view, K = this.kart, fx = env.fx, dt = env.dt, speed = K.speed;
    // ---- Boost flames at the exhausts.
    const boosting = k.boostT > 0 || k.starT > 0;
    this.flameLevel = lerp(this.flameLevel, boosting ? clamp(.55 + (k.boostPower || .3) * 1.4, .6, 1.25) : 0, approach(boosting ? 20 : 9, dt));
    if (this.flameLevel > .02 && !this.flames.length) {
      this.flameMat = flameMaterial();
      for (const p of K.parts.exhausts) { const m = new THREE.Mesh(flameGeometry(), this.flameMat); m.position.copy(p); m.renderOrder = 13; m.frustumCulled = false; K.parts.body.add(m); this.flames.push(m); }
    }
    if (this.flameMat) {
      if (this.flameHold > 0) this.flameHold -= dt; else this.flameColor.lerp(k.starT > 0 ? rainbow(env.time * 1.5, .55, 2) : COLORS.flame, approach(3, dt));
      this.flameMat.uniforms.uColor.value.copy(this.flameColor); this.flameMat.uniforms.uTime.value = env.time;
      this.flameMat.uniforms.uAlpha.value = clamp(this.flameLevel * 1.2, 0, 1);
      for (const m of this.flames) { m.visible = this.flameLevel > .02; const f = this.flameLevel * (.85 + Math.random() * .3); m.scale.set(f * 1.1, f * 1.1, f * (1.1 + Math.random() * .5)); }
    }
    if (boosting && this.flameLevel > .3) for (const e of K.exhaust) {
      fx.emit(FX.flare, e.x, e.y, e.z, k.vx, k.vy, k.vz, this.flameColor, .35 * this.flameLevel);
      for (let i = fx.n(38 * this.flameLevel, dt); i > 0; i--) fx.emit(FX.ember, e.x, e.y, e.z, k.vx * .7 - K.forward.x * rnd(3, 7) + rnd(-1, 1), k.vy * .7 - K.forward.y * rnd(3, 7) + rnd(0, 1.5), k.vz * .7 - K.forward.z * rnd(3, 7) + rnd(-1, 1), this.flameColor, 1);
    } else if (speed < 6 && !K.respawning && k.stallT <= 0) for (const e of K.exhaust) for (let i = fx.n(5, dt); i > 0; i--) fx.emit(FX.puff, e.x, e.y, e.z, -K.forward.x * 1.2, .8, -K.forward.z * 1.2, COLORS.smoke);
    if (k.stallT > 0) for (const e of K.exhaust) for (let i = fx.n(22, dt); i > 0; i--) fx.emit(FX.smoke, e.x, e.y, e.z, -K.forward.x * 2 + rnd(-.5, .5), rnd(1, 2), -K.forward.z * 2 + rnd(-.5, .5), COLORS.darkSmoke, 1.2);

    const grounded = k.grounded && !K.respawning && K.airHeight < .3;
    // ---- Drift: at each rear wheel a flickering flame tongue + a shower of streak sparks in the tier
    // colour (white-hot while still charging), a small glow at the contact and light tyre smoke.
    if (k.drift && grounded) {
      const tier = k.driftTier, col = TIER[tier], lvl = tier ? .8 + tier * .2 : .45;
      for (let wi = 2; wi < 4; wi++) {
        const c = K.contact[wi], out = wi === 2 ? 1 : -1;               // rl is on +X (driver-left)
        const ox = -K.right.x * out, oz = -K.right.z * out;             // outward from the kart centre
        const bx = c.x - K.forward.x * .25 + ox * .12, bz = c.z - K.forward.z * .25 + oz * .12;
        fx.emit(FX.flare, bx, c.y + .12, bz, k.vx, 0, k.vz, col, (.5 + .14 * Math.sin(env.time * 53 + wi * 2)) * lvl);
        // Sparks ride with the kart (full velocity) and spray a short way out/back/up, so they read as
        // a fan at the wheel instead of trailing metres behind it.
        for (let i = fx.n(tier ? 150 : 40, dt); i > 0; i--)
          fx.emit(FX.tongue, bx, c.y + .12, bz, k.vx - K.forward.x * rnd(1, 2.5) + ox * rnd(.8, 2), rnd(1, 2.2), k.vz - K.forward.z * rnd(1, 2.5) + oz * rnd(.8, 2), col, lvl);
        for (let i = fx.n(tier ? 70 + tier * 25 : 20, dt); i > 0; i--)
          fx.emit(FX.spark, bx, c.y + .1, bz, k.vx - K.forward.x * rnd(.5, 3) + ox * rnd(1.5, 3.8), rnd(1.5, 4.2), k.vz - K.forward.z * rnd(.5, 3) + oz * rnd(1.5, 3.8), col, tier ? 1 : .8, 1, c.y);
        if (tier) fx.emit(FX.flare, bx, c.y + .14, bz, k.vx, 0, k.vz, COLORS.hot, .16 * lvl);   // white-hot core
        if (!tier || k.surface === 'ice') for (let i = fx.n(10, dt); i > 0; i--) fx.emit(FX.smoke, c.x, c.y + .15, c.z, k.vx * .3 + ox, .6, k.vz * .3 + oz, COLORS.smoke, .8);
      }
    }
    // ---- Surface spray from the rear wheels.
    if (grounded && speed > 4) {
      const s = k.surface, amount = clamp(speed / 25, .2, 1.2);
      const pre = s === 'water' ? FX.splash : s === 'ice' ? FX.snow : FX.dust;
      const col = s === 'water' ? COLORS.splash : s === 'ice' ? COLORS.ice : DUST[env.theme];
      const rate = s === 'water' ? 70 : s === 'offroad' ? 34 : s === 'ice' && (k.drift || speed > 20) ? 24 : env.theme === 'snow' && s === 'road' && k.drift ? 18 : 0;
      if (rate) for (let wi = 2; wi < 4; wi++) {
        const c = K.contact[wi];
        for (let i = fx.n(rate * amount, dt); i > 0; i--) {
          const up = s === 'water' ? rnd(3, 6.5) : rnd(.6, 2);
          fx.emit(pre, c.x + rnd(-.2, .2), c.y + .1, c.z + rnd(-.2, .2), k.vx * .35 - K.forward.x * rnd(1, 3) + rnd(-1.2, 1.2), up, k.vz * .35 - K.forward.z * rnd(1, 3) + rnd(-1.2, 1.2), col, s === 'offroad' ? amount : 1);
        }
      }
    }
    // ---- Landing puff.
    if (K.landed > 3 && !K.respawning) {
      const col = k.surface === 'water' ? COLORS.splash : k.surface === 'offroad' ? DUST[env.theme] : COLORS.smoke, n = fx.burst(clamp(K.landed * 2.5, 8, 22));
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; fx.emit(FX.dust, K.root.position.x + Math.cos(a) * .9, K.groundY + .15, K.root.position.z + Math.sin(a) * .9, Math.cos(a) * rnd(3, 6), rnd(.3, 1.2), Math.sin(a) * rnd(3, 6), col, .8); }
    }
    // ---- Slipstream wind lines streaming past.
    if ((k.slipCharge > .15 || k.slipT > 0) && speed > 10 && !env.reducedMotion) {
      const strength = k.slipT > 0 ? 1 : clamp(k.slipCharge / 1.4, .2, 1);
      for (let i = fx.n(40 * strength, dt); i > 0; i--) {
        const a = Math.random() * Math.PI * 2, rr = rnd(.9, 1.6), ox = K.right.x * Math.cos(a) * rr, oz = K.right.z * Math.cos(a) * rr, oy = .8 + Math.sin(a) * rr * .7;
        fx.emit(FX.wind, K.center.x + ox + K.forward.x * 2.5, K.root.position.y + oy, K.center.z + oz + K.forward.z * 2.5, k.vx * .15, 0, k.vz * .15, COLORS.wind, 1, 1);
      }
    }
    // ---- Star sparkles, shock zaps, ink drips.
    if (k.starT > 0) for (let i = fx.n(46, dt); i > 0; i--) fx.emit(FX.sparkle, K.center.x + rnd(-1.2, 1.2), K.center.y + rnd(-.4, 1.2), K.center.z + rnd(-1.2, 1.2), k.vx * .8, rnd(.5, 2), k.vz * .8, rainbow(Math.random(), .6, 2.2), rnd(.6, 1.2));
    if (k.shockT > 0) for (let i = fx.n(38, dt); i > 0; i--) {
      const a = Math.random() * Math.PI * 2, b = rnd(-.2, 1.1);
      fx.emit(FX.zap, K.center.x + Math.cos(a) * .7, K.center.y + b, K.center.z + Math.sin(a) * .7, k.vx + Math.cos(a) * rnd(3, 8), rnd(-3, 6), k.vz + Math.sin(a) * rnd(3, 8), Math.random() < .3 ? COLORS.zapCore : COLORS.zap);
    }
    if (k.inkT > 0) for (let i = fx.n(14, dt); i > 0; i--) fx.emit(FX.ink, K.center.x + rnd(-.8, .8), K.center.y + rnd(.1, .6), K.center.z + rnd(-.8, .8), k.vx * .8, rnd(-.5, 1), k.vz * .8, COLORS.ink, 1, 1, K.groundY + .02);
    this.inkScale = lerp(this.inkScale, k.inkT > 0 ? 1 : 0, approach(k.inkT > 0 ? 12 : 3, dt));
    if (this.inkScale > .01 && !this.ink) { this.ink = inkBlobs(); K.parts.body.add(this.ink); }
    if (this.ink) { this.ink.visible = this.inkScale > .01; this.ink.scale.setScalar(this.inkScale); }

    // ---- Shield bubble.
    const shield = k.shieldT > 0;
    this.bubbleScale = lerp(this.bubbleScale, shield ? 1 : 0, approach(shield ? 10 : 18, dt));
    if (this.bubbleScale > .01 && !this.bubble) {
      bubbleGeo ??= new THREE.SphereGeometry(1.8, 32, 20);
      this.bubbleMat = bubbleMaterial(); this.bubble = new THREE.Mesh(bubbleGeo, this.bubbleMat); this.bubble.renderOrder = 14; this.bubble.position.y = .85; K.root.add(this.bubble);
    }
    if (this.bubble && this.bubbleMat) {
      this.bubble.visible = this.bubbleScale > .01;
      const pulse = 1 + Math.sin(env.time * 5) * .02, warn = k.shieldT > 0 && k.shieldT < 2 ? .5 + .5 * Math.sin(env.time * 22) : 1;
      this.bubble.scale.setScalar(this.bubbleScale * pulse);
      this.bubbleMat.uniforms.uAlpha.value = clamp(this.bubbleScale, 0, 1) * (.55 + .45 * warn); this.bubbleMat.uniforms.uTime.value = env.time;
    }

    // ---- Trailing (held) item behind the kart.
    const want = r.trailing && r.item ? TRAIL_PROP[r.item] ?? null : null;
    if (this.held && this.held.item !== want) { this.held.obj.visible = false; this.held = null; }
    if (want && !this.held) {
      let obj = this.heldCache.get(want);
      if (!obj) { obj = cloneProp(this.assets, want) ?? new THREE.Group(); obj.traverse(o => { o.castShadow = true; }); this.heldCache.set(want, obj); K.root.add(obj); }
      obj.visible = true; this.held = { item: want, obj };
    }
    if (this.held) {
      const o = this.held.obj, wob = Math.sin(env.time * 9);
      o.position.set(wob * .12, want === 'peel' ? .02 : .1 + Math.abs(wob) * .04, -2.05 - clamp(speed / 30, 0, 1) * .25);
      o.rotation.set(0, want === 'peel' ? wob * .2 : env.time * 8, 0);
    }

    // ---- Respawn drone: descends, carries the kart away, lowers it at the respawn point, flies off.
    if (K.respawning || this.droneAway > 0) {
      if (!this.drone) {
        this.drone = cloneProp(this.assets, 'drone') ?? new THREE.Group();
        this.drone.traverse(o => { if (/rotor|propell?er|blade/i.test(o.name)) this.rotors.push(o); });
        this.group.add(this.drone);
      }
      this.drone.visible = true;
      for (let i = 0; i < this.rotors.length; i++) this.rotors[i].rotation.y += dt * (40 + i * 3) * (i % 2 ? -1 : 1);
      const kp = K.root.position;
      if (K.respawning) {
        const u = 1 - k.respawnT / 1.6, descend = u < .5 ? 1 - smoothstep(0, .12, u) : 0;
        // Hook tip (the model origin) picks the driver up by the scruff.
        this.drone.position.set(kp.x - K.forward.x * .3, kp.y + 1.85 + descend * 7, kp.z - K.forward.z * .3); this.drone.quaternion.copy(K.root.quaternion);
        this.drone.rotation.z += Math.sin(env.time * 3) * .05;
        this.droneAway = .9; this.droneFrom.copy(this.drone.position);
      } else {
        this.droneAway = Math.max(0, this.droneAway - dt);
        const a = 1 - this.droneAway / .9;
        this.drone.position.set(this.droneFrom.x + K.forward.x * a * 6, this.droneFrom.y + a * a * 14, this.droneFrom.z + K.forward.z * a * 6);
        this.drone.rotation.x = -.35 * a;
        if (this.droneAway === 0) this.drone.visible = false;
      }
    }
  }
  dispose() {
    this.flameMat?.dispose(); this.bubbleMat?.dispose();
    this.drone?.removeFromParent();
  }
}
