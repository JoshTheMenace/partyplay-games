import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { State } from '../../src/engine/state';
import { facts } from '../../src/engine/modules/barbarian-attack/coast';
import { guards, placeGuard } from '../../src/engine/modules/barbarian-attack/guards';
import { act, edit, game, unchanged, view } from '../helpers';
import { blank, give, inland, ix, lay, settle, toMain, walk } from './helpers';

const settlement = (s: State, seat: string) => view(s, seat).build.find(o => o.piece === 'settlement')!;
const cost = { wood: 1, brick: 1, wool: 1, grain: 1 };

test('5–6 paired turn: no player trades, bank and building allowed, and the partner may win', () => {
  const s = blank(game(5)), p1 = s.order[0], partner = s.turn.partner!;
  const line = walk(s, inland(s)[0], 2);
  settle(s, partner, line.vertices[0]);
  lay(s, partner, line.edges);
  const near = new Set(line.vertices.flatMap(v => [v, ...ix(s).vertexNeighbors.get(v)!]));
  const others = inland(s).filter(v => !near.has(v)).slice(-4);
  for (const v of others) settle(s, partner, v, 'city');
  toMain(s);
  give(s, partner, cost);
  act(s, p1, { type: 'end' });
  assert.equal(s.turn.stage, 'paired');
  const me = view(s, partner);
  assert.deepEqual(me.partners, []);
  assert.equal(me.can.propose, false);
  assert.equal(me.why.bank, null, 'bank trades stay open');
  assert.equal(me.vp, 9);
  act(s, partner, { type: 'build', piece: 'settlement', at: line.vertices[2] });
  assert.equal(s.turn.stage, 'finale');
  assert.deepEqual(s.results?.winners, [partner]);
});

test('7–10 concurrent partner: the first commit takes a contested spot and the other list updates', () => {
  const s = blank(game(8)), p1 = s.order[0], partner = s.turn.partner!;
  const line = walk(s, inland(s)[0], 4), [v0, , mid, , v4] = line.vertices;
  settle(s, p1, v0);
  lay(s, p1, line.edges.slice(0, 2));
  settle(s, partner, v4);
  lay(s, partner, line.edges.slice(2));
  toMain(s);
  give(s, p1, cost);
  give(s, partner, cost);
  assert.ok(settlement(s, p1).targets.includes(mid));
  assert.ok(settlement(s, partner).targets.includes(mid), 'both may take the middle corner');
  act(s, p1, { type: 'build', piece: 'settlement', at: mid });
  assert.ok(!settlement(s, partner).targets.includes(mid));
  const late = () => act(s, partner, { type: 'build', piece: 'settlement', at: mid });
  unchanged(s, late, /No legal spot|not available/);
});

test('T&B 5–6: Player 2 gets an End of Turn phase (guards move; a castle guard marches out)', () => {
  const s = blank(game(5, { scenarios: ['barbarian-attack'] })), p1 = s.order[0], partner = s.turn.partner!;
  const castle = facts(s).castleEdges;
  edit(s, n => placeGuard(n, partner, castle[0], true));
  toMain(s, 8);
  act(s, p1, { type: 'end' });
  assert.equal(s.turn.stage, 'paired');
  assert.ok(view(s, partner).commands.some(c => c.id === 'ba-move'), 'Player 2 may move guards');
  act(s, partner, { type: 'end' });
  assert.ok(!castle.includes(guards(s, partner)[0].at), 'the forced march runs for Player 2 too');
});
