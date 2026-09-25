import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameClientModule } from '../../../party-ui/src/index';
import type { Action, ClientProps, Input, PrivateView, PublicView, Settings } from '../src/contracts';
import { AUGMENTS, SYSTEMS, WEAPONS } from '../src/defs/catalog';
import { PLAYER_HULLS } from '../src/defs/hulls';
import { NAMES, NOW, SCREENS } from './fixtures/screens';

/** Bundle browser entry points the way the client build does (CSS stripped) and report every source file they pull in. */
async function load<T>(entry: string) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, metafile: true, logLevel: 'silent' });
  const module = { exports: {} as T };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return { exports: module.exports, inputs: Object.keys(result.metafile!.inputs) };
}
const { exports: display, inputs } = await load<{ Display: ComponentType<ClientProps> }>('../src/display/index.tsx');
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const render = (view: PublicView) => decode(renderToStaticMarkup(createElement(display.Display, { publicView: view, serverNowMs: () => NOW, viewRole: 'display', playerId: null } as unknown as ClientProps)));
const has = (html: string, ...texts: string[]) => { for (const text of texts) assert.ok(html.includes(text), `missing ${JSON.stringify(text)}`); };
const count = (html: string, text: string) => html.split(text).length - 1;

test('browser display code never pulls in server-only modules', () => {
  assert.deepEqual(inputs.filter(path => /starship-scramble\/src\/(content|sim|run|server)/.test(path)), []);
});

test('every fixture screen renders without throwing', () => {
  for (const [name, make] of Object.entries(SCREENS)) assert.ok(render(make()).includes(`ss-phase-${make().phase}`), name);
});

test('hangar shows chosen hulls with stats and asks the rest to choose', () => {
  const full = render(SCREENS['hangar-4']());
  has(full, ...NAMES, 'Wayfarer', 'Halcyon', 'Bulwark', 'Lancer', 'Autopilot', 'Burst Laser', 'Pike Beam', 'Waiting for captains', '2/3');
  assert.equal(count(full, 'Choosing a ship…'), 0);
  assert.equal(count(render(SCREENS['hangar-0']()), 'Choosing a ship…'), 4);
  assert.equal(count(render(SCREENS['hangar-3']()), 'Choosing a ship…'), 1);
});

test('map draws every beacon, link, vote and the Armada front', () => {
  const view = SCREENS.map(), html = render(view);
  assert.equal(count(html, 'class="ss-node '), view.map.nodes.length);
  assert.equal(count(html, 'class="ss-link '), view.map.nodes.reduce((n, node) => n + node.links.length, 0));
  assert.equal(count(html, 'ss-link-reach'), 2);
  has(html, 'The Veil', 'Sector 2 of 3', 'Jumping in', '3/4 voted', 'Crimson Armada', `Votes: ${NAMES[0]}, ${NAMES[1]}`, `Votes: ${NAMES[2]}`, 'Distress', 'Hostile', '2</b><small>reserves');
  assert.equal(count(html, 'ss-node-overrun'), view.map.nodes.filter(n => n.col <= view.map.armadaCol).length);
  has(render(SCREENS['map-start']()), 'Vote for the next beacon', '0/2 voted');
  assert.equal(count(render(SCREENS['map-start']()), 'ss-node-overrun'), 0);
  has(render(SCREENS['map-final']()), 'Flagship', 'Meridian Deep', 'Sector 3 of 3');
});

test('event shows the full 280-character text, four choices with badges and votes, then results', () => {
  const view = SCREENS.event(), html = render(view);
  assert.equal(view.event!.text.length, 280);
  has(html, view.event!.title, view.event!.text, ...view.event!.choices.map(c => c.label), 'Teleporter', 'Engines 3', 'Bastion crew', "Your fleet can't do this yet", 'Deciding in', '3/4 voted');
  assert.equal(count(html, 'ss-choice-lead'), 1);
  const done = SCREENS['event-result'](), result = render(done);
  has(result, done.event!.result!, ...done.event!.resultLines, "Tap Continue when you're ready", '2/4');
  assert.equal(count(result, 'ss-line-good'), 3); assert.equal(count(result, 'ss-line-bad'), 2);
});

