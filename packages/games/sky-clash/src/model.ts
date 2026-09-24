/**
 * Sky Clash shared contract (v2, Melee roster). Browser-safe: types, public constants and display data only.
 * World units are meters. +X right, +Y up. A fighter's x/y is the center of its feet.
 * The simulation runs at 60 frames per second; durations are frames unless named *Ms.
 * Melee values stay in their original units inside fidelity/; UNIT converts them to meters.
 * Owners may ADD optional fields. Renaming or removing a field needs every consumer updated.
 */
import { ROSTER, ROSTER_DATA, type FighterKind } from './roster';
import type { StageId } from './stages';
export { ROSTER, ROSTER_DATA, type FighterKind } from './roster';
export type { StageId } from './stages';

export const FPS = 60;
export const MAX_FIGHTERS = 4;
/** Melee length unit → meters (1.92 m Fox ≈ 24 Melee units tall). */
export const UNIT = .08;
export type FighterInfo = (typeof ROSTER_DATA)[FighterKind];
export const FIGHTERS = ROSTER_DATA as Record<FighterKind, FighterInfo>;
export type HitEffect = 'normal' | 'fire' | 'electric' | 'slash' | 'coin' | 'ice' | 'sleep' | 'grass' | 'darkness' | 'water' | 'star' | 'psychic' | 'magic';

// ── Costumes (authored by the model pipeline in assets/costumes/<kind>.json) ──
/** Material name → hex color. Costume 0 is the default. Every fighter ships exactly four. */
export type Costume = { name: string; colors: Record<string, string> };

// ── Rig contract for fighter GLBs (assets/fighters/<kind>.glb) ───────────
/** Required bones, exact names. Rest pose: T-pose, facing +Z, Y up, feet at y=0, arms along ±X (left hand at +X). Non-humanoids (Kirby, Jigglypuff, the hands, Sandbag) still carry every bone, placed sensibly. */
export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'prop'] as const;
export type BoneName = typeof BONES[number];
/** Optional secondary-motion chains (hair, tails, capes, ears, scarves) are named extra_<name>_<index>, parent→child; the renderer adds spring motion. */
export const EXTRA_BONE_PREFIX = 'extra_';
/** Material names the renderer recognizes. Costumes recolor any of them; 'emissive' glows; 'eye' and 'eye-white' skip outlines. */
export const MATERIALS = ['primary', 'secondary', 'accent', 'trim', 'skin', 'hair', 'dark', 'light', 'metal', 'emissive', 'eye', 'eye-white'] as const;

// ── Moves ────────────────────────────────────────────────────────────────
/** Game move ids and the Melee subaction names they are imported from (first match with hitboxes wins). */
export const MOVE_SOURCES = {
  jab1: ['Attack11'], jab2: ['Attack12'], jab3: ['Attack13'], jabRapid: ['Attack100Loop'],
  ftilt: ['AttackS3S', 'AttackS3'], ftiltHi: ['AttackS3Hi'], ftiltLw: ['AttackS3Lw'], utilt: ['AttackHi3'], dtilt: ['AttackLw3'], dash: ['AttackDash'],
  fsmash: ['AttackS4S', 'AttackS4'], fsmashHi: ['AttackS4Hi'], fsmashLw: ['AttackS4Lw'], usmash: ['AttackHi4'], dsmash: ['AttackLw4'],
  nair: ['AttackAirN'], fair: ['AttackAirF'], bair: ['AttackAirB'], uair: ['AttackAirHi'], dair: ['AttackAirLw'],
  nspecial: ['SpecialN'], nspecialAir: ['SpecialAirN'], sspecial: ['SpecialS'], sspecialAir: ['SpecialAirS', 'SpecialSAir'],
  uspecial: ['SpecialHi'], uspecialAir: ['SpecialAirHi'], dspecial: ['SpecialLw'], dspecialAir: ['SpecialAirLw'],
  grab: ['Catch'], dashgrab: ['CatchDash'], pummel: ['CatchAttack'], fthrow: ['ThrowF'], bthrow: ['ThrowB'], uthrow: ['ThrowHi'], dthrow: ['ThrowLw'],
  ledgeattack: ['CliffAttackQuick'], ledgeattackSlow: ['CliffAttackSlow'], getupattack: ['DownAttackU'], getupattackD: ['DownAttackD'], taunt: ['Appeal', 'AppealR', 'AppealL'],
} as const;
export type MoveId = keyof typeof MOVE_SOURCES;
/** Which body part delivers a hitbox; the renderer reaches that part toward the hitbox during active frames. */
export type Limb = 'handL' | 'handR' | 'footL' | 'footR' | 'head' | 'body' | 'weapon';
/** Animation families implemented by the renderer's pose library. The content table assigns one per fighter per move. */
export const POSES = ['jab', 'jab-cross', 'jab-finisher', 'jab-rapid', 'kick-front', 'kick-high', 'kick-low', 'sweep', 'uppercut', 'headbutt', 'shoulder', 'stomp',
  'overhead-slam', 'spin', 'flip-kick', 'dive-kick', 'knee', 'drill', 'clap', 'dash-attack', 'slide', 'body-slam', 'palm-thrust', 'elbow', 'hip-check',
  'sword-slash', 'sword-rising', 'sword-low', 'sword-thrust', 'sword-overhead', 'sword-spin', 'sword-down-stab',
  'hammer-swing', 'hammer-overhead', 'item-swing', 'staff-swing', 'cast-forward', 'cast-up', 'cast-down', 'cast-around', 'gun-shoot', 'blaster-draw',
  'rush', 'rise', 'rise-spin', 'teleport', 'counter', 'reflect', 'charge-hold', 'hover', 'roll-ball', 'inflate', 'transform',
  'grab', 'pummel', 'throw-forward', 'throw-back', 'throw-up', 'throw-down', 'ledge-attack', 'getup-attack', 'taunt'] as const;
