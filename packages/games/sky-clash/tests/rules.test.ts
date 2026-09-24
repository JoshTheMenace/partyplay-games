import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, neutralInput } from '../src/model';
import { MOVESET } from '../src/moveset';
import { rules } from '../src/server';
import { arena } from '../src/sim/harness';

test('validateSettings: {} is the default; every field is range-checked; unknown fields are rejected', () => {
  assert.deepEqual(rules.validateSettings({}), DEFAULT_SETTINGS);
  assert.deepEqual(rules.validateSettings(undefined), DEFAULT_SETTINGS); assert.deepEqual(rules.validateSettings(null), DEFAULT_SETTINGS);
  const full = { stocks: 5, seconds: 0, cpus: 3, cpuLevel: 3, teams: true, hazards: false, stage: 'battlefield', lcancel: 'melee', recovery: 'melee' } as const;
  assert.deepEqual(rules.validateSettings(full), full);
  assert.equal(rules.validateSettings({ stage: 'random' }).stage, 'random'); assert.equal(rules.validateSettings({ recovery: 'party' }).recovery, 'party');
  for (const bad of [{ stocks: 0 }, { stocks: 6 }, { stocks: 2.5 }, { seconds: 90 }, { cpus: 4 }, { cpus: -1 }, { cpuLevel: 0 }, { teams: 'yes' }, { hazards: 1 },
    { stage: 'hyrule' }, { lcancel: 'off' }, { recovery: 'on' }, { recovery: null }, { extra: 1 }, [], 'x']) assert.throws(() => rules.validateSettings(bad), JSON.stringify(bad));
});
test('parseInput accepts the phone shape and rejects anything else', () => {
  const ok = { x: .5, y: -1, held: { attack: true, special: false, jump: false, shield: false, smash: false }, presses: { attack: 3, special: 0, jump: 1, shield: 0, smash: 0, grab: 2 }, aim: { x: 1, y: 0 } };
  assert.deepEqual(rules.parseInput(ok), ok);
  assert.deepEqual(rules.parseInput(neutralInput()), neutralInput());
  const mut = (f: (v: any) => void) => { const v = structuredClone(ok) as any; f(v); return v; };
  for (const bad of [mut(v => { v.x = 1.2; }), mut(v => { v.y = NaN; }), mut(v => { v.held.attack = 1; }), mut(v => { v.presses.grab = -1; }), mut(v => { v.presses.jump = 1.5; }),
    mut(v => { delete v.aim; }), mut(v => { v.extra = 0; }), mut(v => { v.held.taunt = true; }), mut(v => { v.presses.jump = 2e7; }), null, 7])
    assert.throws(() => rules.parseInput(bad));
});
test('parseAction: taunt with a turn id only', () => {
  assert.deepEqual(rules.parseAction({ turnId: 'r1', type: 'taunt' }), { turnId: 'r1', type: 'taunt' });
  for (const bad of [{ turnId: 'r1' }, { turnId: '', type: 'taunt' }, { turnId: 'x'.repeat(129), type: 'taunt' }, { turnId: 'r1', type: 'taunt', x: 1 }, { turnId: 'r1', type: 'jump' }])
    assert.throws(() => rules.parseAction(bad));
});
test('parseLobbyChoice: partial drafts pass; ready needs fighter and stage; costumes 0–3; Random wears costume 0', () => {
  const p = rules.parseLobbyChoice!;
  assert.deepEqual(p({}, false), { fighter: null, costume: 0, stage: null });
  assert.deepEqual(p({ fighter: 'marth', costume: 3 }, false), { fighter: 'marth', costume: 3, stage: null });
  assert.deepEqual(p({ fighter: 'random', costume: 2, stage: 'random' }, true), { fighter: 'random', costume: 0, stage: 'random' });
  assert.deepEqual(p({ fighter: 'fox', costume: 1, stage: 'yoshi-story' }, true), { fighter: 'fox', costume: 1, stage: 'yoshi-story' });
  for (const [bad, ready] of [[{ fighter: 'fox' }, true], [{ stage: 'battlefield' }, true], [{ fighter: 'waluigi' }, false], [{ fighter: 'fox', costume: 4 }, false],
    [{ fighter: 'fox', costume: -1 }, false], [{ stage: 'hyrule' }, false], [{ fighter: 'fox', kind: 'x' }, false], ['fox', false]] as const)
    assert.throws(() => p(bad, ready), JSON.stringify(bad));
});
test('taunt action: current round only, and only from a grounded neutral state', () => {
  const a = arena({ fighters: ['mario', 'fox'] });
  assert.throws(() => rules.applyAction(a.s, 'p0', { turnId: 'old', type: 'taunt' }, 0));
  rules.applyAction(a.s, 'p0', { turnId: a.s.turnId, type: 'taunt' }, 0);
  assert.equal(a.f(0).move, 'taunt');
  assert.ok(a.s.events.some(e => e.kind === 'taunt' && e.source === 'p0'));
  a.tick(MOVESET.mario.taunt!.total + 2);
  assert.equal(a.f(0).move, null);
});
