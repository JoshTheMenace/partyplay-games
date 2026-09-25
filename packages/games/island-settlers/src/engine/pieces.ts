/**
 * The only functions that mutate `pieces`. Each marks `mapDirty` so the commit bumps `mapRev`
 * (the snapshotCache revision). No-op writes leave the map clean.
 */
import type { Building, EdgeId, Reveal, Route, SeatId, TileId, Unit, UnitId, VertexId } from '../model';
import type { State } from './state';

const dirty = (s: State) => { s.mapDirty = true; };

export function placeBuilding(s: State, b: Building) { s.pieces.buildings[b.vertex] = b; dirty(s); }

export function removeBuilding(s: State, v: VertexId) {
  if (s.pieces.buildings[v]) { delete s.pieces.buildings[v]; dirty(s); }
}

export function placeRoute(s: State, r: Route) {
  s.pieces.routes[r.edge] = r;
  if (r.kind === 'ship') s.seats[r.seat]?.shipsBuilt.push(r.edge);
  dirty(s);
}

export function removeRoute(s: State, e: EdgeId) {
  if (s.pieces.routes[e]) { delete s.pieces.routes[e]; dirty(s); }
}

/** Move a route (ship moves) keeping its owner and kind. */
export function moveRoute(s: State, from: EdgeId, to: EdgeId) {
  const r = s.pieces.routes[from];
  if (!r || from === to) return;
  delete s.pieces.routes[from];
  s.pieces.routes[to] = { ...r, edge: to };
  dirty(s);
}

export function placeUnit(s: State, u: Unit) { s.pieces.units[u.id] = u; dirty(s); }

export function updateUnit(s: State, id: UnitId, patch: Partial<Omit<Unit, 'id'>>) {
  const u = s.pieces.units[id];
  if (u && Object.entries(patch).some(([k, v]) => JSON.stringify(u[k as keyof Unit]) !== JSON.stringify(v))) {
    Object.assign(u, patch);
    dirty(s);
  }
}

export function removeUnit(s: State, id: UnitId) {
  if (s.pieces.units[id]) { delete s.pieces.units[id]; dirty(s); }
}

export function setRobber(s: State, tile: TileId | null) {
  if (s.pieces.robber !== tile) { s.pieces.robber = tile; dirty(s); }
}

export function setPirate(s: State, tile: TileId | null) {
  if (s.pieces.pirate !== tile) { s.pieces.pirate = tile; dirty(s); }
}

export function setMerchant(s: State, merchant: { tile: TileId; seat: SeatId } | null) {
  const now = s.pieces.merchant;
  if (now?.tile !== merchant?.tile || now?.seat !== merchant?.seat) { s.pieces.merchant = merchant; dirty(s); }
}

export function reveal(s: State, tile: TileId, face: Reveal) {
  if (!s.pieces.reveals[tile]) { s.pieces.reveals[tile] = face; dirty(s); }
}
