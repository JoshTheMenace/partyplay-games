/** Seated-host logic on the named fixtures: dock layers, sheet titles, ←/→ spot cycling and the hint. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_NAMES, loadFixture, type FixtureName } from '../fixtures/index';
import { HOME, type Screen } from '../../src/ui/controller/context';
import { route } from '../../src/ui/controller/logic';
import { layerOf, sheetTitle, spotHint, stepSpot } from '../../src/ui/personal/logic';

const layer = (name: FixtureName, seat: string, screen: Partial<Screen> = {}) =>
  layerOf(route(loadFixture(name).views[seat], { ...HOME, ...screen }));

test('placement and the robber pick on the board; menus and prompts raise the sheet', () => {
  assert.equal(layer('setup-4', 'p3'), 'pick');
  assert.equal(layer('seven-robber-4', 'p0'), 'pick');
  assert.equal(layer('mid-4', 'p0', { place: 'road' }), 'pick');
  assert.equal(layer('seven-discard-4', 'p1'), 'sheet');
  assert.equal(layer('seafarers-4', 'p1'), 'sheet', 'gold prompt');
  for (const tab of ['build', 'trade', 'cards'] as const) assert.equal(layer('mid-4', 'p0', { tab }), 'sheet');
  assert.equal(layer('mid-4', 'p0'), 'bar');
  assert.equal(layer('roll-3', 'p1'), 'bar');
  assert.equal(layer('mid-4', 'p1'), 'bar', 'an offer waits in a duty card, not a sheet');
  assert.equal(layer('finale-6', 'p2'), 'bar');
});

test('every fixture seat lands in exactly one layer', () => {
  for (const name of FIXTURE_NAMES) for (const [seat, me] of Object.entries(loadFixture(name).views)) {
    assert.ok(['pick', 'sheet', 'bar'].includes(layerOf(route(me, HOME))), `${name} ${seat}`);
  }
});

test('sheet titles name the menu; commands bring their own heading', () => {
  const me = loadFixture('mid-4').views.p0;
  assert.equal(sheetTitle(route(me, { ...HOME, tab: 'trade' }), me.task.title), 'Trade');
  const discard = loadFixture('seven-discard-4').views.p1;
  assert.equal(sheetTitle(route(discard, HOME), discard.task.title), discard.task.title);
  assert.equal(sheetTitle({ view: 'now' }, 'x'), null);
});

test('←/→ wraps through the spots and starts from the selection', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(stepSpot(ids, null, 1), 'a');
  assert.equal(stepSpot(ids, null, -1), 'c');
  assert.equal(stepSpot(ids, 'c', 1), 'a');
  assert.equal(stepSpot(ids, 'a', -1), 'c');
  assert.equal(stepSpot(ids, 'b', 1), 'c');
  assert.equal(stepSpot(ids, 'gone', 1), 'a');
  assert.equal(stepSpot([], 'a', 1), null);
});

test('the dock hint reads "Spot 3 of 12: …"', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `v${i}`);
  assert.equal(spotHint(ids, 'v2', 'Forest 6, Hills 8'), 'Spot 3 of 12: Forest 6, Hills 8');
  assert.match(spotHint(ids, null, null), /^12 spots · click the board/);
  assert.match(spotHint(['v1'], null, null), /^1 spot /);
});
