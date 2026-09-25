/**
 * Hex tiles, coast, sea and fog (EXPERIENCE §1.1–§1.3). All land shares one instanced prism tinted
 * per tile, so a robbed hex can fade toward grey by changing one instance colour.
 */
import {
  BufferGeometry, CircleGeometry, Color, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, Vector2,
} from 'three';
import { axialKey, corners, neighbor, type Point } from '../../geometry';
import type { PublicView, Terrain, TileId } from '../../model';
import { tileFace } from '../shared/board';
import { TERRAIN_META } from '../shared/labels';
import { landBox, WATER } from './camera';
import { BEACH, LAND_TOP, ORDER, SEA_Y, SHELF, hashUnit } from './constants';
import type { Ctx } from './context';
import { breathe, easeOutBack, progress } from './motion';

const GREY = new Color('#7d7f86'), FOG = '#2a3e5c', FOAM = '#dff4ff';

export const isLand = (terrain: Terrain) => terrain !== 'fog' && !WATER.has(terrain);

function prism() {
  const shape = new Shape(corners({ x: 0, y: 0 }, 0.935).map(c => new Vector2(c.x, -c.y)));
  const bevel = { bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 1 };
  const g = new ExtrudeGeometry(shape, { depth: 0.3, ...bevel });
  return g.rotateX(-Math.PI / 2).translate(0, -0.04, 0);
}
const flatHex = (r: number) => new CircleGeometry(r, 6, Math.PI / 6).rotateX(-Math.PI / 2);

