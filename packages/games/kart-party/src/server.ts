import type { GameRules } from '../../../party-contract/src/index';
import { createRace, sanitizeInput, stepRace } from './engine/simulation';
import { activateItem } from './engine/items';
import { isKartId, type KartId } from './engine/garage';
import { TRACKS } from './engine/tracks';
import { isSpeedClass } from './engine/speed';
import { DRIVERS, NEUTRAL, type Input, type Race, type RaceOptions } from './engine/types';
import { resolveViewMode, type ViewMode } from './views';
export type Action = { type:'use' } | { type:'choose'; driver:number; kart:KartId } | { type:'ready' };
export type Settings = Required<Pick<RaceOptions, 'track' | 'laps' | 'speedClass' | 'difficulty'>> & { views: ViewMode };
export const rules: GameRules<Race, Input, Action, Settings, Race, null> = {
  validateSettings(raw) {
    const value = (raw ?? {}) as Partial<Settings>;
    const settings = { track: value.track ?? 'coast', laps: value.laps ?? 3, speedClass: value.speedClass ?? 100, difficulty: value.difficulty ?? 'normal', views: value.views ?? 'auto' };
    if (!['auto', 'tv', 'personal'].includes(settings.views)) throw Error('Choose Auto, TV views or personal views.');
    if (!Object.hasOwn(TRACKS, settings.track) || !Number.isInteger(settings.laps) || settings.laps < 1 || settings.laps > 5 || !isSpeedClass(settings.speedClass) || !['easy','normal','hard'].includes(settings.difficulty)) throw Error('Choose a course, 1–5 laps, speed class and difficulty.');
    return settings;
  },
  create(ctx, settings) { return { ...createRace({ ...settings, seed: ctx.seed, players: ctx.players.map((player, driver) => ({ ...player, driver })) }), viewMode: resolveViewMode(settings.views, ctx.players.length), startId: ctx.roundId, startAt: null, garage:{deadline:ctx.nowMs+45000,remaining:45,readyIds:[]} }; },
  parseInput: sanitizeInput, neutralInput: () => ({ ...NEUTRAL }),
  parseAction(raw) {
    const action=raw as Partial<Action>|null;
    if(action?.type==='use'||action?.type==='ready')return {type:action.type};
    if(action?.type==='choose'&&Number.isInteger(action.driver)&&action.driver!>=0&&action.driver!<DRIVERS.length&&isKartId(action.kart))return {type:'choose',driver:action.driver!,kart:action.kart};
    throw Error('Choose a valid driver and kart.');
  },
  applyAction(state,id,action) {
    const racer=state.racers.find(player=>player.id===id);if(!racer||racer.bot)return;
    if(action.type==='use'){if(state.phase==='racing')activateItem(state,racer);return;}
    if(!state.garage)throw Error('The race has started. Change your kart before the next race.');
    if(action.type==='choose'){racer.driver=action.driver;racer.kart=action.kart;state.garage.readyIds=state.garage.readyIds.filter(player=>player!==id);}
    else if(!state.garage.readyIds.includes(id))state.garage.readyIds.push(id);
  },
  tick(state, inputs, _dt, now) {
    if(state.garage){
      state.garage.remaining=Math.max(0,(state.garage.deadline-now)/1000);
      const players=state.racers.filter(racer=>!racer.bot&&racer.connected);
      if(state.garage.remaining===0||players.length>0&&players.every(racer=>state.garage!.readyIds.includes(racer.id))){delete state.garage;state.startAt=now+3500;}
      return;
    }
    if (state.phase === 'countdown') { state.countdown = Math.max(0, (state.startAt! - now) / 1000); if (!state.countdown) state.phase = 'racing'; return; }
    stepRace(state, Object.fromEntries(inputs));
  },
  onPresenceChange(state, id, connected) { const racer = state.racers.find(player => player.id === id); if (racer) racer.connected = connected; },
  // The legacy engine sometimes clears optional pose fields with undefined.
  publicView: state => JSON.parse(JSON.stringify(state)), playerView: () => null,
  outcome: state => ({ complete: state.phase === 'results', winners: state.racers.filter(player => !player.bot && player.rank === 1).map(player => player.id), rows: state.racers.filter(player => !player.bot).sort((a,b) => a.rank-b.rank).map(player => ({ playerId: player.id, rank: player.rank, label: player.finishTime === null ? 'Did not finish' : `${player.finishTime.toFixed(1)}s` })) }),
  dispose() {},
};
