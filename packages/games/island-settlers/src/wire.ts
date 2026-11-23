/**
 * What travels to the browsers, and how they rebuild the game views from it (browser-safe).
 *
 * One room is a league of islands: one island for up to ten seats, several four-seat islands for a
 * bigger room (or when the host picks it). The engine's PublicView and PrivateView describe ONE island
 * and stay the UI's contract; this file is the envelope around them.
 *
 * - Everything shared rides one cached field (`league`) under one revision, so a quiet snapshot is
 *   `{"rev":n}`. It holds every island's card (rail, standings) and the full view of the island the TV
 *   features.
 * - A seat's own island and private view ride its private snapshot, which the platform does not cache.
 *   They are sent in full twice after they change and as `{rev}` otherwise; a page that missed the full
 *   copy asks for it with the `sync` action.
 * - No message should pass the platform's 32 KiB (it only enforces that on what browsers send): a full seat
 *   view waits a snapshot when the shared view changed with it, and an archipelago's shared view is final
 *   from the finale on, so the results frame carries the outcome and nothing else that is big.
 * - A board travels as its tiles and ports only (about 1 kB instead of 25–40 kB). The graph is rebuilt
 *   here with the same code the engine used, so vertex and edge ids agree.
 */
import { axialKey, axialToPoint, bounds } from './geometry';
import { buildGraph, setFlags } from './graph';
import type {
  Board, BoardFeature, EndReason, Port, PrivateView, PublicView, Resource, SeatId, Settings, Terrain, Tile,
} from './model';

// ---------------------------------------------------------------- the island plan

/** Seats on each island of an archipelago. Four is the board this game is quickest and most contested on. */
export const ISLAND_SEATS = 4;
/** Above this many players the room is always an archipelago; one board cannot hold more. */
export const ONE_ISLAND_MAX = 10;

/** Islands for `humans` players: one shared board, or enough four-seat islands for everyone. */
export function islandCount(humans: number, settings: Pick<Settings, 'islands'>): number {
  const many = humans > ONE_ISLAND_MAX || (settings.islands === 'many' && humans > ISLAND_SEATS);
  return many ? Math.ceil(humans / ISLAND_SEATS) : 1;
}

/** Humans per island, as even as possible; CPUs fill every island to ISLAND_SEATS. */
export function islandSizes(humans: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.floor(humans / count) + (i < humans % count ? 1 : 0));
}

/** Island names in room order (original to this game). */
export const ISLAND_NAMES = [
  'Amber Cay', 'Brindle Rock', 'Coral Hook', 'Driftwood Key', 'Ember Holm', 'Fennel Bank', 'Gull Skerry',
  'Heron Point', 'Indigo Reef', 'Juniper Isle', 'Kelp Haven', 'Lantern Head', 'Marlin Shoal', 'Nettle Cove',
  'Osprey Rise', 'Pebble Sound',
] as const;

/** The settings an archipelago island actually plays: simultaneous rounds, four seats, always timed. */
export const islandSettings = (s: Settings, shared: boolean): Settings => (shared
  ? { ...s, mode: 'connect', tableSize: ISLAND_SEATS, timer: s.timer === 'off' ? 'relaxed' : s.timer } : s);

// ---------------------------------------------------------------- boards

export const TERRAINS: readonly Terrain[] = [
  'sea', 'wood', 'brick', 'wool', 'grain', 'ore', 'desert', 'gold', 'fog', 'lake', 'oasis',
  'castle', 'quarry', 'glassworks', 'spice', 'shoal', 'council',
];
const PORT_GOODS: readonly Port['good'][] = ['any', 'wood', 'brick', 'wool', 'grain', 'ore'];

/** tiles: [q, r, terrain, number, island]; ports: [edge, good, ratio, tile]. */
export type BoardWire = {
  t: [number, number, number, number, number][];
  p: [string, number, number, string][];
  f: BoardFeature[];
};

export const encodeBoard = (b: Board): BoardWire => ({
  t: b.tiles.map(t => [t.q, t.r, TERRAINS.indexOf(t.terrain), t.number, t.island]),
  p: b.ports.map(p => [p.edge, PORT_GOODS.indexOf(p.good), p.ratio, p.tile]),
  f: b.features,
});

export function decodeBoard(w: BoardWire): Board {
  const tiles: Tile[] = w.t.map(([q, r, terrain, number, island]) =>
    ({ id: axialKey({ q, r }), q, r, ...axialToPoint({ q, r }), terrain: TERRAINS[terrain], number, island }));
  const { vertices, edges } = buildGraph(tiles);
  setFlags(tiles, vertices, edges);
  const edge = new Map(edges.map(e => [e.id, e]));
  const ports: Port[] = w.p.map(([id, good, ratio, tile], i) => {
    const e = edge.get(id)!;
    return { id: `port-${i}`, edge: id, vertices: [e.a, e.b], good: PORT_GOODS[good] as Resource | 'any',
      ratio: ratio as 2 | 3, tile };
  });
  return { tiles, vertices, edges, ports, features: w.f, bounds: bounds(tiles.filter(t => t.terrain !== 'sea')) };
}

// ---------------------------------------------------------------- views on the wire

/** One island's public view; `index` is its place in the room and `rev` bumps on each of its changes. */
export type IslandWire = Omit<PublicView, 'mapRev' | 'board' | 'settings'> & {
  index: number; rev: number; board: BoardWire;
};

