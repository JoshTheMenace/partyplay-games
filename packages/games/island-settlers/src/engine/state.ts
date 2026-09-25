/** Engine state (server-only). Plain JSON-like data: the fixed part is shared, the rest cloned per commit. */
import type {
  AwardId, Blocked, Board, BuildingKind, CpuLevel, DevKind, EdgeId, EventDie, GameEvent, Good, Grant, IntentPiece,
  ModuleId, Offer, Pieces, PrivateEvent, PromptKind, Results, Reveal, RollEvent, RouteKind, SeatId,
  Settings, Stats, TileId, TimedStep, Turn,
} from '../model';
import type { Hand } from './cards';
import type { Profile } from './profile';
import { sfc32, type Streams } from './rng';
import { need } from './need';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type CpuState = {
  level: CpuLevel;
  /** Persona id and its label ("Harbor trader"). */
  persona: string; label: string;
  nextAt: number; memory: unknown;
  /** Actions left this opportunity (Connect: this round). */
  budget: number;
  /** Key of the duty the CPU last woke for; a new key schedules a fresh think delay. */
  duty: string;
  /** Consecutive "nothing to do" answers while owing a duty. */
  idle: number;
};

export type DevCardState = { id: string; kind: DevKind; boughtAt: number };

export type Seat = {
  id: SeatId; name: string; color: string;
  /** Unique palette index into SEAT_COLORS. */
  seat: number;
  cpu: CpuState | null;
  connected: boolean; away: boolean;
  /** Consecutive turns (by turn id) in which this seat was auto-played. */
  autoStreak: number; autoTurn: number;
  hand: Hand;
  dev: DevCardState[];
  /** Opportunity number of the last non-VP card played. */
  devPlayedAt: number;
  /** Increments at the start of each of this seat's opportunities. */
  opportunity: number;
  knights: number; longestRoute: number;
  /** Road Building / module grants to place for free. */
  freeRoutes: number;
  /** Made a movement command this opportunity. */
  moved: boolean;
  /** Ships placed this opportunity (a ship built this turn cannot move; WP-seafarers enforces it). */
  shipsBuilt: EdgeId[];
  /** Connect: done this round. Standard: pre-skipped the paired build turn. */
  ready: boolean;
  emoteAt: number;
  inbox: PrivateEvent[];
};

export type SetupStep = {
  seat: SeatId; piece: BuildingKind | RouteKind; round: number;
  /** Route steps must touch `turn.anchor` (the building just placed). */
  anchorRequired: boolean;
};

export type TurnState = Turn & {
  setupPlan: SetupStep[];
  setupIndex: number;
  /** Building the current setup route must touch. */
  anchor: string | null;
  /** Index in `order` of Player 1 (Standard) or the roller (Connect). */
  captain: number;
  /** When the current main step or Connect window opened. */
  openedAt: number;
  activeDone: boolean;
  partnerDone: boolean;
  /** Opportunities started so far (results). */
  opportunities: number;
};

/** A step deadline owed by one seat. base: the preset deadline; deadline: after disconnect grace. */
export type Timer = { step: TimedStep; startedAt: number; base: number | null; deadline: number | null };

/** A roll being resolved; becomes the public RollEvent once production is done. */
export type RollDraft = {
  seat: SeatId | null; dice: [number, number]; total: number; eventDie: EventDie | null;
  grants: Grant[]; blocked: Blocked[]; shortages: Good[];
  /** Gold picks owed per seat. */
  gold: Record<SeatId, number>;
};

export type Effect =
  | { type: 'roll'; seat: SeatId | null }
  | { type: 'produce'; roll: RollDraft }
  | { type: 'seven'; seat: SeatId | null }
  | { type: 'robber'; seat: SeatId; scope: 'table' | 'self' }
  /** The roll is resolved: open the main step (Standard) or the Connect window. */
  | { type: 'main' }
  | { type: 'end-opportunity' }
  | { type: 'end-round' }
  | { type: 'module'; module: ModuleId; name: string; data: Json };

/** Effects that change the stage; they wait until every prompt is closed. */
export const TRANSITIONS: readonly Effect['type'][] = ['main', 'end-opportunity', 'end-round'];

export type OpenPrompt = {
  id: string; seat: SeatId; kind: PromptKind; scope: 'table' | 'self';
  openedAt: number; base: number | null; deadline: number | null; turnId: number; data: Json;
};

export type OpenOffer = Offer;

export type State = {
  // Fixed at create: shared by clones, never mutated.
  board: Board;
  settings: Settings;
  modules: ModuleId[];
  profile: Profile;
  /** Fog faces, server-only. */
  hidden: Record<TileId, Reveal>;

  // Mutable: cloned by commit.
  /** Server time of the commit in progress. */
  now: number;
  rev: number;
  mapRev: number;
  mapDirty: boolean;
  /** Id counter for events, prompts, offers and cards. */
  serial: number;
  rng: Streams;
  diceDeck: [number, number][] | null;
  lastTotal: number | null;
  order: SeatId[];
  seats: Record<SeatId, Seat>;
  bank: Hand;
  devDeck: DevKind[];
  pieces: Pieces;
  turn: TurnState;
  timers: Record<SeatId, Timer>;
  queue: Effect[];
  prompts: Record<string, OpenPrompt>;
  offers: Record<string, OpenOffer>;
  awards: Partial<Record<AwardId, SeatId | null>>;
  events: GameEvent[];
  lastRoll: RollEvent | null;
  stats: Stats;
  results: Results | null;
  intent: { seat: SeatId; piece: IntentPiece } | null;
  startedAt: number;
  /** Module-owned state, typed by each module. */
  ext: Partial<Record<ModuleId, unknown>>;
};

export const FIXED = ['board', 'settings', 'modules', 'profile', 'hidden'] as const;

/** Deep copy of the mutable part; the fixed part is shared. */
export function cloneState(s: State): State {
  const { board, settings, modules, profile, hidden, ...rest } = s;
  return { ...structuredClone(rest), board, settings, modules, profile, hidden };
}

export function seat(s: State, id: SeatId): Seat {
  const found = s.seats[id];
  need(found, 'This seat is not in the game.');
  return found;
}

export const seatName = (s: State, id: SeatId | null) => (id && s.seats[id]?.name) || 'Nobody';

export const nextId = (s: State, prefix: string) => `${prefix}${++s.serial}`;

export const queueEffect = (s: State, effect: Effect) => { s.queue.push(effect); };

/** Queue an effect to run before everything already queued. */
export const pushEffect = (s: State, effect: Effect) => { s.queue.unshift(effect); };

/** A generator over one of the state's RNG streams (advances the stream in place). */
export const random = (s: State, stream: keyof Streams) => () => sfc32(s.rng[stream]);
