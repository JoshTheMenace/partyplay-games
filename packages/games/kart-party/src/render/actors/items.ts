/* Item entities on the course (peels, shells, bombs, comet, blasts) and the item boxes. Entities are
 * pooled per kind; boxes are drawn with a handful of InstancedMeshes (2–3 draw calls for all of them). */
import * as THREE from 'three';
import { approach, clamp, lerp } from '../../sim/math';
import { blastRadius } from '../../sim/items';
import { queryTrack, type Track } from '../../sim/track';
import type { Entity, EntityKind, RaceView } from '../../sim/types';
import type { KartAssets } from '../types';
import { compactTemplate, isRigMaterial, rigMaterial } from './compact';
import { cloneProp } from './kart-fx';
import type { Fx } from './particles';
import { COLORS, FX, rainbow, rnd } from './presets';

const PROP: Record<Exclude<EntityKind, 'blast'>, string> = { peel: 'peel', bouncer: 'bouncer_shell', seeker: 'seeker_shell', bomb: 'bomb', comet: 'comet' };
type Live = { kind: EntityKind; obj: THREE.Object3D | null; born: number; seen: number; fuse: THREE.Object3D | null; mats: THREE.MeshStandardMaterial[]; spin: number; ground: number };
const v = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), col = new THREE.Color();

/* ---------- explosion fireball ----------
 * A lumpy, normal-blended cartoon fireball: white-yellow core facing the camera, orange body, dark-red
 * soft rim; it billows (animated sine lumps), cools and dissolves into holes as it fades. */
const fireMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uSeed: { value: 0 }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
  vertexShader: `uniform float uT; uniform float uSeed; varying vec3 vN; varying vec3 vV; varying float vNoise;
    #include <fog_pars_vertex>
    float lumps(vec3 p) { return sin(dot(p, vec3(2.9, 1.7, -2.1)) + uSeed + uT * 5.0) * 0.5 + sin(dot(p, vec3(-4.3, 3.1, 2.7)) - uSeed * 1.3 - uT * 7.0) * 0.32 + sin(dot(p, vec3(6.1, -5.3, 4.9)) + uSeed * 0.7 + uT * 9.0) * 0.18; }
    void main() { float n = lumps(position); vNoise = n;
      vec3 p = position * (1.0 + n * 0.14); p.y *= 0.85 + uT * 0.35;
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `uniform float uT; varying vec3 vN; varying vec3 vV; varying float vNoise;
    #include <fog_pars_fragment>
    void main() { float facing = abs(dot(vN, vV)), heat = clamp(facing * 1.15 - uT * 0.95 + vNoise * 0.35, 0.0, 1.0);
      vec3 col = mix(vec3(0.42, 0.05, 0.02), vec3(1.0, 0.42, 0.06), smoothstep(0.05, 0.5, heat));
      col = mix(col, vec3(1.0, 0.86, 0.45), smoothstep(0.62, 0.95, heat)) * (1.0 + heat * 0.35);
      col = mix(col, vec3(0.16, 0.13, 0.12), smoothstep(0.5, 0.95, uT) * (1.0 - heat));
      float a = smoothstep(0.0, 0.55, facing) * (1.0 - smoothstep(0.6, 1.0, uT));
      a *= smoothstep(uT * 1.1 - 0.35, uT * 1.1 - 0.15, vNoise * 0.5 + 0.5);   // dissolve into holes
      if (a < 0.02) discard;
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  transparent: true, depthWrite: false, fog: true,
});
type Blast = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; radius: number };

/* ---------- item box shell ---------- */
const shellMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vI;
    void main() { vec4 wp = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
      #endif
      vec4 mv = modelViewMatrix * wp; vec3 n = normal;
      #ifdef USE_INSTANCING
        n = mat3(instanceMatrix) * n;
      #endif
      vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz); vP = position; vI = float(gl_InstanceID); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vI;
    vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
    void main() { float rim = pow(1.0 - abs(dot(vN, vV)), 1.6);
      vec3 a = abs(vP) / 0.6; float edge = smoothstep(0.82, 0.97, max(min(a.x, a.y), max(min(a.y, a.z), min(a.x, a.z))));
      vec3 c = hue(uTime * 0.35 + vI * 0.13 + dot(vP, vec3(0.5, 0.8, 0.3)) + rim * 0.3);
      vec3 col = mix(c, vec3(1.0), 0.35) * (0.6 + rim * 1.4 + edge * 1.6);
      float alpha = clamp(0.28 + rim * 0.5 + edge * 0.6, 0.0, 0.95);
      gl_FragColor = vec4(col, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false,
});
function questionTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); if (!g) return null;
  g.fillStyle = '#fff6c9'; g.fillRect(0, 0, 128, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128); grad.addColorStop(0, '#ffe46b'); grad.addColorStop(1, '#ff9d2e');
  g.fillStyle = grad; g.fillRect(6, 6, 116, 116);
  g.font = '900 100px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = '#8a3b00'; g.strokeText('?', 64, 70); g.fillStyle = '#ffffff'; g.fillText('?', 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** InstancedMesh per sub-mesh of a template; setMatrix() applies each sub-mesh's offset automatically. */
