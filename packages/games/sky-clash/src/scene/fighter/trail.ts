/**
 * Swing trail: a ribbon smear between a striking part's base and tip (blade root → blade tip, forearm → fist, shin → foot)
 * over the last few frames. World-space ring buffer, one additive draw per actor, rebuilt only while it has samples.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial, Vector3 } from 'three';

const N = 48, SUB = 6, LIFE = .14;
const p0 = new Vector3(), d0 = new Vector3(), d1 = new Vector3(), pb = new Vector3(), pt = new Vector3(), pv = new Vector3();
/** out = the a→b offset from its pivot at fraction s, swung along the arc between them (lengths blend linearly). */
function arc(out: Vector3, a: Vector3, pa: Vector3, b: Vector3, pb2: Vector3, s: number) {
  d0.subVectors(a, pa); d1.subVectors(b, pb2);
  const l0 = d0.length(), l1 = d1.length(), th = l0 > 1e-4 && l1 > 1e-4 ? d0.angleTo(d1) : 0, sn = Math.sin(th), len = l0 + (l1 - l0) * s;
  if (th < .05 || sn < .05) return out.lerpVectors(d0, d1, s);
  return out.copy(d0).multiplyScalar(Math.sin((1 - s) * th) / sn / l0 * len).addScaledVector(d1, Math.sin(s * th) / sn / l1 * len);
}
const VERT = `attribute float alpha; attribute float edge; varying float vA; varying float vE;
void main() { vA = alpha; vE = edge; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const FRAG = `uniform vec3 uColor; varying float vA; varying float vE;
void main() { float core = pow(vE, 2.2); gl_FragColor = vec4(mix(uColor, vec3(1.0), core * .7), vA * (.25 + .75 * vE)); }`;

export class SwingTrail {
  readonly mesh: Mesh;
  private pos = new Float32Array(N * 6); private life = new Float32Array(N);
  private head = 0; private count = 0; private strength = 0; private pivot = new Vector3();
  private geo = new BufferGeometry(); private mat: ShaderMaterial;

  constructor() {
    const edge = new Float32Array(N * 2), index: number[] = [];
    for (let i = 0; i < N; i++) { edge[i * 2] = 0; edge[i * 2 + 1] = 1; }
    for (let i = 0; i < N - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(N * 6), 3).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('alpha', new BufferAttribute(new Float32Array(N * 2), 1).setUsage(DynamicDrawUsage));
    this.geo.setAttribute('edge', new BufferAttribute(edge, 1));
    this.geo.setIndex(index); this.geo.setDrawRange(0, 0);
    this.mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uColor: { value: new Color('#ffffff') } }, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    this.mesh = new Mesh(this.geo, this.mat);
    // Vertices are world space: the mesh never takes its parent's transform.
    this.mesh.matrixAutoUpdate = false; this.mesh.matrixWorldAutoUpdate = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.name = 'swing-trail';
  }

  /**
   * Record this frame's edge (world space); strength 0–1 sets opacity. Between frames both ends swing around the pivot
   * (the shoulder or hip: direction slerp, length lerp), so a fast stroke draws a smooth crescent rather than a polygon.
   */
  push(base: Vector3, tip: Vector3, pivot: Vector3, strength: number, color: string) {
    if (this.count) {
      const j = (this.head - 1 + N) % N, life = this.life[j];
      for (let k = 1; k < SUB; k++) {
        const s = k / SUB; pv.lerpVectors(this.pivot, pivot, s);
        this.record(arc(pb, p0.fromArray(this.pos, j * 6), this.pivot, base, pivot, s).add(pv), arc(pt, p0.fromArray(this.pos, j * 6 + 3), this.pivot, tip, pivot, s).add(pv), life + (1 - life) * s);
      }
    }
    this.record(base, tip, 1); this.pivot.copy(pivot);
    this.strength = Math.max(this.strength * .8, strength); this.mat.uniforms.uColor.value.set(color);
  }
  private record(base: Vector3, tip: Vector3, life: number) {
    const i = this.head; this.head = (this.head + 1) % N; this.count = Math.min(N, this.count + 1);
    this.pos[i * 6] = base.x; this.pos[i * 6 + 1] = base.y; this.pos[i * 6 + 2] = base.z; this.pos[i * 6 + 3] = tip.x; this.pos[i * 6 + 4] = tip.y; this.pos[i * 6 + 5] = tip.z; this.life[i] = life;
  }

  /** Age the samples (frozen during hitlag) and rebuild the strip oldest → newest. */
  update(dt: number, frozen: boolean) {
    if (!this.count) { this.mesh.visible = false; return; }
    const out = this.geo.getAttribute('position') as BufferAttribute, a = this.geo.getAttribute('alpha') as BufferAttribute, P = out.array as Float32Array, A = a.array as Float32Array;
    let live = 0;
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - this.count + k + N) % N;
      if (!frozen) this.life[i] = Math.max(0, this.life[i] - dt / LIFE);
      if (this.life[i] <= 0) continue;
      P.set(this.pos.subarray(i * 6, i * 6 + 6), live * 6);
      A[live * 2] = A[live * 2 + 1] = this.life[i] * this.life[i] * this.strength; live++;
    }
    if (live < this.count) this.count = live; // expired samples are always the oldest
    out.needsUpdate = a.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, live - 1) * 6);
    this.mesh.visible = live > 1;
  }

  clear() { this.count = 0; this.mesh.visible = false; }
  get samples() { return this.count; }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}
