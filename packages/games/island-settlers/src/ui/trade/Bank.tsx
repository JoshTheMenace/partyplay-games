/** Bank segment (EXPERIENCE §4.7): give cards fill whole lots at your best rate; Get taps add more lots. */
import { ArcadeButton } from '../../../../../party-ui/src/index';
import type { Good } from '../../model';
import { cardTotal, cardsText, count } from '../shared/format';
import type { ComposerProps } from './Composer';
import { bankProblem, bump, lotNeedText, rateOf, tapBankGet, tapBankGive } from './logic';
import { TradeCard } from './TradeCard';

export function Bank({ pub, me, draft, patch, goods, busy, send }: Omit<ComposerProps, 'onPosted'>) {
  const { bankGive: give, bankGet: get } = draft, rates = me.rates, bank = pub.bank;
  const afford = goods.some(g => count(me.hand, g) >= rateOf(rates, g));
  const problem = !me.can.bank ? me.why.bank?.text ?? "You can't trade with the bank right now"
    : !afford && !cardTotal(give) ? lotNeedText(rates, goods) : bankProblem(give, get, rates, me.hand, bank);
  const clear = () => patch({ bankGive: {}, bankGet: {} });
  const trade = () => send({ type: 'bank', turnId: pub.turn.id, give, get }, clear);
  const removeLot = (g: Good) => patch({ bankGive: bump(give, g, -rateOf(rates, g)) });

  return <section className="island-settlers-composer" aria-label="Trade with the bank">
    <div className="island-settlers-trade-rows">
      <h3 className="island-settlers-trade-label">Give to the bank</h3>
      <div className="island-settlers-trade-row" role="group" aria-label="Give to the bank">
        {goods.map(g => <TradeCard key={g} good={g} picked={count(give, g)} verb="Give"
          badge={`${rateOf(rates, g)}:1`} note={`have ${count(me.hand, g)}`}
          empty={count(me.hand, g) < rateOf(rates, g)}
          disabled={!me.can.bank || count(me.hand, g) < count(give, g) + rateOf(rates, g)}
          onAdd={() => patch(tapBankGive(draft, g, me.hand, rates))} onRemove={() => removeLot(g)}/>)}
      </div>
      <h3 className="island-settlers-trade-label">Get from the bank</h3>
      <div className="island-settlers-trade-row" role="group" aria-label="Get from the bank">
        {goods.map(g => <TradeCard key={g} good={g} picked={count(get, g)} verb="Get"
          note={`bank ${count(bank, g)}`} empty={!count(bank, g)}
          disabled={!me.can.bank || !afford || count(bank, g) <= count(get, g) || count(give, g) > 0}
          onAdd={() => patch(tapBankGet(draft, g, me.hand, rates, bank, goods))}
          onRemove={() => patch({ bankGet: bump(get, g, -1) })}/>)}
      </div>
    </div>
    <div className="island-settlers-trade-side">
      <div className="island-settlers-trade-actions">
        <ArcadeButton tone="lime" size="lg" disabled={busy || !!problem} onClick={trade}>
          {problem || !cardTotal(get) ? 'Trade with the bank' : `Trade ${cardsText(give)} for ${cardsText(get)}`}
        </ArcadeButton>
        <ArcadeButton tone="ghost" disabled={busy || !cardTotal(give) && !cardTotal(get)} onClick={clear}>
          Clear</ArcadeButton>
      </div>
      {problem && <p className="island-settlers-trade-why">{problem}</p>}
    </div>
  </section>;
}