export type Pose = typeof POSES[number];
/** Public move data shape. The engine builds per-fighter tables in src/moveset.ts from fidelity data. */
export type Hitbox = { x: number; y: number; r: number; damage: number; angle: number; kbBase: number; kbGrowth: number; fixedKb?: number; effect?: HitEffect; limb?: Limb; shieldDamage?: number; hitsGrounded?: boolean; hitsAirborne?: boolean };
export type HitWindow = { from: number; to: number; hitboxes: Hitbox[]; group?: number };
export type MoveDef = { name: string; pose: Pose; total: number; windows: HitWindow[]; landingLag?: number; autoCancel?: [number, boolean][]; charge?: { frame: number; max: number }; iasa?: number };

// ── Input ────────────────────────────────────────────────────────────────
export type Buttons = { attack: boolean; special: boolean; jump: boolean; shield: boolean; smash: boolean };
/** Monotonic press counters survive the platform's 20 Hz input coalescing. The client never lowers a counter below the server's echo. */
export type Presses = { attack: number; special: number; jump: number; shield: number; smash: number; grab: number };
/**
 * Stick axes follow the shared pad: +x right, +y DOWN (opposite world Y).
 * aim is the stick direction captured at the latest attack/special/smash/grab press, so a direction
 * pressed with a button is not lost when the stick recenters before the next 50 ms flush.
 */
export type Input = { x: number; y: number; held: Buttons; presses: Presses; aim: { x: number; y: number } };
export const neutralInput = (): Input => ({ x: 0, y: 0, held: { attack: false, special: false, jump: false, shield: false, smash: false },
  presses: { attack: 0, special: 0, jump: 0, shield: 0, smash: 0, grab: 0 }, aim: { x: 0, y: 0 } });
export type Action = { turnId: string; type: 'taunt' };

// ── Lobby and settings ───────────────────────────────────────────────────
export type LobbyChoice = { fighter: FighterKind | 'random' | null; costume: number; stage: StageId | 'random' | null };
export type CpuLevel = 1 | 2 | 3;
export type Settings = {
  stocks: number;          // 1–5, default 4 (Melee default)
  seconds: number;         // 0 (no limit), 120, 180, 300, 480, 600; default 480
  cpus: number;            // 0–3, capped so humans + cpus ≤ 4; a lone human always gets at least one CPU
  cpuLevel: CpuLevel;      // 1 easy, 2 normal, 3 hard; default 2
  teams: boolean;          // two teams by seat order, no friendly fire; default false
  hazards: boolean;        // default true
  stage: StageId | 'random' | 'vote'; // default 'vote' (most votes, ties by seed)
  /** Aerial landing lag: 'auto' (default when absent) always uses Melee's L-canceled value; 'melee' requires Shield within 7 frames before landing (engine). */
  lcancel?: 'auto' | 'melee';
  /** 'party' (default when absent): stronger air jumps and up-specials, one air jump back after being hit, Jump with no jumps left does up-special. 'melee': Melee values. */
  recovery?: 'party' | 'melee';
};
export const DEFAULT_SETTINGS: Settings = { stocks: 4, seconds: 480, cpus: 0, cpuLevel: 2, teams: false, hazards: true, stage: 'vote' };

