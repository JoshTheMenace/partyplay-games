/** Pure data shaping for the results screen: rows, score columns, dice expectations, awards. */
import type { Outcome } from '../../../../../party-contract/src/index';
import type { PublicView, Results, ScorePart, SeatId, SeatStats } from '../../model';
import { titleCase } from '../shared/labels';

export type Row = {
  seat: SeatId; name: string; index: number; rank: number; vp: number;
  /** null when only the platform Outcome is known (no breakdown to show). */
  parts: ScorePart[] | null; winner: boolean; you: boolean;
};

export type Column = { key: string; label: string; icon: string; match: (part: ScorePart) => boolean };

/** Standings from results when present, else from the bare Outcome (shell fallback). */
export function buildRows(pub: PublicView, outcome: Outcome, you: string | null): Row[] {
  const winners = pub.results?.winners ?? outcome.winners;
  const base: Omit<Row, 'name' | 'index' | 'winner' | 'you'>[] = pub.results?.standings
    ?? outcome.rows.map((r, i) => ({
      seat: r.playerId, rank: r.rank ?? i + 1, vp: r.score ?? 0, parts: null,
    }));
  return base.map(s => {
    const seat = pub.seats.find(x => x.id === s.seat);
    const name = seat?.name ?? 'Player';
    return { ...s, name, index: seat?.seat ?? 0, winner: winners.includes(s.seat), you: s.seat === you };
  }).sort((a, b) => a.rank - b.rank || a.index - b.index);
}

const CORE: Column[] = [
  { key: 'settlements', label: 'Settlements', icon: 'settlement', match: p => p.key === 'settlements' },
  { key: 'cities', label: 'Cities', icon: 'city', match: p => p.key === 'cities' },
  { key: 'longest-road', label: 'Longest Road', icon: 'road', match: p => p.key === 'longest-road' },
  { key: 'largest-army', label: 'Largest Army', icon: 'knight', match: p => p.key === 'largest-army' },
  { key: 'vp-cards', label: 'VP cards', icon: 'vp', match: p => !!p.hidden },
];

/** Core columns (settlements and cities always, others when anyone scored them), then one per module key. */
export function buildColumns(rows: Row[]): Column[] {
  const parts = rows.flatMap(r => r.parts ?? []);
  const core = CORE.filter((c, i) => i < 2 || parts.some(c.match));
  const extra = [...new Set(parts.filter(p => !CORE.some(c => c.match(p))).map(p => p.key))].map(key => {
    const labels = new Set(parts.filter(p => p.key === key).map(p => p.label));
    const label = labels.size === 1 ? [...labels][0] : titleCase(key);
    return { key, label, icon: key.replace(/s$/, ''), match: (p: ScorePart) => p.key === key && !p.hidden };
  });
  return [...core, ...extra];
}

export const points = (parts: ScorePart[], column: Column) =>
  parts.filter(column.match).reduce((sum, p) => sum + p.points, 0);

/** Share of 2d6 rolls landing on each total. */
export const diceOdds = (total: number) => (total < 2 || total > 12 ? 0 : (6 - Math.abs(7 - total)) / 36);

/** Bars for totals 2–12 with the expected count for the same number of rolls. */
export function diceBars(dice: number[]) {
  const rolls = dice.reduce((sum, n) => sum + (n ?? 0), 0);
  return Array.from({ length: 11 }, (_, i) =>
    ({ total: i + 2, count: dice[i + 2] ?? 0, expected: rolls * diceOdds(i + 2) }));
}

/** The seats sharing the highest value of one stat, or none when nobody scored. */
export function leaders(stats: Results['stats'], rows: Row[], pick: (s: SeatStats) => number) {
  const values = rows.map(r => ({ row: r, value: stats.seats[r.seat] ? pick(stats.seats[r.seat]) : 0 }));
  const best = Math.max(0, ...values.map(v => v.value));
  return { value: best, rows: best > 0 ? values.filter(v => v.value === best).map(v => v.row) : [] };
}

/** "41 min", "1 h 12 min". */
export function durationText(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** "#1", "=2" for a shared rank. */
export const rankText = (row: Row, rows: Row[]) =>
  `${rows.filter(r => r.rank === row.rank).length > 1 ? '=' : '#'}${row.rank}`;