class Instancer {
  readonly meshes: { mesh: THREE.InstancedMesh; offset: THREE.Matrix4 }[] = [];
  constructor(template: THREE.Object3D, count: number, group: THREE.Group, override?: (mat: THREE.Material, name: string) => THREE.Material) {
    template.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(template.matrixWorld).invert();
    template.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material, im = new THREE.InstancedMesh(o.geometry, override ? override(mat, o.name) : mat, count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.castShadow = false;
      this.meshes.push({ mesh: im, offset: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) }); group.add(im);
    });
  }
  set(i: number, matrix: THREE.Matrix4) { for (const { mesh, offset } of this.meshes) { mesh.setMatrixAt(i, m.multiplyMatrices(matrix, offset)); } }
  commit() { for (const { mesh } of this.meshes) mesh.instanceMatrix.needsUpdate = true; }
  dispose() { for (const { mesh } of this.meshes) { mesh.removeFromParent(); mesh.dispose(); } }
}

export class ItemActors {
  readonly group = new THREE.Group();
  private readonly live = new Map<number, Live>();
  private readonly pools = new Map<EntityKind, THREE.Object3D[]>();
  private readonly blasts: Blast[] = [];
  private readonly boxes: Instancer | null;
  private readonly boxScale: Float32Array; private readonly boxPrev: Float32Array; private readonly boxPop: Float32Array;
  private readonly owned: { dispose(): void }[] = [];
  private readonly shell: THREE.ShaderMaterial | null = null;
  private frame = 0;
  onBlast: (x: number, y: number, z: number, radius: number) => void = () => {};

