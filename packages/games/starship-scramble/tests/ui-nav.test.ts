import test from 'node:test';
import assert from 'node:assert/strict';
import { back, bareName, carriedDrones, defaultShip, initial, legalTargets, reconcile, reduce, transporterFor, upgradeCost, nextRequestId, phaseContext, uncrewedAllies, beaconCode, beaconState, hangarBusy, hangarEditable, hangarInitial, hangarStep, hangarSync, normalizeDraft, withdrawalDraft, CONTROL_GRACE_MS, type Local, type World } from '../src/ui/nav';
import { parseAction } from '../src/server';
import { beaconOptions } from '../src/ui/phases';
import type { Crew, PrivateView, PublicView, ShipSummary } from '../src/contracts';
const ship = (id: string, faction: ShipSummary['faction'], formation: number, extra: Partial<ShipSummary> = {}): ShipSummary => ({ id, ownerCaptainId: faction === 'allied' ? `cap-${id}` : null, faction, hullId: 'wayfarer', name: id, color: '#4fc6c0', formation, hull: 100, maxHull: 100, status: 'active', shield: 2, alerts: [], rooms: [{ id: 'r0', name: 'piloting', system: 'piloting' }], crewCount: 4, targetShipId: null, escapeAtMs: null, ...extra });
const teleporterRooms = [{ id: 'r0', name: 'piloting', system: 'piloting' as const }, { id: 'r1', name: 'teleporter', system: 'teleporter' as const }];
const crew = (id: string, currentShipId: string): Crew => ({ id, ownerCaptainId: 'cap-own', homeShipId: 'own', currentShipId, name: id, roomId: 'r0', x: 1, y: 1, hp: 100, maxHp: 100, status: 'alive', skill: 'pilot', traits: [], order: { kind: 'hold', roomId: 'r0' }, activity: 'idle', controlEpoch: 0 });
function world(overrides: { ships?: ShipSummary[]; crew?: Crew[]; phase?: PublicView['phase']; ownShip?: boolean; controlledCrewId?: string | null } = {}): World {
  const ships = overrides.ships ?? [ship('own', 'allied', 0), ship('ally', 'allied', 1), ship('e1', 'enemy', 0), ship('e2', 'enemy', 1)];
  const publicView: PublicView = { phase: overrides.phase ?? 'combat', epoch: 3, timeMs: 0, paused: false, pausedBy: null, leaderCaptainId: 'cap-own', captains: [{ id: 'cap-own', playerId: 'p1', name: 'Mira', color: '#fff', shipId: overrides.ownShip === false ? null : 'own', connected: true, ready: false, vote: null, status: 'active', crewCount: 2 }], ships, effects: [], drones: [], sector: { index: 1, count: 5, name: 'Dock', color: '#fff' }, beacons: [], currentBeaconId: 'b0', threat: 0, event: null, loot: [], objective: null, message: '', result: null, assignment: false };
  const privateView = { captainId: 'cap-own', captain: publicView.captains[0], wallet: 0, cargoShipId: 'own', ownShip: null, inspectedShip: null, inspectedShipId: null, viewRequestId: 0, crew: overrides.crew ?? [crew('c1', 'own'), crew('c2', 'ally')], inventory: [], store: [], controlledCrewId: overrides.controlledCrewId ?? null, queued: [], canAct: true, hulls: [] } as PrivateView;
  if (overrides.ownShip !== false) privateView.ownShip = { ship: ships[0], rooms: [], crew: [], weapons: [], systems: [], ammo: 0 };
  return { publicView, privateView };
}
const weapon = { type: 'weapon', weaponId: 'w1', ally: false } as const;
void test('targeting flow: weapons → targets → systems switches the viewed ship and back restores the previous interior', () => {
  let local = initial('own');
  local = reduce(local, { type: 'open', nav: { kind: 'weapons' } });
  local = reduce(local, { type: 'open', nav: { kind: 'targets', tool: weapon } });
  local = reduce(local, { type: 'open', nav: { kind: 'systems', tool: weapon, targetShipId: 'e2' } });
  assert.equal(local.viewedShipId, 'e2'); assert.equal(local.returnShipId, 'own');
  local = reduce(local, { type: 'back' });
  assert.deepEqual(local.nav, { kind: 'targets', tool: weapon }); assert.equal(local.viewedShipId, 'own', 'back from room targeting returns to the interior the player left');
  assert.deepEqual(back(local.nav), { kind: 'weapons' }, 'weapon selection is preserved on the way back');
});
void test('an accepted acknowledgement only completes the navigation it belongs to', () => {
  let local = reduce(reduce(initial('own'), { type: 'open', nav: { kind: 'targets', tool: weapon } }), { type: 'open', nav: { kind: 'systems', tool: weapon, targetShipId: 'e1' } });
  const at = local.epoch; local = reduce(local, { type: 'sent' });
  const stale = reduce(reduce(local, { type: 'view', shipId: 'ally' }), { type: 'ack', ack: { at, accepted: true, after: 'return', now: 0 } });
  assert.equal(stale.viewedShipId, 'ally', 'a newer deliberate ship switch wins over the late ack');
  assert.equal(stale.pending, 0);
  const fresh = reduce(local, { type: 'ack', ack: { at, accepted: true, after: 'return', success: 'Targeting E1', now: 0 } });
  assert.equal(fresh.nav.kind, 'interior'); assert.equal(fresh.viewedShipId, 'own'); assert.equal(fresh.notice?.text, 'Targeting E1');
});
void test('a rejected acknowledgement shows the server prose and leaves the player where they were', () => {
  let local = reduce(initial('own'), { type: 'open', nav: { kind: 'systems', tool: weapon, targetShipId: 'e1' } });
  local = reduce(reduce(local, { type: 'sent' }), { type: 'ack', ack: { at: local.epoch, accepted: false, reason: 'Target room no longer exists.', now: 5 } });
  assert.equal(local.nav.kind, 'systems'); assert.deepEqual(local.notice, { text: 'Target room no longer exists.', tone: 'error', at: 5 });
});
void test('reconcile retires a destroyed target but keeps the picker open with the same weapon', () => {
  const local = reduce(reduce(initial('own'), { type: 'open', nav: { kind: 'targets', tool: weapon } }), { type: 'open', nav: { kind: 'systems', tool: weapon, targetShipId: 'e1' } });
  const w = world(); w.publicView.ships[2].status = 'destroyed';
  const next = reconcile(local, w, 10);
  assert.deepEqual(next.nav, { kind: 'targets', tool: weapon }); assert.equal(next.viewedShipId, 'own'); assert.match(next.notice!.text, /target is gone/);
  assert.deepEqual(legalTargets(weapon, w).map(s => s.id), ['e2'], 'destroyed enemies leave the legal target list');
});
void test('home destroyed while inspecting an enemy: view falls back to the ship carrying survivors', () => {
  const w = world({ ownShip: false }); w.publicView.ships[0].status = 'destroyed'; w.publicView.captains[0].shipId = null; w.publicView.captains[0].status = 'shipless';
  const viewing: Local = { ...initial('own'), viewedShipId: 'e1', returnShipId: 'own' };
  const next = reconcile(viewing, w, 0);
  assert.equal(next.viewedShipId, 'e1', 'the inspected enemy remains visible'); assert.equal(next.returnShipId, 'e1', 'the lost home is no longer a return target');
  assert.equal(defaultShip(w), 'ally', 'own ship gone → the vessel with the most surviving crew');
  const lost = reconcile({ ...viewing, viewedShipId: 'own' }, w, 0);
  assert.equal(lost.viewedShipId, 'ally'); assert.match(lost.notice!.text, /vessel was lost/);
});
void test('direct control ends when the server releases the crew or the crew dies, survives into rewards for extraction, and ends in the hangar', () => {
  const control: Local = { ...initial('own'), nav: { kind: 'control', crewId: 'c1' }, controlSince: 0 };
  assert.equal(reconcile(control, world({ controlledCrewId: 'c1' }), 0).nav.kind, 'control');
  assert.equal(reconcile(control, world({ controlledCrewId: 'c2' }), 0).nav.kind, 'interior');
  // A null grant right after acquisition is an older snapshot: wait. After pause/resume the server clears control for real: release with a notice.
  const granted = reduce(reduce(initial('own'), { type: 'sent' }), { type: 'ack', ack: { at: 0, accepted: true, after: { kind: 'control', crewId: 'c1' }, now: 1000 } });
  assert.equal(granted.nav.kind, 'control'); assert.equal(granted.controlSince, 1000);
  assert.equal(reconcile(granted, world({ controlledCrewId: null }), 1000 + CONTROL_GRACE_MS - 1).nav.kind, 'control', 'within the grace window the pending grant is trusted');
  const cleared = reconcile(granted, world({ controlledCrewId: null }), 1000 + CONTROL_GRACE_MS + 1); assert.equal(cleared.nav.kind, 'interior'); assert.match(cleared.notice!.text, /Direct control ended/); assert.equal(cleared.controlSince, null);
  assert.equal(reconcile({ ...granted, controlSince: 1000 }, world({ controlledCrewId: 'c1' }), 1000 + CONTROL_GRACE_MS + 5000).nav.kind, 'control', 'a confirmed grant is never timed out');
  const dead = world(); dead.privateView.crew[0].status = 'dead'; assert.equal(reconcile(control, dead, 0).nav.kind, 'interior');
  assert.equal(reconcile(control, world({ phase: 'rewards', controlledCrewId: 'c1' }), 0).nav.kind, 'control', 'crew may still be moved after a surrender');
  assert.equal(reconcile(control, world({ phase: 'hangar', controlledCrewId: 'c1' }), 0).nav.kind, 'interior');
  const targeting: Local = { ...initial('own'), nav: { kind: 'targets', tool: weapon } };
  assert.equal(reconcile(targeting, world({ phase: 'rewards' }), 0).nav.kind, 'interior', 'weapon targeting closes outside combat');
});
void test('route options: an empty currentBeaconId at departure or a new sector offers every unvisited column-0 beacon', () => {
  const beacons = [{ id: 'a', column: 0, lane: 0, kind: 'event' as const, label: 'A', next: ['c'], visited: false, eventId: null }, { id: 'b', column: 0, lane: 1, kind: 'store' as const, label: 'B', next: ['c'], visited: true, eventId: null }, { id: 'c', column: 1, lane: 0, kind: 'exit' as const, label: 'C', next: [], visited: false, eventId: null }];
  assert.deepEqual(beaconOptions(beacons, '').map(b => b.id), ['a']);
  assert.deepEqual(beaconOptions(beacons, 'a').map(b => b.id), ['c']);
  assert.deepEqual(beaconOptions(beacons, 'c'), []);
});
void test('upgrade cost follows the expedition rule of 20 plus 15 per current tier', () => {
  assert.equal(upgradeCost(1), 35); assert.equal(upgradeCost(2), 50); assert.equal(upgradeCost(4), 80);
});
void test('ship switching keeps the teleport draft and target picker context but resets ordinary interiors', () => {
  const teleport = reduce(initial('own'), { type: 'open', nav: { kind: 'teleport', crewIds: ['c1'], targetShipId: null } });
  assert.equal(reduce(teleport, { type: 'view', shipId: 'ally' }).nav.kind, 'teleport');
  const room = reduce(initial('own'), { type: 'open', nav: { kind: 'room', roomId: 'r0' } });
  assert.deepEqual(reduce(room, { type: 'view', shipId: 'ally' }).nav, { kind: 'interior' });
});
void test('notices expire and an unchanged world returns the same local object', () => {
  const w = world(), local = reconcile(initial('own'), w, 0);
  assert.equal(reconcile(local, w, 100), local);
  const noisy: Local = { ...local, notice: { text: 'x', tone: 'info', at: 0 } };
  assert.equal(reconcile(noisy, w, 7000).notice, null);
});

