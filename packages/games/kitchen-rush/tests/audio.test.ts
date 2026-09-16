import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KitchenAudio, SOUND_LEVELS, soundFrame } from '../src/audio';
import { rules } from '../src/server';
const create = (practice = false) => rules.create({ roomId: 'audio', roundId: 'round', nowMs: 1000, seed: 42, players: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Chef ${i}`, color: '#abcdef' })) }, { kitchen: 1, seconds: 180, practice });

test('cooking cues follow authoritative readiness, warning, burning and fire; Practice stays calm', () => {
  for (const practice of [false, true]) {
    const view = create(practice), stove = view.stations.find(s => s.kind === 'stove')!;
    stove.item = { id: 1, kind: 'food', food: [{ kind: 'patty', stage: 'raw' }], dirty: false };
    let previous = structuredClone(view); const heard: string[] = [];
    for (let i = 0; i < 22 * 20; i++) {
      rules.tick(view, new Map(), .05, view.now + 50);
      heard.push(...soundFrame(previous, view).cues); previous = structuredClone(view);
    }
    assert.equal(heard.filter(s => s === 'ready').length, 1);
    assert.equal(heard.filter(s => s === 'warning').length, practice ? 0 : 3);
    assert.equal(soundFrame(previous, view).loops.has('fire'), !practice);
    stove.powered = false; stove.fire = 0;
    assert.equal(soundFrame(previous, view).loops.size, 0, 'unpowered food makes no cooking loop');
    stove.item = null;
    assert.equal(soundFrame(previous, view).loops.size, 0);
  }
});
test('delivery fires once per new snapshot, no catch-up cues on join or reconnect, and work stops at results', () => {
  const before = create(), view = structuredClone(before); view.now += 50; view.served = 4;
  assert.deepEqual([...soundFrame(before, view).cues], ['deliver']);
  assert.equal(soundFrame(view, view).cues.size, 0);
  assert.equal(soundFrame(null, view).cues.size, 0);
  view.now += 2000; assert.equal(soundFrame(before, view).cues.size, 0);
  for (const s of view.stations) if (s.kind === 'board' || s.kind === 'sink') s.working = true;
  assert.equal(soundFrame(null, view).chopping, true); assert.equal(soundFrame(null, view).washing, true);
  view.complete = true;
  assert.deepEqual(soundFrame(before, view), { cues: new Set(), loops: new Set(), chopping: false, washing: false });
});
test('pack is small, decodable PCM with audible content and headroom', async () => {
  let bytes = 0;
  for (const name of Object.keys(SOUND_LEVELS)) {
    const file = await readFile(new URL(`../../../../public/games/kitchen-rush/audio/${name}.wav`, import.meta.url));
    bytes += file.length;
    assert.equal(file.toString('ascii', 0, 4), 'RIFF'); assert.equal(file.readUInt16LE(22), 1); assert.equal(file.readUInt32LE(24), 24000); assert.equal(file.readUInt16LE(34), 16);
    let peak = 0; for (let i = 44; i < file.length; i += 2) peak = Math.max(peak, Math.abs(file.readInt16LE(i)));
    assert.ok(peak > 10000 && peak < 29000, `${name} has signal without clipping`);
  }
  assert.ok(bytes < 700000);
});

test('mixer obeys mute/visibility, limits ten-chef bursts, cleans up and tolerates missing clips', async () => {
  const names = ['window', 'document', 'localStorage', 'AudioContext', 'fetch'] as const;
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: false });
  const sources: Source[] = []; let closed = false;
  class Source { buffer: { name: string } | null = null; loop = false; onended: (() => void) | null = null; stopped = false; connect() {} disconnect() {} start() { sources.push(this); } stop() { this.stopped = true; this.onended?.(); } }
  class Context { state = 'running'; currentTime = 0; destination = {}; createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; } createBufferSource() { return new Source(); } async decodeAudioData(data: ArrayBuffer) { return { name: new TextDecoder().decode(data) }; } async resume() {} async close() { closed = true; } }
  const replacements = [window, document, { getItem: () => 'false' }, Context, async (url: string) => ({ ok: !url.includes('ignite'), arrayBuffer: async () => new TextEncoder().encode(url.split('/').at(-1)!.replace('.wav', '')).buffer })];
  names.forEach((name, i) => Object.defineProperty(globalThis, name, { value: replacements[i], configurable: true }));
  const audio = new KitchenAudio('start');
  try {
    await audio.ready; assert.equal(sources.filter(s => s.buffer?.name === 'deliver').length, 2);
    const view = create(); for (const s of view.stations) if (s.kind === 'stove') s.item = { id: 2, kind: 'food', dirty: false, food: [{ kind: 'patty', stage: 'raw' }] };
    audio.update(view); assert.equal(sources.filter(s => s.loop && !s.stopped).length, 1, 'many stoves share one loop');
    window.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: true } })); assert.ok(sources.every(s => s.stopped));
    const count = sources.length; view.now += 50; view.served++; audio.update(view); assert.equal(sources.length, count);
    window.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } }));
    await new Promise(resolve => setTimeout(resolve, 130)); audio.update(view);
    assert.equal(sources.filter(s => !s.stopped && s.buffer?.name === 'deliver').length, 0, 'unmute does not replay deliveries');
    assert.equal(sources.filter(s => s.loop && !s.stopped).length, 1);
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.ok(sources.every(s => s.stopped));
    document.hidden = false; await new Promise(resolve => setTimeout(resolve, 130));
    for (let i = 0; i < 50; i++) { const next = structuredClone(view); next.now += i*50; next.served += i; audio.update(next); }
    assert.ok(sources.filter(s => !s.stopped).length <= 8);
    await new Promise(resolve => setTimeout(resolve, 1800)); assert.ok(sources.every(s => s.stopped), 'stale snapshots silence the mixer');
    audio.dispose(); audio.dispose(); assert.equal(closed, true); assert.ok(sources.every(s => s.stopped));
    const disposedCount = sources.length; window.dispatchEvent(new Event('pointerdown')); audio.update(view); assert.equal(sources.length, disposedCount);
  } finally { audio.dispose(); names.forEach((name, i) => { if (descriptors[i]) Object.defineProperty(globalThis, name, descriptors[i]!); else Reflect.deleteProperty(globalThis, name); }); }
});
