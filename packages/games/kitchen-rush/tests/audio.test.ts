import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLIPS, EVENT_SOUNDS, KitchenAudio, LOOPS, MUSIC_LEVELS, RUSH_SECONDS, SOUND_LEVELS, VARIANTS, barSeconds, musicFor, soundFrame } from '../src/audio';
import { kitchenMap } from '../src/levels';
import { DEFAULT_SETTINGS, POT_SECONDS, type EventType, type GameEvent, type View } from '../src/model';

const map = kitchenMap(0, 2), counter = map.tiles.find(tile => tile.kind === 'counter')!.index, stove = { ...map, tiles: map.tiles.map(tile => tile.index === counter ? { ...tile, kind: 'stove' as const } : tile) };
const view = (patch: Partial<View> = {}): View => ({
  settings: DEFAULT_SETTINGS, players: [], tiles: [], loose: [], orders: [], events: [], startedAt: 0, endsAt: 180_000, now: 10_000, complete: false,
  score: 0, combo: 1, served: 0, failed: 0, stars: 0, thresholds: [100, 200, 300], recipeCounts: {}, gatesOpen: true, gateWarning: false, ...patch,
});
const event = (id: number, type: EventType, at = 10_000): GameEvent => ({ id, at, type });

test('new events map to cues once; history and joins stay silent', () => {
  const before = view({ events: [event(1, 'chop', 9_900)] });
  const after = view({ now: 10_050, events: [event(1, 'chop', 9_900), event(2, 'serve'), event(3, 'fire'), event(4, 'dash'), event(5, 'expire', 8_000)] });
  assert.deepEqual(soundFrame(before, after, map).cues, ['deliver', 'ignite'], 'dash has no clip; the stale expire is skipped');
  assert.deepEqual(soundFrame(after, after, map).cues, [], 'the same snapshot twice plays nothing');
  assert.deepEqual(soundFrame(null, after, map).cues, [], 'joining mid-service replays nothing');
  for (const sound of Object.values(EVENT_SOUNDS)) assert.ok(sound in SOUND_LEVELS);
  assert.deepEqual((['serve', 'chop', 'wash', 'fire', 'warn', 'done', 'place', 'pickup', 'expire'] as EventType[]).map(type => EVENT_SOUNDS[type]), ['deliver', 'chop', 'wash', 'ignite', 'warning', 'ready', 'dish', 'dish', 'warning']);
});

test('mid-service tickets chime softly; opening tickets and history stay silent', () => {
  const before = view({ startedAt: 0, events: [event(1, 'order', 0), event(2, 'order', 0)] });
  assert.deepEqual(soundFrame(before, view({ now: 10_050, events: [...before.events, event(3, 'order', 10_020)] }), map).cues, ['ticket']);
  assert.deepEqual(soundFrame(view({ now: 20 }), view({ now: 60, events: [event(1, 'order', 0), event(2, 'order', 0)] }), map).cues, [], 'opening orders at startedAt are covered by the start bells');
  assert.deepEqual(VARIANTS.ticket, { clip: 'ready', rate: 1.35 });
  for (const variant of Object.values(VARIANTS)) assert.ok(CLIPS.includes(variant!.clip), 'variants reuse shipped clips');
});

test('final countdown: warning bell at 10 s, ticks for the last five seconds, once each', () => {
  const at = (left: number) => view({ now: 180_000 - left, endsAt: 180_000 });
  const cue = (from: number, to: number) => soundFrame(at(from), at(to), map).cues;
  assert.deepEqual(cue(10_050, 9_990), ['warning']);
  assert.deepEqual(cue(9_990, 9_940), [], 'the same second does not repeat');
  assert.deepEqual([8_000, 6_000].map(left => cue(left + 40, left - 10)), [[], []], 'quiet between the bell and the last five');
  assert.deepEqual([5, 4, 3, 2, 1].map(s => cue(s * 1000 + 30, s * 1000 - 20)), [['tick'], ['tick'], ['tick'], ['tick'], ['tick']]);
  assert.deepEqual(cue(11_050, 10_990), [], 'nothing before the last ten seconds');
  assert.deepEqual(soundFrame(null, at(4_990), map).cues, [], 'joining mid-countdown replays nothing');
});

test('start bells on a fresh service, end cue once at completion, then silence', () => {
  assert.deepEqual(soundFrame(null, view({ now: 400 }), map).cues, ['deliver', 'deliver']);
  const done = view({ complete: true, now: 180_000 });
  assert.deepEqual(soundFrame(view(), done, map), { cues: ['end'], loops: new Set(), chopping: false });
  assert.deepEqual(soundFrame(done, done, map).cues, []);
});

test('loops follow fire and heated food; chopping follows chef work', () => {
  const pot = { id: 1, kind: 'pot' as const, parts: [{ food: 'tomato' as const, state: 'chopped' as const }], cook: 2 };
  assert.deepEqual([...soundFrame(null, view({ tiles: [{ at: counter, item: pot }] }), stove).loops], ['simmer']);
  assert.deepEqual([...soundFrame(null, view({ tiles: [{ at: counter, item: pot }] }), map).loops], [], 'a pot on a counter is silent');
  assert.deepEqual([...soundFrame(null, view({ tiles: [{ at: counter, item: { ...pot, cook: POT_SECONDS + 9, parts: [{ food: 'tomato', state: 'burnt' }] }, fire: .4 }] }), stove).loops], ['fire']);
  const chopper = { work: 'chop' } as View['players'][number];
  assert.equal(soundFrame(null, view({ players: [chopper] }), map).chopping, true);
});

