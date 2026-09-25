import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOODS } from '../../src/model';
import { placeBuilding, placeRoute, removeBuilding, setRobber } from '../../src/engine/pieces';
import { int } from '../../src/engine/rng';
import { cpuStep, rules } from '../../src/server';
import { act, edit, fastForward, game, grant, inventory, pastSetup, pub, rig, serializable, tick, unchanged, view } from '../helpers';

test('rejected actions leave the state structuredClone-equal', () => {
  const s = game(4);
  const placer = s.turn.active!, other = s.order.find(x => x !== placer)!;
  unchanged(s, () => act(s, other, { type: 'build', piece: 'settlement', at: s.board.vertices[0].id }), /not your placement/);
  unchanged(s, () => act(s, placer, { type: 'build', piece: 'road', at: 'nowhere' }));
  unchanged(s, () => act(s, placer, { type: 'roll' }), /cannot roll/);
  unchanged(s, () => act(s, placer, { type: 'answer', prompt: 'q1', picks: {}, cards: {} }), /no longer open/);
  unchanged(s, () => act(s, placer, { type: 'command', command: 'x', picks: {}, cards: {} }), /no longer available/);
  unchanged(s, () => rules.applyAction(s, 'ghost', { type: 'end', turnId: s.turn.id }, s.now), /not in the game/);
  act(s, placer, { type: 'emote', emote: 'nice' });
  unchanged(s, () => act(s, placer, { type: 'emote', emote: 'nice' }), /3 seconds/);
  const bad = [
    null, { type: 'roll' }, { type: 'nope', turnId: 1 }, { type: 'build', turnId: 1, piece: 'castle', at: 'v1' },
    { type: 'bank', turnId: 1, give: { gold: 1 }, get: {} }, { type: 'emote', turnId: 1, emote: 'nice', pad: 'x'.repeat(2000) },
  ];
  for (const raw of bad) {
    assert.throws(() => rules.parseAction(raw));
  }
});

test('mapRev changes if and only if pieces changed across 2,000 random commits', () => {
  const s = game(4);
  pastSetup(s);
  const ids = <T extends { id: string }>(list: T[]) => list.map(x => x.id);
  const [tiles, vertices, edges] = [ids(s.board.tiles), ids(s.board.vertices), ids(s.board.edges)];
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const ops = [
    () => edit(s, n => setRobber(n, tiles[int(random, tiles.length)])),
    () => edit(s, n => setRobber(n, n.pieces.robber)),
    () => edit(s, n => {
      placeBuilding(n, { vertex: vertices[int(random, 40)], seat: s.order[int(random, 4)], kind: 'settlement' });
    }),
    () => edit(s, n => removeBuilding(n, vertices[int(random, 40)])),
    () => edit(s, n => placeRoute(n, { edge: edges[int(random, 40)], seat: s.order[0], kind: 'road' })),
    () => edit(s, n => {
      const g = GOODS[int(random, 5)], hand = n.seats[s.order[int(random, 4)]].hand;
      if (n.bank[g]) { n.bank[g]--; hand[g]++; } else if (hand[g]) { hand[g]--; n.bank[g]++; }
    }),
    () => edit(s, n => { n.seats[s.order[0]].ready = !n.seats[s.order[0]].ready; }),
    () => tick(s, s.now + 5000),
  ];
  for (let i = 0; i < 2000; i++) {
    const pieces = JSON.stringify(s.pieces), rev = s.mapRev;
    ops[int(random, ops.length)]();
    assert.equal(s.mapRev !== rev, JSON.stringify(s.pieces) !== pieces, `commit ${i}`);
  }
  serializable(s);
});

test('views are cached per revision and quiet ticks do not bump rev', () => {
  const s = game(4);
  const view0 = pub(s), rev = s.rev;
  assert.equal(pub(s), view0);
  assert.equal(view(s, s.order[0]), view(s, s.order[0]));
  tick(s, s.now + 1);
  assert.equal(s.rev, rev);
  assert.equal(pub(s), view0);
  grant(s, s.order[0], { wood: 1 });
  assert.notEqual(pub(s), view0);
  assert.equal(pub(s).board, view0.board, 'the immutable board is shared');
  const cards = (v: typeof view0) => v.seats.find(x => x.id === s.order[0])!.cards;
  assert.equal(cards(pub(s)), cards(view0) + 1);
});

test('a CPU whose decide throws gets the fallback, an auto event with reason error, and play continues', () => {
  const s = game(1, { tableSize: 4 });
  const cpu = s.order.find(id => s.seats[id].cpu)!;
  fastForward(s, x => x.turn.active === cpu);
  const id = s.turn.id, at = s.seats[cpu].cpu!.nextAt;
  cpuStep(s, at, () => { throw new Error('brain freeze'); });
  const auto = s.events.find(e => e.kind === 'auto' && e.reason === 'error');
  assert.ok(auto?.kind === 'auto' && auto.seat === cpu && auto.reason === 'error');
  assert.notEqual(s.turn.id, id, 'the round continues');
});

test('without a brain CPUs play silent auto-actions and a CPU-only table reaches the finale', () => {
  const s = game(1, { tableSize: 3 });
  const human = 'p0', stock = inventory(s);
  for (let now = s.now, i = 0; i < 20_000 && s.turn.stage !== 'finale'; i++, now += 100) {
    if (s.turn.round === 1 && s.turn.stage === 'roll') edit(s, n => { n.turn.round = 150; });
    if (s.turn.active === human && s.turn.stage === 'roll') { rig(s, [2, 2]); act(s, human, { type: 'roll' }); }
    else if (s.turn.active === human && s.turn.stage === 'main') act(s, human, { type: 'end' });
    rules.tick(s, new Map(), 0.1, now);
  }
  assert.equal(s.turn.stage, 'finale');
  assert.equal(s.results!.reason, 'round-limit');
  assert.ok(!s.events.some(e => e.kind === 'auto' && s.seats[e.seat].cpu), 'CPU moves are not timeouts');
  assert.deepEqual(inventory(s), stock);
  serializable(s);
});

test('a scripted brain acts through parseAction after a think delay, at most three CPUs per tick', () => {
  const s = game(1, { tableSize: 4 });
  let calls = 0;
  const brain = (_: unknown, me: ReturnType<typeof view>) => {
    calls++;
    const action = me.task.kind === 'roll' ? { type: 'roll', turnId: pub(s).turn.id }
      : me.task.kind === 'main' ? { type: 'end', turnId: pub(s).turn.id } : null;
    return { action: action as never, memory: calls, pace: 'think' as const };
  };
  fastForward(s, x => x.turn.stage === 'roll' && !!x.seats[x.turn.active!].cpu);
  const cpu = s.turn.active!, woke = s.seats[cpu].cpu!.nextAt;
  assert.ok(woke - s.now >= 600 && woke - s.now < 1500, 'a fresh duty waits a think delay');
  cpuStep(s, woke - 1, brain);
  assert.equal(calls, 0);
  cpuStep(s, woke, brain);
  assert.equal(s.turn.stage, 'main');
  assert.equal(s.seats[cpu].cpu!.memory, 1);
  cpuStep(s, s.seats[cpu].cpu!.nextAt, brain);
  assert.notEqual(s.turn.active, cpu, 'the CPU ended its turn');
});
