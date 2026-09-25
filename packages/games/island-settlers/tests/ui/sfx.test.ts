import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameEvent, GameEventKind, PieceKind, RollEvent } from '../../src/model';
import { createSfx, GOOD_PITCH, HAPTICS, RECIPES, soundsFor, type SoundName } from '../../src/ui/sfx/index';
import { noiseBuffer, synth } from '../../src/ui/sfx/synth';

// ------------------------------------------------------------------ fakes

type Param = { value: number; ramps: number[] };
const param = (value = 0): Param & Record<string, unknown> => {
  const p: Param = { value, ramps: [] };
  const ramp = (v: number) => { p.ramps.push(v); };
  return Object.assign(p, {
    setValueAtTime: ramp, linearRampToValueAtTime: ramp, exponentialRampToValueAtTime: ramp,
  });
};
const node = () => ({ connect: (to: unknown) => to, disconnect() {} });

class FakeContext {
  state = 'running'; currentTime = 0; sampleRate = 8000; destination = node();
  sources: { kind: 'osc' | 'noise'; type?: string; hz: number; start: number }[] = [];
  gains: Param[] = []; suspended = 0; closed = false;
  createGain() { const gain = param(1); this.gains.push(gain); return { ...node(), gain }; }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createDynamicsCompressor() {
    return { ...node(), threshold: param(), ratio: param(), attack: param(), release: param() };
  }
  createBuffer(_: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createOscillator() { return this.source('osc'); }
  createBufferSource() { return this.source('noise'); }
  private source(kind: 'osc' | 'noise') {
    const frequency = param(), sources = this.sources;
    const source = { ...node(), kind, type: 'sine', frequency, buffer: null, onended: null, stop() {},
      start: (start: number) => sources.push({
        kind, type: kind === 'osc' ? source.type : undefined, start,
        hz: frequency.ramps[0] ?? frequency.value,
      }),
    };
    return source;
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.suspended++; this.state = 'suspended'; }
  async close() { this.closed = true; }
}

function setup(stored = 'false') {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false });
  const vibrations: unknown[] = [];
  const values = { window: win, document: doc, localStorage: { getItem: () => stored },
    navigator: { vibrate: (p: unknown) => vibrations.push(p) } };
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const ctx = new FakeContext();
  const sfx = createSfx({ createContext: () => ctx as unknown as AudioContext });
  sfx.unlock();
  return { sfx, ctx, win, doc, vibrations };
}

let nextId = 1;
const base = () => ({ id: nextId++, at: 0, text: '' });
const roll = (total: number, grants: [string, 'wood' | 'grain' | 'ore'][] = []): RollEvent => ({
  ...base(), kind: 'roll', seat: 'a', dice: [total - 1, 1], total, eventDie: null, blocked: [],
  shortages: [],
  grants: grants.map(([seat, good]) => ({ seat, tile: 't1', good, amount: 1 })),
});

// build's `at: string` collides with EventBase's `at: number` in model.ts (reported), hence the cast.
const build = (piece: PieceKind) =>
  ({ ...base(), kind: 'build', seat: 'a', piece, at: 'v1', free: false }) as unknown as GameEvent;

// ------------------------------------------------------------------ mapping