test('pack is small, decodable PCM with audible content and headroom', async () => {
  let bytes = 0;
  for (const name of CLIPS) {
    const file = await readFile(new URL(`../../../../public/games/kitchen-rush/audio/${name}.wav`, import.meta.url));
    bytes += file.length;
    assert.equal(file.toString('ascii', 0, 4), 'RIFF'); assert.equal(file.readUInt16LE(22), 1); assert.equal(file.readUInt32LE(24), 24000); assert.equal(file.readUInt16LE(34), 16);
    let peak = 0; for (let i = 44; i < file.length; i += 2) peak = Math.max(peak, Math.abs(file.readInt16LE(i)));
    assert.ok(peak > 10000 && peak < 29000, `${name} has signal without clipping`);
  }
  assert.ok(bytes < 700000);
});

test('mixer obeys mute and visibility, caps voices, stops loops when snapshots stall, and cleans up', async () => {
  const names = ['window', 'document', 'localStorage', 'AudioContext', 'fetch'] as const;
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: false });
  const sources: Source[] = []; let closed = false;
  class Source { buffer: { name: string } | null = null; loop = false; playbackRate = { value: 1 }; onended: (() => void) | null = null; stopped = false; connect() {} disconnect() {} start() { sources.push(this); } stop() { this.stopped = true; this.onended?.(); } }
  class Context { state = 'running'; currentTime = 0; destination = {}; createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; } createBufferSource() { return new Source(); } async decodeAudioData(data: ArrayBuffer) { return { name: new TextDecoder().decode(data) }; } async resume() {} async close() { closed = true; } }
  const replacements = [window, document, { getItem: () => 'false' }, Context, async (url: string) => ({ ok: !url.includes('ignite'), arrayBuffer: async () => new TextEncoder().encode(url.split('/').at(-1)!.replace('.wav', '')).buffer })];
  names.forEach((name, i) => Object.defineProperty(globalThis, name, { value: replacements[i], configurable: true }));
  const audio = new KitchenAudio();
  const live = () => sources.filter(source => !source.stopped);
  try {
    await audio.ready;
    const pot = { id: 1, kind: 'pot' as const, parts: [{ food: 'tomato' as const, state: 'chopped' as const }], cook: 1 };
    const fires = map.tiles.filter(tile => tile.kind === 'counter').slice(0, 6).map(tile => ({ at: tile.index, fire: .5, item: pot }));
    let current = view({ tiles: fires, now: 500 });
    audio.update(current);
    assert.equal(sources.filter(source => source.buffer?.name === 'deliver').length, 2, 'fresh service rings twice');
    assert.equal(live().filter(source => source.loop).length, 1, 'many fires share one loop');
    window.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: true } })); assert.equal(live().length, 0);
    const count = sources.length; current = view({ ...current, now: 550, events: [event(1, 'serve', 550)] }); audio.update(current);
    assert.equal(sources.length, count, 'muted plays nothing');
    window.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } }));
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); assert.equal(live().length, 0);
    document.hidden = false;
    await new Promise(resolve => setTimeout(resolve, 130));
    for (let i = 0; i < 40; i++) { current = view({ ...current, now: 600 + i * 50, events: [...current.events, event(10 + i, i % 2 ? 'place' : 'chop', 600 + i * 50)].slice(-32) }); audio.update(current); }
    assert.ok(live().length <= 8, 'bursts are capped at eight voices');
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.equal(live().filter(source => source.loop).length, 0, 'stale snapshots stop the loops');
    audio.dispose(); audio.dispose(); assert.equal(closed, true); assert.equal(live().length, 0);
    const disposed = sources.length; window.dispatchEvent(new Event('pointerdown')); audio.update(current); assert.equal(sources.length, disposed);
  } finally {
    audio.dispose();
    names.forEach((name, i) => { if (saved[i]) Object.defineProperty(globalThis, name, saved[i]!); else Reflect.deleteProperty(globalThis, name); });
  }
});

test('music follows the room: lobby bossa, service swing, rush in the last 30 s, silence while loading and at results', async () => {
  assert.equal(musicFor('lobby', null), 'lobby');
  for (const phase of ['picker', 'preparing', 'results'] as const) assert.equal(musicFor(phase, view()), null);
  assert.equal(musicFor('playing', null), null, 'no snapshot yet');
  assert.equal(musicFor('playing', view({ now: 10_000 })), 'service');
  assert.equal(musicFor('playing', view({ now: 180_000 - RUSH_SECONDS * 1000 })), 'rush');
  assert.equal(musicFor('playing', view({ now: 180_000, complete: true })), null, 'the closing gong and results sting take over');
  // Loops are whole bars (the swing tunes are one 32-bar chorus), and every track ships beside the effects.
  assert.deepEqual(Object.fromEntries(Object.keys(LOOPS).map(track => [track, +(LOOPS[track as keyof typeof LOOPS].bars * barSeconds(track as keyof typeof LOOPS)).toFixed(2)])), { lobby: 38.4, service: 58.18, rush: 50.53 });
  for (const name of Object.keys(MUSIC_LEVELS)) assert.ok((await readFile(new URL(`../../../../public/games/kitchen-rush/music/${name}.mp3`, import.meta.url))).length > 40_000, `${name}.mp3 ships`);
});
