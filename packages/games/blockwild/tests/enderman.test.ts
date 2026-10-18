/** Endermen and ender pearls (DESIGN.md): gaze aggro, blinking, arrow dodges, water, spawning per dimension, pearls. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, cellId } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { dimensionAt, END, NETHER } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { I } from '../src/shared/items';
import { IF, MOB, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { damageMob, killMob, spawnArrow } from '../src/sim/combat';
import { gazer, GAZE_RANGE, spawnEndermen } from '../src/sim/enderman';
import { newMob } from '../src/sim/mobs';
import { createState, tickState } from '../src/sim/game';
import { PEARL_COOLDOWN } from '../src/sim/pearls';
import type { Mob, Player, State } from '../src/sim/state';
import { writeCell } from '../src/sim/world';

/** Flat ground with its top at y 63: grass in the overworld, soul sand in the Nether, end stone in the End. */
const chunkOf = (top: number) => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : top;
  return chunk;
};
const TOPS = { overworld: chunkOf(B.grass_block), nether: chunkOf(B.soul_sand), end: chunkOf(B.end_stone) };
const flat: ChunkSource = (cx, cz) => TOPS[dimensionAt(cx * 16, cz * 16)];
const X = 2048, Z = 2048, NX = NETHER.x0 + 256, NZ = 256, EX = END.x0 + 256, EZ = END.z0 + 256;

function game(x = X, z = Z, players = 1): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#ff5748' })) };
  const state = createState(ctx, validateSettings({ seed: 11, difficulty: 'normal' }), { source: flat, spawn: [x, 64, z] });
  state.players.forEach((p, i) => Object.assign(p, { protectedUntil: 0, x: x + 0.5 + i * 3, y: 64, z: z + 0.5 }));
  // Load every chunk in reach up front: streaming is time-budgeted, so a busy machine would load fewer.
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) state.world.cache.get((x >> 4) + dx, (z >> 4) + dz);
  tickState(state, new Map(), 0.05);
  return state;
}
const run = (state: State, seconds: number, each?: () => void) => { for (let i = 0; i < Math.round(seconds * 20); i++) { tickState(state, new Map(), 0.05); each?.(); } };
const add = (state: State, t: number, x: number, y: number, z: number): Mob => {
  const mob = newMob(state, t, x, y, z);
  state.mobs.push(mob);
  return mob;
};
/** Point a player's crosshair at a world point. */
function aim(player: Player, x: number, y: number, z: number) {
  const dx = x - player.x, dy = y - (player.y + 1.62), dz = z - player.z, d = Math.hypot(dx, dy, dz);
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(dy / d);
}
const head = (mob: Mob): [number, number, number] => [mob.x, mob.y + 2.65, mob.z];
const send = (state: State, cmds: CmdBody[]) => {
  const p = state.players[0]!;
  const input: Input = { p: [p.x, p.y, p.z], v: [0, 0, 0], yaw: p.yaw, pitch: p.pitch, f: IF.ON_GROUND, slot: p.slot, mine: null, tpAck: p.tp.n, cmds: cmds.map((c, i) => ({ n: p.ack + 1 + i, ...c }) as Input['cmds'][number]) };
  tickState(state, new Map([['p0', input]]), 0.05);
};
const endermen = (state: State) => state.mobs.filter(m => m.t === MOB.enderman && m.health > 0);

test('gaze: only the head counts, within 64 blocks, with clear line of sight', () => {
  const state = game(), player = state.players[0]!, mob = add(state, MOB.enderman, X + 20.5, 64, Z + 0.5);
  aim(player, ...head(mob));
  assert.equal(gazer(state, mob), player, 'looking at the head');
  aim(player, mob.x, mob.y + 1.2, mob.z);
  assert.equal(gazer(state, mob), undefined, 'looking at the body is fine');
  aim(player, mob.x + 0.6, mob.y + 2.65, mob.z + 1);
  assert.equal(gazer(state, mob), undefined, 'just beside the head');
  aim(player, ...head(mob));
  writeCell(state, X + 10, 66, Z, B.stone);
  assert.equal(gazer(state, mob), undefined, 'a wall in between blocks the gaze');
  writeCell(state, X + 10, 66, Z, B.glass);
  assert.equal(gazer(state, mob), player, 'glass does not');
  Object.assign(mob, { x: X + GAZE_RANGE + 4.5 });
  aim(player, ...head(mob));
  assert.equal(gazer(state, mob), undefined, 'beyond 64 blocks');
  state.settings.mode = 'creative';
  Object.assign(mob, { x: X + 20.5 });
  aim(player, ...head(mob));
  assert.equal(gazer(state, mob), undefined, 'creative players are ignored');
});

