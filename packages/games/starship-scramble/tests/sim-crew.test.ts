import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Crew, Ship } from '../src/contracts';
import { roomAt } from '../src/defs/geometry';
import { hullDef } from '../src/defs/hulls';
import { applyCombatCommand, orderCrew, stepCombat, stepIdle, type World } from '../src/sim/index';
import { addCrew, battle, events, room, run, ship } from './sim-fixtures';

const foe = (hullId = 'raider', over = {}) => ship('foe', hullId, 'enemy', { weapons: [], ...over });
const inRoom = (s: Ship, m: Crew) => roomAt(hullDef(s.hullId).rooms, Math.floor(m.x), Math.floor(m.y))?.id === m.roomId;
const find = (w: World, shipId: string, role: Crew['role']) => w.crew.find(m => m.shipId === shipId && m.role === role)!;

test('crew start at their stations on distinct cells and walk door to door', () => {
  const me = ship('me', 'wayfarer'), w = battle([me, foe()]);
  assert.deepEqual(w.crew.map(m => [m.role, m.roomId, m.station]), [['pilot', 'helm', 'helm'], ['gunner', 'weapons', 'weapons'], ['engineer', 'shields', 'shields']]);
  const gunner = find(w, 'me', 'gunner');
  applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [gunner.id], roomId: 'engines' });
  assert.deepEqual(gunner.path, ['medbay', 'engines']);
  run(w, 1000);
  assert.equal(gunner.state, 'walking'); assert.ok(inRoom(me, gunner) || Number.isInteger(gunner.x) || Number.isInteger(gunner.y));
  run(w, 2000);
  assert.equal(gunner.roomId, 'engines'); assert.equal(gunner.state, 'manning'); assert.equal(gunner.x % 1, .5); assert.ok(inRoom(me, gunner));
  applyCombatCommand(w, 'cap-me', { type: 'stations' }); run(w, 4000);
  assert.equal(gunner.roomId, 'weapons'); assert.equal(gunner.state, 'manning');
});

test('orders validate ownership, life, ship and space', () => {
  const a = ship('a', 'wayfarer'), b = ship('b', 'lancer'), w = battle([a, b, foe()]);
  const [pilot, gunner, engineer] = w.crew.filter(m => m.shipId === 'a');
  assert.throws(() => applyCombatCommand(w, 'cap-b', { type: 'crew', crewIds: [pilot.id], roomId: 'engines' }), /isn't yours/);
  assert.throws(() => applyCombatCommand(w, 'cap-a', { type: 'crew', crewIds: [gunner.id, engineer.id], roomId: 'helm' }), /Not enough space/);
  assert.throws(() => applyCombatCommand(w, 'cap-a', { type: 'crew', crewIds: [gunner.id], roomId: 'teleporter-bay' }), /isn't on this ship/);
  gunner.state = 'dead';
  assert.throws(() => applyCombatCommand(w, 'cap-a', { type: 'crew', crewIds: [gunner.id], roomId: 'engines' }), /fallen/);
  engineer.shipId = 'b';
  assert.throws(() => applyCombatCommand(w, 'cap-a', { type: 'crew', crewIds: [pilot.id, engineer.id], roomId: 'engines' }), /one ship/);
  assert.deepEqual(pilot.path, []);
});

test('crew extinguish fires, which hurt them; untended fires spread and wreck systems', () => {
  const me = ship('me', 'wayfarer', 'ally', { systems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 3, medbay: 1 } }), w = battle([me, foe()]);
  const gunner = find(w, 'me', 'gunner');
  room(me, 'weapons').fire = 2; room(me, 'engines').fire = 3;
  run(w, 1000);
  assert.equal(gunner.state, 'extinguishing'); assert.ok(gunner.hp < 95);
  run(w, 6000);
  assert.equal(room(me, 'weapons').fire, 0);
  const spread = new Set<string>();
  for (let t = 0; t < 180000; t += 50) { stepCombat(w, 50); for (const r of me.rooms) if (r.fire && r.id !== 'engines') spread.add(r.id); }
  assert.ok(spread.has('medbay'), 'fire spread through the engine room door');
  assert.ok(room(me, 'engines').damage > 0);
});

test('breaches and a dead oxygen system drain air; crew suffocate; breaches get patched', () => {
  const me = ship('me', 'wayfarer'), w = battle([me, foe()]);
  room(me, 'cloak').breach = true;
  run(w, 5000);
  assert.ok(room(me, 'cloak').oxygen < 85 && room(me, 'weapons').oxygen === 100);
  room(me, 'oxygen').damage = 1;
  run(w, 32000);
  const pilot = find(w, 'me', 'pilot');
  assert.ok(room(me, 'helm').oxygen < 15); assert.ok(pilot.hp < pilot.maxHp);
  const engineer = find(w, 'me', 'engineer');
  applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [engineer.id], roomId: 'oxygen' });
  run(w, 12000);
  assert.equal(room(me, 'oxygen').damage, 0); assert.ok(room(me, 'helm').oxygen > 15);
  applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [engineer.id], roomId: 'cloak' });
  run(w, 9000);
  assert.equal(room(me, 'cloak').breach, false);
});

