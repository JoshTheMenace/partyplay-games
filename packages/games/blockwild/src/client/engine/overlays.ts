/** Selection outline and break-crack overlays that hug each block's real shape (slabs, stairs, torches...). */
import { BufferAttribute, BufferGeometry, CustomBlending, DstColorFactor, LineBasicMaterial, LineSegments, Mesh, ShaderMaterial, SrcColorFactor, type Object3D } from 'three';
import { selectionBoxes, type Box } from '../../shared/shapes';
import type { Target } from '../store';
import type { WorldUniforms } from './material';

const GROW = 0.002, MAX_CRACKS = 10, STAGES = 10;
export type Crack = { x: number; y: number; z: number; stage: number };

/** Memoised per-cell-value geometries (a handful of shapes are ever targeted). */
class ShapeCache {
  private readonly geometries = new Map<number, BufferGeometry>();
  constructor(private readonly build: (boxes: readonly Box[]) => BufferGeometry) {}
  get(cell: number) {
    let geometry = this.geometries.get(cell);
    if (!geometry) this.geometries.set(cell, geometry = this.build(selectionBoxes(cell)));
    return geometry;
  }
  dispose() {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }
}

const grow = (box: Box, by: number): Box => [box[0] - by, box[1] - by, box[2] - by, box[3] + by, box[4] + by, box[5] + by];

function edgeGeometry(boxes: readonly Box[]) {
  const points: number[] = [];
  for (const box of boxes) {
    const [x0, y0, z0, x1, y1, z1] = grow(box, GROW);
    for (const [ax, ay, az, bx, by, bz] of [
      [x0, y0, z0, x1, y0, z0], [x0, y1, z0, x1, y1, z0], [x0, y0, z1, x1, y0, z1], [x0, y1, z1, x1, y1, z1],
      [x0, y0, z0, x0, y1, z0], [x1, y0, z0, x1, y1, z0], [x0, y0, z1, x0, y1, z1], [x1, y0, z1, x1, y1, z1],
      [x0, y0, z0, x0, y0, z1], [x1, y0, z0, x1, y0, z1], [x0, y1, z0, x0, y1, z1], [x1, y1, z0, x1, y1, z1],
    ]) points.push(ax!, ay!, az!, bx!, by!, bz!);
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
}

/** Box faces with block-space UVs, so a crack on a slab shows the matching half of the texture (like MC). */
function crackGeometry(boxes: readonly Box[]) {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (const box of boxes) {
    const b = grow(box, GROW * 2);
    for (let face = 0; face < 6; face++) {
      const axis = face >> 1, u = axis === 0 ? 2 : 0, v = axis === 1 ? 2 : 1, w = face & 1 ? b[axis + 3]! : b[axis]!;
      const base = positions.length / 3;
      for (const [cu, cv] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        const p = [0, 0, 0];
        p[axis] = w;
        p[u] = cu ? b[u + 3]! : b[u]!;
        p[v] = cv ? b[v + 3]! : b[v]!;
        positions.push(p[0]!, p[1]!, p[2]!);
        uvs.push(p[u]!, 1 - p[v]!);
      }
      // Wind each face counter-clockwise from outside.
      const flip = (face & 1) === (axis === 2 ? 0 : 1);
      index.push(...flip ? [base, base + 2, base + 1, base, base + 3, base + 2] : [base, base + 1, base + 2, base, base + 2, base + 3]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(index);
  return geometry;
}

const CRACK_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const CRACK_FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uLayer;
in vec2 vUv;
void main() {
  vec4 tex = texture(uAtlas, vec3(fract(vUv), uLayer));
  if (tex.a < 0.1) discard;
  // MC's crumbling blend (src·dst + dst·src): mid grey leaves the block unchanged, dark texels carve cracks, light ones rim them.
  gl_FragColor = vec4(mix(vec3(0.2140), tex.rgb, tex.a), 1.0);
#include <colorspace_fragment>
}`;

export class BlockOutline {
  private readonly line: LineSegments;
  private readonly shapes = new ShapeCache(edgeGeometry);
  private readonly material = new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });

  constructor(private readonly scene: Object3D) {
    this.line = new LineSegments(undefined, this.material);
    this.line.visible = false;
    this.line.renderOrder = 3;
    scene.add(this.line);
  }
  set(target: Target | null) {
    this.line.visible = target?.kind === 'block' && selectionBoxes(target.cell).length > 0;
    if (!this.line.visible || target?.kind !== 'block') return;
    this.line.geometry = this.shapes.get(target.cell);
    this.line.position.set(target.x, target.y, target.z);
  }
  dispose() {
    this.scene.remove(this.line);
    this.shapes.dispose();
    this.material.dispose();
  }
}

export class CrackOverlay {
  private readonly meshes: Mesh[] = [];
  private readonly materials: ShaderMaterial[];
  private readonly shapes = new ShapeCache(crackGeometry);

  constructor(private readonly scene: Object3D, uniforms: WorldUniforms, layerOf: (key: string) => number, private readonly cellAt: (x: number, y: number, z: number) => number) {
    this.materials = Array.from({ length: STAGES }, (_, stage) => new ShaderMaterial({
      vertexShader: CRACK_VERTEX, fragmentShader: CRACK_FRAGMENT, transparent: true, depthWrite: false,
      blending: CustomBlending, blendSrc: DstColorFactor, blendDst: SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
      uniforms: { uAtlas: uniforms.uAtlas, uLayer: { value: layerOf(`crack_${stage}`) } },
    }));
  }
  /** Shows up to ten cracks (stage 0..9); the shape follows the block currently in that cell. */
  set(list: readonly Crack[]) {
    for (let i = 0; i < MAX_CRACKS; i++) {
      const crack = list[i];
      let mesh = this.meshes[i];
      const cell = crack ? this.cellAt(crack.x, crack.y, crack.z) : 0;
      if (!crack || !selectionBoxes(cell).length) {
        if (mesh) mesh.visible = false;
        continue;
      }
      if (!mesh) {
        this.meshes[i] = mesh = new Mesh();
        mesh.renderOrder = 4;
        this.scene.add(mesh);
      }
      mesh.visible = true;
      mesh.geometry = this.shapes.get(cell);
      mesh.material = this.materials[Math.max(0, Math.min(STAGES - 1, Math.floor(crack.stage)))]!;
      mesh.position.set(crack.x, crack.y, crack.z);
    }
  }
  dispose() {
    for (const mesh of this.meshes) this.scene.remove(mesh);
    this.shapes.dispose();
    for (const material of this.materials) material.dispose();
  }
}
