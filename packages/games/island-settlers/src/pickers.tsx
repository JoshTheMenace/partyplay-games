import type { CSSProperties } from 'react';
import type { Hand } from './model';
import type { Good } from './expansion-model';
import { TerrainIcon } from './icons';
import { GOOD_META, count } from './presentation';

export function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange(value: number): void }) {
  return <span className="is-stepper" role="group" aria-label={label}><button type="button" aria-label={`Fewer ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button><output className="kp-numeral">{value}</output><button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button></span>;
}
/** Exact-count goods picker for discards, gold, Year of Plenty, offers and command card specs. */
export function HandPicker({ value, limit, goods, onChange, title, hint }: { value: Hand; limit: Hand | number; goods: readonly Good[]; onChange(hand: Hand): void; title: string; hint?: string }) {
  return <div className="is-picker"><div className="is-picker-head"><strong>{title}</strong>{hint && <small>{hint}</small>}</div>{goods.map(good => { const max = typeof limit === 'number' ? limit : count(limit, good); return <div key={good} className="is-picker-row" data-resource={good} style={{ '--chip': GOOD_META[good].color, '--chip-deep': GOOD_META[good].deep } as CSSProperties}><span className="is-picker-label"><TerrainIcon terrain={good} size={18}/>{GOOD_META[good].label}{typeof limit !== 'number' && <small> · have {count(limit, good)}</small>}</span><Stepper label={GOOD_META[good].label} value={count(value, good)} max={max} onChange={next => onChange({ ...value, [good]: next })}/></div>; })}</div>;
}
export function GoodPick({ value, goods, onChange, disabledFor, label }: { value: Good | null; goods: readonly Good[]; onChange(good: Good): void; disabledFor?(good: Good): boolean; label: string }) {
  return <div className="is-resource-pick" data-count={goods.length} role="radiogroup" aria-label={label}>{goods.map(good => <button key={good} type="button" role="radio" aria-checked={value === good} disabled={disabledFor?.(good)} onClick={() => onChange(good)} style={{ '--chip': GOOD_META[good].color, '--chip-deep': GOOD_META[good].deep } as CSSProperties}><TerrainIcon terrain={good} size={20}/><span>{GOOD_META[good].label}</span></button>)}</div>;
}
/** Labelled radio list for server-provided choices; 48px rows, one selected value. */
export function ChoiceList({ options, value, onChange, label, colorOf }: { options: { value: string; label: string }[]; value: string | null; onChange(value: string): void; label: string; colorOf?(value: string): string | undefined }) {
  return <div className="is-choices" role="radiogroup" aria-label={label}>{options.map(option => { const color = colorOf?.(option.value); return <button key={option.value} type="button" role="radio" aria-checked={value === option.value} onClick={() => onChange(option.value)} style={color ? { '--seat': color } as CSSProperties : undefined}>{color && <b className="is-swatch"/>}<span>{option.label}</span></button>; })}</div>;
}
