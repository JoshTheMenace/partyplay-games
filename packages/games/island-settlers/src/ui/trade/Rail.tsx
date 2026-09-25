/**
 * TV trade rail (EXPERIENCE §3.4 B): offer cards with per-seat response chips, nested counters, expiry bars,
 * CPU decline notes, one-line overflow rows and the lime "Traded with Bo" flash. Sizes are in stage u.
 */
import { useRef, type CSSProperties } from 'react';
import type { Offer, OfferResponse, PublicView } from '../../model';
import { SeatChip } from '../shared/SeatChip';
import { nameOf, seatLabel } from '../shared/seats';
import { useNow } from './draft';
import {
  COMPACT_ROWS, RESPONSE_TEXT, accepters, answerers, audienceText, expiryShare, fullCount, railOrder, rowText,
} from './logic';
import { GoodTokens, TradeArrow } from './TradeCard';

const U = (n: number) => `calc(${n} * var(--u, 1px))`;
const FLASH_MS = 1200, COLLAPSE_MS = 240;
const TIMING = { '--flash': `${FLASH_MS}ms`, '--collapse': `${COLLAPSE_MS}ms` } as CSSProperties;
/** Badge glyphs (24×24 paths) so the state never depends on colour alone. */
const MARK: Partial<Record<OfferResponse, string>> = {
  accept: 'M9.5 16.2 5.3 12l-2.1 2.1 6.3 6.3L21 8.9l-2.1-2.1z',
  counter: 'M7 7h10.2l-2.6-2.6L16 3l5 5-5 5-1.4-1.4 2.6-2.6H7zm10 10H6.8l2.6 2.6L8 21l-5-5 5-5 1.4 1.4L6.8 15H17z',
};

/** One seat's answer: its emblem chip wrapped in the state look (dashed, lime ring, struck, grape ring). */
export function ResponseChip({ pub, seat, state }: { pub: PublicView; seat: string; state: OfferResponse }) {
  const label = `${seatLabel(pub, seat)}: ${RESPONSE_TEXT[state].toLowerCase()}`;
  return <span className="island-settlers-resp" data-state={state} role="img" aria-label={label} title={label}>
    <SeatChip pub={pub} seat={seat} size={U(30)}/>
    {MARK[state] && <svg viewBox="0 0 24 24" aria-hidden="true"><path d={MARK[state]}/></svg>}
  </span>;
}

/** A full offer card. done: the partner's name while the completed-trade flash plays. */
export function OfferCard({ pub, offer, now, done }: {
  pub: PublicView; offer: Offer; now: number; done?: string;
}) {
  const share = done ? null : expiryShare(offer, now);
  const chips = answerers(offer).filter(id => offer.responses[id] !== 'unable');
  const notes = chips.filter(id => offer.reasons[id] && offer.responses[id] === 'decline').slice(0, 2);
  return <article className="island-settlers-offer" data-counter={offer.counterTo ? true : undefined}
    data-done={done ? true : undefined} style={TIMING}>
    <header>
      <SeatChip pub={pub} seat={offer.from} size={U(32)}/>
      <b>{nameOf(pub, offer.from)}</b>
      {offer.counterTo ? <em className="island-settlers-tag">counter</em> : <span>{audienceText(pub, offer)}</span>}
    </header>
    <div className="island-settlers-offer-body">
      <GoodTokens cards={offer.give}/><TradeArrow/><GoodTokens cards={offer.want}/>
    </div>
    {done ? <p className="island-settlers-offer-done" role="status">Traded with {done}</p>
      : <footer>{chips.map(id =>
        <ResponseChip key={id} pub={pub} seat={id} state={offer.responses[id]}/>)}</footer>}
    {!done && notes.map(id => <p key={id} className="island-settlers-offer-note">
      {nameOf(pub, id)}: {offer.reasons[id]}</p>)}
    {share !== null && <i className="island-settlers-expiry" style={{ '--left': share } as CSSProperties}/>}
  </article>;
}

type Done = { offer: Offer; partner: string };

/**
 * Slot B of the TV left rail. Full cards first, the rest as one-line rows; nothing auto-pages.
 * height: the slot height in u (from layout.regions), so a crowded table trades cards for rows.
 * Returns null with no offers so the slot is not drawn.
 */
export function OfferRail({ pub, serverNowMs, height }: {
  pub: PublicView; serverNowMs(): number; height?: number;
}) {
  const now = useNow(serverNowMs), seen = useRef(new Map<string, Offer>());
  const live = new Set(pub.offers.map(o => o.id));
  const done = pub.events.flatMap((e): Done[] => {
    const offer = e.kind === 'trade' && !live.has(e.offer) && now - e.at < FLASH_MS + COLLAPSE_MS
      ? seen.current.get(e.offer) : undefined;
    if (!offer || e.kind !== 'trade') return [];
    return [{ offer, partner: nameOf(pub, e.seat === offer.from ? e.partner : e.seat) }];
  });
  pub.offers.forEach(o => seen.current.set(o.id, o));
  const list = railOrder(pub.offers);
  const full = Math.max(0, fullCount(list.length + done.length, height) - done.length);
  if (!list.length && !done.length) return null;
  return <section className="island-settlers-rail" aria-label="Open trade offers">
    {done.map(d => <OfferCard key={`done-${d.offer.id}`} pub={pub} offer={d.offer} now={now} done={d.partner}/>)}
    {list.slice(0, full).map(o => <OfferCard key={o.id} pub={pub} offer={o} now={now}/>)}
    {list.length > full && <ul className="island-settlers-offer-rows"
      data-compact={list.length - full > COMPACT_ROWS || undefined}>
      {list.slice(full).map(o => <OfferRow key={o.id} pub={pub} offer={o}/>)}
    </ul>}
  </section>;
}

/** Overflow row: chip, name, give → get tokens and the accept count; the full sentence is its label. */
function OfferRow({ pub, offer }: { pub: PublicView; offer: Offer }) {
  const n = accepters(offer).length;
  return <li data-counter={offer.counterTo ? true : undefined} aria-label={rowText(pub, offer)}>
    {offer.counterTo && <i className="island-settlers-offer-mark" aria-hidden="true">⇄</i>}
    <SeatChip pub={pub} seat={offer.from} size={U(22)}/><b>{nameOf(pub, offer.from)}</b>
    <span className="island-settlers-offer-mini" aria-hidden="true">
      <GoodTokens cards={offer.give}/><TradeArrow/><GoodTokens cards={offer.want}/>
      {n > 0 && <em>{n} ✓</em>}
    </span>
  </li>;
}
