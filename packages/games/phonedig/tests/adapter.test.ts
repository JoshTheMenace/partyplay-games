import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { RoundContext, ViewContext } from '../../../party-contract/src/index';
import { rules } from '../src/server';
import { createAdapter, decode } from '../src/viewstate';

const VIEW: ViewContext = { nowMs: 1000, phase: 'playing' };

function crew(players: number): RoundContext {
  return {
    roomId: 'room', roundId: 'round', seed: 4242, nowMs: 1000,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: '#ff5748' })),
  };
}

test('a phone renders its own digger’s lamp, air and relics, not the lead’s', () => {
  const round = rules.create(crew(2), rules.validateSettings({}));
  const [lead, second] = round.sim.players;
  lead.lightRadius = 8; lead.air = 30; lead.relics = [];
  second.lightRadius = 21; second.air = 4; second.relics = ['lantern'];

  const view = rules.publicView(round, VIEW);
  const drawn = createAdapter().build(view, decode(view), 'p1');

  assert.equal(drawn.lightRadius, 21);
  assert.equal(drawn.air, 4);
  assert.deepEqual(drawn.relics, ['lantern']);
  assert.equal(drawn.player, drawn.players[1]);
});

test('every digger carries their own lamp reach to the renderer', () => {
  const round = rules.create(crew(2), rules.validateSettings({}));
  round.sim.players[0].lightRadius = 8;
  round.sim.players[1].lightRadius = 21;

  const view = rules.publicView(round, VIEW);
  const drawn = createAdapter().build(view, decode(view), 'p0');

  assert.deepEqual(drawn.players.map(q => q.lightRadius), [8, 21]);
  assert.equal(drawn.lightRadius, 8);
});
