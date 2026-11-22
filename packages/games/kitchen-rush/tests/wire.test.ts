import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import { KITCHEN_MAX, LINE_MAX, LINES, lineOf, lineSizes, rankScores, type Item, type View } from '../src/model';
import { kitchenMap } from '../src/levels';
import { manifest } from '../src/manifest';
import { lineView, rules, type Service } from '../src/server';
import { EVENT_WINDOW_MS, decodeWire, kitchenOf, type Wire } from '../src/wire';
import { cook, crew } from './helpers/kitchen';

const CTX = { nowMs: 0, phase: 'playing' as const };
const near = (a: number, b: number, tolerance: number, what: string) => assert.ok(Math.abs(a - b) <= tolerance + 1e-9, `${what}: ${a} vs ${b}`);
/** What the wire keeps of an item: heat to a tenth of a second, and only on things that cook. */
const sent = (item: Item | null | undefined) => item && { ...item, cook: ['plate', 'pot', 'pan'].includes(item.kind) ? Math.round(item.cook * 10) / 10 : 0 };
const items = (a: Item | null | undefined, b: Item | null | undefined, what: string) => assert.deepEqual(a ?? null, sent(b) ?? null, what);
/** A decoded kitchen must match the server's own view of it to within the wire's units. */
function same(got: View, want: View) {
  for (const key of ['score', 'combo', 'served', 'failed', 'stars', 'gatesOpen', 'gateWarning', 'line', 'first', 'complete', 'now', 'startedAt', 'endsAt'] as const) assert.equal(got[key], want[key], key);
  assert.deepEqual(got.thresholds, want.thresholds); assert.deepEqual(got.settings, want.settings);
  assert.equal(got.players.length, want.players.length);
  want.players.forEach((chef, i) => {
    const mine = got.players[i];
    for (const key of ['id', 'name', 'color', 'character', 'work', 'target', 'dashing', 'connected'] as const) assert.equal(mine[key], chef[key], `chef ${key}`);
    near(mine.x, chef.x, .0051, 'x'); near(mine.z, chef.z, .0051, 'z'); near(mine.vx, chef.vx, .051, 'vx'); near(mine.vz, chef.vz, .051, 'vz'); near(mine.fx, chef.fx, .013, 'fx'); near(mine.fz, chef.fz, .013, 'fz');
    near(mine.respawnAt, chef.respawnAt, 10, 'respawnAt'); items(mine.held, chef.held, 'held');
  });
  assert.deepEqual(got.tiles.map(tile => [tile.at, tile.count]), want.tiles.map(tile => [tile.at, tile.count]));
  want.tiles.forEach((tile, i) => { items(got.tiles[i].item, tile.item, 'tile item'); near(got.tiles[i].progress ?? 0, tile.progress ?? 0, .003, 'progress'); near(got.tiles[i].fire ?? 0, tile.fire ?? 0, .004, 'fire'); });
  assert.equal(got.loose.length, want.loose.length);
  want.loose.forEach((drop, i) => {
    const mine = got.loose[i]; items(mine.item, drop.item, 'loose item'); assert.equal(mine.by, drop.by);
    for (const key of ['x', 'y', 'z'] as const) near(mine[key], drop[key], .0051, key);
    for (const key of ['vx', 'vy', 'vz'] as const) near(mine[key], drop[key], .051, key);
  });
  assert.deepEqual(got.orders.map(order => [order.id, order.recipe]), want.orders.map(order => [order.id, order.recipe]));
  want.orders.forEach((order, i) => { near(got.orders[i].createdAt, order.createdAt, 50, 'createdAt'); near(got.orders[i].expiresAt, order.expiresAt, 50, 'expiresAt'); });
  const fresh = want.events.filter(event => want.now - event.at < EVENT_WINDOW_MS);
  assert.deepEqual(got.events.map(event => [event.id, event.type, event.player, event.value, event.recipe]), fresh.map(event => [event.id, event.type, event.player, event.value, event.recipe]));
  fresh.forEach((event, i) => { near(got.events[i].at, event.at, 50, 'event time'); near(got.events[i].x ?? 0, event.x ?? 0, .0051, 'event x'); assert.equal(got.events[i].x === undefined, event.x === undefined); });
}
/** Bytes a snapshot costs on the wire once the cached fields have been sent. */
const moving = (wire: Wire) => JSON.stringify({ rev: wire.rev, now: wire.now, k: wire.k }).length;

