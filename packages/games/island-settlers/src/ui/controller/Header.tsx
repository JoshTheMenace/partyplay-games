/** Sticky status header (EXPERIENCE §4.1 row 1) plus the lines right under it: readiness, reconnect, auto. */
import { EmblemChip } from '../shared/SeatChip';
import { clockText } from '../shared/format';
import { Icon } from '../shared/icons';
import { seatLabel, seatOf } from '../shared/seats';
import { useCtl } from './context';
import { TimerRing, useSeconds } from './Timer';

function Score() {
  const { me } = useCtl();
  const hidden = me.parts.filter(p => p.hidden).reduce((sum, p) => sum + p.points, 0);
  return <div className="island-settlers-vp" aria-label={`${me.vp} of ${me.target} points, ${hidden} hidden`}>
    <b className="kp-numeral">{me.vp}<small>/{me.target}</small></b>
    <span>{hidden ? `VP, ${hidden} hidden` : 'VP'}</span>
  </div>;
}

export function Header() {
  const { pub, me } = useCtl();
  const moves = Object.values(me.ext.explorers?.movesLeft ?? {});
  const now = pub.now.title === me.task.title ? '' : pub.now.title;
  const sub = [me.task.text || now, moves.length ? `Moves left: ${Math.max(...moves)}` : '']
    .filter(Boolean).join(' · ');
  return <header className="island-settlers-head">
    <EmblemChip index={seatOf(pub, me.seat)?.seat ?? 0} size="var(--is-chip)" label={seatLabel(pub, me.seat)}/>
    <div className="island-settlers-head-text" aria-live="polite">
      <h2>{me.task.title}</h2>
      <p>{sub || 'Watch the table'}</p>
    </div>
    {me.task.deadline ? <TimerRing deadline={me.task.deadline}/> : <Score/>}
  </header>;
}

/** Connect: who has pressed done this round. */
export function Readiness() {
  const { pub } = useCtl();
  if (pub.turn.stage !== 'round') return null;
  const done = pub.seats.filter(s => s.ready).length;
  return <div className="island-settlers-ready" aria-label={`${done} of ${pub.seats.length} done`}>
    {pub.seats.map(s => <span key={s.id} data-done={s.ready || undefined}>
      <EmblemChip index={s.seat} size="28px" label={`${s.name}${s.ready ? ', done' : ''}`}/>
      {s.ready && <Icon name="check" size={14}/>}
    </span>)}
  </div>;
}

/** "Reconnecting… your move auto-plays in 0:40" while this phone is offline and owes a move. */
export function Reconnect() {
  const { props, me } = useCtl();
  const seconds = useSeconds(props.connected === false ? me.task.deadline : null);
  if (props.connected !== false) return null;
  return <p className="island-settlers-reconnect" role="status">
    Reconnecting…{seconds !== null && ` your move auto-plays in ${clockText(seconds)}`}
  </p>;
}

/** What happens at zero: "Auto-discards biggest piles in 18 s". */
export function AutoLine() {
  const { me } = useCtl();
  const seconds = useSeconds(me.task.auto ? me.task.deadline : null);
  if (seconds === null || !me.task.auto) return null;
  return <p className="island-settlers-auto"><Icon name="timer" size={18}/>
    {me.task.auto} in {seconds > 60 ? clockText(seconds) : `${seconds} s`}</p>;
}
