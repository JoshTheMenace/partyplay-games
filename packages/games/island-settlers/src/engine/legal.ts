/**
 * Legality (ENGINE §3.3, §3.6, §10): where each piece may go right now and, for the build menu, why
 * not. Targets are spatial and rule legality only (turn, supply, locks, module hooks); cost is
 * reported separately in `BuildOption.missing` / `why`, so phones and CPUs can plan ahead.
 */
import {
  COSTS, PIECE_LIMITS, type BuildOption, type BuildPiece, type EdgeId, type Purchase, type RouteKind,
  type SeatId, type ShipMove, type Terrain, type TileId, type VertexId, type Why, type WhyCode,
} from '../model';
import { boardIndex } from './board/lookup';
import { cardsText, missing, total } from './cards';
import { role } from './flow';
import { hooks, type Module } from './modules/registry';
import { seatPrompts, tablePromptOpen } from './prompts';
import type { State } from './state';

export const why = (code: WhyCode, text: string): Why => ({ code, text });

const WATER: ReadonlySet<Terrain> = new Set(['sea', 'fog', 'lake', 'shoal']);

/** Terrain and number token after fog reveals. */
export function face(s: State, tile: TileId): { terrain: Terrain; number: number } {
  const t = boardIndex(s.board).tile.get(tile), shown = s.pieces.reveals[tile];
  return { terrain: shown?.terrain ?? t?.terrain ?? 'sea', number: shown?.number ?? t?.number ?? 0 };
}

export const isLandTile = (s: State, tile: TileId) => !WATER.has(face(s, tile).terrain);

/** Some module `legal` hook returns a reason against this placement. */
const vetoed = (s: State, veto: (legal: NonNullable<Module['legal']>) => Why | null | undefined) =>
  hooks(s, 'legal').some(m => veto(m.legal));

const isRoute = (piece: Purchase): piece is RouteKind => piece === 'road' || piece === 'ship';
const SUPPLY = { road: 'roads', ship: 'ships', settlement: 'settlements', city: 'cities' } as const;

/** Pieces of this kind left in the seat's supply. */
export function piecesLeft(s: State, seat: SeatId, piece: BuildPiece): number {
  const placed = isRoute(piece) ? Object.values(s.pieces.routes) : Object.values(s.pieces.buildings);
  return PIECE_LIMITS[SUPPLY[piece]] - placed.filter(x => x.seat === seat && x.kind === piece).length;
}

/** An opponent building (or a module blocker such as a knight) at `v` stops this seat's routes. */
export function blocks(s: State, seat: SeatId, v: VertexId): boolean {
  const b = s.pieces.buildings[v];
  return (!!b && b.seat !== seat) || hooks(s, 'blocksRoute').some(m => m.blocksRoute(s, seat, v));
}

/** Free corner obeying the distance rule on a vertex that touches land, module filters applied. */
function settleable(s: State, seat: SeatId, v: VertexId): boolean {
  const ix = boardIndex(s.board), vertex = ix.vertex.get(v);
  if (!vertex || s.pieces.buildings[v]) return false;
  if ((ix.vertexNeighbors.get(v) ?? []).some(n => s.pieces.buildings[n])) return false;
  return vertex.tiles.some(t => isLandTile(s, t)) && !vetoed(s, l => l.settlement?.(s, seat, v));
}

/** Empty edge of the right terrain for `kind`, module vetoes applied. */
function placeable(s: State, seat: SeatId, e: EdgeId, kind: RouteKind): boolean {
  const edge = boardIndex(s.board).edge.get(e);
  if (!edge || s.pieces.routes[e]) return false;
  const fits = kind === 'road' ? edge.tiles.some(t => isLandTile(s, t))
    : edge.tiles.some(t => face(s, t).terrain === 'sea') && !edge.tiles.includes(s.pieces.pirate ?? '');
  return fits && !vetoed(s, l => l.route?.(s, seat, e, kind));
}

/** A `kind` route may grow from `v`: own building there, or an own route of the same kind. */
function grows(s: State, seat: SeatId, v: VertexId, kind: RouteKind, skip: EdgeId | null): boolean {
  if (blocks(s, seat, v)) return false;
  if (s.pieces.buildings[v]) return true;
  return (boardIndex(s.board).vertex.get(v)?.edges ?? [])
    .some(e => e !== skip && s.pieces.routes[e]?.seat === seat && s.pieces.routes[e].kind === kind);
}

