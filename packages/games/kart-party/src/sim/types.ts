/* Shared Kart Party types. Pure data: everything here is JSON-serializable and safe to import from
 * both the server rules and browser code. See DESIGN.md for the meaning of each mechanic. */
export type TrackId = 'palm-bay' | 'mesa-rally' | 'neon-drive' | 'frost-peak' | 'rainbow-road';
export type ThemeId = 'beach' | 'desert' | 'city' | 'snow' | 'space';
export type SpeedClass = 50 | 100 | 150 | 200;
export type Difficulty = 'easy' | 'normal' | 'hard';
export type ItemMode = 'normal' | 'frantic' | 'off';
export type ViewMode = 'auto' | 'tv' | 'personal';
export type KartBodyId = 'zoomer' | 'bolt' | 'tank';

export type Settings = {
  track: TrackId; laps: number; speedClass: SpeedClass; difficulty: Difficulty;
  /** Minimum racers on the grid; CPUs fill up to this (1 = humans only). */
  gridSize: number; items: ItemMode; views: ViewMode;
};

/** Per-seat lobby pick (GameRules.parseLobbyChoice). Missing picks are auto-assigned. */
export type LobbyChoice = { character: number; kart: KartBodyId };

/** Held input from a controller. Presses are counters (0–255, wrapping) so a tap shorter than the
 * 20 Hz input cadence is never lost: the server compares against the previous counter. */
export type Input = {
  steer: number;        // -1 (left) … 1 (right), already in driver space
  drift: boolean;       // held: keep drifting
  brake: boolean;       // held: brake / reverse
  item: boolean;        // held: trail a holdable item behind the kart; release deploys it
  hop: number;          // drift/hop press counter
  fire: number;         // item press counter
  seq: number;          // client input sequence for prediction acknowledgement
};
export type Action = { type: 'honk' };

export type Surface = 'road' | 'offroad' | 'ice' | 'water' | 'boost' | 'air';

export type ItemId = 'nitro' | 'triple-nitro' | 'peel' | 'bouncer' | 'seeker' | 'shield' | 'super' | 'thunder' | 'comet' | 'ink' | 'bomb';
export type HitKind = 'spin' | 'tumble' | 'shock' | 'ink';

/** Everything the per-kart physics step reads and writes. Client prediction reconstructs this exact
 * shape from RacerView, so keep it flat numbers/booleans. Timers count down in seconds. */
export type KartState = {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  heading: number; steer: number;           // steer = smoothed steering actually applied
  grounded: boolean; air: number;           // seconds airborne
  hint: number;                             // last nearest track sample index (search hint)
  d: number; lateral: number; surface: Surface; offroad: boolean;
  lastSafeD: number;                        // respawn distance along the lap
  drift: -1 | 0 | 1; driftCharge: number; driftTier: 0 | 1 | 2 | 3; hopT: number;
  boostT: number; boostPower: number;       // remaining seconds, extra top-speed fraction
  slipT: number; slipCharge: number;        // slipstream: charge while drafting, then boost
  trickT: number; tricked: boolean;         // trick window after a ramp lip; tricked → landing boost
  spinT: number; tumbleT: number; starT: number; shieldT: number; inkT: number; shockT: number;
  respawnT: number; invulnT: number; stallT: number;
  launch: -1 | 0 | 1;                       // countdown start press: 1 rocket start pending, -1 stall pending
  loop: number;                             // angle around the loop-the-loop in radians (0 = not in a loop)
  prevHop: number; prevFire: number; prevItem: boolean;
};

export type RacerStats = {
  miniTurbos: number; purpleTurbos: number; tricks: number; itemsUsed: number; hitsDealt: number;
  hitsTaken: number; wallHits: number; airTime: number; topSpeed: number; overtakes: number; rocketStart: boolean;
};

export type AiState = { lane: number; mistakeT: number; itemDelay: number; driftHold: number; targetD: number };

export type Racer = KartState & {
  id: string; name: string; color: string; bot: boolean; connected: boolean;
  character: number; kart: KartBodyId;
  lap: number;                // 0 before first crossing the line, 1..laps racing, laps+1 finished
  checkpoint: number;         // next checkpoint index this lap
  progress: number;           // total metres along the course (for ranking)
  rank: number; finishTime: number | null; lapTimes: number[]; lapStart: number;
  item: ItemId | null; itemCount: number; rollT: number; trailing: boolean;
  lastSeq: number; honkT: number;
  stats: RacerStats; ai: AiState | null;
};

export type EntityKind = 'peel' | 'bouncer' | 'seeker' | 'comet' | 'bomb' | 'blast';
/** Items that exist on the course: dropped peels, flying shells, the comet, bombs and short-lived blasts. */
export type Entity = {
  id: number; kind: EntityKind; owner: string;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  t: number; hint: number; d: number; target: string | null; bounces: number; fuse: number;
};

