/** Build tab (EXPERIENCE §4.2): one row per piece, ship moves and build-type module commands. */
import { useState } from 'react';
import { ArcadeButton } from '../../../../../party-ui/src/index';
import type { BuildOption, Cards, Command } from '../../model';
import { count, goodsIn, needText } from '../shared/format';
import { GoodChip, Icon } from '../shared/icons';
import { useCtl } from './context';
import { buildStatus, PURCHASE_LABEL, usable } from './logic';
import { Sheet } from './Sheet';

/** Cost chips: plain when you have enough, coral-ringed with "need 1" when you don't. */
export function CostRow({ cost, free = false }: { cost: Cards; free?: boolean }) {
  const { me } = useCtl();
  if (free) return <span className="island-settlers-cost"><b className="island-settlers-free">Free</b></span>;
  return <span className="island-settlers-cost">{goodsIn(cost).map(g => {
    const short = count(cost, g) - count(me.hand, g);
    return <span key={g} data-short={short > 0 || undefined}><GoodChip good={g} amount={count(cost, g)}/>
      {short > 0 && <small>need {short}</small>}</span>;
  })}</span>;
}

export function BuyDevSheet({ onClose }: { onClose(): void }) {
  const { me, act, busy } = useCtl();
  const option = me.build.find(o => o.piece === 'development');
  const buy = async () => { if (await act({ type: 'buy-dev' })) onClose(); };
  return <Sheet title="Buy a dev card?" onClose={onClose}>
    <p className="island-settlers-note">A random card from the deck. You can play it from your next turn.</p>
    {option && <CostRow cost={option.cost}/>}
    <div className="island-settlers-sheet-actions">
      <ArcadeButton tone="lime" size="lg" disabled={busy || !option || !usable(option)} onClick={buy}>
        Buy dev card</ArcadeButton>
      <ArcadeButton tone="ghost" onClick={onClose}>Back</ArcadeButton>
    </div>
  </Sheet>;
}

function Row({ icon, name, sub, cost, free, status, off, onClick }: {
  icon: string; name: string; sub?: string; cost: Cards | null; free?: boolean; status: string; off: boolean;
  onClick(): void;
}) {
  return <li><button type="button" className="island-settlers-row" data-off={off || undefined} disabled={off}
    onClick={onClick}>
    <Icon name={icon} size={32}/>
    <b>{name}</b>
    <span className="island-settlers-row-status">{status}</span>
    {sub && <small className="island-settlers-row-sub">{sub}</small>}
    {cost && goodsIn(cost).length > 0 && <CostRow cost={cost} free={free}/>}
  </button></li>;
}

/** Rows for server commands; the server owns legality, the phone shows cost and opens the sheet. */
export function CommandRows({ commands }: { commands: Command[] }) {
  const { me, go } = useCtl();
  return <>{commands.map(c => {
    const need = c.cost && needText(Object.fromEntries(goodsIn(c.cost).map(g =>
      [g, Math.max(0, count(c.cost!, g) - count(me.hand, g))])));
    return <Row key={c.id} icon={c.group} name={c.label} sub={c.detail} cost={c.cost} status={need || 'Open'}
      off={!!need} onClick={() => go({ command: c.id })}/>;
  })}</>;
}

export const CARD_GROUPS = new Set(['cards', 'progress']);

export function BuildMenu() {
  const { pub, me, go } = useCtl();
  const [buying, setBuying] = useState(false);
  const open = (o: BuildOption) => (o.piece === 'development' ? setBuying(true) : go({ place: o.piece }));
  const moves = me.shipMoves.length;
  return <div className="island-settlers-screen">
    <ul className="island-settlers-rows" aria-label="Build">
      {me.build.map(o => <Row key={o.piece} icon={o.piece} name={PURCHASE_LABEL[o.piece]} cost={o.cost}
        free={o.free > 0} status={buildStatus(o, pub.devDeck)} off={!usable(o)} onClick={() => open(o)}/>)}
      {moves > 0 && <Row icon="ship" name="Move a ship" cost={null} status={`${moves} can sail`} off={false}
        onClick={() => go({ place: 'move' })}/>}
      <CommandRows commands={me.commands.filter(c => !CARD_GROUPS.has(c.group))}/>
    </ul>
    {buying && <BuyDevSheet onClose={() => setBuying(false)}/>}
  </div>;
}
