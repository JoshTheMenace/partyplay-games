/** Caper City: the plan and its terrain, the residents' days, vehicles, the economy, Heat and the Watch, and saves. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Object3D, Vector3 } from 'three';
import { MAX_SAVE_BYTES } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { Rides } from '../src/client/city/rides';
import rules from '../src/server';
import { B, cellId, isSolid } from '../src/shared/blocks';
import { CHUNK_CELLS, VoxelWorld } from '../src/shared/chunk';
import { DAY_TICKS } from '../src/shared/constants';
import { cellIndex, localIndex } from '../src/shared/coords';
import { CATALOG, cityAwards, clinicBill, fineFor, GIGS, heatTier, HEAT_TIERS, LOOT, MISCHIEF, scrapValue, START_COINS } from '../src/shared/city/economy';
import { ACT, cityPeople, dayOf, placeOpen, residentAt, type Pose } from '../src/shared/city/people';
import { CITY, CITY_BOUNDS, CITY_SIZE, cityPlan, crossX, crossZ, GROUND, nearestSidewalk, pathLength, PLACE_KINDS, sidewalkPath } from '../src/shared/city/plan';
import { newRide, RIDE, RIDES, stepRide } from '../src/shared/city/vehicles';
import { I } from '../src/shared/items';
import { CITY_ID, CITY_PLAYER_ID, decodeLedger, decodeScene, IF, NS, parseCmd, parseInput, PF, RF, validateSettings, type Cmd, type CmdBody, type LedgerEntry, type PubRide } from '../src/shared/protocol';
import { findSpawn, generateChunk } from '../src/shared/worldgen';
import { canBuild } from '../src/sim/city';
import { whereIs } from '../src/sim/city-state';
import { addExtra, bust, mischief } from '../src/sim/city-watch';
import { runCommand } from '../src/sim/commands';
import { createState, saveSource } from '../src/sim/game';
import { validMove } from '../src/sim/players';
import { CITY_SAVE_VERSION, exportSave, MAX_SAVED_PLAYERS, parseSave, SAVE_VERSION, type SaveSource } from '../src/sim/save';
import type { Player, State } from '../src/sim/state';
import { outcome, playerView, publicView } from '../src/sim/views';
import { writeCell } from '../src/sim/world';

const SEED = 11;
const ctx = (names: string[]) => ({ roomId: 'room', roundId: 'round', seed: 3, nowMs: 0, players: names.map((name, i) => ({ id: `p${i}`, name, color: '#28c6e7' })) });
const city = (names = ['Ada'], extra: Record<string, unknown> = {}): State => createState(ctx(names), validateSettings({ mode: 'city', seed: SEED, ...extra }));
const tick = (state: State, ticks = 1) => { for (let i = 0; i < ticks; i++) rules.tick(state, new Map(), 0.05, 0); };
let n = 0;
const run = (state: State, player: Player, body: CmdBody) => runCommand(state, player, { ...body, n: ++n } as Cmd);
const put = (state: State, player: Player, x: number, z: number, y = GROUND) => { Object.assign(player, { x, y, z, fallPeak: y, supportY: y, movedAt: state.clock, walkBudget: 0, tp: { n: player.tp.n + 1, x, y, z } }); };
const hash = (cells: Uint16Array) => { let h = 2166136261; for (let i = 0; i < cells.length; i++) h = Math.imul(h ^ cells[i]!, 16777619); return h >>> 0; };
const pose = (): Pose => ({ x: 0, z: 0, yaw: 0, act: 0, hidden: false, moving: false });

test('the mode is a setting: city settings carry a round length and the bonk rule, the others keep their shape', () => {
  assert.deepEqual(validateSettings({}), { mode: 'survival', seed: 0, difficulty: 'normal', keepInventory: true });
  assert.deepEqual(validateSettings({ mode: 'city' }), { mode: 'city', seed: 0, difficulty: 'normal', keepInventory: true, minutes: 0, bonks: true });
  assert.deepEqual(validateSettings({ mode: 'city', minutes: 20, bonks: false }).minutes, 20);
  assert.equal(validateSettings({ mode: 'city', minutes: 7 }).minutes, 0);
  assert.deepEqual(parseCmd({ n: 4, t: 'city', a: 'buy', i: 2 }), { n: 4, t: 'city', a: 'buy', i: 2 });
  assert.equal(parseCmd({ n: 4, t: 'city', a: 'nonsense' }), null);
});

test('the plan is the same every time, fills every block and has every kind of place', () => {
  const plan = cityPlan(SEED), again = cityPlan(SEED), other = cityPlan(SEED + 1);
  assert.equal(plan, again, 'memoized');
  assert.deepEqual(plan.lots.map(lot => [lot.kind, lot.x0, lot.z0, lot.floors]), cityPlan(SEED).lots.map(lot => [lot.kind, lot.x0, lot.z0, lot.floors]));
  assert.notDeepEqual(plan.lots.map(lot => lot.style), other.lots.map(lot => lot.style), 'another seed dresses the same map differently');
  assert.deepEqual(plan.blockLots.map(lots => plan.lots[lots[0]!]!.kind), other.blockLots.map(lots => other.lots[lots[0]!]!.kind), 'the zoning is fixed');
  for (const kind of PLACE_KINDS) assert.ok(plan.byKind(kind).length >= 1, kind);
  assert.equal(plan.plots.length, 12);
  for (const lot of plan.lots.filter(lot => lot.bx < CITY.n)) {
    assert.ok(lot.x0 >= CITY.x0 + CITY.road && lot.x1 < CITY.x0 + CITY_SIZE && lot.z0 >= CITY.z0 + CITY.road && lot.z1 < CITY.z0 + CITY_SIZE, `lot ${lot.i}`);
    assert.ok((lot.x0 - CITY.x0) % CITY.pitch >= CITY.road && (lot.z0 - CITY.z0) % CITY.pitch >= CITY.road, 'no lot stands in a road');
  }
  // Every place's sidewalk point is on a sidewalk loop, so residents and couriers can walk to it.
  for (const place of plan.places) { const [x, z] = nearestSidewalk(...place.walk); assert.ok(Math.hypot(x - place.walk[0], z - place.walk[1]) < 0.01, place.name); }
  const a = plan.places[0]!, b = plan.places[plan.places.length - 2]!, path = sidewalkPath(a.walk[0], a.walk[1], b.walk[0], b.walk[1]);
  assert.ok(pathLength(path) >= Math.abs(a.walk[0] - b.walk[0]) + Math.abs(a.walk[1] - b.walk[1]) - 0.01);
  assert.deepEqual(path.slice(-2), [...b.walk]);
});

test('city chunks are deterministic, engine-exact and independent of the order they generate in', () => {
  const at = [crossX(4) >> 4, crossZ(3) >> 4] as const, chunks = [[at[0], at[1]], [at[0] + 1, at[1] + 1], [at[0] + 2, at[1] + 2], [(CITY.x0 >> 4) - 2, CITY.z0 >> 4], [(CITY.x0 + CITY_SIZE + 30) >> 4, (CITY.z0 + 200) >> 4]] as const;
  const first = chunks.map(([cx, cz]) => hash(generateChunk(SEED, cx, cz, 'city')));
  // Again, in reverse, after generating neighbours: nothing a chunk holds depends on what was generated before it.
  for (const [cx, cz] of chunks) generateChunk(SEED, cx + 1, cz, 'city');
  assert.deepEqual([...chunks].reverse().map(([cx, cz]) => hash(generateChunk(SEED, cx, cz, 'city'))).reverse(), first);
  assert.equal(generateChunk(SEED, at[0], at[1], 'city').length, CHUNK_CELLS);
  const shops = cityPlan(SEED).lots.find(lot => lot.kind === 'shop')!, sx = shops.x0 >> 4, sz = shops.z0 >> 4;
  assert.notEqual(hash(generateChunk(SEED, sx, sz, 'city')), hash(generateChunk(SEED + 1, sx, sz, 'city')), 'another seed builds different shops');
  // The wild generator is untouched by the new argument.
  assert.equal(hash(generateChunk(SEED, 128, 128)), hash(generateChunk(SEED, 128, 128, 'wild')));
  // Streets are asphalt with pavement either side; the ground is flat at GROUND; the sea lies beyond the quay.
  const road = generateChunk(SEED, CITY.x0 >> 4, (CITY.z0 >> 4) + 2, 'city'), top = (lx: number, lz: number) => cellId(road[localIndex(lx, GROUND - 1, lz)]!);
  assert.deepEqual([top(1, 5), top(6, 5), top(10, 5), top(14, 5)], [B.pavement, B.asphalt, B.asphalt, B.pavement]);
  const sea = generateChunk(SEED, (CITY.x0 >> 4) - 3, CITY.z0 >> 4, 'city');
  assert.equal(cellId(sea[localIndex(4, 62, 4)]!), B.water);
  // A building crosses chunk borders seamlessly: the wall of the town hall block continues from one chunk to the next.
  const plan = cityPlan(SEED), tower = plan.lots.find(lot => lot.kind === 'office' && lot.x1 - lot.x0 > 40)!;
  const world = new VoxelWorld((cx, cz) => generateChunk(SEED, cx, cz, 'city'), 64);
  for (let x = tower.x0 + 2; x < tower.x1 - 1; x++) assert.ok(isSolid(world.getCell(x, GROUND + 9, tower.z0 + (tower.face === 0 ? 2 : 19))), `tower wall at x ${x}`);
  const spawn = findSpawn(SEED, 'city');
  assert.ok(isSolid(world.getCell(spawn[0], spawn[1] - 1, spawn[2])) && !isSolid(world.getCell(spawn[0], spawn[1], spawn[2])) && !isSolid(world.getCell(spawn[0], spawn[1] + 1, spawn[2])));
});

test('generateChunk stays cheap for the city (a flat, planned world)', () => {
  const times: number[] = [];
  for (let cz = 0; cz < 8; cz++) for (let cx = 0; cx < 8; cx++) { const t = performance.now(); generateChunk(SEED + 2, (CITY.x0 >> 4) + 8 + cx, (CITY.z0 >> 4) + 8 + cz, 'city'); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  console.log(`city chunk: median ${times[32]!.toFixed(2)} ms, slowest ${times[63]!.toFixed(2)} ms`);
  assert.ok(times[32]! < 6, `${times[32]} ms`);
});

test('every resident has a home, a look and a day that starts and ends at home without teleporting', () => {
  const people = cityPeople(SEED), list = people.list, p = pose(), q = pose();
  assert.ok(list.length >= 400 && list.length <= 900, `${list.length} residents`);
  assert.equal(people, cityPeople(SEED));
  assert.deepEqual(list.slice(0, 20).map(r => [r.name, r.job, r.home]), cityPeople(SEED).list.slice(0, 20).map(r => [r.name, r.job, r.home]));
  for (const job of ['keeper', 'officer', 'courier', 'office', 'free'] as const) assert.ok(list.some(r => r.job === job), job);
  let worst = 0;
  for (const resident of list) {
    const steps = dayOf(people, resident, 0);
    assert.equal(steps[0]!.t0, 0);
    assert.equal(steps[steps.length - 1]!.t1, DAY_TICKS, `${resident.name} ends the day`);
    for (let k = 1; k < steps.length; k++) {
      assert.equal(steps[k]!.t0, steps[k - 1]!.t1, 'steps follow one another');
      residentAt(people, resident, 0, steps[k]!.t0 - 0.01, p);
      residentAt(people, resident, 0, steps[k]!.t0 + 0.01, q);
      worst = Math.max(worst, Math.hypot(p.x - q.x, p.z - q.z));
    }
    // Home again by the end of the day, out of sight, and there at the start of the next.
    residentAt(people, resident, 0, DAY_TICKS - 1, p);
    residentAt(people, resident, 1, 0, q);
    assert.ok(p.hidden || resident.job === 'officer', `${resident.name} is home at day's end`);
    assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < (resident.job === 'officer' ? 400 : 1), `${resident.name} wakes where they slept`);
  }
  assert.ok(worst < 1.2, `largest jump between two steps: ${worst}`);
  // Another day is another plan for most people, yet the same again when asked again.
  const someone = list.find(r => r.job === 'free')!;
  assert.deepEqual(dayOf(people, someone, 3).map(s => s.t1), dayOf(people, someone, 3).map(s => s.t1));
});

test('a keeper commutes, works the counter and goes home; shops are open while a keeper stands there', () => {
  const people = cityPeople(SEED), plan = people.plan, place = plan.byKind('food')[0]!, [early, late] = people.keepers[place.i]!.map(i => people.list[i]!), p = pose();
  assert.ok(early && late, 'two shifts');
  const acts = (time: number) => residentAt(people, early!, 0, time, p).act;
  assert.ok(acts(0) === ACT.HOME || acts(0) === ACT.COMMUTE, 'the day starts at home (an early shift leaves at once)');
  assert.equal(acts(5000), ACT.WORK);
  residentAt(people, early!, 0, 5000, p);
  assert.ok(Math.hypot(p.x - place.counter[0], p.z - place.counter[1]) < 0.01 && !p.hidden && !p.moving, 'behind the counter at 11:00');
  assert.equal(residentAt(people, late!, 0, 15000, p).act, ACT.WORK, 'the late shift has it in the evening');
  assert.equal(acts(23900), ACT.HOME);
  assert.equal(placeOpen(people, place.i, 0, 5000), true);
  assert.equal(placeOpen(people, place.i, 0, 15000), true);
  assert.equal(placeOpen(people, place.i, 0, 22000), false, 'closed in the small hours');
  const open = plan.places.filter(other => placeOpen(people, other.i, 0, 6000)).length;
  assert.equal(open, plan.places.length, 'every counter is staffed at noon');
  // An officer walks a beat and an office worker goes out for lunch.
  const officer = people.list.find(r => r.job === 'officer' && r.place < 0 && r.from === 0)!;
  assert.ok(dayOf(people, officer, 0).some(step => step.act === ACT.PATROL && step.path && step.loop));
  const worker = people.list.filter(r => r.job === 'office').find(r => dayOf(people, r, 0).some(step => step.act === ACT.LUNCH));
  assert.ok(worker, 'someone lunches out');
});

test('vehicles: the shared physics reaches each top speed, brakes, and stops at walls', () => {
  const world = new VoxelWorld((cx, cz) => generateChunk(SEED, cx, cz, 'city'), 256), get = (x: number, y: number, z: number) => world.getCell(x, y, z);
  const input = { throttle: 1, steer: 0, brake: false, up: false, down: false };
  for (const key of ['zipster', 'pebble', 'comet', 'hornet']) {
    const kind = RIDES[RIDE[key]!]!, ride = newRide(crossX(4) + 1.5, GROUND, crossZ(6) - 12, 0);
    let peak = 0;
    for (let i = 0; i < 200; i++) { stepRide(ride, kind, input, 0.05, get); peak = Math.max(peak, ride.speed); }
    assert.ok(peak > kind.top - 0.2 && peak <= kind.top + 0.001, `${key} tops out at ${peak}`);
    assert.equal(ride.y, GROUND, `${key} stays on the road`);
    for (let i = 0; i < 40; i++) stepRide(ride, kind, { ...input, throttle: 0, brake: true }, 0.05, get);
    assert.ok(Math.abs(ride.speed) < 0.01, `${key} brakes to a stop`);
  }
  // Into the side of a building: the hatchback stops short of the wall and reports the impact.
  const plan = cityPlan(SEED), tower = plan.lots.find(lot => lot.kind === 'office' && lot.face === 0 && lot.x1 - lot.x0 > 40)!, car = newRide(tower.x0 + 20, GROUND, tower.z0 - 9, Math.PI);
  let crash = 0;
  for (let i = 0; i < 80; i++) { stepRide(car, RIDES[RIDE.pebble!]!, input, 0.05, get); crash = Math.max(crash, car.crash); }
  assert.ok(crash > 5, `impact ${crash}`);
  assert.ok(car.z < tower.z0 + 2, 'it did not drive through the wall');
  // The helicopter climbs and flies; nothing leaves the city's bounds or passes its ceiling.
  const heli = newRide(plan.spawn[0] - 12, GROUND, plan.spawn[2], 0), kind = RIDES[RIDE.dragonfly!]!;
  for (let i = 0; i < 60; i++) stepRide(heli, kind, { throttle: 0, steer: 0, brake: false, up: true, down: false }, 0.05, get);
  assert.ok(heli.y > GROUND + 15 && !heli.onGround);
  for (let i = 0; i < 4000; i++) stepRide(heli, kind, { throttle: 1, steer: 0, brake: false, up: true, down: false }, 0.05, get);
  assert.ok(heli.z >= CITY_BOUNDS.z0 && heli.y <= CITY_BOUNDS.top, `held at the edge: ${heli.z}, ${heli.y}`);
});

test('riding: the server checks a driver against the vehicle, not a walker; passengers are carried', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!;
  put(state, ada, crossX(4) + 1.5, crossZ(6) - 12);
  put(state, bo, crossX(4) + 3, crossZ(6) - 12);
  tick(state, 25);
  const car = c.vehicles.find(v => !v.rail && v.k === RIDE.pebble) ?? Object.assign(c.vehicles[0]!, { k: RIDE.pebble });
  Object.assign(car, { x: ada.x + 1.5, y: GROUND, z: ada.z, yaw: 0, rail: null });
  // On foot nobody covers nine blocks in half a second.
  state.clock += 0.5;
  assert.equal(validMove(state, ada, ada.x, ada.y, ada.z - 9), false);
  assert.equal(run(state, ada, { t: 'interact', id: car.id }), true);
  assert.deepEqual([c.players[0]!.ride, c.players[0]!.seat, ada.pace], [car.id, 0, RIDES[car.k]!.top]);
  assert.equal(ada.tp.yaw, 0, 'the teleport turns the driver to the vehicle heading');
  assert.equal(playerView(state, 'p0').city!.ride![0], car.id);
  state.clock += 0.5;
  assert.equal(validMove(state, ada, ada.x, ada.y, ada.z - 9), true, '18 blocks a second is a hatchback');
  assert.equal(validMove(state, ada, ada.x, ada.y, ada.z - 40), false, 'but not 80');
  assert.equal(validMove(state, ada, CITY_BOUNDS.x0 - 5, ada.y, ada.z), false, 'and never out of the city');
  // Bo climbs in beside her and goes where the car goes.
  assert.equal(run(state, bo, { t: 'interact', id: car.id }), true);
  assert.equal(c.players[1]!.seat, 1);
  rules.tick(state, new Map([['p0', parseInput({ p: [ada.x, ada.y, ada.z - 0.8], v: [0, 0, -16], yaw: 0, pitch: 0, f: 1, slot: 0, mine: null, tpAck: ada.tp.n, cmds: [] })]]), 0.05, 0);
  assert.ok(Math.abs(car.z - ada.z) < 0.001 && Math.abs(bo.z - car.z) < 0.001, 'the car and its passenger follow the driver');
  assert.ok(playerView(state, 'p1').near === undefined || decodeScene(playerView(state, 'p1').near!, publicView(state).who).players.every(p => p.flags & PF.RIDING));
  assert.ok(c.players[0]!.stats.drove > 0.5);
  assert.equal(run(state, ada, { t: 'city', a: 'exit' }), true);
  assert.deepEqual([c.players[0]!.ride, ada.pace, car.driver], [0, 0, -1]);
  assert.ok(Math.hypot(ada.x - car.x, ada.z - car.z) > 1 && Math.hypot(ada.x - car.x, ada.z - car.z) < 4, 'she stands beside it');
});

test('an aircraft left in the air comes down on its own, and screens are sent it all the way', () => {
  const state = city(), [ada] = state.players as [Player], c = state.city!;
  put(state, ada, crossX(4) + 1.5, crossZ(6) - 12);
  tick(state, 25);
  const heli = Object.assign(c.vehicles.find(v => !v.rail)!, { k: RIDE.dragonfly, x: ada.x + 1.5, y: GROUND, z: ada.z, yaw: 0, bay: -1 });
  assert.equal(run(state, ada, { t: 'interact', id: heli.id }), true);
  Object.assign(ada, { y: GROUND + 30, fallPeak: GROUND + 30 });
  tick(state);
  assert.equal(heli.y, GROUND + 30, 'the helicopter is where its pilot is');
  assert.equal(run(state, ada, { t: 'city', a: 'exit' }), true);
  const awake = () => decodeScene(playerView(state, 'p0').near!, publicView(state).who).rides!.some(ride => ride.id === heli.id && !(ride.f & RF.ASLEEP));
  tick(state, 20);
  assert.ok(heli.y < GROUND + 25 && heli.y > GROUND && awake(), `a second later it is on its way down: ${heli.y}`);
  tick(state, 100);
  assert.deepEqual([heli.y, heli.sink], [GROUND, false], 'and it lands on the street');
  // Getting back in stops the drop.
  Object.assign(heli, { y: GROUND + 20, sink: true });
  put(state, ada, heli.x + 1.5, heli.z, GROUND + 20);
  assert.equal(run(state, ada, { t: 'interact', id: heli.id }), true);
  tick(state, 10);
  assert.equal(heli.sink, false);
});

test('heat rises only when mischief is seen, drains when the Watch loses sight, and an arrest costs a fine', () => {
  const state = city(['Ada']), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  // Somewhere with nobody about: out on the pier.
  put(state, ada, CITY.x0 + 6 * CITY.pitch + 40, CITY.z0 + CITY_SIZE + 60);
  tick(state, 12);
  assert.equal(mischief(state, ada, MISCHIEF.bonk, false), false, 'nobody saw');
  assert.equal(cp.heat, 0);
  assert.equal(mischief(state, ada, MISCHIEF.bonk, true), true);
  assert.equal(cp.heat, MISCHIEF.bonk);
  assert.equal(heatTier(cp.heat), 1);
  assert.equal(playerView(state, 'p0').city!.heat, MISCHIEF.bonk);
  // Unseen for long enough, it drains away again.
  tick(state, 20 * 20);
  assert.equal(cp.heat, 0, 'cooled off');
  // Wanted, with an officer at arm's length: the arrest takes a moment, then the fine and the walk from the Watch House.
  mischief(state, ada, 50, true);
  cp.coins = 200;
  ada.inv[5] = { id: I.swag_bag, n: 2 };
  ada.protectedUntil = 0;
  addExtra(state, ada.x + 1, GROUND, ada.z, true, 0, NS.CHASE);
  tick(state, 8);
  assert.ok(cp.grab > 0 && playerView(state, 'p0').city!.grab! > 0, 'an officer has hold');
  tick(state, 30);
  assert.equal(cp.stats.busts, 1);
  assert.equal(cp.heat, 0);
  assert.equal(ada.inv[5], null, 'the loot is confiscated');
  assert.match(playerView(state, 'p0').toast!.text, /Nabbed/);
  // The lock-up first (tests/city2.test.ts has its ways out); paying the fine puts her on the Watch House steps.
  assert.ok(cp.cellUntil > state.clock && cp.coins === 200 && cp.fine === fineFor(200, 2));
  assert.equal(run(state, ada, { t: 'city', a: 'cell', i: 0 }), true);
  assert.equal(cp.coins, 200 - fineFor(200, 2));
  assert.ok(Math.hypot(ada.x - c.plan.jail[0], ada.z - c.plan.jail[2]) < 4, 'outside the Watch House');
  // The numbers the HUD and the server share.
  assert.deepEqual([heatTier(0), heatTier(HEAT_TIERS[0]), heatTier(59), heatTier(100)], [0, 1, 2, 4]);
  assert.deepEqual([fineFor(1000, 3), fineFor(10, 4), clinicBill(1000), clinicBill(5)], [175, 10, 80, 5]);
  bust(state, ada);
  assert.equal(cp.stats.busts, 2);
});

test('bonking: a resident sees stars, drops coins and comes back to their day; players can be bonked when the room allows', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!;
  state.time = 6000;
  tick(state, 12);
  // The nearest resident out of doors at noon.
  let nearest = -1, gap = Infinity;
  for (let i = 0; i < c.people.list.length; i++) { const at = whereIs(state, i); if (at && Math.hypot(at.x - ada.x, at.z - ada.z) < gap && c.people.list[i]!.job !== 'officer') { gap = Math.hypot(at.x - ada.x, at.z - ada.z); nearest = i; } }
  const at = whereIs(state, nearest)!;
  put(state, ada, at.x + 1.1, at.z);
  assert.equal(run(state, ada, { t: 'attack', id: CITY_ID + nearest + 100000 }), false, 'nobody there');
  assert.equal(run(state, ada, { t: 'attack', id: CITY_ID + nearest }), true);
  assert.equal(c.npcs.get(nearest)!.s, NS.DIZZY);
  assert.equal(c.players[0]!.stats.bonks, 1);
  assert.ok(state.items.some(item => item.item === I.coin), 'coins pop out');
  assert.equal(run(state, ada, { t: 'attack', id: CITY_ID + nearest }), false, 'not while they are down');
  const scene = decodeScene(playerView(state, 'p0').near ?? rulesNear(state), publicView(state).who);
  assert.ok(scene.npcs?.some(npc => npc.i === nearest && npc.s === NS.DIZZY), 'the live resident is on the wire');
  tick(state, 20 * 40);
  assert.equal(c.npcs.has(nearest), false, 'back on their script');
  // Coins on the street go straight into the purse.
  ada.inv[3] = { id: I.coin, n: 7 };
  tick(state);
  // (She may have walked over what the bonked resident dropped as well.)
  assert.ok(ada.inv[3] === null && c.players[0]!.coins >= START_COINS + 7, `coins: ${c.players[0]!.coins}`);
  c.players[0]!.coins = START_COINS;
  // Player on player.
  put(state, bo, ada.x + 1, ada.z);
  bo.protectedUntil = 0;
  c.players[1]!.coins = 100;
  assert.equal(run(state, ada, { t: 'attack', id: CITY_PLAYER_ID + 1 }), true);
  assert.ok(state.clock < c.players[1]!.dizzyUntil && c.players[1]!.coins === 95);
  assert.ok(playerView(state, 'p1').city!.dizzy! > 0);
  assert.equal(run(state, bo, { t: 'attack', id: CITY_PLAYER_ID }), false, 'a dizzy player cannot act');
  const calm = city(['Ada', 'Bo'], { bonks: false }), [a2, b2] = calm.players as [Player, Player];
  put(calm, b2, a2.x + 1, a2.z);
  b2.protectedUntil = 0;
  assert.equal(run(calm, a2, { t: 'attack', id: CITY_PLAYER_ID + 1 }), false, 'the room switched it off');
});
/** The scene round seat 0 in a tick that carries one. */
function rulesNear(state: State) { for (;;) { tick(state); const near = playerView(state, 'p0').near; if (near) return near; } }

