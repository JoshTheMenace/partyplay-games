import assert from 'node:assert/strict';
import test from 'node:test';
import { findPath, lineOfSight, move, opaque, solid, visibleCells } from '../src/geometry.js';
import { MAPS } from '../src/maps.js';
import type { ObjectView, Point } from '../src/model.js';
import { getGuards } from '../src/server-levels.js';

const p = (x: number, y: number): Point => ({ x: x + .5, y: y + .5 });
const door: ObjectView = { id: 'door', kind: 'door', label: 'Lock', ...p(2, 1), state: 'ready', until: 0 };
const box = ['#####', '#...#', '#...#', '#...#', '#####'];

for (const map of Object.values(MAPS)) {
  test(`${map.id}: authored content is legal and every role has a walkable solo route`, () => {
    const before = JSON.stringify(map), open: ObjectView[] = map.objects.map(o => ({ ...o, state: 'open', until: 0 }));
    assert.equal(map.width, 32); assert.equal(map.height, 18);
    assert.equal(map.tiles.length, 18);
    assert(map.tiles.every(row => row.length === 32 && /^[#%=~.]+$/.test(row)));
    assert.equal(map.spawns.length, 4);
    assert.equal(map.objects.filter(o => o.kind === 'objective').length, 1);
    assert.equal(map.objects.filter(o => o.kind === 'exit').length, 1);
    assert(map.objects.length <= 64 && map.loot.length <= 256);
    assert(map.props.length >= 30 && map.rooms.length >= 7);
    assert.equal(new Set(map.objects.map(o => o.id)).size, map.objects.length);
    assert.equal(new Set(map.loot.map(o => `${o.x},${o.y}`)).size, map.loot.length);
    for (const point of [...map.spawns, ...map.loot, ...map.objects]) {
      assert.equal(point.x % 1, .5); assert.equal(point.y % 1, .5);
      assert(!solid(map.tiles, open, point.x, point.y), `solid content ${JSON.stringify(point)}`);
      if (point.x !== map.spawns[0].x || point.y !== map.spawns[0].y) assert(findPath(map.tiles, open, map.spawns[0], point).length, `unreachable ${JSON.stringify(point)}`);
    }
    for (const o of map.objects) {
      if (o.kind === 'camera' || o.kind === 'laser') assert(map.objects.some(t => t.kind === 'terminal' && t.circuit === o.circuit));
      if (o.kind === 'vent') {
        assert(o.target && !solid(map.tiles, open, o.target.x, o.target.y));
        assert(map.objects.some(v => v.kind === 'vent' && v.x === o.target?.x && v.y === o.target.y && v.target?.x === o.x && v.target.y === o.y));
      }
    }
    const locked: ObjectView[] = map.objects.map(o => ({ ...o, state: 'ready', until: 0 }));
    const guards = getGuards(map.id);
    assert.equal(guards.length, map.id === 'velvet' ? 5 : 7);
    for (const guard of guards) {
      assert(!solid(map.tiles, locked, guard.x, guard.y));
      assert(Math.hypot(guard.x - map.spawns[0].x, guard.y - map.spawns[0].y) >= 4);
      for (const point of guard.patrol) {
        assert(!solid(map.tiles, locked, point.x, point.y));
        if (point.x !== guard.x || point.y !== guard.y) assert(findPath(map.tiles, locked, guard, point).length, `blocked patrol ${guard.id}`);
      }
    }
    visibleCells(map.tiles, locked, map.spawns);
    move(map.tiles, locked, map.spawns[0], 1, 0);
    guards[0].patrol[0].x = -100;
    assert(getGuards(map.id)[0].patrol[0].x > 0);
    assert.equal(JSON.stringify(map), before);
  });
}

test('glass and water block movement but transmit sight; doors respond to state', () => {
  for (const material of ['=', '~']) {
    const tiles = ['#####', `#.${material}.#`, '#####'];
    assert(solid(tiles, [], 2, 1)); assert(!opaque(tiles, [], 2, 1));
    assert(lineOfSight(tiles, [], p(1, 1), p(3, 1)));
    assert.equal(findPath(tiles, [], p(1, 1), p(3, 1)).length, 0);
  }
  assert(solid(box, [door], 2, 1)); assert(!lineOfSight(box, [door], p(1, 1), p(3, 1)));
  assert(!solid(box, [{ ...door, state: 'open' }], 2, 1));
  assert(lineOfSight(box, [{ ...door, state: 'open' }], p(1, 1), p(3, 1)));
});

test('supercover sight prevents diagonal corner leaks in both directions', () => {
  const tiles = ['#####', '#.#.#', '##..#', '#...#', '#####'];
  assert(!lineOfSight(tiles, [], p(1, 1), p(2, 2)));
  assert(!lineOfSight(tiles, [], p(2, 2), p(1, 1)));
  assert(!lineOfSight(box, [], { x: 1, y: 1.5 }, { x: 1, y: 3.5 }));
  assert(!lineOfSight(box, [], p(1, 1), { x: NaN, y: 1 }));
});

test('movement slides along walls without tunneling through walls, glass or closed doors', () => {
  const tiles = ['#######', '#..#..#', '#..#..#', '#..#..#', '#######'];
  const result = move(tiles, [], p(2, 1), 10, 2);
  assert(result.x <= 3 - .28 + 1e-8); assert(result.y > 3);
  for (const material of ['#', '=', '%', '~']) {
    const moved = move(['#####', `#.${material}.#`, '#####'], [], p(1, 1), 100, 0);
    assert(moved.x <= 2 - .28 + 1e-8);
  }
  assert(move(box, [door], p(1, 1), 3, 0).x <= 2 - .28 + 1e-8);
  assert.deepEqual(move(box, [], p(1, 1), NaN, 0), p(1, 1));
  assert.deepEqual(move(box, [], p(1, 1), 0, 0), p(1, 1));
});

test('visibility reveals the nearest wall, unions observers, and stays sorted and bounded', () => {
  const tiles = ['#######', '#..#..#', '#..#..#', '#..#..#', '#######'];
  const left = visibleCells(tiles, [], [p(1, 2)], 10);
  assert(left.includes(2 * 7 + 3)); assert(!left.includes(2 * 7 + 4));
  const both = visibleCells(tiles, [], [p(1, 2), p(5, 2)], 10);
  assert(both.includes(2 * 7 + 4));
  assert.deepEqual(both, [...new Set(both)].sort((a, b) => a - b));
  assert(both.every(cell => cell >= 0 && cell < 35));
});

test('paths respect closed doors and route around walls without changing the source', () => {
  const before = JSON.stringify(box), path = findPath(box, [door], p(1, 1), p(3, 1));
  assert.equal(path.length, 4); assert.deepEqual(path.at(-1), p(3, 1));
  assert(path.every(point => !solid(box, [door], point.x, point.y)));
  assert.deepEqual(findPath(box, [], p(1, 1), p(0, 0)), []);
  assert.deepEqual(findPath(box, [], p(1, 1), { x: Infinity, y: 2 }), []);
  assert.equal(JSON.stringify(box), before);
});
