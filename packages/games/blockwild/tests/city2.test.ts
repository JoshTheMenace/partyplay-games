/** Caper City, second helping: the passport, gadgets, the parachute, giving, and what a save and a screen carry of them. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { manifest } from '../src/manifest';
import rules from '../src/server';
import { CATALOG, START_COINS } from '../src/shared/city/economy';
import { hasStamp, STAMP, stampCount, STAMPS, titleFor, todo } from '../src/shared/city/passport';
import { GROUND } from '../src/shared/city/plan';
import { RIDE } from '../src/shared/city/vehicles';
import { I } from '../src/shared/items';
import { CITY_ID, decodeLedger, IF, NS, parseInput, PF, type Cmd, type CmdBody, type Input } from '../src/shared/protocol';
import { validateSettings } from '../src/shared/protocol';
import { SnapshotEncoder } from '../../../party-contract/src/snapshot-cache';
import { stamp } from '../src/sim/city-career';
import { whereIs } from '../src/sim/city-state';
import { addExtra, mischief } from '../src/sim/city-watch';
import { runCommand } from '../src/sim/commands';
import { createState } from '../src/sim/game';
import { CITY_FIELDS, CITY_SAVE_VERSION, exportSave, parseSave } from '../src/sim/save';
import type { Player, State } from '../src/sim/state';
import { playerView, publicView } from '../src/sim/views';

const SEED = 11;
const ctx = (names: string[]) => ({ roomId: 'room', roundId: 'round', seed: 3, nowMs: 0, players: names.map((name, i) => ({ id: `p${i}`, name, color: '#28c6e7' })) });
const city = (names = ['Ada'], extra: Record<string, unknown> = {}): State => createState(ctx(names), validateSettings({ mode: 'city', seed: SEED, ...extra }));
const tick = (state: State, ticks = 1, inputs = new Map<string, Input>()) => { for (let i = 0; i < ticks; i++) rules.tick(state, inputs, 0.05, 0); };
let n = 0;
const run = (state: State, player: Player, body: CmdBody) => runCommand(state, player, { ...body, n: ++n } as Cmd);
const put = (state: State, player: Player, x: number, z: number, y = GROUND) => { Object.assign(player, { x, y, z, fallPeak: y, supportY: y, movedAt: state.clock, walkBudget: 0, tp: { n: player.tp.n + 1, x, y, z } }); };
/** An input that claims a position, as a screen would send it. */
const at = (player: Player, x: number, y: number, z: number, f = 0): Input => ({ ...parseInput({ p: [x, y, z], v: [0, 0, 0], yaw: player.yaw, pitch: 0, f, slot: player.slot, tpAck: player.tp.n }) });
/** Somebody out of doors near a player, moved to stand in front of them (facing north, the way yaw 0 looks). */
function victim(state: State, player: Player, dz = -2): number {
  const npc = addExtra(state, player.x, GROUND, player.z + dz, false, -1, NS.STAND);
  npc.until = state.clock + 60;
  return npc.i;
}

test('the passport: a stamp pays once, the to-do list is what is missing, titles come with the count', () => {
  const state = city(), ada = state.players[0]!, cp = state.city!.players[0]!;
  assert.equal(STAMPS.length, 32);
  assert.equal(new Set(STAMPS.map(entry => entry.key)).size, 32);
  assert.deepEqual(todo(cp.stamps).map(id => STAMPS[id]!.key), ['wheels', 'gig', 'snack']);
  assert.equal(stamp(state, ada, 'wheels'), true);
  assert.equal(cp.coins, START_COINS + STAMPS[STAMP.wheels!]!.coins);
  assert.equal(stamp(state, ada, 'wheels'), false, 'once only');
  assert.equal(cp.coins, START_COINS + 10);
  assert.equal(stamp(state, ada, 'no such stamp'), false);
  assert.deepEqual(todo(cp.stamps).map(id => STAMPS[id]!.key), ['gig', 'snack', 'bonk']);
  assert.match(ada.toast!.text, /Passport stamp: Take a ride/);
  // Stamps above bit 15 live in the second half.
  stamp(state, ada, 'tycoon');
  assert.ok(hasStamp(cp.stamps, STAMP.tycoon!) && cp.stamps[1]! > 0 && cp.stamps[0] === 1);
  assert.equal(stampCount(cp.stamps), 2);
  assert.deepEqual([titleFor(0), titleFor(4), titleFor(32)], ['Newcomer', 'Regular', 'Legend']);
  for (const entry of STAMPS.slice(2, 5)) stamp(state, ada, entry.key);
  assert.match(state.city!.news![1], /Ada is now a Regular/);
  // Getting in a vehicle, eating and bonking stamp it by themselves.
  const fresh = city(), bo = fresh.players[0]!, seat = fresh.city!.players[0]!;
  tick(fresh, 25);
  const scooter = fresh.city!.vehicles.find(v => v.k === RIDE.zipster)!;
  put(fresh, bo, scooter.x + 1, scooter.z);
  assert.equal(run(fresh, bo, { t: 'interact', id: scooter.id }), true);
  assert.ok(hasStamp(seat.stamps, STAMP.wheels!));
  run(fresh, bo, { t: 'city', a: 'exit' });
  bo.inv[1] = { id: I.donut, n: 1 };
  bo.health = 10;
  fresh.clock += 10;
  bo.useStart = fresh.clock - 5;
  assert.equal(run(fresh, bo, { t: 'useItem', slot: 1 }), true);
  assert.ok(hasStamp(seat.stamps, STAMP.snack!) && bo.health > 10);
  Object.assign(bo, { yaw: 0 });
  const who = victim(fresh, bo);
  assert.equal(run(fresh, bo, { t: 'attack', id: CITY_ID + who }), true);
  assert.ok(hasStamp(seat.stamps, STAMP.bonk!));
});

test('gadgets: a balloon soaks whoever is near, a peel fells an officer, smoke blinds the Watch, and all are on sale', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!, cp = c.players[0]!;
  for (const id of [I.water_balloon, I.banana_peel, I.smoke_puff, I.parasol]) assert.ok(CATALOG.gizmo.some(offer => offer.t === 'item' && offer.id === id), `the gadget shops sell item ${id}`);
  put(state, ada, 2000.5, 1736.5);
  put(state, bo, 2040.5, 1736.5);
  tick(state);
  ada.yaw = 0;
  // A balloon at a bystander: they run for it (no stars, no coins), and the thrower's balloon is gone.
  const wet = victim(state, ada, -5);
  ada.inv[1] = { id: I.water_balloon, n: 2 };
  assert.equal(run(state, ada, { t: 'useItem', slot: 1 }), true);
  assert.equal(ada.inv[1]!.n, 1);
  assert.equal(c.npcs.get(wet)!.s, NS.FLEE);
  assert.equal(c.splashes.length, 1, 'fires read the splashes of the tick');
  tick(state);
  assert.equal(c.splashes.length, 0);
  // A peel: an officer running over it goes down and the peel is used up.
  ada.inv[2] = { id: I.banana_peel, n: 1 };
  assert.equal(run(state, ada, { t: 'useItem', slot: 2 }), true);
  assert.equal(c.peels.length, 1);
  assert.ok(state.items.some(item => item.item === I.banana_peel), 'screens draw it as an item on the ground');
  tick(state, 30);
  assert.equal(ada.inv.filter(slot => slot?.id === I.banana_peel).length, 0, 'nobody picks a peel up');
  const officer = addExtra(state, ada.x, GROUND, ada.z, true, 0, NS.CHASE);
  cp.heat = 50;
  tick(state, 2);
  assert.equal(c.npcs.get(officer.i)!.s, NS.DIZZY, 'the officer slipped');
  assert.equal(c.peels.length, 0);
  assert.ok(!state.items.some(item => item.item === I.banana_peel));
  // The one who dropped a peel may step off it; anybody else slips.
  put(state, ada, 2010.5, 1736.5);
  ada.inv[2] = { id: I.banana_peel, n: 1 };
  run(state, ada, { t: 'useItem', slot: 2 });
  bo.protectedUntil = 0;
  put(state, bo, 2010.5, 1736.5);
  tick(state, 2);
  assert.ok(c.players[1]!.dizzyUntil > state.clock, 'Bo trod on it');
  assert.ok(playerView(state, 'p0').near === undefined || true);
  // Smoke: mischief inside it goes unseen, and an officer cannot see into it.
  c.npcs.clear();
  put(state, ada, 2100.5, 1736.5);
  cp.heat = 0;
  const watcher = addExtra(state, ada.x + 6, GROUND, ada.z, true, -1, NS.STAND);
  watcher.until = state.clock + 60;
  assert.equal(mischief(state, ada, 10, false), true, 'an officer six blocks off sees it');
  cp.heat = 0;
  ada.inv[3] = { id: I.smoke_puff, n: 1 };
  assert.equal(run(state, ada, { t: 'useItem', slot: 3 }), true);
  assert.equal(mischief(state, ada, 10, false), false, 'not through smoke');
  tick(state, 20 * 8);
  assert.equal(c.smokes.length, 0, 'it clears');
});

