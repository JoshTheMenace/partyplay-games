/** The Ender Dragon fight (DESIGN.md): flight, phases, crystals, acid, damage, death, victory, respawn and saves. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B } from '../src/shared/blocks';
import { END_CENTER, inEnd, SPAWN_X, SPAWN_Z } from '../src/shared/constants';
import { crystalSpot, endPillars, EXIT_PORTAL, EXIT_RIM_SIDES, EXIT_Y, PERCH_Y } from '../src/shared/end';
import type { Vec3 } from '../src/shared/coords';
import { I } from '../src/shared/items';
import { DRAGON_HEAD, DRAGON_PHASE as P, IF, MOB, PK, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { damageMob, mobHitBoxes, spawnArrow } from '../src/sim/combat';
import { ACID_SECONDS, dragonOf } from '../src/sim/dragon';
import { arriveInEnd } from '../src/sim/end';
import { createState, saveSource, tickState } from '../src/sim/game';
import { teleport } from '../src/sim/players';
import { exportSave, parseSave } from '../src/sim/save';
import type { Mob, Player, State } from '../src/sim/state';
import { publicView } from '../src/sim/views';
import { breakBlock, standY, writeCell } from '../src/sim/world';

const SEED = 4242, { x: CX, z: CZ } = END_CENTER;
const ctx = (names: string[]) => ({ roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: names.map((name, i) => ({ id: `p${i}`, name, color: '#ff5748' })) });
/** A world whose first player has just arrived in the End (the dragon and crystals spawn on the first tick). */
function game(names = ['Ada'], save?: ReturnType<typeof parseSave>): State {
  const state = createState(ctx(names), save?.settings ?? validateSettings({ seed: SEED, difficulty: 'normal' }), { spawn: [SPAWN_X, 90, SPAWN_Z], save });
  arriveInEnd(state, state.players[0]!);
  state.players[0]!.protectedUntil = 0;
  tickState(state, new Map(), 0.05);
  return state;
}
const hold = (player: Player, cmds: CmdBody[]): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) });
const tick = (state: State, cmds: CmdBody[] = []) => tickState(state, cmds.length ? new Map([['p0', hold(state.players[0]!, cmds)]]) : new Map(), 0.05);
const run = (state: State, seconds: number, each?: () => void) => { for (let i = 0; i < Math.round(seconds * 20); i++) { tick(state); each?.(); } };
const dragon = (state: State) => dragonOf(state)!;
const crystalMobs = (state: State) => state.mobs.filter(m => m.t === MOB.end_crystal && m.health > 0);
/** Stand a player on the island surface at a column. */
const stand = (state: State, player: Player, x: number, z: number) => teleport(state, player, x + 0.5, standY(state.get, x, z), z + 0.5);
const centre = (box: readonly number[]) => [(box[0]! + box[3]!) / 2, (box[1]! + box[4]!) / 2, (box[2]! + box[5]!) / 2] as const;
const ironArmor = () => [{ id: I.iron_helmet, n: 1 }, { id: I.iron_chestplate, n: 1 }, { id: I.iron_leggings, n: 1 }, { id: I.iron_boots, n: 1 }];
/**
 * A full-power arrow (50 m/s, the server's drag and gravity) from `from` that passes through `to`: its velocity and
 * flight time, found by bisecting the pitch of the low arc. Null when out of range.
 */
function aimArrow(from: Vec3, to: Vec3): { v: Vec3; t: number } | null {
  const dx = to[0] - from[0], dz = to[2] - from[2], flat = Math.hypot(dx, dz), rise = to[1] - from[1], dt = 0.05, drag = 0.99;
  const flight = (pitch: number) => {
    let x = 0, y = 0, vh = Math.cos(pitch) * 50, vy = Math.sin(pitch) * 50, t = 0;
    while (x + vh * dt < flat && t < 4) { x += vh * dt; y += vy * dt; vh *= drag; vy = vy * drag - 20 * dt; t += dt; }
    const f = vh > 0 ? (flat - x) / (vh * dt) : 0;
    return { y: y + vy * dt * f, t: t + dt * f };
  };
  let lo = -1.4, hi = 0.78;
  if (flight(hi).y < rise) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (flight(mid).y < rise) lo = mid; else hi = mid;
  }
  const pitch = (lo + hi) / 2, h = Math.cos(pitch) * 50 / (flat || 1);
  return { v: [dx * h, Math.sin(pitch) * 50, dz * h], t: flight(pitch).t };
}
const noEndermen = (state: State) => { state.mobs = state.mobs.filter(m => m.t !== MOB.enderman); };

