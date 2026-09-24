import assert from 'node:assert/strict';
import test from 'node:test';
import type { CpuLevel, FighterKind, StageId } from '../src/model';
import { rules } from '../src/server';
import { stageFrame } from '../src/stages';
import { setState } from '../src/sim/common';
import { arena } from '../src/sim/harness';

const STAGES: StageId[] = ['battlefield', 'final-destination', 'dream-land', 'yoshi-story', 'stadium', 'fountain'];
function match(stage: StageId, level: CpuLevel, seed: number) {
  const s = rules.create({ roomId: 'r', roundId: 't', seed, nowMs: 0, players: [] }, { ...rules.validateSettings({ stage, cpuLevel: level, stocks: 2, seconds: 300 }), cpus: 4 });
  const seen = new Set<number>(), run = new Map<string, [string, number]>(), longest = new Map<string, number>(), span = new Map<string, [number, number]>();
  let kos = 0, sds = 0, hits = 0, now = 0;
  for (let t = 0; t < 60 * 330 && !rules.outcome(s).complete; t++) {
    now += 1000 / 60; rules.tick(s, new Map(), 1 / 60, now);
    for (const e of s.events) if (!seen.has(e.id)) { seen.add(e.id); if (e.kind === 'ko') { kos++; if (!e.source) sds++; } if (e.kind === 'hit') hits++; }
    for (const f of s.fighters) {
      if (f.state === 'out') continue;
      const key = f.state + (f.move ?? ''), [k, n] = run.get(f.id) ?? ['', 0], len = k === key ? n + 1 : 1;
      run.set(f.id, [key, len]); longest.set(f.id, Math.max(longest.get(f.id) ?? 0, len));
      const [lo, hi] = span.get(f.id) ?? [f.x, f.x]; span.set(f.id, [Math.min(lo, f.x), Math.max(hi, f.x)]);
    }
  }
  return { s, kos, sds, hits, longest: Math.max(...longest.values()), roam: Math.min(...[...span.values()].map(([lo, hi]) => hi - lo)) };
}
for (const level of [2, 3] as CpuLevel[]) test(`level ${level} CPU matches finish with KOs, no self-destructs and nobody stuck`, () => {
  STAGES.forEach((stage, i) => {
    const r = match(stage, level, 40 + i), tag = `${stage} L${level}`;
    assert.ok(rules.outcome(r.s).complete, `${tag} unfinished`);
    assert.ok(r.kos >= 4, `${tag} KOs ${r.kos}`);
    assert.equal(r.sds, 0, `${tag} self-destructs`);
    assert.ok(r.longest < 600, `${tag} a fighter held one state for ${r.longest} frames`);
    assert.ok(r.roam > 2, `${tag} a fighter barely moved (${r.roam} m)`);
  });
});
test('scrolling and split stages: level 3 CPUs keep off terrain leaving the screen and jump the gaps', () => {
  for (const stage of ['rainbow-cruise', 'poke-floats', 'icicle-mountain', 'mute-city', 'big-blue'] as StageId[]) {
    const r = match(stage, 3, 41);
    assert.ok(r.kos >= 3, `${stage} KOs ${r.kos}`); assert.equal(r.sds, 0, `${stage} self-destructs`); assert.ok(r.longest < 900, `${stage} held one state for ${r.longest} frames`);
  }
});
test('level 1 is passive next to level 3', () => {
  const easy = match('final-destination', 1, 7), hard = match('final-destination', 3, 7);
  assert.ok(easy.hits / easy.s.frame < hard.hits / hard.s.frame * .7, `${easy.hits}/${easy.s.frame} vs ${hard.hits}/${hard.s.frame}`);
});
test('CPUs recover from offstage to the ledge or stage', () => {
  const ledge = stageFrame('battlefield', 0).ledges.find(l => l.side === 1)!;
  const kinds: FighterKind[] = ['fox', 'mario', 'marth', 'kirby', 'captain-falcon', 'peach', 'samus', 'link', 'pikachu', 'ness', 'bowser', 'zelda'];
  for (const kind of kinds) for (const level of [2, 3] as CpuLevel[]) {
    const a = arena({ fighters: [kind, 'sandbag'], stage: 'battlefield', cpu: [level, null] }); a.place(1, ledge.x - 6);
    const f = a.f(0); Object.assign(f, { x: ledge.x + 2.5, y: ledge.y - 1.2, vx: .05, vy: 0, grounded: false, ground: null, jumpsLeft: 1 }); setState(f, 'air');
    let safe = false;
    for (let t = 0; t < 420 && f.state !== 'out'; t++) { a.tick(); if (f.grounded || f.state === 'ledge') { safe = true; break; } }
    assert.ok(safe, `${kind} L${level} failed to recover (${f.state} at ${f.x.toFixed(1)}, ${f.y.toFixed(1)})`);
  }
});
