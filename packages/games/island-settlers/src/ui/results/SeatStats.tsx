import type { Results, SeatStats } from '../../model';
import { cardTotal, listText } from '../shared/format';
import { EmblemChip } from '../shared/SeatChip';
import { SEATS } from '../shared/seats';
import { GainedBar, GoodsLegend, VpSpark } from './charts';
import { leaders, type Row } from './data';
import { seatCss, Who } from './Standings';

type Stats = Results['stats'];
type Parts = { gained: boolean; spark: boolean; named: boolean };

const EMPTY = { gained: {}, robbed: 0, stole: 0, trades: 0, bankTrades: 0 } as Partial<SeatStats>;
const num = (n: number | undefined) => n || '–';

/** Per-player stats in standings order. Unnamed rows line up beside the standings table. */
export function StatsTable({ rows, stats, show }: { rows: Row[]; stats: Stats; show: Parts }) {
  const seat = (r: Row) => stats.seats[r.seat] ?? EMPTY;
  const max = Math.max(1, ...rows.map(r => cardTotal(seat(r).gained ?? {})));
  const top = Math.max(1, ...rows.flatMap(r => stats.vpByRound[r.seat] ?? []));
  return <table className="island-settlers-results-table island-settlers-results-stats"
    data-named={show.named || undefined}>
    <thead>
      <tr>
        <th scope="col" rowSpan={2} className="island-settlers-results-player">Player</th>
        {show.gained && <th scope="col" rowSpan={2}>Resources gained</th>}
        <th scope="colgroup" colSpan={2}>Robber</th>
        <th scope="colgroup" colSpan={2}>Trades</th>
        {show.spark && <th scope="col" rowSpan={2}>VP by round</th>}
      </tr>
      <tr>{['Lost', 'Stole', 'Players', 'Bank'].map(h => <th scope="col" key={h}>{h}</th>)}</tr>
    </thead>
    <tbody>{rows.map(r => {
      const s = seat(r);
      return <tr key={r.seat} data-winner={r.winner || undefined} data-you={r.you || undefined}
        style={seatCss(r)}>
        <th scope="row">{show.named ? <Who row={r}/> : <EmblemChip index={r.index} size="var(--row-chip)"
          label={r.name}/>}</th>
        {show.gained && <td><GainedBar gained={s.gained ?? {}} max={max}/></td>}
        <td className="kp-numeral">{num(s.robbed)}</td><td className="kp-numeral">{num(s.stole)}</td>
        <td className="kp-numeral">{num(s.trades)}</td><td className="kp-numeral">{num(s.bankTrades)}</td>
        {show.spark && <td><VpSpark series={stats.vpByRound[r.seat] ?? []} max={top}
          color={SEATS[r.index % SEATS.length].body}/></td>}
      </tr>;
    })}</tbody>
  </table>;
}

/** Phone variant of the resource bars: name above a full-width bar. */
export function GainedList({ rows, stats }: { rows: Row[]; stats: Stats }) {
  const gained = rows.map(r => stats.seats[r.seat]?.gained ?? {});
  const max = Math.max(1, ...gained.map(cardTotal));
  return <>
    <GoodsLegend gained={gained}/>
    <ul className="island-settlers-results-gained-list">{rows.map((r, i) =>
      <li key={r.seat} style={seatCss(r)}><Who row={r}/><GainedBar gained={gained[i]} max={max}/></li>)}
    </ul>
  </>;
}

/** Record holders: longest road ever reached, most knights (dev-card modes only), cards gained, the thief. */
export function Awards({ rows, stats, dev }: { rows: Row[]; stats: Stats; dev: boolean }) {
  const tiles = [
    { label: 'Longest road reached', ...leaders(stats, rows, s => s.longestRoute) },
    ...(dev ? [{ label: 'Most knights played', ...leaders(stats, rows, s => s.knights) }] : []),
    { label: 'Most cards gained', ...leaders(stats, rows, s => cardTotal(s.gained)) },
    { label: 'Biggest thief', ...leaders(stats, rows, s => s.stole) },
  ];
  return <ul className="island-settlers-results-awards">{tiles.map(t => <li key={t.label}>
    <span>{t.label}</span>
    <b className="kp-numeral">{t.value || '–'}</b>
    <span className="island-settlers-results-holders">
      {t.rows.map(r => <EmblemChip key={r.seat} index={r.index} size="var(--row-chip)"/>)}
      <span>{t.rows.length ? listText(t.rows.map(r => r.name)) : 'Nobody'}</span>
    </span>
  </li>)}</ul>;
}
