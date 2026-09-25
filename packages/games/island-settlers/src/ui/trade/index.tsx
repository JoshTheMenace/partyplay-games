/**
 * Trade UI (EXPERIENCE §4.7 and the "Responding to an offer" row of §4.2).
 * - TradePanel: the phone Trade tab and the seated host's dock sheet (variant 'dock').
 * - OfferDuty: an incoming offer as a duty card on any phone screen; Counter prefills the Trade tab.
 * - OfferRail / OfferCard: the TV left-rail slot B (§3.4), sized in stage u.
 */
import { useEffect, useRef } from 'react';
import { StatusNotice } from '../../../../../party-ui/src/index';
import type { GameViewProps } from '../../../../../party-ui/src/index';
import type { Action, Offer, PrivateView, PublicView } from '../../model';
import { Bank } from './Bank';
import { Composer } from './Composer';
import { useDraft, useNow, useSend, writeDraft, type DraftScope } from './draft';
import { counterDraft, myOffers, offersToMe, tradeGoods } from './logic';
import { IncomingOffer, MyOffer } from './Offers';
import './trade.css';

export { OfferCard, OfferRail, ResponseChip } from './Rail';
export { counterDraft, waitingOnMe } from './logic';

type ViewProps = GameViewProps<null, Action, PublicView, PrivateView>;
export type TradePanelProps = ViewProps & { variant?: 'phone' | 'dock' };

const scopeOf = (p: ViewProps): DraftScope =>
  ({ roomId: p.roomId, roundId: p.roundId, playerId: p.playerId, turnId: p.publicView.turn.id });

export function TradePanel(props: TradePanelProps) {
  return props.privateView ? <Trade {...props} me={props.privateView}/> : null;
}

function Trade(props: TradePanelProps & { me: PrivateView }) {
  const { publicView: pub, me, variant = 'phone' } = props;
  const [draft, patch] = useDraft(scopeOf(props)), { busy, error, send } = useSend(props.sendAction);
  const now = useNow(props.serverNowMs, 500), goods = tradeGoods(pub);
  const pinned = useRef<HTMLElement>(null), top = useRef<HTMLDivElement>(null), scroll = useRef(false);
  const mine = myOffers(pub, me.seat), incoming = offersToMe(pub, me.seat);
  const players = me.can.propose || !!draft.counterTo;
  const seg = !players ? 'bank' : !me.can.bank ? 'players' : draft.seg ?? 'players';
  const none = !players && !me.can.bank;
  const blocked = [...new Set([!players && (me.why.propose?.text ?? "You can't trade with players right now"),
    none && me.why.bank?.text].filter((t): t is string => !!t))];
  useEffect(() => {
    if (!scroll.current || !pinned.current) return;
    scroll.current = false;
    pinned.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [mine[0]?.id]);
  const edit = (offer: Offer) => {
    patch({ seg: 'players', give: offer.give, want: offer.want, counterTo: offer.counterTo,
      to: offer.broadcast ? [] : offer.to });
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const common = { pub, me, now, busy, send };
  const composer = { pub, me, draft, patch, goods, busy, send, onPosted: () => { scroll.current = true; } };
  const pins = mine.map((o, i) =>
    <MyOffer key={o.id} ref={i ? undefined : pinned} {...common} offer={o} onEdit={edit}/>);
  const counter = (offer: Offer) => {
    patch(counterDraft(offer, me.hand));
    top.current?.scrollIntoView({ block: 'start' });
  };
  const offers = incoming.length > 0 && <section className="island-settlers-trade-incoming"
    aria-label="Offers for you">
    <h3 className="island-settlers-trade-label">Offers for you · {incoming.length}</h3>
    {incoming.map(o => <IncomingOffer key={o.id} {...common} offer={o}
      onCounter={counter}/>)}
  </section>;

  return <div className="island-settlers-trade" data-variant={variant} ref={top}>
    {!none && <div className="island-settlers-segment" role="group" aria-label="Trade with">
      <button type="button" aria-pressed={seg === 'players'} disabled={!players}
        onClick={() => patch({ seg: 'players' })}>Players</button>
      <button type="button" aria-pressed={seg === 'bank'} disabled={!me.can.bank}
        onClick={() => patch({ seg: 'bank' })}>Bank</button>
    </div>}
    {blocked.length > 0 && <p className="island-settlers-trade-why" data-block>{blocked.join('. ')}</p>}
    {variant === 'phone' && pins}
    {!none && (seg === 'bank' ? <Bank {...composer}/> : <Composer {...composer}/>)}
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    {variant === 'phone' ? offers : <div className="island-settlers-trade-offers">
      {pins}{offers}{!mine.length && !incoming.length && <p className="island-settlers-trade-why">
        Your offer and offers for you show here.</p>}
    </div>}
  </div>;
}

/** An incoming offer as a phone duty card. onOpenTrade: switch to the Trade tab (Counter uses it). */
export function OfferDuty(props: ViewProps & { offer: Offer; onOpenTrade(): void }) {
  const { publicView: pub, privateView: me } = props, { busy, error, send } = useSend(props.sendAction);
  const now = useNow(props.serverNowMs, 500);
  if (!me) return null;
  const counter = (offer: Offer) => {
    writeDraft(scopeOf(props), counterDraft(offer, me.hand));
    props.onOpenTrade();
  };
  return <>
    <IncomingOffer pub={pub} me={me} offer={props.offer} now={now} busy={busy} send={send} compact
      onCounter={counter}/>
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
  </>;
}