test('crews split into one kitchen up to ten chefs, then balanced lines of five to eight in seat order', () => {
  assert.equal(manifest.players.max, MAX_ROOM_PLAYERS); assert.equal(LINES.length * LINE_MAX, MAX_ROOM_PLAYERS);
  for (let players = 1; players <= MAX_ROOM_PLAYERS; players++) {
    const sizes = lineSizes(players);
    assert.equal(sizes.reduce((sum, size) => sum + size, 0), players);
    if (players <= KITCHEN_MAX) { assert.deepEqual(sizes, [players]); continue; }
    assert.ok(sizes.length <= LINES.length && sizes.every(size => size >= 5 && size <= LINE_MAX) && Math.max(...sizes) - Math.min(...sizes) <= 1, `${players}: ${sizes}`);
    assert.equal(sizes.length, Math.ceil(players / LINE_MAX));
    const seats = Array.from({ length: players }, (_, seat) => lineOf(seat, players));
    assert.deepEqual(sizes.map((_, line) => seats.filter(seat => seat.line === line).length), sizes);
    assert.ok(seats.every((seat, i) => !i || seat.line >= seats[i - 1].line), 'seat order');
  }
  assert.deepEqual(lineSizes(11), [6, 5]); assert.deepEqual(lineSizes(32), [8, 8, 8, 8]); assert.deepEqual(lineSizes(64), Array(8).fill(8));
  assert.deepEqual(rankScores([50, 90, 50, 10]), [2, 1, 2, 4]);
  const service = crew(21, { level: 3 });
  assert.deepEqual(service.lines.map(s => [s.line, s.players.length, s.map === kitchenMap(3, 7)]), [[0, 7, true], [1, 7, true], [2, 7, true]]);
  assert.deepEqual(service.lines.flatMap(s => s.players.map(c => c.id)), Array.from({ length: 21 }, (_, i) => `p${i}`));
  assert.deepEqual(service.lines.map(s => s.orders.map(order => order.recipe)), Array(3).fill(service.lines[0].orders.map(order => order.recipe)), 'every kitchen opens with the same tickets');
});

test('the wire round-trips every kitchen through a played service, to within its units', () => {
  for (const [players, level, seconds] of [[1, 0, 20], [10, 2, 45], [20, 5, 70], [64, 7, 25]] as const) {
    const service = crew(players, { level });
    let checked = 0;
    cook(service, seconds, live => {
      if (checked++ % 7) return;
      const wire = rules.publicView(live, CTX), restaurant = decodeWire(wire);
      assertSerializable(wire);
      assert.equal(restaurant.lines.length, live.lines.length);
      live.lines.forEach((s, i) => same(restaurant.lines[i], lineView(s)));
      assert.equal(restaurant.score, live.lines.reduce((sum, s) => sum + s.score, 0));
      assert.deepEqual(restaurant.thresholds, [0, 1, 2].map(n => live.lines.reduce((sum, s) => sum + s.thresholds[n], 0)));
      assert.equal(decodeWire(wire), restaurant, 'memoized per snapshot');
      const last = live.lines.at(-1)!.players.at(-1)!.id;
      assert.equal(kitchenOf(restaurant, last).line, live.lines.length - 1); assert.equal(kitchenOf(restaurant, null).line, 0);
    });
    assert.ok(checked > 50);
  }
});

