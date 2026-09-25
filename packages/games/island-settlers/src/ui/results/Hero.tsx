import type { PublicView } from '../../model';
import { plural } from '../shared/format';
import { describeSettings } from '../shared/labels';
import { EmblemChip } from '../shared/SeatChip';
import { durationText, type Row } from './data';
import { seatCss } from './Standings';

/** Winner chips and names side by side, then "10 VP · 41 min · 12 rounds". */
export function Hero({ pub, rows }: { pub: PublicView; rows: Row[] }) {
  const winners = rows.filter(r => r.winner), res = pub.results;
  const facts = [
    winners[0] && `${winners[0].vp} VP${winners.length > 1 ? ' each' : ''}`,
    res && durationText(res.durationMs), res && plural(res.rounds, 'round'),
  ].filter(Boolean).join(' · ');
  const reason = res?.reason === 'round-limit' ? 'Round limit reached'
    : winners.length > 1 ? 'Shared victory' : winners.length ? 'Winner' : 'Final scores';
  return <header className="island-settlers-results-hero">
    <p className="kp-eyebrow">{reason} · {describeSettings(pub.settings)}</p>
    <div className="island-settlers-results-winners" data-count={winners.length}>
      {winners.length ? winners.map(w => <div key={w.seat} style={seatCss(w)}>
        <EmblemChip index={w.index} size="var(--hero-chip)"/>
        <h1 className="kp-title">{w.name}</h1>
      </div>) : <h1 className="kp-title">Game over</h1>}
    </div>
    <p className="island-settlers-results-facts kp-numeral">{facts}</p>
  </header>;
}
