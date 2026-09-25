/**
 * Command/field builders and `validateAnswer` (port and extension of legacy `validateCommand`):
 * every pick must be an offered option, dependent `then` fields are walked, and card fields are
 * checked against `available`, `allowed`, `min` and `max`.
 */
import {
  GOODS, type CardPicks, type Cards, type CardsField, type Choice, type Command, type Field, type Good,
  type PickField, type Picks,
} from '../model';
import { has, toCards, total } from './cards';
import type { Answer } from './modules/registry';
import { need } from './need';

export const choice = (value: string, label: string, detail?: string, then?: Field[]): Choice =>
  // oxlint-disable-next-line unicorn/no-thenable -- `then` is the model's dependent-fields key
  ({ value, label, ...(detail ? { detail } : {}), ...(then?.length ? { then } : {}) });

export const pickField = (
  key: string, label: string, options: Choice[], target?: PickField['target'], optional?: boolean,
): PickField => ({
  kind: 'pick', key, label, options, ...(target ? { target } : {}), ...(optional ? { optional: true } : {}),
});

export const cardsField = (
  key: string, label: string, source: CardsField['source'], available: Cards, min: number, max = min,
  allowed: readonly Good[] = GOODS,
): CardsField => ({
  kind: 'cards', key, label, source, allowed: [...allowed], available: toCards(available), min, max,
});

export const command = (
  c: Omit<Command, 'cost' | 'hint' | 'fields'> & Partial<Pick<Command, 'cost' | 'hint' | 'fields'>>,
): Command => ({ cost: null, hint: 0.5, fields: [], ...c });

const range = (f: CardsField) => (f.min === f.max ? `${f.min}` : `${f.min}–${f.max}`);

export function validateAnswer(c: Command, picks: Picks, cards: CardPicks): Answer {
  const fields = [...c.fields], seen = new Set<string>(), out: Answer = { picks: {}, cards: {} };
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    seen.add(f.key);
    if (f.kind === 'pick') {
      const value = picks[f.key];
      if (value === undefined) { need(f.optional, `Choose ${f.label.toLowerCase()}.`); continue; }
      const option = f.options.find(o => o.value === value);
      need(option, `Choose ${f.label.toLowerCase()} again.`);
      out.picks[f.key] = value;
      if (option.then) fields.push(...option.then);
    } else {
      const chosen = cards[f.key] ?? {}, n = total(chosen);
      const what = f.label.toLowerCase();
      need(Object.keys(chosen).every(g => f.allowed.includes(g as Good)), `Those cards cannot be used for ${what}.`);
      need(has(f.available, chosen), `You do not have those cards for ${what}.`);
      need(n >= f.min && n <= f.max, `Choose ${range(f)} cards for ${what}.`);
      out.cards[f.key] = toCards(chosen);
    }
  }
  need([...Object.keys(picks), ...Object.keys(cards)].every(k => seen.has(k)), 'Unknown choice.');
  return out;
}