test('a snapshot stays small: the roster rides once, and 64 chefs cost a phone less than ten used to', () => {
  const sizes: Record<number, number> = {};
  for (const players of [10, 32, 64]) {
    const service = crew(players, { level: 2 });
    let most = 0, total = 0, count = 0;
    cook(service, 60, live => { const size = moving(rules.publicView(live, CTX)); most = Math.max(most, size); total += size; count++; });
    sizes[players] = Math.round(total / count);
    const wire = rules.publicView(service, CTX);
    assert.equal(wire.rev, 1); assert.equal(wire.final, null); assert.equal(wire.base.roster.length, players);
    assert.ok(most < ({ 10: 1500, 32: 4000, 64: 8000 } as Record<number, number>)[players], `${players} chefs: largest snapshot ${most} bytes`);
    assert.ok(JSON.stringify(wire).length < 32 * 1024, 'the first, uncached snapshot fits one message');
  }
  console.log(`# mean moving bytes per snapshot: ${JSON.stringify(sizes)} (JSON before this format: about 9200 at 10 chefs)`);
});

test('a seat privately gets only its acknowledgement and note; the end of service attaches stats and tallies once', () => {
  const service = crew(12, { level: 0, seconds: 150 }), first = service.lines[1].players[0];
  rules.tick(service, new Map([[first.id, { x: 0, y: 0, act: false, cmd: 'act', seq: 4 }]]), 1 / 60, 1016);
  assert.deepEqual(rules.playerView(service, first.id, CTX), { seq: 4, note: first.note, noteAt: first.noteAt });
  assert.ok(first.note); assert.equal(rules.playerView(service, 'nobody', CTX), null);
  assert.ok(decodeWire(rules.publicView(service, CTX)).lines[1].players[0].note === '', 'notes are not public');
  cook(service, 160);
  const wire = rules.publicView(service, { ...CTX, phase: 'results' }), restaurant = decodeWire(wire), outcome = rules.outcome(service);
  assertSerializable(wire); assertSerializable(outcome);
  assert.equal(wire.rev, 2); assert.ok(restaurant.lines.every(view => view.complete));
  // Results stay on screen for minutes at 20 snapshots a second: nothing but the clock travels then.
  assert.equal(wire.k, ''); assert.ok(moving(wire) < 60, `a results snapshot carries ${moving(wire)} bytes of kitchen`);
  service.lines.forEach((s, i) => same(restaurant.lines[i], lineView(s)));
  service.lines.forEach((s, i) => { assert.deepEqual(restaurant.lines[i].players.map(chef => chef.stats), s.players.map(c => c.stats)); assert.deepEqual(restaurant.lines[i].recipeCounts, s.recipeCounts); });
  assert.ok(restaurant.served >= 8, `two bot kitchens served ${restaurant.served}`);
  // Kitchens are ranked by coins; the leading kitchen wins the night and every chef's row carries their own kitchen's place.
  const scores = service.lines.map(s => s.score), ranks = rankScores(scores);
  assert.deepEqual(restaurant.ranks, ranks);
  assert.deepEqual(outcome.rows.map(row => [row.playerId, row.score, row.rank]), service.lines.flatMap((s, i) => s.players.map(c => [c.id, scores[i], ranks[i]])));
  assert.deepEqual(outcome.winners, service.lines.flatMap((s, i) => ranks[i] === 1 ? s.players.map(c => c.id) : []));
  assert.equal(outcome.complete, true);
});

test('a full room of 64 ticks eight kitchens well inside a 60 Hz step', () => {
  const service: Service = crew(MAX_ROOM_PLAYERS, { level: 7 });
  cook(service, 20);
  const inputs = new Map(service.lines.flatMap(s => s.players.map((c, i) => [c.id, { x: Math.cos(i), y: Math.sin(i), act: false, cmd: null, seq: 0 }] as const)));
  const steps = 1200, began = performance.now();
  for (let i = 0; i < steps; i++) { rules.tick(service, inputs, 1 / 60, service.lines[0].now + 1000 / 60); if (i % 3 === 0) rules.publicView(service, CTX); }
  const each = (performance.now() - began) / steps;
  console.log(`# 64 chefs: ${each.toFixed(3)} ms per step including a snapshot every third step`);
  assert.ok(each < 4, `${each.toFixed(2)} ms per step`);
});