/** Quads along coast edges between radius r0 and r1 from each tile centre, with an outward attribute. */
function strips(edges: { c: Point; i: number }[], r0: number, r1: number, y: number) {
  const pos: number[] = [], out: number[] = [];
  for (const { c, i } of edges) {
    const a0 = corners(c, r0)[(i + 5) % 6], b0 = corners(c, r0)[i], a1 = corners(c, r1)[(i + 5) % 6];
    const b1 = corners(c, r1)[i], mx = (a1.x + b1.x) / 2 - c.x, my = (a1.y + b1.y) / 2 - c.y;
    const n = Math.hypot(mx, my);
    for (const p of [a0, a1, b1, a0, b1, b0]) { pos.push(p.x, y, p.y); out.push(mx / n, my / n); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('outward', new Float32BufferAttribute(out, 2));
  g.computeVertexNormals();
  return g;
}

export function buildTerrain(ctx: Ctx, view: PublicView, fresh: ReadonlySet<TileId>, now: number) {
  const { scope, mats } = ctx, group = new Group(), m = new Matrix4();
  const faces = new Map(view.board.tiles.map(t => [t.id, tileFace(view, t.id)]));
  const cells = new Map(view.board.tiles.map(t => [axialKey(t), t]));
  const land = view.board.tiles.filter(t => isLand(faces.get(t.id)!.terrain));
  const water = view.board.tiles.filter(t => WATER.has(faces.get(t.id)!.terrain));
  const fog = view.board.tiles.filter(t => faces.get(t.id)!.terrain === 'fog');
  const add = <T extends Mesh | InstancedMesh>(mesh: T, order: number = ORDER.tile) => {
    Object.assign(mesh, { frustumCulled: false, renderOrder: order });
    group.add(mesh);
    return mesh;
  };

  // Deep ocean: an unlit gradient plane that is the stage background.
  const box = landBox(view.board), size = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 3.2;
  const ocean = add(new Mesh(scope.own(new PlaneGeometry(size, size).rotateX(-Math.PI / 2)),
    scope.own(new MeshBasicMaterial({ map: ctx.tex.ocean() }))), -1);
  ocean.position.set((box.minX + box.maxX) / 2, 0, (box.minY + box.maxY) / 2);

  // Land prisms: white top and grey side materials, tinted per instance with the terrain top colour.
  const white = mats.once('white', () => mats.standard({ color: '#ffffff' }));
  const side = mats.once('side', () => mats.standard({ color: '#b4b4b4' }));
  const prisms = add(new InstancedMesh(scope.own(prism()), [white, side], Math.max(1, land.length)));
  const base = land.map(t => new Color(TERRAIN_META[faces.get(t.id)!.terrain].top));
  const slot = new Map(land.map((t, i) => [t.id, i]));
  const place = (i: number, dy: number) => prisms.setMatrixAt(i, m.makeTranslation(land[i].x, dy, land[i].y));
  land.forEach((t, i) => { place(i, fresh.has(t.id) ? -0.3 : 0); prisms.setColorAt(i, base[i]); });
  prisms.count = land.length;

  // Shelf water, lightly varied so the sea is not flat paint.
  const shelf = add(new InstancedMesh(scope.own(flatHex(0.99)), white, Math.max(1, water.length)));
  shelf.count = water.length;
  water.forEach((t, i) => {
    shelf.setMatrixAt(i, m.makeTranslation(t.x, SEA_Y, t.y));
    const tint = new Color(faces.get(t.id)!.terrain === 'shoal' ? '#4fa3c9' : SHELF);
    shelf.setColorAt(i, tint.multiplyScalar(0.94 + hashUnit(t.id) * 0.1));
  });

  // Coast: beach strip on the land top and a drifting foam band on the water just outside it.
  const coast = land.flatMap(t => [0, 1, 2, 3, 4, 5]
    .filter(i => {
      const n = cells.get(axialKey(neighbor(t, i)));
      return !n || WATER.has(faces.get(n.id)!.terrain);
    })
    .map(i => ({ c: t as Point, i })));
  const beach = mats.once('beach', () => mats.standard({ color: BEACH }));
  add(new Mesh(scope.own(strips(coast, 0.935, 0.82, LAND_TOP + 0.001)), beach));
  const drift = { value: 0 };
  const foamMaterial = scope.own(new MeshBasicMaterial({
    color: FOAM, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide,
  }));
  foamMaterial.onBeforeCompile = shader => {
    shader.uniforms.drift = drift;
    shader.vertexShader = 'attribute vec2 outward;\nuniform float drift;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz += outward * drift;');
  };
  add(new Mesh(scope.own(strips(coast, 1.0, 1.1, 0.03)), foamMaterial));

  // Fog: a dark hex under three clouds per tile.
  const fogMaterial = mats.once('fog', () => mats.standard({ color: FOG }));
  const fogBase = add(new InstancedMesh(scope.own(flatHex(0.99)), fogMaterial, Math.max(1, fog.length)));
  fog.forEach((t, i) => fogBase.setMatrixAt(i, m.makeTranslation(t.x, SEA_Y, t.y)));
  fogBase.count = fog.length;
  const clouds = ctx.batch('fog_cloud', group, ORDER.tile);
  const puffs = [...fog, ...view.board.tiles.filter(t => fresh.has(t.id))]
    .flatMap(t => [0, 1, 2].map(k => ({ t, k })));
  const writeClouds = (grow: number) => clouds.write(puffs.filter(p => grow < 1.4 || !fresh.has(p.t.id))
    .map(({ t, k }) => {
      const a = hashUnit(t.id, k) * Math.PI * 2, r = 0.2 + hashUnit(t.id, k + 9) * 0.3;
      const s = fresh.has(t.id) ? grow : 1;
      const y = 0.35 + hashUnit(t.id, k + 5) * 0.2;
      const matrix = new Matrix4().makeTranslation(t.x + Math.cos(a) * r, y, t.y + Math.sin(a) * r)
        .multiply(new Matrix4().makeScale(s, s, s));
      return { matrix, seat: 0 };
    }));
  writeClouds(1);

  let tint = new Map<TileId, number>(), settled = !fresh.size;
  const risen = new Set(land.filter(t => fresh.has(t.id)).map(t => t.id));
  return {
    group,
    /** Revealed land tiles still rising, and their current height offset (−0.30 → 0). */
    rising(time: number, reduced: boolean) {
      const t = progress(time, now, reduced ? 1 : 600);
      return { tiles: t < 1 ? risen : new Set<TileId>(), lift: -0.3 * (1 - easeOutBack(t, 1.7)) };
    },
    /** Robbed hex: amount 0..1 of the 55% blend toward grey. */
    tint(next: Map<TileId, number>) {
      for (const id of new Set([...tint.keys(), ...next.keys()])) {
        const i = slot.get(id);
        if (i !== undefined) prisms.setColorAt(i, base[i].clone().lerp(GREY, 0.55 * (next.get(id) ?? 0)));
      }
      tint = next;
      if (prisms.instanceColor) prisms.instanceColor.needsUpdate = true;
    },
    frame(time: number, reduced: boolean) {
      drift.value = breathe(time, 4000, -0.02, 0.02, reduced, 0);
      if (settled) return;
      const cloud = progress(time, now, reduced ? 1 : 500), rise = progress(time, now, reduced ? 1 : 600);
      settled = cloud >= 1 && rise >= 1;
      writeClouds(cloud < 1 ? 1 + 0.4 * cloud : 1.4);
      land.forEach((t, i) => { if (fresh.has(t.id)) place(i, -0.3 * (1 - easeOutBack(rise, 1.7))); });
      prisms.instanceMatrix.needsUpdate = true;
    },
  };
}
export type TerrainLayer = ReturnType<typeof buildTerrain>;
