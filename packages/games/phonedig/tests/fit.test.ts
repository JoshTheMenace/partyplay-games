import { strict as assert } from 'node:assert';
import test from 'node:test';
import { TIER_DPR_CAP, fit, fitBroadcast } from '../src/fit';
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

test('the shared screen shows a shaft as large as still fits it, and pans the rest', () => {
  // The picture beside the board: 960x620 on a 720p television, 1520x980 on a 1080p one.
  const tv = (w: number, h: number, diggers: number) => fitBroadcast(w, h, 1, [20, 34, 48, 62][diggers - 1]).k;
  // One or two diggers are drawn at double size on 720p: all of a solo shaft, most of a pair's.
  assert.deepEqual([1, 2, 3, 4].map(n => tv(960, 620, n)), [2, 2, 1, 1]);
  // The same crews take the same share of a bigger screen, and four are drawn large and panned.
  assert.deepEqual([1, 2, 3, 4].map(n => tv(1520, 980, n)), [3, 3, 2, 2]);
  // Never less than a whole pixel a cell, however small the window.
  assert.equal(fitBroadcast(300, 200, 1, 62).k, 1);
  // Enough rows to see what is coming, always.
  for (const [w, h] of [[960, 620], [1520, 980], [2240, 1340]]) {
    for (const cols of [20, 34, 48, 62]) {
      const { scale } = fitBroadcast(w, h, 1, cols);
      assert.ok(h / scale >= 18, `${cols} columns on ${w}x${h} shows only ${(h / scale).toFixed(1)} rows`);
    }
  }
});

