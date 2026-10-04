/**
 * Trolley Court shared contract: client-safe types, settings and pure helpers used by server, client, bot, audio and tests.
 * Card text banks live only in deck.server.ts. Client code must never runtime-import server.ts, *.server.ts or bot.ts.
 * See DESIGN.md for the phase machine and timing.
 */
export type PlayerId = string;
export const SIDES = ['north', 'south'] as const;
export type Side = typeof SIDES[number];
export const opposite = (side: Side): Side => side === 'north' ? 'south' : 'north';

// ---------- cards ----------
export const KINDS = ['innocent', 'guilty', 'modifier'] as const;
export type CardKind = typeof KINDS[number];
/** Silhouette the UI draws on a track card. Modifiers carry none. */
export const FIGURES = ['person', 'pair', 'crowd', 'child', 'elder', 'animal', 'pet', 'creature', 'robot', 'object', 'vehicle', 'building'] as const;
export type Figure = typeof FIGURES[number];
/**
 * One card. Stock ids are stable and kind-prefixed (`i001`, `g001`, `m001`); write-in blanks are `w<round><n|s>` (e.g. `w3n`).
 * A blank in a hand has text '' and blank: true; once locked it carries the team's written text and keeps blank: true.
 * spicy marks the darkest stock cards, left out when settings.family is on.
 */
export type Card = { id: string; kind: CardKind; text: string; figure?: Figure; spicy?: true; blank?: true };
/** Maximum stock card text in characters, and the write-in limit. */
export const TEXT_MAX: Record<CardKind, number> = { innocent: 70, guilty: 70, modifier: 60 };
export const WRITE_IN_MAX = 60;
/** Normalizes write-in text (drops invisible format characters such as bidi overrides, keeping emoji joiners; collapses whitespace, trims) or throws a player-facing Error. Shared by phone and server. */
export function cleanWriteIn(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.normalize('NFC').replace(/(?!\u200d)\p{Cf}/gu, '').replace(/\s+/g, ' ').trim() : '';
  if (!/[\p{L}\p{N}]/u.test(text)) throw new Error('Write something on the blank card first.');
  if (/\p{Cc}/u.test(text)) throw new Error('That text has characters the card can’t print.');
  if ([...text].length > WRITE_IN_MAX) throw new Error(`Keep it to ${WRITE_IN_MAX} characters.`);
  return text;
}

// ---------- settings ----------
/** Times each player conducts. auto is the official length: twice with 3–4 players, otherwise once. */
export type Laps = 'auto' | 1 | 2;
export type Settings = {
  laps: Laps;
  /** Innocent and Guilty pick timers. */
  pickSeconds: 20 | 30 | 45 | 60;
  modifierSeconds: 30 | 45 | 60 | 90;
  /** Each team's turn on the floor during pleading. */
  floorSeconds: 20 | 30 | 45 | 60;
  /** The Conductor's final decision window after both floors. */
  leverSeconds: 10 | 15 | 20 | 30;
  accomplices: boolean; catchUp: boolean; blanks: boolean; family: boolean; readAloud: boolean;
};
export const defaults: Settings = { laps: 'auto', pickSeconds: 30, modifierSeconds: 45, floorSeconds: 30, leverSeconds: 20, accomplices: false, catchUp: false, blanks: true, family: false, readAloud: true };
export const options = { laps: ['auto', 1, 2], pickSeconds: [20, 30, 45, 60], modifierSeconds: [30, 45, 60, 90], floorSeconds: [20, 30, 45, 60], leverSeconds: [10, 15, 20, 30] } as const;
export const toggles = {
  accomplices: ['Accomplices', 'Every teammate plays a twist each round, not just the extras.'],
  catchUp: ['Underdog', 'Whoever has the most deaths gives their team one extra twist.'],
  blanks: ['Write-ins', 'Each team finds one blank card per round and writes its own (60 characters).'],
  family: ['Milder deck', 'Leaves out the darkest cards.'],
  readAloud: ['Read cards aloud', 'The Clerk reads every revealed card on the TV.'],
} as const;
export type Toggle = keyof typeof toggles;
/** Strict settings parser (unknown keys and out-of-range values throw); parseSettings({}) returns the defaults. */
export function parseSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Settings must be an object.');
  if (Object.keys(raw).some(k => !Object.hasOwn(defaults, k))) throw new Error('Unknown Trolley Court setting.');
  const s: Record<string, unknown> = { ...defaults, ...raw };
  for (const [k, allowed] of Object.entries(options)) if (!(allowed as readonly unknown[]).includes(s[k])) throw new Error(`Invalid ${k} setting.`);
  for (const k of Object.keys(toggles)) if (typeof s[k] !== 'boolean') throw new Error(`${k} must be on or off.`);
  return s as Settings;
}

