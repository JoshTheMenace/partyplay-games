import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINALE_MS, SEAT_COLORS } from '../../src/model';
import { finish, partnerOf, roundLimit } from '../../src/engine/flow';
import { openPrompt } from '../../src/engine/prompts';
import { rules } from '../../src/server';
import { act, edit, fastForward, game, grant, pastSetup, pub, rig, serializable, tick, unchanged, view } from '../helpers';

test('stale and duplicate turn ids are rejected; prompts do not change turn.id', () => {
  const s = game(4);
  pastSetup(s);
  const a = s.turn.active!, id = s.turn.id;
  unchanged(s, () => act(s, a, { type: 'roll', turnId: id - 1 }), /turn changed/);
  for (const seat of s.order.filter(x => x !== a)) grant(s, seat, { wood: 4, brick: 4 });
  rig(s, [3, 4]);
  act(s, a, { type: 'roll' });
  assert.equal(s.turn.id, id, 'discard prompts keep the turn id');
  assert.equal(pub(s).prompts.filter(p => p.kind === 'discard').length, 3);
  unchanged(s, () => act(s, a, { type: 'roll' }), /Waiting for other players/);
  serializable(s);
});

test('setup is a snake over the seating order with the setup timer', () => {
  const s = game(3);
  const seen: string[] = [];
  fastForward(s, x => {
    if (x.turn.stage === 'setup' && x.turn.setup!.piece === 'settlement') seen.push(x.turn.active!);
    return x.turn.stage !== 'setup';
  });
  assert.deepEqual(seen, [...s.order, ...[...s.order].reverse()]);
  assert.equal(s.turn.round, 1);
  assert.equal(s.turn.active, s.order[0]);
});

test('paired partner: third seat to the left for 5–6 (2025 rulebook), half the table for 7–10', () => {
  const offsets = [5, 6, 7, 8, 9, 10].map(n => {
    const s = game(n);
    return s.order.indexOf(partnerOf(s, 0)!);
  });
  assert.deepEqual(offsets, [3, 3, 3, 4, 4, 5]);
  assert.equal(partnerOf(game(4), 0), null);
  assert.equal(partnerOf(game(6, { mode: 'connect' }), 0), null);
});

test('5–6 seats: Player 1 main, then the partner paired turn with a new turn id, then the next Player 1', () => {
  const s = game(5);
  pastSetup(s);
  const [p1, next] = [s.order[0], s.order[1]], partner = s.order[3];
  assert.equal(s.turn.partner, partner);
  rig(s, [2, 3]);
  act(s, p1, { type: 'roll' });
  assert.equal(s.turn.stage, 'main');
  assert.ok(view(s, partner).can.skipPaired);
  const main = s.turn.id;
  act(s, p1, { type: 'end' });
  assert.equal(s.turn.stage, 'paired');
  assert.notEqual(s.turn.id, main);
  assert.equal(view(s, partner).task.kind, 'paired');
  assert.equal(pub(s).now.detail, 'Build and trade with the bank only');
  act(s, partner, { type: 'end' });
  assert.equal(s.turn.stage, 'roll');
  assert.equal(s.turn.active, next);
  // A pre-skipped paired turn resolves instantly.
  const skipper = s.turn.partner!;
  act(s, skipper, { type: 'skip-paired', skip: true });
  rig(s, [2, 3]);
  act(s, next, { type: 'roll' });
  act(s, next, { type: 'end' });
  assert.equal(s.turn.stage, 'roll');
  assert.equal(s.turn.active, s.order[2]);
  assert.equal(s.seats[skipper].ready, false);
});

test('7–10 seats: the partner builds alongside Player 1; the turn advances when both end', () => {
  const s = game(8);
  pastSetup(s);
  const p1 = s.turn.active!, partner = s.turn.partner!;
  rig(s, [2, 3]);
  act(s, p1, { type: 'roll' });
  assert.equal(s.turn.stage, 'main');
  assert.equal(view(s, partner).task.kind, 'paired');
  assert.deepEqual(pub(s).now.seats, [p1, partner]);
  const id = s.turn.id;
  act(s, partner, { type: 'end' });
  assert.equal(s.turn.id, id, 'the partner shares Player 1\'s turn id');
  assert.equal(s.turn.stage, 'main');
  act(s, p1, { type: 'end' });
  assert.equal(s.turn.active, s.order[1]);
});

