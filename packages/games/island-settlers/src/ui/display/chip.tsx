import type { PublicSeat, PublicView } from '../../model';
import { Icon } from '../shared/icons';
import { SeatChip } from '../shared/SeatChip';
import type { StatusBadge } from './logic';
import { TimerRing } from './ring';

const u = (n: number) => `calc(${n} * var(--u))`;
const CROWN = 'M3 19h18l-1.6-11-4.9 4.2L12 5 9.5 12.2 4.6 8Z';

type Props = {
  pub: PublicView; seat: PublicSeat; serverNowMs(): number; badge: StatusBadge | null; status: string;
  timed: boolean; next: boolean; winner: boolean; rank: number | null;
};

/**
 * The 56u seat chip with everything pinned to it (EXPERIENCE §3.2, §3.10): timer ring, status badge, "next
 * up" chevron, finale crown and rank. `data-seat-chip` is the theatre's fly-out target.
 */
export function RowChip({ pub, seat, serverNowMs, badge, status, timed, next, winner, rank }: Props) {
  const start = pub.clock?.deadline === seat.deadline ? pub.clock.startedAt : null;
  return <span className="island-settlers-hud-chipbox" data-seat-chip={seat.id}>
    <SeatChip pub={pub} seat={seat.id} size={u(56)}/>
    {timed && seat.deadline !== null
      && <TimerRing deadline={seat.deadline} start={start} serverNowMs={serverNowMs}/>}
    {badge && <span className="island-settlers-hud-badge" data-kind={badge.kind}
      aria-label={status || badge.kind}>
      {badge.kind === 'offline' ? <Icon name="offline"/> : badge.kind === 'ready' ? <Icon name="check"/>
        : badge.kind === 'thinking' ? <><i/><i/><i/></> : badge.count ?? '!'}
    </span>}
    {next && <svg className="island-settlers-hud-next" viewBox="0 0 16 16" role="img" aria-label="Next up">
      <path d="M5 2l7 6-7 6"/></svg>}
    {winner && <svg className="island-settlers-hud-crown" viewBox="0 0 24 24" role="img" aria-label="Winner">
      <path d={CROWN}/></svg>}
    {rank !== null && <b className="island-settlers-hud-rank kp-numeral">#{rank}</b>}
  </span>;
}
