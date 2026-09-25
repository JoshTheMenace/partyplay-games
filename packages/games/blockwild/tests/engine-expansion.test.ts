/** Engine support for the expansion (DESIGN.md): new shapes, animated textures and redstone dust. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { B, BLOCK_LIST, makeCell, PISTON_EXTENDED, PORTAL_Z, REPEATER_POWERED, TEXTURE_KEYS } from '../src/shared/blocks';
import { createFallbackAtlas } from '../src/client/engine/fallback-atlas';
import { animationFrames } from '../src/client/engine/index';
import { newVolume, volumeIndex } from '../src/client/engine/light';
import { Mesher } from '../src/client/engine/mesher';
import { VF_FIRE, VF_LAVA, VF_PORTAL, VF_SURFACE, VF_WIRE, type LayerMesh } from '../src/client/engine/types';

const layers = new Map(TEXTURE_KEYS.map((key, i) => [key, i])), mesher = new Mesher(key => layers.get(key) ?? 0);
/** A lit, empty section around chunk-local (8, 64, 8) with a stone floor; `cells` maps "x,y,z" (local) to cell values. */
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
const vertices = (m: LayerMesh | null) => m ? Array.from({ length: m.quads * 4 }, (_, v) => ({
  x: m.pos[v * 3]!, y: m.pos[v * 3 + 1]!, z: m.pos[v * 3 + 2]!, flags: m.uvl[v * 4 + 3]!, layer: m.uvl[v * 4 + 2]!, tint: m.lt[v * 4 + 3]!,
})) : [];
const quads = (layers: ReturnType<typeof mesh>) => layers.reduce((n, m) => n + (m?.quads ?? 0), 0);
const all = (layers: ReturnType<typeof mesh>) => layers.flatMap(vertices);

test('every block in every state meshes finite geometry that stays around its own cell', () => {
  for (const block of BLOCK_LIST) {
    if (block.render === 'none') continue;
    for (let state = 0; state < 64; state++) {
      const out = mesh({ '8,64,8': makeCell(block.id, state) }), label = `${block.name} state ${state}`;
      assert.ok(quads(out) > 0, label);
      for (const v of all(out)) {
        assert.ok([v.x, v.y, v.z].every(Number.isFinite), label);
        assert.ok(v.x > 7.7 && v.x < 9.3 && v.z > 7.7 && v.z < 9.3 && v.y > 63.9 && v.y < 65.45, `${label}: ${v.x},${v.y},${v.z}`);
      }
    }
  }
});

test('fences show a post and two bars per connection, with the joint between neighbours hidden', () => {
  // Fence states: bit 1 = connected east, bit 8 = west. The floor hides both posts' bottoms.
  const [opaque] = mesh({ '8,64,8': makeCell(B.oak_fence, 2), '9,64,8': makeCell(B.oak_fence, 8) });
  assert.equal(opaque?.quads, 2 * (5 + 2 * 4), 'post 5 faces, bars 4 each (their post end and the shared joint are hidden)');
  const bars = vertices(opaque).filter(v => v.y > 64.3 && v.y < 64.99);
  assert.ok(bars.some(v => v.x === 9), 'bars reach the shared edge');
  assert.equal(mesh({ '8,64,8': makeCell(B.oak_fence, 0) })[0]?.quads, 5, 'a lone post');
});

test('redstone dust: a dot alone, a line when joined, arms at corners, a strip up a step, power in lt.w', () => {
  const dust = (power: number) => makeCell(B.redstone_wire, power);
  const [, lone] = mesh({ '8,64,8': dust(0) });
  assert.equal(lone?.quads, 1);
  assert.ok(vertices(lone).every(v => v.flags & VF_WIRE && v.tint === 0 && v.layer === layers.get('redstone_dust_dot')));
  const [, line] = mesh({ '8,64,8': dust(15), '9,64,8': dust(14) });
  assert.equal(line?.quads, 2, 'two straight pieces');
  assert.ok(vertices(line).every(v => v.layer === layers.get('redstone_dust_line')));
  assert.deepEqual([...new Set(vertices(line).map(v => v.tint))].sort((a, b) => a - b), [14 * 17, 15 * 17]);
  const [, corner] = mesh({ '8,64,8': dust(5), '8,64,7': dust(5), '9,64,8': dust(5) });
  assert.equal(corner?.quads, 1 + 2 + 1 + 1, 'the corner has a dot and two arms; its neighbours are lines');
  // A step: dust beside a stone block climbs it to the dust on top.
  const [, step] = mesh({ '8,64,8': dust(9), '9,64,8': B.stone, '9,65,8': dust(8) });
  const climb = vertices(step).filter(v => v.y > 64.5 && v.x > 8.9 && v.x < 9);
  assert.equal(climb.length, 2, 'the strip reaches the top of the block beside');
  assert.equal(step?.quads, 3, 'lower line + strip + upper line');
  // A repeater joins only along its axis.
  const dustLayer = (repeater: number) => vertices(mesh({ '8,64,8': dust(0), '9,64,8': makeCell(B.repeater, repeater) })[1]).find(v => v.flags & VF_WIRE)!.layer;
  assert.equal(dustLayer(1), layers.get('redstone_dust_line'), 'a repeater pointing east joins');
  assert.equal(dustLayer(0), layers.get('redstone_dust_dot'), 'a repeater pointing north does not');
});