void test('transport uses the teleporter at the crew’s ship, else at the chosen destination, else recalls through own; never an enemy', () => {
  const ships = [ship('own', 'allied', 0), ship('ally', 'allied', 1, { rooms: teleporterRooms }), ship('e1', 'enemy', 0, { rooms: teleporterRooms })];
  const w = world({ ships, crew: [crew('c1', 'e1'), crew('c2', 'e1')] });
  assert.equal(transporterFor(['c1', 'c2'], w, 'own'), null, 'no teleporter anywhere reachable without a destination');
  assert.equal(transporterFor(['c1', 'c2'], w, 'own', 'ally'), 'ally', 'a shipless or stranded captain can pick an allied destination with a working teleporter');
  assert.equal(transporterFor(['c1'], w, 'own', 'e1'), null, 'an enemy teleporter never counts');
  assert.equal(transporterFor(['c1'], world({ ships, crew: [crew('c1', 'ally')] }), null, 'own'), 'ally', 'source ship teleporter wins for a shipless owner');
  const ownTele = world({ ships: [ship('own', 'allied', 0, { rooms: teleporterRooms }), ship('e1', 'enemy', 0)], crew: [crew('c1', 'e1')] });
  assert.equal(transporterFor(['c1'], ownTele, 'own', 'own'), 'own', 'recall home through own teleporter');
});
void test('drones show from cargo or original mounts on the own ship and are only launchable while the drone bay works', () => {
  const w = world();
  const bay = { id: 'r5', name: 'drone bay', system: 'drone-bay' as const, x: 0, y: 0, w: 3, h: 3, capacity: 4, adjacent: [], tier: 1, damage: 0, fire: 0, breach: 0, oxygen: 100, locked: false, disruptedUntilMs: 0, mannedBy: null, known: true };
  w.privateView.ownShip = { ship: w.publicView.ships[0], rooms: [bay], crew: [], weapons: [], systems: [{ id: 'drone-bay', tier: 1, cooldownUntilMs: 0, activeUntilMs: 0, targetShipId: null, targetRoomId: null }], ammo: 3 };
  const item = (id: string, location: 'cargo' | 'installed' | 'loot', carrierShipId: string | null) => ({ id, definitionId: 'drone-attack', kind: 'drone' as const, name: 'Needle Drone', description: '', price: 40, version: 1, ownerCaptainId: 'cap-own', carrierShipId, location });
  w.privateView.inventory = [item('d1', 'cargo', 'own'), item('d2', 'installed', 'own'), item('d3', 'cargo', 'ally'), item('d4', 'loot', null)];
  assert.deepEqual(carriedDrones(w).map(d => d.item.id), ['d1', 'd2'], 'cargo and mounted drones aboard own ship only');
  assert.ok(carriedDrones(w).every(d => d.operational));
  bay.damage = 10; assert.ok(carriedDrones(w).every(d => !d.operational), 'ten damage units disable a tier-1 bay');
  bay.damage = 0; bay.disruptedUntilMs = 5000; assert.ok(carriedDrones(w).every(d => !d.operational), 'disruption disables the bay');
});
void test('enemy names that already carry their shared label are not double prefixed', () => {
  assert.equal(bareName({ name: 'E1 · Tax Collector', faction: 'enemy' }), 'Tax Collector');
  assert.equal(bareName({ name: 'E12: Warden', faction: 'enemy' }), 'Warden');
  assert.equal(bareName({ name: 'Eagle Prime', faction: 'enemy' }), 'Eagle Prime', 'a name that merely starts with E survives');
  assert.equal(bareName({ name: 'E1 · Mine', faction: 'allied' }), 'E1 · Mine', 'allied names are never rewritten');
});

