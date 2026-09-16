import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SAVE_BYTES } from '../../../party-contract/src/index';
import { CONTENT_VERSION, type State } from '../src/contracts';
import { definitions as defs } from '../src/definitions/server';
import { legacyHullIds, legacyRoomShapes } from '../src/definitions/presentation/legacy-layouts';
import { exportSave, validateSave } from '../src/save';
import { createShip } from '../src/simulation';
import { fixture } from './fixtures';

function legacySave() {
  const state = fixture(1);
  for (const hull of defs.hulls) {
    const { ship, crew } = createShip(defs, { id: `legacy-${hull.id}`, hullId: hull.id, ownerCaptainId: null, name: hull.name, color: hull.color, formation: 0, faction: 'enemy' });
    state.simulation.ships.push(ship);
    state.simulation.crew.push(...hull.rooms.map((room, index) => ({ ...crew[0], id: `${ship.id}-${room.id}`, roomId: room.id, order: { kind: 'repair' as const, roomId: hull.rooms[(index + 1) % hull.rooms.length].id } })));
  }
  const saved = exportSave(state);
  saved.contentVersion = 1;
  for (const [index, crew] of saved.simulation.crew.entries()) {
    const ship = saved.simulation.ships.find(ship => ship.id === crew.currentShipId)!;
    const [x, y, w, h] = legacyRoomShapes[legacyHullIds.indexOf(ship.hullId)][Number(crew.roomId.slice(1))];
    crew.x = x + w * (index % 5) / 4; crew.y = y + h * (4 - index % 5) / 4;
    crew.hp = 45; crew.maxHp = 100;
    delete crew.species;
  }
  return saved;
}

function expectedMigration(saved: State, currentDefs = defs) {
  const expected = structuredClone(saved);
  expected.contentVersion = CONTENT_VERSION;
  for (const crew of expected.simulation.crew) {
    const ship = expected.simulation.ships.find(ship => ship.id === crew.currentShipId)!;
    const room = currentDefs.hulls.find(hull => hull.id === ship.hullId)!.rooms.find(room => room.id === crew.roomId);
    if (room) {
      const [x, y, w, h] = legacyRoomShapes[legacyHullIds.indexOf(ship.hullId)][Number(crew.roomId.slice(1))];
      crew.x = room.x + (crew.x - x) / w * room.w;
      crew.y = room.y + (crew.y - y) / h * room.h;
    }
    crew.species ??= 'human';
  }
  return expected;
}

test('version 1 migrates every room of all eight hulls, preserving crew state and input', () => {
  const saved = legacySave(), before = structuredClone(saved);
  assert.equal(defs.hulls.length, 8);
  assert.deepEqual(validateSave(saved, defs), expectedMigration(saved));
  assert.deepEqual(saved, before);
  assert.deepEqual(validateSave(exportSave(validateSave(saved, defs)), defs), exportSave(expectedMigration(saved)));
});

test('migration translates and scales positions before applying new room bounds', () => {
  const saved = legacySave();
  const changedDefs = { ...defs, hulls: defs.hulls.map(hull => ({ ...hull, rooms: hull.rooms.map(room => ({ ...room, x: room.x + 100, y: room.y + 200, w: room.w * 2, h: room.h * 3 })) })) };
  const migrated = validateSave(saved, changedDefs);
  assert.deepEqual(migrated, expectedMigration(saved, changedDefs));
  assert.notEqual(migrated.simulation.crew[0].x, saved.simulation.crew[0].x);
  assert.deepEqual(validateSave(migrated, changedDefs), migrated);
  saved.simulation.crew[0].x = migrated.simulation.crew[0].x;
  saved.simulation.crew[0].y = migrated.simulation.crew[0].y;
  assert.throws(() => validateSave(saved, changedDefs), /outside its room/);
});

