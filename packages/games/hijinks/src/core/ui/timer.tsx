/* Server-clock timers: the big TV ring and the compact phone pill. Both turn urgent in the last 5 seconds. */
import { useRef } from 'react';
import { useNow } from './hooks';

type TimerProps = { deadline: number; now(): number; /** Full duration in ms for the ring; defaults to the time left when first shown. */ total?: number; className?: string };
function useClock({ deadline, now, total }: TimerProps) {
  const left = Math.max(0, deadline - useNow(now, 100)), first = useRef({ deadline: NaN, span: 0 });
  if (first.current.deadline !== deadline) first.current = { deadline, span: left };
  const span = total ?? first.current.span;
  return { left, secs: Math.ceil(left / 1000), frac: span > 0 ? Math.min(1, left / span) : 0, urgent: left > 0 && left <= 5000, up: left === 0 };
}

/** Big circular TV timer (default 168 px). */
export function Timer(props: TimerProps & { size?: number }) {
  const { secs, frac, urgent, up } = useClock(props);
  return <div className={`hj-timer ${props.className ?? ''}`} data-urgent={urgent || undefined} data-up={up || undefined} role="timer" aria-label={`${secs} seconds left`} style={{ width: props.size ?? 168, height: props.size ?? 168 }}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="hj-timer-track" cx="50" cy="50" r="43" /><circle className="hj-timer-ring" cx="50" cy="50" r="43" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - frac} transform="rotate(-90 50 50)" /></svg>
    <span className="kp-numeral" key={urgent ? secs : 'calm'} aria-hidden="true">{secs}</span>
  </div>;
}

/** Compact phone timer: seconds plus a draining bar. */
export function PhoneTimer(props: TimerProps) {
  const { secs, frac, urgent, up } = useClock(props);
  return <div className={`hj-ptimer ${props.className ?? ''}`} data-urgent={urgent || undefined} data-up={up || undefined} role="timer" aria-label={up ? 'Time is up' : `${secs} seconds left`}>
    <b className="kp-numeral" aria-hidden="true">{up ? 'Time!' : secs}</b><i aria-hidden="true"><span style={{ transform: `scaleX(${frac})` }} /></i>
  </div>;
}
