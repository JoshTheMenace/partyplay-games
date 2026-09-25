/**
 * Cities & Knights module state (s.ext['cities-knights']) and the small helpers every C&K file shares:
 * decks, per-seat extras, knights (pieces.units of kind 'knight') and the "may act now" gate.
 */
import type {
  Commodity, EventDie, Good, ProgressKind, SeatId, TileId, Track, Unit, UnitId, VertexId,
} from '../../../model';
import { emit } from '../../events';
import { role } from '../../flow';
import { seatPrompts, tablePromptOpen } from '../../prompts';
import { shuffle } from '../../rng';
import { random, type State } from '../../state';

export type Held = { id: string; kind: ProgressKind; track: Track };

export type SeatX = {
  improvements: Record<Track, number>;
  progress: Held[];
  /** Printer / Constitution points (public). */
  points: number;
  /** "Defender of Catan" points. */
  defender: number;
  /** Merchant Fleet goods at 2:1 for this opportunity. */
  fleet: Good[];
  /** Commercial Harbor: seats already offered this opportunity, or null when not played. */
  harbor: SeatId[] | null;
};

export type CkState = {
  /** Barbarian ship position 0..LENGTH (attack on arrival). */
  position: number;
  attacks: number;
  lastEvent: EventDie | null;
  /** Face-down decks; index 0 is the top, played and discarded cards go to the end. */
  decks: Record<Track, ProgressKind[]>;
  seats: Record<SeatId, SeatX>;
  /** Seat opportunity numbers when each knight was last activated / promoted. */
  knights: Record<UnitId, { activated: number; promoted: number }>;
  /** Alchemist: production dice for the next roll (red, yellow). */
  alchemy: [number, number] | null;
  /** Where the robber enters play after the first attack. */
  start: TileId | null;
  /** Cities pillaged while the owner had no settlement left: must be rebuilt first. */
  overflow: VertexId[];
};

export const LENGTH = 7;
export const HAND_LIMIT = 4;
export const MAX_WALLS = 3;
export const PER_LEVEL = 2;
export const TRACK_GOOD: Record<Track, Commodity> = { science: 'paper', trade: 'cloth', politics: 'coin' };
export const TRACK_LABEL: Record<Track, string> = { science: 'Science', trade: 'Trade', politics: 'Politics' };
/** Event die: three ship faces and one gate per track. */
export const EVENT_FACES: readonly EventDie[] = ['ship', 'ship', 'ship', 'science', 'trade', 'politics'];

/** Official 54-card decks (classic names), 18 per track. */
export const DECKS: Record<Track, [ProgressKind, number][]> = {
  science: [['alchemist', 2], ['crane', 2], ['engineer', 1], ['inventor', 2], ['irrigation', 2],
    ['medicine', 2], ['mining', 2], ['printer', 1], ['road-building', 2], ['smith', 2]],
  trade: [['commercial-harbor', 2], ['master-merchant', 2], ['merchant', 6], ['merchant-fleet', 2],
    ['resource-monopoly', 4], ['trade-monopoly', 2]],
  politics: [['bishop', 2], ['constitution', 1], ['deserter', 2], ['diplomat', 2], ['intrigue', 2],
    ['saboteur', 2], ['spy', 3], ['warlord', 2], ['wedding', 2]],
};

export const LABELS: Record<ProgressKind, string> = {
  alchemist: 'Alchemist', crane: 'Crane', engineer: 'Engineer', inventor: 'Inventor', irrigation: 'Irrigation',
  medicine: 'Medicine', mining: 'Mining', printer: 'Printer', 'road-building': 'Road Building', smith: 'Smith',
  'commercial-harbor': 'Commercial Harbor', 'master-merchant': 'Master Merchant', merchant: 'Merchant',
  'merchant-fleet': 'Merchant Fleet', 'resource-monopoly': 'Resource Monopoly', 'trade-monopoly': 'Trade Monopoly',
  bishop: 'Bishop', constitution: 'Constitution', deserter: 'Deserter', diplomat: 'Diplomat', intrigue: 'Intrigue',
  saboteur: 'Saboteur', spy: 'Spy', warlord: 'Warlord', wedding: 'Wedding',
};

/** Commodity stock per type: 12 in the box, scaled with the resource bank for bigger tables (adaptation). */
export const commodityStock = (seats: number) => (seats <= 4 ? 12 : seats <= 6 ? 15 : seats <= 8 ? 18 : 22);

export function initState(s: State): CkState {
  const copies = s.order.length >= 7 ? 2 : 1, shuffled = random(s, 'cards');
  const deck = (t: Track) => shuffle(DECKS[t].flatMap(([k, n]) => Array<ProgressKind>(n * copies).fill(k)), shuffled);
  const seat = (): SeatX => ({
    improvements: { science: 0, trade: 0, politics: 0 }, progress: [], points: 0, defender: 0,
    fleet: [], harbor: null,
  });
  return {
    position: 0, attacks: 0, lastEvent: null,
    decks: { science: deck('science'), trade: deck('trade'), politics: deck('politics') },
    seats: Object.fromEntries(s.order.map(id => [id, seat()])), knights: {}, alchemy: null,
    start: s.pieces.robber, overflow: [],
  };
}

export const ck = (s: State) => s.ext['cities-knights'] as CkState;
export const sx = (s: State, seat: SeatId) => ck(s).seats[seat];
export const level = (s: State, seat: SeatId, track: Track) => sx(s, seat).improvements[track];

/** Barbarian Attack replaces the ship track and our knights (official combination). */
export const shipTrack = (s: State) => !s.profile.coastalBarbarians;

export const knightsOf = (s: State, seat?: SeatId): Unit[] => Object.values(s.pieces.units)
  .filter(u => u.kind === 'knight' && (!seat || u.seat === seat));

export const knightAt = (s: State, v: VertexId) => knightsOf(s).find(u => u.at === v);

/** Active knight strength (the seat's contribution against the barbarians). */
export const strength = (s: State, seat: SeatId) =>
  knightsOf(s, seat).filter(k => k.active).reduce((n, k) => n + k.level, 0);

/** Nothing stands here: no building and no unit. */
export const empty = (s: State, v: VertexId) =>
  !s.pieces.buildings[v] && !Object.values(s.pieces.units).some(u => u.at === v);

export const cities = (s: State, seat?: SeatId) => Object.values(s.pieces.buildings)
  .filter(b => b.kind === 'city' && (!seat || b.seat === seat));

/** The seat's own build step (main, paired, Connect window) with no decision pending or movement lock. */
export function acting(s: State, seat: SeatId): boolean {
  const r = role(s, seat);
  if (r !== 'main' && r !== 'paired' && r !== 'round') return false;
  if (tablePromptOpen(s) || seatPrompts(s, seat).length) return false;
  return !(s.profile.movementLocksBuilding && s.seats[seat].moved);
}

/** A seat owes a prompt of this kind already (at most one per seat per kind). */
export const hasPrompt = (s: State, seat: SeatId, kind: string) =>
  Object.values(s.prompts).some(p => p.seat === seat && p.kind === `cities-knights/${kind}`);

/** A public `module` event (ticker text; `target` is the vertex, edge or tile involved). */
export const note = (s: State, name: string, seat: SeatId | null, target: string | null, text: string) =>
  emit(s, { kind: 'module', module: 'cities-knights', name, seat, target, text });
