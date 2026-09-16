import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityGovernor, SnapshotBuffer, PresentationDelay } from '../src/index';
test('quality lowers only for sustained slow frames and recovers at 60 Hz', () => {
  const quality = new QualityGovernor(2); let now = 0;
  const frames = (count: number, interval: number) => { for (let i = 0; i < count; i++) quality.frame(interval, now += interval); };
  frames(1, 200); frames(240, 1000 / 60); assert.equal(quality.tier, 0);
  frames(250, 30); assert.equal(quality.tier, 1);
  frames(1800, 1000 / 60); assert.equal(quality.tier, 0);
  quality.frame(10000, now + 10000); assert.equal(quality.tier, 0);
});
test('adaptive delay stays bounded and presentation never rewinds after jitter or suspension', () => {
  const delay = new PresentationDelay(); for (let i = 0; i < 100; i++) { delay.arrival(i * 200); delay.advance(200); } assert.equal(delay.ms, 150);
  const buffer = new SnapshotBuffer<number>(100, 32, { adaptive: {}, monotonic: true, resetGapMs: 500 });
  let last = -Infinity;
  for (let time = 0; time < 2000; time += 50) { buffer.push(time, time, time + (time % 3) * 20); const value = buffer.sample(time, (a,b,t) => a+(b-a)*t)!; assert(value >= last); last = value; }
  buffer.push(5000, 5000, 5000); assert.equal(buffer.sample(5000, (a,b,t) => a+(b-a)*t), 5000);
});

test('phone quality starts economical, recovers, and rejects invalid initial tiers', () => {
  const quality = new QualityGovernor(2, { initialTier: 1 });
  assert.equal(quality.frame(16, 16), 1);
  for (let now = 32; now < 24000; now += 16) quality.frame(16, now);
  assert.equal(quality.tier, 0);
  for (const initialTier of [-1, 2, .5, NaN]) assert.throws(() => new QualityGovernor(2, { initialTier }));
});