void test('inspection ids always exceed the server’s latest accepted id, including after a reload resets the local counter', () => {
  assert.equal(nextRequestId(0, 0), 1); assert.equal(nextRequestId(0, 41), 42, 'fresh page seeds above the server id'); assert.equal(nextRequestId(50, 41), 51, 'local counter keeps leading once ahead');
});
void test('uncrewed detection follows the server alert on active allied hulls only', () => {
  const w = world({ ships: [ship('own', 'allied', 0, { alerts: ['Uncrewed'] }), ship('ally', 'allied', 1), ship('dead', 'allied', 2, { alerts: ['Uncrewed'], status: 'destroyed' }), ship('e1', 'enemy', 0, { alerts: ['Uncrewed'] })] });
  assert.deepEqual(uncrewedAllies(w).map(s => s.id), ['own']);
});

void test('phase context replaces the stale free-form message with concise per-phase wording', () => {
  const w = world({ phase: 'store' }); w.publicView.message = 'Vote for a beacon, or let the expedition leader choose.';
  const store = phaseContext(w.publicView); assert.equal(store.title, 'Station'); assert.doesNotMatch(store.hint + store.detail, /Vote for a beacon/);
  const route = phaseContext({ ...w.publicView, phase: 'route', beacons: [{ id: 'a', column: 0, lane: 0, kind: 'event', label: 'A', next: [], visited: false, eventId: null }], currentBeaconId: '' });
  assert.match(route.detail, /1 beacon within jump range · 0\/1 voted/); assert.notEqual(route.detail, route.hint, 'overview and footer never repeat one sentence');
  const event = phaseContext({ ...w.publicView, phase: 'event', event: { id: 'e', title: 'Derelict', text: 'A silent hull drifts.', result: '', resolved: false, choices: [{ id: 'c', label: 'Board', text: '', special: false, available: true, requirement: '', cost: 0, contributors: [] }] } });
  assert.equal(event.title, 'Derelict'); assert.equal(event.detail, 'A silent hull drifts.'); assert.match(event.hint, /voted/);
  assert.equal(phaseContext({ ...w.publicView, phase: 'results', result: 'victory', message: 'Done.' }).detail, 'Done.', 'results keep the real closing message');
});

