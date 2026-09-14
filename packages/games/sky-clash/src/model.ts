import { getStage, type StageChoice, type StageId } from './stages';
import { ATTRIBUTES } from '../fidelity/attributes';
export { getMove } from './moves';
// Public, browser-safe combat data. Coordinates: +X right, +Y up; positions are feet.
import { ROSTER, ROSTER_DATA, type FighterKind } from './roster';
export { ROSTER, type FighterKind } from './roster';
export type Move = 'jab' | 'side' | 'upper' | 'sweep' | 'smash' | 'upsmash' | 'downsmash' | 'aerial' | 'forwardair' | 'backair' | 'upair' | 'downair' | 'dash' | 'rise' | 'laser' | 'reflect';
export type Mode = 'idle' | 'run' | 'air' | 'attack' | 'hurt' | 'shield' | 'respawn' | 'out' | 'jumpsquat' | 'landing' | 'dodge';
export type Presses = { jump: number; attack: number; special: number; smash: number };
// Input axes follow the shared pad: +X right, +Y DOWN (opposite world Y).
export type Input = { x: number; y: number; jump: boolean; attack: boolean; special: boolean; smash: boolean; shield: boolean; presses: Presses };
export type Action = { turnId: string; kind: FighterKind } | { turnId: string; stage: StageId };
export type LobbyChoice = { kind: FighterKind | null; stage: StageId | null };
export type Settings = { seconds: number; stocks: number; stage?: StageChoice; hazards?: boolean };
export type Fighter = {
  id: string; name: string; color: string; kind: FighterKind; chosen: boolean; connected: boolean;
  x: number; y: number; vx: number; vy: number; facing: number; grounded: boolean;
  damage: number; stocks: number; kos: number; falls: number; shield: number; mode: Mode;
  move: Move | null; moveFrame: number; charge: number; invulnerable: boolean; jumps: number; recoveryUsed: boolean; presses: Presses;
};
export type Impact = { id: number; kind: 'hit' | 'block' | 'ko' | 'break'; x: number; y: number; color: string; at: number };
export type Projectile = { id: number; owner: string; x: number; y: number; vx: number; color: string };
export type View = { stageId: StageId; stageTick: number; hazards: boolean; mapVotes: { playerId: string; stageId: StageId }[]; turnId: string; phase: 'select' | 'vote' | 'countdown' | 'fight' | 'complete'; phaseEndsAt: number; endsAt: number; players: Fighter[]; impacts: Impact[]; projectiles: Projectile[]; frame: number };
export const STAGE = {
  name: 'Cloudbreak', halfWidth: 8, blastX: getStage('cloudbreak').blastX, blastBottom: getStage('cloudbreak').blastBottom, blastTop: getStage('cloudbreak').blastTop, fighterRadius: .34, fighterHeight: 1.92,
  platforms: getStage('cloudbreak').platforms,
};
// Only the unit conversion changes: imported tuning remains in original units/frame.
export const UNIT = .08, VELOCITY = UNIT * 60;
type FighterInfo = { name: string; title: string; description: string; color: string; speed: number; weight: number; jump: number; gravity: number; jumps: number; height: number; radius: number; style: string; bonus: boolean; profile: string; specials: readonly string[] };
export const FIGHTERS = Object.fromEntries(ROSTER.map<[FighterKind, FighterInfo]>(kind => {
  const a = ATTRIBUTES[kind], data = ROSTER_DATA[kind];
  return [kind, { ...data, title: data.bonus ? 'Bonus fighter · adapted' : data.style[0].toUpperCase() + data.style.slice(1),
    description: data.bonus ? 'Adapted stock-match fighter with a borrowed movement profile.' : 'Imported movement and normal attacks. Reconstructed specials and collision.',
    speed: a.dash_max_velocity, weight: a.weight, jump: a.jump_v_initial_velocity, gravity: a.gravity, jumps: a.max_jumps }];
})) as Record<FighterKind, FighterInfo>;
export const neutralInput = (): Input => ({ x: 0, y: 0, jump: false, attack: false, special: false, smash: false, shield: false, presses: { jump: 0, attack: 0, special: 0, smash: 0 } });
export function interpolate(a: View, b: View, alpha: number): View {
  return { ...b, stageTick: a.stageTick + (b.stageTick - a.stageTick) * alpha, players: b.players.map(p => { const before = a.players.find(q => q.id === p.id); return before && before.stocks === p.stocks && before.mode !== 'respawn' && p.mode !== 'respawn' ? { ...p, x: before.x + (p.x - before.x) * alpha, y: before.y + (p.y - before.y) * alpha } : p; }) };
}
