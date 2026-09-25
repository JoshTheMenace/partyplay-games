/**
 * Where every piece stands (EXPERIENCE §1.5): pure plan-view math, no three.js, so the scene and the
 * token-coverage test read the same numbers. Buildings, routes, robber and pirate live here; module
 * units and landmarks come from module-places.ts. Think of it as the seating chart the 3D layer
 * follows: it says which model goes where, never how it is drawn.
 */
import { FOOTPRINT, ROBBER_OFFSET, distance, type Point } from '../../geometry';
import type { Building, EdgeId, PublicView, TileId, VertexId } from '../../model';
import { boardIndex, edgeLine, tileFace } from '../shared/board';
import { WATER } from './camera';
import { LAND_TOP, PIRATE_OFFSET, ROBBER_DIR, SEA_Y } from './constants';

/** How a piece moves when its spot changes (EXPERIENCE §6). */
export type Motion = 'hop' | 'sail' | 'step' | 'roll' | 'fixed';
/** A small model riding on a place (cargo in a ship, crews on a lair); offsets are local wu. */
export type Rider = {
  node: string; seat: number; dx: number; dy: number; dh: number; tint?: string; size?: number;
};
export type Place = {
  /** Slot key: the same piece keeps its id while it moves. */
  id: string;
  /** Kit node, or '' for riders only. */
  node: string;
  seat: number;
  x: number; y: number; h: number; yaw: number;
  /** Player pieces take pieceScale; the robber, pirate, merchant and neutral landmarks never do. */
  scaled: boolean;
  /** Board spot it stands on, matched against build events for the drop. */
  spot: string;
  motion: Motion;
  /** Road length factor after trimming around neighbouring buildings. */
  stretch?: number;
  /** Largest vertical pieceScale (the metropolis keep would reach a token north of it at 1.2). */
  upright?: number;
  hide?: string[]; dark?: boolean; tint?: string; riders?: Rider[];
  /** Tile-anchored landmarks rise with a revealed fog tile. */
  tile?: TileId;
  /** Waypoints it travels along (barbarian ship track) and its index there. */
  via?: Point[]; step?: number;
};

/** Plan boxes [w, d, h] before pieceScale, for halos and the token-coverage test. */
export const BOXES: Record<string, readonly [number, number, number]> = {
  settlement: [0.34, 0.3, 0.38], harbor: [0.4, 0.34, 0.46], city: [0.58, 0.42, 0.6],
  metropolis: [0.58, 0.42, 0.78], wall: [0.76, 0.76, 0.09], road: [0.54, 0.12, 0.1], ship: [0.53, 0.18, 0.46],
  bridge: [0.4, 0.16, 0.12], robber: [0.34, 0.34, 0.6], pirate: [0.62, 0.22, 0.62], merchant: [0.28, 0.28, 0.4],
  knight: [0.4, 0.4, 0.52], wagon: [0.41, 0.2, 0.26], invader: [0.18, 0.12, 0.22], camel: [0.34, 0.14, 0.26],
  castle: [1, 0.9, 0.95], depot: [0.68, 0.68, 0.51], council: [0.62, 0.62, 0.5], lair: [0.76, 0.7, 0.42],
  barbarian_ship: [0.9, 0.28, 0.6], settler: [0.1, 0.1, 0.14], crew: [0.1, 0.1, 0.14],
  crate_fish: [0.1, 0.1, 0.1], sack_spice: [0.1, 0.1, 0.1], crate: [0.1, 0.1, 0.1],
};
/** Round footprints (radius = w / 2), so the coverage test does not use their box corners. */
export const ROUND = new Set(['robber', 'merchant', 'knight', 'wall', 'invader', 'settler', 'crew']);
export const kindOf = (node: string) =>
  node.replace(/_(\d|science|trade|politics|castle|quarry|glassworks)$/, '');
export const boxOf = (node: string) => BOXES[kindOf(node)] ?? BOXES[node] ?? [0.3, 0.3, 0.3];

const ROAD_HALF = 0.06 + 0.014, OUT = 0.15;
/** The merchant mirrors the robber to the north-east, so neither stands south of a token. */
export const MERCHANT_DIR = { x: -ROBBER_DIR.x, y: ROBBER_DIR.y };

type View = Pick<PublicView, 'board' | 'pieces'>;
const terrainOf = (view: View, t: TileId) => tileFace(view, t).terrain;
export const landTouch = (view: View, tiles: TileId[]) => tiles.some(t => !WATER.has(terrainOf(view, t)));
export const isWater = (view: View, t: TileId) => WATER.has(terrainOf(view, t));

