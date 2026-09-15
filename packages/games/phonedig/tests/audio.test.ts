/* The ears, against a graph that refuses bad numbers.
 *
 * A Web Audio parameter throws on a non-finite float. The mixer and the score
 * are called from inside requestAnimationFrame, so a throw there does not make
 * the music stop — it makes the GAME stop: the exception unwinds past the
 * reschedule at the bottom of the loop, the loop never runs again, and the
 * canvas freezes on its last painted frame while React carries on updating the
 * HUD from live snapshots. It reads as "the simulation hung", which is the one
 * place it did not.
 *
 * That shipped once. `scoreFor` derives a biome's tension interval by indexing
 * a four-entry table with `(h >> 4) % 4`, and `hash()` returns an UNSIGNED
 * 32-bit value — so any id whose hash has the top bit set produced a negative
 * index, an undefined interval, a NaN pitch, and a dead render loop several
 * levels down. Karst is such an id.
 *
 * So the stub below VALIDATES rather than accepting anything, which is the
 * whole point of it: a permissive stub passes exactly the bug it exists to
 * catch. Everything here runs offline and deterministically.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as audio from '../src/audio';
import * as music from '../src/music';
import { THEMES } from '../src/themes';

/* ── a graph that behaves like the browser's ──────────────────────────── */

const faults: string[] = [];

function check(where: string, args: unknown[]) {
  for (const a of args) {
    if (typeof a === 'number' && !Number.isFinite(a)) {
      faults.push(`${where}(${args.map(String).join(', ')})`);
      // Throw exactly as a real AudioParam does, so any code that would have
      // taken the browser down takes the test down too.
      throw new TypeError(`The provided float value is non-finite.`);
    }
  }
}

const param = () => ({
  value: 0,
  cancelScheduledValues(...a: unknown[]) { check('cancelScheduledValues', a); },
  setValueAtTime(...a: unknown[]) { check('setValueAtTime', a); },
  linearRampToValueAtTime(...a: unknown[]) { check('linearRampToValueAtTime', a); },
  exponentialRampToValueAtTime(...a: unknown[]) { check('exponentialRampToValueAtTime', a); },
  setTargetAtTime(...a: unknown[]) { check('setTargetAtTime', a); },
  setValueCurveAtTime(...a: unknown[]) { check('setValueCurveAtTime', a); },
});

const node = (extra: Record<string, unknown> = {}) => ({
  connect() { return this; },
  disconnect() {},
  gain: param(), frequency: param(), Q: param(),
  detune: param(), delayTime: param(), playbackRate: param(),
  ...extra,
});

class StubContext {
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  destination = node();
  createGain() { return node(); }
  createOscillator() { return node({ type: 'sine', start() {}, stop() {} }); }
  createBufferSource() { return node({ buffer: null, loop: false, start() {}, stop() {} }); }
  createBiquadFilter() { return node({ type: 'lowpass' }); }
  createWaveShaper() { return node({ curve: null, oversample: 'none' }); }
  createDelay() { return node(); }
  createBuffer(channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return {
      length, duration: length / rate, sampleRate: rate, numberOfChannels: channels,
      getChannelData: () => data,
    };
  }
}

function fresh() {
  faults.length = 0;
  music._clearFaults();
  const ctx = new StubContext();
  audio._attachForTest(ctx as never, { limiter: false });
  return ctx;
}

/* Both halves, and both are needed.
 *
 * `faults` is what a real browser would have THROWN on. `music._faults()` is
 * what the module's own guards caught and swallowed — which keeps a player's
 * game alive and would otherwise let the underlying bug ship silently. A guard
 * firing in a test is a failure. */
function assertClean(where: string) {
  assert.deepEqual(faults, [], `${where} reached a parameter with ${faults[0]}`);
  assert.deepEqual(music._faults(), [], `${where} tripped a guard: ${music._faults()[0]}`);
}

/* ── the voices ───────────────────────────────────────────────────────── */

/* The values the simulation actually sends. `value` is whatever the engine put
 * on the event — a count, a depth, a relic id — so the awkward cases are the
 * point: a voice that assumes a number gets a string, and vice versa. */
const VALUES: Record<string, unknown[]> = {
  hazard: ['seep', 'gas', 'dripstone', 'shardfall', 'vent'],
  canary: ['air', 'rock'],
  relic: ['barbed', 'widebore'],
  crystal: ['thunderegg'],
  wheelwind: [0, 1, 2, 3],
  pump: [1, 2, 3, 9, 12],
  combo: [1, 5, 11, 40],
};
const AWKWARD: unknown[] = [undefined, null, 0, 1, 12, 999, -1, 'air'];

test('every voice builds without handing a parameter a non-finite value', () => {
  fresh();
  for (const name of audio._voiceNames()) {
    for (const value of VALUES[name] ?? AWKWARD) {
      // Both call shapes the mixer accepts: a bare value, and the whole event.
      for (const shape of [value, { value, x: 4, y: 9, id: 7, type: name, seq: 1 }]) {
        assert.doesNotThrow(
          () => audio.play(name, shape as never),
          `voice "${name}" threw on value ${JSON.stringify(value)}`);
      }
    }
  }
  assertClean('a voice');
});

/* ── the ambient bed and the score ────────────────────────────────────── */

test('every biome scores a full descent without a non-finite value', () => {
  for (const theme of THEMES) {
    const ctx = fresh();
    /* Ten minutes in one biome, retuned every frame the way sound.ts does, with
     * the air running out and refilling — the tension tone is stacked more
     * often as air runs low, and the tension tone is what used to be NaN, so a
     * calm run would not have found this. */
    for (let i = 0; i < 60 * 600; i++) {
      ctx.currentTime += 1 / 60;
      const air = Math.max(0, 1 - ((i % (60 * 90)) / (60 * 90)));
      assert.doesNotThrow(() => audio.setAmbient({
        theme: theme.id,
        depth: Math.min(1, i / (60 * 500)),
        intensity: 0.55 + 0.45 * (1 - air),
      }), `biome "${theme.id}" threw while scoring`);
    }
    assertClean(`biome "${theme.id}"`);
  }
});

test('a biome the score has no entry for still gets a usable one', () => {
  /* The authored table covers five biomes; the generator has seven, and more
   * can be added. The fallback derives everything from a hash of the id, and
   * each derived field has to be USABLE, not merely present — an undefined
   * tension interval is what took the renderer down. */
  for (const id of [...THEMES.map(t => t.id), 'karst', 'aquifer', 'nonesuch', 'z']) {
    const ctx = fresh();
    for (let i = 0; i < 60 * 120; i++) {
      ctx.currentTime += 1 / 60;
      assert.doesNotThrow(() => audio.setAmbient({ theme: id, depth: 0.8, intensity: 1 }),
        `unknown biome "${id}" threw while scoring`);
    }
    assertClean(`biome "${id}"`);
  }
});

test('nonsense from the caller is ignored rather than thrown', () => {
  /* Nothing upstream should send these, but "should" is not a guarantee, and
   * the cost of being wrong is the whole round rather than one silent frame. */
  const ctx = fresh();
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.doesNotThrow(() => audio.setAmbient({ theme: 'stone', depth: bad, intensity: 1 }));
    assert.doesNotThrow(() => audio.setAmbient({ theme: 'stone', depth: 0.5, intensity: bad }));
    ctx.currentTime += 1;
  }
  assert.equal(music.running(), true);
});
