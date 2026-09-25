import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HULLS } from '../src/defs/hulls';
import { shipLayout, type Box } from '../src/defs/geometry';
import { arrivalMs, mountPoint, sceneLayout, shieldEllipse } from '../src/render/scene';
import { fixtureCombat } from './fixtures/view';

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const cases = [...[1, 2, 3, 4].flatMap(a => [1, 2, 3, 4].map(e => fixtureCombat(a, e))), fixtureCombat(4, 1, true), fixtureCombat(1, 1, true)];

for (const [w, h] of [[1920, 1080], [1280, 720], [1240, 455]]) test(`sceneLayout keeps sides apart, ships and plates disjoint and on screen at ${w}×${h}`, () => {
  for (const view of cases) {
    const scene = sceneLayout(view, w, h), placed = view.ships.map(s => ({ ship: s, ...scene.ships[s.id] }));
    assert.equal(placed.length, Object.keys(scene.ships).length);
    for (const { ship, layout, plate } of placed) {
      const ally = ship.faction === 'ally';
      assert.equal(layout.facing, ally ? 1 : -1);
      assert.ok(ally ? layout.sprite.x + layout.sprite.w <= w / 2 : layout.sprite.x >= w / 2, `${ship.id} on its half`);
      for (const b of [layout.sprite, plate]) assert.ok(b.x >= 0 && b.y >= h * .1 && b.x + b.w <= w && b.y + b.h <= h, `${ship.id} on screen`);
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j], label = `${a.ship.id}/${b.ship.id} in ${view.ships.length} ships`;
      assert.ok(!overlap(a.layout.grid, b.layout.grid), `grids ${label}`);
      assert.ok(!overlap(a.plate, b.plate), `plates ${label}`);
      assert.ok(!overlap(a.plate, b.layout.grid) && !overlap(b.plate, a.layout.grid), `plate over ship ${label}`);
    }
    const allies = placed.filter(p => p.ship.faction === 'ally').map(p => p.layout.cell);
    assert.equal(new Set(allies.map(c => c.toFixed(6))).size, 1, 'allies share one scale');
    const boss = placed.find(p => p.ship.hullId === 'flagship');
    if (boss) assert.ok(boss.layout.sprite.w > w * .3 && boss.layout.cell > Math.max(...allies), 'the boss dominates');
  }
});

test('mount points sit on the hull edge outside every room, alternating top and bottom', () => {
  for (const hull of HULLS) {
    const layout = shipLayout(hull, { x: 0, y: 0, w: 1000, h: 600 }, 1);
    for (let i = 0; i < hull.weaponSlots; i++) {
      const p = mountPoint(layout, i), e = shieldEllipse(layout);
      assert.equal(p.side, i % 2 ? 1 : -1);
      assert.ok(!Object.values(layout.rooms).some(r => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h), `${hull.id} mount ${i} outside rooms`);
      assert.ok(((p.x - e.x) / e.rx) ** 2 + ((p.y - e.y) / e.ry) ** 2 < 1, `${hull.id} mount ${i} inside the shield bubble`);
    }
    const mirrored = shipLayout(hull, { x: 0, y: 0, w: 1000, h: 600 }, -1), a = mountPoint(layout, 0), b = mountPoint(mirrored, 0);
    assert.ok(Math.abs(a.x - layout.grid.x - (mirrored.grid.x + mirrored.grid.w - b.x)) < 1e-6 && a.y === b.y, `${hull.id} mirrors`);
  }
});

test('warp-in arrivals: allies first, staggered by slot, all within the intro', () => {
  const combat = { introUntilMs: 3000 }, times = [0, 1, 2, 3].flatMap(slot => (['ally', 'enemy'] as const).map(faction => ({ faction, slot, t: arrivalMs(combat, { faction, slot }) })));
  assert.ok(times.every(t => t.t > 0 && t.t < 3000));
  assert.ok(Math.max(...times.filter(t => t.faction === 'ally').map(t => t.t)) < Math.min(...times.filter(t => t.faction === 'enemy').map(t => t.t)) + 700);
});