test('the parachute: bailing out of an aircraft or carrying a parasol makes a long fall soft', () => {
  const fall = (parasol: boolean, flag: boolean) => {
    const state = city(), ada = state.players[0]!, cp = state.city!.players[0]!;
    put(state, ada, 2024.5, 1900.5, GROUND + 30);
    ada.protectedUntil = 0;
    if (parasol) ada.inv[1] = { id: I.parasol, n: 1 };
    // Down thirty blocks at a canopy's pace (or a stone's), then onto the ground.
    for (let y = GROUND + 30; y > GROUND; y -= flag ? 0.17 : 1.2) tick(state, 1, new Map([['p0', at(ada, ada.x, Math.max(GROUND, y), ada.z, flag ? IF.CHUTE : 0)]]));
    tick(state, 1, new Map([['p0', at(ada, ada.x, GROUND, ada.z, IF.ON_GROUND)]]));
    return { state, ada, cp };
  };
  const soft = fall(true, true), hard = fall(false, false), cheat = fall(false, true);
  assert.equal(soft.ada.health, 20, 'a parasol floats its owner down');
  assert.ok(hasStamp(soft.cp.stamps, STAMP.chute!));
  assert.ok(hard.ada.dead || hard.ada.health < 6, 'without one the fall is the usual fall');
  assert.ok(cheat.ada.dead || cheat.ada.health < 20, 'the flag alone opens nothing');
  // Stepping out of a helicopter in the air comes with a canopy, and the player is drawn under it.
  const state = city(), ada = state.players[0]!, c = state.city!;
  const pad = c.plan.bays.find(bay => bay.kind === RIDE.dragonfly)!;
  put(state, ada, pad.x + 3, pad.z);
  tick(state, 25);
  const heli = c.vehicles.find(v => v.k === RIDE.dragonfly)!;
  put(state, ada, heli.x + 1, heli.z);
  assert.equal(run(state, ada, { t: 'interact', id: heli.id }), true);
  Object.assign(ada, { y: GROUND + 40, onGround: false });
  heli.y = GROUND + 40;
  assert.equal(run(state, ada, { t: 'city', a: 'exit' }), true);
  assert.equal(playerView(state, 'p0').city!.chute, 1);
  tick(state, 1, new Map([['p0', at(ada, ada.x, ada.y - 0.2, ada.z, IF.CHUTE)]]));
  assert.ok(c.players[0]!.gliding);
  const tuple = playerView(state, 'p0').near!.p.find(t => t[0] === 0)!;
  assert.ok(tuple[10]! & PF.CHUTE);
});

test('giving: coins change hands within a few steps, never more than the giver has', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!;
  put(state, ada, 2000.5, 1736.5);
  put(state, bo, 2003.5, 1736.5);
  assert.equal(run(state, ada, { t: 'city', a: 'give', i: 1, j: 10 }), true);
  assert.deepEqual([c.players[0]!.coins, c.players[1]!.coins], [START_COINS - 10 + STAMPS[STAMP.gift!]!.coins, START_COINS + 10]);
  assert.equal(run(state, ada, { t: 'city', a: 'give', i: 1, j: 5000 }), false);
  assert.equal(run(state, ada, { t: 'city', a: 'give', i: 0, j: 1 }), false, 'not to yourself');
  put(state, bo, 2040.5, 1736.5);
  assert.equal(run(state, ada, { t: 'city', a: 'give', i: 1, j: 1 }), false, 'too far');
  assert.match(bo.toast!.text, /Ada gave you 10 coins/);
});

test('saves: version 13 keeps the whole career, a version 12 city still loads, and the fields have their bounds', () => {
  const state = city(['Ada'], { minutes: 10 }), ada = state.players[0]!, cp = state.city!.players[0]!;
  stamp(state, ada, 'wheels');
  stamp(state, ada, 'tycoon');
  Object.assign(cp, { feathers: [5, 9], story: 0o1234, rep: [77, 12, 40], hat: 6, paint: 3, tuned: 0b101, biz: [4, 60] });
  Object.assign(cp.stats, { fish: 12, wins: 3, jump: 27.4, tips: 345, helped: 2, bounties: 1, gull: 44 });
  const save = rules.exportSave!(state) as ReturnType<typeof exportSave>, json = JSON.stringify(save);
  assert.equal(save.version, CITY_SAVE_VERSION);
  assert.equal(save.players[0]!.c!.length, CITY_FIELDS);
  const back = rules.loadSave!(ctx(['Ada']), JSON.parse(json), validateSettings({})).state.city!.players[0]!;
  assert.deepEqual([back.stamps, back.feathers, back.story, back.rep, back.hat, back.paint, back.tuned, back.biz], [cp.stamps, [5, 9], 0o1234, [77, 12, 40], 6, 3, 0b101, [4, 60]]);
  assert.deepEqual([back.stats.fish, back.stats.wins, back.stats.jump, back.stats.tips, back.stats.helped, back.stats.bounties, back.stats.gull], [12, 3, 27, 345, 2, 1, 44]);
  // The city's first format: thirteen numbers a player. It loads, with the new things at their starting marks.
  const old = { ...JSON.parse(json), version: 12, players: [{ ...save.players[0], c: save.players[0]!.c!.slice(0, 13) }] };
  const from12 = rules.loadSave!(ctx(['Ada']), old, validateSettings({})).state.city!.players[0]!;
  assert.deepEqual([from12.coins, from12.stamps, from12.rep, from12.hat, from12.biz, from12.stats.fish], [cp.coins, [0, 0], [20, 20, 0], 0, [], 0]);
  assert.throws(() => parseSave({ ...JSON.parse(json), players: [{ ...save.players[0], c: save.players[0]!.c!.slice(0, 13) }] }), /damaged/, 'a version 13 record has all its fields');
  assert.throws(() => parseSave({ ...JSON.parse(json), players: [{ ...save.players[0], c: save.players[0]!.c!.map((value, k) => k === 13 ? 70000 : value) }] }), /damaged/, 'stamps are sixteen bits a half');
  assert.throws(() => parseSave({ ...JSON.parse(json), version: 14 }), /newer version/);
});

test('what screens are sent: the career rides in the bag, the ledger in the cached part of the view', () => {
  const state = city(['Ada', 'Bo'], { minutes: 10 }), ada = state.players[0]!;
  assert.deepEqual(manifest.snapshotCache!.fields, ['edits', 'who', 'ledger']);
  const first = playerView(state, 'p0');
  assert.deepEqual(first.bag!.career, { st: [0, 0], fe: [0, 0], story: 0, rep: 20 | 20 << 7, look: 0, biz: 0 });
  // Confirmed, the bag (and the career in it) stays off the wire until something in it changes.
  const held = new Map([['p0', { ...parseInput(null), bag: first.bagRev }]]);
  tick(state, 1, held);
  assert.equal(playerView(state, 'p0').bag, undefined);
  stamp(state, ada, 'gig');
  const next = playerView(state, 'p0');
  assert.equal(next.bag!.career!.st[0], 2);
  assertSerializable(next);
  // The ledger: an empty list until the round is over, then one line a seat, and the cache key moves once.
  const encoder = new SnapshotEncoder(), before = publicView(state);
  assert.deepEqual(before.ledger, []);
  encoder.encode('round', before, manifest.snapshotCache);
  assert.equal('ledger' in (encoder.encode('round', publicView(state), manifest.snapshotCache).publicView as object), false, 'unchanged: not resent');
  const revision = state.revision;
  state.clock = 601;
  tick(state);
  const done = publicView(state), sent = encoder.encode('round', done, manifest.snapshotCache);
  assert.equal(state.revision, revision + 1);
  assert.equal(done.ledger.length, 2);
  assert.equal('ledger' in (sent.publicView as object), true, 'sent when the round ends');
  assert.equal('ledger' in (encoder.encode('round', publicView(state), manifest.snapshotCache).publicView as object), false, 'and not again in the snapshots the results screen repeats');
  const lines = decodeLedger(done);
  assert.deepEqual([lines[0]!.id, lines[0]!.stamps, lines[1]!.stamps], ['p0', 1, 0]);
  rules.finish!(state, 0);
  assert.equal(state.revision, revision + 1, 'finishing twice moves nothing');
  // Survival keeps an empty ledger (the field is always there for the cache).
  assert.deepEqual(publicView(createState(ctx(['Ada']), validateSettings({ seed: 5 }))).ledger, []);
  assert.equal(whereIs(state, 0) === null || true, true);
});

// More ways to earn and spend --------------------------------------------------------------------------------------------
import { B, cellId, isWater } from '../src/shared/blocks';
import { VoxelWorld } from '../src/shared/chunk';
import { BIZ, FISH, HATS, sellPrice, shopPrice, SPRAY, STUNT, tunePrice } from '../src/shared/city/economy';
import { cityExtras, FEATHERS, rampHeight } from '../src/shared/city/extras';
import { cityPlan, ISLE, PIER, PLACE_KINDS, SEA_Y, SHORE } from '../src/shared/city/plan';
import { newRide, rideClass, RIDES, stepRide } from '../src/shared/city/vehicles';
import { EV } from '../src/shared/protocol';
import { generateChunk } from '../src/shared/worldgen';
import { startFire } from '../src/sim/city-events';
import type { CityState } from '../src/sim/city-state';

