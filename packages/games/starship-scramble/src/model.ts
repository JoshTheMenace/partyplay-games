export * from './contracts';
import type { Captain, State } from './contracts';
export const livingCrew = (state: State, captainId: string) => state.simulation.crew.filter(crew => crew.ownerCaptainId === captainId && crew.status === 'alive');
export const activeCaptain = (state: State, captain: Captain) => livingCrew(state, captain.id).length > 0;
export const eligibleCaptains = (state: State) => state.captains.filter(captain => captain.connected && captain.playerId && activeCaptain(state, captain));
export function captainFor(state: State, playerId: string) {
  const captain = state.captains.find(item => item.playerId === playerId);
  if (!captain) throw new Error('Choose your saved captain first.');
  return captain;
}
export function changePhase(state: State, phase: State['phase']) {
  state.phase = phase; state.epoch++; state.queue = []; state.controlledCrew = {};
  for (const crew of state.simulation.crew) { crew.controlEpoch++; if (crew.activity === 'direct') crew.activity = 'idle'; }
  for (const captain of state.captains) { captain.ready = false; captain.vote = null; captain.contribution = null; if (phase === 'route' || phase === 'combat') captain.abandonedCrew = false; }
  state.revision++;
}
