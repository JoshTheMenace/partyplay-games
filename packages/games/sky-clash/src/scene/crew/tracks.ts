/** Which clip a crew fighter plays for a snapshot, and at which frame. Pure, so tests and tools share it with the actor. */
import { clipEnd, type Clip } from '../../anim/core';
import type { CrewDef, CrewMove, StateClip } from '../../crew/types';
import type { FighterView, MoveId } from '../../model';

/** Local clocks the actor advances between 30 Hz snapshots (frames), plus seconds and the stride phase 0..1. */
export type Clock = { state: number; move: number; seconds: number; gait: number; airJump: number };
export type Track = { key: string; clip: Clip; frame: number; blend: number; move?: CrewMove };
const SLOT: Partial<Record<MoveId, 'nspecial' | 'sspecial' | 'uspecial' | 'dspecial'>> = { nspecial: 'nspecial', nspecialAir: 'nspecial', sspecial: 'sspecial', sspecialAir: 'sspecial', uspecial: 'uspecial', uspecialAir: 'uspecial', dspecial: 'dspecial', dspecialAir: 'dspecial' };
/** The authored move behind a view: a normal by id, or a special's phase script (its 'Air' variant when airborne). */
export function crewMove(def: CrewDef, move: MoveId, phase: string | undefined, grounded: boolean): CrewMove | undefined {
  const slot = SLOT[move]; if (!slot) return def.moves[move];
  const phases = def.specials[slot]; if (!phases) return undefined;
  const key = phase ?? ''; return (!grounded && phases[key + 'Air']) || phases[key] || phases[''] || Object.values(phases)[0];
}
export function trackOf(def: CrewDef, v: FighterView, c: Clock, win = false): Track {
  const S = def.states, st = (name: StateClip, frame: number, blend = 5): Track => ({ key: 's:' + name, clip: S[name], frame, blend });
  const once = (name: StateClip, blend = 4) => st(name, Math.min(c.state, clipEnd(S[name])), blend), loop = (name: StateClip, blend = 6) => st(name, c.seconds * 60, blend);
  if (win && v.grounded && v.state !== 'out') return st('win', Math.min(c.state, clipEnd(S.win)), 6);
  if (v.move && v.state !== 'grabbed' && v.state !== 'thrown') {
    const m = crewMove(def, v.move, v.movePhase, v.grounded);
    if (m) return { key: `m:${v.move}:${v.movePhase ?? ''}:${v.grounded || !SLOT[v.move] ? '' : 'a'}`, clip: m.clip, frame: c.move, blend: 2, move: m };
  }
  switch (v.state) {
    case 'idle': return loop('idle');
    case 'walk': return st('walk', c.gait * clipEnd(S.walk), 5);
    case 'run': return c.state < clipEnd(S.dash) ? st('dash', c.state, 2) : st('run', c.gait * clipEnd(S.run), 4);
    case 'turn': return once('turn', 2);
    case 'crouch': return once('crouch');
    case 'jumpsquat': return once('jumpsquat', 2);
    case 'air': return c.airJump < clipEnd(S.airjump) ? st('airjump', c.airJump, 2) : v.vy > .04 ? st('rise', c.state, 4) : v.vy > -.05 ? st('apex', c.seconds * 60, 7) : st('fall', c.seconds * 60, 7);
    case 'land': return once('land', 2);
    case 'attack': return loop('idle');
    case 'hitstun': return v.grounded ? once('hurt', 1) : once('hurtAir', 1);
    case 'tumble': return st('tumble', c.seconds * 60, 3);
    case 'shield': return once('shield', 3);
    case 'shieldstun': return once('shieldstun', 1);
    case 'dizzy': return loop(v.asleep ? 'sleep' : 'dizzy');
    case 'roll': return once(v.vx * v.facing >= 0 ? 'rollF' : 'rollB', 2);
    case 'spotdodge': return once('spotdodge', 2);
    case 'airdodge': return once('airdodge', 2);
    case 'helpless': return loop('helpless');
    case 'ledge': return loop('ledge', 3);
    case 'ledgeclimb': return once('ledgeclimb', 3);
    case 'grab': return loop('grab', 3);
    case 'grabbed': return loop('grabbed', 3);
    case 'thrown': return loop('thrown', 3);
    case 'knockdown': return once('knockdown', 3);
    case 'getup': return once('getup', 3);
    case 'tech': return Math.abs(v.vx) > .02 ? once(v.vx * v.facing >= 0 ? 'rollF' : 'rollB', 2) : once('tech', 2);
    case 'teeter': return loop('teeter');
    case 'respawn': return loop('respawn');
    default: return loop('idle');
  }
}
