/* Audio: safe in Node, cue rules (dedupe, countdown from race time, focus), and every synthesised
 * sound driven through a strict mock AudioContext to prove click-free envelopes and sane gain staging. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { KartAudio } from '../src/audio/audio';
import { CueTracker, viewportPan, type Cue, type SoundId } from '../src/audio/cues';
import { createMixer, EngineVoice, panned, playSound } from '../src/audio/synth';
import { musicFor, TRACK_MUSIC } from '../src/audio/music';
import { createRace, stepRace } from '../src/sim/race';
import { toRaceView } from '../src/sim/view';
import { ITEM_IDS } from '../src/sim/items';
import { existsSync } from 'node:fs';
import type { RaceEvent, RaceView } from '../src/sim/types';

function view(time = -3.5, racers = 3): RaceView {
  const race = createRace({ track: 'palm-bay', laps: 3, speedClass: 100, difficulty: 'normal', gridSize: racers, items: 'normal', views: 'tv' },
    [{ id: 'p0', name: 'A', color: '#f00' }, { id: 'p1', name: 'B', color: '#0f0' }], 1, 'tv');
  while (race.time < time - 1e-9) stepRace(race, new Map(), 1 / 60);
  return JSON.parse(JSON.stringify(toRaceView(race)));
}
const ev = (id: number, type: RaceEvent['type'], racer = 'p0', extra: Partial<RaceEvent> = {}): RaceEvent => ({ id, t: 0, type, racer, ...extra });
const sounds = (cues: Cue[]) => cues.map(c => c.sound);

test('KartAudio is inert and disposable in Node', () => {
  const audio = new KartAudio('display', 'palm-bay');
  audio.unlock(); audio.setPan('p0', .5); audio.setMuted(true);
  audio.update(view(), ['p0'], [], 1 / 60); audio.update(null, [], [], 1 / 60);
  audio.dispose(); audio.dispose();
  audio.update(view(), ['p0'], [], 1 / 60);
});

test('countdown beeps come from race time: once each, in order, never when joining late', () => {
  const tracker = new CueTracker('display'), v = view(-3.5), heard: string[] = [];
  for (let t = -3.5; t < .6; t += 1 / 60 + (t > -1.5 ? .01 : 0)) { v.time = t; heard.push(...sounds(tracker.frame(v, [{ id: 'p0', pan: 0 }]))); }
  assert.deepEqual(heard.filter(s => s === 'countdown' || s === 'go'), ['countdown', 'countdown', 'countdown', 'go']);
  const late = new CueTracker('display'); v.time = -.5; late.frame(v, []); v.time = 5; assert.deepEqual(sounds(late.frame(v, [])), [], 'a big jump past GO is not a beep');
  const phone = new CueTracker('controller'); v.time = -1.01; phone.frame(v, [{ id: 'p0', pan: 0 }]); v.time = -.99;
  assert.deepEqual(sounds(phone.frame(v, [{ id: 'p0', pan: 0 }])), [], 'phones leave the countdown to the TV');
});

test('events: history is not replayed, repeats are deduped, focus decides who hears what', () => {
  const t = new CueTracker('display'), v = view(2), focus = [{ id: 'p0', pan: -.5 }];
  v.events = [ev(1, 'lap')]; v.serial = 1;
  assert.deepEqual(sounds(t.frame(v, focus)), [], 'events already on the first view are history');
  v.events = [ev(1, 'lap'), ev(2, 'mini-turbo', 'p0', { value: 3 }), ev(3, 'mini-turbo', 'p1'), ev(4, 'hit', 'p1', { other: 'p0', value: 1 }), ev(5, 'honk', 'p1'),
    ev(6, 'explode', 'p1', { x: v.racers.find(r => r.id === 'p0')!.x + 500, z: 0, value: 7 }), ev(7, 'item', 'p0', { value: ITEM_IDS.indexOf('shield') })]; v.serial = 7;
  const cues = t.frame(v, focus, v.events.slice(3));
  assert.deepEqual(sounds(cues), ['mini-turbo', 'hit-dealt', 'honk', 'explode', 'item']);
  assert.equal(cues[0].pan, -.5); assert.equal(cues[0].value, 3);
  assert.equal(cues[4].value, 'shield');
  assert.ok(cues[3].gain < .5, 'a far explosion is quiet');
  assert.ok(cues[2].gain < 1, 'another racer\'s honk is softer');
  assert.deepEqual(sounds(t.frame(v, focus, v.events)), [], 'resent events stay silent');
  const fresh = view(1); fresh.serial = 0; fresh.events = [];
  t.frame(fresh, focus); fresh.events = [ev(1, 'lap')]; fresh.serial = 1;
  assert.deepEqual(sounds(t.frame(fresh, focus)), ['lap'], 'a new race (serial restarted) resets dedupe');
});

test('state cues: drift tier-ups, roulette ticks that slow down, item ready; walls rate-limited', () => {
  const t = new CueTracker('display'), v = view(5), focus = [{ id: 'p0', pan: 0 }], r = v.racers.find(x => x.id === 'p0')!;
  t.frame(v, focus);
  r.drift = 1; r.driftTier = 1; v.time += .1; assert.deepEqual(sounds(t.frame(v, focus)), ['tier']);
  r.driftTier = 2; v.time += .1; assert.deepEqual(sounds(t.frame(v, focus)), ['tier']);
  v.time += .1; assert.deepEqual(sounds(t.frame(v, focus)), []);
  r.drift = 0; r.driftTier = 0; r.item = 'peel'; const ticks: number[] = [];
  for (let roll = 1.4; roll > 0; roll -= 1 / 60) { r.rollT = roll; v.time += 1 / 60; if (t.frame(v, focus).some(c => c.sound === 'roulette-tick')) ticks.push(v.time); }
  assert.ok(ticks.length >= 8 && ticks.length <= 20, `${ticks.length} ticks`);
  assert.ok(ticks[1] - ticks[0] < ticks.at(-1)! - ticks.at(-2)!, 'the roulette slows down');
  r.rollT = 0; v.time += 1 / 60; assert.deepEqual(sounds(t.frame(v, focus)), ['item-ready']);
  v.events = [ev(100, 'wall'), ev(101, 'wall')]; v.serial = 101;
  assert.deepEqual(sounds(t.frame(v, focus)), ['wall']);
});

test('the predicted local kart sounds at once; the server echo is skipped, other events still play', () => {
  const t = new CueTracker('solo'), v = view(5), focus = [{ id: 'p0', pan: .2 }], r = v.racers.find(x => x.id === 'p0')!;
  const kart = { ...r }, local = (events: { type: RaceEvent['type']; t: number; value?: number }[] = []) => ({ id: 'p0', kart, events });
  t.frame(v, focus, [], local());
  kart.drift = -1; kart.driftTier = 2; v.time += .05;
  assert.deepEqual(sounds(t.frame(v, focus, [], local())), ['tier'], 'tier-up chime from the predicted kart, before the snapshot shows it');
  r.drift = -1; r.driftTier = 2; v.time += .05; assert.deepEqual(sounds(t.frame(v, focus, [], local())), [], 'not again when the snapshot catches up');
  kart.drift = 0; kart.driftTier = 0; v.time += .05;
  const now = t.frame(v, focus, [], local([{ type: 'mini-turbo', t: v.time + .2, value: 2 }, { type: 'item', t: v.time + .2, value: ITEM_IDS.indexOf('nitro') }]));
  assert.deepEqual(sounds(now), ['mini-turbo', 'item']); assert.equal(now[0].pan, .2); assert.equal(now[1].value, 'nitro');
  v.time += .2; v.events = [ev(50, 'mini-turbo', 'p0', { t: v.time + .02, value: 2 }), ev(51, 'item', 'p0', { t: v.time, value: ITEM_IDS.indexOf('nitro') }), ev(52, 'lap', 'p0', { t: v.time })]; v.serial = 52;
  assert.deepEqual(sounds(t.frame(v, focus, [], local())), ['lap'], 'server echoes of predicted events are skipped');
  v.time += 1; v.events = [ev(53, 'mini-turbo', 'p0', { t: v.time, value: 1 })]; v.serial = 53;
  assert.deepEqual(sounds(t.frame(v, focus, [], local())), ['mini-turbo'], 'an event prediction missed still plays');
});

test('rainbow road: ring, spring and bumper voice once, for the focused racer, deduped against prediction', () => {
  const t = new CueTracker('solo'), v = view(5), focus = [{ id: 'p0', pan: 0 }], kart = { ...v.racers.find(x => x.id === 'p0')! };
  t.frame(v, focus);
  v.events = [ev(60, 'ring', 'p0', { t: v.time, value: 2 }), ev(61, 'spring', 'p1', { t: v.time }), ev(62, 'bumper', 'p0', { t: v.time })]; v.serial = 62;
  assert.deepEqual(sounds(t.frame(v, focus)), ['ring', 'bumper'], 'another racer\'s spring is not voiced');
  v.time += .5;
  const predicted = t.frame(v, focus, [], { id: 'p0', kart, events: [{ type: 'spring', t: v.time }, { type: 'ring', t: v.time + .3, value: 3 }] });
  assert.deepEqual(sounds(predicted), ['spring', 'ring']);
  v.time += .3; v.events = [ev(63, 'spring', 'p0', { t: v.time - .25 }), ev(64, 'ring', 'p0', { t: v.time, value: 3 })]; v.serial = 64;
  assert.deepEqual(sounds(t.frame(v, focus, [], { id: 'p0', kart, events: [] })), [], 'server copies of predicted springs/rings are skipped');
  v.time += .5; v.events = [ev(65, 'loop', 'p1', { t: v.time }), ev(66, 'loop', 'p0', { t: v.time })]; v.serial = 66;
  assert.deepEqual(sounds(t.frame(v, focus)), ['loop'], 'the loop whoosh is the focused racer\'s own');
  v.time += 3;   // next lap's loop
  assert.deepEqual(sounds(t.frame(v, focus, [], { id: 'p0', kart, events: [{ type: 'loop', t: v.time + .1 }] })), ['loop'], 'predicted entry whooshes at once');
  v.time += .2; v.events = [ev(67, 'loop', 'p0', { t: v.time })]; v.serial = 67;
  assert.deepEqual(sounds(t.frame(v, focus, [], { id: 'p0', kart, events: [] })), [], 'its server copy is skipped');
  assert.equal(musicFor('rainbow-road'), 'rainbow-lap-rush.mp3');
});

test('spectator display voices the race, phones only their own feedback', () => {
  const spec = new CueTracker('display'), v = view(10); spec.frame(v, []);
  v.events = [ev(1, 'final-lap', 'p1'), ev(2, 'final-lap', 'p0'), ev(3, 'mini-turbo', 'p1'), ev(4, 'thunder', 'p1')]; v.serial = 4;
  assert.deepEqual(sounds(spec.frame(v, [])), ['final-lap', 'thunder']);
  const phone = new CueTracker('controller'), p = view(10), focus = [{ id: 'p0', pan: 0 }]; phone.frame(p, focus);
  p.events = [ev(1, 'honk', 'p0'), ev(2, 'honk', 'p1'), ev(3, 'lap', 'p0'), ev(4, 'hit', 'p0', { value: 0 })]; p.serial = 4;
  assert.deepEqual(sounds(phone.frame(p, focus)), ['honk', 'hit']);
});

test('viewport pans and music per course', () => {
  assert.equal(viewportPan(0, 1), 0);
  assert.deepEqual([0, 1, 2, 3].map(i => viewportPan(i, 4)), [-.55, .55, -.55, .55]);
  for (const file of new Set([...Object.values(TRACK_MUSIC), musicFor('unknown')])) assert.ok(existsSync(new URL(`../public/music/${file}`, import.meta.url)), file);
});

/* ---------------- strict mock WebAudio ---------------- */
type Event = [kind: 'set' | 'lin' | 'exp' | 'target' | 'cancel', value: number, time: number];
class Param {
  events: Event[] = [];
  constructor(public value = 0) {}
  private check(v: number, t: number) { if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) throw new TypeError(`non-finite automation ${v} @ ${t}`); }
  setValueAtTime(v: number, t: number) { this.check(v, t); this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.check(v, t); this.events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { this.check(v, t); if (v <= 0) throw new RangeError('exponential ramp to 0'); this.events.push(['exp', v, t]); return this; }
  setTargetAtTime(v: number, t: number, tau: number) { this.check(v, t); if (!(tau > 0)) throw new RangeError('tau'); this.events.push(['target', v, t]); return this; }
  cancelScheduledValues(t: number) { this.events.push(['cancel', 0, t]); return this; }
}
class Node { connect<T>(n: T) { return n; } disconnect() {} }
class Source extends Node { started = -1; stopped = Infinity; onended: (() => void) | null = null; start(t = 0) { if (this.started >= 0) throw Error('started twice'); this.started = t; } stop(t = 0) { this.stopped = t; } }
class Osc extends Source { type = 'sine'; frequency = new Param(440); }
class Buffered extends Source { buffer: unknown = null; loop = false; }
class Gain extends Node { gain = new Param(1); }
class Filter extends Node { type = 'lowpass'; frequency = new Param(350); Q = new Param(1); }
class Comp extends Node { threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); }
class MockContext {
  currentTime = 1; sampleRate = 8000; destination = new Node(); gains: Gain[] = []; sources: Source[] = [];
  createGain() { const g = new Gain(); this.gains.push(g); return g; }
  createOscillator() { const o = new Osc(); this.sources.push(o); return o; }
  createBufferSource() { const b = new Buffered(); this.sources.push(b); return b; }
  createBiquadFilter() { return new Filter(); }
  createDynamicsCompressor() { return new Comp(); }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Param() }); }
  createWaveShaper() { return Object.assign(new Node(), { curve: null as unknown }); }
  createBuffer(_c: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
}
const ALL: SoundId[] = ['countdown', 'go', 'tier', 'mini-turbo', 'boost-pad', 'rocket-start', 'stall', 'slipstream', 'trick', 'wall', 'bump', 'pickup', 'roulette-tick',
  'item-ready', 'item', 'hit', 'hit-dealt', 'shield-pop', 'explode', 'thunder', 'comet', 'lap', 'final-lap', 'finish', 'respawn', 'fall', 'honk', 'overtake', 'ring', 'spring', 'bumper', 'loop'];
