/**
 * Pooled particles: one Points draw per blend mode, fixed typed arrays, ring-buffer reuse (no per-spawn allocation).
 * Sprites are procedural shapes drawn in the fragment shader, sized in world meters.
 */
import { AdditiveBlending, BufferAttribute, DynamicDrawUsage, BufferGeometry, NormalBlending, Points, ShaderMaterial, Vector4, type Camera, type WebGLRenderer } from 'three';

export const SHAPE = { glow: 0, spark: 1, ring: 2, star: 3, puff: 4, shard: 5, leaf: 6, coin: 7, bubble: 8, streak: 9, flame: 10, crescent: 11, burst: 12 } as const;
export type Shape = keyof typeof SHAPE;
export type Spawn = {
  x: number; y: number; z?: number; vx?: number; vy?: number; vz?: number; life: number; size: number; grow?: number;
  color: [number, number, number]; alpha?: number; gravity?: number; drag?: number; shape: Shape; spin?: number; angle?: number;
};

const VERT = `attribute vec4 color4; attribute vec2 shapeRot; attribute float size;
uniform float uScale; varying vec4 vColor; varying vec2 vShape;
void main() { vColor = color4; vShape = shapeRot; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(.1, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `uniform float uGain; varying vec4 vColor; varying vec2 vShape;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; p.y = -p.y;
  float c = cos(vShape.y), s = sin(vShape.y); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float r = length(p), a = 0.0; int k = int(vShape.x + .5);
  if (k == 0) a = exp(-r * r * 4.0);
  else if (k == 1) a = pow(max(0.0, 1.0 - abs(p.x)), 10.0) * (1.0 - abs(p.y)) + pow(max(0.0, 1.0 - abs(p.y)), 10.0) * (1.0 - abs(p.x)) + exp(-r * r * 18.0);
  else if (k == 2) a = smoothstep(.62, .78, r) * (1.0 - smoothstep(.84, 1.0, r));
  else if (k == 3) { float ang = atan(p.y, p.x); a = 1.0 - smoothstep(-.06, .06, r - mix(.4, .98, pow(.5 + .5 * cos(ang * 5.0 - 1.5708), 3.0))); }
  else if (k == 4) a = (1.0 - smoothstep(.2, 1.0, r)) * (.8 + .2 * sin(p.x * 7.0 + p.y * 5.0));
  else if (k == 5) a = 1.0 - smoothstep(.85, 1.0, abs(p.x) * 3.2 + abs(p.y));
  else if (k == 6) a = 1.0 - smoothstep(.8, 1.0, length(vec2(p.x * 2.2, p.y)));
  else if (k == 7) a = (1.0 - smoothstep(.85, 1.0, length(vec2(p.x * 1.4, p.y)))) * (.75 + .25 * step(.6, length(vec2(p.x * 1.4, p.y))));
  else if (k == 8) a = smoothstep(.55, .9, r) * (1.0 - smoothstep(.9, 1.0, r)) + .25 * exp(-r * r * 3.0);
  else if (k == 9) a = (1.0 - smoothstep(0.0, 1.0, abs(p.y) * 9.0)) * pow(max(0.0, 1.0 - abs(p.x)), 1.4) * (1.0 + step(abs(p.y), .035));   // a tapered streak along x with a hot core
  else if (k == 10) { vec2 q = vec2(p.x * (1.7 + p.y * .9), p.y * 1.05 + .1); a = 1.0 - smoothstep(.35, .95, length(q)); a *= a; }                         // teardrop flame, point up
  else if (k == 11) { float ang = atan(p.y, p.x); a = (1.0 - smoothstep(0.0, .13, abs(r - .72) + .05 * abs(ang))) * smoothstep(1.5, .5, abs(ang)); }        // crescent slash opening toward -x
  else { float ang = atan(p.y, p.x); float spike = pow(.5 + .5 * cos(ang * 4.0), 14.0) + .5 * pow(.5 + .5 * cos(ang * 8.0 + 3.1416), 22.0); a = (1.0 - smoothstep(-.04, .04, r - mix(.1, 1.0, spike))) * (1.0 - r * .6) + exp(-r * r * 30.0); }
  a *= vColor.a; if (a < .01) discard;
  gl_FragColor = vec4(vColor.rgb * uGain, a);
}`;

export class Particles {
  readonly points: Points;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private sh: Float32Array; private sz: Float32Array;
  private life: Float32Array; private max: Float32Array; private base: Float32Array; private grow: Float32Array; private alpha: Float32Array; private grav: Float32Array; private drag: Float32Array; private spin: Float32Array;
  private next = 0; private live = 0;
  private attrs: BufferAttribute[];
  private view = new Vector4();

  constructor(readonly capacity: number, additive: boolean) {
    const n = capacity, geo = new BufferGeometry();
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.sh = new Float32Array(n * 2); this.sz = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.base = new Float32Array(n); this.grow = new Float32Array(n); this.alpha = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.spin = new Float32Array(n);
    this.attrs = [new BufferAttribute(this.pos, 3), new BufferAttribute(this.col, 4), new BufferAttribute(this.sh, 2), new BufferAttribute(this.sz, 1)];
    ['position', 'color4', 'shapeRot', 'size'].forEach((name, i) => { this.attrs[i].setUsage(DynamicDrawUsage); geo.setAttribute(name, this.attrs[i]); });
    geo.setDrawRange(0, 0);
    const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending, uniforms: { uScale: { value: 600 }, uGain: { value: 1 } } });
    this.points = new Points(geo, mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 20 : 19;
    this.points.onBeforeRender = (renderer: WebGLRenderer, _s, camera: Camera) => {
      renderer.getCurrentViewport(this.view);
      mat.uniforms.uScale.value = this.view.w * camera.projectionMatrix.elements[5] * .5;
    };
  }
  get count() { return this.live; }
  /** Brightness multiplier: above 1 feeds the bloom of the HDR pipeline. */
  set gain(v: number) { (this.points.material as ShaderMaterial).uniforms.uGain.value = v; }

  spawn(p: Spawn) {
    // Ring buffer: the oldest particle is recycled when the pool is full.
    const i = this.next; this.next = (this.next + 1) % this.capacity;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z ?? .3;
    this.vel[i3] = p.vx ?? 0; this.vel[i3 + 1] = p.vy ?? 0; this.vel[i3 + 2] = p.vz ?? 0;
    this.col[i4] = p.color[0]; this.col[i4 + 1] = p.color[1]; this.col[i4 + 2] = p.color[2]; this.col[i4 + 3] = p.alpha ?? 1;
    this.sh[i * 2] = SHAPE[p.shape]; this.sh[i * 2 + 1] = p.angle ?? 0;
    this.life[i] = p.life; this.max[i] = p.life; this.base[i] = p.size; this.sz[i] = p.size; this.grow[i] = p.grow ?? 0; this.alpha[i] = p.alpha ?? 1;
    this.grav[i] = p.gravity ?? 0; this.drag[i] = p.drag ?? 0; this.spin[i] = p.spin ?? 0;
  }

  update(dt: number) {
    let top = 0; this.live = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) { if (this.col[i * 4 + 3] !== 0) { this.col[i * 4 + 3] = 0; this.sz[i] = 0; } continue; }
      this.life[i] -= dt;
      const i3 = i * 3, t = 1 - Math.max(0, this.life[i]) / this.max[i], k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.sz[i] = Math.max(0, this.base[i] * (1 + this.grow[i] * t));
      this.col[i * 4 + 3] = this.life[i] > 0 ? this.alpha[i] * (1 - t * t) : 0;
      this.sh[i * 2 + 1] += this.spin[i] * dt;
      this.live++; top = i + 1;
    }
    this.points.geometry.setDrawRange(0, top);
    for (const a of this.attrs) a.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.col.fill(0); this.points.geometry.setDrawRange(0, 0); this.live = 0; }
  dispose() { this.points.geometry.dispose(); (this.points.material as ShaderMaterial).dispose(); this.points.removeFromParent(); }
}
