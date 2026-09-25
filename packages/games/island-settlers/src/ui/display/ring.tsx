import { useRef } from 'react';
import { useFrame } from './hooks';

const R = 33, C = 2 * Math.PI * R;

/**
 * 5u arc at radius 33u around a 56u seat chip (EXPERIENCE §3.2). It drains clockwise from the deadline:
 * cream, sun under 25 % left, coral in the last 10 s. Drawn each frame from the server clock, so it never
 * depends on CSS animation. `start` is when the step began; unknown starts use the first time we saw it.
 */
export function TimerRing({ deadline, start, serverNowMs }: {
  deadline: number; start: number | null; serverNowMs(): number;
}) {
  const arc = useRef<SVGCircleElement>(null), seen = useRef({ deadline, at: serverNowMs() });
  if (seen.current.deadline !== deadline) seen.current = { deadline, at: serverNowMs() };
  useFrame(() => {
    const el = arc.current;
    if (!el) return;
    const begin = start ?? seen.current.at, left = Math.max(0, deadline - serverNowMs());
    const share = Math.min(1, left / Math.max(1000, deadline - begin));
    el.style.strokeDashoffset = String(-C * (1 - share));
    el.dataset.tone = left <= 10_000 ? 'coral' : share < 0.25 ? 'sun' : 'cream';
  });
  return <svg className="island-settlers-hud-ring" viewBox="0 0 76 76" aria-hidden="true">
    <circle className="island-settlers-hud-ring-track" cx="38" cy="38" r={R}/>
    <circle ref={arc} cx="38" cy="38" r={R} strokeDasharray={C} transform="rotate(-90 38 38)"/>
  </svg>;
}
