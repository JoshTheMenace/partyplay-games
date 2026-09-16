import { strict as assert } from 'node:assert';
import test from 'node:test';
import { TIER_DPR_CAP, fit } from '../src/fit';
import { TILE } from '../src/worldgen';

/* The quality governor changes tier mid-round. If a tier changed the cell size,
 * the shaft would visibly zoom out and back in; it must only cost pixels. */
test('every automatic quality tier keeps the same cells on screen', () => {
  for (const device of [1, 2, 2.625, 3]) {
    const dpr = Math.min(device, 2);
    for (let w = 320; w <= 1000; w += 5) {
      for (let h = 480; h <= 1000; h += 20) {
        const full = fit(w, h, dpr);
        for (const cap of TIER_DPR_CAP) {
          const tier = fit(w, h, dpr, cap), at = `${w}x${h}@${device} cap ${cap}`;
          assert.equal(tier.scale, full.scale, at);
          assert(tier.dpr <= Math.max(cap, (TILE * 1) / full.scale) + 1e-9, at);
          assert(Math.abs(tier.scale * tier.dpr - TILE * tier.k) < 1e-9, at);
        }
      }
    }
  }
});

test('the cases that used to zoom now only lower resolution', () => {
  assert.deepEqual(fit(390, 700, 2), { k: 2, scale: 16, dpr: 2 });
  assert.deepEqual(fit(390, 700, 2, 1), { k: 1, scale: 16, dpr: 1 });
  const wide = fit(480, 700, 2, 1);
  assert.equal(wide.scale, fit(480, 700, 2).scale);
  assert.equal(wide.k, 1);
});
