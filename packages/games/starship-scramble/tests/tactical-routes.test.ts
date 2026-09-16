import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpedition } from '../src/expedition';
import { definitions as defs } from '../src/definitions/server';
import { interiorView, projectPublic } from '../src/projections';
import { blueprintRooms } from '../src/ui/fleet';
import { battleFixture } from './fixtures';

test('standard routes vary by seed, remain connected, and offer shortcuts and distinct branches', () => {
  const maps = new Set<string>(), settings = { difficulty: 'relaxed', expedition: 'standard' } as const;
  for (let seed = 0; seed < 100; seed++) {
    const exp = createExpedition(seed, settings, 2, defs), nodes = exp.beacons;
    assert.deepEqual(exp, createExpedition(seed, settings, 2, defs)); maps.add(JSON.stringify(nodes));
    const starts = nodes.filter(b => b.column === 0), exit = nodes.find(b => b.kind === 'exit')!;
    assert.equal(new Set(starts.map(b => b.kind)).size, 3);
    const reached = new Set(starts.map(b => b.id));
    for (const node of nodes) {
      assert.ok(reached.has(node.id), `${node.id} reachable from departure`);
      if (node !== exit) assert.ok(node.next.length > 0);
      assert.equal(new Set(node.next).size, node.next.length);
      for (const id of node.next) { assert.ok(nodes.find(b => b.id === id)!.column > node.column); reached.add(id); }
    }
    const lengths = (id: string): number[] => { const node = nodes.find(b => b.id === id)!; return node === exit ? [1] : node.next.flatMap(next => lengths(next).map(n => n + 1)); };
    const paths = starts.flatMap(b => lengths(b.id));
    assert.ok(Math.min(...paths) < Math.max(...paths), 'shortcuts change trip length');
    assert.ok(nodes.some(b => b.column > 0 && b.column < 5 && b.next.length < nodes.filter(n => n.column === b.column + 1).length), 'branches restrict later destinations');
  }
  assert.equal(maps.size, 100);
});

test('ally and enemy blueprints expose installed systems but conceal crew and room conditions', () => {
  const state = battleFixture(2, 1), captain = state.captains[0];
  for (const ship of state.simulation.ships.filter(s => s.ownerCaptainId !== captain.id)) {
    ship.rooms[0].fire = 9; ship.rooms[0].damage = 12;
    const hidden = interiorView(state, ship, captain, defs);
    assert.equal(hidden.crew.length, 0); assert.ok(hidden.rooms.every(r => !r.known && r.fire === 0 && r.damage === 0));
    assert.deepEqual(hidden.rooms.map(r => r.system), ship.rooms.map(r => r.system));
    const blueprints = blueprintRooms(projectPublic(state, defs).ships.find(s => s.id === ship.id)!);
    assert.ok(blueprints.every(r => !r.known && r.mannedBy === null && r.fire === 0));
    const scout = state.simulation.crew.find(c => c.ownerCaptainId === captain.id)!;
    scout.currentShipId = ship.id; scout.roomId = ship.rooms[0].id;
    const visited = interiorView(state, ship, captain, defs);
    assert.equal(visited.rooms[0].fire, 9); assert.equal(visited.rooms[0].known, true);
    assert.ok(visited.rooms.slice(1).every(r => !r.known));
    scout.currentShipId = captain.currentOwnedShipId!;
    const scanner = state.simulation.ships.find(s => s.ownerCaptainId === captain.id)!.systems.find(s => s.id === 'scanner')!;
    scanner.targetShipId = ship.id; scanner.activeUntilMs = state.simulation.timeMs + 100;
    assert.ok(interiorView(state, ship, captain, defs).rooms.every(r => r.known));
    scanner.activeUntilMs = state.simulation.timeMs;
    assert.ok(interiorView(state, ship, captain, defs).rooms.every(r => !r.known));
  }
});