test('levers swing their handle, buttons and plates sit on their face, repeater torches move with the delay', () => {
  const handleTop = (state: number) => {
    const top = all(mesh({ '8,64,8': makeCell(B.lever, state) })).filter(v => v.y > 64.5);
    return top.reduce((sum, v) => sum + v.z, 0) / top.length;
  };
  // A floor lever (attached face 3) facing north: off leans one way, on the other.
  assert.ok(handleTop(3) < 8.5 && handleTop(3 | 8) > 8.5, `${handleTop(3)} vs ${handleTop(3 | 8)}`);
  const button = all(mesh({ '8,64,8': makeCell(B.stone_button, 1) }));
  assert.ok(button.every(v => v.x <= 8 + 2 / 16 + 1e-6), 'a button on the east face of the block to the west hugs x = 0');
  const torchZ = (delay: number) => {
    const torches = all(mesh({ '8,64,8': makeCell(B.repeater, (delay - 1) << 2) })).filter(v => v.y > 64 + 2.5 / 16);
    return [...new Set(torches.map(v => Math.round((v.z - 8) * 16)))].sort((a, b) => a - b);
  };
  assert.deepEqual(torchZ(1), [2, 4, 6, 8], 'fixed torch at 2–4 px, delay torch at 6–8 px (output north)');
  assert.deepEqual(torchZ(4), [2, 4, 12, 14]);
  const lit = all(mesh({ '8,64,8': makeCell(B.repeater, REPEATER_POWERED) })), unlit = all(mesh({ '8,64,8': makeCell(B.repeater, 0) }));
  assert.ok(lit.some(v => v.layer === layers.get('redstone_torch')) && unlit.some(v => v.layer === layers.get('redstone_torch_off')));
});

test('pistons: a full base when retracted; extended, a cut base with its rod and a head with plate and rod', () => {
  assert.equal(mesh({ '8,64,8': makeCell(B.piston, 3) })[0]?.quads, 5);
  const [opaque] = mesh({ '8,64,8': makeCell(B.piston, 3 | PISTON_EXTENDED), '8,65,8': makeCell(B.piston_head, 3) });
  assert.equal(opaque?.quads, 5 + 4 + 6 + 4, 'base 5 + rod 4, head plate 6 + rod 4');
  const rod = vertices(opaque).filter(v => v.x > 8.3 && v.x < 8.7 && v.z > 8.3 && v.z < 8.7);
  assert.ok(Math.min(...rod.map(v => v.y)) <= 64.75 && Math.max(...rod.map(v => v.y)) >= 65.75, 'the rod runs from inside the base up to the plate');
});

test('portals are thin glowing planes along their axis; lava and fire glow and animate', () => {
  const [, , along] = mesh({ '8,64,8': makeCell(B.nether_portal, 0), '9,64,8': makeCell(B.nether_portal, 0) });
  assert.equal(along?.quads, 2 * 4, 'the joint between neighbouring portal cells (and the floor side) is hidden');
  const xs = vertices(along).map(v => v.z);
  assert.ok(Math.min(...xs) === 8 + 6 / 16 && Math.max(...xs) === 8 + 10 / 16);
  assert.ok(vertices(along).every(v => v.flags & VF_PORTAL));
  const [, , across] = mesh({ '8,64,8': makeCell(B.nether_portal, PORTAL_Z) });
  assert.ok(vertices(across).every(v => v.x >= 8 + 6 / 16 && v.x <= 8 + 10 / 16));
  const [lava] = mesh({ '8,64,8': B.lava, '9,64,8': B.lava });
  assert.ok(vertices(lava).every(v => v.flags & VF_LAVA));
  assert.equal(Math.max(...vertices(lava).map(v => v.y)), 64 + 14 / 16);
  assert.ok(vertices(lava).some(v => v.flags & VF_SURFACE));
  assert.equal(lava?.quads, 2 * (3 + 1 + 1), 'lava pools join over the floor: three sides and a top each, the top also seen from below');
  const [, fire] = mesh({ '8,64,8': B.fire });
  assert.ok(vertices(fire).every(v => v.flags & VF_FIRE));
  assert.ok(Math.abs(Math.max(...vertices(fire).map(v => v.y)) - 65.4) < 1e-4, 'flames rise above the block (MC: 22.4 px)');
  assert.equal(mesh({ '8,64,8': B.monster_spawner })[1]?.quads, 10, 'the cage is drawn inside and out (floor side hidden)');
});

test('the fallback atlas animates water, lava, portals and fire; the engine finds every frame', () => {
  const atlas = createFallbackAtlas();
  for (const key of ['water', 'lava', 'nether_portal', 'fire']) {
    const frames = animationFrames(atlas, key);
    assert.equal(frames.length, 8, key);
    assert.equal(new Set(frames).size, 8, key);
    assert.ok(!frames.includes(atlas.layerOf('missing')), key);
  }
  assert.deepEqual(animationFrames(atlas, 'stone'), [atlas.layerOf('stone')], 'still textures have one frame');
});