// ---------- seats, teams and slots (pure; the server is authoritative) ----------
export const lapsFor = (players: number, laps: Laps) => laps === 'auto' ? players <= 4 ? 2 : 1 : laps;
export const roundCount = (players: number, laps: Laps) => players * lapsFor(players, laps);
/** Round r (1-based) is conducted by seat (r - 1) % n. The seats after the Conductor, in seat order: first ceil(k/2) North, rest South. */
export function seatTeams(seats: readonly PlayerId[], round: number): { conductor: PlayerId; north: PlayerId[]; south: PlayerId[] } {
  const n = seats.length, c = (round - 1) % n, rest = Array.from({ length: n - 1 }, (_, i) => seats[(c + 1 + i) % n]), half = Math.ceil(rest.length / 2);
  return { conductor: seats[c], north: rest.slice(0, half), south: rest.slice(half) };
}
export const MAX_MODIFIER_SLOTS = 6;
/** Twists a team plays: one plus one per member beyond three (official), or one per member with Accomplices; +1 with an Underdog. */
export const modifierSlots = (teamSize: number, accomplices: boolean, underdog: boolean) => Math.min(MAX_MODIFIER_SLOTS, (accomplices ? teamSize : Math.max(1, teamSize - 2)) + (underdog ? 1 : 0));
/** Cards in a team's hand of one kind. Innocent and Guilty always have one slot. */
export const handSize = (kind: CardKind, slots: number) => kind === 'modifier' ? Math.min(12, 3 * slots) : 3;
/** With write-ins on, each team's blank replaces one card in this hand, rotating by round. */
export const blankKind = (round: number): CardKind => KINDS[(round - 1) % 3];

// ---------- phases and timing ----------
export const PHASES = ['deal', 'innocent', 'innocentReveal', 'guilty', 'guiltyReveal', 'modifier', 'modifierReveal', 'plead', 'lever', 'crash', 'complete'] as const;
export type Phase = typeof PHASES[number];
/** Pick phases are named after the card kind they play. */
export const isPick = (phase: Phase): phase is CardKind => phase === 'innocent' || phase === 'guilty' || phase === 'modifier';
/** The game-owned turn id: one per phase of one round. */
export const turnIdFor = (round: number, phase: Phase) => `${round}.${phase}`;
export const TIMING = {
  /** deal: intro beat before the two random Bystanders (plus welcomeMs in round 1). */
  dealMs: 3500, welcomeMs: 3000,
  /** First beat of each reveal phase (narrator line, face-down cards). */
  introMs: 2500,
  /** An all-locked pick phase ends settleMs after the last lock, never sooner than minPickMs after it began. */
  settleMs: 1500, minPickMs: 3000,
  /** The hurry cue fires this long before a pick deadline. */
  hurryMs: 10000,
  /** The Conductor may end a floor early once it has run this long. */
  floorMinMs: 5000,
  /** A disconnected Conductor's remaining floor/lever time shrinks to this. */
  awayMs: 8000,
  /** The trolley run; the last round holds longer before results. */
  crashMs: 8000, lastCrashMs: 11000,
} as const;
/** One reveal beat. Long enough for the Clerk to read the card when readAloud is on. */
export const revealMs = (text: string, readAloud: boolean) => readAloud ? Math.min(6500, Math.max(2600, 1400 + 60 * text.length)) : 2200;

// ---------- audio cues ----------
export const SFX_IDS = ['tap', 'deal', 'flip', 'lock', 'all-locked', 'reveal', 'stamp', 'tick', 'hurry', 'timeup', 'gavel', 'lever', 'bell', 'rumble', 'crash', 'gasp', 'aww', 'cheer', 'drumroll', 'whoosh'] as const;
export type SfxId = typeof SFX_IDS[number];
/** The Clerk's static lines (no names, no card text). narration.ts may add variants `<id>.2`, `<id>.3`; the player picks one. */
export const LINE_IDS = ['welcome', 'round', 'final-round', 'heading.north', 'heading.south', 'pick.innocent', 'pick.guilty', 'pick.modifier', 'reveal.innocent', 'reveal.guilty', 'reveal.modifier', 'hurry', 'timeup', 'floor.north', 'floor.south', 'lever', 'pull', 'nothing', 'dither', 'struck', 'end', 'tie'] as const;
export type LineId = typeof LINE_IDS[number];
/**
 * Host-display audio events. seq rises for the whole game; play cues newer than the last handled and drop any older than
 * ~4 s (late joiners stay quiet). card: the id of a card now visible on the tracks, to be read aloud (only when readAloud).
 */
