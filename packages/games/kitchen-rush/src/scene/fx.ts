// Pooled, instanced effects. Every system is one draw call and allocates nothing per frame.
import {
  AdditiveBlending, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  NormalBlending, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, type Texture,
} from 'three';

export const SHAPE = { puff: 0, spark: 1, flame: 2, fleck: 3, ring: 4, drop: 5, foam: 6, confetti: 7 } as const;
const quad = () => { const g = new InstancedBufferGeometry(); const plane = new PlaneGeometry(1, 1); g.index = plane.index; g.setAttribute('position', plane.getAttribute('position')); g.setAttribute('uv', plane.getAttribute('uv')); return g; };
const attribute = (g: InstancedBufferGeometry, name: string, size: number, capacity: number) => {
  const value = new InstancedBufferAttribute(new Float32Array(capacity * size), size); value.setUsage(DynamicDrawUsage); g.setAttribute(name, value); return value;
};

const PARTICLE_VERTEX = /* glsl */`
attribute vec3 iPos; attribute float iSize; attribute vec4 iColor; attribute vec2 iMisc;
varying vec2 vUv; varying vec4 vColor; varying float vShape;
void main() {
  vUv = uv; vColor = iColor; vShape = iMisc.x;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iMisc.y), s = sin(iMisc.y);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FRAGMENT = /* glsl */`
