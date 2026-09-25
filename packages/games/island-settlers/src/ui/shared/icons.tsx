import type { CSSProperties } from 'react';
import type { Cards, Good } from '../../model';
import { cardsText, count, goodText, goodsIn } from './format';
import { ICON_ALIASES, ICON_PATHS, NONZERO } from './icon-paths';
import { GOOD_META } from './labels';

/** Picture for any icon key; unknown keys (future module badges) draw a dot. Decorative unless labelled. */
export function Icon({ name, size = 20, label, className = '' }: {
  name: string; size?: number | string; label?: string; className?: string;
}) {
  const key = ICON_PATHS[name] ? name : ICON_ALIASES[name] ?? '';
  const d = ICON_PATHS[key] ?? 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z';
  return <svg className={`island-settlers-icon ${className}`} width={size} height={size} viewBox="0 0 24 24"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <path d={d} fill="currentColor" fillRule={NONZERO.has(key) ? 'nonzero' : 'evenodd'}/>
  </svg>;
}

/** A good in its card colour with an optional count: cost chips, payouts, trade summaries. */
export function GoodChip({ good, amount }: { good: Good; amount?: number }) {
  const meta = GOOD_META[good];
  return <span className="island-settlers-good" data-good={good}
    style={{ '--good': meta.color, '--good-deep': meta.deep } as CSSProperties}
    role="img" aria-label={amount === undefined ? meta.label : goodText(amount, good)}>
    <Icon name={good} size="1.15em"/>{amount !== undefined && <b className="kp-numeral">{amount}</b>}
  </span>;
}

/** Chips for a card set in GOODS order; empty shows "nothing". */
export function CardChips({ cards }: { cards: Cards }) {
  const goods = goodsIn(cards);
  return <span className="island-settlers-goods" aria-label={cardsText(cards)}>
    {goods.length ? goods.map(g => <GoodChip key={g} good={g} amount={count(cards, g)}/>) : 'nothing'}
  </span>;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[12, 12]], 2: [[7, 7], [17, 17]], 3: [[7, 7], [12, 12], [17, 17]], 4: [[7, 7], [17, 7], [7, 17], [17, 17]],
  5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]], 6: [[7, 6], [17, 6], [7, 12], [17, 12], [7, 18], [17, 18]],
};

/** A cream die face. */
export function Die({ value, size = 44 }: { value: number; size?: number | string }) {
  return <svg className="island-settlers-die" width={size} height={size} viewBox="0 0 24 24" role="img"
    aria-label={`Die showing ${value}`}>
    <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#fff6e5" stroke="#05071a" strokeWidth="1.6"/>
    {(PIPS[value] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.1" fill="#05071a"/>)}
  </svg>;
}
