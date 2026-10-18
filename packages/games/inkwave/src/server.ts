import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import { Engine } from './engine.server.js';
import { MAPS, WEAPONS, WEAPON_ORDER, SUB_ORDER, SPECIAL_ORDER, IRIS_NAMES, BROW_NAMES, HAIR_STYLE_NAMES, SKIN_NAMES, OUTFIT_NAMES, HATS } from './options.js';
import { neutral, type Action, type Choice, type Input, type PublicView, type Settings } from './model';
type State = { engine: Engine; players: RoundContext['players']; roundId: string; lastNow: number; view: PublicView };
function object(raw: unknown): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Inkwave settings or controls.'); return raw as Record<string, unknown>; }
function pick<T extends string>(value: unknown, values: readonly T[], fallback: T): T { if (value === undefined) return fallback; if (!values.includes(value as T)) throw new Error('Choose an available Inkwave option.'); return value as T; }
export const rules: GameRules<State, Input, Action, Settings, PublicView, null> = {
  validateSettings(raw) {
    const value = object(raw), duration = value.duration ?? 180;
    if (![30, 60, 90, 180, 240, 300].includes(duration as number)) throw new Error('Choose an available match length.');
    const map = pick(value.map, MAPS.map(map => map.id), 'tidewater'), mode = pick(value.mode, ['turf', 'zones', 'boss'], 'turf');
    if (mode === 'boss' && MAPS.find(stage => stage.id === map)?.noBoss) throw new Error('Cargo Terminal supports Turf War and Zone Control. Choose another stage for Boss Battle.');
    return { map, mode, time: pick(value.time, ['day', 'dusk'], 'day'), duration: duration as number, difficulty: pick(value.difficulty, ['easy', 'normal', 'hard'], 'normal') };
  },
  validateStart(players, settings) { if (MAPS.find(map => map.id === settings.map)?.noBots && players.length < 2) throw new Error('Cargo Terminal needs at least two human players, one on each team. Other stages fill empty seats with CPUs.'); },
  parseLobbyChoice(raw): Choice {
    const value = object(raw), style = value.style === undefined ? {} : object(value.style), clean: Choice['style'] = {};
    for (const [key, count] of [['hair', HAIR_STYLE_NAMES.length], ['skin', SKIN_NAMES.length], ['outfit', OUTFIT_NAMES.length], ['hat', HATS.length], ['eyes', IRIS_NAMES.length], ['brows', BROW_NAMES.length]] as const) {
      const index = style[key] ?? 0; if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= count) throw new Error('Choose an available look.'); clean[key] = Number(index);
    }
    return { weapon: pick(value.weapon, WEAPON_ORDER, 'shooter'), sub: value.sub == null ? null : pick(value.sub, SUB_ORDER, WEAPONS.shooter.sub), special: value.special == null ? null : pick(value.special, SPECIAL_ORDER, WEAPONS.shooter.special), style: clean };
  },
  parseInput(raw) {
    const value = object(raw), input = neutral();
    for (const [key, limit] of [['moveX', 1], ['moveY', 1], ['yaw', Math.PI], ['pitch', 1.15], ['aimX', 512], ['aimY', 512], ['aimZ', 512]] as const) { const n = value[key]; if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > limit) throw new Error('Invalid movement or aim.'); input[key] = n; }
    for (const key of ['hasAim', 'fire', 'squid', 'jump', 'sub', 'special', 'cheer'] as const) { if (typeof value[key] !== 'boolean') throw new Error('Invalid button state.'); input[key] = value[key]; }
    const length = Math.max(1, Math.hypot(input.moveX, input.moveY)); input.moveX /= length; input.moveY /= length;
    return input;
  },
  parseAction(raw) {
    const value = object(raw); if (typeof value.turnId !== 'string') throw new Error('Missing match ID.');
    if (value.type === 'superjump' && Number.isInteger(value.target) && Number(value.target) >= -1 && Number(value.target) < 8) return { type: 'superjump', turnId: value.turnId, target: Number(value.target) };
    if (value.type === 'beacon' && Number.isInteger(value.target) && Number(value.target) > 0 && Number(value.target) < 800000) return { type: 'beacon', turnId: value.turnId, target: Number(value.target) };
    if (value.type === 'strike' && [value.x, value.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 512)) return { type: 'strike', turnId: value.turnId, x: Number(value.x), z: Number(value.z) };
    throw new Error('Invalid map action.');
  },
  applyAction(state, id, action) { if (action.turnId !== state.roundId) throw new Error('That match has ended.'); state.engine.action(id, action); }, neutralInput: neutral,
  create(context, settings) {
    rules.validateStart!(context.players, settings);
    const engine = new Engine(context.players, settings, context.seed, context.roundId);
    return { engine, players: context.players, roundId: context.roundId, lastNow: context.nowMs, view: engine.view() };
  },
  tick(state, inputs, dt, now) {
    state.engine.tick(inputs, dt, Math.max(dt, (now - state.lastNow) / 1000)); state.lastNow = now; state.view = state.engine.view();
  },
  onPresenceChange(state, id, connected) { state.engine.presence(id, connected); },
  publicView: state => state.view, playerView: () => null,
  outcome(state) {
    const { result, coverage, stats, settings, roster } = state.view, boss = settings.mode === 'boss', tie = result && settings.mode === 'turf' && coverage[0] === coverage[1], winner = result?.winner;
    const rows = state.players.map((player, index) => ({ playerId: player.id, score: Math.round(boss ? stats[index].bossDmg || 0 : stats[index].turf), rank: tie || roster[index].team === winner ? 1 : 2, label: boss ? `${Math.round(stats[index].bossDmg || 0)} damage · ${stats[index].weakHits || 0} weak-point hits` : `${stats[index].splats} splats · ${stats[index].deaths} splatted` }));
    return { complete: !!result, winners: result ? rows.filter(row => row.rank === 1).map(row => row.playerId) : [], rows };
  },
  dispose(state) { state.engine.dispose(); },
};
export default rules;
