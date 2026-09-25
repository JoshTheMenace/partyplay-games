/**
 * One instanced mesh per part of a node, so 96 settlements cost as many draw calls as one.
 * Seat slots take a per-instance colour and the decal takes a per-instance emblem cell.
 * Like a rubber stamp: one stamp per part, pressed once per piece on the board.
 */
import {
  Color, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, type Material, type Object3D,
} from 'three';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { SEATS } from '../shared/seats';
import { ATLAS, type Textures } from './canvas';
import { INK } from './constants';
import type { Part } from './kit';
import { SEAT_ROLES, type Materials } from './materials';

/**
 * hide: part tags to leave out (inactive banner, unused level pennants); dark: seat_dark on the body
 * (inactive knights); tint: the colour of `cargo` slots.
 */
export type Instance = {
  matrix: Matrix4; seat: number; hide?: ReadonlySet<string>; dark?: boolean; tint?: string;
};

const BODY = SEATS.map(s => new Color(s.body)), DARK = SEATS.map(s => new Color(s.dark));
const ZERO = new Matrix4().makeScale(0, 0, 0), tints = new Map<string, Color>();
const tint = (hex = '#ffffff') => tints.get(hex) ?? tints.set(hex, new Color(hex)).get(hex)!;
function colour(role: string, inst: Instance) {
  if (role === 'cargo') return tint(inst.tint);
  return (role === 'seat' && !inst.dark ? BODY : DARK)[inst.seat % BODY.length];
}
const cell = (seat: number): [number, number] => {
  const row = Math.floor(seat / ATLAS.columns) % ATLAS.rows;
  return [(seat % ATLAS.columns) / ATLAS.columns, row / ATLAS.rows];
};

/** Ink emblem decal whose UVs pick the instance's atlas cell. */
export function decalMaterial(scope: ResourceScope, tex: Textures, mats: Materials): Material {
  return mats.once('decal', () => {
    const m = scope.own(new MeshBasicMaterial({
      color: INK, map: tex.atlas(), transparent: true, opacity: 0.7, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    m.onBeforeCompile = shader => {
      const cellSize = `vec2(${1 / ATLAS.columns}, ${1 / ATLAS.rows})`;
      shader.vertexShader = 'attribute vec2 emblemCell;\n' + shader.vertexShader.replace('#include <uv_vertex>',
        `#include <uv_vertex>\nvMapUv = vMapUv * ${cellSize} + emblemCell;`);
    };
    m.customProgramCacheKey = () => 'island-settlers-emblem';
    return m;
  });
}

export class Batch {
  private meshes: InstancedMesh[] = [];
  private capacity = 0;
  private readonly m = new Matrix4();

  constructor(
    private readonly scope: ResourceScope, private readonly parent: Object3D, private readonly parts: Part[],
    private readonly material: (part: Part) => Material, private readonly order: number,
  ) {
    scope.defer(() => this.meshes.forEach(mesh => mesh.dispose()));
  }

  private grow(n: number) {
    this.meshes.forEach(mesh => { mesh.removeFromParent(); mesh.dispose(); });
    this.capacity = Math.max(8, 2 ** Math.ceil(Math.log2(n)));
    this.meshes = this.parts.map(part => {
      const decal = part.role === 'decal';
      const geometry = decal ? this.scope.own(part.geometry.clone()) : part.geometry;
      const cells = new InstancedBufferAttribute(new Float32Array(this.capacity * 2), 2);
      if (decal) geometry.setAttribute('emblemCell', cells);
      const mesh = new InstancedMesh(geometry, this.material(part), this.capacity);
      Object.assign(mesh, { frustumCulled: false, renderOrder: this.order });
      this.parent.add(mesh);
      return mesh;
    });
  }

  /** Write every instance; call when pieces change or animate. */
  write(instances: readonly Instance[]) {
    if (instances.length > this.capacity) this.grow(instances.length);
    this.meshes.forEach((mesh, p) => {
      const part = this.parts[p], seat = SEAT_ROLES.has(part.role) || part.role === 'cargo';
      const cells = mesh.geometry.getAttribute('emblemCell');
      instances.forEach((inst, i) => {
        const hidden = inst.hide && part.tags?.some(t => inst.hide!.has(t));
        mesh.setMatrixAt(i, hidden ? ZERO : this.m.multiplyMatrices(inst.matrix, part.matrix));
        if (seat) mesh.setColorAt(i, colour(part.role, inst));
        if (cells) cells.setXY(i, ...cell(inst.seat));
      });
      mesh.count = instances.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (cells) cells.needsUpdate = true;
    });
  }
}
