/**
 * Special-move kit contract and builders (browser-safe data). Hitbox windows always come from each fighter's imported
 * SpecialN/S/Hi/Lw scripts (src/moveset.ts phases); a kit adds what Melee runs in C callbacks: phase flow, movement,
 * projectiles, reflect/absorb/counter/armor windows, command grabs, teleports, charge and transforms.
 * Units: speeds meters/frame, gravity meters/frame², positions meters (x forward, y up from the feet), times frames.
 * Phase ids default to the script key ('' is the base subaction; '#2' the second script of that name).
 */
import type { FighterKind, HitEffect } from '../model';

export type Motion = {
  from?: number; to?: number;
  /** Only while grounded / airborne. */
  when?: 'ground' | 'air';
  /** Set velocity (vx forward-relative). */
  vx?: number; vy?: number;
  /** At `from`, launch along the stick (neutral = straight up) at this speed; `arc` limits the angle from vertical. */
  aim?: number; arc?: number;
  /** Aim only when the stick is held (Quick Attack's optional second zip). */
  stick?: boolean;
  /** At `from`, launch at this speed along the stored launch angle (PK Thunder 2: the bolt's travel), bent up to ~30° toward a held stick. */
  launch?: number;
  /** `brake` scales vx; `damp` scales both vx and vy (ends a rise cleanly). */
  ax?: number; ay?: number; brake?: number; damp?: number; gravity?: number; drift?: number; steer?: number; fall?: number;
  /** Added to vy on each special press (tornado-style rise). */
  mash?: number;
};
export type Shot = {
  at: number | 'script'; kind: string; damage: number; speed: number; angle?: number; gravity?: number; life?: number; r?: number;
  kbAngle?: number; kbBase?: number; kbGrowth?: number; fixedKb?: number; effect?: HitEffect; bounce?: number; ground?: boolean;
  pierce?: boolean; flinch?: boolean; reflectable?: boolean; absorbable?: boolean; x?: number; y?: number;
  /** Repeat every n frames of the phase until `until`; with `count`, stored charge sets how many (1..count) fly. */
  every?: number; until?: number; count?: number;
  /** Scale damage/speed/size with stored charge; aim with the stick; home on the nearest foe; return to the owner. */
  charge?: boolean; aimed?: boolean; homing?: number; boomerang?: boolean;
  /** Maximum of this kind alive per owner. */
  max?: number;
  /** Turn rate (radians/frame) toward the owner's stick while the owner stays in this special. */
  steer?: number;
  /** The shot can strike its own owner (after 12 frames): the owner enters this phase, launched along the shot's travel. */
  self?: string;
  /** Explodes when it expires, touches a fighter, or its owner detonates it: a still blast of this radius and damage. */
  blast?: { r: number; damage: number; life?: number; kbBase?: number; kbGrowth?: number; angle?: number };
  /** On its first body hit it stops and lingers this many frames, re-hitting every 6 frames for `damage` (PK Fire's pillar). */
  pillar?: [number, number];
  /** Freezes a grounded foe that faces the shot for this many frames (+1 per 3% damage) instead of hitting (Disable). */
  stun?: number;
};
export type InlineHit = { from: number; to: number; damage: number; angle: number; kbBase: number; kbGrowth: number; x: number; y: number; r: number; effect?: HitEffect; fixedKb?: number };
/** `back`: the victim is swung behind the thrower and launched that way; `stuck`: trapped in place instead of launched. */
export type Release = { at: number; damage: number; angle: number; kbBase: number; kbGrowth: number; fixedKb?: number; effect?: HitEffect; stuck?: number; back?: boolean };
export type Phase = {
  script?: string; total?: number; next?: string;
  /** Loop while the button is held; release (after `min`) → `release`; reaching `max` charge frames → `full` (or `release`). */
  hold?: { max: number; release: string; full?: string; min?: number; button?: 'special' | 'attack' | 'jump'; charge?: boolean; store?: boolean };
  /** Pressing special after `from` chains the next phase by stick direction (back and neutral default to side). */
  combo?: { from: number; up: string; side: string; down: string; back?: string; neutral?: string };
  /** Pressing special (or attack) after `from` switches phase (reflector re-press, stone exit, spit). */
  repress?: { from: number; to: string; attack?: boolean };
  motion?: Motion[]; shots?: Shot[]; hits?: InlineHit[];
  reflect?: [number, number]; absorb?: [number, number]; armor?: [number, number]; intangible?: [number, number];
  /** Damage the armor soaks before it gives way (Stone). */
  armorHp?: number;
  /** Counter window, the phase to play when countered, and an optional multiplier of the countered damage. */
  counter?: [number, number, string, number?];
  /** Ledges can be grabbed from this frame of the phase. */
  ledge?: number;
  /** Landing: go to a phase, 'lag' (landing lag then end), 'keep' (continue grounded) or 'stop'. Default: helpless specials lag, others keep. */
  land?: string;
  /** Connecting with a hitbox switches phase; `grab` makes the hitboxes a command grab holding the victim in that phase. */
  onHit?: string; grab?: string;
  /** Hitboxes strike only the held victim, adding damage without releasing (bites, Dark Dive's shocks). */
  pummel?: boolean;
  /** Release a command-grabbed victim with this knockback (`stuck`: trapped in place instead, mashing out). */
  release?: Release;
  teleport?: { at: number; dist: number };
  /** Full-charge damage multiplier for release phases (interpolated by charge). */
  scale?: number;
  /** Hits reverse the victim's facing (Mario's cape). */
  reverse?: boolean;
  /** After the special: sleep this many frames (Rest). */
  rest?: number;
  transform?: FighterKind; heal?: number; selfDamage?: number;
  jumpCancel?: number;
  /** Pick one of these phases at random (Judgment, turnips, misfires); repeat ids to weight them. */
  random?: string[];
  /** Hits put the victim to sleep instead of launching (Sing). */
  sleep?: number;
  /** Hits on grounded foes plant them in place this many frames instead of launching (Headbutt). */
  bury?: number;
  /** Stay in this phase while the owner's shot of this kind lives; when it is gone, go to the phase (PK Thunder, Thunder, Din's Fire). */
  tether?: [kind: string, phase: string];
  /** Entering the phase detonates the owner's shots of this kind (charge sets the blast size). */
  detonate?: string;
  /** Absorbed projectiles fill the bucket instead of healing (Oil Panic). */
  bucket?: boolean;
};
export type Special = {
  start: string; phases: Record<string, Phase>;
  /** Start phase when used airborne. */
  air?: string;
  /** Start phase when the press came with a stick flick (Samus's Super Missile). */
  smash?: string;
  /** Ends in helpless fall if airborne, with this landing lag. */
  helpless?: boolean; lag?: number;
  /** Usable once per airtime (side and up recoveries). */
  once?: boolean;
  /** First air use per airtime sets vy to at least this (stall/float). */
  stall?: number;
  /** Stored-charge key and the full-charge frame count (Samus, DK, Mewtwo). Full stored charge skips straight to `fire`. */
  charge?: { max: number; fire: string };
  /** Oil Panic: after `count` absorptions the next use plays `fire`, dealing the absorbed damage × `mult` (capped at 50). */
  bucket?: { count: number; fire: string; mult: number };
  groundOnly?: boolean;
  /** Damage multiplier for every hit, shot and release of this special (bonus fighters). */
  power?: number;
};
export type Slot = 'n' | 's' | 'hi' | 'lw';
export type Kit = Partial<Record<Slot, Special>> & {
  /** Frames of Peach-style float: hold Jump while falling (once per airtime). */
  float?: number;
  /** Bonus-fighter tuning: damage multiplier for every attack (normals included) and a weight override. */
  power?: number; weight?: number;
};

