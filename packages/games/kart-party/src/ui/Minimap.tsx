/* North-up course map drawn from the same track samples the simulation uses. World → map: (−x, −z),
 * so driving "forward" is up the screen and a left turn on the course is a left turn on the map. */
import { useId, useMemo, type ReactNode } from 'react';
import { getTrack } from '../tracks/index';
import type { Track } from '../sim/track';
import type { RaceView, TrackId } from '../sim/types';

type Line = { x1: number; y1: number; x2: number; y2: number };
/** `over`: open sub-paths of road passing above another part of the course, redrawn on top so overpasses read.
 * `loops`: map centre of each loop-the-loop footprint (a vertical loop projects to a line, so the map marks it with a ring). */
export type TrackOutline = { d: string; over: string[]; loops: { cx: number; cy: number }[]; viewBox: string; box: Line; size: number; start: Line; rainbow: boolean };
const RAINBOW = ['#ff4d6d', '#ff9a1f', '#ffe14d', '#5be37d', '#3fb4ff', '#7a6bff', '#d46bff'];
const cache = new WeakMap<Track, TrackOutline>();
/** SVG path + viewBox for a course (cached per track). Used by the minimap and the settings cards. */
export function trackOutline(id: TrackId, track: Track = getTrack(id)): TrackOutline {
  const hit = cache.get(track); if (hit) return hit;
  const S = track.samples, step = Math.max(1, Math.floor(S.length / 240));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of S) { minX = Math.min(minX, -s.x); maxX = Math.max(maxX, -s.x); minY = Math.min(minY, -s.z); maxY = Math.max(maxY, -s.z); }
  const size = Math.max(maxX - minX, maxY - minY), pad = size * .08, x0 = minX - pad - (size - (maxX - minX)) / 2, y0 = minY - pad - (size - (maxY - minY)) / 2;
  const P = S.filter((_, i) => i % step === 0), n = P.length, at = (i: number) => `${(-P[i].x).toFixed(1)} ${(-P[i].z).toFixed(1)}`;
  // A point is "over" when it runs ≥ 3 m above road whose map stroke it touches (reach = both edge strokes).
  const reach = 2.2 * (size + pad * 2) / 34, len = track.length;
  const over = P.map(p => P.some(q => { const gap = Math.abs(p.d - q.d); return Math.min(gap, len - gap) > reach * 4 && p.y > q.y + 3 && Math.hypot(p.x - q.x, p.z - q.z) < reach; }));
  const on = over.map((o, i) => o || over[(i + 1) % n] || over[(i + n - 1) % n]), first = on.indexOf(false), runs: string[] = [];
  if (first >= 0) for (let k = 1, run: string[] = []; k <= n; k++) { const i = (first + k) % n; if (on[i]) run.push(at(i)); else if (run.length) { if (run.length > 1) runs.push(`M${run.join('L')}`); run = []; } }
  const s0 = S[0], half = s0.halfWidth + 3, f = (v: number) => Number(v.toFixed(1));
  const outline = { d: `M${P.map((_, i) => at(i)).join('L')}Z`, over: runs, loops: track.loops.map(l => ({ cx: f(-(l.ax + l.bx) / 2), cy: f(-(l.az + l.bz) / 2) })), size: size + pad * 2, rainbow: track.def.theme === 'space',
    viewBox: `${x0.toFixed(1)} ${y0.toFixed(1)} ${(size + pad * 2).toFixed(1)} ${(size + pad * 2).toFixed(1)}`, box: { x1: f(minX), y1: f(minY), x2: f(maxX), y2: f(maxY) },
    start: { x1: -(s0.x + s0.rx * half), y1: -(s0.z + s0.rz * half), x2: -(s0.x - s0.rx * half), y2: -(s0.z - s0.rz * half) } };
  cache.set(track, outline); return outline;
}

/** Edge + road strokes (overpasses on top), the start line, `children` (racer dots) and, above them, the loop rings
 * (seven rainbow arcs on a dark halo, hollow so dots show through). On Rainbow Road the road stroke is a rainbow too. */
function Course({ o, children }: { o: TrackOutline; children?: ReactNode }) {
  const w = o.size / 34, id = `kp2-rainbow${useId().replace(/[^\w-]/g, '')}`, road = o.rainbow ? { stroke: `url(#${id})` } : undefined;
  return <>
    {o.rainbow && <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" {...o.box}>{RAINBOW.map((c, i) => <stop key={c} offset={i / (RAINBOW.length - 1)} stopColor={c}/>)}</linearGradient></defs>}
    {[o.d, ...o.over].map((d, i) => <g key={i} className={i ? 'kp2-map-over' : undefined}>
      <path d={d} className="kp2-map-edge" strokeWidth={w * 2.1}/><path d={d} className="kp2-map-road" strokeWidth={w} style={road}/>
    </g>)}
    <line {...o.start} className="kp2-map-start" strokeWidth={w * .7}/>
    {children}
    {o.loops.map((l, i) => <g key={i} className="kp2-map-loop"><circle {...l} r={w * 2.2} strokeWidth={w * 1.5}/>
      {RAINBOW.map((c, k) => <circle key={c} {...l} r={w * 2.2} strokeWidth={w * .8} stroke={c} pathLength={7} strokeDasharray="1 6" strokeDashoffset={-k}/>)}</g>)}
  </>;
}

export function TrackShape({ id, className = 'kp2-track-shape' }: { id: TrackId; className?: string }) {
  return <svg className={className} viewBox={trackOutline(id).viewBox} aria-hidden="true" focusable="false"><Course o={trackOutline(id)}/></svg>;
}

export function Minimap({ race, highlight = [], className = '' }: { race: RaceView; highlight?: readonly string[]; className?: string }) {
  const o = useMemo(() => trackOutline(race.track), [race.track]), r = o.size / 42;
  const order = [...race.racers].sort((a, b) => Number(highlight.includes(a.id)) - Number(highlight.includes(b.id)) || Number(!a.bot) - Number(!b.bot) || b.rank - a.rank);
  return <svg className={`kp2-minimap ${className}`} viewBox={o.viewBox} role="img" aria-label="Course map">
    <Course o={o}>{order.map(p => {
      const big = highlight.includes(p.id), rad = big ? r * 1.45 : p.bot ? r * .9 : r * 1.15;
      return <g key={p.id} transform={`translate(${(-p.x).toFixed(1)} ${(-p.z).toFixed(1)})`} opacity={p.respawnT > 0 ? .45 : 1}>
        {big && <circle r={rad * 1.7} className="kp2-map-halo" fill={p.color}/>}
        <circle r={rad} fill={p.color} className="kp2-map-dot" strokeWidth={rad * .38}/>
        {!p.bot && <circle r={rad * .36} fill="#fff6e5"/>}
      </g>;
    })}</Course>
  </svg>;
}
