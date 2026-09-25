/**
 * The persistent production strip (EXPERIENCE §3.8): roll disc, one chip per producing seat, blocked
 * chips and notes. It fills in 600 ms into a new roll and stays until the next one.
 */
import type { CSSProperties } from 'react';
import type { PublicView, SeatId } from '../../../model';
import { SeatChip } from '../../shared/SeatChip';
import { nameOf, seatLabel } from '../../shared/seats';
import { cardsText, goodText, listText } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { GOOD_META } from '../../shared/labels';
import { ROLL_MS } from '../../shared/timeline';
import { clamp01, EASE } from './motion';
import { lastRollBeat } from './plan';
import { stripModel, type Part, type StripChip } from './payout';
import { useTheatre } from './store';

const Mention = ({ pub, seat }: { pub: PublicView; seat: SeatId }) =>
  <span className="island-settlers-mention"><SeatChip pub={pub} seat={seat} size="calc(24 * var(--u))"/>
    {nameOf(pub, seat)}</span>;

function Chip({ pub, chip }: { pub: PublicView; chip: StripChip }) {
  const name = seatLabel(pub, chip.seat);
  if (chip.kind === 'blocked') {
    const goods = chip.goods.map(g => GOOD_META[g].label.toLowerCase());
    const label = `${name}: ${listText(goods)} blocked`;
    return <li className="island-settlers-strip-chip" data-blocked aria-label={label}>
      <Icon name="robber" className="island-settlers-strip-robber"/>
      <SeatChip pub={pub} seat={chip.seat} size="calc(28 * var(--u))"/>
      <span>{goods.join(', ')}</span>
    </li>;
  }
  const cards: Record<string, number> = {};
  for (const g of chip.cards) cards[g] = (cards[g] ?? 0) + 1;
  const label = `${name}: +${chip.total} (${cardsText(cards)})`;
  return <li className="island-settlers-strip-chip" aria-label={label}>
    <SeatChip pub={pub} seat={chip.seat} size="calc(28 * var(--u))"/>
    <span className="island-settlers-fan">{chip.cards.map((good, i) => <span key={i} title={goodText(1, good)}
      style={{ '--good': GOOD_META[good].color, '--i': i } as CSSProperties}>
      <Icon name={good}/></span>)}</span>
    <b className="kp-numeral">+{chip.total}</b>
  </li>;
}

const Notes = ({ pub, parts }: { pub: PublicView; parts: Part[] }) => <p className="island-settlers-strip-note">
  {parts.filter(p => p !== '').map((p, i) => typeof p === 'string'
    ? <span key={i} data-dot={p === '·' || undefined}>{p}</span> : <Mention key={i} pub={pub} seat={p.seat}/>)}
</p>;

export function ProductionStrip({ pub, reduced }: { pub: PublicView; reduced: boolean }) {
  const { beats, now } = useTheatre(), model = stripModel(pub);
  if (!model) return null;
  const beat = lastRollBeat(beats), fresh = beat?.event.id === model.roll.id && !reduced;
  const t = fresh ? now - beat.start - ROLL_MS.flyStart : Infinity;
  if (t < 0) return null;
  const p = EASE.out(clamp01(t / 220));
  return <section className="island-settlers-strip" aria-label={`Roll ${model.roll.total} payout`}
    style={{ opacity: p, transform: `translateY(calc(${(1 - p) * 12} * var(--u)))` }}>
    <b className="island-settlers-disc kp-numeral" data-tone={model.tone}>{model.roll.total}</b>
    {model.chips.length > 0 &&
      <ul>{model.chips.map(c => <Chip key={`${c.kind}:${c.seat}`} pub={pub} chip={c}/>)}</ul>}
    {model.notes.length > 0 && <Notes pub={pub} parts={model.notes}/>}
  </section>;
}
