/* Draw-call compaction for rigged models. A Blender kart + driver is ~35 primitives (one per material);
 * ten racers in four viewports would blow the draw budget. Every opaque, untextured primitive is baked
 * into ONE vertex-coloured mesh per rig node (body, each wheel, steering wheel, head, arms...), with
 * per-vertex roughness / metalness / emission / paint mask read by a patched MeshStandardMaterial.
 * Result: ~10 draws per racer. Templates are compacted once and cached; instances share geometry. */
import * as THREE from 'three';

const RIG_NODE = /^(kart_[a-z]+_(body|steer_f[lr]|wheel_[fr][lr]|steering|seat|exhaust_[lr])|char_\d+_(body|head|arm_[lr])|drone_rotor_\d+|bomb_fuse|.*(rotor|propell?er|blade).*)$/;
const cache = new WeakMap<THREE.Object3D, Map<string, THREE.Object3D>>();
const nm = new THREE.Matrix3(), p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();

/** The shared material every compacted mesh uses; clone per racer via rigMaterial(paint). */
const base = new THREE.MeshStandardMaterial({ name: 'rig', vertexColors: true, roughness: 1, metalness: 0 });
/** Per-instance rig material: `paint` tints vertices whose paint mask is set (the `kart_paint` material). */
export function rigMaterial(paint = new THREE.Color(1, 1, 1)) {
  const mat = base.clone(), uPaint = { value: paint.clone() }, uStar = { value: 0 }, uTime = { value: 0 }, uFade = { value: 1 };
  mat.userData.paint = uPaint; mat.userData.star = uStar; mat.userData.time = uTime; mat.userData.fade = uFade;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uPaint, uStar, uTime, uFade });
    shader.vertexShader = shader.vertexShader.replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute vec4 aPbr; varying vec4 vPbr;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = aPbr;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nvarying vec4 vPbr; uniform vec3 uPaint; uniform float uStar; uniform float uTime; uniform float uFade;')
      // Screen-door fade (no sorting, no recompiles) for karts right in front of a camera.
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uFade < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > uFade) discard;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(vColor.rgb, vColor.rgb * uPaint, vPbr.w);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPbr.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vPbr.z;\n'
        // Super Star: rainbow bands sweeping up the kart, over the lit surface (keeps the model readable).
        + 'if (uStar > 0.0) { vec3 h = clamp(abs(fract(uTime * 1.6 - vViewPosition.y * 0.45 + vViewPosition.x * 0.2 + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);\n'
        + 'diffuseColor.rgb = mix(diffuseColor.rgb, h, 0.45 * uStar); totalEmissiveRadiance += h * 0.75 * uStar; }');
  };
  mat.customProgramCacheKey = () => 'kart-rig-v3';
  return mat;
}
/** Shared by every compacted template (props keep it; racers swap in their own tinted clone). */
export const sharedRig = rigMaterial();
export const isRigMaterial = (mat: THREE.Material) => mat.name === 'rig';
/** Stand-in library key for the primitive fallbacks. */
export const FALLBACK_LIBRARY = {};

const mergeable = (mat: THREE.Material): mat is THREE.MeshStandardMaterial =>
  mat instanceof THREE.MeshStandardMaterial && !mat.map && !mat.transparent && mat.opacity >= 1 && !mat.alphaTest && !mat.normalMap && !mat.emissiveMap;

