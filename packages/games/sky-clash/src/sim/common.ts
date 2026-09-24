/** Fighter helpers shared by the state machine, specials, combat and CPUs, including the one place a hit lands (takeHit). */
import type { FighterState, HitEffect, MoveId } from '../model';
import { PHYSICS, TIMING } from '../moveset';
import { KITS } from './kits';
import { hitlagFrames, hitstunFrames, knockback, launchAngle, TUMBLE } from './formulas';
import type { Fighter, State } from './types';
import { emit } from './util';

export const P = (f: Fighter) => PHYSICS[f.kind];
/** Party recovery (the default): stronger air jumps and up-specials for phone lag; 'melee' keeps Melee's values. */
export const party = (s: State) => s.settings.recovery !== 'melee';
export const PARTY_JUMP = 1.3, PARTY_UP_B = 1.45;
export function setState(f: Fighter, state: FighterState, timer = 0) { f.state = state; f.stateFrame = 0; f.timer = timer; }
export function clearMove(f: Fighter) { f.move = null; f.moveFrame = 0; f.phase = ''; f.phaseFrame = 0; f.charge = 0; f.hitIds = []; f.special.scale = 0; f.special.counter = 0; }
export function startMove(s: State, f: Fighter, move: MoveId, state: FighterState = 'attack') {
  clearMove(f); f.move = move; f.staled = false; setState(f, state);
  emit(s, 'swing', f.x, f.y + P(f).height * .5, { source: f.id, move });
}
export function toAir(f: Fighter, state: FighterState = 'air') { f.grounded = false; f.ground = null; if (state !== f.state) setState(f, state); }
export const isAerial = (m: MoveId | null) => m === 'nair' || m === 'fair' || m === 'bair' || m === 'uair' || m === 'dair';
export const isSpecial = (m: MoveId | null) => !!m && m.includes('special');
export const isSmash = (m: MoveId | null) => m === 'fsmash' || m === 'fsmashHi' || m === 'fsmashLw' || m === 'usmash' || m === 'dsmash';
export const isThrow = (m: MoveId | null) => m === 'fthrow' || m === 'bthrow' || m === 'uthrow' || m === 'dthrow';
/** Melee's action frame (1 = first frame) for script windows: moves count moveFrame, specials count within their phase. */
export const scriptFrame = (f: Fighter) => (isSpecial(f.move) ? f.phaseFrame : f.moveFrame) + 1;
export const inRange = (ranges: readonly [number, number][], frame: number) => ranges.some(([a, b]) => frame >= a && frame < b);
export const alive = (f: Fighter) => f.state !== 'out';
/** Same side: teammates, or an Ice Climber and her partner. Allies never hit, grab or target each other. */
export const allied = (s: State, a: Fighter, b: Fighter) => (a.leader ?? a.id) === (b.leader ?? b.id) || (s.teams && a.team === b.team);
export const foes = (s: State, f: Fighter) => s.fighters.filter(o => alive(o) && !allied(s, o, f));
export const byId = (s: State, id: string | null) => (id ? s.fighters.find(o => o.id === id) : undefined);
/** Who is credited for f's damage and KOs: an Ice Climbers partner scores for her leader. */
export const creditOf = (s: State, f: Fighter) => byId(s, f.leader) ?? f;
export const endMove = (f: Fighter) => { clearMove(f); setState(f, f.grounded ? 'idle' : 'air'); };

/** Let go of a held fighter (grab, command grab or inhale) without launching them. */
export function dropHeld(s: State, f: Fighter) {
  const v = byId(s, f.holding); f.holding = null;
  if (v && v.grabbedBy === f.id) { v.grabbedBy = null; clearMove(v); setState(v, v.grounded ? 'idle' : 'air'); }
}
/** Grab release (timer, mash-out): both slide apart with CatchCut/CaptureCut timing. */
export function grabRelease(s: State, holder: Fighter, v: Fighter) {
  holder.holding = null; v.grabbedBy = null; clearMove(holder); clearMove(v);
  setState(holder, holder.grounded ? 'land' : 'air', Math.min(30, TIMING[holder.kind].grabRelease.total));
  v.vx = holder.facing * .09; holder.vx = -holder.facing * .05;
  if (holder.grounded) { v.grounded = true; v.ground = holder.ground; v.y = holder.y; setState(v, 'land', Math.min(30, TIMING[v.kind].capturedRelease.total)); }
  else toAir(v, 'air');
}
export function shieldBreak(s: State, f: Fighter) {
  dropHeld(s, f); f.shield = 30; clearMove(f); toAir(f, 'dizzy'); f.timer = Math.max(120, 400 - Math.floor(f.damage)); f.stateFrame = 0;
  f.vy = P(f).shieldBreakVy; f.vx = 0; f.y += .01;
  emit(s, 'shieldbreak', f.x, f.y + P(f).height / 2, { source: f.id, power: 1 });
}

