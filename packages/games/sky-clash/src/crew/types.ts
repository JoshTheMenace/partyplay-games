/** What a crew fighter is made of: authored physics, frame data, hitboxes on bones, specials and keyframed animation. Browser-safe. */
import type { Clip, Pose, Rig } from '../anim/core';
import type { HitEffect, Limb, MoveId } from '../model';
import type { Kit } from '../specials/types';

/** Meters and frames (60 per second); speeds are meters per frame. */
export type CrewPhysics = {
  walk: number; run: number; dashInitial: number; friction: number; jumpsquat: number; fullHop: number; shortHop: number; airJump: number; jumps: number;
  gravity: number; terminal: number; fastFall: number; airSpeed: number; airAccel: number; airFriction: number; weight: number; landing: number; shieldSize: number;
};
/** A hitbox riding a rig anchor or bone while frames from..to (exclusive) of the move are live. `off` shifts it [forward, up] in fighter space. */
export type CrewHit = {
  from: number; to: number; at: string; off?: readonly [number, number]; r: number; damage: number; angle: number; kb: readonly [base: number, growth: number];
  effect?: HitEffect; fixed?: number; shield?: number; group?: number; ground?: boolean; air?: boolean; clank?: boolean;
  /** What strikes (for the hit read-out and sounds); a weapon unless said otherwise. */
  limb?: Limb;
};
export type CrewThrow = { damage: number; angle: number; kb: readonly [number, number]; effect?: HitEffect; release: number; turn?: boolean };
/** A weapon or limb smear drawn while the move is in `frames`: from anchor `base` out to anchor `tip`. */
export type CrewTrail = { tip: string; base: string; frames: readonly [number, number]; color?: string; width?: number };
export type CrewMove = {
  name: string; total: number; clip: Clip; hits?: readonly CrewHit[];
  /** First interruptible frame; the frame a smash holds to charge; aerial landing lag and the frames outside which it lands clean. */
  iasa?: number; charge?: number; landingLag?: number; autoCancel?: readonly [before: number, after: number];
  intangible?: readonly (readonly [number, number])[]; throw?: CrewThrow; followup?: number; shots?: readonly number[];
  trail?: CrewTrail | readonly CrewTrail[];
  /** A glassy sphere drawn at an anchor while the move is in `frames` (a blown bulb, a bubble underfoot, a pane held out): radius in meters, `off` [forward, up]. */
  aura?: { at: string; r: number; frames: readonly [number, number]; off?: readonly [number, number] };
  /** Short accent for the renderer at a frame: 'step' dust, a 'flare' at an anchor, a 'burst' of the element from the ground, resonance 'ring's. */
  cues?: readonly { f: number; kind: 'step' | 'flare' | 'burst' | 'swish' | 'ring'; at?: string; power?: number }[];
};
/** Looping and one-shot clips for everything that is not an attack. */
export type StateClip = 'idle' | 'walk' | 'run' | 'dash' | 'turn' | 'crouch' | 'jumpsquat' | 'rise' | 'apex' | 'fall' | 'airjump' | 'land' | 'landHard' | 'hurt' | 'hurtAir' | 'tumble'
  | 'shield' | 'shieldstun' | 'dizzy' | 'sleep' | 'rollF' | 'rollB' | 'spotdodge' | 'airdodge' | 'helpless' | 'ledge' | 'ledgeclimb' | 'grab' | 'grabbed' | 'thrown'
  | 'knockdown' | 'getup' | 'tech' | 'teeter' | 'respawn' | 'win' | 'lose' | 'select';
export type CrewTiming = Partial<Record<'spotdodge' | 'rollF' | 'rollB' | 'airdodge' | 'tech' | 'techF' | 'techB' | 'techWall' | 'techCeil' | 'bound' | 'getup' | 'getupF' | 'getupB' | 'ledgeCatch'
  | 'climb' | 'climbSlow' | 'ledgeRoll' | 'ledgeRollSlow' | 'ledgeJump' | 'ledgeJumpSlow' | 'guardOff' | 'rebound' | 'turn' | 'dash' | 'grabRelease' | 'capturedRelease', readonly [total: number, intangibleFrom?: number, intangibleTo?: number]>>;
export type CrewDef = {
  rig: Rig; physics: CrewPhysics; timing?: CrewTiming; stance: Pose;
  states: Record<StateClip, Clip>;
  moves: Partial<Record<MoveId, CrewMove>>;
  /** Special scripts by slot move, then by phase key ('' is the base phase; an 'Air' suffix is picked when airborne). */
  specials: Partial<Record<'nspecial' | 'sspecial' | 'uspecial' | 'dspecial', Record<string, CrewMove>>>;
  kit: Kit;
  /** Element colours for trails and effects, and distances in meters for one walk and one run cycle (two steps). */
  element: { color: string; hot: string }; stride: { walk: number; run: number };
  /** Spring tuning per extra_ chain prefix: [stiffness 0..1, damping 0..1, gravity m/s^2, max swing degrees]. */
  springs?: Record<string, readonly [number, number, number, number]>;
};
