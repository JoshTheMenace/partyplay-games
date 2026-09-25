/** Lobby rules text, host wording and the seat row's gains slot. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MODULE_IDS } from '../../src/model';
import { SeatRow } from '../../src/ui/display/row';
import { tapText } from '../../src/ui/shared/format';
import { ALL_TOPICS, MODULE_HELP } from '../../src/ui/shared/help';
import { MISSION_NAMES, SEAFARERS_NAMES } from '../../src/ui/shared/labels';
import { loadFixture } from '../fixtures/index';

const text = (topics: { lines: string[] }[]) => topics.flatMap(t => t.lines).join('\n');

test('every module has rules, and the lobby lists every scenario and mission', () => {
  for (const id of MODULE_IDS) assert.ok(MODULE_HELP[id].lines.length > 0, id);
  const all = text(ALL_TOPICS);
  for (const name of [...Object.values(SEAFARERS_NAMES), ...Object.values(MISSION_NAMES)]) {
    assert.ok(all.includes(name), name);
  }
});

test('phone wording becomes mouse wording only on the host dock', () => {
  assert.equal(tapText('Build and trade, then tap Done', true), 'Build and trade, then click Done');
  assert.equal(tapText('Tap a card to give it', true), 'Click a card to give it');
  assert.equal(tapText('Tap a card', false), 'Tap a card');
  assert.equal(tapText('Tapestry', true), 'Tapestry');
});

test('the seat row reserves its own [data-seat-gains] slot after the stats', () => {
  const { pub, now } = loadFixture('ck-4'), seat = pub.seats[0];
  const html = renderToStaticMarkup(createElement(SeatRow,
    { pub, seat, height: 168, now, serverNowMs: () => now, vp: seat.vp, rank: null }));
  assert.match(html, /<span class="island-settlers-hud-gains-slot" data-seat-gains="p0"><\/span><\/p>/);
  assert.doesNotMatch(html, /hud-stats" data-seat-gains/);
});