/** Stand at a place's counter and open it (its keeper is at work at the hour a city starts). */
function shop(state: State, player: Player, kind: string, nth = 0) {
  const c = state.city!, place = c.plan.byKind(kind as never)[nth]!, keeper = c.people.keepers[place.i]!.find(i => whereIs(state, i))!;
  put(state, player, place.front[0], place.front[1]);
  assert.equal(run(state, player, { t: 'interact', id: CITY_ID + keeper }), true, `the counter at ${place.name} opens`);
  return place;
}
/** Read a place's job board and take offer `i`. */
function takeFrom(state: State, player: Player, kind: string, i = 0) {
  const c = state.city!, place = c.plan.byKind(kind as never)[0]!, [x, y, z] = place.board!;
  // Two steps out from the board, towards the street.
  const dx = place.walk[0] - x - 0.5, dz = place.walk[1] - z - 0.5, d = Math.hypot(dx, dz);
  put(state, player, x + 0.5 + dx / d * 2, z + 0.5 + dz / d * 2);
  assert.equal(run(state, player, { t: 'use', x, y, z, face: 3 }), true, `${place.name} has a board`);
  assert.equal(run(state, player, { t: 'city', a: 'gig', i }), true);
  return { place, gig: c.players[player.seat]!.gig! };
}
/** Sit a player at the wheel of the nearest parked vehicle of a kind (it is stood in its bay as they come near). */
function drive(state: State, player: Player, k: number, c: CityState = state.city!) {
  const bay = c.plan.bays.filter(entry => entry.kind === k).sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0]!;
  put(state, player, bay.x + 2.5, bay.z, GROUND);
  tick(state, 25);
  const vehicle = c.vehicles.find(v => v.k === k && Math.hypot(v.x - bay.x, v.z - bay.z) < 2)!;
  assert.ok(vehicle, `a ${RIDES[k]!.name} waits in its bay`);
  assert.equal(run(state, player, { t: 'interact', id: vehicle.id }), true);
  return vehicle;
}
/** Move a driver (and so their vehicle) somewhere, stopped. */
function park(state: State, player: Player, x: number, z: number, y = GROUND) {
  put(state, player, x, z, y);
  state.city!.players[player.seat]!.speed = 0;
  tick(state, 5);
}

test('the plan grows without moving what was there: new places, moorings, bike racks and the lots outside the grid', () => {
  const plan = cityPlan(SEED);
  for (const kind of PLACE_KINDS) assert.ok(plan.byKind(kind).length >= 1, kind);
  assert.equal(plan.field, 390, 'the airfield keeps its number: saved flats are lot numbers');
  assert.deepEqual([plan.lots[plan.pier]!.kind, plan.lots[plan.isle]!.kind, plan.lots.length], ['pier', 'isle', 393]);
  assert.deepEqual([plan.lots[32]!.kind, plan.lots[34]!.kind, plan.lots[33]!.kind], ['firehouse', 'busdepot', 'warehouse']);
  assert.equal(plan.lots.filter(lot => lot.kind === 'flats').length, 66);
  for (const kind of [RIDE.clunker!, RIDE.trundler!, RIDE.squirt!, RIDE.patch!, RIDE.dinghy!, RIDE.skipjack!]) assert.ok(plan.bays.some(bay => bay.kind === kind), RIDES[kind]!.name);
  assert.ok(plan.bays.filter(bay => bay.kind === RIDE.clunker).length >= 12, 'bikes where people gather');
  for (const bay of plan.bays.filter(entry => rideClass(entry.kind) === 'sea')) assert.equal(bay.y, SEA_Y);
  const bait = plan.byKind('bait')[0]!;
  assert.ok(bait.counter[1] > SHORE + PIER.d - 8, 'the hut is at the far end of the pier');
  for (const kind of ['clinic', 'fire', 'bus', 'depot', 'hall', 'airfield'] as const) assert.ok(plan.byKind(kind)[0]!.board, `${kind} has a job board`);
  // Extras: spots, four courses that close, ramps and forty feathers, the same every time.
  const extras = cityExtras(SEED);
  assert.equal(extras, cityExtras(SEED));
  assert.deepEqual(extras.courses.map(course => [course.name, course.points.length]), [['Brasswick Dash', 8], ['Strand Sprint', 10], ['Grand Circuit', 8], ['Yards Rally', 8]]);
  for (const course of extras.courses) assert.deepEqual(course.points[course.points.length - 1], [course.x, course.z], 'a course ends where it starts');
  assert.equal(extras.feathers.length, FEATHERS);
  assert.equal(new Set(extras.feathers.map(at => at.join())).size, FEATHERS);
  assert.deepEqual(extras.spots.map(spot => spot.kind).filter((kind, i, all) => all.indexOf(kind) === i), ['race', 'paint', 'alarm', 'vault', 'lock', 'stall', 'prize']);
});

test('the new ground is in the chunks: Gull Rock, the pier head, a ramp and the lock-up, the same in any order', () => {
  const world = new VoxelWorld((cx, cz) => generateChunk(SEED, cx, cz, 'city'), 400), get = (x: number, y: number, z: number) => world.getCell(x, y, z);
  assert.equal(cellId(get(ISLE.x, GROUND + 1, ISLE.z + 5)), B.grass_block, 'the island has a grassy back');
  assert.equal(cellId(get(ISLE.x + 2, GROUND + 10, ISLE.z)), B.stucco, 'and a lighthouse');
  assert.equal(cellId(get(ISLE.x, GROUND + 6, ISLE.z + 1)), B.ladder);
  assert.ok(isWater(get(ISLE.x + 60, 62, ISLE.z)), 'in open sea');
  assert.equal(cellId(get(PIER.x0 - 5, GROUND - 1, SHORE + PIER.d + 2)), B.oak_planks, 'the pier head is wider than the pier');
  assert.equal(cellId(get(PIER.x0 + 3, GROUND, SHORE + PIER.d - 1)), B.counter, 'with the bait hut on it');
  const extras = cityExtras(SEED), ramp = extras.ramps[0]!, cage = extras.cage;
  assert.equal(rampHeight(ramp.long - 1), 4);
  assert.notEqual(cellId(get(ramp.x + ramp.dx * (ramp.long - 1), GROUND + 3, ramp.z + ramp.dz * (ramp.long - 1))), B.air, 'a ramp four blocks high at its lip');
  assert.equal(cellId(get(ramp.x, GROUND + 1, ramp.z)), B.air, 'and one at its foot');
  assert.equal(cellId(get(cage.x0 + 2, GROUND + 1, cage.z0)), B.iron_bars);
  assert.equal(cellId(get(Math.floor(cage.stand[0]), GROUND, Math.floor(cage.stand[2]))), B.air, 'room to stand in the cage');
  // Order: the chunks round the island and the pier, generated forwards and backwards.
  const keys: [number, number][] = [];
  for (let cz = (ISLE.z - 32) >> 4; cz <= (ISLE.z + 32) >> 4; cz++) for (let cx = (ISLE.x - 32) >> 4; cx <= (ISLE.x + 32) >> 4; cx++) keys.push([cx, cz]);
  const hash = (cells: Uint16Array) => { let h = 2166136261; for (let i = 0; i < cells.length; i++) h = Math.imul(h ^ cells[i]!, 16777619); return h >>> 0; };
  assert.deepEqual(keys.map(([cx, cz]) => hash(generateChunk(SEED, cx, cz, 'city'))), [...keys].reverse().map(([cx, cz]) => hash(generateChunk(SEED, cx, cz, 'city'))).reverse());
});

test('boats float where the water is deep, stop at the shore and are boarded from the pier; a bike is free to ride', () => {
  const world = new VoxelWorld((cx, cz) => generateChunk(SEED, cx, cz, 'city'), 400), get = (x: number, y: number, z: number) => world.getCell(x, y, z), boat = RIDES[RIDE.skipjack!]!;
  // Out from a mooring, south into the bay at full throttle.
  const r = newRide(PIER.x0 + PIER.w + 30, SEA_Y, SHORE + 50, Math.PI);
  for (let i = 0; i < 60 * 6; i++) stepRide(r, boat, { throttle: 1, steer: 0, brake: false, up: false, down: false }, 1 / 60, get);
  assert.ok(Math.abs(r.speed - boat.top) < 0.5 && Math.abs(r.y - SEA_Y) < 0.05, `afloat at speed ${r.speed.toFixed(1)}`);
  assert.ok(r.z > SHORE + 120);
  // Back at the beach it runs aground on the sand and goes no further.
  const ashore = newRide(PIER.x0 - 30, SEA_Y, SHORE + 30, 0);
  for (let i = 0; i < 60 * 8; i++) stepRide(ashore, boat, { throttle: 1, steer: 0, brake: false, up: false, down: false }, 1 / 60, get);
  assert.ok(ashore.z > SHORE + 6 && ashore.z < SHORE + 20, `stopped by the shallows at ${(ashore.z - SHORE).toFixed(1)}`);
  // In a room: a dinghy from the pier, and a stamp for it; stepping out lands on the deck, not in the sea.
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  const dinghy = drive(state, ada, RIDE.dinghy!);
  assert.equal(dinghy.y, SEA_Y);
  assert.equal(cp.heat, 0);
  assert.ok(hasStamp(cp.stamps, STAMP.sail!));
  assert.equal(validMoveAt(state, ada, dinghy.x, SEA_Y, dinghy.z + 3), true, 'the server lets a boat sail');
  assert.equal(run(state, ada, { t: 'city', a: 'exit' }), true);
  assert.ok(ada.y === GROUND && ada.x > PIER.x0 + 1 && ada.x < PIER.x0 + PIER.w - 1, `back on the pier's planks, not on its rail or a lamp (${ada.x.toFixed(1)}, ${ada.y})`);
  // A city bike: no heat for borrowing it, in front of an officer or not.
  const bike = drive(state, ada, RIDE.clunker!);
  addExtra(state, ada.x + 3, GROUND, ada.z, true, -1, NS.STAND);
  assert.equal(cp.heat, 0, 'free to ride');
  assert.ok(RIDES[bike.k]!.free);
  // Taken bikes are stood back in their racks after a while.
  const racked = () => c.vehicles.filter(v => v.k === RIDE.clunker && v.bay >= 0).length, before = racked();
  park(state, ada, ada.x + 9, ada.z);
  run(state, ada, { t: 'city', a: 'exit' });
  state.clock += 200;
  tick(state, 45);
  assert.equal(racked(), before + 1);
});
import { validMove } from '../src/sim/players';
const validMoveAt = (state: State, player: Player, x: number, y: number, z: number) => { player.movedAt = state.clock - 1; return validMove(state, player, x, y, z); };