// ── Public view (30 Hz snapshots) ────────────────────────────────────────
export type FighterState = 'idle' | 'walk' | 'run' | 'turn' | 'crouch' | 'jumpsquat' | 'air' | 'land' | 'attack' | 'hitstun' | 'tumble'
  | 'shield' | 'shieldstun' | 'dizzy' | 'roll' | 'spotdodge' | 'airdodge' | 'helpless' | 'ledge' | 'ledgeclimb' | 'grab' | 'grabbed' | 'thrown'
  | 'knockdown' | 'getup' | 'tech' | 'teeter' | 'respawn' | 'out';
/** An active hitbox this frame, in world meters, so the renderer can aim limbs at it. */
export type LiveHit = { x: number; y: number; r: number; limb: Limb };
export type FighterView = {
  id: string; name: string; color: string; fighter: FighterKind; costume: number; team: 0 | 1 | null; cpu: CpuLevel | null; connected: boolean;
  x: number; y: number; vx: number; vy: number; facing: 1 | -1; grounded: boolean;
  state: FighterState; stateFrame: number; move: MoveId | null; moveFrame: number;
  charge: number;          // 0–1 smash/special charge
  hitlag: number;          // remaining freeze frames
  damage: number; stocks: number; kos: number; falls: number;
  shield: number;          // 0–100
  jumpsLeft: number; intangible: boolean; armored: boolean;
  launch: number;          // knockback speed at launch while in hitstun/tumble (m/frame), else 0
  combo: number;           // consecutive true-combo hits taken
  hits?: LiveHit[];
  grabbedBy?: string; holding?: string; ledgeSide?: -1 | 1;
  /** Asleep (Sing, Rest): the renderer draws drifting Zs. Optional; fighter-render. */
  asleep?: boolean;
  /** Latest press counters the server consumed for this seat (ui): a reloaded phone never counts below them. */
  presses?: Presses;
  /** Total damage this fighter dealt this match (ui results/highlights). */
  dealt?: number;
  /** Current special phase (the MOVESET[fighter][move].phases key; moveFrame counts within it). Absent for single-script moves (engine). */
  movePhase?: string;
  /** Ice Climbers partner (Nana, or Popo when Nana was picked): the leader's id. She shares the leader's stock (echoed in `stocks`) and credits her KOs and damage to the leader, so HUD cards, results rows and port labels should skip her (engine). */
  partner?: string;
};
export type ProjectileView = { id: number; owner: string; kind: string; x: number; y: number; vx: number; vy: number; r: number; life: number; effect: HitEffect };
export type EventKind = 'hit' | 'shield' | 'parry' | 'shieldbreak' | 'ko' | 'jump' | 'airjump' | 'land' | 'swing' | 'projectile' | 'grab' | 'throw'
  | 'tech' | 'ledge' | 'respawn' | 'counter' | 'reflect' | 'absorb' | 'armor' | 'clash' | 'dodge' | 'hazard-warn' | 'hazard' | 'taunt' | 'sudden-death' | 'star-ko';
export type GameEvent = {
  id: number; kind: EventKind; frame: number; x: number; y: number;
  source?: string; target?: string; effect?: HitEffect; move?: MoveId;
  power?: number;          // 0–1 impact strength for shake, flash and sound
  angle?: number;          // world degrees (0 = +X, 90 = up)
  damage?: number;
};
export type Phase = 'countdown' | 'fight' | 'sudden' | 'complete';
export type View = {
  turnId: string; phase: Phase; phaseEndsAt: number;
  endsAt: number;          // wall-clock match end, 0 when unlimited
  frame: number; stageId: StageId; stageTick: number; hazards: boolean; teams: boolean; stocks: number;
  fighters: FighterView[]; projectiles: ProjectileView[];
  /** Recent events (about the last second), ids strictly increasing. Consumers fire each id once. */
  events: GameEvent[];
};
export const isFighterKind = (value: unknown): value is FighterKind => typeof value === 'string' && (ROSTER as string[]).includes(value);