test('repairs take 6 s per level, faster for engineers, and report the repairer', () => {
  const me = ship('me', 'wayfarer'), w = battle([me, foe()]);
  room(me, 'weapons').damage = 1; room(me, 'shields').damage = 1;
  run(w, 3500);
  assert.equal(room(me, 'shields').damage, 1);
  run(w, 1000);
  assert.equal(room(me, 'shields').damage, 0); assert.equal(room(me, 'weapons').damage, 1);
  run(w, 2000);
  assert.equal(room(me, 'weapons').damage, 0);
  assert.deepEqual(events(w, 'repair').map(e => [e.roomId, e.crewId, e.amount]), [['shields', find(w, 'me', 'engineer').id, 1], ['weapons', find(w, 'me', 'gunner').id, 1]]);
});

test('teleport queue: crew anywhere aboard walk to the pad and beam to an ally together', () => {
  const me = ship('me', 'corsair', 'ally', { systems: { ...hullDef('corsair').startSystems, teleporter: 1 } }), w = battle([me, ship('fr', 'wayfarer'), foe()]);
  const pilot = find(w, 'me', 'pilot'), soldier = w.crew.find(m => m.shipId === 'me' && m.role === 'soldier')!, order = { type: 'teleport' as const, crewIds: [pilot.id, soldier.id], shipId: 'fr', roomId: 'medbay' };
  applyCombatCommand(w, 'cap-me', order);
  assert.equal(pilot.shipId, 'me'); assert.ok(pilot.beam && soldier.beam && pilot.path.length, 'off-pad crew walk over first');
  run(w, 8000);
  assert.deepEqual([pilot.shipId, soldier.shipId, pilot.roomId, soldier.roomId], ['fr', 'fr', 'medbay', 'medbay'], 'the pair departs together');
  assert.ok(!pilot.beam && !soldier.beam);
  const w2 = battle([ship('me', 'corsair'), ship('fr', 'wayfarer'), foe()]), p2 = find(w2, 'me', 'pilot');
  applyCombatCommand(w2, 'cap-me', { ...order, crewIds: [p2.id] }); applyCombatCommand(w2, 'cap-me', { type: 'crew', crewIds: [p2.id], roomId: 'helm' });
  run(w2, 8000); assert.equal(p2.shipId, 'me', 'a new order cancels the queued teleport'); assert.equal(p2.beam, undefined);
});

test('teleporter capacity, cooldown, ownership and recall', () => {
  const me = ship('me', 'corsair', 'ally', { systems: { ...hullDef('corsair').startSystems, teleporter: 1 } }), friend = ship('fr', 'wayfarer'), enemy = foe(), w = battle([me, friend, enemy]);
  const [a, b] = w.crew.filter(m => m.shipId === 'me' && m.role === 'soldier'), pilot = find(w, 'me', 'pilot');
  assert.equal(a.roomId, 'teleporter'); assert.equal(b.roomId, 'teleporter');
  const send = (ids: string[], shipId = 'foe', roomId = 'weapons', cap = 'cap-me') => applyCombatCommand(w, cap, { type: 'teleport', crewIds: ids, shipId, roomId });
  assert.throws(() => send([find(w, 'fr', 'pilot').id]), /isn't yours/);
  assert.throws(() => send([a.id], 'me'), /another ship/);
  applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [pilot.id], roomId: 'teleporter' }); run(w, 4000);
  assert.throws(() => send([a.id, b.id, pilot.id]), /carries 2/);
  assert.throws(() => send([a.id, b.id], 'foe', 'nowhere'), /isn't on that ship/);
  send([a.id, b.id]);
  assert.deepEqual([a.shipId, a.roomId, b.shipId, b.roomId], ['foe', 'weapons', 'foe', 'weapons']);
  assert.ok(inRoom(enemy, a) && inRoom(enemy, b) && (a.x !== b.x || a.y !== b.y));
  assert.equal(me.teleportCooldownMs, 20000);
  assert.deepEqual(events(w, 'teleport').map(e => e.shipId), ['me', 'foe']);
  applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [a.id], roomId: 'engines' });
  assert.ok(a.path.length > 0);
  assert.throws(() => send([a.id]), /aboard your own ship/);
  run(w, 5000);
  applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [pilot.id], roomId: 'helm' });
  applyCombatCommand(w, 'cap-me', { type: 'recall', shipId: 'foe' });
  assert.deepEqual([a.shipId, a.roomId, b.shipId, b.roomId], ['me', 'teleporter', 'me', 'teleporter'], 'recall works while the teleporter recharges');
  assert.equal(me.teleportCooldownMs, 20000, 'and restarts the cooldown');
  run(w, 20000);
  assert.throws(() => applyCombatCommand(w, 'cap-me', { type: 'recall', shipId: 'foe' }), /None of your crew/);
  assert.throws(() => applyCombatCommand(w, 'cap-fr', { type: 'recall', shipId: 'foe' }), /no teleporter/);
});

