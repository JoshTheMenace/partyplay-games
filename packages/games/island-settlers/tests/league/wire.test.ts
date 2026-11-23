/** The wire: boards rebuilt in the browser match the engine's, and the new options behave as documented. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAX_ROOM_PLAYERS } from '../../../../party-contract/src/index';
import { assertSerializable } from '../../../../party-contract/src/serializable';
import { CONNECT_MIN_OPEN_SECONDS, SCENARIOS, type Settings } from '../../src/model';
import { validateSettings } from '../../src/settings';
import { HORN } from '../../src/engine/flow';
import { rules } from '../../src/server';
import { LeagueResults } from '../../src/ui/league/results';
import { LeaguePanel } from '../../src/ui/league/tv';
import { decodeBoard, encodeBoard, islandSettings } from '../../src/wire';
import { act as islandAct, game, pastSetup, rig, tick as islandTick } from '../helpers';
import { loadFixture } from '../fixtures/index';
import { roomOf } from '../fixtures/wire';
import { play, room, shared, START, tick } from './helpers';

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('a board on the wire rebuilds to the engine\'s board on every map and size', () => {
  const setups: Partial<Settings>[] = [
    {}, { map: 'seafarers', seafarers: 'new-shores' }, { map: 'seafarers', seafarers: 'four-islands' },
    { map: 'seafarers', seafarers: 'fog-islands' }, { map: 'explorers' }, { citiesKnights: true },
    { scenarios: [...SCENARIOS] }, { map: 'explorers', scenarios: ['fishing'], citiesKnights: true },
  ];
  let largest = 0;
  for (const settings of setups) for (const seats of [3, 4, 6, 10]) for (const seed of [1, 77]) {
    const board = game(seats, settings, seed).board, wire = plain(encodeBoard(board));
    assert.deepEqual(plain(decodeBoard(wire)), plain(board), `${JSON.stringify(settings)} at ${seats} seats`);
    largest = Math.max(largest, Buffer.byteLength(JSON.stringify(wire)));
    assert.ok(Buffer.byteLength(JSON.stringify(wire)) * 4 < Buffer.byteLength(JSON.stringify(board)), 'the wire form is the small one');
  }
  assert.ok(largest < 9000, `largest board on the wire: ${largest} B`);
});

test('settings: islands and quick start validate, and an archipelago island is timed Connect for four', () => {
  const s = validateSettings({});
  assert.equal(s.islands, 'one');
  assert.equal(s.quickStart, false);
  assert.throws(() => validateSettings({ islands: 'lots' }), /island format/);
  assert.throws(() => validateSettings({ quickStart: 'yes' }), /valid game options/);
  const many = validateSettings({ islands: 'many', timer: 'off', mode: 'standard', tableSize: 8 });
  assert.deepEqual(islandSettings(many, false), many, 'one island plays the host\'s settings');
  const island = islandSettings(many, true);
  assert.deepEqual([island.mode, island.tableSize, island.timer], ['connect', 4, 'relaxed']);
});

test('quick start places every starting piece at once and pays the second settlement', () => {
  for (const [seats, settings] of [[4, {}], [6, { mode: 'connect' }], [3, { citiesKnights: true }],
    [4, { map: 'seafarers' }]] as [number, Partial<Settings>][]) {
    const s = game(seats, { ...settings, quickStart: true });
    assert.equal(s.turn.stage, 'roll', `${seats} seats: play starts at the first roll`);
    assert.equal(s.turn.round, 1);
    for (const id of s.order) {
      const mine = Object.values(s.pieces.buildings).filter(b => b.seat === id).length;
      const routes = Object.values(s.pieces.routes).filter(r => r.seat === id).length;
      assert.equal(mine, 2, 'two buildings each');
      assert.equal(routes, 2, 'two routes each');
      assert.ok(Object.values(s.seats[id].hand).reduce((a, b) => a + b, 0) >= 1, 'starting resources were paid');
      assert.equal(s.stats.seats[id].timeouts, 0, 'nobody is marked as having missed a turn');
    }
    assert.ok(!s.events.some(e => e.kind === 'auto'));
  }
  const slow = game(4);
  assert.equal(slow.turn.stage, 'setup', 'without it the snake is played');
});

test('one island, Connect, five or more seats: the horn pulls the round in once most are done', () => {
  const s = game(6, { mode: 'connect', roundSeconds: 120 });
  pastSetup(s);
  rig(s, [2, 3]);
  islandAct(s, s.turn.active!, { type: 'roll' });
  const opened = s.turn.openedAt, need = Math.ceil(HORN.share * 6), round = s.turn.round;
  s.order.slice(0, need - 1).forEach(id => islandAct(s, id, { type: 'end' }));
  assert.equal(s.turn.hornAt, null);
  assert.ok(Object.values(s.timers).every(t => t.deadline === opened + 120_000));
  islandAct(s, s.order[need - 1], { type: 'end' }, opened + 5000);
  assert.equal(s.turn.hornAt, opened + 5000);
  assert.ok(Object.values(s.timers).every(t => t.deadline === opened + 5000 + HORN.seconds * 1000));
  const horn = s.events.find(e => e.kind === 'horn');
  assert.ok(horn && horn.kind === 'horn' && horn.seconds === HORN.seconds);
  islandTick(s, opened + 5000 + HORN.seconds * 1000);
  assert.equal(s.turn.round, round + 1, 'the round ended on the horn, not the two-minute clock');
  assert.equal(s.turn.hornAt, null, 'a new round starts without it');

  // Four seats keep their whole window: three done does not rush the fourth.
  const small = game(4, { mode: 'connect', roundSeconds: 60 });
  pastSetup(small);
  rig(small, [2, 3]);
  islandAct(small, small.turn.active!, { type: 'roll' });
  small.order.slice(0, 3).forEach(id => islandAct(small, id, { type: 'end' }));
  assert.equal(small.turn.hornAt, null);
  islandTick(small, small.turn.openedAt + CONNECT_MIN_OPEN_SECONDS * 1000 + 100);
  assert.equal(small.turn.stage, 'round');
});

test('an archipelago plays every map and expansion: a few rounds without a stall or a leak', () => {
  const setups: Partial<Settings>[] = [
    { map: 'seafarers', seafarers: 'new-shores' }, { map: 'seafarers', seafarers: 'fog-islands' },
    { citiesKnights: true }, { map: 'explorers' }, { scenarios: ['fishing', 'rivers'] },
    { scenarios: ['caravans'] }, { scenarios: ['barbarian-attack'] }, { scenarios: ['deliveries'] },
    { variants: ['friendly-robber', 'harbormaster'], balancedDice: true },
  ];
  for (const [i, settings] of setups.entries()) {
    const l = room(11, { ...settings, quickStart: i % 2 === 0, timer: 'brisk', roundSeconds: 60 });
    const label = JSON.stringify(settings);
    let largest = 0;
    play(l, { seed: i + 1, paceMs: 500, maxMs: 9 * 60_000, every: 30, watch(_l, _now, view) {
      largest = Math.max(largest, Buffer.byteLength(JSON.stringify(view)));
    } });
    const rounds = l.islands.map(s => s.turn.round);
    assert.equal(new Set(rounds).size, 1, `${label}: islands stayed together (${rounds})`);
    assert.ok(rounds[0] >= 4, `${label}: ${rounds[0]} rounds in nine minutes`);
    assert.equal(new Set(l.islands.map(s => JSON.stringify(s.stats.dice))).size, 1, `${label}: one dice history`);
    assertSerializable(shared(l, START));
    assert.ok(largest < 32 * 1024, `${label}: shared view ${largest} B`);
  }
});

test('the league panel and the room results render at every size up to the cap', () => {
  const fixture = loadFixture('ended-6');
  for (const seats of [12, 32, MAX_ROOM_PLAYERS]) {
    const islands = Math.ceil(seats / fixture.pub.seats.length), view = roomOf(fixture.pub, { islands }).league;
    const panel = renderToStaticMarkup(createElement(LeaguePanel, { league: view, shown: 0, height: 764, serverNowMs: () => 0 }));
    for (const card of view.islands) assert.ok(panel.includes(card.name), `${seats}: ${card.name} is on the rail`);
    assert.ok(panel.includes('Room leaders'));
    const outcome = { complete: true, winners: view.results!.winners, rows: [] };
    const results = renderToStaticMarkup(createElement(LeagueResults, { league: view, outcome, playerId: view.islands[1].seats[0][0] }));
    for (const card of view.islands) for (const [, name] of card.seats) assert.ok(results.includes(name), `${seats}: ${name} is ranked`);
    assert.ok(results.includes("You placed"));
    assert.ok(results.includes('Room awards'));
  }
});

test('the room plays one island through the same wire: a full four-seat game', () => {
  const l = room(4, { targetPoints: 8 });
  assert.equal(l.shared, false);
  const { rejected } = play(l, { seed: 3 });
  assert.ok(rules.outcome(l).complete);
  assert.deepEqual(rejected, [], 'no move chosen on a current view is refused');
  const view = shared(l, START).league;
  assert.equal(view.results, null, 'room results are an archipelago thing');
  assert.ok(view.island.results, 'the island carries its own');
  tick(l, l.islands[0].now + 100);
});
