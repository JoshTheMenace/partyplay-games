/* Primitive stand-ins for every props.glb scenery node (DESIGN §7), so a missing or late GLB never
 * leaves the world bare. Toy-like flat-shaded shapes, origin at ground contact, facing +Z, metres.
 * Also flattens any template (GLB or primitive) into one merged geometry per material for instancing. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TextureKit } from './textures';

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material };
export type Template = { parts: Part[]; radius: number; height: number };

export class PropLibrary {
  private mats = new Map<string, THREE.Material>();
  private geos: THREE.BufferGeometry[] = [];
  private cache = new Map<string, Template>();
  constructor(private readonly kit: TextureKit, private readonly night: boolean, private readonly clone: (name: string) => THREE.Object3D | null) {}

  /** Flat-shaded standard material, shared by colour + options. */
  mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}, key = '') {
    const k = `${color}|${key}|${JSON.stringify(Object.keys(opts))}`;
    let m = this.mats.get(k);
    if (!m) this.mats.set(k, m = new THREE.MeshStandardMaterial({ color, roughness: 0.78, flatShading: true, ...opts }));
    return m;
  }
  private glowMat(color: number, strength = 2.4) { return this.mat(color, { emissive: color, emissiveIntensity: strength, roughness: 0.4 }, `glow${strength}`); }

  /** Template for a prop kind: the GLB node when present, else the primitive stand-in. */
  template(kind: string, mirror = false): Template {
    const key = kind + (mirror ? ':m' : '');
    let t = this.cache.get(key);
    if (!t) { const src = this.clone(kind) ?? this.primitive(kind); this.cache.set(key, t = this.flatten(src, mirror)); }
    return t;
  }
  hasModel(kind: string) { return !!this.clone(kind); }

  /** Bake a hierarchy into one geometry per material (world transforms applied). */
  flatten(root: THREE.Object3D, mirror = false): Template {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), flip = new THREE.Matrix4().makeScale(mirror ? -1 : 1, 1, 1);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(flip, inv).multiply(mesh.matrixWorld));
      if (mirror) { const p = g.getAttribute('position'); for (let i = 0; i < p.count; i += 3) { const swap = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => { for (let c = 0; c < a.itemSize; c++) { const t = a.getComponent(i + 1, c); a.setComponent(i + 1, c, a.getComponent(i + 2, c)); a.setComponent(i + 2, c, t); } }; for (const name of Object.keys(g.attributes)) swap(g.getAttribute(name)); } }
      // Multi-material meshes: split by group. Flat colours are baked into vertex colours so a whole
      // prop (and every prop sharing a finish) draws with one shared material.
      const add = (m: THREE.Material, geo: THREE.BufferGeometry) => { const baked = this.bake(m, geo); push(byMat, baked ?? m, geo); };
      if (mats.length > 1 && g.groups.length) for (const grp of g.groups) add(mats[grp.materialIndex ?? 0], subRange(g, grp.start, grp.count));
      else add(mats[0], g);
    });
    const parts: Part[] = [], box = new THREE.Box3();
    for (const [material, list] of byMat) {
      const names = common(list), cleaned = list.map(g => { for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n); g.morphAttributes = {}; return g; });
      const joined = cleaned.length === 1 ? cleaned[0] : mergeGeometries(cleaned, false);
      if (!joined) continue;
      const merged = uniform(joined);
      merged.computeBoundingBox(); box.union(merged.boundingBox!); merged.computeBoundingSphere();
      this.geos.push(merged); parts.push({ geometry: merged, material });
    }
    return { parts, radius: Math.max(0.5, Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z)), height: Math.max(0.5, box.max.y) };
  }

  /** Replace a plain (untextured, opaque, non-glowing) standard material by a shared vertex-coloured one. */
  private bake(m: THREE.Material, geo: THREE.BufferGeometry): THREE.Material | null {
    const s = m as THREE.MeshStandardMaterial;
    if (!s.isMeshStandardMaterial || s.map || s.emissiveMap || s.normalMap || s.alphaMap || s.transparent) return null;
    // Glowing parts (windows, neon, lamps) become one unlit material whose vertex colour is the glow.
    const glow = s.emissiveIntensity > 0 && s.emissive.getHex() !== 0;
    const rough = Math.round(s.roughness * 4) / 4, metal = Math.round(s.metalness * 2) / 2;
    const key = glow ? `glow|${s.side}` : `bake|${rough}|${metal}|${s.flatShading ? 1 : 0}|${s.side}`;
    let shared = this.mats.get(key);
    if (!shared) this.mats.set(key, shared = glow ? new THREE.MeshBasicMaterial({ vertexColors: true, side: s.side })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, flatShading: s.flatShading, side: s.side }));
    const c = glow ? s.emissive.clone().multiplyScalar(s.emissiveIntensity).add(s.color.clone().multiplyScalar(0.12)) : s.color;
    const n = geo.getAttribute('position').count, prev = geo.getAttribute('color'), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r * (prev ? prev.getX(i) : 1); col[i * 3 + 1] = c.g * (prev ? prev.getY(i) : 1); col[i * 3 + 2] = c.b * (prev ? prev.getZ(i) : 1); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return shared;
  }

  // ---------------------------------------------------------------- primitive stand-ins
  primitive(kind: string): THREE.Object3D {
    const g = new THREE.Group(), K = this.kit, n = this.night;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz, 'YXZ'); mesh.scale.set(sx, sy, sz); g.add(mesh); this.geos.push(geo); return mesh;
    };
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const cyl = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
    const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);
    const sph = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
    const rock = (r: number, seed: number) => { const geo = new THREE.IcosahedronGeometry(r, 1), p = geo.getAttribute('position'); for (let i = 0; i < p.count; i++) { const k = 0.78 + 0.4 * frac(Math.sin((p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7 + seed) * 43758.5)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); } geo.computeVertexNormals(); return geo; };
    const trunk = this.mat(0x9a6b3f), wood = this.mat(0xc98f55), white = this.mat(0xf4f4f4), dark = this.mat(0x2a2c36), red = this.mat(0xe0453a), metal = this.mat(0x9aa0aa, { metalness: 0.6, roughness: 0.4 });
    const palm = (h: number, lean: number, leaf: number) => {
      let x = 0, y = 0;
      for (let i = 0; i < 6; i++) { const seg = h / 6; add(cyl(0.2 - i * 0.012, 0.26 - i * 0.012, seg * 1.05, 7), trunk, x, y + seg / 2, 0, 0, 0, -lean * (0.3 + i * 0.12)); x += Math.sin(lean * (0.3 + i * 0.12)) * seg; y += seg * Math.cos(lean * (0.3 + i * 0.12)); }
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add(cone(0.55, 3.8, 4), this.mat(i % 2 ? leaf : leaf + 0x101a08), x + Math.sin(a) * 1.5, y - 0.3, Math.cos(a) * 1.5, Math.PI / 2 + 0.55, a, 0, 1, 1, 0.18); }
      for (let i = 0; i < 3; i++) add(sph(0.2, 0), this.mat(0x6b4a2a), x + Math.sin(i * 2.1) * 0.3, y - 0.35, Math.cos(i * 2.1) * 0.3);
    };
    switch (kind) {
      case 'palm_a': palm(7.2, 0.28, 0x3fae3a); break;
      case 'palm_b': palm(8.6, -0.16, 0x2f9a45); break;
      case 'rock_beach': add(rock(1.3, 1), this.mat(0xb8aa92), 0, 0.7, 0); break;
      case 'rock_red_a': add(rock(1.5, 2), this.mat(0xb4553a), 0, 1.0, 0, 0, 0, 0, 1, 1.5, 1); break;
      case 'rock_red_b': add(rock(1.6, 3), this.mat(0xc2663f), 0, 0.8, 0, 0, 0.6, 0, 1.4, 0.9, 1); add(rock(0.8, 4), this.mat(0xa84a32), 1.4, 0.4, 0.4); break;
      case 'snow_rock': add(rock(1.4, 5), this.mat(0x6f7788), 0, 0.8, 0); add(rock(1.1, 6), this.mat(0xffffff), 0, 1.45, 0, 0, 0, 0, 1.05, 0.35, 1.05); break;
      case 'umbrella': {
        add(cyl(0.05, 0.05, 2.5, 5), white, 0, 1.25, 0);
        for (let i = 0; i < 8; i++) add(new THREE.ConeGeometry(1.6, 0.6, 2, 1, true, i / 8 * Math.PI * 2, Math.PI / 4), this.mat(i % 2 ? 0xffffff : 0xff4f6a, { side: THREE.DoubleSide }), 0, 2.45, 0);
        add(box(1.8, 0.02, 0.9), this.mat(0x2bb5e8), 1.2, 0.02, 0.6, 0, 0.4, 0); break;
      }
      case 'beach_hut': add(box(3.2, 2.4, 3.2), wood, 0, 1.2, 0); add(cone(2.8, 1.5, 4), red, 0, 3.15, 0, 0, Math.PI / 4); add(box(0.9, 1.7, 0.05), dark, 0, 0.85, 1.62); break;
      case 'lifeguard_tower': {
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(cyl(0.08, 0.1, 3, 5), white, x, 1.5, z);
        add(box(2.6, 0.2, 2.6), wood, 0, 3, 0); add(box(2.2, 1.6, 2.2), red, 0, 3.9, 0); add(cone(1.9, 0.8, 4), white, 0, 5.1, 0, 0, Math.PI / 4); add(box(0.8, 0.08, 2.6), wood, 0, 1.5, 2, -0.9, 0, 0); break;
      }
      case 'boat': add(box(2, 0.9, 5.2), white, 0, 0.3, 0); add(cone(1, 1.4, 4), white, 0, 0.3, 3.2, Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.64); add(box(1.8, 0.1, 4.6), wood, 0, 0.78, 0); add(cyl(0.06, 0.06, 5, 5), wood, 0, 3.2, -0.2); add(cone(1.4, 4.2, 3), this.mat(0xfff6e0, { side: THREE.DoubleSide }), 0, 3.2, 0.9, 0, Math.PI / 2, 0, 1, 1, 0.05); break;
      case 'cactus_a': { const c = this.mat(0x4f9e44); add(new THREE.CapsuleGeometry(0.38, 3.4, 3, 8), c, 0, 2, 0); add(new THREE.CapsuleGeometry(0.24, 1.2, 3, 8), c, 0.75, 2.4, 0); add(new THREE.CapsuleGeometry(0.24, 0.8, 3, 8), c, 0.45, 1.9, 0, 0, 0, Math.PI / 2); add(new THREE.CapsuleGeometry(0.22, 1, 3, 8), c, -0.7, 2.9, 0); add(new THREE.CapsuleGeometry(0.22, 0.6, 3, 8), c, -0.4, 2.5, 0, 0, 0, Math.PI / 2); break; }
      case 'cactus_b': { const c = this.mat(0x5aab4a); add(new THREE.CapsuleGeometry(0.5, 1.4, 3, 8), c, 0, 1.2, 0); add(new THREE.CapsuleGeometry(0.3, 0.7, 3, 8), c, 0.6, 1.3, 0.2, 0, 0, -0.7); add(sph(0.18, 0), this.mat(0xff5fa2), 0, 2.2, 0); break; }
      case 'mesa': { add(cyl(15, 19, 26, 9), this.mat(0xb8603c), 0, 13, 0); add(cyl(15.3, 15.6, 3, 9), this.mat(0xd98a5a), 0, 18, 0); add(cyl(14.6, 15, 1.2, 9), this.mat(0xc9774a), 0, 26.4, 0); break; }
      case 'water_tower': { for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) add(cyl(0.12, 0.16, 8, 5), metal, x, 4, z); add(cyl(2.4, 2.4, 3.2, 12), this.mat(0xe4e0d8), 0, 9.6, 0); add(cone(2.6, 1.4, 12), red, 0, 11.9, 0); break; }
      case 'windmill': {
        for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) add(box(0.14, 10, 0.14), metal, x * 0.6, 5, z * 0.6, z * 0.07, 0, -x * 0.07);
        add(box(0.5, 0.5, 1.2), metal, 0, 10, 0); for (let i = 0; i < 10; i++) add(box(0.3, 1.9, 0.04), white, Math.sin(i / 10 * Math.PI * 2) * 1.1, 10 + Math.cos(i / 10 * Math.PI * 2) * 1.1, 0.7, 0, 0, -i / 10 * Math.PI * 2);
        add(box(0.05, 1, 1.8), red, 0, 10, -1.3); break;
      }
      case 'building_a': case 'building_b': case 'building_c': {
        const seed = kind === 'building_a' ? 1 : kind === 'building_b' ? 2 : 3, win = K.windows(seed, n ? 0.5 : 0.3);
        const skin = this.mat([0x3b4260, 0x4a3f5e, 0x2f4a5a][seed - 1], { emissiveMap: win, emissive: 0xffffff, emissiveIntensity: n ? 1.6 : 0.2, map: win, roughness: 0.6 }, `bld${seed}`);
        const shell = (w: number, h: number, d: number, y: number) => { const geo = box(w, h, d); scaleUv(geo, w, h, d); add(geo, skin, 0, y + h / 2, 0); };
        if (seed === 1) { shell(10, 34, 10, 0); add(box(10.4, 0.6, 10.4), dark, 0, 34.3, 0); add(cyl(0.12, 0.12, 6, 4), metal, 0, 37.6, 0); add(sph(0.3, 0), this.glowMat(0xff3355), 0, 40.6, 0); }
        else if (seed === 2) { shell(16, 18, 12, 0); add(box(5, 2.4, 4), dark, 3, 19.2, -2); add(box(16.4, 0.5, 12.4), dark, 0, 18.2, 0); }
        else { shell(12, 24, 12, 0); shell(8, 14, 8, 24); add(box(8.3, 0.5, 8.3), this.glowMat(0x19e6ff, 3), 0, 38.1, 0); add(box(12.3, 0.4, 12.3), this.glowMat(0xff2bd6, 3), 0, 24.1, 0); }
        break;
      }
      case 'street_light': add(cyl(0.12, 0.16, 7.4, 6), this.mat(0x4a4e5c, { metalness: 0.5 }), 0, 3.7, 0); add(box(0.14, 0.14, 2.6), this.mat(0x4a4e5c), 0, 7.3, 1.2); add(box(0.7, 0.18, 0.5), this.glowMat(0xffe2a8, 3), 0, 7.18, 2.4); break;
      case 'lamp_post': add(cyl(0.08, 0.12, 4, 6), this.mat(0x2c3a4a, { metalness: 0.4 }), 0, 2, 0); add(sph(0.32, 1), this.glowMat(0xfff0c8, 2.2), 0, 4.2, 0); break;
      case 'neon_sign': { add(box(0.2, 5, 0.2), dark, -1.8, 2.5, 0); add(box(0.2, 5, 0.2), dark, 1.8, 2.5, 0); add(box(4.4, 2.2, 0.3), dark, 0, 5, 0); add(box(4.1, 0.2, 0.34), this.glowMat(0xff2bd6, 3), 0, 6, 0); add(box(4.1, 0.2, 0.34), this.glowMat(0xff2bd6, 3), 0, 4, 0); add(box(2.8, 0.9, 0.36), this.glowMat(0x19e6ff, 2.6), 0, 5, 0); break; }
      case 'billboard': { const art = this.mat(0xffffff, { map: K.billboard(0), emissive: 0xffffff, emissiveIntensity: n ? 0.5 : 0, roughness: 0.6 }, 'bb'); add(box(0.3, 5, 0.3), metal, -3, 2.5, -0.2); add(box(0.3, 5, 0.3), metal, 3, 2.5, -0.2); add(box(8.4, 4.2, 0.2), dark, 0, 6.4, -0.1); add(new THREE.PlaneGeometry(8, 3.8), art, 0, 6.4, 0.01); break; }
      case 'parked_car': { const body = this.mat(0xe8e8f0, { metalness: 0.3, roughness: 0.4 }, 'car'); add(box(1.9, 0.75, 4.2), body, 0, 0.7, 0); add(box(1.7, 0.6, 2.2), this.mat(0x223044, { roughness: 0.2 }), 0, 1.35, -0.2); for (const [x, z] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) add(cyl(0.36, 0.36, 0.3, 10), dark, x, 0.36, z, 0, 0, Math.PI / 2); add(box(1.6, 0.14, 0.05), this.glowMat(0xffffff, 1.5), 0, 0.8, 2.11); add(box(1.6, 0.14, 0.05), this.glowMat(0xff2020, 1.5), 0, 0.8, -2.11); break; }
      case 'pine_a': case 'pine_b': {
        const tall = kind === 'pine_b' ? 1.35 : 1, leaf = this.mat(kind === 'pine_b' ? 0x2a6048 : 0x2f7a4e), snow = this.mat(0xf6faff);
        add(cyl(0.22, 0.3, 1.6, 6), trunk, 0, 0.8, 0);
        for (let i = 0; i < 3; i++) { const r = (2.3 - i * 0.6) / (tall * 0.9), y = 1.4 + i * 1.9 * tall; add(cone(r, 2.8 * tall, 8), leaf, 0, y + 1.4 * tall, 0); add(cone(r * 0.62, 1.1 * tall, 8), snow, 0, y + 2.35 * tall, 0); }
        break;
      }
      case 'cabin': { add(box(5, 3, 4), this.mat(0x8a5634), 0, 1.5, 0); const roof = new THREE.CylinderGeometry(3.1, 3.1, 5.6, 3, 1); add(roof, this.mat(0x6a3a2a), 0, 3.6, 0, 0, 0, Math.PI / 2, 1, 1, 0.8); add(new THREE.CylinderGeometry(3.25, 3.25, 5.8, 3, 1), this.mat(0xffffff), 0, 3.85, 0, 0, 0, Math.PI / 2, 0.55, 1, 0.84); add(box(0.7, 2, 0.7), this.mat(0x7a7a80), 1.4, 4.4, 0.6); add(box(1, 1.8, 0.05), dark, 0, 0.9, 2.02); add(box(0.9, 0.8, 0.05), this.glowMat(0xffc870, 1.5), -1.5, 1.8, 2.02); break; }
      case 'snowman': { add(sph(0.9, 1), white, 0, 0.8, 0); add(sph(0.65, 1), white, 0, 2.05, 0); add(sph(0.45, 1), white, 0, 2.95, 0); add(cone(0.09, 0.5, 6), this.mat(0xff8a1f), 0, 2.95, 0.6, Math.PI / 2); add(cyl(0.34, 0.34, 0.5, 10), dark, 0, 3.55, 0); add(cyl(0.5, 0.5, 0.06, 10), dark, 0, 3.32, 0); break; }
      case 'ice_crystal': { const ice = this.mat(0x9fe6ff, { emissive: 0x3fb8ff, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.88 }, 'ice'); add(new THREE.OctahedronGeometry(0.8), ice, 0, 2, 0, 0, 0, 0, 1, 3, 1); add(new THREE.OctahedronGeometry(0.5), ice, 0.8, 1.1, 0.3, 0, 0, -0.5, 1, 2.4, 1); add(new THREE.OctahedronGeometry(0.45), ice, -0.7, 1, -0.2, 0.3, 0, 0.6, 1, 2.2, 1); break; }
      case 'cone': add(cone(0.32, 0.8, 12), this.mat(0xff6a1a), 0, 0.4, 0); add(cyl(0.2, 0.24, 0.12, 12), white, 0, 0.45, 0); add(box(0.7, 0.06, 0.7), this.mat(0xff6a1a), 0, 0.03, 0); break;
      case 'tire_stack': for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.45, 0.2, 6, 12), dark, 0, 0.2 + i * 0.4, 0, Math.PI / 2); break;
      case 'barrier': add(box(2, 0.9, 0.5), red, 0, 0.45, 0); add(box(2.02, 0.25, 0.52), white, 0, 0.6, 0); break;
      case 'arrow_sign': { const board = this.mat(0xffffff, { map: K.arrowBoard(n ? '#c21a8a' : '#e0302a'), emissive: 0xffffff, emissiveIntensity: n ? 0.45 : 0.05, roughness: 0.5 }, 'arrow'); add(box(0.15, 1.6, 0.15), metal, -1.1, 0.8, -0.1); add(box(0.15, 1.6, 0.15), metal, 1.1, 0.8, -0.1); add(box(3.1, 1.6, 0.12), dark, 0, 2.1, -0.08); add(new THREE.PlaneGeometry(3, 1.5), board, 0, 2.1, 0); break; }
      case 'crowd_stand': {
        const crowd = this.mat(0xffffff, { map: K.crowd(), roughness: 0.9 }, 'crowd');
        const slope = new THREE.PlaneGeometry(14, 6.4); add(slope, crowd, 0, 2.6, 0, -Math.PI / 2 + 0.9, 0, 0);
        add(box(14.4, 5.4, 0.3), this.mat(0x4a5068), 0, 2.7, -2.3); for (const x of [-7, 7]) add(box(0.3, 7.6, 0.3), metal, x, 3.8, -2.3);
        add(box(15, 0.2, 4.4), this.mat(n ? 0x1ee8ff : 0xf2f2f2, n ? { emissive: 0x1ee8ff, emissiveIntensity: 0.6 } : {}), 0, 7.6, -0.4, 0.12, 0, 0);
        for (const x of [-7.1, 7.1]) add(box(0.2, 5.2, 4.8), this.mat(0x3a3f55), x, 2.6, -0.1); break;
      }
      case 'balloon_arch': { const cols = [0xff4f6a, 0xffd23f, 0x28c6e7, 0x78d955]; for (let i = 0; i <= 26; i++) { const a = i / 26 * Math.PI; add(sph(0.75, 1), this.mat(cols[i % 4], { roughness: 0.3 }), Math.cos(a) * 9, Math.sin(a) * 7.5, 0); } break; }
      case 'flag_pole': { add(cyl(0.06, 0.08, 6.5, 5), metal, 0, 3.25, 0); const f = new THREE.PlaneGeometry(1.8, 1.1, 4, 1), p = f.getAttribute('position'); for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.9) * 2.4) * 0.18); f.computeVertexNormals(); add(f, this.mat(0xffffff, { map: K.checker(4, 2), side: THREE.DoubleSide }, 'flag'), 0.95, 5.8, 0, 0, Math.PI / 2); break; }
      // Space (Rainbow Road): floating scenery, origin at the bottom like every prop.
      case 'asteroid_a': { add(rock(2.4, 11), this.mat(0x6c6280), 0, 2.2, 0, 0.3, 0, 0.2, 1.2, 0.9, 1); add(rock(0.9, 12), this.mat(0x5a5070), 2.4, 1.2, 0.8); add(rock(0.6, 13), this.mat(0x7a6f90), -1.8, 3.4, -1); break; }
      case 'asteroid_b': { add(rock(2.2, 14), this.mat(0x4a4260), 0, 2.4, 0, 0.5, 0.4, 0, 0.8, 1.3, 1); for (let i = 0; i < 4; i++) add(new THREE.OctahedronGeometry(0.45), this.glowMat(i % 2 ? 0xff4fd8 : 0x39e6ff, 2.6), Math.sin(i * 1.7) * 1.7, 1.2 + i * 0.7, Math.cos(i * 1.7) * 1.6, 0.4, i, 0, 1, 2, 1); break; }
      case 'star_crystal': { const c = [0xff5fd8, 0x5fe8ff, 0xffd84a]; add(new THREE.OctahedronGeometry(0.9), this.glowMat(c[0], 2.2), 0, 2.3, 0, 0, 0, 0, 1, 2.6, 1); add(new THREE.OctahedronGeometry(0.55), this.glowMat(c[1], 2.4), 0.9, 1.3, 0.3, 0, 0, -0.5, 1, 2.2, 1); add(new THREE.OctahedronGeometry(0.5), this.glowMat(c[2], 2.4), -0.8, 1.2, -0.2, 0.3, 0, 0.6, 1, 2.1, 1); add(rock(0.8, 15), this.mat(0x3a3050), 0, 0.5, 0); break; }
      case 'satellite': {
        const foil = this.mat(0xe8b54a, { metalness: 0.8, roughness: 0.3 }, 'foil'), panel = this.mat(0x1a2a7a, { emissive: 0x2a4aff, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.3 }, 'panel');
        add(box(1.6, 1.6, 2.2), foil, 0, 1.6, 0); for (const x of [-3.2, 3.2]) { add(box(4, 0.06, 1.6), panel, x, 1.6, 0); add(cyl(0.05, 0.05, 1.2, 5), metal, x * 0.3, 1.6, 0, 0, 0, Math.PI / 2); }
        add(new THREE.SphereGeometry(0.9, 12, 6, 0, Math.PI * 2, 0, 1.1), white, 0, 2.2, 1.6, Math.PI / 2 + 0.3); add(sph(0.14, 0), this.glowMat(0xff3355, 3), 0, 2.6, -1.2); break;
      }
      case 'space_station': {
        const hull = this.mat(0xd8dcef, { metalness: 0.5, roughness: 0.35 }, 'hull'), panel = this.mat(0x1a2a7a, { emissive: 0x2a4aff, emissiveIntensity: 0.4, metalness: 0.4, roughness: 0.3 }, 'panel');
        add(new THREE.TorusGeometry(16, 1.6, 10, 48), hull, 0, 12, 0, Math.PI / 2); add(new THREE.TorusGeometry(16, 0.35, 6, 48), this.glowMat(0x7fe8ff, 2.8), 0, 12, 0, Math.PI / 2, 0, 0, 1.08, 1.08, 1);
        add(cyl(2.4, 2.4, 22, 16), hull, 0, 12, 0); add(sph(3.2, 1), hull, 0, 23, 0); add(cyl(0.8, 0.8, 6, 8), this.glowMat(0xffd27a, 2), 0, 1.5, 0);
        for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; add(cyl(0.5, 0.5, 14, 6), hull, Math.cos(a) * 8.5, 12, Math.sin(a) * 8.5, 0, -a, Math.PI / 2); }
        for (const y of [4, 20]) for (const x of [-9, 9]) add(box(10, 0.1, 4), panel, x, y, 0);
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; add(box(0.9, 0.5, 0.2), this.glowMat(0xfff0b0, 2.6), Math.cos(a) * 16, 12 + 1.62, Math.sin(a) * 16, 0, -a + Math.PI / 2); }
        break;
      }
      case 'star_bumper': { add(cyl(1.45, 1.6, 0.6, 32), this.mat(0x2a2350, { metalness: 0.4, roughness: 0.3 }, 'bbase'), 0, 0.3, 0); add(new THREE.TorusGeometry(1.5, 0.22, 8, 40), this.glowMat(0xff4fd8, 3), 0, 0.85, 0, Math.PI / 2); add(cyl(1.2, 1.3, 0.8, 32), this.glowMat(0x6a3dff, 1.2), 0, 1.0, 0); break; }
      case 'star_bumper_star': { const st = new THREE.Shape(); for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI * 2, r = i % 2 ? 0.6 : 1.3; if (i) st.lineTo(Math.sin(a) * r, Math.cos(a) * r); else st.moveTo(0, r); } const geo = new THREE.ExtrudeGeometry(st, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1 }); geo.translate(0, 0, -0.2); add(geo, this.glowMat(0xffc21a, 2.2), 0, 0, 0); break; }
      case 'planet_ringed': { add(new THREE.IcosahedronGeometry(6, 3), this.mat(0xb98ae0, { roughness: 0.7 }, 'planet'), 0, 6, 0); add(new THREE.TorusGeometry(9.5, 1.2, 2, 48), this.mat(0xffd8b0, { roughness: 0.6, side: THREE.DoubleSide }, 'pring'), 0, 6, 0, Math.PI / 2 - 0.35, 0, 0, 1, 1, 0.12); break; }
      default: add(rock(1.2, 7), this.mat(0x9a9aa4), 0, 0.6, 0);
    }
    return g;
  }

  dispose() { for (const g of this.geos.splice(0)) g.dispose(); for (const m of this.mats.values()) m.dispose(); this.mats.clear(); this.cache.clear(); }
}

