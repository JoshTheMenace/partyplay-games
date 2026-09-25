/** WP-map logic: auto-zoom spacing, spot resolution and labels (node --import tsx --test). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadFixture } from '../fixtures';
import { boardIndex } from '../../src/ui/shared/board';
import { autoZoom, clamp, fitScale, home, minGap, SPOT_GAP_PX, viewBox, zoomAt } from '../../src/ui/map/camera';
import { resolveSpot, resolveSpots, rolledTiles, spotDetail, spotLabel } from '../../src/ui/map/spots';

const PHONES = [{ width: 296, height: 220 }, { width: 366, height: 480 }, { width: 296, height: 336 }];
const boxOf = (pub: ReturnType<typeof loadFixture>['pub']) => {
  const l = boardIndex(pub.board).land;
  return { minX: l.minX - 0.75, minY: l.minY - 0.75, maxX: l.maxX + 0.75, maxY: l.maxY + 0.75 };
};

test('auto-zoom keeps every legal spot at least 48 px apart on the 10-seat max-pieces board', () => {
  const { pub, views } = loadFixture('max-10'), box = boxOf(pub);
  const sets = {
    vertices: pub.board.vertices.map(v => v.id), edges: pub.board.edges.map(e => e.id),
    tiles: pub.board.tiles.map(t => t.id), cities: views.p4.build.find(b => b.piece === 'city')!.targets,
  };
  for (const size of PHONES) {
    for (const [name, ids] of Object.entries(sets)) {
      const points = resolveSpots(pub, ids).map(s => s.at), cam = autoZoom(points, box, size);
      const px = minGap(points) * viewBox(cam, box, size).ppu;
      assert.ok(px >= SPOT_GAP_PX, `${name} at ${size.width}×${size.height}: ${px.toFixed(1)} px`);
    }
  }
});

test('auto-zoom leaves an uncrowded board at the whole-island view', () => {
  const { pub, views } = loadFixture('mid-4'), box = boxOf(pub), size = { width: 366, height: 480 };
  assert.deepEqual(autoZoom([], box, size), home(box));
  const city = resolveSpots(pub, views.p0.build.find(b => b.piece === 'city')!.targets).map(s => s.at);
  assert.equal(autoZoom(city, box, size).zoom, 1);
});

test('camera clamps zoom and keeps the view over the board', () => {
  const { pub } = loadFixture('mid-4'), box = boxOf(pub), size = { width: 300, height: 300 };
  assert.equal(clamp({ cx: 0, cy: 0, zoom: 0.2 }, box, size).zoom, 1);
  const far = clamp({ cx: 999, cy: -999, zoom: 3 }, box, size), v = viewBox(far, box, size);
  assert.ok(v.x + v.width <= box.maxX + 1e-9 && v.y >= box.minY - 1e-9);
  const at = { x: 40, y: 60 }, before = viewBox(home(box), box, size), after = zoomAt(home(box), 2, at, box, size);
  assert.equal(after.zoom, 2);
  assert.ok(fitScale(box, size) > 0 && before.ppu * 2 === viewBox(after, box, size).ppu);
});

test('spot kinds are found from the id alone', () => {
  const { pub } = loadFixture('explorers-4');
  const [v, e, t] = [pub.board.vertices[0].id, pub.board.edges[0].id, pub.board.tiles[0].id];
  assert.deepEqual([v, e, t, 'x1'].map(id => resolveSpot(pub, id)?.kind), ['vertex', 'edge', 'tile', 'unit']);
  assert.equal(resolveSpot(pub, 'nope'), null);
});

test('labels name terrain, numbers, harbours and robber victims', () => {
  const { pub } = loadFixture('seven-robber-4');
  const port = pub.board.ports[0], corner = resolveSpot(pub, port.vertices[0])!;
  assert.match(spotLabel(pub, corner, 'p0'), /harbour/);
  assert.match(spotDetail(pub, port.vertices[0]), /^Corner: .*harbour$/);
  const choice = pub.robberChoices[0].tiles.find(t => t.victims.length)!;
  const label = spotLabel(pub, resolveSpot(pub, choice.tile)!, 'p0');
  const name = pub.seats.find(s => s.id === choice.victims[0])!.name;
  assert.match(label, new RegExp(`Rob ${name} · \\d+`));
});

test('the last roll glows only its own numbers, never on a 7', () => {
  const { pub } = loadFixture('mid-4'), total = pub.lastRoll!.total;
  const glow = rolledTiles(pub), index = boardIndex(pub.board);
  assert.ok(glow.length > 0 && glow.every(id => index.tiles.get(id)!.number === total));
  assert.deepEqual(rolledTiles({ ...pub, lastRoll: { ...pub.lastRoll!, total: 7 } }), []);
});
