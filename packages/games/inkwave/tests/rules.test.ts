import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/server';
import { MAPS, WEAPON_ORDER } from '../src/options.js';
import type { Choice, Input, Settings } from '../src/model';
import { assertSerializable } from '../../../../../apps/party-server/src/room-server';

const players = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Player000000000${index}`, color: '#ff5748', lobbyChoice: { weapon: WEAPON_ORDER[index % WEAPON_ORDER.length] } }));
function create(count = 8, settings: Partial<Settings> = {}, seed = 123) { return rules.create({ roomId: 'inkwave-test', roundId: 'test-round', players: players(count), seed, nowMs: 1000 }, rules.validateSettings({ duration: 30, ...settings })); }
function advance(state: ReturnType<typeof create>, seconds: number, inputs = new Map<string, Input>()) {
  for (let step = 0; step < seconds * 60 && !rules.outcome(state).complete; step++) rules.tick(state, inputs, 1 / 60, state.lastNow + 1000 / 60);
}

test('validates settings, loadouts and bounded finite controls', () => {
  assert.equal(rules.validateSettings({}).duration, 180);
  for (const raw of [{ map: 'missing' }, { map: 'cargo', mode: 'boss' }, { mode: 'unknown' }, { duration: 0 }]) assert.throws(() => rules.validateSettings(raw));
  assert.equal((rules.parseLobbyChoice!({ weapon: 'bow', style: { hat: 3 } }, true) as { weapon: string }).weapon, 'bow');
  assert.throws(() => rules.parseLobbyChoice!({ weapon: 'unknown' }, true));
  const look = { hair: 7, skin: 8, outfit: 9, hat: 3, eyes: 7, brows: 3 };
  assert.deepEqual((rules.parseLobbyChoice!({ style: look }, true) as Choice).style, look);
  for (const key of Object.keys(look)) assert.throws(() => rules.parseLobbyChoice!({ style: { [key]: 99 } }, true));
  for (const bad of [NaN, Infinity, 2, '1']) assert.throws(() => rules.parseInput({ ...rules.neutralInput(), moveX: bad }));
  assert.throws(() => rules.parseInput({ ...rules.neutralInput(), fire: 'true' }));
  const input = rules.parseInput({ ...rules.neutralInput(), moveX: 1, moveY: 1 });
  assert.ok(Math.hypot(input.moveX, input.moveY) <= 1);
});

test('real input paints turf, release stops firing, and results rank the winning team', () => {
  const state = create(1), input = { ...rules.neutralInput(), hasAim: true, yaw: 0, pitch: -.3, aimX: 0, aimY: 0, aimZ: 0, moveY: 1, fire: true };
  try {
    advance(state, 15, new Map([['p0', input]]));
    assert.ok(state.view.stats[0].turf > 0);
    advance(state, 1);
    assert.equal(state.view.actors[0][10] & 4096, 0);
    advance(state, 30);
    assert.equal(rules.outcome(state).complete, true);
    assert.equal(rules.outcome(state).rows[0].rank, state.view.result!.winner === 0 ? 1 : 2);
    assertSerializable(state.view); assertSerializable(rules.outcome(state));
  } finally { rules.dispose(state); }
});

test('weapon state and seeded randomness stay isolated between simultaneous rooms', () => {
  const a = create(1), b = create(1), reference = create(1);
  try {
    advance(reference, 15);
    for (let step = 0; step < 900; step++) { advance(a, 1 / 60); advance(b, 1 / 60); }
    assert.deepEqual(a.view, reference.view); assert.deepEqual(b.view, reference.view);
    rules.dispose(a); advance(b, 15); advance(reference, 15);
    assert.deepEqual(b.view, reference.view);
  } finally { rules.dispose(b); rules.dispose(reference); }
});

test('disconnect takes over with a bot and reconnect restores the same seat', () => {
  const state = create();
  try {
    rules.onPresenceChange(state, 'p0', false, state.lastNow); advance(state, 14);
    assert.ok(state.view.stats[0].turf > 0);
    const id = state.view.roster[0].id;
    rules.onPresenceChange(state, id, true, state.lastNow); advance(state, 2);
    assert.equal(state.view.roster[0].id, id); assert.equal(state.view.actors[0][10] & 4096, 0);
  } finally { rules.dispose(state); }
});

test('stale, enemy and duplicate Super Jumps cannot alter a match', () => {
  const state = create();
  try {
    advance(state, 5);
    assert.throws(() => rules.applyAction(state, 'p0', { type: 'superjump', turnId: 'old-round', target: 2 }, state.lastNow));
    assert.throws(() => rules.applyAction(state, 'p0', { type: 'superjump', turnId: 'test-round', target: 1 }, state.lastNow));
    const action = { type: 'superjump' as const, turnId: 'test-round', target: 2 };
    rules.applyAction(state, 'p0', action, state.lastNow);
    assert.throws(() => rules.applyAction(state, 'p0', action, state.lastNow));
  } finally { rules.dispose(state); }
});

test('wall-clock deadline survives a stalled scheduler', () => {
  const state = create();
  try { advance(state, 5); rules.tick(state, new Map(), 1 / 60, state.lastNow + 40000); advance(state, 3); assert.equal(rules.outcome(state).complete, true); }
  finally { rules.dispose(state); }
});

for (const map of MAPS) test(`${map.name}: maximum roster reaches serializable results`, () => {
  const state = create(8, { map: map.id });
  try {
    const input = { ...rules.neutralInput(), moveY: 1, fire: true, sub: true };
    advance(state, 40, new Map(players(8).map(player => [player.id, input])));
    assert.equal(rules.outcome(state).complete, true); assertSerializable(state.view);
    assert.ok(Buffer.byteLength(JSON.stringify(state.view)) < 256 * 1024);
  } finally { rules.dispose(state); }
});

test('Zone Control reaches an authoritative result, including possible overtime', () => {
  const state = create(1, { mode: 'zones' });
  try { advance(state, 350); assert.equal(rules.outcome(state).complete, true); assert.ok(state.view.zones); assertSerializable(state.view); }
  finally { rules.dispose(state); }
});


test('Cargo Terminal requires two humans and never fills or replaces seats with CPUs', () => {
  assert.throws(() => create(1, { map: 'cargo' }), /two human/);
  const state = create(2, { map: 'cargo' });
  try {
    assert.equal(state.view.roster.length, 2); assert.ok(state.view.roster.every(p => !p.bot));
    advance(state, 5); rules.onPresenceChange(state, 'p0', false, state.lastNow); advance(state, 8);
    assert.equal(state.view.actors[0][10] & 1, 0); assert.equal(state.view.stats[0].turf, 0);
    rules.onPresenceChange(state, 'p0', true, state.lastNow); advance(state, 1);
    assert.equal(state.view.actors[0][10] & 1, 1); assertSerializable(state.view);
  } finally { rules.dispose(state); }
});

test('Boss Battle puts humans and CPUs in one squad and replicates an authoritative defeat', () => {
  const state = create(2, { mode: 'boss' });
  try {
    assert.equal(state.view.roster.length, 8); assert.ok(state.view.roster.every(p => p.team === 0));
    advance(state, 20); assert.ok(state.view.boss); assert.ok(state.view.bossMoves.length); assertSerializable(state.view);
    advance(state, 30); assert.equal(rules.outcome(state).complete, true);
    assert.equal(state.view.result!.winner, 1); assert.deepEqual(rules.outcome(state).winners, []);
  } finally { rules.dispose(state); }
});

// Drive real boss damage in the room context to exercise phase changes and cooperative victory.
test('boss phases, weak-point scoring and victory stay isolated between rooms', () => {
  const a = create(2, { mode: 'boss', duration: 180 }), b = create(2, { mode: 'boss', duration: 180 });
  const engine = a.engine as typeof a.engine & { run(fn: () => void): void; context: { actors: unknown[]; boss: { maxHp: number; invuln: boolean; applyDamage(actor: unknown, amount: number, weak: boolean, point: null): void } } };
  const damage = (fraction: number) => engine.run(() => { const { boss, actors } = engine.context; boss.invuln = false; boss.applyDamage(actors[0], boss.maxHp * fraction, true, null); });
  try {
    advance(a, 15); advance(b, 15); const before = structuredClone(b.view);
    damage(.4); advance(a, 10); assert.equal(a.view.boss![8], 2);
    damage(.4); advance(a, 10); assert.equal(a.view.boss![8], 3);
    damage(1); advance(a, 8);
    assert.equal(a.view.result!.winner, 0); assert.deepEqual(rules.outcome(a).winners, ['p0', 'p1']);
    assert.ok(a.view.stats[0].bossDmg! > 0); assert.equal(a.view.stats[0].weakHits, 3);
    assert.deepEqual(b.view, before); assertSerializable(a.view);
  } finally { rules.dispose(a); rules.dispose(b); }
});
