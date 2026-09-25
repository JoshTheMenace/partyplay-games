/**
 * Every piece on the board (EXPERIENCE §1.5, §2, §6): one keyed diff over the places from places.ts
 * and module-places.ts, drawn as one instanced batch per model. A piece keeps its slot while it
 * moves, so a changed spot glides, sails or hops there; a fresh build event drops it in. Like a
 * stage manager with a seating chart: only the actors whose seats changed get walked across.
 */
import {
  Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, type Object3D,
} from 'three';
import { FOOTPRINT } from '../../geometry';
import type { PublicView, TileId } from '../../model';
import { boardIndex } from '../shared/board';
import { SEATS } from '../shared/seats';
import type { Batch, Instance } from './batch';
import { ORDER } from './constants';
import type { Ctx } from './context';
import { modulePlaces } from './module-places';
import { clamp01, easeInOutSine, easeOut, easeOutBack, easeOutCubic, progress } from './motion';
import { corePlaces, edgePoint, tilePoint, vertexPoint, type Motion, type Place } from './places';

type Slot = { place: Place; pos: Vector3; born: number; path?: Vector3[]; moved?: number };
/** drops: spots of fresh build events; moves: ship edge → previous edge; paths: slot id → spots stepped. */
export type Cues = { drops: Set<string>; moves: Map<string, string>; paths: Map<string, string[]> };
export const NO_CUES: Cues = { drops: new Set(), moves: new Map(), paths: new Map() };

const UP = new Vector3(0, 1, 0), ROUTES = new Set(['road', 'ship', 'bridge']);
const MOVERS = new Set(['robber', 'pirate', 'merchant']);
/** Per-step duration, easing and arc height by motion (EXPERIENCE §6). */
const STEP: Record<Motion, { ms: number; ease: (t: number) => number; arc: number }> = {
  hop: { ms: 520, ease: easeInOutSine, arc: 0.6 }, sail: { ms: 700, ease: easeInOutSine, arc: 0 },
  step: { ms: 450, ease: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2), arc: 0.15 },
  roll: { ms: 450, ease: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2), arc: 0 },
  fixed: { ms: 1, ease: t => t, arc: 0 },
};
const orderOf = (node: string) =>
  (ROUTES.has(node) ? ORDER.route : MOVERS.has(node) ? ORDER.robber : ORDER.building);

/** A kit node as ordinary meshes (hover ghosts). */
export function single(ctx: Ctx, node: string, order: number, material = ctx.part): Group {
  const group = new Group();
  for (const part of ctx.kit.parts(node)) {
    if (part.role === 'decal') continue;
    const mesh = new Mesh(part.geometry, material(part));
    mesh.applyMatrix4(part.matrix);
    mesh.renderOrder = order;
    group.add(mesh);
  }
  return group;
}

const vec = (p: { x: number; y: number; h: number }) => new Vector3(p.x, p.h, p.y);
const same = (a: Place, b: Place) =>
  JSON.stringify([a.seat, a.yaw, a.hide, a.dark, a.tint, a.riders, a.stretch])
  === JSON.stringify([b.seat, b.yaw, b.hide, b.dark, b.tint, b.riders, b.stretch]);

/** Board point of a spot id at the height a piece of this place would stand. */
function spotAt(view: PublicView, id: string, place: Place) {
  const index = boardIndex(view.board), e = index.edges.get(id);
  const p = index.vertices.has(id) ? vertexPoint(view, id)
    : e ? edgePoint(view, id, e.sea && !e.land) : tilePoint(view, id);
  return p ? new Vector3(p.x, place.h, p.y) : null;
}

