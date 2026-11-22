import type { GameRules } from '../../../party-contract/src/index';
import { MISSIONS, neutralInput, type Action, type Input, type Settings } from './model';
import type { Own, Wire } from './wire';
import { parseChoice, playing, record } from './sim/state';
import { useTool } from './sim/crew';
import { clock, createNight, outcome, ownNight, presence, publicNight, tickNight, type Night } from './sim/night';

export type { Night } from './sim/night';
export type { State } from './sim/state';

export const rules: GameRules<Night, Input, Action, Settings, Wire, Own | null> = {
  validateSettings(raw) {
    const v = record(raw), mission = v.mission ?? 'velvet', difficulty = v.difficulty ?? 'normal';
    if (Object.keys(v).some(k => k !== 'mission' && k !== 'difficulty') || typeof mission !== 'string' || !Object.hasOwn(MISSIONS, mission) || (difficulty !== 'normal' && difficulty !== 'relaxed')) throw Error('Choose a mission and difficulty.');
    return { mission, difficulty } as Settings;
  },
  parseLobbyChoice: parseChoice, neutralInput,
  parseInput(raw) {
    const v = record(raw), { x, y } = v, sneak = v.sneak ?? false;
    if (Object.keys(v).some(k => !['x', 'y', 'sneak'].includes(k)) || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1 || typeof sneak !== 'boolean') throw Error('Invalid movement.');
    const length = Math.max(1, Math.hypot(x, y));
    return { x: x / length, y: y / length, sneak };
  },
  parseAction(raw) {
    const v = record(raw);
    if (Object.keys(v).some(k => k !== 'type' && k !== 'heistId') || v.type !== 'tool' || typeof v.heistId !== 'string' || !v.heistId || v.heistId.length > 128) throw Error('Invalid tool action.');
    return { type: 'tool', heistId: v.heistId };
  },
  create: (ctx, settings) => createNight(ctx, settings),
  applyAction(night, id, action, wall) {
    const s = night.heists[night.crewOf.get(id) ?? -1], p = s?.crew.find(q => q.id === id);
    if (!p || !playing(s) || action.heistId !== s.heistId) throw Error('This heist is over.');
    clock(s, wall); night.stamp++;
    useTool(s, p);
  },
  tick: tickNight,
  onPresenceChange(night, id, connected, wall) { const s = night.heists[night.crewOf.get(id) ?? -1]; if (s) { presence(s, id, connected, wall); night.stamp++; } },
  publicView: publicNight, playerView: ownNight, outcome,
  dispose() {},
};
export default rules;
