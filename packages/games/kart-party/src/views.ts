import type { Race } from './engine/types';

export type ViewMode = 'auto' | 'tv' | 'personal';
export const resolveViewMode = (mode: ViewMode = 'auto', players: number) => mode === 'auto' ? players > 4 ? 'personal' : 'tv' : mode;
export function screenMode(mode: ViewMode, players: number, playerId: string | null, isHost = false) {
  if (resolveViewMode(mode, players) === 'personal') return playerId ? 'personal' : 'spectator';
  return isHost || !playerId ? 'split' : 'controls';
}

/** Hold a shot for six seconds; leave a finished/disconnected racer immediately. */
export function createRaceDirector() {
  let id = '', since = -Infinity;
  return (race: Race) => {
    const active = race.racers.filter(racer => racer.finishTime === null && (racer.bot || racer.connected));
    const leader = [...(active.length ? active : race.racers)].sort((a, b) => a.rank - b.rank)[0];
    if (leader && (race.time < since || !active.some(racer => racer.id === id) || race.time - since >= 6)) {
      id = leader.id; since = race.time;
    }
    return id;
  };
}