test('loot shows the scrap split, all six items and who claimed what', () => {
  const view = SCREENS.loot(), html = render(view);
  has(html, '+38', 'scrap to every captain', ...view.loot!.items.map(i => (i.kind === 'weapon' ? WEAPONS : AUGMENTS).find(d => d.id === i.defId)!.name), '1/4');
  assert.equal(count(html, '<em>claimed</em>'), 3);
  assert.equal(count(html, 'Up for grabs'), 3);
});

test('store shelves eight offers (one recruit) with prices, SOLD tags and services', () => {
  const view = SCREENS.store(), html = render(view);
  has(html, 'Trading Post', 'Flak Cannon', 'Breach Missile', 'Medic Pulse', 'Auto-Loader', 'Hull Welders', 'Missile Recycler', SYSTEMS.find(s => s.id === 'teleporter')!.name, 'Hull repair', 'Missiles', 'Bartholomew', 'Bastion Engineer');
  assert.equal(count(html, 'class="ss-card '), 8);
  assert.equal(count(html, '>Sold<'), 2);
  for (const o of view.store!.offers.filter(o => !o.soldTo)) has(html, `>${o.price}</b>`);
});

test('top bar marks disconnected captains as Autopilot and shows scrap', () => {
  const view = SCREENS.store(); view.captains[1].connected = false;
  const html = render(view);
  has(html, 'Autopilot', '>124</b>', '>260</b>', 'Sector 2/3');
});

test('victory and defeat debriefs list every captain and star tied leaders', () => {
  const win = render(SCREENS.victory()), loss = render(SCREENS.defeat());
  has(win, 'Victory', 'The Armada is broken', ...NAMES, ...PLAYER_HULLS.slice(0, 4).map(h => h.name), 'Ships lost', '612');
  assert.equal(count(win, 'aria-label="best"'), 6, 'damage tie stars both captains');
  has(loss, 'Defeat', 'The fleet is lost', 'wrecked');
});

// The client module pulls in the phone and audio owners' code; load it lazily so a broken sibling fails only these tests.
const clientModule = load<{ client: GameClientModule<Input, Action, Settings, PublicView, PrivateView> }>('../src/client.tsx').then(m => ({ client: m.exports.client, inputs: m.inputs }));
clientModule.catch(() => {});
test('client module is browser-safe and gates portrait to menus', async () => {
  const { client, inputs } = await clientModule;
  assert.deepEqual(inputs.filter(path => /starship-scramble\/src\/(content|sim|run|server)/.test(path)), []);
  assert.equal(client.immersivePhone, true);
  assert.equal(client.allowPortraitController!(null), false);
  for (const [name, make] of Object.entries(SCREENS)) assert.equal(client.allowPortraitController!(make()), true, name);
  assert.equal(client.allowPortraitController!({ ...SCREENS.map(), phase: 'combat' }), false);
});

test('settings, instructions and results render their copy', async () => {
  const { client } = await clientModule;
  const html = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(node).replace(/&#x27;/g, "'");
  const settings = html(createElement(client.SettingsView, { settings: { difficulty: 'cadet', length: 'standard' }, onChange() {}, disabled: false }));
  assert.match(settings, /aria-checked="true"[^>]*aria-label="Cadet difficulty/); assert.match(settings, /aria-checked="false"[^>]*aria-label="Short run/);
  assert.notEqual(html(createElement(client.InstructionsView, { role: 'display' })), html(createElement(client.InstructionsView, { role: 'controller' })));
  const results = html(createElement(client.ResultsView!, { outcome: { complete: true, winners: [], rows: [] }, publicView: SCREENS.defeat(), playerId: null }));
  for (const text of ['Defeat', ...NAMES, 'Damage']) assert.ok(results.includes(text), text);
});
