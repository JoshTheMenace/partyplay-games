/**
 * Island Settlers v2: the browser-safe contract shared by the engine, the CPU and the UI.
 *
 * Types and small constants only. The client may import this file at runtime, so it must
 * never import from src/engine or src/cpu. Hands, decks, fog faces and RNG state appear
 * only in the owner's PrivateView (or nowhere). Every projection must be serializable:
 * optional properties are omitted, never set to undefined.
 */

// ---------------------------------------------------------------- goods and ids

export const RESOURCES = ['wood', 'brick', 'wool', 'grain', 'ore'] as const;
export const COMMODITIES = ['paper', 'cloth', 'coin'] as const;
export const GOODS = [...RESOURCES, ...COMMODITIES] as const;
export type Resource = (typeof RESOURCES)[number];
export type Commodity = (typeof COMMODITIES)[number];
export type Good = Resource | Commodity;

/** Sparse card counts. A missing key means zero; values are non-negative integers. */
export type Cards = Partial<Record<Good, number>>;

export type SeatId = string;
export type TileId = string;
export type VertexId = string;
export type EdgeId = string;
export type UnitId = string;

// ---------------------------------------------------------------- settings

export const MODES = ['standard', 'connect'] as const;
export const MAPS = ['base', 'seafarers', 'explorers'] as const;
export const SEAFARERS_SCENARIOS = ['new-shores', 'four-islands', 'fog-islands'] as const;
export const SCENARIOS = ['fishing', 'rivers', 'caravans', 'barbarian-attack', 'deliveries'] as const;
export const VARIANTS = ['friendly-robber', 'harbormaster'] as const;
/** Explorers & Pirates missions. "Land Ho!" (exploring and settling) is always on. */
export const MISSIONS = ['lairs', 'fish', 'spices'] as const;
export const TIMER_PRESETS = ['off', 'relaxed', 'brisk'] as const;
export const CPU_LEVELS = ['easy', 'normal', 'sharp'] as const;
export const ROUND_SECONDS = [60, 90, 120] as const;

export type Mode = (typeof MODES)[number];
export type MapKind = (typeof MAPS)[number];
export type SeafarersScenario = (typeof SEAFARERS_SCENARIOS)[number];
export type Scenario = (typeof SCENARIOS)[number];
export type Variant = (typeof VARIANTS)[number];
export type Mission = (typeof MISSIONS)[number];
export type TimerPreset = (typeof TIMER_PRESETS)[number];
export type CpuLevel = (typeof CPU_LEVELS)[number];
export type RoundSeconds = (typeof ROUND_SECONDS)[number];