void test('hangar edit transaction: an accepted ship cannot be repainted, renamed or swapped until readiness is withdrawn; rejection keeps it accepted and visible', () => {
  const accepted = { ...hangarInitial({ hullId: 'longbow', name: 'Aurora', color: '#71a8e8' }, true), mode: 'preview' as const };
  assert.equal(hangarEditable(accepted), false);
  assert.equal(hangarStep(accepted, { type: 'paint', color: '#ff5748' }).draft.color, '#71a8e8', 'paint is inert while accepted');
  assert.equal(hangarStep(accepted, { type: 'name', name: 'Other' }).draft.name, 'Aurora'); assert.equal(hangarStep(accepted, { type: 'select', hullId: 'kite', color: '#8fcbb0' }).draft.hullId, 'longbow'); assert.equal(hangarStep(accepted, { type: 'back' }).mode, 'preview');
  assert.equal(hangarStep(accepted, { type: 'confirm' }).status, 'accepted', 'no second chooseHull/ready while accepted');
  const editing = hangarStep(accepted, { type: 'edit', target: 'preview' }); assert.equal(editing.status, 'unreadying'); assert.ok(hangarBusy(editing)); assert.equal(hangarStep(editing, { type: 'paint', color: '#ff5748' }).draft.color, '#71a8e8', 'controls stay locked while the withdrawal is in flight');
  const refused = hangarStep(editing, { type: 'unreadied', accepted: false, reason: 'Choose a hull before departure.' }); assert.equal(refused.status, 'accepted'); assert.equal(refused.error, 'Choose a hull before departure.');
  const open = hangarStep(editing, { type: 'unreadied', accepted: true }); assert.equal(open.status, 'idle'); assert.equal(open.mode, 'preview'); assert.equal(open.expect, 'notReady');
  assert.equal(hangarSync(open, true).status, 'idle', 'a stale snapshot that still says ready is ignored after our own withdrawal');
  const settled = hangarSync(open, false); assert.equal(settled.expect, null); assert.equal(hangarSync(settled, true).status, 'accepted', 'later, a real outside change is followed');
  const repainted = hangarStep(settled, { type: 'paint', color: '#ff5748' }); assert.equal(repainted.draft.color, '#ff5748'); assert.equal(repainted.status, 'idle', 'an edit requires a fresh Confirm');
  const toSelector = hangarStep(hangarStep(accepted, { type: 'edit', target: 'select' }), { type: 'unreadied', accepted: true }); assert.equal(toSelector.mode, 'select');
});
void test('two-captain ready race: after our Confirm is accepted a stale not-ready snapshot cannot reopen editing, and a rejected chooseHull never sends ready', () => {
  let state = hangarStep(hangarInitial({ hullId: 'wayfarer', name: 'Mira', color: '#fff' }, false), { type: 'select', hullId: 'moth', color: '#b79bdc' });
  state = hangarStep(state, { type: 'confirm' }); state = hangarStep(state, { type: 'chosen', accepted: true }); state = hangarStep(state, { type: 'readied', accepted: true });
  assert.equal(state.status, 'accepted'); assert.equal(state.expect, 'ready');
  assert.equal(hangarSync(state, false).status, 'accepted', 'the snapshot from before our ready ack is ignored'); const live = hangarSync(state, true); assert.equal(live.expect, null);
  assert.equal(hangarSync(live, false).status, 'idle', 'once settled, the server clearing readiness (a new expedition round) reopens the flow');
  let rejected = hangarStep(hangarInitial({ hullId: 'kite', name: '', color: '#fff' }, false), { type: 'select', hullId: 'kite', color: '#8fcbb0' });
  rejected = hangarStep(hangarStep(rejected, { type: 'confirm' }), { type: 'chosen', accepted: false, reason: 'Unknown hull.' });
  assert.equal(rejected.status, 'error'); assert.equal(hangarStep(rejected, { type: 'readied', accepted: true }).status, 'error', 'a stray readied ack can never bless a hull the hangar rejected'); assert.equal(hangarStep(rejected, { type: 'retry' }).status, 'error', 'no readiness retry without an accepted chooseHull'); assert.equal(hangarStep(rejected, { type: 'paint', color: '#000' }).status, 'idle', 'editing after an error clears it');
});
void test('hangar draft flow: a rejected chooseHull keeps the preview open with the error and never reaches ready; acceptance moves to readying, then accepted', () => {
  let state = hangarInitial({ hullId: 'wayfarer', name: 'Mira', color: '#fff' }, false);
  state = hangarStep(state, { type: 'select', hullId: 'moth', color: '#b79bdc' }); assert.equal(state.mode, 'preview'); assert.equal(state.draft.hullId, 'moth'); assert.equal(state.draft.color, '#fff', 'an existing draft colour is kept over the hull default');
  state = hangarStep(state, { type: 'paint', color: '#4fc6c0' }); assert.equal(state.draft.color, '#4fc6c0');
  state = hangarStep(state, { type: 'name', name: 'A very long ship name indeed' }); assert.equal(state.draft.name.length, 16);
  state = hangarStep(state, { type: 'confirm' }); assert.equal(state.status, 'choosing'); assert.equal(hangarStep(state, { type: 'back' }).mode, 'preview', 'no leaving while the hangar is deciding');
  const rejected = hangarStep(state, { type: 'chosen', accepted: false, reason: 'Unknown hull.' }); assert.equal(rejected.status, 'error'); assert.equal(rejected.error, 'Unknown hull.'); assert.equal(rejected.mode, 'preview'); assert.equal(rejected.draft.hullId, 'moth', 'the draft survives a rejection');
  const readying = hangarStep(state, { type: 'chosen', accepted: true }); assert.equal(readying.status, 'readying');
  const readyFailed = hangarStep(readying, { type: 'readied', accepted: false, reason: 'Every saved captain must be assigned.' }); assert.equal(readyFailed.status, 'error'); assert.match(readyFailed.error!, /assigned/);
  const accepted = hangarStep(readying, { type: 'readied', accepted: true }); assert.equal(accepted.status, 'accepted'); assert.equal(accepted.mode, 'preview');
  assert.equal(hangarStep(accepted, { type: 'back' }).status, 'accepted', 'back never sends anything or forgets acceptance');
  assert.equal(hangarSync(hangarInitial({ hullId: 'kite', name: '', color: '#fff' }, false), true).status, 'accepted', 'a reload into an already-ready seat shows accepted');
});
void test('beacon codes are lane letter plus column number and beacon state is shape-distinct: current, reachable, visited, locked', () => {
  assert.equal(beaconCode({ lane: 0, column: 0 }), 'A1'); assert.equal(beaconCode({ lane: 1, column: 0 }), 'B1'); assert.equal(beaconCode({ lane: 2, column: 4 }), 'C5');
  const beacons = [{ id: 'a', column: 0, lane: 0, kind: 'event' as const, label: 'Same', next: ['c'], visited: true, eventId: null }, { id: 'b', column: 0, lane: 1, kind: 'event' as const, label: 'Same', next: ['c'], visited: false, eventId: null }, { id: 'c', column: 1, lane: 0, kind: 'exit' as const, label: 'Exit', next: [], visited: false, eventId: null }];
  assert.notEqual(beaconCode(beacons[0]), beaconCode(beacons[1]), 'two same-label signals get different codes');
  const reachable = new Set(['c']);
  assert.equal(beaconState(beacons[0], 'a', reachable), 'current'); assert.equal(beaconState(beacons[2], 'a', reachable), 'reachable'); assert.equal(beaconState(beacons[1], 'a', reachable), 'locked');
  assert.equal(beaconState(beacons[0], 'c', new Set()), 'visited');
});

