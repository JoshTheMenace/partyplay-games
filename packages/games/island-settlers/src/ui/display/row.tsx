import type { CSSProperties } from 'react';
import type { PublicSeat, PublicView } from '../../model';
import { CPU_NAMES, hasDevCards } from '../shared/labels';
import { SEATS } from '../shared/seats';
import { RowChip } from './chip';
import { dense as isDense, statusBadge, statusText } from './logic';
import { extrasFor, Stat, useRoom } from './stats';

const u = (n: number) => `calc(${n} * var(--u))`;
const LEFT = [['roads', 'road'], ['settlements', 'settlement'], ['cities', 'city']] as const;
const SHIPS = [...LEFT, ['ships', 'ship']] as const;

type RowProps = {
  pub: PublicView; seat: PublicSeat; height: number; now: number; serverNowMs(): number;
  /** Shown VP (the finale counts hidden points in) and the final rank once re-sorted. */
  vp: number; rank: number | null;
};

/**
 * One seat on the rail (EXPERIENCE §3.2): chip, the name across the full width (never truncated), stats and
 * status below it, and the big VP beside them. Dense rows (7+ seats) have two lines.
 */
export function SeatRow({ pub, seat, height, now, serverNowMs, vp, rank }: RowProps) {
  const dense = isDense(pub.seats.length), { turn } = pub;
  const over = turn.stage === 'finale' || turn.stage === 'ended';
  const active = !over && turn.stage !== 'round' && turn.active === seat.id;
  const paired = !over && turn.partner === seat.id, next = !over && !active && turn.next === seat.id;
  const winner = !!pub.results?.winners.includes(seat.id), badge = over ? null : statusBadge(pub, seat);
  const status = over ? '' : statusText(pub, seat, now), level = CPU_NAMES[pub.settings.cpuLevel];
  const extras = extrasFor(pub, seat), { row, line, room } = useRoom(extras);
  const more = extras.slice(room).map(e => e.label).join(', '), army = pub.awards['largest-army'] === seat.id;
  const knights = `${seat.knights} knights`;
  // Dense rows keep the word only (every CPU shares the table's level); the title still names it.
  const cpu = seat.cpu && <small className="island-settlers-hud-cpu" title={`CPU, ${level}`}>
    CPU{dense ? '' : ` ${level[0]}`}</small>;
  return <article ref={row} className="island-settlers-hud-row" data-flip={seat.id}
    data-dense={dense || undefined} data-active={active || undefined} data-paired={paired || undefined}
    data-winner={winner || undefined} data-offline={badge?.kind === 'offline' || undefined}
    style={{ height: u(height), '--seat': SEATS[seat.seat % SEATS.length].body } as CSSProperties}>
    <RowChip {...{ pub, seat, serverNowMs, badge, status, next, winner, rank }} timed={!over}/>
    <p className="island-settlers-hud-name">{seat.name}{dense && cpu}</p>
    <div className="island-settlers-hud-row-body">
      <p ref={line} className="island-settlers-hud-stats">
        {!dense && cpu}
        {dense && paired && <span className="island-settlers-hud-pill" data-paired>Build turn</span>}
        <Stat icon="cards" value={seat.cards} label={`${seat.cards} resource cards`}
          tone={seat.cards > seat.discardLimit ? 'alert' : undefined}/>
        {hasDevCards(pub) && <Stat icon="development" value={seat.dev} label={`${seat.dev} dev cards`}/>}
        {army ? <Stat icon="guard" value={seat.knights} tone="army" label={`Largest Army, ${knights}`}/>
          : seat.knights > 0 && <Stat icon="knight" value={seat.knights} label={`${knights} played`}/>}
        {extras.slice(0, room).map(e => <span key={e.key}>{e.node}</span>)}
        {more && <span className="island-settlers-hud-pill" title={more} aria-label={more}>
          +{extras.length - room}</span>}
        <span className="island-settlers-hud-gains-slot" data-seat-gains={seat.id}/>
      </p>
      {!dense && <p className="island-settlers-hud-line3" data-status={status ? true : undefined}>
        {status || <><small>Left</small>{(pub.settings.map === 'base' ? LEFT : SHIPS).map(([k, icon]) =>
          <Stat key={k} icon={icon} value={seat.left[k]} label={`${seat.left[k]} ${k} left`}/>)}</>}</p>}
    </div>
    <b className="island-settlers-hud-vp kp-numeral" data-seat-vp={seat.id} data-up={vp > seat.vp || undefined}
      aria-label={`${vp} victory points`}>{vp}</b>
  </article>;
}
