/**
 * Static module features on the board (EXPERIENCE §1.5, §3.5): river ribbons along interior edges,
 * fishing-ground signs with runtime-drawn numbers, and the barbarian ship's dotted track on the
 * water. Rebuilt with the other static layers when the board or fog reveals change.
 */
import {
  BufferGeometry, CircleGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, RepeatWrapping,
} from 'three';
import { distance, type Point } from '../../geometry';
import type { BoardFeature, EdgeId, PublicView, VertexId } from '../../model';
import { boardIndex } from '../shared/board';
import { CREAM, LAND_TOP, ORDER, SEA_Y } from './constants';
import type { Ctx } from './context';
import { features } from './module-places';
import { isWater, tilePoint } from './places';

const RIVER_W = 0.12, DASH = 0.3, FLOW = 0.05, SIGN_OUT = 0.45, DOT_GAP = 0.28;
type Ground = Extract<BoardFeature, { kind: 'fishing-ground' }>;
type View = Pick<PublicView, 'board' | 'pieces'>;

/** Sign spot: on a lake at its centre, else SIGN_OUT wu out to sea from the coastal corners' midpoint. */
export function signSpot(view: View, f: Ground) {
  const index = boardIndex(view.board), tile = index.tiles.get(f.tile);
  const corners = f.vertices.map(v => index.vertices.get(v)).filter(v => !!v);
  if (!tile) return null;
  if (!isWater(view, f.tile) || !corners.length) return { x: tile.x, y: tile.y, h: LAND_TOP };
  const mid = corners.reduce((p, v) => ({ x: p.x + v.x / corners.length, y: p.y + v.y / corners.length }),
    { x: 0, y: 0 });
  const n = distance(mid, tile) || 1;
  const k = SIGN_OUT / n;
  return { x: mid.x + (tile.x - mid.x) * k, y: mid.y + (tile.y - mid.y) * k, h: SEA_Y };
}

/** One quad per river edge, chained so the dashes flow one way; u runs in DASH-long repeats. */
function ribbon(view: View, edges: EdgeId[], pos: number[], uv: number[]) {
  const index = boardIndex(view.board), y = LAND_TOP + 0.003;
  let prev: VertexId | null = null, u = 0;
  for (const id of edges) {
    const e = index.edges.get(id);
    if (!e) continue;
    const [a, b]: VertexId[] = prev === e.b ? [e.b, e.a] : [e.a, e.b];
    if (prev !== a) u = 0;
    const A = index.vertices.get(a)!, B = index.vertices.get(b)!, L = distance(A, B);
    const dx = (B.x - A.x) / L, dy = (B.y - A.y) / L, h = RIVER_W / 2;
    const at = (p: Point, along: number, side: number) =>
      [p.x + dx * along - dy * side, y, p.y + dy * along + dx * side];
    const quad = [at(A, -h, h), at(A, -h, -h), at(B, h, -h), at(B, h, h)];
    const u1 = u + (L + RIVER_W) / DASH, uvs = [[u, 1], [u, 0], [u1, 0], [u1, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...quad[i]); uv.push(...uvs[i]); }
    u = u1 - RIVER_W / DASH;
    prev = b;
  }
}

export function buildFeatures(ctx: Ctx, view: PublicView) {
  const { scope, tex } = ctx, group = new Group(), all = features(view);
  const pos: number[] = [], uv: number[] = [];
  for (const f of all) if (f.kind === 'river') ribbon(view, f.edges, pos, uv);
  const water = tex.river();
  if (pos.length) {
    water.wrapS = RepeatWrapping;
    water.needsUpdate = true;
    const g = scope.own(new BufferGeometry());
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    const mesh = new Mesh(g, scope.own(new MeshBasicMaterial({
      map: water, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    })));
    mesh.renderOrder = ORDER.tile;
    group.add(mesh);
  }

  for (const f of all) {
    const spot = f.kind === 'fishing-ground' ? signSpot(view, f) : null;
    if (!spot || f.kind !== 'fishing-ground') continue;
    const face = scope.own(new MeshBasicMaterial({
      map: tex.fishSign(f.numbers), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    const sign = new Group();
    for (const part of ctx.kit.parts('fishing_sign')) {
      const mesh = new Mesh(part.geometry, part.role === 'decal' ? face : ctx.part(part));
      mesh.applyMatrix4(part.matrix);
      mesh.renderOrder = ORDER.token;
      sign.add(mesh);
    }
    sign.position.set(spot.x, spot.h, spot.y);
    group.add(sign);
  }

  // The barbarian ship's track: cream dots every DOT_GAP wu through the waypoints, at opacity 0.25.
  const dots: Point[] = [];
  for (const f of all) {
    if (f.kind !== 'barbarian-path') continue;
    const via = f.tiles.map(t => tilePoint(view, t)).filter(p => !!p);
    via.slice(1).forEach((b, i) => {
      const a = via[i], n = Math.max(1, Math.round(distance(a, b) / DOT_GAP));
      for (let k = 0; k < n; k++) dots.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    });
  }
  if (dots.length) {
    const mesh = new InstancedMesh(scope.own(new CircleGeometry(0.04, 12).rotateX(-Math.PI / 2)),
      scope.own(new MeshBasicMaterial({ color: CREAM, transparent: true, opacity: 0.25, depthWrite: false })),
      dots.length);
    const m = new Matrix4();
    dots.forEach((d, i) => mesh.setMatrixAt(i, m.makeTranslation(d.x, SEA_Y + 0.012, d.y)));
    mesh.renderOrder = ORDER.token;
    group.add(mesh);
  }

  return {
    group,
    /** Rivers flow at FLOW wu/s; still under reduced motion. */
    frame(now: number, reduced: boolean) {
      if (pos.length && !reduced) water.offset.x = -(((now / 1000) * FLOW) / DASH) % 1;
    },
  };
}
export type FeatureLayer = ReturnType<typeof buildFeatures>;
