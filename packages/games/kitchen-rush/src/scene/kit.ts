// Resolves contract names to drawable templates: authored GLB objects first, procedural fallbacks otherwise.
import { Box3, BufferGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3, type Material, type Object3D } from 'three';
import type { KitchenModels } from '../models';
import { proceduralShape } from './procedural';
import { Shape, type Finish, type Template, type TemplatePart } from './shapes';
import { beltTexture } from './textures';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Palette } from './themes';

/** Materials the art kit exports white so the scene can colour them per theme, ingredient or player. */
const TINTABLE = new Set(['Floor', 'Wall', 'CrateLabel']);
/** Largest sensible footprint per asset family; oversized authored art (e.g. an older 2 m kit) is scaled to fit. */
function expectedSize(name: string) {
  if (/^(counter|board|stove|oven|sink|rack|return|serve|bin|crate|belt|wall|floor_tile|ice_tile|gate_plank|portal_pad)$/.test(name)) return 1;
  if (name === 'pan') return .62;
  if (name === 'pot') return .56;
  if (name.startsWith('plate') || name.startsWith('soup') || name.startsWith('dish_')) return .42;
  if (name === 'extinguisher') return .32;
  if (name.startsWith('prop_')) return 3;
  return .34;
}

export class Kit {
  readonly materials: Record<Finish, Material>;
  private cache = new Map<string, Template | null>();
  private owned: { dispose(): void }[] = [];
  constructor(private models: KitchenModels | null, private palette: Palette) {
    const standard = (options: ConstructorParameters<typeof MeshStandardMaterial>[0]) => this.own(new MeshStandardMaterial({ vertexColors: true, ...options }));
    this.materials = { matte: standard({ roughness: .72 }), gloss: standard({ roughness: .28 }), metal: standard({ roughness: .32, metalness: .55 }), glow: this.own(new MeshBasicMaterial({ vertexColors: true })) };
  }
  own<T extends { dispose(): void }>(resource: T) { this.owned.push(resource); return resource; }
  dispose() { this.owned.splice(0).forEach(item => item.dispose()); this.cache.clear(); }
  /** True when the authored kit supplies this object. */
  authored(name: string) { return !!this.models?.has(name); }
  /** First name the authored kit has, else the first name with procedural art, else a neutral block. */
  template(...names: string[]): Template {
    for (const name of names) { const found = this.lookup(name, true); if (found) return found; }
    for (const name of names) { const found = this.lookup(name, false); if (found) return found; }
    return this.lookup('__missing', false) ?? this.store('__missing', new Shape().box([.2, .2, .2], { at: [0, .1, 0], color: '#c9c2b8', r: .04 }).build(this.materials, 'missing'));
  }
  /** The procedural fallback even when authored art exists (cheaper shapes for low graphics quality). */
  procedural(name: string) { return this.lookup(name, false) ?? this.template(name); }
  private lookup(name: string, authored: boolean) {
    const key = `${authored ? 'a' : 'p'}:${name}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? undefined;
    let template: Template | null = null;
    if (authored) { const source = this.models?.source(name); if (source) template = fitTemplate(flatten(source), expectedSize(name)); }
    else {
      const shape = proceduralShape(name, this.palette);
      if (shape) template = shape.build(this.materials, name);
      template?.parts.forEach(part => this.own(part.geometry));
    }
    this.cache.set(key, template);
    return template ?? undefined;
  }
  /**
   * Scrolling chevron strip laid on every belt. It replaces the authored `belt_surface` ribs, whose geometry cannot
   * scroll without spilling past the belt ends; offsetting a texture moves the pattern while the strip stays put.
   */
  readonly beltMaterial = this.own(new MeshStandardMaterial({ map: this.own(beltTexture()), roughness: .8 }));
  readonly beltStrip: Template = (() => {
    const geometry = this.own(new PlaneGeometry(1, .74).rotateX(-Math.PI / 2).translate(0, .922, 0));
    geometry.computeBoundingBox();
    return { parts: [{ geometry, material: this.beltMaterial, matrix: new Matrix4(), name: 'belt_strip' }], box: geometry.boundingBox!.clone() };
  })();
  /** Separate parts whose name path matches (animated children such as `stove_flame`) from the rest. */
  split(template: Template, pattern: RegExp): [Template, Template] {
    const pick = (keep: boolean) => {
      const parts = template.parts.filter(part => pattern.test(part.name) === keep), box = new Box3();
      for (const part of parts) { part.geometry.computeBoundingBox(); box.union(bounds.copy(part.geometry.boundingBox!).applyMatrix4(part.matrix)); }
      return { parts, box };
    };
    return [pick(false), pick(true)];
  }
  private store(name: string, template: Template) { this.cache.set(`p:${name}`, template); template.parts.forEach(part => this.own(part.geometry)); return template; }
  /**
   * Bake static placements: untinted parts merge into one mesh per material (a handful of draw calls for the whole
   * kitchen); tinted parts (floor checker, crate labels) and multi-material parts use one InstancedMesh per
   * geometry+material. A colour tints only the art's tintable materials unless `all` is set (procedural tiles).
   */
  batch(entries: { template: Template; matrix: Matrix4; color?: Color; all?: boolean }[], shadows: { cast: boolean; receive: boolean }) {
    const root = new Group(), white = new Color(1, 1, 1);
    const merged = new Map<string, { material: Material; pieces: BufferGeometry[] }>(), instanced = new Map<string, { part: TemplatePart; items: { matrix: Matrix4; color?: Color }[] }>();
    for (const entry of entries) for (const part of entry.template.parts) {
      const matrix = entry.matrix.clone().multiply(part.matrix);
      const color = entry.color && (entry.all || TINTABLE.has([part.material].flat()[0].name)) ? entry.color : undefined;
      if (color || Array.isArray(part.material)) {
        const key = `${part.geometry.uuid}:${[part.material].flat().map(material => material.uuid).join(',')}`;
        const group = instanced.get(key) ?? { part, items: [] };
        group.items.push({ matrix, color }); instanced.set(key, group);
        continue;
      }
      const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      geometry.applyMatrix4(matrix); geometry.morphAttributes = {};
      const key = `${part.material.uuid}:${Object.keys(geometry.attributes).sort().map(name => `${name}${geometry.attributes[name].itemSize}`).join(',')}`;
      const group = merged.get(key) ?? { material: part.material, pieces: [] };
      group.pieces.push(geometry); merged.set(key, group);
    }
    for (const { material, pieces } of merged.values()) {
      const geometry = this.own(mergeGeometries(pieces) ?? pieces[0]);
      pieces.forEach(piece => piece !== geometry && piece.dispose());
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = shadows.cast; mesh.receiveShadow = shadows.receive; mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
    for (const { part, items } of instanced.values()) {
      const mesh = this.own(new InstancedMesh(part.geometry, part.material, items.length));
      const tinted = items.some(item => item.color);
      items.forEach((item, i) => { mesh.setMatrixAt(i, item.matrix); if (tinted) mesh.setColorAt(i, item.color ?? white); });
      mesh.castShadow = shadows.cast; mesh.receiveShadow = shadows.receive; mesh.computeBoundingSphere();
      root.add(mesh);
    }
    return root;
  }
  /** A light clone: meshes share geometry and materials. */
  spawn(template: Template, shadows = false) {
    const group = new Group();
    for (const part of template.parts) {
      const mesh = new Mesh(part.geometry, part.material);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(part.matrix); mesh.name = part.name; mesh.castShadow = shadows;
      group.add(mesh);
    }
    return group;
  }
}

const offset = new Matrix4(), position = new Vector3(), bounds = new Box3();
/** Mesh parts relative to the asset's own origin (its top-level placement in Blender is ignored). */
export function flatten(source: Object3D): Template {
  source.updateWorldMatrix(true, true);
  source.getWorldPosition(position);
  offset.makeTranslation(-position.x, -position.y, -position.z);
  const parts: Template['parts'] = [], box = new Box3();
  source.traverse(object => {
    if (!(object instanceof Mesh) || !object.visible) return;
    const matrix = offset.clone().multiply(object.matrixWorld);
    object.geometry.computeBoundingBox();
    box.union(bounds.copy(object.geometry.boundingBox!).applyMatrix4(matrix));
    let name = object.name;
    for (let parent = object.parent; parent && parent !== source; parent = parent.parent) name = `${parent.name}/${name}`;
    parts.push({ geometry: object.geometry, material: object.material, matrix, name });
  });
  return { parts, box };
}
/** Uniformly shrink a template whose footprint is far larger than its family allows. */
export function fitTemplate(template: Template, size: number): Template {
  const extent = Math.max(template.box.max.x - template.box.min.x, template.box.max.z - template.box.min.z);
  if (!(extent > size * 1.3)) return template;
  const scale = new Matrix4().makeScale(size / extent, size / extent, size / extent);
  return { parts: template.parts.map(part => ({ ...part, matrix: scale.clone().multiply(part.matrix) })), box: template.box.clone().applyMatrix4(scale) };
}

/** A template drawn many times per frame with changing transforms (plate stacks): one InstancedMesh per part. */
export class Instances {
  readonly group = new Group(); private meshes: InstancedMesh[]; private count = 0; private matrix = new Matrix4();
  constructor(private template: Template, capacity: number, own: <T extends { dispose(): void }>(r: T) => T, shadows = true) {
    this.meshes = template.parts.map(part => { const mesh = own(new InstancedMesh(part.geometry, part.material, capacity)); mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadows; this.group.add(mesh); return mesh; });
  }
  begin() { this.count = 0; }
  add(matrix: Matrix4) {
    if (this.count >= this.meshes[0]?.instanceMatrix.count) return;
    this.meshes.forEach((mesh, i) => mesh.setMatrixAt(this.count, this.matrix.multiplyMatrices(matrix, this.template.parts[i].matrix)));
    this.count++;
  }
  end() { for (const mesh of this.meshes) { mesh.count = this.count; mesh.instanceMatrix.needsUpdate = true; } }
}
