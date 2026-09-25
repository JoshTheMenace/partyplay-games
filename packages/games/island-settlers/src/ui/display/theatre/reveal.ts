/**
 * Finale reveal timing (EXPERIENCE §3.10), pure: from 0.8 s after results.finaleAt each seat gets a
 * slot in seat order (0.5 s, or 0.3 s above 6 seats). A seat with hidden points flips a card over its
 * VP numeral during its slot; the rail (WP-hud) shows the new total from the slot start.
 */
import type { PublicView, SeatId } from '../../../model';

export const REVEAL = { start: 800, step: 500, stepDense: 300 } as const;
export const revealStep = (seats: number) => (seats > 6 ? REVEAL.stepDense : REVEAL.step);

export type Flip = { seat: SeatId; hidden: number; p: number };

/** Hidden points per seat, from the results breakdown. */
export const hiddenPoints = (pub: PublicView, seat: SeatId) =>
  pub.results?.standings.find(s => s.seat === seat)?.parts
    .filter(p => p.hidden).reduce((sum, p) => sum + p.points, 0) ?? 0;

/** Cards flipping at `now` (p = 0..1 through the slot). None under reduced motion or outside the finale. */
export function flipsAt(pub: PublicView, now: number, reduced: boolean): Flip[] {
  if (!pub.results || pub.turn.stage !== 'finale' || reduced) return [];
  const step = revealStep(pub.seats.length), t = now - pub.results.finaleAt - REVEAL.start;
  return pub.seats.flatMap((s, i) => {
    const p = (t - i * step) / step, hidden = hiddenPoints(pub, s.id);
    return p >= 0 && p < 1 && hidden > 0 ? [{ seat: s.id, hidden, p }] : [];
  });
}

