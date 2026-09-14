import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, launchForce, type State } from '../src/server';
import { neutralInput, STAGE, type Input } from '../src/model';
import { HeldInputChannel } from '../../../party-client/src/held-input';

function create(count = 2, stocks = 3) {
  return rules.create({ roomId: 'room', roundId: 'round', nowMs: 1000, seed: 17,
    players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player000000000${i}`, color: '#28c6e7' })) }, { stocks, seconds: 60 });
}
function fight(count = 2, stocks = 3) { const state = create(count, stocks); state.phase = 'fight'; state.endsAt = 61000; return state; }
function tick(state: State, frames = 1, entries: [string, Input][] = [], start = 1000) { for (let frame = 1; frame <= frames; frame++) rules.tick(state, new Map(entries), 1 / 60, start + frame * 1000 / 60); }
function input(value: Partial<Input> = {}): Input { return { ...neutralInput(), ...value }; }

test('selection rejects stale/invalid choices and all choices advance after a readable minimum', () => {
  const state = create();
  assert.throws(() => rules.parseAction({ turnId: 'round', kind: '__proto__' }));
  assert.throws(() => rules.applyAction(state, 'p0', { turnId: 'old', kind: 'falco' }, 1000));
  for (const p of state.players) rules.applyAction(state, p.id, { turnId: 'round', kind: 'falco' }, 1000);
  assert.throws(() => rules.applyAction(state, 'p0', { turnId: 'round', kind: 'fox' }, 1100));
  tick(state); assert.equal(state.phase, 'select');
  rules.tick(state, new Map(), 1 / 60, 4000); assert.equal(state.phase, 'vote');
  for (const p of state.players) rules.applyAction(state, p.id, { turnId: 'round', stage: 'cloudbreak' }, 4000);
  rules.tick(state, new Map(), 1 / 60, 4000); assert.equal(state.phase, 'countdown');
  assert.throws(() => rules.applyAction(state, 'p0', { turnId: 'round', kind: 'fox' }, 4000));
  rules.tick(state, new Map(), 1 / 60, 7000); assert.equal(state.phase, 'fight'); assert.equal(state.endsAt, 67000);
});

test('missing choices use defaults, and wall time ends a match even after a stall', () => {
  const state = create(); rules.tick(state, new Map(), 1 / 60, 61000); assert.equal(state.phase, 'vote');
  rules.tick(state, new Map(), 1 / 60, 81000); assert.equal(state.phase, 'countdown');
  rules.tick(state, new Map(), 1 / 60, 84000); assert.equal(state.phase, 'fight');
  rules.tick(state, new Map(), 1 / 60, 150000); assert.equal(rules.outcome(state).complete, true);
});

test('inputs reject malformed axes, buttons, counters, extra fields, and settings', () => {
  for (const value of [null, [], { ...input(), x: NaN }, { ...input(), x: 2 }, { ...input(), jump: 1 }, { ...input(), presses: { jump: -1, attack: 0, special: 0, smash: 0 } }, { ...input(), extra: 1 }]) assert.throws(() => rules.parseInput(value));
  for (const value of [{ seconds: -1 }, { stocks: 999 }, { extra: true }]) assert.throws(() => rules.validateSettings(value));
  assert.deepEqual(rules.validateSettings({}), { stocks: 3, seconds: 900 });
});

test('a coalesced short tap jumps once and old counter heartbeats cannot repeat it', () => {
  const state = fight(), p = state.players[0], tap = input({ presses: { jump: 1, attack: 0, special: 0, smash: 0 } });
  tick(state, 4, [['p0', tap]]); assert.ok(p.y > 0); assert.equal(p.jumps, 1);
  tick(state, 90, [['p0', tap]]); assert.equal(p.grounded, true); assert.equal(p.y, 0); assert.equal(p.jumps, 2);
  tick(state, 5, [['p0', tap]]); assert.equal(p.y, 0);
});

test('the actual 20 Hz channel preserves a press and release between network sends', () => {
  const state = fight(), sent: Input[] = [], channel = new HeldInputChannel((kind, value) => { if (kind === 'state') sent.push(value as Input); });
  channel.set(input(), 0);
  channel.set(input({ attack: true, presses: { jump: 0, attack: 1, special: 0, smash: 0 } }), 10);
  channel.set(input({ presses: { jump: 0, attack: 1, special: 0, smash: 0 } }), 20);
  assert.equal(sent.length, 1); channel.flush(50); assert.equal(sent.length, 2);
  tick(state, 1, [['p0', rules.parseInput(sent[1])]]); assert.equal(state.players[0].move, 'jab');
  tick(state, 60, [['p0', sent[1]]]); assert.equal(state.players[0].move, null);
});

test('two jumps, finite recovery, and landing restore movement resources', () => {
  const state = fight(), p = state.players[0]; p.x = -7;
  tick(state, 4, [['p0', input({ jump: true, presses: { jump: 1, attack: 0, special: 0, smash: 0 } })]]);
  tick(state, 1, [['p0', input({ jump: true, presses: { jump: 2, attack: 0, special: 0, smash: 0 } })]]); assert.equal(p.jumps, 0);
  tick(state, 1, [['p0', input({ y: -1, presses: { jump: 2, attack: 0, special: 1, smash: 0 } })]]); assert.equal(p.move, 'rise'); assert.equal(p.recoveryUsed, true);
  tick(state, 90); tick(state, 1, [['p0', input({ y: -1, presses: { jump: 2, attack: 0, special: 2, smash: 0 } })]]); assert.notEqual(p.move, 'rise');
  tick(state, 180); assert.equal(p.grounded, true); assert.equal(p.jumps, 2); assert.equal(p.recoveryUsed, false);
});

test('attacks have startup, hit once per target, and grow knockback with damage and lower weight', () => {
  const state = fight(), [p, target] = state.players; p.x = -.5; target.x = .5;
  const attack = input({ presses: { jump: 0, attack: 1, special: 0, smash: 0 } });
  tick(state, 1, [['p0', attack]]); assert.equal(target.damage, 0);
  tick(state, 6, [['p0', attack]]); assert.equal(target.damage, 4); assert.equal(target.mode, 'hurt');
  tick(state, 20, [['p0', attack]]); assert.equal(target.damage, 4);
  assert.ok(launchForce(150, 10, 82, 25, 90) > launchForce(20, 10, 82, 25, 90));
  assert.ok(launchForce(100, 10, 82, 25, 90) > launchForce(100, 10, 118, 25, 90));
});

test('simultaneous attacks trade without roster-order advantage', () => {
  const state = fight(), [a, b] = state.players; a.x = -.5; b.x = .5; b.kind = 'fox';
  const attack = input({ attack: true, presses: { jump: 0, attack: 1, special: 0, smash: 0 } });
  tick(state, 5, [['p0', attack], ['p1', attack]]);
  assert.equal(a.damage, 4); assert.equal(b.damage, 4);
});

test('shield absorbs damage, drains, breaks, and releases', () => {
  const state = fight(), [p, target] = state.players; p.x = -.5; target.x = .5;
  tick(state, 6, [['p0', input({ attack: true })], ['p1', input({ shield: true })]]);
  assert.equal(target.damage, 0); assert.ok(target.shield < 94); assert.ok(state.impacts.some(e => e.kind === 'block'));
  tick(state, 215, [['p1', input({ shield: true })]]); assert.equal(target.mode, 'hurt');
  tick(state, 130); assert.ok(target.shield > 0); assert.notEqual(target.mode, 'shield');
});

test('fall-through affects raised platforms; the main floor catches the fighter', () => {
  const state = fight(), p = state.players[0]; p.x = -4; p.y = 2.7; p.grounded = true;
  tick(state, 50, [['p0', input({ y: 1 })]]); assert.equal(p.y, 0); assert.equal(p.grounded, true);
});

test('blast zones cost stocks, credit recent attacker, respawn safely, and finish on last survivor', () => {
  const state = fight(), [p, target] = state.players; target.lastHitBy = p.id; target.lastHitAt = 1000; target.x = STAGE.blastX + 2;
  tick(state); assert.equal(target.stocks, 2); assert.equal(p.kos, 1); assert.equal(target.mode, 'respawn'); assert.equal(target.damage, 0);
  tick(state, 65); assert.ok(target.invulnerable); assert.equal(target.stocks, 2);
  target.stocks = 1; target.y = STAGE.blastBottom - 2; tick(state);
  assert.equal(state.phase, 'complete'); assert.deepEqual(rules.outcome(state).winners, [p.id]);
});

test('disconnect is neutral, reconnect preserves fighter, and 15 seconds absent forfeits', () => {
  const state = fight(), p = state.players[0];
  rules.onPresenceChange(state, p.id, false, 1000); tick(state, 30, [[p.id, input({ x: 1 })]]); assert.equal(p.x, -1.6);
  rules.onPresenceChange(state, p.id, true, 2000); tick(state, 10, [[p.id, input({ x: 1 })]], 2000); assert.ok(p.x > -1.6);
  rules.onPresenceChange(state, p.id, false, 3000); rules.tick(state, new Map(), 1 / 60, 18000); assert.equal(p.stocks, 0); assert.equal(state.phase, 'complete');
});

test('maximum roster, timeout tie rules, public projection isolation, and replay start clean', () => {
  const state = fight(4); state.players[0].damage = 20; state.players[1].stocks = 2;
  rules.tick(state, new Map(), 1 / 60, state.endsAt); assert.deepEqual(rules.outcome(state).winners, ['p2', 'p3']);
  const view = rules.publicView(state, { nowMs: 61000, phase: 'results' });
  assert.equal('pending' in view.players[0], false); assert.equal('lastHitBy' in view.players[0], false);
  view.players[0].presses.attack = 50; assert.equal(state.players[0].presses.attack, 0);
  const replay = create(4); assert.ok(replay.players.every(p => !p.chosen && p.damage === 0 && p.stocks === 3 && !p.kos));
});

test('four-player sustained combat stays finite and reaches authoritative results', () => {
  const state = fight(4, 5); let random = 27;
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
  const counts = state.players.map(() => zeroCounts());
  function zeroCounts() { return { jump: 0, attack: 0, special: 0, smash: 0 }; }
  for (let frame = 0; frame <= 3601 && state.phase !== 'complete'; frame++) {
    const entries: [string, Input][] = state.players.map((p, index) => {
      const other = state.players.filter(q => q.id !== p.id && q.stocks).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      if (frame % 45 === 0) counts[index].jump++;
      if (frame % 80 === 0) counts[index].special++;
      return [p.id, input({ x: other ? Math.sign(other.x - p.x) : 0, y: next() > .5 ? -.8 : .8, jump: frame % 45 < 12, attack: true, shield: frame % 200 > 170, presses: { ...counts[index] } })];
    });
    rules.tick(state, new Map(entries), 1 / 60, 1000 + frame * 1000 / 60);
    for (const p of state.players) { assert.ok([p.x, p.y, p.vx, p.vy, p.damage, p.shield].every(Number.isFinite)); assert.ok(p.stocks >= 0 && p.stocks <= 5); }
  }
  assert.equal(state.phase, 'complete'); assert.ok(state.players.some(p => p.damage > 0 || p.falls > 0));
});
