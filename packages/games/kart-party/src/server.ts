import type { GameRules } from '../../../party-contract/src/index';
import { createRace, sanitizeInput, stepRace } from '../../../../modules/kart-party/game/simulation';
import { activateItem } from '../../../../modules/kart-party/game/items';
import { TRACKS } from '../../../../modules/kart-party/game/tracks';
import { isSpeedClass } from '../../../../modules/kart-party/game/speed';
import { setPersonalCamera } from '../../../../modules/kart-party/game/personal-camera';
import { NEUTRAL, type Input, type Race, type RaceOptions } from '../../../../modules/kart-party/game/types';
export type Action = { type: 'use' } | { type: 'camera'; enabled: boolean };
export type Settings = Required<Pick<RaceOptions, 'track' | 'laps' | 'speedClass' | 'difficulty'>>;
export const rules: GameRules<Race, Input, Action, Settings, Race, null> = {
  validateSettings(raw) {
    const value = (raw ?? {}) as Partial<Settings>;
    const settings = { track: value.track ?? 'coast', laps: value.laps ?? 3, speedClass: value.speedClass ?? 100, difficulty: value.difficulty ?? 'normal' };
    if (!Object.hasOwn(TRACKS, settings.track) || !Number.isInteger(settings.laps) || settings.laps < 1 || settings.laps > 5 || !isSpeedClass(settings.speedClass) || !['easy','normal','hard'].includes(settings.difficulty)) throw Error('Choose a course, 1–5 laps, speed class and difficulty.');
    return settings;
  },
  create(ctx, settings) { return { ...createRace({ ...settings, seed: ctx.seed, players: ctx.players.map((player, driver) => ({ ...player, driver })) }), startId: ctx.roundId, startAt: ctx.nowMs + 3500 }; },
  parseInput: sanitizeInput, neutralInput: () => ({ ...NEUTRAL }),
  parseAction(raw) {
    if ((raw as Action)?.type === 'use') return { type: 'use' };
    if ((raw as Action)?.type === 'camera' && typeof (raw as { enabled?: unknown }).enabled === 'boolean') return { type: 'camera', enabled: (raw as { enabled: boolean }).enabled };
    throw Error('Unknown racing action.');
  },
  applyAction(state, id, action) {
    const racer = state.racers.find(player => player.id === id);
    if (!racer || racer.bot) return;
    if (action.type === 'camera') { setPersonalCamera(state, id, action.enabled); return; }
    if (state.phase === 'racing') activateItem(state, racer);
  },
  tick(state, inputs, _dt, now) {
    if (state.phase === 'countdown') { state.countdown = Math.max(0, (state.startAt! - now) / 1000); if (!state.countdown) state.phase = 'racing'; return; }
    stepRace(state, Object.fromEntries(inputs));
  },
  onPresenceChange(state, id, connected) { const racer = state.racers.find(player => player.id === id); if (racer) racer.connected = connected; if (!connected) setPersonalCamera(state,id,false); },
  // The legacy engine sometimes clears optional pose fields with undefined.
  publicView: state => JSON.parse(JSON.stringify(state)), playerView: () => null,
  outcome: state => ({ complete: state.phase === 'results', winners: state.racers.filter(player => !player.bot && player.rank === 1).map(player => player.id), rows: state.racers.filter(player => !player.bot).sort((a,b) => a.rank-b.rank).map(player => ({ playerId: player.id, rank: player.rank, label: player.finishTime === null ? 'Did not finish' : `${player.finishTime.toFixed(1)}s` })) }),
  dispose() {},
};
