import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import { Engine } from './engine.server.js';
import { dealArenas } from '../public/arenas.js';
import { MAPS, WEAPONS, WEAPON_ORDER, SUB_ORDER, SPECIAL_ORDER, IRIS_NAMES, BROW_NAMES, HAIR_STYLE_NAMES, SKIN_NAMES, OUTFIT_NAMES, HATS, TEAM_PALETTES } from './options.js';
import { neutral, type Action, type ArenaSummary, type Choice, type Input, type PrivateView, type PublicView, type RoomResult, type Roster, type Settings } from './model';
type Arena = { engine: Engine; settled: number; sentBaseline: number; own: PrivateView; ownTick: number };
type State = {
  arenas: Arena[]; roster: Roster[][]; seats: Map<string, { arena: number; nid: number; team: number }>; players: RoundContext['players']; roundId: string; settings: Settings;
  lastNow: number; clock: number; ticks: number; feature: number; featureAt: number; finale: boolean; baseline: string; view: PublicView | null; viewTick: number; result: RoomResult | null; final: PublicView | null;
};
/** Seconds the TV stays on one arena, and how long it holds on a finished one before moving to a live one. */
const CUT_EVERY = 14, HOLD_FINISH = 4, FINALE = 20;
function object(raw: unknown): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Inkwave settings or controls.'); return raw as Record<string, unknown>; }
function pick<T extends string>(value: unknown, values: readonly T[], fallback: T): T { if (value === undefined) return fallback; if (!values.includes(value as T)) throw new Error('Choose an available Inkwave option.'); return value as T; }
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** The room's result once every arena has one. One arena: its own result. Several: the two room-wide teams add up. */
export function roomResult(mode: Settings['mode'], arenas: RoomResult['arenas']): RoomResult {
  const wins = [0, 1].map(team => arenas.filter(arena => arena.result.winner === team).length);
  const coverage = [0, 1].map(team => Math.round(mean(arenas.map(arena => arena.coverage[team])) * 1e4) / 1e4), counts = [0, 1].map(team => arenas.reduce((sum, arena) => sum + (arena.zones?.count[team] ?? 0), 0));
  const lead = (a: number, b: number) => a === b ? -1 : a > b ? 0 : 1, first = arenas[0].result.winner;
  // Turf War: most turf across every arena, then arenas won (one arena alone can end level, as it always could).
  // Zone Control: arenas won, then the lower countdown total, then turf. Boss Battle is cooperative: the room wins when
  // at least half its squads sink their boss.
  const order = mode === 'boss' ? [wins[0] * 2 >= arenas.length ? 0 : 1] : mode === 'zones' ? [lead(wins[0], wins[1]), lead(counts[1], counts[0]), lead(coverage[0], coverage[1])] : [lead(coverage[0], coverage[1]), arenas.length > 1 ? lead(wins[0], wins[1]) : -1];
  const decided = order.find(team => team >= 0);
  return { winner: decided ?? first, tie: mode === 'turf' && decided === undefined, coverage, wins, arenas };
}
function summary(engine: Engine): ArenaSummary {
  const feed = engine.feed(), boss = feed.boss;
  return { state: feed.state, time: feed.time, coverage: feed.coverage, ...(feed.zones ? { count: feed.zones.count } : {}), ...(boss ? { boss: [Math.round(Number(boss[7]) / Number(boss[17]) * 1000) / 1000, Number(boss[8])] } : {}), ...(feed.result ? { winner: feed.result.winner } : {}) };
}
/** Which arena the TV shows: each live arena in turn, a few seconds on a finish, and the closest Turf War for the last twenty seconds. */
function direct(state: State) {
  const { arenas } = state, live = arenas.map((_, index) => index).filter(index => !arenas[index].engine.result);
  if (arenas.length === 1 || !live.length) return;
  const since = state.clock - state.featureAt, watching = live.includes(state.feature);
  let next = state.feature;
  if (state.settings.mode === 'turf' && !state.finale && Math.min(...live.map(index => arenas[index].engine.time)) <= FINALE) {
    state.finale = true;
    const gap = (index: number) => { const [a, b] = arenas[index].engine.coverage(); return Math.abs(a - b); };
    next = live.reduce((best, index) => gap(index) < gap(best) ? index : best);
  } else if (!watching ? since >= HOLD_FINISH : !state.finale && since >= CUT_EVERY) next = live.find(index => index > state.feature) ?? live[0];
  if (next === state.feature) return;
  // The screens that start watching this arena repaint from a baseline taken at this moment.
  state.feature = next; state.featureAt = state.clock; arenas[next].engine.rebaseline();
}
function project(state: State): PublicView {
  // The platform keeps sending the results snapshot at the snapshot rate, so the finished round is one small still view:
  // the last scoreboard without actors, events or paint. The result itself is a cached field: this view's revision is 1,
  // so it reaches every socket once.
  if (state.final) return state.final;
  if (state.view && state.viewTick === state.ticks) return state.view;
  // `ink` is always the featured arena's newest baseline, for a screen that connects now. The transport caches it with the
  // roster and sends both once per socket (the revision never moves); screens already watching get each retaken baseline
  // once, as `fresh`, which is also how the TV repaints when the broadcast cuts to another arena.
  const featured = state.arenas[state.feature].engine, baseline = `${state.feature}:${featured.baselines}`, fresh = baseline !== state.baseline;
  state.baseline = baseline;
  if (!state.result && state.arenas.every(arena => arena.engine.result)) state.result = roomResult(state.settings.mode, state.arenas.map(({ engine }) => { const feed = engine.feed(); return { coverage: feed.coverage, zones: feed.zones, stats: feed.stats, result: feed.result! }; }));
  state.viewTick = state.ticks;
  const live = featured.feed();
  if (state.result) return state.final = { roundId: state.roundId, settings: state.settings, colors: [TEAM_PALETTES[0].a, TEAM_PALETTES[0].b], teams: TEAM_PALETTES[0].names, roster: state.roster, arenas: state.arenas.map(arena => summary(arena.engine)), feature: state.feature, live: { ...live, actors: [], events: [], beacons: [], bossMoves: [] }, revision: 1, ink: '', inkSequence: featured.inkSequence, result: state.result };
  return state.view = { roundId: state.roundId, settings: state.settings, colors: [TEAM_PALETTES[0].a, TEAM_PALETTES[0].b], teams: TEAM_PALETTES[0].names, roster: state.roster, arenas: state.arenas.map(arena => summary(arena.engine)), feature: state.feature, live, revision: 0, ink: featured.ink, inkSequence: featured.inkSequence, ...(fresh ? { fresh: { ink: featured.ink, inkSequence: featured.inkSequence } } : {}), result: state.result };
}
export const rules: GameRules<State, Input, Action, Settings, PublicView, PrivateView> = {
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
  applyAction(state, id, action) {
    const seat = state.seats.get(id); if (action.turnId !== state.roundId || !seat) throw new Error('That match has ended.');
    state.arenas[seat.arena].engine.action(id, action);
  },
  neutralInput: neutral,
  create(context, settings) {
    rules.validateStart!(context.players, settings);
    const roster = dealArenas(context.players, settings, WEAPON_ORDER, !!MAPS.find(map => map.id === settings.map)?.noBots), arenas: Arena[] = [];
    try {
      // Each arena gets its own seed and staggers its paint baselines, so eight arenas never pack their grids on the same tick.
      for (const [index, seats] of roster.entries()) arenas.push({ engine: new Engine(seats, settings, context.seed + index * 7919, index / roster.length, arenas[0]?.engine.world), settled: 0, sentBaseline: -1, own: null, ownTick: -1 });
    } catch (error) { for (const arena of arenas) arena.engine.dispose(); throw error; }
    const seats = new Map(roster.flatMap(arena => arena.filter(seat => !seat.bot).map(seat => [seat.id, { arena: seat.arena, nid: seat.nid, team: seat.team }] as const)));
    return { arenas, roster, seats, players: context.players, roundId: context.roundId, settings, lastNow: context.nowMs, clock: 0, ticks: 0, feature: 0, featureAt: 0, finale: false, baseline: '', view: null, viewTick: -1, result: null, final: null };
  },
  tick(state, inputs, dt, now) {
    const elapsed = Math.max(dt, (now - state.lastNow) / 1000); state.lastNow = now; state.clock += dt; state.ticks++;
    // A decided arena runs half a second longer so its last events reach every screen, then rests while the others play on.
    for (const arena of state.arenas) if (!arena.engine.result || ++arena.settled <= 30) arena.engine.tick(inputs, dt, elapsed);
    direct(state);
  },
  onPresenceChange(state, id, connected) { const seat = state.seats.get(id); if (seat) state.arenas[seat.arena].engine.presence(id, connected); },
  publicView: project,
  playerView(state, id) {
    const seat = state.seats.get(id); if (state.arenas.length === 1 || !seat || state.final) return null;
    const arena = state.arenas[seat.arena], engine = arena.engine;
    if (arena.ownTick !== state.ticks) {
      // The arena's paint baseline rides along once each time it is retaken; a phone that reloads repaints from the next one.
      const fresh = arena.sentBaseline !== engine.baselines; arena.sentBaseline = engine.baselines; arena.ownTick = state.ticks;
      arena.own = { arena: seat.arena, feed: engine.feed(), ...(fresh ? { ink: engine.ink, inkSequence: engine.inkSequence } : {}) };
    }
    return arena.own;
  },
  outcome(state) {
    if (!state.arenas.every(arena => arena.engine.result)) return { complete: false, winners: [], rows: [] };
    const result = project(state).result!, boss = state.settings.mode === 'boss';
    const rows = state.players.map(player => {
      const seat = state.seats.get(player.id)!, stats = result.arenas[seat.arena].stats[seat.nid], won = boss ? result.arenas[seat.arena].result.winner === 0 : result.tie || seat.team === result.winner;
      // (A big room's rows repeat in every results snapshot: there the label is left to the results screen.)
      return { playerId: player.id, score: boss ? stats[4] : stats[0], rank: won ? 1 : 2, ...(state.arenas.length === 1 ? { label: boss ? `${stats[4]} damage · ${stats[5]} weak-point hits` : `${stats[1]} splats · ${stats[2]} splatted` } : {}) };
    });
    return { complete: true, winners: rows.filter(row => row.rank === 1).map(row => row.playerId), rows };
  },
  dispose(state) { for (const arena of state.arenas) arena.engine.dispose(); },
};
export default rules;
