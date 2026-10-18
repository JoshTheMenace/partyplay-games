import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';

const { rendererQuality, QUALITY } = await import(new URL('../upstream/src/config.js', import.meta.url).href);
const { Renderer } = await import(new URL('../upstream/src/core/renderer.js', import.meta.url).href);
const { CameraRig } = await import(new URL('../upstream/src/game/cameraRig.js', import.meta.url).href);
const { G } = await import(new URL('../upstream/src/core/ctx.js', import.meta.url).href);

test('phone rendering stays within one CSS pixel per render pixel and can adapt below it', () => {
  const settings = { quality: 'low', mobilePerformance: true };
  const quality = rendererQuality(settings, true);
  assert.ok(quality.pixelRatio <= 1);
  assert.equal(quality.msaa, 0);
  assert.equal(quality.ao, false);
  assert.equal(quality.bloom, false);
  assert.equal(Renderer.prototype.dynFloor.call({ settings, touch: true }), .75);
});

test('desktop quality presets retain their original rendering settings', () => {
  for (const quality of Object.keys(QUALITY)) assert.equal(rendererQuality({ quality }, false), QUALITY[quality]);
});

test('camera follows a replicated super jump without local flight endpoints', () => {
  const previous = G.physics;
  G.physics = { cameraProbe: (_origin: unknown, _direction: unknown, distance: number, _radius: number, out: any) => Object.assign(out, { hard: distance, soft: distance, floor: false }) };
  try {
    const camera = new PerspectiveCamera(), rig = new CameraRig(camera);
    rig.target = { pos: new Vector3(0, 12, 0), vel: new Vector3(0, 3, 5), form: 'kid', anim: { form: 'idle' }, superJumpState: { phase: 'flight', net: true } };
    for (let i = 0; i < 30; i++) rig._follow(1 / 60);
    assert.ok([...camera.position.toArray(), rig.yaw, rig.pitch].every(Number.isFinite));
    assert.ok(camera.position.y > 10);
  } finally { G.physics = previous; }
});