test('earning and spending: a parcel round pays on delivery, counters sell, tills can be grabbed and swag pawned', () => {
  const state = city(['Ada']), ada = state.players[0]!, c = state.city!, cp = c.players[0]!, plan = c.plan, people = c.people;
  state.time = 6000;
  tick(state, 12);
  const depot = plan.byKind('depot')[0]!, [bx, by, bz] = depot.board!;
  put(state, ada, bx + 0.5, bz + 2.5);
  assert.equal(cellId(state.get(bx, by, bz)), B.job_board, 'the board is on the wall');
  assert.equal(run(state, ada, { t: 'use', x: bx, y: by, z: bz, face: 3 }), true);
  const offers = playerView(state, 'p0').city!.offers!;
  assert.equal(offers.length, 3);
  assert.ok(offers.every(offer => offer.pay > GIGS[0].base && offer.secs > 20));
  assert.equal(run(state, ada, { t: 'city', a: 'gig', i: 0 }), true);
  const gig = cp.gig!;
  assert.equal(playerView(state, 'p0').city!.gig!.pay, offers[0]!.pay);
  // Walk it to the first door, then the second.
  put(state, ada, gig.x, gig.z);
  tick(state, 5);
  assert.equal(cp.gig!.drops, 1, 'one door done');
  put(state, ada, cp.gig!.x, cp.gig!.z);
  tick(state, 5);
  assert.equal(cp.gig, null);
  assert.equal(cp.stats.gigs, 1);
  assert.ok(cp.coins >= START_COINS + offers[0]!.pay, `paid: ${cp.coins}`);
  // A burger at a food counter: its keeper opens it, coins buy it, eating mends hearts.
  const diner = plan.byKind('food')[0]!, keeper = people.keepers[diner.i]!.find(i => whereIs(state, i))!;
  put(state, ada, diner.front[0], diner.front[1]);
  assert.equal(run(state, ada, { t: 'interact', id: CITY_ID + keeper }), true);
  assert.equal(playerView(state, 'p0').city!.open, diner.i);
  const before = cp.coins, burger = CATALOG.food[0]!;
  assert.equal(run(state, ada, { t: 'city', a: 'buy', i: 0 }), true);
  assert.equal(cp.coins, before - burger.price);
  assert.ok(ada.inv.some(slot => slot?.id === I.burger));
  cp.coins = 3;
  assert.equal(run(state, ada, { t: 'city', a: 'buy', i: 0 }), false, 'not without the coins');
  assert.equal(run(state, ada, { t: 'craft', r: 'oak_planks' }), false, 'no crafting in the city');
  // The till: mining it empties it into a swag bag, and the keeper saw.
  const [tx, ty, tz] = diner.till!;
  assert.equal(cellId(state.get(tx, ty, tz)), B.till);
  assert.equal(run(state, ada, { t: 'break', x: tx, y: ty, z: tz }), true);
  assert.ok(state.items.some(item => item.item === I.swag_bag));
  assert.ok(cp.heat >= MISCHIEF.till, `heat ${cp.heat}`);
  assert.equal(cellId(state.get(tx, ty, tz)), B.till, 'the till itself stays');
  assert.equal(run(state, ada, { t: 'break', x: tx, y: ty, z: tz }), false, 'empty until it refills');
  // Pawn the swag.
  const pawn = plan.byKind('pawn')[0]!, broker = people.keepers[pawn.i]!.find(i => whereIs(state, i))!;
  put(state, ada, pawn.front[0], pawn.front[1]);
  ada.inv[8] = { id: I.swag_bag, n: 1 };
  assert.equal(run(state, ada, { t: 'interact', id: CITY_ID + broker }), true);
  assert.equal(run(state, ada, { t: 'city', a: 'sell', i: 8 }), true);
  assert.equal(cp.coins, 3 + LOOT[I.swag_bag]!);
  // Prices and payouts make sense.
  for (const offers of Object.values(CATALOG)) for (const offer of offers) assert.ok(offer.price > 0);
  assert.ok(scrapValue(RIDE.comet!) > scrapValue(RIDE.zipster!));
});

