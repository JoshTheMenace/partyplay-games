/** Nether mobs (DESIGN.md): neutral piglins with group anger, ghasts, fireballs, spawning. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, cellId, isAir, isFullCube, isSolid } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { inNether, NETHER } from '../src/shared/constants';
import { localIndex } from '../src/shared/coords';
import { IF, MOB, MS, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { spawnArrow } from '../src/sim/combat';
import { createState, tickState } from '../src/sim/game';
import { newMob } from '../src/sim/mobs';
import { spawnNetherMobs } from '../src/sim/nether-mobs';
import type { Mob, Player, State } from '../src/sim/state';
import { publicView } from '../src/sim/views';

const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.netherrack;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
/** A spot in the Nether region and one in the overworld. */
const NX = NETHER.x0 + 256, NZ = 256, X = 2048, Z = 2048;
function game(x: number, z: number): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11, difficulty: 'normal' }), { source: flat, spawn: [x, 64, z] });
  Object.assign(state.players[0]!, { protectedUntil: 0, x: x + 0.5, y: 64, z: z + 0.5 });
  tickState(state, new Map(), 0.05);
  return state;
}
const hold = (player: Player, cmds: CmdBody[]): Input =>
  ({ p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: player.yaw, pitch: player.pitch, f: IF.ON_GROUND, slot: player.slot, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) });
const send = (state: State, cmds: CmdBody[]) => tickState(state, new Map([['p0', hold(state.players[0]!, cmds)]]), 0.05);
const run = (state: State, seconds: number, each?: () => void) => { for (let i = 0; i < Math.round(seconds * 20); i++) { tickState(state, new Map(), 0.05); each?.(); } };
const add = (state: State, t: number, x: number, y: number, z: number): Mob => {
  const mob = newMob(state, t, x, y, z);
  state.mobs.push(mob);
  return mob;
};
const angry = (state: State, mob: Mob) => ((publicView(state).mobs.find(m => m.id === mob.id)?.s ?? 0) & MS.ANGRY) !== 0;

test('zombified piglins are neutral until hit; then every piglin within 24 blocks hunts the attacker for 30 s', () => {
  const state = game(X, Z), player = state.players[0]!;
  const hit = add(state, MOB.zombified_piglin, X + 1.8, 64, Z + 0.5), near = add(state, MOB.zombified_piglin, X + 10.5, 64, Z + 3.5);
  const behind = add(state, MOB.zombified_piglin, X - 14.5, 64, Z - 3.5), far = add(state, MOB.zombified_piglin, X + 32.5, 64, Z + 0.5);
  run(state, 3);
  assert.ok([hit, near, behind, far].every(p => p.target === null && !angry(state, p)), 'calm');
  assert.equal(player.health, 20, 'neutral piglins leave players alone');
  Object.assign(hit, { x: X + 1.8, z: Z + 0.5 });
  send(state, [{ t: 'attack', id: hit.id }]);
  run(state, 0.05);
  for (const piglin of [hit, near, behind]) {
    assert.equal(piglin.target, 'p0');
    assert.ok(Math.abs(piglin.aggroUntil - state.clock - 30) < 0.2, 'angry for 30 s');
    assert.ok(angry(state, piglin));
  }
  assert.ok(far.target === null && !angry(state, far), 'piglins beyond 24 blocks stay calm');
  run(state, 3);
  assert.ok(player.health < 20, 'the group attacks');
  state.settings.mode = 'creative';
  run(state, 28);
  assert.ok([hit, near, behind].every(p => p.target === null && !angry(state, p)), 'anger wears off');
});

test('ghasts shoot fireballs at players they can see; fireballs explode, burn and set fires', () => {
  const state = game(NX, NZ), player = state.players[0]!, ghast = add(state, MOB.ghast, NX + 18.5, 68, NZ + 0.5);
  let charged = false, fired = false;
  run(state, 4, () => {
    charged ||= ghast.a === 3;
    fired ||= state.arrows.some(arrow => arrow.k === 1 && arrow.shooter === ghast.id);
  });
  assert.ok(charged && fired, 'charges (face open) and fires');
  assert.ok(state.fx.some(entry => entry.fx.k === 'fireball') || fired);
  run(state, 4);
  assert.ok(player.health < 20, 'hit');
  assert.ok(player.fire > 0 || player.health < 17, 'set alight');
  assert.ok(ghast.y > 60, 'ghasts fly');

  // A fireball into the ground: a small blast and fire around it (never floating).
  const quiet = game(NX, NZ), ball = spawnArrow(quiet, NX + 12.5, 70, NZ + 0.5, 0, -14, 0, 6, 12345, false, 1);
  quiet.players[0]!.x = NX - 20;
  run(quiet, 1);
  assert.ok(!quiet.arrows.includes(ball), 'the fireball is gone');
  assert.ok(quiet.fx.some(entry => entry.fx.k === 'explode' && entry.fx.a === 1 && Math.abs(entry.fx.x - NX - 12.5) < 1));
  const fires = [...quiet.world.edits].filter(([, cell]) => cellId(cell) === B.fire);
  assert.ok(fires.length > 0, 'fire starts');
  for (const [index] of fires) {
    const x = index % 4096, z = Math.floor(index / 4096) % 4096, y = Math.floor(index / 4096 / 4096);
    assert.ok(isSolid(quiet.get(x, y - 1, z)), 'fire sits on a block');
  }
});

test('hitting a fireball sends it back; a returned fireball kills the ghast', () => {
  const state = game(NX, NZ), player = state.players[0]!, ghast = add(state, MOB.ghast, NX + 16.5, 63.5, NZ + 0.5);
  player.yaw = -Math.PI / 2;
  const ball = spawnArrow(state, NX + 3, 65.6, NZ + 0.5, -14, 0, 0, 6, ghast.id, false, 1);
  send(state, [{ t: 'attack', id: ball.id }]);
  assert.equal(ball.shooter, 'p0');
  assert.ok(ball.vx > 13, 'now flying along the look');
  run(state, 1.5);
  assert.ok(ghast.health <= 0 && !state.mobs.includes(ghast), 'the ghast dies');
  assert.equal(player.stats.mobs, 1);
  assert.equal(player.health, 20, 'a returned fireball never hurts its hitter directly');
});

test('Nether spawning: piglin groups on the floor and ghasts in open air, only in the region, with caps', () => {
  const state = game(NX, NZ), player = state.players[0]!;
  const seen = new Set<Mob>();
  for (let i = 0; i < 400; i++) {
    spawnNetherMobs(state);
    for (const mob of state.mobs) {
      if (seen.has(mob)) continue;
      seen.add(mob);
      assert.ok(inNether(mob.x, mob.z), 'inside the Nether');
      assert.ok(Math.hypot(mob.x - player.x, mob.y - player.y, mob.z - player.z) >= 24, 'never within 24 blocks');
      if (mob.t === MOB.zombified_piglin) assert.ok(isFullCube(state.get(mob.x, mob.y - 1, mob.z)) && isAir(state.get(mob.x, mob.y, mob.z)), 'on the floor');
      else assert.equal(mob.t, MOB.ghast);
    }
  }
  const count = (t: number) => state.mobs.filter(mob => mob.t === t).length;
  assert.equal(count(MOB.zombified_piglin), 8, 'piglin cap 4 + 4 per player');
  assert.equal(count(MOB.ghast), 2, 'ghast cap 1 + 1 per player');
  const overworld = game(X, Z);
  for (let i = 0; i < 100; i++) spawnNetherMobs(overworld);
  assert.equal(overworld.mobs.length, 0, 'nothing from the Nether spawns outside it');
});
