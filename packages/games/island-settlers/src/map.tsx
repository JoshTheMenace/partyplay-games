import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { PublicView } from './model';
import { RESOURCE_META, TERRAIN_META, boardBounds, edgeGeometry, edgeLabel, hexCorners, indexBoard, pips, pushOutward, tileLabel, vertexLabel } from './presentation';
import { MapLayers } from './layers';

export type Hotspot = { id: string; shape: 'vertex' | 'edge' | 'tile'; tone: 'settlement' | 'city' | 'harbor' | 'road' | 'ship' | 'robber' | 'pirate' | 'target'; label?: string };
type Props = { view: PublicView; hotspots?: Hotspot[]; selected?: string | null; onSelect?(spot: Hotspot): void; ghostColor?: string; className?: string };
type Cam = { cx: number; cy: number; zoom: number };
const MAX_ZOOM = 5, ROUND = (n: number) => Math.round(n * 1000) / 1000;

function House({ x, y, color, city, harbor, ghost }: { x: number; y: number; color: string; city?: boolean; harbor?: boolean; ghost?: boolean }) {
  const s = city ? .3 : .22;
  return <g transform={`translate(${ROUND(x)} ${ROUND(y)})`} className={ghost ? 'is-ghost' : 'is-piece'}>{harbor && <rect x={-s * 1.5} y={s * .75} width={s * 3} height={s * .35} rx={.03} fill="#8a6136" stroke="#05071a" strokeWidth={.04}/>}
    <path d={city ? `M${-s} ${s * .9}v${-s * 1.1}l${s * .55} ${-s * .6}l${s * .55} ${s * .6}v${-s * .9}h${s * .55}v${-s * .35}h${s * .35}v${s * 2.15}h${-s * 2}Z` : `M${-s} ${s * .9}v${-s}l${s} ${-s * .85}l${s} ${s * .85}v${s}Z`} fill={color} stroke="#05071a" strokeWidth={.06} strokeLinejoin="round"/>
  </g>;
}
function Route({ ax, ay, bx, by, color, ship, ghost }: { ax: number; ay: number; bx: number; by: number; color: string; ship: boolean; ghost?: boolean }) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len * .34, uy = dy / len * .34;
  if (ship) return <g transform={`translate(${ROUND(mx)} ${ROUND(my)}) rotate(${ROUND(Math.atan2(dy, dx) * 180 / Math.PI)})`} className={ghost ? 'is-ghost' : 'is-piece'}><path d="M-.34 .02q.34 .2 .68 0l-.1 .16h-.48Z" fill={color} stroke="#05071a" strokeWidth={.05}/><path d="M0 .02V-.3M0 -.3l.26 .22H0Z" fill="#fff6e5" stroke="#05071a" strokeWidth={.045}/></g>;
  return <line x1={ROUND(mx - ux)} y1={ROUND(my - uy)} x2={ROUND(mx + ux)} y2={ROUND(my + uy)} stroke={color} strokeWidth={.17} strokeLinecap="round" className={ghost ? 'is-ghost' : 'is-piece is-road'} style={{ '--outline': '#05071a' } as CSSProperties}/>;
}
function Robber({ x, y, pirate, ghost }: { x: number; y: number; pirate: boolean; ghost?: boolean }) {
  return <g transform={`translate(${ROUND(x)} ${ROUND(y)})`} className={ghost ? 'is-ghost' : 'is-piece'}>{pirate ? <path d="M-.36 .08q.36 .22 .72 0l-.1 .18h-.52ZM0 .08V-.36M0 -.36l.3 .26H0Z" fill="#23212f" stroke="#fff6e5" strokeWidth={.05}/> : <><ellipse cx="0" cy=".06" rx=".2" ry=".26" fill="#23212f" stroke="#fff6e5" strokeWidth={.05}/><circle cx="0" cy="-.26" r=".16" fill="#23212f" stroke="#fff6e5" strokeWidth={.05}/></>}</g>;
}

