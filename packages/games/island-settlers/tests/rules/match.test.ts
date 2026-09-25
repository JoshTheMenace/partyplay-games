import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COSTS, FINALE_MS, GOODS, RESOURCES, type Action, type CardPicks, type Cards, type Command, type Field,
  type Picks, type PrivateView, type Settings,
} from '../../src/model';
import { rules } from '../../src/server';
import type { State } from '../../src/engine/state';
import { act, game, inventory, serializable, tick, view } from '../helpers';

type Move = Action extends infer A ? A extends Action ? Omit<A, 'turnId'> : never : never;

/** First option of every pick (walking `then`), largest piles first for card fields. */
function answerOf(c: Command): { picks: Picks; cards: CardPicks } {
  const picks: Picks = {}, cards: CardPicks = {}, fields: Field[] = [...c.fields];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.kind === 'pick') {
      const o = f.options[0];
      if (o) { picks[f.key] = o.value; fields.push(...(o.then ?? [])); }
      continue;
    }
    const left: Cards = { ...f.available }, out: Cards = {};
    for (let n = 0; n < f.min; n++) {
      const g = f.allowed.reduce((a, b) => ((left[b] ?? 0) > (left[a] ?? 0) ? b : a), f.allowed[0]);
      left[g] = (left[g] ?? 0) - 1;
      out[g] = (out[g] ?? 0) + 1;
    }
    cards[f.key] = out;
  }
  return { picks, cards };
}

/** 4:1-style bank lot toward the cheapest missing card of `goal`. */
function bankMove(v: PrivateView, goal: Cards): Move | null {
  const want = RESOURCES.find(r => (v.hand[r] ?? 0) < (goal[r] ?? 0));
  const give = GOODS.find(g => g !== want && (v.hand[g] ?? 0) - (v.rates[g] ?? 4) >= (goal[g] ?? 0));
  if (!want || !give || v.why.bank) return null;
  return { type: 'bank', give: { [give]: v.rates[give] }, get: { [want]: 1 } };
}

/** A simple always-legal player: build the best affordable piece, play and buy cards, trade with the bank. */
function choose(s: State, seat: string): Move | null {
  const v = view(s, seat), opt = (p: string) => v.build.find(o => o.piece === p);
  if (v.prompts.length) return { type: 'answer', prompt: v.prompts[0].id, ...answerOf(v.prompts[0].command) };
  const ready = (p: string) => {
    const o = opt(p);
    return o && (!o.why || o.free > 0) && o.targets.length ? o : null;
  };
  if (v.task.kind === 'setup') {
    const o = v.build.find(x => x.free && x.targets.length)!;
    return { type: 'build', piece: o.piece as 'road', at: o.targets[0] };
  }
  if (v.task.kind === 'roll') {
    return v.can.roll ? { type: 'roll' } : { type: 'build', piece: 'road', at: ready('road')!.targets[0] };
  }
  if (!['main', 'paired', 'round'].includes(v.task.kind)) return null;
  const settle = opt('settlement');
  for (const piece of ['city', 'settlement'] as const) {
    const o = ready(piece);
    if (o) return { type: 'build', piece, at: o.targets[0] };
  }
  const road = ready('road');
  const expand = road && (road.free > 0 || !settle?.targets.length);
  if (expand) return { type: 'build', piece: 'road', at: road.targets[0] };
  const card = v.dev.find(c => c.playable);
  if (card) {
    const rich = RESOURCES.find(r => s.bank[r] > 1);
    const goods = card.kind === 'plenty' ? (rich ? [rich, rich] : [])
      : card.kind === 'monopoly' ? ['ore' as const] : [];
    if (card.kind !== 'plenty' || goods.length) return { type: 'play-dev', card: card.id, goods: [...goods] };
  }
  if (!opt('development')?.why && v.dev.length < 3) return { type: 'buy-dev' };
  const goal = settle?.left && settle.targets.length ? COSTS.settlement
    : opt('city')?.targets.length ? COSTS.city : COSTS.road;
  return bankMove(v, goal) ?? { type: 'end' };
}

function play(seats: number, settings: Partial<Settings>, seed: number) {
  const s = game(seats, { timer: 'off', ...settings }, seed), stock = inventory(s);
  let steps = 0, now = s.now;
  for (let loop = 0; s.turn.stage !== 'finale' && loop < 20000; loop++) {
    for (const id of s.order) {
      const move = choose(s, id);
      if (!move) continue;
      act(s, id, move, (now += 10));
      steps++;
    }
    tick(s, (now += 100));
    assert.deepEqual(inventory(s), stock, 'goods are conserved');
    if (steps % 250 === 0) serializable(s);
  }
  return s;
}

/** Finale → ended → complete, and a fresh replay. */
function finishes(s: State, seats: number, settings: Partial<Settings>, seed: number) {
  const [w] = s.results!.winners, vp = s.results!.standings.find(r => r.seat === w)!.vp;
  assert.ok(vp >= Math.max(...s.results!.standings.map(r => r.vp)));
  serializable(s);
  assert.equal(rules.outcome(s).complete, false);
  tick(s, s.now + FINALE_MS);
  assert.equal(s.turn.stage, 'ended');
  assert.equal(rules.outcome(s).complete, true);
  assert.equal(game(seats, settings, seed + 1).turn.stage, 'setup', 'a replay starts fresh');
}

for (const [seats, seed] of [[3, 2], [4, 7], [6, 11], [8, 3]] as const) {
  test(`full match: ${seats} seats Standard reaches the target, the finale and results`, () => {
    const s = play(seats, {}, seed);
    assert.equal(s.turn.stage, 'finale', `stuck in ${s.turn.stage} round ${s.turn.round}`);
    assert.equal(s.results?.reason, 'target');
    const winner = s.results!.standings.find(r => r.seat === s.results!.winners[0])!;
    assert.ok(winner.vp >= s.settings.targetPoints);
    finishes(s, seats, {}, seed);
  });
}

// This naive picker is too weak for 100 Connect rounds; the run still exercises every Connect rule.
test('full match: 4 seats Connect plays to the finale with goods conserved', () => {
  const s = play(4, { mode: 'connect' }, 5);
  assert.equal(s.turn.stage, 'finale');
  assert.ok(s.turn.round > 50, 'many Connect rounds were played');
  finishes(s, 4, { mode: 'connect' }, 5);
});