test('boarders fight defenders, then sabotage unopposed systems and move on', () => {
  const me = ship('me', 'corsair'), enemy = foe('raider'), w = battle([me, enemy]);
  addCrew(w, enemy, [{ species: 'human', role: 'gunner' }, { species: 'human', role: 'medic' }])[1].hp = 20;
  room(enemy, 'medbay').damage = 1;
  const defender = find(w, 'foe', 'gunner'), [a, b] = w.crew.filter(m => m.role === 'soldier');
  assert.equal(defender.roomId, 'weapons');
  applyCombatCommand(w, 'cap-me', { type: 'teleport', crewIds: [a.id, b.id], shipId: 'foe', roomId: 'weapons' });
  run(w, 500);
  assert.equal(a.state, 'fighting'); assert.equal(defender.state, 'fighting');
  run(w, 3000);
  assert.equal(defender.state, 'dead'); assert.equal(defender.hp, 0); assert.ok(events(w, 'crew-death').some(e => e.crewId === defender.id));
  assert.ok(a.hp < a.maxHp || b.hp < b.maxHp);
  run(w, 25000);
  assert.equal(room(enemy, 'weapons').damage, 2);
  assert.ok(enemy.rooms.filter(r => r.system && r.damage === r.tier).length >= 2);
});

test('killing the last crew member aboard scuttles an enemy; boarders beam home with the kill', () => {
  const me = ship('me', 'corsair'), enemy = foe('raider'), w = battle([me, enemy]);
  const [defender] = addCrew(w, enemy, [{ species: 'human', role: 'gunner' }]), [a, b] = w.crew.filter(m => m.role === 'soldier');
  room(enemy, 'medbay').damage = 1;
  applyCombatCommand(w, 'cap-me', { type: 'teleport', crewIds: [a.id, b.id], shipId: 'foe', roomId: 'weapons' });
  run(w, 5000);
  assert.equal(defender.state, 'dead'); assert.equal(enemy.status, 'destroyed'); assert.equal(w.combat.outcome, 'victory');
  assert.deepEqual([a.shipId, b.shipId, a.state === 'dead'], ['me', 'me', false]);
  assert.deepEqual(events(w, 'explode').map(e => [e.shipId, e.fromShipId]), [['foe', 'me']]);
});

test('enemy crew answer boarders and fires; boarder AI beams two crew aboard', () => {
  const me = ship('me', 'wayfarer'), hive = foe('hive'), w = battle([me, hive]);
  addCrew(w, hive, [{ species: 'human', role: 'pilot' }, { species: 'ember', role: 'soldier' }, { species: 'bastion', role: 'soldier' }, { species: 'human', role: 'engineer' }]);
  room(hive, 'weapons').fire = 1;
  const aboard = () => w.crew.filter(m => m.faction === 'enemy' && m.shipId === 'me');
  for (let t = 0; t < 15000 && !aboard().length; t += 50) stepCombat(w, 50);
  assert.equal(aboard().length, 2); assert.ok(aboard().every(m => m.role === 'soldier' && ['weapons', 'shields'].includes(m.roomId)));
  run(w, 5000);
  assert.equal(room(hive, 'weapons').fire, 0);
});

test('out of combat crew heal and repair, nothing hostile happens, orders still work', () => {
  const me = ship('me', 'wayfarer'), world: World = { ships: [me], crew: [] };
  addCrew(world, me);
  const gunner = find(world, 'me', 'gunner'), pilot = find(world, 'me', 'pilot');
  room(me, 'engines').damage = 2; room(me, 'oxygen').fire = 2; room(me, 'medbay').oxygen = 40; gunner.hp = 50;
  orderCrew(world, 'cap-me', [gunner.id], 'medbay');
  stepIdle(world, 2000);
  assert.equal(gunner.roomId, 'medbay');
  stepIdle(world, 30000);
  assert.equal(gunner.hp, gunner.maxHp);
  assert.equal(room(me, 'engines').damage, 0); assert.equal(room(me, 'oxygen').fire, 0); assert.equal(room(me, 'medbay').oxygen, 100);
  assert.equal(pilot.hp, pilot.maxHp);
  assert.throws(() => orderCrew(world, 'someone', [pilot.id], 'engines'), /isn't yours/);
});

test('stepCombat does nothing during the intro, while paused or after the outcome', () => {
  const me = ship('me', 'wayfarer'), w = battle([me, foe()]), t = w.combat.t;
  w.combat.paused = true; stepCombat(w, 1000); assert.equal(w.combat.t, t);
  w.combat.paused = false; w.combat.outcome = 'escaped'; stepCombat(w, 1000); assert.equal(w.combat.t, t);
  assert.throws(() => applyCombatCommand(w, 'cap-me', { type: 'fire' }), /over/);
});
