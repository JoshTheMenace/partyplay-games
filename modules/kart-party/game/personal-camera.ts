import type { Race } from './types';

export function hasPersonalCamera(race: Race | null, playerId: string | null): boolean {
  return !!playerId && !!race?.personalCameraIds.includes(playerId);
}

export function setPersonalCamera(race: Race, playerId: string, enabled: boolean): void {
  race.personalCameraIds = race.personalCameraIds.filter(id => id !== playerId);
  if (enabled) race.personalCameraIds.push(playerId);
}

export function cameraPlayerIds(race: Race, activePlayerIds: readonly string[], viewRole: 'display' | 'controller', playerId: string | null): string[] {
  if (viewRole === 'controller') return playerId ? [playerId] : [];
  const shared = activePlayerIds.filter(id => !race.personalCameraIds.includes(id));
  if (shared.length) return shared;
  const broadcastRacer = race.racers.find(racer => racer.bot);
  return broadcastRacer ? [broadcastRacer.id] : [];
}
