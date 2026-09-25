import type { CSSProperties } from 'react';
import type { Cards, Good } from '../../model';
import { Icon } from '../shared/icons';
import { GOOD_META } from '../shared/labels';

export const goodStyle = (good: Good) =>
  ({ '--good': GOOD_META[good].color, '--good-deep': GOOD_META[good].deep }) as CSSProperties;

/**
 * A tappable resource card: tap adds one, the "−" chip removes one. picked shows as a sun bubble;
 * note is the small line ("have 5", "bank 12"); badge is the top-left rate ("3:1").
 */
export function TradeCard({ good, picked, onAdd, onRemove, disabled, note, badge, empty, verb }: {
  good: Good; picked: number; onAdd(): void; onRemove(): void;
  disabled?: boolean; note?: string; badge?: string; empty?: boolean; verb: string;
}) {
  const label = GOOD_META[good].label;
  return <div className="island-settlers-tcard" style={goodStyle(good)} data-picked={picked > 0 || undefined}
    data-empty={empty || undefined}>
    <button type="button" className="island-settlers-tcard-face" onClick={onAdd} disabled={disabled}
      aria-label={`${verb} ${label}${note ? `, ${note}` : ''}${picked ? `, ${picked} picked` : ''}`}>
      {badge && <span className="island-settlers-tcard-rate">{badge}</span>}
      <Icon name={good} size="var(--tcard-icon)"/>
      <span className="island-settlers-tcard-name">{label}</span>
      {note && <small>{note}</small>}
      {picked > 0 && <b className="island-settlers-tcard-pick kp-numeral">{picked}</b>}
    </button>
    {picked > 0 && <button type="button" className="island-settlers-tcard-minus" onClick={onRemove}
      aria-label={`One less ${label.toLowerCase()}`}><span aria-hidden="true">−</span></button>}
  </div>;
}

/** A good token with its count, for offer bodies: an icon tile then "×2". */
export function GoodTokens({ cards, className = '' }: { cards: Cards; className?: string }) {
  const goods = (Object.keys(GOOD_META) as Good[]).filter(g => (cards[g] ?? 0) > 0);
  return <span className={`island-settlers-tokens ${className}`}>
    {goods.map(g => <span key={g} className="island-settlers-token" style={goodStyle(g)}
      role="img" aria-label={`${cards[g]} ${GOOD_META[g].label.toLowerCase()}`}>
      <i><Icon name={g} size="72%"/></i>{(cards[g] ?? 0) > 1 && <b className="kp-numeral">×{cards[g]}</b>}
    </span>)}
  </span>;
}

/** The arrow between the give and get sides. */
export const TradeArrow = () => <svg className="island-settlers-trade-arrow" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 10h13.2l-4-4 2.1-2.1L22 11.6l-7.7 7.7-2.1-2.1 4-4H3z" fill="currentColor"/>
</svg>;