test('the city cannot be mined, but an owned plot can be built on; a bought vehicle is yours', () => {
  const state = city(['Ada']), ada = state.players[0]!, c = state.city!, cp = c.players[0]!, plan = c.plan;
  state.time = 6000;
  tick(state, 12);
  const wall = plan.lots.find(lot => lot.kind === 'office')!;
  put(state, ada, wall.x0 + 4.5, wall.z0 - 1.5);
  assert.equal(run(state, ada, { t: 'break', x: wall.x0 + 4, y: GROUND + 1, z: wall.z0 + 2 }), false);
  assert.match(ada.toast!.text, /belongs to the city/);
  assert.equal(state.world.edits.size, 0);
  // Buy a plot at the town hall, then build on it.
  const hall = plan.byKind('hall')[0]!, clerk = c.people.keepers[hall.i]!.find(i => whereIs(state, i))!;
  put(state, ada, hall.front[0], hall.front[1]);
  cp.coins = 5000;
  assert.equal(run(state, ada, { t: 'interact', id: CITY_ID + clerk }), true);
  assert.equal(run(state, ada, { t: 'city', a: 'buy', i: 1 }), true);
  assert.ok(cp.plot >= 0 && cp.coins === 5000 - 900 + 40, 'the deed, less its price, plus the passport stamp for a first plot');
  assert.equal(run(state, ada, { t: 'city', a: 'buy', i: 0 }), true, 'and a flat');
  assert.ok(cp.flat >= 0);
  const plot = plan.plots[cp.plot]!;
  put(state, ada, plot.x0 + 1.5, plot.z0 - 1.5);
  ada.inv[0] = { id: B.oak_planks, n: 4 };
  assert.equal(canBuild(state, ada, plot.x0, GROUND - 1, plot.z0), true);
  assert.equal(run(state, ada, { t: 'place', x: plot.x0, y: GROUND - 1, z: plot.z0, face: 3, slot: 0 }), true);
  assert.equal(cellId(state.get(plot.x0, GROUND, plot.z0)), B.oak_planks);
  assert.equal(run(state, ada, { t: 'place', x: plot.x0 - 3, y: GROUND - 1, z: plot.z0, face: 3, slot: 0 }), false, 'not outside the plot');
  assert.equal(state.world.edits.size, 1, 'an ordinary journal entry');
  // A vehicle from the dealer.
  const dealer = plan.byKind('dealer')[0]!, seller = c.people.keepers[dealer.i]!.find(i => whereIs(state, i))!;
  put(state, ada, dealer.front[0], dealer.front[1]);
  assert.equal(run(state, ada, { t: 'interact', id: CITY_ID + seller }), true);
  assert.equal(run(state, ada, { t: 'city', a: 'buy', i: 0 }), true);
  assert.equal(cp.own, 1 << RIDE.zipster!);
  const mine = c.vehicles.find(v => v.owner === 0)!;
  assert.ok(mine && Math.hypot(mine.x - ada.x, mine.z - ada.z) < 100);
  put(state, ada, mine.x + 1, mine.z);
  const heat = cp.heat;
  assert.equal(run(state, ada, { t: 'interact', id: mine.id }), true);
  assert.equal(cp.heat, heat, 'no heat for driving your own');
});

