/** Sky Clash room rules: strict parsing at the boundary, the Melee simulation in src/sim, compact public snapshots. */
import type { GameRules } from '../../../party-contract/src/index';
import { DEFAULT_SETTINGS, ROSTER, neutralInput, type Action, type Buttons, type Input, type LobbyChoice, type Presses, type Settings, type View } from './model';
import { STAGE_IDS, type StageId } from './stages';
import { startMove } from './sim/common';
import { createMatch, onPresence, outcomeOf, stepMatch, viewOf } from './sim/match';
import type { State } from './sim/types';
import { emit } from './sim/util';

const record = (raw: unknown, allowed: readonly string[], what: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${what} must be an object.`);
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) throw new Error(`Unknown ${what.toLowerCase()} field: ${k}.`);
  return raw as Record<string, unknown>;
};
const isStage = (v: unknown): v is StageId => (STAGE_IDS as readonly unknown[]).includes(v);
const oneOf = <T>(v: unknown, options: readonly T[], message: string): T => { if (!options.includes(v as T)) throw new Error(message); return v as T; };
const axis = (v: unknown) => { if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1) throw new Error('Stick axes must be numbers from -1 to 1.'); return v; };
const BUTTONS = ['attack', 'special', 'jump', 'shield', 'smash'] as const, PRESSES = [...BUTTONS, 'grab'] as const;
export const TIME_CHOICES = [0, 120, 180, 300, 480, 600] as const;

export function validateSettings(raw: unknown): Settings {
  const v = record(raw ?? {}, ['stocks', 'seconds', 'cpus', 'cpuLevel', 'teams', 'hazards', 'stage', 'lcancel', 'recovery'], 'Settings'), s: Settings = { ...DEFAULT_SETTINGS };
  if (v.stocks !== undefined) s.stocks = oneOf(v.stocks, [1, 2, 3, 4, 5], 'Stocks must be 1–5.');
  if (v.seconds !== undefined) s.seconds = oneOf(v.seconds, TIME_CHOICES, 'Choose an available time limit.');
  if (v.cpus !== undefined) s.cpus = oneOf(v.cpus, [0, 1, 2, 3], 'CPU fighters must be 0–3.');
  if (v.cpuLevel !== undefined) s.cpuLevel = oneOf(v.cpuLevel, [1, 2, 3] as const, 'CPU level must be 1, 2 or 3.');
  if (v.teams !== undefined) s.teams = oneOf(v.teams, [true, false], 'Teams must be on or off.');
  if (v.hazards !== undefined) s.hazards = oneOf(v.hazards, [true, false], 'Hazards must be on or off.');
  if (v.stage !== undefined) { if (v.stage !== 'vote' && v.stage !== 'random' && !isStage(v.stage)) throw new Error('Choose a stage from the list.'); s.stage = v.stage; }
  if (v.lcancel !== undefined) s.lcancel = oneOf(v.lcancel, ['auto', 'melee'] as const, 'L-cancel must be auto or melee.');
  if (v.recovery !== undefined) s.recovery = oneOf(v.recovery, ['party', 'melee'] as const, 'Recovery must be party or melee.');
  return s;
}
export function parseInput(raw: unknown): Input {
  const v = record(raw, ['x', 'y', 'held', 'presses', 'aim'], 'Input'), held = record(v.held, BUTTONS, 'Held buttons'), presses = record(v.presses, PRESSES, 'Presses'), aim = record(v.aim, ['x', 'y'], 'Aim');
  const out = { x: axis(v.x), y: axis(v.y), held: {} as Buttons, presses: {} as Presses, aim: { x: axis(aim.x), y: axis(aim.y) } };
  for (const k of BUTTONS) { if (typeof held[k] !== 'boolean') throw new Error('Held buttons must be true or false.'); out.held[k] = held[k]; }
  for (const k of PRESSES) { const n = presses[k]; if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 1e7) throw new Error('Press counters must be whole numbers.'); out.presses[k] = n as number; }
  return out;
}
export function parseAction(raw: unknown): Action {
  const v = record(raw, ['turnId', 'type'], 'Action');
  if (typeof v.turnId !== 'string' || !v.turnId || v.turnId.length > 128) throw new Error('Invalid round.');
  if (v.type !== 'taunt') throw new Error('Unknown action.');
  return { turnId: v.turnId, type: 'taunt' };
}
/** Public lobby draft. Drafts may be partial; ready requires a fighter and a stage vote. Random fighters wear costume 0. */
export function parseLobbyChoice(raw: unknown, ready: boolean): LobbyChoice {
  const v = record(raw, ['fighter', 'costume', 'stage'], 'Lobby choice');
  const fighter = v.fighter ?? null, stage = v.stage ?? null, costume = v.costume ?? 0;
  if (fighter !== null && fighter !== 'random' && !(ROSTER as unknown[]).includes(fighter)) throw new Error('Choose a fighter from the roster.');
  if (stage !== null && stage !== 'random' && !isStage(stage)) throw new Error('Choose a stage from the list.');
  if (!Number.isInteger(costume) || (costume as number) < 0 || (costume as number) > 3) throw new Error('Choose one of the four costumes.');
  if (ready && (fighter === null || stage === null)) throw new Error('Choose a fighter and vote for a stage before readying up.');
  return { fighter: fighter as LobbyChoice['fighter'], costume: fighter === 'random' ? 0 : costume as number, stage: stage as LobbyChoice['stage'] };
}
const TAUNTABLE = new Set(['idle', 'walk', 'crouch', 'teeter']);
export const rules: GameRules<State, Input, Action, Settings, View, null> = {
  validateSettings, parseInput, parseAction, parseLobbyChoice, neutralInput,
  create: (ctx, settings) => createMatch(ctx, settings),
  applyAction(state, playerId, action) {
    if (action.turnId !== state.turnId) throw new Error('This round has ended.');
    const f = state.fighters.find(o => o.id === playerId && !o.cpu);
    if (!f || (state.phase !== 'fight' && state.phase !== 'sudden') || !f.grounded || !TAUNTABLE.has(f.state)) return;
    startMove(state, f, 'taunt'); emit(state, 'taunt', f.x, f.y, { source: f.id });
  },
  tick: (state, inputs, _dt, nowMs) => stepMatch(state, inputs, nowMs),
  onPresenceChange: (state, playerId, connected, nowMs) => onPresence(state, playerId, connected, nowMs),
  publicView: state => viewOf(state),
  playerView: () => null,
  outcome: state => outcomeOf(state),
  dispose(state) { state.projectiles = []; state.events = []; },
};
export default rules;
