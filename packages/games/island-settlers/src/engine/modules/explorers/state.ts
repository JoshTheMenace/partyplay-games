/**
 * Explorers & Pirates state (s.ext.explorers) and the small lookups every other file shares:
 * the seat's ships, supplies, per-opportunity flags and "what this hex looks like now".
 */
import type { CargoKind, Mission, SeatId, Terrain, TileId, Unit, UnitId, VertexId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { face, isLandTile } from '../../legal';
import type { State } from '../../state';

export type Lair = {
  tile: TileId; crews: Record<SeatId, number>; captured: SeatId | null;
  /** Turn id of the capture: remaining crews may leave from the next turn on. */
  at: number;
};

/** Flags for one seat's current opportunity (Connect: the round). */
export type Voyage = {
  /** Movement points left per ship that has started moving. */
  moves: Record<UnitId, number>;
  /** The ship now moving; moving another one finishes it. */
  active: UnitId | null;
  done: UnitId[]; boosted: UnitId[]; paid: UnitId[]; chased: UnitId[];
  fished: boolean; goldBuys: number; fastGold: number;
  /** Fishing (2 fish): no pirate tribute for the rest of this turn. */
  calm?: boolean;
};

export type ExplorersState = {
  coins: Record<SeatId, number>;
  missions: Record<SeatId, Partial<Record<Mission, number>>>;
  /** Bonus tile holder per mission (ties keep the holder). */
  leaders: Partial<Record<Mission, SeatId>>;
  lairs: Lair[];
  /** Spice farms where the seat left a crew (and took its sack). */
  spiceVisits: Record<SeatId, TileId[]>;
  /** Shoals holding a fish haul. */
  hauls: TileId[];
  /** Owner of the pirate ship on the board (pieces.pirate holds its hex). */
  pirate: SeatId | null;
  voyages: Record<SeatId, Voyage>;
};

export const LIMITS = { ships: 3, harbors: 4, settlers: 2, crews: 9, settlements: 5, slots: 2 } as const;
export const BASE_MOVES = 4;
export const HARBOR_COST = { grain: 2, ore: 2 } as const;
export const CREW_COST = { wool: 1, ore: 1 } as const;

export const ext = (s: State) => s.ext.explorers as ExplorersState;

export const freshVoyage = (): Voyage => ({
  moves: {}, active: null, done: [], boosted: [], paid: [], chased: [], fished: false, goldBuys: 0,
  fastGold: 0,
});
/** Read-only in projections; `voyageFor` creates the record inside a commit. */
export const voyage = (s: State, seat: SeatId) => ext(s).voyages[seat] ?? freshVoyage();
export const voyageFor = (s: State, seat: SeatId) => (ext(s).voyages[seat] ??= freshVoyage());

/** Water for ships: open sea, fish shoals and the Council of Catan hex. */
const WATER: ReadonlySet<Terrain> = new Set(['sea', 'shoal', 'council']);
export const terrain = (s: State, t: TileId) => face(s, t).terrain;
export const isWater = (s: State, t: TileId) => WATER.has(terrain(s, t));
export const isFog = (s: State, t: TileId) => terrain(s, t) === 'fog';
/** Land that can hold buildings (the council counts as sea). */
export const isRealLand = (s: State, t: TileId) => isLandTile(s, t) && terrain(s, t) !== 'council';

export const ships = (s: State, seat: SeatId): Unit[] =>
  Object.values(s.pieces.units).filter(u => u.kind === 'expedition' && u.seat === seat);
export const shipsOn = (s: State, edge: string) =>
  Object.values(s.pieces.units).filter(u => u.kind === 'expedition' && u.at === edge).length;

/** Cargo slots used: settlers and fish hauls are large (both slots), crews and spice sacks small. */
export const load = (cargo: CargoKind[]) =>
  cargo.reduce((n, c) => n + (c === 'settler' || c === 'fish' ? 2 : 1), 0);
export const room = (u: Unit) => u.level - load(u.cargo);

export const harborsOf = (s: State, seat: SeatId): VertexId[] => Object.values(s.pieces.buildings)
  .filter(b => b.seat === seat && b.kind === 'harbor').map(b => b.vertex);

/** Ship ends (the two corners of its edge). */
export const ends = (s: State, u: Unit): VertexId[] => {
  const e = boardIndex(s.board).edge.get(u.at);
  return e ? [e.a, e.b] : [];
};
export const docked = (s: State, u: Unit) => ends(s, u).some(v => {
  const b = s.pieces.buildings[v];
  return b?.seat === u.seat && b.kind === 'harbor';
});
/** Hexes touching either end of the ship ("one end of the ship is adjacent to the hex"). */
export const nearTiles = (s: State, u: Unit): TileId[] => {
  const ix = boardIndex(s.board);
  return [...new Set(ends(s, u).flatMap(v => ix.vertex.get(v)?.tiles ?? []))];
};

/** Cargo of one kind aboard the seat's ships. */
export const aboard = (s: State, seat: SeatId, kind: CargoKind) =>
  ships(s, seat).reduce((n, u) => n + u.cargo.filter(c => c === kind).length, 0);

/** Crews in play: aboard, on lairs and left on spice farms. */
export function crewsUsed(s: State, seat: SeatId) {
  const x = ext(s), onLairs = x.lairs.reduce((n, l) => n + (l.crews[seat] ?? 0), 0);
  return aboard(s, seat, 'crew') + onLairs + (x.spiceVisits[seat]?.length ?? 0);
}

export const lairAt = (s: State, t: TileId) => ext(s).lairs.find(l => l.tile === t);
export const crewCount = (l: Lair) => Object.values(l.crews).reduce((a, b) => a + b, 0);
/** A lair still waiting for crews. */
export const openLair = (l: Lair) => !l.captured && crewCount(l) < 3;

/** Revealed spice farms (the feature travels with the reveal). */
export const spiceFarms = (s: State) => Object.values(s.pieces.reveals)
  .flatMap(r => (r.feature?.kind === 'spice' ? [r.feature] : []));
export const shoals = (s: State): TileId[] =>
  Object.keys(s.pieces.reveals).filter(t => s.pieces.reveals[t].terrain === 'shoal');
export const council = (s: State): TileId | null =>
  s.board.features.find(f => f.kind === 'council')?.tile ?? null;

export const coins = (s: State, seat: SeatId) => ext(s).coins[seat] ?? 0;
export const addCoins = (s: State, seat: SeatId, n: number) => {
  ext(s).coins[seat] = Math.max(0, coins(s, seat) + n);
};

/** Farms of one benefit the seat has visited (the second one doubles the effect). */
export const benefits = (s: State, seat: SeatId, benefit: 'speed' | 'pirate' | 'gold') => {
  const mine = ext(s).spiceVisits[seat] ?? [];
  return Math.min(2, spiceFarms(s).filter(f => f.benefit === benefit && mine.includes(f.tile)).length);
};
