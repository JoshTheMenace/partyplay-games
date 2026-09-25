/**
 * Board highlights (EXPERIENCE §2, §3.5): robber rims and victim pins, breathing setup/intent/pick
 * spots, the active seat's spotlight halos, and the host's hover ghost and keyboard focus ring.
 * All sit above the pieces in draw order and never write depth.
 */
import {
  Group, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, RingGeometry, Sprite,
  SpriteMaterial, Vector3, type Object3D, type Texture,
} from 'three';
import type { PublicView, TileId } from '../../model';
import { boardIndex, edgeLine } from '../shared/board';
import type { BridgePick } from '../shared/bridge';
import { WATER } from './camera';
import { CORAL, CREAM, INK, LAND_TOP, ORDER, SEA_Y, SUN } from './constants';
import type { Ctx } from './context';
import { breathe } from './motion';
import { single, type PieceLayer } from './pieces';
import { SEAT_ROLES } from './materials';
import { classify, type Spots, watchSpots } from './spots';

const UP = new Vector3(0, 1, 0), RIM_IN = 0.84, RIM_OUT = 0.93;
type Mark = { pos: Vector3; yaw?: number; scale?: number };

export function createOverlays(ctx: Ctx, parent: Object3D) {
  const { scope, mats, tex } = ctx, group = new Group(), m = new Matrix4(), q = new Quaternion();
  parent.add(group);
  type Params = ConstructorParameters<typeof MeshBasicMaterial>[0];
  const material = (key: string, p: Params) => mats.once(key, () =>
    scope.own(new MeshBasicMaterial({ transparent: true, depthWrite: false, ...p })) as MeshBasicMaterial);
  const layer = (geometry: PlaneGeometry | RingGeometry, mat: MeshBasicMaterial, order = ORDER.highlight) => {
    const mesh = new InstancedMesh(scope.own(geometry.rotateX(-Math.PI / 2)), mat, 256);
    Object.assign(mesh, { count: 0, frustumCulled: false, renderOrder: order });
    group.add(mesh);
    return { mesh, mat };
  };
  const hexRing = (a: number, b: number) => new RingGeometry(a, b, 6, 1, Math.PI / 6);
  const inkRim = layer(hexRing(RIM_IN - 0.03, RIM_OUT + 0.015),
    material('rimInk', { color: INK, opacity: 0.55 }));
  const sunRim = layer(hexRing(RIM_IN, RIM_OUT), material('rimSun', { color: SUN }));
  const coralRim = layer(hexRing(RIM_IN, RIM_OUT), material('rimCoral', { color: CORAL }));
  const dots = layer(new PlaneGeometry(0.16, 0.16), material('dot', { map: tex.dot() }));
  const dashes = layer(new PlaneGeometry(0.2, 0.05), material('dash', { map: tex.dash() }));
  const halos = layer(new RingGeometry(0.24, 0.34, 40), material('halo', { color: CREAM }));
  const focus = layer(new RingGeometry(0.2, 0.28, 40), material('focus', { color: SUN }));
  const pins = new Group(), ghosts = new Map<string, Group>();
  group.add(pins);
  let scale = 1, active = { rims: false, spots: false, halos: false };
  let hoverable: { id: string; pos: Vector3; node: string; yaw: number }[] = [], me: number | null = null;

  const write = (target: { mesh: InstancedMesh }, marks: Mark[]) => {
    marks.slice(0, 256).forEach((mark, i) => target.mesh.setMatrixAt(i, m.compose(mark.pos,
      q.setFromAxisAngle(UP, mark.yaw ?? 0), new Vector3(1, 1, 1).multiplyScalar(mark.scale ?? 1))));
    target.mesh.count = Math.min(256, marks.length);
    target.mesh.instanceMatrix.needsUpdate = true;
  };

  function sync(view: PublicView, pieces: PieceLayer, pick: BridgePick, seat: number | null) {
    const index = boardIndex(view.board);
    const tileAt = (id: TileId, lift: number) => {
      const t = index.tiles.get(id)!, water = WATER.has(view.pieces.reveals[id]?.terrain ?? t.terrain);
      return new Vector3(t.x, (water ? SEA_Y + 0.01 : LAND_TOP) + lift, t.y);
    };
    const height = (tiles: TileId[]) =>
      tiles.some(t => !WATER.has(view.pieces.reveals[t]?.terrain ?? index.tiles.get(t)?.terrain ?? 'sea'))
        ? LAND_TOP : SEA_Y + 0.01;
    const vertexAt = (id: string) => {
      const v = index.vertices.get(id)!;
      return new Vector3(v.x, height(v.tiles) + 0.006, v.y);
    };
    const edgeAt = (id: string) => {
      const line = edgeLine(view.board, id)!, e = index.edges.get(id)!;
      return { pos: new Vector3(line.mid.x, height(e.tiles) + 0.006, line.mid.y), yaw: -line.angle };
    };

    // Robber and pirate choices: sun rims on legal hexes, coral on the current one, pins over victims.
    const choices = view.robberChoices, legal = new Set(choices.flatMap(c => c.tiles.map(t => t.tile)));
    const current = choices.map(c => view.pieces[c.piece]).filter((t): t is TileId => !!t);
    const spots: Spots = pick.spots.length ? classify(view.board, pick.spots) : watchSpots(view);
    spots.tiles.forEach(t => legal.add(t));
    const rims = [...legal].filter(t => index.tiles.has(t)).map(t => ({ pos: tileAt(t, 0.005) }));
    write(sunRim, rims);
    write(coralRim, current.map(t => ({ pos: tileAt(t, 0.006) })));
    write(inkRim, [...rims, ...current.map(t => ({ pos: tileAt(t, 0.004) }))]);
    pins.clear();
    const victims = new Map<string, number>();
    for (const c of choices) for (const t of c.tiles) for (const victim of t.victims) {
      const tile = index.tiles.get(t.tile)!;
      for (const b of Object.values(view.pieces.buildings)) {
        const v = index.vertices.get(b.vertex);
        if (b.seat !== victim || !v?.tiles.includes(tile.id)) continue;
        victims.set(b.vertex, view.seats.find(s => s.id === victim)?.seat ?? 0);
      }
    }
    for (const [vertex, s] of victims) {
      const sprite = new Sprite(mats.once(`pin${s}`, () =>
        scope.own(new SpriteMaterial({ map: tex.chip(s) as Texture, depthTest: false }))) as SpriteMaterial);
      const tall = view.pieces.buildings[vertex]?.kind === 'city' ? 0.84 : 0.62;
      sprite.position.copy(vertexAt(vertex)).setY(LAND_TOP + tall * scale);
      sprite.scale.setScalar(0.26);
      sprite.renderOrder = ORDER.highlight;
      pins.add(sprite);
    }

    // Placement spots: cream dots on corners, dashes on edges.
    write(dots, spots.vertices.map(id => ({ pos: vertexAt(id), scale })));
    write(dashes, spots.edges.map(id => ({ ...edgeAt(id), scale })));
    const spotCount = spots.vertices.length + spots.edges.length;
    active = { rims: legal.size + current.length > 0, spots: spotCount > 0, halos: false };

    // Spotlight: the active seat's buildings, only in Standard turn stages.
    const lit = view.settings.mode === 'standard' && ['roll', 'main'].includes(view.turn.stage);
    const owned = lit ? Object.values(view.pieces.buildings).filter(b => b.seat === view.turn.active) : [];
    write(halos, owned.map(b =>
      ({ pos: vertexAt(b.vertex).setY(LAND_TOP + 0.003), scale: pieces.footprint(b.vertex) / 0.22 })));
    active.halos = owned.length > 0;

    // Host picking: hover targets, the ghost's piece kind, and the keyboard focus ring.
    me = seat;
    hoverable = pick.onPick ? [
      ...spots.vertices.map(id => ({ id, pos: vertexAt(id), yaw: 0,
        node: view.pieces.buildings[id] ? 'city' : 'settlement' })),
      ...spots.edges.map(id => ({ id, ...edgeAt(id), node: index.edges.get(id)!.land ? 'road' : 'ship' })),
      ...spots.tiles.map(id => ({ id, pos: tileAt(id, 0), yaw: 0, node: 'robber' })),
    ] : [];
    const focused = hoverable.find(h => h.id === pick.focus);
    write(focus, focused ? [{ pos: focused.pos.clone().setY(focused.pos.y + 0.004), scale }] : []);
  }

  /** Ghost of the hovered spot in the host's colour at 70% opacity. */
  function hover(id: string | null) {
    ghosts.forEach(g => { g.visible = false; });
    const spot = hoverable.find(h => h.id === id);
    if (!spot || me === null) return;
    const seat = me, paint = (role: string) =>
      (SEAT_ROLES.has(role) ? mats.seat(seat, role === 'seat_dark', 0.7) : mats.faded(role, 0.7));
    const ghost = ghosts.get(spot.node) ?? single(ctx, spot.node, ORDER.highlight, part => paint(part.role));
    ghosts.set(spot.node, ghost);
    group.add(ghost);
    ghost.position.copy(spot.pos);
    ghost.rotation.y = spot.yaw;
    ghost.scale.setScalar(spot.node === 'robber' ? 1 : scale);
    ghost.visible = true;
  }

  /** Nearest hoverable spot within 0.25 wu of a board point. */
  const nearest = (x: number, z: number) => hoverable
    .map(h => ({ id: h.id, d: Math.hypot(h.pos.x - x, h.pos.z - z) }))
    .filter(h => h.d <= 0.25 * Math.max(1, scale)).sort((a, b) => a.d - b.d)[0]?.id ?? null;

  function frame(now: number, reduced: boolean) {
    if (active.rims) {
      sunRim.mat.opacity = breathe(now, 1200, 0.5, 1, reduced, 0.8);
      coralRim.mat.opacity = Math.max(0.85, sunRim.mat.opacity);
    }
    if (active.spots) dots.mat.opacity = dashes.mat.opacity = breathe(now, 1200, 0.7, 1, reduced, 0.9);
    if (active.halos) halos.mat.opacity = breathe(now, 1600, 0.25, 0.55, reduced, 0.45);
  }

  return {
    group, sync, hover, nearest, frame,
    setScale(next: number) { scale = next; },
    hoverable: () => hoverable.map(h => h.id),
  };
}
export type OverlayLayer = ReturnType<typeof createOverlays>;