test('knocked out: the clinic bills and the player wakes at its door', () => {
  const state = city(['Ada']), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  cp.coins = 400;
  ada.protectedUntil = 0;
  ada.health = 0;
  ada.dead = true;
  assert.equal(run(state, ada, { t: 'respawn' }), true);
  assert.equal(cp.coins, 400 - clinicBill(400));
  assert.equal(cp.stats.kos, 1);
  assert.ok(Math.hypot(ada.x - c.plan.clinic[0], ada.z - c.plan.clinic[2]) < 4 && !ada.dead && ada.health === 20);
});

test('a city save keeps coins, property and careers, and nothing of the city itself', () => {
  const state = city(['Ada', 'Bo'], { minutes: 20, bonks: false }), c = state.city!, [ada] = state.players as [Player];
  Object.assign(c.players[0]!, { coins: 1234, own: 0b100011, flat: 17, plot: 3 });
  Object.assign(c.players[0]!.stats, { earned: 900, gigs: 6, bonks: 2, busts: 1, escapes: 3, peak: 77, drove: 4321.7, flew: 12, kos: 1 });
  writeCell(state, Math.floor(ada.x), 80, Math.floor(ada.z), B.oak_planks);
  tick(state, 30);
  const save = rules.exportSave!(state) as ReturnType<typeof exportSave>, json = JSON.stringify(save);
  assertSerializable(save);
  assert.equal(save.version, CITY_SAVE_VERSION);
  assert.deepEqual([save.mode, save.minutes, save.bonks, save.animals.length, save.villagers.length], ['city', 20, false, 0, 0]);
  assert.ok(Buffer.byteLength(json) < 2700, `a fresh city is tiny: ${Buffer.byteLength(json)} bytes`);
  const loaded = rules.loadSave!(ctx(['Bo', 'Ada', 'Cy']), JSON.parse(json), validateSettings({}));
  assert.deepEqual(loaded.settings, { mode: 'city', seed: SEED, difficulty: 'normal', keepInventory: true, minutes: 20, bonks: false });
  const back = loaded.state.city!.players[1]!, fresh = loaded.state.city!.players[2]!;
  // (Being worth 2,000 coins stamped Ada's passport on the way: 100 coins.)
  assert.deepEqual([back.coins, back.own, back.flat, back.plot], [1334, 0b100011, 17, 3]);
  assert.deepEqual(back.stats, { earned: 1000, gigs: 6, bonks: 2, busts: 1, escapes: 3, peak: 77, drove: 4322, flew: 12, kos: 1, fish: 0, wins: 0, jump: 0, tips: 0, helped: 0, bounties: 0, gull: 0 });
  assert.deepEqual([fresh.coins, fresh.own, fresh.plot], [START_COINS, 0, -1]);
  assert.equal(loaded.state.world.edits.size, 1);
  assert.equal(loaded.state.city!.vehicles.length, 0, 'vehicles come back from the seed');
  // Survival worlds are still written as version 11, and a version 12 world that is not a city comes from the future.
  const wild = createState(ctx(['Ada']), validateSettings({ seed: 5 })), wildSave = exportSave(saveSource(wild));
  assert.equal(wildSave.version, SAVE_VERSION);
  assert.equal('c' in wildSave.players[0]!, false);
  assert.throws(() => parseSave({ ...wildSave, version: CITY_SAVE_VERSION }), /newer version/);
  assert.throws(() => parseSave({ ...JSON.parse(json), version: SAVE_VERSION }), /damaged/);
  assert.throws(() => parseSave({ ...JSON.parse(json), animals: [{ t: 4, x: 5, y: 64, z: 5, s: 0 }] }), /damaged/);
  assert.throws(() => parseSave({ ...JSON.parse(json), players: [{ ...save.players[0], c: [1, 2, 3] }] }), /damaged/);
  assert.throws(() => parseSave({ ...wildSave, players: [{ ...wildSave.players[0], c: save.players[0]!.c }] }), /damaged/);
});