test('a glance is safe; a 0.5 s stare provokes a scream, a stare-back, then blink-in attacks', () => {
  const state = game(), player = state.players[0]!, mob = add(state, MOB.enderman, X + 20.5, 64, Z + 0.5);
  const look = () => aim(player, ...head(mob));
  run(state, 0.3, look);
  aim(player, X - 20, 65, Z);
  run(state, 1);
  assert.equal(mob.target, null, 'a 0.3 s glance');
  assert.equal(player.health, 20);
  const fx0 = state.fx.length;
  run(state, 0.6, look);
  assert.equal(mob.target, 'p0', 'provoked');
  assert.ok(state.fx.slice(fx0).some(e => e.fx.k === 'scream'), 'screams');
  assert.equal(mob.a, 3, 'stares');
  aim(player, X - 20, 65, Z);
  let blinked = false;
  run(state, 6, () => { blinked ||= state.fx.some(e => e.fx.k === 'teleport'); });
  assert.ok(blinked && Math.hypot(mob.x - player.x, mob.z - player.z) < 8, 'blinked in close');
  assert.ok(player.health <= 13, 'hits hard (7)');
});

test('arrows are dodged with a blink; melee provokes; water scatters it', () => {
  const state = game(), player = state.players[0]!, mob = add(state, MOB.enderman, X + 12.5, 64, Z + 0.5);
  const [x0, z0] = [mob.x, mob.z];
  spawnArrow(state, X + 2.5, 66, Z + 0.5, 50, 0, 0, 9, 'p0', true);
  run(state, 0.3);
  assert.equal(mob.health, 40, 'no damage from the arrow');
  assert.ok(Math.hypot(mob.x - x0, mob.z - z0) >= 3, 'teleported away');
  assert.ok(!state.arrows.some(a => a.k === 0 && !a.stuck && a.age < 1 && Math.abs(a.x - x0) < 1), 'the arrow flies on');
  assert.equal(mob.target, 'p0', 'and is angry at the archer');
  assert.equal(cellId(state.get(Math.floor(mob.x), Math.ceil(mob.y) - 1, Math.floor(mob.z))) !== B.air, true, 'lands on a floor');

  const struck = add(state, MOB.enderman, X + 2.5, 64, Z + 4.5);
  damageMob(state, struck, 4, player);
  assert.ok(struck.health === 36 && struck.target === 'p0', 'a punch lands and provokes');

  const calm = game(), wet = add(calm, MOB.enderman, X + 10.5, 64, Z + 0.5);
  writeCell(calm, X + 10, 64, Z, B.water);
  run(calm, 0.1);
  assert.ok(wet.health < 40, 'water hurts');
  assert.ok(Math.floor(wet.x) !== X + 10 || Math.floor(wet.z) !== Z, 'and teleports it out');
  assert.equal(wet.target, null, 'without making it angry');
  assert.ok(calm.players[0]!.health === 20 && player.health === 20);
});

test('spawning: rare and capped on overworld nights, soul sand in the Nether, common on the End island (cap 16)', () => {
  const roll = (state: State, seconds: number) => { for (let i = 0; i < seconds; i++) spawnEndermen(state); };
  const day = game(X, Z, 4);
  day.time = 6000;
  roll(day, 300);
  assert.equal(endermen(day).length, 0, 'never by day');
  const night = game(X, Z, 4);
  night.time = 18000;
  roll(night, 20);
  const early = endermen(night).length;
  roll(night, 600);
  assert.ok(early <= 2, `rare (${early} in 20 s)`);
  assert.equal(endermen(night).length, 3, 'cap 1 + players / 2');
  for (const mob of endermen(night)) {
    assert.equal(dimensionAt(mob.x, mob.z), 'overworld');
    assert.ok(night.players.every(p => Math.hypot(p.x - mob.x, p.y - mob.y, p.z - mob.z) >= 24), 'never within 24 blocks');
  }

  const nether = game(NX, NZ);
  roll(nether, 600);
  assert.equal(endermen(nether).length, 1, 'one in a valley with one player');
  assert.equal(cellId(nether.get(Math.floor(endermen(nether)[0]!.x), 63, Math.floor(endermen(nether)[0]!.z))), B.soul_sand);

  const end = game(EX, EZ);
  roll(end, 20);
  assert.ok(endermen(end).length >= 10, `common (${endermen(end).length} in 20 s)`);
  roll(end, 60);
  assert.equal(endermen(end).length, 16, 'cap 16');
  assert.ok(endermen(end).every(mob => dimensionAt(mob.x, mob.z) === 'end'));
});

test('overworld endermen leave at dawn when nobody is near', () => {
  const state = game(), far = add(state, MOB.enderman, X + 50.5, 64, Z + 0.5), near = add(state, MOB.enderman, X + 6.5, 64, Z + 0.5);
  state.time = 1000;
  run(state, 30);
  assert.ok(far.health <= 0 && !state.mobs.includes(far), 'the far one is gone');
  assert.ok(near.health > 0, 'the near one stays');
});

