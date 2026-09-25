/** Server-clock countdowns: a ticking seconds hook and the 44px header ring (EXPERIENCE §4.4). */
import { useEffect, useRef, useState } from 'react';
import { clockText, secondsLeft } from '../shared/format';
import { useCtl } from './context';

/** Whole seconds until `deadline` by the server clock, re-rendering as they change; null without one. */
export function useSeconds(deadline: number | null) {
  const { now } = useCtl();
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : secondsLeft(deadline, now());
}

const R = 19, C = 2 * Math.PI * R;

/** Drains from the first moment this deadline was seen (or the public clock start) to zero. */
export function TimerRing({ deadline }: { deadline: number }) {
  const { pub, now, sfx } = useCtl();
  const arc = useRef<SVGCircleElement>(null), first = useRef(new Map<number, number>());
  const start = pub.clock?.deadline === deadline ? pub.clock.startedAt
    : first.current.get(deadline) ?? first.current.set(deadline, now()).get(deadline)!;
  const seconds = useSeconds(deadline) ?? 0;
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const left = Math.max(0, Math.min(1, (deadline - now()) / Math.max(1, deadline - start)));
      arc.current?.setAttribute('stroke-dashoffset', String(C * (1 - left)));
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [deadline, start, now]);
  useEffect(() => {
    sfx.warn(seconds, deadline);
    if (seconds === 10) sfx.haptic('warning');
  }, [seconds, deadline, sfx]);
  return <div className="island-settlers-timer" data-urgent={seconds <= 10 || undefined}
    role="timer" aria-label={`${seconds} seconds left`}>
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r={R} className="island-settlers-timer-track"/>
      <circle ref={arc} cx="22" cy="22" r={R} className="island-settlers-timer-arc"
        strokeDasharray={C} transform="rotate(-90 22 22)"/>
    </svg>
    <b className="kp-numeral">{seconds <= 30 ? seconds : clockText(seconds)}</b>
  </div>;
}
