import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_TARGET, crewClusters, fitInterior } from '../src/render/geometry';
import { EXTERIORS, doorsFor, fitCutaway, fitLabel, iconPath, labelPlan, pointInPolygon, rectInside } from '../src/render/cutaway';
import { hulls } from '../src/definitions/presentation/index';
import { HULL_PATHS } from '../src/render/hulls';
import type { Crew } from '../src/contracts';
/** Stage sizes root measured inside the shell's landscape frame (HUD and 56px dock deducted), the same frames while aiming (124px dock), plus desktop. */
const STAGES = { phone568: { w: 498, h: 198 }, phone568aim: { w: 430, h: 198 }, phone667: { w: 597, h: 253 }, phone667aim: { w: 529, h: 253 }, phone844: { w: 774, h: 268 }, phone844aim: { w: 706, h: 268 }, personal: { w: 700, h: 420 }, desktop: { w: 900, h: 520 } };
for (const hull of hulls) for (const [name, stage] of Object.entries(STAGES)) void test(`${hull.name} cutaway on the ${name} stage: exterior inside the stage, rooms inside the exterior, ${MIN_TARGET}px targets or the list fallback`, () => {
  const fit = fitCutaway(hull.rooms, stage, hull.id);
  assert.ok(fit.hull.x >= 0 && fit.hull.y >= 0 && fit.hull.x + fit.hull.w <= stage.w && fit.hull.y + fit.hull.h <= stage.h, `exterior ${JSON.stringify(fit.hull)} inside ${name}`);
  assert.ok(fit.extent.x >= 0 && fit.extent.y >= 0 && fit.extent.x + fit.extent.w <= stage.w && fit.extent.y + fit.extent.h <= stage.h, `decoration extent ${JSON.stringify(fit.extent)} (dish, engines, barrels) inside ${name}`);
  for (const room of fit.rooms) assert.ok(rectInside(room, fit.body), `${room.id} sits inside the ${hull.name} exterior`);
  for (const a of fit.rooms) for (const b of fit.rooms) if (a !== b) assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, `${a.id} and ${b.id} do not overlap`);
  assert.ok(fit.meets44, `${hull.name} keeps ${MIN_TARGET}px rooms on ${name} (tile ${fit.tile})`);
});
for (const hull of hulls) void test(`${hull.name}: every authored adjacency shares an edge and gets a door on it`, () => {
  const fit = fitCutaway(hull.rooms, STAGES.phone667, hull.id), doors = doorsFor(fit.rooms, Object.fromEntries(hull.rooms.map(r => [r.id, r.adjacent])));
  const pairs = new Set(hull.rooms.flatMap(r => r.adjacent.map(id => [r.id, id].sort().join('|'))));
  assert.equal(doors.length, pairs.size, 'one door per adjacent pair');
  for (const door of doors) {
    const a = fit.rooms.find(r => r.id === door.a)!, b = fit.rooms.find(r => r.id === door.b)!, length = Math.hypot(door.x2 - door.x1, door.y2 - door.y1);
    assert.ok(length >= fit.tile / 3 - 1, `${door.a}-${door.b} door is at least a third of a tile`);
    const onA = door.x1 >= a.x - .5 && door.x2 <= a.x + a.w + .5 && door.y1 >= a.y - .5 && door.y2 <= a.y + a.h + .5, onB = door.x1 >= b.x - .5 && door.x2 <= b.x + b.w + .5 && door.y1 >= b.y - .5 && door.y2 <= b.y + b.h + .5;
    assert.ok(onA && onB, `${door.a}-${door.b} door lies on the shared edge`);
  }
});
void test('eight hulls keep distinct exteriors: unique margins or body outlines, and unique compact silhouettes', () => {
  const outlines = hulls.map(h => JSON.stringify(EXTERIORS[h.id].body(12, 9)));
  assert.equal(new Set(outlines).size, hulls.length, 'no two hulls share a body outline');
  for (const hull of hulls) { assert.ok(HULL_PATHS[hull.id]?.startsWith('M'), hull.id); assert.equal(HULL_PATHS[hull.id], iconPath(hull.id, { w: Math.max(...hull.rooms.map(r => r.x + r.w)), h: Math.max(...hull.rooms.map(r => r.y + r.h)) }), 'compact icons derive from the authored cutaway exterior'); const nums = HULL_PATHS[hull.id].match(/-?[\d.]+/g)!.map(Number); assert.ok(nums.every((n, i) => i % 2 ? n >= 0 && n <= 60 : n >= 0 && n <= 100), `${hull.id} icon fits the 100x60 box`); }
  assert.equal(new Set(hulls.map(h => HULL_PATHS[h.id])).size, hulls.length);
  assert.ok(HULL_PATHS.enemy && HULL_PATHS.flagship);
  assert.ok(pointInPolygon([1, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]) && !pointInPolygon([3, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]));
});
void test('adjacency without a shared edge yields no door instead of a floating line', () => {
  const rooms = [{ id: 'a', x: 0, y: 0, w: 40, h: 40 }, { id: 'b', x: 100, y: 0, w: 40, h: 40 }];
  assert.deepEqual(doorsFor(rooms, { a: ['b'], b: ['a'] }), []);
});
void test('a room too small for a finger reports meets44 false so the list fallback appears', () => {
  const fit = fitInterior([{ id: 'tiny', x: 0, y: 0, w: 1, h: 1 }, { id: 'wide', x: 1, y: 0, w: 20, h: 1 }], { w: 440, h: 259 });
  assert.equal(fit.meets44, false);
  assert.equal(fitCutaway([{ id: 'tiny', x: 0, y: 0, w: 1, h: 1, adjacent: [] }], { w: 60, h: 60 }, 'wayfarer').meets44, false);
});
void test('32 friendly crew plus 8 boarders on one hull cluster with a bounded token count per room', () => {
  const hull = hulls[0], fit = fitCutaway(hull.rooms, STAGES.phone667, hull.id);
  const crew: Crew[] = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, ownerCaptainId: i < 32 ? `cap${i % 4}` : null, homeShipId: 'ship', currentShipId: 'ship', name: `Crew ${i}`, roomId: hull.rooms[i % hull.rooms.length].id, x: 1, y: 1, hp: 100, maxHp: 100, status: 'alive', skill: 'engineer', traits: [], order: { kind: 'hold', roomId: 'r0' }, activity: 'idle', controlEpoch: 0 }));
  const clusters = crewClusters(fit, crew);
  assert.equal(clusters.reduce((sum, c) => sum + c.shown.length + c.overflow, 0), 40);
  assert.ok(clusters.every(c => c.shown.length <= 6));
});

