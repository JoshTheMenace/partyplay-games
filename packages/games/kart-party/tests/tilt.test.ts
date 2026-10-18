import assert from 'node:assert/strict';
import test from 'node:test';
import { screenAngle, steerFromTilt, tiltAngle } from '../src/ui/tilt';
import { InputComposer } from '../src/ui/input';

test('tilt follows screen-right in both landscape directions and ignores Euler wrapping', () => {
  const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < .001, `${actual} ≈ ${expected}`);
  near(tiltAngle(20, 60, 90), 20);
  near(tiltAngle(-20, -60, 270), 20);
  near(tiltAngle(-20, -60, -90), 20);
  near(tiltAngle(-20, 60, 90), -20);
  near(tiltAngle(0, -30, 0), -30);
  near(tiltAngle(0, -30, 180), 30);
  near(tiltAngle(179, 45, 90), tiltAngle(-181, 45, 90)!);
  near(tiltAngle(0, 89, 90), 0);
  near(tiltAngle(0, -89, 90), 0);
  for (const value of [null, NaN, Infinity]) {
    assert.equal(tiltAngle(value, 0, 90), null);
    assert.equal(tiltAngle(0, value, 90), null);
  }
});

test('screen facing comes from gravity, so a browser reporting the opposite landscape angle still steers right', () => {
  // Landscape, screen facing you, top of the phone to the left: the phone's right edge points up (beta 0, gamma -90).
  for (const reported of [90, 270, -90]) assert.equal(screenAngle(0, -90, reported), 90);
  assert.equal(screenAngle(0, 90, 90), 270);
  assert.equal(screenAngle(0, 0, 270), 270);                     // flat: trust the browser
  assert.equal(screenAngle(60, 0, 180), 0);
  assert.equal(screenAngle(0, -90, 0, true), 90);              // a browser reporting 0 while the page is landscape
  assert.equal(screenAngle(0, 0, 0, true), 90);
  // Turning that phone like a wheel 20 degrees clockwise lowers the right side and reads as +20 (steer right).
  assert.ok(Math.abs(tiltAngle(20, -89.999, screenAngle(0, -90, 270))! - 20) < .01);
});

test('tilt has a dead zone, proportional steering, calibration and bounded lock', () => {
  assert.equal(steerFromTilt(10, 10), 0);
  assert.equal(steerFromTilt(11.9, 10), 0);
  assert.equal(steerFromTilt(26, 10), .5);
  assert.equal(steerFromTilt(-6, 10), -.5);
  assert.equal(steerFromTilt(80, 10), 1);
  assert.equal(steerFromTilt(-80, 10), -1);
});

test('releasing tilt preserves simultaneous drift, brake, item and press counters', () => {
  const c = new InputComposer(() => {});
  c.hold('drift', 't:drift', true); c.hold('brake', 't:brake', true); c.hold('item', 't:item', true);
  c.steer('m:tilt', .5);
  assert.equal(c.input.steer, .5);
  c.clear('m:');
  assert.deepEqual({ ...c.input, seq: 0 }, { steer: 0, drift: true, brake: true, item: true, hop: 1, fire: 1, fly: 0, seq: 0 });
});
