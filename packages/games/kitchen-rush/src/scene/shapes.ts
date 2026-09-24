// A tiny procedural modelling kit: primitives are baked with vertex colours and merged into one geometry per finish,
// so a whole fallback asset costs one or two draw calls and batches like authored art.
import { BoxGeometry, Box3, BufferGeometry, CapsuleGeometry, Color, ConeGeometry, CylinderGeometry, Euler, Float32BufferAttribute, LatheGeometry, Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector2, Vector3, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Finish = 'matte' | 'gloss' | 'metal' | 'glow';
export type TemplatePart = { geometry: BufferGeometry; material: Material | Material[]; matrix: Matrix4; name: string };
/** Anything drawable: authored GLB meshes or merged procedural shapes, in the asset's own space. */
export type Template = { parts: TemplatePart[]; box: Box3 };
export type Place = { at?: readonly number[]; rot?: readonly number[]; scale?: number | readonly number[]; color: string; finish?: Finish };

const matrix = new Matrix4(), quaternion = new Quaternion(), euler = new Euler(), scale = new Vector3(), position = new Vector3(), tint = new Color();

export class Shape {
  private pieces = new Map<Finish, BufferGeometry[]>();
  add(geometry: BufferGeometry, { at = [0, 0, 0], rot = [0, 0, 0], scale: s = 1, color, finish = 'matte' }: Place) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    scale.set(...(typeof s === 'number' ? [s, s, s] as const : s as [number, number, number]));
    matrix.compose(position.set(at[0], at[1], at[2]), quaternion.setFromEuler(euler.set(rot[0], rot[1], rot[2])), scale);
    g.applyMatrix4(matrix);
    tint.set(color);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const list = this.pieces.get(finish) ?? []; list.push(g); this.pieces.set(finish, list);
    return this;
  }
  box(size: readonly number[], place: Place & { r?: number }) {
    const r = Math.min(place.r ?? 0, ...size.map(v => v / 2 - .001));
    return this.add(r > .004 ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, r) : new BoxGeometry(size[0], size[1], size[2]), place);
  }
  cylinder(radiusTop: number, radiusBottom: number, height: number, place: Place & { segments?: number }) { return this.add(new CylinderGeometry(radiusTop, radiusBottom, height, place.segments ?? 18), place); }
  sphere(radius: number, place: Place & { segments?: number }) { return this.add(new SphereGeometry(radius, place.segments ?? 16, Math.max(6, Math.round((place.segments ?? 16) * .66))), place); }
  torus(radius: number, tube: number, place: Place & { arc?: number }) { return this.add(new TorusGeometry(radius, tube, 8, 24, place.arc ?? Math.PI * 2), place); }
  cone(radius: number, height: number, place: Place & { segments?: number }) { return this.add(new ConeGeometry(radius, height, place.segments ?? 14), place); }
  capsule(radius: number, length: number, place: Place) { return this.add(new CapsuleGeometry(radius, length, 4, 12), place); }
  /** Revolve a profile of [radius, height] points around Y (bowls, pots, bins). */
  lathe(profile: readonly (readonly [number, number])[], place: Place & { segments?: number }) { return this.add(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), place.segments ?? 22), place); }
  build(materials: Record<Finish, Material>, name: string): Template {
    const parts: TemplatePart[] = [];
    for (const [finish, list] of this.pieces) {
      const geometry = mergeGeometries(list)!; list.forEach(item => item.dispose());
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      parts.push({ geometry, material: materials[finish], matrix: new Matrix4(), name: `${name}_${finish}` });
    }
    this.pieces.clear();
    const box = new Box3(); parts.forEach(part => box.union(part.geometry.boundingBox!));
    return { parts, box };
  }
}
