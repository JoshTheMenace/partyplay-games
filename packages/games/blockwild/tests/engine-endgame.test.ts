/** Engine support for the endgame (DESIGN.md): new block meshes, per-state light, the End's look and its void. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, FRAME_EYE, makeCell, OBSERVER_POWERED, TEXTURE_KEYS } from '../src/shared/blocks';
import { END } from '../src/shared/constants';
import { END_FLAT_SKY, END_FOG_FAR, END_FOG_NEAR, NETHER_FOG_FAR } from '../src/client/engine/environment';
import { newVolume, volumeIndex } from '../src/client/engine/light';
import { createUniforms } from '../src/client/engine/material';
import { Mesher } from '../src/client/engine/mesher';
import { EMIT_CELL } from '../src/client/engine/tables';
import { OPTIONAL_KEYS, VF_END, type LayerMesh } from '../src/client/engine/types';
import { ClientWorld } from '../src/client/engine/world';

const keys = [...TEXTURE_KEYS, ...OPTIONAL_KEYS], layers = new Map(keys.map((key, i) => [key, i])), mesher = new Mesher(key => layers.get(key) ?? 0);
/** A lit section with a stone floor at y = 63; `cells` maps "x,y,z" (chunk-local) to cell values. */
function mesh(cells: Record<string, number>) {
  const volume = newVolume();
  volume.sky.fill(15);
  for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) volume.cells[volumeIndex(x, 63, z)] = B.stone;
  for (const [at, cell] of Object.entries(cells)) {
    const [x, y, z] = at.split(',').map(Number) as [number, number, number];
    volume.cells[volumeIndex(x, y, z)] = cell;
  }
  return mesher.section(volume, 4);
}
const vertices = (m: LayerMesh | null) => m ? Array.from({ length: m.quads * 4 }, (_, v) => ({ x: m.pos[v * 3]!, y: m.pos[v * 3 + 1]!, z: m.pos[v * 3 + 2]!, layer: m.uvl[v * 4 + 2]!, flags: m.uvl[v * 4 + 3]! })) : [];
const layersOf = (m: LayerMesh | null) => new Set(vertices(m).map(v => v.layer));

test('iron bars: a thin post alone, full-height panes towards connections, joints between bars hidden', () => {
  assert.equal(mesh({ '8,64,8': B.iron_bars })[1]?.quads, 5, 'a lone post (its bottom on the floor hidden)');
  const [, cutout] = mesh({ '8,64,8': makeCell(B.iron_bars, 2), '9,64,8': makeCell(B.iron_bars, 8) });
  assert.equal(cutout?.quads, 2 * (5 + 3), 'post plus a pane each: top and sides (the post joint, floor and shared edge are hidden)');
  const v = vertices(cutout);
  assert.ok(v.every(p => p.z >= 8 + 7 / 16 - 1e-6 && p.z <= 8 + 9 / 16 + 1e-6), 'panes are 2 px thick');
  assert.equal(Math.max(...v.map(p => p.y)), 65, 'panes run the full height');
});

test('end portal frames are 13/16 slabs that grow an eye knob; the portal is a starfield plane at 12/16, both sides', () => {
  const [empty] = mesh({ '8,64,8': B.end_portal_frame }), [filled] = mesh({ '8,64,8': makeCell(B.end_portal_frame, FRAME_EYE) });
  assert.equal(Math.max(...vertices(empty).map(p => p.y)), 64 + 13 / 16);
  assert.equal(filled!.quads, empty!.quads + 5, 'the knob shows every face but its bottom');
  assert.equal(Math.max(...vertices(filled).map(p => p.y)), 65);
  assert.ok(layersOf(filled).has(layers.get('end_portal_frame_eye')!), 'the eye has its own texture when the atlas paints it');
  const [portal] = mesh({ '8,64,8': B.end_portal });
  assert.equal(portal?.quads, 2);
  assert.ok(vertices(portal).every(p => p.flags & VF_END && p.y === 64.75));
  assert.equal(EMIT_CELL[B.end_portal_frame], 1);
  assert.equal(EMIT_CELL[makeCell(B.end_portal_frame, FRAME_EYE)], 3, 'an eye makes the frame glow brighter');
});

test('the dragon egg tapers inside its cell; observers show their face and back; daylight detectors are 6/16 slabs', () => {
  const egg = vertices(mesh({ '8,64,8': B.dragon_egg })[0]);
  assert.ok(egg.every(p => p.x >= 8 + 1 / 16 && p.x <= 8 + 15 / 16 && p.y <= 65));
  assert.ok(egg.filter(p => p.y === 65).every(p => p.x >= 8 + 6 / 16 && p.x <= 8 + 10 / 16), 'a narrow tip');
  const observer = layersOf(mesh({ '8,64,8': makeCell(B.observer, 4) })[0]);
  assert.ok(observer.has(layers.get('observer_front')!) && observer.has(layers.get('observer_back')!));
  assert.ok(layersOf(mesh({ '8,64,8': makeCell(B.observer, 4 | OBSERVER_POWERED) })[0]).has(layers.get('observer_back_on')!), 'the back lights while pulsing');
  assert.equal(Math.max(...vertices(mesh({ '8,64,8': B.daylight_detector })[0]).map(p => p.y)), 64 + 6 / 16);
  assert.ok(layersOf(mesh({ '8,64,8': B.silverfish_stone })[0]).has(layers.get('stone_bricks')!), 'infested bricks look like the real thing');
});

test('the End looks like itself: violet fog, flat light, a void below the island', () => {
  assert.equal(createUniforms(null as never).uEnd.value, 0, 'the engine starts in the overworld look');
  const violet = (c: readonly number[]) => c[2]! > c[1]! && c[0]! > c[1]!;
  assert.ok(violet(END_FOG_NEAR) && violet(END_FOG_FAR) && END_FOG_FAR[2]! > END_FOG_NEAR[2]!, 'dark violet deepening to a lighter far haze');
  assert.notDeepEqual(END_FOG_FAR, NETHER_FOG_FAR);
  assert.ok(END_FLAT_SKY > 0.5 && END_FLAT_SKY < 1, 'moody, but readable everywhere');
  const world = new ClientWorld();
  assert.deepEqual(world.lightLevels(END.x0 + 100, -20, END.z0 + 100), [15, 0], 'the void is open');
  assert.equal(world.getCell(END.x0 + 100, -20, END.z0 + 100), B.air);
});