/** Connected route spots; `skip` ignores one of the seat's own routes (a ship being moved). */
function routeSpots(s: State, seat: SeatId, kind: RouteKind, skip: EdgeId | null = null): EdgeId[] {
  return s.board.edges.filter(e => e.id !== skip && placeable(s, seat, e.id, kind)
    && [e.a, e.b].some(v => grows(s, seat, v, kind, skip))).map(e => e.id);
}

function setupSpots(s: State, seat: SeatId, piece: BuildPiece): string[] {
  const step = s.turn.setup, ix = boardIndex(s.board);
  if (!step || !accepts(step.piece, piece)) return [];
  if (!isRoute(piece)) return s.board.vertices.map(v => v.id).filter(v => settleable(s, seat, v));
  const anchor = s.turn.anchor;
  if (!anchor || !s.profile.routeKinds.includes(piece)) return [];
  return (ix.vertex.get(anchor)?.edges ?? []).filter(e => placeable(s, seat, e, piece));
}

/** A building step takes a settlement (or a city on city/harbor steps); a route step any route kind. */
function accepts(step: string, piece: BuildPiece) {
  if (step === 'road' || step === 'ship') return isRoute(piece);
  return piece === 'settlement' || (piece === 'city' && step !== 'settlement');
}

const BUILDS = new Set(['main', 'paired', 'round']);

/** Movement locks building (Explorers, Deliveries, Barbarian Attack). */
const lockWhy = (s: State, seat: SeatId): Why | null =>
  (s.profile.movementLocksBuilding && s.seats[seat].moved ? why('moved', 'You started moving') : null);

/** Legal spots for `piece` for this seat right now (setup, paid builds and owed free routes). */
export function targets(s: State, seat: SeatId, piece: BuildPiece): string[] {
  const r = role(s, seat), p = s.seats[seat];
  if (r === 'setup') return setupSpots(s, seat, piece);
  if (!r || (isRoute(piece) && !s.profile.routeKinds.includes(piece))) return [];
  if (piecesLeft(s, seat, piece) <= 0) return [];
  if (r === 'roll' ? !(isRoute(piece) && p.freeRoutes > 0) : lockWhy(s, seat)) return [];
  if (isRoute(piece)) return routeSpots(s, seat, piece);
  const ix = boardIndex(s.board);
  if (piece === 'city') {
    if (!s.profile.cities) return [];
    return Object.values(s.pieces.buildings)
      .filter(b => b.seat === seat && b.kind === 'settlement')
      .map(b => b.vertex).filter(v => !vetoed(s, l => l.city?.(s, seat, v)));
  }
  const mine = (v: VertexId) => (ix.vertex.get(v)?.edges ?? []).some(e => s.pieces.routes[e]?.seat === seat);
  return s.board.vertices.map(v => v.id).filter(v => mine(v) && settleable(s, seat, v));
}

/** Why this seat cannot buy `piece` now (turn, prompts, locks, supply, cost, spot), else null. */
export function purchaseWhy(s: State, seat: SeatId, piece: Purchase, spots?: string[]): Why | null {
  const r = role(s, seat), p = s.seats[seat], route = isRoute(piece);
  if (s.turn.stage === 'setup') {
    if (r !== 'setup') return why('not-your-turn', 'Wait for your turn');
    if (piece === 'development' || !accepts(s.turn.setup!.piece, piece)) {
      return why('stage', `Place your starting ${s.turn.setup!.piece} first`);
    }
    return (spots ?? targets(s, seat, piece)).length ? null : why('no-spot', 'No legal spot');
  }
  const free = route && p.freeRoutes > 0;
  if (!r) return why('not-your-turn', 'Wait for your turn');
  if (r === 'roll' && !free) return why('roll-first', 'Roll first');
  if (tablePromptOpen(s)) return why('prompt', 'Waiting for other players to decide');
  if (seatPrompts(s, seat).length) return why('prompt', 'Finish your open decision first');
  const lock = lockWhy(s, seat);
  if (lock) return lock;
  if (piece === 'development') {
    if (!s.profile.devCards) return why('rule', 'No development cards in this game');
    if (!s.devDeck.length) return why('deck-empty', 'The deck is empty');
  } else if (piecesLeft(s, seat, piece) <= 0) return why('no-pieces', `No ${SUPPLY[piece]} left`);
  const lack = free ? {} : missing(p.hand, COSTS[piece]);
  if (total(lack)) return why('cost', `Need ${cardsText(lack)}`);
  const none = piece !== 'development' && !(spots ?? targets(s, seat, piece)).length;
  return none ? why('no-spot', 'No legal spot') : null;
}

