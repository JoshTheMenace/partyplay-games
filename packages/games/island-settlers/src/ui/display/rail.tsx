import { useRef, useSyncExternalStore } from 'react';
import { COMMODITIES, RESOURCES, type AwardId, type PublicView } from '../../model';
import { goodText } from '../shared/format';
import { Icon } from '../shared/icons';
import { AWARD_LABEL, hasDevCards } from '../shared/labels';
import { regionStyle, type Rect } from '../shared/layout';
import { SeatChip } from '../shared/SeatChip';
import { nameOf, seatOf } from '../shared/seats';
import { useReducedMotion } from '../shared/timeline';
import { useFlip } from './hooks';
import { dense, finale, rowHeight } from './logic';
import { RaceTrack, SnakeStrip } from './race';
import { theatre } from './theatre/store';
import { SeatRow } from './row';

const u = (n: number) => `calc(${n} * var(--u))`;
const AWARDS: AwardId[] = ['longest-road', 'largest-army'];

/** ≤ 6 seats: dev cards left, bank piles at 3 or fewer, and the award holders (no dev row without dev cards). */
function TableCard({ pub }: { pub: PublicView }) {
  const goods = pub.modules.includes('cities-knights') ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
  const low = goods.filter(g => (pub.bank[g] ?? 0) <= 3), dev = hasDevCards(pub);
  return <section className="island-settlers-hud-table island-settlers-panel" aria-label="Table">
    {(dev || low.length > 0) && <p data-bank="table">{dev && <><Icon name="development"/>
      <span><b className="kp-numeral">{pub.devDeck}</b> dev cards left</span></>}
      {low.length > 0 && <em>Bank low: {low.map(g => goodText(pub.bank[g] ?? 0, g)).join(', ')}</em>}</p>}
    {AWARDS.filter(id => dev || id !== 'largest-army').map(id => {
      const holder = pub.awards[id];
      return <p key={id}><Icon name={id}/><span>{AWARD_LABEL[id]}</span>
        {holder ? <><SeatChip pub={pub} seat={holder} size={u(24)}/><b>{nameOf(pub, holder)}</b></>
          : <small>nobody yet</small>}</p>;
    })}
  </section>;
}

/**
 * The right rail: race track (or setup snake), one row per seat, then the Table card at ≤ 6 seats. In the
 * finale the totals count up seat by seat, then the rows re-sort into rank (EXPERIENCE §3.10).
 */
export function SeatRail({ pub, rect, now, serverNowMs }: {
  pub: PublicView; rect: Rect; now: number; serverNowMs(): number;
}) {
  const reduced = useReducedMotion(), list = useRef<HTMLOListElement>(null);
  // In the finale read the theatre's per-frame clock, so totals and the re-sort land on their slot.
  const frame = useSyncExternalStore(theatre.subscribe, () => (pub.results ? theatre.snapshot().now : 0));
  const reveal = finale(pub, Math.max(now, frame), reduced);
  const order = reveal?.order ?? pub.seats.map(s => s.id);
  useFlip(list, order.join(), reduced);
  const height = rowHeight(rect.height, pub.seats.length);
  return <aside className="island-settlers-hud-rail" style={regionStyle(rect)} aria-label="Players">
    {pub.turn.stage === 'setup' ? <SnakeStrip pub={pub} width={rect.width}/>
      : <RaceTrack pub={pub} vp={reveal?.vp ?? {}}/>}
    <ol ref={list} className="island-settlers-hud-rows">
      {order.map(id => seatOf(pub, id)).filter(s => !!s).map(seat => <li key={seat.id}>
        <SeatRow pub={pub} seat={seat} height={height} now={now} serverNowMs={serverNowMs}
          vp={reveal?.vp[seat.id] ?? seat.vp} rank={reveal?.ranks?.[seat.id] ?? null}/>
      </li>)}
    </ol>
    {!dense(pub.seats.length) && <TableCard pub={pub}/>}
  </aside>;
}
