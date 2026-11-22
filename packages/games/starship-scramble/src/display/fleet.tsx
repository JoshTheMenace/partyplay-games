import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { wingCount, type PublicView } from '../contracts';
import { manifest } from '../manifest';
import { FleetRenderer, fleetLayout } from '../render/fleet';
import { Callout, Header, useBattleFeed } from './combat';
import './combat.css';

/** The TV's battle for a fleet of several wings: one tile per engagement, drawn from PublicView.fleet. */
export function FleetScene({ view }: { view: PublicView }) {
  const root = useRef<HTMLDivElement>(null), bg = useRef<HTMLCanvasElement>(null), main = useRef<HTMLCanvasElement>(null), renderer = useRef<FleetRenderer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 }), { toasts, banner } = useBattleFeed(view), ships = view.fleet?.ships ?? [];
  const shape = ships.map(s => `${s.id}:${s.wing}:${s.faction}:${s.slot}:${s.hullId}`).join();
  const layout = useMemo(() => fleetLayout(ships, wingCount(view.captains.length), size.w, size.h), [shape, size]);
  useLayoutEffect(() => {
    const r = renderer.current = new FleetRenderer(bg.current!, main.current!, manifest.assetBase), el = root.current!;
    const observer = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; r.resize(w, h); setSize(s => s.w === w && s.h === h ? s : { w, h }); });
    observer.observe(el); return () => { observer.disconnect(); r.dispose(); renderer.current = null; };
  }, []);
  useEffect(() => { if (size.w) renderer.current?.set(view, layout); });
  const combat = view.combat;
  return <div ref={root} className={`ss-combat-scene ss-fleet-scene${combat?.paused ? ' is-paused' : ''}`} style={{ '--u': `${Math.max(layout.unit, .5)}px` } as CSSProperties}>
    <canvas ref={bg} className="ss-scene__layer" aria-hidden/>
    <canvas ref={main} className="ss-scene__layer" aria-hidden/>
    {combat && <Header view={view} combat={combat}/>}
    {combat && <Callout view={view} combat={combat} banner={banner}/>}
    <div className="ss-feed" aria-live="polite">{toasts.map(t => <div key={t.id} className="ss-feed__item">{t.text}</div>)}</div>
  </div>;
}