varying vec2 vUv; varying vec4 vColor; varying float vShape;
void main() {
  vec2 p = vUv - 0.5; float r = length(p), a = 0.0; vec3 color = vColor.rgb; int shape = int(vShape + 0.5);
  if (shape == 0) a = (1.0 - smoothstep(0.1, 0.5, r)) * (0.85 + 0.15 * (1.0 - smoothstep(0.0, 0.3, length(p - vec2(-0.1, 0.12)))));
  else if (shape == 1) { float star = max(0.0, 1.0 - abs(p.x) * 9.0) * max(0.0, 1.0 - abs(p.y) * 2.1) + max(0.0, 1.0 - abs(p.y) * 9.0) * max(0.0, 1.0 - abs(p.x) * 2.1); a = clamp(star + 1.0 - smoothstep(0.0, 0.22, r), 0.0, 1.0); color = mix(color, vec3(1.0), 1.0 - smoothstep(0.0, 0.12, r)); }
  else if (shape == 2) {
    // Teardrop flame: deep red rim, the base colour, then a saturated yellow core (never white, so it reads on pale counters).
    vec2 q = vec2(p.x * (1.2 + p.y * 1.2), p.y + 0.12); float d = length(vec2(q.x, max(q.y, 0.0) * 0.55 + min(q.y, 0.0)));
    a = 1.0 - smoothstep(0.26, 0.34, d);
    color = mix(color * vec3(0.95, 0.42, 0.3), color, 1.0 - smoothstep(0.14, 0.3, d));
    color = mix(color, vec3(1.0, 0.8, 0.22), 1.0 - smoothstep(0.02, 0.16, d));
  }
  else if (shape == 3) { vec2 q = abs(p) - 0.3; a = 1.0 - smoothstep(0.0, 0.06, max(q.x, q.y)); }
  else if (shape == 4) a = 1.0 - smoothstep(0.0, 0.07, abs(r - 0.4));
  else if (shape == 5) a = (1.0 - smoothstep(0.36, 0.5, r)) * (0.8 + 0.2 * (1.0 - smoothstep(0.0, 0.25, length(p - vec2(-0.12, 0.12)))));
  else if (shape == 6) {
    // Foam bubble: opaque white body, a cool blue rim that reads on pale counters and a glossy highlight.
    a = 1.0 - smoothstep(0.42, 0.5, r);
    color = mix(color, vec3(0.38, 0.62, 0.9), smoothstep(0.26, 0.44, r));
    color = mix(color, vec3(1.0), 1.0 - smoothstep(0.0, 0.1, length(p - vec2(-0.13, 0.14))));
  }
  else { vec2 q = abs(p) - vec2(0.36, 0.15); a = 1.0 - smoothstep(0.0, 0.05, max(q.x, q.y)); color *= 0.85 + 0.3 * step(0.0, p.y); }
  if (a * vColor.a < 0.004) discard;
  gl_FragColor = vec4(color, a * vColor.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

type Emit = { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; life: number; size: number; grow?: number; color: Color; alpha?: number; shape: number; gravity?: number; drag?: number; spin?: number };
const STRIDE = 18; // px py pz vx vy vz age life size grow r g b a shape rot spin gravity|drag packed below
/** Billboard particles simulated on the CPU into instanced attributes. */
export class Particles {
  readonly mesh: Mesh;
  private data: Float32Array; private extra: Float32Array; private alive = 0;
  private pos: InstancedBufferAttribute; private size: InstancedBufferAttribute; private color: InstancedBufferAttribute; private misc: InstancedBufferAttribute; private attrs: InstancedBufferAttribute[];
  constructor(readonly capacity: number, additive: boolean) {
    const g = quad();
    this.pos = attribute(g, 'iPos', 3, capacity); this.size = attribute(g, 'iSize', 1, capacity); this.color = attribute(g, 'iColor', 4, capacity); this.misc = attribute(g, 'iMisc', 2, capacity);
    this.attrs = [this.pos, this.size, this.color, this.misc];
    g.instanceCount = 0;
    const material = new ShaderMaterial({ vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT, transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending });
    this.mesh = new Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 6 : 5;
    this.data = new Float32Array(capacity * STRIDE); this.extra = new Float32Array(capacity * 2);
  }
  emit(o: Emit) {
    if (this.alive >= this.capacity) return;
    const i = this.alive++, d = this.data, k = i * STRIDE;
    d[k] = o.x; d[k + 1] = o.y; d[k + 2] = o.z; d[k + 3] = o.vx ?? 0; d[k + 4] = o.vy ?? 0; d[k + 5] = o.vz ?? 0;
    d[k + 6] = 0; d[k + 7] = o.life; d[k + 8] = o.size; d[k + 9] = o.grow ?? 1;
    d[k + 10] = o.color.r; d[k + 11] = o.color.g; d[k + 12] = o.color.b; d[k + 13] = o.alpha ?? 1; d[k + 14] = o.shape;
    // Flames stay upright; everything else starts at a random angle.
    const upright = o.shape === SHAPE.flame;
    d[k + 15] = upright ? 0 : Math.random() * Math.PI * 2; d[k + 16] = upright ? 0 : o.spin ?? 0;
    this.extra[i * 2] = o.gravity ?? 0; this.extra[i * 2 + 1] = o.drag ?? 0;
  }
  update(dt: number) {
    const d = this.data, e = this.extra;
    for (let i = 0; i < this.alive; i++) {
      const k = i * STRIDE;
      d[k + 6] += dt;
      if (d[k + 6] >= d[k + 7]) { // swap-remove the dead particle with the last live one
        const last = --this.alive;
        if (i !== last) { d.copyWithin(k, last * STRIDE, last * STRIDE + STRIDE); e[i * 2] = e[last * 2]; e[i * 2 + 1] = e[last * 2 + 1]; }
        i--; continue;
      }
      const drag = Math.max(0, 1 - e[i * 2 + 1] * dt);
      d[k + 3] *= drag; d[k + 5] *= drag; d[k + 4] = d[k + 4] * drag - e[i * 2] * dt;
      d[k] += d[k + 3] * dt; d[k + 1] += d[k + 4] * dt; d[k + 2] += d[k + 5] * dt; d[k + 15] += d[k + 16] * dt;
      if (e[i * 2] > 0 && d[k + 1] < .02) { d[k + 1] = .02; d[k + 4] *= -.3; d[k + 3] *= .6; d[k + 5] *= .6; }
    }
    const pos = this.pos.array as Float32Array, size = this.size.array as Float32Array, color = this.color.array as Float32Array, misc = this.misc.array as Float32Array;
    for (let i = 0; i < this.alive; i++) {
      const k = i * STRIDE, t = d[k + 6] / d[k + 7], ease = 1 - (1 - t) * (1 - t);
      pos[i * 3] = d[k]; pos[i * 3 + 1] = d[k + 1]; pos[i * 3 + 2] = d[k + 2];
      size[i] = d[k + 8] * (1 + (d[k + 9] - 1) * ease);
      color[i * 4] = d[k + 10]; color[i * 4 + 1] = d[k + 11]; color[i * 4 + 2] = d[k + 12];
      color[i * 4 + 3] = d[k + 13] * Math.min(1, t * 12) * (1 - t) ** 1.3;
      misc[i * 2] = d[k + 14]; misc[i * 2 + 1] = d[k + 15];
    }
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = this.alive;
    for (const attr of this.attrs) { attr.clearUpdateRanges(); attr.addUpdateRange(0, this.alive * attr.itemSize); attr.needsUpdate = true; }
  }
  clear() { this.alive = 0; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

const WIDGET_VERTEX = /* glsl */`
attribute vec3 iPos; attribute vec2 iScale; attribute vec4 iFill; attribute vec4 iBack; attribute vec3 iData;
varying vec2 vUv; varying vec4 vFill; varying vec4 vBack; varying vec3 vData; varying float vAspect;
void main() {
  vUv = uv; vFill = iFill; vBack = iBack; vData = iData; vAspect = iScale.x / iScale.y;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += position.xy * iScale;
  gl_Position = projectionMatrix * mv;
}`;
const WIDGET_FRAGMENT = /* glsl */`
varying vec2 vUv; varying vec4 vFill; varying vec4 vBack; varying vec3 vData; varying float vAspect;
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
void main() {
  vec2 p = (vUv - 0.5) * vec2(vAspect, 1.0); float aa = fwidth(p.y) * 1.3; int kind = int(vData.x + 0.5);
  vec4 ink = vec4(0.08, 0.09, 0.13, 0.94), col;
  if (kind == 0) {
    vec2 h = vec2(vAspect * 0.5, 0.5); float outer = box(p, h, 0.5), inner = box(p, h - 0.16, 0.34);
    float edge = mix(-h.x + 0.16, h.x - 0.16, vData.y);
    vec4 fill = p.x < edge ? vFill : vBack; fill.rgb *= 1.0 + 0.25 * step(0.06, p.y) * step(p.x, edge);
    col = mix(ink, fill, 1.0 - smoothstep(-aa, aa, inner)); col.a *= 1.0 - smoothstep(-aa, aa, outer);
  } else {
    float r = length(p), disc = 1.0 - smoothstep(0.5 - aa, 0.5, r), face = 1.0 - smoothstep(0.4 - aa, 0.4, r);
    vec4 inside = vFill;
    if (kind == 1) { float turn = fract(atan(p.x, p.y) / 6.2831853 + 1.0); inside = turn <= vData.y ? vFill : vBack; inside.rgb *= 1.0 + 0.18 * step(0.0, p.y); }
    else if (kind == 2) { float d = min(seg(p, vec2(-0.2, 0.0), vec2(-0.06, -0.14)), seg(p, vec2(-0.06, -0.14), vec2(0.21, 0.15))); inside = mix(vFill, vec4(1.0), 1.0 - smoothstep(0.06 - aa, 0.06 + aa, d)); }
    else if (kind == 3) { float d = min(seg(p, vec2(0.0, 0.2), vec2(0.0, -0.03)), length(p - vec2(0.0, -0.18)) - 0.01); inside = mix(vFill, vec4(1.0), 1.0 - smoothstep(0.065 - aa, 0.065 + aa, d)); }
    else if (kind == 4) { float d = min(seg(p, vec2(-0.16, -0.16), vec2(0.16, 0.16)), seg(p, vec2(-0.16, 0.16), vec2(0.16, -0.16))); inside = mix(vFill, vec4(1.0), 1.0 - smoothstep(0.07 - aa, 0.07 + aa, d)); }
    col = mix(ink, inside, face); col.a *= disc;
  }
  col.a *= vData.z;
  if (col.a < 0.01) discard;
  gl_FragColor = col;
  #include <colorspace_fragment>
}`;
export const WIDGET = { bar: 0, gauge: 1, check: 2, warn: 3, cross: 4 } as const;
/** Progress bars, cooking gauges and status badges: rebuilt every frame from game state, drawn above everything. */
export class Widgets {
  readonly mesh: Mesh; private count = 0;
  private pos: InstancedBufferAttribute; private scale: InstancedBufferAttribute; private fill: InstancedBufferAttribute; private back: InstancedBufferAttribute; private info: InstancedBufferAttribute; private attrs: InstancedBufferAttribute[];
  constructor(readonly capacity = 96) {
    const g = quad();
    this.pos = attribute(g, 'iPos', 3, capacity); this.scale = attribute(g, 'iScale', 2, capacity); this.fill = attribute(g, 'iFill', 4, capacity); this.back = attribute(g, 'iBack', 4, capacity); this.info = attribute(g, 'iData', 3, capacity);
    this.attrs = [this.pos, this.scale, this.fill, this.back, this.info]; g.instanceCount = 0;
    this.mesh = new Mesh(g, new ShaderMaterial({ vertexShader: WIDGET_VERTEX, fragmentShader: WIDGET_FRAGMENT, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    // Above nameplates (25) so a chef's plate never hides a progress bar or cooking badge; below popups (30).
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 27;
  }
  begin() { this.count = 0; }
  add(kind: number, x: number, y: number, z: number, width: number, height: number, value: number, fill: Color, back: Color = fill, alpha = 1) {
    if (this.count >= this.capacity) return;
    const i = this.count++, pos = this.pos.array as Float32Array, scale = this.scale.array as Float32Array, f = this.fill.array as Float32Array, b = this.back.array as Float32Array, info = this.info.array as Float32Array;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; scale[i * 2] = width; scale[i * 2 + 1] = height;
    f[i * 4] = fill.r; f[i * 4 + 1] = fill.g; f[i * 4 + 2] = fill.b; f[i * 4 + 3] = 1;
    b[i * 4] = back.r; b[i * 4 + 1] = back.g; b[i * 4 + 2] = back.b; b[i * 4 + 3] = 1;
    info[i * 3] = kind; info[i * 3 + 1] = value; info[i * 3 + 2] = alpha;
  }
  end() {
    (this.mesh.geometry as InstancedBufferGeometry).instanceCount = this.count;
    for (const attr of this.attrs) { attr.clearUpdateRanges(); attr.addUpdateRange(0, this.count * attr.itemSize); attr.needsUpdate = true; }
  }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), m = new Matrix4(), v = new Vector3(), s = new Vector3(), q = new Quaternion(), up = new Vector3(0, 1, 0);
/** Flat textured decals on the ground (blob shadows, target frames, chef rings), one instance each. */
export class Decals {
  readonly mesh: InstancedMesh; private count = 0;
  constructor(map: Texture, capacity: number, options: { opacity?: number; additive?: boolean; renderOrder?: number; color?: boolean; tint?: string } = {}) {
    const material = new MeshBasicMaterial({ map, color: options.tint ?? '#ffffff', transparent: true, depthWrite: false, opacity: options.opacity ?? 1, blending: options.additive ? AdditiveBlending : NormalBlending, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, capacity);
    if (options.color) this.mesh.setColorAt(0, new Color());
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = options.renderOrder ?? 2;
  }
  begin() { this.count = 0; }
  add(x: number, y: number, z: number, sx: number, sz = sx, color?: Color, angle = 0) {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    q.setFromAxisAngle(up, angle).multiply(flat);
    m.compose(v.set(x, y, z), q, s.set(sx, sz, 1)); this.mesh.setMatrixAt(this.count, m);
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(this.count, color);
    this.count++;
  }
  end() { this.mesh.count = this.count; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as MeshBasicMaterial).dispose(); this.mesh.dispose(); }
}
