/**
 * Flat piece icons for the phone map, drawn around (0, 0) in world units with a 0.04 ink stroke.
 * Seat colour fills the body and the seat emblem sits inside, so owners read without colour alone.
 */
import type { ReactNode } from 'react';
import type { Point } from '../../geometry';
import type { BuildingKind, Track, Unit } from '../../model';
import { EMBLEM_PATHS } from '../shared/emblems';
import { ICON_PATHS, NONZERO } from '../shared/icon-paths';
import { TRACK_META } from '../shared/labels';
import type { SeatStyle } from '../shared/seats';
import { round } from './spots';

export const INK = '#05071a', CREAM = '#fff6e5', SUN = '#ffd24a', PLUM = '#463a5c';
const STROKE = 0.04;

/** Places children at a world point; `look` dims other seats' pieces or marks a ghost. */
export function At({ at, look, scale = 1, children }:
  { at: Point; look?: 'dim' | 'ghost'; scale?: number; children: ReactNode }) {
  const t = `translate(${round(at.x)} ${round(at.y)})${scale === 1 ? '' : ` scale(${scale})`}`;
  return <g transform={t} className={look && `island-settlers-${look}`}>
    {children}
  </g>;
}

export function Emblem({ seat, x = 0, y = 0, size }: { seat: SeatStyle; x?: number; y?: number; size: number }) {
  const t = `translate(${round(x - size / 2)} ${round(y - size / 2)}) scale(${round(size / 24)})`;
  return <path d={EMBLEM_PATHS[seat.emblem]} transform={t} fill={INK} fillOpacity={0.7} stroke="none"/>;
}

/** A 24×24 icon from the shared set, centred at (x, y). */
export const Glyph = ({ name, x = 0, y = 0, size, fill = INK }:
  { name: string; x?: number; y?: number; size: number; fill?: string }) => ICON_PATHS[name]
  ? <path d={ICON_PATHS[name]} fill={fill} fillRule={NONZERO.has(name) ? 'nonzero' : 'evenodd'} stroke="none"
    transform={`translate(${round(x - size / 2)} ${round(y - size / 2)}) scale(${round(size / 24)})`}/>
  : null;

/** Soft ink drop under a shape, so pieces lift off the terrain like plastic on cardboard. */
const Shadow = ({ d }: { d: string }) =>
  <path d={d} transform="translate(0.035 0.05)" fill={INK} fillOpacity={0.35} stroke="none"/>;

const HOUSE = 'M-.24 .2V-.05L0-.27.24-.05V.2Z';
const CITY = 'M-.33 .23V-.02L-.16-.17 0-.02V-.3L.165-.44.33-.3V.23Z';

export function Building({ kind, seat, wall, metropolis }:
  { kind: BuildingKind; seat: SeatStyle; wall?: boolean; metropolis?: Track }) {
  const city = kind === 'city', d = city ? CITY : HOUSE;
  return <g stroke={INK} strokeWidth={STROKE} strokeLinejoin="round">
    {wall && <rect x={-0.4} y={-0.1} width={0.8} height={0.4} rx={0.08} fill="#c9c2b3" strokeWidth={0.035}/>}
    {kind === 'harbor' && <rect x={-0.34} y={0.14} width={0.68} height={0.12} rx={0.03} fill="#8a6136"/>}
    <Shadow d={d}/>
    <path d={d} fill={seat.body}/>
    {city && <path d="M0-.3 .165-.44.33-.3Z" fill={seat.dark}/>}
    {metropolis && <circle cx={0.165} cy={-0.5} r={0.1} fill={TRACK_META[metropolis].color}/>}
    <Emblem seat={seat} x={city ? -0.16 : 0} y={city ? 0.07 : 0.04} size={city ? 0.2 : 0.22}/>
  </g>;
}

/** A road bar (0.54 × 0.12 plus its ink outline) along a→b, centred on the edge midpoint. */
export function Road({ a, b, seat, bridge }: { a: Point; b: Point; seat: SeatStyle; bridge?: boolean }) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = ((b.x - a.x) / len) * 0.27, uy = ((b.y - a.y) / len) * 0.27;
  const line = { x1: round(mx - ux), y1: round(my - uy), x2: round(mx + ux), y2: round(my + uy) };
  return <g strokeLinecap="round">
    {bridge && <line {...line} stroke="#c9c2b3" strokeWidth={0.3}/>}
    <line {...line} stroke={INK} strokeWidth={0.2} transform="translate(0.03 0.045)" strokeOpacity={0.35}/>
    <line {...line} stroke={INK} strokeWidth={0.2}/>
    <line {...line} stroke={seat.body} strokeWidth={0.12}/>
  </g>;
}

