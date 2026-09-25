import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRACE_SECONDS, TIMERS, type PromptKind, type TimerPreset } from '../../src/model';
import { dueAt } from '../../src/engine/auto';
import { openPrompt } from '../../src/engine/prompts';
import type { State } from '../../src/engine/state';
import { rules } from '../../src/server';
import { act, edit, fastForward, game, grant, pastSetup, pub, rig, tick } from '../helpers';

const lastAuto = (s: State) => [...s.events].reverse().find(e => e.kind === 'auto');
const presence = (s: State, id: string, on: boolean, now = s.now) => rules.onPresenceChange(s, id, on, now);

/** The step for `seat` expires exactly at `deadline`: nothing at deadline − 1, an auto event at deadline. */
function expiresAt(s: State, seat: string, deadline: number, reason = 'timeout') {
  const rev = s.rev;
  tick(s, deadline - 1);
  assert.equal(s.rev, rev, 'quiet tick before the deadline');
  tick(s, deadline);
  const auto = lastAuto(s);
  assert.ok(auto?.kind === 'auto' && auto.seat === seat && auto.reason === reason, `auto for ${seat}`);
  assert.equal(s.stats.seats[seat].timeouts > 0, true);
}

for (const timer of ['relaxed', 'brisk'] as TimerPreset[]) {
  const T = TIMERS[timer];
  test(`${timer}: setup, roll, main and paired steps auto-resolve at their deadlines`, () => {
    const s = game(5, { timer });
    const placer = s.turn.active!, index = s.turn.setupIndex;
    expiresAt(s, placer, s.now + T.setup! * 1000);
    assert.equal(s.turn.setupIndex, index + 1);
    pastSetup(s);
    const p1 = s.turn.active!, partner = s.turn.partner!;
    rig(s, [2, 3]);
    expiresAt(s, p1, s.now + T.roll! * 1000);
    assert.equal(s.turn.stage, 'main');
    expiresAt(s, p1, s.now + T.main! * 1000);
    assert.equal(s.turn.stage, 'paired');
    expiresAt(s, partner, s.now + T.paired! * 1000);
    assert.equal(s.turn.stage, 'roll');
    assert.equal(s.turn.active, s.order[1]);
  });

  test(`${timer}: discard, robber and gold prompts auto-resolve at their deadlines`, () => {
    const s = game(4, { timer });
    pastSetup(s);
    const roller = s.turn.active!, victim = s.order[1];
    grant(s, victim, { ore: 9 });
    rig(s, [5, 2]);
    act(s, roller, { type: 'roll' });
    const opened = s.now;
    expiresAt(s, victim, opened + T.discard! * 1000);
    assert.equal(s.seats[victim].hand.ore < 9, true, 'biggest pile discarded first');
    const robber = Object.values(s.prompts).find(p => p.kind === 'robber')!;
    assert.equal(robber.deadline, s.now + T.robber! * 1000);
    expiresAt(s, roller, robber.deadline!);
    assert.equal(s.turn.stage, 'main');
    const kinds: [PromptKind, number][] = [['gold', T.prompt!], ['discard', T.discard!]];
    for (const [kind, seconds] of kinds) {
      const seat = s.order[2];
      if (kind === 'discard') grant(s, seat, { wood: 8 });
      edit(s, n => { openPrompt(n, { seat, kind, scope: 'table', data: { count: kind === 'gold' ? 2 : 4 } }); });
      expiresAt(s, seat, s.now + seconds * 1000);
      assert.equal(Object.keys(s.prompts).length, 0);
    }
  });
}

test('a step that expires behind its own open prompt waits quietly, then auto-plays with the prompt', () => {
  const s = game(3, { timer: 'relaxed' });
  pastSetup(s);
  rig(s, [2, 3]);
  const a = s.turn.active!;
  act(s, a, { type: 'roll' });
  const step = s.timers[a].deadline!;
  const gold = { seat: a, kind: 'gold', scope: 'table', data: { count: 1 } } as const;
  edit(s, n => { openPrompt(n, gold); }, step - 1000);
  const prompt = Object.values(s.prompts)[0].deadline!, rev = s.rev;
  assert.equal(dueAt(s), prompt, 'the overdue step does not make every tick due');
  tick(s, step + 1000);
  assert.equal(s.rev, rev, 'no commit while the prompt is open');
  tick(s, prompt);
  assert.deepEqual([Object.keys(s.prompts).length, s.turn.active !== a], [0, true], 'both auto-played');
});

test('off: nothing ever expires, except under disconnect grace', () => {
  const s = game(3, { timer: 'off' });
  assert.equal(dueAt(s), Infinity);
  tick(s, s.now + 1e9);
  assert.equal(s.turn.setupIndex, 0);
  const placer = s.turn.active!;
  presence(s, placer, false);
  assert.equal(pub(s).seats.find(x => x.id === placer)!.deadline, s.now + GRACE_SECONDS.disconnected * 1000);
  expiresAt(s, placer, s.now + GRACE_SECONDS.disconnected * 1000, 'disconnected');
  assert.equal(s.turn.setupIndex, 1);
});

test('disconnect: owing nothing never delays anyone; owing gets grace, then away after two autos', () => {
  const s = game(4, { timer: 'relaxed' });
  const idle = s.order[3], placer = s.turn.active!, due = dueAt(s);
  presence(s, idle, false);
  assert.equal(dueAt(s), due, 'an idle disconnect changes no deadline');
  assert.equal(pub(s).seats.find(x => x.id === idle)!.status, 'offline');
  presence(s, placer, false);
  expiresAt(s, placer, s.now + GRACE_SECONDS.disconnected * 1000, 'disconnected');
  assert.equal(s.seats[placer].away, false);
  assert.equal(s.turn.active, placer, 'the setup route is the same seat\'s next step');
  expiresAt(s, placer, s.now + GRACE_SECONDS.disconnected * 1000, 'disconnected');
  assert.equal(s.seats[placer].away, true);
  fastForward(s, x => x.turn.active === placer);
  assert.equal(s.timers[placer].deadline, s.now + GRACE_SECONDS.away * 1000);
  presence(s, placer, true, s.now + 1000);
  assert.equal(s.seats[placer].away, false);
  assert.ok(s.timers[placer].deadline! >= s.now + GRACE_SECONDS.reconnect * 1000);
});

test('reconnect restores at least 15 s; with Off the grace deadline is removed', () => {
  const relaxed = game(3, { timer: 'relaxed' });
  pastSetup(relaxed);
  const a = relaxed.turn.active!, base = relaxed.timers[a].base!;
  presence(relaxed, a, false);
  presence(relaxed, a, true, base - 2000);
  assert.equal(relaxed.timers[a].deadline, base - 2000 + GRACE_SECONDS.reconnect * 1000);
  const off = game(3, { timer: 'off' });
  const p = off.turn.active!;
  presence(off, p, false);
  assert.notEqual(off.timers[p].deadline, null);
  presence(off, p, true, off.now + 20_000);
  assert.equal(off.timers[p].deadline, null);
  assert.equal(pub(off).clock, null);
});
