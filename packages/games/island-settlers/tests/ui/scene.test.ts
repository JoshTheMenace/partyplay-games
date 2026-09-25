/**
 * Scene geometry checks without a GPU: the camera fit keeps the land inside the board window, and
 * no number token is ever covered on screen by any piece (EXPERIENCE §1.4 and the WP-scene
 * acceptance). Pieces use their EXPERIENCE §1.5 boxes at the fitted pieceScale (coverage.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEX_WIDTH, TOKEN_RADIUS, corners } from '../../src/geometry';
import { FIXTURE_NAMES, loadFixture } from '../fixtures/index';
import { boardIndex } from '../../src/ui/shared/board';
import { fitCamera, project } from '../../src/ui/scene/camera';
import { LAND_TOP } from '../../src/ui/scene/constants';
import { coveredTokens } from './coverage';
import { openCorners, setupRoutes, watchSpots } from '../../src/ui/scene/spots';

const STAGES = [{ width: 1560, height: 980 }, { width: 1240, height: 620 }];
test('token diameter is 30–36% of the hex flat width', () => {
  const share = (2 * TOKEN_RADIUS) / HEX_WIDTH;
  assert.ok(share >= 0.3 && share <= 0.36, `${share}`);
});

test('no token is covered by any piece on the 10-seat max-pieces board', () => {
  const view = loadFixture('max-10').pub;
  for (const stage of STAGES) {
    const { covered, count, shapes } = coveredTokens(view, stage);
    assert.ok(count >= 30 && shapes > 200, `stress board has ${count} tokens and ${shapes} pieces`);
    assert.deepEqual(covered, [], `covered at ${stage.width}×${stage.height}`);
  }
});

test('no token is covered in any fixture at either TV size', () => {
  for (const name of FIXTURE_NAMES) for (const stage of STAGES) {
    assert.deepEqual(coveredTokens(loadFixture(name).pub, stage).covered, [], `${name} ${stage.width}`);
  }
});

test('the land fits inside the board window for every fixture, TV and seated host', () => {
  for (const name of FIXTURE_NAMES) for (const stage of STAGES) for (const host of [false, true]) {
    const view = loadFixture(name).pub, fit = fitCamera(view.board, stage, host), w = fit.window;
    for (const t of view.board.tiles.filter(t => t.terrain !== 'sea')) for (const c of corners(t)) {
      const p = project(fit, c.x, LAND_TOP, c.y);
      assert.ok(p.x >= w.left - 0.5 && p.x <= w.left + w.width + 0.5, `${name} x ${p.x}`);
      assert.ok(p.y >= w.top - 0.5 && p.y <= w.top + w.height + 0.5, `${name} y ${p.y}`);
    }
  }
});

test('the fit depends only on the board and stage, so panels never move it', () => {
  const a = loadFixture('mid-4').pub, b = loadFixture('seven-robber-4').pub;
  assert.deepEqual(fitCamera(a.board, STAGES[0], false), fitCamera(b.board, STAGES[0], false));
  const base = fitCamera(a.board, STAGES[0], false).scale;
  assert.ok(base > 70 && base < 90, `base board ≈ 80 px/wu at 1080p, got ${base}`);
});

test('setup spots follow the distance rule and the newest settlement', () => {
  const view = loadFixture('setup-4').pub, index = boardIndex(view.board), built = view.pieces.buildings;
  const free = openCorners(view);
  assert.ok(free.length > 10);
  for (const id of free) {
    const near = index.vertices.get(id)!.edges.map(e => index.edges.get(e)!)
      .map(e => (e.a === id ? e.b : e.a));
    assert.ok(!built[id] && near.every(n => !built[n]), id);
  }
  assert.deepEqual(watchSpots(view).vertices.sort(), [...view.intent!.targets].sort());
  const seat = Object.values(built)[0].seat;
  const routes = setupRoutes({ ...view, pieces: { ...view.pieces, routes: {} } }, {
    seat, piece: 'road', round: 1, index: 0, total: 8,
  });
  assert.ok(routes.length >= 2 && routes.every(e => index.edges.get(e)!.land));
});
