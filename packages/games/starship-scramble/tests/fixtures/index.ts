import { rules } from '../../src/server';
import { definitions } from '../../src/definitions/server';
import { createShip } from '../../src/simulation';
import type { State } from '../../src/contracts';
export function fixture(count = 4, seed = 42): State {
  return rules.create({ roomId: 'starship-fixture', roundId: 'expedition-fixture', nowMs: 0, seed, players: Array.from({ length: count }, (_, index) => ({ id: `player-${index + 1}`, name: `Captain ${index + 1} Aurora`, color: ['#28c6e7', '#ffd24a', '#b58aff', '#78d955'][index] })) }, { difficulty: 'relaxed', expedition: 'training' });
}
export function battleFixture(count = 4, enemies = 6) {
  const state = fixture(count); state.phase = 'combat'; state.simulation.objective = { kind: 'destroy', deadlineMs: null, stage: 1, description: 'Disable the hostile fleet.' };
  for (let index = 0; index < enemies; index++) { const enemy = definitions.enemies[index]; const created = createShip(definitions, { id: `enemy-${index + 1}`, hullId: enemy.hullId, enemyId: enemy.id, ownerCaptainId: null, name: `E${index + 1} · ${enemy.name}`, color: '#ff5748', formation: index, faction: 'enemy' }); state.simulation.ships.push(created.ship); state.simulation.crew.push(...created.crew); }
  return state;
}
export function views(state = fixture()) {
  const context = { nowMs: 0, phase: 'playing' as const };
  return { publicView: rules.publicView(state, context), privateViews: Object.fromEntries(state.captains.filter(captain => captain.playerId).map(captain => [captain.id, rules.playerView(state, captain.playerId!, context)])) };
}
