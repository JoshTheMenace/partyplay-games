/* Pooled GPU particles: one instanced billboard draw per blend mode, simulated on the CPU in a flat
 * Float32Array (no per-frame allocation). Particles can stretch along their velocity (sparks, wind),
 * bounce off a per-particle floor, fade and change colour/size over their life. */
import * as THREE from 'three';

/** Fragment shapes. */
export const SHAPE = { soft: 0, spark: 1, rect: 2, ring: 3, star: 4 } as const;
export type Preset = {
  life: number; jitter: number;          // seconds, ± fraction of life
  size: number; sizeEnd: number;         // metres (quad half-extent)
  gravity: number; drag: number;         // m/s² downward, 1/s velocity decay
  shape: number; stretch: number;        // seconds of velocity drawn as a streak (0 = none)
  alpha: number; spin: number;           // start opacity, max random spin rad/s
  additive: boolean; bounce?: boolean;
  colorEnd?: THREE.Color;                // fade toward this colour (defaults to the start colour)
};

const STRIDE = 24; // px py pz vx vy vz age life s0 s1 r0 g0 b0 r1 g1 b1 a0 grav drag shape stretch rot rotV floor
const NO_FLOOR = -1e9;

const vertex = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iCol; attribute vec3 iMisc;
varying vec2 vUv; varying vec4 vCol; varying float vShape;
#include <fog_pars_vertex>
void main() {
  vec2 c = position.xy * 2.0; vUv = c; vCol = iCol; vShape = iMisc.z;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float size = iMisc.x;
  vec2 vv = (modelViewMatrix * vec4(iVel, 0.0)).xy;
  float vl = length(vv);
  if (vl > 0.002) {
    vec2 dir = vv / vl, perp = vec2(dir.y, -dir.x);   // (perp, dir) keeps the quad's winding (front-facing)
    mvPosition.xy += perp * c.x * size + dir * (c.y * (size + vl * 0.5) - vl * 0.5);
  } else {
    float cs = cos(iMisc.y), sn = sin(iMisc.y);
    if (iMisc.z > 1.5 && iMisc.z < 2.5) c.x *= abs(cos(iMisc.y * 1.7)) * 0.8 + 0.2;   // confetti flutter
    mvPosition.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  }
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const fragment = (additive: boolean) => /* glsl */`
varying vec2 vUv; varying vec4 vCol; varying float vShape;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv), a; vec3 col = vCol.rgb;
  if (vShape < 0.5) a = pow(max(0.0, 1.0 - r * r), 1.6);
  else if (vShape < 1.5) { a = pow(max(0.0, 1.0 - r), 1.4); col += vec3(pow(max(0.0, 1.0 - r * 2.2), 3.0) * 0.9); }
  else if (vShape < 2.5) a = step(abs(vUv.x), 0.92) * step(abs(vUv.y), 0.55);
  else if (vShape < 3.5) a = smoothstep(0.62, 0.84, r) * smoothstep(1.0, 0.88, r);
  else { float ax = abs(vUv.x), ay = abs(vUv.y); a = max(pow(max(0.0, 1.0 - ax * 7.0 - ay * 0.9), 1.0), pow(max(0.0, 1.0 - ay * 7.0 - ax * 0.9), 1.0)); a = max(a, pow(max(0.0, 1.0 - r * 2.2), 2.0)); col += vec3(a * 0.6); }
  a *= vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${additive ? `#ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif` : '#include <fog_fragment>'}
}`;

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  count = 0;
  private readonly data: Float32Array;
  private readonly pos: THREE.InstancedBufferAttribute; private readonly vel: THREE.InstancedBufferAttribute;
  private readonly col: THREE.InstancedBufferAttribute; private readonly misc: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  constructor(readonly capacity: number, additive: boolean) {
    this.data = new Float32Array(capacity * STRIDE);
    const g = this.geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
    const attr = (size: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.pos = attr(3)); g.setAttribute('iVel', this.vel = attr(3));
    g.setAttribute('iCol', this.col = attr(4)); g.setAttribute('iMisc', this.misc = attr(3));
    g.instanceCount = 0; this.attrs = [this.pos, this.vel, this.col, this.misc];
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment(additive), uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      transparent: true, depthWrite: false, fog: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 12 : 11;
    this.mesh.matrixAutoUpdate = false;
  }

  emit(p: Preset, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, sizeMul = 1, lifeMul = 1, floor = NO_FLOOR) {
    if (this.count >= this.capacity) return;
    const d = this.data, o = this.count++ * STRIDE, end = p.colorEnd ?? color;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = 0; d[o + 7] = Math.max(.02, p.life * lifeMul * (1 + (Math.random() * 2 - 1) * p.jitter));
    d[o + 8] = p.size * sizeMul; d[o + 9] = p.sizeEnd * sizeMul;
    d[o + 10] = color.r; d[o + 11] = color.g; d[o + 12] = color.b; d[o + 13] = end.r; d[o + 14] = end.g; d[o + 15] = end.b;
    d[o + 16] = p.alpha; d[o + 17] = p.gravity; d[o + 18] = p.drag; d[o + 19] = p.shape; d[o + 20] = p.stretch;
    d[o + 21] = Math.random() * 6.283; d[o + 22] = (Math.random() * 2 - 1) * p.spin; d[o + 23] = p.bounce ? floor : NO_FLOOR;
  }

  update(dt: number) {
    const d = this.data, P = this.pos.array as Float32Array, V = this.vel.array as Float32Array, C = this.col.array as Float32Array, M = this.misc.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      // Particles emitted this frame are drawn where they were spawned (no integration yet), so fast
      // emitters (a kart at 30 m/s) don't place them half a metre ahead of the source.
      const o = i * STRIDE, fresh = d[o + 6] === 0, step = fresh ? 0 : dt, age = fresh ? 1e-5 : d[o + 6] + dt;
      if (age >= d[o + 7]) { this.count--; if (i < this.count) d.copyWithin(o, this.count * STRIDE, this.count * STRIDE + STRIDE); continue; }
      d[o + 6] = age;
      const damp = Math.exp(-d[o + 18] * step);
      d[o + 4] -= d[o + 17] * step;
      d[o + 3] *= damp; d[o + 4] *= damp; d[o + 5] *= damp;
      d[o] += d[o + 3] * step; d[o + 1] += d[o + 4] * step; d[o + 2] += d[o + 5] * step;
      if (d[o + 1] < d[o + 23]) { d[o + 1] = d[o + 23]; d[o + 4] = Math.abs(d[o + 4]) * .35; d[o + 3] *= .7; d[o + 5] *= .7; }
      d[o + 21] += d[o + 22] * step;
      const t = age / d[o + 7], fade = Math.min(1, (fresh ? dt / d[o + 7] : t) * 12) * (1 - t * t), s = d[o + 8] + (d[o + 9] - d[o + 8]) * t, st = d[o + 20];
      const j3 = i * 3, j4 = i * 4;
      P[j3] = d[o]; P[j3 + 1] = d[o + 1]; P[j3 + 2] = d[o + 2];
      V[j3] = d[o + 3] * st; V[j3 + 1] = d[o + 4] * st; V[j3 + 2] = d[o + 5] * st;
      C[j4] = d[o + 10] + (d[o + 13] - d[o + 10]) * t; C[j4 + 1] = d[o + 11] + (d[o + 14] - d[o + 11]) * t; C[j4 + 2] = d[o + 12] + (d[o + 15] - d[o + 12]) * t;
      C[j4 + 3] = d[o + 16] * fade;
      M[j3] = s; M[j3 + 1] = d[o + 21]; M[j3 + 2] = d[o + 19];
      i++;
    }
    this.geometry.instanceCount = this.count;
    for (const a of this.attrs) { a.clearUpdateRanges(); if (this.count) { a.addUpdateRange(0, this.count * a.itemSize); a.needsUpdate = true; } }
  }
  clear() { this.count = 0; this.geometry.instanceCount = 0; }
  dispose() { this.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** Both blend modes behind one emit(); `budget` scales how many particles effects spawn (quality tiers). */
export class Fx {
  readonly group = new THREE.Group();
  readonly add: ParticleSystem; readonly blend: ParticleSystem;
  budget = 1;
  constructor(capacity: number) {
    this.add = new ParticleSystem(capacity, true); this.blend = new ParticleSystem(Math.round(capacity * .6), false);
    this.group.add(this.blend.mesh, this.add.mesh);
  }
  emit(p: Preset, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, sizeMul = 1, lifeMul = 1, floor = NO_FLOOR) {
    (p.additive ? this.add : this.blend).emit(p, x, y, z, vx, vy, vz, color, sizeMul, lifeMul, floor);
  }
  /** Particles to spawn this frame for a continuous emitter (dithered so low rates still emit on average). */
  n(ratePerSecond: number, dt: number) { return Math.floor(ratePerSecond * dt * this.budget + Math.random()); }
  /** Burst size scaled by quality (at least one). */
  burst(count: number) { return Math.max(1, Math.round(count * this.budget)); }
  update(dt: number) { this.add.update(dt); this.blend.update(dt); }
  get count() { return this.add.count + this.blend.count; }
  dispose() { this.add.dispose(); this.blend.dispose(); }
}