void test('withdrawal right after the ready ack sends the locally accepted hull, even while the snapshot still shows the previous selection or no readiness', () => {
  let state = hangarStep(hangarInitial({ hullId: 'wayfarer', name: 'Mira', color: '#fff' }, false), { type: 'select', hullId: 'moth', color: '#b79bdc' });
  state = hangarStep(hangarStep(hangarStep(state, { type: 'confirm' }), { type: 'chosen', accepted: true }), { type: 'readied', accepted: true });
  assert.deepEqual(state.accepted, { hullId: 'moth', name: 'Mira', color: '#fff' }, 'the accepted draft is remembered at acceptance');
  const stale = { hullId: 'wayfarer', name: 'Mira', color: '#fff' };
  assert.deepEqual(withdrawalDraft(state, false, stale), state.accepted, 'ack before snapshot: withdraw with the accepted Moth, not the stale Wayfarer, and never skip the transaction');
  assert.deepEqual(withdrawalDraft(state, true, stale), state.accepted, 'a lagging ship projection never wins over local acceptance');
  const editing = hangarStep(state, { type: 'edit', target: 'preview' }); assert.equal(editing.status, 'unreadying');
  const reopened = hangarStep(editing, { type: 'unreadied', accepted: true }); assert.equal(reopened.status, 'idle'); assert.equal(reopened.accepted, null); assert.deepEqual(reopened.draft, { hullId: 'moth', name: 'Mira', color: '#fff' }, 'the draft stays on the accepted hull for editing');
  assert.equal(withdrawalDraft(reopened, false, stale), null, 'nothing ready any more: plain edit, no chooseHull');
  const reloaded = hangarInitial({ hullId: 'kite', name: 'K', color: '#000' }, true); assert.deepEqual(withdrawalDraft(reloaded, true, { hullId: 'kite', name: 'K', color: '#000' }), { hullId: 'kite', name: 'K', color: '#000' }, 'a reload into a ready seat withdraws with the server ship');
  const idle = hangarInitial({ hullId: 'kite', name: 'K', color: '#000' }, false); assert.deepEqual(withdrawalDraft(idle, true, { hullId: 'kite', name: 'K', color: '#000' }), { hullId: 'kite', name: 'K', color: '#000' }, 'server readiness without local acceptance still withdraws');
});
void test('retrying readiness is a locked transaction: no edit can slip in before the ack, a late ack after an edit is ignored, and a rejected retry keeps the editable draft', () => {
  let state = hangarStep(hangarInitial({ hullId: 'wayfarer', name: 'Mira', color: '#fff' }, false), { type: 'select', hullId: 'kite', color: '#8fcbb0' });
  state = hangarStep(hangarStep(hangarStep(state, { type: 'confirm' }), { type: 'chosen', accepted: true }), { type: 'readied', accepted: false, reason: 'Every saved captain must be assigned.' });
  assert.equal(state.status, 'error'); assert.deepEqual(state.accepted, { hullId: 'kite', name: 'Mira', color: '#fff' });
  const retrying = hangarStep(state, { type: 'retry' }); assert.equal(retrying.status, 'readying'); assert.ok(hangarBusy(retrying)); assert.equal(retrying.error, null);
  assert.equal(hangarStep(retrying, { type: 'paint', color: '#ff5748' }).draft.color, '#fff', 'paint is inert during the retry'); assert.equal(hangarStep(retrying, { type: 'name', name: 'Other' }).draft.name, 'Mira'); assert.equal(hangarStep(retrying, { type: 'select', hullId: 'moth', color: '#b79bdc' }).draft.hullId, 'kite');
  const rejected = hangarStep(retrying, { type: 'readied', accepted: false, reason: 'Still waiting.' }); assert.equal(rejected.status, 'error'); assert.equal(rejected.error, 'Still waiting.'); assert.ok(hangarEditable(rejected)); assert.equal(hangarStep(rejected, { type: 'paint', color: '#ff5748' }).draft.color, '#ff5748', 'after rejection the draft is editable again');
  const accepted = hangarStep(retrying, { type: 'readied', accepted: true }); assert.equal(accepted.status, 'accepted'); assert.equal(accepted.expect, 'ready');
  // The old race: edit first, then the stale ack and a ready snapshot arrive.
  const edited = hangarStep(state, { type: 'paint', color: '#ff5748' }); assert.equal(edited.status, 'idle');
  assert.equal(hangarStep(edited, { type: 'readied', accepted: true }).status, 'idle', 'a readied ack without a locked attempt is ignored');
  assert.equal(hangarStep(edited, { type: 'retry' }).status, 'idle', 'no retry once the draft differs from what the server accepted; Confirm is required');
  const adopted = hangarSync(edited, true, { hullId: 'kite', name: 'Mira', color: '#fff' }); assert.equal(adopted.status, 'accepted'); assert.equal(adopted.draft.color, '#fff', 'a ready snapshot adopts the authoritative ship instead of blessing the unsent repaint');
  assert.deepEqual(adopted.accepted, { hullId: 'kite', name: 'Mira', color: '#fff' });
});