test('the dragon wakes over the island with ten crystals on the pillars; the boss bar shows only to the End', () => {
  const state = game(['Ada', 'Bo']), pillars = endPillars(SEED), d = dragon(state);
  assert.ok(Math.hypot(d.x - CX, d.z - CZ) < 2 && d.y > 80, 'hovering above the centre');
  assert.deepEqual(crystalMobs(state).map(c => [c.x, c.y, c.z]).sort(), pillars.map(crystalSpot).sort());
  assert.deepEqual(publicView(state).boss, { name: 'Ender Dragon', health: 200, max: 200, crystals: 10 });
  run(state, 1);
  assert.equal(state.mobs.filter(m => m.t === MOB.ender_dragon).length, 1, 'only one dragon');
  teleport(state, state.players[0]!, SPAWN_X, 90, SPAWN_Z);
  assert.equal(publicView(state).boss, undefined, 'nobody in the End: no boss bar');
});

test('a long flight stays smooth, above the island and inside the region; phases cycle; strafes only target the End', () => {
  const state = game(['Ada', 'Bo']), [ada, bo] = state.players as [Player, Player], seen = new Set<number>(), perches: number[] = [];
  stand(state, ada, CX + 18, CZ - 6);
  let last = { ...dragon(state) }, perchedAt = -1, maxStep = 0;
  const fireballs = new Set<number>();
  run(state, 600, () => {
    noEndermen(state);
    ada.health = 20;
    ada.food = 20;
    const d = dragon(state);
    assert.ok(Math.hypot(d.x - CX, d.z - CZ) <= 150 && d.y >= PERCH_Y && d.y <= 118, `in bounds: ${d.x}, ${d.y}, ${d.z}`);
    assert.notEqual(state.dragon.target, bo.id, 'Bo is in the overworld');
    maxStep = Math.max(maxStep, Math.hypot(d.x - last.x, d.y - last.y, d.z - last.z));
    if (d.ph === P.PERCHED && last.ph !== P.PERCHED) perchedAt = state.clock;
    if (d.ph !== P.PERCHED && last.ph === P.PERCHED) perches.push(state.clock - perchedAt);
    seen.add(d.ph);
    for (const a of state.arrows) if (a.k === PK.DRAGON_FIREBALL) fireballs.add(a.id);
    last = { ...d };
  });
  assert.deepEqual([...seen].sort(), [P.CIRCLING, P.STRAFING, P.LANDING, P.PERCHED, P.TAKING_OFF]);
  assert.ok(maxStep < 1.3, `no jumps (largest step ${maxStep.toFixed(2)} m)`);
  assert.ok(perches.length >= 4 && perches.every(s => s >= 5.9 && s <= 10.1), `perches of 6–10 s: ${perches.map(s => s.toFixed(1))}`);
  assert.ok(fireballs.size >= 5, `${fireballs.size} strafing fireballs`);
  assert.equal(dragon(state).health, 200, 'crystals keep it topped up');
});

test('crystals heal the dragon with a beam; destroying the healing one hurts it, explodes and leaves the pillar bare', () => {
  const state = game(), player = state.players[0]!, d = dragon(state), [crystal] = crystalMobs(state) as [Mob];
  Object.assign(d, { x: crystal.x + 12, y: crystal.y + 4, z: crystal.z, health: 150, ph: P.PERCHED });
  state.dragon.phaseUntil = state.clock + 60;
  run(state, 2);
  assert.ok(d.health >= 153 && d.health <= 155, `healed to ${d.health}`);
  assert.equal(publicView(state).mobs.find(m => m.id === crystal.id)!.a, 3, 'the healing crystal shows its beam');
  const before = d.health, pillar = crystal.p - 1;
  // An arrow fired from a block 20 away at the crystal's height (as if pillared up).
  writeCell(state, Math.floor(crystal.x) + 20, crystal.y - 1, Math.floor(crystal.z), B.cobblestone);
  teleport(state, player, Math.floor(crystal.x) + 20.5, crystal.y, Math.floor(crystal.z) + 0.5);
  const eye: Vec3 = [player.x, player.y + 1.5, player.z];
  spawnArrow(state, ...eye, ...aimArrow(eye, [crystal.x, crystal.y + 1, crystal.z])!.v, 9, player.id, true);
  run(state, 1);
  assert.equal(crystal.health, 0);
  assert.ok(before - d.health >= 9.5, `the dragon took ${before - d.health}`);
  assert.ok(!state.end.crystals.includes(pillar) && state.end.crystals.length === 9);
  assert.equal(publicView(state).boss?.crystals, 9);
  assert.ok(state.fx.some(f => f.fx.k === 'crystal') && state.fx.some(f => f.fx.k === 'explode' && f.fx.a === 6));
  const [p] = endPillars(SEED).filter((_, i) => i === pillar) as [ReturnType<typeof endPillars>[number]];
  assert.equal(state.get(p.x, p.top, p.z), B.bedrock, 'the blast breaks no blocks');
});