/** Keep a yaw within ±90° so sails and emblems face the camera; pieces along +X are symmetric. */
export const facing = (yaw: number) => {
  const a = ((yaw % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a > Math.PI / 2 ? a - Math.PI : a <= -Math.PI / 2 ? a + Math.PI : a;
};

export function vertexPoint(view: View, id: VertexId) {
  const v = boardIndex(view.board).vertices.get(id);
  return v ? { x: v.x, y: v.y, h: landTouch(view, v.tiles) ? LAND_TOP : SEA_Y } : null;
}

export function tilePoint(view: View, id: TileId) {
  const t = boardIndex(view.board).tiles.get(id);
  return t ? { x: t.x, y: t.y, h: isWater(view, id) ? SEA_Y : LAND_TOP } : null;
}

/** Edge midpoint and yaw; ships sit OUT wu toward the sea on coast edges (half inside the land otherwise). */
export function edgePoint(view: View, id: EdgeId, sea: boolean) {
  const line = edgeLine(view.board, id), e = boardIndex(view.board).edges.get(id);
  if (!line || !e) return null;
  let { x, y } = line.mid;
  const water = sea && landTouch(view, e.tiles)
    ? e.tiles.map(t => boardIndex(view.board).tiles.get(t)).find(t => t && isWater(view, t.id)) : null;
  if (water) {
    const n = distance(line.mid, water) || 1;
    x += ((water.x - x) / n) * OUT;
    y += ((water.y - y) / n) * OUT;
  }
  return { x, y, h: sea ? SEA_Y : LAND_TOP, yaw: facing(-line.angle), line };
}

/** Distance from a building's vertex along direction (c, s) where a road of half-width w clears it. */
function clearance(b: Building | undefined, c: number, s: number, scale: number) {
  if (!b) return 0;
  const w = ROAD_HALF * scale, ring = (r: number) => Math.sqrt(Math.max(0, (r * scale) ** 2 - w * w));
  if (b.wall) return ring(0.39);
  if (b.kind !== 'city') return ring(b.kind === 'harbor' ? 0.23 : FOOTPRINT.settlement + 0.01);
  const X = 0.3 * scale, Z = 0.22 * scale, ax = Math.abs(c), az = Math.abs(s);
  const out = (x: number, z: number) => Math.abs(x) >= X || Math.abs(z) >= Z;
  for (let d = 0; d < 0.6; d += 0.005) {
    if (out(d * ax - w * az, d * az + w * ax) && out(d * ax + w * az, d * az - w * ax)) return d;
  }
  return 0.6;
}

/** A road trimmed (and nudged) so it never overlaps the plinths at either end. */
function roadSpan(view: View, id: EdgeId, scale: number) {
  const p = edgePoint(view, id, false), e = boardIndex(view.board).edges.get(id);
  if (!p || !e) return null;
  const { a, b } = p.line, L = distance(a, b), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
  const ga = clearance(view.pieces.buildings[e.a], c, s, scale);
  const gb = clearance(view.pieces.buildings[e.b], c, s, scale);
  const want = BOXES.road[0] * scale, start = Math.max(ga, Math.min((L - want) / 2, L - gb - want));
  const end = Math.min(L - gb, start + want), mid = (start + end) / 2;
  return { ...p, x: a.x + c * mid, y: a.y + s * mid, stretch: Math.max(0.2, (end - start) / want) };
}

/** Buildings (walls under cities, metropolises in place of cities), routes, robber and pirate. */
export function corePlaces(view: PublicView, scale: number): Place[] {
  const seatOf = new Map(view.seats.map(s => [s.id, s.seat])), out: Place[] = [];
  for (const b of Object.values(view.pieces.buildings)) {
    const p = vertexPoint(view, b.vertex), seat = seatOf.get(b.seat) ?? 0;
    if (!p) continue;
    const node = b.metropolis ? `metropolis_${b.metropolis}` : b.kind;
    const base = { ...p, seat, yaw: 0, scaled: true, spot: b.vertex, motion: 'fixed' as const };
    out.push({ ...base, id: b.vertex, node, upright: b.metropolis ? 0.95 : undefined });
    if (b.wall) out.push({ ...base, id: `wall:${b.vertex}`, node: 'wall' });
  }
  for (const r of Object.values(view.pieces.routes)) {
    const seat = seatOf.get(r.seat) ?? 0, ship = r.kind === 'ship';
    const span = ship || r.bridge ? null : roadSpan(view, r.edge, scale);
    const p = span ?? edgePoint(view, r.edge, ship);
    if (!p) continue;
    out.push({
      id: r.edge, node: r.bridge ? 'bridge' : r.kind, seat, x: p.x, y: p.y, h: p.h, yaw: p.yaw,
      stretch: span?.stretch, scaled: true, spot: r.edge, motion: ship ? 'sail' : 'fixed',
    });
  }
  for (const piece of ['robber', 'pirate'] as const) {
    const t = view.pieces[piece], p = t ? tilePoint(view, t) : null;
    const off = piece === 'pirate' ? PIRATE_OFFSET : ROBBER_OFFSET;
    if (!p || !t) continue;
    out.push({
      id: piece, node: piece, seat: 0, x: p.x + ROBBER_DIR.x * off, y: p.y + ROBBER_DIR.y * off,
      h: piece === 'pirate' ? SEA_Y : LAND_TOP, yaw: 0, scaled: false, spot: t, motion: 'hop',
    });
  }
  return out;
}
