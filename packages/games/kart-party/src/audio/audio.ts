/* Kart Party sound: synthesised engines and effects (synth.ts), rules for what plays (cues.ts) and
 * streamed music (music.ts). Safe to construct anywhere: without WebAudio (Node, old browsers) every
 * method is a no-op. Honours the platform mute preference (localStorage 'party.sound.muted' and the
 * window 'party-sound' event) by suspending the whole context, so muted costs no CPU.
 *
 * Roles: 'display' (TV) and 'solo' (a device drawing its own race) get engines, effects and music;
 * 'controller' (a phone in TV mode) only voices its own honk, pickups, roulette and hits, quietly. */
import { clamp } from '../sim/math';
import { TOP_SPEED } from '../sim/stats';
import type { KartState, RaceEvent, RaceView } from '../sim/types';
import { CueTracker, viewportPan, type AudioRole, type Cue, type Focus, type LocalKart } from './cues';
import { musicFor, MusicPlayer, RESULTS_MUSIC } from './music';
import { createMixer, EngineVoice, panned, playSound, type Mixer } from './synth';
export type { AudioRole, LocalKart } from './cues';

const MAX_ENGINES = 4, MAX_ACTIVE_SOUNDS = 24, MAX_CUES_PER_FRAME = 10;
const PRIORITY: Partial<Record<Cue['sound'], number>> = { go: 9, countdown: 9, finish: 8, 'final-lap': 8, explode: 7, thunder: 7, comet: 7, hit: 7, lap: 6, 'mini-turbo': 6 };

export class KartAudio {
  private mute = false;
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private music: MusicPlayer | null = null;
  private engines = new Map<string, EngineVoice>();
  private pans = new Map<string, number>();
  private readonly cues: CueTracker;
  private active: number[] = [];                  // end times of scheduled one-shots
  private duckUntil = 0;
  private disposed = false;
  private hidden = false;
  private cleanups: (() => void)[] = [];

