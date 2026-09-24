/* Streamed race music: two <audio> decks routed through WebAudio so songs crossfade into each other and
 * loop without the gap an mp3 `loop` leaves. Reserved assets: public/music is read, never changed. */
import type { TrackId } from '../sim/types';

export const MUSIC_BASE = '/games/kart-party/music/';
/** The longest cuts carry a whole 3-lap race without looping. */
export const TRACK_MUSIC: Record<TrackId, string> = {
  'palm-bay': 'sugar-rush-circuit-alt.mp3', 'mesa-rally': 'rainbow-drift-dash.mp3', 'neon-drive': 'rainbow-lap-rush-alt.mp3', 'frost-peak': 'rainbow-lap-rush.mp3', 'rainbow-road': 'rainbow-lap-rush.mp3',
};
export const RESULTS_MUSIC = 'sugar-rush-circuit.mp3';
export const musicFor = (track: string) => TRACK_MUSIC[track as TrackId] ?? TRACK_MUSIC['palm-bay'];

const LOOP_FADE = 2.5;
type Deck = { el: HTMLAudioElement; gain: GainNode; file: string | null };

export class MusicPlayer {
  private decks: Deck[];
  private active = 0;
  private wanted: string | null = null;
  private level = 1;
  private rate = 1;
  private paused = false;
  private primed = false;
  constructor(private readonly ctx: AudioContext, out: AudioNode) {
    this.decks = [0, 1].map(() => {
      const el = new Audio(); el.preload = 'auto';
      const gain = ctx.createGain(); gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(out);
      return { el, gain, file: null };
    });
  }
  /** iOS only lets a media element start inside a user gesture: call from one to unlock both decks
   * (they play silently at zero gain for a moment). Retries on the next gesture if refused. */
  prime(file: string) {
    if (this.primed) return; this.primed = true;
    for (const d of this.decks) {
      if (!d.file) this.load(d, file);
      if (d.el.paused) void d.el.play().then(() => { if (this.decks[this.active] !== d || !this.wanted || this.paused) d.el.pause(); }, () => { this.primed = false; });
    }
  }
  /** Start buffering a song so it starts instantly later. */
  preload(file: string) { const d = this.decks[this.active]; if (!d.file) this.load(d, file); }
  /** Play `file` at `level` (0..1), crossfading from whatever plays now. Repeated calls are cheap. */
  play(file: string, level = 1, fade = 1.2) {
    const d = this.decks[this.active];
    if (this.wanted === file) { if (level !== this.level) { this.level = level; this.ramp(d, level, .8); } if (d.el.paused && !this.paused) void d.el.play().catch(() => {}); return; }
    this.wanted = file; this.level = level;
    if (d.el.paused) this.start(d, file, .3); else this.start(this.decks[1 - this.active], file, fade);
  }
  /** Loop crossfade; call every frame. */
  tick() {
    const d = this.decks[this.active];
    if (this.paused || !this.wanted || d.el.paused || !Number.isFinite(d.el.duration)) return;
    if (d.el.duration - d.el.currentTime < LOOP_FADE * this.rate) this.start(this.decks[1 - this.active], this.wanted, LOOP_FADE);
  }
  /** Final-lap lift: slightly faster and higher, like the classics. */
  setRate(rate: number) {
    if (rate === this.rate) return; this.rate = rate;
    for (const d of this.decks) this.applyRate(d.el);
  }
  stop(fade = 1.5) {
    if (this.wanted === null) return;
    this.wanted = null;
    const t = this.ctx.currentTime;
    for (const d of this.decks) { d.gain.gain.cancelScheduledValues(t); d.gain.gain.setTargetAtTime(0, t, fade / 4); const el = d.el; setTimeout(() => { if (this.wanted === null) el.pause(); }, fade * 1000 + 100); }
  }
  /** Pause without forgetting the song (mute, hidden tab). */
  pause() { this.paused = true; for (const d of this.decks) d.el.pause(); }
  resume() {
    if (!this.paused) return; this.paused = false;
    const d = this.decks[this.active];
    if (this.wanted && d.file) void d.el.play().catch(() => {});
  }
  dispose() {
    this.wanted = null;
    for (const d of this.decks) { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); d.gain.disconnect(); }
  }

  private load(d: Deck, file: string) { d.file = file; d.el.src = MUSIC_BASE + file; this.applyRate(d.el); }
  private applyRate(el: HTMLAudioElement) {
    const media = el as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    media.preservesPitch = media.webkitPreservesPitch = media.mozPreservesPitch = this.rate === 1;
    el.playbackRate = this.rate;
  }
  private ramp(d: Deck, to: number, fade: number) {
    const t = this.ctx.currentTime, g = d.gain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(to, t + Math.max(.02, fade));
  }
  /** Play `file` from the top on deck `d`, fading it in and fading out the other deck. */
  private start(d: Deck, file: string, fade: number) {
    const old = this.decks[this.active];
    if (d.file !== file) this.load(d, file); else d.el.currentTime = 0;
    this.applyRate(d.el);
    if (!this.paused) void d.el.play().catch(() => {});
    if (d !== old) { this.ramp(old, 0, fade); const el = old.el; setTimeout(() => { if (this.decks[this.active] !== old) el.pause(); }, fade * 1000 + 150); }
    const g = d.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(this.level, t + Math.max(.05, fade));
    this.active = this.decks.indexOf(d);
  }
}
