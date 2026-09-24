/** Server-only simulation state. Positions are meters, velocities meters/frame, durations frames (60 Hz). */
import type { Buttons, CpuLevel, FighterKind, FighterState, GameEvent, HitEffect, Input, MoveId, Phase, Presses, Settings, StageId } from '../model';

export type PressKey = keyof Presses;
export const PRESS_KEYS: readonly PressKey[] = ['attack', 'special', 'jump', 'shield', 'smash', 'grab'];
/** Frames a press stays buffered (phones cross a 20 Hz coalesced link). */
export const BUFFER = 8;

/** Launch waiting for the end of hitlag: world angle (degrees), Melee knockback, facing-independent direction. */
export type Pending = { angle: number; kb: number; dir: 1 | -1; hitstun: number; tumble: boolean };
/** CPU memory: its own press counters and the current short plan. */
export type CpuMemo = {
  presses: Presses; plan: string; until: number; next: number; x: number; y: number; hold: Buttons;
  target: string | null; stuck: number; lastX: number; recover: number; mash: number;
};
export type Fighter = {
  id: string; name: string; color: string; kind: FighterKind; costume: number; team: 0 | 1 | null; cpu: CpuLevel | null; connected: boolean; seat: number;
  x: number; y: number; vx: number; vy: number; kx: number; ky: number; facing: 1 | -1; grounded: boolean; ground: string | null;
  state: FighterState; stateFrame: number; timer: number; move: MoveId | null; moveFrame: number; phase: string; phaseFrame: number;
  charge: number; hitlag: number; damage: number; stocks: number; kos: number; falls: number; dealt: number; shield: number;
  jumpsLeft: number; launch: number; combo: number; hitstun: number; tumble: boolean;
  /** Frames of invincibility (respawn, ledge grab); intangibility from scripts is computed per frame. */
  invincible: number; intangibleNow: boolean; armorNow: boolean;
  fastFall: boolean; helpless: boolean; helplessLag: number; airdodged: boolean; shortHop: boolean; aerialQueued: boolean;
  used: string[];              // once-per-airtime specials used ('s', 'hi')
  hitIds: string[];            // `${target}:${group}` already hit by the current move instance
  staled: boolean;             // current move instance already entered the stale queue
  stale: MoveId[];
  lastHitBy: string | null; lastHitFrame: number;
  ledge: string | null; ledgeSide: -1 | 1; ledgeFresh: boolean; ledgeCooldown: number; ledgeTarget: number;
  grabbedBy: string | null; holding: string | null; grabTimer: number;
  shieldFrame: number; techPress: number; techLock: number; bounces: number;
  pending: Pending | null; sdiDir: number;
  seen: Presses; buf: Presses; held: Buttons; px: number; py: number;
  sx: number; sy: number; hist: [number, number][]; aim: { x: number; y: number };
  coyote: number; dropThrough: number; runFrames: number; dashing: number;
  special: Record<string, number>; // per-fighter special memory (stored charge, counter damage, halo height...)
  disconnectedAt: number | null; respawnTimer: number; outTimer: number;
  /** Elimination order (1 = first out) and the frame of the last hazard hit. */
  eliminated: number; hazardHit: number;
  cpuMemo: CpuMemo;
  /** Ice Climbers: the partner's leader id (Nana follows Popo, or Popo follows a Nana pick) and the leader's recent inputs she replays. */
  leader: string | null; echo: Input[];
};
export type Projectile = {
  id: number; owner: string; team: 0 | 1 | null; kind: string; x: number; y: number; vx: number; vy: number; r: number; life: number; effect: HitEffect;
  damage: number; angle: number; kbBase: number; kbGrowth: number; fixedKb: number; gravity: number; bounce: number; ground: boolean;
  reflectable: boolean; absorbable: boolean; pierce: boolean; flinch: boolean; hitIds: string[]; move: MoveId; hits: number;
  homing?: number; boomerang?: number;
  /** Spawn frame; steer rate toward the owner's stick; the phase a self-hit sends the owner into; explosive blast; PK Fire pillar; Disable stun (src/specials types). */
  born?: number; steer?: number; self?: string; blast?: { r: number; damage: number; life?: number; kbBase?: number; kbGrowth?: number; angle?: number }; pillar?: [number, number]; stun?: number; rehit?: number;
};
export type State = {
  turnId: string; phase: Phase; phaseEndsAt: number; endsAt: number; frame: number; stageId: StageId; stageTick: number;
  hazards: boolean; teams: boolean; stocks: number; settings: Settings; seed: number; rng: number;
  fighters: Fighter[]; projectiles: Projectile[]; events: GameEvent[]; eventId: number; projectileId: number;
  eliminations: number; winners: string[]; hazardCycle: number; lastNow: number;
};