void test('blank or padded names: the normalised payload the server accepted becomes the draft and the accepted record, so withdrawal and retry re-send exactly what parseAction took', () => {
  for (const raw of ['', '   ', '  Aurora  ']) {
    let state = hangarStep(hangarInitial({ hullId: 'wayfarer', name: 'Mira', color: '#71a8e8' }, false), { type: 'select', hullId: 'moth', color: '#b79bdc' });
    state = hangarStep(hangarStep(state, { type: 'name', name: raw }), { type: 'confirm' });
    const sent = normalizeDraft(state.draft, 'Moth'); assert.equal(sent.name, raw.trim() || 'Moth');
    assert.doesNotThrow(() => parseAction({ epoch: 1, type: 'chooseHull', ...sent }), 'the confirm payload passes the real parser');
    state = hangarStep(state, { type: 'chosen', accepted: true, sent });
    assert.equal(state.draft.name, sent.name, 'the draft now holds the normalised name'); assert.deepEqual(state.accepted, sent);
    state = hangarStep(state, { type: 'readied', accepted: true });
    const withdrawal = withdrawalDraft(state, false, { hullId: 'moth', name: sent.name, color: '#71a8e8' })!;
    assert.deepEqual(withdrawal, sent, 'withdrawal re-sends the accepted normalised ship, never a blank name');
    assert.doesNotThrow(() => parseAction({ epoch: 1, type: 'chooseHull', ...withdrawal }));
  }
  const failed = hangarStep(hangarStep(hangarStep(hangarStep(hangarInitial({ hullId: 'kite', name: '', color: '#8fcbb0' }, false), { type: 'select', hullId: 'kite', color: '#8fcbb0' }), { type: 'confirm' }), { type: 'chosen', accepted: true, sent: { hullId: 'kite', name: 'Kite', color: '#8fcbb0' } }), { type: 'readied', accepted: false, reason: 'Not yet.' });
  assert.equal(failed.status, 'error'); assert.equal(hangarStep(failed, { type: 'retry', hullName: 'Kite' }).status, 'readying', 'retry compares the normalised draft, so it stays available after a blank name');
  const renamed = hangarStep(failed, { type: 'name', name: 'Other' }); assert.equal(hangarStep(renamed, { type: 'retry', hullName: 'Kite' }).status, 'idle', 'a changed name needs a fresh Confirm, not a retry');
  assert.throws(() => parseAction({ epoch: 1, type: 'chooseHull', hullId: 'kite', name: 'A name that is far too long', color: '#8fcbb0' }), 'the real parser still rejects invalid payloads');
});
