import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../../src/engine/cards';
import { largestFirst, openPrompt, openRobber } from '../../src/engine/prompts';
import { act, answer, edit, game, grant, inventory, pastSetup, pub, rig, rob, serializable, unchanged, view } from '../helpers';

test('three discards open together, resolve in any order, then the robber', () => {
  const s = game(4);
  pastSetup(s);
  const roller = s.turn.active!, [b, c, d] = s.order.filter(x => x !== roller);
  grant(s, b, { wood: 5, brick: 4 });
  grant(s, c, { ore: 8 });
  grant(s, d, { wool: 3, grain: 3, ore: 3, wood: 1 });
  grant(s, roller, { grain: 3 });
  const stock = inventory(s);
  rig(s, [6, 1]);
  act(s, roller, { type: 'roll' });
  const owed = (id: string) => Math.floor(total(s.seats[id].hand) / 2);
  const expected = { [b]: owed(b), [c]: owed(c), [d]: owed(d) };
  assert.deepEqual(Object.fromEntries(pub(s).prompts.map(p => [p.seat, p.count])), expected);
  assert.equal(pub(s).now.title, 'Rolled 7!');
  assert.equal(view(s, c).task.title, 'Discard now');
  unchanged(s, () => answer(s, c, 'discard', {}, { cards: { ore: 3 } }), /Choose \d+ cards/);
  unchanged(s, () => answer(s, c, 'discard', {}, { cards: { brick: 9 } }), /do not have/);
  const discard = (id: string) => answer(s, id, 'discard', {}, { cards: largestFirst(s.seats[id].hand, expected[id]) });
  discard(d);
  assert.equal(pub(s).robberChoices.length, 0, 'robber waits for every discard');
  discard(b);
  assert.equal(pub(s).robberChoices.length, 0);
  discard(c);
  assert.deepEqual(pub(s).prompts.map(p => [p.seat, p.kind]), [[roller, 'robber']]);
  assert.equal(pub(s).robberChoices[0].seat, roller);
  assert.equal(s.turn.stage, 'roll', 'main waits for the robber');
  const tile = rob(s, roller);
  assert.equal(s.pieces.robber, tile);
  assert.equal(s.turn.stage, 'main');
  assert.deepEqual(inventory(s), stock, 'discards return cards to the bank; the steal moves one card');
  assert.deepEqual(s.events.filter(e => e.kind === 'discard').map(e => e.kind === 'discard' && e.count),
    [expected[d], expected[b], expected[c]]);
  serializable(s);
});

test('self prompts block only their owner; stage transitions wait for all prompts', () => {
  const s = game(4);
  pastSetup(s);
  const active = s.turn.active!, other = s.order.find(x => x !== active)!;
  rig(s, [2, 3]);
  act(s, active, { type: 'roll' });
  edit(s, n => openRobber(n, other, 'self'));
  assert.equal(pub(s).robberChoices[0].seat, other);
  act(s, active, { type: 'end' });
  assert.equal(s.turn.stage, 'main', 'end-opportunity waits for the open prompt');
  assert.equal(s.turn.active, active);
  unchanged(s, () => act(s, other, { type: 'end' }), /Finish your open decision/);
  rob(s, other);
  assert.equal(s.turn.stage, 'roll');
  assert.equal(s.turn.active, s.order[1]);
});

test('table prompts block other actions but not emotes; one prompt per seat per kind', () => {
  const s = game(3);
  pastSetup(s);
  const a = s.turn.active!;
  edit(s, n => { openPrompt(n, { seat: s.order[1], kind: 'gold', scope: 'table', data: { count: 2 } }); });
  unchanged(s, () => act(s, a, { type: 'roll' }), /Waiting for other players/);
  act(s, a, { type: 'emote', emote: 'hurry' });
  unchanged(s, () => edit(s, n => { openPrompt(n, { seat: s.order[1], kind: 'gold', scope: 'table' }); }), /already open/);
  assert.equal(pub(s).prompts[0].count, 2);
  const before = inventory(s), hand = { ...s.seats[s.order[1]].hand };
  answer(s, s.order[1], 'gold', {}, { cards: { ore: 1, wool: 1 } });
  assert.deepEqual(s.seats[s.order[1]].hand, { ...hand, wool: hand.wool + 1, ore: hand.ore + 1 });
  assert.deepEqual(inventory(s), before);
  act(s, a, { type: 'roll' });
});
