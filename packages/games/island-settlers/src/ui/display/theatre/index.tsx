/**
 * WP-theatre: the TV's presentation layer over the HUD (EXPERIENCE §3.6–3.8, §3.10, §6).
 *
 * Mount contract (WP-hud's HudFrame, reused by WP-personal): `<Theatre publicView serverNowMs host/>`
 * inside the stage box, after the rails. It fills the stage, ignores the pointer, draws the dice chip
 * and the production strip in their `layout.regions`, and flies cards on top of everything.
 * It reads these rail hooks: `[data-seat-chip=<seat id>]` (fly-out target, bump), `[data-seat-vp=<id>]`
 * (finale flip card over it), `[data-seat-gains=<id>]` on line 2 ("+n" chips right-aligned in it;
 * falls back to the row's stats line) and optionally `[data-bank="table"]` (gold/plenty flights start there).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PublicView, SeatId } from '../../../model';
import { bridge } from '../../shared/bridge';
import { regions, regionStyle, unit } from '../../shared/layout';
import { freshEvents, useReducedMotion } from '../../shared/timeline';
import { DiceChip } from './Dice';
import { FlipCards } from './Finale';
import { Flights, type Locate } from './Flights';
import { GainChips } from './Gains';
import { ProductionStrip } from './Strip';
import { theatre, useTheatre } from './store';
import './theatre.css';

export { theatre, useTheatre } from './store';

export type TheatreProps = { publicView: PublicView; serverNowMs(): number; host: boolean };

/** Sees each event once: plays the unseen ones from the last 3 s, never older history. */
function useEventFeed(pub: PublicView, serverNowMs: () => number) {
  const seen = useRef(0);
  useEffect(() => () => { theatre.reset(); seen.current = 0; }, []);
  useEffect(() => {
    const top = Math.max(0, ...pub.events.map(e => e.id));
    if (top < seen.current) seen.current = 0; // a new game restarts ids
    const now = serverNowMs(), fresh = freshEvents(pub.events, seen.current, now);
    seen.current = Math.max(seen.current, top);
    if (fresh.length) theatre.enqueue(fresh, pub, now);
  }, [pub, serverNowMs]);
}

/** Frame clock: ticks the store while a beat or the finale is playing, then sleeps. */
function useClock(pub: PublicView, serverNowMs: () => number) {
  const { beats } = useTheatre(), end = pub.results && pub.turn.stage === 'finale' ? pub.results.completeAt : 0;
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const now = serverNowMs();
      theatre.tick(now);
      const busy = now < end || theatre.snapshot().beats.some(b => now < b.start + b.life);
      frame = busy ? requestAnimationFrame(step) : 0;
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [beats, end, serverNowMs]);
}

function useStageSize(root: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 1560, height: 980 });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setSize(s => (s.width === el.clientWidth && s.height === el.clientHeight ? s
      : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);
  return size;
}

/** `el`'s box in the root's px space. */
function box(root: HTMLElement | null, el: Element | null) {
  if (!root || !el) return null;
  const a = root.getBoundingClientRect(), b = el.getBoundingClientRect();
  const left = b.left - a.left;
  const top = b.top - a.top;
  return { x: left + b.width / 2, y: top + b.height / 2, left, right: left + b.width, height: b.height };
}

export function Theatre({ publicView: pub, serverNowMs, host }: TheatreProps) {
  const root = useRef<HTMLDivElement>(null), size = useStageSize(root);
  const reduced = useReducedMotion(), { beats, now } = useTheatre();
  useEventFeed(pub, serverNowMs);
  useClock(pub, serverNowMs);
  const area = useMemo(() => regions(size, host), [size, host]), u = unit(size), rail = area.rail!;
  const scope = () => root.current?.closest('.kp-scene-stage') ?? root.current?.parentElement;
  const find = (selector: string) => scope()?.querySelector<HTMLElement>(selector) ?? null;
  const attr = (name: string, id: SeatId) => find(`[${name}="${CSS.escape(id)}"]`);
  const at: Locate = {
    u,
    tile: id => bridge.tileScreen(id),
    chip: id => attr('data-seat-chip', id),
    seat: id => box(root.current, attr('data-seat-chip', id)),
    vp: id => box(root.current, attr('data-seat-vp', id)),
    // Line 2 of the row: an explicit [data-seat-gains] anchor, else the rail's stats line beside the VP.
    line: id => box(root.current, attr('data-seat-gains', id)
      ?? attr('data-seat-vp', id)?.parentElement?.querySelector('.island-settlers-hud-stats') ?? null),
    bank: () => box(root.current, find('[data-bank="table"]'))
      ?? { x: (rail.left + rail.width / 2) * u, y: (rail.top + 48) * u },
  };
  return <div ref={root} className="island-settlers-theatre">
    {area.dice && <div className="island-settlers-dice-slot" style={regionStyle(area.dice)}>
      <DiceChip pub={pub} reduced={reduced}/></div>}
    {area.strip && <div className="island-settlers-strip-slot" data-host={host || undefined}
      style={regionStyle(area.strip)}><ProductionStrip pub={pub} reduced={reduced}/></div>}
    <GainChips pub={pub} beats={beats} now={now} at={at} reduced={reduced}/>
    <FlipCards pub={pub} now={now} at={at} reduced={reduced}/>
    <Flights beats={beats} now={now} at={at} reduced={reduced}/>
  </div>;
}
