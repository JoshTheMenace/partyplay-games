/** Big resource cards (EXPERIENCE §4.6): the hand strip and the card face reused by every pick grid. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { COMMODITIES, RESOURCES, type Cards, type Good } from '../../model';
import { count, goodText, plural, signed } from '../shared/format';
import { Icon } from '../shared/icons';
import { GOOD_META, hasDevCards } from '../shared/labels';
import { useCtl } from './context';

type CardProps = {
  good: Good; n: number; ratio?: number; note?: string; bump?: { key: number; by: number };
  size?: 'hand' | 'grid' | 'commodity'; onClick?(): void; disabled?: boolean; label?: string;
};

/** One card: resource colour, ink icon, name, count bubble, optional ratio badge and change float. */
export function GoodCard(p: CardProps) {
  const { good, n, ratio, note, bump, size = 'hand', onClick, disabled, label } = p;
  const meta = GOOD_META[good];
  const style = { '--good': meta.color, '--good-deep': meta.deep } as CSSProperties;
  const body = <>
    {ratio !== undefined && ratio < 4 && <i className="island-settlers-ratio">{ratio}:1</i>}
    <Icon name={good} size="var(--is-icon)"/>
    <span className="island-settlers-card-name">{meta.label}</span>
    {note && <small className="island-settlers-card-note">{note}</small>}
    <b className="island-settlers-count kp-numeral">{n}</b>
    {bump && bump.by !== 0 && <em key={bump.key} className="island-settlers-float" aria-hidden="true">
      {signed(bump.by)}</em>}
  </>;
  const props = {
    className: 'island-settlers-card', style, 'data-good': good, 'data-size': size,
    'data-zero': n === 0 || undefined, 'data-bump': bump && bump.by !== 0 ? bump.key % 2 : undefined,
  };
  const name = label ?? `${goodText(n, good)}${ratio && ratio < 4 ? `, trades ${ratio} to 1` : ''}`;
  return onClick
    ? <button type="button" {...props} onClick={onClick} disabled={disabled} aria-label={name}>{body}</button>
    : <div {...props} role="img" aria-label={name}>{body}</div>;
}

/** Remembers the last change per good so the card can bump and float "+2" (EXPERIENCE §4.6). */
function useChanges(hand: Cards) {
  const last = useRef(hand);
  const [changes, setChanges] = useState<Partial<Record<Good, { key: number; by: number }>>>({});
  useEffect(() => {
    const before = last.current;
    last.current = hand;
    const moved = [...RESOURCES, ...COMMODITIES].filter(g => count(hand, g) !== count(before, g));
    if (!moved.length) return;
    setChanges(old => ({ ...old, ...Object.fromEntries(moved.map(g =>
      [g, { key: (old[g]?.key ?? 0) + 1, by: count(hand, g) - count(before, g) }])) }));
  }, [hand]);
  return changes;
}

export function HandStrip() {
  const { pub, me } = useCtl();
  const changes = useChanges(me.hand);
  const commodities = pub.settings.citiesKnights || COMMODITIES.some(g => count(me.hand, g) > 0);
  const resources = RESOURCES.reduce((sum, g) => sum + count(me.hand, g), 0);
  const goods = COMMODITIES.reduce((sum, g) => sum + count(me.hand, g), 0);
  const card = (g: Good, size: CardProps['size']) =>
    <GoodCard key={g} good={g} n={count(me.hand, g)} ratio={me.rates[g]} bump={changes[g]} size={size}/>;
  return <section className="island-settlers-hand" aria-label="Your hand">
    <div className="island-settlers-cards">{RESOURCES.map(g => card(g, 'hand'))}</div>
    {commodities && <div className="island-settlers-cards" data-row="commodity">
      {COMMODITIES.map(g => card(g, 'commodity'))}</div>}
    <p className="island-settlers-hand-count">
      {[plural(resources, 'resource'), commodities && plural(goods, 'commodity', 'commodities'),
        hasDevCards(pub) && plural(me.dev.length, 'dev card')].filter(Boolean).join(' · ')}
    </p>
  </section>;
}
