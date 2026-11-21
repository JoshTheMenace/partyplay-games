/** Test helpers: what a player's screen is sent, decoded back into entity objects. */
import { decodeScene, nearEvery, type Scene, type Screen } from '../src/shared/protocol';
import type { State } from '../src/sim/state';
import { playerView, publicView } from '../src/sim/views';

/** The scene around a player (the first one by default), as its client decodes it. */
export function sceneOf(state: State, playerId = state.players[0]!.id): Scene {
  const who = publicView(state).who, player = state.players.find(candidate => candidate.id === playerId)!;
  // Big rooms send a seat its scene in every second snapshot: read the one that carries it.
  const ticks = state.ticks;
  while ((state.ticks + player.seat) % nearEvery(state.players.length)) state.ticks++;
  const near = playerView(state, playerId).near!;
  state.ticks = ticks;
  return decodeScene(near, who);
}
/** The open screen in a player's bag (the bag is sent because no input has confirmed it). */
export const screenOf = (state: State, playerId: string): Screen | null => playerView(state, playerId).bag!.screen;
