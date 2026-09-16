import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRaceDirector, resolveViewMode, screenMode } from '../src/views';
import { rules } from '../src/server';
import { assertSerializable } from '../../../party-contract/src/serializable';
const ctx = (count: number) => ({ roomId: 'room', roundId: 'round', nowMs: 1000, seed: 42, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: '#fff' })) });

test('Auto uses the active human roster; CPUs and disconnections do not change a running mode', () => {
  for (const count of [1, 2, 3, 4, 5, 10]) {
    const state = rules.create(ctx(count), rules.validateSettings({}));
    assert.equal(state.viewMode, count > 4 ? 'personal' : 'tv');
    rules.onPresenceChange!(state, 'p0', false, 2000);
    assert.equal(state.viewMode, count > 4 ? 'personal' : 'tv');
    assertSerializable(rules.publicView(state, { nowMs: 2000, phase: 'playing' }));
  }
  assert.equal(rules.create(ctx(1), rules.validateSettings({})).racers.length, 8);
});

test('hosts can override Auto in either direction and invalid settings are rejected', () => {
  assert.equal(rules.validateSettings({}).views, 'auto');
  for (const mode of ['tv', 'personal'] as const) for (const count of [1, 4, 5, 10]) {
    assert.equal(resolveViewMode(mode, count), mode);
    assert.equal(rules.create(ctx(count), rules.validateSettings({ views: mode })).viewMode, mode);
  }
  for (const views of ['phones', '', 42, {}, []]) assert.throws(() => rules.validateSettings({ views }), /views/);
});

test('TV phones are controls-only; personal racers get one view and watching screens broadcast', () => {
  for (const count of [1, 4, 5, 10]) {
    for (const mode of ['auto', 'tv', 'personal'] as const) {
      const personal = resolveViewMode(mode, count) === 'personal';
      assert.equal(screenMode(mode, count, 'p0', false), personal ? 'personal' : 'controls');
      assert.equal(screenMode(mode, count, 'p0', true), personal ? 'personal' : 'split');
      assert.equal(screenMode(mode, count, null, true), personal ? 'spectator' : 'split');
      assert.equal(screenMode(mode, count, null, false), personal ? 'spectator' : 'split');
    }
  }
});

test('broadcast holds a shot through position changes, then follows the leader', () => {
  const race = rules.create(ctx(10), rules.validateSettings({})), direct = createRaceDirector();
  race.racers.forEach((racer, i) => { racer.rank = i + 1; });
  assert.equal(direct(race), 'p0');
  race.racers[0].rank = 2; race.racers[1].rank = 1; race.time = 5.9;
  assert.equal(direct(race), 'p0');
  race.time = 6; assert.equal(direct(race), 'p1');
  race.racers[1].finishTime = 6.1; race.time = 6.1;
  assert.equal(direct(race), 'p0');
  race.racers[0].connected = false;
  assert.equal(direct(race), 'p2');
  race.racers.forEach(racer => { racer.finishTime = 8; });
  assert.equal(direct(race), 'p1');
});

test('broadcast resets its hold when race time restarts', () => {
  const race = rules.create(ctx(2), rules.validateSettings({})), direct = createRaceDirector();
  race.racers.forEach((racer, i) => { racer.rank = i + 1; });
  race.time = 100; assert.equal(direct(race), 'p0');
  race.time = 0; race.racers[0].rank = 2; race.racers[1].rank = 1;
  assert.equal(direct(race), 'p1');
});
