import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { store } from '../store';
import { BackgroundMusic } from './music';

/**
 * Background music belongs to the host device, independently of its player seat: it plays on the watching display
 * and for a playing host, while snapshots keep arriving, and respects the platform mute.
 */
export class HostMusic {
  private ctx?: AudioContext;
  private playlist?: BackgroundMusic;
  private platformMuted = false;
  private active = false;
  private closed = false;
  private time = -1;
  private receivedAt = 0;

  constructor(private readonly scope: ResourceScope) {
    try { this.platformMuted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* private mode */ }
    const unlock = (e: Event) => { if (e.isTrusted) this.unlock(); };
    scope.listen(window, 'pointerdown', unlock, { capture: true });
    scope.listen(window, 'keydown', unlock, { capture: true });
    scope.listen(window, 'party-sound', e => {
      this.platformMuted = !!(e as CustomEvent<{ muted: boolean }>).detail?.muted;
      this.onMute();
    });
    scope.defer(store.subscribe((state, previous) => { if (state.settings.muted !== previous.settings.muted) this.onMute(); }));
    scope.listen(document, 'visibilitychange', () => {
      this.sync();
      if (document.hidden) void this.ctx?.suspend().catch(() => {});
      else this.unlock();
    });
    scope.listen(window, 'pagehide', () => { this.active = false; this.sync(); });
    scope.defer(() => {
      this.closed = true;
      this.playlist?.dispose();
      void this.ctx?.close().catch(() => {});
    });
    // Start already follows a host gesture. Browsers that require another tap keep it suspended.
    if (navigator.userActivation?.hasBeenActive) this.unlock();
  }

  /** The platform sound toggle or the in-game sound setting. */
  private get muted() { return this.platformMuted || store.get().settings.muted; }
  private onMute() {
    this.sync();
    if (!this.muted) this.unlock();
  }
  private unlock() {
    if (this.closed || this.muted || document.hidden) return;
    try {
      if (!this.ctx) {
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        this.ctx = new Context();
        this.playlist = new BackgroundMusic(this.ctx, this.ctx.destination);
        this.scope.listen(this.ctx, 'statechange', () => this.sync());
      }
      this.sync(true);
      if (this.ctx.state !== 'running') void this.ctx.resume().then(() => { if (!this.closed) this.sync(true); }).catch(() => {});
    } catch { /* Music failure must not interrupt the room or phone effects. */ }
  }
  private sync(retry = false) { this.playlist?.setPlaying(this.active && !this.muted && !document.hidden && this.ctx?.state === 'running', retry); }

  /** Call every frame with the latest world time: music plays while the time keeps advancing on a connected room. */
  update(time: number | undefined, connected: boolean) {
    const now = performance.now();
    if (time !== undefined && time !== this.time) {
      this.time = time;
      this.receivedAt = now;
    }
    const active = time !== undefined && connected && now - this.receivedAt < 1500;
    if (active === this.active) return;
    this.active = active;
    this.sync();
  }
}
