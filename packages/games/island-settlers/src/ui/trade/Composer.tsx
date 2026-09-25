/** Players segment (EXPERIENCE §4.7): tap-to-add give/get rows, quick offers, recipients, bank shortcut. */
import { ArcadeButton } from '../../../../../party-ui/src/index';
import type { Action, Cards, Good, PrivateView, PublicView, SeatId } from '../../model';
import { EmblemChip } from '../shared/SeatChip';
import { cardTotal, cardsText, count } from '../shared/format';
import { nameOf, seatOf } from '../shared/seats';
import type { Draft } from './draft';
import {
  EMPTY_OFFER, bankFill, bankProblem, bump, offerProblem, quickOffers, ratioText, summaryText, tapSide, type Sides,
} from './logic';
import { TradeCard } from './TradeCard';

export type ComposerProps = {
  pub: PublicView; me: PrivateView; draft: Draft; patch(p: Partial<Draft>): void; goods: Good[];
  busy: boolean; send(action: Action, onOk?: () => void): void; onPosted(): void;
};

function Row({ side, d, me, goods, patch }: {
  side: keyof Sides; d: Sides; me: PrivateView; goods: Good[]; patch(p: Partial<Draft>): void;
}) {
  const give = side === 'give';
  return <div className="island-settlers-trade-row" role="group" aria-label={give ? 'You give' : 'You get'}>
    {goods.map(g => <TradeCard key={g} good={g} picked={count(d[side], g)} verb={give ? 'Give' : 'Get'}
      empty={give && !count(me.hand, g)} disabled={give && count(d.give, g) >= count(me.hand, g)}
      note={give ? `have ${count(me.hand, g)}` : undefined}
      onAdd={() => patch(tapSide(d, side, g, me.hand))}
      onRemove={() => patch({ [side]: bump(d[side], g, -1) })}/>)}
  </div>;
}

function Recipients({ pub, me, draft, patch }: Pick<ComposerProps, 'pub' | 'me' | 'draft' | 'patch'>) {
  const want = cardTotal(draft.want), to = draft.to.filter(id => me.partners.includes(id));
  const toggle = (id: SeatId) => patch({ to: to.includes(id) ? to.filter(x => x !== id) : [...to, id] });
  if (!me.partners.length) return null;
  return <div className="island-settlers-trade-to" role="group" aria-label="Send to">
    <span className="island-settlers-trade-label">To</span>
    {me.partners.length > 1 && <button type="button" className="island-settlers-pill" aria-pressed={!to.length}
      onClick={() => patch({ to: [] })}>Everyone</button>}
    {me.partners.map(id => {
      const seat = seatOf(pub, id), short = !!seat && want > 0 && seat.cards < want, name = nameOf(pub, id);
      return <button key={id} type="button" className="island-settlers-pill" data-short={short || undefined}
        aria-pressed={me.partners.length === 1 || to.includes(id)} onClick={() => toggle(id)}
        disabled={me.partners.length === 1} title={short ? `${name} can't afford it` : name}>
        <EmblemChip index={seat?.seat ?? 0} size="26px"/><span>{name}</span>
        {short && <small>can't afford</small>}
      </button>;
    })}
  </div>;
}

export function Composer(p: ComposerProps) {
  const { pub, me, draft, patch, goods, busy, send } = p;
  const parent = draft.counterTo ? pub.offers.find(o => o.id === draft.counterTo) ?? null : null;
  const state = parent ? me.offers.find(o => o.id === parent.id) : undefined;
  const problem = offerProblem(me, draft, parent ? state?.canCounter ?? false : null);
  const quick = quickOffers(me.hand, draft, goods);
  const fill = !cardTotal(draft.give) && me.can.bank
    ? bankFill(me.hand, draft.want, me.rates, pub.bank, goods) : null;
  const bankOk = me.can.bank && cardTotal(draft.give) > 0
    && !bankProblem(draft.give, draft.want, me.rates, me.hand, pub.bank);
  const clear = () => patch({ give: {}, want: {}, to: [], counterTo: null });
  const post = () => send({
    type: 'offer', turnId: pub.turn.id, give: draft.give, want: draft.want, counterTo: parent?.id ?? null,
    to: parent ? [parent.from] : draft.to.filter(id => me.partners.includes(id)),
  }, () => { clear(); p.onPosted(); });
  const bank = () => send({ type: 'bank', turnId: pub.turn.id, give: draft.give, get: draft.want }, clear);
  const offerFill = (give: Cards) => patch({ give });

  return <section className="island-settlers-composer" aria-label={parent ? 'Counter-offer' : 'New offer'}>
    {parent && <p className="island-settlers-trade-counter">
      <span>Countering {nameOf(pub, parent.from)}'s offer</span>
      <button type="button" className="kp-text-button" onClick={clear}>Cancel counter</button>
    </p>}
    <div className="island-settlers-trade-rows">
      <h3 className="island-settlers-trade-label">You give</h3>
      <Row side="give" d={draft} me={me} goods={goods} patch={patch}/>
      <h3 className="island-settlers-trade-label">You get</h3>
      <Row side="want" d={draft} me={me} goods={goods} patch={patch}/>
    </div>
    <div className="island-settlers-trade-side">
      <p className="island-settlers-trade-summary" aria-live="polite">
        {cardTotal(draft.give) + cardTotal(draft.want) ? summaryText(draft) : EMPTY_OFFER}
      </p>
      {(quick.length > 0 || fill) && <div className="island-settlers-trade-quick" role="group"
        aria-label="Quick offers">
        {quick.map(give => <button key={cardsText(give)} type="button" className="island-settlers-pill"
          onClick={() => offerFill(give)}>{cardsText(give)} for {cardsText(draft.want)}</button>)}
        {fill && <button type="button" className="island-settlers-pill" data-bank onClick={() => offerFill(fill)}>
          Bank: {cardsText(fill)}</button>}
      </div>}
      {!parent && <Recipients pub={pub} me={me} draft={draft} patch={patch}/>}
      <div className="island-settlers-trade-actions">
        <ArcadeButton tone={parent ? 'grape' : 'sky'} size="lg" disabled={busy || !!problem} onClick={post}>
          {parent ? 'Send counter' : 'Offer'}
        </ArcadeButton>
        <ArcadeButton tone="ghost" disabled={busy || !cardTotal(draft.give) && !cardTotal(draft.want)}
          onClick={clear}>Clear</ArcadeButton>
        {bankOk && <ArcadeButton tone="lime" size="lg" disabled={busy} onClick={bank}>
          Trade with bank ({ratioText(draft.give, me.rates)})</ArcadeButton>}
      </div>
      {problem && problem !== EMPTY_OFFER && <p className="island-settlers-trade-why">{problem}</p>}
      {!parent && !problem && me.partners[0] === pub.turn.active && me.partners.length === 1 &&
        <p className="island-settlers-trade-why">
          Trades go through {nameOf(pub, pub.turn.active)}, whose turn it is.</p>}
    </div>
  </section>;
}