  constructor(private readonly track: Track, private readonly assets: KartAssets, private readonly fx: Fx) {
    const n = track.boxes.length;
    this.boxScale = new Float32Array(n).fill(1); this.boxPrev = new Float32Array(n); this.boxPop = new Float32Array(n);
    if (!n) { this.boxes = null; return; }
    const glb = assets.props && compactTemplate(assets.props, 'item_box', () => assets.clone('item_box'));
    if (glb) {
      // Keep the modelled "?" mark; swap the glass for the rainbow shell shader.
      this.shell = shellMaterial(); this.owned.push(this.shell);
      this.boxes = new Instancer(glb, n, this.group, mat => mat.transparent ? this.shell! : mat);
      for (const { mesh } of this.boxes.meshes) if (mesh.material === this.shell) mesh.renderOrder = 5;
    } else {
      // Rainbow shell + opaque "?" core.
      const shellGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2), coreGeo = new THREE.BoxGeometry(.62, .62, .62), tex = questionTexture();
      this.shell = shellMaterial();
      const coreMat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xffc53a, emissive: 0xffb020, emissiveIntensity: .35, roughness: .4 });
      const tpl = new THREE.Group(), core = new THREE.Mesh(coreGeo, coreMat), shell = new THREE.Mesh(shellGeo, this.shell);
      tpl.add(core, shell);
      this.boxes = new Instancer(tpl, n, this.group);
      this.boxes.meshes[1].mesh.renderOrder = 5;
      this.owned.push(shellGeo, coreGeo, coreMat, this.shell); if (tex) this.owned.push(tex);
    }
  }

  update(race: RaceView, time: number, dt: number) {
    this.frame++;
    // ---- Item boxes.
    // Items off: the sim never arms the boxes (timers stay 0), so hide them and their shadows outright.
    const on = race.items !== 'off';
    if (this.boxes) for (const { mesh } of this.boxes.meshes) mesh.visible = on;
    if (!on) this.boxScale.fill(0);
    if (this.boxes && on) {
      if (this.shell) this.shell.uniforms.uTime.value = time;
      for (let i = 0; i < this.track.boxes.length; i++) {
        const b = this.track.boxes[i], timer = race.boxes[i] ?? 0, prev = this.boxPrev[i];
        if (timer > 0 && prev <= 0 && this.frame > 1) this.shatter(b.x, b.y, b.z);
        if (timer <= 0 && prev > 0) this.boxPop[i] = .45;
        this.boxPrev[i] = timer;
        let scale: number;
        if (timer > 0) scale = 0;
        else if (this.boxPop[i] > 0) { this.boxPop[i] = Math.max(0, this.boxPop[i] - dt); const p = 1 - this.boxPop[i] / .45; scale = 1 + Math.sin(p * Math.PI) * .35 * (1 - p) - (1 - p) ** 3; }
        else scale = 1;
        this.boxScale[i] = lerp(this.boxScale[i], scale, scale === 0 ? 1 : approach(30, dt));
        const phase = i * 1.7, sc = Math.max(.0001, this.boxScale[i]);
        m.compose(v.set(b.x, b.y + .15 + Math.sin(time * 2.2 + phase) * .14, b.z), q.setFromEuler(e.set(.35 + Math.sin(time * .9 + phase) * .15, time * 1.3 + phase, .2)), s.set(sc, sc, sc));
        this.boxes.set(i, m);
      }
      this.boxes.commit();
    }
    // ---- Entities.
    for (const ent of race.entities) {
      let l = this.live.get(ent.id);
      if (!l) { l = this.spawn(ent, time); this.live.set(ent.id, l); }
      l.seen = this.frame;
      this.animate(ent, l, time, dt);
    }
    for (const [id, l] of this.live) if (l.seen !== this.frame) { this.retire(l); this.live.delete(id); }
    // ---- Blasts.
    for (const b of this.blasts) if (b.t < 1) {
      b.t = Math.min(1, b.t + dt / .75);
      const grow = 1 - (1 - Math.min(1, b.t / .4)) ** 3;
      b.mesh.scale.setScalar(Math.max(.01, b.radius * (.25 + .75 * grow)));
      b.mat.uniforms.uT.value = b.t; b.mesh.visible = b.t < 1;
    }
  }

  /** Explosion at a point (entity blasts and explode events share this; near-duplicates are merged). */
  explode(x: number, y: number, z: number, radius = 7) {
    if (radius < 3) { this.poof(x, y, z); return; }
    for (const b of this.blasts) if (b.t < .3 && (b.mesh.position.x - x) ** 2 + (b.mesh.position.z - z) ** 2 < 16) return;
    let b = this.blasts.find(b => b.t >= 1);
    if (!b) {
      if (this.blasts.length >= 6) b = this.blasts.reduce((a, c) => a.t > c.t ? a : c);
      else { const mat = fireMaterial(), mesh = new THREE.Mesh(blastGeometry(), mat); mesh.renderOrder = 15; mesh.frustumCulled = false; this.group.add(mesh); b = { mesh, mat, t: 1, radius }; this.blasts.push(b); this.owned.push(mat); }
    }
    b.t = 0; b.radius = radius * .55; b.mesh.position.set(x, y + 1.2, z); b.mat.uniforms.uSeed.value = Math.random() * 100; b.mesh.visible = true;
    this.fx.emit(FX.flash, x, y + 1.5, z, 0, 0, 0, COLORS.hot, radius * .5);
    const fx = this.fx, n = fx.burst(46);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, u = rnd(-.2, 1), sp = rnd(4, 13); fx.emit(FX.fire, x, y + 1, z, Math.cos(a) * sp * Math.sqrt(1 - u * u), u * sp * .8 + 3, Math.sin(a) * sp * Math.sqrt(1 - u * u), COLORS.fire, rnd(.6, 1.2)); }
    for (let i = fx.burst(18); i > 0; i--) { const a = Math.random() * Math.PI * 2, sp = rnd(2, 6); fx.emit(FX.blastSmoke, x + Math.cos(a) * 2, y + rnd(.5, 2.5), z + Math.sin(a) * 2, Math.cos(a) * sp, rnd(1, 4), Math.sin(a) * sp, COLORS.darkSmoke); }
    for (let i = fx.burst(30); i > 0; i--) { const a = Math.random() * Math.PI * 2, sp = rnd(6, 16); fx.emit(FX.burst, x, y + 1, z, Math.cos(a) * sp, rnd(4, 14), Math.sin(a) * sp, COLORS.spark, 1.5, 1.4, y); }
    for (let i = fx.burst(16); i > 0; i--) { const a = Math.random() * Math.PI * 2, sp = rnd(4, 11); fx.emit(FX.debris, x, y + .6, z, Math.cos(a) * sp, rnd(6, 13), Math.sin(a) * sp, COLORS.debris, 1.2, 1, y); }
    fx.emit(FX.bigRing, x, y + .4, z, 0, 0, 0, COLORS.fire, radius / 8);
    this.onBlast(x, y, z, radius);
  }

  /** Small pop when a shell breaks (hit a kart, a peel, too many ricochets). */
  private poof(x: number, y: number, z: number) {
    const fx = this.fx;
    fx.emit(FX.flash, x, y + .5, z, 0, 0, 0, COLORS.hot, .9);
    fx.emit(FX.ring, x, y + .4, z, 0, 0, 0, COLORS.white, 1.1);
    for (let i = fx.burst(18); i > 0; i--) { const a = Math.random() * Math.PI * 2, sp = rnd(3, 8); fx.emit(FX.burst, x, y + .4, z, Math.cos(a) * sp, rnd(2, 7), Math.sin(a) * sp, COLORS.spark, 1.1, 1, y); }
    for (let i = fx.burst(8); i > 0; i--) fx.emit(FX.puff, x + rnd(-.4, .4), y + .4, z + rnd(-.4, .4), rnd(-2, 2), rnd(1, 3), rnd(-2, 2), COLORS.white, 1.8);
    this.onBlast(x, y, z, 1.5);
  }

  private shatter(x: number, y: number, z: number) {
    const fx = this.fx;
    for (let i = fx.burst(26); i > 0; i--) { const a = Math.random() * Math.PI * 2, sp = rnd(3, 8); fx.emit(FX.shard, x, y, z, Math.cos(a) * sp, rnd(2, 8), Math.sin(a) * sp, rainbow(Math.random(), .62, 1.6), rnd(.8, 1.4), 1, y - 1.1); }
    for (let i = fx.burst(14); i > 0; i--) fx.emit(FX.sparkle, x + rnd(-.6, .6), y + rnd(-.6, .6), z + rnd(-.6, .6), rnd(-2, 2), rnd(0, 3), rnd(-2, 2), rainbow(Math.random(), .7, 2), rnd(.8, 1.5));
    fx.emit(FX.ring, x, y, z, 0, 0, 0, COLORS.white, 1.2);
  }

  private spawn(ent: Entity, time: number): Live {
    if (ent.kind === 'blast') { this.explode(ent.x, ent.y, ent.z, blastRadius(ent) || 7); return { kind: 'blast', obj: null, born: time, seen: 0, fuse: null, mats: [], spin: 0, ground: ent.y }; }
    const pool = this.pools.get(ent.kind) ?? [];
    let obj = pool.pop() ?? null;
    if (!obj) {
      obj = cloneProp(this.assets, PROP[ent.kind]) ?? new THREE.Group();
      const mats: THREE.MeshStandardMaterial[] = [];
      obj.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = true;
        if ((ent.kind === 'bomb' || ent.kind === 'seeker') && isRigMaterial(o.material as THREE.Material)) { const c = rigMaterial(); o.material = c; mats.push(c); this.owned.push(c); }
      });
      obj.userData.mats = mats;
      this.group.add(obj);
    }
    obj.visible = true;
    return { kind: ent.kind, obj, born: time, seen: 0, fuse: obj.getObjectByName('bomb_fuse') ?? null, mats: obj.userData.mats as THREE.MeshStandardMaterial[], spin: Math.random() * 6, ground: ent.y };
  }
  private retire(l: Live) {
    if (!l.obj) return;
    const p = l.obj.position, fx = this.fx;
    if (l.kind === 'peel' || l.kind === 'bouncer' || l.kind === 'seeker') for (let i = fx.burst(12); i > 0; i--) fx.emit(FX.puff, p.x, p.y + .3, p.z, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), COLORS.white, 1.2);
    l.obj.visible = false;
    let pool = this.pools.get(l.kind); if (!pool) this.pools.set(l.kind, pool = []);
    pool.push(l.obj);
  }

  private animate(ent: Entity, l: Live, time: number, dt: number) {
    const o = l.obj; if (!o) return;
    const fx = this.fx, age = time - l.born, speed = Math.hypot(ent.vx, ent.vz), pop = Math.min(1, age / .15);
    // Trails spawn along the segment travelled this frame so fast items leave a continuous streak, not beads.
    if (age > 0) this.from.copy(o.position); else this.from.set(ent.x, ent.y, ent.z);
    o.position.set(ent.x, ent.y, ent.z);
    l.ground = queryTrack(this.track, ent.x, ent.z, ent.hint, ent.y).ground ?? ent.y - 30;
    o.scale.setScalar(.4 + .6 * (1 - (1 - pop) ** 3));
    const heading = speed > .5 ? Math.atan2(ent.vx, ent.vz) : o.rotation.y;
    switch (ent.kind) {
      case 'peel': o.rotation.set(0, l.spin + Math.sin(age * 12) * .3 * Math.max(0, 1 - age), 0); break;
      case 'bouncer': case 'seeker': {
        l.spin += dt * (speed > 1 ? 16 : 3);
        o.rotation.set(0, l.spin, 0);
        const c = ent.kind === 'seeker' ? COLORS.shellR : COLORS.shellG;
        if (speed > 2) for (let i = fx.n(ent.kind === 'seeker' ? 90 : 70, dt); i > 0; i--) { const p = this.along(ent, .3); fx.emit(FX.trail, p.x + rnd(-.12, .12), p.y + rnd(-.08, .08), p.z + rnd(-.12, .12), -ent.vx * .05, rnd(0, .6), -ent.vz * .05, c, rnd(.6, 1)); }
        if (ent.kind === 'seeker') { const beep = Math.sin(time * 18) > .4 ? 1 : 0; for (const mt of l.mats) { mt.emissive.setRGB(1, .1, .1); mt.emissiveIntensity = beep * .8; } }
        break;
      }
      case 'bomb': {
        l.spin += dt * speed * .8;
        o.rotation.set(ent.vy !== 0 || speed > 1 ? l.spin : 0, heading, 0);
        // Fuse flashes faster as it burns down (fuse = seconds left once armed; fall back to age).
        const left = ent.fuse > 0 ? ent.fuse : Math.max(.1, 1.8 - age), rate = clamp(3 + 14 / Math.max(.15, left), 3, 26), flash = Math.sin(time * rate * Math.PI) > 0 ? 1 : 0;
        for (const mt of l.mats) { mt.emissive.setRGB(1, .12, .05); mt.emissiveIntensity = flash * .9; }
        if (l.fuse) { l.fuse.getWorldPosition(v); for (let i = fx.n(40, dt); i > 0; i--) fx.emit(FX.fuse, v.x, v.y, v.z, rnd(-1.5, 1.5), rnd(1, 3), rnd(-1.5, 1.5), COLORS.spark); fx.emit(FX.flare, v.x, v.y, v.z, ent.vx, ent.vy, ent.vz, COLORS.spark, .5 + flash * .3); }
        break;
      }
      case 'comet': {
        o.rotation.set(0, heading, time * 4);          // barrel-roll about the travel axis
        const cy = ent.y + 1;
        fx.emit(FX.flare, ent.x, cy, ent.z, ent.vx, ent.vy, ent.vz, COLORS.comet, 3.2);
        for (let i = fx.n(260, dt); i > 0; i--) { const p = this.along(ent, 1); fx.emit(FX.cometTail, p.x + rnd(-.3, .3), p.y + rnd(-.3, .3), p.z + rnd(-.3, .3), rnd(-1, 1), rnd(-.5, 1), rnd(-1, 1), col.copy(COLORS.comet).lerp(COLORS.cometEnd, Math.random()), rnd(.6, 1.1)); }
        for (let i = fx.n(50, dt); i > 0; i--) { const p = this.along(ent, 1); fx.emit(FX.sparkle, p.x + rnd(-1, 1), p.y + rnd(-1, 1), p.z + rnd(-1, 1), -ent.vx * .1, rnd(-1, 1), -ent.vz * .1, rainbow(Math.random(), .75, 1.6), 1); }
        break;
      }
    }
  }

  /** Random point on the segment an entity travelled this frame (from → entity), raised by `lift`. */
  private readonly from = new THREE.Vector3();
  private along(ent: Entity, lift: number) { const k = Math.random(), f = this.from; return v.set(f.x + (ent.x - f.x) * k, f.y + (ent.y - f.y) * k + lift, f.z + (ent.z - f.z) * k); }

  /** Blob shadows for live entities and present boxes: (x, groundY, z, size, height above ground). */
  forEachShadow(cb: (x: number, groundY: number, z: number, size: number, height: number) => void) {
    for (const l of this.live.values()) if (l.obj?.visible && l.kind !== 'blast' && l.kind !== 'comet') { const p = l.obj.position; cb(p.x, l.ground, p.z, l.kind === 'bomb' ? 1.4 : .95, Math.max(0, p.y - l.ground)); }
    for (let i = 0; i < this.track.boxes.length; i++) if (this.boxScale[i] > .05) { const b = this.track.boxes[i]; cb(b.x, b.y - 1.1, b.z, 1.3 * this.boxScale[i], 1); }
  }

  dispose() {
    this.boxes?.dispose();
    for (const o of this.owned) o.dispose();
    this.group.removeFromParent();
  }
}
let blastGeo: THREE.BufferGeometry | null = null;
const blastGeometry = () => blastGeo ??= new THREE.IcosahedronGeometry(1, 5);