void test('crew labels: one crew shows the full name; several share left-to-right slots inside the room; a 45px room with four crew keeps only the selected label', () => {
  const room = { x: 100, y: 100, w: 45, h: 45 }, tile = 18;
  const one = labelPlan(room, [{ id: 'a', name: 'Cleo', x: 122 }], tile); assert.equal(one.length, 1); assert.equal(one[0].text, 'Cleo'); assert.ok(one[0].full); assert.equal(one[0].y, 141, 'the label sits in the bottom band, above the room edge');
  const four = [{ id: 'a', name: 'Crew 1', x: 110 }, { id: 'b', name: 'Crew 2', x: 120 }, { id: 'c', name: 'Crew 3', x: 130 }, { id: 'd', name: 'Crew 4', x: 140 }];
  assert.deepEqual(labelPlan(room, four, tile), [], 'no piled-up labels at maximum density');
  const selected = labelPlan(room, four, tile, 'c'); assert.equal(selected.length, 1); assert.equal(selected[0].id, 'c'); assert.ok(selected[0].x - 20 >= room.x && selected[0].x + 20 <= room.x + room.w, 'the selected label stays inside the room');
  const wide = { x: 0, y: 0, w: 96, h: 60 }, two = labelPlan(wide, [{ id: 'b', name: 'Bartholomew', x: 70 }, { id: 'a', name: 'Ari', x: 20 }], 24);
  assert.deepEqual(two.map(l => l.id), ['a', 'b'], 'slots follow figure order left to right'); assert.ok(two[0].x < two[1].x && two[1].x - two[0].x >= 40, 'labels never overlap each other');
  assert.equal(two[0].text, 'Ari'); assert.ok(two[1].text.length < 'Bartholomew'.length && two[1].text.endsWith('…'), 'long names abbreviate only when the slot is narrow'); assert.equal(two[1].full, false);
  assert.equal(fitLabel('Crew 15', 30, 8), 'Crew', 'a first token is preferred over a chopped ellipsis'); assert.equal(fitLabel('Ari', 30, 8), 'Ari');
});
void test('every hull decoration, including fins, dishes, claws and glow-free engine blocks, stays inside the 568 aiming frame with its stroke', () => {
  for (const hull of hulls) { const fit = fitCutaway(hull.rooms, { w: 430, h: 198 }, hull.id); assert.ok(fit.extent.y >= 0 && fit.extent.y + fit.extent.h <= 198 && fit.extent.x >= 0 && fit.extent.x + fit.extent.w <= 430, `${hull.id} extent ${JSON.stringify(fit.extent)}`); assert.ok(fit.parts.length >= 6, `${hull.id} carries individual detailing (${fit.parts.length} parts)`); }
});

void test('installed weapon hardpoints fit every hull without covering any room target', async () => {
  const { weaponMount } = await import('../src/render/weapons');
  for (const hull of hulls) for (const stage of Object.values(STAGES)) for (const faction of ['allied', 'enemy'] as const) {
    const fit = fitCutaway(hull.rooms, stage, hull.id);
    for (let i = 0; i < hull.maxWeapons; i++) {
      const m = weaponMount(fit, i, faction), x = Math.min(m.x - 13 * m.scale * m.direction, m.muzzle.x), y = m.y - 6.7 * m.scale, w = 41 * m.scale, h = 13.4 * m.scale;
      assert.ok(x >= 0 && y >= 0 && x + w <= stage.w && y + h <= stage.h, `${hull.id} mount ${i} fits`);
      assert.ok(fit.rooms.every(r => x + w <= r.x || x >= r.x + r.w || y + h <= r.y || y >= r.y + r.h), `${hull.id} mount ${i} leaves rooms clear`);
    }
  }
});
