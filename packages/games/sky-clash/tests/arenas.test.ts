/** The arenas of the Reaches: collision authored in src/arenas.ts, agreeing with what the Blender scripts modelled, with working ledges and platforms. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ARENAS, ARENA_IDS } from '../src/arenas';
import { UNIT } from '../src/model';
import { setState } from '../src/sim/common';
import { arena } from '../src/sim/harness';
import { LEGACY_STAGE_IDS, STAGES, STAGE_IDS, stageFrame } from '../src/stages';

const json = (path: string) => JSON.parse(readFileSync(new URL(`../assets/${path}`, import.meta.url), 'utf8'));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test('arenas come first, keep genre-staple layouts and have complete definitions', () => {
  assert.deepEqual(STAGE_IDS.slice(0, ARENA_IDS.length), [...ARENA_IDS]); assert.equal(LEGACY_STAGE_IDS.length, 30);
  assert.ok(ARENA_IDS.length >= 1);
  for (const id of ARENA_IDS) {
    const s = STAGES[id], frame = stageFrame(id, 0, true);
    assert.equal(s.source, 'Original'); assert.ok(s.name && s.blurb.length > 30, id);
    assert.ok(s.spawns.length >= 4 && s.respawns.length >= 4, id); assert.equal(frame.ledges.length, 2, `${id} has a ledge at each end of its floor`);
    assert.ok(!frame.hazard, `${id} has no hazard`);
    assert.ok(s.blast.left < s.camera.left && s.blast.right > s.camera.right && s.blast.top > s.camera.top && s.blast.bottom < s.camera.bottom, `${id} blast zone lies outside the camera box`);
    for (const [x, y] of s.spawns) assert.ok(frame.blocks.some(b => x > b.left && x < b.right && near(y, b.top)) || frame.platforms.some(p => x > p.left && x < p.right && near(y, p.y)), `${id} spawn ${x},${y} stands on something`);
    assert.deepEqual(stageFrame(id, 0, true), stageFrame(id, 5000, true), `${id} does not move`);
  }
});

test('each arena’s model was built to the collision numbers the simulation uses', () => {
  for (const id of ARENA_IDS) {
    const meta = json(`models/${id}.json`), spec = ARENAS[id], built = meta.extras.collision;
    assert.equal(built.blocks.length, spec.blocks.length, id); assert.equal(built.platforms.length, spec.platforms.length, id);
    for (const [i, b] of spec.blocks.entries()) for (const [key, side] of [['l', 'left'], ['r', 'right'], ['top', 'top'], ['bottom', 'bottom']] as const) assert.ok(near(b[key] * UNIT, built.blocks[i][side]), `${id} block ${b.id} ${side}`);
    for (const [i, p] of spec.platforms.entries()) { assert.ok(near(p.l * UNIT, built.platforms[i].left) && near(p.r * UNIT, built.platforms[i].right) && near(p.y * UNIT, built.platforms[i].y), `${id} platform ${p.id}`); }
    assert.ok(meta.tris <= 60000 && meta.bytes <= 4_000_000 && meta.slots.length <= 16, `${id}: ${meta.tris} tris, ${meta.bytes} bytes, ${meta.slots.length} slots`);
  }
});

test('fighters stand on the floor and the platforms, drop through platforms, grab both ledges and die past the blast zone', () => {
  for (const id of ARENA_IDS) {
    const frame = stageFrame(id, 0, false), main = frame.blocks[0]!, a = arena({ fighters: ['sola', 'sola'], stage: id });
    a.place(0, 0, { y: main.top + .1 }); a.tick(30); assert.ok(a.f(0).grounded && near(a.f(0).y, main.top), `${id}: stands on the floor`);
    for (const p of frame.platforms) {
      const f = a.place(0, 0, { y: main.top + .1 }); a.hold(0, { x: 0, y: 0 }); a.tick(30); Object.assign(f, { x: (p.left + p.right) / 2, y: p.y + 1.5, vx: 0, vy: 0, grounded: false, ground: null }); setState(f, 'air');
      for (let t = 0; t < 90 && !f.grounded; t++) a.tick();
      assert.ok(f.grounded && near(f.y, p.y), `${id}: lands on platform ${p.id}`);
      a.tick(16); a.hold(0, { y: -1 }); for (let t = 0; t < 40 && near(f.y, p.y); t++) a.tick(); a.hold(0, { y: 0 });   // a flick down from neutral drops through
      assert.ok(f.y < p.y - .05, `${id}: drops through platform ${p.id}`);
    }
    for (const l of frame.ledges) {
      const f = a.place(0, 0, { y: main.top + .1 }); Object.assign(f, { x: l.x + l.side * .45, y: l.y - .5, vx: -l.side * .03, vy: -.01, grounded: false, ground: null, facing: -l.side }); setState(f, 'air');
      for (let t = 0; t < 60 && f.state !== 'ledge'; t++) a.tick();
      assert.equal(f.state, 'ledge', `${id}: grabs the ${l.side > 0 ? 'right' : 'left'} ledge`);
    }
    const f = a.place(0, 0, { y: main.top + .1 }), stocks = f.stocks; Object.assign(f, { x: STAGES[id].blast.right - .2, y: 2, vx: .5, vy: 0, grounded: false, ground: null }); setState(f, 'air');
    a.tick(5); assert.equal(f.stocks, stocks - 1, `${id}: a fighter past the right blast zone loses a stock`);
  }
});