const VALUES: Partial<Record<SoundId, (number | string)[]>> = { tier: [1, 2, 3], 'mini-turbo': [1, 2, 3], item: [...ITEM_IDS], hit: ['spin', 'tumble', 'shock', 'ink'], finish: [1, 6], honk: [0, 7] };

test('every sound: click-free envelopes, bounded length, sane peak level', () => {
  for (const sound of ALL) for (const value of VALUES[sound] ?? [0]) {
    const ctx = new MockContext(), m = createMixer(ctx as unknown as BaseAudioContext);
    const g0 = ctx.gains.length, s0 = ctx.sources.length, out = panned(m, .3, 1), start = ctx.currentTime + .01;
    const length = playSound(m, out, start, sound, value);
    const gains = ctx.gains.slice(g0).filter(g => g.gain.events.length), sources = ctx.sources.slice(s0);
    const label = `${sound}(${value})`;
    assert.ok(sources.length > 0 && gains.length > 0, `${label} makes sound`);
    let peakSum = 0;
    for (const g of gains) {
      const [first] = g.gain.events, last = g.gain.events.at(-1)!;
      assert.deepEqual(first.slice(0, 2), ['set', 0], `${label}: envelope starts silent`);
      assert.ok(last[0] === 'exp' && last[1] <= .001, `${label}: envelope ends on an exponential tail`);
      assert.ok(last[2] <= start + length + 1e-6, `${label}: tail inside the reported length`);
      peakSum += Math.max(...g.gain.events.map(e => e[1]));
    }
    for (const s of sources) {
      assert.ok(s.started >= start - 1e-9, `${label}: starts on time`);
      assert.ok(Number.isFinite(s.stopped) && s.stopped <= start + length + .05, `${label}: every source is stopped`);
    }
    const lastStop = Math.max(...sources.map(s => s.stopped));
    for (const g of gains) assert.ok(g.gain.events.at(-1)![2] <= lastStop, `${label}: nothing is cut off before its tail`);
    assert.ok(length > 0 && length <= 2.5, `${label}: length ${length}`);
    assert.ok(peakSum <= 1.3, `${label}: summed peaks ${peakSum.toFixed(2)}`);
  }
});

test('engine voice: smooth parameter moves only, fades in, stops idempotently', () => {
  const ctx = new MockContext(), m = createMixer(ctx as unknown as BaseAudioContext), voice = new EngineVoice(m);
  const state = { speed: 0, boost: false, air: false, drift: 0 as const, tier: 0, surface: 'road' as const, hurt: false, muffled: false, gain: .6, pan: -.5 };
  for (let i = 0; i <= 120; i++) { ctx.currentTime += 1 / 60; voice.set({ ...state, speed: i / 100, boost: i > 90, drift: i > 60 ? 1 : 0, tier: i > 80 ? 2 : 0, surface: i % 50 < 10 ? 'offroad' : 'road' }); }
  for (const g of ctx.gains) assert.ok(!g.gain.events.some(e => e[0] === 'set' && e[1] > 0), 'gains only glide (no instantaneous jumps)');
  voice.stop(); voice.stop();
  assert.ok(ctx.sources.every(s => Number.isFinite(s.stopped)), 'all engine sources released');
});
