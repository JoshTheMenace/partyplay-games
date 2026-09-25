import type { RoomPhase } from '../../../../party-contract/src/protocol';
import { ResourceScope } from '../../../../party-runtime/src/index';
import type { GameAudioProps } from '../../../../party-ui/src/index';
import type { PublicView } from '../contracts';
export const PLAYLISTS = {
  battle: ['fleet-engagement', 'mision-silenciosa', 'starfield-clash'],
  idle: ['cosmic-discovery', 'quiet-discovery', 'weightless-drift', 'weightless-drift-1'],
} as const;
export type Category = keyof typeof PLAYLISTS;
export const MUSIC_BASE = '/games/starship-scramble/music/';
/** Battle only while the round is actually in combat, tactical pause included. Every other room and game phase idles; the picker is silent. */
export function musicCategory(phase: RoomPhase, view: Pick<PublicView, 'phase'> | null): Category | 'silent' {
  if (phase === 'picker') return 'silent';
  return phase === 'playing' && view?.phase === 'combat' ? 'battle' : 'idle';
}
/** One streamed element routed through a gain node. Each category remembers its own position so switching never restarts a playlist. */
export class Playlist {
  private category: Category = 'idle';
  private index: Record<Category, number> = { battle: 0, idle: 0 };
  private failed: Record<Category, Set<number>> = { battle: new Set(), idle: new Set() };
  /** Seconds into the current track of each category, saved when switching away so short battles do not replay one opening forever. */
  private offset: Record<Category, number> = { battle: 0, idle: 0 };
  private playing = false;
  private closed = false;
  private source: MediaElementAudioSourceNode;
  private gain: GainNode;
  constructor(ctx: AudioContext, destination: AudioNode, private audio: HTMLAudioElement = new Audio(), volume = .16) {
    audio.preload = 'none'; audio.loop = false;
    this.source = ctx.createMediaElementSource(audio); this.gain = ctx.createGain(); this.gain.gain.value = volume;
    this.source.connect(this.gain); this.gain.connect(destination);
    audio.onended = () => this.advance(); audio.onerror = () => { this.failed[this.category].add(this.index[this.category]); this.advance(); };
    this.load();
  }
  get track() { return PLAYLISTS[this.category][this.index[this.category]]; }
  private exhausted(category = this.category) { return this.failed[category].size >= PLAYLISTS[category].length; }
  private load() {
    const track = this.track, seconds = this.offset[this.category];
    this.audio.onloadedmetadata = null; this.audio.src = `${MUSIC_BASE}${track}.mp3`;
    if (seconds <= 0) return;
    // Browsers accept an initial seek before loading; the metadata handler covers those that drop it, and only for this same track.
    try { this.audio.currentTime = seconds; } catch { /* seek before metadata may be refused */ }
    this.audio.onloadedmetadata = () => {
      this.audio.onloadedmetadata = null;
      if (this.closed || this.track !== track || Math.abs(this.audio.currentTime - seconds) < 1) return;
      try { this.audio.currentTime = Math.min(seconds, this.audio.duration > 0 ? this.audio.duration - 1 : seconds); } catch { /* keep playing from wherever the browser landed */ }
    };
  }
  private start() { void this.audio.play().catch(() => { /* Autoplay policy or a mid-stream error; the next gesture or track retries. */ }); }
  private advance() {
    if (this.closed) return;
    if (this.exhausted()) { this.audio.pause(); return; }
    const tracks = PLAYLISTS[this.category];
    do { this.index[this.category] = (this.index[this.category] + 1) % tracks.length; } while (this.failed[this.category].has(this.index[this.category]));
    this.offset[this.category] = 0; this.load(); if (this.playing) this.start();
  }
  setCategory(category: Category) {
    if (this.closed || category === this.category) return;
    this.offset[this.category] = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    this.category = category;
    if (this.exhausted()) { this.audio.pause(); return; }
    this.load(); if (this.playing) this.start();
  }
  setPlaying(playing: boolean, retry = false) {
    if (this.closed || (this.playing === playing && !retry)) return;
    this.playing = playing;
    if (!playing) { this.audio.pause(); return; }
    if (!this.exhausted()) this.start();
  }
  dispose() {
    this.closed = true; this.playing = false; this.audio.onended = this.audio.onerror = this.audio.onloadedmetadata = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    this.source.disconnect(); this.gain.disconnect();
  }
}
type Env = { win: EventTarget & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }; doc: EventTarget & { hidden: boolean }; storage?: Pick<Storage, 'getItem'>; activated?: boolean; audio?: () => HTMLAudioElement };
/** Even reading window.localStorage can throw when storage is blocked; music must still mount. */
export const browserEnv = (): Env => { let storage: Env['storage']; try { storage = window.localStorage; } catch { storage = undefined; } return { win: window as unknown as Env['win'], doc: document, storage, activated: navigator.userActivation?.hasBeenActive }; };
/** Host soundtrack. Silent until a trusted gesture (or an earlier one) unlocks audio; follows the shell's mute event and stored preference. */
export class StarshipMusic {
  private ctx?: AudioContext;
  private playlist?: Playlist;
  private muted = false;
  private active = false;
  private category: Category | 'silent' = 'silent';
  private closed = false;
  private scope = new ResourceScope();
  constructor(private env: Env = browserEnv()) {
    try { this.muted = env.storage?.getItem('party.sound.muted') === 'true'; } catch { /* storage may be unavailable */ }
    const unlock = (event: Event) => { if (event.isTrusted !== false) this.unlock(); };
    this.scope.listen(env.win, 'pointerdown', unlock, { capture: true }); this.scope.listen(env.win, 'keydown', unlock, { capture: true });
    this.scope.listen(env.win, 'party-sound', event => { this.muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted; this.sync(); if (!this.muted) this.unlock(); });
    this.scope.listen(env.doc, 'visibilitychange', () => { this.sync(); if (env.doc.hidden) void this.ctx?.suspend().catch(() => {}); else this.unlock(); });
    this.scope.listen(env.win, 'pagehide', () => { this.active = false; this.sync(); });
    this.scope.defer(() => { this.closed = true; this.playlist?.dispose(); this.playlist = undefined; void this.ctx?.close().catch(() => {}); this.ctx = undefined; });
    if (env.activated) this.unlock();
  }
  private unlock() {
    if (this.closed || this.muted || this.env.doc.hidden) return;
    try {
      if (!this.ctx) {
        const Context = this.env.win.AudioContext ?? this.env.win.webkitAudioContext; if (!Context) return;
        this.ctx = new Context(); this.playlist = new Playlist(this.ctx, this.ctx.destination, this.env.audio?.());
        this.scope.listen(this.ctx, 'statechange', () => this.sync());
        if (this.category !== 'silent') this.playlist.setCategory(this.category);
      }
      this.sync(true);
      if (this.ctx.state !== 'running') void this.ctx.resume().then(() => { if (!this.closed) this.sync(true); }).catch(() => {});
    } catch { /* Music must never break the room. */ }
  }
  private sync(retry = false) { this.playlist?.setPlaying(this.active && !this.muted && !this.env.doc.hidden && this.ctx?.state === 'running', retry); }
  update(props: Pick<GameAudioProps<PublicView>, 'phase' | 'publicView' | 'connected'>) {
    this.category = musicCategory(props.phase, props.publicView);
    if (this.category !== 'silent') this.playlist?.setCategory(this.category);
    this.active = props.connected && this.category !== 'silent';
    this.sync();
  }
  dispose() { this.scope.dispose(); }
}
