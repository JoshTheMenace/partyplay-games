/** decide() against every hand-built fixture: never throws, only legal actions, prompts answered. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU_LEVELS, RESOURCES, type PrivateView, type PublicView } from '../../src/model';
import { decide, PERSONAS } from '../../src/cpu/index';
import { seeded } from '../fixtures/board';
import { FIXTURE_NAMES, loadFixture } from '../fixtures/index';
import { goldPrompt } from '../fixtures/prompts';
import { me } from '../fixtures/private';
import { assertLegal, brain, cpuMs, think } from './helpers';

test('every fixture view, level and persona: no throw, legal action, serializable memory', () => {
  for (const name of FIXTURE_NAMES) {
    const f = loadFixture(name);
    for (const view of Object.values(f.views)) for (const level of CPU_LEVELS) for (const p of PERSONAS) {
      const d = think(f.pub, view, brain(level, 3, p.id));
      assertLegal(f.pub, view, d.action, `${name}/${view.seat}/${level}/${p.id}`);
      assert.deepEqual(JSON.parse(JSON.stringify(d.memory)), d.memory);
      assert.ok(['think', 'forced', 'respond'].includes(d.pace));
    }
  }
});

test('garbage in never throws', () => {
  const f = loadFixture('mid-4');
  const broken = [
    [{} as PublicView, {} as PrivateView], [f.pub, { ...f.views.p0, build: null } as unknown as PrivateView],
    [{ ...f.pub, board: null } as unknown as PublicView, f.views.p0],
  ] as const;
  for (const [pub, view] of broken) assert.doesNotThrow(() => decide(pub, view, brain()));
});

test('discards take exactly the owed count from the hand, forced pace', () => {
  const f = loadFixture('seven-discard-4');
  for (const seat of ['p1', 'p2', 'p3']) {
    const view = f.views[seat], d = think(f.pub, view);
    assert.equal(d.action?.type, 'answer');
    assert.equal(d.pace, 'forced');
    assertLegal(f.pub, view, d.action);
  }
});

test('gold picks the full count from the bank, what the goals lack first', () => {
  const f = loadFixture('mid-4'), prompt = goldPrompt('qg', 2, f.pub.bank, null);
  const view = me(f.pub, 'p1', f.views.p1.hand, { prompts: [prompt] });
  const d = think(f.pub, view);
  assertLegal(f.pub, view, d.action);
  assert.ok(d.action?.type === 'answer');
  assert.equal(Object.values(d.action.cards.cards).reduce((a, b) => a + (b ?? 0), 0), 2);
});

test('robber prompt: legal picks, never our own hex', () => {
  const f = loadFixture('seven-robber-4'), view = f.views.p0;
  for (const level of CPU_LEVELS) for (let seed = 1; seed <= 10; seed++) {
    const d = think(f.pub, view, brain(level, seed));
    assertLegal(f.pub, view, d.action);
    assert.ok(d.action?.type === 'answer');
    const tile = d.action.picks.tile, corners = f.pub.board.vertices.filter(v => v.tiles.includes(tile));
    assert.ok(!corners.some(v => f.pub.pieces.buildings[v.id]?.seat === 'p0'), `${level} robbed itself`);
  }
});

test('setup: the placer builds a legal settlement', () => {
  const f = loadFixture('setup-4'), d = think(f.pub, f.views.p3);
  assert.equal(d.action?.type, 'build');
  assertLegal(f.pub, f.views.p3, d.action);
});

test('roll stage: rolls (or plays a useful knight first)', () => {
  const f = loadFixture('roll-3'), d = think(f.pub, f.views.p1);
  assert.ok(d.action && ['roll', 'play-dev'].includes(d.action.type));
});

test('decide p95 under 5 ms on the 10-seat and module fixtures', () => {
  const times: number[] = [];
  for (const name of ['max-10', 'ck-4', 'explorers-4', 'seafarers-4', 'offers-12'] as const) {
    const f = loadFixture(name);
    for (const view of Object.values(f.views)) for (let i = 0; i < 20; i++) {
      const t = cpuMs();
      think(f.pub, view, brain('sharp', i));
      times.push(cpuMs() - t);
    }
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 5, `p95 ${p95.toFixed(2)} ms`);
});

test('fuzz: random hands, dev cards and offers on live-turn fixtures stay legal', () => {
  const random = seeded(99), roll = (n: number) => Math.floor(random() * n);
  const kinds = ['knight', 'road-building', 'plenty', 'monopoly', 'victory'] as const;
  for (let i = 0; i < 300; i++) {
    const f = loadFixture((['mid-4', 'connect-6', 'max-10', 'concurrent-8', 'paired-6', 'ck-4'] as const)[i % 6]);
    const base = f.views[f.seat], hand = Object.fromEntries(RESOURCES.map(r => [r, roll(5)]));
    const dev = Array.from({ length: roll(3) }, (_, k) =>
      ({ id: `d${k}`, kind: kinds[roll(5)], playable: random() < 0.6, why: null }));
    const other = f.pub.seats.find(s => s.id !== f.seat)!.id;
    f.pub.offers = random() < 0.5 ? [] : [{
      id: 'fz', at: f.now, from: other, to: [f.seat], broadcast: false,
      give: { [RESOURCES[roll(5)]]: 1 + roll(2) }, want: { [RESOURCES[roll(5)]]: 1 },
      counterTo: null, responses: { [f.seat]: 'pending' }, reasons: {}, expires: null,
    }];
    const o = f.pub.offers[0];
    if (o && Object.keys(o.give)[0] === Object.keys(o.want)[0]) f.pub.offers = [];
    const view = me(f.pub, f.seat, hand, { dev, commands: base.commands, prompts: base.prompts, ext: base.ext });
    const b = brain(CPU_LEVELS[i % 3], i, PERSONAS[i % PERSONAS.length].id);
    for (let step = 0; step < 3; step++) {
      const d = think(f.pub, view, b);
      assertLegal(f.pub, view, d.action, `fuzz ${i}`);
      b.memory = d.memory;
    }
  }
});
