import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFixture } from '../fixtures/index';
import { firstNames } from '../../src/ui/display/banner';
import {
  bannerDeadline, bannerSeats, eventSeat, finale, rowHeight, snake,
  statusBadge, statusText, tickerEvents, waiting,
} from '../../src/ui/display/logic';

const RAIL = 948; // layout rail height in u (980 − 2 × 16)

test('row heights follow EXPERIENCE §3.2 at 3, 6 and 10 seats', () => {
  assert.equal(rowHeight(RAIL, 3), 168);
  assert.ok(rowHeight(RAIL, 6) >= 110 && rowHeight(RAIL, 6) <= 119);
  assert.ok(rowHeight(RAIL, 10) >= 78 && rowHeight(RAIL, 10) <= 84);
  for (const n of [3, 4, 6, 7, 10]) {
    const table = n > 6 ? 0 : 128, used = 96 + 8 + table + n * rowHeight(RAIL, n) + 6 * (n - 1);
    assert.ok(used <= RAIL + 0.01, `${n} seats fit the rail`);
  }
});

test('setup snake: round 1 forward, round 2 back, caret on the placer', () => {
  const { pub } = loadFixture('setup-4');
  assert.deepEqual(snake(pub).rows, [['p0', 'p1', 'p2', 'p3'], ['p3', 'p2', 'p1', 'p0']]);
  assert.deepEqual(snake(pub).at, [0, 3]);
  pub.turn.setup = { ...pub.turn.setup!, seat: 'p1', round: 2 };
  assert.deepEqual(snake(pub).at, [1, 2]);
});

test('status words and badges come from prompts, presence and seat status', () => {
  const { pub, now } = loadFixture('seven-discard-4');
  const [roller, bo] = pub.seats;
  assert.equal(statusText(pub, bo, now), 'Discarding 4');
  assert.deepEqual(statusBadge(pub, bo), { kind: 'owed', count: 4 });
  assert.equal(statusText(pub, roller, now), '');
  Object.assign(bo, { connected: false, deadline: now + 42_000 });
  assert.equal(statusText(pub, bo, now), 'Offline: auto-plays in 0:42');
  assert.equal(statusBadge(pub, bo)?.kind, 'offline');
  const { pub: table } = loadFixture('connect-6');
  assert.equal(statusBadge(table, table.seats[1])?.kind, 'ready');
  assert.equal(statusBadge(table, table.seats[5])?.kind, 'thinking');
  assert.equal(statusText(table, table.seats[0], 0), '', '"Playing" is never printed');
});

test('banner seats, deadline and the waiting list', () => {
  const seven = loadFixture('seven-discard-4').pub;
  assert.deepEqual(bannerSeats(seven), ['p0'], 'three discarders: the chip is the roller');
  assert.equal(bannerDeadline(seven), seven.clock!.deadline);
  assert.deepEqual(waiting(seven).map(w => [w.seat, w.count]), [['p1', 4], ['p2', 5], ['p3', 4]]);
  assert.deepEqual(bannerSeats(loadFixture('concurrent-8').pub), ['p2', 'p6']);
  assert.deepEqual(bannerSeats(loadFixture('connect-6').pub), []);
  const done = loadFixture('finale-6').pub;
  assert.deepEqual(bannerSeats(done), ['p2']);
  assert.equal(bannerDeadline(done), null);
});

test('finale: totals land seat by seat, then the rail sorts by rank', () => {
  const { pub } = loadFixture('finale-6'), at = pub.results!.finaleAt;
  assert.equal(finale(pub, at + 100, false)!.vp.p2, pub.seats[2].vp, 'nothing revealed before 0.8 s');
  const mid = finale(pub, at + 800 + 2 * 500, false)!;
  assert.equal(mid.vp.p2, pub.results!.standings.find(s => s.seat === 'p2')!.vp);
  assert.equal(mid.vp.p4, pub.seats[4].vp, 'p4 not yet');
  assert.equal(mid.ranks, null);
  const end = finale(pub, at + 800 + 6 * 500, false)!;
  assert.equal(end.order[0], 'p2');
  assert.equal(end.ranks!.p2, 1);
  assert.deepEqual(finale(pub, at + 800, true)!.order, end.order, 'reduced motion: final at 0.8 s');
  assert.equal(finale(loadFixture('mid-4').pub, 0, false), null);
});

test('ticker: three newest, newest first, no offer/turn/move noise', () => {
  const { pub } = loadFixture('offers-12'), lines = tickerEvents(pub.events);
  assert.ok(lines.length <= 3 && lines.every(e => !['offer', 'turn', 'move'].includes(e.kind)));
  const all = tickerEvents(loadFixture('setup-4').pub.events);
  assert.equal(all.length, 3);
  assert.ok(all[0].id > all[1].id && all[1].id > all[2].id);
  assert.equal(eventSeat(all[0]), 'p2');
});

test('a long discard subline falls back to first names so every seat stays listed', () => {
  const { pub } = loadFixture('seven-discard-4');
  pub.seats[0].name = 'Constance Wright';
  pub.seats[1].name = 'Gwendolyn Hartley';
  const text = 'Discarding: Constance Wright (4), Gwendolyn Hartley (5)';
  assert.equal(firstNames(pub, text), 'Discarding: Constance (4), Gwendolyn (5)');
});
