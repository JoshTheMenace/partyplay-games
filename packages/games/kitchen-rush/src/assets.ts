import { BufferGeometry, DoubleSide, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ResourceScope } from '../../../party-runtime/src/index';
import { assetUrl } from './asset-url';

/** One scene owns the kit; instances share geometry and materials until round disposal. */
export async function loadKitchenAssets(scope: ResourceScope) {
  const response = await fetch(assetUrl('models/kitchen-rush.glb'), { signal: scope.signal });
  if (!response.ok) throw new Error(`Kitchen assets failed to load (${response.status}).`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const geometry = new Set<BufferGeometry>(), materials = new Set<MeshStandardMaterial>();
  gltf.scene.traverse(object => { if (object instanceof Mesh) { geometry.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); } });
  // parseAsync cannot be aborted; a late result is disposed immediately by the scope.
  scope.defer(() => { geometry.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); });
  scope.signal.throwIfAborted();
  const prototypes = new Map<string, Mesh>(), tints = new Map<string, MeshStandardMaterial>();
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
  const tint = (color: string) => { let material = tints.get(color); if (!material) { material = new MeshStandardMaterial({ color, vertexColors: true, roughness: .7, side: DoubleSide }); tints.set(color, material); materials.add(material); } return material; };
  return { geometry: (name: string) => get(name).geometry, tint, create(name: string, color?: string) { const mesh = get(name).clone(); if (color) mesh.material = tint(color); return mesh; } };
}