test('a crystal broken by hand blasts a nearby player hard but not fatally in iron armor; blasts chain', () => {
  const state = game(), player = state.players[0]!, [a, b] = crystalMobs(state) as [Mob, Mob];
  player.armor = ironArmor();
  Object.assign(b, { x: a.x + 5, y: a.y, z: a.z });
  teleport(state, player, a.x + 3, a.y, a.z);
  damageMob(state, a, 1, player);
  assert.ok(player.health > 8 && player.health < 16, `health ${player.health}`);
  assert.equal(b.health, 0, 'the neighbour went too');
});

test('damage: the head takes ×1.5 by part, 0.5 s invulnerability, only players hurt it, never while dying', () => {
  const state = game(), player = state.players[0]!, d = dragon(state);
  assert.ok(damageMob(state, d, 10, player, undefined, { part: DRAGON_HEAD }));
  assert.equal(d.health, 185);
  assert.ok(!damageMob(state, d, 10, player, undefined, { part: 2 }), 'a smaller hit in the window does nothing');
  state.clock += 0.6;
  assert.ok(damageMob(state, d, 10, player, undefined, { part: 2 }));
  assert.equal(d.health, 175);
  state.clock += 0.6;
  assert.ok(!damageMob(state, d, 50, null), 'explosions, fire and acid do not hurt it');
  // The attack command: a player in reach of the perched head strikes it (diamond sword).
  const [hx, , hz] = centre(mobHitBoxes(Object.assign(d, { x: CX + 0.5, y: PERCH_Y, z: CZ + 0.5, yaw: 0, pt: -0.35, ph: P.PERCHED }))[DRAGON_HEAD]!);
  state.dragon.phaseUntil = state.clock + 60;
  player.inv[0] = { id: I.diamond_sword, n: 1 };
  stand(state, player, Math.floor(hx), Math.floor(hz));
  const health = d.health;
  tick(state, [{ t: 'attack', id: d.id, part: DRAGON_HEAD }]);
  assert.ok(health - d.health >= 9, `a sword on the head: ${health - d.health}`);
  d.health = 3;
  state.clock += 0.6;
  damageMob(state, d, 10, player);
  assert.equal(d.ph, P.DYING);
  state.clock += 0.6;
  assert.ok(!damageMob(state, d, 10, player), 'dying: no more damage');
});

test('with the crystals gone it strafes sooner and fires pairs, even at a player under cover; landing pushes players off the fountain', () => {
  const state = game(), player = state.players[0]!;
  noEndermen(state);
  state.end.crystals = [];
  for (const c of crystalMobs(state)) c.health = 0;
  stand(state, player, CX + 24, CZ + 24);
  // A stone roof 3 above the player's head: the dragon has no clear view, so after 5 s of diving it fires blind.
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) writeCell(state, CX + 24 + dx, Math.floor(player.y) + 5, CZ + 24 + dz, B.obsidian);
  Object.assign(state.dragon, { strafeAt: state.clock, perchAt: Infinity });
  const shots = new Map<number, number>();
  run(state, 16, () => { for (const a of state.arrows) if (a.k === PK.DRAGON_FIREBALL && !shots.has(a.id)) shots.set(a.id, state.ticks); });
  const ticks = [...shots.values()];
  assert.ok(ticks.length >= 2 && ticks[0] === ticks[1], `a pair of fireballs (${ticks})`);

  const perch = game(), bo = perch.players[0]!;
  noEndermen(perch);
  stand(perch, bo, CX + 3, CZ);
  Object.assign(perch.dragon, { strafeAt: Infinity, perchAt: perch.clock });
  const pushes = bo.imp.n;
  for (let i = 0; i < 1200 && dragon(perch).ph !== P.PERCHED; i++) tick(perch);
  assert.equal(dragon(perch).ph, P.PERCHED);
  assert.ok(bo.imp.n > pushes && Math.hypot(bo.imp.vx, bo.imp.vz) > 8, 'the landing gust shoves the player outwards');
});

