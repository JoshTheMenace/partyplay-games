import { useEffect, useRef } from 'react';
import type { GameAudioProps } from '../../../party-ui/src/index';
import type { RoomPhase } from '../../../party-contract/src/protocol';
import type { Effect, MissionId, NpcState, View } from './model';
import { getMap } from './maps';
import { doorObjects } from './geometry';
import { assetUrl } from './render/assets';

const MAX_VOICES = 24, STALE = 900, MUSIC_LEVEL = .3;
/** Mission loops from music/export.ts, in seconds (bars × beats × 60 / bpm). Files carry one wrapped extra second, so looping from 0.5 s is gapless. */
export const MUSIC: Record<MissionId, number> = { velvet: 32 * 240 / 116, glasshouse: 32 * 240 / 132, ferry: 48 * 360 / 216 };
const WARY: readonly NpcState[] = ['suspicious', 'investigate'];

/** Host-display mixer: the mission's music loop, short synthesized cues from public snapshot diffs, and two loops (alarm siren, chase heartbeat). */
export class HeistAudio {
  private context: AudioContext | null = null;
  private output: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private nodes = new Set<AudioScheduledSourceNode>();
  private siren: AudioScheduledSourceNode[] = [];
  private muted = false;
  private disposed = false;
  private round = '';
  private previous: View | null = null;
  private event = -1;
  private shotAt = -Infinity;
  private noiseAt = -Infinity;
  private lastCue = new Map<string, number>();
  private coinRun = 0;
  private coinAt = -Infinity;
  private music: { mission: MissionId; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private tracks = new Map<MissionId, Promise<AudioBuffer | null>>();
  private wanted: MissionId | null = null;
  private alarm = false;
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
        this.output = ctx.createDynamicsCompressor(); this.output.threshold.value = -14; this.output.knee.value = 12; this.output.ratio.value = 8;
        this.output.attack.value = .003; this.output.release.value = .15; this.output.connect(ctx.destination);
        this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0); let seed = 317;
        for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
      }
      void this.context.resume().then(() => this.syncMusic()).catch(() => {});
    } catch { /* Silent devices still play. */ }
  };
  private preference = (event: Event) => { this.muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted; if (this.muted) this.stop(); else this.unlock(); };
  private visibility = () => { if (document.hidden) this.stop(); else this.unlock(); };
  private live() { return this.context?.state === 'running' && !this.muted && !document.hidden && !this.disposed; }
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
    if (!this.live() || this.nodes.size >= MAX_VOICES) return;
    const ctx = this.context!, source = ctx.createOscillator(), at = ctx.currentTime + delay;
    source.type = type; source.frequency.setValueAtTime(from, at); source.frequency.exponentialRampToValueAtTime(to, at + duration);
    this.voice(source, duration, volume, pan, delay);
  }
  private noise(frequency: number, duration: number, volume: number, pan = 0, delay = 0, type: BiquadFilterType = 'lowpass') {
    if (!this.live() || this.nodes.size >= MAX_VOICES) return;
    const ctx = this.context!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    source.buffer = this.noiseBuffer; filter.type = type; filter.frequency.value = frequency; filter.Q.value = .65;
    this.voice(source, duration, volume, pan, delay, filter);
  }
  private due(key: string, now: number, interval: number) {
    if (now - (this.lastCue.get(key) ?? -Infinity) < interval) return false;
    this.lastCue.set(key, now); return true;
  }
  /** Rising two-tone wail: a sawtooth swept by a slow LFO. */
  private sirenOn() {
    if (this.siren.length || !this.live()) return;
    const ctx = this.context!, osc = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 640; lfo.frequency.value = .8; depth.gain.value = 190; filter.type = 'lowpass'; filter.frequency.value = 1500; gain.gain.value = .022;
    lfo.connect(depth); depth.connect(osc.frequency); osc.connect(filter); filter.connect(gain); gain.connect(this.output!);
    osc.onended = () => { [osc, lfo, depth, filter, gain].forEach(n => n.disconnect()); };
    osc.start(); lfo.start(); this.siren = [osc, lfo];
  }
  private sirenOff() { for (const node of this.siren) { try { node.stop(); } catch { /* Already ended. */ } } this.siren = []; }
  private load(mission: MissionId) {
    const ctx = this.context!;
    let track = this.tracks.get(mission);
    if (!track) this.tracks.set(mission, track = fetch(assetUrl(`music/${mission}.mp3`)).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(data => ctx.decodeAudioData(data)).catch(() => null));
    return track;
  }
  /** Fades the playing loop out when it is no longer wanted, and starts the wanted one once its file is decoded. Music is optional. */
  private syncMusic() {
    const wanted = this.live() ? this.wanted : null, ctx = this.context;
    if (this.music && this.music.mission !== wanted) { const { source, gain } = this.music; gain.gain.setTargetAtTime(0, ctx!.currentTime, .5); source.stop(ctx!.currentTime + 3); this.music = null; }
    if (this.music) this.music.gain.gain.setTargetAtTime(MUSIC_LEVEL * (this.alarm ? .5 : 1), ctx!.currentTime, .4);
    if (!wanted || this.music) return;
    void this.load(wanted).then(buffer => {
      if (!buffer || this.music || this.wanted !== wanted || !this.live()) return;
      const source = ctx!.createBufferSource(), gain = ctx!.createGain();
      source.buffer = buffer; source.loop = true; source.loopStart = .5; source.loopEnd = .5 + MUSIC[wanted];
      gain.gain.setValueAtTime(0, ctx!.currentTime); source.connect(gain); gain.connect(ctx!.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(ctx!.currentTime, .5); this.music = { mission: wanted, source, gain }; this.syncMusic();
    });
  }
  private exclaim(pan: number, now: number) { if (this.due('!', now, 250)) { this.tone(740, 1480, .09, 'square', .03, pan); this.tone(1480, 1480, .16, 'triangle', .04, pan, .08); } }
  private cue(effect: Effect, now: number, pan: number) {
    if (!this.due(effect.kind, now, effect.kind === 'coin' ? 55 : 110)) return;
    switch (effect.kind) {
      case 'coin': {
        this.coinRun = now - this.coinAt < 650 ? (this.coinRun + 1) % 5 : 0; this.coinAt = now;
        const note = [1047, 1175, 1319, 1568, 1760][this.coinRun];
        this.tone(note, note, .12, 'sine', .04, pan); this.tone(note * 2, note * 1.99, .05, 'sine', .012, pan); break;
      }
      case 'safe': this.noise(700, .18, .12, pan); this.tone(90, 50, .2, 'triangle', .07, pan); [1319, 1568, 2093].forEach((f, i) => this.tone(f, f, .22, 'sine', .035, pan, .14 + i * .07)); break;
      case 'hack': this.tone(1568, 784, .06, 'square', .016, pan); this.tone(1175, 1760, .12, 'sine', .04, pan, .07); break;
      case 'heal': [523, 659, 784].forEach((f, i) => this.tone(f, f, .22, 'sine', .035, pan, i * .08)); break;
      case 'takedown': this.noise(400, .12, .12, pan); this.tone(160, 60, .14, 'sine', .07, pan); break;
      case 'break': this.noise(effect.label.toLowerCase().includes('glass') ? 7000 : 1600, .3, .12, pan, 0, 'highpass'); this.noise(900, .4, .08, pan, .06); break;
      case 'smoke': this.noise(5200, .9, .09, pan, 0, 'highpass'); this.noise(900, 1.2, .06, pan, .05); this.tone(110, 40, .2, 'sine', .04, pan); break;
      case 'emp': this.tone(1800, 60, .35, 'square', .035, pan); this.noise(3000, .25, .07, pan, .03, 'bandpass'); this.tone(60, 55, .45, 'sawtooth', .025, pan, .05); break;
      case 'decoy': this.noise(1800, .16, .04, pan, 0, 'bandpass'); break;
      case 'charge': this.tone(880, 880, .1, 'triangle', .035, pan); this.tone(1320, 1320, .2, 'sine', .04, pan, .09); break;
      case 'spotted': this.exclaim(pan, now); break;
      case 'alarm': this.tone(988, 988, .12, 'square', .03, pan); this.tone(988, 988, .12, 'square', .03, pan, .16); break;
    }
  }
  update(view: View | null, connected: boolean, phase: RoomPhase = 'playing') {
    // The loop plays through the heist and its getaway, fades on a bust and at results, and ducks under the alarm.
    this.wanted = connected && view && phase === 'playing' && view.phase !== 'failed' ? view.mission : null; this.alarm = !!view?.alarm;
    if (this.context) this.syncMusic();
    if (!connected || !view) { this.stop(); this.previous = null; return; }
    if (this.round !== view.heistId) { this.stop(false); this.round = view.heistId; this.previous = null; this.event = -1; this.shotAt = this.noiseAt = -Infinity; this.lastCue.clear(); this.coinRun = 0; this.coinAt = -Infinity; }
    const map = getMap(view.mission), now = view.now, pan = (x: number) => (x / map.width - .5) * 1.4, fresh = (at: number) => now - at < STALE;
    for (const effect of view.effects) if (effect.id > this.event) { if (fresh(effect.at)) this.cue(effect, now, pan(effect.x)); this.event = Math.max(this.event, effect.id); }
    for (const shot of view.shots) if (shot.at > this.shotAt) {
      const p = pan(shot.from.x);
      if (fresh(shot.at)) {
        if (shot.kind === 'guard') { this.noise(6000, .09, .2, p); this.noise(700, .28, .12, p, .02); this.tone(120, 40, .16, 'triangle', .07, p); }
        else if (shot.kind === 'tranq') { this.noise(2400, .05, .06, p, 0, 'bandpass'); this.tone(420, 180, .06, 'sine', .04, p); }
        else { this.noise(4000, .12, .24, p); this.noise(400, .5, .16, p, .02); this.tone(80, 30, .35, 'triangle', .09, p); }
      }
      this.shotAt = Math.max(this.shotAt, shot.at);
    }
    for (const n of view.noises) if (n.at > this.noiseAt) {
      if (n.kind === 'decoy' && fresh(n.at)) [2600, 3100, 2600].forEach((f, i) => this.tone(f, f * 1.1, .05, 'sine', .03, pan(n.x), i * .09));
      this.noiseAt = Math.max(this.noiseAt, n.at);
    }
    const old = this.previous && now >= this.previous.now && now - this.previous.now < 500 ? this.previous : null;
    if (old) {
      for (const p of view.players) {
        const was = old.players.find(q => q.id === p.id); if (!was) continue;
        if (p.down && !was.down) { this.noise(500, .12, .1, pan(p.x)); this.tone(220, 55, .6, 'triangle', .06, pan(p.x)); }
        else if (p.health < was.health && this.due(`hurt:${p.id}`, now, 200)) { this.noise(600, .09, .09, pan(p.x)); this.tone(150, 80, .1, 'triangle', .06, pan(p.x)); }
        if (was.down && !p.down) [392, 523, 659, 1047].forEach((f, i) => this.tone(f, f, .2, 'sine', .04, pan(p.x), i * .07));
      }
      doorObjects(map).forEach((o, i) => {
        const a = old.doors[i], b = view.doors[i], p = pan(o.x); if (!a || !b || a === b) return;
        if (b === 'b') { this.noise(1200, .35, .13, p); this.tone(90, 40, .25, 'triangle', .07, p); }
        else if (a === 'l') { this.noise(3000, .04, .06, p, 0, 'bandpass'); this.noise(2200, .05, .06, p, .07, 'bandpass'); }
        else if (b === 'o') { this.tone(300, 240, .18, 'triangle', .02, p); this.noise(900, .14, .04, p); }
        else if (b === 'c') { this.noise(300, .1, .08, p); this.tone(110, 70, .08, 'sine', .05, p); }
      });
      for (const n of view.npcs) {
        const was = old.npcs.find(q => q.id === n.id); if (!was || n.kind === 'civilian') continue;
        if (n.state === 'chase' && was.state !== 'chase') { if (n.kind === 'dog') this.noise(700, .12, .1, pan(n.x)); else this.exclaim(pan(n.x), now); }
        else if (WARY.includes(n.state) && !WARY.includes(was.state) && this.due(`?${n.id}`, now, 800)) { this.tone(520, 700, .12, 'sine', .035, pan(n.x)); this.tone(700, 660, .1, 'sine', .025, pan(n.x), .12); }
        if (n.aiming && !was.aiming) { this.tone(1760, 1760, .07, 'square', .025, pan(n.x)); this.tone(1760, 1760, .07, 'square', .025, pan(n.x), .12); }
      }
      if (view.objective.carrier && !old.objective.carrier) [659, 880, 1175].forEach((f, i) => this.tone(f, f * 1.01, .3, 'triangle', .045, pan(view.objective.x), i * .09));
      if (view.phase !== old.phase) {
        if (view.phase === 'clear') [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, f, i === 4 ? .6 : .18, i === 4 ? 'sine' : 'triangle', .05, 0, i * .11));
        if (view.phase === 'failed') { this.tone(330, 110, .8, 'triangle', .06); this.tone(247, 82, .9, 'sine', .04, 0, .15); }
      }
    }
    if (view.players.some(p => p.work && !p.down) && this.due('work', now, 170)) this.noise(3200, .02, .03, 0, 0, 'bandpass');
    if (view.npcs.some(n => n.kind !== 'civilian' && n.state === 'chase') && this.due('heart', now, 720)) { this.tone(70, 45, .12, 'sine', .08); this.tone(62, 40, .14, 'sine', .06, 0, .17); }
    if (view.alarm && view.phase !== 'clear' && view.phase !== 'failed') this.sirenOn(); else this.sirenOff();
    this.previous = view;
  }
  /** Silences cues and the siren; music too unless a new round of the same room is starting. */
  private stop(music = true) {
    this.sirenOff(); for (const node of this.nodes) { try { node.stop(); } catch { /* Already ended. */ } }
    if (music && this.music) { try { this.music.source.stop(); } catch { /* Already ended. */ } this.music = null; }
  }
  dispose() {
    this.disposed = true; this.stop();
    window.removeEventListener('pointerdown', this.unlock); window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('party-sound', this.preference); document.removeEventListener('visibilitychange', this.visibility);
    this.output?.disconnect(); this.noiseBuffer = null; void this.context?.close().catch(() => {});
  }
}

export function AudioView({ isHost, viewRole, publicView, connected, phase }: GameAudioProps<View>) {
  const mixer = useRef<HeistAudio | null>(null), owner = isHost && viewRole === 'display';
  useEffect(() => { if (!owner) return; const audio = new HeistAudio(); mixer.current = audio; return () => { mixer.current = null; audio.dispose(); }; }, [owner]);
  useEffect(() => { mixer.current?.update(publicView, connected, phase); }, [publicView, connected, phase]);
  return null;
}
