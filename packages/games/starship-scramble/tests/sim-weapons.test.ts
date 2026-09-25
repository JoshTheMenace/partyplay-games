import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCombatCommand, deriveShip, stepCombat } from '../src/sim/index';
import { neighbors } from '../src/defs/geometry';
import { hullDef } from '../src/defs/hulls';
import { battle, events, room, run, ship, shoot } from './sim-fixtures';

const target = (hullId = 'raider', over = {}) => ship('foe', hullId, 'enemy', { weapons: [], ...over });

test('laser bolts pop one shield layer each, and layers recharge in 2 s', () => {
  const me = ship('me', 'wayfarer'), foe = target(), w = battle([me, foe]);
  shoot(w, me, foe, 'basic-laser', 'shields');
  assert.equal(foe.shields, 0); assert.equal(foe.hull, 14); assert.equal(events(w, 'shield').length, 1);
  run(w, 1500); assert.equal(foe.shields, 0);
  run(w, 600); assert.equal(foe.shields, 1);
  shoot(w, me, foe, 'basic-laser', 'shields', 2);
  assert.equal(foe.hull, 13); assert.equal(room(foe, 'shields').damage, 1);
  assert.deepEqual(events(w, 'hit').at(-1), { ...events(w, 'hit').at(-1), shipId: 'foe', roomId: 'shields', amount: 1, fromShipId: 'me', weaponId: 'basic-laser' });
});

test('missiles pierce shields, spend ammo and cannot fire when empty', () => {
  const me = ship('me', 'wayfarer'), foe = target(), w = battle([me, foe]);
  shoot(w, me, foe, 'swift-missile', 'weapons');
  assert.equal(foe.hull, 12); assert.equal(foe.shields, 1);
  const missile = me.weapons[1];
  Object.assign(missile, { charge: 1, target: { shipId: 'foe', roomId: 'weapons' } });
  stepCombat(w, 50);
  assert.equal(me.ammo, 7); assert.equal(missile.charge < .1, true);
  const flying = w.combat.projectiles.find(p => p.kind === 'missile')!;
  assert.equal(flying.mount, 1); assert.ok(flying.arriveMs - flying.launchMs >= 1800 && flying.arriveMs - flying.launchMs <= 2200);
  Object.assign(missile, { charge: 1, auto: false }); me.ammo = 0;
  assert.throws(() => applyCombatCommand(w, 'cap-me', { type: 'fire' }), /No weapons are ready/);
  missile.auto = true; stepCombat(w, 50);
  assert.equal(w.combat.projectiles.filter(p => p.kind === 'missile').length, 1);
});

test('missile recycler saves roughly a third of missiles', () => {
  const me = ship('me', 'wayfarer', 'ally', { augments: ['missile-recycler'], ammo: 200 }), foe = target('raider', { maxHull: 10000 }), w = battle([me, foe]);
  for (let i = 0; i < 100; i++) { Object.assign(me.weapons[1], { charge: 1, target: { shipId: 'foe', roomId: 'weapons' } }); stepCombat(w, 50); }
  assert.ok(me.ammo > 118 && me.ammo < 150, `ammo left ${me.ammo}`);
});

test('beams are blocked by enough shield layers and otherwise sweep rooms', () => {
  const me = ship('me', 'lancer'), foe = target(), w = battle([me, foe]);
  shoot(w, me, foe, 'pike-beam', 'weapons');
  assert.equal(foe.hull, 14); assert.equal(foe.shields, 1); assert.equal(events(w, 'shield').length, 1);
  shoot(w, me, foe, 'halberd-beam', 'weapons');
  assert.equal(foe.hull, 12); assert.equal(events(w, 'hit').length, 2);
  foe.shields = 0; shoot(w, me, foe, 'pike-beam', 'engines');
  assert.equal(foe.hull, 9); assert.equal(new Set(events(w, 'hit').slice(2).map(e => e.roomId)).size, 3);
});

test("a volley's beam sweeps after its bolts have popped the shields", () => {
  const me = ship('me', 'lancer'), foe = target('raider', { maxHull: 99 }), w = battle([me, foe]);
  for (const x of me.weapons) Object.assign(x, { charge: 1, auto: false, target: { shipId: 'foe', roomId: 'weapons' } });
  applyCombatCommand(w, 'cap-me', { type: 'fire' });
  const beam = w.combat.projectiles.find(p => p.kind === 'beam')!;
  assert.ok(w.combat.projectiles.every(p => p === beam || p.arriveMs < beam.arriveMs));
  run(w, 2100);
  assert.equal(events(w, 'hit').filter(e => e.weaponId === 'pike-beam').length, 3);
});