test('dragon fireballs burst into acid clouds that hurt 3 a second for 3 s, less through armor', () => {
  const hurt = (armor: boolean) => {
    const state = game(), player = state.players[0]!, d = dragon(state);
    stand(state, player, CX + 20, CZ + 20);
    Object.assign(player, { food: 10, armor: armor ? ironArmor() : player.armor });
    // Keep the dragon busy circling far away.
    Object.assign(state.dragon, { strafeAt: Infinity, perchAt: Infinity });
    Object.assign(d, { x: CX - 120, z: CZ });
    spawnArrow(state, player.x, player.y + 10, player.z, 0, -15, 0, 0, d.id, false, PK.DRAGON_FIREBALL);
    const before = player.health;
    run(state, 1);
    assert.equal(state.dragon.clouds.length, 1, 'a cloud on the ground');
    assert.ok(state.fx.some(f => f.fx.k === 'acid' && f.fx.a === 3));
    run(state, ACID_SECONDS + 0.5);
    assert.equal(state.dragon.clouds.length, 0, 'it fades');
    return before - player.health;
  };
  const bare = hurt(false), iron = hurt(true);
  assert.equal(bare, 9);
  assert.ok(iron > 2 && iron < 6, `iron armor: ${iron}`);
});

/**
 * A scripted, well-equipped player (diamond sword, full iron armor, bow and arrows, cobblestone to pillar with) on
 * normal: shoots the crystals (pillaring up to break the cages), then shoots the dragon in flight and swords its head
 * whenever it perches, stepping out of acid and eating when hungry.
 */
