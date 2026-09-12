import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTRIBUTES } from '../fidelity/attributes';
import { getMove, neutralInput, VELOCITY, type FighterKind, type Input } from '../src/model';
import { rules, launchForce } from '../src/server';
import { assertSerializable } from '../../../party-contract/src/serializable';
const create = (kind: FighterKind = 'fox') => {
  const state = rules.create({ roomId: 'r', roundId: 'round', nowMs: 0, seed: 1, players: [{ id: 'a', name: 'A', color: '#fff' }, { id: 'b', name: 'B', color: '#000' }] }, { seconds: 60, stocks: 3 });
  state.phase = 'fight'; state.players[0].kind = kind; state.players[0].x = -6; state.players[1].x = 6; return state;
};
function tick(state: ReturnType<typeof create>, frames: number, a = neutralInput(), b = neutralInput()) {
  for (let i = 0; i < frames; i++) rules.tick(state, new Map([['a', a], ['b', b]]), 1 / 60, (state.frame + 1) * 1000 / 60);
}
const press = (button: 'jump' | 'attack' | 'special' | 'smash', extra: Partial<Input> = {}): Input => ({ ...neutralInput(), [button]: true, ...extra, presses: { ...neutralInput().presses, [button]: 1 } });

test('both fighters retain sourced stats; jump startup, short hop and full hop use their own values', () => {
  assert.equal(ATTRIBUTES.fox.weight, 75); assert.equal(ATTRIBUTES.falco.weight, 80);
  assert.ok(ATTRIBUTES.falco.jump_v_initial_velocity > ATTRIBUTES.fox.jump_v_initial_velocity);
  for (const kind of ['fox', 'falco'] as const) for (const held of [true, false]) {
    const state = create(kind), p = state.players[0], input = press('jump', { jump: held }), a = ATTRIBUTES[kind];
    tick(state, a.jump_startup_time, input); assert.equal(p.y, 0); assert.equal(p.mode, 'jumpsquat');
    tick(state, 1, input); assert.equal(p.vy, (held ? a.jump_v_initial_velocity : a.hop_v_initial_velocity) * VELOCITY); assert.equal(p.jumps, 1);
  }
});

test('scripts retain startup, late hits, loops, interruptibility and ground/air masks', () => {
  assert.deepEqual(getMove('fox', 'jab').windows.map(w => [w.from, w.to]), [[2, 3], [3, 4]]);
  assert.equal(getMove('fox', 'jab').end, 16);
  assert.deepEqual(getMove('fox', 'downair').windows.map(w => [w.from, w.to, w.hitboxes[0].damage]), [[5, 7, 3], [8, 10, 3], [11, 13, 3], [14, 16, 3], [17, 19, 3], [20, 22, 3], [23, 25, 3]]);
  assert.deepEqual(getMove('falco', 'downair').windows.map(w => [w.from, w.to, w.hitboxes[0].damage]), [[5, 15, 12], [15, 25, 9]]);
  assert.equal(getMove('fox', 'upsmash').windows[0].hitboxes[0].damage, 18);
  assert.equal(getMove('falco', 'upsmash').windows[0].hitboxes[0].damage, 14);
});

test('charging holds the sourced charge frame, releases, and boosts the original move damage', () => {
  const state = create(), [p, target] = state.players; p.x = -.5; target.x = .5;
  const held = press('smash'); tick(state, 20, held);
  assert.equal(p.move, 'smash'); assert.equal(p.moveFrame, getMove('fox', 'smash').chargeFrame); assert.ok(p.charge > 0); assert.equal(target.damage, 0);
  tick(state, 12, { ...held, smash: false }); assert.ok(target.damage > getMove('fox', 'smash').windows[0].hitboxes[0].damage);
});

test('Fox lasers damage without flinching; Falco lasers interrupt and shields block them', () => {
  for (const kind of ['fox', 'falco'] as const) for (const guard of [false, true]) {
    const state = create(kind), [p, target] = state.players; p.x = -3; target.x = 0;
    tick(state, getMove(kind, 'laser').startup + 5, press('special'), { ...neutralInput(), shield: guard });
    assert.equal(target.damage, guard ? 0 : 3);
    if (!guard) assert.equal(target.mode === 'hurt', kind === 'falco');
    else assert.ok(target.shield < 95);
    assert.equal(state.projectiles.length, 0);
  }
});

test('reflector reverses projectile ownership, direction and damage without self-hitting', () => {
  const state = create(), [p, target] = state.players; p.x = -3; target.x = 0;
  tick(state, 10, press('special'));
  tick(state, 3, neutralInput(), press('special', { y: 1 }));
  assert.equal(target.damage, 0); assert.ok(state.projectiles.some(shot => shot.owner === target.id && shot.vx < 0 && shot.damage === 4.5));
  tick(state, 6); assert.equal(p.damage, 4.5);
});

test('recovery charges before moving, uses one airtime resource, and airdodge cannot repeat', () => {
  const state = create(), p = state.players[0]; p.y = 2; p.grounded = false; p.jumps = 1;
  tick(state, 42, press('special', { y: -1 })); assert.equal(p.y, 2); assert.equal(p.recoveryUsed, true);
  tick(state, 1, press('special', { y: -1 })); assert.ok(p.y > 2); assert.ok(p.vy > 0);
  const dodge = create(), q = dodge.players[0]; q.y = 3; q.grounded = false;
  tick(dodge, 1, { ...neutralInput(), shield: true, x: 1 }); assert.equal(q.mode, 'dodge'); assert.equal(q.recoveryUsed, true); assert.equal(q.jumps, 0);
  tick(dodge, 1); tick(dodge, 1, { ...neutralInput(), shield: true }); assert.equal(q.dodge, 46);
});

test('aerial landing lag is sourced and prevents attacks until it expires', () => {
  const state = create(), p = state.players[0]; p.y = .15; p.grounded = false; p.vy = -1; p.move = 'aerial'; p.moveFrame = 8;
  tick(state, 10); assert.equal(p.grounded, true); assert.ok(p.lag > 0); const lag = p.lag;
  tick(state, 1, press('attack')); assert.equal(p.move, null); assert.equal(p.lag, lag - 1);
});

test('standard and fixed knockback formulas and actual transport projections stay valid', () => {
  assert.ok(Math.abs(launchForce(100, 10, 100, 20, 100) - 122) < .001);
  assert.equal(launchForce(20, 3, 75, 0, 100, 30), launchForce(150, 12, 75, 0, 100, 30));
  const state = create(); tick(state, 12, press('special'));
  assertSerializable(rules.publicView(state, { nowMs: 200, phase: 'playing' }));
  assertSerializable(rules.outcome(state)); assert.equal(rules.playerView(state, 'a', { nowMs: 200, phase: 'playing' }), null);
});