/** Upright ship: seat hull, cream sail with the emblem. Drawn unrotated so it always reads as a boat. */
export function Ship({ seat, cargo = [] }: { seat: SeatStyle; cargo?: Unit['cargo'] }) {
  return <g stroke={INK} strokeWidth={STROKE} strokeLinejoin="round">
    <Shadow d="M-.27 0H.27L.18.15H-.18Z"/>
    <path d="M-.27 0H.27L.18.15H-.18Z" fill={seat.body}/>
    <path d="M.0 0V-.42" fill="none"/>
    <path d="M.03-.4 .25-.06H.03Z" fill={CREAM}/>
    <Emblem seat={seat} x={0.11} y={-0.14} size={0.13}/>
    {cargo.map((kind, i) =>
      <circle key={i} cx={round(-0.16 + i * 0.1)} cy={0.07} r={0.035} fill={CREAM} strokeWidth={0.02}/>)}
  </g>;
}

/** The robber: a slate-plum hooded figure with the only cream outline and sun eyes. */
export const Robber = () => <g stroke={CREAM} strokeWidth={STROKE} strokeLinejoin="round">
  <Shadow d="M-.15 .2Q-.17-.08 0-.28 .17-.08 .15 .2Z"/>
  <path d="M-.15 .2Q-.17-.08 0-.28 .17-.08 .15 .2Z" fill={PLUM}/>
  <circle cx={-0.045} cy={-0.1} r={0.025} fill={SUN} stroke="none"/>
  <circle cx={0.045} cy={-0.1} r={0.025} fill={SUN} stroke="none"/>
</g>;

export const Pirate = () => <g stroke={CREAM} strokeWidth={STROKE} strokeLinejoin="round">
  <path d="M-.3 0H.3L.2.16H-.2Z" fill="#2a2433"/>
  <path d="M-.02 0V-.44M0-.42-.24-.06H0Z" fill={INK}/>
  <circle cx={-0.1} cy={-0.18} r={0.04} fill={CREAM} stroke="none"/>
</g>;

export const Merchant = ({ seat }: { seat: SeatStyle }) => <g stroke={INK} strokeWidth={STROKE}>
  <path d="M-.13 .2-.08-.08H.08L.13 .2Z" fill="#e8b23a"/>
  <circle cy={-0.15} r={0.08} fill="#e8b23a"/>
  <path d="M-.12-.2H.12L0-.33Z" fill={seat.body}/>
</g>;

/**
 * Any module unit (knight, guard, wagon, camel, raider, expedition...): a round token in the seat colour
 * (plum when neutral) with the unit's icon, strength pips and a sun halo when active.
 */
export function UnitMark({ unit, seat }: { unit: Unit; seat: SeatStyle | null }) {
  if (unit.kind === 'expedition' && seat) return <Ship seat={seat} cargo={unit.cargo}/>;
  if (unit.kind === 'barbarian') return <Invaders count={Math.max(1, unit.level)}/>;
  const fill = seat ? (unit.active || unit.kind !== 'knight' ? seat.body : seat.dark) : PLUM;
  const pips = unit.kind === 'knight' || unit.kind === 'guard' || unit.kind === 'wagon' ? unit.level : 0;
  return <g stroke={seat ? INK : CREAM} strokeWidth={STROKE}>
    {unit.active && unit.kind === 'knight' && <circle r={0.24} fill="none" stroke={SUN} strokeWidth={0.05}/>}
    <circle r={0.17} fill={fill}/>
    <Glyph name={unit.kind} size={0.2} y={-0.01} fill={seat ? INK : CREAM}/>
    {Array.from({ length: Math.min(pips, 3) }, (_, i) =>
      <rect key={i} x={round((i - (Math.min(pips, 3) - 1) / 2) * 0.09 - 0.03)} y={0.2} width={0.06} height={0.06}
        fill={CREAM} strokeWidth={0.02}/>)}
  </g>;
}

/** Up to three rust invaders; more become a "×n" tag. */
export function Invaders({ count }: { count: number }) {
  const shown = Math.min(count, 3);
  return <g stroke={CREAM} strokeWidth={0.025}>
    {Array.from({ length: shown }, (_, i) =>
      <path key={i} d={`M${round(i * 0.16 - 0.24)} .1l.08-.24.08.24Z`} fill="#8c3b2a"/>)}
    {count > 3 && <text x={0.28} y={0.08} fontSize={0.2} fill={CREAM} stroke="none"
      className="island-settlers-map-text">×{count}</text>}
  </g>;
}
