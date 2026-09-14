import assert from 'node:assert/strict';
import test from 'node:test';
import type { Definitions, DroneDefinition, Input, State, SystemId, WeaponFamily } from '../src/contracts';
import { applySimulationCommand, createShip, destroyShips, effectiveTier, roomManning, tickSimulation } from '../src/simulation';
import { definitions } from '../src/definitions/server';
import { roomFor, standingPlaces } from '../src/simulation/core';

const optional: SystemId[] = ['teleporter', 'drone-bay', 'hacking', 'cloak', 'point-defense', 'shield-projector', 'repair-relay', 'tractor', 'scanner', 'decoy', 'boarding-defense', 'medical-support'];
const behaviors: DroneDefinition['behavior'][] = ['attack', 'intercept', 'repair', 'board', 'scan', 'shield', 'heal', 'fire', 'ion', 'breach', 'decoy', 'salvage'];
function fixture() {
  const families: WeaponFamily[] = ['laser', 'beam', 'missile', 'flak', 'ion', 'plasma', 'boarding', 'support'];
  const defs: Definitions = {
    hulls: [{ id: 'test', name: 'Test', description: 'Test', color: '#fff', maxHull: 100, maxWeapons: 4, rooms: ['piloting', 'weaponry', 'shields', 'engines', 'life-support', 'medical', 'doors', null].map((system, i) => ({ id: `r${i}`, name: `Room ${i}`, x: i % 4 * 2, y: Math.floor(i / 4) * 2, w: 2, h: 2, capacity: 6, system: system as SystemId | null, adjacent: [i % 4 > 0 ? i - 1 : -1, i % 4 < 3 ? i + 1 : -1, i < 4 ? i + 4 : i - 4].filter(index => index >= 0).map(index => `r${index}`) })), startingWeapons: ['laser'], startingSystems: optional, crew: 4, traits: ['adaptable'] }],
    weapons: families.map(family => ({ id: family, name: family, description: family, family, price: 20, chargeMs: 1000, damage: 8, shieldDamage: 2, pierce: family === 'missile' ? 9 : 0, roomDamage: 4, crewDamage: 7, fire: family === 'plasma' ? 3 : 0, breach: family === 'missile' ? 2 : 0, ionMs: family === 'ion' ? 5000 : 0, ammo: family === 'missile' || family === 'boarding' ? 1 : 0, shots: family === 'flak' ? 3 : 1, tier: 1, target: family === 'support' ? 'ally' : 'enemy', tags: [] })),
    systems: [...optional, 'piloting', 'weaponry', 'shields', 'engines', 'life-support', 'medical', 'doors'].map(id => ({ id: id as SystemId, name: id, description: id, price: 20, cooldownMs: 4000, durationMs: 3000, strength: 2, maxTier: 4, tags: [] })),
    drones: behaviors.map(behavior => ({ id: behavior, name: behavior, description: behavior, price: 20, behavior, intervalMs: 500, strength: 2, hp: 12, tags: [] })), augments: [], enemies: [], sectors: [], events: [],
  };
  const crews = ['a', 'b', 'enemy'].map((id, index) => createShip(defs, { id, hullId: 'test', ownerCaptainId: id === 'enemy' ? null : id, name: id, color: '#fff', formation: index, faction: id === 'enemy' ? 'enemy' : 'allied' }));
  const state: State = { schemaVersion: 1, contentVersion: 1, expeditionId: 'test', seed: 3, settings: { difficulty: 'standard', expedition: 'training' }, phase: 'combat', resumePhase: null, epoch: 1, captains: ['a', 'b'].map(id => ({ id, playerId: id, name: id, color: '#fff', currentOwnedShipId: id, connected: true, wallet: 0, cargoShipId: id, ready: false, vote: null, contribution: null, stats: { damage: 0, repairs: 0, kills: 0, collected: 0 }, abandonedCrew: false })), leaderCaptainId: 'a', simulation: { timeMs: 0, rng: 555, nextId: 0, ships: crews.map(item => item.ship), crew: crews.flatMap(item => item.crew), projectiles: [], drones: [], effects: [], objective: { kind: 'destroy', deadlineMs: null, stage: 1, description: 'Win' } }, expedition: { rng: 1, sectorIds: [], sectorIndex: 0, beacons: [], currentBeaconId: '', seenRoots: [], event: null, items: [], rewardRemainder: 0, rewardSerial: 0, threat: 0, flags: {}, reputation: {}, completedBeacons: 0, nextItemId: 0 }, paused: false, pausedBy: null, queue: [], inspections: {}, controlledCrew: {}, result: null, message: '', revision: 0 };
  state.simulation.ships[2].weapons = [];
  state.simulation.ships[2].systems = state.simulation.ships[2].systems.filter(system => !optional.includes(system.id));
  return { state, defs };
}
function advance(state: State, defs: Definitions, milliseconds: number, inputs: ReadonlyMap<string, Input> = new Map()) {
  return Array.from({ length: Math.ceil(milliseconds / 100) }, () => tickSimulation(state, inputs, 100, defs)).flat();
}
test('strategic reading permits recovery and extraction without hostile or environmental harm', () => {
  for (const phase of ['route', 'event', 'rewards', 'store', 'combat'] as const) {
    const { state, defs } = fixture(); state.phase = phase;
    const [ship, ally] = state.simulation.ships;
    const owned = state.simulation.crew.filter(crew => crew.ownerCaptainId === 'a');
    const hostiles = state.simulation.crew.filter(crew => crew.ownerCaptainId === null);
    function place(crew: typeof owned[number], roomId: string) {
      Object.assign(crew, standingPlaces(state, ship, roomId, defs, [crew.id])[0]);
      crew.currentShipId = ship.id; crew.roomId = roomId; crew.order = { kind: 'hold', roomId };
    }
    owned.forEach((crew, index) => place(crew, ['r0', 'r1', 'r5', 'r2'][index]));
    hostiles.slice(0, 3).forEach((crew, index) => place(crew, ['r0', 'r6', 'r7'][index]));
    hostiles[2].order = { kind: 'move', roomId: 'r3' };
    owned[2].hp = 50; ship.rooms[1].damage = 10;
    ship.rooms[4].damage = ship.rooms[4].tier * 10;
    Object.assign(ship.rooms[7], { damage: 3, fire: 2, breach: 2, oxygen: 0 });
    Object.assign(ship.rooms[0], { fire: 2, oxygen: 0 });
    ally.rooms[0].oxygen = 50; ally.shield = 0;
    applySimulationCommand(state, 'a', { type: 'orderCrew', crewId: owned[3].id, roomId: 'r3', order: 'move' }, defs);
    applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: 'boarding-defense', targetShipId: 'a', roomId: 'r0' }, defs);
    applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: 'tractor', targetShipId: 'enemy', roomId: 'r0' }, defs);
    state.simulation.drones.push({ id: 'enemy-drone', definitionId: 'attack', sourceShipId: 'enemy', targetShipId: 'a', targetRoomId: 'r0', hp: 12, nextAtMs: 100000 });
    state.simulation.projectiles.push({ ...defs.weapons.find(weapon => weapon.id === 'missile')!, id: 'incoming', sourceShipId: 'enemy', targetShipId: 'a', roomId: 'r6', weaponId: 'missile', arriveAtMs: 500 });
    const before = structuredClone(state.simulation);
    advance(state, defs, phase === 'combat' ? 1000 : 60000);
    if (phase === 'combat') {
      assert.ok(ship.hull < before.ships[0].hull);
      assert.ok(owned[0].hp < 100); assert.ok(hostiles[0].hp < 100);
      assert.ok(state.simulation.drones[0].hp < 12);
      continue;
    }
    assert.equal(ship.hull, before.ships[0].hull, phase);
    assert.equal(owned[0].hp, 100, phase); assert.equal(owned[2].hp, owned[2].maxHp, phase);
    assert.equal(ship.rooms[1].damage, 0, phase); assert.equal(ship.rooms[6].damage, 0, phase);
    assert.equal(ship.rooms[7].damage, 3, phase); assert.equal(ship.rooms[7].breach, 2, phase);
    assert.equal(ship.rooms[7].fire, 2, phase); assert.equal(ship.rooms[2].oxygen, 100, phase);
    assert.equal(owned[3].roomId, 'r3', phase);
    assert.ok(ally.rooms[0].oxygen > 50, phase); assert.ok(ally.shield > 0, phase);
    assert.deepEqual(hostiles.map(crew => [crew.id, crew.hp, crew.status, crew.x, crew.y]), before.crew.filter(crew => crew.ownerCaptainId === null).map(crew => [crew.id, crew.hp, crew.status, crew.x, crew.y]), phase);
    assert.equal(state.simulation.drones[0].hp, 12, phase);
    assert.equal(state.simulation.projectiles.length, 0, phase);
    applySimulationCommand(state, 'a', { type: 'teleportCrew', crewIds: [owned[0].id], transporterShipId: 'b', targetShipId: 'b', roomId: 'r0' }, defs);
    advance(state, defs, 4000);
    applySimulationCommand(state, 'a', { type: 'teleportCrew', crewIds: [owned[0].id], transporterShipId: 'b', targetShipId: 'a', roomId: 'r0' }, defs);
    assert.equal(owned[0].currentShipId, 'a', phase);
  }
});
test('guests keep command ownership and man with the best eligible skill only', () => {
  const { state, defs } = fixture();
  const guest = state.simulation.crew[0]; guest.skill = 'engineer';
  applySimulationCommand(state, 'a', { type: 'teleportCrew', crewIds: [guest.id], transporterShipId: 'a', targetShipId: 'b', roomId: 'r2' }, defs);
  const before = structuredClone(state);
  assert.throws(() => applySimulationCommand(state, 'b', { type: 'orderCrew', crewId: guest.id, roomId: 'r0', order: 'move' }, defs), /only your own/);
  assert.deepEqual(state, before);
  assert.equal(roomManning(state, 'b', 'r2', defs), guest.id);
  applySimulationCommand(state, 'a', { type: 'orderCrew', crewId: guest.id, roomId: 'r3', order: 'move' }, defs);
  assert.notEqual(roomManning(state, 'b', 'r2', defs), guest.id);
});
test('teleport rejects duplicate, full, shielded and unavailable destinations atomically', () => {
  const { state, defs } = fixture();
  const command = { type: 'teleportCrew' as const, crewIds: ['a-crew-0'], transporterShipId: 'a', targetShipId: 'enemy', roomId: 'r2' };
  assert.throws(() => applySimulationCommand(state, 'a', command, defs), /shields/);
  state.simulation.ships[2].shield = 0;
  const before = structuredClone(state);
  assert.throws(() => applySimulationCommand(state, 'a', { ...command, crewIds: ['a-crew-0', 'a-crew-0'] }, defs), /distinct/);
  defs.hulls[0].rooms[2].capacity = 1;
  assert.throws(() => applySimulationCommand(state, 'a', command, defs), /full/);
  assert.deepEqual(state, before);
});
test('room damage disables slots without deleting weapons or purchased tiers', () => {
  const { state, defs } = fixture();
  const ship = state.simulation.ships[0]; const room = ship.rooms[1]; room.tier = 3; room.damage = 10;
  ship.weapons = [0, 1, 2].map(i => ({ itemId: `w${i}`, definitionId: 'laser', chargeMs: 0, order: null }));
  assert.equal(effectiveTier(room), 2);
  advance(state, defs, 1000);
  assert.ok(ship.weapons[0].chargeMs > 0); assert.equal(ship.weapons[2].chargeMs, 0);
  room.damage = 0; advance(state, defs, 100);
  assert.ok(ship.weapons[2].chargeMs > 0); assert.equal(room.tier, 3); assert.equal(ship.weapons.length, 3);
});
test('destruction is batched, kills guests, preserves offship survivors and launched attacks', () => {
  const { state, defs } = fixture();
  applySimulationCommand(state, 'a', { type: 'teleportCrew', crewIds: ['a-crew-0'], transporterShipId: 'a', targetShipId: 'b', roomId: 'r0' }, defs);
  const weapon = defs.weapons[0];
  state.simulation.projectiles.push({ ...weapon, id: 'launched', sourceShipId: 'a', targetShipId: 'enemy', roomId: 'r0', weaponId: 'laser', arriveAtMs: 2000 });
  state.simulation.ships[0].hull = 0; state.simulation.ships[2].hull = 0;
  const events = destroyShips(state);
  assert.equal(events.filter(event => event.kind === 'ship-destroyed').length, 2);
  assert.equal(state.simulation.crew.find(crew => crew.id === 'a-crew-0')!.status, 'alive');
  assert.equal(state.simulation.crew.find(crew => crew.id === 'a-crew-1')!.status, 'dead');
  assert.equal(state.simulation.projectiles.length, 1);
  assert.equal(destroyShips(state).length, 0);
});
test('paused simulation freezes every timestamp and absent direct input cancels movement', () => {
  const { state, defs } = fixture();
  applySimulationCommand(state, 'a', { type: 'controlCrew', crewId: 'a-crew-0' }, defs);
  state.paused = true; const before = structuredClone(state);
  advance(state, defs, 1000); assert.deepEqual(state, before);
  state.paused = false; const crew = state.simulation.crew[0];
  advance(state, defs, 100); assert.equal(state.controlledCrew.a, crew.id); assert.equal(crew.order.kind, 'hold'); assert.equal(crew.activity, 'idle');
});
test('weapon families execute distinct payloads, support cannot target enemies', () => {
  for (const family of ['laser', 'beam', 'missile', 'flak', 'ion', 'plasma', 'boarding', 'support'] as WeaponFamily[]) {
    const { state, defs } = fixture(); const ship = state.simulation.ships[0]; const enemy = state.simulation.ships[2];
    enemy.shield = 0; enemy.systems = []; enemy.hull = 70; ship.weapons[0].definitionId = family;
    const ally = state.simulation.ships[1]; ally.hull = 50;
    applySimulationCommand(state, 'a', { type: 'targetWeapon', weaponId: ship.weapons[0].itemId, targetShipId: family === 'support' ? 'b' : 'enemy', roomId: 'r7' }, defs);
    advance(state, defs, 3500);
    if (family === 'support') { assert.ok(ally.hull > 50); assert.throws(() => applySimulationCommand(state, 'a', { type: 'targetWeapon', weaponId: ship.weapons[0].itemId, targetShipId: 'enemy', roomId: 'r0' }, defs), /cannot target/); }
    else if (family === 'ion') assert.ok(enemy.rooms[7].disruptedUntilMs > 0);
    else assert.ok(enemy.hull < 70, family);
    if (family === 'boarding') assert.ok(state.simulation.crew.filter(crew => crew.ownerCaptainId === 'a').every(crew => crew.currentShipId === 'a'));
    if (family === 'plasma') assert.ok(enemy.rooms[7].fire > 0);
    if (family === 'missile') assert.ok(ship.ammo < 16);
  }
});
test('all twelve systems have operational controls or explicit deployment commands', () => {
  for (const id of optional.filter(id => !['teleporter', 'drone-bay'].includes(id))) {
    const { state, defs } = fixture(); const hostile = ['hacking', 'tractor', 'scanner'].includes(id);
    const ship = state.simulation.ships[0]; ship.hull = 50; ship.rooms[0].damage = 5;
    applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: id, targetShipId: hostile ? 'enemy' : 'a', roomId: 'r0' }, defs);
    const system = ship.systems.find(system => system.id === id)!;
    assert.ok(system.activeUntilMs > 0, id); assert.ok(system.cooldownUntilMs > 0, id);
    assert.throws(() => applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: id, targetShipId: hostile ? 'enemy' : 'a', roomId: 'r0' }, defs), /recharging/);
    advance(state, defs, 1000);
    if (id === 'repair-relay') assert.ok(ship.hull > 50);
    if (id === 'hacking') assert.ok(state.simulation.ships[2].rooms[0].disruptedUntilMs > 0);
  }
});
test('twelve drone behaviors deploy and tick; replayed deployment never duplicates a drone', () => {
  for (const behavior of behaviors) {
    const { state, defs } = fixture();
    const hostile = ['attack', 'board', 'fire', 'ion', 'breach'].includes(behavior);
    state.expedition.items.push({ id: 'drone', definitionId: behavior, kind: 'drone', ownerCaptainId: 'a', carrierShipId: 'a', location: 'installed', price: 0, version: 0, stockCaptainId: null });
    const command = { type: 'deployDrone' as const, itemId: 'drone', targetShipId: hostile ? 'enemy' : 'a', roomId: 'r7' };
    applySimulationCommand(state, 'a', command, defs);
    assert.throws(() => applySimulationCommand(state, 'a', command, defs));
    advance(state, defs, 700);
    assert.equal(state.simulation.drones.length, 1, behavior); assert.ok(state.simulation.drones[0].nextAtMs > 700, behavior); assert.equal(state.simulation.ships[0].ammo, 15);
  }
});
test('objective timers and escaped boarders settle without stranded combat', () => {
  const { state, defs } = fixture();
  state.simulation.objective = { kind: 'survive', deadlineMs: 1000, stage: 1, description: 'Hold' };
  assert.ok(advance(state, defs, 1000).some(event => event.kind === 'combat-complete' && event.result === 'victory'));
  state.simulation.crew[0].currentShipId = 'enemy'; state.simulation.ships[2].escapeAtMs = 1100;
  assert.ok(advance(state, defs, 100).some(event => event.kind === 'enemy-escaped'));
  assert.equal(state.simulation.crew[0].status, 'captured');
});
test('fixed seed and input produce equal simulations, safe phases never conclude combat', () => {
  const { state, defs } = fixture(); const other = structuredClone(state);
  advance(state, defs, 5000); advance(other, defs, 5000); assert.deepEqual(state, other);
  state.phase = 'route'; state.simulation.ships[2].status = 'destroyed';
  assert.equal(advance(state, defs, 1000).some(event => event.kind === 'combat-complete'), false);
});
test('all authored launch hulls preserve specialization and have distinct legal crew positions', () => {
  for (const hull of definitions.hulls) {
    const { ship, crew } = createShip(definitions, { id: hull.id, hullId: hull.id, ownerCaptainId: 'a', name: hull.name, color: hull.color, formation: 0, faction: 'allied' });
    assert.deepEqual(ship.systems.map(system => system.id).sort(), [...new Set(hull.startingSystems)].sort());
    assert.equal(new Set(crew.map(crew => `${crew.x}:${crew.y}`)).size, crew.length);
    assert.ok(hull.rooms.reduce((sum, room) => sum + room.capacity, 0) >= 40);
    assert.ok(ship.weapons.every(weapon => definitions.weapons.some(definition => definition.id === weapon.definitionId)));
  }
});
test('direct holds reject stale epochs, stop on neutral input and preserve ownership', () => {
  const { state, defs } = fixture(); const crew = state.simulation.crew[0];
  applySimulationCommand(state, 'a', { type: 'controlCrew', crewId: crew.id }, defs);
  const x = crew.x;
  const held: Input = { crewId: crew.id, controlEpoch: crew.controlEpoch - 1, x: .5, y: 0, action: 'none' };
  advance(state, defs, 100, new Map([['a', held]])); assert.equal(crew.x, x);
  held.controlEpoch = crew.controlEpoch; advance(state, defs, 100, new Map([['a', held]])); assert.ok(crew.x > x);
  const movedX = crew.x; advance(state, defs, 100); assert.equal(crew.x, movedX);
  advance(state, defs, 100, new Map([['b', held]])); assert.equal(crew.x, movedX);
});
test('locked movement paths reject before mutation and capacity reserves at room arrival', () => {
  const { state, defs } = fixture(); const ship = state.simulation.ships[0];
  ship.rooms[2].locked = true;
  assert.throws(() => applySimulationCommand(state, 'a', { type: 'orderCrew', crewId: 'a-crew-0', roomId: 'r2', order: 'move' }, defs), /Locked/);
  ship.rooms[2].locked = false; defs.hulls[0].rooms[7].capacity = 1;
  applySimulationCommand(state, 'a', { type: 'orderCrew', crewId: 'a-crew-0', roomId: 'r7', order: 'move' }, defs);
  applySimulationCommand(state, 'a', { type: 'orderCrew', crewId: 'a-crew-1', roomId: 'r7', order: 'move' }, defs);
  advance(state, defs, 20000);
  assert.equal(state.simulation.crew.filter(crew => crew.currentShipId === 'a' && crew.roomId === 'r7').length, 1);
});
test('support variants restore signed payload stats without hurting living crew', () => {
  const { state, defs } = fixture(); const target = state.simulation.ships[1]; const crew = state.simulation.crew.find(crew => crew.currentShipId === target.id)!;
  target.hull = 20; target.shield = 0; target.rooms[0].damage = 10; crew.hp = 20;
  state.simulation.projectiles.push({ id: 'repair', sourceShipId: 'a', targetShipId: 'b', roomId: 'r0', weaponId: 'support', arriveAtMs: 0, damage: -8, shieldDamage: -2, pierce: 0, roomDamage: -5, crewDamage: -20, fire: 0, breach: 0, ionMs: 0, family: 'support' });
  advance(state, defs, 100);
  assert.equal(target.hull, 28); assert.equal(target.shield, 2); assert.ok(target.rooms[0].damage < 5); assert.equal(crew.hp, 40);
});
test('missile saturation exhausts a point defense window, damaged systems cannot activate', () => {
  const { state, defs } = fixture(); const ship = state.simulation.ships[0];
  applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: 'point-defense', targetShipId: 'a', roomId: 'r0' }, defs);
  for (let i = 0; i < 8; i++) state.simulation.projectiles.push({ id: `missile-${i}`, sourceShipId: 'enemy', targetShipId: 'a', roomId: 'r7', weaponId: 'missile', arriveAtMs: 0, damage: 4, shieldDamage: 0, pierce: 9, roomDamage: 0, crewDamage: 0, fire: 0, breach: 0, ionMs: 0, family: 'missile' });
  advance(state, defs, 100);
  assert.ok(ship.hull < 100); assert.equal(state.simulation.effects.filter(effect => effect.text === 'Projectile intercepted').length, 3);
  roomFor(ship, 'hacking').damage = 30;
  assert.throws(() => applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: 'hacking', targetShipId: 'enemy', roomId: 'r0' }, defs), /disabled/);
});
test('repair relay delivers bounded authored strength over its active window', () => {
  const { state, defs } = fixture(); const ship = state.simulation.ships[0];
  ship.hull = 50;
  applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: 'repair-relay', targetShipId: 'a', roomId: 'r0' }, defs);
  advance(state, defs, 3500);
  assert.ok(ship.hull > 50); assert.ok(ship.hull <= 51.01);
});
test('sensor augments extend scans and shorten cooldown without changing ownership', () => {
  const { state, defs } = fixture(); const ship = state.simulation.ships[0];
  defs.augments.push({ id: 'sensor', name: 'Sensor', description: 'Sensor', price: 10, effect: 'sensors', strength: .5, tags: [] }); ship.augments.push('sensor');
  applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: 'scanner', targetShipId: 'enemy', roomId: 'r0' }, defs);
  const system = ship.systems.find(system => system.id === 'scanner')!;
  assert.equal(system.activeUntilMs, 4500); assert.equal(system.cooldownUntilMs, 4000 / 1.5); assert.equal(ship.ownerCaptainId, 'a');
});
test('decoy drone removes a diverted projectile instead of leaving an invalid target ID', () => {
  const { state, defs } = fixture();
  state.expedition.items.push({ id: 'decoy', definitionId: 'decoy', kind: 'drone', ownerCaptainId: 'a', carrierShipId: 'a', location: 'cargo', price: 0, version: 0, stockCaptainId: null });
  applySimulationCommand(state, 'a', { type: 'deployDrone', itemId: 'decoy', targetShipId: 'a', roomId: 'r0' }, defs);
  state.simulation.projectiles.push({ id: 'incoming', sourceShipId: 'enemy', targetShipId: 'a', roomId: 'r0', weaponId: 'missile', arriveAtMs: 2000, damage: 4, shieldDamage: 0, pierce: 9, roomDamage: 0, crewDamage: 0, fire: 0, breach: 0, ionMs: 0, family: 'missile' });
  advance(state, defs, 600);
  assert.equal(state.simulation.projectiles.length, 0);
});
test('lethal interception removes the drone before the next published snapshot', () => {
  const { state, defs } = fixture();
  state.expedition.items.push({ id: 'catcher', definitionId: 'intercept', kind: 'drone', ownerCaptainId: 'a', carrierShipId: 'a', location: 'cargo', price: 0, version: 0, stockCaptainId: null });
  applySimulationCommand(state, 'a', { type: 'deployDrone', itemId: 'catcher', targetShipId: 'a', roomId: 'r0' }, defs);
  state.simulation.projectiles.push({ id: 'lethal', sourceShipId: 'enemy', targetShipId: 'a', roomId: 'r0', weaponId: 'missile', arriveAtMs: 0, damage: 100, shieldDamage: 0, pierce: 9, roomDamage: 0, crewDamage: 0, fire: 0, breach: 0, ionMs: 0, family: 'missile' });
  advance(state, defs, 100);
  assert.equal(state.simulation.drones.length, 0);
});
test('a new effect cannot overflow the saved effect limit during a full recent battle log', () => {
  const { state, defs } = fixture();
  state.simulation.effects = Array.from({ length: 64 }, (_, index) => ({ id: `old-${index}`, kind: 'warning', sourceShipId: 'a', targetShipId: 'a', text: 'Recent battle', atMs: 0 }));
  applySimulationCommand(state, 'a', { type: 'activateSystem', systemId: 'cloak', targetShipId: 'a', roomId: 'r0' }, defs);
  assert.equal(state.simulation.effects.length, 64);
});
test('each authored hull accommodates 32 friendly crew and eight boarders without overlapping spawns', () => {
  for (const hull of definitions.hulls) {
    const { state } = fixture();
    const { ship, crew } = createShip(definitions, { id: 'crowded', hullId: hull.id, ownerCaptainId: 'a', name: hull.name, color: hull.color, formation: 0, faction: 'allied' });
    state.simulation.ships = [ship]; state.simulation.crew = [];
    for (let i = 0; i < 40; i++) {
      const room = hull.rooms.find(room => standingPlaces(state, ship, room.id, definitions).length)!;
      const place = standingPlaces(state, ship, room.id, definitions)[0];
      state.simulation.crew.push({ ...structuredClone(crew[0]), id: `occupant-${i}`, ownerCaptainId: i < 32 ? `captain-${Math.floor(i / 8)}` : null, roomId: room.id, ...place, order: { kind: 'hold', roomId: room.id } });
    }
    assert.equal(new Set(state.simulation.crew.map(crew => `${crew.x}:${crew.y}`)).size, 40);
    assert.equal(hull.rooms.some(room => standingPlaces(state, ship, room.id, definitions).length), false);
    state.phase = 'route'; advance(state, definitions, 100);
    assert.equal(state.simulation.crew.length, 40);
  }
});
