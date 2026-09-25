/**
 * The Traders & Barbarians gold purse, shared by Barbarian Attack and Deliveries (one purse when both
 * are on; Deliveries owns it then). Gold is public, never counts toward the hand and cannot be stolen.
 * Spending 2 gold takes 1 resource from the bank, up to twice per opportunity; resource cards sell to
 * the bank for 1 gold at the seat's bank rate (T&B p.16, p.21). Also the small helpers
 * both modules share (action-phase check, ranked auto answers).
 */
import { RESOURCES, type Command, type ModuleId, type Resource, type SeatId } from '../../../model';
import { cardsText, toCards, total, transfer } from '../../cards';
import { cardsField, choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { role } from '../../flow';
import { need } from '../../need';
import { gained } from '../../stats';
import { seatName, type OpenPrompt, type State } from '../../state';
import { rates } from '../../trade';
import type { Answer, PromptSpec } from '../registry';

export type Purse = { gold: Record<SeatId, number>; bought: Record<SeatId, number> };

export const purseOwner = (s: State): ModuleId =>
  (s.modules.includes('deliveries') ? 'deliveries' : 'barbarian-attack');

export const purse = (s: State) => s.ext[purseOwner(s)] as Purse;
const each = (s: State, n: number) => Object.fromEntries(s.order.map(id => [id, n]));
export const emptyPurse = (s: State, start: number): Purse => ({ gold: each(s, start), bought: each(s, 0) });

export const addGold = (s: State, seat: SeatId, n: number) => { purse(s).gold[seat] += n; };

/** Action-phase commands (build, buy, upgrade): own opportunity, not after moving. */
export function mayBuild(s: State, seat: SeatId): boolean {
  const r = role(s, seat);
  return (r === 'main' || r === 'paired' || r === 'round') && !s.seats[seat].moved;
}

/**
 * End of Turn (moving locks trading): own main turn, 5–6 Player 2's paired turn (T&B 5–6 rules) or the
 * Connect window, with no accepted trade pending.
 */
export function mayMove(s: State, seat: SeatId): boolean {
  const r = role(s, seat), accepted = Object.values(s.offers).some(o => o.responses[seat] === 'accept');
  return (r === 'main' || r === 'paired' || r === 'round') && !accepted;
}

const GOLD_BUY = 'tb-gold', GOLD_SELL = 'tb-sell';
export const GOLD_IDS: ReadonlySet<string> = new Set([GOLD_BUY, GOLD_SELL]);

/** `reserve`: gold the seat should keep (Deliveries: tolls on the way to its next depot). */
export function goldCommands(s: State, seat: SeatId, module: ModuleId, reserve = 0): Command[] {
  const p = purse(s), out: Command[] = [];
  if (purseOwner(s) !== module || !mayBuild(s, seat)) return out;
  const bank = toCards(Object.fromEntries(RESOURCES.map(g => [g, s.bank[g]])));
  if (p.gold[seat] >= 2 && p.bought[seat] < 2 && total(bank)) {
    out.push(command({
      id: GOLD_BUY, module, group: 'barbarians', label: 'Buy a resource (2 gold)',
      hint: p.gold[seat] - 2 >= reserve ? 0.7 : 0.2,
      detail: `You have ${p.gold[seat]} gold. Up to twice per turn.`,
      fields: [cardsField('cards', 'Resource', 'bank', bank, 1, 1, RESOURCES)],
    }));
  }
  const rate = rates(s, seat), goods = RESOURCES.filter(g => s.seats[seat].hand[g] >= rate[g]);
  if (goods.length) {
    const options = goods.map(g => choice(g, `${rate[g]} ${g} → 1 gold`));
    out.push(command({
      id: GOLD_SELL, module, group: 'barbarians', label: 'Sell cards for gold', hint: 0.15,
      detail: 'Your bank rate buys 1 gold', fields: [pickField('good', 'Cards to sell', options)],
    }));
  }
  return out;
}

/** Apply a GOLD_IDS command: buy a resource for 2 gold, or sell cards at the bank rate for 1 gold. */
export function goldTrade(s: State, seat: SeatId, id: string, a: Answer) {
  if (id === GOLD_SELL) {
    const g = a.picks.good as Resource, paid = { [g]: rates(s, seat)[g] };
    transfer(s.seats[seat].hand, s.bank, paid, 'You no longer have those cards.');
    addGold(s, seat, 1);
    const text = `${seatName(s, seat)} sold ${cardsText(paid)} for 1 gold`;
    return emit(s, { kind: 'module', module: purseOwner(s), name: 'gold', seat, target: null, text });
  }
  const p = purse(s), cards = a.cards.cards;
  need(p.gold[seat] >= 2 && p.bought[seat] < 2, 'You cannot buy with gold now.');
  transfer(s.bank, s.seats[seat].hand, cards, 'The bank does not have that resource.');
  p.gold[seat] -= 2;
  p.bought[seat]++;
  gained(s, seat, cards);
  emit(s, { kind: 'take', seat, cards, text: `${seatName(s, seat)} bought ${cardsText(cards)} with gold` });
}

/** The first option of every required pick: prompts list options best-first, so this is the auto answer. */
export const firstAnswer = (spec: PromptSpec) => (s: State, p: OpenPrompt): Answer => ({
  picks: Object.fromEntries(spec.command(s, p).fields.flatMap(f => (f.kind === 'pick' && f.options[0]
    ? [[f.key, f.options[0].value]] : []))), cards: {},
});
