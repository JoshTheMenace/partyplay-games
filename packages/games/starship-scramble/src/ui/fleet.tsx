import { memo } from 'react';
import type { PublicView, RoomView, ShipSummary } from '../contracts';
import { hulls } from '../definitions/presentation';
import { fitCutaway } from '../render/cutaway';
import { formation, STAGE, type Slot } from '../render/formation';
import { CutawaySvg } from './cutaway';

/** Public deck plans contain installed system identities, never crew or live room conditions. */
export function blueprintRooms(ship: ShipSummary): RoomView[] {
  return (hulls.find(h => h.id === ship.hullId)?.rooms ?? []).map(room => {
    const installed = ship.rooms.find(r => r.id === room.id);
    return { ...room, ...installed, tier: 0, damage: 0, fire: 0, breach: 0, oxygen: 0, locked: false, disruptedUntilMs: 0, mannedBy: null, known: false };
  });
}
const Blueprint = memo(function Blueprint({ ship, w, h }: { ship: ShipSummary; w: number; h: number }) {
  const rooms = blueprintRooms(ship), fit = fitCutaway(rooms, { w, h }, ship.hullId, 6);
  return <g style={{ ['--ss-glyph' as string]: `${Math.max(7, Math.min(14, fit.tile * .48))}px`, ['--ss-room-name' as string]: `${Math.max(7, Math.min(11, fit.tile * .34))}px` }}><CutawaySvg roomNames={false} fit={fit} rooms={rooms} crew={[]} weaponIds={ship.weaponIds} paint={ship.color} faction={ship.faction} timeMs={0} viewerId={null} captainColors={new Map()} destroyed={ship.status !== 'active'}/></g>;
}, (a, b) => a.w === b.w && a.h === b.h && a.ship.hullId === b.ship.hullId && a.ship.color === b.ship.color && a.ship.status === b.ship.status && JSON.stringify(a.ship.rooms) === JSON.stringify(b.ship.rooms) && JSON.stringify(a.ship.weaponIds) === JSON.stringify(b.ship.weaponIds));
export function ShipThumbnail({ ship }: { ship: ShipSummary }) {
  return <svg className="ss-ship-thumbnail" viewBox="0 0 320 160" aria-hidden="true"><Blueprint ship={ship} w={320} h={160}/></svg>;
}
function Vessel({ ship, slot }: { ship: ShipSummary; slot: Slot }) {
  const enemy = ship.faction === 'enemy', accent = enemy ? '#ff5748' : ship.color;
  const name = ship.name.replace(/^E\d+\s*[·:-]\s*/, ''), short = slot.w < 300, title = enemy ? `${slot.label} · ${name}` : name;
  const alerts = ship.status !== 'active' ? ship.status : ship.alerts.join(' · ');
  return <g transform={`translate(${slot.x} ${slot.y})`} data-fleet-ship={ship.id}>
    <title>{`${title}. Hull ${Math.ceil(ship.hull)} of ${ship.maxHull}. Shields ${Math.floor(ship.shield)}. ${ship.rooms.map(r => r.name).join(', ')}. Crew and room conditions hidden.`}</title>
    <text x={8} y={18} className="ss-fleet-title" fill={accent} fontSize={short ? 15 : 20}>{title.length > (short ? 25 : 42) ? title.slice(0, short ? 24 : 41) + '…' : title}</text>
    <g transform="translate(8 25)" fill="none" stroke="#a9b3e6" strokeWidth="1.4" aria-hidden="true"><path d="M1 6 5 1H11L15 6 11 11H5Z"/><path d="M100 1 107 3V7Q105 11 100 13Q95 11 93 7V3Z"/></g>
    <text x={30} y={36} fill="#c9d2ff" fontSize={short ? 11 : 13}>{Math.ceil(ship.hull)}/{ship.maxHull}</text>
    <text x={123} y={36} fill="#c9d2ff" fontSize={short ? 11 : 13}>{Math.floor(ship.shield)}</text>
    <rect x={8} y={43} width={slot.w - 16} height={4} rx={2} fill="#303955"/>
    <rect x={8} y={43} width={(slot.w - 16) * Math.max(0, ship.hull / ship.maxHull)} height={4} rx={2} fill={enemy ? '#ff5748' : '#78d955'}/>
    <g transform="translate(0 50)"><Blueprint ship={ship} w={slot.w} h={slot.h - 70}/></g>
    <text x={slot.w / 2} y={slot.h - 4} textAnchor="middle" fill="#ff9a73" fontSize={short ? 10 : 12}>{alerts}</text>
  </g>;
}
export function FleetBlueprints({ view }: { view: PublicView }) {
  return <svg className="ss-fleet-blueprints" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} role="img" aria-label="Fleet deck plans and installed systems. Crew and room conditions are concealed.">
    <defs><radialGradient id="ss-fleet-sky"><stop stopColor="#182652"/><stop offset="1" stopColor="#05071a"/></radialGradient></defs>
    <rect width={STAGE.w} height={STAGE.h} fill="url(#ss-fleet-sky)"/>
    {Array.from({ length: 140 }, (_, i) => <circle key={i} cx={(i * 701 + 43) % STAGE.w} cy={(i * 271 + 83) % STAGE.h} r={i % 4 === 0 ? 1.2 : .6} fill="#bbc9e8" opacity={.2 + i % 3 * .12}/>)}
    <text x={32} y={27} fill="#28c6e7" className="ss-fleet-title" fontSize={18}>ALLIES</text>
    <text x={724} y={27} fill="#ff5748" className="ss-fleet-title" fontSize={18}>HOSTILES</text>
    {formation(view.ships).map(slot => <Vessel key={slot.shipId} ship={view.ships.find(s => s.id === slot.shipId)!} slot={slot}/>)}
  </svg>;
}