test('current saves retain exact coordinates and all species through roundtrip', () => {
  const saved = exportSave(fixture(4));
  const species = ['human', 'bastion', 'skitter', 'ember'] as const;
  for (const [index, crew] of saved.simulation.crew.entries()) {
    const ship = saved.simulation.ships.find(ship => ship.id === crew.currentShipId)!;
    const room = defs.hulls.find(hull => hull.id === ship.hullId)!.rooms.find(room => room.id === crew.roomId)!;
    crew.x = room.x + room.w * .173; crew.y = room.y + room.h * .817;
    crew.species = species[index % species.length];
  }
  assert.equal(saved.contentVersion, 2);
  assert.deepEqual(validateSave(saved, defs), saved);
  delete saved.simulation.crew[0].species;
  assert.deepEqual(validateSave(saved, defs), saved);
});

test('legacy corruption fails before migration can disguise it', () => {
  const saved = legacySave();
  const ship = saved.simulation.ships.find(ship => ship.id === saved.simulation.crew[0].currentShipId)!;
  const [x, y, w, h] = legacyRoomShapes[legacyHullIds.indexOf(ship.hullId)][0];
  for (const [badX, badY] of [[x - .01, y], [x + w + .01, y], [x, y - .01], [x, y + h + .01]]) {
    const bad = structuredClone(saved); bad.simulation.crew[0].x = badX; bad.simulation.crew[0].y = badY;
    const before = structuredClone(bad);
    assert.throws(() => validateSave(bad, defs), /outside its room/);
    assert.deepEqual(bad, before);
  }
  for (const mutate of [
    (state: State) => { state.simulation.crew[0].ownerCaptainId = 'intruder'; },
    (state: State) => { state.simulation.crew[0].order.roomId = 'missing'; },
    (state: State) => { state.simulation.crew[0].roomId = 'missing'; },
    (state: State) => { state.simulation.ships[0].rooms[0].tier = 99; },
    (state: State) => { state.simulation.crew[0].hp = 101; },
  ]) { const bad = structuredClone(saved); mutate(bad); assert.throws(() => validateSave(bad, defs)); }
});

test('current coordinates remain subject to room bounds', () => {
  const saved = exportSave(fixture(1)); saved.simulation.crew[0].x = -100;
  assert.throws(() => validateSave(saved, defs), /outside its room/);
});

for (const status of ['dead', 'captured', 'dismissed'] as const) test(`legacy ${status} crew migrate only when their recorded room exists`, () => {
  const saved = legacySave(), crew = saved.simulation.crew[4];
  crew.status = status; if (status === 'dead') crew.hp = 0;
  assert.deepEqual(validateSave(saved, defs), expectedMigration(saved));
  const bad = structuredClone(saved); bad.simulation.crew[4].x = -100;
  assert.throws(() => validateSave(bad, defs), /outside its room/);
  crew.roomId = 'missing'; crew.x = 123; crew.y = 456;
  assert.deepEqual(validateSave(saved, defs), expectedMigration(saved));
});

test('unknown species and unsupported versions are rejected', () => {
  for (const saved of [legacySave(), exportSave(fixture(1))]) {
    for (const species of ['unknown', '', null, 7]) {
      const bad = structuredClone(saved); Object.assign(bad.simulation.crew[0], { species });
      assert.throws(() => validateSave(bad, defs));
    }
    for (const contentVersion of [0, 3, 100]) assert.throws(() => validateSave({ ...saved, contentVersion }, defs));
    assert.throws(() => validateSave({ ...saved, schemaVersion: 2 }, defs));
  }
});

test('a legacy save near the byte limit permits bounded migration growth but oversized inputs fail', () => {
  const saved = legacySave(), size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  while (size(saved) < MAX_SAVE_BYTES - 4010) saved.simulation.crew[0].traits.push('x'.repeat(4000));
  saved.simulation.crew[0].traits.push('x'.repeat(MAX_SAVE_BYTES - size(saved) - 13));
  const before = structuredClone(saved);
  assert.equal(size(saved), MAX_SAVE_BYTES - 10);
  const migrated = validateSave(saved, defs);
  assert.ok(size(migrated) > MAX_SAVE_BYTES);
  assert.deepEqual(migrated, expectedMigration(saved));
  assert.deepEqual(saved, before);
  saved.message += 'x'.repeat(11);
  assert.throws(() => validateSave(saved, defs), /exceeds 256 KiB/);
  assert.throws(() => validateSave(migrated, defs), /exceeds 256 KiB/);
});