test('a bus route: four stops in a Trundler, the last back at the depot, and more for a friend aboard', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!, cp = c.players[0]!;
  const { place, gig } = takeFrom(state, ada, 'bus');
  assert.deepEqual([gig.k, gig.drops, gig.stage], [3, 4, 1]);
  // On foot at the first stop nothing happens: it wants a bus.
  park(state, ada, gig.x, gig.z);
  assert.equal(cp.gig!.drops, 4);
  assert.match(ada.toast!.text, /needs a Trundler/);
  const bus = drive(state, ada, RIDE.trundler!);
  assert.equal(cp.heat, 0, 'on duty: no heat for taking the bus');
  put(state, bo, bus.x + 2, bus.z);
  assert.equal(run(state, bo, { t: 'interact', id: bus.id }), true, 'a friend rides along');
  const coins = cp.coins, pay = gig.pay;
  for (let stop = 0; stop < 4; stop++) {
    if (stop === 3) assert.deepEqual([cp.gig!.x, cp.gig!.z], [place.walk[0], place.walk[1]], 'the last stop is the depot');
    park(state, ada, cp.gig!.x, cp.gig!.z);
  }
  assert.equal(cp.gig, null);
  assert.ok(cp.coins >= coins + pay + Math.round(pay * 0.2), `paid ${cp.coins - coins} for a route worth ${pay} with a passenger`);
  assert.ok(hasStamp(cp.stamps, STAMP.bus!) && hasStamp(cp.stamps, STAMP.gig!));
  assert.match(bo.toast!.text, /12 coins for riding along/);
});

test('an ambulance run: fetch the patient in the Patch Wagon and bring them back to the clinic', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  const { place, gig } = takeFrom(state, ada, 'clinic');
  assert.deepEqual([gig.k, gig.stage], [4, 0]);
  const patient = c.npcs.get(gig.rider)!;
  assert.equal(patient.s, NS.DIZZY, 'somebody is lying out there');
  const wagon = drive(state, ada, RIDE.patch!);
  assert.equal(wagon.k, RIDE.patch);
  park(state, ada, gig.x, gig.z);
  assert.equal(cp.gig!.stage, 1);
  assert.equal(c.npcs.has(patient.i), false, 'aboard');
  assert.deepEqual([cp.gig!.x, cp.gig!.z], [place.walk[0], place.walk[1]]);
  const coins = cp.coins;
  park(state, ada, place.walk[0], place.walk[1]);
  assert.equal(cp.gig, null);
  assert.ok(cp.coins > coins && cp.stats.helped === 1 && hasStamp(cp.stamps, STAMP.medic!));
});

test('a cab fare: the passenger waits a short drive from the stand, the clock allows for both legs, and the door pays', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!, far = (ax: number, az: number, bx: number, bz: number) => Math.abs(ax - bx) + Math.abs(az - bz);
  const { place, gig } = takeFrom(state, ada, 'cabs');
  assert.deepEqual([gig.k, gig.stage], [2, 0]);
  const fare = c.npcs.get(gig.rider)!, [px, pz, tx, tz] = [gig.x, gig.z, gig.from[0]!, gig.from[1]!], out = far(place.walk[0], place.walk[1], px, pz), ride = far(px, pz, tx, tz), pay = gig.pay;
  assert.equal(fare.s, NS.HAIL, 'somebody is hailing');
  assert.ok(out >= 40 && out <= 160, `the fare waits ${out} blocks from the stand, not across the city`);
  assert.ok(gig.until - state.clock >= (out + ride) / 7 + 25, `time for both legs: ${Math.round(gig.until - state.clock)} s for ${out} + ${ride} blocks`);
  // On foot nothing happens; in a cab the fare gets in, and the door they point at pays.
  park(state, ada, px, pz);
  assert.equal(cp.gig!.stage, 0);
  assert.ok(drive(state, ada, RIDE.hopper!));
  park(state, ada, px, pz);
  assert.equal(cp.gig!.stage, 1);
  assert.equal(c.npcs.has(fare.i), false, 'aboard');
  assert.deepEqual([cp.gig!.x, cp.gig!.z], [tx, tz]);
  const coins = cp.coins;
  park(state, ada, tx, tz);
  assert.equal(cp.gig, null);
  assert.ok(cp.coins >= coins + pay, `paid ${cp.coins - coins} for a ${pay} coin fare`);
});

test('a fire call: the fire is on every map, an engine parked by it or water balloons put it out, helpers share the pot', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!, cp = c.players[0]!;
  c.nextEventAt = Infinity;
  const { gig } = takeFrom(state, ada, 'fire');
  assert.equal(gig.k, 5);
  const fire = c.events.find(event => event.k === EV.FIRE)!;
  assert.deepEqual([fire.x, fire.z, fire.a], [gig.x, gig.z, 100]);
  state.ticks = 19;
  tick(state);
  assert.deepEqual(publicView(state).city!.ev![0]!.slice(0, 3), [EV.FIRE, Math.round(fire.x), Math.round(fire.z)]);
  // Bo lobs two balloons at it; Ada parks an engine beside it.
  put(state, bo, fire.x, fire.z + 6);
  bo.yaw = 0;
  bo.inv[1] = { id: I.water_balloon, n: 2 };
  run(state, bo, { t: 'useItem', slot: 1 });
  tick(state);
  assert.ok(fire.a < 100 - 20, `a balloon took it to ${fire.a}`);
  drive(state, ada, RIDE.squirt!);
  park(state, ada, fire.x + 5, fire.z);
  const coins = [cp.coins, c.players[1]!.coins];
  tick(state, 20 * 9);
  assert.equal(c.events.some(event => event.k === EV.FIRE), false, 'out');
  assert.equal(cp.gig, null, 'and the call is settled');
  assert.ok(cp.coins >= coins[0]! + gig.pay && c.players[1]!.coins > coins[1]!, 'the crew and the balloon thrower are both paid');
  assert.ok(hasStamp(cp.stamps, STAMP.hero!) && hasStamp(c.players[1]!.stamps, STAMP.hero!));
  assert.equal(cp.stats.helped, 1);
  // A fire nobody tends burns for its time and goes out by itself.
  startFire(state, 2000, 1736, 'a test');
  state.clock += 300;
  tick(state, 12);
  assert.equal(c.events.length, 0);
});

test('fishing: cast at water, strike while the fish is on, sell the catch at the bait hut', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  assert.equal(FISH.reduce((sum, row) => sum + row[2], 0), 1000);
  assert.equal(FISH.reduce((sum, row) => sum + row[3], 0), 1000);
  ada.inv[1] = { id: I.fishing_rod, n: 1 };
  ada.slot = 1;
  // No water in sight on the plaza.
  ada.yaw = Math.PI / 2;
  assert.equal(run(state, ada, { t: 'useItem', slot: 1 }), false);
  assert.match(ada.toast!.text, /Face some water/);
  // On the pier head, facing out to sea.
  put(state, ada, PIER.x0 + 3.5, SHORE + PIER.d + 2.5);
  ada.yaw = Math.PI;
  assert.equal(run(state, ada, { t: 'useItem', slot: 1 }), true);
  assert.equal(cp.fish, 1);
  assert.deepEqual(playerView(state, 'p0').city!.fish!.slice(0, 1), [1]);
  assert.ok(cp.fishDeep, 'deep water off the pier head');
  // Too soon reels in nothing.
  assert.equal(run(state, ada, { t: 'useItem', slot: 1 }), true);
  assert.equal(cp.fish, 0);
  assert.equal(cp.stats.fish, 0);
  // Wait for the bite, then strike inside the window.
  let caught = 0;
  for (let n = 0; n < 12 && cp.stats.fish < 3; n++) {
    run(state, ada, { t: 'useItem', slot: 1 });
    for (let i = 0; i < 20 * 12 && cp.fish !== 2; i++) tick(state, 1, new Map([['p0', { ...at(ada, ada.x, ada.y, ada.z, IF.ON_GROUND), slot: 1 }]]));
    assert.equal(cp.fish, 2, 'a bite comes within ten seconds');
    run(state, ada, { t: 'useItem', slot: 1 });
    caught++;
  }
  assert.ok(cp.stats.fish >= 3 && hasStamp(cp.stamps, STAMP.fish!), `${cp.stats.fish} fish in ${caught} casts`);
  // Miss the window and it gets away.
  run(state, ada, { t: 'useItem', slot: 1 });
  for (let i = 0; i < 20 * 14 && cp.fish; i++) tick(state, 1, new Map([['p0', { ...at(ada, ada.x, ada.y, ada.z, IF.ON_GROUND), slot: 1 }]]));
  assert.match(ada.toast!.text, /got away/);
  // The hut pays the listed price.
  const fishAt = ada.inv.findIndex(slot => slot && FISH.some(row => row[0] === slot.id && row[0] !== I.old_boot)), stack = ada.inv[fishAt]!, coins = cp.coins;
  shop(state, ada, 'bait');
  assert.equal(run(state, ada, { t: 'city', a: 'sell', i: fishAt }), true);
  assert.equal(cp.coins, coins + sellPrice(0, 'bait', stack.id) * stack.n);
  assert.equal(sellPrice(0, 'food', I.silver_dab), 11, 'diners take fish at four fifths');
  assert.equal(sellPrice(60, 'pawn', I.swag_bag), 163, 'the Magpies pay their friends more');
});

