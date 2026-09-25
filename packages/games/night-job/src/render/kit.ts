/* The Blender kit, with a procedural stand-in for every contract name the GLB does not (yet) provide. */
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Mesh, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ResourceScope } from '../../../../party-runtime/src/index';
import { assetUrl } from './assets';
import { SHAPES } from './shapes';

export type Kit = { geometry(name: string): BufferGeometry; source: { glb: string[]; procedural: string[] } };

/** Position, normal and linear RGB colour only (kit material colour folded into the vertex colours). */
function normalise(mesh: Mesh, relative: Matrix4) {
  const g = mesh.geometry.clone().applyMatrix4(relative), n = g.attributes.position.count, vc = g.attributes.color;
  const tint = new Color((mesh.material as MeshStandardMaterial).color ?? '#ffffff'), rgba = vc?.itemSize === 4 && Array.from({ length: n }, (_, i) => vc.getW(i)).some(a => a < .99), k = rgba ? 4 : 3, colour = new Float32Array(n * k);
  for (let i = 0; i < n; i++) { colour[i * k] = (vc ? vc.getX(i) : 1) * tint.r; colour[i * k + 1] = (vc ? vc.getY(i) : 1) * tint.g; colour[i * k + 2] = (vc ? vc.getZ(i) : 1) * tint.b; if (rgba) colour[i * k + 3] = vc.getW(i); }
  for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
  g.setAttribute('color', new Float32BufferAttribute(colour, k)); g.morphAttributes = {};
  return g.index ? g.toNonIndexed() : g;
}

async function loadGlb(signal: AbortSignal) {
  const found = new Map<string, BufferGeometry>();
  const response = await fetch(assetUrl('models/night-job-kit.glb'), { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
  if (!response.ok) throw new Error(`kit ${response.status}`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    if (!node.name) continue;
    const origin = new Matrix4().makeTranslation(node.getWorldPosition(node.position.clone()).negate()), parts: BufferGeometry[] = [];
    node.traverse(o => { if (o instanceof Mesh) parts.push(normalise(o, origin.clone().multiply(o.matrixWorld))); });
    const merged = parts.length > 1 ? mergeGeometries(parts) : parts[0];
    if (merged) { if (!merged.attributes.normal) merged.computeVertexNormals(); found.set(node.name.replace(/\.\d+$/, ''), merged); }
    if (parts.length > 1) parts.forEach(p => p.dispose());
  }
  gltf.scene.traverse(o => { if (o instanceof Mesh) { o.geometry.dispose(); (o.material as MeshStandardMaterial).dispose(); } });
  return found;
}

/** Never rejects for a missing or broken kit: procedural shapes stand in. Aborts propagate. */
export async function loadKit(scope: ResourceScope): Promise<Kit> {
  let glb = new Map<string, BufferGeometry>();
  try { glb = await loadGlb(scope.signal); } catch (error) { scope.signal.throwIfAborted(); console.info('[night-job] kit unavailable, using procedural shapes:', (error as Error).message); }
  scope.defer(() => glb.forEach(g => g.dispose()));
  const made = new Map<string, BufferGeometry>(), source = { glb: [] as string[], procedural: [] as string[] };
  scope.defer(() => made.forEach(g => g.dispose()));
  return {
    source,
    geometry(name) {
      const kit = glb.get(name);
      if (kit) { if (!source.glb.includes(name)) source.glb.push(name); return kit; }
      let shape = made.get(name);
      if (!shape) { shape = (SHAPES[name] ?? SHAPES.prop_crate)(); made.set(name, shape); source.procedural.push(name); }
      return shape;
    },
  };
}
