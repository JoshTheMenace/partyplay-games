/**
 * Where E&P lets a seat build and when (rulebook "Build"): only on explored land, never on an
 * uncaptured lair's gold field or a spice farm without your crew; setup stays on the starting
 * island with the harbor settlement on its coast. Building comes before moving, and the paired
 * build turn never moves ships.
 */
import type { EdgeId, SeatId, TileId, VertexId, Why } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { role } from '../../flow';
import { why } from '../../legal';
import { seatPrompts, tablePromptOpen } from '../../prompts';
import type { State } from '../../state';
import { hooks, type PlacedPiece } from '../registry';
import { navigable } from './sea';
import { crewCount, ext, isFog, isRealLand, isWater, openLair, spiceFarms } from './state';

/** 'build' before the first movement command; 'move' on main and Connect turns. */
export function phase(s: State, seat: SeatId, want: 'build' | 'move'): boolean {
  const r = role(s, seat);
  if (!r || r === 'setup' || r === 'roll' || tablePromptOpen(s) || seatPrompts(s, seat).length) return false;
  return want === 'build' ? !s.seats[seat].moved : r !== 'paired';
}

/** Hexes nobody may build on yet: fog, uncaptured lairs, spice farms without this seat's crew. */
function tileWhy(s: State, seat: SeatId, t: TileId): Why | null {
  if (isFog(s, t)) return why('rule', 'Explore this hex first');
  if (ext(s).lairs.some(l => l.tile === t && !l.captured)) return why('rule', 'Capture the lair first');
  const farm = s.pieces.reveals[t]?.feature?.kind === 'spice' && !(ext(s).spiceVisits[seat] ?? []).includes(t);
  return farm ? why('rule', 'Land a crew on the spice farm first') : null;
}

/** Corner rules for settlements, settlers and setup, on top of the core distance rule. */
export function cornerWhy(s: State, seat: SeatId, v: VertexId): Why | null {
  const ix = boardIndex(s.board), tiles = ix.vertex.get(v)?.tiles ?? [];
  const closed = tiles.map(t => tileWhy(s, seat, t)).find(w => w);
  if (closed) return closed;
  if (!tiles.some(t => isRealLand(s, t))) return why('rule', 'Settle next to land');
  if (s.turn.stage !== 'setup') return null;
  const home = tiles.every(t => ix.tile.get(t)?.island === 0 || isWater(s, t));
  if (!home) return why('rule', 'Start on the home island');
  const coast = (ix.vertex.get(v)?.edges ?? []).some(e => navigable(s, e));
  const harbor = s.turn.setup?.piece === 'harbor';
  return harbor && !coast ? why('rule', 'Harbor settlements go on the coast') : null;
}

/** The same rules for a road edge. */
export function edgeWhy(s: State, seat: SeatId, e: EdgeId): Why | null {
  const tiles = boardIndex(s.board).edge.get(e)?.tiles ?? [];
  const closed = tiles.map(t => tileWhy(s, seat, t)).find(w => w);
  return closed ?? (tiles.some(t => isRealLand(s, t)) ? null : why('rule', 'Roads need land'));
}

/** A free corner a settler may found a settlement on (distance rule and every module's veto). */
export function settleable(s: State, seat: SeatId, v: VertexId): boolean {
  const ix = boardIndex(s.board);
  const b = s.pieces.buildings;
  if (b[v] || (ix.vertexNeighbors.get(v) ?? []).some(n => b[n])) return false;
  return !hooks(s, 'legal').some(m => m.legal.settlement?.(s, seat, v)); // ours is cornerWhy
}

/** Crews still wanted by known targets: open lairs and spice farms this seat has not visited. */
export function crewDemand(s: State, seat: SeatId) {
  const mine = ext(s).spiceVisits[seat] ?? [];
  const lairs = ext(s).lairs.filter(openLair).reduce((n, l) => n + 3 - crewCount(l), 0);
  return lairs + spiceFarms(s).filter(f => !mine.includes(f.tile)).length;
}

/** Module-built pieces run every active module's onBuild, like core builds. */
export const onBuilt = (s: State, seat: SeatId, placed: PlacedPiece) => {
  for (const m of hooks(s, 'onBuild')) m.onBuild(s, seat, placed);
};
