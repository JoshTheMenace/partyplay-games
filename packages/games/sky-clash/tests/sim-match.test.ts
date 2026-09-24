import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { neutralInput, type Input, type StageId } from '../src/model';
import { STAGE_IDS, stageFrame } from '../src/stages';
import { rules } from '../src/server';
import { arena } from '../src/sim/harness';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#ff5748', lobbyChoice: { fighter: (['fox', 'marth', 'kirby', 'mario'] as const)[i], costume: 0, stage: 'battlefield' } }));
const hasUndefined = (v: unknown): boolean => v === undefined || (typeof v === 'object' && v !== null && Object.values(v).some(hasUndefined));

test('time up: more stocks wins, then lower damage', () => {
  const a = arena({ fighters: ['fox', 'mario'], settings: { seconds: 120 } });
  a.f(0).stocks = 3; a.f(1).stocks = 4; a.f(0).damage = 0; a.f(1).damage = 150;
  a.now = a.s.endsAt; a.tick();
  assert.equal(a.s.phase, 'complete'); assert.deepEqual(rules.outcome(a.s).winners, ['p1']);
  const b = arena({ fighters: ['fox', 'mario'], settings: { seconds: 120 } }); b.f(0).damage = 40; b.f(1).damage = 90;
  b.now = b.s.endsAt; b.tick(); assert.deepEqual(rules.outcome(b.s).winners, ['p0']);
});
test('a tie goes to Sudden Death at 300% with one stock; a KO decides it, running out of time shares the win', () => {
  const a = arena({ fighters: ['fox', 'mario', 'kirby'], settings: { seconds: 120 } });
  a.f(2).stocks = 1; a.now = a.s.endsAt; a.tick();
  assert.equal(a.s.phase, 'sudden'); assert.ok(a.s.events.some(e => e.kind === 'sudden-death'));
  assert.equal(a.f(2).stocks, 0, 'the trailing fighter is out');
  for (const i of [0, 1]) { assert.equal(a.f(i).stocks, 1); assert.equal(a.f(i).damage, 300); assert.equal(a.f(i).state, 'respawn'); }
  a.tick(); Object.assign(a.f(1), { x: 99, grounded: false }); a.f(1).state = 'air'; a.tick();
  assert.equal(a.s.phase, 'complete'); assert.deepEqual(rules.outcome(a.s).winners, ['p0']);
  const b = arena({ fighters: ['fox', 'mario'], settings: { seconds: 120 } }); b.now = b.s.endsAt; b.tick();
  assert.equal(b.s.phase, 'sudden'); b.now = b.s.phaseEndsAt; b.tick();
  assert.equal(b.s.phase, 'complete'); assert.deepEqual(rules.outcome(b.s).winners.sort(), ['p0', 'p1']);
  assert.deepEqual(rules.outcome(b.s).rows.map(r => r.rank), [1, 1]);
});
test('teams: no friendly fire, and the surviving team wins together', () => {
  const a = arena({ fighters: ['fox', 'mario', 'kirby', 'marth'], settings: { teams: true } });
  a.place(0, 0, { facing: 1 }); a.place(2, .7, { facing: -1 }); a.place(1, 5); a.place(3, -5);
  a.press(0, 'attack', { x: 0, y: 0 }); a.tick(10);
  assert.equal(a.f(2).damage, 0);
  for (const i of [1, 3]) { a.f(i).stocks = 1; Object.assign(a.f(i), { x: 99, grounded: false }); a.f(i).state = 'air'; }
  a.tick(); assert.equal(a.s.phase, 'complete');
  assert.deepEqual(rules.outcome(a.s).winners.sort(), ['p0', 'p2']);
});
test('a disconnected fighter stands idle and forfeits after 20 seconds; reconnecting in time keeps them in', () => {
  const a = arena({ fighters: ['fox', 'mario', 'kirby'] });
  rules.onPresenceChange(a.s, 'p1', false, a.now);
  a.inputs.get('p1')!.presses.attack = 9; a.tick(60 * 19);
  assert.equal(a.f(1).stocks, 4); assert.equal(a.f(1).move, null); assert.equal(a.view().fighters[1]!.connected, false);
  a.tick(60 * 2); assert.equal(a.f(1).stocks, 0); assert.equal(a.f(1).state, 'out');
  rules.onPresenceChange(a.s, 'p2', false, a.now); a.tick(60 * 10); rules.onPresenceChange(a.s, 'p2', true, a.now); a.tick(60 * 15);
  assert.equal(a.f(2).stocks, 4);
});
test('determinism: the same seed and inputs give identical snapshots; another seed differs', () => {
  const run = (seed: number) => {
    const s = rules.create({ roomId: 'r', roundId: 't', seed, nowMs: 0, players: players(2) }, rules.validateSettings({ cpus: 2, cpuLevel: 3, stage: 'battlefield' }));
    const input: Input = neutralInput();
    for (let k = 0; k < 900; k++) { if (k % 40 === 0) { input.presses.attack++; input.x = k % 80 ? 1 : -1; } rules.tick(s, new Map([['p0', input], ['p1', input]]), 1 / 60, 3000 + k * 1000 / 60); }
    return JSON.stringify(rules.publicView(s, { nowMs: 0, phase: 'playing' }));
  };
  assert.equal(run(9), run(9)); assert.notEqual(run(9), run(10));
});
test('public view: strictly serializable, no undefined, rounded, events capped and ordered, live hitboxes published', () => {
  const a = arena({ fighters: ['fox', 'mario', 'kirby', 'marth'], cpu: [3, 3, 3, 3], stage: 'battlefield' });
  let sawHits = false, lastId = 0;
  for (let k = 0; k < 1800; k++) {
    a.tick();
    if (k % 30) continue;
    const v = rules.publicView(a.s, { nowMs: a.now, phase: 'playing' });
    assertSerializable(v); assert.equal(hasUndefined(v), false);
    assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
    assert.ok(v.events.length <= 48); for (const e of v.events) assert.ok(e.frame >= v.frame - 60);
    for (let i = 1; i < v.events.length; i++) assert.ok(v.events[i]!.id > v.events[i - 1]!.id);
    lastId = Math.max(lastId, v.events.at(-1)?.id ?? 0);
    for (const f of v.fighters) { for (const n of [f.x, f.y, f.damage]) assert.equal(Math.round(n * 1000) / 1000, n); if (f.hits?.length) sawHits = true; }
    assert.equal(rules.playerView(a.s, 'p0', { nowMs: a.now, phase: 'playing' }), null);
  }
  assert.ok(sawHits && lastId > 100);
});
test('outcome rows: ranks by survival, ties share, labels read like the results screen', () => {
  const a = arena({ fighters: ['fox', 'mario', 'kirby'] });
  a.f(0).stocks = 2; a.f(0).damage = 34.6; a.f(0).kos = 3;
  a.f(1).stocks = 0; a.f(1).eliminated = 2; a.f(2).stocks = 0; a.f(2).eliminated = 1; a.f(1).state = a.f(2).state = 'out'; a.f(1).kos = 1;
  a.tick(); assert.equal(a.s.phase, 'complete'); assert.equal(rules.outcome(a.s).complete, false, 'GAME! holds before results');
  a.tick(120);
  const o = rules.outcome(a.s);
  assert.equal(o.complete, true); assert.deepEqual(o.winners, ['p0']);
  assert.deepEqual(o.rows.map(r => [r.playerId, r.rank, r.label]), [['p0', 1, '2 stocks · 34% · 3 KOs'], ['p1', 2, '0 stocks · 0% · 1 KO'], ['p2', 3, '0 stocks · 0% · 0 KOs']]);
  assertSerializable(o);
});
test('tick cost stays far under 1 ms with four CPUs', () => {
  const a = arena({ fighters: ['fox', 'falco', 'marth', 'sheik'], cpu: [3, 3, 3, 3], stage: 'yoshi-story' });
  a.tick(120); const t0 = performance.now(); a.tick(1800);
  assert.ok((performance.now() - t0) / 1800 < .25, `${(performance.now() - t0) / 1800} ms`);
});
test('hazards warn first, then hit fighters inside their zones with Melee knockback; hazards off disables them', () => {
  let found: { stage: StageId; tick: number } | null = null;
  for (const stage of STAGE_IDS) { for (let t = 1; t < 60 * 120 && !found; t++) { const h = stageFrame(stage, t, true).hazard; if (h?.active && h.damage > 0 && h.zones.length && !stageFrame(stage, t - 1, true).hazard?.active) found = { stage, tick: t }; } if (found) break; }
  assert.ok(found, 'a damaging hazard exists');
  const hit = (hazards: boolean) => {
    const a = arena({ fighters: ['fox', 'mario'], stage: found!.stage, settings: { hazards } }); a.s.stageTick = found!.tick - 200;
    let warned = false; while (a.s.stageTick < found!.tick - 1) { a.tick(); warned ||= a.s.events.some(e => e.kind === 'hazard-warn'); a.f(1).damage = 0; }
    const z = stageFrame(found!.stage, found!.tick, true).hazard!.zones[0]!, f = a.f(1);
    Object.assign(f, { x: (z.left + z.right) / 2, y: Math.max(z.bottom, -1) + .05, px: 0, py: 0, vx: 0, vy: 0, grounded: false, ground: null, invincible: 0 }); f.state = 'air';
    a.tick(); return { warned, damage: f.damage, event: a.s.events.some(e => e.kind === 'hazard' && e.target === 'p1') };
  };
  const on = hit(true), off = hit(false);
  assert.ok(on.warned && on.damage > 0 && on.event, JSON.stringify({ found, on }));
  assert.equal(off.damage, 0);
});
test('an input release never lowers press counters, so the next state fires no phantom presses', () => {
  const a = arena({ fighters: ['fox', 'mario'] });
  a.place(0, -2); a.place(1, 2);
  for (const k of ['attack', 'special', 'jump', 'shield', 'smash', 'grab'] as const) a.press(0, k);
  a.tick(90);
  const kept = { ...a.inputs.get('p0')! }, frames = { ...a.f(0).buf };
  a.inputs.set('p0', neutralInput()); a.tick(); a.inputs.set('p0', kept); a.tick();
  assert.deepEqual(a.f(0).buf, frames, 'no counter re-fires after a release');
  assert.deepEqual(a.view().fighters[0]!.presses, kept.presses);
});
