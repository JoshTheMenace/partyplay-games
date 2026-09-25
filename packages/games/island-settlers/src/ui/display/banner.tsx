import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PublicView } from '../../model';
import { clockText, secondsLeft } from '../shared/format';
import { regionStyle, type Rect } from '../shared/layout';
import { SeatChip } from '../shared/SeatChip';
import { bannerDeadline, bannerSeats, waiting } from './logic';

const u = (n: number) => `calc(${n} * var(--u))`;
const TITLE_SIZES = [44, 36, 30];

/** Keeps the previous headline for its 140 ms exit while the new one enters (EXPERIENCE §3.3). */
function useSwap(title: string) {
  const [state, setState] = useState({ title, old: null as string | null });
  if (state.title !== title) setState({ title, old: state.title });
  useEffect(() => {
    if (state.old === null) return;
    const timer = setTimeout(() => setState(s => ({ ...s, old: null })), 140);
    return () => clearTimeout(timer);
  }, [state.old]);
  return state;
}

/** Steps through `steps` (title sizes, detail wordings) only while the line would not fit. */
function useFit<T, E extends HTMLElement>(text: string, steps: readonly T[]) {
  const ref = useRef<E>(null), [at, setAt] = useState(0);
  useLayoutEffect(() => setAt(0), [text]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && at < steps.length - 1 && el.scrollWidth > el.clientWidth + 1) setAt(at + 1);
  });
  return { ref, value: steps[at] };
}

/** "Discarding: Constance Wright (4), …" → "Discarding: Constance (4), …" so every seat stays listed. */
export const firstNames = (pub: PublicView, text: string) =>
  pub.seats.reduce((t, s) => t.replaceAll(s.name, s.name.split(' ')[0]), text);

/** "Whose turn is it and what is happening": server title and detail, plus the countdown. */
export function Banner({ pub, rect, now }: { pub: PublicView; rect: Rect; now: number }) {
  const { title, old } = useSwap(pub.now.title), fit = useFit<number, HTMLHeadingElement>(title, TITLE_SIZES);
  const { detail: text } = pub.now;
  const detail = useFit<string, HTMLParagraphElement>(text, [text, firstNames(pub, text)]);
  const deadline = bannerDeadline(pub), left = deadline === null ? null : secondsLeft(deadline, now);
  const owed = waiting(pub).slice(0, 6), chips = bannerSeats(pub);
  return <section className="island-settlers-hud-banner island-settlers-panel" style={regionStyle(rect)}
    aria-label="Turn">
    {chips.length > 0 && <span className="island-settlers-hud-banner-chips">
      {chips.map(id => <SeatChip key={id} pub={pub} seat={id} size={u(56)}/>)}
    </span>}
    <div className="island-settlers-hud-banner-text">
      {old !== null && <p className="island-settlers-hud-banner-old" aria-hidden="true">{old}</p>}
      <h2 key={title} ref={fit.ref} className="island-settlers-hud-title" aria-live="polite"
        style={{ fontSize: u(fit.value) }} data-enter={old !== null || undefined}>{title}</h2>
      <p ref={detail.ref} className="island-settlers-hud-detail">{detail.value}</p>
    </div>
    {owed.length > 0 && <ul className="island-settlers-hud-waiting" aria-label="Waiting on">
      {owed.map(w => <li key={w.seat} title={w.label} aria-label={w.label}>
        <SeatChip pub={pub} seat={w.seat} size={u(36)}/>
        {w.count !== null && <b className="kp-numeral">{w.count}</b>}
      </li>)}
    </ul>}
    {left !== null && <b className="island-settlers-hud-clock kp-numeral" role="timer"
      data-urgent={left <= 10 || undefined} aria-label={`${left} seconds left`}>{clockText(left)}</b>}
  </section>;
}
