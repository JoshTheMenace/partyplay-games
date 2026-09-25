import type { CSSProperties } from 'react';
import type { PublicView, SeatId } from '../../model';
import { EMBLEM_PATHS } from './emblems';
import { SEATS, seatLabel, seatOf } from './seats';

/** Ink emblem in a seat-coloured circle. size is any CSS length ("40px", "calc(56 * var(--u))"). */
export function EmblemChip({ index, size, label }: { index: number; size: string; label?: string }) {
  const style = SEATS[index % SEATS.length];
  const css = { '--chip-size': size, '--chip-fill': style.body } as CSSProperties;
  return <span className="island-settlers-chip" role={label ? 'img' : undefined} aria-label={label}
    aria-hidden={label ? undefined : true} style={css}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={EMBLEM_PATHS[style.emblem]}/></svg>
  </span>;
}

/** A seat's chip, labelled with its name and emblem so colour is never the only cue. */
export function SeatChip({ pub, seat, size }: { pub: PublicView; seat: SeatId; size: string }) {
  return <EmblemChip index={seatOf(pub, seat)?.seat ?? 0} size={size} label={seatLabel(pub, seat)}/>;
}
