import type { CSSProperties } from 'react';
import type { Hand, Tile } from './model';
import type { Good } from './expansion-model';
import { GOODS, GOOD_META, TERRAIN_META, count, handTotal } from './presentation';

/** Small original geometric glyphs; the same paths decorate the phone map. */
export function TerrainIcon({ terrain, size = 20, className = '' }: { terrain: Tile['terrain'] | Good; size?: number; className?: string }) {
  const glyph = (TERRAIN_META as Record<string, { glyph: string } | undefined>)[terrain]?.glyph ?? GOOD_META[terrain as Good].glyph;
  return <svg className={`is-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={glyph} fill="currentColor"/></svg>;
}
export function GoodChip({ good, amount, muted = false }: { good: Good; amount?: number; muted?: boolean }) {
  const meta = GOOD_META[good];
  return <span className="is-chip" data-resource={good} data-muted={muted || undefined} style={{ '--chip': meta.color, '--chip-deep': meta.deep } as CSSProperties} aria-label={`${amount ?? ''} ${meta.label}`.trim()}><TerrainIcon terrain={good} size={16}/>{amount !== undefined && <b className="kp-numeral">{amount}</b>}</span>;
}
/** Chips for a hand or a cost. `zeros` lists every good in `goods`, which lets private hands show empty commodity slots. */
export function HandChips({ hand, zeros = false, goods, className = '' }: { hand: Hand; zeros?: boolean; goods?: readonly Good[]; className?: string }) {
  const shown = (goods ?? GOODS).filter(good => zeros || count(hand, good) > 0);
  return <span className={`is-chips ${className}`}>{shown.length ? shown.map(good => <GoodChip key={good} good={good} amount={count(hand, good)} muted={count(hand, good) === 0}/>) : <span className="is-chip is-chip-empty">nothing</span>}{zeros && <small className="is-chips-total">{handTotal(hand)} cards</small>}</span>;
}
export function Die({ value, size = 44 }: { value: number; size?: number }) {
  const spots: Record<number, [number, number][]> = { 1: [[12, 12]], 2: [[7, 7], [17, 17]], 3: [[7, 7], [12, 12], [17, 17]], 4: [[7, 7], [17, 7], [7, 17], [17, 17]], 5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]], 6: [[7, 6], [17, 6], [7, 12], [17, 12], [7, 18], [17, 18]] };
  return <svg className="is-die" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`Die showing ${value}`}><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#fff6e5" stroke="#05071a" strokeWidth="1.6"/>{(spots[value] ?? []).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.1" fill="#05071a"/>)}</svg>;
}