test('every event kind maps to its recipe', () => {
  const samples: Record<GameEventKind, [GameEvent, SoundName[]]> = {
    roll: [roll(7, [['a', 'wood'], ['a', 'wood'], ['b', 'ore']]), ['dice', 'seven', 'resource', 'resource']],
    turn: [{ ...base(), kind: 'turn', seat: 'a', stage: 'main', round: 1 }, ['turn']],
    build: [build('city'), ['city']],
    robber: [{ ...base(), kind: 'robber', seat: 'a', piece: 'robber', from: null, tile: 't', victim: null },
      ['robber']],
    steal: [{ ...base(), kind: 'steal', seat: 'a', victim: 'b', count: 1 }, ['steal']],
    discard: [{ ...base(), kind: 'discard', seat: 'a', count: 4 }, []],
    trade: [{ ...base(), kind: 'trade', offer: 'o', seat: 'a', partner: 'b', give: {}, get: {} }, ['trade']],
    offer: [{ ...base(), kind: 'offer', offer: 'o', seat: 'a', change: 'posted' }, ['offer']],
    bank: [{ ...base(), kind: 'bank', seat: 'a', give: { wood: 4 }, get: { ore: 1 } }, ['trade']],
    take: [{ ...base(), kind: 'take', seat: 'a', cards: { ore: 1, grain: 1 } }, ['resource', 'resource']],
    payout: [
      { ...base(), kind: 'payout', seat: 'a', grants: [{ seat: 'a', tile: 't', good: 'wool', amount: 1 }] },
      ['resource']],
    move: [{ ...base(), kind: 'move', seat: 'a', piece: 'ship', unit: null, from: 'e1', to: 'e2' }, []],
    'dev-buy': [{ ...base(), kind: 'dev-buy', seat: 'a' }, []],
    'dev-play': [
      { ...base(), kind: 'dev-play', seat: 'a', card: 'knight', goods: [], count: 0, taken: {} }, []],
    award: [{ ...base(), kind: 'award', award: 'longest-road', seat: 'a', from: null }, []],
    reveal: [{ ...base(), kind: 'reveal', seat: 'a', tile: 't', terrain: 'wood' }, []],
    auto: [{ ...base(), kind: 'auto', seat: 'a', step: 'roll', reason: 'timeout' }, []],
    presence: [{ ...base(), kind: 'presence', seat: 'a', connected: false }, []],
    emote: [{ ...base(), kind: 'emote', seat: 'a', emote: 'gg' }, []],
    barbarians: [
      { ...base(), kind: 'barbarians', strength: 3, defense: 2, result: 'pillaged', losers: [], defenders: [],
      },
      ['barbarians']],
    module: [{ ...base(), kind: 'module', module: 'fishing', name: 'x', seat: null, target: null }, []],
    win: [{ ...base(), kind: 'win', seats: ['a'], reason: 'target' }, ['victory']],
  };
  for (const [kind, [event, sounds]] of Object.entries(samples)) {
    assert.deepEqual(soundsFor(event).map(s => s.sound), sounds, kind);
  }
  assert.deepEqual(soundsFor(roll(8)).map(s => s.sound), ['dice'], 'no growl without a seven');
  for (const [piece, sound] of [['road', 'route'], ['bridge', 'route'], ['settlement', 'settlement'],
    ['knight', 'settlement'], ['metropolis', 'city'], ['camel', null]] as const) {
    assert.deepEqual(soundsFor(build(piece)).map(s => s.sound), sound ? [sound] : [], piece);
  }
  assert.deepEqual(soundsFor({ ...base(), kind: 'offer', offer: 'o', seat: 'a', change: 'expired' }), []);
});

test('each recipe synthesizes its documented voices', () => {
  const expected: Record<SoundName, [string, number][]> = {
    dice: [['triangle', 1800]], seven: [['sawtooth', 110], ['sawtooth', 116]],
    resource: [['triangle', GOOD_PITCH.ore]], route: [['sine', 220]], settlement: [['sine', 180]],
    city: [['sine', 180], ['sine', 1047], ['sine', 1568]], robber: [['sine', 98], ['sine', 7]], steal: [],
    turn: [['sine', 523], ['sine', 784]], offer: [['triangle', 660]],
    trade: [['sine', 523], ['sine', 659], ['sine', 784]], tick: [['square', 1000]],
    barbarians: [['sine', 72], ['sawtooth', 110]],
    victory: [['triangle', 523], ['triangle', 1047], ['sine', 659]],
  };
  const noises: Partial<Record<SoundName, number>> = {
    dice: 6, steal: 1, victory: 1, route: 1, settlement: 2, city: 2, robber: 1,
  };
  for (const name of Object.keys(RECIPES) as SoundName[]) {
    const ctx = new FakeContext(), c = ctx as unknown as AudioContext;
    RECIPES[name](synth(c, c.destination, noiseBuffer(c), 0, 1, new Set()), 'ore');
    for (const [type, hz] of expected[name]) {
      assert.ok(ctx.sources.some(s => s.type === type && s.hz === hz), `${name} has ${type} ${hz}`);
    }
    assert.equal(ctx.sources.filter(s => s.kind === 'noise').length, noises[name] ?? 0, name);
    assert.ok(ctx.sources.length > 0, name);
  }
});

