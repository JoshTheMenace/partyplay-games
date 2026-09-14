import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpeciesId } from '../src/contracts';
import { SPECIES, speciesFor } from '../src/definitions/presentation/species';
import { definitions } from '../src/definitions/server';
import { applyEconomyCommand } from '../src/expedition';
import { rules } from '../src/server';
import { createShip, tickSimulation } from '../src/simulation';
import { fixture } from './fixtures';

function isolated(species?: SpeciesId) {
  const state = fixture(1), defs = structuredClone(definitions);
  const ship = state.simulation.ships[0], crew = state.simulation.crew[0];
  const hull = defs.hulls.find(hull => hull.id === ship.hullId)!;
  hull.rooms.forEach((room, index) => Object.assign(room, { x: index * 10, y: 0, w: 10, h: 10, adjacent: hull.rooms.filter((_, other) => Math.abs(index - other) === 1).map(room => room.id) }));
  state.phase = 'route'; state.simulation.crew = [crew];
  if (species) crew.species = species; else delete crew.species;
  Object.assign(crew, { x: 5, y: 5, hp: speciesFor(species).maxHp, maxHp: speciesFor(species).maxHp });
  return { state, defs, ship, crew, hull };
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('every launch hull creates a stable mixed roster with species health and independent specialties', () => {
  for (const hull of definitions.hulls) {
    const { crew } = createShip(definitions, { id: hull.id, hullId: hull.id, ownerCaptainId: 'captain', name: hull.name, color: hull.color, formation: 0, faction: 'allied' });
    crew.forEach((member, index) => {
      assert.equal(member.species, SPECIES[index % 4].id);
      assert.equal(member.hp, speciesFor(member.species).maxHp);
      assert.equal(member.maxHp, member.hp);
    });
    assert.deepEqual(crew.slice(0, 4).map(member => member.skill), ['pilot', 'engineer', 'gunner', 'medic']);
  }
});

test('direct and ordered movement both respect speed, including legacy human defaults', () => {
  for (const species of [undefined, ...SPECIES.map(species => species.id)]) for (const direct of [false, true]) {
    const { state, defs, crew, hull } = isolated(species);
    const inputs = new Map();
    if (direct) {
      state.controlledCrew['captain-1'] = crew.id;
      inputs.set('player-1', { crewId: crew.id, controlEpoch: crew.controlEpoch, x: 1, y: 0, action: 'none' });
    } else crew.order = { kind: 'move', roomId: hull.rooms[1].id };
    tickSimulation(state, inputs, 100, defs);
    near(Math.hypot(crew.x - 5, crew.y - 5), .24 * speciesFor(species).speed);
  }
});

test('Ember melee stacks with fighter specialty and leaves empty-room sabotage unchanged', () => {
  for (const species of ['human', 'ember'] as const) for (const fightingCrew of [false, true]) {
    const { state, defs, ship, crew } = isolated(species);
    state.phase = 'combat'; crew.skill = 'fighter';
    const victim = { ...structuredClone(crew), id: 'victim', species: 'human' as const, ownerCaptainId: null, hp: 100, maxHp: 100 };
    if (fightingCrew) state.simulation.crew.push(victim);
    else crew.ownerCaptainId = null;
    tickSimulation(state, new Map(), 100, defs);
    if (fightingCrew) near(100 - victim.hp, 1.1 * speciesFor(species).melee);
    else near(ship.rooms[0].damage, .2);
  }
});

test('species repair stacks with engineer specialty and healing stops at species maximum', () => {
  for (const species of SPECIES) {
    const { state, defs, ship, crew, hull } = isolated(species.id);
    crew.skill = 'engineer'; ship.rooms[0].damage = 5;
    tickSimulation(state, new Map(), 100, defs);
    near(5 - ship.rooms[0].damage, .5 * species.repair);
    const medical = hull.rooms.find(room => room.system === 'medical')!;
    Object.assign(crew, { roomId: medical.id, x: medical.x + 5, y: 5, hp: crew.maxHp - .1, order: { kind: 'heal', roomId: medical.id } });
    tickSimulation(state, new Map(), 100, defs);
    assert.equal(crew.hp, species.maxHp);
  }
});

test('recruitment validates species before spending and creates explicit full-health species', () => {
  for (const species of [undefined, ...SPECIES.map(species => species.id)]) {
    const state = fixture(1); state.phase = 'store';
    const raw = { epoch: state.epoch, type: 'recruitCrew', skill: 'scientist', replaceCrewId: null, ...(species ? { species } : {}) };
    rules.applyAction(state, 'player-1', rules.parseAction(raw), 0);
    const recruited = state.simulation.crew.at(-1)!;
    assert.equal(recruited.species, species ?? 'human');
    assert.equal(recruited.hp, speciesFor(species).maxHp);
    assert.equal(recruited.maxHp, recruited.hp);
    assert.equal(recruited.skill, 'scientist');
    assert.equal(state.captains[0].wallet, 40);
  }
  for (const species of ['unknown', null, 1, {}, ['human']]) {
    const state = fixture(1); state.phase = 'store'; const before = structuredClone(state);
    const raw = { epoch: state.epoch, type: 'recruitCrew', skill: 'pilot', replaceCrewId: null, species };
    assert.throws(() => rules.parseAction(raw), /species/);
    assert.throws(() => applyEconomyCommand(state, 'captain-1', raw as never, definitions), /species/);
    assert.deepEqual(state, before);
  }
});

test('event recruits fill the least represented living species deterministically', () => {
  const state = fixture(1); state.simulation.crew.forEach(crew => { crew.species = 'human'; crew.hp = crew.maxHp = 100; });
  const event = definitions.events.find(event => event.id === 'broken-lifeline')!;
  for (const expected of ['bastion', 'skitter', 'ember']) {
    state.phase = 'event';
    state.expedition.event = { id: `rescue-${expected}`, definitionId: event.id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: event.choices.map(choice => choice.id) };
    rules.applyAction(state, 'player-1', { epoch: state.epoch, type: 'commitChoice', choiceId: 'dock' }, 0);
    const recruited = state.simulation.crew.at(-1)!;
    assert.equal(recruited.species, expected);
    assert.equal(recruited.maxHp, speciesFor(recruited.species).maxHp);
    assert.equal(recruited.hp, recruited.maxHp);
    assert.equal(recruited.skill, 'engineer');
  }
});

test('ordered movement crosses offset shared doors and waits for locks and capacity', () => {
  const { state, defs, ship, crew, hull } = isolated('skitter');
  Object.assign(hull.rooms[0], { x: 0, y: 0, w: 4, h: 4, adjacent: [hull.rooms[1].id] });
  Object.assign(hull.rooms[1], { x: 4, y: 3, w: 4, h: 4, adjacent: [hull.rooms[0].id, hull.rooms[2].id], capacity: 1 });
  Object.assign(hull.rooms[2], { x: 7, y: 7, w: 4, h: 4, adjacent: [hull.rooms[1].id], capacity: 1 });
  Object.assign(crew, { x: 1, y: 1, order: { kind: 'move', roomId: hull.rooms[2].id } });
  ship.rooms[1].locked = true;
  for (let i = 0; i < 20; i++) tickSimulation(state, new Map(), 100, defs);
  assert.equal(crew.x, 1); assert.equal(crew.y, 1);
  ship.rooms[1].locked = false;
  const blocker = { ...structuredClone(crew), id: 'blocker', roomId: hull.rooms[1].id, x: 6, y: 5, order: { kind: 'hold' as const, roomId: hull.rooms[1].id } };
  state.simulation.crew.push(blocker);
  for (let i = 0; i < 20; i++) tickSimulation(state, new Map(), 100, defs);
  assert.equal(crew.x, 1); assert.equal(crew.y, 1);
  state.simulation.crew = [crew];
  for (let i = 0; i < 200; i++) {
    tickSimulation(state, new Map(), 100, defs);
    const room = hull.rooms.find(room => room.id === crew.roomId)!;
    assert.ok(crew.x >= room.x && crew.x <= room.x + room.w && crew.y >= room.y && crew.y <= room.y + room.h);
  }
  assert.equal(crew.roomId, hull.rooms[2].id);
  assert.equal(crew.x, 9); assert.equal(crew.y, 9);
  assert.equal(crew.activity, 'idle');
});

test('repair and heal arrivals settle inside the destination before working', () => {
  for (const kind of ['repair', 'heal'] as const) {
    const { state, defs, ship, crew, hull } = isolated('human');
    Object.assign(hull.rooms[0], { x: 0, y: 0, w: 4, h: 4, adjacent: [hull.rooms[1].id] });
    Object.assign(hull.rooms[1], { x: 4, y: 3, w: 4, h: 4, adjacent: [hull.rooms[0].id], capacity: 1 });
    Object.assign(ship.rooms[1], kind === 'heal' ? { system: 'medical' } : { damage: 5 });
    Object.assign(crew, { x: 1, y: 1, hp: 50, order: { kind, roomId: hull.rooms[1].id } });
    for (let tick = 0; tick < 100 && crew.activity !== (kind === 'heal' ? 'healing' : 'repairing'); tick++) {
      tickSimulation(state, new Map(), 100, defs);
      const room = hull.rooms.find(room => room.id === crew.roomId)!;
      assert.ok(crew.x >= room.x && crew.x <= room.x + room.w && crew.y >= room.y && crew.y <= room.y + room.h);
    }
    assert.equal(crew.x, 6, kind); assert.equal(crew.y, 5, kind);
    assert.equal(crew.activity, kind === 'heal' ? 'healing' : 'repairing');
  }
});

test('hold and neutral direct input stop unfinished room settling immediately', () => {
  for (const direct of [false, true]) {
    const { state, defs, crew } = isolated('human');
    Object.assign(crew, { x: 0, y: 5, activity: 'moving', order: { kind: direct ? 'heal' : 'hold', roomId: crew.roomId } });
    const inputs = new Map();
    if (direct) {
      state.controlledCrew['captain-1'] = crew.id;
      inputs.set('player-1', { crewId: crew.id, controlEpoch: crew.controlEpoch, x: 0, y: 0, action: 'none' });
    }
    tickSimulation(state, inputs, 100, defs);
    assert.equal(crew.x, 0); assert.equal(crew.y, 5); assert.equal(crew.order.kind, 'hold');
  }
});
