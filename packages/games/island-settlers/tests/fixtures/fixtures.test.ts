import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSerializable } from '../../../../party-contract/src/serializable';
import { VIEW_LIMITS, type CorePromptKind, type TaskKind } from '../../src/model';
import { FIXTURE_NAMES, loadFixture } from './index';

const all = FIXTURE_NAMES.map(loadFixture);

test('every fixture is serializable and JSON-round-trips unchanged', () => {
  for (const f of all) {
    for (const value of [f.pub, ...Object.values(f.views)]) {
      assertSerializable(value);
      assert.deepEqual(JSON.parse(JSON.stringify(value)), value, f.name);
    }
  }
});

test('names match keys, default seats have views, factories return fresh copies', () => {
  for (const [i, f] of all.entries()) {
    assert.equal(f.name, FIXTURE_NAMES[i]);
    assert.ok(f.views[f.seat], `${f.name} has a view for ${f.seat}`);
  }
  assert.notEqual(loadFixture('mid-4').pub, loadFixture('mid-4').pub);
});

test('coverage: every TaskKind and core prompt kind appears in some private view', () => {
  const views = all.flatMap(f => Object.values(f.views));
  const tasks = new Set(views.map(v => v.task.kind));
  const prompts = new Set(views.flatMap(v => v.prompts.map(p => p.kind)));
  const kinds: TaskKind[] = [
    'setup', 'roll', 'main', 'paired', 'round', 'prompt', 'respond', 'wait', 'finale', 'ended',
  ];
  for (const kind of kinds) assert.ok(tasks.has(kind), `task ${kind}`);
  for (const kind of ['discard', 'robber', 'gold'] satisfies CorePromptKind[]) assert.ok(prompts.has(kind), kind);
});

test('references point at real board ids and seats', () => {
  for (const { name, pub, views } of all) {
    const tiles = new Set(pub.board.tiles.map(t => t.id)), vertices = new Set(pub.board.vertices.map(v => v.id));
    const edges = new Set(pub.board.edges.map(e => e.id)), seats = new Set(pub.seats.map(s => s.id));
    for (const b of Object.values(pub.pieces.buildings)) assert.ok(vertices.has(b.vertex) && seats.has(b.seat));
    for (const r of Object.values(pub.pieces.routes)) assert.ok(edges.has(r.edge) && seats.has(r.seat), name);
    for (const t of [pub.pieces.robber, pub.pieces.pirate]) assert.ok(t === null || tiles.has(t), name);
    for (const e of pub.events) if ('seat' in e && e.seat) assert.ok(seats.has(e.seat), `${name} event ${e.id}`);
    assert.equal(new Set(pub.seats.map(s => s.seat)).size, pub.seats.length, `${name} unique palette index`);
    assert.ok(pub.offers.length <= VIEW_LIMITS.openOffers && pub.events.length <= VIEW_LIMITS.events, name);
    for (const v of Object.values(views)) assert.ok(seats.has(v.seat), name);
  }
});

test('stress fixtures match the plan', () => {
  const max = loadFixture('max-10').pub;
  const land = new Set(max.board.tiles.filter(t => t.terrain !== 'sea').map(t => t.id));
  const landVertices = max.board.vertices.filter(v => v.tiles.some(t => land.has(t)));
  assert.equal(Object.keys(max.pieces.buildings).length, landVertices.length);
  assert.equal(Object.keys(max.pieces.routes).length, max.board.edges.filter(e => e.land).length);
  const offers = loadFixture('offers-12').pub.offers;
  assert.equal(offers.length, 12);
  const states = new Set(offers.flatMap(o => Object.values(o.responses)));
  for (const s of ['pending', 'accept', 'decline', 'counter', 'unable']) assert.ok(states.has(s as never), s);
  assert.ok(offers.some(o => o.counterTo));
  assert.equal(loadFixture('seven-discard-4').pub.prompts.filter(p => p.kind === 'discard').length, 3);
  for (const n of ['roll-3', 'paired-6', 'offers-12', 'max-10'] as const) {
    assert.ok(loadFixture(n).pub.seats.every(s => s.name.length === 16), n);
  }
  const finale = loadFixture('finale-6').pub;
  assert.ok(finale.results && finale.results.winners.length === 1 && finale.turn.stage === 'finale');
});
