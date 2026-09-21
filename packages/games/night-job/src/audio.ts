import { useEffect, useRef } from 'react';
import type { GameAudioProps } from '../../../party-ui/src/index';
import type { Effect, PlayerView, View } from './model';

/** Original, positional effects. Only the host owns a mixer; no music or external samples. */
export class HeistAudio {
  private context: AudioContext | null = null;
  private output: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private nodes = new Set<AudioScheduledSourceNode>();
  private muted = false;
  private disposed = false;
  private round = '';
  private event = -1;
  private phase = '';
  private previous: View | null = null;
  private lastCue = new Map<string, number>();
  private coinRun = 0;
  private coinAt = -Infinity;
  constructor() {
    try { this.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* Storage is optional. */ }
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    window.addEventListener('party-sound', this.preference);
    document.addEventListener('visibilitychange', this.visibility);
  }
  private unlock = () => {
    if (this.disposed || this.muted || document.hidden) return;
    try {
      if (!this.context) {
        const ctx = this.context = new AudioContext();
        this.output = ctx.createDynamicsCompressor(); this.output.threshold.value = -12; this.output.knee.value = 12; this.output.ratio.value = 8;
        this.output.attack.value = .003; this.output.release.value = .15; this.output.connect(ctx.destination);
        this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0); let seed = 317;
        for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
      }
      void this.context.resume().catch(() => {});
    } catch { /* Silent devices still play. */ }
  };
  private preference = (event: Event) => { this.muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted; if (this.muted) this.stop(); else this.unlock(); };
  private visibility = () => { if (document.hidden) this.stop(); else this.unlock(); };
  private available() { return this.context?.state === 'running' && !this.muted && !document.hidden && !this.disposed && this.nodes.size < 24; }
  private voice(source: AudioScheduledSourceNode, duration: number, volume: number, pan: number, delay: number, filter?: BiquadFilterNode) {
    const ctx = this.context!, gain = ctx.createGain(), stereo = ctx.createStereoPanner(), at = ctx.currentTime + delay;
    stereo.pan.value = Math.max(-.8, Math.min(.8, pan));
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(volume, at + .006); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    if (filter) { source.connect(filter); filter.connect(gain); } else source.connect(gain);
    gain.connect(stereo); stereo.connect(this.output!); this.nodes.add(source);
    source.onended = () => { source.disconnect(); filter?.disconnect(); gain.disconnect(); stereo.disconnect(); this.nodes.delete(source); };
    source.start(at); source.stop(at + duration + .02);
  }
  private tone(from: number, to: number, duration: number, type: OscillatorType = 'sine', volume = .045, pan = 0, delay = 0) {
    if (!this.available()) return;
    const ctx = this.context!, source = ctx.createOscillator(), at = ctx.currentTime + delay;
    source.type = type; source.frequency.setValueAtTime(from, at); source.frequency.exponentialRampToValueAtTime(to, at + duration);
    this.voice(source, duration, volume, pan, delay);
  }
  private noise(frequency: number, duration: number, volume: number, pan = 0, delay = 0, type: BiquadFilterType = 'lowpass') {
    if (!this.available()) return;
    const ctx = this.context!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    source.buffer = this.noiseBuffer; filter.type = type; filter.frequency.value = frequency; filter.Q.value = .65;
    this.voice(source, duration, volume, pan, delay, filter);
  }
  private due(key: string, now: number, interval: number) {
    if (now - (this.lastCue.get(key) ?? -Infinity) < interval) return false;
    this.lastCue.set(key, now); return true;
  }
  private cue(effect: Effect, now: number, pan: number) {
    if (!this.due(effect.kind, now, effect.kind === 'coin' ? 55 : 90)) return;
    switch (effect.kind) {
      case 'coin': {
        this.coinRun = now - this.coinAt < 650 ? (this.coinRun + 1) % 5 : 0; this.coinAt = now;
        const note = [1047, 1175, 1319, 1568, 1760][this.coinRun];
        this.tone(note, note, .12, 'sine', .045, pan); this.tone(note * 2, note * 1.99, .055, 'sine', .014, pan);
        if (effect.label === '+10') this.tone(2093, 2093, .22, 'triangle', .03, pan, .1); break;
      }
      case 'alarm': this.tone(440, 880, .22, 'triangle', .055, pan); this.tone(880, 440, .24, 'triangle', .05, pan, .22); break;
      case 'smoke': this.noise(3800, .08, .1, pan); this.noise(1100, .65, .12, pan, .04); this.tone(100, 35, .18, 'sine', .05, pan); break;
      case 'shot':
        if (effect.label === 'Quiet shot') { this.noise(1800, .055, .065, pan); this.tone(260, 95, .07, 'sine', .055, pan); }
        else { this.noise(6500, .1, .2, pan); this.noise(700, .3, .13, pan, .02); this.tone(110, 35, .18, 'triangle', .075, pan); }
        break;
      case 'break': this.noise(effect.label === 'Glass shattered' ? 7500 : 1800, .24, .11, pan, 0, 'highpass'); this.noise(1200, .35, .06, pan, .07); break;
      case 'heal': case 'rescue': this.tone(523, 523, .18, 'sine', .045, pan); this.tone(659, 659, .18, 'sine', .04, pan, .1); this.tone(1047, 1047, .28, 'sine', .04, pan, .2); break;
      case 'hack': this.tone(1568, 784, .06, 'square', .018, pan); this.tone(1175, 1568, .12, 'sine', .045, pan, .07); this.noise(2200, .13, .035, pan, .16); break;
      case 'unlock': this.noise(2800, .045, .07, pan); this.tone(580, 280, .08, 'triangle', .04, pan); this.noise(900, .08, .06, pan, .075); break;
    }
  }
  private playerFeedback(p: PlayerView, old: PlayerView, now: number, pan: number) {
    if (p.health < old.health && this.due(`hurt:${p.id}`, now, 220)) {
      this.noise(500, .1, .09, pan); this.tone(p.down ? 170 : 130, p.down ? 42 : 70, p.down ? .45 : .1, 'triangle', .06, pan);
    }
    if (Math.floor(p.coins / 10) > Math.floor(old.coins / 10)) { this.tone(880, 880, .12, 'triangle', .035, pan); this.tone(1320, 1320, .2, 'sine', .04, pan, .09); }
    if (p.down || p.suspended || p.hidden || !p.connected) return;
    const distance = Math.hypot(p.x - old.x, p.y - old.y);
    if (distance > .025 && distance < 1 && this.due(`step:${p.id}`, now, 320)) this.noise(420, .045, .022, pan);
    if (p.work && p.work.target === old.work?.target && p.work.progress > old.work.progress && this.due(`work:${p.id}`, now, 220)) this.noise(2400, .022, .026, pan, 0, 'bandpass');
  }
  update(view: View | null, connected: boolean) {
    if (!connected || !view) { this.stop(); this.previous = null; return; }
    if (this.round !== view.heistId) { this.stop(); this.round = view.heistId; this.event = -1; this.phase = ''; this.previous = null; this.lastCue.clear(); this.coinRun = 0; this.coinAt = -Infinity; }
    const pan = (x: number) => (x / view.tiles[0].length - .5) * 1.4;
    for (const effect of view.effects) if (effect.id > this.event) {
      if (view.now - effect.at < 900) this.cue(effect, view.now, pan(effect.x));
      this.event = Math.max(this.event, effect.id);
    }
    const fresh = this.previous && view.now >= this.previous.now && view.now - this.previous.now < 500;
    if (fresh) for (const p of view.players) { const old = this.previous!.players.find(q => q.id === p.id); if (old) this.playerFeedback(p, old, view.now, pan(p.x)); }
    if (view.phase !== this.phase) {
      if (view.phase === 'escape' && this.phase === 'infiltrate') { this.tone(523, 523, .16, 'triangle'); this.tone(784, 784, .18, 'triangle', .045, 0, .12); this.tone(1047, 1047, .32, 'sine', .05, 0, .25); }
      if (view.phase === 'clear') { this.tone(660, 660, .16); this.tone(880, 880, .16, 'sine', .045, 0, .14); this.tone(1320, 1320, .35, 'sine', .05, 0, .28); }
      if (view.phase === 'failed') this.tone(220, 55, .6, 'triangle', .055);
      this.phase = view.phase;
    }
    this.previous = view;
  }
  private stop() { for (const node of this.nodes) { try { node.stop(); } catch { /* Already ended. */ } } }
  dispose() {
    this.disposed = true; this.stop();
    window.removeEventListener('pointerdown', this.unlock); window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('party-sound', this.preference); document.removeEventListener('visibilitychange', this.visibility);
    this.output?.disconnect(); this.noiseBuffer = null; void this.context?.close().catch(() => {});
  }
}
export function AudioView({ isHost, publicView, connected }: GameAudioProps<View>) {
  const mixer = useRef<HeistAudio | null>(null);
  useEffect(() => { if (!isHost) return; const audio = new HeistAudio(); mixer.current = audio; return () => { mixer.current = null; audio.dispose(); }; }, [isHost]);
  useEffect(() => { mixer.current?.update(publicView, connected); }, [publicView, connected]);
  return null;
}
