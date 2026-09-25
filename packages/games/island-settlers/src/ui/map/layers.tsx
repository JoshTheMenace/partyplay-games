/**
 * Everything that sits on the board: module features, routes, buildings, units and the neutral pieces.
 * Module layers are generic: features draw by `kind` and units by `UnitKind`, so a new module that only
 * uses contract types shows up without map changes.
 */
import { midpoint, toward } from '../../geometry';
import type { BoardFeature, PublicView, SeatId } from '../../model';
import { boardIndex, edgeLine } from '../shared/board';
import { seatStyle } from '../shared/seats';
import {
  At, Building, CREAM, Glyph, INK, Merchant, Pirate, PLUM, Road, Robber, Ship, UnitMark,
} from './pieces';
import { merchantPoint, robberPoint, round, unitPoint } from './spots';

type Props = { pub: PublicView; seat: SeatId | null; scale: number };
const look = (seat: SeatId | null, owner: SeatId | null) => (seat && owner !== seat ? 'dim' as const : undefined);
const MARK: Partial<Record<BoardFeature['kind'], string>> = {
  depot: 'tools', lair: 'pirate', spice: 'spice', council: 'vp',
};

/** One feature: rivers are ribbons, fishing grounds driftwood discs, the rest small landmark badges. */
function Feature({ pub, f }: { pub: PublicView; f: BoardFeature }) {
  const index = boardIndex(pub.board);
  if (f.kind === 'river') {
    return <g strokeLinecap="round">{f.edges.map(id => {
      const e = edgeLine(pub.board, id);
      return e && <g key={id}>
        <line x1={round(e.a.x)} y1={round(e.a.y)} x2={round(e.b.x)} y2={round(e.b.y)} stroke="#4fa6d9"
          strokeWidth={0.14}/>
        <line x1={round(e.a.x)} y1={round(e.a.y)} x2={round(e.b.x)} y2={round(e.b.y)} stroke="#bfe4f7"
          strokeWidth={0.03}/>
      </g>;
    })}</g>;
  }
  if (f.kind === 'bridge-site') {
    const e = edgeLine(pub.board, f.edge);
    return e && !pub.pieces.routes[f.edge] ? <circle cx={round(e.mid.x)} cy={round(e.mid.y)} r={0.12} fill="none"
      stroke={CREAM} strokeWidth={0.035} strokeDasharray="0.05 0.04"/> : null;
  }
  if (f.kind === 'fishing-ground') {
    const tile = index.tiles.get(f.tile), ends = f.vertices.map(v => index.vertices.get(v)).filter(v => !!v);
    if (!tile || ends.length < 2) return null;
    const at = toward(midpoint(ends[0], ends[1]), tile, 0.45 / 0.866);
    return <At at={at}>
      <circle r={0.22} fill="#8a6136" stroke={INK} strokeWidth={0.03}/>
      <text fontSize={0.14} fill={CREAM} textAnchor="middle" dominantBaseline="central"
        className="island-settlers-map-text">{f.numbers.join(' ')}</text>
    </At>;
  }
  if (f.kind === 'barbarian-path') {
    const at = pub.ext['cities-knights']?.barbarian.position ?? -1;
    return <g>{f.tiles.map((id, i) => {
      const t = index.tiles.get(id);
      return t && <circle key={id} cx={round(t.x)} cy={round(t.y)} r={i === at ? 0.16 : 0.08}
        fill={i === at ? '#5a1f22' : CREAM} fillOpacity={i === at ? 1 : 0.5} stroke={INK} strokeWidth={0.02}/>;
    })}</g>;
  }
  if (f.kind === 'landing') {
    const points = f.path.map(id => index.tiles.get(id)).filter(t => !!t).map(t => `${round(t.x)},${round(t.y)}`);
    return <polyline points={points.join(' ')} fill="none" stroke={CREAM} strokeWidth={0.04}
      strokeDasharray="0.1 0.08"
      opacity={0.7}/>;
  }
  const where = f.kind === 'depot' ? index.vertices.get(f.vertex) : index.tiles.get(f.tile);
  if (!where) return null;
  const at = f.kind === 'depot' ? where : { x: where.x + 0.45, y: where.y + 0.32 };
  return <At at={at}>
    <rect x={-0.15} y={-0.15} width={0.3} height={0.3} rx={0.07} fill={f.kind === 'lair' ? PLUM : CREAM}
      stroke={INK} strokeWidth={0.03}/>
    <Glyph name={MARK[f.kind] ?? 'vp'} size={0.22} fill={f.kind === 'lair' ? CREAM : INK}/>
  </At>;
}

/** Static features plus features revealed from fog. */
export function Features({ pub }: { pub: PublicView }) {
  const revealed = Object.values(pub.pieces.reveals).flatMap(r => (r.feature ? [r.feature] : []));
  return <g className="island-settlers-features">
    {[...pub.board.features, ...revealed].map(f => <Feature key={f.id} pub={pub} f={f}/>)}
  </g>;
}

/** Routes, buildings and units at `scale` (bigger on the mini map); merchant, robber and pirate never scale. */
export function Pieces({ pub, seat, scale }: Props) {
  const index = boardIndex(pub.board), { pieces } = pub;
  const tile = (id: string | null) => (id ? index.tiles.get(id) : undefined);
  const robber = tile(pieces.robber), pirate = tile(pieces.pirate), merchant = pieces.merchant;
  const merchantTile = tile(merchant?.tile ?? null);
  return <g className="island-settlers-pieces">
    {Object.values(pieces.routes).map(r => {
      const e = edgeLine(pub.board, r.edge), style = seatStyle(pub, r.seat);
      if (!e) return null;
      return r.kind === 'ship'
        ? <At key={r.edge} at={e.mid} look={look(seat, r.seat)} scale={scale}><Ship seat={style}/></At>
        : <g key={r.edge} className={look(seat, r.seat) && 'island-settlers-dim'}>
          <Road a={e.a} b={e.b} seat={style} bridge={r.bridge}/>
        </g>;
    })}
    {Object.values(pieces.buildings).map(b => {
      const v = index.vertices.get(b.vertex);
      return v && <At key={b.vertex} at={v} look={look(seat, b.seat)} scale={scale}>
        <Building kind={b.kind} seat={seatStyle(pub, b.seat)} wall={b.wall} metropolis={b.metropolis}/>
      </At>;
    })}
    {Object.values(pieces.units).map(u => {
      const at = unitPoint(pub, u);
      return at && <At key={u.id} at={at} look={u.seat ? look(seat, u.seat) : undefined} scale={scale}>
        <UnitMark unit={u} seat={u.seat ? seatStyle(pub, u.seat) : null}/>
      </At>;
    })}
    {merchant && merchantTile && <At at={merchantPoint(merchantTile)}>
      <Merchant seat={seatStyle(pub, merchant.seat)}/>
    </At>}
    {robber && <At at={robberPoint(robber)}><Robber/></At>}
    {pirate && <At at={robberPoint(pirate, 0.35)}><Pirate/></At>}
  </g>;
}
