import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { PHASES, phoneCombat, phoneEvent, phoneProps } from './fixtures/phone';

register('data:text/javascript,export async function load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context); }');
const { Controller, Personal } = await import('../src/phone/index');
const html = (view = phoneCombat(), patch = {}, View = Controller) => renderToString(createElement(View, phoneProps(view, patch))).replaceAll('<!-- -->', '');

test('every phase renders on the phone and in the personal view', () => {
  for (const [name, make] of Object.entries(PHASES)) for (const View of [Controller, Personal]) assert.ok(html(make(), {}, View).length > 200, `${name} ${View.name}`);
});
test('combat cockpit shows status, tools, weapon cards, crew and fire', () => {
  const out = html();
  for (const text of ['HULL', 'Stations', 'Cloak', 'Teleport', 'Jump away (1/3 votes)', 'Pause battle', 'Burst Laser', 'HOLD', 'Nanite Lance', 'Unpowered', 'Fire', '1 ready', 'Away team', 'Wilhelmina']) assert.ok(out.includes(text), text);
});
test('paused, wrecked and disconnected states are explained', () => {
  assert.ok(html(PHASES.paused()).includes('Paused by Oskar'));
  assert.ok(html(PHASES.wrecked()).includes('Ship destroyed'));
  assert.ok(html(phoneCombat(), { connected: false }).includes('Reconnecting'));
});
test('spectators get a watching screen', () => {
  assert.ok(html(phoneCombat(), { playerId: 'nobody', privateView: { captainId: null } }).includes('Watching the battle'));
  assert.ok(html(phoneEvent(), { playerId: 'nobody', privateView: { captainId: null } }).includes('Watching the run'));
});
test('menus show votes, blue badges, disabled choices and results', () => {
  const ev = html(phoneEvent());
  for (const text of ['Teleporter', 'Needs Bastion crew', 'Screaming Derelict']) assert.ok(ev.includes(text), text);
  assert.ok(html(phoneEvent(true)).includes('Continue'));
  assert.ok(html(PHASES.map()).includes('Sector exit'));
  assert.ok(html(PHASES.store()).includes('Trading post'));
  assert.ok(html(PHASES.loot()).includes('Claimed by Mira'));
  assert.ok(html(PHASES.hangar()).includes('Launch ready'));
  assert.ok(html(PHASES.over()).includes('The Armada is broken'));
});
