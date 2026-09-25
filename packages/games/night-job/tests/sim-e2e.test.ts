import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { ROLES, type Role } from '../src/model';
import { getMap } from '../src/maps';
import { getServerLevel } from '../src/server-levels';
import { rules } from '../src/server';
import { heist, push, steer, stealthBot, STEP, type Heist } from '../src/sim/harness';
import { dist, type Crew } from '../src/sim/state';

const map = getMap('velvet'), ledger = map.objects.find(o => o.kind === 'objective')!, exit = map.objects.find(o => o.kind === 'exit')!, stand = { x: ledger.x - 1, y: ledger.y };
const view = (h: Heist) => rules.publicView(h.s, { nowMs: h.wall, phase: 'playing' });
/** Runner bot: path to the ledger, push into it, path to the getaway. */
const runner = (h: Heist, p: Crew, sneak = false) => h.s.objective.carrier === null && h.s.objective.taken ? steer(h.s, p, h.s.objective, sneak, 0) ?? push(p, h.s.objective)
  : !h.s.objective.taken ? steer(h.s, p, stand, sneak) ?? push(p, ledger, sneak) : steer(h.s, p, exit, sneak) ?? { x: 0, y: 0, sneak };

for (const role of Object.keys(ROLES) as Role[]) test(`velvet is completable solo by the ${ROLES[role].name} (no NPCs)`, () => {
  const h = heist(1, { level: { npcs: [] }, choices: [{ role }] }), p = h.s.crew[0];
  for (let t = 0; t < 30 * 180 && h.s.phase !== 'clear'; t++) h.step({ p0: runner(h, p) });
  assert.equal(h.s.phase, 'clear', `stuck at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  const ended = h.s.elapsed;
  assert.equal(rules.outcome(h.s).complete, false, 'the getaway plays out on the TV before results');
  for (let t = 0; t < 30 * 3; t++) h.step();
  const out = rules.outcome(h.s);
  assert.ok(out.complete && out.winners[0] === 'p0' && h.s.elapsed === ended && h.s.elapsed < 90, `${role} took ${h.s.elapsed.toFixed(0)} s`);
});

test('four thieves clear velvet together and the whole crew must reach the getaway', () => {
  const h = heist(4, { level: { npcs: [] }, choices: [{ role: 'cracker' }, { role: 'magpie' }, { role: 'wire' }, { role: 'face' }] });
  for (let t = 0; t < 30 * 180 && h.s.phase !== 'clear'; t++) h.step(Object.fromEntries(h.s.crew.map((p, i) => [p.id, i === 3 && t < 30 * 50 ? { x: 0, y: 0, sneak: false } : runner(h, p)])));
  assert.equal(h.s.phase, 'clear');
  assert.ok(h.s.elapsed > 50, 'the idle Face held everyone until they arrived');
  assert.ok(h.s.crew.every(p => dist(p, exit) <= 1.8));
});

test('on relaxed, a sneaking bot gets past live security to the ledger', () => {
  const results = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => {
    const h = heist(1, { settings: { difficulty: 'relaxed' }, choices: [{ role: 'cracker', tool: 'tranq' }], seed }), s = h.s, p = s.crew[0], bot = stealthBot(s, p);
    for (let t = 0; t < 30 * 300 && s.phase !== 'clear' && s.phase !== 'failed'; t++) {
      const threat = s.npcs.find(n => n.target === p.id || (n.state === 'suspicious' && n.suspicion > .5 && n.lastKnown && dist(n.lastKnown, p) < 1));
      if (threat && p.charges && dist(threat, p) < 8 && s.now >= p.toolAt) { p.facing = Math.atan2(threat.y - p.y, threat.x - p.x); h.tool('p0'); }
      h.step({ p0: s.objective.taken ? bot(exit, null) : bot(stand, ledger) });
    }
    return s.objective.taken;
  });
  // Deterministic per seed. The bot trips the ledger laser on the way in, so escaping is left to real players.
  assert.ok(results.filter(Boolean).length >= 3, `took the ledger on ${results.filter(Boolean).length}/8 seeds`);
});

test('a chase is escapable: outrun the aim telegraph, break line of sight, and the guard falls back to searching', () => {
  const h = heist(1, { level: { npcs: [{ kind: 'guard', route: [[12, 21, 9999, 0]] }] } }), p = h.s.crew[0], g = h.s.npcs[0];
  Object.assign(p, { x: 16.5, y: 21.5 }); g.suspicion = .999; h.step();
  assert.equal(g.state, 'chase');
  for (let t = 0; t < 30 * 10; t++) h.step({ p0: steer(h.s, p, { x: 40.5, y: 25.5 }) ?? { x: 0, y: 0, sneak: true } });
  assert.ok(p.health > 0 && !p.down, `survived with ${p.health}`);
  assert.ok(['search', 'patrol', 'investigate'].includes(g.state), g.state);
});

test('equal seeds replay identically', () => {
  const run = () => {
    const h = heist(2, { seed: 99, choices: [{ role: 'scout' }, { role: 'ghost' }] }), bots = h.s.crew.map(p => stealthBot(h.s, p));
    for (let t = 0; t < 30 * 20; t++) h.step(Object.fromEntries(h.s.crew.map((p, i) => [p.id, bots[i](stand, ledger)])));
    return JSON.stringify({ view: view(h), npcs: h.s.npcs, rng: h.s.rng });
  };
  assert.equal(run(), run());
});

test('four-player snapshots stay under 12 KiB and ticks average under 2 ms with every NPC active', () => {
  const level = getServerLevel('velvet');
  level.npcs.push(...level.reinforcements!.npcs);
  const h = heist(4, { level, choices: [{ role: 'scout' }, { role: 'wire' }, { role: 'magpie' }, { role: 'breacher' }] });
  let biggest = 0, ticks = 0, spent = 0;
  for (let t = 0; t < 30 * 40; t++) {
    for (const p of h.s.crew) p.health = 100; // keep everyone up so guards chase and shoot for the whole run
    const inputs = Object.fromEntries(h.s.crew.map(p => [p.id, runner(h, p)]));
    const active = h.s.phase === 'infiltrate' || h.s.phase === 'escape', start = performance.now();
    h.wall += 1000 * STEP; rules.tick(h.s, new Map(Object.entries(inputs)), STEP, h.wall);
    if (active) { spent += performance.now() - start; ticks++; }
    if (t % 10 === 0) { const v = view(h); assertSerializable(v); biggest = Math.max(biggest, JSON.stringify(v).length); }
  }
  assert.ok(ticks > 30 * 20 && h.s.stats.p0.spotted + h.s.stats.p1.spotted > 0, `${ticks} live ticks`);
  assert.ok(biggest < 12 * 1024, `largest snapshot ${biggest} bytes`);
  assert.ok(spent / ticks < 2, `average tick ${(spent / ticks).toFixed(3)} ms`);
  console.log(`# snapshot max ${biggest} B, tick avg ${(spent / ticks).toFixed(3)} ms, NPCs ${h.s.npcs.length}, phase ${h.s.phase}`);
});

test('every patrol (reinforcements included) loops for five minutes without sticking or producing NaN', () => {
  const level = getServerLevel('velvet');
  level.npcs.push(...level.reinforcements!.npcs);
  const h = heist(1, { level, seed: 3 }), moved = new Map<string, { x: number; y: number; t: number }>(), stops = new Map<string, Set<number>>();
  Object.assign(h.s.crew[0], { x: 1.5, y: 26.5 });
  for (let t = 0; t < 30 * 300; t++) {
    h.step();
    for (const n of h.s.npcs) {
      assert.ok([n.x, n.y, n.facing].every(Number.isFinite), n.id);
      const last = moved.get(n.id);
      if (!last || Math.hypot(last.x - n.x, last.y - n.y) > .5) moved.set(n.id, { x: n.x, y: n.y, t });
      else assert.ok(t - last.t < 30 * 25, `${n.id} stuck at ${n.x.toFixed(1)},${n.y.toFixed(1)} (${n.state})`);
      stops.set(n.id, (stops.get(n.id) ?? new Set()).add(n.stop));
    }
  }
  for (const n of h.s.npcs) assert.equal(stops.get(n.id)!.size, n.route.length, `${n.id} skipped stops`);
});
