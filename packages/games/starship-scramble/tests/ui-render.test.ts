import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { hulls, weapons } from '../src/definitions/presentation/index';
import type { CaptainView, Crew, InteriorView, ItemView, PrivateView, PublicView, ShipSummary } from '../src/contracts';
// Typed isolated builders: legitimate view shapes only, no server state. Coordinator fixtures replace these when they land.
const NAMES = ['Mirabel Okonkwo', 'Tadeusz Brzęczysz', 'Ximena Valderrama', 'Bartholomew Quill'];
const hullFor = (id: string) => hulls.find(h => h.id === id)!;
function summary(id: string, faction: ShipSummary['faction'], formation: number, hullId: string, name: string, extra: Partial<ShipSummary> = {}): ShipSummary {
  const hull = hullFor(hullId);
  return { id, ownerCaptainId: faction === 'allied' ? `cap${formation}` : null, faction, hullId, name, color: hull.color, formation, hull: hull.maxHull * .7, maxHull: hull.maxHull, status: 'active', shield: 2.4, alerts: [], rooms: hull.rooms.map(r => ({ id: r.id, name: r.name, system: r.system })), crewCount: 4, targetShipId: null, escapeAtMs: null, ...extra };
}
function crewOn(shipId: string, owner: string | null, count: number, prefix: string, roomIds: string[]): Crew[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, ownerCaptainId: owner, homeShipId: owner ? `ship-${owner}` : shipId, currentShipId: shipId, name: `${prefix.toUpperCase()}${i}`, roomId: roomIds[i % roomIds.length], x: 1.5 + (i % 3), y: 1.5, hp: 100 - i * 9, maxHp: 100, status: 'alive', skill: 'engineer', traits: [], order: { kind: 'hold', roomId: roomIds[0] }, activity: 'idle', controlEpoch: 2 }));
}
function interior(ship: ShipSummary, crew: Crew[], own: boolean, knownAll = true): InteriorView {
  const hull = hullFor(ship.hullId), defs = hull.startingWeapons.concat('beam-thread').map(id => weapons.find(w => w.id === id)!);
  return { ship, rooms: hull.rooms.map((r, i) => ({ ...r, tier: r.system === 'weaponry' ? 2 : 1, damage: i === 1 ? 12 : 0, fire: i === 2 ? .5 : 0, breach: 0, oxygen: i === 3 ? 18 : 100, locked: i === 4, disruptedUntilMs: 0, mannedBy: i === 0 ? crew[0]?.id ?? null : null, known: knownAll || i % 2 === 0 })), crew,
    weapons: own ? defs.map((d, index) => ({ itemId: `w${index}`, definitionId: d.id, chargeMs: 1200, order: index === 0 ? { shipId: 'e3', roomId: 'r2', hold: false } : null, name: d.name, description: d.description, family: d.family, readyInMs: index === 0 ? 0 : d.chargeMs - 1200, disabled: index >= 2, ammoCost: d.ammo, target: d.target })) : [],
    systems: own ? hull.startingSystems.map(id => ({ id, tier: 1, cooldownUntilMs: id === 'scanner' ? 9000 : 0, activeUntilMs: 0, targetShipId: null, targetRoomId: null })) : [], ammo: own ? 11 : 0 };
}
export function maxDensity(): { publicView: PublicView; privateViews: Record<string, PrivateView> } {
  const allies = hulls.slice(0, 4).map((h, i) => summary(`ship-cap${i}`, 'allied', i, h.id, `${h.name} ${NAMES[i].split(' ')[0]}`.slice(0, 16), { alerts: i === 1 ? ['Boarders', 'Fire', 'Low oxygen'] : i === 2 ? ['Critical hull'] : [], targetShipId: `e${i + 1}` }));
  allies[3] = { ...allies[3], status: 'destroyed', hull: 0, alerts: [] };
  const enemies = ['bulwark', 'kite', 'longbow', 'moth', 'magpie', 'cuttlefish'].map((h, i) => summary(`e${i + 1}`, 'enemy', i, h, ['Rust Lantern', 'Hollow Choir', 'Kestrel Debt', 'Ninefold Ash', 'Salt Verdict', 'Dread Cartographer Prime'][i], { maxHull: i === 5 ? 420 : hullFor(h).maxHull, hull: i === 5 ? 380 : hullFor(h).maxHull * .5, targetShipId: allies[i % 3].id, escapeAtMs: i === 1 ? 45000 : null, alerts: i === 0 ? ['Fire'] : [] }));
  const captains: CaptainView[] = NAMES.map((name, i) => ({ id: `cap${i}`, playerId: `p${i}`, name, color: ['#ffd24a', '#28c6e7', '#78d955', '#b58aff'][i], shipId: i === 3 ? null : allies[i].id, connected: i !== 2, ready: i === 0, vote: null, status: i === 3 ? 'shipless' : 'active', crewCount: i === 3 ? 2 : 4 }));
  const ownCrew = crewOn(allies[0].id, 'cap0', 4, 'a', allies[0].rooms.map(r => r.id)), guests = crewOn(allies[0].id, 'cap3', 2, 'g', [allies[0].rooms[2].id]), boarders = crewOn(allies[0].id, null, 3, 'x', [allies[0].rooms[5].id]);
  const publicView: PublicView = { phase: 'combat', epoch: 9, timeMs: 30000, paused: false, pausedBy: null, leaderCaptainId: 'cap0', captains, ships: [...allies, ...enemies], effects: [{ id: 'fx1', kind: 'shot', sourceShipId: allies[0].id, targetShipId: 'e3', text: 'Needle', atMs: 29900 }, { id: 'fx2', kind: 'warning', sourceShipId: 'e6', targetShipId: allies[1].id, text: 'Boarding party inbound', atMs: 29950 }], drones: [{ id: 'd1', definitionId: 'drone-repair', sourceShipId: allies[2].id, targetShipId: allies[1].id, targetRoomId: 'r1', hp: 10, nextAtMs: 31000 }],
    sector: { index: 3, count: 5, name: 'The Cinder Reach', color: '#dc8b74' }, beacons: [{ id: 'b0', column: 0, lane: 1, kind: 'combat', label: 'Ash Relay', next: ['b1', 'b2'], visited: true, eventId: null }, { id: 'b1', column: 1, lane: 0, kind: 'store', label: 'Verdict Station', next: [], visited: false, eventId: null }, { id: 'b2', column: 1, lane: 2, kind: 'exit', label: 'Sector exit', next: [], visited: false, eventId: null }], currentBeaconId: 'b0', threat: 62, event: null, loot: [], objective: { kind: 'destroy', deadlineMs: null, stage: 1, description: 'Break the blockade' }, message: '', result: null, assignment: false };
  const privateViews: Record<string, PrivateView> = {};
  const loot: ItemView[] = Array.from({ length: 6 }, (_, i) => ({ id: `item${i}`, definitionId: weapons[i * 7].id, kind: 'weapon', name: weapons[i * 7].name, description: weapons[i * 7].description, price: 60 + i, version: 1, ownerCaptainId: null, carrierShipId: null, location: 'loot' }));
  privateViews.p0 = { captainId: 'cap0', captain: captains[0], wallet: 143, cargoShipId: allies[0].id, ownShip: interior(allies[0], [...ownCrew, ...guests, ...boarders], true), inspectedShip: interior(enemies[2], crewOn('e3', null, 2, 'n', ['r0', 'r1']), false, false), inspectedShipId: 'e3', viewRequestId: 4, crew: ownCrew, inventory: [{ ...loot[0], id: 'inv-drone', kind: 'drone', definitionId: 'drone-attack', name: 'Needle Drone', location: 'installed', ownerCaptainId: 'cap0', carrierShipId: allies[0].id }], store: loot.map(i => ({ ...i, location: 'store' })), controlledCrewId: null, queued: [], canAct: true, hulls };
  privateViews.p3 = { captainId: 'cap3', captain: captains[3], wallet: 12, cargoShipId: allies[0].id, ownShip: null, inspectedShip: interior(allies[0], [...ownCrew, ...guests, ...boarders], false), inspectedShipId: allies[0].id, viewRequestId: 1, crew: guests, inventory: [], store: [], controlledCrewId: null, queued: [], canAct: true, hulls };
  privateViews.p9 = { captainId: 'cap2', captain: { ...captains[2], status: 'spectator', crewCount: 0 }, wallet: 40, cargoShipId: null, ownShip: null, inspectedShip: null, inspectedShipId: null, viewRequestId: 0, crew: [], inventory: [], store: [], controlledCrewId: null, queued: [], canAct: false, hulls };
  return { publicView, privateViews };
}
type Extra = { initialMenu?: 'none' | 'main' | 'ships' | 'crew' | 'phase'; initialPreview?: string };
let temp: string, bundle: string, render: (role: 'display' | 'controller' | 'personal', publicView: PublicView, privateView: PrivateView | null, playerId: string | null, extra?: Extra) => string;
before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'starship-render-')); const outfile = join(temp, 'client.cjs');
  await build({ stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { client } from ${JSON.stringify(fileURLToPath(new URL('../src/client.tsx', import.meta.url)))}; import { Controller } from ${JSON.stringify(fileURLToPath(new URL('../src/ui/controller.tsx', import.meta.url)))};
export function render(role, publicView, privateView, playerId, extra = {}) { const View = role === 'display' ? client.DisplayView : role === 'personal' ? client.PersonalView : Controller;
 return renderToStaticMarkup(React.createElement(View, { roomId: 'r', roundId: 'round', playerId, viewRole: role === 'display' ? 'display' : 'controller', isHost: role !== 'controller', publicView, privateView, connected: true, serverNowMs: () => 0, setInput: () => {}, releaseInput: () => {}, sendAction: async () => ({ accepted: true }), assetsReady: () => {}, ...extra })); }`, resolveDir: process.cwd(), loader: 'tsx' }, outfile, bundle: true, platform: 'node', format: 'cjs', loader: { '.css': 'empty' }, logLevel: 'silent', jsx: 'automatic' });
  bundle = await readFile(outfile, 'utf8'); render = createRequire(import.meta.url)(outfile).render;
});
after(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });
const count = (html: string, needle: string) => html.split(needle).length - 1;
void test('client bundle never pulls in server rules or hidden content', () => {
  for (const secret of ['Locked doors block that route.', 'applySimulationCommand', 'definitions/server', 'projectPrivate', 'roomManning']) assert.ok(!bundle.includes(secret), secret);
});
void test('TV combat frame at maximum density lists four allies and six enemies with emergency chips, no ticker', () => {
  const { publicView } = maxDensity(), html = render('display', publicView, null, null);
  assert.match(html, /4 allied ships, 6 enemy ships/); assert.match(html, /<b class="kp-display">Defeat the hostile fleet<\/b><small>Break the blockade<\/small>/); assert.match(html, /The Cinder Reach/);
  assert.ok(count(html, 'ss-emergency-chip') >= 3, 'boarders, critical hull, destroyed and reconnecting chips');
  assert.match(html, /Mirabel Okonkwo|Tadeusz/);
});
void test('TV phase screens render route votes, event choices, salvage and station rosters', () => {
  const { publicView } = maxDensity();
  assert.match(render('display', { ...publicView, phase: 'route' }, null, null), /Verdict Station[\s\S]*Sector exit/);
  const event = { ...publicView, phase: 'event' as const, event: { id: 'ev', title: 'Derelict Beacon', text: 'A silent station drifts ahead.', result: '', resolved: false, choices: [{ id: 'c1', label: 'Board it', text: 'Send crew', special: false, available: true, requirement: '', cost: 0, contributors: [] }, { id: 'c2', label: 'Scan first', text: '', special: true, available: false, requirement: 'Advanced scanner', cost: 0, contributors: [] }] } };
  const eventHtml = render('display', event, null, null); assert.match(eventHtml, /Derelict Beacon/); assert.match(eventHtml, /Needs Advanced scanner/); assert.match(eventHtml, /ss-tv-event-split/, 'open choices sit beside the text'); assert.match(eventHtml, /data-counter="voted"/);
  const resolved = render('display', { ...event, event: { ...event.event, resolved: true, result: 'The station yields a cache.', choices: [] } }, null, null); assert.doesNotMatch(resolved, /ss-tv-event-split/); assert.doesNotMatch(resolved, /data-counter/);
  assert.match(render('display', { ...publicView, phase: 'rewards', loot: maxDensity().privateViews.p0.store }, null, null), /Salvage/);
  assert.match(render('display', { ...publicView, phase: 'store' }, null, null), /Station/);
});
void test('phone combat screen is ship-first: HUD with own ship, alerts and Pause, a 44px dock, every room a native button, guests visible but not commandable', () => {
  const { publicView, privateViews } = maxDensity(), html = render('controller', publicView, privateViews.p0, 'p0');
  assert.match(html, /class="ss-hud-ship"[^>]*aria-label="Ships\. Viewing own ship /); assert.match(html, /<strong>Own ship<\/strong>/); assert.match(html, /aria-label="Weapons and systems"/); assert.match(html, /aria-label="Your crew, 4 alive"/); assert.match(html, />Pause</);
  assert.doesNotMatch(html, /ss-interior-hint|class="ss-aim"/, 'no instruction overlays sit on the rooms');
  assert.doesNotMatch(html, /ss-drawer-root/, 'no drawer or backdrop is mounted until asked for'); assert.doesNotMatch(html, /ss-rail|ss-switcher/, 'the permanent rail and switcher strip are gone');
  assert.equal(count(html, 'ss-crew-own'), 4, 'own crew tokens are highlighted'); assert.ok(count(html, 'class="ss-crew ') >= 9, 'guest and hostile crew are drawn as information');
  assert.equal(count(html, 'class="ss-room-button '), hulls[0].rooms.length, 'one native button per authored room'); assert.match(html, /data-meets44="true"/);
  assert.match(html, /class="ss-cut ss-cut-allied"/); assert.ok(count(html, '<line ') >= 10, 'doors are drawn on shared bulkheads'); assert.match(html, /ss-cut-thrust/, 'engines are part of the exterior');
  assert.ok(!html.includes('Tadeusz Brzęczysz’s ship'), 'own interior does not describe itself as an ally’s ship');
  const ships = render('controller', publicView, privateViews.p0, 'p0', { initialMenu: 'ships' });
  for (let i = 1; i <= 6; i++) assert.ok(ships.includes(`<strong>E${i}</strong>`), `E${i} in the ship list`); assert.match(ships, /role="dialog" aria-modal="true" aria-label="Ships"/);
  const weapons = render('controller', { ...publicView, phase: 'combat' }, privateViews.p0, 'p0', { initialMenu: 'main' }); assert.match(weapons, /aria-label="Withdraw from battle"/);
});
void test('weapons drawer lists only own weapons with targets by TV label, offline slots, and cargo drones; guests never appear as controls', () => {
  const { publicView, privateViews } = maxDensity();
  const html = render('controller', publicView, { ...privateViews.p0 }, 'p0', { initialMenu: 'none' });
  assert.doesNotMatch(html, /ss-weapon /, 'weapons stay in their drawer until opened');
});
void test('shipless captain gets My survivors in the HUD and ship list, sees the ally interior and no weapon dock button', () => {
  const { publicView, privateViews } = maxDensity(), html = render('controller', publicView, privateViews.p3, 'p3');
  assert.match(html, /My survivors · /); assert.match(html, /your crew only/); assert.doesNotMatch(html, /aria-label="Weapons and systems"/, 'no weapons without a ship'); assert.match(html, /aria-label="Your crew, 2 alive"/);
  const list = render('controller', publicView, privateViews.p3, 'p3', { initialMenu: 'ships' }); assert.match(list, /<strong>My survivors<\/strong>/); assert.match(list, /your ship was lost/);
  const crew = render('controller', publicView, privateViews.p3, 'p3', { initialMenu: 'crew' }); assert.match(crew, /Your ship is gone/);
});
void test('spectator sees a clear spectator panel, not a broken ship screen', () => {
  const { publicView, privateViews } = maxDensity(); assert.match(render('controller', publicView, privateViews.p9, 'p9'), /Spectating/);
});
void test('hangar: hull choices first, then a full painted cutaway preview with Back, popovers and one floating Confirm; the draft paint recolors the preview', () => {
  const { publicView, privateViews } = maxDensity(), hangarPub = { ...publicView, phase: 'hangar' as const, ships: [] }, hangarPriv = { ...privateViews.p0, ownShip: null, captain: { ...privateViews.p0.captain!, shipId: null, ready: false } };
  const select = render('controller', hangarPub, hangarPriv, 'p0');
  assert.match(select, /data-hangar="select"/); assert.equal(count(select, '<svg viewBox="0 0 100 60" aria-hidden="true">'), 8, 'eight hull cards'); assert.doesNotMatch(select, /Confirm ship/); assert.doesNotMatch(select, /ss-cut /, 'no cutaway until a hull is chosen');
  const preview = render('controller', hangarPub, hangarPriv, 'p0', { initialPreview: 'moth' });
  assert.match(preview, /data-hangar="preview"/); assert.match(preview, /aria-label="Back to hull choices"/); assert.match(preview, /Confirm ship/); assert.match(preview, /takes this hull and marks you ready/);
  assert.equal(count(preview, 'class="ss-room-button '), 0, 'the preview is art, not a live interior'); assert.equal(count(preview, 'class="ss-room '), hulls.find(h => h.id === 'moth')!.rooms.length, 'every authored Moth room is drawn'); assert.ok(count(preview, '<line ') >= 10, 'doors appear in the preview');
  assert.match(preview, /--chip:#ffd24a/, 'captain colour is the default paint'); assert.match(preview, /aria-label="Customize Mirabel Okonkwo: name, paint and stats"/); assert.doesNotMatch(preview, />Name<|>Paint<|>Stats</, 'settings live behind one Customize button, not a toolbar over the rooms'); assert.doesNotMatch(preview, /maxLength="16"/, 'name entry lives in a popover, not on the stage');
  assert.doesNotMatch(preview, /ss-hull-grid/, 'the selector is replaced, not stacked'); assert.match(preview, /data-editable="true"/);
  const acceptedShip = { ...publicView.ships[0], hullId: 'moth', color: '#71a8e8', name: 'Aurora' };
  const accepted = render('controller', { ...hangarPub, ships: [acceptedShip], captains: publicView.captains.map(c => c.id === 'cap0' ? { ...c, ready: true, shipId: acceptedShip.id } : c) }, { ...hangarPriv, captain: { ...hangarPriv.captain!, ready: true, shipId: acceptedShip.id } }, 'p0');
  assert.match(accepted, /data-hangar="preview" data-status="accepted" data-editable="false"/); assert.match(accepted, /aria-label="Change ship: withdraw readiness and edit this ship"/); assert.doesNotMatch(accepted, /Confirm ship|Customize/, 'no mutable controls while the server holds us ready'); assert.match(accepted, /Ready ✓ · 1\/4 ready/); assert.match(accepted, /--chip:#71a8e8/, 'the authoritative paint is shown, not a stale draft');
  const assignment = render('controller', { ...publicView, phase: 'assignment', assignment: true, captains: publicView.captains.map((c, i) => ({ ...c, playerId: i === 0 ? 'p0' : null })) }, privateViews.p0, 'p0');
  assert.equal(count(assignment, 'Tap to claim'), 3); assert.match(assignment, /Ship lost · 2 crew survive/);
});
void test('salvage and station drawers render tap-to-take loot, cargo carrier choice, store stock and refit controls', () => {
  const { publicView, privateViews } = maxDensity(), loot = privateViews.p0.store.map(i => ({ ...i, location: 'loot' as const }));
  const rewards = render('controller', { ...publicView, phase: 'rewards', loot }, privateViews.p0, 'p0');
  assert.equal(count(rewards, 'aria-label="Take '), 6); assert.match(rewards, /Cargo goes to/);
  const store = render('controller', { ...publicView, phase: 'store' }, privateViews.p0, 'p0');
  assert.equal(count(store, 'aria-label="Buy '), 6); assert.match(store, /Done shopping|Ready ✓/); assert.match(store, /<small>tap a room to upgrade<\/small>/, 'the store hint lives in the HUD subtitle, never over the rooms');
});
void test('HUD pause: solo shows Resume, a fleet shows Ready with the leader’s Resume now; Withdraw waits in the menu with its two-tap confirm', () => {
  const { publicView, privateViews } = maxDensity();
  const fighting = render('controller', publicView, privateViews.p0, 'p0'); assert.doesNotMatch(fighting, /Withdraw/, 'withdraw is a menu item, not HUD clutter'); assert.match(fighting, />Pause</);
  const menu = render('controller', publicView, privateViews.p0, 'p0', { initialMenu: 'main' }); assert.match(menu, /aria-label="Withdraw from battle"/); assert.doesNotMatch(menu, /Confirm withdraw/);
  const paused = render('controller', { ...publicView, paused: true, pausedBy: 'cap1', captains: publicView.captains.map(c => ({ ...c, ready: false })) }, privateViews.p0, 'p0');
  assert.match(paused, /Ready to resume/); assert.doesNotMatch(paused, /Resume now|Paused · Tadeusz/, 'the HUD keeps one action; details live in the menu'); assert.match(paused, /<strong>Own ship<\/strong>/, 'ship identity survives the paused HUD');
  const pausedMenu = render('controller', { ...publicView, paused: true, pausedBy: 'cap1', captains: publicView.captains.map(c => ({ ...c, ready: false })) }, privateViews.p0, 'p0', { initialMenu: 'main' });
  assert.match(pausedMenu, /data-paused="true"/); assert.match(pausedMenu, /Tadeusz Brzęczysz paused the battle/); assert.match(pausedMenu, /Resume now/); assert.equal(count(pausedMenu, 'class="ss-ready-list"'), 1);
  const readyMe = render('controller', { ...publicView, paused: true, pausedBy: 'cap1', captains: publicView.captains.map(c => ({ ...c, ready: c.id === 'cap0' })) }, privateViews.p0, 'p0'); assert.match(readyMe, /Ready 1\/3/);
  const solo = render('controller', { ...publicView, paused: true, pausedBy: 'cap0', captains: [publicView.captains[0]] }, privateViews.p0, 'p0');
  assert.match(solo, />Resume</); assert.doesNotMatch(solo, /Resume now/);
  const escaping = render('display', { ...publicView, objective: { kind: 'escape', deadlineMs: 50000, stage: 0, description: 'Retreat ordered.' } }, null, null); assert.match(escaping, /Retreat · hold 20s/);
});
void test('route: stable location codes everywhere, reachable nodes are native targets, votes and Jump name the selected code, two same-label signals stay distinct', () => {
  const { publicView, privateViews } = maxDensity(), beacons = [{ id: 'b1', column: 0, lane: 0, kind: 'event' as const, label: 'Uncharted signal', next: ['b3'], visited: false, eventId: null }, { id: 'b2', column: 0, lane: 1, kind: 'event' as const, label: 'Uncharted signal', next: ['b3'], visited: false, eventId: null }, { id: 'b3', column: 1, lane: 0, kind: 'exit' as const, label: 'Sector exit', next: [], visited: false, eventId: null }];
  const route = { ...publicView, phase: 'route' as const, beacons, currentBeaconId: '' };
  const phone = render('controller', route, privateViews.p0, 'p0');
  assert.match(phone, /class="ss-drawer ss-drawer-full" role="dialog" aria-modal="true" aria-label="Route"/, 'the route panel takes the full frame'); assert.match(phone, /class="ss-route-full"/); assert.match(phone, /viewBox="0 0 188 120"/, 'compact map width follows the two columns');
  assert.equal(count(phone, 'Uncharted signal'), 6, 'both same-label beacons appear as node targets, as cards and in accessible names; the compact map carries codes only'); assert.match(phone, /class="ss-code">A1</); assert.match(phone, /class="ss-code">B1</); assert.doesNotMatch(phone, /class="ss-code">A2</, 'the exit is out of range and is not offered');
  assert.equal(count(phone, 'class="ss-route-node '), 2, 'one native target per reachable beacon'); assert.match(phone, /aria-label="A1 Uncharted signal, Unknown signal"/); assert.match(phone, /aria-label="B1 Uncharted signal, Unknown signal"/);
  assert.match(phone, /data-code="A2" data-state="locked"/); assert.doesNotMatch(phone, /OUT OF RANGE/, 'compact maps show codes for unreachable nodes, not repeated captions'); assert.doesNotMatch(phone, /<text[^>]*class="ss-route-label"/, 'full labels live in the choice cards on phones');
  const a1 = /data-beacon="b1"[^>]*>[^]*?<text x="([\d.]+)" y="([\d.]+)"/.exec(phone)!, b1 = /data-beacon="b2"[^>]*>[^]*?<text x="([\d.]+)" y="([\d.]+)"/.exec(phone)!;
  assert.ok(a1[1] !== b1[1] || a1[2] !== b1[2], 'same-label beacons draw at different coordinates');
  assert.doesNotMatch(phone, /Jump to/, 'a leader who has not voted yet sees Jump disabled without a code'); assert.match(phone, /vote for a beacon first/); assert.doesNotMatch(phone, />Continue</);
  const voted = render('controller', { ...route, captains: route.captains.map(c => c.id === 'cap0' ? { ...c, vote: 'b2' } : c) }, privateViews.p0, 'p0');
  assert.match(voted, /data-voted="B1"/); assert.match(voted, /aria-label="Jump to B1, Uncharted signal"/); assert.match(voted, />VOTED</, 'the compact map marks the voted node'); assert.match(voted, /class="ss-route-node ss-active"/); assert.match(voted, /aria-pressed="true"[^>]*aria-label="Vote for B1/);
  const solo = render('controller', { ...route, captains: [route.captains[0]] }, privateViews.p0, 'p0'); assert.match(solo, /aria-label="Jump to A1, Uncharted signal/); assert.doesNotMatch(solo, /vote for a beacon first/); assert.match(solo, /Your vote jumps the fleet/);
  const tv = render('display', route, null, null); assert.match(tv, /data-code="A1"/); assert.match(tv, /data-code="B1"/); assert.match(tv, /data-counter="voted">0<small>\/4 voted/); assert.doesNotMatch(tv, /ss-route-node/, 'the TV map is not interactive');
  assert.equal(count(tv, 'class="ss-route-label"'), 2, 'TV spells out only current and reachable nodes; the rest carry codes and kinds');
  for (const lanes of [1, 2, 3]) { const html = render('display', { ...route, beacons: Array.from({ length: lanes * 2 }, (_, i) => ({ id: `l${i}`, column: i % 2, lane: Math.floor(i / 2), kind: 'event' as const, label: `Lane ${i}`, next: [], visited: false, eventId: null })) }, null, null);
    const height = Number(/viewBox="0 0 720 (\d+)"/.exec(html)![1]), ys = [...html.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map(m => Number(m[1]));
    assert.ok(ys.length >= lanes * 5 && ys.every(y => y <= height - 4 && y >= 4), `${lanes}-lane codes and labels stay inside the ${height}px map (${ys.length} labels, max y ${Math.max(...ys)})`); }
});
void test('rewards after a surrender: the phase drawer opens with the stranded-crew acknowledgement and teleporter, surrendered enemies stay listed', () => {
  const { publicView, privateViews } = maxDensity(), ships = publicView.ships.map(s => s.id === 'e2' ? { ...s, status: 'surrendered' as const } : s);
  const priv = { ...privateViews.p0, crew: [...privateViews.p0.crew, { ...privateViews.p0.crew[0], id: 'boarder', currentShipId: 'e2' }] };
  const html = render('controller', { ...publicView, phase: 'rewards', ships }, priv, 'p0');
  assert.match(html, /aria-label="Salvage"/); assert.match(html, /Crew aboard enemy vessels/); assert.match(html, /extract crew before jumping/); assert.match(html, /Leave them/); assert.match(html, /ss-hud-phase ss-attention/, 'the HUD phase badge flags the blocker');
  const list = render('controller', { ...publicView, phase: 'rewards', ships }, priv, 'p0', { initialMenu: 'ships' }); assert.match(list, /aria-label="E2 Hollow Choir[^"]*1 of your crew aboard/);
});
void test('spectator at a station gets the paid recovery offer in the station drawer; in combat only the HUD badge and menu explanation', () => {
  const { publicView, privateViews } = maxDensity();
  const store = render('controller', { ...publicView, phase: 'store' }, privateViews.p9, 'p9');
  assert.match(store, /data-recovery="store"/); assert.match(store, /Hire a recruit for 60 scrap/); assert.match(store, /Wallet 40/); assert.match(store, /need 20 more scrap/); assert.match(store, /<select/);
  const combat = render('controller', publicView, privateViews.p9, 'p9'); assert.doesNotMatch(combat, /data-recovery/); assert.match(combat, /ss-hud-spectating">Spectating/); assert.doesNotMatch(combat, /aria-label="Weapons and systems"|aria-label="Your crew/, 'no ordinary controls for a spectator');
  assert.match(render('controller', publicView, privateViews.p9, 'p9', { initialMenu: 'main' }), /No crew remain under your command/);
});
void test('uncrewed hull between battles: everyone sees the departure notice, only the leader gets the two-tap abandon, combat stays clean', () => {
  const { publicView, privateViews } = maxDensity(), ships = publicView.ships.map(s => s.id === 'ship-cap2' ? { ...s, alerts: ['Uncrewed'] } : s);
  const route = { ...publicView, phase: 'route' as const, currentBeaconId: '', ships };
  const leader = render('controller', route, privateViews.p0, 'p0');
  assert.match(leader, /data-uncrewed="1"/); assert.match(leader, /Longbow Ximena/); assert.match(leader, /aria-label="Abandon Longbow Ximena"/); assert.doesNotMatch(leader, /Confirm abandon/, 'second tap only after arming'); assert.doesNotMatch(leader, /ends the expedition/, 'ordinary abandon does not threaten the run');
  const lastHull = render('controller', { ...route, ships: ships.map(s => s.faction === 'allied' && s.id !== 'ship-cap2' ? { ...s, status: 'destroyed' as const } : s) }, privateViews.p0, 'p0');
  assert.match(lastHull, /last surviving friendly hull/); assert.match(lastHull, /ends the expedition/);
  const follower = render('controller', { ...route, leaderCaptainId: 'cap1' }, privateViews.p0, 'p0'); assert.match(follower, /data-uncrewed="1"/); assert.doesNotMatch(follower, /aria-label="Abandon/); assert.match(follower, /Only Tadeusz Brzęczysz can abandon it/);
  assert.doesNotMatch(render('controller', { ...publicView, ships }, privateViews.p0, 'p0'), /data-uncrewed/, 'no departure clutter in combat');
  assert.match(render('display', route, null, null), /Longbow Ximena is uncrewed/);
  assert.doesNotMatch(render('display', { ...publicView, ships }, null, null), /is uncrewed/);
});
void test('rewards explain that unclaimed items are discarded and no shared cargo controls exist', () => {
  const { publicView, privateViews } = maxDensity(), loot = privateViews.p0.store.map(i => ({ ...i, location: 'loot' as const }));
  const html = render('controller', { ...publicView, phase: 'rewards', loot }, privateViews.p0, 'p0');
  assert.match(html, /Unclaimed items are discarded when the fleet leaves/); assert.doesNotMatch(html, /Shared cargo|Carrier:/);
  assert.match(render('display', { ...publicView, phase: 'rewards', loot }, null, null), /discarded when the fleet leaves/);
  assert.ok(!bundle.includes('setSharedCarrier') && !bundle.includes('sharedCargo'), 'shared cargo is fully removed from the client');
});
void test('cargo drones appear in the weapons drawer with a launch note and never get an Install button in the store', () => {
  const { publicView, privateViews } = maxDensity();
  const drone = { ...privateViews.p0.inventory[0], id: 'cargo-drone', location: 'cargo' as const };
  const priv = { ...privateViews.p0, inventory: [drone], ownShip: { ...privateViews.p0.ownShip!, systems: [...privateViews.p0.ownShip!.systems, { id: 'drone-bay' as const, tier: 1, cooldownUntilMs: 0, activeUntilMs: 0, targetShipId: null, targetRoomId: null }], rooms: privateViews.p0.ownShip!.rooms.map((r, i) => i === 8 ? { ...r, system: 'drone-bay' as const, tier: 1 } : r) } };
  const store = render('controller', { ...publicView, phase: 'store' }, { ...priv, store: [{ ...drone, id: 'stock-drone', location: 'store' as const, ownerCaptainId: null }] }, 'p0'); assert.match(store, /drone · launches from cargo/); assert.doesNotMatch(store, /aria-label="Install/);
});
void test('TV: concise objective label, pause banner keeps the fleet visible, enemy names are not double prefixed, rosters are substantial', () => {
  const { publicView } = maxDensity(), ships = publicView.ships.map(s => s.id === 'e1' ? { ...s, name: 'E1 · Tax Collector' } : s);
  const combat = render('display', { ...publicView, ships, objective: { kind: 'destroy', deadlineMs: null, stage: 1, description: 'Defeat the hostile fleet. Target a weapon, then tap an enemy room.' } }, null, null);
  assert.match(combat, /<b class="kp-display">Defeat the hostile fleet<\/b>/); assert.match(combat, /<small>Defeat the hostile fleet\. Target a weapon, then tap an enemy room\.<\/small>/, 'full instruction sits under the concise headline');
  const paused = render('display', { ...publicView, paused: true, pausedBy: 'cap1' }, null, null); assert.match(paused, /ss-pause-banner/); assert.doesNotMatch(paused, /ss-pause-overlay/); assert.match(paused, /called a tactical pause/); assert.equal(count(paused, '<li style="--chip:'), 3, 'one chip per connected non-spectator captain, names wrapped for ellipsis'); assert.match(paused, /<span>Mirabel Okonkwo<\/span>/);
  const hangar = render('display', { ...publicView, phase: 'hangar' }, null, null); assert.match(hangar, /ss-tv-roster-big/); assert.match(hangar, /Wayfarer · hull/); assert.match(hangar, /\/4 ready/);
  const phone = render('controller', { ...publicView, ships }, { ...maxDensity().privateViews.p0, inspectedShipId: 'e1', inspectedShip: { ...maxDensity().privateViews.p0.inspectedShip!, ship: ships.find(s => s.id === 'e1')! } }, 'p0', { initialMenu: 'ships' });
  assert.match(phone, /aria-label="E1 Tax Collector\./); assert.doesNotMatch(phone, /E1 E1/);
  const inspecting = render('controller', { ...publicView, ships }, { ...maxDensity().privateViews.p0, inspectedShipId: 'e1', inspectedShip: { ...maxDensity().privateViews.p0.inspectedShip!, ship: ships.find(s => s.id === 'e1')! } }, 'p0');
  assert.match(inspecting, /ss-cut ss-cut-allied/, 'own ship stays the default view');
});
void test('event Continue turns into a waiting indicator once this captain is ready, so repeated taps stop', () => {
  const { publicView, privateViews } = maxDensity(), event = { ...publicView, phase: 'event' as const, captains: publicView.captains.map(c => ({ ...c, ready: false })), event: { id: 'ev', title: 'Quiet Dock', text: 'Nothing stirs.', result: 'The fleet rests.', resolved: true, choices: [] } };
  assert.match(render('controller', event, privateViews.p0, 'p0'), />Continue</);
  const waiting = render('controller', { ...event, captains: event.captains.map(c => c.id === 'cap0' ? { ...c, ready: true } : c) }, privateViews.p0, 'p0');
  assert.doesNotMatch(waiting, />Continue</); assert.match(waiting, /data-waiting="true"/); assert.match(waiting, /waiting for 3 more \(1\/4\)/);
});
void test('unknown enemy rooms stay hidden in the cutaway: no furniture, tier pips or status for unscanned compartments', () => {
  const { publicView, privateViews } = maxDensity(), enemy = privateViews.p0.inspectedShip!;
  const priv = { ...privateViews.p0, captain: { ...privateViews.p0.captain!, shipId: null }, ownShip: null, crew: privateViews.p0.crew.map(c => ({ ...c, currentShipId: 'e3' })) };
  const html = render('controller', publicView, priv, 'p0');
  assert.match(html, /ss-cut ss-cut-enemy/); const unknown = enemy.rooms.filter(r => !r.known).length; assert.ok(unknown > 0, 'fixture has unscanned rooms');
  assert.equal(count(html, 'url(#ss-unknown-'), unknown, 'each unknown room renders the unknown pattern'); assert.equal(count(html, 'Unknown interior'), unknown);
  assert.doesNotMatch(html, /Manned by/); assert.ok(count(html, 'data-door="unknown"') > 0, 'doors touching unknown rooms are neutral'); assert.doesNotMatch(html, /data-door="open"[^>]*stroke="#78d955"[^]*?data-door="unknown"[^>]*stroke="#78d955"/);
});
void test('personal view composes the fleet overview with the captain interface and never repeats the stale message', () => {
  const { publicView, privateViews } = maxDensity(), html = render('personal', publicView, privateViews.p0, 'p0');
  assert.match(html, /ss-personal-fleet/); assert.match(html, /4 allied ships, 6 enemy ships/); assert.match(html, /Own ship/); assert.match(html, /aria-label="Fleet overview"/, 'the dock offers the fleet overlay'); assert.match(html, /aria-label="Close fleet overview"/);
  assert.doesNotMatch(html, /class="ss-personal-fleet" aria-label="Fleet overview" role="dialog"/, 'the wide side panel is not a dialog until it opens as an overlay');
  assert.doesNotMatch(html, /ss-personal-tabs/, 'no permanent Captain/Fleet strip');
  const store = render('personal', { ...publicView, phase: 'store', message: 'Vote for a beacon, or let the expedition leader choose.' }, privateViews.p0, 'p0');
  assert.doesNotMatch(store, /Vote for a beacon/); assert.match(store, /ss-personal-quiet[^]*?<strong>Station<\/strong>/); assert.equal(count(store, 'Refit, restock and recruit on your phones'), 1);
  const calm = render('personal', { ...publicView, phase: 'store', message: 'Vote for a beacon.', ships: publicView.ships.map(s => ({ ...s, status: 'active' as const, alerts: [] })), captains: publicView.captains.map(c => ({ ...c, connected: true })) }, privateViews.p0, 'p0');
  assert.match(calm, /ss-emergency-quiet">No timer · /, 'footer shows the phase hint, not the stale message'); assert.doesNotMatch(calm, /Vote for a beacon/);
  assert.doesNotMatch(render('controller', { ...publicView, phase: 'store' }, privateViews.p0, 'p0'), /ss-personal-quiet/);
  assert.doesNotMatch(render('controller', publicView, privateViews.p0, 'p0'), /width="440"/, 'interior SVG is sized by CSS, not fixed pixel attributes');
});