export function createPieces(ctx: Ctx, parent: Object3D) {
  const group = new Group(), slots = new Map<string, Slot>(), batches = new Map<string, Batch>();
  const bursts: { mesh: Mesh; born: number; material: MeshBasicMaterial }[] = [];
  const burstGeometry = ctx.scope.own(new RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2));
  let scale = 1, dirty = true, busy = false, last: PublicView | null = null;
  let rising = { tiles: new Set<TileId>() as ReadonlySet<TileId>, lift: 0 };
  parent.add(group);
  const batch = (node: string) =>
    batches.get(node) ?? batches.set(node, ctx.batch(node, group, orderOf(node))).get(node)!;

  function sync(view: PublicView, now: number, cues: Cues) {
    last = view;
    const places = [...corePlaces(view, scale), ...modulePlaces(view)];
    const byId = new Map(places.map(p => [p.id, p]));
    const before = new Map([...slots].map(([id, slot]) => [id, slot.pos]));
    for (const [id, slot] of slots) {
      if (byId.get(id)?.node !== slot.place.node) { slots.delete(id); dirty = true; }
    }
    for (const place of places) {
      const old = slots.get(place.id), pos = vec(place);
      if (!old) {
        const from = cues.moves.get(place.id), start = from ? before.get(from) : undefined;
        const slot: Slot = { place, pos, born: -Infinity };
        if (start) Object.assign(slot, { path: [start, pos], moved: now });
        else if (cues.drops.has(place.spot)) { slot.born = now; burst(slot, now); }
        slots.set(place.id, slot);
        dirty = true;
        continue;
      }
      if (!old.pos.equals(pos) && place.motion !== 'fixed') {
        const via = place.via && old.place.step! < place.step!
          ? place.via.slice(old.place.step, place.step! + 1).map(p => new Vector3(p.x, place.h, p.y)) : null;
        const steps = (cues.paths.get(place.id) ?? []).slice(0, -1).flatMap(s => spotAt(view, s, place) ?? []);
        old.path = via ?? [old.pos, ...steps, pos];
        old.moved = now;
      } else if (!old.pos.equals(pos)) old.path = undefined;
      if (!old.pos.equals(pos) || !same(old.place, place)) dirty = true;
      Object.assign(old, { place, pos });
    }
  }

  function burst(slot: Slot, now: number) {
    const material = ctx.scope.own(new MeshBasicMaterial({
      color: SEATS[slot.place.seat % SEATS.length].body, transparent: true, depthWrite: false,
    }));
    const mesh = new Mesh(burstGeometry, material);
    mesh.position.copy(slot.pos).setY(slot.pos.y + 0.004);
    mesh.renderOrder = ORDER.highlight;
    group.add(mesh);
    bursts.push({ mesh, born: now, material });
  }

  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3(), r = new Matrix4();
  /** Position along a slot's path at `now`; false once it has arrived. */
  function travel(slot: Slot, now: number, reduced: boolean) {
    const path = slot.path!, step = STEP[slot.place.motion], legs = path.length - 1;
    const t = reduced ? 1 : clamp01((now - slot.moved!) / (step.ms * legs));
    const leg = Math.min(legs - 1, Math.floor(t * legs));
    const local = t * legs - leg, k = step.ease(local);
    p.lerpVectors(path[leg], path[leg + 1], k);
    p.y += step.arc * Math.sin(Math.PI * local);
    if (t >= 1) slot.path = undefined;
    return t < 1;
  }

  function frame(now: number, reduced: boolean) {
    const animate = busy;
    busy = false;
    if (!dirty && !animate && !bursts.length) return;
    const byNode = new Map<string, Instance[]>();
    const add = (node: string, inst: Instance) => byNode.set(node, [...(byNode.get(node) ?? []), inst]);
    for (const slot of slots.values()) {
      const { place } = slot, route = ROUTES.has(place.node), age = now - slot.born;
      p.copy(slot.pos);
      if (slot.path) busy = travel(slot, now, reduced) || busy;
      const t = reduced ? 1 : clamp01(age / (route ? 320 : 420));
      busy ||= !reduced && age < 480;
      if (!slot.path && !route) p.y += 0.8 * (1 - easeOutBack(t, 1.4));
      if (place.tile && rising.tiles.has(place.tile)) p.y += rising.lift;
      const k = place.scaled ? scale : 1, grow = route && !slot.path ? Math.max(0.001, easeOutCubic(t)) : 1;
      s.set(grow * (place.stretch ?? 1) * k, Math.min(k, place.upright ?? k), k);
      m.compose(p, q.setFromAxisAngle(UP, place.yaw), s);
      const look = { seat: place.seat, dark: place.dark, tint: place.tint, hide: new Set(place.hide ?? []) };
      if (place.node) add(place.node, { matrix: m.clone(), ...look });
      for (const rider of place.riders ?? []) {
        const matrix = m.clone().multiply(r.makeTranslation(rider.dx, rider.dh, rider.dy))
          .multiply(r.makeScale(rider.size ?? 1, rider.size ?? 1, rider.size ?? 1));
        add(rider.node, { matrix, seat: rider.seat, tint: rider.tint });
      }
    }
    if (dirty || busy || animate) {
      for (const node of new Set([...batches.keys(), ...byNode.keys()])) {
        batch(node).write(byNode.get(node) ?? []);
      }
      dirty = false;
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], t = progress(now, b.born, 480), radius = 0.2 + 0.4 * easeOut(t);
      b.mesh.scale.setScalar(radius * scale);
      b.material.opacity = 0.9 * (1 - t);
      if (t < 1 && !reduced) continue;
      b.mesh.removeFromParent();
      b.material.dispose();
      bursts.splice(i, 1);
    }
  }

  return {
    group, sync, frame,
    setScale(next: number) {
      if (next === scale) return;
      scale = next;
      dirty = true;
      if (last) sync(last, 0, NO_CUES);
    },
    /** Revealed fog tiles rising (EXPERIENCE §1.3): landmarks on them follow the land. */
    rise(tiles: ReadonlySet<TileId>, lift: number) {
      if (!tiles.size && !rising.tiles.size) return;
      rising = { tiles, lift };
      dirty = true;
    },
    /** Footprint radius of whatever stands at a vertex, for the spotlight halo. */
    footprint: (vertex: string) => scale
      * (/city|metropolis/.test(slots.get(vertex)?.place.node ?? '') ? FOOTPRINT.city : FOOTPRINT.settlement),
  };
}
export type PieceLayer = ReturnType<typeof createPieces>;
