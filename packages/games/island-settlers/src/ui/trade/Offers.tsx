/** Phone offer cards: the pinned "Your offer" and the incoming offer with Accept / Decline / Counter. */
import { forwardRef, type CSSProperties } from 'react';
import { ArcadeButton } from '../../../../../party-ui/src/index';
import type { Action, Offer, OfferResponse, PrivateView, PublicView } from '../../model';
import { EmblemChip } from '../shared/SeatChip';
import { nameOf, seatOf } from '../shared/seats';
import { RESPONSE_TEXT, answerers, audienceText, expiryShare, offerLine, tallyText } from './logic';
import { ResponseChip } from './Rail';
import { GoodTokens, TradeArrow } from './TradeCard';

type Common = {
  pub: PublicView; me: PrivateView; offer: Offer; now: number;
  busy: boolean; send(action: Action, onOk?: () => void): void;
};

const GLYPH: Record<OfferResponse, string> =
  { pending: '', accept: '✓ ', decline: '✕ ', counter: '⇄ ', unable: '' };

function Expiry({ offer, now }: { offer: Offer; now: number }) {
  const share = expiryShare(offer, now);
  return share === null ? null
    : <i className="island-settlers-expiry" style={{ '--left': share } as CSSProperties} aria-hidden="true"/>;
}

/** give → want, each side under its label ("You give" / "You get" from the viewer's side). */
const Body = ({ offer, labels }: { offer: Offer; labels: [string, string] }) =>
  <div className="island-settlers-offer-body">
    <span><small>{labels[0]}</small><GoodTokens cards={offer.give}/></span><TradeArrow/>
    <span><small>{labels[1]}</small><GoodTokens cards={offer.want}/></span>
  </div>;

/** Your posted offer (or counter): live responses, Trade with Bo per acceptor, Edit and Withdraw. */
export const MyOffer = forwardRef<HTMLElement, Common & { onEdit(offer: Offer): void }>(function MyOffer(
  { pub, offer, now, busy, send, onEdit }, ref,
) {
  const turnId = pub.turn.id, ids = answerers(offer), choose = ids.length > 1;
  // Few recipients get a row each; a crowd gets rows for acceptors only and a chip strip for the rest.
  const rows = ids.length <= 3 ? ids : ids.filter(id => offer.responses[id] === 'accept');
  const rest = ids.filter(id => !rows.includes(id)), notes = rest.filter(id => offer.reasons[id]);
  const title = `Your ${offer.counterTo ? 'counter' : 'offer'} ${audienceText(pub, offer)}`;
  return <article ref={ref} className="island-settlers-offer-card" data-mine aria-label={title}>
    <header><b>{title}</b></header>
    <Body offer={offer} labels={['You give', 'You get']}/>
    {rows.length > 0 && <ul className="island-settlers-offer-answers">
      {rows.map(id => {
        const state = offer.responses[id], reason = offer.reasons[id];
        return <li key={id} data-state={state}>
          <EmblemChip index={seatOf(pub, id)?.seat ?? 0} size="26px"/>
          <span className="island-settlers-offer-who">{nameOf(pub, id)}
            <small>{GLYPH[state]}{!choose && state === 'pending' ? 'Deciding' : RESPONSE_TEXT[state]}
              {reason ? `: ${reason}` : ''}</small></span>
          {choose && state === 'accept' && <ArcadeButton tone="lime" size="sm" disabled={busy}
            onClick={() => send({ type: 'confirm-trade', turnId, offer: offer.id, partner: id })}>
            Trade with {nameOf(pub, id)}</ArcadeButton>}
        </li>;
      })}
    </ul>}
    {rest.length > 0 && <div className="island-settlers-offer-chips">
      {rest.map(id => <ResponseChip key={id} pub={pub} seat={id} state={offer.responses[id]}/>)}
      <small>{tallyText(offer, rest)}</small>
    </div>}
    {notes.map(id => <p key={id} className="island-settlers-trade-why">
      {nameOf(pub, id)}: {offer.reasons[id]}</p>)}
    <footer className="island-settlers-offer-buttons">
      <ArcadeButton tone="ghost" size="sm" disabled={busy} onClick={() => onEdit(offer)}>Edit</ArcadeButton>
      <ArcadeButton tone="ghost" size="sm" disabled={busy}
        onClick={() => send({ type: 'withdraw', turnId, offer: offer.id })}>Withdraw</ArcadeButton>
    </footer>
    <Expiry offer={offer} now={now}/>
  </article>;
});

/** An offer waiting on you (EXPERIENCE §4.2 "Responding to an offer"); compact is the duty-card size. */
export function IncomingOffer({ pub, me, offer, now, busy, send, onCounter, compact }: Common & {
  onCounter(offer: Offer): void; compact?: boolean;
}) {
  const turnId = pub.turn.id, mine = offer.responses[me.seat] ?? 'pending';
  const state = me.offers.find(o => o.id === offer.id), from = nameOf(pub, offer.from);
  const counterToMe = !!offer.counterTo && pub.offers.some(o => o.id === offer.counterTo && o.from === me.seat);
  const respond = (answer: 'accept' | 'decline') => send({ type: 'respond', turnId, offer: offer.id, answer });
  const waiting = mine === 'accept' && answerers(offer).length > 1;
  return <article className="island-settlers-offer-card" data-compact={compact || undefined}
    data-state={mine} aria-label={offerLine(pub, offer)}>
    <header>
      <EmblemChip index={seatOf(pub, offer.from)?.seat ?? 0} size={compact ? '28px' : '32px'}/>
      <b>{offerLine(pub, offer)}</b>
      {offer.counterTo && <em className="island-settlers-tag">{counterToMe ? 'counter to you' : 'counter'}</em>}
    </header>
    {!compact && <Body offer={offer} labels={['You get', 'You give']}/>}
    {waiting ? <div className="island-settlers-offer-buttons">
      <p className="island-settlers-offer-wait" role="status">Waiting for {from} to choose</p>
      <ArcadeButton tone="ghost" size="sm" disabled={busy} onClick={() => respond('decline')}>Cancel</ArcadeButton>
    </div> : <div className="island-settlers-offer-buttons">
      <ArcadeButton tone="lime" disabled={busy || !state?.canAccept || mine === 'accept'}
        onClick={() => respond('accept')}>{mine === 'accept' ? 'Accepted' : 'Accept'}</ArcadeButton>
      {mine !== 'decline' && <ArcadeButton tone="ghost" disabled={busy} onClick={() => respond('decline')}>
        Decline</ArcadeButton>}
      {state?.canCounter && <ArcadeButton tone="grape" disabled={busy} onClick={() => onCounter(offer)}>
        Counter</ArcadeButton>}
    </div>}
    {!state?.canAccept && state?.why && mine !== 'accept' &&
      <p className="island-settlers-trade-why">{state.why.text}</p>}
    {mine === 'decline' && state?.canAccept && <p className="island-settlers-trade-why">
      You declined. You can still accept.</p>}
    {mine === 'counter' && <p className="island-settlers-trade-why">You sent a counter-offer.</p>}
    <Expiry offer={offer} now={now}/>
  </article>;
}
