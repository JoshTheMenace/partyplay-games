/**
 * Hijinks pack contract. Shared by server rules, minigames, client views, bots and tests.
 * Type-only and dependency-free: no React, no content banks, no answer keys.
 */
import type { ActionResult } from '../../../../party-contract/src/index';

// ---------- players, settings ----------
export const AVATAR_COUNT = 16;
export type PackPlayer = { id: string; name: string; color: string; avatar: number; connected: boolean };
export type TimerPace = 'relaxed' | 'standard' | 'speedy';
export type PackSettings = {
  /** Filters content tagged adult. On by default. */
  family: boolean;
  /** Scales every minigame timer: relaxed 1.5×, standard 1×, speedy 0.7×. */
  timers: TimerPace;
  /** Host display reads player-written text with the browser's speech voice. */
  readAloud: boolean;
  /** Plays the narrated how-to-play intro before each minigame. */
  tutorials: boolean;
  /** Minigame id to start with, or '' to open on the menu. */
  startWith: string;
};
export type LobbyChoice = { avatar: number };

// ---------- audio cues ----------
/** Every SFX id has a file at /games/hijinks/sfx/<id>.mp3 (see core/audio). */
export const SFX_IDS = [
  'tap', 'submit', 'lock', 'tick', 'tick-fast', 'timeup', 'whoosh', 'swoosh-in', 'pop', 'ding', 'correct', 'wrong', 'buzzer',
  'drumroll', 'reveal', 'applause', 'cheer', 'laugh', 'gasp', 'boo', 'aww', 'ooh', 'fanfare', 'win', 'lose', 'score-up', 'coin',
  'vote', 'join', 'slide', 'stamp', 'sparkle', 'boing', 'splat', 'scribble', 'camera', 'spooky', 'thunder', 'heartbeat', 'alarm',
  'bell', 'gong', 'kazoo', 'record-scratch', 'rimshot', 'airhorn', 'typewriter', 'glitch', 'crash', 'sting',
] as const;
export type SfxId = typeof SFX_IDS[number];
/**
 * Host-display audio events. `seq` increases monotonically for the whole night; clients play cues with seq greater than
 * the last one they handled and drop cues older than a few seconds (late joiners and reconnects stay quiet).
 * vo: narrator line id (core/narration or minis/<id>/narration). speak: player text for the optional read-aloud voice.
 */
export type Cue = { seq: number; at: number; kind: 'vo' | 'sfx' | 'speak'; id: string };

// ---------- minigame server contract ----------
/** Result of one finished minigame. Scores are that minigame's own points; winners receive a trophy for the night. */
export type MiniResult = {
  scores: Record<string, number>;
  winners: string[];
  /** Optional fun superlatives shown on the podium, e.g. { title: 'Crowd favourite', playerId }. */
  awards?: { title: string; playerId: string }[];
  /** Optional one-line headline for the podium, e.g. 'The aliens were caught!' (co-op/team games). */
  headline?: string;
};
/** Services the pack gives a running minigame. All randomness must come from here (seeded, replayable). */
export type MiniApi = {
  readonly now: number;
  random(): number;
  shuffle<T>(items: readonly T[]): T[];
  /** Up to `count` distinct items in random order. */
  pick<T>(items: readonly T[], count: number): T[];
  /** Pace-scaled timer: seconds → milliseconds after applying the host's timer setting. */
  seconds(base: number): number;
  /** Queue a narrator line. Returns its spoken length in ms (0 when the line has no recording yet). */
  say(line: string): number;
  sfx(id: SfxId): void;
  /** Background music track id (core/audio tracks) or null for silence. Repeated calls with the same id do nothing. */
  music(track: string | null): void;
  /** Read player-written text aloud on the host display (only when settings.readAloud). Keep it short. */
  speak(text: string): void;
  /** Heavy public payloads (drawings, long galleries) go here: sent only when changed. Cleared between minigames. */
  media: { put(key: string, value: unknown): void; remove(key: string): void };
  readonly settings: PackSettings;
  /** Night-long memory of content this minigame has used (e.g. prompt ids), kept across replays. Prefer unused items. */
  used: { has(key: string): boolean; add(key: string): void };
};
export type MiniServer<S = any, Pub = unknown, Priv = unknown> = {
  id: string;
  /** Players are every seated player at minigame start, in roster order (index 0 is the VIP). */
  create(players: readonly PackPlayer[], api: MiniApi): S;
  /** Throw an Error with a short player-facing message to reject. Validate the minigame's own turn id. */
  action(state: S, playerId: string, action: Record<string, unknown>, api: MiniApi): void;
  /** Called every ~100 ms. Advance phases from deadlines and from "everyone has submitted". */
  tick(state: S, api: MiniApi): void;
  presence?(state: S, playerId: string, connected: boolean, api: MiniApi): void;
  publicView(state: S, now: number): Pub;
  playerView(state: S, playerId: string, now: number): Priv;
  /** Non-null once the minigame is over; the pack then shows the podium. */
  result(state: S): MiniResult | null;
};

