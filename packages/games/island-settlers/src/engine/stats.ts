/** Stat accumulation (ENGINE §12), results built at the finale, and the platform outcome. */
import type { Outcome } from '../../../../party-contract/src/index';
import {
  GOODS, type Cards, type EndReason, type Results, type ScorePart, type SeatId, type SeatStats, type Standing,
  type Stats,
} from '../model';
import { total } from './cards';
import { scoreParts } from './score';
import type { State } from './state';

type Counter = { [K in keyof SeatStats]: SeatStats[K] extends number ? K : never }[keyof SeatStats];

export const seatStats = (): SeatStats => ({
  gained: {}, produced: 0, blocked: 0, robbed: 0, stole: 0, discarded: 0, trades: 0, bankTrades: 0,
  devBought: 0, knights: 0, longestRoute: 0, largestHand: 0, timeouts: 0, opportunities: 0,
});

export const emptyStats = (ids: SeatId[]): Stats => ({
  dice: Array(13).fill(0),
  seats: Object.fromEntries(ids.map(id => [id, seatStats()])),
  vpByRound: Object.fromEntries(ids.map(id => [id, []])),
});

export const bump = (s: State, seat: SeatId, key: Counter, n = 1) => { s.stats.seats[seat][key] += n; };

/** Cards received from the bank; `produced` for roll income. */
export function gained(s: State, seat: SeatId, cards: Cards, produced = false) {
  const st = s.stats.seats[seat];
  for (const g of GOODS) if (cards[g]) st.gained[g] = (st.gained[g] ?? 0) + cards[g]!;
  if (produced) st.produced += total(cards);
}

/** Running maxima, refreshed after every commit. */
export function track(s: State) {
  for (const id of s.order) {
    const st = s.stats.seats[id], seat = s.seats[id];
    st.largestHand = Math.max(st.largestHand, total(seat.hand));
    st.longestRoute = Math.max(st.longestRoute, seat.longestRoute);
  }
}

export const vpOf = (parts: ScorePart[], hidden: boolean) =>
  parts.reduce((n, p) => n + (hidden || !p.hidden ? p.points : 0), 0);

export const publicVp = (s: State, seat: SeatId) => vpOf(scoreParts(s, seat), false);

export function recordRound(s: State) {
  for (const id of s.order) s.stats.vpByRound[id].push(publicVp(s, id));
}

/** Everyone by total VP (hidden included); equal totals share a rank. */
export function standings(s: State): Standing[] {
  const rows = s.order.map(seat => {
    const parts = scoreParts(s, seat);
    return { seat, rank: 0, vp: vpOf(parts, true), parts };
  });
  for (const row of rows) row.rank = 1 + rows.filter(o => o.vp > row.vp).length;
  return rows.sort((a, b) => a.rank - b.rank || s.order.indexOf(a.seat) - s.order.indexOf(b.seat));
}

export const leaders = (s: State): SeatId[] => standings(s).filter(r => r.rank === 1).map(r => r.seat);

export function buildResults(s: State, winners: SeatId[], reason: EndReason, finaleMs: number): Results {
  return {
    winners, reason, finaleAt: s.now, completeAt: s.now + finaleMs,
    rounds: s.turn.round, opportunities: s.turn.opportunities, durationMs: s.now - s.startedAt,
    standings: standings(s), stats: structuredClone(s.stats),
  };
}

export function outcome(s: State): Outcome {
  const rows = standings(s);
  return {
    complete: s.turn.stage === 'ended',
    winners: s.results?.winners ?? [],
    rows: rows.map(r => {
      const cpu = s.seats[r.seat].cpu;
      const top = [...r.parts].filter(p => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 2);
      const label = cpu ? `CPU · ${cpu.label}` : top.map(p => p.label).join(' · ') || `${r.vp} VP`;
      return { playerId: r.seat, score: r.vp, rank: r.rank, label };
    }),
  };
}
