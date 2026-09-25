import test from 'node:test';
import assert from 'node:assert/strict';
import { HeistAudio, MUSIC } from '../src/audio';
import { getMap } from '../src/maps';
import { doorObjects } from '../src/geometry';
import type { Effect, NpcView, PlayerView, View } from '../src/model';

const param = () => { const p = { value: 0, targets: [] as number[], setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v: number) { p.targets.push(v); } }; return p; };
class Source {
  frequency = param(); type = ''; buffer: unknown = null; onended: (() => void) | null = null; stopped = false; loop = false; loopStart = 0; loopEnd = 0; offset = 0; stopAt = Infinity;
  connect() {} disconnect() {} start(_at?: number, offset = 0) { this.offset = offset; }
  stop(at?: number) { if (at === undefined) { this.stopped = true; this.onended?.(); } else this.stopAt = at; }
}
class Context {
  static instances: Context[] = [];
  sources: Source[] = []; pans: number[] = []; gains: ReturnType<typeof param>[] = []; state = 'running'; sampleRate = 1000; currentTime = 0; destination = {};
  constructor() { Context.instances.push(this); }
  createDynamicsCompressor() { return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {} }; }
  createBuffer() { return { getChannelData: () => new Float32Array(1000) }; }
  createGain() { const gain = param(); this.gains.push(gain); return { gain, connect() {}, disconnect() {} }; }
  async decodeAudioData() { return { duration: 67 }; }
  createStereoPanner() { const pan = Object.defineProperty({}, 'value', { set: (value: number) => this.pans.push(value) }); return { pan, connect() {}, disconnect() {} }; }
  createBiquadFilter() { return { frequency: param(), Q: param(), type: '', connect() {}, disconnect() {} }; }
  createOscillator() { const source = new Source(); this.sources.push(source); return source; }
  createBufferSource() { return this.createOscillator(); }
  async resume() {} async close() { this.state = 'closed'; }
  get live() { return this.sources.filter(source => !source.stopped).length; }
}
const map = getMap('velvet'), doors = doorObjects(map).map(o => o.locked ? 'l' : 'c').join('');
const player = (over: Partial<PlayerView> = {}): PlayerView => ({ id: 'p', name: 'Thief', color: '#fff', seat: 0, role: 'cracker', tool: 'smoke', x: 5, y: 25, health: 100, coins: 0, charges: 2, facing: 0, moving: false, running: false, down: false, connected: true, suspended: false, hidden: false, disguised: false, carrying: false, work: null, hint: '', ...over });
const guard = (over: Partial<NpcView> = {}): NpcView => ({ id: 'g', kind: 'guard', x: 20, y: 10, facing: 0, state: 'patrol', suspicion: 0, aiming: null, moving: true, ...over });
const view = (over: Partial<View> = {}): View => ({
  heistId: 'h', mission: 'velvet', phase: 'infiltrate', now: 1000, elapsed: 0, message: '', players: [player()], npcs: [], intel: [], doors, broken: [], coins: '', objects: [],
  objective: { x: 40, y: 2, carrier: null, taken: false }, objectiveTaken: false, smoke: [], noises: [], shots: [], effects: [], alarm: null, collected: 0, totalLoot: 100, stats: {}, ...over,
});
const fetched: string[] = [];
async function environment(run: (audio: HeistAudio, win: EventTarget, doc: EventTarget & { hidden: boolean }) => void | Promise<void>) {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false });
  const globals = { window: win, document: doc, localStorage: { getItem: () => null }, AudioContext: Context, fetch: async (url: string) => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; } };
  const old = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  Context.instances = []; const audio = new HeistAudio();
  try { await run(audio, win, doc); } finally { audio.dispose(); for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
}
const effect = (id: number, kind: Effect['kind'], x = 2, at = 1000): Effect => ({ id, kind, x, y: 2, at, label: '' });

test('audio waits for a gesture, deduplicates snapshots and pans events across the map', () => environment((audio, win) => {
  const v = view(); audio.update(v, true); assert.equal(Context.instances.length, 0);
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0];
  audio.update({ ...v, effects: [effect(1, 'coin')] }, true); const voices = ctx.sources.length;
  assert.ok(voices > 0); assert.ok(ctx.pans.every(pan => pan < 0));
  audio.update({ ...v, effects: [effect(1, 'coin')] }, true); assert.equal(ctx.sources.length, voices);
  audio.update({ ...v, now: 1100, effects: [effect(2, 'smoke', 40, 1100)] }, true); assert.ok(ctx.pans.at(-1)! > 0);
  const after = ctx.sources.length; audio.update({ ...v, now: 3000, effects: [effect(3, 'emp', 2, 1000)] }, true); assert.equal(ctx.sources.length, after, 'stale events are skipped');
}));

