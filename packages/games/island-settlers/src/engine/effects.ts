/**
 * The resolve loop and the core effect handlers (ENGINE §3.1). Effects run one at a time; a table
 * prompt holds the loop for everyone, and stage transitions wait until every prompt is closed.
 * Handlers insert their follow-ups at the front of the queue, so a roll resolves before `main`.
 */
import { cardsText, total } from './cards';
import { emit } from './events';
import { endRound, nextOpportunity, openMain } from './flow';
import { hooks, moduleById } from './modules/registry';
import { need } from './need';
import { produce } from './production';
import { discardLimit, openPrompt, openRobber, tablePromptOpen } from './prompts';
import { rollDice } from './rng';
import { pushEffect, random, seatName, TRANSITIONS, type Effect, type RollDraft, type State } from './state';

export function advance(s: State) {
  for (let guard = 0; guard < 1000; guard++) {
    if (s.turn.stage === 'finale' || s.turn.stage === 'ended') { s.queue = []; return; }
    const next = s.queue[0];
    if (!next || tablePromptOpen(s)) return;
    if (TRANSITIONS.includes(next.type) && Object.keys(s.prompts).length) return;
    s.queue.shift();
    run(s, next);
  }
  throw new Error('The effect queue did not settle.');
}

function run(s: State, e: Effect) {
  switch (e.type) {
    case 'roll': return rollEffect(s, e.seat);
    case 'produce': return produceEffect(s, e.roll);
    case 'seven': return seven(s, e.seat);
    case 'robber': return openRobber(s, e.seat, e.scope);
    case 'main': return openMain(s);
    case 'end-opportunity': return nextOpportunity(s);
    case 'end-round': return endRound(s);
    case 'module': {
      const handler = moduleById(e.module)?.effects?.[e.name];
      need(handler, `Unknown effect ${e.module}/${e.name}.`);
      return handler(s, e.data);
    }
  }
}

function rollEffect(s: State, seat: string | null) {
  const { dice, deck } = rollDice(random(s, 'dice'), s.diceDeck, s.lastTotal);
  s.diceDeck = deck;
  const roll: RollDraft = {
    seat, dice, total: dice[0] + dice[1], eventDie: null, grants: [], blocked: [], shortages: [], gold: {},
  };
  for (const m of hooks(s, 'beforeProduce')) m.beforeProduce(s, roll);
  pushEffect(s, { type: 'produce', roll });
}

function produceEffect(s: State, roll: RollDraft) {
  s.lastTotal = roll.total;
  s.stats.dice[roll.total]++;
  if (roll.total === 7) {
    publish(s, roll);
    return pushEffect(s, { type: 'seven', seat: roll.seat });
  }
  produce(s, roll);
  for (const m of hooks(s, 'afterProduce')) m.afterProduce(s, roll);
  publish(s, roll);
  for (const [seat, count] of Object.entries(roll.gold)) {
    if (count > 0) openPrompt(s, { seat, kind: 'gold', scope: 'table', data: { count } });
  }
}

/** The RollEvent doubles as `lastRoll`, the production summary kept until the next roll. */
function publish(s: State, roll: RollDraft) {
  const by = new Map<string, Record<string, number>>();
  for (const g of roll.grants) {
    const cards = by.get(g.seat) ?? {};
    cards[g.good] = (cards[g.good] ?? 0) + g.amount;
    by.set(g.seat, cards);
  }
  const paid = [...by].map(([id, cards]) => `${seatName(s, id)} +${cardsText(cards)}`).join(', ');
  const who = roll.seat ? `${seatName(s, roll.seat)} rolled` : 'Rolled';
  const text = `${who} ${roll.total}${paid ? `: ${paid}` : ''}`;
  const { gold: _gold, ...fields } = roll;
  const event = emit(s, { kind: 'roll', ...fields, text });
  s.lastRoll = event.kind === 'roll' ? event : null;
}

/** Everyone over their limit discards half at once; then the robber unless a module replaces it. */
function seven(s: State, seat: string | null) {
  for (const id of s.order) {
    const n = total(s.seats[id].hand);
    const data = { count: Math.floor(n / 2) };
    if (n > discardLimit(s, id)) openPrompt(s, { seat: id, kind: 'discard', scope: 'table', data });
  }
  const replaced = hooks(s, 'onSeven').map(m => m.onSeven(s, seat)).includes('replace');
  if (!replaced && seat) pushEffect(s, { type: 'robber', seat, scope: 'table' });
}
