import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTER_HEIGHT, INGREDIENTS, RECIPES, parseMap, type GameEvent, type Item, type Part } from '../src/model';
import { LEVELS, kitchenMap } from '../src/levels';
import { SnapshotBuffer } from '../../../party-runtime/src/index';
import { EventCursor, FOV, TILT, cookReadout, fitCamera, framingPoints, gateHinges, initialRackCounts, itemAnchor, itemLook, kitchenCorners, landingIn, metresPerPixel, pairSampler, plateOffsets, popWobble, project, soupOf, stackHeights } from '../src/scene/layout';
import { proceduralShape } from '../src/scene/procedural';
import { THEMES } from '../src/scene/themes';

const part = (food: Part['food'], state: Part['state']): Part => ({ food, state });
const item = (kind: Item['kind'], parts: Part[], cook = 0): Item => ({ id: 1, kind, parts, cook });

test('camera fit keeps the whole kitchen inside the band below the HUD at every aspect, and fits tightly', () => {
  for (const [cols, rows] of [[7, 5], [13, 8], [15, 9], [19, 9], [25, 13]]) for (const aspect of [16 / 9, 4 / 3, 21 / 9, 1.2, 3 / 2, .8]) {
    const hudTop = 120 / 720, fit = fitCamera(cols / 2, rows / 2, aspect, { hudTop }), top = 1 - 2 * hudTop;
    const points = framingPoints(cols / 2, rows / 2).map(point => project(point, fit.distance, fit.targetZ, aspect));
    for (const p of points) {
      assert.ok(Math.abs(p.x) <= .991 && p.y <= top + 1e-3 && p.y >= -.961 && p.depth > 0, `${cols}x${rows} @${aspect.toFixed(2)} keeps ${p.x.toFixed(3)},${p.y.toFixed(3)} on screen`);
    }
    const slack = Math.min(...points.map(p => Math.min(.99 - Math.abs(p.x), top - p.y, p.y + .96)));
    assert.ok(slack < .03, `${cols}x${rows} @${aspect.toFixed(2)} fills the view (slack ${slack.toFixed(3)})`);
    assert.deepEqual(fit.position.map(v => Math.round(v * 1e6)), [0, Math.sin(58 * Math.PI / 180) * fit.distance, fit.targetZ + Math.cos(58 * Math.PI / 180) * fit.distance].map(v => Math.round(v * 1e6)));
  }
  assert.ok(fitCamera(9.5, 4.5, 16 / 9).distance > fitCamera(6.5, 4, 16 / 9).distance, 'bigger kitchens pull the camera back');
  assert.ok(fitCamera(6.5, 4, 16 / 9, { hudTop: .25 }).distance > fitCamera(6.5, 4, 16 / 9, { hudTop: .1 }).distance, 'a taller HUD band pulls the camera back');
  const banded = fitCamera(10, 5.5, 16 / 9, { hudTop: .18, hudBottom: .12 });
  assert.ok(framingPoints(10, 5.5).every(point => project(point, banded.distance, banded.targetZ, 16 / 9).y >= -1 + .24 - 1e-3), 'a bottom HUD band keeps the front row clear of it');
  assert.ok(Math.abs(metresPerPixel(20, 720) * 720 - 2 * 20 * Math.tan(17 * Math.PI / 180)) < 1e-9);
});

test('the kitchen fills at least 90% of the HUD-free view on every map, including solo side bands', () => {
  // The client's display bands (18.5 and 12 units of a 620 px stage) and a solo layout with controls over both edges.
  const display = { hudTop: .185, hudBottom: .12 }, solo = { hudTop: .1, hudBottom: 0, hudLeft: .22, hudRight: .18 };
  for (let level = 0; level < LEVELS.length; level++) for (const players of [2, 10]) for (const [aspect, bands] of [[2, display], [16 / 9, display], [16 / 9, solo], [2.1, solo]] as const) {
    const map = kitchenMap(level, players), fit = fitCamera(map.halfX, map.halfZ, aspect, bands);
    const free = { top: 1 - 2 * bands.hudTop, bottom: -1 + 2 * bands.hudBottom, left: -1 + 2 * ('hudLeft' in bands ? bands.hudLeft : 0), right: 1 - 2 * ('hudRight' in bands ? bands.hudRight : 0) };
    const onScreen = (points: readonly (readonly number[])[]) => points.map(point => project(point, fit.distance, fit.targetZ, aspect, FOV, TILT, fit.shift));
    const label = `${LEVELS[level].id} x${players} @${aspect.toFixed(2)} ${'hudLeft' in bands ? 'solo' : 'display'}`;
    for (const p of onScreen(framingPoints(map.halfX, map.halfZ))) assert.ok(p.x >= free.left - 1e-3 && p.x <= free.right + 1e-3 && p.y >= free.bottom - 1e-3 && p.y <= free.top + 1e-3, `${label} keeps ${p.x.toFixed(3)},${p.y.toFixed(3)} clear of the HUD`);
    const box = onScreen(kitchenCorners(map.halfX, map.halfZ)), xs = box.map(p => p.x), ys = box.map(p => p.y);
    const fill = Math.max((Math.max(...xs) - Math.min(...xs)) / (free.right - free.left), (Math.max(...ys) - Math.min(...ys)) / (free.top - free.bottom));
    assert.ok(fill >= .9, `${label} fills ${(fill * 100).toFixed(1)}%`);
    assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - (free.left + free.right) / 2) < .01, `${label} is centred between the side bands`);
  }
});