function fight(state: State) {
  const player = state.players[0]!, pillars = endPillars(SEED);
  Object.assign(player, { armor: ironArmor(), inv: player.inv.map((_, i) => i === 0 ? { id: I.diamond_sword, n: 1 } : null) });
  stand(state, player, CX + 12, CZ);
  let arrows = 0, shotAt = 0, minHealth = 20;
  /** One tick of walking (5 m/s) towards a column. */
  const walk = (x: number, z: number) => {
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz), k = Math.min(d, 0.25) / (d || 1), nx = player.x + dx * k, nz = player.z + dz * k;
    teleport(state, player, nx, standY(state.get, Math.floor(nx), Math.floor(nz)), nz);
  };
  const shoot = (tx: number, ty: number, tz: number, vx = 0, vy = 0, vz = 0) => {
    if (state.clock - shotAt < 1.1) return;
    const eye: Vec3 = [player.x, player.y + 1.5, player.z], first = aimArrow(eye, [tx, ty, tz]);
    const aim = first && aimArrow(eye, [tx + vx * first.t, ty + vy * first.t, tz + vz * first.t]);
    if (!aim) return;
    spawnArrow(state, ...eye, ...aim.v, 9, player.id, true);
    shotAt = state.clock;
    arrows++;
  };
  /** True while the player is stepping out of an acid cloud. */
  const dodge = () => {
    const cloud = state.dragon.clouds.find(c => Math.hypot(c.x - player.x, c.z - player.z) < 4.5 && Math.abs(c.y - player.y) < 3);
    if (!cloud) return false;
    const dx = player.x - cloud.x || 1, dz = player.z - cloud.z, d = Math.hypot(dx, dz);
    walk(player.x + dx / d * 3, player.z + dz / d * 3);
    return true;
  };
  const each = () => {
    noEndermen(state);
    if (player.food < 18) Object.assign(player, { food: 20, saturation: Math.min(20, player.saturation + 12.8) });
    minHealth = Math.min(minHealth, player.health);
  };
  // 1. The crystals, shortest pillar first. Caged ones: pillar up beside the cage, break the bars, shoot point blank.
  // Open ones: from 24 blocks inward, pillared up to 8 below the crystal so the shot clears the pillar's top edge.
  for (const p of [...pillars].sort((a, b) => a.top - b.top)) {
    const crystal = () => crystalMobs(state).find(c => c.p - 1 === pillars.indexOf(p));
    const [sx, sy, sz] = crystalSpot(p), inward = (p.caged ? 4.3 : 24) / Math.hypot(sx - CX, sz - CZ);
    const bx = Math.floor(sx + (CX - sx) * inward), bz = Math.floor(sz + (CZ - sz) * inward);
    for (let i = 0; i < 400 && Math.hypot(bx + 0.5 - player.x, bz + 0.5 - player.z) > 0.3; i++) { if (!dodge()) walk(bx + 0.5, bz + 0.5); tick(state); each(); }
    const ground = Math.floor(player.y), up = p.caged ? p.top + 1 : Math.max(ground, sy - 8);
    for (let y = ground; y < up; y++) {
      writeCell(state, bx, y, bz, B.cobblestone);
      teleport(state, player, bx + 0.5, y + 1, bz + 0.5);
      run(state, 0.4, each);
    }
    if (p.caged) {
      for (let y = p.top; y <= p.top + 4; y++) for (let d = -2; d <= 2; d++) for (const [x, z] of [[p.x + d, p.z - 2], [p.x + d, p.z + 2], [p.x - 2, p.z + d], [p.x + 2, p.z + d]] as const) {
        if (state.get(x, y, z) !== B.air && Math.hypot(x + 0.5 - player.x, z + 0.5 - player.z) < Math.hypot(sx - player.x, sz - player.z)) breakBlock(state, x, y, z);
      }
      run(state, 1, each);
    }
    for (let i = 0; i < 400 && crystal(); i++) {
      const c = crystal()!;
      shoot(c.x, c.y + 1, c.z);
      tick(state);
      each();
    }
    // Dig back down the pillar.
    for (let y = up - 1; y >= ground; y--) {
      writeCell(state, bx, y, bz, B.air);
      teleport(state, player, bx + 0.5, standY(state.get, bx, bz), bz + 0.5);
      run(state, 0.3, each);
    }
  }
  // 2. The dragon.
  const start = state.clock;
  for (let i = 0; i < 20 * 900 && dragonOf(state) && dragon(state).ph !== P.DYING; i++) {
    const d = dragon(state), cmds: CmdBody[] = [];
    if (!dodge()) {
      if (d.ph === P.PERCHED) {
        const [hx, , hz] = centre(mobHitBoxes(d)[DRAGON_HEAD]!), toward = 1.2 / (Math.hypot(hx - CX, hz - CZ) || 1);
        walk(hx + (hx - CX) * toward, hz + (hz - CZ) * toward);
        if (Math.hypot(hx - player.x, hz - player.z) < 2.5 && state.clock - player.attackAt > 0.55) cmds.push({ t: 'attack', id: d.id, part: DRAGON_HEAD });
      } else {
        if (Math.hypot(player.x - CX - 12, player.z - CZ) > 3) walk(CX + 12, CZ);
        const [bx, by, bz] = centre(mobHitBoxes(d)[2]!);
        if (Math.hypot(bx - player.x, by - player.y, bz - player.z) < 40) shoot(bx, by, bz, d.vx, d.vy, d.vz);
      }
    }
    tick(state, cmds);
    each();
  }
  return { arrows, seconds: state.clock - start, minHealth };
}

test('a well-equipped player beats the dragon on normal: crystals, flight, perches, then the death sequence and victory', () => {
  const state = game(), player = state.players[0]!, result = fight(state);
  assert.equal(state.end.crystals.length, 0, 'every crystal is gone');
  const d = dragon(state);
  assert.equal(d?.ph, P.DYING, `the dragon is dying after ${result.seconds.toFixed(0)} s and ${result.arrows} arrows`);
  assert.ok(result.seconds < 600 && result.arrows <= 96, `fight: ${result.seconds.toFixed(0)} s, ${result.arrows} arrows`);
  assert.equal(player.stats.deaths, 0, `the player survives (lowest health ${result.minHealth})`);
  assert.equal(publicView(state).boss?.health, 0, 'the bar reads 0 while it dies');
  assert.equal(state.fx.filter(f => f.fx.k === 'dragonDeath').length, 1);
  // 8 s of rising, then the portal, the egg and the victory.
  const y0 = d.y;
  run(state, 7.5);
  assert.ok(dragonOf(state) && d.y > y0 + 8 && state.end.victory === null, 'still rising');
  run(state, 0.6);
  assert.equal(dragonOf(state), undefined);
  for (const [dx, dz] of EXIT_PORTAL) assert.equal(state.get(CX + dx, EXIT_Y, CZ + dz), B.end_portal);
  assert.equal(state.get(CX, PERCH_Y, CZ), B.dragon_egg);
  assert.deepEqual(state.end.victory, { day: state.day, tick: state.end.victory!.tick, by: ['Ada'] });
  assert.equal(state.stats.dragons, 1);
  assert.match(player.toast?.text ?? '', /Ender Dragon has been defeated/);
  assert.deepEqual(publicView(state).victory?.by, ['Ada']);
  assert.equal(publicView(state).boss, undefined);
  run(state, 2);
  assert.equal(state.stats.dragons, 1, 'victory happens once');
  assert.equal(state.mobs.filter(m => m.t === MOB.ender_dragon).length, 0, 'no new dragon by itself');
});

