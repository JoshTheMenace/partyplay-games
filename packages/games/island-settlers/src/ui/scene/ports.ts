/**
 * Harbour plaques (EXPERIENCE §1.4): a flat cream plaque on the water 0.55 wu out from the port
 * edge, upright to the camera, joined to its two corners by ink dock planks.
 */
import {
  ExtrudeGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Shape,
  Vector3,
} from 'three';
import { angle, distance, midpoint, type Point } from '../../geometry';
import type { PublicView } from '../../model';
import { boardIndex } from '../shared/board';
import { INK, ORDER, SEA_Y } from './constants';
import type { Ctx } from './context';

const W = 0.72, D = 0.4, THICK = 0.03, OUT = 0.55, PLANK = 0.07;

function slab() {
  const x = W / 2, y = D / 2, r = 0.08, shape = new Shape().moveTo(-x + r, -y);
  shape.lineTo(x - r, -y).quadraticCurveTo(x, -y, x, -y + r)
    .lineTo(x, y - r).quadraticCurveTo(x, y, x - r, y)
    .lineTo(-x + r, y).quadraticCurveTo(-x, y, -x, y - r)
    .lineTo(-x, -y + r).quadraticCurveTo(-x, -y, -x + r, -y);
  return new ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false }).rotateX(-Math.PI / 2);
}

export function buildPorts(ctx: Ctx, view: PublicView) {
  const { scope, mats, tex } = ctx, group = new Group(), index = boardIndex(view.board);
  const base = scope.own(slab()), face = scope.own(new PlaneGeometry(W, D).rotateX(-Math.PI / 2));
  const side = mats.once('plaqueSide', () => mats.standard({ color: '#d9ccb0' }));
  const ink = mats.once('plankInk', () => scope.own(new MeshBasicMaterial({ color: INK })));
  const planks = new InstancedMesh(scope.own(new PlaneGeometry(1, PLANK).rotateX(-Math.PI / 2)), ink,
    Math.max(1, view.board.ports.length * 2));
  planks.count = 0;
  const m = new Matrix4(), up = new Vector3(0, 1, 0);

  for (const port of view.board.ports) {
    const [a, b] = port.vertices.map(v => index.vertices.get(v)), sea = index.tiles.get(port.tile);
    if (!a || !b || !sea) continue;
    const mid = midpoint(a, b), n = distance(mid, sea) || 1;
    const at: Point = { x: mid.x + ((sea.x - mid.x) / n) * OUT, y: mid.y + ((sea.y - mid.y) / n) * OUT };
    for (const corner of [a, b]) {
      const centre = midpoint(at, corner), q = new Quaternion().setFromAxisAngle(up, -angle(at, corner));
      m.compose(new Vector3(centre.x, SEA_Y + 0.015, centre.y), q, new Vector3(distance(at, corner), 1, 1));
      planks.setMatrixAt(planks.count++, m);
    }
    const material = mats.once(`plaque${port.good}${port.ratio}`, () => scope.own(new MeshBasicMaterial({
      map: tex.plaque(port.good, port.ratio), alphaTest: 0.5,
    })));
    const slabMesh = new Mesh(base, side), top = new Mesh(face, material);
    slabMesh.position.set(at.x, SEA_Y, at.y);
    top.position.set(at.x, SEA_Y + THICK + 0.002, at.y);
    slabMesh.renderOrder = top.renderOrder = ORDER.token;
    group.add(slabMesh, top);
  }
  planks.renderOrder = ORDER.tile;
  planks.frustumCulled = false;
  group.add(planks);
  return { group };
}