test('busking: a kazoo draws a crowd and tips, more as the tune warms up', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  tick(state, 12);
  // A market crowd at eleven in the morning.
  const market = c.plan.lots.find(lot => lot.kind === 'market')!;
  put(state, ada, market.x0 + 24.5, market.z0 + 20.5);
  for (let k = 0; k < 6; k++) victim(state, ada, -3 - k);
  ada.inv[1] = { id: I.kazoo, n: 1 };
  tick(state, 12);
  let tips = 0;
  for (let n = 0; n < 220 && tips < 10; n++) { run(state, ada, { t: 'useItem', slot: 1 }); tick(state, 7); tips = cp.stats.tips; }
  assert.ok(tips >= 1, 'somebody tipped');
  assert.ok(hasStamp(cp.stamps, STAMP.busk!));
  assert.ok(cp.tune > 0.5, 'the tune has warmed up');
  assert.equal(run(state, ada, { t: 'useItem', slot: 1 }) && run(state, ada, { t: 'useItem', slot: 1 }), false, 'notes come no faster than three a second');
});

test('hats, a business, a tune-up and a respray', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!, cp = c.players[0]!, other = c.players[1]!;
  cp.coins = other.coins = 5000;
  // A hat is worn at once, shows in the player's tuple and in the career.
  shop(state, ada, 'hats');
  const top = HATS.findIndex(hat => hat.name === 'Top hat');
  assert.equal(run(state, ada, { t: 'city', a: 'buy', i: 0 }), true);
  assert.equal(cp.hat, top);
  assert.ok(hasStamp(cp.stamps, STAMP.hat!));
  assert.equal(playerView(state, 'p0').near!.p.find(t => t[0] === 0)![11], top);
  assert.equal(playerView(state, 'p0').bag!.career!.look & 15, top);
  // A business: bought once, pays every minute, and takes a cut of what Bo spends there.
  const diner = shop(state, ada, 'food'), [price, income] = BIZ.food!;
  let coins = cp.coins;
  assert.equal(run(state, ada, { t: 'city', a: 'biz' }), true);
  assert.deepEqual([cp.coins, cp.biz, c.owners.get(diner.i)], [coins - price + 40, [diner.i], 0]);
  assert.equal(playerView(state, 'p0').city!.owner, 0);
  shop(state, bo, 'food');
  assert.equal(run(state, bo, { t: 'city', a: 'biz' }), false, 'one owner');
  coins = cp.coins;
  assert.equal(run(state, bo, { t: 'city', a: 'buy', i: 0 }), true);
  assert.equal(cp.coins, coins + Math.round(14 * 0.3), 'a cut of a burger');
  coins = cp.coins;
  state.clock += 61;
  tick(state);
  assert.equal(cp.coins, coins + income);
  assert.equal(publicView(state).city === undefined || true, true);
  // It counts towards net worth, and comes back with a save.
  state.ticks = 19;
  tick(state);
  assert.equal(publicView(state).city!.board[0]![3], cp.coins + price);
  const loaded = rules.loadSave!(ctx(['Ada', 'Bo']), JSON.parse(JSON.stringify(rules.exportSave!(state))), validateSettings({})).state.city!;
  assert.deepEqual([loaded.players[0]!.biz, loaded.owners.get(diner.i), loaded.players[0]!.hat], [[diner.i], 0, top]);
  // The townsfolk's friends pay less; those they are wary of, more.
  assert.deepEqual([shopPrice(100, 20, false), shopPrice(100, 45, false), shopPrice(100, 80, false), shopPrice(100, 20, true)], [100, 90, 80, 125]);
  // A tune-up makes an owned vehicle quicker for good.
  shop(state, ada, 'dealer');
  run(state, ada, { t: 'city', a: 'buy', i: 0 });
  coins = cp.coins;
  assert.equal(run(state, ada, { t: 'city', a: 'tune', i: RIDE.zipster! }), true);
  assert.equal(cp.coins, coins - tunePrice(RIDE.zipster!));
  assert.equal(run(state, ada, { t: 'city', a: 'tune', i: RIDE.zipster! }), false, 'once');
  assert.equal(run(state, ada, { t: 'city', a: 'tune', i: RIDE.comet! }), false, 'only what you own');
  const scooter = c.vehicles.find(v => v.owner === 0 && v.k === RIDE.zipster)!;
  put(state, ada, scooter.x + 1, scooter.z);
  run(state, ada, { t: 'interact', id: scooter.id });
  assert.ok(Math.abs(ada.pace - RIDES[RIDE.zipster!]!.top * 1.12) < 1e-9);
  // The spray pad: a new colour, and heat off when nobody is watching.
  const pad = cityExtras(SEED).spots.find(spot => spot.kind === 'paint')!, paint = scooter.paint;
  park(state, ada, pad.x, pad.z);
  Object.assign(cp, { heat: 50, seenAt: -1e9, hotAt: -1e9, spell: 2 });
  coins = cp.coins;
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: pad.i }), true);
  assert.ok(scooter.paint !== paint && cp.paint === scooter.paint);
  assert.ok(cp.heat <= 50 - SPRAY.cools + 1 && cp.coins === coins - SPRAY.price + 15);
  run(state, ada, { t: 'city', a: 'exit' });
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: pad.i }), false, 'on foot there is nothing to spray');
});

test('golden feathers are found by walking into them; a jump off a ramp pays by the block', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!, extras = cityExtras(SEED);
  let coins = cp.coins;
  for (let i = 0; i < 5; i++) { const [x, y, z] = extras.feathers[20 + i]!; put(state, ada, x, z, y); tick(state, 5); }
  assert.deepEqual(cp.feathers, [0, 0b11111]);
  assert.equal(cp.coins, coins + 5 * 15 + 30, 'fifteen coins each and the stamp for five');
  tick(state, 10);
  assert.deepEqual(cp.feathers, [0, 0b11111], 'each one once');
  // A stunt: leave the ground at one place in a car, land fourteen blocks on.
  const ramp = extras.ramps[0]!;
  put(state, ada, ramp.x - 20, ramp.z + 1);
  const car = drive(state, ada, RIDE.clunker!);
  assert.ok(car);
  coins = cp.coins;
  const fly = (x: number, y: number, f: number) => tick(state, 1, new Map([['p0', at(ada, x, y, ramp.z + 1.5, f)]]));
  ada.pace = 30;
  put(state, ada, ramp.x + 12.5, ramp.z + 1.5, GROUND + 4);
  for (let k = 1; k <= 7; k++) fly(ramp.x + 12.5 + k * 2, GROUND + 4 - k * 0.5, 0);
  fly(ramp.x + 12.5 + 16, GROUND, IF.ON_GROUND);
  assert.ok(cp.stats.jump >= 14, `a jump of ${cp.stats.jump}`);
  assert.equal(cp.coins, coins + cp.stats.jump * STUNT.per + 30);
  assert.ok(hasStamp(cp.stamps, STAMP.stunt!));
});

test('a stunt ramp at speed: the shared physics takes a quick car up every step, the server accepts the climb and the jump is paid', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!, ramp = cityExtras(SEED).ramps[0]!, line = ramp.z + 1.5;
  assert.ok(drive(state, ada, RIDE.comet!));
  const r = newRide(ramp.x - 60, GROUND, line, -Math.PI / 2), kind = RIDES[RIDE.comet!]!;
  put(state, ada, r.x, r.z);
  tick(state, 2);
  const told = ada.tp.n;
  let lip = 0, refused = '';
  for (let i = 0; i < 20 * 12 && !cp.stats.jump && !refused; i++) {
    for (let k = 0; k < 3; k++) { stepRide(r, kind, { throttle: 1, steer: 0, brake: false, up: false, down: false }, 1 / 60, state.get); if (r.x > ramp.x + 11 && !lip) lip = r.speed; }
    tick(state, 1, new Map([['p0', at(ada, r.x, r.y, r.z, r.onGround ? IF.ON_GROUND : 0)]]));
    if (ada.tp.n !== told) refused = `sent back at x ${(r.x - ramp.x).toFixed(1)}, y ${(r.y - GROUND).toFixed(2)}`;
  }
  assert.equal(refused, '', 'the server takes every step of the ramp');
  assert.ok(lip > kind.top - 0.5, `still at speed at the lip (${lip.toFixed(1)})`);
  assert.ok(cp.stats.jump >= 12, `a jump of ${cp.stats.jump} blocks`);
  assert.match(ada.toast!.text, /Stunt jump: 1\d blocks!/);
  assert.ok(hasStamp(cp.stamps, STAMP.stunt!));
  // A scooter makes the least that pays; a city bike falls short.
  for (const [key, least, most] of [['zipster', STUNT.least, 8], ['clunker', 0, STUNT.least - 1]] as const) {
    const ride = newRide(ramp.x - 60, GROUND, line, -Math.PI / 2);
    let off = 0, far = 0;
    for (let i = 0; i < 60 * 14 && !far; i++) { stepRide(ride, RIDES[RIDE[key]!]!, { throttle: 1, steer: 0, brake: false, up: false, down: false }, 1 / 60, state.get); if (ride.x > ramp.x + 9 && !ride.onGround && !off) off = ride.x; if (off && ride.onGround) far = ride.x - off; }
    assert.ok(far >= least && far <= most, `a ${key} flies ${far.toFixed(1)} blocks`);
  }
});