export type Blow = { damage: number; angle: number; kbBase: number; kbGrowth: number; fixedKb?: number; effect?: HitEffect };
/** `sleep` puts the victim to sleep; `stuck` plants or traps them (buried, egged, disabled) for that many frames +1 per 3% damage. */
export type BlowOpts = { move?: MoveId; attackerLag?: boolean; x?: number; y?: number; kind?: 'hit' | 'hazard'; sleep?: number; stuck?: number };
/**
 * Apply one hit: damage, Melee knockback (crouch-cancel ×2/3), hitlag on both sides, then hitstun/tumble with the
 * launch deferred to the end of hitlag (so SDI and DI apply). Armor takes the damage without flinching.
 * `dir` is the knockback's horizontal sense (+1 = toward +X). Returns the knockback.
 */
export function takeHit(s: State, t: Fighter, b: Blow, dir: 1 | -1, from: Fighter | null, o: BlowOpts = {}): number {
  const p = P(t), crouch = t.grounded && t.state === 'crouch', electric = b.effect === 'electric';
  t.damage = Math.min(999, t.damage + b.damage);
  if (from) { creditOf(s, from).dealt += b.damage; t.lastHitBy = from.id; t.lastHitFrame = s.frame; }
  let kb = knockback(t.damage, b.damage, KITS[t.kind]?.weight ?? p.weight, b.kbBase, b.kbGrowth, b.fixedKb ?? 0);
  if (crouch) kb *= 2 / 3;
  const lag = hitlagFrames(b.damage, electric, crouch), x = o.x ?? t.x, y = o.y ?? t.y + p.height * .55;
  if (from && o.attackerLag) from.hitlag = Math.max(from.hitlag, hitlagFrames(b.damage, electric));
  const power = Math.min(1, kb / 160), angle = launchAngle(b.angle, kb, t.grounded, dir);
  emit(s, o.kind ?? 'hit', x, y, { source: from?.id, target: t.id, effect: b.effect ?? 'normal', move: o.move, power, angle: Math.round(angle), damage: Math.round(b.damage * 10) / 10 });
  if (t.armorNow && kb < 200) { t.special.armorTaken = (t.special.armorTaken ?? 0) + b.damage; t.hitlag = Math.max(t.hitlag, Math.ceil(lag / 2)); emit(s, 'armor', t.x, t.y + p.height / 2, { source: t.id }); return 0; }
  dropHeld(s, t);
  const holder = byId(s, t.grabbedBy); if (holder && holder.holding === t.id) { holder.holding = null; clearMove(holder); setState(holder, holder.grounded ? 'idle' : 'air'); }
  t.grabbedBy = null;
  const stunned = t.hitstun > 0 || t.hitlag > 0 || t.state === 'hitstun' || t.state === 'tumble';
  t.combo = stunned ? t.combo + 1 : 1;
  clearMove(t); t.ledge = null; t.hitlag = lag; t.vx = t.vy = 0; t.kx = t.ky = 0;
  t.fastFall = false; t.helpless = false; t.airdodged = false; t.ledgeFresh = true; t.bounces = 0; t.special.asleep = 0;
  if (o.sleep) { t.pending = null; t.launch = 0; t.hitstun = 0; setState(t, 'dizzy', Math.max(60, o.sleep - Math.floor(t.damage / 2))); t.special.asleep = 1; return kb; }
  if (o.stuck) { t.pending = null; t.launch = 0; t.hitstun = 0; setState(t, 'dizzy', Math.min(240, o.stuck + Math.floor(t.damage / 3))); return kb; }
  const tumble = kb >= TUMBLE;
  t.pending = { angle, kb, dir, hitstun: hitstunFrames(kb), tumble };
  t.hitstun = hitstunFrames(kb); t.tumble = tumble; t.facing = (-dir) as 1 | -1;
  setState(t, tumble ? 'tumble' : 'hitstun');
  return kb;
}
