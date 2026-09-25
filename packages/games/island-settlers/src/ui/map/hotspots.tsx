/**
 * Tappable spots (EXPERIENCE §4.2 placement, §4.3). Empty corners and paths get breathing cream rings,
 * existing pieces (movable ships, upgradable settlements, units) a sun ring, hexes a sun rim with the
 * emblems of the seats that could be robbed there. Every spot is a keyboard button with a spoken label.
 */
import type { KeyboardEvent } from 'react';
import type { PieceKind, PublicView, SeatId } from '../../model';
import { edgeLine } from '../shared/board';
import { seatOf, seatStyle } from '../shared/seats';
import { At, Building, CREAM, Emblem, INK, Pirate, Road, Robber, Ship, UnitMark } from './pieces';
import { hexPoints, robberPoint, round, spotLabel, tileOwners, victimsAt, type Spot } from './spots';

export type GhostPiece = PieceKind | 'robber' | 'pirate';
type Props = {
  pub: PublicView; spots: Spot[]; seat: SeatId | null; selected: string | null; ppu: number;
  labels?: Record<string, string>; onPick(id: string): void; onFocusSpot(spot: Spot): void;
};

/** Victim emblems in a row across the south of the hex, each with its card count; your own chip dashed. */
function Victims({ pub, spot, seat }: { pub: PublicView; spot: Spot; seat: SeatId | null }) {
  const victims = victimsAt(pub, spot.id, seat), yours = !!seat && tileOwners(pub, spot.id).includes(seat);
  const row = [...victims, ...(yours ? [seat] : [])];
  return <g transform={`translate(${round(spot.at.x - (row.length - 1) * 0.22)} ${round(spot.at.y + 0.52)})`}>
    {row.map((id, i) => {
      const own = yours && i === row.length - 1, cards = seatOf(pub, id)?.cards ?? 0;
      return <g key={id} transform={`translate(${round(i * 0.44)} 0)`}>
        <circle r={0.17} fill={seatStyle(pub, id).body} stroke={own ? '#ff5748' : INK} strokeWidth={0.035}
          strokeDasharray={own ? '0.06 0.04' : undefined}/>
        <Emblem seat={seatStyle(pub, id)} size={0.17}/>
        {!own && <g transform="translate(0.16 -0.13)">
          <circle r={0.11} fill={CREAM} stroke={INK} strokeWidth={0.02}/>
          <text fontSize={0.16} fill={INK} textAnchor="middle" dominantBaseline="central"
            className="island-settlers-map-text">{cards}</text>
        </g>}
      </g>;
    })}
  </g>;
}

export function Hotspots({ pub, spots, seat, selected, ppu, labels, onPick, onFocusSpot }: Props) {
  const key = (event: KeyboardEvent, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onPick(id);
  };
  const hit = 24 / ppu, px = (n: number) => n / ppu;
  return <g className="island-settlers-hotspots">
    {spots.map(spot => {
      const tile = spot.kind === 'tile', ring = spot.occupied ? Math.max(0.36, px(15)) : Math.max(0.15, px(8));
      const { x, y } = spot.at;
      return <g key={spot.id} className="island-settlers-hotspot" role="button" tabIndex={0} data-spot={spot.id}
        data-kind={spot.kind} data-occupied={spot.occupied || undefined}
        data-selected={spot.id === selected || undefined}
        aria-pressed={spot.id === selected} aria-label={labels?.[spot.id] ?? spotLabel(pub, spot, seat)}
        onKeyDown={event => key(event, spot.id)} onFocus={() => onFocusSpot(spot)}>
        {tile ? <>
          <polygon points={hexPoints(spot.at, 0.98)} fill="transparent"/>
          <polygon points={hexPoints(spot.at, 0.86)} className="island-settlers-rim"/>
          <polygon points={hexPoints(spot.at, 0.98)} className="island-settlers-focus"/>
          <Victims pub={pub} spot={spot} seat={seat}/>
        </> : <>
          <circle cx={round(x)} cy={round(y)} r={round(Math.max(hit, ring))} fill="transparent"/>
          <g className="island-settlers-ring">
            <circle cx={round(x)} cy={round(y)} r={round(ring)} className="island-settlers-ring-ink"/>
            <circle cx={round(x)} cy={round(y)} r={round(ring)} className="island-settlers-ring-face"/>
          </g>
          <circle cx={round(x)} cy={round(y)} r={round(ring + px(6))} className="island-settlers-focus"/>
        </>}
      </g>;
    })}
  </g>;
}

/** The piece you are about to place, in your colour at 70% opacity, drawn at the chosen spot. */
export function Ghost({ pub, spot, piece, seat }: { pub: PublicView; spot: Spot; piece: GhostPiece; seat: SeatId }) {
  const style = seatStyle(pub, seat);
  if (spot.kind === 'tile') {
    return <At at={robberPoint(spot.at, piece === 'pirate' ? 0.35 : undefined)} look="ghost">
      {piece === 'pirate' ? <Pirate/> : <Robber/>}
    </At>;
  }
  if (spot.kind === 'edge') {
    const e = edgeLine(pub.board, spot.id);
    if (!e) return null;
    return piece === 'ship' || piece === 'expedition'
      ? <At at={e.mid} look="ghost"><Ship seat={style}/></At>
      : <g className="island-settlers-ghost"><Road a={e.a} b={e.b} seat={style} bridge={piece === 'bridge'}/></g>;
  }
  const building = piece === 'city' || piece === 'metropolis' || piece === 'wall' ? 'city'
    : piece === 'harbor' ? 'harbor' : piece === 'settlement' ? 'settlement' : null;
  return <At at={spot.at} look="ghost">
    {building ? <Building kind={building} seat={style} wall={piece === 'wall'}/>
      : <UnitMark seat={style} unit={{ id: 'ghost', kind: piece === 'wagon' ? 'wagon' : 'knight', seat,
        at: spot.id, level: 1, active: false, cargo: [] }}/>}
  </At>;
}
