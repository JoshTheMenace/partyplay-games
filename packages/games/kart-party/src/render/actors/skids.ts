/* Skid marks: one ring-buffered ribbon mesh for every wheel on the course. Each wheel keeps its last
 * edge pair; moving far enough appends a quad that joins the previous one seamlessly. Quads fade out
 * by age in the shader, so nothing is touched after it is written. */
import * as THREE from 'three';

const MIN_STEP = .45, WIDTH = .16, LIFE = 7;
type Trail = { active: boolean; lx: number; ly: number; lz: number; rx: number; ry: number; rz: number; px: number; pz: number };

export class Skids {
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute; private readonly born: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private next = 0; private readonly trails = new Map<string, Trail>();
  private dirty0 = Infinity; private dirty1 = -1;
  constructor(private readonly capacity: number) {
    const g = new THREE.BufferGeometry(), index = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.born = new THREE.BufferAttribute(new Float32Array(capacity * 4).fill(-1e6), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('aBorn', this.born); g.setIndex(new THREE.BufferAttribute(index, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x15161a) }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: `attribute float aBorn; uniform float uTime; varying float vA;
        #include <fog_pars_vertex>
        void main() { float age = uTime - aBorn; vA = 0.55 * clamp(1.0 - age / ${LIFE.toFixed(1)}, 0.0, 1.0) * clamp(age * 8.0 + 0.4, 0.0, 1.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        #include <fog_pars_fragment>
        void main() { if (vA < 0.01) discard; gl_FragColor = vec4(uColor, vA);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.matrixAutoUpdate = false;
  }
  /** Lay (or break) the trail for one wheel. `rx/rz` is the kart's right vector on the ground. */
  mark(key: string, on: boolean, x: number, y: number, z: number, rx: number, rz: number, time: number) {
    let t = this.trails.get(key);
    if (!t) this.trails.set(key, t = { active: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, px: 0, pz: 0 });
    if (!on) { t.active = false; return; }
    const hw = WIDTH / 2, lx = x - rx * hw, lz = z - rz * hw, rrx = x + rx * hw, rrz = z + rz * hw, yy = y + .025;
    if (!t.active) { t.active = true; Object.assign(t, { lx, ly: yy, lz, rx: rrx, ry: yy, rz: rrz, px: x, pz: z }); return; }
    const d2 = (x - t.px) ** 2 + (z - t.pz) ** 2;
    if (d2 < MIN_STEP * MIN_STEP) return;
    if (d2 > 25) { Object.assign(t, { lx, ly: yy, lz, rx: rrx, ry: yy, rz: rrz, px: x, pz: z }); return; }   // teleport: restart
    const i = this.next, p = this.pos.array as Float32Array, b = this.born.array as Float32Array, o = i * 12;
    p[o] = t.lx; p[o + 1] = t.ly; p[o + 2] = t.lz; p[o + 3] = t.rx; p[o + 4] = t.ry; p[o + 5] = t.rz;
    p[o + 6] = lx; p[o + 7] = yy; p[o + 8] = lz; p[o + 9] = rrx; p[o + 10] = yy; p[o + 11] = rrz;
    b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = b[i * 4 + 3] = time;
    t.lx = lx; t.ly = yy; t.lz = lz; t.rx = rrx; t.ry = yy; t.rz = rrz; t.px = x; t.pz = z;
    this.dirty0 = Math.min(this.dirty0, i); this.dirty1 = Math.max(this.dirty1, i);
    this.next = (i + 1) % this.capacity;
  }
  forget(prefix: string) { for (const key of this.trails.keys()) if (key.startsWith(prefix)) this.trails.delete(key); }
  update(time: number) {
    this.material.uniforms.uTime.value = time;
    if (this.dirty1 < 0) return;
    this.pos.clearUpdateRanges(); this.born.clearUpdateRanges();
    this.pos.addUpdateRange(this.dirty0 * 12, (this.dirty1 - this.dirty0 + 1) * 12); this.born.addUpdateRange(this.dirty0 * 4, (this.dirty1 - this.dirty0 + 1) * 4);
    this.pos.needsUpdate = true; this.born.needsUpdate = true;
    this.dirty0 = Infinity; this.dirty1 = -1;
  }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