/** The island at a glance: enough for the rail, the room standings and a phone's "where am I". */
export type IslandCard = {
  name: string;
  /** setup: placing; roll: waiting for the dice; busy: a 7 is being resolved; play: window open; done: round in. */
  phase: 'setup' | 'roll' | 'busy' | 'play' | 'done' | 'over';
  /** [id, name, palette index on this island, cpu]. */
  seats: [SeatId, string, number, boolean][];
  /** Public points per seat, in `seats` order (hidden points join at the finale). */
  vp: number[];
  /** Per seat: 1 done this round, 2 offline; else 0. */
  flags: number[];
};

export type LeaguePhase = 'setup' | 'roll' | 'play' | 'finale' | 'ended';

/** A room award at the end (the league's own, not a rule): one line per title. */
export type LeagueAward = { key: string; title: string; text: string; seats: SeatId[] };

/** The room's verdict. Every seat's final total is its island card's `vp` from then on; `roomRanks` ranks them. */
export type LeagueResults = {
  winners: SeatId[]; reason: EndReason; rounds: number; durationMs: number; finaleAt: number; completeAt: number;
  awards: LeagueAward[];
};

export type LeagueView = {
  settings: Settings;
  /** More than one island: shared rolls, synchronized rounds and room standings. */
  shared: boolean;
  islands: IslandCard[];
  /** The island on the TV: its index in `islands`, and its full view. */
  featured: number;
  island: IslandWire;
  phase: LeaguePhase;
  round: number;
  /** Shared rolls: when the next round's start, and this round's dice (`at` in server ms). Null with one island. */
  rollAt: number | null;
  dice: { at: number; round: number; rolls: [number, number][] } | null;
  /** The horn sounded: every open window closes at this server time. */
  hornAt: number | null;
  results: LeagueResults | null;
};

/** Cached by the platform under `rev` (manifest snapshotCache). */
export type RoomView = { rev: number; league: LeagueView };

/** `me` (and `island` in an archipelago) are present only while fresh; see FULL_TIMES. */
export type SeatView = { rev: number; home: number; me?: PrivateView; island?: IslandWire };

/** A changed seat view is sent whole in this many snapshots in a row, then as `{rev, home}`. */
export const FULL_TIMES = 2;

// ---------------------------------------------------------------- decoding

const boards = new Map<string, Board>();

/** Boards never change in a round, so one decode per distinct board keeps their identity stable for the UI. */
function boardOf(w: BoardWire): Board {
  const key = JSON.stringify(w.t);
  if (!boards.has(key) && boards.size >= 2 * ISLAND_NAMES.length) boards.clear();
  return boards.get(key) ?? boards.set(key, decodeBoard(w)).get(key)!;
}

const views = new WeakMap<IslandWire, PublicView>();

/** The island's PublicView; the same wire object always yields the same view object. */
export function islandOf(league: LeagueView, w: IslandWire): PublicView {
  let v = views.get(w);
  if (!v) {
    const { index: _index, rev, board, ...rest } = w;
    v = { ...rest, mapRev: rev, board: boardOf(board), settings: islandSettings(league.settings, league.shared) };
    views.set(w, v);
  }
  return v;
}

/** Tests and previews that build a wire object from a view they already hold skip the decode. */
export const adoptView = (w: IslandWire, view: PublicView) => { views.set(w, view); };

export type Seated = { pub: PublicView; me: PrivateView; home: number };
type Held = { round: string; rev: number; pub: PublicView | null; me: PrivateView };
const held = new Map<string, Held>();

/**
 * A seat's island and private view from its latest snapshot, or the last full copy while the snapshot
 * is the short form. `stale` means this page never received the current revision in full: ask for it.
 */
export function seatView(roundId: string, playerId: string, room: RoomView, seat: SeatView | null):
  { view: Seated | null; stale: boolean } {
  if (!seat) return { view: null, stale: false };
  let h = held.get(playerId);
  if (h && h.round !== roundId) h = undefined;
  if (seat.me) {
    h = { round: roundId, rev: seat.rev, pub: seat.island ? islandOf(room.league, seat.island) : null, me: seat.me };
    held.set(playerId, h);
  }
  if (!h) return { view: null, stale: true };
  // One island: the shared copy is always current; only the private view may be a revision behind.
  const pub = h.pub ?? islandOf(room.league, room.league.island);
  return { view: { pub, me: h.me, home: seat.home }, stale: h.rev !== seat.rev };
}

/** Forget held views (a disposed client, a test). */
export function resetWire() { held.clear(); boards.clear(); }

// ---------------------------------------------------------------- room standings (pure, shared with the TV)

export type RoomSeat = {
  id: SeatId; name: string; island: number; seat: number; cpu: boolean; vp: number; done: boolean; offline: boolean;
};

export const roomSeats = (league: LeagueView): RoomSeat[] => league.islands.flatMap((c, island) =>
  c.seats.map(([id, name, seat, cpu], i) => ({
    id, name, island, seat, cpu, vp: c.vp[i], done: c.flags[i] === 1, offline: c.flags[i] === 2,
  })));

/** Seats by points, best first; `rank` is shared by equal totals. */
export function roomRanks(league: LeagueView): (RoomSeat & { rank: number })[] {
  const rows = roomSeats(league).map(s => ({ ...s, rank: 0 }));
  for (const row of rows) row.rank = 1 + rows.filter(o => o.vp > row.vp).length;
  return rows.sort((a, b) => a.rank - b.rank || a.island - b.island || a.seat - b.seat);
}
