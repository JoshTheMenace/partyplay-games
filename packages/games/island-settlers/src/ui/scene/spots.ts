/**
 * Which spots the TV breathes while players watch (EXPERIENCE §2 legal-target glow): the phone's
 * `intent` targets when it sends one, otherwise the public setup rules (free corners by the
 * distance rule, then the edges next to the settlement just placed).
 */
import type { Board, EdgeId, PublicView, SetupInfo, TileId, VertexId } from '../../model';
import { boardIndex } from '../shared/board';
import { WATER } from './camera';

export type Spots = { vertices: VertexId[]; edges: EdgeId[]; tiles: TileId[] };
export const NO_SPOTS: Spots = { vertices: [], edges: [], tiles: [] };

/** Split mixed target ids by what they name on the board. */
export function classify(board: Board, ids: readonly string[]): Spots {
  const index = boardIndex(board);
  return {
    vertices: ids.filter(id => index.vertices.has(id)),
    edges: ids.filter(id => index.edges.has(id)),
    tiles: ids.filter(id => index.tiles.has(id)),
  };
}

type View = Pick<PublicView, 'board' | 'pieces'>;

const neighbours = (view: View, id: VertexId) => {
  const index = boardIndex(view.board);
  return (index.vertices.get(id)?.edges ?? []).map(e => index.edges.get(e)).filter(e => !!e)
    .map(e => (e.a === id ? e.b : e.a));
};

/** Unbuilt corners on real land that keep the distance rule. */
export function openCorners(view: View): VertexId[] {
  const index = boardIndex(view.board), built = view.pieces.buildings;
  const land = (t: TileId) => {
    const terrain = view.pieces.reveals[t]?.terrain ?? index.tiles.get(t)?.terrain;
    return !!terrain && terrain !== 'fog' && !WATER.has(terrain);
  };
  const onLand = (id: VertexId) => index.vertices.get(id)!.tiles.some(land);
  return view.board.vertices.map(v => v.id)
    .filter(id => !built[id] && onLand(id) && neighbours(view, id).every(n => !built[n]));
}

/** Free edges beside the placer's newest building (the one no route of theirs touches yet). */
export function setupRoutes(view: View, setup: SetupInfo): EdgeId[] {
  const index = boardIndex(view.board), routes = view.pieces.routes;
  const own = (e: EdgeId) => routes[e]?.seat === setup.seat;
  const fresh = Object.values(view.pieces.buildings).filter(b => b.seat === setup.seat)
    .map(b => index.vertices.get(b.vertex)!).filter(v => v && !v.edges.some(own));
  const fits = (e: EdgeId) =>
    !routes[e] && (setup.piece === 'ship' ? index.edges.get(e)?.sea : index.edges.get(e)?.land);
  return [...new Set(fresh.flatMap(v => v.edges).filter(fits))];
}

export function watchSpots(pub: PublicView): Spots {
  if (pub.intent) return classify(pub.board, pub.intent.targets);
  const setup = pub.turn.stage === 'setup' ? pub.turn.setup : null;
  if (!setup) return NO_SPOTS;
  const routes = setup.piece === 'road' || setup.piece === 'ship';
  return classify(pub.board, routes ? setupRoutes(pub, setup) : openCorners(pub));
}
