import { WeaponMounts } from './weapons';
import { useId } from 'react';
import { CrewFigure } from './crew';
import { speciesFor } from '../definitions/presentation/species';
import type { Crew, HullDefinition, RoomView, SystemId } from '../contracts';
import { FURNITURE, doorsFor, labelPlan, polygonPath, type CutawayFit, type Part } from '../render/cutaway';
import { crewClusters, crewPoint } from '../render/geometry';
export const SYSTEM_GLYPH: Record<SystemId, string> = { piloting: 'PLT', engines: 'ENG', shields: 'SHD', weaponry: 'WPN', 'life-support': 'O₂', doors: 'DRS', medical: 'MED', teleporter: 'TEL', 'drone-bay': 'DRN', hacking: 'HCK', cloak: 'CLK', 'point-defense': 'PDF', 'shield-projector': 'SPJ', 'repair-relay': 'RPR', tractor: 'TRC', scanner: 'SCN', decoy: 'DCY', 'boarding-defense': 'BDF', 'medical-support': 'MSP' };
/** Matches the simulation's effective tier: each 10 damage units lower the working tier; disruption zeroes it. */
export const effectiveTier = (room: Pick<RoomView, 'tier' | 'damage' | 'disruptedUntilMs'>, timeMs: number) => room.disruptedUntilMs > timeMs ? 0 : Math.max(0, room.tier - Math.ceil(room.damage / 10));
export const roomTitle = (room: Pick<RoomView, 'name'>) => room.name.replace(/\b\w/g, c => c.toUpperCase());
/** Hangar previews render the authored hull as a pristine, fully known interior. The preview uses the same deck plan as simulation. */
export function roomsFromHull(hull: HullDefinition): RoomView[] {
  return hull.rooms.map(r => ({ ...r, system: r.system, tier: r.system === 'weaponry' ? 2 : 1, damage: 0, fire: 0, breach: 0, oxygen: 100, locked: false, disruptedUntilMs: 0, mannedBy: null, known: true, adjacent: [...r.adjacent] }));
}
const shade = (hex: string, amount: number) => { const n = parseInt(hex.replace('#', ''), 16); if (Number.isNaN(n) || hex.length !== 7) return hex; const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return `#${[r, g, b].map(v => c(v + (amount > 0 ? (255 - v) * amount : v * amount)).toString(16).padStart(2, '0')).join('')}`; };
export type CutawayProps = { fit: CutawayFit; rooms: RoomView[]; crew: Crew[]; paint: string; faction: 'allied' | 'enemy'; timeMs: number; viewerId: string | null; captainColors: Map<string, string>; highlightRoomId?: string | null; selectedCrewId?: string | null; destroyed?: boolean; weaponIds?: string[]; roomNames?: boolean };
/** The painted vessel with an exposed interior. Exterior, bulkheads, doors, furniture, crew and status all derive from the same fit. */
export function CutawaySvg({ fit, rooms, crew, paint, faction, timeMs, viewerId, captainColors, highlightRoomId, selectedCrewId, destroyed, weaponIds = [], roomNames = true }: CutawayProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, ''), id = (name: string) => `ss-${name}-${uid}`;
  const doors = doorsFor(fit.rooms, Object.fromEntries(rooms.map(r => [r.id, r.adjacent]))), clusters = crewClusters(fit, crew), t = fit.tile;
  const hullColor = destroyed ? '#3a3f5a' : paint, dark = shade(hullColor, -.45), light = shade(hullColor, .25), ink = '#05071a';
  const part = (p: Part, i: number) => {
    if (p.kind === 'engine' && p.at && p.w && p.h) return <g key={i}><rect x={p.at[0] - p.w / 2} y={p.at[1] - p.h / 2} width={p.w} height={p.h} rx={p.h * .16} fill="#596574" stroke={ink} strokeWidth={2.5}/>{[.2,.4,.6,.8].map(v=><line key={v} x1={p.at![0]-p.w!*.34} x2={p.at![0]+p.w!*.34} y1={p.at![1]-p.h!*.5+p.h!*v} y2={p.at![1]-p.h!*.5+p.h!*v} stroke="#18202e" strokeWidth={2}/>)}<rect x={p.at[0] - p.w / 2 - 2} y={p.at[1] - p.h * .3} width={4} height={p.h * .6} rx={2} fill={destroyed ? '#3a3f5a' : '#28c6e7'} className="ss-cut-thrust"/></g>;
    if (p.kind === 'canopy' && p.at && p.r) return <ellipse key={i} cx={p.at[0]} cy={p.at[1]} rx={p.r * .9} ry={p.r * 1.2} fill={destroyed ? '#1f2757' : '#9fe3f5'} stroke={ink} strokeWidth={2}/>;
    if (p.kind === 'dish' && p.at && p.r) return <g key={i}><line x1={p.at[0]} y1={p.at[1]} x2={p.at[0]} y2={p.at[1] - p.r * .9} stroke={ink} strokeWidth={3}/><ellipse cx={p.at[0]} cy={p.at[1] - p.r * .9} rx={p.r * 1.4} ry={p.r * .5} fill={light} stroke={ink} strokeWidth={2}/></g>;
    if (p.kind === 'barrel' && p.points && p.w) return <g key={i}>{[[p.w + 4, ink], [p.w, '#7d909c'], [p.w * .4, '#cad8d9']].map(([width, color]) => <line key={color} x1={p.points![0][0]} y1={p.points![0][1]} x2={p.points![1][0]} y2={p.points![1][1]} stroke={String(color)} strokeWidth={Number(width)} strokeLinecap="round"/>)}</g>;
    if (p.kind === 'stripe' && p.points) return <polyline key={i} points={p.points.map(q => q.join(',')).join(' ')} fill="none" stroke={faction === 'enemy' ? '#ffd24a' : light} strokeWidth={Math.max(2, t * .18)} strokeLinecap="round" opacity={.9}/>;
    if (p.kind === 'poly' && p.points) return <path key={i} d={polygonPath(p.points)} fill={`url(#${id('steel')})`} stroke={ink} strokeWidth={2.5} strokeLinejoin="round"/>;
    if (p.kind === 'plate' && p.points) { const cx = p.points.reduce((a, q) => a + q[0], 0) / p.points.length, cy = p.points.reduce((a, q) => a + q[1], 0) / p.points.length; return <g key={i}><path d={polygonPath(p.points)} fill={`url(#${id('paint')})`} stroke={ink} strokeWidth={2.5} strokeLinejoin="round"/><path d={polygonPath(p.points)} fill="none" stroke={light} strokeOpacity=".6" strokeWidth={1}/><circle cx={cx} cy={cy} r={Math.max(1.2, t * .06)} fill="#e4e9db" opacity=".8"/></g>; }
    if (p.kind === 'band' && p.points && p.w) return <line key={i} x1={p.points[0][0]} y1={p.points[0][1]} x2={p.points[1][0]} y2={p.points[1][1]} stroke="#1c2734" strokeOpacity=".75" strokeWidth={p.w}/>;
    if (p.kind === 'ring' && p.at && p.r) return <ellipse key={i} cx={p.at[0]} cy={p.at[1]} rx={Math.max(2, t * .12)} ry={p.r} fill="#596574" stroke={ink} strokeWidth={2}/>;
    if (p.kind === 'window' && p.at && p.r) return <ellipse key={i} cx={p.at[0]} cy={p.at[1]} rx={p.r} ry={p.r * .8} fill={destroyed ? '#1f2757' : '#9fe3f5'} stroke={ink} strokeWidth={1.5}/>;
    if (p.kind === 'mark' && p.at && p.r) return <g key={i}><circle cx={p.at[0]} cy={p.at[1]} r={p.r} fill="#fff6e5" stroke={ink} strokeWidth={1.5}/><path d={`M${p.at[0] - p.r * .55} ${p.at[1]}h${p.r * 1.1}M${p.at[0]} ${p.at[1] - p.r * .55}v${p.r * 1.1}`} stroke="#3d9a6a" strokeWidth={Math.max(2, p.r * .45)} strokeLinecap="round"/></g>;
    if (p.kind === 'hazard' && p.points) return <g key={i}><polyline points={p.points.map(q => q.join(',')).join(' ')} fill="none" stroke="#1c2734" strokeWidth={Math.max(3, t * .22)} strokeLinecap="round"/><polyline points={p.points.map(q => q.join(',')).join(' ')} fill="none" stroke="#ffd24a" strokeWidth={Math.max(3, t * .22)} strokeLinecap="butt" strokeDasharray={`${t * .35} ${t * .35}`}/></g>;
    return null;
  };
  const under = fit.parts.filter(p => p.kind === 'poly'), bands = fit.parts.filter(p => p.kind === 'band'), over = fit.parts.filter(p => ['engine', 'stripe', 'hazard', 'barrel', 'ring', 'dish', 'plate', 'window', 'mark'].includes(p.kind)), canopies = fit.parts.filter(p => p.kind === 'canopy');
  const H = fit.grid.h, seamY = (f: number) => fit.oy + f * H * t, seams = [.18, .5, .82].map(seamY);
  return <g className={`ss-cut ss-cut-${faction}`} data-hull-x={Math.round(fit.hull.x)} data-hull-w={Math.round(fit.hull.w)}>
    <defs>
      <linearGradient id={id('steel')} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#9aa9b6"/><stop offset=".5" stopColor="#485969"/><stop offset="1" stopColor="#253443"/></linearGradient>
      <linearGradient id={id('floor')} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#455363"/><stop offset="1" stopColor="#283544"/></linearGradient>
      <linearGradient id={id('paint')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={light}/><stop offset=".45" stopColor={hullColor}/><stop offset="1" stopColor={dark}/></linearGradient>
      <pattern id={id('deck')} width={t * .9} height={t * .9} patternUnits="userSpaceOnUse" patternTransform="rotate(-18)"><path d={`M0 ${t * .45}H${t * .9}M${t * .45} 0V${t * .9}`} fill="none" stroke="#bfd4de" strokeOpacity=".09" strokeWidth="1"/><circle cx={t * .45} cy={t * .45} r=".9" fill="#bfd4de" fillOpacity=".18"/></pattern>
      <pattern id={id('hatch')} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#ff574866"/></pattern>
      <clipPath id={id('clip')}><path d={polygonPath(fit.body)}/></clipPath>
    </defs>
    {/* Under layer: wings, pods and the crane sit behind the pressure hull. */}
    <g className="ss-cut-under">{under.map(part)}</g>
    {/* Exhaust glow, drawn before the engine blocks so it reads as heat behind them. */}
    {!destroyed && fit.parts.filter(p => p.kind === 'engine' && p.at && p.w && p.h).map((p, i) => <ellipse key={`glow${i}`} cx={p.at![0] - p.w! / 2 - t * .2} cy={p.at![1]} rx={t * .45} ry={p.h! * .36} fill="#28c6e7" opacity=".35" className="ss-cut-thrust"/>)}
    <path d={polygonPath(fit.body)} fill={`url(#${id('paint')})`} stroke={ink} strokeWidth={Math.max(4, t * .2)} strokeLinejoin="round" opacity={destroyed ? .6 : 1}/>
    {/* Over layer: armour seams and rim highlight clipped to the hull, then machinery that must stay visible. */}
    <g clipPath={`url(#${id('clip')})`} opacity={destroyed ? .4 : 1}>
      <path d={polygonPath(fit.body)} fill="none" stroke="#263846" strokeWidth={t*.56}/>
      <path d={polygonPath(fit.body)} fill="none" stroke={light} strokeWidth={t*.12}/>
      {Array.from({length:9},(_,i)=>{const x=fit.ox+i*fit.grid.w*t/8;return <g key={`armor${i}`}><path d={`M${x} ${fit.hull.y}l${t*.55} ${t*.7}v${fit.hull.h-t*1.4}l${-t*.55} ${t*.7}`} fill="none" stroke={dark} strokeWidth={Math.max(1,t*.06)}/><circle cx={x+t*.28} cy={fit.hull.y+t*.24} r={Math.max(1,t*.055)} fill="#e4e9db"/><circle cx={x+t*.28} cy={fit.hull.y+fit.hull.h-t*.24} r={Math.max(1,t*.055)} fill="#e4e9db"/></g>;})}
      <path d={`M${fit.ox+t*.2} ${fit.oy+H*t*.5}H${fit.ox+(fit.grid.w+1.3)*t}`} stroke="#e6ded0" strokeWidth={t*.25} opacity=".6"/>
      <text x={fit.ox+(fit.grid.w+.38)*t} y={fit.oy+H*t*.5+t*.18} textAnchor="middle" fill="#172634" fontSize={Math.max(6,t*.3)} fontWeight="900" transform={`rotate(90 ${fit.ox+(fit.grid.w+.38)*t} ${fit.oy+H*t*.5+t*.18})`}>{fit.hullId.slice(0,3).toUpperCase()}</text>
      {bands.map(part)}
      {seams.map((y, i) => <line key={i} x1={fit.hull.x} y1={y} x2={fit.hull.x + fit.hull.w} y2={y} stroke={dark} strokeOpacity=".55" strokeWidth={Math.max(1, t * .05)}/>)}
      <path d={polygonPath(fit.body)} fill="none" stroke={light} strokeOpacity=".5" strokeWidth={Math.max(1.5, t * .07)} strokeLinejoin="round" transform={`translate(0 ${Math.max(2, t * .12)})`}/>
    </g>
    <g className="ss-cut-over">{over.map(part)}</g>
    {canopies.map(part)}
    <WeaponMounts fit={fit} ids={weaponIds} faction={faction} destroyed={destroyed}/>
    {/* Exposed deck: one dark cavity behind every room so the interior reads as a cut into the hull. */}
    <g className="ss-cut-deck">{fit.rooms.map(r => <rect key={r.id} x={r.x - t * .12} y={r.y - t * .12} width={r.w + t * .24} height={r.h + t * .24} rx={t * .18} fill={ink} opacity=".9"/>)}</g>
    <g className="ss-cut-rooms">{fit.rooms.map(rect => { const room = rooms.find(r => r.id === rect.id)!, tier = effectiveTier(room, timeMs), cold = room.known && room.oxygen < 25, occupied = crew.some(c => c.roomId === rect.id), furniture = room.system ? FURNITURE[room.system] ?? [] : [];
      const tint = room.system === 'medical' || room.system === 'medical-support' ? '#3d9a6a' : room.system === 'shields' || room.system === 'teleporter' || room.system === 'shield-projector' || room.system === 'cloak' ? '#28c6e7' : room.system === 'weaponry' || room.system === 'point-defense' || room.system === 'boarding-defense' ? '#ffb347' : room.system === 'engines' ? '#ff8a5b' : room.system === 'piloting' || room.system === 'scanner' || room.system === 'hacking' ? '#78c9e8' : null;
      const wall = Math.max(2.5, t * .14), inset = 1.5 + wall / 2;
      return <g key={rect.id} className={`ss-room ${highlightRoomId === rect.id ? 'ss-room-highlight' : ''}`} data-room={rect.id} data-occupied={occupied}>
        <rect x={rect.x + 1.5} y={rect.y + 1.5} width={rect.w - 3} height={rect.h - 3} rx={3} fill={cold ? '#22384e' : `url(#${id('floor')})`}/>
        <rect x={rect.x + 1.5} y={rect.y + 1.5} width={rect.w - 3} height={rect.h - 3} rx={3} fill={`url(#${id('deck')})`}/>
        {tint && <rect x={rect.x + inset} y={rect.y + inset} width={rect.w - inset * 2} height={rect.h - inset * 2} rx={2} fill={tint} opacity={tier === 0 ? .04 : .09}/>}
        {/* Bulkhead: a steel wall with an inner shadow line and corner rivets, not a card border. */}
        <rect x={rect.x + inset} y={rect.y + inset} width={rect.w - inset * 2} height={rect.h - inset * 2} rx={2} fill="none" stroke={room.locked ? '#ffd24a' : `url(#${id('steel')})`} strokeOpacity={room.known ? 1 : .8} strokeWidth={room.locked ? wall + 1 : wall}/>
        {<rect x={rect.x + inset + wall / 2} y={rect.y + inset + wall / 2} width={rect.w - inset * 2 - wall} height={rect.h - inset * 2 - wall} rx={1.5} fill="none" stroke="#0b1220" strokeOpacity=".7" strokeWidth={1}/>}
        {[[rect.x + inset, rect.y + inset], [rect.x + rect.w - inset, rect.y + inset], [rect.x + inset, rect.y + rect.h - inset], [rect.x + rect.w - inset, rect.y + rect.h - inset]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={Math.max(1, wall * .28)} fill="#dfe6ea" opacity=".75"/>)}
        {furniture.map((f, i) => { const X = (v: number) => rect.x + v * rect.w, Y = (v: number) => rect.y + v * rect.h, R = (v: number) => v * Math.min(rect.w, rect.h), stroke = room.system === 'medical' ? '#b7e9c2' : room.system === 'shields' || room.system === 'teleporter' ? '#81d9e9' : room.system === 'weaponry' ? '#f3cf8e' : '#a7bfcb', props = { fill: '#101d2b', stroke, strokeWidth: Math.max(1.2, t * .06), opacity: .85 };
          if (f.kind === 'rect') return <rect key={i} x={X(f.x)} y={Y(f.y)} width={f.w! * rect.w} height={f.h! * rect.h} rx={2} {...props}/>;
          if (f.kind === 'circle') return <circle key={i} cx={X(f.x)} cy={Y(f.y)} r={R(f.r!)} {...props}/>;
          if (f.kind === 'line') return <line key={i} x1={X(f.x)} y1={Y(f.y)} x2={X(f.x2!)} y2={Y(f.y2!)} {...props}/>;
          return <path key={i} d={`M${X(f.x) - R(f.r!)} ${Y(f.y)} A${R(f.r!)} ${R(f.r!)} 0 0 1 ${X(f.x) + R(f.r!)} ${Y(f.y)}`} {...props}/>; })}
        {room.known && room.damage > 0 && <rect x={rect.x + 1.5} y={rect.y + 1.5} width={rect.w - 3} height={rect.h - 3} rx={3} fill={`url(#${id('hatch')})`} opacity={Math.min(1, room.damage / 30)}/>}
        {room.system && <text x={rect.x + 5} y={rect.y + Math.min(15, rect.h * .28)} className="ss-room-glyph" fill={tier === 0 && room.known ? '#ff5748' : '#28c6e7'}>{SYSTEM_GLYPH[room.system]}</text>}
        {roomNames && !occupied && rect.w >= 66 && rect.h >= 52 && <text x={rect.x + 5} y={rect.y + rect.h - 6} className="ss-room-name" fill="#c9d2ff">{room.system ? roomTitle(room) : 'Bay'}</text>}
        {room.known && room.system && Array.from({ length: Math.max(room.tier, 1) }, (_, i) => <rect key={i} x={rect.x + rect.w - 8 - i * 7} y={rect.y + 5} width={5} height={5} rx={1} fill={i < tier ? '#78d955' : '#ff5748'} opacity={i < room.tier ? 1 : 0}/>)}
        {room.known && room.fire > 0 && <text x={rect.x + rect.w / 2} y={rect.y + (occupied ? 14 : rect.h - 6)} textAnchor="middle" className="ss-room-badge" fill="#ffae42">🔥</text>}
        {room.known && room.breach > 0 && <text x={rect.x + rect.w - 8} y={rect.y + (occupied ? 26 : rect.h - 6)} textAnchor="end" className="ss-room-badge" fill="#28c6e7">◌</text>}
        {room.known && room.mannedBy && <circle cx={rect.x + 8} cy={rect.y + rect.h - 8} r={3.5} fill="#78d955"/>}
      </g>; })}</g>
    <g className="ss-cut-doors">{doors.map(d => { const a = rooms.find(r => r.id === d.a), b = rooms.find(r => r.id === d.b), known = !!a?.known && !!b?.known, locked = a?.locked || b?.locked; return <line key={d.a + d.b} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke={!known ? '#8a93c4' : locked ? '#ffd24a' : '#78d955'} strokeDasharray={known ? undefined : '3 3'} strokeWidth={Math.max(3, t * .16)} strokeLinecap="round" data-door={known ? locked ? 'locked' : 'open' : 'unknown'}/>; })}</g>
    <g className="ss-cut-crew">{clusters.flatMap(cluster => { const rect = fit.rooms.find(r => r.id === cluster.roomId)!, n = cluster.shown.length, size = Math.max(16, Math.min(32, t * 1.3, Math.min(rect.w, rect.h) / (n > 2 ? 2.4 : n === 2 ? 2 : 1.7)));
      const points = new Map(cluster.shown.map(member => [member.id, crewPoint(fit, member)])), labels = labelPlan(rect, cluster.shown.map(member => ({ id: member.id, name: member.name, x: points.get(member.id)!.x })), t, selectedCrewId ?? null), labelOf = new Map(labels.map(l => [l.id, l]));
      return [...cluster.shown.map(member => { const p = points.get(member.id)!, mine = member.ownerCaptainId === viewerId, ring = member.ownerCaptainId ? captainColors.get(member.ownerCaptainId) ?? '#a9b3e6' : '#ff5748', label = labelOf.get(member.id);
        // Figures stand on their authoritative position, lifted just enough to leave the label band free at the bottom of the room.
        const fy = Math.min(p.y, rect.y + rect.h - (labels.length ? 12 : 4) - size / 2);
        return <g key={member.id} className={`ss-crew ${mine ? 'ss-crew-own' : ''} ${selectedCrewId === member.id ? 'ss-crew-selected' : ''}`} data-crew={member.id} data-labelled={!!label}><title>{`${member.name} · ${speciesFor(member.species).name}`}</title><CrewFigure crew={member} x={p.x} y={fy} size={size} ownerColor={ring} selected={selectedCrewId === member.id} hostile={!member.ownerCaptainId}/>
          {label && <text x={label.x} y={label.y} textAnchor="middle" className="ss-crew-label" fontSize={label.size} fill={mine ? '#fff6e5' : '#d3dfe9'}>{label.text}</text>}
          {member.hp < member.maxHp && <rect x={p.x - size * .4} y={fy + size * .5 + 1} width={size * .8 * member.hp / member.maxHp} height={2} fill={member.hp < member.maxHp / 3 ? '#ff5748' : '#78d955'}/>}</g>; }),
      ...(cluster.overflow ? [<text key={cluster.roomId + '+'} x={rect.x + rect.w - 6} y={rect.y + 26} textAnchor="end" className="ss-crew-overflow" fill="#fff6e5">+{cluster.overflow}</text>] : [])]; })}</g>
  </g>;
}
