import { Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { assetUrl } from './asset-url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ResourceScope } from '../../../party-runtime/src/index';

/** One round owns one kit. Clones share GPU resources; chef team colors are per player. */
export async function loadKitchenModels(scope: ResourceScope) {
  const response = await fetch(assetUrl('models/kitchen-kit.glb'), { signal: scope.signal });
  if (!response.ok) throw new Error(`Kitchen models could not load (${response.status})`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const resources = new Set<{ dispose(): void }>();
  gltf.scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
  });
  resources.forEach(resource => scope.own(resource));
  const assets = new Map(gltf.scene.children.map(object => [object.name, object]));
  return (name: string, teamColor?: string) => {
    const source = assets.get(name);
    if (!source) throw new Error(`Missing Kitchen model: ${name}`);
    const group = new Group(); group.add(source.clone(true));
    if (teamColor) {
      let team: MeshStandardMaterial | undefined;
      group.traverse(object => {
        if (object instanceof Mesh && object.material.name === 'TeamColor') {
          team ??= scope.own((object.material as MeshStandardMaterial).clone());
          team.color.set(teamColor); object.material = team;
        }
      });
    }
    return group;
  };
}

/** Exported rigid pivots keep holds and work poses tied to live gameplay, without skinning cost. */
export function chefJoints(body: Group) {
  const joint = (name: string) => {
    let found: Object3D | undefined; body.traverse(object => { if (!(object instanceof Mesh) && object.name.replace(/[.\d]/g, '') === name) found = object; });
    if (!found) throw new Error(`Missing chef joint: ${name}`);
    return found;
  };
  return { arms: [joint('ArmL'), joint('ArmR')], legs: [joint('LegL'), joint('LegR')], head: joint('Head') };
}