/** Build menu rows (PrivateView.build). */
export function buildOptions(s: State, seat: SeatId): BuildOption[] {
  const pieces: Purchase[] = [...s.profile.routeKinds, 'settlement'];
  if (s.profile.cities) pieces.push('city');
  if (s.profile.devCards) pieces.push('development');
  const p = s.seats[seat], setup = s.turn.stage === 'setup' && role(s, seat) === 'setup';
  return pieces.map(piece => {
    const spots = piece === 'development' ? [] : targets(s, seat, piece);
    const free = setup ? (piece !== 'development' && accepts(s.turn.setup!.piece, piece) ? 1 : 0)
      : isRoute(piece) ? p.freeRoutes : 0;
    return {
      piece, cost: COSTS[piece], free, targets: spots,
      left: piece === 'development' ? null : piecesLeft(s, seat, piece),
      missing: free ? {} : missing(p.hand, COSTS[piece]), why: purchaseWhy(s, seat, piece, spots),
    };
  });
}

/** Ships at an open end of a shipping line, not next to the pirate, one move per opportunity. */
export function shipMoves(s: State, seat: SeatId): ShipMove[] {
  const r = role(s, seat), ix = boardIndex(s.board);
  const ready = s.profile.routeKinds.includes('ship') && !!r && BUILDS.has(r) && !s.seats[seat].moved;
  if (!ready || lockWhy(s, seat)) return [];
  const ships = (v: VertexId) => (ix.vertex.get(v)?.edges ?? [])
    .filter(e => s.pieces.routes[e]?.seat === seat && s.pieces.routes[e].kind === 'ship').length;
  const open = (e: EdgeId) => {
    const edge = ix.edge.get(e)!;
    if (edge.tiles.includes(s.pieces.pirate ?? '')) return false;
    return [edge.a, edge.b].some(v => s.pieces.buildings[v]?.seat !== seat && ships(v) === 1);
  };
  const movable = (e: EdgeId) => open(e) && !vetoed(s, l => l.shipMove?.(s, seat, e));
  return Object.values(s.pieces.routes).filter(x => x.seat === seat && x.kind === 'ship' && movable(x.edge))
    .map(x => ({ from: x.edge, to: routeSpots(s, seat, 'ship', x.edge) })).filter(m => m.to.length);
}

/**
 * Hexes the robber or pirate may move to (never its current hex); the robber may also take the
 * Fishing lake (T&B p.10), which stays unbuildable. Module `robberTile` filters
 * apply to the robber; when they would leave no hex at all, every hex stays legal.
 */
export function robberTiles(s: State, seat: SeatId, piece: 'robber' | 'pirate'): TileId[] {
  const current = piece === 'robber' ? s.pieces.robber : s.pieces.pirate;
  const fits = (t: TileId) => (piece === 'robber' ? isLandTile(s, t) || face(s, t).terrain === 'lake'
    : face(s, t).terrain === 'sea');
  const all = s.board.tiles.map(t => t.id).filter(t => t !== current && fits(t));
  if (piece === 'pirate') return all;
  const allowed = all.filter(t => !vetoed(s, l => l.robberTile?.(s, seat, t)));
  return allowed.length ? allowed : all;
}

/** Seats with cards that `seat` can rob on `tile`: buildings on its corners (pirate: ships on its sides). */
export function victims(s: State, seat: SeatId, tile: TileId, piece: 'robber' | 'pirate'): SeatId[] {
  const ix = boardIndex(s.board);
  const ship = (e: EdgeId) => (s.pieces.routes[e]?.kind === 'ship' ? s.pieces.routes[e].seat : undefined);
  const owners = piece === 'robber'
    ? (ix.tileVertices.get(tile) ?? []).map(v => s.pieces.buildings[v]?.seat)
    : (ix.tileEdges.get(tile) ?? []).map(ship);
  const robbable = (id?: SeatId): id is SeatId => !!id && id !== seat && total(s.seats[id].hand) > 0
    && hooks(s, 'robbable').every(m => m.robbable(s, seat, id));
  return [...new Set(owners)].filter(robbable);
}
