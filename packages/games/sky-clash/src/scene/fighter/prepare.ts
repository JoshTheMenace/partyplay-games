/**
 * Turns a parsed fighter scene into a render template: every mesh sharing a skeleton (or a rigid parent) is merged into
 * one palette mesh whose vertices carry a material slot, with smoothed normals for the inverted-hull outline.
 * Browser-safe and DOM-free so tests can run it on a procedural mannequin.
 */
import { Box3, BufferAttribute, BufferGeometry, Color, Mesh, SkinnedMesh, Vector3, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FIGHTERS, MATERIALS, type Costume, type FighterKind } from '../../model';
import { MAX_SLOTS } from './materials';

/** Prop bone visibility from the model pipeline: always held (swords), shown only by the moves that use it, or never. */
export type PropMode = 'always' | 'move' | 'none';
/** A parsed fighter. scene is a template: actors clone it with SkeletonUtils and never add it to a scene. */
export type FighterModel = { kind: FighterKind; scene: Object3D; height: number; slots: string[]; colors: Color[]; costumes: Costume[]; triangles: number; prop: PropMode };
const HELD = new Set(['sword', 'climber']);
export type FighterModels = ReadonlyMap<FighterKind, FighterModel>;

/** 'Primary.001', 'eye_white' and 'EyeWhite' all resolve to the contract names in model.ts. */
export function slotName(material: Material | undefined): string {
  const raw = (material?.name ?? '').toLowerCase().replace(/\.\d+$/, '').replace(/[_\s]+/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2');
  if ((MATERIALS as readonly string[]).includes(raw)) return raw;
  if (/eye-?white|sclera/.test(raw)) return 'eye-white';
  if (/pupil|iris|^eye/.test(raw)) return 'eye';
  return (MATERIALS as readonly string[]).find(m => raw.startsWith(m)) ?? (raw || 'primary');
}

const KEEP = ['position', 'normal', 'skinIndex', 'skinWeight'];
function normalized(mesh: Mesh, slot: number, rigid: boolean): BufferGeometry {
  const src = mesh.geometry, geo = new BufferGeometry();
  for (const name of KEEP) {
    const attr = src.getAttribute(name); if (!attr) continue;
    const count = attr.count, size = attr.itemSize;
    const array = name === 'skinIndex' ? new Uint16Array(count * size) : new Float32Array(count * size);
    for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) array[i * size + k] = attr.getComponent(i, k);
    geo.setAttribute(name, new BufferAttribute(array, size));
  }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (src.index) geo.setIndex(Array.from(src.index.array as ArrayLike<number>));
  geo.setAttribute('slot', new BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(slot), 1));
  if (rigid) geo.applyMatrix4(mesh.matrix);
  return geo;
}

/** Normals averaged over coincident positions, so hard-edged bevels do not crack the outline hull. */
export function smoothNormals(geo: BufferGeometry) {
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), sums = new Map<string, Vector3>(), keys: string[] = [];
  const q = (n: number) => Math.round(n * 2e4);
  for (let i = 0; i < pos.count; i++) {
    const key = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`; keys.push(key);
    const sum = sums.get(key) ?? sums.set(key, new Vector3()).get(key)!;
    sum.x += nor.getX(i); sum.y += nor.getY(i); sum.z += nor.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const n = sums.get(keys[i])!; const l = n.length() || 1; out[i * 3] = n.x / l; out[i * 3 + 1] = n.y / l; out[i * 3 + 2] = n.z / l; }
  geo.setAttribute('onormal', new BufferAttribute(out, 3));
}

/** Merge in place and measure. Returns the template description. */
export function prepareModel(kind: FighterKind, scene: Object3D, costumes: Costume[], prop: PropMode = HELD.has(FIGHTERS[kind].style) ? 'always' : 'move'): FighterModel {
  scene.updateMatrixWorld(true);
  const slots: string[] = [], colors: Color[] = [], groups = new Map<string, { meshes: Mesh[]; skinned: SkinnedMesh | null; parent: Object3D }>();
  const slotOf = (m: Material | undefined) => {
    const name = slotName(m); let i = slots.indexOf(name);
    if (i < 0 && slots.length < MAX_SLOTS) { i = slots.push(name) - 1; colors.push(((m as { color?: Color } | undefined)?.color ?? new Color(1, 1, 1)).clone()); }
    return i < 0 ? 0 : i;
  };
  const meshes: Mesh[] = [];
  scene.traverse(o => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  let triangles = 0;
  for (const mesh of meshes) {
    const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? mesh as SkinnedMesh : null;
    const key = skinned ? `s:${skinned.skeleton.uuid}:${skinned.bindMatrix.elements.map(n => n.toFixed(4)).join()}:${mesh.parent?.uuid}:${mesh.matrix.elements.map(n => n.toFixed(4)).join()}` : `r:${mesh.parent?.uuid}`;
    const g = groups.get(key) ?? groups.set(key, { meshes: [], skinned, parent: mesh.parent! }).get(key)!;
    g.meshes.push(mesh);
  }
  for (const { meshes: list, skinned, parent } of groups.values()) {
    // GLTFLoader emits one mesh per primitive, so each mesh has exactly one material.
    let parts = list.map(mesh => normalized(mesh, slotOf(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material), !skinned));
    if (parts.some(p => !p.index) && parts.some(p => p.index)) parts = parts.map(p => p.index ? p.toNonIndexed() : p);
    const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!merged) continue;
    smoothNormals(merged); merged.computeBoundingSphere(); merged.computeBoundingBox();
    triangles += (merged.index?.count ?? merged.getAttribute('position').count) / 3;
    const out = skinned ? new SkinnedMesh(merged) : new Mesh(merged);
    out.name = 'fighter-body';
    if (skinned) { out.position.copy(skinned.position); out.quaternion.copy(skinned.quaternion); out.scale.copy(skinned.scale); (out as SkinnedMesh).bind(skinned.skeleton, skinned.bindMatrix); }
    parent.add(out);
    for (const mesh of list) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  }
  // Culling uses the rest bounds; fighters bend far outside them.
  scene.traverse(o => { if ((o as Mesh).isMesh) o.frustumCulled = false; });
  const size = new Box3().setFromObject(scene).getSize(new Vector3()), height = size.y > .2 ? size.y : FIGHTERS[kind].height;
  return { kind, scene, height, slots, colors, costumes, triangles, prop };
}

/** Palette colors for a costume (falls back to the GLB's own material colors). */
export function paletteFor(model: FighterModel, costume: number, out: Color[]) {
  const colors = model.costumes[costume]?.colors ?? model.costumes[0]?.colors ?? {};
  model.slots.forEach((name, i) => { const hex = colors[name]; out[i].copy(model.colors[i]); if (hex) out[i].set(hex); });
  return out;
}
