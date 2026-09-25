/**
 * Sailing (E&P rulebook "Move ships", "Pay tribute", "Explore hexes"): ships move along sea hex
 * edges, never onto an edge of an unexplored hex; reaching an edge whose corner touches fog
 * discovers that hex and ends the move. At most 2 ships may end on one edge; passing is free.
 * Moving onto, off or around an opponent's pirate hex costs 1 gold per ship per turn.
 */
import { RESOURCES, type EdgeId, type Resource, type SeatId, type TileId, type Unit } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { transfer } from '../../cards';
import { emit } from '../../events';
import { reveal } from '../../pieces';
import { gained } from '../../stats';
import { seatName, type State } from '../../state';
import {
  addCoins, benefits, BASE_MOVES, coins, ext, isFog, isWater, shipsOn, voyage,
} from './state';

/** Sea hex edges with no unexplored hex on them, and those of them touching fog at a corner. */
type Chartable = { size: number; open: Set<EdgeId>; shore: EdgeId[] };
const charts = new WeakMap<object, Chartable>();

/** Cached per reveal set: the board never changes and reveals only grow (or are replaced). */
function sea(s: State): Chartable {
  const key = s.pieces.reveals, size = Object.keys(key).length, known = charts.get(key);
  if (known?.size === size) return known;
  const open = new Set(s.board.edges.filter(e => e.tiles.some(t => isWater(s, t)) && !e.tiles.some(t => isFog(s, t)))
    .map(e => e.id));
  const next = { size, open, shore: [...open].filter(e => fogNear(s, e).length) };
  charts.set(key, next);
  return next;
}

export const navigable = (s: State, e: EdgeId) => sea(s).open.has(e);
/** Explored sea edges where a ship would discover fog. */
export const shoreline = (s: State) => sea(s).shore;

/** Unexplored hexes at either corner of `e` (a ship stopping here discovers them). */
export function fogNear(s: State, e: EdgeId): TileId[] {
  const ix = boardIndex(s.board), edge = ix.edge.get(e);
  const tiles = edge ? [edge.a, edge.b].flatMap(v => ix.vertex.get(v)?.tiles ?? []) : [];
  return [...new Set(tiles)].filter(t => isFog(s, t));
}

const links = new WeakMap<object, Map<EdgeId, EdgeId[]>>();

/** Edges sharing a corner with `e` (cached per immutable board). */
export function nextEdges(s: State, e: EdgeId): EdgeId[] {
  let all = links.get(s.board);
  if (!all) {
    const ix = boardIndex(s.board);
    all = new Map(s.board.edges.map(x => [x.id, [x.a, x.b].flatMap(v => ix.vertex.get(v)!.edges)
      .filter(y => y !== x.id)]));
    links.set(s.board, all);
  }
  return all.get(e) ?? [];
}

const touchesPirate = (s: State, e: EdgeId) =>
  !!s.pieces.pirate && !!boardIndex(s.board).edge.get(e)?.tiles.includes(s.pieces.pirate);

/** Whether moving `ship` near the pirate costs its owner tribute right now. */
export const owesTribute = (s: State, ship: Unit) => !!s.pieces.pirate && ext(s).pirate !== ship.seat
  && !voyage(s, ship.seat!).calm && !voyage(s, ship.seat!).paid.includes(ship.id);

export const maxMoves = (s: State, seat: SeatId) => BASE_MOVES + benefits(s, seat, 'speed');
export const movesLeft = (s: State, ship: Unit) => {
  const v = voyage(s, ship.seat!);
  return v.done.includes(ship.id) ? 0 : v.moves[ship.id] ?? maxMoves(s, ship.seat!);
};

export type Leg = { path: EdgeId[]; tribute: boolean };

/**
 * Every edge this ship may end on now, with the shortest path. Tribute-free paths win; paths that
 * pay tribute appear only when the seat has a gold coin for it.
 */
export function destinations(s: State, ship: Unit): Map<EdgeId, Leg> {
  const budget = movesLeft(s, ship), out = new Map<EdgeId, Leg>();
  const tax = owesTribute(s, ship), passes = tax && coins(s, ship.seat!) > 0 ? [false, true] : [false];
  for (const allow of passes) {
    const seen = new Map<EdgeId, EdgeId[]>([[ship.at, []]]), queue = [ship.at];
    if (tax && !allow && touchesPirate(s, ship.at)) continue;
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i], path = seen.get(at)!;
      if (path.length >= budget || (path.length && fogNear(s, at).length)) continue;
      for (const e of nextEdges(s, at)) {
        if (seen.has(e) || !navigable(s, e) || (tax && !allow && touchesPirate(s, e))) continue;
        const next = [...path, e];
        seen.set(e, next);
        queue.push(e);
        if (!out.has(e) && shipsOn(s, e) < 2) out.set(e, { path: next, tribute: allow && tax });
      }
    }
  }
  return out;
}

/** Sea steps from each edge to the nearest goal edge, ignoring ships, the pirate and move points. */
export function distanceTo(s: State, goals: EdgeId[]): Map<EdgeId, number> {
  const dist = new Map(goals.map(g => [g, 0])), queue = [...goals];
  for (let i = 0; i < queue.length; i++) {
    for (const e of nextEdges(s, queue[i])) {
      if (dist.has(e) || !navigable(s, e)) continue;
      dist.set(e, dist.get(queue[i])! + 1);
      queue.push(e);
    }
  }
  return dist;
}

/** Turn over the fog hexes at the ship's corners: land pays 1 of its resource, anything else 2 gold. */
export function discover(s: State, seat: SeatId, e: EdgeId): number {
  const found = fogNear(s, e), name = seatName(s, seat);
  for (const tile of found) {
    const face = { ...s.hidden[tile] }, good = face.terrain as Resource;
    if (face.feature?.kind === 'lair') {
      ext(s).lairs.push({ tile, crews: {}, captured: null, at: 0 });
      face.number = 0; // the lair token hides its number disc until the lair is captured
    }
    reveal(s, tile, face);
    const text = `${name} discovered ${face.terrain}`;
    emit(s, { kind: 'reveal', seat, tile, terrain: face.terrain, text });
    if (RESOURCES.includes(good) && s.bank[good] > 0) {
      transfer(s.bank, s.seats[seat].hand, { [good]: 1 });
      gained(s, seat, { [good]: 1 });
      const grants = [{ seat, tile, good, amount: 1 }];
      emit(s, { kind: 'payout', seat, grants, text: `${name} took 1 ${good}` });
    } else addCoins(s, seat, 2);
  }
  return found.length;
}
