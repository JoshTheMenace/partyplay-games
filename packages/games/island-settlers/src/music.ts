export const SOUNDTRACKS = ['isle-of-kingdoms', 'isle-of-two-paths', 'island-kingdom-suite'] as const;
/** Stream one track at a time; mute pauses without losing the playlist position. */
export class Soundtrack {
  private index = 0;
  private playing = false;
  private closed = false;
  private failed = new Set<number>();
  constructor(private audio: HTMLAudioElement = new Audio()) {
    audio.preload = 'none'; audio.loop = false; audio.volume = .22;
    audio.onended = () => this.next();
    audio.onerror = () => { this.failed.add(this.index); this.next(); };
    this.load();
  }
  private load() { this.audio.src = `/games/island-settlers/music/${SOUNDTRACKS[this.index]}.mp3`; }
  private next() {
    if (this.closed) return;
    if (this.failed.size === SOUNDTRACKS.length) { this.audio.pause(); return; }
    do { this.index = (this.index + 1) % SOUNDTRACKS.length; } while (this.failed.has(this.index));
    this.load(); if (this.playing) this.start();
  }
  private start() { void this.audio.play().catch(() => {}); } // A later gesture retries blocked autoplay.
  setPlaying(playing: boolean, retry = false) {
    if (this.closed) return;
    if (playing && retry && this.failed.size === SOUNDTRACKS.length) { this.failed.clear(); this.load(); }
    if (this.failed.size === SOUNDTRACKS.length || this.playing === playing && !retry) return;
    this.playing = playing; if (playing) this.start(); else this.audio.pause();
  }
  dispose() { this.closed = true; this.audio.onended = this.audio.onerror = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
}