test('round-limit safety net ends a stalled game with reason round-limit', () => {
  const s = game(3);
  pastSetup(s);
  edit(s, n => { n.turn.round = 150; });
  fastForward(s, x => x.turn.stage === 'finale');
  assert.equal(s.results!.reason, 'round-limit');
  assert.equal(s.results!.rounds, 150);
  assert.equal(pub(s).results!.standings.length, 3);
});

test('the round limit scales with target and profile: long legit Connect games are not cut short', () => {
  const connect = { mode: 'connect' } as const;
  const setups = [{}, { ...connect, map: 'seafarers' }, { ...connect, citiesKnights: true }] as const;
  assert.deepEqual(setups.map(o => roundLimit(game(3, o))), [150, 168, 234]);
  const s = game(3, { mode: 'connect', map: 'seafarers' });
  pastSetup(s);
  edit(s, n => { n.turn.round = 120; });
  fastForward(s, x => x.turn.round === 121);
  edit(s, n => { n.turn.round = 168; });
  fastForward(s, x => x.turn.stage === 'finale');
  assert.deepEqual([s.results!.reason, s.results!.rounds], ['round-limit', 168]);
});

test('a win enters the finale: results public, complete only at completeAt, emotes only', () => {
  const s = game(4);
  pastSetup(s);
  const winner = s.order[0];
  edit(s, n => {
    openPrompt(n, { seat: winner, kind: 'gold', scope: 'table', data: { count: 1 } });
    finish(n, [winner], 'target');
  });
  const at = s.now;
  assert.equal(s.turn.stage, 'finale');
  assert.deepEqual(Object.keys(s.prompts), []);
  assert.equal(pub(s).results!.completeAt, at + FINALE_MS);
  assert.equal(pub(s).now.title, `${s.seats[winner].name} wins!`);
  assert.equal(view(s, winner).task.kind, 'finale');
  assert.equal(rules.outcome(s).complete, false);
  unchanged(s, () => act(s, winner, { type: 'end' }), /Only emotes/);
  act(s, winner, { type: 'emote', emote: 'gg' });
  tick(s, at + FINALE_MS - 1);
  assert.equal(s.turn.stage, 'finale');
  tick(s, at + FINALE_MS);
  assert.equal(s.turn.stage, 'ended');
  assert.equal(rules.outcome(s).complete, true);
  assert.deepEqual(rules.outcome(s).winners, [winner]);
  unchanged(s, () => act(s, winner, { type: 'emote', emote: 'gg' }), /finished/);
  serializable(s);
});

test('seats get unique palette indices; humans keep their room colour', () => {
  for (let n = 1; n <= 10; n++) {
    const s = game(n);
    const seats = pub(s).seats, indices = seats.map(x => x.seat);
    assert.equal(new Set(indices).size, seats.length);
    assert.ok(indices.every(i => i >= 0 && i <= 9));
    for (const x of seats) assert.equal(x.color, SEAT_COLORS[x.seat]);
    for (const x of seats.filter(x => !x.cpu)) assert.equal(x.seat, (SEAT_COLORS as readonly string[]).indexOf(x.color));
    assert.equal(seats.length, Math.max(3, n));
  }
  const clash = rules.create({
    roomId: 'r', roundId: 'r', seed: 1, nowMs: 0,
    players: [0, 1, 2].map(i => ({ id: `h${i}`, name: `H${i}`, color: SEAT_COLORS[4] })),
  }, rules.validateSettings({ tableSize: 5 }));
  assert.deepEqual(pub(clash).seats.map(x => x.seat).sort(), [0, 1, 2, 3, 4]);
  assert.equal(pub(clash).seats.find(x => x.id === 'h0')!.seat, 4);
  assert.equal(pub(clash).seats.filter(x => x.cpu).length, 2);
});
