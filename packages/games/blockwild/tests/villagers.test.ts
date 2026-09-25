/** Villagers (DESIGN.md): spawning per bed, day/night routine, fleeing, zombies hunting them, trades, restock and saves. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, DOOR_OPEN, DOOR_UPPER, makeCell } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { chunkKey, localIndex, type Vec3 } from '../src/shared/coords';
import { countItem } from '../src/shared/inventory';
import { I, itemOf } from '../src/shared/items';
import { IF, MOB, validateSettings, type CmdBody, type Input, type Settings } from '../src/shared/protocol';
import type { Village } from '../src/shared/structures/index';
import { offersFor, PROFESSIONS } from '../src/shared/trades';
import { createState, saveSource, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import { exportSave, parseSave } from '../src/sim/save';
import type { Mob, State } from '../src/sim/state';
import { playerView } from '../src/sim/views';
import { restock, spawnVillagers, thinkVillager } from '../src/sim/villagers';
import { writeCell } from '../src/sim/world';

const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
const X = 2048, Z = 2048;
function game(settings: Partial<Settings> = {}): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11, difficulty: 'peaceful', ...settings }), { source: flat, spawn: [X, 64, Z] });
  state.players[0]!.protectedUntil = 0;
  // Only the synthetic villages below populate: mark the neighbourhood as already rolled.
  for (let cz = 120; cz < 136; cz++) for (let cx = 120; cx < 136; cx++) state.animalChunks.add(chunkKey(cx, cz));
  return state;
}
const input = (state: State, cmds: CmdBody[] = []): Map<string, Input> => {
  const p = state.players[0]!;
  return new Map([['p0', { p: [p.x, p.y, p.z], v: [0, 0, 0], yaw: 0, pitch: 0, f: IF.ON_GROUND, slot: 0, mine: null, tpAck: p.tp.n, cmds: cmds.map((c, i) => ({ n: p.ack + 1 + i, ...c }) as Input['cmds'][number]) }]]);
};
const send = (state: State, cmds: CmdBody[]) => tickState(state, input(state, cmds), 0.05);
function run(state: State, seconds: number, each?: () => void) {
  for (let i = 0; i < seconds * 20; i++) { tickState(state, input(state), 0.05); each?.(); }
}
const house = (bed: Vec3): Village['houses'][number] => ({ bed, bounds: [bed[0] - 2, bed[1] - 1, bed[2] - 2, bed[0] + 2, bed[1] + 4, bed[2] + 2] });
const village = (beds: Vec3[], center: Vec3 = [X, 64, Z]): Village => ({ center, houses: beds.map(house), bounds: [center[0] - 40, 50, center[2] - 40, center[0] + 40, 90, center[2] + 40] });
const villagers = (state: State) => state.mobs.filter(m => m.t === MOB.villager && m.health > 0);
/** A villager standing at (x, z) with the given profession and seed. */
function villagerAt(state: State, x: number, z: number, p = 0, seed = 1): Mob {
  const mob = Object.assign(newMob(state, MOB.villager, x + 0.5, 64, z + 0.5), { p, seed });
  state.mobs.push(mob);
  return mob;
}

test('a village spawns one villager per bed in the populated chunk, deterministically and capped at 64', () => {
  const state = game(), beds: Vec3[] = [[X + 3, 64, Z + 3], [X + 9, 64, Z + 2], [X + 20, 64, Z]], v = village(beds);
  spawnVillagers(state, X >> 4, Z >> 4, [v]);
  assert.deepEqual(villagers(state).map(m => m.home), beds.slice(0, 2), 'only beds in this chunk');
  for (const mob of villagers(state)) {
    assert.ok(mob.p >= 0 && mob.p < PROFESSIONS.length && Number.isInteger(mob.seed) && mob.seed >= 0 && mob.seed < 2 ** 31);
    assert.ok(Math.hypot(mob.x - mob.home![0] - 0.5, mob.z - mob.home![2] - 0.5) < 2 && mob.y === 64, 'stands beside its bed');
  }
  spawnVillagers(state, X >> 4, Z >> 4, [v]);
  assert.equal(villagers(state).length, 2, 'a bed never gets a second villager');
  spawnVillagers(state, (X + 20) >> 4, Z >> 4, [v]);
  assert.equal(villagers(state).length, 3);
  const again = game();
  spawnVillagers(again, X >> 4, Z >> 4, [v]);
  assert.deepEqual(villagers(again).map(m => [m.p, m.seed]), villagers(state).slice(0, 2).map(m => [m.p, m.seed]), 'same world, same villagers');
  // The save cap.
  const full = game();
  for (let i = 0; i < 64; i++) villagerAt(full, X + (i % 8), Z + Math.floor(i / 8));
  spawnVillagers(full, X >> 4, Z >> 4, [v]);
  assert.equal(villagers(full).length, 64);
});

