import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CPU_BUDGET } from '../../src/engine/flow';
import type { State } from '../../src/engine/state';
import { act, edit, pub, view } from '../helpers';
import { deal, seats, trading } from './helpers';

/** The same script, with seat b a human in one game and a CPU in the other. */
function script(cpu: boolean) {
  const s = trading(4), [a, b, c] = seats(s);
  if (cpu) edit(s, n => {
    n.seats[b].cpu = { level: 'normal', persona: 'x', label: 'X', nextAt: Infinity, memory: null,
      budget: CPU_BUDGET, duty: '', idle: 0 };
  });
  deal(s, { [a]: { wool: 2 }, [b]: { ore: 2 }, [c]: { ore: 1 } });
  act(s, b, { type: 'offer', give: { ore: 1 }, want: { wool: 1 }, to: [], counterTo: null });
  act(s, a, { type: 'offer', give: { wool: 1 }, want: { ore: 1 }, to: [], counterTo: null });
  const offer = Object.values(s.offers).find(o => o.from === a)!.id;
  act(s, b, { type: 'respond', offer, answer: 'decline', reason: 'Not now' });
  act(s, b, { type: 'respond', offer, answer: 'accept' });
  act(s, c, { type: 'respond', offer, answer: 'accept' });
  act(s, a, { type: 'confirm-trade', offer, partner: b });
  return { s, b };
}

const summary = ({ s, b }: { s: State; b: string }) => ({
  hands: s.order.map(id => s.seats[id].hand), offers: pub(s).offers, events: s.events,
  mine: view(s, b).offers, stats: s.stats.seats,
});

test('CPU and human seats get identical trade outcomes', () => {
  assert.deepEqual(summary(script(true)), summary(script(false)));
});