test('the worst legal city save stays under 256 KiB', () => {
  const big = 99_999_999, name = (i: number) => `${'世'.repeat(14)}${String(i).padStart(2, '0')}`;
  const fullSlots = (count: number) => Array.from({ length: count }, (_, i) => ({ id: I.diamond_pickaxe + (i % 5), n: 1, d: 1000 + i }));
  // The same worst journal, inventories, chests and furnaces as the survival test, with every player's city record at its largest.
  const flat = new Uint16Array(CHUNK_CELLS).fill(B.stone, 0, 16 * 16 * 64), blank = createState(ctx(['Ada']), validateSettings({ seed: 5 }), { source: () => flat, spawn: [2048, 64, 2048] });
  let seed = 99;
  const random = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 2 ** 32, edits = blank.world.edits;
  for (let i = 0, refused = false; ; i++) {
    if (writeCell(blank, Math.floor(random() * 4096), 64 + Math.floor(random() * 64), Math.floor(random() * 4096), (i < 64 ? B.chest : i < 96 ? B.furnace_lit : B.stone_brick_stairs) | (i % 8) << 8)) { refused = false; continue; }
    if (refused) break;
    refused = true;
    blank.clock += 2;
    i--;
  }
  const chests = [...edits].filter(([, value]) => (value & 255) === B.chest).map(([index]) => index), furnaces = [...edits].filter(([, value]) => (value & 255) === B.furnace_lit).map(([index]) => index);
  const stats = { earned: big, gigs: big, bonks: big, busts: big, escapes: big, peak: big, drove: big, flew: big, kos: big, fish: 9999, wins: 999, jump: 999, tips: 99999, helped: 999, bounties: 999, gull: 9999 };
  const record = { coins: big, own: 2 ** RIDES.length - 1, flat: 4095, plot: 63, stats, stamps: [65535, 65535] as [number, number], feathers: [2 ** 20 - 1, 2 ** 20 - 1] as [number, number], story: 2 ** 24 - 1, rep: 2 ** 21 - 1, look: 2 ** 23 - 1, biz: 2 ** 21 - 1 };
  const players = Array.from({ length: MAX_SAVED_PLAYERS }, (_, i) => ({
    name: name(i), x: 4095.99, y: 127.99, z: 4095.99, yaw: -3.141, pitch: -1.571, health: 19.5, food: 19, saturation: 19.99, inv: fullSlots(36),
    armor: [I.diamond_helmet, I.diamond_chestplate, I.diamond_leggings, I.diamond_boots].map(id => ({ id, n: 1, d: 360 })), bed: [4095, 127, 4095] as [number, number, number],
    stats: { mined: 999999999, placed: 999999999, crafted: 999999999, mobs: 999999999, deaths: 999999999, distance: 999999999 }, milestones: 2 ** 30,
    city: record,
  }));
  const source: SaveSource = {
    settings: validateSettings({ seed: 999999, mode: 'city', minutes: 30, bonks: false }), worldId: `999999-${'z'.repeat(57)}`, time: 23999, day: 999999999, edits, players,
    chests: new Map(chests.map(i => [i, fullSlots(27)])),
    furnaces: new Map(furnaces.map(i => [i, { slots: [{ id: B.iron_ore, n: 64 }, { id: B.coal_block, n: 64 }, { id: I.iron_ingot, n: 64 }], burn: 799.99, burnMax: 800, cook: 9.99 }])),
    animals: [], villagers: [], populated: new Set(Array.from({ length: 65536 }, (_, i) => i).filter(() => random() < 0.5)),
    stats: { mined: 999999999, placed: 999999999, crafted: 999999999, mobs: 999999999, deaths: 999999999, days: 999999999, dragons: 999999999 },
    end: { dragon: 'alive', health: 199.99, crystals: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], portalActive: true, egg: true }, victory: { day: 999999999, tick: 23999, by: players.map(player => player.name) }, pearlPity: 999999,
  };
  const save = exportSave(source), json = JSON.stringify(save), bytes = Buffer.byteLength(json);
  console.log(`worst-case city save: ${(bytes / 1024).toFixed(1)} KiB with ${edits.size} scattered edits and ${MAX_SAVED_PLAYERS} players`);
  assert.ok(bytes < MAX_SAVE_BYTES, `${bytes} bytes`);
  const parsed = parseSave(JSON.parse(json));
  assert.equal(parsed.players.length, MAX_SAVED_PLAYERS);
  assert.deepEqual(parsed.players[95]!.city, record);
});

