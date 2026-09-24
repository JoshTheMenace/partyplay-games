import type { GameRules } from '../../../party-contract/src/index';
import { createRace, honk, NEUTRAL_INPUT, racerOutcome, stepRace } from './sim/race';
import { toRaceView } from './sim/view';
import { encodeRaceView, type RaceWire } from './net/wire';
import { isKartBody, isSpeedClass, CHARACTERS } from './sim/stats';
import { isTrackId } from './tracks/index';
import { resolveViewMode } from './views';
import type { Action, Input, LobbyChoice, Race, Settings } from './sim/types';
export type { Action, Settings } from './sim/types';

const DEFAULTS: Settings = { track: 'palm-bay', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: 8, items: 'normal', views: 'auto' };
const counter = (n: unknown) => Number.isInteger(n) ? ((n as number) % 256 + 256) % 256 : 0;
export const rules: GameRules<Race, Input, Action, Settings, RaceWire, null> = {
  validateSettings(raw) {
    const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw as Partial<Settings> : {}) };
    if (!isTrackId(s.track)) throw Error('Choose a course.');
    if (!Number.isInteger(s.laps) || s.laps < 1 || s.laps > 5) throw Error('Choose 1–5 laps.');
    if (!isSpeedClass(s.speedClass)) throw Error('Choose 50, 100, 150 or 200cc.');
    if (!['easy', 'normal', 'hard'].includes(s.difficulty)) throw Error('Choose a CPU difficulty.');
    if (!Number.isInteger(s.gridSize) || s.gridSize < 1 || s.gridSize > 10) throw Error('Choose a grid of 1–10 racers.');
    if (!['normal', 'frantic', 'off'].includes(s.items)) throw Error('Choose an item mode.');
    if (!['auto', 'tv', 'personal'].includes(s.views)) throw Error('Choose Auto, TV or personal views.');
    return { track: s.track, laps: s.laps, speedClass: s.speedClass, difficulty: s.difficulty, gridSize: s.gridSize, items: s.items, views: s.views };
  },
  parseLobbyChoice(raw, ready) {
    // Ready without a pick means "surprise me": the race assigns a free character and the Zoomer.
    void ready; if (raw === undefined || raw === null) return null;
    const c = raw as Partial<LobbyChoice>;
    if (!Number.isInteger(c.character) || c.character! < 0 || c.character! >= CHARACTERS.length || !isKartBody(c.kart)) throw Error('Choose a racer and a kart.');
    return { character: c.character, kart: c.kart };
  },
  create(ctx, settings) { return createRace(settings, ctx.players, ctx.seed, resolveViewMode(settings.views, ctx.players.length)); },
  neutralInput: () => ({ ...NEUTRAL_INPUT }),
  parseInput(raw) {
    const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Input, unknown>>;
    const steer = typeof v.steer === 'number' && Number.isFinite(v.steer) ? Math.max(-1, Math.min(1, v.steer)) : 0;
    return { steer, drift: v.drift === true, brake: v.brake === true, item: v.item === true, hop: counter(v.hop), fire: counter(v.fire), seq: Number.isInteger(v.seq) && (v.seq as number) >= 0 ? v.seq as number : 0 };
  },
  parseAction(raw) { if ((raw as Action | null)?.type === 'honk') return { type: 'honk' }; throw Error('Unknown action.'); },
  applyAction(state, playerId, action) { if (action.type === 'honk') honk(state, playerId); },
  tick(state, inputs, dt) { stepRace(state, inputs, dt); },
  onPresenceChange(state, playerId, connected) { const racer = state.racers.find(r => r.id === playerId); if (racer) racer.connected = connected; },
  publicView: state => encodeRaceView(toRaceView(state)), playerView: () => null,
  outcome: state => racerOutcome(state),
  dispose() {},
};
export default rules;