test('villagers go home at night, stroll the village by day and look at players', () => {
  const state = game(), home: Vec3 = [X + 12, 64, Z + 4];
  spawnVillagers(state, X >> 4, Z >> 4, [village([home])]);
  const mob = villagers(state)[0]!;
  Object.assign(mob, { x: X - 9.5, z: Z - 6.5 });
  state.time = 13000;
  run(state, 30);
  assert.ok(Math.hypot(mob.x - home[0] - 0.5, mob.z - home[2] - 0.5) < 2, `home at night (${mob.x}, ${mob.z})`);
  const at = [mob.x, mob.z];
  run(state, 5);
  assert.ok(Math.hypot(mob.x - at[0]!, mob.z - at[1]!) < 0.5, 'stays indoors');

  state.time = 1000;
  let far = 0, travelled = 0, last = [mob.x, mob.z];
  run(state, 90, () => {
    far = Math.max(far, Math.hypot(mob.x - X, mob.z - Z));
    travelled += Math.hypot(mob.x - last[0]!, mob.z - last[1]!);
    last = [mob.x, mob.z];
  });
  assert.ok(travelled > 8, `wanders by day (${travelled.toFixed(1)} m)`);
  assert.ok(far <= 34, `within the village (${far.toFixed(1)})`);
  // Walked out too far: it heads back to the well.
  Object.assign(mob, { x: X + 40.5, z: Z + 0.5, path: null });
  run(state, 15);
  assert.ok(mob.x < X + 36, `returns towards the centre (${mob.x})`);

  // Idle with a player close by: it turns to face them.
  const player = state.players[0]!, watcher = villagerAt(state, X + 3, Z);
  watcher.thinkAt = Infinity;
  thinkVillager(state, watcher, 0.05);
  assert.ok(Math.abs(watcher.yaw - Math.atan2(-(player.x - watcher.x), -(player.z - watcher.z))) < 1e-9);
});

test('villagers step from a dirt path over a door sill and under the lintel to reach their bed', () => {
  // A cobblestone hut (inside x 1–3, z 1–3, floor top 64, lintel at 66) with an open door in its north wall, reached by a
  // 15/16-tall dirt path: the sill is a 1/16 step and a 1.95-tall villager has only 0.05 of headroom under the lintel.
  const state = game(), put = (x: number, y: number, z: number, cell: number) => writeCell(state, X + x, y, Z + z, cell);
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) for (let y = 63; y <= 66; y++) {
    put(x, y, z, y === 63 || y === 66 || x === 0 || x === 4 || z === 0 || z === 4 ? B.cobblestone : B.air);
  }
  put(2, 64, 0, makeCell(B.oak_door, 2 | DOOR_OPEN));
  put(2, 65, 0, makeCell(B.oak_door, 2 | DOOR_OPEN | DOOR_UPPER));
  for (let z = -8; z < 0; z++) for (let x = 1; x <= 3; x++) put(x, 63, z, B.dirt_path);
  const mob = villagerAt(state, X + 2, Z - 7);
  Object.assign(mob, { y: 63.9375, home: [X + 2, 64, Z + 3] });
  state.time = 13000;
  run(state, 20);
  assert.ok(mob.z > Z + 1 && mob.y === 64, `indoors at night (${mob.x.toFixed(2)}, ${mob.y.toFixed(2)}, ${mob.z.toFixed(2)})`);
});

test('villagers flee monsters; zombies hunt and hit villagers', () => {
  const state = game({ difficulty: 'normal', mode: 'creative' });
  state.time = 6000;
  const mob = villagerAt(state, X + 6, Z), zombie = newMob(state, MOB.zombie, X + 2.5, 64, Z + 0.5);
  state.mobs.push(zombie);
  run(state, 3);
  assert.ok(mob.x > X + 9, `ran away (${mob.x})`);
  assert.equal(zombie.prey, mob.id, 'the zombie hunts the villager (creative players are not targets)');

  // A villager held in place by a trading player gets caught.
  const trapped = game({ difficulty: 'normal', mode: 'creative' }), victim = villagerAt(trapped, X + 2, Z), hunter = newMob(trapped, MOB.zombie, X + 5.5, 64, Z + 0.5);
  trapped.mobs.push(hunter);
  send(trapped, [{ t: 'interact', id: victim.id }]);
  run(trapped, 6);
  assert.ok(victim.health < 20, `bitten (${victim.health})`);
});