test('snapshot diffs drive doors, guard stingers, aim, shots, revive, pickup and phase cues', () => environment((audio, win) => {
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0], v = view({ npcs: [guard()] });
  audio.update(v, true);
  const step = (over: Partial<View>, label: string) => { ctx.sources.forEach(source => source.onended?.()); const before = ctx.sources.length; audio.update({ ...v, ...over }, true); assert.ok(ctx.sources.length > before, label); Object.assign(v, over); };
  step({ now: 1050, doors: 'o' + doors.slice(1) }, 'door opens');
  step({ now: 1100, doors }, 'door closes');
  step({ now: 1150, npcs: [guard({ state: 'suspicious' })] }, 'guard ?');
  step({ now: 1500, npcs: [guard({ state: 'chase' })] }, 'guard ! and heartbeat');
  step({ now: 2300, npcs: [guard({ state: 'chase', aiming: { x: 5, y: 25 } })] }, 'aim beep');
  step({ now: 2350, shots: [{ from: { x: 20, y: 10 }, to: { x: 5, y: 25 }, at: 2350, hit: true, kind: 'guard' }] }, 'gunshot');
  step({ now: 2400, players: [player({ health: 0, down: true })] }, 'down');
  step({ now: 2450, players: [player({ health: 50 })] }, 'revive');
  step({ now: 2500, objective: { x: 40, y: 2, carrier: 'p', taken: true }, phase: 'escape' }, 'objective grabbed');
  step({ now: 2550, phase: 'clear' }, 'escape fanfare');
}));

test('the alarm siren loops only while the alarm is up and stops on hide, mute and disconnect', () => environment((audio, win, doc) => {
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0], alarm = { x: 10, y: 10, until: 20000 };
  audio.update(view({ alarm }), true); assert.equal(ctx.live, 2, 'siren oscillator and LFO');
  audio.update(view({ now: 1050, alarm }), true); assert.equal(ctx.live, 2, 'not restarted each snapshot');
  audio.update(view({ now: 1100 }), true); assert.equal(ctx.live, 0);
  audio.update(view({ now: 1150, alarm }), true); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(ctx.live, 0);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); audio.update(view({ now: 1200, alarm }), true); assert.equal(ctx.live, 2);
  win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: true } })); assert.equal(ctx.live, 0);
  audio.update(view({ now: 1250, alarm }), true); assert.equal(ctx.live, 0, 'muted stays silent');
  win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } })); audio.update(view({ now: 1300, alarm }), true); assert.equal(ctx.live, 2);
  audio.update(null, false); assert.equal(ctx.live, 0);
  audio.dispose(); assert.equal(ctx.state, 'closed'); win.dispatchEvent(new Event('pointerdown')); assert.equal(Context.instances.length, 1);
}));

test('voices are bounded in busy scenes and reconnects do not invent injury cues', () => environment((audio, win) => {
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0], v = view();
  audio.update(v, true);
  const hurt = view({ now: 1100, players: [player({ health: 60 })] });
  audio.update(hurt, true); const afterHit = ctx.sources.length; assert.ok(afterHit > 0);
  audio.update(hurt, true); assert.equal(ctx.sources.length, afterHit);
  audio.update(null, false); audio.update(view({ now: 1200, players: [player({ health: 20 })] }), true); assert.equal(ctx.sources.length, afterHit);
  for (let i = 0; i < 100; i++) audio.update(view({ now: 1500 + i * 150, effects: [effect(i + 1, 'safe', 2, 1500 + i * 150)] }), true);
  assert.equal(ctx.live, 24);
  audio.update(null, false); assert.equal(ctx.live, 0);
}));

test('a new heist resets event cursors so its first effects still play', () => environment((audio, win) => {
  win.dispatchEvent(new Event('pointerdown')); const ctx = Context.instances[0];
  audio.update(view({ effects: [effect(50, 'coin')] }), true); const first = ctx.sources.length;
  audio.update(view({ heistId: 'next', effects: [effect(1, 'coin')] }), true); assert.ok(ctx.sources.length > first);
}));

test('the mission loop fades in after a gesture, ducks under the alarm, fades on a bust and stops on mute', () => environment(async (audio, win) => {
  const settle = () => new Promise(resolve => setTimeout(resolve, 0)), v = view({ mission: 'ferry' });
  audio.update(v, true, 'lobby'); win.dispatchEvent(new Event('pointerdown')); await settle();
  const ctx = Context.instances[0], looping = () => ctx.sources.filter(source => source.loop && !source.stopped && source.stopAt === Infinity);
  assert.equal(looping().length, 0, 'no music in the lobby');
  audio.update(v, true, 'playing'); await settle();
  const [music] = looping();
  assert.ok(music, 'the loop starts during the heist'); assert.equal(fetched.at(-1), '/games/night-job/music/ferry.mp3');
  assert.equal(music.offset, .5); assert.equal(music.loopStart, .5); assert.equal(music.loopEnd, .5 + MUSIC.ferry);
  const gain = ctx.gains.at(-1)!; assert.equal(gain.targets.at(-1), .3, 'faded in to the music level');
  audio.update({ ...v, alarm: { x: 5, y: 5, until: 9000 } }, true, 'playing'); assert.equal(gain.targets.at(-1), .15, 'the alarm ducks the music');
  audio.update({ ...v, phase: 'failed' }, true, 'playing'); assert.equal(gain.targets.at(-1), 0); assert.ok(music.stopAt < Infinity, 'a bust fades the loop out');
  audio.update({ ...v, heistId: 'next' }, true, 'playing'); await settle();
  const [again] = looping(); assert.ok(again && again !== music, 'the next heist starts it again');
  win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: true } })); assert.ok(again.stopped, 'mute stops it at once');
}));
