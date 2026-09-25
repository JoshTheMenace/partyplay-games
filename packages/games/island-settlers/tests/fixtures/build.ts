/** Builders for public fixture state: seats, pieces, derived scores and the PublicView skeleton. */
import {
  DEFAULT_SETTINGS, PIECE_LIMITS, RESOURCES, SEAT_COLORS, TIMERS,
  type Board, type BuildingKind, type Cards, type Good, type PrivateView, type PublicSeat, type PublicView,
  type RouteKind, type SeatId, type SeatStatus, type Settings, type Stage, type TimedStep, type Turn, type VertexId,
} from '../../src/model';
import { pips } from '../../src/geometry';

/** Fixture epoch. Fixtures place `now` a little after this; deadlines are absolute server times. */
export const T0 = 1_760_000_000_000;

/** Each exactly 16 characters, for roster density checks (EXPERIENCE §3.12). */
export const LONG_NAMES = [
  'Maximilian Ortiz', 'Anastasia Rowley', 'Bartholomew Chen', 'Evangeline Moore', 'Christopher Diaz',
  'Josephine Walker', 'Alessandro Nunes', 'Gwendolyn Harper', 'Sebastian Okafor', 'Penelope Vasquez',
];
export const SHORT_NAMES = ['Ana', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun'];
const PERSONAS = ['Harbor trader', 'Road baron', 'Quiet farmer', 'Ore hoarder', 'Bold builder'];

export const sid = (i: number): SeatId => `p${i}`;

/** n seats p0…p(n-1) with room colours in order. cpu lists seat indexes played by CPUs. */
export function makeSeats(n: number, o: { long?: boolean; cpu?: number[] } = {}): PublicSeat[] {
  return Array.from({ length: n }, (_, i) => {
    const cpu = o.cpu?.includes(i) ?? false;
    return {
      id: sid(i), name: (o.long ? LONG_NAMES : SHORT_NAMES)[i], color: SEAT_COLORS[i], seat: i, cpu,
      persona: cpu ? PERSONAS[i % PERSONAS.length] : null, connected: true, away: false,
      status: 'idle', deadline: null, vp: 0, parts: [], cards: 0, dev: 0, knights: 0, longestRoute: 0,
      discardLimit: 7, left: { roads: 15, ships: 15, settlements: 5, cities: 4 }, badges: [], ready: false,
    };
  });
}

/** Bank supply per resource by table size (ENGINE §8.1). */
export const supply = (seats: number) => (seats <= 4 ? 19 : seats <= 6 ? 24 : seats <= 8 ? 30 : 35);

/** A PublicView with every field present; scenarios then mutate it and call finish(). */
export function makeView(board: Board, seats: PublicSeat[], o: {
  settings?: Partial<Settings>; stage: Stage; turn?: Partial<Turn>; now?: string[];
}): PublicView {
  const desert = board.tiles.find(t => t.terrain === 'desert' && t.island === 0);
  return {
    mapRev: 1, board,
    pieces: {
      buildings: {}, routes: {}, units: {}, robber: desert?.id ?? null, pirate: null, merchant: null, reveals: {},
    },
    settings: { ...DEFAULT_SETTINGS, tableSize: seats.length, ...o.settings },
    modules: [],
    turn: { id: 1, stage: o.stage, round: 1, active: null, partner: null, next: null, setup: null, ...o.turn },
    now: { seats: [], title: o.now?.[0] ?? '', detail: o.now?.[1] ?? '' },
    clock: null, seats, bank: {}, devDeck: 25, awards: {}, offers: [], prompts: [], robberChoices: [],
    intent: null, lastRoll: null, events: [], ext: {}, hud: [], results: null,
  };
}

// ---------------------------------------------------------------- pieces

export const neighbours = (pub: PublicView, v: VertexId) => {
  const edges = new Map(pub.board.edges.map(e => [e.id, e]));
  return pub.board.vertices.find(x => x.id === v)!.edges.map(id => {
    const e = edges.get(id)!;
    return e.a === v ? e.b : e.a;
  });
};

const landVertex = (pub: PublicView) => {
  const terrain = new Map(pub.board.tiles.map(t => [t.id, t.terrain]));
  return (v: { tiles: string[] }) => v.tiles.some(id => terrain.get(id) !== 'sea');
};

/** Free vertices that satisfy the distance rule, best pips first (a plausible opening order). */
export function openSpots(pub: PublicView): VertexId[] {
  const numbers = new Map(pub.board.tiles.map(t => [t.id, t.number]));
  const score = (tiles: string[]) => tiles.reduce((sum, id) => sum + pips(numbers.get(id) ?? 0), 0);
  const land = landVertex(pub), taken = pub.pieces.buildings;
  return pub.board.vertices
    .filter(v => land(v) && !taken[v.id] && neighbours(pub, v.id).every(n => !taken[n]))
    .sort((a, b) => score(b.tiles) - score(a.tiles) || a.id.localeCompare(b.id))
    .map(v => v.id);
}

export function build(pub: PublicView, seat: SeatId, vertex: VertexId, kind: BuildingKind = 'settlement') {
  pub.pieces.buildings[vertex] = { vertex, seat, kind };
}

/** Lays up to n connected roads (or ships) from a vertex along free edges; returns the edges used. */
export function lay(pub: PublicView, seat: SeatId, from: VertexId, n: number, kind: RouteKind = 'road') {
  const used: string[] = [];
  let at = from;
  for (let i = 0; i < n; i++) {
    const edge = pub.board.edges.find(e => (e.a === at || e.b === at) && !pub.pieces.routes[e.id]
      && (kind === 'road' ? e.land : e.sea));
    if (!edge) break;
    pub.pieces.routes[edge.id] = { edge: edge.id, seat, kind };
    used.push(edge.id);
    const next = edge.a === at ? edge.b : edge.a;
    const blocker = pub.pieces.buildings[next];
    if (blocker && blocker.seat !== seat) break;
    at = next;
  }
  return used;
}

/** Opening: each seat takes the next best spot and a road, snake order, `rounds` times. */
export function settleAll(pub: PublicView, rounds: number, roads = 1) {
  const order = pub.seats.map(s => s.id);
  for (let r = 0; r < rounds; r++) {
    for (const seat of r % 2 ? [...order].reverse() : order) {
      const spot = openSpots(pub)[0];
      if (!spot) return;
      build(pub, seat, spot);
      lay(pub, seat, spot, roads);
    }
  }
}

/** Upgrades a seat's first n settlements to cities. */
export function upgrade(pub: PublicView, seat: SeatId, n: number) {
  Object.values(pub.pieces.buildings).filter(b => b.seat === seat && b.kind === 'settlement')
    .slice(0, n).forEach(b => { b.kind = 'city'; });
}

// ---------------------------------------------------------------- derived fields

export const total = (cards: Cards) => Object.values(cards).reduce((sum, n) => sum + (n ?? 0), 0);

/** Recomputes seat scores, card counts, pieces left and the bank from pieces, awards and hands. */
export function finish(pub: PublicView, hands: Record<SeatId, Cards>) {
  const buildings = Object.values(pub.pieces.buildings), routes = Object.values(pub.pieces.routes);
  for (const seat of pub.seats) {
    const own = buildings.filter(b => b.seat === seat.id), mine = routes.filter(r => r.seat === seat.id);
    const count = (kind: string) => own.filter(b => b.kind === kind).length;
    const parts = [
      { key: 'settlements', label: 'Settlements', points: count('settlement'), count: count('settlement') },
      { key: 'cities', label: 'Cities', points: 2 * count('city'), count: count('city') },
      { key: 'harbors', label: 'Harbor settlements', points: 2 * count('harbor'), count: count('harbor') },
      ...(['longest-road', 'largest-army'] as const).filter(a => pub.awards[a] === seat.id).map(a =>
        ({ key: a, label: a === 'longest-road' ? 'Longest road' : 'Largest army', points: 2, count: 1 })),
    ].filter(p => p.count > 0);
    seat.parts = parts;
    seat.vp = parts.reduce((sum, p) => sum + p.points, 0);
    seat.cards = total(hands[seat.id] ?? {});
    seat.longestRoute = Math.min(mine.length, 15);
    seat.left = {
      roads: Math.max(0, PIECE_LIMITS.roads - mine.filter(r => r.kind === 'road').length),
      ships: Math.max(0, PIECE_LIMITS.ships - mine.filter(r => r.kind === 'ship').length),
      settlements: Math.max(0, PIECE_LIMITS.settlements - count('settlement')),
      cities: Math.max(0, PIECE_LIMITS.cities - count('city')),
    };
  }
  const held = (good: Good) => Object.values(hands).reduce((sum, h) => sum + (h[good] ?? 0), 0);
  pub.bank = Object.fromEntries(RESOURCES.map(g => [g, Math.max(0, supply(pub.seats.length) - held(g))]));
  return pub;
}

// ---------------------------------------------------------------- fixtures

export type Fixture = {
  name: string;
  description: string;
  /** Server time the snapshot represents; the preview clock starts here. */
  now: number;
  /** Default seat for controller/personal previews. */
  seat: SeatId;
  pub: PublicView;
  views: Record<SeatId, PrivateView>;
};

export const fixture = (f: Omit<Fixture, 'views'> & { views: PrivateView[] }): Fixture =>
  ({ ...f, views: Object.fromEntries(f.views.map(v => [v.seat, v])) });

/** Starts the public clock for a step and marks who owes it (status + deadline on the rail). */
export function clock(pub: PublicView, step: TimedStep, seats: SeatId[], startedAt: number, status: SeatStatus) {
  const seconds = step === 'main' && pub.settings.mode === 'connect' ? pub.settings.roundSeconds
    : TIMERS[pub.settings.timer][step] ?? 0;
  const deadline = startedAt + seconds * 1000;
  pub.clock = { step, seats, startedAt, deadline };
  for (const s of pub.seats.filter(x => seats.includes(x.id))) Object.assign(s, { status, deadline });
  return deadline;
}
