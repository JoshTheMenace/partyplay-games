/**
 * Cards tab (EXPERIENCE §4.2 Dev cards): Buy at the top, 2-column card tiles with Play or the reason, Year of
 * Plenty and Monopoly pick grids, C&K progress cards and card-type module commands.
 */
import { useState } from 'react';
import { ArcadeButton } from '../../../../../party-ui/src/index';
import { RESOURCES, type Cards, type CardsField, type DevCard, type Resource } from '../../model';
import { cardTotal, count, goodsIn } from '../shared/format';
import { DEV_META, hasDevCards, titleCase, TRACK_META } from '../shared/labels';
import { BuyDevSheet, CARD_GROUPS, CommandRows, CostRow } from './Build';
import { CardPick } from './CardPick';
import { useCtl, useDraft } from './context';
import { buildStatus, usable } from './logic';
import { GoodCard } from './Hand';

const reason = (d: DevCard) => d.why?.text
  ?? (d.kind === 'victory' ? 'Victory point: counts at the end (hidden)' : 'Not playable now');

/** Year of Plenty (pick 2 from the bank) or Monopoly (pick 1 resource). */
function PlayPick({ card, onBack }: { card: DevCard; onBack(): void }) {
  const { pub, act, busy } = useCtl();
  const [cards, setCards] = useDraft<Cards>(`play:${card.id}`, {});
  const plenty = card.kind === 'plenty', stock = RESOURCES.reduce((n, g) => n + count(pub.bank, g), 0);
  const field: CardsField = {
    kind: 'cards', key: 'goods', label: 'Pick 2 from the bank', source: 'bank', allowed: [...RESOURCES],
    available: pub.bank, min: Math.min(2, stock), max: 2,
  };
  const goods = goodsIn(cards).flatMap(g => Array<Resource>(count(cards, g)).fill(g as Resource));
  const play = async (list: Resource[]) => {
    if (await act({ type: 'play-dev', card: card.id, goods: list })) { setCards({}); onBack(); }
  };
  return <div className="island-settlers-screen">
    <header className="island-settlers-command-head"><h3>{DEV_META[card.kind].label}</h3>
      <button type="button" className="island-settlers-link" onClick={onBack}>Back</button></header>
    <p className="island-settlers-note">{DEV_META[card.kind].blurb}</p>
    {plenty ? <>
      <CardPick field={field} value={cards} onChange={setCards} verb="Pick"/>
      <ArcadeButton tone="lime" size="lg" disabled={busy || cardTotal(cards) !== field.min}
        onClick={() => play(goods)}>Take {goods.length || 2} from the bank</ArcadeButton>
    </> : <div className="island-settlers-grid" role="group" aria-label="Pick a resource">
      {RESOURCES.map(g => <GoodCard key={g} good={g} n={0} size="grid" disabled={busy} onClick={() => play([g])}
        label={`Take everyone's ${g}`} note="Take all"/>)}
    </div>}
  </div>;
}

export function CardsTab() {
  const { pub, me, act, busy, screen, go } = useCtl();
  const [buying, setBuying] = useState(false);
  const buy = me.build.find(o => o.piece === 'development');
  const progress = me.ext['cities-knights']?.progress ?? [];
  const open = me.dev.find(d => d.id === screen.card);
  if (open) return <PlayPick card={open} onBack={() => go({ card: null })}/>;
  const play = (d: DevCard) => (d.kind === 'plenty' || d.kind === 'monopoly' ? go({ card: d.id })
    : void act({ type: 'play-dev', card: d.id, goods: [] }).then(ok => ok && go({ tab: 'now' })));
  return <div className="island-settlers-screen">
    {buy && <div className="island-settlers-buy">
      <span><b>Buy dev card</b><CostRow cost={buy.cost}/></span>
      <ArcadeButton tone="lime" size="sm" disabled={busy || !usable(buy)} onClick={() => setBuying(true)}>
        {usable(buy) ? 'Buy' : buildStatus(buy, pub.devDeck)}</ArcadeButton>
    </div>}
    {me.dev.length ? <ul className="island-settlers-devs">{me.dev.map(d => <li key={d.id} data-kind={d.kind}>
      <b>{DEV_META[d.kind].label}</b>
      <small>{DEV_META[d.kind].blurb}</small>
      {d.playable ? <ArcadeButton tone="sun" size="sm" disabled={busy} onClick={() => play(d)}>Play</ArcadeButton>
        : <em>{reason(d)}</em>}
    </li>)}</ul> : !progress.length && <p className="island-settlers-note">
      {hasDevCards(pub) ? 'No dev cards yet.' : 'No cards to play yet.'}</p>}
    {progress.length > 0 && <ul className="island-settlers-devs" aria-label="Progress cards">
      {progress.map(c => <li key={c.id} style={{ borderColor: TRACK_META[c.track].color }}>
        <b>{titleCase(c.kind)}</b><small>{TRACK_META[c.track].label} progress</small>
        {!c.playable && c.why && <em>{c.why.text}</em>}
      </li>)}</ul>}
    <ul className="island-settlers-rows">
      <CommandRows commands={me.commands.filter(c => CARD_GROUPS.has(c.group))}/>
    </ul>
    {buying && <BuyDevSheet onClose={() => setBuying(false)}/>}
  </div>;
}
