/** Positional game sound effects through Web Audio: licensed samples plus a few tiny synthesized sounds. */
import type { ResourceScope } from '../../../../../party-runtime/src/index';
import { store } from '../store';
import { SOUND_FILES, type SynthSound } from './sounds';

/** `range`: hearing distance in blocks (default 24; ghasts and explosions carry further). */
export type PlayOptions = { at?: readonly [number, number, number]; volume?: number; pitch?: number; jitter?: number; range?: number };
const MAX_VOICES = 28, HEARING = 24;
const mutedByPlatform = () => { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } };

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private readonly synths = new Map<SynthSound, AudioBuffer>();
  private platformMuted = mutedByPlatform();
  private voices = 0;
  private closed = false;
  private readonly listener = { x: 0, y: 0, z: 0 };

  constructor(private readonly scope: ResourceScope, private readonly base = '/games/blockwild/sounds/') {
    const unlock = (e: Event) => { if (e.isTrusted) this.unlock(); };
    scope.listen(window, 'pointerdown', unlock, { capture: true });
    scope.listen(window, 'keydown', unlock, { capture: true });
    scope.listen(window, 'touchend', unlock, { capture: true });
    scope.listen(window, 'party-sound', e => { this.platformMuted = !!(e as CustomEvent<{ muted: boolean }>).detail?.muted; this.applyVolume(); });
    scope.listen(document, 'visibilitychange', () => { if (document.hidden) void this.ctx?.suspend().catch(() => {}); else this.unlock(); });
    scope.defer(store.subscribe((state, previous) => { if (state.settings.muted !== previous.settings.muted) this.applyVolume(); }));
    scope.defer(() => { this.closed = true; void this.ctx?.close().catch(() => {}); });
    if (navigator.userActivation?.hasBeenActive) this.unlock();
  }

  private get muted() { return this.platformMuted || store.get().settings.muted; }
  private applyVolume() { if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.02); }

  private unlock() {
    if (this.closed || document.hidden) return;
    try {
      if (!this.ctx) {
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        this.ctx = new Context();
        const compressor = this.ctx.createDynamicsCompressor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        this.master.connect(compressor);
        compressor.connect(this.ctx.destination);
        this.buildSynths(this.ctx);
        for (const name of SOUND_FILES) void this.load(name);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch { /* sound must never break the game */ }
  }

  private async load(name: string) {
    if (this.buffers.has(name) || !this.ctx) return;
    this.buffers.set(name, null);
    try {
      const response = await fetch(`${this.base}${name}.wav`, { signal: this.scope.signal });
      if (!response.ok) return;
      const data = await response.arrayBuffer();
      if (this.ctx && !this.closed) this.buffers.set(name, await this.ctx.decodeAudioData(data));
    } catch { /* missing sample: stays silent */ }
  }

  /** Listener pose (camera position and yaw). Called every frame; allocation-free. */
  setListener(x: number, y: number, z: number, yaw: number) {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    l.positionX.value = x;
    l.positionY.value = y;
    l.positionZ.value = z;
    l.forwardX.value = -Math.sin(yaw);
    l.forwardY.value = 0;
    l.forwardZ.value = -Math.cos(yaw);
    l.upY.value = 1;
  }

  play(name: string, options: PlayOptions = {}) { this.start(this.buffers.get(name) ?? null, options); }
  synth(name: SynthSound, options: PlayOptions = {}) { this.start(this.synths.get(name) ?? null, options); }

  private start(buffer: AudioBuffer | null, { at, volume = 1, pitch = 1, jitter = 0.08, range = HEARING }: PlayOptions) {
    const ctx = this.ctx, master = this.master;
    if (!buffer || !ctx || !master || ctx.state !== 'running' || this.muted || this.voices >= MAX_VOICES) return;
    if (at && Math.hypot(at[0] - this.listener.x, at[1] - this.listener.y, at[2] - this.listener.z) > range) return;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = pitch * (1 + (Math.random() * 2 - 1) * jitter);
    gain.gain.value = volume;
    source.connect(gain);
    if (at) {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.refDistance = 1.5;
      panner.maxDistance = range;
      panner.positionX.value = at[0];
      panner.positionY.value = at[1];
      panner.positionZ.value = at[2];
      gain.connect(panner);
      panner.connect(master);
    } else gain.connect(master);
    this.voices++;
    source.onended = () => { this.voices--; source.disconnect(); gain.disconnect(); };
    source.start();
  }

  /** Small procedurally generated sounds for events without a licensed sample. */
  private buildSynths(ctx: AudioContext) {
    const rate = ctx.sampleRate;
    const make = (seconds: number, fill: (t: number, i: number) => number) => {
      const buffer = ctx.createBuffer(1, Math.ceil(seconds * rate), rate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = fill(i / rate, i);
      return buffer;
    };
    let seed = 1, low = 0;
    const noise = () => { seed = seed * 16807 % 2147483647; return seed / 1073741823.5 - 1; };
    // Crunchy bite: three short filtered noise bursts.
    this.synths.set('eat', make(0.16, t => { low += (noise() - low) * 0.35; return low * Math.exp(-t * 40) * 1.6; }));
    this.synths.set('burp', make(0.35, t => Math.sin(2 * Math.PI * (120 - t * 120) * t) * Math.sin(Math.PI * t / 0.35) * 0.6));
    const notes = [523.25, 659.25, 783.99, 1046.5];
    this.synths.set('levelup', make(0.7, t => {
      const i = Math.min(3, Math.floor(t / 0.12)), local = t - i * 0.12;
      return Math.sin(2 * Math.PI * notes[i]! * t) * Math.exp(-local * 9) * 0.35;
    }));
    this.synths.set('click', make(0.03, t => noise() * Math.exp(-t * 300) * 0.5));
    this.synths.set('hurt', make(0.22, t => {
      const f = 330 - t * 700;
      return (2 * Math.abs(2 * ((f * t) % 1) - 1) - 1) * Math.exp(-t * 12) * 0.45;
    }));
    // Water on lava, water in the Nether: a bright hiss (differentiated noise) dying away.
    let last = 0;
    this.synths.set('fizz', make(0.6, t => { const n = noise(), hiss = n - last; last = n; return hiss * Math.exp(-t * 6) * 0.3 * Math.min(1, t * 80); }));
    // Piston: a low thump under a short puff of air.
    this.synths.set('piston', make(0.3, t => { low += (noise() - low) * 0.2; return Math.sin(2 * Math.PI * (95 - t * 120) * t) * Math.exp(-t * 16) * 0.55 + low * Math.exp(-t * 22) * 0.7; }));
    // Flint and steel: two quick scrapes.
    this.synths.set('scrape', make(0.2, t => { const n = noise(), hiss = n - last; last = n; return hiss * (Math.exp(-t * 40) + Math.exp(-Math.abs(t - 0.1) * 60) * 0.8) * 0.35; }));
    // Portal hum: a slowly wavering low tone with rushing air, swelling in and out.
    let phase = 0;
    this.synths.set('portal', make(2.4, t => {
      phase += (150 + 45 * Math.sin(2 * Math.PI * 1.3 * t)) / rate;
      low += (noise() - low) * 0.05;
      return (Math.sin(2 * Math.PI * phase) * 0.22 + Math.sin(4 * Math.PI * phase * 1.01) * 0.08 + low * 0.6) * Math.sin(Math.PI * t / 2.4);
    }));
    // Travel: a rising whoosh.
    this.synths.set('travel', make(1.4, t => { low += (noise() - low) * (0.02 + t * 0.25); return low * Math.sin(Math.PI * t / 1.4) * 1.4; }));
    // Villager "hmm": a nasal hum (formant-heavy harmonics) gliding up a little.
    this.synths.set('villager', make(0.42, t => {
      const f = 165 * (1 + t * 0.35) * (1 + Math.sin(2 * Math.PI * 7 * t) * 0.02), p = 2 * Math.PI * f * t;
      const tone = Math.sin(p) + 0.9 * Math.sin(2 * p) + 0.7 * Math.sin(3 * p) + 0.3 * Math.sin(4 * p) + 0.15 * Math.sin(5 * p);
      return tone * Math.min(1, t * 30) * Math.exp(-t * 5) * 0.16;
    }));
    // Ghast: a high, wavering wail falling away.
    this.synths.set('ghast', make(1.3, t => {
      const f = (560 - t * 170) * (1 + Math.sin(2 * Math.PI * 5.5 * t) * 0.035), p = 2 * Math.PI * f * t;
      low += (noise() - low) * 0.3;
      return (Math.sin(p) + 0.35 * Math.sin(2 * p) + low * 0.25) * Math.min(1, t * 12) * Math.exp(-t * 2.2) * 0.3;
    }));
    // Ghast firing: a harsh shriek.
    this.synths.set('shriek', make(0.5, t => {
      const p = 2 * Math.PI * (980 - t * 900) * t;
      return Math.tanh(3 * Math.sin(p)) * Math.min(1, t * 60) * Math.exp(-t * 7) * 0.22 + noise() * Math.exp(-t * 14) * 0.12;
    }));
  }
}
