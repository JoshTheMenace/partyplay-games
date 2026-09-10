import type { GameRules } from '../../../party-contract/src/index';
import { ARENA, type Input, type Settings, type View } from './model';
type State = View & { random: number };
function star(state: State) { const random = () => { state.random = (Math.imul(state.random, 1664525) + 1013904223) >>> 0; return state.random / 4294967296; }; const angle = random() * Math.PI * 2, radius = 2.5 + random() * 1.5; return { x: Math.cos(angle) * radius * 1.5, z: Math.sin(angle) * radius }; }
export const rules: GameRules<State, Input, never, Settings, View, null> = {
  validateSettings(raw) { if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Settings must be an object.'); const value = raw as Partial<Settings> | undefined; if (value && Object.keys(value).some(key => key !== 'seconds')) throw new Error('Unknown setting.'); const seconds = value?.seconds ?? 20; if (![20, 45].includes(seconds)) throw new Error('Choose a 20 or 45 second round.'); return { seconds }; },
  parseInput(raw) { const value = raw as Input; if (!value || Object.keys(value).some(key => !['x','y','boost'].includes(key)) || !Number.isFinite(value.x) || !Number.isFinite(value.y) || typeof value.boost !== 'boolean' || Math.abs(value.x) > 1 || Math.abs(value.y) > 1) throw new Error('Invalid steering input.'); const length = Math.max(1, Math.hypot(value.x, value.y)); return { x: value.x / length, y: value.y / length, boost: value.boost }; },
  neutralInput: () => ({ x: 0, y: 0, boost: false }), parseAction() { throw new Error('This arena uses held input.'); }, applyAction() {},
  create(ctx, settings) { const state: State = { random: ctx.seed >>> 0, players: ctx.players.map((player, index) => { const angle = index / ctx.players.length * Math.PI * 2; return { ...player, x: Math.cos(angle) * 6, z: Math.sin(angle) * 3.6, score: 0, connected: true }; }), stars: [], endsAt: ctx.nowMs + settings.seconds * 1000, complete: false }; state.stars = Array.from({ length: 8 }, () => star(state)); return state; },
  tick(state, inputs, dt, now) {
    if (now >= state.endsAt) { state.complete = true; return; }
    for (const player of state.players) {
      const input = inputs.get(player.id); if (!input || !player.connected) continue;
      const speed = input.boost ? ARENA.boostSpeed : ARENA.speed;
      player.x = Math.max(-ARENA.halfX + ARENA.radius, Math.min(ARENA.halfX - ARENA.radius, player.x + input.x * speed * dt));
      player.z = Math.max(-ARENA.halfZ + ARENA.radius, Math.min(ARENA.halfZ - ARENA.radius, player.z + input.y * speed * dt));
      const distance = Math.hypot(player.x, player.z), minDistance = ARENA.pillarRadius + ARENA.radius;
      if (distance < minDistance) { player.x = (distance ? player.x / distance : 1) * minDistance; player.z = (distance ? player.z / distance : 0) * minDistance; }
      state.stars.forEach((item, index) => { if (Math.hypot(player.x - item.x, player.z - item.z) < .7) { player.score++; state.stars[index] = star(state); } });
    }
  },
  onPresenceChange(state, id, connected) { const player = state.players.find(item => item.id === id); if (player) player.connected = connected; },
  publicView: state => ({ players: state.players.map(player => ({ ...player })), stars: state.stars.map(item => ({ ...item })), endsAt: state.endsAt, complete: state.complete }), playerView: () => null,
  outcome(state) { const best = Math.max(...state.players.map(player => player.score)); return { complete: state.complete, winners: state.players.filter(player => player.score === best).map(player => player.id), rows: [...state.players].sort((a, b) => b.score - a.score).map(player => ({ playerId: player.id, score: player.score })) }; }, dispose() {},
};
