/** WP-integration engine repairs: a Knight's robber pauses the step clock; ships built this turn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeRoute } from '../../src/engine/pieces';
import { act, edit, game, rob, tick, view } from '../helpers';
import { blank, toMain } from '../rules/helpers';

test('a Knight robber (self prompt) gives the main step back the time it was open', () => {
  const s = blank(game(3)), a = s.turn.active!;
  toMain(s);
  const deadline = s.timers[a].deadline!;
  edit(s, n => { n.seats[a].dev.push({ id: 'k1', kind: 'knight', boughtAt: -1 }); });
  act(s, a, { type: 'play-dev', card: 'k1', goods: [] }, s.now + 5000);
  assert.ok(view(s, a).prompts.some(p => p.kind === 'robber'));
  edit(s, () => {}, s.now + 7000); // the clock moves on while the robber prompt is open
  rob(s, a);
  assert.equal(s.timers[a].deadline, deadline + 7000, 'paused for the 7 s the robber prompt was open');
  tick(s, deadline + 1000);
  assert.equal(s.turn.stage, 'main', 'the old deadline no longer ends the turn');
});

test('ships placed this opportunity are listed per seat and cleared at the next opportunity', () => {
  const s = blank(game(3)), a = s.turn.active!;
  edit(s, n => placeRoute(n, { edge: 'e-test', seat: a, kind: 'ship' }));
  edit(s, n => placeRoute(n, { edge: 'e-road', seat: a, kind: 'road' }));
  assert.deepEqual(s.seats[a].shipsBuilt, ['e-test']);
  toMain(s);
  act(s, a, { type: 'end' });
  toMain(s);
  act(s, s.turn.active!, { type: 'end' });
  toMain(s);
  act(s, s.turn.active!, { type: 'end' });
  assert.equal(s.turn.active, a);
  assert.deepEqual(s.seats[a].shipsBuilt, []);
});
