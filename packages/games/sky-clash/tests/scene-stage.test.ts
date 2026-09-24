import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, InstancedMesh, Mesh, PerspectiveCamera, Vector3, type BufferGeometry, type Object3D } from 'three';
import { ResourceScope } from '../../../party-runtime/src/index';
import { STAGE_IDS, stageFrame, type Block, type StageId } from '../src/stages';
import { createStageArt, type StageArt } from '../src/scene/stage/index';
import { BESPOKE } from '../src/scene/stage/art/index';
import { massGeometry, slabGeometry, stacks, type Rect } from '../src/scene/stage/kit';

// Glow sprites paint a radial gradient on a canvas at build time; Node has none, so the kit gets a stub.
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };

const E = 1e-3, camera = new PerspectiveCamera(30, 16 / 9, .5, 2400);
camera.position.set(0, 3, 20); camera.updateMatrixWorld();
const art = (id: StageId, quality: 'low' | 'balanced' = 'balanced') => createStageArt(id, new ResourceScope(), quality);
const step = (a: StageArt, tick: number, reduced = false, hazards = true) => { const f = a.update({ tick, hazards, seconds: tick / 60, dt: 1 / 60, reduced, camera, fighters: [] }); a.root.updateMatrixWorld(true); return f; };
const meshes = (o: Object3D) => { const out: Mesh[] = []; o.traverse(m => { if (m instanceof Mesh && m.visible) out.push(m); }); return out; };
type Tri = { minX: number; maxX: number; maxY: number };
/** Bounds of every triangle (world space) that cuts the fighters' plane, |z| < .3. Decor wholly in front or behind is free. */
function planeTris(m: Mesh): Tri[] {
  const g = m.geometry, p = g.attributes.position, idx = g.index, n = idx ? idx.count : p.count, v = [new Vector3(), new Vector3(), new Vector3()], out: Tri[] = [];
  for (let i = 0; i < n; i += 3) {
    for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(p, idx ? idx.getX(i + j) : i + j).applyMatrix4(m.matrixWorld);
    if (Math.min(v[0].z, v[1].z, v[2].z) > .3 || Math.max(v[0].z, v[1].z, v[2].z) < -.3) continue;
    out.push({ minX: Math.min(v[0].x, v[1].x, v[2].x), maxX: Math.max(v[0].x, v[1].x, v[2].x), maxY: Math.max(v[0].y, v[1].y, v[2].y) });
  }
  return out;
}
/** Every vertex of a collision mass lies inside the union of its rects. */
function inside(g: BufferGeometry, rects: readonly Rect[], label: string) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    assert.ok(rects.some(r => x >= r.left - E && x <= r.right + E && y >= r.bottom - E && y <= r.top + E), `${label}: vertex (${x.toFixed(3)}, ${y.toFixed(3)}) outside collision`);
  }
}
/** Ticks worth checking: the start, a few seconds in, and the stage's first hazard warning and activation. */
function ticks(id: StageId) {
  const out = [0, 600, 2000, 4500];
  for (const want of ['warning', 'active'] as const) for (let t = 0; t < 12000; t += 15) if (stageFrame(id, t, true).hazard?.[want]) { out.push(t + 20); break; }
  return out;
}

test('every stage has bespoke art', () => {
  assert.deepEqual(STAGE_IDS.filter(id => !BESPOKE[id]), []);
});

test('kit solids and slabs are collision exact: floors at tops, walls at sides, nothing outside', () => {
  const rects = [{ left: -5, right: 5, top: 0, bottom: -1 }, { left: -4, right: 4, top: -1, bottom: -3 }, { left: -2, right: 2, top: -3, bottom: -6 }];
  const g = massGeometry(rects, true, true, { round: 1.4, jag: .8, step: .4 }); inside(g, rects, 'taper');
  g.computeBoundingBox(); const b = g.boundingBox!;
  assert.ok(Math.abs(b.max.y) < E && Math.abs(b.min.x + 5) < E && Math.abs(b.max.x - 5) < E && b.min.y >= -6 - E);
  const s = slabGeometry(3.2); s.computeBoundingBox();
  assert.ok(Math.abs(s.boundingBox!.max.y) < E && Math.abs(s.boundingBox!.min.x + 1.6) < E && Math.abs(s.boundingBox!.max.x - 1.6) < E);
  assert.deepEqual(stacks([rects[2], rects[0], rects[1], { left: 8, right: 9, top: 0, bottom: -1 }]).map(x => x.length), [3, 1]);
});