test('what screens are sent: the city rides in the private view, the scoreboard once a second, the ledger at the end', () => {
  const state = city(['Ada', 'Bo', 'Cy'], { minutes: 10 }), c = state.city!, [ada, bo] = state.players as [Player, Player];
  put(state, bo, ada.x + 300, ada.z + 300);
  tick(state, 40);
  let board: number[][] | undefined, left: number | undefined;
  for (let i = 0; i < 25; i++) { tick(state); const view = publicView(state); assertSerializable(view); assertSerializable(playerView(state, 'p0')); if (view.city) ({ board, left } = view.city); }
  assert.deepEqual(board!.map(row => [row[0], row[1], row[2]]), [[0, START_COINS, 0], [1, START_COINS, 0], [2, START_COINS, 0]]);
  assert.ok(left! > 590 && left! <= 600);
  const mine = playerView(state, 'p0');
  assert.deepEqual(mine.city, { coins: START_COINS, heat: 0, own: 0, flat: -1, plot: -1 });
  assert.equal(mine.mode, 'city');
  // Vehicles near Ada reach her screen and not Bo's 400 blocks away; parked ones come once a second.
  const seen = new Set<number>(), far = new Set<number>();
  for (let i = 0; i < 40; i++) { tick(state); for (const t of playerView(state, 'p0').near?.v ?? []) seen.add(t[0]!); for (const t of playerView(state, 'p1').near?.v ?? []) far.add(t[0]!); }
  assert.ok(seen.size > 0, 'there are vehicles round the plaza');
  for (const id of seen) { const v = c.vehicles.find(vehicle => vehicle.id === id); if (v) assert.ok(Math.hypot(v.x - ada.x, v.z - ada.z) < 120); }
  assert.ok([...far].every(id => !seen.has(id)), 'each screen has its own neighbourhood');
  const quiet = JSON.stringify(playerView(state, 'p2')).length;
  assert.ok(quiet < 2600, `a quiet private view is ${quiet} bytes`);
  // The round ends by itself and everyone is ranked by what they are worth.
  c.players[1]!.coins = 900;
  c.players[2]!.own = 1 << RIDE.pebble!;
  assert.equal(outcome(state).complete, false);
  assert.deepEqual(outcome(state).rows.map(row => row.score), [START_COINS, 900, START_COINS + RIDES[RIDE.pebble!]!.price], 'a row a seat while the round runs');
  state.clock = 601;
  tick(state);
  const result = outcome(state), view = publicView(state);
  assert.equal(result.complete, true);
  assert.deepEqual(result.winners, ['p1']);
  assert.deepEqual(result.rows, [], 'and none once it is over: the room repeats the outcome twenty times a second, the ledger goes once');
  assert.deepEqual(decodeLedger(view).map(line => [line.id, line.worth]), [['p0', START_COINS], ['p1', 900], ['p2', START_COINS + RIDES[RIDE.pebble!]!.price]], 'the ledger travels as numbers by seat and reads back by id');
  assert.equal(view.journal, undefined, 'the wild journal stays out of city results');
  assertSerializable(view);
  const entry = (id: string, patch: Partial<LedgerEntry>): LedgerEntry => ({ id, worth: 0, coins: 0, earned: 0, gigs: 0, bonks: 0, busts: 0, escapes: 0, peak: 0, drove: 0, flew: 0, kos: 0, fish: 0, wins: 0, jump: 0, tips: 0, helped: 0, bounties: 0, stamps: 0, feathers: 0, gull: 0, ...patch });
  const won = cityAwards([entry('a', { worth: 900, gigs: 5 }), entry('b', { worth: 100, bonks: 9, peak: 80, busts: 2 }), entry('c', { worth: 100, escapes: 2, drove: 800 })]);
  assert.deepEqual(Object.fromEntries(won.map(award => [award.title, award.ids])), { Tycoon: ['a'], 'Most Wanted': ['b'], Slippery: ['c'], 'Road Hog': ['c'], 'Bonk Champion': ['b'], Jailbird: ['b'], 'Model Citizen': ['a'] });
  assert.deepEqual(cityAwards([entry('a', { worth: START_COINS }), entry('b', { worth: START_COINS })]), [], 'a round nobody did anything in hands out nothing: the starting coins make no Tycoon');
});

