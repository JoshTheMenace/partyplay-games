/**
 * "Sail toward new land": a ship build pre-filtered to the edges that bring the seat closer to
 * land it has not settled (other islands, fog). Phones see it as a shortcut in the Ships group;
 * the generic CPU uses it (by `hint`) to leave a crowded home island.
 */
import { COSTS, type Command, type EdgeId, type SeatId, type VertexId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { build } from '../../build';
import { cardsText } from '../../cards';
import { choice, command, pickField } from '../../commands';
import { face, isLandTile, purchaseWhy, targets } from '../../legal';
import type { State } from '../../state';

export const SAIL = 'seafarers/sail';
const REACH = 14;

/** Free corners (distance rule) on land outside the seat's home islands, or touching fog. */
function goals(s: State, home: number[]): VertexId[] {
  const ix = boardIndex(s.board), b = s.pieces.buildings;
  const open = (v: VertexId) => !b[v] && (ix.vertexNeighbors.get(v) ?? []).every(n => !b[n]);
  const fresh = (t: string) => (s.hidden[t] && !s.pieces.reveals[t])
    || (isLandTile(s, t) && !home.includes(ix.tile.get(t)?.island ?? -1));
  return s.board.vertices.filter(v => open(v.id) && v.tiles.some(fresh)).map(v => v.id);
}

/** Sea-edge steps from every goal corner, never through another seat's route or building. */
function distances(s: State, seat: SeatId, from: VertexId[]): Map<VertexId, number> {
  const ix = boardIndex(s.board), dist = new Map(from.map(v => [v, 0])), queue = [...from];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i], d = dist.get(v)!, owner = s.pieces.buildings[v]?.seat;
    if (d >= REACH || (owner && owner !== seat)) continue;
    for (const w of ix.vertexNeighbors.get(v) ?? []) {
      const e = ix.edge.get(ix.edgeBetween.get(`${v} ${w}`)!)!, r = s.pieces.routes[e.id];
      const sea = e.tiles.some(t => face(s, t).terrain === 'sea');
      if (dist.has(w) || !sea || (r && r.seat !== seat)) continue;
      dist.set(w, d + 1);
      queue.push(w);
    }
  }
  return dist;
}

export function sailCommand(s: State, seat: SeatId, home: number[]): Command | null {
  if (purchaseWhy(s, seat, 'ship')) return null;
  const ix = boardIndex(s.board), dist = distances(s, seat, goals(s, home));
  const d = (v: VertexId) => dist.get(v) ?? Infinity;
  const toward = targets(s, seat, 'ship').map(id => ix.edge.get(id)!)
    .filter(e => d(e.a) !== d(e.b) && Math.min(d(e.a), d(e.b)) < Infinity)
    .sort((x, y) => Math.min(d(x.a), d(x.b)) - Math.min(d(y.a), d(y.b)));
  if (!toward.length) return null;
  type Ends = { a: VertexId; b: VertexId };
  const left = (e: Ends) => Math.min(d(e.a), d(e.b));
  const detail = (e: Ends) => (left(e) ? `${left(e)} more to new land` : 'Reaches new land');
  const options = toward.map(e => choice(e.id, 'Ship', detail(e)));
  const land = targets(s, seat, 'settlement').length > 0, free = s.seats[seat].freeRoutes > 0;
  return command({
    id: SAIL, module: 'seafarers', group: 'ships', label: 'Sail toward new land',
    detail: `Build a ship toward unsettled land (${free ? 'free' : cardsText(COSTS.ship)})`,
    fields: [pickField('at', 'Ship', options, 'edge')], hint: land && left(toward[0]) > 2 ? 0.3 : 0.75,
  });
}

export const sail = (s: State, seat: SeatId, at: EdgeId) => build(s, seat, 'ship', at);
