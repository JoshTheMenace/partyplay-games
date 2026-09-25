import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_HULLS, hullDef } from '../src/defs/hulls';
import { applyCombatCommand, stepCombat } from '../src/sim/index';
import { addCrew, battle, events, room, run, ship, shoot, skirmish } from './sim-fixtures';

test('a destroyed ship kills everyone aboard, drops shots at it and credits the killer', () => {
  const me = ship('me', 'corsair'), foe = ship('foe', 'raider', 'enemy', { weapons: [] }), w = battle([me, foe]);
  addCrew(w, foe, [{ species: 'human', role: 'pilot' }]);
  const [a, b] = w.crew.filter(m => m.role === 'soldier');
  applyCombatCommand(w, 'cap-me', { type: 'teleport', crewIds: [a.id, b.id], shipId: 'foe', roomId: 'engines' });
  applyCombatCommand(w, 'cap-me', { type: 'target', weapon: 'me-w0', shipId: 'foe', roomId: 'shields' });
  w.combat.projectiles.push({ id: 'late', kind: 'laser', weaponId: 'basic-laser', fromShipId: 'me', toShipId: 'foe', roomId: 'helm', mount: 0, launchMs: w.combat.t, arriveMs: w.combat.t + 1000 });
  foe.hull = 2;
  shoot(w, me, foe, 'swift-missile', 'weapons');
  assert.equal(foe.status, 'destroyed');
  assert.ok(w.crew.filter(m => m.shipId === 'foe').every(m => m.state === 'dead' && m.hp === 0));
  assert.equal(w.crew.filter(m => m.shipId === 'foe').length, 3);
  assert.equal(w.combat.projectiles.length, 0); assert.equal(me.weapons[0].target, null);
  assert.equal(events(w, 'explode')[0].fromShipId, 'me');
  assert.equal(w.combat.outcome, 'victory');
});

test('defeat when every ally is gone; survive objective wins on the timer', () => {
  const me = ship('me', 'wayfarer'), foe = ship('foe', 'raider', 'enemy', { weapons: [] }), w = battle([me, foe]);
  me.hull = 1; room(me, 'helm').damage = 1;
  shoot(w, foe, me, 'swift-missile', 'weapons');
  assert.equal(w.combat.outcome, 'defeat');
  const s = battle([ship('me', 'wayfarer'), ship('foe', 'raider', 'enemy', { weapons: [] })], { objective: 'survive', surviveMs: 10000 });
  run(s, 9800); assert.equal(s.combat.outcome, null);
  run(s, 300); assert.equal(s.combat.outcome, 'victory');
});

test('enemies flee after a 15 s countdown that pauses while they cannot fly; allied crew aboard come home', () => {
  const me = ship('me', 'corsair'), drone = ship('foe', 'drone', 'enemy', { weapons: [], fleeBelow: .5 }), w = battle([me, drone]);
  const [a] = w.crew.filter(m => m.role === 'soldier');
  drone.hull = 5; stepCombat(w, 50);
  assert.equal(drone.fleeAtMs, w.combat.t + 15000);
  run(w, 14000); assert.equal(drone.status, 'active');
  applyCombatCommand(w, 'cap-me', { type: 'teleport', crewIds: [a.id], shipId: 'foe', roomId: 'defense' });
  run(w, 1100);
  assert.equal(drone.status, 'fled'); assert.equal(events(w, 'flee').length, 1); assert.equal(w.combat.outcome, 'victory');
  assert.equal(a.shipId, 'me'); assert.equal(a.state === 'dead', false);
  const raider = ship('foe', 'raider', 'enemy', { weapons: [], fleeBelow: .5 }), p = battle([ship('me', 'wayfarer'), raider]);
  raider.hull = 3; stepCombat(p, 50);
  const at = raider.fleeAtMs!;
  run(p, 20000);
  assert.equal(raider.status, 'active'); assert.ok(raider.fleeAtMs! > at + 19000);
});