test('the city leaves the wild alone: no monsters, animals or hunger; survival still has them', () => {
  const state = city(['Ada']), ada = state.players[0]!;
  state.time = 16000;
  ada.food = 3;
  ada.health = 10;
  tick(state, 20 * 30);
  assert.equal(state.mobs.length, 0, 'nothing spawns at night in the city');
  assert.equal(ada.food, 20);
  assert.ok(ada.health > 10, 'a rest mends health');
  assert.equal(state.settings.keepInventory, true);
  assert.equal(cellIndex(0, 0, 0), 0);
});

test('a slow screen keeps the parked vehicles: a list stays until a newer one replaces it', () => {
  // Parked vehicles ride in one snapshot a second; a screen drawing a few frames a second is rarely between that one and the next.
  const rides = new Rides(new Object3D(), () => [1, 1, 1]), eye = new Vector3(100, 0, 100);
  const car = (id: number, x: number, f: number): PubRide => ({ id, k: RIDE.pebble, x, y: GROUND, z: 100, yaw: 0, paint: 0, f, v: 0 });
  const frames = (count: number, moving: PubRide[] = [], from = eye) => { for (let i = 0; i < count; i++) rides.update(0.1, moving, moving, 1, null, from); };
  assert.equal(rides.asking, true, 'with no list yet, the screen asks for one');
  rides.park([car(1, 100, RF.ASLEEP), car(2, 106, RF.ASLEEP)]);
  assert.equal(rides.asking, false);
  frames(100);
  assert.deepEqual([...rides.shown.keys()], [1, 2], 'ten seconds of frames between scenes without the list');
  assert.equal(rides.nearest(100, 100, 2.4)?.id, 1, 'and the one beside the player can be boarded');
  rides.park([car(3, 90, RF.DRIVEN)]);
  frames(1);
  assert.equal(rides.shown.size, 2, 'a scene of moving vehicles only is not a parked list');
  rides.park([car(2, 106, RF.ASLEEP)]);
  frames(1);
  assert.deepEqual([...rides.shown.keys()], [2], 'a newer list leaves the first one out');
  frames(1, [car(3, 90, RF.DRIVEN)]);
  assert.ok(rides.shown.has(3));
  frames(20);
  assert.deepEqual([...rides.shown.keys()], [2], 'a moving vehicle goes soon after the scenes stop listing it');
  frames(1, [], new Vector3(400, 0, 100));
  assert.equal(rides.shown.size, 0, 'and a parked one far behind is forgotten');
});

test('parked vehicles are listed once a second, and in every scene for a screen that asks', () => {
  const state = city(), [ada] = state.players as [Player];
  tick(state, 30);
  const listed = (f: number) => Array.from({ length: 20 }, () => {
    rules.tick(state, new Map([['p0', parseInput({ p: [ada.x, ada.y, ada.z], v: [0, 0, 0], yaw: 0, pitch: 0, f, slot: 0, mine: null, tpAck: ada.tp.n, cmds: [] })]]), 0.05, 0);
    return decodeScene(playerView(state, 'p0').near!, publicView(state).who).rides!.some(ride => ride.f & RF.ASLEEP);
  }).filter(Boolean).length;
  assert.equal(listed(IF.ON_GROUND), 1);
  assert.equal(listed(IF.ON_GROUND | IF.PARKED), 20, 'a screen too slow to catch that one snapshot gets the list in the next');
  assert.equal(listed(IF.ON_GROUND), 1, 'and the asking stops with the flag');
});