test('respawning: four crystals on the exit portal rim bring the dragon back with fresh pillar crystals', () => {
  const state = game(), player = state.players[0]!;
  const d = dragon(state);
  d.health = 1;
  damageMob(state, d, 5, player);
  run(state, 8.5);
  const victory = state.end.victory;
  assert.ok(victory && state.end.portalActive);
  // A player broke a cage on the way; the pillars are restored for the replay.
  const caged = endPillars(SEED).find(p => p.caged)!;
  writeCell(state, caged.x + 2, caged.top + 2, caged.z, B.air);
  for (const c of crystalMobs(state)) damageMob(state, c, 1, player);
  player.inv[0] = { id: I.end_crystal, n: 4 };
  for (const [dx, dz] of EXIT_RIM_SIDES) {
    stand(state, player, CX + dx * 2, CZ + dz * 2);
    tick(state, [{ t: 'use', x: CX + dx, y: EXIT_Y, z: CZ + dz, face: 3 }]);
  }
  assert.equal(crystalMobs(state).length, 4, 'four crystals on the rim');
  run(state, 1.5);
  assert.equal(state.end.dragon, 'alive');
  assert.equal(dragon(state).health, 200);
  assert.equal(crystalMobs(state).length, 10, 'fresh crystals on every pillar, the rim ones used up');
  assert.equal(state.get(CX + 1, EXIT_Y, CZ), B.air, 'the portal closes');
  assert.equal(state.get(caged.x + 2, caged.top + 2, caged.z) & 255, B.iron_bars, 'cages restored');
  dragon(state).health = 1;
  state.clock += 1;
  damageMob(state, dragon(state), 5, player);
  run(state, 8.5);
  assert.equal(state.stats.dragons, 2);
  assert.equal(state.end.victory, victory, 'the first victory stands');
  assert.equal(state.get(CX, PERCH_Y, CZ), B.dragon_egg, 'still one egg');
});

test('saves: mid-fight health and crystals round-trip and the dragon resumes circling; a save mid-death finishes it', () => {
  const state = game(), player = state.players[0]!;
  const d = dragon(state);
  for (const c of crystalMobs(state).slice(0, 3)) damageMob(state, c, 1, player);
  Object.assign(state.dragon, { strafeAt: Infinity, perchAt: Infinity });
  d.health = 123;
  run(state, 0.1);
  const json = JSON.stringify(exportSave(saveSource(state))), save = parseSave(JSON.parse(json));
  assert.deepEqual([save.end?.health, save.end?.crystals.length, save.end?.dragon], [d.health, 7, 'alive']);
  const loaded = game(['Ada'], save), again = dragon(loaded);
  assert.equal(again.health, d.health);
  assert.equal(again.ph, P.CIRCLING);
  assert.deepEqual(crystalMobs(loaded).map(c => c.p).sort(), state.end.crystals.map(i => i + 1).sort());
  // Saved while dying (health 0): loading completes the death.
  again.health = 1;
  damageMob(loaded, again, 5, loaded.players[0]!);
  const dying = parseSave(JSON.parse(JSON.stringify(exportSave(saveSource(loaded)))));
  assert.equal(dying.end?.health, 0);
  const after = game(['Ada'], dying);
  assert.deepEqual([after.end.dragon, after.end.portalActive, after.stats.dragons, after.end.victory?.by], ['dead', true, 1, ['Ada']]);
  assert.equal(after.mobs.filter(m => m.t === MOB.ender_dragon).length, 0);
  // A v9 world gets a fresh End.
  const v9 = JSON.parse(json);
  v9.version = 9;
  for (const key of ['end', 'victory', 'pearlPity']) delete v9[key];
  delete v9.stats.dragons;
  const fresh = game(['Ada'], parseSave(v9));
  assert.deepEqual([dragon(fresh).health, crystalMobs(fresh).length, publicView(fresh).boss?.crystals], [200, 10, 10]);
  assert.ok(inEnd(fresh.players[0]!.x, fresh.players[0]!.z));
});