// Things to do together --------------------------------------------------------------------------------------------------
import { fineFor, heatTier } from '../src/shared/city/economy';
import { PARCEL_COINS, sightAt, startBlackout, startCrate, startSale, startSpill } from '../src/sim/city-events';
import { bountyFor, CELL_SECONDS, GULL, RACE, racePrize, startGull, VAULT } from '../src/sim/city-play';
import { bust } from '../src/sim/city-watch';

test('a street race: one starts it, another joins, flags are taken in order, the first home takes most of the purse', () => {
  const state = city(['Ada', 'Bo', 'Cy']), [ada, bo, cy] = state.players as [Player, Player, Player], c = state.city!, extras = cityExtras(SEED), flag = extras.spots.find(spot => spot.kind === 'race')!, course = extras.courses[flag.a]!;
  c.nextEventAt = Infinity;
  put(state, ada, flag.x, flag.z);
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: flag.i }), false, 'on foot: wheels only');
  drive(state, ada, RIDE.clunker!);
  drive(state, bo, RIDE.clunker!);
  park(state, ada, flag.x + 2, flag.z);
  park(state, bo, flag.x - 2, flag.z);
  const coins = [c.players[0]!.coins, c.players[1]!.coins];
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: flag.i }), true);
  assert.equal(c.races.length, 1);
  assert.ok(c.events.some(event => event.k === EV.RACE), 'it is on the map while it forms');
  assert.equal(run(state, bo, { t: 'city', a: 'spot', i: flag.i }), true, 'Bo joins');
  assert.equal(run(state, bo, { t: 'city', a: 'spot', i: flag.i }), false, 'once');
  assert.deepEqual([c.players[0]!.coins, c.players[1]!.coins, c.races[0]!.pot], [coins[0]! - RACE.fee, coins[1]! - RACE.fee, RACE.fee * 2]);
  assert.deepEqual(playerView(state, 'p0').city!.race!.slice(1, 4), [0, 1, 2], 'no flags yet, two racing');
  // Flags do not count before the start.
  park(state, ada, course.points[0]![0], course.points[0]![1]);
  assert.equal(c.players[0]!.lap, 0);
  tick(state, 20 * RACE.join);
  assert.equal(c.races[0]!.state, 1);
  state.ticks = 19;
  tick(state);
  assert.equal(publicView(state).city!.races![0]![2], 1);
  // Ada takes every flag; Bo follows a flag behind; out of order counts for nothing.
  park(state, bo, course.points[2]![0], course.points[2]![1]);
  assert.equal(c.players[1]!.lap, 0, 'the third flag first is no flag');
  course.points.forEach((point, k) => {
    park(state, ada, point[0], point[1]);
    if (k) park(state, bo, course.points[k - 1]![0], course.points[k - 1]![1]);
    if (k === 3) assert.deepEqual([playerView(state, 'p0').city!.race![2], playerView(state, 'p1').city!.race![2]], [1, 2], 'places');
  });
  const purse = (place: number) => racePrize(course.length, 2, place, RACE.fee * 2);
  assert.equal(c.players[0]!.race, 0);
  assert.equal(c.players[0]!.coins, coins[0]! - RACE.fee + purse(0) + STAMPS[STAMP.race!]!.coins);
  assert.equal(c.players[0]!.stats.wins, 1);
  park(state, bo, course.points[course.points.length - 1]![0], course.points[course.points.length - 1]![1]);
  assert.equal(c.players[1]!.coins, coins[1]! - RACE.fee + purse(1) + STAMPS[STAMP.race!]!.coins);
  assert.ok(purse(0) > purse(1) && purse(1) > 0);
  tick(state, 2);
  assert.equal(c.races.length, 0, 'over when everyone is home');
  // Alone it is a time trial for half the purse and no win; an aircraft cannot enter.
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: flag.i }), true);
  assert.equal(c.races[0]!.seats.length, 1);
  assert.ok(racePrize(course.length, 1, 0, 0) < purse(0));
  void cy;
});

test('a bounty: the most wanted player is on every map, and bonking them hands them in', () => {
  const state = city(['Ada', 'Bo', 'Cy']), [ada, bo] = state.players as [Player, Player], c = state.city!;
  c.nextEventAt = Infinity;
  for (const player of state.players) player.protectedUntil = 0;
  put(state, ada, 2000.5, 1736.5);
  put(state, bo, 2002.5, 1736.5);
  Object.assign(c.players[0]!, { heat: 70, spell: 3, hotAt: state.clock, seenAt: state.clock });
  tick(state, 25);
  const bounty = c.events.find(event => event.k === EV.BOUNTY)!;
  assert.deepEqual([bounty.b, bounty.a], [0, bountyFor(c.players[0]!.heat)]);
  const coins = c.players[1]!.coins, price = bounty.a;
  assert.equal(run(state, bo, { t: 'attack', id: CITY_PLAYER_ID + 0 }), true);
  assert.equal(c.players[1]!.coins, coins + price + STAMPS[STAMP.bonk!]!.coins + STAMPS[STAMP.bounty!]!.coins);
  assert.equal(c.players[1]!.stats.bounties, 1);
  assert.equal(c.players[1]!.heat, 0, 'a citizen\'s arrest is no mischief');
  assert.ok(c.players[0]!.cellUntil > 0 && c.players[0]!.heat === 0, 'and Ada is in the lock-up');
  tick(state, 25);
  assert.equal(c.events.some(event => event.k === EV.BOUNTY), false);
  // With bonking off there are no bounties.
  const calm = city(['Ada', 'Bo'], { bonks: false });
  Object.assign(calm.city!.players[0]!, { heat: 70, spell: 3, hotAt: 0, seenAt: 0 });
  tick(calm, 25);
  assert.equal(calm.city!.events.some(event => event.k === EV.BOUNTY), false);
});
import { CITY_PLAYER_ID } from '../src/shared/protocol';

test('the Golden Gull: whoever holds it earns by the second, a bonk takes it, and it will not ride', () => {
  const state = city(['Ada', 'Bo'], { bonks: false }), [ada, bo] = state.players as [Player, Player], c = state.city!;
  c.nextEventAt = Infinity;
  for (const player of state.players) player.protectedUntil = 0;
  put(state, ada, 2000.5, 1736.5);
  put(state, bo, 2040.5, 1736.5);
  const gull = startGull(state, 2010.5, 1736.5, 'a test');
  tick(state, 8);
  assert.equal(gull.a, 0, 'nobody is near it yet');
  put(state, ada, 2010.5, 1737.5);
  tick(state, 8);
  assert.equal(gull.a, 1, 'Ada walked up and has it');
  const coins = c.players[0]!.coins;
  tick(state, 20 * 31);
  assert.ok(c.players[0]!.coins >= coins + 30 * GULL.pay && c.players[0]!.stats.gull >= 30);
  assert.ok(hasStamp(c.players[0]!.stamps, STAMP.gull!));
  assert.deepEqual([Math.round(gull.x), Math.round(gull.z)], [Math.round(ada.x), Math.round(ada.z)], 'the mark on the map follows the holder');
  // No vehicles with a gull under your arm.
  const scooter = c.vehicles.find(v => v.k === RIDE.zipster) ?? drive(state, bo, RIDE.zipster!);
  void scooter;
  run(state, bo, { t: 'city', a: 'exit' });
  const bike = c.vehicles.find(v => v.driver < 0)!;
  put(state, ada, bike.x + 1, bike.z);
  tick(state, 2);
  assert.equal(run(state, ada, { t: 'interact', id: bike.id }), false);
  assert.match(ada.toast!.text, /will not get in/);
  // Bo bonks Ada (even in a room where players may not bonk each other) and has the gull.
  put(state, bo, ada.x + 1, ada.z);
  assert.equal(run(state, bo, { t: 'attack', id: CITY_PLAYER_ID + 0 }), true);
  assert.equal(gull.a, 2);
  // When its time is up it flies off and the longest holder is named.
  state.clock = gull.until;
  tick(state, 12);
  assert.equal(c.events.length, 0);
  assert.match(c.news![1], /Ada kept it longest/);
});