  /** `music` defaults on for the TV/solo roles; personal-view phones pass false so only the host streams it. */
  constructor(readonly role: AudioRole, readonly track: string, music = role !== 'controller') {
    this.cues = new CueTracker(role);
    if (typeof window === 'undefined') return;
    try { this.mute = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* storage can be unavailable */ }
    const listen = (target: EventTarget, type: string, fn: (e: Event) => void) => { target.addEventListener(type, fn, { passive: true }); this.cleanups.push(() => target.removeEventListener(type, fn)); };
    listen(window, 'party-sound', e => this.setMuted(!!(e as CustomEvent<{ muted?: boolean }>).detail?.muted));
    for (const type of ['pointerdown', 'keydown', 'touchend']) listen(window, type, () => this.unlock());
    if (typeof document !== 'undefined') { this.hidden = document.hidden; listen(document, 'visibilitychange', () => { this.hidden = document.hidden; this.sync(); }); }
    const Context = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      this.ctx = new Context({ latencyHint: 'interactive' });
      this.mixer = createMixer(this.ctx);
      if (music && typeof Audio !== 'undefined') { this.music = new MusicPlayer(this.ctx, this.mixer.music); this.music.preload(musicFor(track)); }
    } catch { this.ctx = null; this.mixer = null; this.music = null; }       // audio is optional: the game must run without it
    this.sync();
  }

  /** Call from a user gesture at least once (autoplay policy). Also done automatically on the first tap/key. */
  unlock() { this.sync(); if (!this.mute) this.music?.prime(musicFor(this.track)); }

  /** Override the stereo position of a focused racer's viewport (−1 left … 1 right). null restores the default. */
  setPan(racerId: string, pan: number | null) { if (pan === null) this.pans.delete(racerId); else this.pans.set(racerId, clamp(pan, -1, 1)); }

  /** Assigning is the same as setMuted: the context suspends/resumes to match. */
  get muted() { return this.mute; }
  set muted(muted: boolean) { this.setMuted(muted); }
  setMuted(muted: boolean) { this.mute = muted; this.sync(); }

  /** Once per frame. focusIds: racers whose engines/events this device voices (its own racer, or the
   * split-screen racers in viewport order). newEvents may repeat events already passed: ids are deduped.
   * local (optional): the predicted kart, so its engine, drift chimes and kart events sound with no lag. */
  update(view: RaceView | null, focusIds: readonly string[], newEvents: readonly RaceEvent[], dt: number, local?: LocalKart | null) {
    void dt;
    if (this.disposed) return;
    if (!view) { this.stopEngines(); this.music?.stop(); return; }
    const focus: Focus[] = focusIds.map((id, i) => ({ id, pan: this.pans.get(id) ?? viewportPan(i, focusIds.length) }));
    const cues = this.cues.frame(view, focus, newEvents, local);
    const ctx = this.ctx, m = this.mixer;
    if (!ctx || !m || ctx.state !== 'running' || this.muted) return;
    const now = ctx.currentTime;
    if (this.role !== 'controller') { this.updateEngines(view, focus, m, local); this.updateMusic(view, focus); }
    this.active = this.active.filter(end => end > now);
    const ordered = cues.length > 1 ? [...cues].sort((a, b) => (PRIORITY[b.sound] ?? 0) - (PRIORITY[a.sound] ?? 0)) : cues;
    for (const cue of ordered.slice(0, MAX_CUES_PER_FRAME)) {
      if (this.active.length >= MAX_ACTIVE_SOUNDS && (PRIORITY[cue.sound] ?? 0) < 7) continue;
      const out = panned(m, cue.pan, cue.gain * (this.role === 'controller' ? .8 : 1));
      const length = playSound(m, out, now + .01, cue.sound, cue.value);
      this.active.push(now + length);
      setTimeout(() => out.disconnect(), (length + .5) * 1000);
      if (cue.sound === 'finish' || cue.sound === 'final-lap') this.duck(length);
    }
    if (this.duckUntil && now > this.duckUntil) { this.duckUntil = 0; m.duck.gain.setTargetAtTime(1, now, .25); }
  }

  /** Stop everything and release the audio device. Idempotent. */
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const c of this.cleanups.splice(0)) c();
    this.stopEngines(); this.music?.dispose(); this.music = null;
    void this.ctx?.close().catch(() => {}); this.ctx = null; this.mixer = null;
  }

  /** Resume or suspend the context to match mute/visibility; music follows. */
  private sync() {
    const ctx = this.ctx; if (!ctx || this.disposed) return;
    const audible = !this.mute && !this.hidden;
    if (audible) { if (ctx.state === 'suspended') void ctx.resume().catch(() => {}); this.music?.resume(); }
    else { this.music?.pause(); if (ctx.state === 'running') void ctx.suspend().catch(() => {}); }
  }

  private updateEngines(view: RaceView, focus: readonly Focus[], m: Mixer, local?: LocalKart | null) {
    const racing = view.phase !== 'results', voiced = new Set<string>(), top = TOP_SPEED[view.speedClass] ?? 29;
    const count = Math.min(focus.length, MAX_ENGINES), level = .62 / Math.sqrt(Math.max(1, count));
    for (const f of focus.slice(0, MAX_ENGINES)) {
      const r = view.racers.find(x => x.id === f.id); if (!r || !racing) continue;
      voiced.add(r.id);
      let voice = this.engines.get(r.id);
      if (!voice) this.engines.set(r.id, voice = new EngineVoice(m));
      voice.set(engineState(local?.id === r.id ? local.kart : r, top, view.time < 0, level, f.pan));
    }
    for (const [id, voice] of this.engines) if (!voiced.has(id)) { voice.stop(.6); this.engines.delete(id); }
  }
  private stopEngines() { for (const voice of this.engines.values()) voice.stop(.4); this.engines.clear(); }

  private updateMusic(view: RaceView, focus: readonly Focus[]) {
    const music = this.music; if (!music) return;
    if (view.phase === 'results') { music.setRate(1); music.play(RESULTS_MUSIC, .7, 2.5); }
    else if (view.time >= -.05) {
      music.play(musicFor(view.track), 1);
      const watched = focus.length ? view.racers.filter(r => focus.some(f => f.id === r.id)) : view.racers;
      music.setRate(view.laps > 1 && watched.some(r => r.lap >= view.laps && r.finishTime === null) ? 1.06 : 1);
    }
    music.tick();
  }
  private duck(seconds: number) {
    const m = this.mixer, ctx = this.ctx; if (!m || !ctx) return;
    m.duck.gain.setTargetAtTime(.45, ctx.currentTime, .05); this.duckUntil = Math.max(this.duckUntil, ctx.currentTime + seconds);
  }
}

function engineState(r: KartState, top: number, countdown: boolean, gain: number, pan: number) {
  const surface = r.surface === 'offroad' || r.offroad ? 'offroad' : r.surface === 'water' ? 'water' : r.surface === 'ice' ? 'ice' : r.surface === 'road' || r.surface === 'boost' ? 'road' : 'other';
  return {
    speed: Math.hypot(r.vx, r.vz) / top + (countdown ? .04 : 0), boost: r.boostT > 0 || r.starT > 0, air: !r.grounded, drift: r.drift, tier: r.driftTier,
    surface, hurt: r.spinT > 0 || r.tumbleT > 0 || r.stallT > 0 || r.shockT > 0, muffled: r.respawnT > 0, gain, pan,
  } as const;
}