/** Rule families. Each one is a module in the engine registry. */
export const MODULE_IDS = [
  'seafarers', 'explorers', 'cities-knights',
  'fishing', 'rivers', 'caravans', 'barbarian-attack', 'deliveries',
  'friendly-robber', 'harbormaster',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export type Settings = {
  mode: Mode;
  map: MapKind;
  /** Read only when map is 'seafarers'. */
  seafarers: SeafarersScenario;
  citiesKnights: boolean;
  scenarios: Scenario[];
  variants: Variant[];
  /** Read only when map is 'explorers'. */
  missions: Mission[];
  targetPoints: number;
  timer: TimerPreset;
  /** Connect-style action window. */
  roundSeconds: RoundSeconds;
  /** Total seats. CPUs fill empty seats up to this count; with more humans the table grows to fit. */
  tableSize: number;
  cpuLevel: CpuLevel;
  balancedDice: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  mode: 'standard',
  map: 'base',
  seafarers: 'new-shores',
  citiesKnights: false,
  scenarios: [],
  variants: [],
  missions: ['lairs', 'fish', 'spices'],
  targetPoints: 10,
  timer: 'relaxed',
  roundSeconds: 90,
  tableSize: 4,
  cpuLevel: 'normal',
  balancedDice: false,
};

export const TABLE_SIZE = { min: 3, max: 10 } as const;
export const TARGET_RANGE = { min: 8, max: 30 } as const;

// ---------------------------------------------------------------- timers

export type TimedStep = 'setup' | 'roll' | 'main' | 'paired' | 'discard' | 'robber' | 'prompt' | 'offer';

/** Seconds per step; null means no deadline. Connect rounds use Settings.roundSeconds. */
export const TIMERS: Record<TimerPreset, Record<TimedStep, number | null>> = {
  off: {
    setup: null, roll: null, main: null, paired: null,
    discard: null, robber: null, prompt: null, offer: null,
  },
  relaxed: {
    setup: 60, roll: 15, main: 120, paired: 45,
    discard: 40, robber: 30, prompt: 40, offer: 45,
  },
  brisk: {
    setup: 30, roll: 8, main: 60, paired: 25,
    discard: 20, robber: 15, prompt: 20, offer: 25,
  },
};

/** Disconnect policy: only a seat that must act is ever waited on, and only this long. */
export const GRACE_SECONDS = {
  /** A disconnected seat that owes an action gets this long before auto-play. */
  disconnected: 30,
  /** After two auto-played opportunities a seat is "away" and gets only this long. */
  away: 5,
  /** Minimum time left on a deadline when the seat reconnects. */
  reconnect: 15,
} as const;

/** Connect: once every seat is ready the round still stays open this long. */
export const CONNECT_MIN_OPEN_SECONDS = 2;

/** The finale (hidden-VP reveal) holds this long before outcome().complete turns true. */
export const FINALE_MS = 9000;

/** Room colour order (room-server COLORS). PublicSeat.seat is an index into it. */
export const SEAT_COLORS = [
  '#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a',
  '#ff90ba', '#56decd', '#ffa260', '#97aeff', '#e2ef93',
] as const;

// ---------------------------------------------------------------- costs and supplies

export type BuildPiece = 'road' | 'ship' | 'settlement' | 'city';
export type Purchase = BuildPiece | 'development';

export const COSTS: Record<Purchase, Cards> = {
  road: { wood: 1, brick: 1 },
  ship: { wood: 1, wool: 1 },
  settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  development: { wool: 1, grain: 1, ore: 1 },
};

export const PIECE_LIMITS = { roads: 15, ships: 15, settlements: 5, cities: 4 } as const;

export const DEV_KINDS = ['knight', 'road-building', 'plenty', 'monopoly', 'victory'] as const;
export type DevKind = (typeof DEV_KINDS)[number];

/** Limits the projections respect so views stay small. */
export const VIEW_LIMITS = { events: 40, inbox: 12, openOffers: 12, offersPerSeat: 1 } as const;

// ---------------------------------------------------------------- board

export type Terrain =
  | Resource | 'desert' | 'gold' | 'sea' | 'fog' | 'lake' | 'oasis'
  | 'castle' | 'quarry' | 'glassworks' | 'spice' | 'shoal' | 'council';

/** Pointy-top axial hex. x/y are world units with circumradius 1 (see geometry.ts). */
export type Tile = {
  id: TileId;
  q: number;
  r: number;
  x: number;
  y: number;
  terrain: Terrain;
  /** Number token, or 0 for none. */
  number: number;
  /** -1 sea, 0 home island, 1+ outer islands. */
  island: number;
};

export type Vertex = { id: VertexId; x: number; y: number; tiles: TileId[]; edges: EdgeId[]; coast: boolean };
export type Edge = { id: EdgeId; a: VertexId; b: VertexId; tiles: TileId[]; land: boolean; sea: boolean };

export type Port = {
  id: string;
  edge: EdgeId;
  vertices: [VertexId, VertexId];
  good: Resource | 'any';
  ratio: 2 | 3;
  /** Sea tile the port sits on, for orientation. */
  tile: TileId;
};

export type DepotKind = 'castle' | 'quarry' | 'glassworks';
export type SpiceBenefit = 'speed' | 'pirate' | 'gold';

/** Static scenario features, fixed when the board is generated. */
export type BoardFeature =
  | { kind: 'fishing-ground'; id: string; tile: TileId; vertices: VertexId[]; numbers: number[] }
  | { kind: 'river'; id: string; edges: EdgeId[]; tiles: TileId[] }
  | { kind: 'bridge-site'; id: string; edge: EdgeId }
  | { kind: 'depot'; id: string; tile: TileId; vertex: VertexId; depot: DepotKind }
  | { kind: 'landing'; id: string; tile: TileId; path: TileId[] }
  | { kind: 'lair'; id: string; tile: TileId }
  | { kind: 'spice'; id: string; tile: TileId; benefit: SpiceBenefit }
  | { kind: 'council'; id: string; tile: TileId }
  /** C&K barbarian ship waypoints: 8 sea tiles in track order (positions 0-7). */
  | { kind: 'barbarian-path'; id: string; tiles: TileId[] };

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Immutable for the whole round. Hidden hexes appear as terrain 'fog'; see Pieces.reveals. */
export type Board = {
  tiles: Tile[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
  features: BoardFeature[];
  bounds: Bounds;
};

// ---------------------------------------------------------------- pieces

export type Track = 'science' | 'trade' | 'politics';
export const TRACKS = ['science', 'trade', 'politics'] as const satisfies readonly Track[];

export type BuildingKind = 'settlement' | 'city' | 'harbor';
export type RouteKind = 'road' | 'ship';
export type Building = { vertex: VertexId; seat: SeatId; kind: BuildingKind; wall?: true; metropolis?: Track };
export type Route = { edge: EdgeId; seat: SeatId; kind: RouteKind; bridge?: true };

export type CargoKind = 'settler' | 'crew' | 'fish' | 'spice' | 'tools' | 'sand' | 'marble' | 'glass';

/**
 * Movable or countable board pieces from every module.
 * knight/wagon at a vertex, guard/expedition/camel/raider on an edge, barbarian on a tile.
 */
export type UnitKind = 'knight' | 'guard' | 'expedition' | 'wagon' | 'camel' | 'raider' | 'barbarian';
export type Unit = {
  id: UnitId;
  kind: UnitKind;
  seat: SeatId | null;
  at: string;
  /** Knight/guard strength, wagon level, barbarian count, expedition cargo slots; else 0. */
  level: number;
  active: boolean;
  cargo: CargoKind[];
};

/** A fog hex once discovered. The Board itself never changes. */
export type Reveal = { terrain: Terrain; number: number; feature?: BoardFeature };

/** Cached with the board (manifest snapshotCache). Changes bump PublicView.mapRev. */
export type Pieces = {
  buildings: Record<VertexId, Building>;
  routes: Record<EdgeId, Route>;
  units: Record<UnitId, Unit>;
  robber: TileId | null;
  pirate: TileId | null;
  merchant: { tile: TileId; seat: SeatId } | null;
  reveals: Record<TileId, Reveal>;
};

// ---------------------------------------------------------------- scoring, stats, results

export type AwardId = 'longest-road' | 'largest-army' | 'harbormaster' | 'wealthiest' | 'old-boot';

/** One line of a score breakdown. Hidden parts only appear privately and in results. */
export type ScorePart = { key: string; label: string; points: number; count: number; hidden?: true };

export type SeatStats = {
  gained: Cards;
  /** Cards received from rolls. */
  produced: number;
  /** Cards the robber (or a blocking piece) kept from this seat. */
  blocked: number;
  /** Cards stolen from this seat / by this seat (robber, pirate, knights; not Monopoly). */
  robbed: number;
  stole: number;
  discarded: number;
  trades: number;
  bankTrades: number;
  devBought: number;
  knights: number;
  longestRoute: number;
  largestHand: number;
  timeouts: number;
  opportunities: number;
};

export type Stats = {
  /** Index = dice total (0 and 1 unused). */
  dice: number[];
  seats: Record<SeatId, SeatStats>;
  /** Public VP at the end of each round, per seat. */
  vpByRound: Record<SeatId, number[]>;
};

export type EndReason = 'target' | 'round-limit';

export type Standing = { seat: SeatId; rank: number; vp: number; parts: ScorePart[] };

export type Results = {
  winners: SeatId[];
  /** Finale window: the reveal plays from finaleAt; outcome completes at completeAt. */
  finaleAt: number;
  completeAt: number;
  reason: EndReason;
  rounds: number;
  opportunities: number;
  durationMs: number;
  standings: Standing[];
  stats: Stats;
};

// ---------------------------------------------------------------- command protocol

/**
 * Server-authored choices. The phone edits a local draft from these options; the server
 * re-validates membership and charges `cost` on confirmation. CPUs use the same shapes.
 */
export type Choice = { value: string; label: string; detail?: string; then?: Field[] };

/** Pick one option. `target` tells the UI to pick on the map or from seats. */
export type PickField = {
  kind: 'pick';
  key: string;
  label: string;
  options: Choice[];
  target?: 'tile' | 'vertex' | 'edge' | 'seat' | 'unit' | 'good' | 'track';
  optional?: true;
};

/** Choose a card selection from the hand or the bank. */
export type CardsField = {
  kind: 'cards';
  key: string;
  label: string;
  source: 'hand' | 'bank';
  allowed: Good[];
  available: Cards;
  min: number;
  max: number;
};

export type Field = PickField | CardsField;

export type CommandGroup =
  | 'build' | 'trade' | 'cards' | 'knights' | 'city' | 'progress'
  | 'fishing' | 'rivers' | 'caravans' | 'barbarians' | 'deliveries' | 'ships' | 'missions';

export type Command = {
  id: string;
  module: ModuleId | 'core';
  group: CommandGroup;
  label: string;
  detail: string;
  cost: Cards | null;
  fields: Field[];
  /** Engine-estimated usefulness 0..1. UI may badge high values; CPUs use it as a prior. */
  hint: number;
};

/** Core prompts. The robber prompt also covers the pirate (its first field picks the piece). */
export type CorePromptKind = 'discard' | 'robber' | 'gold';
export type PromptKind = CorePromptKind | `${ModuleId}/${string}`;

/**
 * A decision owed by one seat. Many prompts can be open at once (simultaneous discards).
 * scope 'table' pauses the shared flow until answered; 'self' blocks only its owner.
 */
export type Prompt = {
  id: string;
  kind: PromptKind;
  scope: 'table' | 'self';
  deadline: number | null;
  /** What happens on timeout, e.g. "Random discard". */
  auto: string;
  command: Command;
};

/** Public "who are we waiting for" chip. count: cards to discard or picks owed, else null. */
export type PromptChip = {
  id: string; seat: SeatId; kind: PromptKind; label: string; count: number | null; deadline: number | null;
};

// ---------------------------------------------------------------- actions

export type Picks = Record<string, string>;
export type CardPicks = Record<string, Cards>;
export const EMOTES = ['nice', 'ouch', 'deal', 'no-way', 'hurry', 'gg'] as const;
export type Emote = (typeof EMOTES)[number];

/** Every action carries the game-owned turn id; stale ids are rejected. Payload <= 1024 B. */
export type Action =
  | { type: 'roll'; turnId: number }
  /** End turn, finish the paired build turn, or mark ready in a Connect round. */
  | { type: 'end'; turnId: number }
  | { type: 'build'; turnId: number; piece: BuildPiece; at: string }
  | { type: 'move-ship'; turnId: number; from: EdgeId; to: EdgeId }
  | { type: 'buy-dev'; turnId: number }
  /** goods: two for Year of Plenty, one for Monopoly, none otherwise. */
  | { type: 'play-dev'; turnId: number; card: string; goods: Resource[] }
  /** Any number of lots at once; each give good must be a multiple of its rate. */
  | { type: 'bank'; turnId: number; give: Cards; get: Cards }
  /** to: explicit targets, or [] for everyone eligible. counterTo: the offer being countered. */
  | { type: 'offer'; turnId: number; give: Cards; want: Cards; to: SeatId[]; counterTo: string | null }
  /** A seat may change its answer until the trade completes. reason: optional one-liner (<= 80). */
  | { type: 'respond'; turnId: number; offer: string; answer: 'accept' | 'decline'; reason?: string }
  | { type: 'confirm-trade'; turnId: number; offer: string; partner: SeatId }
  | { type: 'withdraw'; turnId: number; offer: string }
  | { type: 'answer'; turnId: number; prompt: string; picks: Picks; cards: CardPicks }
  | { type: 'command'; turnId: number; command: string; picks: Picks; cards: CardPicks }
  /** Pre-commit to skipping your upcoming paired build turn (5+ seats, Standard). */
  | { type: 'skip-paired'; turnId: number; skip: boolean }
  /** Optional: tell the TV which placement the phone is choosing (null when leaving it). */
  | { type: 'intent'; turnId: number; piece: IntentPiece | null }
  | { type: 'emote'; turnId: number; emote: Emote };

export type ActionType = Action['type'];
export const ACTION_LIMITS = { maxBytes: 1024, perPlayer: 4096 } as const;

// ---------------------------------------------------------------- events

export type EventDie = 'ship' | Track;
export type Grant = { seat: SeatId; tile: TileId; good: Good; amount: number };
export type Blocked = { seat: SeatId; tile: TileId; good: Good; amount: number; by: 'robber' | 'barbarians' };
export type PieceKind = BuildPiece | 'harbor' | 'wall' | 'knight' | 'bridge' | 'metropolis' | UnitKind;
export type IntentPiece = BuildPiece | 'knight' | 'move';

type EventBase = { id: number; at: number; text: string };

/** Production result of one roll. Also kept as PublicView.lastRoll until the next roll. */
export type RollEvent = EventBase & {
  kind: 'roll';
  seat: SeatId | null;
  /** dice[0] is the red die in Cities & Knights. */
  dice: [number, number];
  total: number;
  eventDie: EventDie | null;
  grants: Grant[];
  blocked: Blocked[];
  /** Goods nobody received because the bank ran short. */
  shortages: Good[];
};

export type GameEvent =
  | RollEvent
  | (EventBase & { kind: 'turn'; seat: SeatId | null; stage: Stage; round: number })
  /** spot: the vertex or edge built on (the engine always sets it; `at` collides with EventBase.at). */
  | (EventBase & { kind: 'build'; seat: SeatId; piece: PieceKind; at: string; spot?: string; free: boolean })
  | (EventBase & {
      kind: 'robber'; seat: SeatId; piece: 'robber' | 'pirate';
      from: TileId | null; tile: TileId; victim: SeatId | null;
    })
  | (EventBase & { kind: 'steal'; seat: SeatId; victim: SeatId; count: number })
  | (EventBase & { kind: 'discard'; seat: SeatId; count: number })
  | (EventBase & { kind: 'trade'; offer: string; seat: SeatId; partner: SeatId; give: Cards; get: Cards })
  | (EventBase & {
      kind: 'offer'; offer: string; seat: SeatId; change: 'posted' | 'withdrawn' | 'expired' | 'invalid';
    })
  | (EventBase & { kind: 'bank'; seat: SeatId; give: Cards; get: Cards })
  | (EventBase & { kind: 'take'; seat: SeatId; cards: Cards })
  /** Resources paid from hexes outside a roll: setup round 2, fog discoveries. */
  | (EventBase & { kind: 'payout'; seat: SeatId; grants: Grant[] })
  /** One step of a moving piece (ship, knight, wagon, expedition, guard). unit is null for ships. */
  | (EventBase & {
      kind: 'move'; seat: SeatId; piece: RouteKind | UnitKind; unit: UnitId | null; from: string; to: string;
    })
  | (EventBase & { kind: 'dev-buy'; seat: SeatId })
  /** taken: Monopoly cards per victim ({} otherwise). */
  | (EventBase & {
      kind: 'dev-play'; seat: SeatId; card: DevKind; goods: Resource[]; count: number;
      taken: Record<SeatId, number>;
    })
  | (EventBase & { kind: 'award'; award: AwardId; seat: SeatId | null; from: SeatId | null })
  | (EventBase & { kind: 'reveal'; seat: SeatId | null; tile: TileId; terrain: Terrain })
  | (EventBase & { kind: 'auto'; seat: SeatId; step: TimedStep; reason: 'timeout' | 'disconnected' | 'error' })
  | (EventBase & { kind: 'presence'; seat: SeatId; connected: boolean })
  | (EventBase & { kind: 'emote'; seat: SeatId; emote: Emote })
  /** C&K barbarian ship arrival or a Barbarian Attack battle. */
  | (EventBase & {
      kind: 'barbarians'; strength: number; defense: number; result: 'defended' | 'pillaged';
      losers: SeatId[]; defenders: SeatId[];
    })
  | (EventBase & { kind: 'module'; module: ModuleId; name: string; seat: SeatId | null; target: string | null })
  | (EventBase & { kind: 'win'; seats: SeatId[]; reason: EndReason });

export type GameEventKind = GameEvent['kind'];

/** Owner-only toast: exact cards stolen, drawn, lost or received. other: the thief, victim or partner. */
export type PrivateEvent = {
  id: number; at: number; text: string; cards: Cards; tone: 'gain' | 'loss' | 'info'; other: SeatId | null;
};

// ---------------------------------------------------------------- module projections

export type ProgressKind =
  | 'alchemist' | 'crane' | 'engineer' | 'inventor' | 'irrigation' | 'medicine' | 'mining'
  | 'printer' | 'road-building' | 'smith'
  | 'commercial-harbor' | 'master-merchant' | 'merchant' | 'merchant-fleet'
  | 'resource-monopoly' | 'trade-monopoly'
  | 'bishop' | 'constitution' | 'deserter' | 'diplomat' | 'intrigue' | 'saboteur'
  | 'spy' | 'warlord' | 'wedding';

export type CitiesKnightsPublic = {
  barbarian: { position: number; length: number; attacks: number };
  lastEvent: EventDie | null;
  metropolises: Partial<Record<Track, VertexId>>;
  seats: Record<SeatId, {
    improvements: Record<Track, number>;
    /** Progress cards held (face down). */
    progress: number;
    defender: number;
    strength: number;
  }>;
};

export type ModulePublic = {
  seafarers?: { claimed: Record<SeatId, number[]> };
  'cities-knights'?: CitiesKnightsPublic;
  fishing?: { fish: Record<SeatId, number>; deck: number; boot: SeatId | null };
  rivers?: { coins: Record<SeatId, number>; wealthiest: SeatId[]; poorest: SeatId[] };
  caravans?: { bidding: boolean; lastWinner: SeatId | null };
  'barbarian-attack'?: { castle: TileId; prisoners: Record<SeatId, number> };
  deliveries?: { delivered: Record<SeatId, number>; cargoLeft: Partial<Record<CargoKind, number>> };
  harbormaster?: { points: Record<SeatId, number> };
  'friendly-robber'?: { safe: SeatId[] };
  explorers?: {
    coins: Record<SeatId, number>;
    missions: Record<SeatId, Partial<Record<Mission, number>>>;
    lairs: { tile: TileId; crews: Record<SeatId, number>; captured: SeatId | null }[];
    spiceVisits: Record<SeatId, TileId[]>;
    /** Shoals holding a fish haul (always set by the engine; optional for older fixtures). */
    hauls?: TileId[];
    /** Owner of the pirate ship at pieces.pirate (always set by the engine). */
    pirate?: SeatId | null;
  };
};

/**
 * Generic HUD widgets and seat badges, authored by modules so the TV needs no per-module panels.
 * icon is a client icon key (a Good, Track, UnitKind, CargoKind or 'coin' | 'fish' | 'boot' ...).
 */
export type Badge = { key: string; icon: string; value: number; label: string };
type Labelled = { label: string; value: number };
type HudRow = { label: string; values: Record<SeatId, number>; max: number | null };
export type HudItem =
  | { kind: 'track'; key: string; label: string; value: number; max: number; alert: boolean; icon: string }
  | { kind: 'versus'; key: string; label: string; left: Labelled; right: Labelled }
  | { kind: 'table'; key: string; label: string; rows: HudRow[] }
  | { kind: 'holder'; key: string; label: string; seat: SeatId | null; icon: string };

export type ProgressCard = { id: string; kind: ProgressKind; track: Track; playable: boolean; why: Why | null };

export type ModulePrivate = {
  'cities-knights'?: { progress: ProgressCard[] };
  fishing?: { fish: { id: string; value: number }[] };
  explorers?: { movesLeft: Record<UnitId, number> };
};

// ---------------------------------------------------------------- views

export type Stage = 'setup' | 'roll' | 'main' | 'paired' | 'round' | 'finale' | 'ended';

/** Snake order is seats[] forward then back. round: 1 or 2 (E&P and C&K change the pieces). */
export type SetupInfo = {
  seat: SeatId; piece: BuildingKind | RouteKind; round: number; index: number; total: number;
};

export type Turn = {
  /** Game-owned id every action must echo. Changes when the turn, paired turn or round changes. */
  id: number;
  stage: Stage;
  /** 1-based round (every seat has had one main turn per round). */
  round: number;
  /** Main-turn seat (Standard), roller (Connect), placer (setup). */
  active: SeatId | null;
  /** Paired build seat (Standard, 5+ seats) or null. */
  partner: SeatId | null;
  /** Seat whose main turn (Standard) or captaincy (Connect) is next. */
  next: SeatId | null;
  setup: SetupInfo | null;
};

export type Clock = { step: TimedStep; seats: SeatId[]; startedAt: number; deadline: number };

/**
 * Server-authored headline that always answers "whose turn / what is happening".
 * title "Ana moves the robber"; detail "Discarding: Ana (4), Bo (5)". Countdowns are added by clients.
 */
export type Now = { seats: SeatId[]; title: string; detail: string };

export type SeatStatus =
  | 'idle' | 'placing' | 'rolling' | 'acting' | 'paired' | 'discarding' | 'choosing' | 'robbing'
  | 'moving' | 'thinking' | 'ready' | 'offline';

export type PublicSeat = {
  id: SeatId;
  name: string;
  color: string;
  /** Unique 0-9 index into SEAT_COLORS; drives the piece colour and emblem. */
  seat: number;
  cpu: boolean;
  /** CPU personality label, e.g. "Harbor trader". */
  persona: string | null;
  connected: boolean;
  away: boolean;
  status: SeatStatus;
  /** Earliest deadline this seat must meet now (step or prompt), else null. Offline + deadline = grace. */
  deadline: number | null;
  vp: number;
  parts: ScorePart[];
  cards: number;
  dev: number;
  knights: number;
  longestRoute: number;
  /** Discard threshold: 7 plus module bonuses (C&K walls). */
  discardLimit: number;
  left: { roads: number; ships: number; settlements: number; cities: number };
  badges: Badge[];
  /** Connect: pressed done. Standard: pre-skipped the paired build turn. */
  ready: boolean;
};

/** 'counter': the seat posted a counter to this offer. 'unable': pending but cannot pay now. */
export type OfferResponse = 'pending' | 'accept' | 'decline' | 'counter' | 'unable';

export type Offer = {
  id: string;
  at: number;
  from: SeatId;
  /** Explicit recipients. broadcast: sent to "everyone eligible" (audience label only). */
  to: SeatId[];
  broadcast: boolean;
  give: Cards;
  want: Cards;
  counterTo: string | null;
  responses: Record<SeatId, OfferResponse>;
  /** One-line decline reasons, mainly from CPUs. */
  reasons: Record<SeatId, string>;
  expires: number | null;
};

/** Open robber or pirate decisions, public so the TV can rim legal hexes and pin victims. */
export type RobberChoice = {
  seat: SeatId; piece: 'robber' | 'pirate'; tiles: { tile: TileId; victims: SeatId[] }[];
};

/** Public placement preview (optional intent action); targets are the seat's legal spots. */
export type Intent = { seat: SeatId; piece: IntentPiece; targets: string[] };

export type PublicView = {
  /** snapshotCache revision: bumps only when board or pieces change. */
  mapRev: number;
  board: Board;
  pieces: Pieces;
  settings: Settings;
  modules: ModuleId[];
  turn: Turn;
  now: Now;
  clock: Clock | null;
  seats: PublicSeat[];
  bank: Cards;
  devDeck: number;
  awards: Partial<Record<AwardId, SeatId | null>>;
  offers: Offer[];
  prompts: PromptChip[];
  robberChoices: RobberChoice[];
  intent: Intent | null;
  lastRoll: RollEvent | null;
  events: GameEvent[];
  ext: ModulePublic;
  hud: HudItem[];
  /** Present from the finale on (stage 'finale' or 'ended'); includes hidden VP and stats. */
  results: Results | null;
};

export type WhyCode =
  | 'cost' | 'no-spot' | 'no-pieces' | 'not-your-turn' | 'roll-first' | 'stage'
  | 'bought-this-turn' | 'one-per-turn' | 'deck-empty' | 'moved' | 'limit' | 'prompt' | 'rule';

/** Why an option is unavailable, in words a player can act on ("Need 1 ore"). */
export type Why = { code: WhyCode; text: string };

export type BuildOption = {
  piece: Purchase;
  cost: Cards;
  /** Free placements owed (setup, Road Building). */
  free: number;
  targets: string[];
  /** Pieces of this kind left in supply; null for development cards. */
  left: number | null;
  missing: Cards;
  why: Why | null;
};

export type DevCard = { id: string; kind: DevKind; playable: boolean; why: Why | null };

export type ShipMove = { from: EdgeId; to: EdgeId[] };

export type OfferState = { id: string; canAccept: boolean; canCounter: boolean; why: Why | null };

export type TaskKind =
  | 'setup' | 'roll' | 'main' | 'paired' | 'round' | 'prompt' | 'respond' | 'wait' | 'finale' | 'ended';

/**
 * The one thing this seat should do now; private duties (prompts) come first.
 * title "Discard now"; text "Pick 4 cards"; auto "Auto-discards biggest piles" when a deadline applies.
 */
export type Task = {
  kind: TaskKind; title: string; text: string;
  prompt: string | null; deadline: number | null; auto: string | null;
};

export type PrivateView = {
  seat: SeatId;
  hand: Cards;
  dev: DevCard[];
  vp: number;
  parts: ScorePart[];
  /** Effective target for this seat (e.g. +1 while holding the old boot). */
  target: number;
  rates: Cards;
  task: Task;
  can: { roll: boolean; end: boolean; bank: boolean; propose: boolean; skipPaired: boolean };
  /** Why propose or bank is unavailable ("Build turns trade with the bank only"). */
  why: { propose: Why | null; bank: Why | null };
  build: BuildOption[];
  shipMoves: ShipMove[];
  offers: OfferState[];
  /** Seats this player may trade with right now. */
  partners: SeatId[];
  prompts: Prompt[];
  commands: Command[];
  inbox: PrivateEvent[];
  ext: ModulePrivate;
};
