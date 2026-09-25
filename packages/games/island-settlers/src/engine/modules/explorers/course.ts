/**
 * The Sail command. A heading comes first (listed most useful first, so the generic CPU simply
 * follows the engine), then a sea edge on the map: the reachable goal edges, or the reachable edges
 * that get closest to a goal when none is in reach. "Anywhere" lists every reachable edge.
 */
import { pips } from '../../../geometry';
import type { CargoKind, Command, EdgeId, SeatId, Unit, VertexId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { face } from '../../legal';
import { need } from '../../need';
import { updateUnit } from '../../pieces';
import { seatName, type State } from '../../state';
import { settleable } from './rules';
import { useful } from './missions';
import { destinations, discover, distanceTo, movesLeft, navigable, shoreline, type Leg } from './sea';
import {
  addCoins, council, docked, ext, harborsOf, openLair, ships, spiceFarms, voyageFor,
} from './state';

/** Shared per seat and revision: landing sites worth sailing for, edges that discover fog. */
export type Chart = { good: Set<VertexId>; explore: EdgeId[] };
type Heading = { key: string; label: string; hint: number; goals: EdgeId[] };

export const has = (u: Unit, c: CargoKind) => u.cargo.includes(c);
/** Explored sea edges with a corner on one of `corners`. */
function goalEdges(s: State, corners: Iterable<VertexId>): EdgeId[] {
  const ix = boardIndex(s.board), out = new Set<EdgeId>();
  for (const v of corners) for (const e of ix.vertex.get(v)?.edges ?? []) if (navigable(s, e)) out.add(e);
  return [...out];
}
const onTiles = (s: State, tiles: string[]) => tiles.flatMap(t => boardIndex(s.board).tileVertices.get(t) ?? []);

/** Corner value for landing a settler: pips of its hexes. */
export const siteValue = (s: State, v: VertexId) =>
  (boardIndex(s.board).vertex.get(v)?.tiles ?? []).reduce((n, t) => n + pips(face(s, t).number), 0);

export function chart(s: State, seat: SeatId): Chart {
  const all = s.board.vertices.filter(v => settleable(s, seat, v.id))
    .map(v => ({ v: v.id, n: siteValue(s, v.id) }));
  const top = Math.max(0, ...all.map(x => x.n)), bar = Math.min(top, Math.max(3, top - 3));
  return { good: new Set(all.filter(x => x.n >= bar).map(x => x.v)), explore: shoreline(s) };
}

function headings(s: State, u: Unit, c: Chart): Heading[] {
  const seat = u.seat!, x = ext(s), mine = x.spiceVisits[seat] ?? [], out: Heading[] = [];
  const add = (key: string, label: string, hint: number, goals: EdgeId[]) => {
    if (goals.length && !out.some(h => h.key === key)) out.push({ key, label, hint, goals });
  };
  const hall = council(s), empty = !u.cargo.length, dock = docked(s, u);
  if (hall && (has(u, 'fish') || has(u, 'spice'))) {
    add('council', 'To the Council of Catan', 0.68, goalEdges(s, onTiles(s, [hall])));
  }
  if (has(u, 'settler')) add('settle', 'To a landing site', 0.66, goalEdges(s, c.good));
  if (has(u, 'crew')) {
    const lairs = x.lairs.filter(openLair).map(l => l.tile);
    add('lair', 'To a pirate lair', 0.64, goalEdges(s, onTiles(s, lairs)));
    const farms = useful(s, seat, 'spices') ? spiceFarms(s).filter(f => !mine.includes(f.tile)) : [];
    add('spice', 'To a spice farm', 0.64, goalEdges(s, onTiles(s, farms.map(f => f.tile))));
  }
  if (empty && useful(s, seat, 'fish')) {
    add('fish', 'To a fish haul', 0.62, goalEdges(s, onTiles(s, x.hauls)));
  }
  // With landing sites known, one empty ship waits at a harbor for the next settler.
  const waiting = ships(s, seat).some(w => w !== u && docked(s, w) && !w.cargo.length);
  const needDock = empty && c.good.size > 0 && !waiting;
  const home = goalEdges(s, harborsOf(s, seat));
  if (needDock && !dock) add('home', 'Back to your harbor', 0.6, home);
  add('explore', 'Explore the fog', needDock && dock ? 0.3 : 0.6, c.explore);
  if (empty && !dock) add('home', 'Back to your harbor', 0.56, home);
  return out;
}

/** Reachable goal edges, else the reachable edges that get closest to one (never backwards). */
function aim(s: State, u: Unit, reach: Map<EdgeId, Leg>, goals: EdgeId[]): EdgeId[] {
  const inReach = goals.filter(g => reach.has(g));
  if (inReach.length) return inReach;
  const dist = distanceTo(s, goals), here = dist.get(u.at) ?? Infinity;
  const best = Math.min(...[...reach.keys()].map(e => dist.get(e) ?? Infinity));
  return best < here ? [...reach.keys()].filter(e => dist.get(e) === best) : [];
}

export const shipName = (s: State, u: Unit) =>
  `Ship ${ships(s, u.seat!).indexOf(u) + 1}${u.cargo.length ? ` (${u.cargo.join(', ')})` : ''}`;

export function sailCommand(s: State, u: Unit, c: Chart): Command | null {
  const reach = destinations(s, u), left = movesLeft(s, u);
  const edges = (ids: EdgeId[]) => [pickField('to', 'Sea edge', ids.map(e => {
    const leg = reach.get(e)!, n = leg.path.length;
    const toll = leg.tribute ? 'Pays 1 gold to the pirate' : undefined;
    return choice(e, `${n} ${n > 1 ? 'moves' : 'move'}`, toll);
  }), 'edge')];
  const list = headings(s, u, c).map(h => ({ h, to: aim(s, u, reach, h.goals) })).filter(o => o.to.length);
  const options = list.map(o => choice(o.h.key, o.h.label, '', edges(o.to)));
  if (reach.size) options.push(choice('any', 'Anywhere', '', edges([...reach.keys()])));
  if (!left || !options.length) return null;
  return command({
    id: `explorers/sail:${u.id}`, module: 'explorers', group: 'ships', label: `Sail ${shipName(s, u)}`,
    detail: `${left} moves left; discovering fog ends the move`, hint: list[0]?.h.hint ?? 0.1,
    fields: [pickField('heading', 'Heading', options)],
  });
}

/** Move along the path (one `move` event per edge), pay any tribute, discover fog at the end. */
export function sail(s: State, seat: SeatId, u: Unit, to: EdgeId) {
  const v = voyageFor(s, seat), leg = destinations(s, u).get(to);
  need(leg, 'That ship cannot reach there.');
  if (v.active && v.active !== u.id && !v.done.includes(v.active)) v.done.push(v.active);
  v.active = u.id;
  if (leg.tribute) { addCoins(s, seat, -1); v.paid.push(u.id); }
  v.moves[u.id] = movesLeft(s, u) - leg.path.length;
  let from = u.at;
  for (const step of leg.path) {
    updateUnit(s, u.id, { at: step });
    const text = `${seatName(s, seat)} sailed`;
    emit(s, { kind: 'move', seat, piece: 'expedition', unit: u.id, from, to: step, text });
    from = step;
  }
  if (discover(s, seat, to)) v.moves[u.id] = 0;
}
