import test from 'node:test';
import assert from 'node:assert/strict';
import { HeistAudio } from '../src/audio';
import rules, { create } from '../src/server';
import type { Effect, View } from '../src/model';

const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
class Source {
  frequency = param(); buffer = null; onended: (() => void) | null = null; stopped = false;
  connect() {} disconnect() {} start() {}
  stop(at?: number) { if (at === undefined) { this.stopped = true; this.onended?.(); } }
}
class Context {
  static instances: Context[] = [];
  sources: Source[] = []; pans: number[] = []; state = 'running'; sampleRate = 1000; currentTime = 0; destination = {};
  constructor() { Context.instances.push(this); }
  createDynamicsCompressor() { return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {} }; }
  createBuffer() { return { getChannelData: () => new Float32Array(1000) }; }
  createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
  createStereoPanner() { const pan = Object.defineProperty({}, 'value', { set: (value: number) => this.pans.push(value) }); return { pan, connect() {}, disconnect() {} }; }
  createBiquadFilter() { return { frequency: param(), Q: param(), connect() {}, disconnect() {} }; }
  createOscillator() { const source = new Source(); this.sources.push(source); return source; }
  createBufferSource() { return this.createOscillator(); }
  async resume() {} async close() { this.state = 'closed'; }
}
function view(): View {
  const s = create({ nowMs: 1000, roomId: 'audio', roundId: 'round', seed: 1, players: [{ id: 'p', name: 'Thief', color: '#fff' }] }, { mission: 'velvet', difficulty: 'normal' });
  return rules.publicView(s, { nowMs: 1000, phase: 'playing' });
}
function environment(run: (audio: HeistAudio, win: EventTarget, doc: EventTarget & { hidden: boolean }) => void) {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false });
  const globals = { window: win, document: doc, localStorage: { getItem: () => null }, AudioContext: Context };
  const old = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  Context.instances = []; const audio = new HeistAudio();
  try { run(audio, win, doc); } finally { audio.dispose(); for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}
const effect = (id: number, kind: Effect['kind'], x = 2): Effect => ({ id, kind, x, y: 2, at: 1000, label: '+1' });

test('audio waits for a gesture, deduplicates snapshots and pans projected events', () => environment((audio, win) => {
  const v = view(); audio.update(v, true); assert.equal(Context.instances.length, 0);
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0];
  v.effects = [effect(1, 'coin')]; audio.update(v, true); const voices = ctx.sources.length;
  assert.ok(voices > 0); assert.ok(ctx.pans.every(pan => pan < 0));
  audio.update(v, true); assert.equal(ctx.sources.length, voices);
  audio.update({ ...v, now: 1100, effects: [effect(2, 'shot', 30)] }, true);
  assert.ok(ctx.pans.at(-1)! > 0);
  const after = ctx.sources.length; audio.update({ ...v, now: 3000, effects: [effect(3, 'alarm')] }, true); assert.equal(ctx.sources.length, after);
  audio.update({ ...v, now: 3100, effects: [] }, true); assert.equal(ctx.sources.length, after);
}));

test('mute, visibility, disconnect and disposal stop active and scheduled voices without replay', () => environment((audio, win, doc) => {
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0], v = view();
  v.effects = [effect(1, 'rescue')]; audio.update(v, true); assert.ok(ctx.sources.length >= 3);
  win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: true } })); assert.ok(ctx.sources.every(source => source.stopped));
  const before = ctx.sources.length; audio.update({ ...v, now: 1100, effects: [effect(2, 'smoke')] }, true); assert.equal(ctx.sources.length, before);
  win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } })); audio.update(v, true); assert.equal(ctx.sources.length, before);
  audio.update({ ...v, now: 1200, effects: [effect(3, 'shot')] }, true); assert.ok(ctx.sources.length > before);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.ok(ctx.sources.every(source => source.stopped));
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  audio.update({ ...v, now: 1300, effects: [effect(4, 'shot')] }, true); audio.update(v, false); assert.ok(ctx.sources.every(source => source.stopped));
  audio.dispose(); assert.equal(ctx.state, 'closed'); win.dispatchEvent(new Event('pointerdown')); assert.equal(Context.instances.length, 1);
}));

test('feedback is bounded during busy scenes and does not invent injury cues on reconnect', () => environment((audio, win) => {
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0], v = view();
  audio.update(v, true);
  const hurt = { ...v, now: 1100, players: v.players.map(p => ({ ...p, health: 60 })) };
  audio.update(hurt, true); assert.ok(ctx.sources.length > 0); const afterHit = ctx.sources.length;
  audio.update(hurt, true); assert.equal(ctx.sources.length, afterHit);
  audio.update(null, false); audio.update({ ...hurt, now: 1200, players: hurt.players.map(p => ({ ...p, health: 20 })) }, true); assert.equal(ctx.sources.length, afterHit);
  for (let i = 0; i < 100; i++) audio.update({ ...hurt, now: 1500 + i * 100, effects: [{ ...effect(i + 1, 'shot'), at: 1500 + i * 100 }] }, true);
  assert.equal(ctx.sources.filter(source => !source.stopped).length, 24);
  audio.update(null, false); assert.ok(ctx.sources.every(source => source.stopped));
}));