/** Portrait-friendly map: one finger pans, two fingers pinch, taps select server-provided hotspots at ≥44px. */
export function BoardMap({ view, hotspots = [], selected = null, onSelect, ghostColor = '#fff6e5', className = '' }: Props) {
  // Snapshots may hand over a fresh board object every 100 ms; key memos on the tile IDs so panning is never reset by a repaint.
  const board = view.board, boardKey = board.tiles.map(tile => tile.id).join(), index = useMemo(() => indexBoard(board), [boardKey]), box = useMemo(() => boardBounds(board), [boardKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = Math.max(box.maxX - box.minX, box.maxY - box.minY) + .5, home = useMemo<Cam>(() => ({ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, zoom: 1 }), [box]);
  const [cam, setCam] = useState<Cam>(home), svg = useRef<SVGSVGElement>(null), [px, setPx] = useState(320);
  useEffect(() => { const element = svg.current!, observer = new ResizeObserver(() => setPx(element.clientWidth || 320)); observer.observe(element); setPx(element.clientWidth || 320); return () => observer.disconnect(); }, []);
  const clamp = (next: Cam): Cam => { const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom)), half = fit / zoom / 2, pad = .6; return { zoom, cx: Math.min(box.maxX - half + pad, Math.max(box.minX + half - pad, next.cx)), cy: Math.min(box.maxY - half + pad, Math.max(box.minY + half - pad, next.cy)) }; };
  const point = (spot: Hotspot) => spot.shape === 'vertex' ? index.vertices.get(spot.id) : spot.shape === 'tile' ? index.tiles.get(spot.id) : edgeGeometry(index, spot.id);
  const signature = hotspots.map(spot => spot.id).join(',');
  useEffect(() => {
    if (!hotspots.length) { setCam(home); return; }
    const points = hotspots.map(point).filter((p): p is NonNullable<typeof p> => !!p);
    let min = Infinity; for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    const needed = min < Infinity ? 48 / (min * (px / fit)) : 1, centroid = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 });
    setCam(clamp(needed > 1 ? { cx: centroid.x, cy: centroid.y, zoom: needed } : home));
  }, [signature, px, home]); // eslint-disable-line react-hooks/exhaustive-deps
  const side = fit / cam.zoom, ppu = px / side, hitRadius = Math.max(.15, 22 / ppu);
  const pointers = useRef(new Map<number, { x: number; y: number }>()), gesture = useRef<{ cam: Cam; distance: number; travelled: number; target: string | null } | null>(null);
  const spread = () => { const [a, b] = [...pointers.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const target = (event.target as Element).closest('[data-spot]')?.getAttribute('data-spot') ?? null;
    gesture.current = { cam, distance: spread(), travelled: gesture.current?.travelled ?? 0, target: pointers.current.size === 1 ? target : null };
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId), current = gesture.current; if (!previous || !current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y; current.travelled += Math.hypot(dx, dy);
    if (pointers.current.size === 1) setCam(prev => clamp({ ...prev, cx: prev.cx - dx / ppu, cy: prev.cy - dy / ppu }));
    else if (current.distance > 0) setCam(clamp({ ...current.cam, zoom: current.cam.zoom * spread() / current.distance }));
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId); const current = gesture.current; if (!current) return;
    if (pointers.current.size === 0) { if (current.travelled < 8 && current.target) { const spot = hotspots.find(item => item.id === current.target); if (spot) onSelect?.(spot); } gesture.current = null; }
    else gesture.current = { ...current, cam, distance: spread(), target: null };
  };
  const cancel = (event: PointerEvent<SVGSVGElement>) => { pointers.current.delete(event.pointerId); gesture.current = pointers.current.size && gesture.current ? { ...gesture.current, cam, distance: spread(), target: null } : null; };
  const wheel = (event: WheelEvent<SVGSVGElement>) => setCam(prev => clamp({ ...prev, zoom: prev.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2) }));
  const keyed = (event: KeyboardEvent, spot: Hotspot) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(spot); } };
  const colorOf = (id: string) => view.players.find(player => player.id === id)?.color ?? '#fff6e5';
  const selectedSpot = hotspots.find(spot => spot.id === selected) ?? null, robberTile = index.tiles.get(view.robber), pirateTile = view.pirate ? index.tiles.get(view.pirate) : undefined;
  const label = (spot: Hotspot) => spot.label ?? (spot.shape === 'vertex' ? `Corner by ${vertexLabel(index, spot.id)}` : spot.shape === 'edge' ? edgeLabel(index, spot.id) : tileLabel(index.tiles.get(spot.id)!));
  return <div className={`is-map ${className}`}>
    <svg ref={svg} className="is-map-svg" viewBox={`${ROUND(cam.cx - side / 2)} ${ROUND(cam.cy - side / 2)} ${ROUND(side)} ${ROUND(side)}`} role="group" aria-label="Island map. Drag to pan, pinch to zoom." onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel} onWheel={wheel}>
      <rect x={box.minX - 40} y={box.minY - 40} width={box.maxX - box.minX + 80} height={box.maxY - box.minY + 80} fill="var(--is-ocean)"/>
      {board.tiles.map(tile => { const meta = TERRAIN_META[tile.terrain], corners = hexCorners(tile.x, tile.y, tile.terrain === 'sea' ? .985 : .95).map(([x, y]) => `${ROUND(x)},${ROUND(y)}`).join(' '), hot = tile.number > 0 && (tile.number === 6 || tile.number === 8), blocked = tile.id === view.robber || tile.id === view.pirate; return <g key={tile.id} className="is-tile" data-terrain={tile.terrain} data-blocked={blocked || undefined}>
        <polygon points={corners} fill={meta.color} stroke={tile.terrain === 'sea' ? 'var(--is-ocean-line)' : meta.deep} strokeWidth={tile.terrain === 'sea' ? .02 : .07} strokeLinejoin="round"/>
        {tile.terrain !== 'sea' && <g transform={tile.terrain === 'fog' ? `translate(${ROUND(tile.x - .42)} ${ROUND(tile.y - .42)}) scale(.035)` : `translate(${ROUND(tile.x - .3)} ${ROUND(tile.y - (tile.number ? .82 : .3))}) scale(.025)`}><path d={meta.glyph} fill={tile.terrain === 'fog' ? '#fff6e5' : meta.deep} opacity={.85}/></g>}
        {tile.number > 0 && <g className="is-token" transform={`translate(${ROUND(tile.x)} ${ROUND(tile.y)})`} aria-hidden="true"><circle r=".36" fill="#fff6e5" stroke="#05071a" strokeWidth=".04"/><text y=".08" textAnchor="middle" fontSize=".42" fontWeight="900" fill={hot ? '#d8331f' : '#05071a'}>{tile.number}</text><g fill={hot ? '#d8331f' : '#05071a'}>{Array.from({ length: pips(tile.number) }, (_, i) => <circle key={i} cx={(i - (pips(tile.number) - 1) / 2) * .075} cy=".22" r=".028"/>)}</g></g>}
      </g>; })}
      {board.ports.map((port, i) => { const a = index.vertices.get(port.vertices[0]), b = index.vertices.get(port.vertices[1] ?? port.vertices[0]); if (!a || !b) return null; const { x, y } = pushOutward({ x: home.cx, y: home.cy }, (a.x + b.x) / 2, (a.y + b.y) / 2, .36); return <g key={i} className="is-port" transform={`translate(${ROUND(x)} ${ROUND(y)})`}><rect x="-.42" y="-.2" width=".84" height=".4" rx=".12" fill="#fff6e5" stroke="#05071a" strokeWidth=".035"/><text y=".08" textAnchor="middle" fontSize=".24" fontWeight="900" fill="#05071a">{port.resource === 'any' ? '3 : 1' : '2 : 1'}</text>{port.resource !== 'any' && <g transform="translate(.16 -.2) scale(.014)"><path d={RESOURCE_META[port.resource].glyph} fill={RESOURCE_META[port.resource].deep}/></g>}</g>; })}
      {view.routes.map(route => { const g = edgeGeometry(index, route.edge); return g && <Route key={route.edge} ax={g.a.x} ay={g.a.y} bx={g.b.x} by={g.b.y} color={colorOf(route.playerId)} ship={route.kind === 'ship'}/>; })}
      {view.buildings.map(building => { const v = index.vertices.get(building.vertex); return v && <House key={building.vertex} x={v.x} y={v.y} color={colorOf(building.playerId)} city={building.kind === 'city'} harbor={building.kind === 'harbor'}/>; })}
      <MapLayers view={view} index={index} colorOf={colorOf}/>
      {robberTile && <Robber x={robberTile.x + .45} y={robberTile.y + .3} pirate={false}/>}
      {pirateTile && <Robber x={pirateTile.x} y={pirateTile.y} pirate/>}
      {hotspots.map(spot => { const p = point(spot); if (!p) return null; const active = spot.id === selected; return <g key={spot.id} className="is-hotspot" data-spot={spot.id} data-tone={spot.tone} data-selected={active || undefined} role="button" tabIndex={0} aria-label={label(spot)} aria-pressed={active} onKeyDown={event => keyed(event, spot)}>
        {spot.shape === 'tile' ? <polygon points={hexCorners(p.x, p.y, .9).map(([x, y]) => `${ROUND(x)},${ROUND(y)}`).join(' ')} fill="transparent" stroke="var(--is-hot)" strokeWidth={.12} strokeLinejoin="round" className="is-hotspot-ring"/> : <><circle cx={ROUND(p.x)} cy={ROUND(p.y)} r={ROUND(hitRadius)} fill="transparent"/><circle cx={ROUND(p.x)} cy={ROUND(p.y)} r={ROUND(Math.min(hitRadius, .32))} fill="var(--is-hot-fill)" stroke="var(--is-hot)" strokeWidth={.07} className="is-hotspot-ring"/></>}
      </g>; })}
      {selectedSpot && (() => { const p = point(selectedSpot); if (!p) return null; if (selectedSpot.shape === 'vertex') return <House x={p.x} y={p.y} color={ghostColor} city={selectedSpot.tone === 'city'} harbor={selectedSpot.tone === 'harbor'} ghost/>; if (selectedSpot.shape === 'edge') { const g = p as ReturnType<typeof edgeGeometry> & object; return <Route ax={g.a.x} ay={g.a.y} bx={g.b.x} by={g.b.y} color={ghostColor} ship={selectedSpot.tone === 'ship'} ghost/>; } return <Robber x={p.x + (selectedSpot.tone === 'pirate' ? 0 : .45)} y={p.y + (selectedSpot.tone === 'pirate' ? 0 : .3)} pirate={selectedSpot.tone === 'pirate'} ghost/>; })()}
    </svg>
    <div className="is-map-tools" role="group" aria-label="Map zoom"><button type="button" aria-label="Zoom in" onClick={() => setCam(prev => clamp({ ...prev, zoom: prev.zoom * 1.4 }))}>+</button><button type="button" aria-label="Zoom out" onClick={() => setCam(prev => clamp({ ...prev, zoom: prev.zoom / 1.4 }))}>−</button><button type="button" aria-label="Show whole board" onClick={() => setCam(home)}>⛶</button></div>
  </div>;
}
