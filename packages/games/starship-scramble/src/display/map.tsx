import { ArrowBigRight, CircleHelp, Cloud, Crosshair, Crown, Home, Mountain, RadioTower, ShoppingBag, Sun, Zap, type LucideIcon } from 'lucide-react';
import { Countdown } from '../../../../party-ui/src/index';
import type { Hazard, MapNode, NodeKind, PublicView } from '../contracts';
import { Votes, backdrop, tint } from './common';

const NODE: Record<NodeKind, { label: string; Icon: LucideIcon; color: string }> = {
  start: { label: 'Start', Icon: Home, color: '#fff6e5' }, unknown: { label: 'Unknown', Icon: CircleHelp, color: '#a9b3e6' },
  hostile: { label: 'Hostile', Icon: Crosshair, color: '#ff5748' }, distress: { label: 'Distress', Icon: RadioTower, color: '#ffd24a' },
  store: { label: 'Store', Icon: ShoppingBag, color: '#78d955' }, nebula: { label: 'Nebula', Icon: Cloud, color: '#b58aff' },
  exit: { label: 'Exit', Icon: ArrowBigRight, color: '#28c6e7' }, boss: { label: 'Flagship', Icon: Crown, color: '#ff2d55' },
};
const HAZARD: Partial<Record<Hazard, LucideIcon>> = { asteroids: Mountain, solar: Sun, 'ion-storm': Zap };
const W = 1600, H = 660, R = 34;

/** run/map.ts positions are normalized 0..1 (margins included), so they scale straight into the SVG box. */
const place = (nodes: readonly MapNode[]) => new Map(nodes.map(n => [n.id, { x: n.x * W, y: n.y * H }]));

function SectorMap({ view }: { view: PublicView }) {
  const { nodes, currentId, armadaCol } = view.map, at = place(nodes), current = nodes.find(n => n.id === currentId);
  const reach = new Set(current?.links ?? []), colX = (c: number) => { const xs = nodes.filter(n => n.col === c).map(n => at.get(n.id)!.x); return xs.length ? xs.reduce((a, b) => a + b) / xs.length : NaN; };
  const step = W * .88 / Math.max(1, view.map.columns - 1), front = armadaCol < 0 ? W * .06 - step * .55 : (colX(armadaCol) + (colX(armadaCol + 1) || colX(armadaCol) + step)) / 2;
  const trail = (a: MapNode, b: MapNode) => a.visited && (b.visited || b.id === currentId);
  return <svg className="ss-map-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sector map, ${reach.size} reachable beacons`}>
    <defs>
      <linearGradient id="ss-armada" x1="0" x2="1"><stop offset="0" stopColor="#5a0616" stopOpacity=".92"/><stop offset=".78" stopColor="#b3102e" stopOpacity=".55"/><stop offset="1" stopColor="#ff2d55" stopOpacity=".85"/></linearGradient>
      <pattern id="ss-hatch" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="12" height="26" fill="#ff2d55" opacity=".12"/></pattern>
      <radialGradient id="ss-node-glass"><stop offset="0" stopColor="#1f2757"/><stop offset="1" stopColor="#05071a"/></radialGradient>
    </defs>
    {nodes.flatMap(a => a.links.map(id => { const b = nodes.find(n => n.id === id); if (!b) return null; const p = at.get(a.id)!, q = at.get(b.id)!, mx = (p.x + q.x) / 2;
      const kind = trail(a, b) ? 'trail' : a.id === currentId ? 'reach' : b.col <= armadaCol ? 'lost' : 'future';
      return <path key={`${a.id}-${id}`} className={`ss-link ss-link-${kind}`} d={`M${p.x},${p.y} C${mx},${p.y} ${mx},${q.y} ${q.x},${q.y}`}/>; }))}
    <g className="ss-armada" style={{ transform: `translateX(${front}px)` }}>
      <rect x={-W} y={-20} width={W} height={H + 40} fill="url(#ss-armada)"/><rect x={-W} y={-20} width={W} height={H + 40} fill="url(#ss-hatch)"/>
      <path className="ss-armada-edge" d={`M0,-20 ${Array.from({ length: 23 }, (_, i) => `L${i % 2 ? 14 : -6},${i * 32}`).join(' ')} L0,${H + 20}`}/>
      <text className="ss-armada-label" transform={`translate(-22 ${H / 2}) rotate(-90)`} textAnchor="middle">Crimson Armada</text>
    </g>
    {nodes.map(n => { const p = at.get(n.id)!, meta = NODE[n.kind], Hz = n.kind !== 'nebula' ? HAZARD[n.hazard] : undefined, voters = view.captains.filter(c => c.vote === n.id).map(c => c.id);
      const state = n.id === currentId ? 'current' : reach.has(n.id) ? 'reach' : n.visited ? 'visited' : n.col <= armadaCol ? 'lost' : 'future';
      return <g key={n.id} className={`ss-node ss-node-${state} ${n.col <= armadaCol ? 'ss-node-overrun' : ''}`} transform={`translate(${p.x} ${p.y})`} style={tint(meta.color)}>
        {state === 'reach' && <circle className="ss-node-pulse" r={R + 8}/>}
        <circle className="ss-node-disc" r={n.kind === 'boss' ? R + 10 : R}/>
        <meta.Icon x={-19} y={-19} width={38} height={38} className="ss-node-icon"/>
        {Hz && <g transform={`translate(${R * .72} ${R * .72})`}><circle r={15} className="ss-node-hazard"/><Hz x={-10} y={-10} width={20} height={20}/></g>}
        {state === 'reach' && <text className="ss-node-label" y={R + 36} textAnchor="middle">{meta.label}</text>}
        {voters.length > 0 && <foreignObject x={-90} y={-R - 58} width={180} height={46}><Votes ids={voters} captains={view.captains}/></foreignObject>}
        {state === 'current' && <g className="ss-fleet"><circle className="ss-fleet-ring" r={R + 16}/>{view.captains.map((c, i, all) => { const a = -Math.PI / 2 + (i - (all.length - 1) / 2) * .62; return <circle key={c.id} cx={Math.cos(a + Math.PI) * (R + 16)} cy={Math.sin(a + Math.PI) * (R + 16)} r={10} fill={c.color} className="ss-fleet-dot"/>; })}</g>}
      </g>; })}
  </svg>;
}

