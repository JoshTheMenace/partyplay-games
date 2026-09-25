/** Rivers bridges: sites on river edges, 3 per seat, each one of the seat's 15 roads. */
import type { EdgeId, SeatId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { emit } from '../../events';
import { piecesLeft } from '../../legal';
import { placeRoute } from '../../pieces';
import { seatName, type State } from '../../state';
import { hooks, type PlacedPiece } from '../registry';

export const BRIDGE_COST = { brick: 2, wood: 1 };
export const MAX_BRIDGES = 3;

export const siteSet = (s: State) =>
  new Set(s.board.features.flatMap(f => (f.kind === 'bridge-site' ? [f.edge] : [])));

/** Empty bridge sites joined to the seat's road or building (never past an opponent's building). */
export function bridgeSites(s: State, seat: SeatId): EdgeId[] {
  const ix = boardIndex(s.board), { buildings, routes } = s.pieces;
  const mine = Object.values(routes).filter(r => r.seat === seat && r.bridge).length;
  if (mine >= MAX_BRIDGES || piecesLeft(s, seat, 'road') <= 0) return [];
  const joins = (v: string) => (buildings[v] ? buildings[v].seat === seat
    : (ix.vertex.get(v)?.edges ?? []).some(e => routes[e]?.seat === seat));
  return [...siteSet(s)].filter(e => !routes[e] && [ix.edge.get(e)!.a, ix.edge.get(e)!.b].some(joins));
}

/** Place a bridge like any build: the `build` event, then every module's onBuild hook. */
export function placeBridge(s: State, seat: SeatId, edge: EdgeId) {
  const placed: PlacedPiece = { kind: 'route', piece: { edge, seat, kind: 'road', bridge: true } };
  placeRoute(s, placed.piece);
  const text = `${seatName(s, seat)} built a bridge`;
  emit(s, { kind: 'build', seat, piece: 'bridge', spot: edge, free: false, text });
  for (const m of hooks(s, 'onBuild')) m.onBuild(s, seat, placed);
}
