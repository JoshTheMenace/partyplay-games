import { BufferGeometry, DoubleSide, Matrix4, Mesh, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ResourceScope } from '../../../party-runtime/src/index';
import { assetUrl } from './asset-url';

/**
 * Contributor animal chefs (models/kitchen-rush.glb, credit Aaron Hendricks): `<animal>_body`, `<animal>_color`
 * (team colour), `<animal>_left_hand`, `<animal>_right_hand`, plus shared `chef_left_foot` / `chef_right_foot`.
 * Each mesh is re-centred on its own pivot; clones share geometry until round disposal.
 */
export async function loadKitchenAssets(scope: ResourceScope) {
  const response = await fetch(assetUrl('models/kitchen-rush.glb'), { signal: scope.signal });
  if (!response.ok) throw new Error(`Kitchen assets failed to load (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const geometry = new Set<BufferGeometry>(), materials = new Set<Material>();
  gltf.scene.traverse(object => { if (object instanceof Mesh) { geometry.add(object.geometry); for (const material of [object.material].flat()) materials.add(material); } });
  scope.defer(() => { geometry.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); });
  scope.signal.throwIfAborted();
  const prototypes = new Map<string, Mesh>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    if (Array.isArray(object.material)) throw new Error(`Kitchen asset ${object.name} must use one material.`);
    const position = object.getWorldPosition(object.position.clone());
    const normalized = object.geometry.clone().applyMatrix4(object.matrixWorld).applyMatrix4(new Matrix4().makeTranslation(-position.x, -position.y, -position.z));
    geometry.add(normalized); object.material.side = DoubleSide;
    const prototype = new Mesh(normalized, object.material); prototype.position.copy(position); prototype.name = object.name; prototypes.set(object.name, prototype);
  });
  const get = (name: string) => { const mesh = prototypes.get(name); if (!mesh) throw new Error(`Missing Kitchen Rush asset: ${name}`); return mesh; };
  return { has: (name: string) => prototypes.has(name), geometry: (name: string) => get(name).geometry, create: (name: string) => get(name).clone() };
}
export type AnimalKit = Awaited<ReturnType<typeof loadKitchenAssets>>;
