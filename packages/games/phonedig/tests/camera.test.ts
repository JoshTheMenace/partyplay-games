import { strict as assert } from 'node:assert';
import test from 'node:test';
import { create } from '../src/camera';

const VIS_COLS = 20, VIS_ROWS = 45, DT = 1 / 60;
const world = { levelSerial: 1, activeGW: 40, worldKey: '9/1/null/2' };

/** Where a camera that has just cut to this world would sit. */
function cutTo(state: typeof world, x: number, y: number) {
  const camera = create();
  camera.follow(state, x, y, VIS_COLS, VIS_ROWS, DT, 0);
  return camera.at().y;
}

test('a rebuilt render state for the same world keeps camera smoothing', () => {
  const camera = create();
  camera.follow({ ...world }, 10, 20, VIS_COLS, VIS_ROWS, DT, 0);
  const start = camera.at().y;
  // The adapter builds a fresh object every frame; that alone must not cut.
  camera.follow({ ...world }, 10, 100, VIS_COLS, VIS_ROWS, DT, 0);
  const moved = camera.at().y, cut = cutTo(world, 10, 100);
  assert.ok(moved > start, 'the camera should start following');
  assert.ok(moved < start + (cut - start) / 2, `smoothed ${moved}, a cut lands at ${cut}`);
});

test('a new world cuts the camera even when the level serial matches', () => {
  const camera = create();
  camera.follow(world, 10, 20, VIS_COLS, VIS_ROWS, DT, 0);
  const next = { ...world, worldKey: '10/1/null/2' };
  camera.follow(next, 10, 100, VIS_COLS, VIS_ROWS, DT, 0);
  assert.equal(camera.at().y, cutTo(next, 10, 100));
});

test('a new level serial cuts the camera', () => {
  const camera = create();
  camera.follow(world, 10, 20, VIS_COLS, VIS_ROWS, DT, 0);
  const next = { ...world, levelSerial: 2 };
  camera.follow(next, 10, 100, VIS_COLS, VIS_ROWS, DT, 0);
  assert.equal(camera.at().y, cutTo(next, 10, 100));
});
