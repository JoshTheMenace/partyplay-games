/** Controller logic on the named fixtures: routing, payout copy, command fields, drafts. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CardsField, Field, PrivateView } from '../../src/model';
import { FIXTURE_NAMES, loadFixture, type FixtureName } from '../fixtures/index';
import { HOME, useDraftIn, type Screen } from '../../src/ui/controller/context';
import {
  answerOf, buildStatus, counterText, fieldsReady, hintChips, payout, robberFields, route, usable,
} from '../../src/ui/controller/logic';

const view = (name: FixtureName, seat?: string) => {
  const f = loadFixture(name);
  return { pub: f.pub, me: f.views[seat ?? f.seat] };
};
const at = (me: PrivateView, screen: Partial<Screen> = {}) => route(me, { ...HOME, ...screen }).view;

test('route picks the screen from the task, private duties first', () => {
  assert.equal(at(view('mid-4', 'p0').me), 'now');
  assert.equal(at(view('mid-4', 'p0').me, { tab: 'build' }), 'build');
  assert.equal(at(view('mid-4', 'p0').me, { place: 'road' }), 'place');
  assert.equal(at(view('mid-4', 'p1').me), 'wait');
  assert.equal(at(view('mid-4', 'p1').me, { tab: 'trade' }), 'trade', 'responders reach the trade panel');
  assert.equal(at(view('mid-4', 'p1').me, { tab: 'build' }), 'wait', 'no build menu off-turn');
  assert.equal(at(view('roll-3', 'p1').me), 'roll');
  assert.equal(at(view('seven-discard-4', 'p1').me, { tab: 'build' }), 'prompt', 'prompts win over tabs');
  assert.equal(at(view('seven-robber-4', 'p0').me), 'robber');
  assert.equal(at(view('ck-4', 'p2').me), 'prompt');
  assert.equal(at(view('seafarers-4', 'p1').me), 'prompt');
  assert.equal(at(view('finale-6', 'p2').me), 'finale');
  assert.equal(at(view('ended-6', 'p0').me), 'finale');
  assert.deepEqual(route(view('setup-4', 'p3').me, HOME), { view: 'setup', piece: 'settlement' });
  assert.equal(at(view('setup-4', 'p0').me), 'wait');
  assert.equal(at(view('ck-4', 'p0').me, { command: 'cities-knights/improve' }), 'command');
  assert.equal(at(view('seafarers-4', 'p0').me, { place: 'move' }), 'move');
});

test('a city setup step offers the city, not the settlement it also accepts', () => {
  const { me } = view('setup-4', 'p3'), city = me.build.find(o => o.piece === 'city')!;
  Object.assign(city, { free: 1, targets: me.build.find(o => o.piece === 'settlement')!.targets });
  me.task.title = 'Place a city';
  assert.deepEqual(route(me, HOME), { view: 'setup', piece: 'city' });
});

test('robber fields: the hex field sits under the chosen piece when robber and pirate can both move', () => {
  const hex = (key: string, value: string): Field => ({ kind: 'pick', key, label: 'Hex', target: 'tile',
    options: [{ value, label: value }] });
  // oxlint-disable-next-line unicorn/no-thenable -- Choice.then is the contract's dependent-field list.
  const choice = (value: string) => ({ value, label: value, then: [hex('tile', `${value}-hex`)] });
  const fields: Field[] = [{ kind: 'pick', key: 'piece', label: 'Piece',
    options: [choice('robber'), choice('pirate')] }];
  assert.deepEqual(robberFields(fields, {}).lead.map(f => f.key), ['piece']);
  assert.equal(robberFields(fields, {}).hexes, undefined, 'no map until a piece is picked');
  assert.equal(robberFields(fields, { piece: 'pirate' }).hexes?.options[0].value, 'pirate-hex');
  const one = robberFields([hex('tile', 't1')], {});
  assert.deepEqual([one.lead.length, one.hexes?.key], [0, 'tile'], 'one piece: straight to the map');
});

test('owed Road Building placements take over the Now tab until skipped', () => {
  const { me } = view('mid-4', 'p0');
  me.build = me.build.map(o => (o.piece === 'road' ? { ...o, free: 2, missing: {}, why: null } : o));
  assert.deepEqual(route(me, HOME), { view: 'free', piece: 'road' });
  assert.equal(at(me, { skipFree: true }), 'now');
  assert.equal(at(me, { tab: 'cards' }), 'cards');
});

test('every fixture seat routes somewhere and never throws', () => {
  for (const name of FIXTURE_NAMES) {
    const f = loadFixture(name);
    for (const me of Object.values(f.views)) assert.ok(at(me), `${name}/${me.seat}`);
  }
});

test('payout copy', () => {
  const { pub } = view('connect-6', 'p0'), line = payout(pub, 'p0')!;
  assert.equal(line.tone, 'gain');
  assert.match(line.text, /^\+2 brick from 6$/);
  pub.lastRoll = { ...pub.lastRoll!, total: 7, grants: [] };
  assert.equal(payout(pub, 'p0')!.tone, 'seven');
  pub.lastRoll = null;
  assert.equal(payout(pub, 'p0'), null);
});

test('build hints', () => {
  const { me } = view('mid-4', 'p0');
  const waiting = view('mid-4', 'p1');
  const chips = hintChips(waiting.me);
  assert.ok(chips.length <= 3 && chips.every(c => /ready$|: need /.test(c)));
  const ck = view('ck-4', 'p0').me.build.find(o => o.piece === 'settlement')!;
  assert.equal(buildStatus(ck, 10), 'Need 3 cards');
  assert.equal(me.build.filter(usable).map(o => o.piece).join(), 'road,city,development');
});

test('command fields: dependents follow their choice and stale picks are dropped', () => {
  const fields: Field[] = [{
    kind: 'pick', key: 'tile', label: 'Hex', target: 'tile', options: [
      // oxlint-disable-next-line unicorn/no-thenable -- Choice.then is the contract's dependent-field list.
      { value: 't1', label: 'Hills 8', then: [{ kind: 'pick', key: 'victim', label: 'Rob', target: 'seat',
        options: [{ value: 'p1', label: 'Bo' }, { value: 'p2', label: 'Cy' }] }] },
      { value: 't2', label: 'Desert' },
    ],
  }];
  assert.equal(fieldsReady(fields, { tile: 't1' }, {}), false, 'victim still owed');
  assert.equal(fieldsReady(fields, { tile: 't1', victim: 'p2' }, {}), true);
  assert.deepEqual(answerOf(fields, { tile: 't2', victim: 'p2' }, {}).picks, { tile: 't2' });
  const cards: CardsField = {
    kind: 'cards', key: 'cards', label: 'Pick 4', source: 'hand', allowed: ['wood', 'ore'],
    available: { wood: 3, ore: 1 }, min: 4, max: 4,
  };
  assert.equal(fieldsReady([cards], {}, { cards: { wood: 3, ore: 1 } }), true);
  assert.equal(fieldsReady([cards], {}, { cards: { wood: 2, ore: 2 } }), false, 'over the available ore');
  assert.equal(counterText(1, cards, 'Discard'), 'Discard 3 more');
  assert.equal(counterText(4, cards, 'Discard'), 'Ready: discard 4');
});

test('drafts survive a reload for the same room, round, player and turn only', () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, { sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  } });
  const scope = { roomId: 'R', roundId: 'r1', playerId: 'p0', turnId: 7 };
  let setter: ((v: string) => void) | null = null;
  const Probe = ({ turnId, player = 'p0' }: { turnId: number; player?: string }) => {
    const [value, set] = useDraftIn({ ...scope, turnId, playerId: player }, 'spot', 'none');
    setter = set;
    return createElement('b', null, value);
  };
  renderToStaticMarkup(createElement(Probe, { turnId: 7 }));
  setter!('v12');
  assert.equal(renderToStaticMarkup(createElement(Probe, { turnId: 7 })), '<b>v12</b>');
  assert.equal(renderToStaticMarkup(createElement(Probe, { turnId: 8 })), '<b>none</b>', 'new turn starts fresh');
  assert.equal(renderToStaticMarkup(createElement(Probe, { turnId: 7, player: 'p1' })), '<b>none</b>');
});