test('throw landing and pop helpers', () => {
  // The rules throw from 1.1 m with 3.61 m/s lift under 18 m/s² gravity and land at worktop height after 0.45 s.
  const lift = (.9 - 1.1 + 9 * .45 ** 2) / .45;
  assert.ok(Math.abs(landingIn(1.1, lift) - .45) < 1e-9);
  assert.ok(Math.abs(landingIn(1.1 + lift * .2 - 9 * .04, lift - 18 * .2) - .25) < 1e-9);
  assert.equal(popWobble(0), 0); assert.equal(popWobble(-1), 0); assert.equal(popWobble(2), 0);
  assert.ok(popWobble(.05) > .1, 'a pop starts by stretching');
});

test('placement heights follow the model contract and plate layouts never index missing parts', () => {
  assert.equal(itemAnchor('counter').y, COUNTER_HEIGHT);
  assert.ok(itemAnchor('board').y > COUNTER_HEIGHT && itemAnchor('sink').y < COUNTER_HEIGHT);
  assert.deepEqual(itemAnchor('oven'), { y: .5, z: .3, scale: .78 });
  assert.equal(itemAnchor('oven', true).y, COUNTER_HEIGHT);
  assert.deepEqual(stackHeights(3), [0, .045, .09]);
  assert.equal(stackHeights(40).length, 8);
  assert.deepEqual(plateOffsets(0), []);
  assert.deepEqual(plateOffsets(1), [[0, 0]]);
  const ring = plateOffsets(4);
  assert.equal(new Set(ring.map(p => p.join())).size, 4);
  assert.ok(ring.every(([x, z]) => Math.hypot(x, z) < .1));
  for (const [racks, players] of [[1, 1], [2, 3], [3, 1], [2, 10]]) {
    const counts = initialRackCounts(racks, players);
    assert.equal(counts.length, racks); assert.equal(counts.reduce((a, b) => a + b, 0), players + 3);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
});

test('cooking readouts: fill while cooking, check when done, warning before burning, nothing in relaxed mode', () => {
  assert.deepEqual(cookReadout(item('pot', []), false), { state: 'idle', progress: 0 });
  assert.deepEqual(cookReadout(item('pot', [part('tomato', 'chopped'), part('tomato', 'chopped')], 4.5), false), { state: 'cooking', progress: .5 });
  assert.deepEqual(cookReadout(item('pot', [part('onion', 'cooked')], 10), false), { state: 'done', progress: 1 });
  assert.deepEqual(cookReadout(item('pot', [part('onion', 'cooked')], 16), false), { state: 'warn', progress: .5 });
  assert.deepEqual(cookReadout(item('pot', [part('onion', 'cooked')], 16), true), { state: 'done', progress: 1 });
  assert.equal(cookReadout(item('pan', [part('patty', 'burnt')], 20), false).state, 'burnt');
  assert.deepEqual(cookReadout(item('plate', [part('dough', 'raw'), part('tomato', 'chopped')], 4.5), false), { state: 'cooking', progress: .5 });
  assert.equal(cookReadout(item('plate', [part('dough', 'cooked'), part('tomato', 'chopped')], 9.5), false).state, 'done');
  assert.equal(cookReadout(item('plate', [part('lettuce', 'chopped')]), false).state, 'idle');
  assert.equal(cookReadout(undefined, false).state, 'idle');
  assert.deepEqual(soupOf(item('pot', [part('tomato', 'cooked'), part('onion', 'cooked')])), { kind: 'mixed', fill: 2 / 3, burnt: false });
  assert.equal(soupOf(item('pot', [part('onion', 'chopped')])).kind, 'onion');
  assert.notEqual(itemLook(item('pot', [part('tomato', 'chopped')])), itemLook(item('pot', [part('tomato', 'cooked')])));
  assert.equal(itemLook(item('pot', [part('tomato', 'chopped')], 1)), itemLook(item('pot', [part('tomato', 'chopped')], 8)), 'heat alone never rebuilds meshes');
});

test('events play once each and a late display skips the backlog', () => {
  const cursor = new EventCursor(), seen: number[] = [];
  const event = (id: number): GameEvent => ({ id, at: id, type: 'chop' });
  cursor.take([event(3), event(4)], e => seen.push(e.id));
  cursor.take([event(3), event(4), event(5), event(6)], e => seen.push(e.id));
  cursor.take([event(5), event(6), event(7)], e => seen.push(e.id));
  cursor.take([], e => seen.push(e.id));
  assert.deepEqual(seen, [5, 6, 7]);
  // A display tab returning from hidden skips the stale backlog but still plays what just happened.
  cursor.take([event(8), event(9), event(9000)], e => seen.push(e.id), 9500);
  assert.deepEqual(seen, [5, 6, 7, 9000]);
  cursor.take([event(9000), event(9001)], e => seen.push(e.id), 9500);
  assert.deepEqual(seen, [5, 6, 7, 9000, 9001]);
});

test('the scene draws the snapshot the buffer returns, even when it does not interpolate', () => {
  const buffer = new SnapshotBuffer<{ now: number }>(100, 32, { monotonic: true, resetGapMs: 1500 }), sample = pairSampler(buffer);
  assert.equal(sample(0), null);
  for (let t = 0; t <= 900; t += 50) buffer.push(t, { now: t }, t);
  const mid = sample(625)!;
  assert.deepEqual([mid.a.now, mid.b.now, mid.k], [500, 550, .5]);
  buffer.push(3000, { now: 3000 }, 3000); // A 2 s stall resets the buffer; the fresh frame is all it has.
  const after = sample(3050)!;
  assert.deepEqual([after.a.now, after.b.now, after.k], [3000, 3000, 1]);
});

test('drawbridges hinge at the ends of each run, across the gap they span', () => {
  const map = parseMap(['#######', '#.....#', '#~ggg~#', '#~ggg~#', '#.....#', '#######']);
  const hinges = gateHinges(map);
  assert.equal(hinges.length, 6);
  for (const hinge of hinges) {
    assert.equal(hinge.alongX, false, `gate ${hinge.tile.col},${hinge.tile.row} spans the gap vertically`);
    assert.equal(hinge.hinge.x, hinge.tile.x);
    assert.equal(hinge.hinge.z, hinge.tile.row === 2 ? hinge.tile.z - .5 : hinge.tile.z + .5);
  }
  const side = gateHinges(parseMap(['#####', '#.g.#', '#####']))[0];
  assert.equal(side.alongX, true); assert.equal(side.reach, .5);
});

test('fallback art exists for every station, item, food state, dish and theme prop the scene can request', () => {
  const palette = THEMES.diner;
  const names = ['counter', 'board', 'stove', 'oven', 'sink', 'rack', 'return', 'serve', 'bin', 'crate', 'belt', 'wall', 'floor_tile', 'ice_tile', 'gate_plank', 'portal_pad',
    'pot', 'pan', 'plate', 'plate_dirty', 'extinguisher', 'soup_tomato', 'soup_onion', 'soup_mixed', 'burnt',
    ...Object.keys(INGREDIENTS).map(food => `${food}_raw`), ...Object.keys(RECIPES).map(id => `dish_${id}`), ...new Set(Object.values(THEMES).flatMap(theme => theme.props))];
  for (const name of names) assert.ok(proceduralShape(name, palette), `procedural ${name}`);
  for (const food of ['lettuce', 'tomato', 'onion', 'patty', 'cheese']) assert.ok(proceduralShape(`${food}_chopped`, palette), `procedural ${food}_chopped`);
  for (const food of ['tomato', 'onion', 'patty', 'dough']) assert.ok(proceduralShape(`${food}_cooked`, palette), `procedural ${food}_cooked`);
  // Every level's tiles are drawable and every map has somewhere to spawn each chef.
  for (let level = 0; level < LEVELS.length; level++) for (const players of [4, 10]) {
    const map = kitchenMap(level, players);
    assert.ok(map.spawns.length >= players, `${LEVELS[level].id} seats ${players}`);
    assert.ok(THEMES[LEVELS[level].theme], `${LEVELS[level].id} has a theme palette`);
  }
});
