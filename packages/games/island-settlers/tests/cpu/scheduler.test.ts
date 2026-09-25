/**
 * decide() inside the real CPU scheduler (server.ts cpuStep with per-CPU think delays): CPU seats
 * finish a game with no error fallbacks, and each CPU's actions land at least a think delay apart.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../../src/cpu/index';
import { tick } from '../../src/engine/index';
import { cpuStep, rules } from '../../src/server';
import { seeded } from '../fixtures/board';
import { act, pub, view } from '../helpers';
import { enginePlays } from './match';

const OWN = new Set(['build', 'bank', 'dev-buy', 'dev-play', 'discard', 'robber', 'offer', 'take', 'roll']);
const skip = enginePlays() ? false : 'engine does not play a full game yet';

test('scheduler-driven CPUs (1 human + CPUs) finish by target with per-CPU pacing', { skip }, () => {
  for (const tableSize of [4, 10]) {
    const players = [{ id: 'h', name: 'Human', color: '#ff5748' }];
    const s = rules.create({ roomId: 'r', roundId: 'x', seed: 77 + tableSize, nowMs: 0, players },
      rules.validateSettings({ tableSize }));
    const human = { level: 'normal' as const, persona: 'trader', memory: null as unknown, random: seeded(5) };
    const last = new Map<string, number>(), gaps: number[] = [];
    let now = 0, seen = 0, humanAt = 600;
    while (s.turn.stage !== 'finale' && s.turn.stage !== 'ended' && now < 4 * 3600_000) {
      if (now >= humanAt) {
        const d = decide(pub(s), view(s, 'h'), human);
        human.memory = d.memory;
        humanAt = now + 900;
        if (d.action) act(s, 'h', d.action, now);
      }
      now += 100;
      tick(s, now);
      cpuStep(s, now, decide);
      for (const e of s.events.filter(x => x.id > seen)) {
        seen = e.id;
        assert.ok(!(e.kind === 'auto' && e.reason === 'error'), `error fallback: ${e.text}`);
        const seat = 'seat' in e ? e.seat : null;
        // Only events the CPU's own action causes (a trade event completes on the partner's accept).
        if (!seat || !s.seats[seat]?.cpu || !OWN.has(e.kind)) continue;
        if (last.has(seat) && e.at > last.get(seat)!) gaps.push(e.at - last.get(seat)!);
        last.set(seat, e.at);
      }
    }
    assert.equal(s.results?.reason, 'target', `${tableSize} seats: ${s.turn.stage} round ${s.turn.round}`);
    assert.ok(Math.min(...gaps) >= 400, `closest CPU actions ${Math.min(...gaps)} ms apart`);
  }
});