const frac = (n: number) => n - Math.floor(n);
/** Same attribute set for every part (Float32 position/normal/uv/colour, non-indexed) so any parts can share a BatchedMesh. */
function uniform(g: THREE.BufferGeometry) {
  const src = g.index ? g.toNonIndexed() : g;
  if (!src.getAttribute('normal')) src.computeVertexNormals();
  const n = src.getAttribute('position').count, out = new THREE.BufferGeometry();
  const copy = (name: string, size: number, fill: number) => {
    const a = src.getAttribute(name), arr = new Float32Array(n * size).fill(fill);
    if (a) for (let i = 0; i < n; i++) for (let c = 0; c < Math.min(size, a.itemSize); c++) arr[i * size + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  copy('position', 3, 0); copy('normal', 3, 0); copy('uv', 2, 0); copy('color', 3, 1);
  if (src !== g) src.dispose();
  g.dispose();
  return out;
}
function push(map: Map<THREE.Material, THREE.BufferGeometry[]>, m: THREE.Material, g: THREE.BufferGeometry) { const l = map.get(m); if (l) l.push(g); else map.set(m, [g]); }
function common(list: THREE.BufferGeometry[]) { const names = Object.keys(list[0].attributes).filter(n => ['position', 'normal', 'uv', 'color'].includes(n)); return names.filter(n => list.every(g => !!g.getAttribute(n) && g.getAttribute(n).itemSize === list[0].getAttribute(n).itemSize)); }
function subRange(g: THREE.BufferGeometry, start: number, count: number) {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) { const a = g.getAttribute(name); out.setAttribute(name, new THREE.BufferAttribute(new Float32Array(Array.from({ length: count * a.itemSize }, (_, i) => a.getComponent(start + Math.floor(i / a.itemSize), i % a.itemSize))), a.itemSize)); }
  return out;
}
/** Box UVs in metres/8 so window grids keep their size on any face. */
function scaleUv(geo: THREE.BoxGeometry, w: number, h: number, d: number) {
  const uv = geo.getAttribute('uv'), sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) for (let i = 0; i < 4; i++) { const k = face * 4 + i; uv.setXY(k, uv.getX(k) * sizes[face][0] / 8, uv.getY(k) * sizes[face][1] / 16); }
}
