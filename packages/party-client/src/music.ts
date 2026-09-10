/** Optional user-supplied local music. Playback starts after a user interaction. */
export class MusicBus {
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private muted = false;
  async enable() { this.unlocked = true; this.muted = false; if (this.audio) { this.audio.muted = false; await this.audio.play(); } }
  setMuted(muted: boolean) { this.muted = muted; if (this.audio) this.audio.muted = muted; }
  async play(path: string) { if (!path.startsWith('/music/') || path.includes('..') || path.includes('?') || path.includes('#')) throw new Error('Use a local /music/ asset.'); this.stop(); this.audio = new Audio(path); this.audio.loop = true; this.audio.muted = this.muted; if (this.unlocked) await this.audio.play(); }
  stop() { if (!this.audio) return; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null; }
  dispose() { this.stop(); }
}