test('the flagship heals into each remaining phase and only its last phase can die', () => {
  const phases = [
    { maxHull: 20, weapons: ['burst-laser'], systems: {}, line: 'One' },
    { maxHull: 15, weapons: ['flak-cannon', 'heavy-ion'], systems: { shields: 1, weapons: 2 }, line: 'Two' },
    { maxHull: 10, weapons: ['halberd-beam'], systems: { shields: 4, weapons: 1 }, line: 'Three' },
  ];
  const boss = ship('boss', 'flagship', 'enemy', { maxHull: 20, weapons: ['burst-laser'], phases, systems: { ...ENEMY_HULLS.at(-1)!.startSystems, defense: 0 } }), me = ship('me', 'wayfarer');
  const escort = ship('escort', 'gunship', 'enemy', { weapons: [] }), w = battle([me, boss, escort], { objective: 'boss' });
  room(boss, 'engines').fire = 2; boss.hull = 1;
  shoot(w, me, boss, 'swift-missile', 'weapons');
  assert.equal(boss.status, 'active'); assert.equal(boss.phase, 1); assert.equal(boss.hull, 15); assert.equal(boss.maxHull, 15);
  assert.deepEqual(boss.weapons.map(x => [x.uid, x.defId, x.powered]), [['boss-p1-w0', 'flak-cannon', true], ['boss-p1-w1', 'heavy-ion', true]]);
  assert.equal(room(boss, 'shields').tier, 1); assert.equal(room(boss, 'engines').fire, 0);
  assert.equal(events(w, 'phase')[0].amount, 1);
  boss.hull = 1; shoot(w, me, boss, 'swift-missile', 'weapons');
  assert.equal(boss.phase, 2); assert.equal(boss.shields, 4);
  boss.hull = 1; shoot(w, me, boss, 'swift-missile', 'weapons');
  assert.equal(boss.status, 'destroyed'); assert.equal(escort.status, 'active'); assert.equal(w.combat.outcome, 'victory', 'escorts do not outlive the Flagship'); assert.equal(w.combat.ftl, 0);
});

test('hazards: asteroids every 6 s, solar flares start fires, ion storms slow shields', () => {
  const rocks = battle([ship('me', 'wayfarer'), ship('foe', 'raider', 'enemy', { weapons: [] })], { hazard: 'asteroids' });
  run(rocks, 12000);
  assert.equal(events(rocks, 'hazard').length, 1);
  const flare = battle([ship('me', 'wayfarer'), ship('foe', 'raider', 'enemy', { weapons: [] })], { hazard: 'solar', seed: 3 });
  run(flare, 17100);
  assert.ok(events(flare, 'hazard').length === 1 && events(flare, 'fire').length >= 1);
  const me = ship('me', 'wayfarer'), foe = ship('foe', 'raider', 'enemy', { weapons: [] }), storm = battle([me, foe], { hazard: 'ion-storm' });
  shoot(storm, me, foe, 'basic-laser', 'shields'); run(storm, 2500);
  assert.equal(foe.shields, 0); run(storm, 600); assert.equal(foe.shields, 1);
});

test('the fleet FTL drive charges from allied engines', () => {
  const w = battle([ship('me', 'wayfarer'), ship('foe', 'raider', 'enemy', { weapons: [] })]);
  run(w, 45000);
  assert.ok(Math.abs(w.combat.ftl - 1) < .01);
});

test('the same seed replays the same battle', () => {
  const a = skirmish(7), b = skirmish(7);
  run(a, 60000); run(b, 60000);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(a.combat.events.length > 0 && a.combat.nextId > 50);
});

test('50 randomized 4v3 AI-vs-autopilot battles always finish within 8 minutes', t => {
  const results: string[] = [], times: number[] = [];
  for (let seed = 1; seed <= 50; seed++) {
    const w = skirmish(seed);
    for (let ms = 0; ms < 8 * 60000 + 3000 && !w.combat.outcome; ms += 50) stepCombat(w, 50);
    assert.ok(w.combat.outcome, `seed ${seed} still fighting (${w.ships.map(s => `${s.id}:${s.hullId}:${s.status}:${s.hull}`).join(' ')})`);
    results.push(w.combat.outcome!); times.push(w.combat.t);
  }
  times.sort((a, b) => a - b);
  t.diagnostic(`victories ${results.filter(r => r === 'victory').length}/50, median ${Math.round(times[25] / 1000)} s, max ${Math.round(times[49] / 1000)} s`);
});

test('a 4v4 battle with ~30 crew steps in well under 0.3 ms', t => {
  const w = skirmish(11, 4, 4, 400);
  for (let i = 0; w.crew.length < 30; i++) { const s = w.ships[i % w.ships.length]; if (!hullDef(s.hullId).automated) addCrew(w, s, [{ species: 'skitter', role: 'soldier' }]); }
  run(w, 10000);
  const steps = 4000, start = performance.now();
  for (let i = 0; i < steps; i++) stepCombat(w, 50);
  const ms = (performance.now() - start) / steps;
  assert.equal(w.combat.outcome, null);
  t.diagnostic(`${ms.toFixed(4)} ms per 50 ms step, ${w.crew.length} crew`);
  assert.ok(ms < .3, `${ms} ms per step`);
});
