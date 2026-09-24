import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, STAGE_IDS, getStage, resolveStage, stageFrame, type Block, type Zone } from '../src/stages';
import { UNIT } from '../src/model';

const E = 1e-6, TICKS = 14400; // 4 minutes covers every stage loop (Stadium's full rotation is 7.3 minutes; sampled below)
const within = (z: Zone, x: number, y: number) => x >= z.left && x <= z.right && y >= z.bottom && y <= z.top;
const contains = (a: Zone, b: Zone) => b.left >= a.left && b.right <= a.right && b.bottom >= a.bottom && b.top <= a.top;
const overlap = (a: Block, b: Block) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > E && Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom) > E;
const inside = (blocks: Block[], x: number, y: number) => blocks.some(b => x > b.left + E && x < b.right - E && y > b.bottom + E && y < b.top - E);
const samples = (id: string) => Array.from({ length: id === 'stadium' ? 1400 : 700 }, (_, i) => i * (id === 'stadium' ? 19 : 21));

test('thirty stages keep their ids, real Melee names and complete definitions', () => {
  assert.equal(STAGE_IDS.length, 30);
  assert.equal(new Set(STAGE_IDS).size, 30);
  assert.equal(new Set(STAGE_IDS.map(id => getStage(id).name)).size, 30);
  for (const id of STAGE_IDS) {
    const s = getStage(id);
    assert.equal(s.id, id);
    assert.ok(s.name && s.blurb && s.family && s.source, id);
    for (const color of Object.values(s.palette)) assert.match(color, /^#[0-9a-f]{6}$/, id);
    assert.equal(s.spawns.length, 4, id); assert.equal(s.respawns.length, 4, id);
    assert.ok(contains(s.blast, s.camera), `${id}: blast contains camera`);
  }
  assert.equal(getStage('cloudbreak').source, 'Original');
  assert.equal(getStage('peach-castle').name, "Princess Peach's Castle");
});

test('tournament stages match Melee dimensions', () => {
  const width = (id: 'battlefield' | 'final-destination' | 'yoshi-story' | 'dream-land' | 'fountain' | 'stadium') => {
    const main = stageFrame(id, 0).blocks[0]; return (main.right - main.left) / UNIT;
  };
  assert.ok(Math.abs(width('battlefield') - 136.8) < 1e-6);
  assert.ok(Math.abs(width('final-destination') - 171.14) < .01);
  assert.ok(Math.abs(width('yoshi-story') - 112) < 1e-6);
  assert.ok(Math.abs(width('dream-land') - 154.54) < .01);
  assert.ok(Math.abs(width('fountain') - 126.7) < 1e-6);
  assert.ok(Math.abs(width('stadium') - 175.5) < 1e-6);
  const bf = stageFrame('battlefield', 0);
  assert.deepEqual(bf.platforms.map(p => +(p.y / UNIT).toFixed(2)), [27.2, 27.2, 54.4]);
  assert.deepEqual(STAGES.battlefield.blast, { left: -224 * UNIT, right: 224 * UNIT, bottom: -108.8 * UNIT, top: 200 * UNIT });
  assert.equal(stageFrame('final-destination', 0).platforms.length, 0);
  assert.equal(stageFrame('final-destination', 0).hazard, null);
});

test('every stage frame is finite, non-overlapping and inside its blast zone', () => {
  for (const id of STAGE_IDS) {
    const { blast } = getStage(id);
    for (const t of samples(id)) {
      const f = stageFrame(id, t);
      assert.ok(f.blocks.length > 0, `${id}@${t}: has ground`);
      assert.equal(new Set(f.blocks.map(b => b.id)).size, f.blocks.length);
      assert.equal(new Set(f.platforms.map(p => p.id)).size, f.platforms.length);
      for (const b of f.blocks) {
        assert.ok([b.left, b.right, b.top, b.bottom, b.dx ?? 0, b.dy ?? 0].every(Number.isFinite) && b.left < b.right && b.bottom < b.top, `${id}@${t}: ${b.id} finite`);
        if (!b.moving) assert.ok(b.top < blast.top, `${id}: ${b.id} below the top blast line`);
      }
      for (let i = 0; i < f.blocks.length; i++) for (let j = i + 1; j < f.blocks.length; j++)
        assert.ok(!overlap(f.blocks[i], f.blocks[j]), `${id}@${t}: ${f.blocks[i].id} overlaps ${f.blocks[j].id}`);
      for (const p of f.platforms) {
        assert.ok([p.left, p.right, p.y, p.dx, p.dy].every(Number.isFinite) && p.left < p.right, `${id}@${t}: ${p.id} finite`);
        assert.ok(!f.blocks.some(b => Math.min(p.right, b.right) - Math.max(p.left, b.left) > E && p.y > b.bottom + E && p.y < b.top - E), `${id}@${t}: ${p.id} inside a block`);
      }
    }
  }
});

test('spawns stand on floors, respawns hover above the stage inside the camera', () => {
  for (const id of STAGE_IDS) {
    const s = getStage(id), f = stageFrame(id, 0);
    for (const [x, y] of s.spawns) {
      assert.ok([...f.blocks.map(b => [b.left, b.right, b.top]), ...f.platforms.map(p => [p.left, p.right, p.y])].some(([l, r, top]) => x > l + .3 && x < r - .3 && Math.abs(y - top) < E), `${id}: spawn ${x},${y} on a floor`);
      assert.ok(!inside(f.blocks, x, y + .5) && within(s.camera, x, y), `${id}: spawn clear and framed`);
    }
    assert.equal(new Set(s.spawns.map(([x]) => x.toFixed(3))).size, 4, `${id}: spawns spread out`);
    for (const [x, y] of s.respawns) {
      assert.ok(within(s.camera, x, y), `${id}: respawn ${x},${y} in camera`);
      const below = [...f.blocks.map(b => [b.left, b.right, b.top]), ...f.platforms.map(p => [p.left, p.right, p.y])].filter(([l, r, top]) => x > l - 1 && x < r + 1 && top < y);
      assert.ok(below.length && y - Math.max(...below.map(([, , top]) => top)) > 1.5, `${id}: respawn hovers over the stage`);
      assert.ok(!inside(f.blocks, x, y) && !inside(f.blocks, x, y - 1), `${id}: respawn clear of blocks`);
    }
  }
});

test('ledges exist exactly at exposed top corners', () => {
  for (const id of STAGE_IDS) for (const t of samples(id).filter((_, i) => i % 5 === 0)) {
    const f = stageFrame(id, t), e = 1e-3;
    for (const l of f.ledges) {
      const b = f.blocks.find(q => q.id === l.block);
      assert.ok(b && b.ledges && l.x === (l.side < 0 ? b.left : b.right) && l.y === b.top, `${id}: ${l.id} sits on its block corner`);
      assert.ok(!inside(f.blocks, l.x + l.side * e, l.y - e) && !inside(f.blocks, l.x - l.side * e, l.y + e), `${id}@${t}: ${l.id} exposed`);
    }
    assert.equal(new Set(f.ledges.map(l => l.id)).size, f.ledges.length);
    for (const b of f.blocks.filter(q => !q.ledges)) assert.ok(!f.ledges.some(l => l.block === b.id), `${id}: ${b.id} has no ledges`);
  }
  for (const id of ['battlefield', 'final-destination', 'dream-land', 'yoshi-story', 'fountain', 'stadium', 'cloudbreak'] as const) {
    const f = stageFrame(id, 0);
    assert.deepEqual(f.ledges.map(l => [l.block, l.side]), [['main', -1], ['main', 1]], `${id}: only the two main ledges; under-stage steps are covered`);
  }
});

test('moving pieces are deterministic and their dx/dy match the previous tick', () => {
  for (const id of STAGE_IDS) {
    const late = stageFrame(id, 9001), early = stageFrame(id, 17);
    assert.deepEqual(stageFrame(id, 17), early); assert.deepEqual(stageFrame(id, 9001), late);
    for (const t of samples(id).filter((_, i) => i % 3 === 0)) {
      const now = stageFrame(id, t), prev = stageFrame(id, t - 1);
      for (const p of now.platforms) {
        const q = prev.platforms.find(o => o.id === p.id);
        if (q && Math.abs(p.left - q.left) < 1 && Math.abs(p.y - q.y) < 1) assert.ok(Math.abs(p.dx - (p.left - q.left)) < E && Math.abs(p.dy - (p.y - q.y)) < E, `${id}@${t}: ${p.id} dx/dy`);
        assert.ok(Math.abs(p.dx) < .5 && Math.abs(p.dy) < .5, `${id}@${t}: ${p.id} rides smoothly`);
      }
      for (const b of now.blocks) {
        const q = prev.blocks.find(o => o.id === b.id);
        if (!b.moving) { assert.ok(q && q.left === b.left && q.top === b.top, `${id}: static ${b.id} stays put`); continue; }
        if (q && Math.abs(b.left - q.left) < 1 && Math.abs(b.top - q.top) < 1) assert.ok(Math.abs((b.dx ?? 0) - (b.left - q.left)) < E && Math.abs((b.dy ?? 0) - (b.top - q.top)) < E, `${id}@${t}: ${b.id} dx/dy`);
        assert.ok(Math.abs(b.dx ?? 0) < .5 && Math.abs(b.dy ?? 0) < .5, `${id}@${t}: ${b.id} rides smoothly`);
      }
    }
  }
});

test('signature stage behaviors run on the stage clock', () => {
  const ys = (t: number) => stageFrame('fountain', t).platforms.slice(0, 2).map(p => p.y);
  assert.ok(new Set(Array.from({ length: 40 }, (_, i) => ys(i * 600).join()).values()).size > 5, 'Fountain platforms change height');
  const randall = Array.from({ length: 1260 }, (_, t) => stageFrame('yoshi-story', t).platforms.find(p => p.id === 'randall'));
  assert.ok(randall.some(p => p && p.left < -56 * UNIT) && randall.some(p => p && p.left > 56 * UNIT) && randall.some(p => !p), 'Randall circles both sides');
  const kinds = new Set(Array.from({ length: 30 }, (_, i) => stageFrame('stadium', i * 1000).blocks.map(b => b.art).filter(Boolean).join()));
  for (const k of ['fire', 'grass', 'rock', 'water']) assert.ok([...kinds].some(s => s.includes(k)), `Stadium becomes ${k}`);
  assert.ok(stageFrame('stadium', 0).platforms.length === 2 && stageFrame('stadium', 4000).platforms.every(p => !['left', 'right'].includes(p.id)), 'Stadium platforms leave for transformations');
  assert.deepEqual([0, 3100, 4000, 11000, 30000].map(t => stageFrame('stadium', t).hazard?.label), ['Transformation', 'Fire', 'Fire', 'Grass', 'Fire']);
  assert.ok(Array.from({ length: 60 }, (_, i) => stageFrame('great-bay', i * 60).blocks.some(b => b.id === 'turtle')).includes(false), 'the turtle dives');
  const deck = (t: number) => stageFrame('rainbow-cruise', t).blocks.find(b => b.id === 'deck');
  assert.equal(deck(1200)?.left, deck(0)?.left, 'Rainbow Cruise dwells on the ship');
  assert.ok((deck(2000)?.left ?? -99) < (deck(0)?.left ?? 0) - 5, 'then the course scrolls left');
  const base = (t: number) => stageFrame('icicle-mountain', t).blocks.find(b => b.id === 'base')?.top ?? -99;
  assert.ok(base(0) === 0 && base(700) < 0, 'Icicle Mountain climbs');
  assert.ok(stageFrame('mute-city', 1500).blocks.some(b => b.id === 'track') && !stageFrame('mute-city', 100).blocks.some(b => b.id === 'track'), 'Mute City track comes and goes');
  assert.ok(stageFrame('brinstar-depths', 2400 + 200).platforms.find(p => p.id === 'left')!.y > stageFrame('brinstar-depths', 0).platforms.find(p => p.id === 'left')!.y, 'Kraid turns the stage');
  const floats = new Set(Array.from({ length: 80 }, (_, i) => stageFrame('poke-floats', i * 150).blocks.filter(b => b.left < 0 && b.right > 0).map(b => b.art).join()));
  assert.ok(floats.size >= 4, 'Poké Floats parade passes the center');
});

test('hazards warn before they strike, and hazards off stops them but keeps terrain moving', () => {
  const withHazard = STAGE_IDS.filter(id => getStage(id).hazardLabel);
  assert.ok(withHazard.length >= 14);
  for (const id of STAGE_IDS) {
    let warned = false, struck = false;
    for (let t = 0; t < TICKS; t += 4) {
      const on = stageFrame(id, t), off = stageFrame(id, t, false);
      assert.equal(off.hazard, null, id);
      assert.deepEqual(off.blocks, on.blocks, `${id}@${t}: terrain ignores hazards`); assert.deepEqual(off.platforms, on.platforms);
      const h = on.hazard;
      if (!h) { assert.ok(!getStage(id).hazardLabel, id); continue; }
      assert.ok([h.damage, h.angle, h.kbBase, h.kbGrowth, h.push, h.cycle].every(Number.isFinite) && h.label, id);
      assert.ok(!(h.warning && h.active), id);
      if (h.warning) warned = true;
      if (h.active) { struck = true; assert.ok(h.kind === 'transform' || h.zones.length > 0, `${id}: active zones`); }
      if (h.active && h.kind !== 'track') assert.ok(warned, `${id}@${t}: warned first`);
      for (const z of h.zones) assert.ok(z.left < z.right && z.bottom < z.top && [z.left, z.right, z.bottom, z.top].every(Number.isFinite), id);
      if (!h.active) assert.equal(h.push, 0, id);
    }
    if (getStage(id).hazardLabel) assert.ok(struck, `${id}: hazard fires within ${TICKS} ticks`);
  }
  const wind = [...Array(5600).keys()].map(t => stageFrame('dream-land', t).hazard!).filter(h => h.active);
  assert.ok(wind.some(h => h.push > 0) && wind.some(h => h.push < 0) && wind.every(h => h.damage === 0), 'Whispy blows both ways');
  const acid = [...Array(2600).keys()].map(t => stageFrame('brinstar', t).hazard!).filter(h => h.active);
  assert.ok(acid.some(h => h.zones[0].top > 0) && acid.every(h => h.damage > 0 && h.rehit), 'Brinstar acid reaches the stage');
});

test('resolveStage picks seeded random stages and falls back safely', () => {
  assert.equal(resolveStage('random', 27), resolveStage('random', 27));
  assert.equal(new Set(Array.from({ length: 30 }, (_, seed) => resolveStage('random', seed))).size, 30);
  assert.equal(resolveStage('onett', 1), 'onett');
  assert.equal(resolveStage(undefined, 1), 'battlefield');
  assert.equal(resolveStage('__proto__' as never, 1), 'battlefield');
});