test('offers: 3–5 per villager from the profession table, emerald-priced, deterministic, one rare diamond deal at most', () => {
  const diamondGear = (id: number) => itemOf(id)?.key.startsWith('diamond_') ?? false;
  for (let p = 0; p < PROFESSIONS.length; p++) {
    let rare = 0;
    for (let seed = 0; seed < 300; seed++) {
      const offers = offersFor(p, seed * 7919);
      assert.deepEqual(offersFor(p, seed * 7919), offers);
      assert.ok(offers.length >= 3 && offers.length <= 5, `${PROFESSIONS[p]} offers`);
      assert.equal(offers[0]!.sell.id, I.emerald, 'every villager has a way to earn emeralds');
      for (const offer of offers) {
        assert.ok((offer.buy.id === I.emerald) !== (offer.sell.id === I.emerald), 'emeralds on exactly one side');
        assert.ok(offer.buy.n >= 1 && offer.buy.n <= 64 && offer.sell.n >= 1 && offer.max >= 1);
      }
      const diamonds = offers.filter(o => diamondGear(o.sell.id)).length;
      assert.ok(diamonds <= 1);
      rare += diamonds;
    }
    const smiths = p === 2 || p === 3;
    assert.ok(smiths ? rare > 60 && rare < 180 : rare === 0, `${PROFESSIONS[p]} rare deals: ${rare}`);
  }
  // Classic prices appear: the farmer buys 20 wheat and sells 6 bread; the armorer sells an iron chestplate for 9.
  const all = (p: number) => Array.from({ length: 200 }, (_, s) => offersFor(p, s)).flat();
  assert.ok(all(0).some(o => o.buy.id === I.wheat && o.buy.n === 20 && o.sell.n === 1));
  assert.ok(all(0).some(o => o.sell.id === I.bread && o.sell.n === 6 && o.buy.n === 1));
  assert.ok(all(2).some(o => o.sell.id === I.iron_chestplate && o.buy.n === 9));
  assert.ok(all(3).some(o => o.buyB?.id === I.diamond && o.sell.id === I.diamond_pickaxe));
});

test('trading consumes exact items, respects uses, restocks at dawn and survives a save', () => {
  const state = game(), player = state.players[0]!, mob = villagerAt(state, X + 2, Z, 0, 4242);
  const [buy] = offersFor(0, 4242), buyIndex = 0, sellIndex = offersFor(0, 4242).findIndex(o => o.buy.id === I.emerald);
  send(state, [{ t: 'interact', id: mob.id }]);
  const screen = () => playerView(state, 'p0').screen;
  assert.deepEqual([screen()?.kind, screen()?.villager, screen()?.profession, screen()?.offers?.length], ['trade', mob.id, 0, offersFor(0, 4242).length]);

  // Not enough goods: nothing happens.
  player.inv[0] = { id: buy!.buy.id, n: buy!.buy.n - 1 };
  send(state, [{ t: 'trade', i: buyIndex }]);
  assert.deepEqual([countItem(player.inv, buy!.buy.id), countItem(player.inv, I.emerald)], [buy!.buy.n - 1, 0]);
  // Once, then as often as possible (limited by the goods).
  player.inv[0] = { id: buy!.buy.id, n: buy!.buy.n * 3 + 1 };
  send(state, [{ t: 'trade', i: buyIndex }]);
  assert.deepEqual([countItem(player.inv, buy!.buy.id), countItem(player.inv, I.emerald)], [buy!.buy.n * 2 + 1, 1]);
  send(state, [{ t: 'trade', i: buyIndex, max: true }]);
  assert.deepEqual([countItem(player.inv, buy!.buy.id), countItem(player.inv, I.emerald)], [1, 3]);
  assert.equal(screen()?.offers?.[buyIndex]?.left, buy!.max - 3);
  assert.ok(state.fx.some(e => e.fx.k === 'trade'));

  // A sale whose goods would not fit changes nothing.
  const sale = offersFor(0, 4242)[sellIndex]!, saved = player.inv.map(s => s && { ...s });
  player.inv.fill({ id: B.dirt, n: 64 });
  player.inv[0] = { id: I.emerald, n: 64 };
  const before = player.inv.map(s => s && { ...s });
  send(state, [{ t: 'trade', i: sellIndex }]);
  assert.deepEqual(player.inv, before);
  player.inv.splice(0, 36, ...saved);

  // Uses run out, then the dawn restock refills them.
  for (let i = 5; i < 15; i++) player.inv[i] = { id: buy!.buy.id, n: 64 };
  send(state, [{ t: 'trade', i: buyIndex, max: true }]);
  assert.equal(screen()?.offers?.[buyIndex]?.left, 0);
  assert.equal(countItem(player.inv, I.emerald), buy!.max);
  send(state, [{ t: 'trade', i: buyIndex }]);
  assert.equal(countItem(player.inv, I.emerald), buy!.max, 'sold out');
  assert.equal(sale.buy.id, I.emerald);

  // Save and reload: profession, seed (so the same offers) and uses persist.
  const reloaded = parseSave(JSON.parse(JSON.stringify(exportSave(saveSource(state)))));
  const ctx = { roomId: 'room', roundId: 'r2', seed: 9, nowMs: 0, players: [{ id: 'q', name: 'Ada', color: '#fff' }] };
  const loaded = createState(ctx, reloaded.settings, { source: flat, save: reloaded }), back = villagers(loaded)[0]!;
  assert.deepEqual([back.p, back.seed, back.uses], [0, 4242, mob.uses]);
  assert.equal(back.uses[buyIndex], buy!.max);

  state.time = 23999.5;
  run(state, 0.05);
  assert.equal(screen()?.offers?.[buyIndex]?.left, buy!.max, 'restocked at dawn');
  restock(loaded);
  assert.deepEqual(back.uses, []);

  // The screen closes when the villager dies.
  mob.health = 0;
  run(state, 0.05);
  assert.equal(player.screen, null);
});