export function MapScreen({ view, serverNowMs }: { view: PublicView; serverNowMs(): number }) {
  const live = view.captains.filter(c => c.connected), voted = live.filter(c => c.vote).length, last = view.sectorIndex === view.sectorCount - 1;
  return <section className="ss-screen ss-map ss-bg" style={backdrop('map')}>
    <header className="ss-screen-head">
      <div><p className="kp-eyebrow">Sector {view.sectorIndex + 1} of {view.sectorCount} · {view.map.theme}</p><h1 className="kp-title">{view.map.name}</h1>
        <ol className="ss-progress" aria-label="Sector progress">{Array.from({ length: view.sectorCount + 1 }, (_, i) => <li key={i} className={i < view.sectorIndex ? 'done' : i === view.sectorIndex ? 'here' : ''}>{i === view.sectorCount ? <Crown aria-label="Flagship"/> : null}</li>)}</ol></div>
      <div className="ss-vote-status">
        {view.voteDeadline ? <><span>Jumping in</span><Countdown deadline={view.voteDeadline} serverNowMs={serverNowMs}/></> : <span>Vote for the next beacon</span>}
        <b className="kp-numeral">{voted}/{live.length} voted</b>
      </div>
    </header>
    <div className="ss-map-frame"><SectorMap view={view}/></div>
    <footer className="ss-map-foot">
      <ul className="ss-legend">{(['hostile', 'distress', 'store', 'nebula', 'unknown', last ? 'boss' : 'exit'] as const).map(k => { const { Icon, label, color } = NODE[k]; return <li key={k} style={tint(color)}><Icon aria-hidden/>{label}</li>; })}
        <li className="ss-legend-armada"><i/>Armada front: beacons it reaches trigger ambushes</li></ul>
    </footer>
  </section>;
}
