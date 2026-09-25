/**
 * The model kit: every node from WP-art's GLB bundles flattened into parts (geometry + material
 * slot + transform from the node origin). Missing bundles or nodes fall back to procedural parts,
 * so the board always has pieces. Like a box of Lego bricks sorted by piece name.
 */
import { Matrix4, Mesh, type BufferGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Settings } from '../../model';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { MODEL_BASE } from './constants';
import { procedural } from './procedural';

/** tags: names of the node's children this part sits under (toggles like `knight_2_active`, `level_1`). */
export type Part = {
  geometry: BufferGeometry; role: string; source?: Material; matrix: Matrix4; tags?: string[];
};
export type Kit = { parts(node: string): Part[]; modelled(node: string): boolean };

const FAILED = 'Island Settlers models failed to load. Return to the lobby and try again.';
const GLB_MAGIC = 0x46546c67;

/** Parts per root node of one bundle, or an empty map when the bundle is not published yet. */
async function bundle(scope: ResourceScope, file: string) {
  const nodes = new Map<string, Part[]>();
  const response = await fetch(MODEL_BASE + file, { signal: scope.signal });
  const data = response.ok ? await response.arrayBuffer() : null;
  // Dev servers answer unknown files with index.html, so check the GLB magic, not just the status.
  if (!data || data.byteLength < 12 || new DataView(data).getUint32(0, true) !== GLB_MAGIC) {
    console.warn(`[island-settlers] ${file} not found; using procedural pieces`);
    return nodes;
  }
  const gltf = await new GLTFLoader().parseAsync(data, MODEL_BASE).catch(() => { throw new Error(FAILED); });
  gltf.scene.updateMatrixWorld(true);
  for (const root of gltf.scene.children) {
    const inverse = new Matrix4().copy(root.matrixWorld).invert(), parts: Part[] = [];
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as Material;
      scope.own(object.geometry);
      scope.own(material);
      const tags: string[] = [];
      for (let o: Object3D | null = object; o && o !== root; o = o.parent) tags.push(o.name);
      parts.push({
        geometry: object.geometry, role: material.name, source: material, tags,
        matrix: new Matrix4().multiplyMatrices(inverse, object.matrixWorld),
      });
    });
    nodes.set(root.name, parts);
  }
  return nodes;
}

/** Every T&B scenario uses an expansions node (fishing signs, bridges, invaders, wagons, depots). */
const needsExpansions = (s: Settings) => s.citiesKnights || s.map === 'explorers' || s.scenarios.length > 0;

export async function loadKit(scope: ResourceScope, settings: Settings): Promise<Kit> {
  const files = ['pieces.glb', 'props.glb', ...(needsExpansions(settings) ? ['expansions.glb'] : [])];
  const bundles = await Promise.all(files.map(file => bundle(scope, file)));
  const models = new Map(bundles.flatMap(b => [...b]));
  const made = new Map<string, Part[]>();
  return {
    modelled: node => models.has(node),
    parts(node) {
      const hit = models.get(node) ?? made.get(node);
      if (hit) return hit;
      const parts = procedural(node);
      parts.forEach(p => scope.own(p.geometry));
      made.set(node, parts);
      return parts;
    },
  };
}
