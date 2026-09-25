import type { CSSProperties } from 'react';
import { plural } from '../shared/format';
import { Icon } from '../shared/icons';
import { EmblemChip } from '../shared/SeatChip';
import { SEATS } from '../shared/seats';
import { points, rankText, type Column, type Row } from './data';

/** Soft hyphens so long one-word headers ("Settlements", "Harbormaster") can wrap in narrow columns. */
const soft = (label: string) => label.replace(/\p{L}{10,}/gu, w => {
  const half = Math.ceil(w.length / 2);
  return `${w.slice(0, half)}\u00ad${w.slice(half)}`;
});

export const seatCss = (row: Row) => ({ '--seat': SEATS[row.index % SEATS.length].body }) as CSSProperties;

/** Chip, name and "· you". */
export function Who({ row }: { row: Row }) {
  return <span className="island-settlers-results-who">
    <EmblemChip index={row.index} size="var(--row-chip)"/>
    <span>{row.name}{row.you && <small> · you</small>}</span>
  </span>;
}

/** Rank, player, one column per score source, total. Compact keeps rank, player and total only. */
export function Standings({ rows, columns, compact }: { rows: Row[]; columns: Column[]; compact: boolean }) {
  const cols = compact || rows.some(r => !r.parts) ? [] : columns;
  return <table className="island-settlers-results-table island-settlers-results-standings"
    data-compact={!cols.length || undefined}>
    <thead><tr>
      <th scope="col" className="island-settlers-results-rank">Rank</th>
      <th scope="col" className="island-settlers-results-player">Player</th>
      {cols.map(c => <th scope="col" key={c.key} title={c.label}>
        <Icon name={c.icon} size={18}/><span>{soft(c.label)}</span>
      </th>)}
      <th scope="col" className="island-settlers-results-total">Total</th>
    </tr></thead>
    <tbody>{rows.map(r => <tr key={r.seat} data-winner={r.winner || undefined} data-you={r.you || undefined}
      style={seatCss(r)}>
      <td className="island-settlers-results-rank kp-numeral">{rankText(r, rows)}</td>
      <th scope="row"><Who row={r}/></th>
      {cols.map(c => {
        const pts = points(r.parts ?? [], c), n = (r.parts ?? []).filter(c.match).reduce((a, p) => a + p.count, 0);
        return <td key={c.key} className="kp-numeral" aria-label={`${c.label}: ${plural(pts, 'point')}`}>
          {n > 0 && n !== pts && <small className="island-settlers-results-count">{n}×</small>}{pts || '–'}
        </td>;
      })}
      <td className="island-settlers-results-total kp-numeral">{r.vp}</td>
    </tr>)}</tbody>
  </table>;
}

/** Phone card: your rank and the full breakdown, hidden points included, summing to your total. */
export function YouCard({ row, of }: { row: Row; of: number }) {
  return <section className="island-settlers-results-you" style={seatCss(row)} aria-label="Your result">
    <p className="kp-eyebrow">Your result</p>
    <p><b className="kp-numeral">#{row.rank}</b> of {of} · <b className="kp-numeral">{row.vp} VP</b></p>
    {row.parts && <ul>
      {row.parts.map(p => <li key={`${p.key}${p.hidden ? '-hidden' : ''}`}>
        <span>{p.label}{p.count > 1 && ` ×${p.count}`}{p.hidden && <small> · revealed</small>}</span>
        <b className="kp-numeral">{p.points}</b>
      </li>)}
      <li className="island-settlers-results-sum">
        <span>Total</span><b className="kp-numeral">{row.vp}</b>
      </li>
    </ul>}
  </section>;
}
