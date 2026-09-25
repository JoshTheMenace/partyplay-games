/** Client-side board lookups and spoken labels, cached per Board object (boards never change in a round). */
import { angle, bounds, midpoint, pips, type Point } from '../../geometry';
import type {
  Board, Bounds, Edge, EdgeId, Port, PublicView, Tile, TileId, Vertex, VertexId,
} from '../../model';
import { GOOD_META, TERRAIN_META } from './labels';

export type BoardIndex = {
  tiles: Map<TileId, Tile>;
  vertices: Map<VertexId, Vertex>;
  edges: Map<EdgeId, Edge>;
  /** Port touching each vertex. */
  ports: Map<VertexId, Port>;
  /** Land (including fog) plus one hex radius: the box the camera and the map fit. */
  land: Bounds;
};

const cache = new WeakMap<Board, BoardIndex>();

export function boardIndex(board: Board): BoardIndex {
  const hit = cache.get(board);
  if (hit) return hit;
  const land = board.tiles.filter(t => t.terrain !== 'sea');
  const index: BoardIndex = {
    tiles: new Map(board.tiles.map(t => [t.id, t])),
    vertices: new Map(board.vertices.map(v => [v.id, v])),
    edges: new Map(board.edges.map(e => [e.id, e])),
    ports: new Map(board.ports.flatMap(p => p.vertices.map(v => [v, p] as const))),
    land: land.length ? bounds(land) : board.bounds,
  };
  cache.set(board, index);
  return index;
}

/** Endpoints, midpoint and angle of an edge, or null for an unknown id. */
export function edgeLine(board: Board, id: EdgeId): { a: Point; b: Point; mid: Point; angle: number } | null {
  const index = boardIndex(board), edge = index.edges.get(id);
  const a = edge && index.vertices.get(edge.a), b = edge && index.vertices.get(edge.b);
  return a && b ? { a, b, mid: midpoint(a, b), angle: angle(a, b) } : null;
}

type MapView = Pick<PublicView, 'board' | 'pieces'>;

/** Terrain and number as players see them: fog shows its reveal once discovered. */
export function tileFace(view: MapView, id: TileId) {
  const tile = boardIndex(view.board).tiles.get(id), reveal = view.pieces.reveals[id];
  return { terrain: reveal?.terrain ?? tile?.terrain ?? 'sea', number: reveal?.number ?? tile?.number ?? 0 };
}

/** "Forest 6", "Desert". */
export function tileLabel(view: MapView, id: TileId) {
  const { terrain, number } = tileFace(view, id);
  return number ? `${TERRAIN_META[terrain].label} ${number}` : TERRAIN_META[terrain].label;
}

/** "Forest 6 (5 pips)". */
export const tileDetail = (view: MapView, id: TileId) => {
  const n = pips(tileFace(view, id).number);
  return n ? `${tileLabel(view, id)} (${n} pip${n === 1 ? '' : 's'})` : tileLabel(view, id);
};

export const portLabel = (port: Port) =>
  port.good === 'any' ? '3:1 harbour' : `2:1 ${GOOD_META[port.good].label.toLowerCase()} harbour`;

const landTiles = (view: MapView, ids: TileId[]) => ids.filter(id => tileFace(view, id).terrain !== 'sea');

/** Hotspot label: "Corner by Forest 6, Hills 8, 3:1 harbour". */
export function vertexLabel(view: MapView, id: VertexId) {
  const index = boardIndex(view.board), vertex = index.vertices.get(id), port = index.ports.get(id);
  const tiles = landTiles(view, vertex?.tiles ?? []).map(t => tileLabel(view, t));
  const parts = [...(tiles.length ? tiles : ['open sea']), ...(port ? [portLabel(port)] : [])];
  return `Corner by ${parts.join(', ')}`;
}

/** "Path by Forest 6 and Hills 8", "Coast by Fields 9", "Sea lane by open water". */
export function edgeLabel(view: MapView, id: EdgeId) {
  const edge = boardIndex(view.board).edges.get(id);
  const kind = edge?.sea && !edge.land ? 'Sea lane' : edge?.sea ? 'Coast' : 'Path';
  const tiles = landTiles(view, edge?.tiles ?? []).map(t => tileLabel(view, t));
  return `${kind} by ${tiles.length ? tiles.join(' and ') : 'open water'}`;
}