// ---------- pack views and actions ----------
export type PackPhase = 'menu' | 'intro' | 'mini' | 'podium';
export type PackPublicView = {
  phase: PackPhase;
  players: PackPlayer[];
  /** First connected player in roster order: drives menu lock-in, intro skip and podium continue. */
  vip: string | null;
  settings: PackSettings;
  /** Minigame wins this night. */
  trophies: Record<string, number>;
  /** Minigame ids played this night, in order. */
  played: string[];
  menu: { votes: Record<string, string>; lockAt: number | null } | null;
  /** Active or most recent minigame. `session` increments each time a minigame starts; actions must echo it. */
  current: { id: string; session: number; startedAt: number } | null;
  intro: { endsAt: number; skips: string[] } | null;
  /** Active minigame public view (shape owned by that minigame). */
  mini: unknown;
  podium: { result: MiniResult; endsAt: number } | null;
  music: string | null;
  cues: Cue[];
  mediaRev: number;
  media: Record<string, unknown>;
};
export type PackPrivateView = { vote: string | null; mini: unknown };
export type PackAction =
  | { k: 'vote'; game: string }
  | { k: 'lock' }
  | { k: 'end' }
  | { k: 'skip'; session: number }
  | { k: 'next'; session: number }
  | { k: 'mini'; session: number; a: Record<string, unknown> };

// ---------- minigame client contract ----------
export type MiniViewProps<Pub = any, Priv = any> = {
  view: Pub;
  /** This phone's private minigame view; null on the display. */
  me: Priv | null;
  playerId: string | null;
  players: readonly PackPlayer[];
  vip: string | null;
  settings: PackSettings;
  media: Record<string, unknown>;
  /** Server-clock milliseconds; compare with deadlines in views. */
  now(): number;
  /** Sends { k: 'mini', session, a: action }. Resolves with the server's accept/reject. */
  send(action: Record<string, unknown>): Promise<ActionResult>;
  /** Unique per minigame session, for scoping drafts in sessionStorage. */
  sessionKey: string;
};
/** Default export of minis/<id>/client.tsx. */
export type MiniClient = {
  Display: (props: MiniViewProps) => unknown;
  Controller: (props: MiniViewProps) => unknown;
};
/** Client-safe catalog entry, minis/catalog.ts. */
export type MiniInfo = {
  id: string; title: string; tagline: string;
  /** Inspiration-free three-step how-to shown on the intro card. */
  howTo: [string, string, string];
  players: { min: number; max: number };
  minutes: string;
  tags: string[];
  /** Accent colour for tiles and intro. */
  accent: string;
  /** Narrator line ids played on the intro card, in order. */
  intro: string[];
};
/** Bot policy for tests and QA drivers: given views, return the next minigame action or null to wait. */
export type MiniBot<Pub = any, Priv = any> = (input: { view: Pub; me: Priv; playerId: string; players: readonly PackPlayer[]; now: number; random(): number }) => Record<string, unknown> | null;
