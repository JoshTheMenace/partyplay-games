/** Armor (DESIGN.md): MC damage reduction, bypassing causes, durability wear and breaking, equipping. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B } from '../src/shared/blocks';
import { CHUNK_CELLS, type ChunkSource } from '../src/shared/chunk';
import { localIndex } from '../src/shared/coords';
import { armorOf, durabilityOf, I, type Slot } from '../src/shared/items';
import { IF, validateSettings, type CmdBody, type Input } from '../src/shared/protocol';
import { afterArmor } from '../src/sim/armor';
import { damagePlayer } from '../src/sim/combat';
import { createState, tickState } from '../src/sim/game';
import type { DamageCause, Player, State } from '../src/sim/state';

const FLAT = (() => {
  const chunk = new Uint16Array(CHUNK_CELLS);
  for (let y = 0; y <= 63; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk[localIndex(x, y, z)] = y === 0 ? B.bedrock : y < 63 ? B.stone : B.grass_block;
  return chunk;
})();
const flat: ChunkSource = () => FLAT;
function game(mode: 'survival' | 'creative' = 'survival'): State {
  const ctx = { roomId: 'room', roundId: 'round', seed: 7, nowMs: 0, players: [{ id: 'p0', name: 'Ada', color: '#ff5748' }] };
  const state = createState(ctx, validateSettings({ seed: 11, mode, difficulty: 'peaceful' }), { source: flat, spawn: [2048, 64, 2048] });
  state.players[0]!.protectedUntil = 0;
  return state;
}
const MATERIALS = ['leather', 'golden', 'iron', 'diamond'] as const;
const fullSet = (material: string): Slot[] => ['helmet', 'chestplate', 'leggings', 'boots'].map(piece => ({ id: I[`${material}_${piece}` as keyof typeof I], n: 1 }));
/** One hit, far enough after the last one that invulnerability has worn off. */
function hit(state: State, player: Player, amount: number, cause: DamageCause) {
  state.clock += 1;
  damagePlayer(state, player, amount, 'was hurt', undefined, cause);
}

test('the MC armor formula for every full set (points 7/11/15/20, diamond toughness 8)', () => {
  // Reference values from Minecraft's damage formula, for a 10-damage hit, a 30-damage hit and a 1-damage hit.
  const expected = { leather: [9.2, 28.32, 0.74], golden: [7.6, 27.36, 0.58], iron: [6, 26.4, 0.42], diamond: [3, 15, 0.21] };
  for (const material of MATERIALS) {
    const set = fullSet(material), points = set.reduce((sum, s) => sum + armorOf(s.id)!.points, 0), toughness = set.reduce((sum, s) => sum + armorOf(s.id)!.toughness, 0);
    const got = [10, 30, 1].map(d => Math.round(afterArmor(d, points, toughness) * 1000) / 1000);
    assert.deepEqual(got, expected[material], material);
  }
  assert.equal(afterArmor(10, 0, 0), 10, 'no armor, no reduction');
  assert.ok(afterArmor(1000, 20, 8) > 0 && afterArmor(1, 30, 0) >= 0.2 - 1e-9, 'never below 20% of the hit (80% cap)');
});

test('armor reduces combat and heat damage but not falls, drowning, starvation or magma', () => {
  const state = game(), player = state.players[0]!;
  player.armor = fullSet('iron');
  for (const [cause, left] of [['mob', 14], ['arrow', 14], ['fireball', 14], ['explosion', 14], ['cactus', 14], ['fire', 14], ['lava', 14], ['fall', 10], ['drown', 10], ['starve', 10], ['magma', 10], ['other', 10]] as const) {
    player.health = 20;
    const before = player.armor.map(s => s!.d ?? 0);
    hit(state, player, 10, cause);
    assert.equal(player.health, left, cause);
    const wear = player.armor.map((s, i) => (s!.d ?? 0) - before[i]!);
    assert.deepEqual(wear, left === 14 ? [2, 2, 2, 2] : [0, 0, 0, 0], `${cause} wear`);
  }
  // Point-blank and chip damage: every worn piece loses max(1, floor(damage / 4)).
  player.armor = [{ id: I.diamond_helmet, n: 1 }, null, { id: I.leather_leggings, n: 1, d: 5 }, null];
  player.health = 20;
  hit(state, player, 3, 'mob');
  assert.deepEqual(player.armor.map(s => s?.d), [1, undefined, 6, undefined]);
  hit(state, player, 17, 'explosion');
  assert.deepEqual(player.armor.map(s => s?.d), [5, undefined, 10, undefined]);
});

test('worn-out pieces break with a toast and chips; creative takes no wear', () => {
  const state = game(), player = state.players[0]!;
  player.armor = [{ id: I.iron_helmet, n: 1, d: durabilityOf(I.iron_helmet) - 1 }, { id: I.golden_chestplate, n: 1, d: durabilityOf(I.golden_chestplate) - 3 }, null, null];
  assert.deepEqual([durabilityOf(I.iron_helmet), durabilityOf(I.golden_chestplate), durabilityOf(I.diamond_boots), durabilityOf(I.leather_leggings)], [165, 112, 429, 75]);
  hit(state, player, 4, 'arrow');
  assert.equal(player.armor[0], null, 'the helmet broke');
  assert.equal(player.armor[1]!.d, durabilityOf(I.golden_chestplate) - 2);
  assert.equal(player.toast?.text, 'Your Iron Helmet broke!');
  const fx = state.fx.map(e => e.fx).find(f => f.k === 'break');
  assert.equal(fx?.a, B.iron_block);
  // The reduction used the helmet it wore when the hit landed: 7 points turn 4 damage into 3.2.
  assert.equal(Math.round(player.health * 100) / 100, 16.8);

  const creative = game('creative'), builder = creative.players[0]!;
  builder.armor = fullSet('leather');
  hit(creative, builder, 10, 'mob');
  assert.deepEqual([builder.health, builder.armor.map(s => s!.d)], [20, [undefined, undefined, undefined, undefined]]);
});

test('using armor equips it, swapping with the worn piece and keeping durability', () => {
  const state = game(), player = state.players[0]!;
  const send = (cmds: CmdBody[]) => {
    const input: Input = { p: [player.x, player.y, player.z], v: [0, 0, 0], yaw: 0, pitch: 0, f: IF.ON_GROUND, slot: 0, mine: null, tpAck: player.tp.n, cmds: cmds.map((c, i) => ({ n: player.ack + 1 + i, ...c }) as Input['cmds'][number]) };
    tickState(state, new Map([['p0', input]]), 0.05);
  };
  player.inv[2] = { id: I.diamond_chestplate, n: 1, d: 40 };
  player.armor[1] = { id: I.leather_chestplate, n: 1, d: 3 };
  send([{ t: 'useItem', slot: 2 }]);
  assert.deepEqual([player.armor[1], player.inv[2]], [{ id: I.diamond_chestplate, n: 1, d: 40 }, { id: I.leather_chestplate, n: 1, d: 3 }]);
  assert.ok(state.fx.some(e => e.fx.k === 'pickup' && e.fx.a === I.diamond_chestplate), 'equip feedback');
  player.inv[3] = { id: B.dirt, n: 5 };
  const ack = player.ack;
  send([{ t: 'useItem', slot: 3 }]);
  assert.deepEqual([player.ack, player.inv[3], player.armor[1]!.id], [ack + 1, { id: B.dirt, n: 5 }, I.diamond_chestplate], 'dirt is not worn');
});