test('ion strips shield layers and locks recharge; unshielded it ionizes the system', () => {
  const me = ship('me', 'lancer'), foe = target('gunship'), w = battle([me, foe]);
  shoot(w, me, foe, 'heavy-ion', 'shields');
  assert.equal(foe.shields, 0); assert.ok(foe.shieldCharge < 0);
  run(w, 3500); assert.equal(foe.shields, 0);
  run(w, 3000); assert.equal(foe.shields, 1);
  foe.shields = 0; foe.shieldCharge = -2;
  shoot(w, me, foe, 'ion-blast', 'weapons');
  assert.equal(room(foe, 'weapons').ionMs > 5000, true); assert.equal(deriveShip(foe, w).levels.weapons, 0); assert.equal(events(w, 'ion').length, 1);
  assert.equal(foe.hull, 18);
});

test('evasion needs a crewed helm, except on automated hulls; nebula and cloak add', () => {
  const me = ship('me', 'wayfarer'), w = battle([me, target()]);
  assert.equal(deriveShip(me, w).evasion, 2 * 5 + 3 + 5);
  const pilot = w.crew.find(m => m.roomId === 'helm')!;
  applyCombatCommand(w, 'cap-me', { type: 'crew', crewIds: [pilot.id], roomId: 'oxygen' }); stepCombat(w, 50);
  assert.equal(deriveShip(me, w).evasion, 0);
  const foe = target('raider', { maxHull: 999 }), hit = battle([ship('y', 'wayfarer'), foe]);
  for (let i = 0; i < 20; i++) shoot(hit, me, foe, 'swift-missile', 'engines');
  assert.equal(events(hit, 'miss').length, 0);
  const drone = target('drone'), neb = battle([ship('x', 'wayfarer'), drone], { hazard: 'nebula' });
  assert.equal(deriveShip(drone, neb).evasion, 3 * 5 + 3 + 10);
  drone.cloakMs = 1000; assert.equal(deriveShip(drone, neb).evasion, 88);
});

test('cloak command, duration, cooldown and evasion', () => {
  const me = ship('me', 'wayfarer', 'ally', { systems: { helm: 1, engines: 2, shields: 1, weapons: 2, oxygen: 1, medbay: 1, cloak: 1 } }), w = battle([me, target()]);
  const before = deriveShip(me, w).evasion;
  applyCombatCommand(w, 'cap-me', { type: 'cloak' });
  assert.equal(me.cloakMs, 5000); assert.equal(deriveShip(me, w).evasion, before + 60); assert.equal(events(w, 'cloak').length, 1);
  assert.throws(() => applyCombatCommand(w, 'cap-me', { type: 'cloak' }), /Already cloaked/);
  run(w, 5100); assert.equal(me.cloakMs, 0);
  assert.throws(() => applyCombatCommand(w, 'cap-me', { type: 'cloak' }), /recharging/);
  run(w, 25000); applyCombatCommand(w, 'cap-me', { type: 'cloak' });
  assert.throws(() => applyCombatCommand(battle([ship('b', 'bulwark'), target()]), 'cap-b', { type: 'cloak' }), /no cloak/);
});

test('point defense shoots down one missile per cooldown', () => {
  const me = ship('me', 'wayfarer'), foe = target('gunship', { systems: { helm: 1, engines: 2, shields: 2, weapons: 3, oxygen: 1, medbay: 1, defense: 1 } }), w = battle([me, foe]);
  shoot(w, me, foe, 'swift-missile', 'weapons', 2);
  assert.equal(events(w, 'intercept').length, 1); assert.equal(foe.hull, 16); assert.equal(foe.defenseCooldownMs > 5000, true);
  shoot(w, me, foe, 'basic-laser', 'weapons');
  assert.equal(events(w, 'intercept').length, 1);
  run(w, 6000); shoot(w, me, foe, 'flak-cannon', 'weapons');
  assert.equal(events(w, 'intercept').at(-1)?.atMs, w.combat.t);
});

test('flak scatters fragments over the target room and its neighbours', () => {
  const me = ship('me', 'wayfarer', 'ally', { weapons: ['flak-cannon'] }), foe = target('gunship', { maxHull: 999 }), w = battle([me, foe]);
  const rooms = new Set<string>();
  for (let i = 0; i < 12; i++) { Object.assign(me.weapons[0], { charge: 1, target: { shipId: 'foe', roomId: 'shields' } }); stepCombat(w, 50); for (const p of w.combat.projectiles) rooms.add(p.roomId); }
  assert.equal(w.combat.projectiles.length, 48);
  const allowed = ['shields', ...neighbors(hullDef('gunship'), 'shields')];
  assert.ok(rooms.size > 1 && [...rooms].every(id => allowed.includes(id)), [...rooms].join());
});