export type RaceEventType = 'hit' | 'bump' | 'wall' | 'boost-pad' | 'mini-turbo' | 'trick' | 'rocket-start' | 'stall'
  | 'slipstream' | 'pickup' | 'item' | 'shield-pop' | 'explode' | 'thunder' | 'comet' | 'lap' | 'final-lap'
  | 'finish' | 'respawn' | 'fall' | 'honk' | 'overtake' | 'ring' | 'spring' | 'bumper' | 'loop';
export type RaceEvent = { id: number; t: number; type: RaceEventType; racer: string; other?: string; value?: number; x?: number; z?: number };

export type Phase = 'countdown' | 'racing' | 'results';

export type Race = {
  track: TrackId; laps: number; speedClass: SpeedClass; difficulty: Difficulty; items: ItemMode;
  viewMode: 'tv' | 'personal';
  phase: Phase;
  time: number;               // race clock in seconds; negative during the countdown, 0 at GO
  racers: Racer[]; entities: Entity[];
  boxes: number[];            // per item box: seconds until it reappears (0 = present)
  events: RaceEvent[];        // recent events ring (ids from serial)
  serial: number; rng: number;
  firstFinish: number | null; endAt: number | null;  // race time when results begin
  cooldowns: { thunder: number; comet: number };
};

/** Snapshot sent to every screen at 20 Hz. Racer physics fields are rounded but complete, so
 * prediction can reconstruct KartState. Stats are only included once results begin. */
export type RacerView = Omit<Racer, 'stats' | 'ai' | 'lapTimes'> & { lapTimes: number[]; stats?: RacerStats };
export type RaceView = Omit<Race, 'racers' | 'rng'> & { racers: RacerView[] };

/* ---------------- Track authoring ---------------- */
/** Control point of a closed centre-line spline. Racing direction follows increasing index;
 * points[0] is the start/finish line. Lateral offsets are positive to the driver's right. */
export type TrackPoint = {
  x: number; z: number; y?: number;          // elevation (default 0)
  w?: number;                                // road width in metres (default 16)
  bank?: number;                             // degrees; positive raises the LEFT edge (banked for right turns)
  runoffL?: number; runoffR?: number;        // off-road apron width before the edge (default 7)
  edgeL?: 'wall' | 'drop'; edgeR?: 'wall' | 'drop';  // what stops you past the apron (default wall)
};
/** Along-track features use `at` = fraction of lap length [0,1) and `lat` = metres right of centre. */
export type BoostPad = { at: number; lat: number; width?: number; length?: number };
export type Ramp = { at: number; lat: number; width: number; length?: number; height?: number };
export type ItemRow = { at: number; count?: number };
export type Gap = { from: number; to: number };      // no ground: fall unless airborne across it
export type SurfaceZone = { from: number; to: number; latMin: number; latMax: number; surface: 'offroad' | 'ice' | 'water' | 'boost' };
export type Obstacle = { at: number; lat: number; radius: number; kind: string };
export type Landmark = { kind: string; at: number; side: -1 | 1; offset: number; scale?: number; yaw?: number };
/** Glowing hoop floating `height` m above the road (centre); flying or driving through its disc gives a boost. */
export type StarRing = { at: number; lat: number; height: number; radius?: number };
/** Bounce pad flush with the road: touching it launches the kart upward (vy = power m/s) with a trick window. */
export type Spring = { at: number; lat: number; width?: number; length?: number; power?: number };
/** Gravity multiplier over a stretch (moon hop: scale < 1). */
export type GravityZone = { from: number; to: number; scale: number };
/** Round bumper sliding across the road: lateral = lat + amp·sin(2π(time/period + phase)); knocks karts away. */
export type Mover = { at: number; lat: number; amp: number; period: number; phase?: number; radius: number; kind: string };
/** Vertical loop-the-loop over a straight footprint `length` m long: karts ride a circle of `radius` m that is
 * tilted `tilt` degrees off the travel direction, so the rising and falling halves pass side by side. */
export type Loop = { at: number; length?: number; radius?: number; tilt?: number };

export type TrackDef = {
  id: TrackId; name: string; theme: ThemeId; tagline: string;
  points: TrackPoint[];
  boostPads: BoostPad[]; ramps: Ramp[]; itemRows: ItemRow[]; gaps: Gap[]; zones: SurfaceZone[];
  obstacles: Obstacle[]; landmarks: Landmark[];
  rings?: StarRing[]; springs?: Spring[]; gravity?: GravityZone[]; movers?: Mover[]; loops?: Loop[];
};
