/**
 * "+2 grain" chips on the seat rail (EXPERIENCE §3.2 line 2, §3.7 arrival): they pop in at the right of
 * the row's line 2 when its cards land (at once under reduced motion), hold 1.6 s and fade. Drawn as an
 * overlay inside the row's reserved `[data-seat-gains]` slot, so the rail never shifts and no stat is covered.
 */
import type { CSSProperties } from 'react';
import type { Good, PublicView, SeatId } from '../../../model';
import { goodText } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { GOOD_META } from '../../shared/labels';
import type { Layer } from './Flights';
import { clamp01 } from './motion';
import { GAIN, type Beat } from './plan';

/** Room one "+2" chip takes in its slot, gap included (words need about twice that). */
const CHIP_U = 64;

export type Gain = { key: string; good: Good; amount: number; opacity: number; scale: number };

/** Chips visible for `seat` at `now`. */
export function gainsAt(beats: Beat[], seat: SeatId, now: number, reduced: boolean): Gain[] {
  const fadeIn = reduced ? 1 : GAIN.in;
  return beats.flatMap(b => b.flights.filter(f => f.seat === seat && !f.faceDown).flatMap(f => {
    const t = now - (reduced ? b.start : b.start + f.delay + f.ms);
    if (t < 0 || t >= fadeIn + GAIN.hold + GAIN.out) return [];
    const inP = clamp01(t / fadeIn), outP = clamp01((t - fadeIn - GAIN.hold) / GAIN.out);
    return f.goods.map(g => ({
      key: `${b.event.id}:${g.good}`, good: g.good, amount: g.amount,
      opacity: inP * (1 - outP), scale: reduced ? 1 : 0.7 + 0.3 * inP,
    }));
  }));
}

export function GainChips({ pub, beats, now, at, reduced }: Layer & { pub: PublicView }) {
  return <>{pub.seats.map(({ id }) => {
    const all = gainsAt(beats, id, now, reduced), box = all.length ? at.line(id) : null;
    // Only the chips that fit the row's slot (the seat chip's badge and the strip still count them all).
    const width = box ? box.right - box.left : 0, gains = all.slice(0, Math.floor(width / (CHIP_U * at.u)));
    if (!box || !gains.length) return null;
    const words = gains.length === 1 && width >= 2 * CHIP_U * at.u;
    return <span key={id} className="island-settlers-gains" data-words={words || undefined}
      style={{ width, transform: `translate(${box.left}px, ${box.y}px) translateY(-50%)` }}>
      {gains.map(g => <span key={g.key} className="island-settlers-gain"
        aria-label={`+${goodText(g.amount, g.good)}`}
        style={{ '--good': GOOD_META[g.good].color, opacity: g.opacity, scale: g.scale } as CSSProperties}>
        <b className="kp-numeral">+{g.amount}</b><Icon name={g.good} size="1.1em"/>
        <span className="island-settlers-gain-word">{GOOD_META[g.good].label.toLowerCase()}</span>
      </span>)}
    </span>;
  })}</>;
}