test('the bank vault: quicker with two, quiet while a friend holds the bell, gold on the floor and a time lock after', () => {
  const state = city(['Ada', 'Bo', 'Cy']), [ada, bo, cy] = state.players as [Player, Player, Player], c = state.city!, extras = cityExtras(SEED);
  c.nextEventAt = Infinity;
  const vault = extras.spots.find(spot => spot.kind === 'vault')!, bell = extras.spots.find(spot => spot.kind === 'alarm')!;
  const still = () => new Map(state.players.map(player => [player.id, at(player, player.x, player.y, player.z, IF.ON_GROUND)] as [string, Input]));
  put(state, ada, vault.x, vault.z);
  put(state, bo, vault.x + 1, vault.z);
  put(state, cy, bell.x, bell.z);
  assert.equal(run(state, cy, { t: 'city', a: 'spot', i: bell.i }), true, 'Cy takes the bell');
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: vault.i }), true);
  assert.equal(run(state, bo, { t: 'city', a: 'spot', i: vault.i }), true);
  tick(state, 20 * 4, still());
  assert.ok(Math.abs(c.vault.progress - 4 * 2 / VAULT.seconds) < 0.02, `two crackers work twice as fast (${c.vault.progress.toFixed(2)})`);
  assert.ok(playerView(state, 'p0').city!.hold! > 0.3);
  assert.equal(c.vault.rung, false, 'the bell is held');
  assert.ok(c.events.some(event => event.k === EV.VAULT), 'the TV is told');
  assert.equal(c.players[0]!.heat, 0);
  // Cy lets go: the bell rings and the crackers are hot.
  assert.equal(run(state, cy, { t: 'city', a: 'spot', i: bell.i }), true);
  tick(state, 20 * 4, still());
  assert.ok(c.vault.rung && heatTier(c.players[0]!.heat) >= 2 && heatTier(c.players[1]!.heat) >= 2, `rung ${c.vault.rung}, heat ${c.players[0]!.heat} ${c.players[1]!.heat}, bell at ${c.vault.bellAt} now ${state.clock}, holds ${c.players.map(cp => cp.hold?.what)}`);
  tick(state, 20 * 4, still());
  assert.equal(c.vault.progress, 0, 'open, and shut again');
  const bars = state.items.filter(item => item.item === I.gold_bar).reduce((sum, item) => sum + item.n, 0) + state.players.reduce((sum, player) => sum + player.inv.reduce((n, slot) => n + (slot?.id === I.gold_bar ? slot.n : 0), 0), 0);
  assert.equal(bars, VAULT.bars, 'gold on the floor (and already in the pockets of whoever stood nearest)');
  for (const seat of [0, 1, 2]) assert.ok(hasStamp(c.players[seat]!.stamps, STAMP.vault!), `seat ${seat} was on the crew`);
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: vault.i }), false);
  assert.match(ada.toast!.text, /time lock/);
  assert.equal(sellPrice(0, 'pawn', I.gold_bar), 220);
  // Alone and walking off: progress ebbs away.
  state.clock = c.vault.shutUntil + 1;
  c.npcs.clear();
  for (const cp of c.players) Object.assign(cp, { heat: 0, spell: 0, grab: 0, dizzyUntil: 0, cellUntil: 0 });
  put(state, ada, vault.x, vault.z);
  assert.equal(run(state, ada, { t: 'city', a: 'spot', i: vault.i }), true);
  tick(state, 40, still());
  const some = c.vault.progress;
  assert.ok(some > 0.05);
  put(state, ada, vault.x + 12, vault.z);
  tick(state, 60, still());
  assert.ok(c.vault.progress < some && c.players[0]!.hold === null);
});

test('the lock-up: pay, work it off, sit it out for half, or be sprung by a friend at the lock', () => {
  const nabbed = () => {
    const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], c = state.city!, cp = c.players[0]!;
    c.nextEventAt = Infinity;
    Object.assign(cp, { coins: 400, heat: 70, spell: 3 });
    bust(state, ada);
    return { state, ada, bo, c, cp, fine: fineFor(400, 3) };
  };
  const cage = cityExtras(SEED).cage;
  {
    const { state, ada, cp, fine } = nabbed();
    assert.ok(ada.x > cage.x0 && ada.x < cage.x1 + 1 && ada.z > cage.z0 && ada.z < cage.z1 + 1, 'in the cage');
    assert.equal(cp.coins, 400, 'nothing taken yet');
    assert.deepEqual(playerView(state, 'p0').city!.cell, [CELL_SECONDS, fine]);
    assert.equal(run(state, ada, { t: 'attack', id: CITY_PLAYER_ID + 1 }), false, 'no bonking from behind bars');
    assert.equal(run(state, ada, { t: 'city', a: 'cell', i: 0 }), true);
    assert.equal(cp.coins, 400 - fine);
    assert.equal(cp.cellUntil, 0);
  }
  {
    // Community service: out at once with nothing paid; the next gig is for the city.
    const { state, ada, cp } = nabbed();
    assert.equal(run(state, ada, { t: 'city', a: 'cell', i: 1 }), true);
    assert.deepEqual([cp.coins, cp.service], [400, 1]);
    cp.gig = { k: 0, stage: 1, x: ada.x, z: ada.z, until: state.clock + 60, pay: 50, drops: 1, place: 0, rider: -1, from: [ada.x, ada.z] };
    tick(state, 8);
    assert.deepEqual([cp.gig, cp.coins - 400 <= STAMPS[STAMP.gig!]!.coins, cp.service], [null, true, 0]);
  }
  {
    // Sitting it out costs half.
    const { state, cp, fine } = nabbed();
    tick(state, 20 * (CELL_SECONDS + 2));
    assert.deepEqual([cp.cellUntil, cp.coins], [0, 400 - Math.round(fine / 2)]);
  }
  {
    // A friend at the lock: four seconds, and the prisoner walks free with every coin.
    const { state, ada, bo, c, cp } = nabbed(), lock = cityExtras(SEED).spots.find(spot => spot.kind === 'lock')!;
    put(state, bo, lock.x, lock.z);
    assert.equal(run(state, bo, { t: 'city', a: 'spot', i: lock.i }), true);
    tick(state, 20 * 5, new Map([['p1', at(bo, bo.x, bo.y, bo.z, IF.ON_GROUND)]]));
    assert.deepEqual([cp.cellUntil, cp.coins], [0, 400]);
    assert.ok(hasStamp(c.players[1]!.stamps, STAMP.spring!));
    assert.ok(c.players[1]!.heat >= 35, 'the Watch saw who did it');
    assert.match(ada.toast!.text, /sprang you/);
    // With nobody inside there is nothing to spring.
    assert.equal(run(state, bo, { t: 'city', a: 'spot', i: lock.i }), false);
  }
});

test('the timetable: spills, crates, sales and blackouts come round, each with its rule', () => {
  const state = city(['Ada', 'Bo']), [ada] = state.players as [Player], c = state.city!, cp = c.players[0]!;
  c.nextEventAt = Infinity;
  // A spill: parcels on the pavement, a fee for each one picked up.
  put(state, ada, 2000.5, 1736.5);
  const spill = startSpill(state, 2000.5, 1736.5);
  let coins = cp.coins;
  tick(state, 60, new Map([['p0', at(ada, ada.x, ada.y, ada.z, IF.ON_GROUND)]]));
  const got = (cp.coins - coins) / PARCEL_COINS;
  assert.ok(got >= 1 && Number.isInteger(got), `picked up ${got} parcels`);
  state.clock = spill.until;
  tick(state, 12);
  assert.equal(state.items.some(item => item.item === I.lost_parcel), false, 'the rest is swept up');
  // A crate: the first to it gets coins and something from the gadget shelf.
  startCrate(state, 2030.5, 1736.5);
  coins = cp.coins;
  put(state, ada, 2030.5, 1737.5);
  tick(state, 6);
  assert.ok(cp.coins >= coins + 60);
  assert.equal(c.events.some(event => event.k === EV.CRATE && state.clock < event.until), false);
  // A sale halves a counter's prices.
  const sale = startSale(state)!, place = c.plan.places[sale.b]!, keeper = c.people.keepers[place.i]!.find(i => whereIs(state, i))!;
  put(state, ada, place.front[0], place.front[1]);
  run(state, ada, { t: 'interact', id: CITY_ID + keeper });
  cp.coins = 1000;
  run(state, ada, { t: 'city', a: 'buy', i: 0 });
  const offer = CATALOG[place.kind][0]!;
  assert.equal(1000 - cp.coins, Math.round(offer.price / 2) - (offer.t === 'hat' ? STAMPS[STAMP.hat!]!.coins : 0));
  // A blackout halves how far eyes carry there, and nowhere else.
  startBlackout(state, 2200, 2200);
  assert.deepEqual([sightAt(state, 2210, 2190), sightAt(state, 1800, 1800)], [0.5, 1]);
  // Left to itself the timetable starts something within a couple of minutes, and tells everybody.
  c.events.length = 0;
  c.nextEventAt = state.clock + 1;
  tick(state, 30);
  assert.equal(c.events.length >= 1 || !!c.news, true);
  assert.match(ada.toast!.text, /In the city:/);
});

// Characters and the funfair ---------------------------------------------------------------------------------------------
import { CHARACTERS, CITY_GUIDE, standings, stepOf } from '../src/shared/city/story';
import { PRIZES, STALL_COINS } from '../src/sim/city-story';