export type Cue = { seq: number; at: number } & ({ kind: 'sfx'; id: SfxId } | { kind: 'line'; id: LineId } | { kind: 'card'; id: string });
export const CUE_LIMIT = 16;

// ---------- public view ----------
/** Slot 0: the random Bystander; 1: the team's own Innocent; 2: the other team's Guilty. */
export type Target = { side: Side; slot: 0 | 1 | 2 };
/** A card on the tracks. from: the team that played it, or 'deck'. by: who locked it (omitted for deck cards and auto-picks). */
export type Placed = { card: Card; from: Side | 'deck'; by?: PlayerId; auto?: true };
/** mods are twists in reveal order; each mod's from is its author team. */
export type TrackCard = Placed & { mods: Placed[] };
/** slots are null until revealed. Hidden picks never appear here. */
export type Track = { side: Side; team: PlayerId[]; slots: [TrackCard | null, TrackCard | null, TrackCard | null] };
export type PublicPlayer = { id: PlayerId; name: string; color: string; connected: boolean; deaths: number; spared: number; conducted: number };
export type RoundRecord = { round: number; conductor: PlayerId; defaultSide: Side; pulled: boolean; timedOut: boolean; struck: Side; victims: PlayerId[] };
export type PublicView = {
  phase: Phase; round: number; rounds: number; turnId: string;
  /** Server-clock ms. deadline is when the current phase or step ends. */
  startedAt: number; deadline: number;
  /** Reveal phases: index of the beat on screen (0 = intro) of steps. plead: floor index 0–1 of 2. Otherwise 0 of 1. */
  step: number; steps: number;
  conductor: PlayerId; defaultSide: Side;
  /** Live lever. The trolley heads to pulled ? opposite(defaultSide) : defaultSide. Resets each round. */
  lever: { pulled: boolean; decided: boolean; timedOut: boolean };
  tracks: Record<Side, Track>;
  /** Locked slots per team in the current pick phase (totals stay visible through its reveal); zeros before the first pick. */
  progress: Record<Side, { locked: number; total: number }>;
  /** The card (or twist when mod is set) being revealed this beat. */
  spotlight: (Target & { mod?: number }) | null;
  /** plead: the team with the floor (the team in the trolley's path speaks first). Otherwise null. */
  floor: Side | null;
  /** crash/complete: the track the trolley ran down. */
  struck: Side | null;
  /** Underdog players this round (catchUp); their team has one extra twist. */
  underdogs: PlayerId[];
  players: PublicPlayer[];
  history: RoundRecord[];
  cues: Cue[];
  settings: Settings;
  /** complete: everyone tied for the fewest deaths. */
  winners: PlayerId[];
};

// ---------- private view ----------
export type Proposal = { by: PlayerId; cardId: string; text?: string; target?: Target };
export type Pick = { cardId: string; text?: string; target?: Target; by: PlayerId };
/** One pick a team must make this phase. Modifier phases have one slot per twist. */
export type SlotView = { index: number; kind: CardKind; locked: Pick | null; proposals: Proposal[] };
/**
 * The team's shared hands, visible to every teammate and nobody else. A hand empties when its phase ends (unplayed cards
 * are discarded). The Conductor gets role 'conductor', side null, empty hands and no slots.
 */
export type PrivateView = { role: 'conductor' | 'team'; side: Side | null; turnId: string; hands: Record<CardKind, Card[]>; slots: SlotView[] };

// ---------- actions ----------
/**
 * Every action carries the current PublicView.turnId; stale ids are rejected. lean also accepts the round's plead id
 * during lever. propose/lock: team members in a pick phase. slot indexes PrivateView.slots. text only for blank cards
 * (required to lock); target only in the modifier phase (required to lock). propose with cardId null withdraws.
 * lock is first-wins and final. lean/next/decide: Conductor only. next ends floor `step` early (after floorMinMs).
 */
export type Action =
  | { kind: 'propose'; turnId: string; slot: number; cardId: string | null; text?: string; target?: Target }
  | { kind: 'lock'; turnId: string; slot: number; cardId: string; text?: string; target?: Target }
  | { kind: 'lean'; turnId: string; pulled: boolean }
  | { kind: 'next'; turnId: string; step: number }
  | { kind: 'decide'; turnId: string; pull: boolean };
/** Trolley Court has no held input. */
export type Input = null;