test('pearls arc, teleport the thrower with fx for everyone and 5 fall damage that armor ignores', () => {
  const state = game(), player = state.players[0]!;
  player.inv[0] = { id: I.ender_pearl, n: 3 };
  player.armor = [{ id: I.diamond_helmet, n: 1 }, { id: I.diamond_chestplate, n: 1 }, { id: I.diamond_leggings, n: 1 }, { id: I.diamond_boots, n: 1 }];
  aim(player, X + 20.5, 66, Z + 0.5);
  player.pitch = 0.4;
  send(state, [{ t: 'useItem', slot: 0 }]);
  assert.equal(player.inv[0]!.n, 2, 'uses one pearl');
  const pearl = state.arrows.find(a => a.k === 5)!;
  assert.ok(pearl && pearl.vy > 0, 'thrown upward');
  let peak = 0, wentDown = false;
  for (let i = 0; i < 80 && state.arrows.includes(pearl); i++) {
    peak = Math.max(peak, pearl.y);
    run(state, 0.05);
    wentDown ||= pearl.vy < 0;
  }
  assert.ok(peak > 68 && wentDown, 'a gravity arc');
  assert.ok(!state.arrows.includes(pearl), 'landed');
  assert.ok(player.x > X + 20 && Math.abs(player.y - 64) < 0.05, `arrived on the ground (${player.x}, ${player.y})`);
  assert.equal(player.health, 15, '5 damage straight through diamond armor');
  assert.equal(player.armor[0]!.d ?? 0, 0, 'and no armor wear');
  assert.ok(state.fx.some(e => e.fx.k === 'pearl') && state.fx.filter(e => e.fx.k === 'teleport').length >= 2);
  assert.ok(player.tp.n > 1, 'the client is told to move');
});

test('pearls: a 1 s cooldown, spawn protection, the void and solid blocks', () => {
  const state = game(), player = state.players[0]!;
  player.inv[0] = { id: I.ender_pearl, n: 16 };
  player.pitch = 1.2;
  send(state, [{ t: 'useItem', slot: 0 }]);
  send(state, [{ t: 'useItem', slot: 0 }]);
  assert.equal(state.arrows.filter(a => a.k === 5).length, 1, 'cooling down');
  run(state, PEARL_COOLDOWN);
  send(state, [{ t: 'useItem', slot: 0 }]);
  assert.equal(state.arrows.filter(a => a.k === 5).length, 2, 'ready again after 1 s');

  const safe = game(), p = safe.players[0]!;
  p.protectedUntil = safe.clock + 60;
  spawnArrow(safe, X + 5.5, 66, Z + 0.5, 0, -10, 0, 0, 'p0', false, 5);
  run(safe, 0.5);
  assert.ok(Math.abs(p.x - (X + 5.5)) < 0.05 && p.health === 20, 'teleports but spawn protection blocks the damage');

  const end = game(EX, EZ), q = end.players[0]!;
  const lost = spawnArrow(end, END.x0 + 40, -60, END.z0 + 40, 0, -10, 0, 0, 'p0', false, 5);
  run(end, 1);
  assert.ok(!end.arrows.includes(lost) && Math.abs(q.x - (EX + 0.5)) < 0.05, 'void pearls just vanish');

  const box = game(), r = box.players[0]!;
  // A pearl landing in a 1-high gap under a stone ceiling: no body fits there, so nobody moves.
  writeCell(box, X + 10, 65, Z, B.stone);
  spawnArrow(box, X + 10.5, 64.5, Z + 0.5, 0, -10, 0, 0, 'p0', false, 5);
  run(box, 0.5);
  assert.ok(Math.abs(r.x - (X + 0.5)) < 0.05 && r.health === 20, 'never into solid blocks');

  // Review: a pearl hitting the underside of a 1-thick roof over a 1-high crawlspace never lands its thrower on the roof.
  const roof = game(), u = roof.players[0]!;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) writeCell(roof, X + 10 + dx, 65, Z + dz, B.stone);
  spawnArrow(roof, X + 10.5, 64.5, Z + 0.5, 0, 10, 0, 0, 'p0', false, 5);
  run(roof, 0.5);
  assert.ok(Math.abs(u.x - (X + 0.5)) < 0.05 && u.y < 65, `never through a ceiling (${u.x.toFixed(2)}, ${u.y.toFixed(2)})`);

  // Review: a pearl still flying when its thrower leaves the dimension does not pull them back.
  const away = game(), v = away.players[0]!;
  spawnArrow(away, X + 8.5, 70, Z + 0.5, 0, -10, 0, 0, 'p0', false, 5);
  Object.assign(v, { x: EX + 0.5, y: 64, z: EZ + 0.5 });
  run(away, 1);
  assert.ok(dimensionAt(v.x, v.z) === 'end' && v.health === 20, 'stays in the End');
});

test('every player kill drops 1-3 ender pearls', () => {
  const state = game(), player = state.players[0]!;
  const kill = (r: number) => {
    state.items = [];
    state.rand = () => r;
    killMob(state, add(state, MOB.enderman, X + 3, 64, Z), player);
    return state.items.filter(item => item.item === I.ender_pearl).reduce((n, item) => n + item.n, 0);
  };
  assert.deepEqual([kill(0), kill(0.5), kill(0.99)], [1, 2, 3]);
});