test('play schedules the roll, dedupes by id and skips stale history', () => {
  const { sfx, ctx } = setup();
  const seven = roll(7);
  sfx.play(seven); const once = ctx.sources.length;
  assert.ok(ctx.sources.some(s => s.type === 'sawtooth' && s.start > 0.48), 'growl follows the dice');
  sfx.play(seven);
  assert.equal(ctx.sources.length, once, 'duplicate id plays once');
  sfx.play({ ...roll(8), at: 1000 }, 5000);
  assert.equal(ctx.sources.length, once, 'events older than 3 s stay silent');
  sfx.play({ ...roll(8), at: 4000 }, 5000);
  assert.ok(ctx.sources.length > once);
});

test('resource blips are rate-limited to 6 per 200 ms and cues play at 0.6x', () => {
  const { sfx, ctx } = setup();
  for (let i = 0; i < 10; i++) sfx.cue('resource', 'grain');
  const blips = ctx.sources.filter(s => s.hz === GOOD_PITCH.grain);
  assert.equal(blips.length, 6);
  assert.ok(ctx.gains.some(g => Math.abs(Math.max(...g.ramps) - 0.18 * 0.6) < 1e-9), 'personal level');
  ctx.currentTime = 0.5;
  sfx.cue('resource', 'grain');
  assert.equal(ctx.sources.filter(s => s.hz === GOOD_PITCH.grain).length, 7, 'window slides');
  const many = roll(6, Array.from({ length: 10 }, (_, i) => [`s${i}`, 'wood'] as [string, 'wood']));
  sfx.play(many);
  const starts = ctx.sources.filter(s => s.hz === GOOD_PITCH.wood).map(s => s.start);
  for (const t of starts) assert.ok(starts.filter(u => u >= t && u < t + 0.2).length <= 6);
});

test('mute and hidden pages silence sounds; warnings and haptics follow their tables', () => {
  const { sfx, ctx, win, doc, vibrations } = setup();
  win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: true } }));
  assert.equal(ctx.state, 'suspended');
  ctx.state = 'running';
  sfx.play(roll(5)); sfx.cue('turn');
  assert.equal(ctx.sources.length, 0, 'mute silences');
  win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } }));
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  ctx.state = 'running'; sfx.cue('turn');
  assert.equal(ctx.sources.length, 0, 'hidden silences');
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  for (const s of [12, 10, 10, 9, 5, 4]) sfx.warn(s, 'deadline-1');
  assert.equal(ctx.sources.filter(s => s.type === 'square').length, 3, 'ticks at 10, 5 and 4 once each');
  sfx.haptic('turn'); sfx.haptic('robbed');
  assert.deepEqual(vibrations, [[...HAPTICS.turn], HAPTICS.robbed]);
  sfx.dispose();
  assert.equal(ctx.closed, true);
  const before = ctx.sources.length;
  sfx.cue('turn');
  assert.equal(ctx.sources.length, before, 'disposed stays silent');
});

test('a stored mute keeps the context from ever starting', () => {
  const { sfx, ctx } = setup('true');
  sfx.play(roll(9));
  assert.equal(ctx.sources.length, 0);
});
