import { speciesFor } from '../definitions/presentation/species';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Crew, InteriorView, RoomView } from '../contracts';
import { fitCutaway, type CutawayFit } from '../render/cutaway';
import { CutawaySvg, effectiveTier, roomTitle } from './cutaway';
import { shipLabel, type World } from './nav';
export { SYSTEM_GLYPH, effectiveTier, roomTitle } from './cutaway';
export function roomStatus(room: RoomView, timeMs: number) {
  if (!room.known) return 'Layout known · crew and condition hidden';
  const parts: string[] = [`Tier ${effectiveTier(room, timeMs)} of ${room.tier}`];
  if (room.disruptedUntilMs > timeMs) parts.push('Disrupted'); if (room.damage > 0) parts.push(`${Math.round(room.damage)} damage`);
  if (room.fire > 0) parts.push('Fire'); if (room.breach > 0) parts.push('Breach'); if (room.oxygen < 25) parts.push('Low oxygen'); if (room.locked) parts.push('Locked');
  return parts.join(' · ');
}
export function useStage(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null), [size, setSize] = useState(fallback);
  useEffect(() => { const node = ref.current; if (!node) return; const read = () => { const box = node.getBoundingClientRect(); if (box.width > 40 && box.height > 40) setSize({ w: Math.round(box.width), h: Math.round(box.height) }); }; read(); const observer = new ResizeObserver(read); observer.observe(node); return () => observer.disconnect(); }, []);
  return { ref, size };
}
export type InteriorProps = { view: InteriorView; world: World; captainId: string | null; highlightRoomId?: string | null; selectedCrewId?: string | null; hint?: string; onRoom(roomId: string): void; roomLabel?(room: RoomView): string; disabled?: boolean; fallback?: { w: number; h: number }; children?: ReactNode };
/** Live cutaway: authored room geometry drives the painted hull, the interior and the native button layer together, so the tap target is exactly the drawn room. */
export function Interior({ view, world, captainId, highlightRoomId, selectedCrewId, hint, onRoom, roomLabel, disabled, fallback = { w: 600, h: 259 }, children }: InteriorProps) {
  const { ref, size } = useStage(fallback), fit: CutawayFit = fitCutaway(view.rooms, size, view.ship.hullId), timeMs = world.publicView.timeMs;
  const captains = new Map(world.publicView.captains.map(c => [c.id, c.color])), label = shipLabel(view.ship, world.publicView.ships), own = view.ship.ownerCaptainId === captainId;
  return <div ref={ref} className={`ss-interior ${own ? 'ss-interior-own' : view.ship.faction === 'enemy' ? 'ss-interior-enemy' : 'ss-interior-ally'}`} data-ship={view.ship.id} data-tile={fit.tile} data-meets44={fit.meets44}>
    <svg className="ss-interior-art" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <CutawaySvg weaponIds={view.ship.weaponIds} fit={fit} rooms={view.rooms} crew={view.crew} paint={view.ship.faction === 'enemy' ? '#b2542f' : view.ship.color} faction={view.ship.faction} timeMs={timeMs} viewerId={captainId} captainColors={captains} highlightRoomId={highlightRoomId} selectedCrewId={selectedCrewId} destroyed={view.ship.status === 'destroyed'}/>
    </svg>
    <div className="ss-room-buttons">{fit.rooms.map(rect => { const room = view.rooms.find(r => r.id === rect.id)!, occupants = view.crew.filter(c => c.roomId === rect.id), mine = occupants.filter(c => c.ownerCaptainId === captainId).length;
      return <button key={rect.id} type="button" className={`ss-room-button ${highlightRoomId === rect.id ? 'ss-room-button-active' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} disabled={disabled} onClick={() => onRoom(rect.id)}
        aria-label={roomLabel?.(room) ?? `${roomTitle(room)} on ${label}. ${roomStatus(room, timeMs)}. ${room.known ? `${occupants.length} crew` : 'Crew hidden'}${occupants.length ? `: ${occupants.map(c=>`${c.name} (${speciesFor(c.species).name})`).join(', ')}` : ''}${mine ? `, ${mine} yours` : ''}.`}/>; })}</div>
    {!fit.meets44 && <div className="ss-interior-list"><p role="status">Rooms are too small to tap here. Choose from the list.</p><RoomList view={view} timeMs={timeMs} onRoom={onRoom} disabled={disabled}/></div>}
    {hint && <p className="ss-interior-hint" role="status">{hint}</p>}
    {children}
  </div>;
}
/** Accessible alternative when authored rooms cannot reach 44px at the current stage size. */
export function RoomList({ view, timeMs, onRoom, disabled }: { view: InteriorView; timeMs: number; onRoom(roomId: string): void; disabled?: boolean }) {
  return <ul className="ss-room-list">{view.rooms.map(room => <li key={room.id}><button type="button" disabled={disabled} onClick={() => onRoom(room.id)}><strong>{roomTitle(room)}</strong><small>{roomStatus(room, timeMs)}</small></button></li>)}</ul>;
}
export const crewSummary = (crew: Crew) => `${crew.name} · ${speciesFor(crew.species).name} · ${crew.skill} · ${Math.round(crew.hp)}/${crew.maxHp} · ${crew.activity === 'direct' ? 'direct control' : crew.activity}`;
