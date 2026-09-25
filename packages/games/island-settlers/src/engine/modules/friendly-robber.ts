/**
 * Friendly Robber (T&B variant): the robber may not move to a hex touching a building of a seat
 * with 2 public VP or less, nor steal from such a seat. If every hex is protected, it may go to a
 * desert (official). When even that is impossible the core keeps every hex legal, and `robbable`
 * still shields the weak seats from the steal.
 */
import type { SeatId, TileId } from '../../model';
import { boardIndex } from '../board/lookup';
import { face, isLandTile, why } from '../legal';
import { publicVp } from '../stats';
import type { State } from '../state';
import type { Module } from './registry';

export const SAFE_VP = 2;

export const safeSeats = (s: State): SeatId[] => s.order.filter(id => publicVp(s, id) <= SAFE_VP);

function touches(s: State, tile: TileId, safe: ReadonlySet<SeatId>) {
  const owner = (v: string) => s.pieces.buildings[v]?.seat ?? '';
  return (boardIndex(s.board).tileVertices.get(tile) ?? []).some(v => safe.has(owner(v)));
}

export const friendlyRobber: Module = {
  id: 'friendly-robber',
  legal: {
    robberTile(s, _seat, tile) {
      const safe = new Set(safeSeats(s));
      if (!touches(s, tile, safe)) return null;
      const open = (t: TileId) => t !== s.pieces.robber && isLandTile(s, t) && !touches(s, t, safe);
      const desertFallback = face(s, tile).terrain === 'desert' && !s.board.tiles.some(t => open(t.id));
      return desertFallback ? null : why('rule', 'Friendly robber: players with 2 VP or less are safe');
    },
  },
  robbable: (s, _thief, victim) => publicVp(s, victim) > SAFE_VP,
  publicView: s => ({ safe: safeSeats(s) }),
  badges: (s, seat) => (publicVp(s, seat) <= SAFE_VP
    ? [{ key: 'safe', icon: 'shield', value: publicVp(s, seat), label: 'Safe from the robber' }] : []),
};
