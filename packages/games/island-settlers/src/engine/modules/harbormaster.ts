/**
 * Harbormaster / Strongest Ports (T&B variant): harbour points are the VP of the seat's buildings on
 * port vertices (settlement 1, city 2, C&K metropolis 4; Barbarian Attack: conquered buildings 0).
 * The first seat to 3 takes the award (+2 VP); only a strictly higher total takes it away. A holder
 * who drops below 3 (a pillaged city) loses it to the leader, if unique.
 */
import type { SeatId } from '../../model';
import { boardIndex } from '../board/lookup';
import { emit } from '../events';
import { seatName, type State } from '../state';
import { conqueredAt } from './barbarian-attack/coast';
import type { Module } from './registry';

export const HARBOR_MIN = 3;

export function harborPoints(s: State, seat: SeatId): number {
  const { portAt } = boardIndex(s.board), ba = s.modules.includes('barbarian-attack');
  const counts = (v: string) => portAt.has(v) && !(ba && conqueredAt(s, v));
  return Object.values(s.pieces.buildings).filter(b => b.seat === seat && counts(b.vertex))
    .reduce((n, b) => n + (b.metropolis ? 4 : b.kind === 'city' ? 2 : 1), 0);
}

function holder(s: State): SeatId | null {
  const now = s.awards.harbormaster ?? null, points = new Map(s.order.map(id => [id, harborPoints(s, id)]));
  const best = Math.max(...points.values()), top = s.order.filter(id => points.get(id) === best);
  if (now && points.get(now)! >= HARBOR_MIN && points.get(now) === best) return now;
  return best >= HARBOR_MIN && top.length === 1 ? top[0] : null;
}

export const harbormaster: Module = {
  id: 'harbormaster',
  awards(s) {
    const from = s.awards.harbormaster ?? null, next = holder(s);
    if ('harbormaster' in s.awards && next === from) return;
    s.awards.harbormaster = next;
    if (next === from) return;
    const text = next ? `${seatName(s, next)} takes Harbormaster` : 'Harbormaster is unclaimed';
    emit(s, { kind: 'award', award: 'harbormaster', seat: next, from, text });
  },
  score: (s, seat) => (s.awards.harbormaster === seat
    ? [{ key: 'harbormaster', label: 'Harbormaster', points: 2, count: 1 }] : []),
  publicView: s => ({ points: Object.fromEntries(s.order.map(id => [id, harborPoints(s, id)])) }),
  hud: s => [{
    kind: 'holder', key: 'harbormaster', label: 'Harbormaster', seat: s.awards.harbormaster ?? null, icon: 'harbor',
  }],
  badges: (s, seat) => {
    const n = harborPoints(s, seat);
    return n ? [{ key: 'harbor', icon: 'harbor', value: n, label: 'Harbour points' }] : [];
  },
};
