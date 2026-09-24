import { Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ResourceScope } from '../../../party-runtime/src/index';
import { assetUrl } from './asset-url';

export type KitchenModels = ((name: string, teamColor?: string) => Group) & { has(name: string): boolean; source(name: string): Object3D | undefined; names: string[] };

/** One round owns one kit (models/kitchen-kit.glb). Clones share GPU resources; chef team colours are per player. */
export async function loadKitchenModels(scope: ResourceScope): Promise<KitchenModels> {
  const response = await fetch(assetUrl('models/kitchen-kit.glb'), { signal: scope.signal });
  if (!response.ok) throw new Error(`Kitchen models could not load (${response.status})`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const resources = new Set<{ dispose(): void }>();
  gltf.scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
  });
  // parseAsync cannot be aborted; a late result is disposed at once by the scope.
  resources.forEach(resource => scope.own(resource));
  scope.signal.throwIfAborted();
  const assets = new Map(gltf.scene.children.map(object => [object.name, object]));
  const model = (name: string, teamColor?: string) => {
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
  return Object.assign(model, { has: (name: string) => assets.has(name), source: (name: string) => assets.get(name), names: [...assets.keys()] });
}

/** Rigid pivots exported with the human chefs keep holds and work poses tied to gameplay without skinning cost. */
export function chefJoints(body: Object3D) {
  const joint = (name: string, optional = false) => {
    let found: Object3D | undefined;
    body.traverse(object => { if (!found && !(object instanceof Mesh) && object.name.replace(/[._\d]/g, '') === name) found = object; });
    if (!found && !optional) throw new Error(`Missing chef joint: ${name}`);
    return found;
  };
  return { arms: [joint('ArmL')!, joint('ArmR')!], legs: [joint('LegL')!, joint('LegR')!], head: joint('Head')!, body: joint('Body', true) };
}
