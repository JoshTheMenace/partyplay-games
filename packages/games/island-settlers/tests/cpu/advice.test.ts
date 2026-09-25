/**
 * Module advisors on live engine views: C&K metropolis and defense values, the Seafarers island
 * bonus, camel bids, fish saving, route kinds that switch only at our buildings, and prompts that
 * cannot be answered not blocking the next one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Board, Command, Field, Settings } from '../../src/model';
import { advisedAnswer, spotBonus, worth } from '../../src/cpu/advice/index';
import { indexOf, modeDistances } from '../../src/cpu/board';
import { context, freshMemory } from '../../src/cpu/context';
import { promptAction } from '../../src/cpu/prompts';
import { needsOf } from '../../src/cpu/trade';
import { game, pastSetup, pub, view } from '../helpers';

function live(settings: Partial<Settings>) {
  const s = game(4, settings, 3);
  pastSetup(s);
  const p = pub(s), me = view(s, 'p0');
  return { p, me, c: () => context(p, me, 'normal', 'trader', () => 0.5, freshMemory(p.turn.id)) };
}

const cmd = (id: string, module: Command['module'], fields: Field[] = []): Command =>
  ({ id, module, group: 'city', label: id, detail: '', cost: null, fields, hint: 0.5 });

test('C&K: a metropolis capture outranks a plain level; a dead track is not a goal', () => {
  const { p, c } = live({ citiesKnights: true }), x = p.ext['cities-knights']!;
  const rival = Object.values(p.pieces.buildings).find(b => b.seat === 'p1' && b.kind === 'city')!;
  x.seats.p0.improvements = { science: 3, trade: 0, politics: 4 };
  x.seats.p1.improvements.politics = 5;
  x.metropolises = { politics: rival.vertex };
  const capture = worth(c(), cmd('ck:improve:science', 'cities-knights'));
  assert.ok(capture > 2 * worth(c(), cmd('ck:improve:trade', 'cities-knights')), `capture ${capture}`);
  assert.ok(worth(c(), cmd('ck:improve:politics', 'cities-knights')) < 0.9);
});

test('C&K: activating a knight matters most as the barbarian ship closes in on the weakest city holder', () => {
  const { p, c } = live({ citiesKnights: true }), x = p.ext['cities-knights']!;
  const at = p.board.vertices.find(v => !p.pieces.buildings[v.id])!.id;
  p.pieces.units.k1 = { id: 'k1', kind: 'knight', seat: 'p0', at, level: 1, active: false, cargo: [] };
  for (const s of p.seats) x.seats[s.id].strength = s.id === 'p0' ? 0 : 1;
  const at$ = (position: number) => {
    x.barbarian.position = position;
    return worth(c(), cmd('ck:activate:k1', 'cities-knights'));
  };
  const far = at$(0), near = at$(x.barbarian.length - 1);
  assert.ok(near > 2 * far && near > 2, `near ${near}, far ${far}`);
});

test('Seafarers: a settlement on a new island adds 2 VP; home islands and Fog Islands add none', () => {
  for (const seafarers of ['new-shores', 'fog-islands'] as const) {
    const { p, c } = live({ map: 'seafarers', seafarers }), ix = indexOf(p.board);
    const islands = (id: string) => [...new Set(ix.vertex.get(id)!.tiles.map(t => ix.tile.get(t)!.island))];
    const bonus = (island: number) => p.board.vertices.filter(v => islands(v.id).join() === String(island))
      .map(v => spotBonus(c(), v.id));
    if (seafarers === 'fog-islands') {
      assert.ok(p.board.vertices.every(v => !spotBonus(c(), v.id)));
      continue;
    }
    assert.deepEqual([...new Set(bonus(0))], [0], 'home island');
    assert.deepEqual([...new Set(bonus(1))], [2], 'new island');
  }
});

test('Caravans: bids only for a camel that puts one of our buildings between two camels', () => {
  const { p, me, c } = live({ scenarios: ['caravans'] }), ix = indexOf(p.board);
  const home = Object.values(p.pieces.buildings).find(b => b.seat === 'p0')!.vertex;
  const [e1, e2] = ix.links.get(home)!.map(l => l.edge);
  me.hand = { wool: 3, grain: 3 };
  const bid = cmd('q1', 'caravans', [
    { kind: 'cards', key: 'bid', label: 'Bid', source: 'hand', allowed: ['wool', 'grain'], available: me.hand,
      min: 0, max: 6 },
    { kind: 'pick', key: 'edge', label: 'Edge', options: [{ value: e2, label: 'Camel edge' }], target: 'edge',
      optional: true },
  ]);
  assert.deepEqual(advisedAnswer(c(), bid, needsOf()), { picks: {}, cards: { bid: {} } });
  const camel = { id: 'camel-1', kind: 'camel' as const, seat: null, at: e1, level: 0, active: true, cargo: [] };
  p.pieces.units[camel.id] = camel;
  const a = advisedAnswer(c(), bid, needsOf())!;
  assert.equal(a.picks.edge, e2);
  assert.equal(Object.values(a.cards.bid).reduce((n, k) => n + (k ?? 0), 0), 1);
});

test('Fishing: saves for a development card, then spends on it', () => {
  const { p, me, c } = live({ scenarios: ['fishing'] }), spend = (k: string) => cmd(`fishing-${k}`, 'fishing');
  me.commands = [spend('steal'), spend('resource')];
  me.ext.fishing = { fish: [{ id: 'f1', value: 2 }, { id: 'f2', value: 2 }] };
  assert.ok(p.devDeck > 0 && worth(c(), spend('resource')) < 0.9);
  me.commands.push(spend('route'), spend('dev'));
  me.ext.fishing = { fish: [{ id: 'f1', value: 3 }, { id: 'f2', value: 2 }, { id: 'f3', value: 2 }] };
  assert.ok(worth(c(), spend('dev')) > 0.9 && worth(c(), spend('resource')) < 0.9);
});

test('route kinds switch between road and ship only at our own building', () => {
  const v = (id: string, edges: string[]) => ({ id, x: 0, y: 0, tiles: [], edges, coast: false });
  const e = (id: string, a: string, b: string, land: boolean, sea: boolean) =>
    ({ id, a, b, tiles: [], land, sea });
  const board = {
    tiles: [], ports: [],
    vertices: [v('x', ['xa']), v('a', ['xa', 'ab']), v('b', ['ab', 'bc']), v('c', ['bc'])],
    edges: [e('xa', 'x', 'a', true, false), e('ab', 'a', 'b', true, true), e('bc', 'b', 'c', false, true)],
  } as unknown as Board;
  const routes = { xa: { edge: 'xa', seat: 'me', kind: 'road' } };
  const pieces = { buildings: {}, routes, units: {}, reveals: {} };
  const ix = indexOf(board), from = (p: typeof pieces) => modeDistances(ix, p as never, 'me', ['a'], true, 5);
  assert.equal(from(pieces).ship.has('c'), false, 'no ship leaves a bare road end');
  const settled = { ...pieces, buildings: { b: { vertex: 'b', seat: 'me', kind: 'settlement' } } };
  assert.equal(from(settled).ship.get('c'), 2, 'a ship leaves our settlement');
});

test('a prompt with no legal answer does not block the next one', () => {
  const { me, c } = live({ citiesKnights: true });
  const prompt = (id: string, fields: Field[]) => ({
    id, kind: 'cities-knights/give' as const, scope: 'self' as const, deadline: null, auto: '',
    command: cmd(id, 'cities-knights', fields),
  });
  me.hand = { wool: 2 };
  me.prompts = [prompt('q1', [{ kind: 'pick', key: 'card', label: 'Card', options: [] }]),
    prompt('q2', [{ kind: 'cards', key: 'cards', label: 'Give', source: 'hand', allowed: ['wool'],
      available: me.hand, min: 1, max: 1 }])];
  me.task = { ...me.task, kind: 'prompt', prompt: 'q1' };
  const a = promptAction(c(), needsOf());
  assert.ok(a?.type === 'answer' && a.prompt === 'q2', JSON.stringify(a));
});
