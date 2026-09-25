/**
 * Tap-to-pick card grid for any cards field (discard, gold, Year of Plenty, module costs): tap a card to move
 * one into the pile below it, tap a pile chip to take it back. No +/- steppers (EXPERIENCE §4.2 Discard).
 */
import type { Cards, CardsField } from '../../model';
import { cardTotal, count, goodsIn, goodText, tapText } from '../shared/format';
import { GoodChip } from '../shared/icons';
import { useCtl } from './context';
import { GoodCard } from './Hand';
import { counterText } from './logic';

export function CardPick({ field, value, onChange, verb }: {
  field: CardsField; value: Cards; onChange(next: Cards): void; verb: string;
}) {
  const n = cardTotal(value), bank = field.source === 'bank', { docked } = useCtl();
  const add = (g: CardsField['allowed'][number]) => onChange({ ...value, [g]: count(value, g) + 1 });
  const drop = (g: CardsField['allowed'][number]) => onChange({ ...value, [g]: count(value, g) - 1 });
  return <section className="island-settlers-pick" data-source={field.source} aria-label={field.label}>
    <p className="island-settlers-counter kp-numeral" aria-live="polite">{counterText(n, field, verb)}</p>
    <div className="island-settlers-grid">
      {field.allowed.map(g => {
        const left = count(field.available, g) - count(value, g);
        return <GoodCard key={g} good={g} n={left} size="grid" note={bank ? 'in bank' : undefined}
          disabled={left <= 0 || n >= field.max} onClick={() => add(g)}
          label={`${verb} ${g}: ${left} ${bank ? 'in the bank' : 'left'}`}/>;
      })}
    </div>
    <div className="island-settlers-pile" aria-label="Chosen">
      {n ? goodsIn(value).map(g => <button key={g} type="button" onClick={() => drop(g)}
        aria-label={`Put back one ${g} (${goodText(count(value, g), g)} chosen)`}>
        <GoodChip good={g} amount={count(value, g)}/></button>)
        : <span>{tapText(bank ? 'Tap a card to take it' : `Tap a card to ${verb.toLowerCase()} it`, docked)}
        </span>}
    </div>
  </section>;
}
