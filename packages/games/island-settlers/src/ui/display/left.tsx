import type { PublicView } from '../../model';
import { regionStyle, type Rect } from '../shared/layout';
import { SeatChip } from '../shared/SeatChip';
import { nameOf } from '../shared/seats';
import { eventSeat, tickerEvents } from './logic';
import { OfferRail } from '../trade/Rail';
import '../trade/trade.css';
import { HudPanel } from './widgets';
import './left.css';

const u = (n: number) => `calc(${n} * var(--u))`;

/**
 * Slot C: the three newest public events, newest on top, older lines fading (EXPERIENCE §3.4). A roll reads
 * "Ana rolled 8" since the production strip carries the payout; other kinds use the server's text.
 */
function Ticker({ pub }: { pub: PublicView }) {
  const lines = tickerEvents(pub.events);
  if (!lines.length) return null;
  return <ol className="island-settlers-hud-ticker island-settlers-panel" aria-label="Latest events">
    {lines.map(e => {
      const seat = eventSeat(e);
      const text = e.kind === 'roll' && e.seat ? `${nameOf(pub, e.seat)} rolled ${e.total}` : e.text;
      return <li key={e.id}>{seat && <SeatChip pub={pub} seat={seat} size={u(18)}/>}<span>{text}</span></li>;
    })}
  </ol>;
}

/** Height in u left for slot B: the rail minus the ticker and about 100u per module widget. */
const offerRoom = (pub: PublicView, rect: Rect) => rect.height - 140 - 100 * pub.hud.length;

/** Left rail: A module widgets, B offers (WP-trade-ui's OfferRail), C ticker. Empty slots are not drawn. */
export function LeftRail({ pub, rect, serverNowMs }: { pub: PublicView; rect: Rect; serverNowMs(): number }) {
  return <aside className="island-settlers-hud-left" style={regionStyle(rect)} aria-label="Table news">
    <HudPanel pub={pub}/>
    <OfferRail pub={pub} serverNowMs={serverNowMs} height={offerRoom(pub, rect)}/>
    <Ticker pub={pub}/>
  </aside>;
}
