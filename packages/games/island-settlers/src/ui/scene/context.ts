/** Everything a scene layer needs for one round: disposal scope, materials, textures and the model kit. */
import { Vector3, type Object3D } from 'three';
import type { Point } from '../../geometry';
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { Batch, decalMaterial } from './batch';
import type { Textures } from './canvas';
import type { Kit, Part } from './kit';
import type { Materials } from './materials';

export type Ctx = {
  scope: ResourceScope; mats: Materials; tex: Textures; kit: Kit;
  /** An instanced batch of a kit node under parent. */
  batch(node: string, parent: Object3D, order: number): Batch;
  part(part: Part): ReturnType<Materials['role']>;
};

export function context(scope: ResourceScope, mats: Materials, tex: Textures, kit: Kit): Ctx {
  const part = (p: Part) =>
    (p.role === 'decal' ? decalMaterial(scope, tex, mats) : mats.role(p.role, p.source));
  return {
    scope, mats, tex, kit, part,
    batch: (node, parent, order) => new Batch(scope, parent, kit.parts(node), part, order),
  };
}

/** World point (x east, y south) at height h as a scene vector. */
export const at = (p: Point, h = 0) => new Vector3(p.x, h, p.y);