test('support weapons repair hull and systems, grant a temporary layer, and heal crew', () => {
  const medic = ship('med', 'halcyon', 'ally', { weapons: ['nanite-lance', 'aegis-projector', 'medic-pulse'] }), friend = ship('fr', 'wayfarer'), foe = target(), w = battle([medic, friend, foe]);
  friend.hull = 20; room(friend, 'engines').damage = 1; room(friend, 'helm').damage = 1;
  shoot(w, medic, friend, 'nanite-lance', 'engines');
  assert.equal(friend.hull, 22); assert.equal(room(friend, 'engines').damage, 0); assert.equal(events(w, 'heal').at(-1)?.amount, 2);
  shoot(w, medic, friend, 'aegis-projector', 'shields');
  assert.equal(friend.tempShield, 1);
  shoot(w, foe, friend, 'basic-laser', 'shields');
  assert.equal(friend.tempShield, 0); assert.equal(friend.shields, 1);
  const hurt = w.crew.find(m => m.shipId === 'fr')!; hurt.hp = 20;
  shoot(w, medic, friend, 'medic-pulse', hurt.roomId);
  assert.ok(hurt.hp >= 60);
  assert.throws(() => applyCombatCommand(w, 'cap-med', { type: 'target', weapon: 'med-w0', shipId: 'foe', roomId: 'shields' }), /Support weapons target allies/);
  assert.throws(() => applyCombatCommand(w, 'cap-fr', { type: 'target', weapon: 'fr-w0', shipId: 'med', roomId: 'shields' }), /Target an enemy/);
});

test('only the first `weapons level` slots are powered; damage unpowers the last', () => {
  const me = ship('me', 'lancer'), foe = target(), w = battle([me, foe]);
  run(w, 1000);
  assert.deepEqual(me.weapons.map(x => x.powered), [true, true, true]);
  const charged = me.weapons[2].charge;
  room(me, 'helm').damage = 1;
  shoot(w, foe, me, 'swift-missile', 'weapons');
  assert.equal(room(me, 'weapons').damage, 2);
  stepCombat(w, 50);
  assert.deepEqual(me.weapons.map(x => x.powered), [true, false, false]);
  run(w, 500); assert.ok(me.weapons[2].charge < charged);
});

test('weapon commands validate ownership and targets before changing anything', () => {
  const a = ship('a', 'wayfarer'), b = ship('b', 'lancer'), foe = target(), w = battle([a, b, foe]);
  assert.throws(() => applyCombatCommand(w, 'cap-a', { type: 'target', weapon: 'b-w0', shipId: 'foe', roomId: 'shields' }), /isn't yours/);
  assert.throws(() => applyCombatCommand(w, 'cap-a', { type: 'target', weapon: 'a-w0', shipId: 'foe', roomId: 'nowhere' }), /room/);
  assert.throws(() => applyCombatCommand(w, 'cap-a', { type: 'target', weapon: 'a-w0', shipId: 'ghost', roomId: 'shields' }), /out of the fight/);
  assert.throws(() => applyCombatCommand(w, 'nobody', { type: 'fire' }), /out of action/);
  assert.equal(a.weapons[0].target, null);
  applyCombatCommand(w, 'cap-a', { type: 'autofire', weapon: 'a-w0', auto: false });
  applyCombatCommand(w, 'cap-a', { type: 'target', weapon: 'a-w0', shipId: 'foe', roomId: 'shields' });
  applyCombatCommand(w, 'cap-a', { type: 'target', weapon: 'a-w1', shipId: 'foe', roomId: 'weapons' });
  run(w, 12000);
  assert.equal(a.weapons[0].charge, 1); assert.ok(a.weapons[1].charge < 1);
  applyCombatCommand(w, 'cap-a', { type: 'fire' });
  assert.equal(a.weapons[0].charge, 0); assert.deepEqual(events(w, 'launch').filter(e => e.weaponId === 'burst-laser').map(e => e.shipId), ['a']);
  assert.equal(w.combat.projectiles.filter(p => p.weaponId === 'burst-laser').length, 2);
  applyCombatCommand(w, 'cap-a', { type: 'untarget', weapon: 'a-w1' }); assert.equal(a.weapons[1].target, null);
});

test('late-game augments: pre-igniter, repair drone, FTL booster and reactive armor', () => {
  const hot = ship('hot', 'wayfarer', 'ally', { augments: ['pre-igniter', 'repair-drone', 'ftl-booster'] }), plain = ship('plain', 'wayfarer');
  const w = battle([hot, target()]), base = battle([plain, target()]);
  assert.ok(hot.weapons.every(x => x.charge === 1), 'pre-igniter starts weapons charged'); assert.ok(plain.weapons.every(x => x.charge === 0));
  hot.hull = 20; run(w, 21000); run(base, 21000);
  assert.equal(hot.hull, 21, 'repair drone patches 1 hull per 20 s'); assert.ok(w.combat.ftl > base.combat.ftl * 1.2, 'FTL booster charges faster');
  const tough = target('raider', { augments: ['reactive-armor'], systems: { shields: 0 } }), me = ship('me', 'wayfarer'), a = battle([me, tough]);
  tough.hull = tough.maxHull = 1000; shoot(a, me, tough, 'swift-missile', 'weapons', 60);
  const taken = 1000 - tough.hull; assert.ok(taken < 120 && taken > 90, `reactive armor shrugs off ~20% of hits (took ${taken} of 120)`);
});