// ── Builders ─────────────────────────────────────────────────────────────
export const shot = (at: Shot['at'], kind: string, damage: number, speed: number, o: Partial<Shot> = {}): Shot => ({ at, kind, damage, speed, ...o });
export const one = (o: Phase = {}, sp: Partial<Special> = {}): Special => ({ start: '', phases: { '': o }, ...sp });
export const hit = (from: number, to: number, damage: number, angle: number, kbBase: number, kbGrowth: number, x: number, y: number, r: number, effect?: HitEffect): InlineHit =>
  ({ from, to, damage, angle, kbBase, kbGrowth, x, y, r, ...(effect ? { effect } : {}) });
export const still: Motion = { vx: 0, vy: 0, gravity: 0 };
/**
 * Rising recovery: freeze until `from`, then rise at a steady `speed - decay` with stick steering (height ≈ (to - from) × that);
 * with `arc`, launch along the stick within that many degrees of vertical, slowing by `decay` per frame. Momentum is damped at `to`.
 */
export const rise = (from: number, to: number, speed: number, decay: number, steer = .02, arc?: number): Motion[] =>
  [{ from: 0, to: from, ...still }, ...(arc === undefined ? [{ from, to, vy: speed, ay: -decay, steer, gravity: 0 }] : [{ from, to: from + 1, aim: speed, arc }, { from: from + 1, to, ay: -decay, gravity: 0 }]), { from: to, to: to + 1, damp: .15 }];
