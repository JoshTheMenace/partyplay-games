/**
 * Turns server target ids (BuildOption.targets, PickField options, ShipMove lists) into map spots.
 * The kind is found by looking the id up on the board, so callers never have to say what it is.
 */
import { corners, ROBBER_OFFSET, type Point } from '../../geometry';
import type { PublicView, SeatId, TileId, Unit } from '../../model';
import { boardIndex, edgeLabel, edgeLine, tileDetail, tileFace, vertexLabel } from '../shared/board';
import { CARGO_LABEL, PIECE_LABEL } from '../shared/labels';
import { nameOf, seatOf } from '../shared/seats';

export type SpotKind = 'vertex' | 'edge' | 'tile' | 'unit';
export type Spot = { id: string; kind: SpotKind; at: Point; occupied: boolean };
type MapView = Pick<PublicView, 'board' | 'pieces'>;

/** Direction of the robber from a hex centre: toward the north-west edge midpoint. */
const NW = { x: -Math.cos(Math.PI / 3), y: -Math.sin(Math.PI / 3) };
export const robberPoint = (c: Point, offset = ROBBER_OFFSET) => ({ x: c.x + NW.x * offset, y: c.y + NW.y * offset });
export const merchantPoint = (c: Point, offset = ROBBER_OFFSET) =>
  ({ x: c.x - NW.x * offset, y: c.y - NW.y * offset });

/** Where a unit stands: its vertex (lifted above a building there), edge midpoint or tile. */
export function unitPoint(view: MapView, unit: Unit): Point | null {
  const index = boardIndex(view.board), vertex = index.vertices.get(unit.at);
  if (vertex) return view.pieces.buildings[unit.at] ? { x: vertex.x, y: vertex.y - 0.38 } : vertex;
  const edge = edgeLine(view.board, unit.at);
  if (edge) return edge.mid;
  const tile = index.tiles.get(unit.at);
  return tile ? { x: tile.x + 0.42, y: tile.y + 0.3 } : null;
}

export function resolveSpot(view: MapView, id: string): Spot | null {
  const index = boardIndex(view.board), { pieces } = view;
  const vertex = index.vertices.get(id);
  if (vertex) return { id, kind: 'vertex', at: vertex, occupied: !!pieces.buildings[id] };
  const edge = edgeLine(view.board, id);
  if (edge) return { id, kind: 'edge', at: edge.mid, occupied: !!pieces.routes[id] };
  const tile = index.tiles.get(id);
  if (tile) return { id, kind: 'tile', at: tile, occupied: false };
  const unit = pieces.units[id], at = unit && unitPoint(view, unit);
  return at ? { id, kind: 'unit', at, occupied: true } : null;
}

export const resolveSpots = (view: MapView, ids: readonly string[]) =>
  ids.map(id => resolveSpot(view, id)).filter((s): s is Spot => !!s);

/** Seats with a building on one of the tile's corners. */
export function tileOwners(view: MapView, tile: TileId): SeatId[] {
  const seats = new Set<SeatId>();
  for (const v of view.board.vertices) {
    const b = v.tiles.includes(tile) ? view.pieces.buildings[v.id] : undefined;
    if (b) seats.add(b.seat);
  }
  return [...seats];
}

/** Robber victims for a tile from the public robber choice of `seat` (or the only open one). */
export function victimsAt(pub: PublicView, tile: TileId, seat: SeatId | null) {
  const choice = pub.robberChoices.find(c => c.seat === seat) ?? pub.robberChoices[0];
  return choice?.tiles.find(t => t.tile === tile)?.victims ?? [];
}

const unitLabel = (pub: PublicView, unit: Unit) => {
  const owner = unit.seat ? `${nameOf(pub, unit.seat)}'s ` : '';
  const cargo = unit.cargo.length ? ` carrying ${unit.cargo.map(c => CARGO_LABEL[c].toLowerCase()).join(', ')}` : '';
  const level = unit.kind === 'knight' || unit.kind === 'guard' ? ` level ${unit.level}` : '';
  const state = unit.kind === 'knight' ? (unit.active ? ', active' : ', inactive') : '';
  return `${owner}${PIECE_LABEL[unit.kind].toLowerCase()}${level}${state}${cargo}`;
};

/** Spoken label for a hotspot: "Corner by Forest 6, Hills 8, 3:1 harbour", "Hills 8 (5 pips). Rob Bo · 5". */
export function spotLabel(pub: PublicView, spot: Spot, seat: SeatId | null): string {
  const { pieces } = pub;
  if (spot.kind === 'vertex') {
    const b = pieces.buildings[spot.id], own = b ? `${b.seat === seat ? 'Your' : `${nameOf(pub, b.seat)}'s`} ` : '';
    return b ? `${own}${PIECE_LABEL[b.kind].toLowerCase()}, ${vertexLabel(pub, spot.id).toLowerCase()}`
      : vertexLabel(pub, spot.id);
  }
  if (spot.kind === 'edge') {
    const r = pieces.routes[spot.id];
    return r ? `${r.seat === seat ? 'Your' : `${nameOf(pub, r.seat)}'s`} ${r.kind}, ${edgeLabel(pub, spot.id)
      .toLowerCase()}` : edgeLabel(pub, spot.id);
  }
  if (spot.kind === 'unit') return unitLabel(pub, pieces.units[spot.id]);
  const victims = victimsAt(pub, spot.id, seat);
  const rob = victims.length
    ? `Rob ${victims.map(v => `${nameOf(pub, v)} · ${seatOf(pub, v)?.cards ?? 0}`).join(', ')}` : 'Nobody to rob';
  const yours = seat && tileOwners(pub, spot.id).includes(seat) ? '. Yours too' : '';
  return pub.robberChoices.length ? `${tileDetail(pub, spot.id)}. ${rob}${yours}` : tileDetail(pub, spot.id);
}

/**
 * Confirm-sheet detail for a corner: "Corner: Forest 6 (5 pips), Hills 8 (5), Pasture 3 (2). 3:1 harbour".
 * Edges and tiles fall back to their spot label.
 */
export function spotDetail(pub: PublicView, id: string, seat: SeatId | null = null): string {
  const spot = resolveSpot(pub, id);
  if (!spot) return '';
  if (spot.kind !== 'vertex') return spotLabel(pub, spot, seat);
  const index = boardIndex(pub.board), vertex = index.vertices.get(id)!, port = index.ports.get(id);
  const land = vertex.tiles.filter(t => index.tiles.get(t)?.terrain !== 'sea');
  const parts = land.map((t, i) => {
    const text = tileDetail(pub, t);
    return i ? text.replace(/ pips?\)/, ')') : text;
  });
  const harbour = port ? `. ${port.good === 'any' ? '3:1' : `2:1 ${port.good}`} harbour` : '';
  return `Corner: ${parts.join(', ') || 'open sea'}${harbour}`;
}

/** Hex outline points at a radius, as an SVG points string. */
export const hexPoints = (c: Point, radius: number) =>
  corners(c, radius).map(p => `${round(p.x)},${round(p.y)}`).join(' ');

export const round = (n: number) => Math.round(n * 1000) / 1000;

/** Tiles whose number matches the last roll (the ones that glow on the mini map). */
export function rolledTiles(view: MapView & Pick<PublicView, 'lastRoll'>) {
  const total = view.lastRoll?.total;
  if (!total || total === 7) return [];
  return view.board.tiles.filter(t => tileFace(view, t.id).number === total).map(t => t.id);
}
