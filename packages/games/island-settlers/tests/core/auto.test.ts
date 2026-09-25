/** Auto steps wait behind open prompts instead of throwing inside tick (owed free routes, fog gold). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPrompt } from '../../src/engine/prompts';
import { placeBuilding, removeBuilding, removeRoute } from '../../src/engine/pieces';
import type { State } from '../../src/engine/state';
import { act, edit, game, pastSetup, rig, tick } from '../helpers';

const routes = (s: State, seat: string) => Object.values(s.pieces.routes).filter(r => r.seat === seat).length;

test('a main timeout with owed free routes waits behind a table prompt, then the next seat rolls', () => {
  const s = game(4);
  pastSetup(s);
  rig(s, [2, 3]);
  const a = s.turn.active!, b = s.order.find(id => id !== a)!, before = routes(s, a);
  act(s, a, { type: 'roll' });
  const main = s.timers[a].deadline!;
  edit(s, n => {
    n.seats[a].freeRoutes = 2;
    openPrompt(n, { seat: b, kind: 'gold', scope: 'table', data: { count: 1 } });
  }, main - 1000);
  const gold = Object.values(s.prompts)[0].deadline!;
  assert.ok(gold > main);
  tick(s, main);
  assert.equal(s.turn.stage, 'main', 'the step waits for the table prompt');
  tick(s, gold);
  assert.equal(routes(s, a), before + 2);
  assert.equal(s.turn.stage, 'roll');
  const next = s.turn.active!;
  assert.notEqual(next, a);
  tick(s, s.timers[next].deadline!);
  assert.equal(s.turn.stage, 'main');
});

test('Connect: a window deadline with owed free routes and a table prompt does not throw', () => {
  const s = game(4, { mode: 'connect', roundSeconds: 60 });
  pastSetup(s);
  rig(s, [2, 3]);
  act(s, s.turn.active!, { type: 'roll' });
  const [a, b] = s.order, opened = s.turn.openedAt;
  edit(s, n => { n.seats[a].freeRoutes = 2; });
  edit(s, n => { openPrompt(n, { seat: b, kind: 'gold', scope: 'table', data: { count: 1 } }); }, opened + 50_000);
  tick(s, opened + 60_000);
  assert.equal(s.turn.stage, 'round');
  tick(s, Object.values(s.prompts)[0].deadline!);
  assert.equal(s.seats[a].freeRoutes, 0);
});

test('Fog Islands: a free ship that reveals gold stops the loop at the gold prompt', () => {
  const s = game(4, { map: 'seafarers', seafarers: 'fog-islands' });
  pastSetup(s);
  const a = s.turn.active!, tiles = new Map(s.board.tiles.map(t => [t.id, t]));
  for (const t of Object.keys(s.hidden)) s.hidden[t] = { terrain: 'gold', number: 5 };
  const taken = new Set(Object.keys(s.pieces.buildings));
  const coast = s.board.vertices.find(v => v.tiles.some(t => s.hidden[t])
    && v.tiles.some(t => tiles.get(t)?.terrain === 'sea') && !taken.has(v.id))!.id;
  edit(s, n => {
    for (const r of Object.values(n.pieces.routes)) if (r.seat === a) removeRoute(n, r.edge);
    for (const x of Object.values(n.pieces.buildings)) if (x.seat === a) removeBuilding(n, x.vertex);
    placeBuilding(n, { vertex: coast, seat: a, kind: 'settlement' });
    n.seats[a].freeRoutes = 2;
  });
  tick(s, s.timers[a].deadline!);
  assert.ok(Object.values(s.prompts).some(p => p.seat === a && p.kind === 'gold'));
});

test('a sweep that still throws is retried once without owed free routes, so the room survives', t => {
  const s = game(4, { scenarios: ['deliveries'] });
  pastSetup(s);
  rig(s, [2, 3]);
  const a = s.turn.active!;
  // Unreachable in play: a mover in its roll step, so the free-route build is refused.
  edit(s, n => Object.assign(n.seats[a], { freeRoutes: 2, moved: true }));
  const log = t.mock.method(console, 'error', () => {});
  tick(s, s.timers[a].deadline!);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(s.turn.stage, 'main', 'the roll still happened');
});