type Part = { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; material: THREE.MeshStandardMaterial; group?: { start: number; count: number } };
function bakeParts(parts: Part[]): THREE.BufferGeometry {
  let verts = 0, indices = 0;
  const count = (part: Part) => { const idx = part.geometry.index; const range = part.group ?? { start: 0, count: idx ? idx.count : part.geometry.getAttribute('position').count }; return range; };
  for (const part of parts) { verts += part.geometry.getAttribute('position').count; indices += count(part).count; }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3), pbr = new Float32Array(verts * 4);
  const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vo = 0, io = 0;
  for (const part of parts) {
    const g = part.geometry, P = g.getAttribute('position'), N = g.getAttribute('normal'), C = g.getAttribute('color'), mat = part.material;
    nm.getNormalMatrix(part.matrix);
    const paint = mat.name.startsWith('kart_paint') ? 1 : 0, emissive = Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b) * mat.emissiveIntensity;
    const tint = paint ? c.setRGB(1, 1, 1) : emissive > .05 && mat.color.getHex() === 0 ? c.copy(mat.emissive) : c.copy(mat.color);
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i).applyMatrix4(part.matrix); pos.set([p.x, p.y, p.z], (vo + i) * 3);
      if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([n.x, n.y, n.z], (vo + i) * 3); }
      const vc = C && mat.vertexColors ? [C.getX(i), C.getY(i), C.getZ(i)] : [1, 1, 1];
      col.set([tint.r * vc[0], tint.g * vc[1], tint.b * vc[2]], (vo + i) * 3);
      pbr.set([mat.roughness, mat.metalness, emissive, paint], (vo + i) * 4);
    }
    const idx = g.index, range = count(part);
    for (let k = 0; k < range.count; k++) index[io++] = vo + (idx ? idx.getX(range.start + k) : range.start + k);
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 4));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  if (!parts.some(part => part.geometry.getAttribute('normal'))) out.computeVertexNormals();
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

/** Rebuild `source` so each rig node (and the root) owns at most one merged opaque mesh. Non-mergeable
 * meshes (textured/transparent) are kept as-is, re-parented to their rig node with their transform baked. */
export function compact(source: THREE.Object3D): THREE.Object3D {
  source.updateMatrixWorld(true);
  const parts = new Map<THREE.Object3D, Part[]>(), kept = new Map<THREE.Object3D, THREE.Mesh[]>(), copies = new Map<THREE.Object3D, THREE.Object3D>();
  const collect = (mesh: THREE.Mesh, owner: THREE.Object3D) => {
    const rel = new THREE.Matrix4().copy(owner.matrixWorld).invert().multiply(mesh.matrixWorld);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.every(mergeable)) { const k = new THREE.Mesh(mesh.geometry, mesh.material); rel.decompose(k.position, k.quaternion, k.scale); k.castShadow = true; kept.set(owner, [...kept.get(owner) ?? [], k]); return; }
    const groups = Array.isArray(mesh.material) && mesh.geometry.groups.length ? mesh.geometry.groups : [null];
    for (const g of groups) parts.set(owner, [...parts.get(owner) ?? [], { geometry: mesh.geometry, matrix: rel, material: mats[g?.materialIndex ?? 0] as THREE.MeshStandardMaterial, group: g ? { start: g.start, count: g.count } : undefined }]);
  };
  const copy = (o: THREE.Object3D, owner: THREE.Object3D): THREE.Object3D => {
    const g = new THREE.Group(); g.name = o.name; g.position.copy(o.position); g.quaternion.copy(o.quaternion); g.scale.copy(o.scale); copies.set(o, g);
    if (o instanceof THREE.Mesh) collect(o, owner);
    for (const ch of o.children) {
      if (ch instanceof THREE.Mesh && !ch.children.length && !RIG_NODE.test(ch.name)) collect(ch, owner);
      else g.add(copy(ch, RIG_NODE.test(ch.name) ? ch : owner));
    }
    return g;
  };
  const root = copy(source, source);
  for (const [owner, list] of parts) { const mesh = new THREE.Mesh(bakeParts(list), sharedRig); mesh.name = `${owner.name}_mesh`; mesh.castShadow = true; copies.get(owner)!.add(mesh); }
  for (const [owner, list] of kept) copies.get(owner)!.add(...list);
  return root;
}

/** Compacted template for `name`, cached per library root (so rounds reuse the merged geometry). */
export function compactTemplate(library: object, name: string, make: () => THREE.Object3D | null): THREE.Object3D | null {
  const key = library as THREE.Object3D;
  let map = cache.get(key); if (!map) cache.set(key, map = new Map());
  if (!map.has(name)) { const src = make(); if (src) map.set(name, compact(src)); else return null; }
  return map.get(name)!;
}