/** Hold-to-charge special with a release phase (`full` plays at maximum charge). */
export const charged = (start: string, loop: string, release: string, max: number, o: Partial<Phase> = {}, full?: string): Special =>
  ({ start, phases: { [start]: { next: loop }, [loop]: { hold: { max, release, ...(full ? { full } : {}), charge: true } }, [release]: { scale: 3, ...o }, ...(full ? { [full]: {} } : {}) } });
/** Counter stance: countered hits play `Hit` (optionally dealing the countered damage × mult). */
export const counter = (window: [number, number], mult?: number): Special => ({ start: '', phases: { '': { counter: [window[0], window[1], 'Hit', mult], motion: [{ gravity: .5, fall: .05 }] }, Hit: {} } });
/** Fox/Falco reflector: frame-1 hit, reflect from the first frame, jump-cancelable, held with Special. */
export const reflector = (): Special => ({ start: 'Start', phases: {
  Start: { next: 'Loop', reflect: [0, 4], jumpCancel: 1, motion: [{ brake: .5, vy: 0, gravity: 0 }] },
  Loop: { hold: { max: 99999, release: 'End' }, reflect: [0, 999], jumpCancel: 0, motion: [{ brake: .6, gravity: .2, fall: .05 }] },
  End: { reflect: [0, 3], jumpCancel: 0, motion: [{ gravity: .6, fall: .08 }] },
} });
/** Marth/Roy Dancing Blade: four swings chained by re-pressing Special, each branching up/side/down. */
export const dancing = (): Special => ({ start: '1', stall: .03, phases: {
  '1': { combo: { from: 9, up: '2Hi', side: '2Hi', down: '2Lw' } },
  '2Hi': { combo: { from: 15, up: '3Hi', side: '3S', down: '3Lw' } }, '2Lw': { combo: { from: 16, up: '3Hi', side: '3S', down: '3Lw' } },
  '3Hi': { combo: { from: 17, up: '4Hi', side: '4S', down: '4Lw' } }, '3S': { combo: { from: 14, up: '4Hi', side: '4S', down: '4Lw' } }, '3Lw': { combo: { from: 18, up: '4Hi', side: '4S', down: '4Lw' } },
  '4Hi': {}, '4S': {}, '4Lw': {},
} });
/** Weighted random table: `[phase, weight]` pairs to a repeated list. */
export const weighted = (...pairs: [string, number][]) => pairs.flatMap(([id, n]) => Array<string>(n).fill(id));
