import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_BASE, PLAYLISTS, Playlist, StarshipMusic, browserEnv, musicCategory } from '../src/render/music';
/** Mimics a real element: assigning src resets currentTime; `dropEarlySeek` models browsers that ignore a seek before metadata. */
class Media {
  private _src = ''; private _time = 0; preload = ''; loop = true; paused = true; plays = 0; loads = 0; blocked = false; dropEarlySeek = false; metadata = false; duration = NaN;
  onended: (() => void) | null = null; onerror: (() => void) | null = null; onloadedmetadata: (() => void) | null = null;
  get src() { return this._src; } set src(value: string) { this._src = value; this._time = 0; this.metadata = false; }
  get currentTime() { return this._time; } set currentTime(value: number) { if (this.dropEarlySeek && !this.metadata) return; this._time = value; }
  loadMetadata(duration = 300) { this.metadata = true; this.duration = duration; this.onloadedmetadata?.(); }
  play() { this.plays++; this.paused = false; return this.blocked ? Promise.reject(new Error('Gesture required')) : Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  load() { this.loads++; }
}
class Node { closed = false; connect() {} disconnect() { this.closed = true; } }
class FakeContext extends EventTarget {
  state: AudioContextState = 'suspended'; destination = new Node(); closed = false; source = new Node(); gain = Object.assign(new Node(), { gain: { value: 1 } });
  createMediaElementSource() { return this.source; } createGain() { return this.gain; }
  resume() { this.state = 'running'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
  suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
}
const playlist = () => { const media = new Media(), ctx = new FakeContext(); return { media, ctx, music: new Playlist(ctx as unknown as AudioContext, ctx.destination as unknown as AudioNode, media as unknown as HTMLAudioElement) }; };
const src = (category: keyof typeof PLAYLISTS, i: number) => `${MUSIC_BASE}${PLAYLISTS[category][i]}.mp3`;
const combat = { phase: 'combat' } as const, route = { phase: 'route' } as const;
test('battle only during real combat, pause included; every other room and game phase idles; the picker is silent', () => {
  assert.equal(musicCategory('lobby', null), 'idle'); assert.equal(musicCategory('preparing', null), 'idle'); assert.equal(musicCategory('picker', null), 'silent');
  for (const phase of ['hangar', 'assignment', 'route', 'event', 'rewards', 'store', 'results'] as const) assert.equal(musicCategory('playing', { phase }), 'idle', phase);
  assert.equal(musicCategory('playing', combat), 'battle'); assert.equal(musicCategory('results', combat), 'idle', 'results screen idles even when the last snapshot was combat');
  assert.equal(musicCategory('playing', null), 'idle', 'no snapshot yet means idle, never silence mid-round');
});
test('each playlist loops in order through one element with modest gain, and the seven user tracks are all referenced', () => {
  const { media, music, ctx } = playlist(); assert.equal(media.preload, 'none'); assert.equal(media.loop, false); assert.equal(ctx.gain.gain.value, .16);
  music.setPlaying(true); assert.equal(media.plays, 1);
  for (let i = 0; i < 8; i++) { assert.equal(media.src, src('idle', i % 4)); media.onended!(); }
  music.setCategory('battle'); for (let i = 0; i < 6; i++) { assert.equal(media.src, src('battle', i % 3)); media.onended!(); }
  assert.equal(new Set([...PLAYLISTS.battle, ...PLAYLISTS.idle]).size, 7); music.dispose();
});
test('switching category is prompt and each category resumes its own progression instead of restarting at track one', () => {
  const { media, music } = playlist(); music.setPlaying(true);
  media.onended!(); media.onended!(); assert.equal(media.src, src('idle', 2));
  music.setCategory('battle'); assert.equal(media.src, src('battle', 0)); media.onended!(); assert.equal(media.src, src('battle', 1));
  music.setCategory('idle'); assert.equal(media.src, src('idle', 2), 'idle continues where it left off');
  music.setCategory('battle'); assert.equal(media.src, src('battle', 1), 'battle continues where it left off');
  const plays = media.plays; music.setCategory('battle'); assert.equal(media.plays, plays, 'same category is a no-op'); music.dispose();
});
test('switching away remembers the playback time per category and restores it on return; advancing a track resets to its start', () => {
  const { media, music } = playlist(); music.setPlaying(true);
  media.currentTime = 40; music.setCategory('battle'); assert.equal(media.currentTime, 0, 'a new src starts at zero');
  media.currentTime = 25; music.setCategory('idle'); assert.equal(media.src, src('idle', 0)); assert.equal(media.currentTime, 40, 'idle resumes at 40s');
  music.setCategory('battle'); assert.equal(media.currentTime, 25, 'battle resumes at 25s rather than replaying its opening');
  media.onended!(); assert.equal(media.src, src('battle', 1)); assert.equal(media.currentTime, 0, 'the next track starts from its beginning');
  media.currentTime = 12; music.setCategory('idle'); music.setCategory('battle'); assert.equal(media.src, src('battle', 1)); assert.equal(media.currentTime, 12);
  music.setCategory('idle'); media.onended!(); music.setCategory('battle'); music.setCategory('idle'); assert.equal(media.currentTime, 0, 'advancing while away cleared the saved idle offset'); music.dispose();
});
test('browsers that drop an early seek get the restore once metadata loads, but never for a different track loaded meanwhile', () => {
  const { media, music } = playlist(); media.dropEarlySeek = true; music.setPlaying(true); media.loadMetadata();
  media.currentTime = 90; music.setCategory('battle'); media.currentTime = 30; music.setCategory('idle');
  assert.equal(media.currentTime, 0, 'early seek dropped'); media.loadMetadata(); assert.equal(media.currentTime, 90, 'restored at metadata');
  const stale = media.onloadedmetadata; music.setCategory('battle'); assert.equal(media.currentTime, 0); media.onended!(); stale?.(); assert.equal(media.src, src('battle', 1)); assert.equal(media.currentTime, 0, 'a stale handler for the old track does nothing');
  music.setCategory('idle'); media.loadMetadata(60); assert.equal(media.currentTime, 59, 'restore is clamped inside a shorter duration'); music.dispose(); assert.equal(media.onloadedmetadata, null);
});
test('repeated snapshots never restart a track; pausing keeps position; a category change while paused waits for playback', () => {
  const { media, music } = playlist(); music.setPlaying(true); media.currentTime = 40;
  for (let i = 0; i < 50; i++) music.setPlaying(true); assert.equal(media.plays, 1);
  music.setPlaying(false); assert.equal(media.paused, true); assert.equal(media.currentTime, 40);
  music.setCategory('battle'); assert.equal(media.plays, 1, 'no play while inactive'); music.setPlaying(true); assert.equal(media.plays, 2); assert.equal(media.src, src('battle', 0)); music.dispose();
});
test('blocked storage: a throwing localStorage getter or getItem never breaks mount, and music still plays once unmuted', async () => {
  const saved = { window: Object.getOwnPropertyDescriptor(globalThis, 'window'), document: Object.getOwnPropertyDescriptor(globalThis, 'document'), navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  const win = new EventTarget(); Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError: storage blocked'); } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win }); Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), { hidden: false }) }); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userActivation: { hasBeenActive: true } } });
  try { const env = browserEnv(); assert.equal(env.storage, undefined); assert.equal(env.activated, true); }
  finally { for (const [key, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  const h = host(); const before = h.contexts.length; const throwing = new StarshipMusic({ win: h.win, doc: h.doc, storage: { getItem: () => { throw new Error('blocked'); } }, activated: true, audio: () => new Media() as unknown as HTMLAudioElement });
  throwing.update(props('lobby', null)); await Promise.resolve(); assert.equal(h.contexts.length, before + 1, 'plays with the default unmuted preference'); throwing.dispose(); h.music.dispose();
});
test('a bad track is skipped once, an exhausted playlist stops without retry loops, and the other playlist still works', async () => {
  const { media, music } = playlist(); music.setPlaying(true);
  media.onerror!(); assert.equal(media.src, src('idle', 1));
  for (let i = 0; i < 3; i++) media.onerror!(); assert.equal(media.paused, true); const plays = media.plays;
  for (let i = 0; i < 50; i++) music.setPlaying(true, true); assert.equal(media.plays, plays, 'exhausted idle playlist never retries');
  music.setCategory('battle'); assert.equal(media.paused, false); assert.equal(media.src, src('battle', 0));
  media.blocked = true; music.setPlaying(true, true); await Promise.resolve(); music.dispose();
});
test('disposal stops playback, releases the element and nodes, and ignores late events', () => {
  const { media, music, ctx } = playlist(); music.setPlaying(true); const ended = media.onended!; music.dispose(); ended(); music.setPlaying(true, true); music.setCategory('battle');
  assert.equal(media.paused, true); assert.equal(media.src, ''); assert.equal(media.loads, 1); assert.equal(media.onended, null); assert.equal(ctx.source.closed, true); assert.equal(ctx.gain.closed, true);
});
function host(options: { muted?: boolean; activated?: boolean; hidden?: boolean } = {}) {
  const win = Object.assign(new EventTarget(), { AudioContext: FakeContext as unknown as typeof AudioContext }), doc = Object.assign(new EventTarget(), { hidden: options.hidden ?? false });
  const medias: Media[] = [], contexts: FakeContext[] = [];
  win.AudioContext = class extends FakeContext { constructor() { super(); contexts.push(this); } } as unknown as typeof AudioContext;
  const music = new StarshipMusic({ win, doc, storage: { getItem: () => options.muted ? 'true' : 'false' }, activated: options.activated ?? true, audio: () => { const m = new Media(); medias.push(m); return m as unknown as HTMLAudioElement; } });
  // Real browsers only unlock audio on trusted input; Node events are untrusted, so the fake gesture flags itself as trusted.
  const gesture = () => { const event = new Event('pointerdown'); Object.defineProperty(event, 'isTrusted', { value: true }); win.dispatchEvent(event); };
  return { win, doc, medias, contexts, music, gesture, media: () => medias[0], ctx: () => contexts[0] };
}
const props = (phase: 'lobby' | 'playing' | 'results' | 'picker', view: { phase: 'combat' | 'route' } | null, connected = true) => ({ phase, publicView: view as never, connected });
test('host soundtrack: idle from the lobby, battle in combat including pause, and a single element for the whole room', async () => {
  const h = host(); await Promise.resolve(); h.music.update(props('lobby', null)); await Promise.resolve();
  assert.equal(h.contexts.length, 1); assert.equal(h.medias.length, 1); assert.equal(h.media().src, src('idle', 0)); assert.equal(h.media().paused, false);
  h.music.update(props('playing', route)); h.music.update(props('playing', combat)); assert.equal(h.media().src, src('battle', 0));
  h.music.update(props('playing', combat)); h.music.update(props('playing', combat)); assert.equal(h.media().plays, 2, 'combat snapshots do not restart the track');
  h.music.update(props('results', combat)); assert.equal(h.media().src, src('idle', 0)); assert.equal(h.medias.length, 1); h.music.dispose();
});
test('disconnect, hidden document, pagehide and mute stop playback; unmute, visibility and gestures resume without rejected promises', async () => {
  const h = host(); h.music.update(props('playing', combat)); await Promise.resolve(); assert.equal(h.media().paused, false);
  h.music.update(props('playing', combat, false)); assert.equal(h.media().paused, true); h.music.update(props('playing', combat)); assert.equal(h.media().paused, false);
  h.doc.hidden = true; h.doc.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); assert.equal(h.media().paused, true); assert.equal(h.ctx().state, 'suspended');
  h.doc.hidden = false; h.doc.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); await Promise.resolve(); assert.equal(h.media().paused, false); assert.equal(h.ctx().state, 'running');
  h.win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: true } })); assert.equal(h.media().paused, true);
  h.win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } })); await Promise.resolve(); assert.equal(h.media().paused, false);
  h.win.dispatchEvent(new Event('pagehide')); assert.equal(h.media().paused, true);
  h.media().blocked = true; h.gesture(); await Promise.resolve(); h.media().blocked = false; h.music.update(props('playing', combat)); h.gesture(); await Promise.resolve(); assert.equal(h.media().paused, false);
  h.music.dispose(); assert.equal(h.ctx().closed, true); assert.equal(h.media().src, '');
});
test('a stored mute preference or no prior gesture creates no audio until unmuted or tapped; stale events after disposal are inert', async () => {
  const muted = host({ muted: true }); muted.music.update(props('lobby', null)); assert.equal(muted.contexts.length, 0);
  muted.win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } })); await Promise.resolve(); assert.equal(muted.contexts.length, 1); assert.equal(muted.media().paused, false); muted.music.dispose();
  const cold = host({ activated: false }); cold.music.update(props('lobby', null)); assert.equal(cold.contexts.length, 0); cold.gesture(); await Promise.resolve(); assert.equal(cold.contexts.length, 1); cold.music.dispose();
  cold.gesture(); cold.win.dispatchEvent(new CustomEvent('party-sound', { detail: { muted: false } })); assert.equal(cold.contexts.length, 1); assert.equal(cold.media().paused, true);
  const untrusted = host({ activated: false }); untrusted.win.dispatchEvent(new Event('pointerdown')); assert.equal(untrusted.contexts.length, 0, 'synthetic untrusted input never unlocks audio'); untrusted.music.dispose();
});