for (const id of STAGE_IDS) test(`${id}: art follows collision at every checked tick`, () => {
  const a = art(id);
  try {
    for (const tick of ticks(id)) {
      const frame = step(a, tick), fixed = frame.blocks.filter(b => !b.moving);
      // Static stacks and moving blocks: the collision mass matches its rects; decor in the fighters' plane stays inside them.
      const groups: [string, Block[]][] = [...new Set(fixed.map(b => b.art))].flatMap(hint => stacks(fixed.filter(b => b.art === hint)).map(s => [s[0].id, s] as [string, Block[]]));
      for (const b of frame.blocks) if (b.moving) groups.push([b.id, [b]]);
      for (const [key, rects] of groups) {
        const obj = a.root.getObjectByName(`block:${key}`);
        assert.ok(obj?.visible, `${id} @${tick}: no visible art for block ${key}`);
        const top = rects[0], label = `${id} @${tick} block ${key}`;
        for (const m of meshes(obj!)) {
          if (m.geometry.attributes.aRect) {
            const g = m.geometry.clone().applyMatrix4(m.matrixWorld); inside(g, rects, label);
            g.computeBoundingBox(); assert.ok(Math.abs(g.boundingBox!.max.y - top.top) < .01 && Math.abs(g.boundingBox!.min.x - top.left) < .01 && Math.abs(g.boundingBox!.max.x - top.right) < .01, `${label}: mass misses its top rect`);
            g.dispose();
          } else for (const t of planeTris(m)) {
            if (t.maxY < top.bottom - 1) continue;
            assert.ok(t.minX >= top.left - .05 && t.maxX <= top.right + .05 && t.maxY <= top.top + .05, `${label}: decor (${t.minX.toFixed(2)}..${t.maxX.toFixed(2)}, top ${t.maxY.toFixed(2)}) crosses a wall or floor in the fighters' plane`);
          }
        }
      }
      // One-way platforms: the slab's top is the platform line, its ends are the platform ends.
      for (const p of frame.platforms) {
        const obj = a.root.getObjectByName(`platform:${p.id}`), label = `${id} @${tick} platform ${p.id}`;
        assert.ok(obj?.visible, `${label}: missing`);
        const near = meshes(obj!).flatMap(planeTris).filter(t => t.maxY > p.y - .5);
        assert.ok(near.length, `${label}: nothing drawn at the platform line`);
        for (const t of near) assert.ok(t.maxY <= p.y + .02 && t.minX >= p.left - .05 && t.maxX <= p.right + .05, `${label}: art (${t.minX.toFixed(2)}..${t.maxX.toFixed(2)}, top ${t.maxY.toFixed(2)}) leaves ${p.left.toFixed(2)}..${p.right.toFixed(2)} @ ${p.y.toFixed(2)}`);
        const line = near.filter(t => Math.abs(t.maxY - p.y) < .02);
        assert.ok(line.length && Math.abs(Math.min(...line.map(t => t.minX)) - p.left) < .05 && Math.abs(Math.max(...line.map(t => t.maxX)) - p.right) < .05, `${label}: no slab spans the platform`);
      }
    }
  } finally { a.dispose(); }
});

test('reduced motion calms decor only: gameplay pieces sit exactly where they do at full motion', () => {
  for (const id of ['fountain', 'rainbow-cruise', 'icicle-mountain', 'poke-floats', 'mute-city', 'corneria'] as const) {
    const a = art(id), b = art(id);
    try {
      for (const tick of [300, 1700, 4100]) {
        const frame = step(a, tick, false); step(b, tick, true);
        for (const key of [...frame.platforms.map(p => `platform:${p.id}`), ...frame.blocks.filter(x => x.moving).map(x => `block:${x.id}`)]) {
          const pa = a.root.getObjectByName(key)!, pb = b.root.getObjectByName(key)!;
          assert.ok(pa.position.distanceTo(pb.position) < 1e-9 && pa.scale.distanceTo(pb.scale) < 1e-9, `${id} ${key} @${tick}`);
        }
      }
    } finally { a.dispose(); b.dispose(); }
  }
});

test('hazard telegraphs show while a hazard warns', () => {
  for (const id of STAGE_IDS) {
    if (BESPOKE[id]?.hazard === false) continue;
    const warn = ticks(id).slice(4).at(0);
    if (warn === undefined) continue;
    const a = art(id);
    try { step(a, warn); let lit = false; a.root.traverse(o => { if (o.name === 'hazard-telegraph' && o.visible) lit = true; }); assert.ok(lit, `${id} @${warn}`); }
    finally { a.dispose(); }
  }
});

test('stage art fits the scene budget with room for four fighters (worst case, nothing culled)', () => {
  for (const id of STAGE_IDS) {
    const count = (q: 'low' | 'balanced') => {
      const a = art(id, q); let calls = 0, tris = 0;
      try {
        step(a, 1200);
        a.root.traverse(o => {
          if (!(o instanceof Mesh) || !o.visible) return;
          const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
          calls++; tris += n * (o instanceof InstancedMesh ? o.count : 1);
        });
      } finally { a.dispose(); }
      return { calls, tris };
    };
    const full = count('balanced'), low = count('low');
    assert.ok(full.calls <= 80 && full.tris <= 180_000, `${id}: ${full.calls} calls, ${Math.round(full.tris / 1000)}k tris`);
    assert.ok(low.tris <= full.tris && low.calls <= full.calls, `${id}: low quality costs more`);
  }
});

test('disposing a stage releases its root', () => {
  const a = art('battlefield'), parent = new Mesh(); parent.add(a.root); a.dispose();
  assert.equal(a.root.parent, null);
  assert.ok(new Box3().setFromObject(parent).isEmpty());
});