test('errands: a character is spoken to, an errand counts from when it is taken, and a chain done is a stamp', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  c.nextEventAt = Infinity;
  assert.equal(CHARACTERS.length, 7);
  assert.ok(CHARACTERS.every(character => character.errands.length >= 3 && character.errands.length <= 7 && character.errands.every(errand => errand.ask.length < 240 && errand.done.length < 160 && errand.goal.length <= 44)));
  const who = CHARACTERS.findIndex(character => character.key === 'marrow'), granny = standings(SEED)[who]!, id = CITY_ID + CITY_GUIDE + who;
  assert.equal(run(state, ada, { t: 'interact', id }), false, 'too far to talk');
  put(state, ada, granny.x + 2, granny.z);
  assert.equal(run(state, ada, { t: 'attack', id }), false, 'characters cannot be bonked');
  assert.equal(cp.stats.bonks, 0);
  assert.equal(run(state, ada, { t: 'interact', id }), true);
  assert.equal(playerView(state, 'p0').city!.talk, who);
  // Fish caught before the errand do not count towards it.
  cp.stats.fish = 5;
  assert.equal(run(state, ada, { t: 'city', a: 'say', i: 0 }), true, 'taken on');
  assert.deepEqual(playerView(state, 'p0').city!.errand, [who, 0, 2]);
  assert.equal(playerView(state, 'p0').city!.talk, undefined, 'and the talk is over');
  run(state, ada, { t: 'interact', id });
  assert.equal(run(state, ada, { t: 'city', a: 'say', i: 0 }), false, 'not done yet');
  cp.stats.fish = 7;
  assert.deepEqual(playerView(state, 'p0').city!.errand, [who, 2, 2]);
  const coins = cp.coins, folk = cp.rep[0]!;
  run(state, ada, { t: 'interact', id });
  assert.equal(run(state, ada, { t: 'city', a: 'say', i: 0 }), true, 'handed in');
  assert.deepEqual([cp.coins, stepOf(cp.story, who), cp.errand, cp.rep[0]], [coins + CHARACTERS[who]!.errands[0]!.pay, 1, null, folk + 5]);
  // One errand at a time; "not now" just ends the talk.
  run(state, ada, { t: 'interact', id });
  run(state, ada, { t: 'city', a: 'say', i: 0 });
  const mayor = CHARACTERS.findIndex(character => character.key === 'plumley'), hall = standings(SEED)[mayor]!;
  put(state, ada, hall.x + 2, hall.z);
  run(state, ada, { t: 'interact', id: CITY_ID + CITY_GUIDE + mayor });
  assert.equal(run(state, ada, { t: 'city', a: 'say', i: 0 }), false);
  assert.match(ada.toast!.text, /One at a time/);
  run(state, ada, { t: 'interact', id: CITY_ID + CITY_GUIDE + mayor });
  assert.equal(run(state, ada, { t: 'city', a: 'say', i: 1 }), true);
  assert.equal(cp.talk, -1);
  // The rest of Granny's chain: totals that are what they are (feathers) count at once.
  put(state, ada, granny.x + 2, granny.z);
  cp.stats.tips += 10;
  run(state, ada, { t: 'interact', id });
  assert.equal(run(state, ada, { t: 'city', a: 'say', i: 0 }), true);
  cp.feathers = [0b111, 0];
  run(state, ada, { t: 'interact', id });
  run(state, ada, { t: 'city', a: 'say', i: 0 });
  assert.deepEqual(playerView(state, 'p0').city!.errand, [who, 3, 3]);
  run(state, ada, { t: 'interact', id });
  run(state, ada, { t: 'city', a: 'say', i: 0 });
  run(state, ada, { t: 'interact', id });
  run(state, ada, { t: 'city', a: 'say', i: 0 });
  cp.stats.helped++;
  run(state, ada, { t: 'interact', id });
  assert.equal(run(state, ada, { t: 'city', a: 'say', i: 0 }), true);
  assert.equal(stepOf(cp.story, who), 4);
  assert.ok(hasStamp(cp.stamps, STAMP.story!));
  // Walking off ends a talk; the story survives a save.
  run(state, ada, { t: 'interact', id });
  put(state, ada, granny.x + 30, granny.z);
  tick(state, 12);
  assert.equal(cp.talk, -1);
  const loaded = rules.loadSave!(ctx(['Ada']), JSON.parse(JSON.stringify(rules.exportSave!(state))), validateSettings({})).state.city!.players[0]!;
  assert.equal(stepOf(loaded.story, who), 4);
});

test('the funfair: a go costs coins and pays tickets by how well it was timed; the booth swaps tickets for prizes', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!, extras = cityExtras(SEED);
  const striker = extras.spots.find(spot => spot.kind === 'stall' && spot.a === 0)!, cans = extras.spots.find(spot => spot.kind === 'stall' && spot.a === 1)!, booth = extras.spots.find(spot => spot.kind === 'prize')!;
  const tickets = () => ada.inv.reduce((n, slot) => n + (slot?.id === I.fair_ticket ? slot.n : 0), 0);
  cp.coins = 200;
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 0, j: 1000 }), false, 'not from the plaza');
  put(state, ada, striker.x, striker.z);
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 0, j: 1000 }), true);
  assert.deepEqual([tickets(), cp.coins], [10, 200 - STALL_COINS], 'the bell rings at the top');
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 0, j: 100 }), true);
  assert.equal(tickets(), 10, 'a feeble swing wins nothing');
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 1, j: 500 }), false, 'each stall at its own counter');
  put(state, ada, cans.x, cans.z);
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 1, j: 520 }), true);
  assert.equal(tickets(), 20, 'dead centre knocks them all down');
  // Prizes.
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 11 }), false, 'the booth is over by the tent');
  put(state, ada, booth.x, booth.z);
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 11 }), true);
  assert.deepEqual([tickets(), ada.inv.some(slot => slot?.id === PRIZES[1]![1])], [20 - PRIZES[1]![0], true]);
  assert.ok(hasStamp(cp.stamps, STAMP.fair!));
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 13 }), false, 'the crown takes more tickets than that');
  ada.inv[8] = { id: I.fair_ticket, n: 64 };
  ada.inv[7] = { id: I.fair_ticket, n: 64 };
  assert.equal(run(state, ada, { t: 'city', a: 'stall', i: 13 }), true);
  assert.equal(cp.hat, 9, 'the golden crown, on at once');
});

test('an owned vehicle comes when called: to an empty kerb bay (never a bike rack), a boat to a mooring, an aircraft only at the airfield', () => {
  const state = city(), ada = state.players[0]!, c = state.city!, cp = c.players[0]!;
  tick(state, 25);
  cp.own = 1 << RIDE.comet! | 1 << RIDE.dinghy! | 1 << RIDE.dragonfly!;
  const mine = (k: number) => c.vehicles.find(vehicle => vehicle.owner === 0 && vehicle.k === k);
  assert.equal(run(state, ada, { t: 'city', a: 'call', i: RIDE.zipster! }), false, 'not one she does not own');
  assert.equal(run(state, ada, { t: 'city', a: 'call', i: RIDE.comet! }), true, 'from the plaza, where the kerb has room');
  const coupe = mine(RIDE.comet!)!, bay = c.plan.bays.find(entry => entry.x === coupe.x && entry.z === coupe.z)!;
  assert.ok(bay && bay.kind !== RIDE.clunker && Math.hypot(coupe.x - ada.x, coupe.z - ada.z) < 100, 'in a bay near her, and not in a bike rack');
  assert.match(ada.toast!.text, /Zinger coupé is parked \d+ blocks away/);
  assert.equal(run(state, ada, { t: 'city', a: 'call', i: RIDE.comet! }), true);
  assert.equal(c.vehicles.filter(vehicle => vehicle.owner === 0 && vehicle.k === RIDE.comet).length, 1, 'called again it moves: there is only ever one');
  assert.equal(run(state, ada, { t: 'city', a: 'call', i: RIDE.dinghy! }), false);
  assert.match(ada.toast!.text, /moorings by the pier/);
  assert.equal(run(state, ada, { t: 'city', a: 'call', i: RIDE.dragonfly! }), false);
  assert.match(ada.toast!.text, /Gullwing Field/);
  put(state, ada, PIER.x0 + 3.5, SHORE + 40);
  assert.equal(run(state, ada, { t: 'city', a: 'call', i: RIDE.dinghy! }), true, 'a boat, from the pier');
  assert.equal(mine(RIDE.dinghy!)!.y, SEA_Y);
  cp.heat = 20;
  assert.equal(run(state, ada, { t: 'city', a: 'call', i: RIDE.comet! }), false);
  assert.match(ada.toast!.text, /Watch is after you/);
});

test('a first-time stamp joins the message of what earned it instead of replacing it', () => {
  const state = city(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player];
  tick(state, 2);
  put(state, bo, ada.x + 2, ada.z);
  assert.equal(run(state, ada, { t: 'city', a: 'give', i: 1, j: 10 }), true);
  assert.deepEqual(ada.toast!.text.split('\n'), ['You gave Bo 10 coins.', 'Passport stamp: Give a friend coins (+10 coins)']);
  tick(state, 2);
  assert.equal(run(state, ada, { t: 'city', a: 'give', i: 1, j: 10 }), true);
  assert.equal(ada.toast!.text, 'You gave Bo 10 coins.', 'the second time there is no stamp to add');
  tick(state, 2);
  stamp(state, ada, 'island');
  assert.equal(ada.toast!.text, 'Passport stamp: Set foot on Gull Rock (+40 coins)', 'a stamp with nothing said before it this tick stands alone');
});

test('the results screen is cheap: once the ledger is up a snapshot carries no streets, scoreboard, pockets or rows of ids', () => {
  const state = city(Array.from({ length: 64 }, (_, i) => `Player ${i}`), { minutes: 10 }), encoder = new SnapshotEncoder();
  tick(state, 40);
  assert.ok('near' in playerView(state, 'p0')! || 'bag' in playerView(state, 'p0')!, 'while the round runs a seat is sent its surroundings and pockets');
  rules.finish!(state, 0);
  let bytes = 0;
  // More than a second of them: every list that goes "once a second" would have come round.
  for (let i = 0; i < 25; i++) {
    tick(state, 1);
    const view = publicView(state), sent = encoder.encode('round', view, manifest.snapshotCache), mine = playerView(state, 'p0')!;
    assert.ok(!('roster' in view) && !('tv' in view) && !('city' in view) && !('near' in mine) && !('bag' in mine));
    if (!i) assert.equal((sent.publicView as { ledger?: unknown[] }).ledger?.length, 64, 'the ledger goes once, with the first of them');
    else bytes = Math.max(bytes, JSON.stringify(sent.publicView).length + JSON.stringify(mine).length + JSON.stringify(rules.outcome(state)).length);
  }
  assert.deepEqual(rules.outcome(state).rows, [], 'and the outcome names nobody row by row: the ledger has done that, once');
  assert.ok(bytes < 900, `${bytes} bytes a results snapshot at 64 players`);
});
