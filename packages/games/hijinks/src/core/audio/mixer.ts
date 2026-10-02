/* Host-display mixer: looped music with crossfades, server cues (SFX, narrator VO, optional read-aloud) and ducking. */
import type { RoomPhase } from '../../../../../party-contract/src/protocol';
import { manifest } from '../../manifest';
import { SFX_IDS, type PackPublicView, type SfxId } from '../contract';
import { VO } from '../vo-manifest';
import { TRACKS } from './tracks';

const BASE = manifest.assetBase, LEVEL = { music: .35, sfx: .7, vo: 1 }, DUCK = 10 ** (-9 / 20), STALE_MS = 4000, FADE_OUT = 1.2, FADE_IN = .6;
/** Minimum ms between two plays of one effect; crowd beds and stingers must not stack. */
const COOLDOWN: Partial<Record<SfxId, number>> = { tick: 150, 'tick-fast': 90, applause: 1500, cheer: 1500, laugh: 1200, boo: 1500, aww: 1200, ooh: 1200, gasp: 700, drumroll: 1500, fanfare: 1500, thunder: 1500, gong: 1200 };
const SFX_SET = new Set<string>(SFX_IDS);
const isMuted = () => { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } };

/** Fetch + decode, cached (LRU when limited). Missing or undecodable files resolve to null and stay silent. */
class Buffers {
  private map = new Map<string, Promise<AudioBuffer | null>>();
  constructor(private ctx: BaseAudioContext, private signal: AbortSignal, private limit = Infinity) {}
  get(path: string) {
    let p = this.map.get(path);
    if (p) this.map.delete(path);
    else p = fetch(BASE + path, { signal: this.signal }).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(data => this.ctx.decodeAudioData(data)).catch(() => null);
    this.map.set(path, p);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value!);
    return p;
  }
}

/** One-shot effects with slight pitch/gain variation, per-id rate limiting and a voice cap. */
export class SfxPlayer {
  private last = new Map<string, number>();
  private voices = 0;
  readonly buffers: Buffers;
  constructor(private ctx: AudioContext, private out: AudioNode, signal: AbortSignal) { this.buffers = new Buffers(ctx, signal); }
  preload() { for (const id of SFX_IDS) void this.buffers.get(`sfx/${id}.mp3`); }
  play(id: string, gain = 1) {
    const now = performance.now();
    if (!SFX_SET.has(id) || this.ctx.state !== 'running' || this.voices >= 16 || now - (this.last.get(id) ?? -Infinity) < (COOLDOWN[id as SfxId] ?? 70)) return;
    this.last.set(id, now);
    void this.buffers.get(`sfx/${id}.mp3`).then(buffer => {
      if (!buffer || this.ctx.state !== 'running' || performance.now() - now > 800) return; // a late effect is worse than none
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buffer; src.playbackRate.value = 1 + (Math.random() - .5) * .06; g.gain.value = gain * (.88 + Math.random() * .12);
      src.connect(g).connect(this.out); this.voices++;
      src.onended = () => { src.disconnect(); g.disconnect(); this.voices--; };
      src.start();
    });
  }
}

type Spoken = { kind: 'vo' | 'speak'; id: string; queued: number };
export type MixerInput = { phase: RoomPhase; roundId: string | null; view: PackPublicView | null; connected: boolean; now: number };

export class PackMixer {
  private ctx: AudioContext;
  private abort = new AbortController();
  private musicBus: GainNode; private musicDuck: GainNode; private voBus: GainNode; private limiter: DynamicsCompressorNode;
  private sfx: SfxPlayer; private music: Buffers; private vo: Buffers;
  private deck: { id: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted: string | null = null;
  private queue: Spoken[] = []; private speaking: (() => void) | null = null; private unduckTimer = 0;
  private lastSeq = 0; private seeded = false; private round: string | null = null; private readAloud = false;
  private muted = isMuted(); private disposed = false; private voice: SpeechSynthesisVoice | null | undefined;

  constructor() {
    const ctx = this.ctx = new AudioContext(), master = ctx.createGain(), music = ctx.createGain(), sfx = ctx.createGain();
    this.musicBus = music; this.limiter = ctx.createDynamicsCompressor(); this.musicDuck = ctx.createGain(); this.voBus = ctx.createGain();
    const l = this.limiter;
    l.threshold.value = -8; l.knee.value = 6; l.ratio.value = 12; l.attack.value = .003; l.release.value = .25;
    music.gain.value = LEVEL.music; sfx.gain.value = LEVEL.sfx; this.voBus.gain.value = LEVEL.vo;
    music.connect(this.musicDuck).connect(master); sfx.connect(master); this.voBus.connect(master); master.connect(l).connect(ctx.destination);
    const signal = this.abort.signal;
    this.sfx = new SfxPlayer(ctx, sfx, signal); this.music = new Buffers(ctx, signal, 3); this.vo = new Buffers(ctx, signal, 12);
    this.sfx.preload();
    for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, this.unlock);
    window.addEventListener('party-sound', this.preference); window.addEventListener('pagehide', this.silence);
    document.addEventListener('visibilitychange', this.visibility);
    globalThis.speechSynthesis?.addEventListener?.('voiceschanged', this.voicesChanged);
    if (this.audible()) this.unlock(); else void ctx.suspend().catch(() => {});
  }
  private audible() { return !this.disposed && !this.muted && !document.hidden; }
  private unlock = () => { if (this.audible() && this.ctx.state !== 'running') void this.ctx.resume().then(() => this.next()).catch(() => {}); };
  private preference = (e: Event) => { this.muted = !!(e as CustomEvent<{ muted?: boolean }>).detail?.muted; if (this.muted) this.silence(); else this.unlock(); };
  private visibility = () => { if (document.hidden) this.silence(); else this.unlock(); };
  /** Pauses everything (music keeps its place) and drops queued narration. */
  private silence = () => { this.clearSpeech(); void this.ctx.suspend().catch(() => {}); };
  private voicesChanged = () => { this.voice = undefined; };

  update({ phase, roundId, view, connected, now }: MixerInput) {
    if (this.disposed) return;
    this.readAloud = !!view?.settings.readAloud;
    this.setMusic(!connected || phase === 'picker' ? null : phase === 'lobby' || phase === 'preparing' ? 'menu' : view?.music ?? (phase === 'results' ? 'finale' : null));
    // Cues: the first snapshot after mounting mid-round is history; a new round starts counting afresh.
    const cues = view?.cues ?? [], max = cues.reduce((m, c) => Math.max(m, c.seq), 0);
    if (!view) { this.seeded = true; return; }
    if (!this.seeded) { this.seeded = true; this.round = roundId; this.lastSeq = max; return; }
    if (roundId !== this.round || max < this.lastSeq) { this.round = roundId; this.lastSeq = 0; }
    for (const cue of [...cues].sort((a, b) => a.seq - b.seq)) {
      if (cue.seq <= this.lastSeq) continue;
      this.lastSeq = cue.seq;
      if (!connected || now - cue.at > STALE_MS || !this.audible()) continue;
      if (cue.kind === 'sfx') this.sfx.play(cue.id);
      else if (cue.kind === 'vo' ? Object.hasOwn(VO, cue.id) : this.readAloud && 'speechSynthesis' in globalThis) { this.queue.push({ kind: cue.kind, id: cue.id, queued: performance.now() }); this.next(); }
    }
  }

  private setMusic(id: string | null) {
    if (id === this.wanted) return;
    this.wanted = id;
    const info = id ? TRACKS[id] : undefined;
    void (info ? this.music.get(info.file) : Promise.resolve(null)).then(buffer => {
      if (this.disposed || this.wanted !== id) return;
      const t = this.ctx.currentTime, old = this.deck;
      if (old) { const g = old.gain.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + FADE_OUT); old.source.stop(t + FADE_OUT + .05); }
      this.deck = null;
      if (!buffer || !info || !id) return;
      const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      // Files carry one wrapped extra second; export.ts picks the loop start where the seam is cleanest.
      source.buffer = buffer; source.loop = true; source.loopStart = info.loopStart; source.loopEnd = Math.min(buffer.duration, info.loopStart + info.loopSeconds);
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(1, t + FADE_IN);
      source.connect(gain).connect(this.musicBus); source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(t, info.loopStart); this.deck = { id, source, gain };
    });
  }

  /** Plays the narration queue one item at a time, ducking music while anything is spoken. */
  private next() {
    if (this.speaking || this.ctx.state !== 'running' || !this.audible()) return;
    const item = this.queue.shift();
    if (!item) { clearTimeout(this.unduckTimer); this.unduckTimer = window.setTimeout(() => this.duck(false), 250); return; }
    if (performance.now() - item.queued > 12000) { this.next(); return; }
    clearTimeout(this.unduckTimer); this.duck(true);
    let finished = false;
    const done = () => { if (finished) return; finished = true; this.speaking = null; this.next(); };
    if (item.kind === 'vo') {
      let src: AudioBufferSourceNode | null = null;
      this.speaking = () => { finished = true; if (src) { src.onended = null; try { src.stop(); } catch { /* Not started. */ } src.disconnect(); } };
      void this.vo.get(`vo/${item.id}.mp3`).then(buffer => {
        if (finished) return;
        if (!buffer || this.ctx.state !== 'running') { done(); return; }
        src = this.ctx.createBufferSource(); src.buffer = buffer; src.connect(this.voBus);
        src.onended = () => { src?.disconnect(); done(); }; src.start();
      });
    } else {
      const u = new SpeechSynthesisUtterance(item.id), timer = window.setTimeout(done, 2000 + item.id.length * 90);
      const voice = this.pickVoice(); if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
      u.rate = 1.02; u.onend = u.onerror = () => { clearTimeout(timer); done(); };
      this.speaking = () => { finished = true; clearTimeout(timer); u.onend = u.onerror = null; speechSynthesis.cancel(); };
      speechSynthesis.speak(u);
    }
  }
  private duck(on: boolean) { const g = this.musicDuck.gain; g.cancelScheduledValues(this.ctx.currentTime); g.setTargetAtTime(on ? DUCK : 1, this.ctx.currentTime, on ? .08 : .35); }
  private clearSpeech() { this.queue = []; this.speaking?.(); this.speaking = null; this.duck(false); }
  /** A natural-sounding English voice when the browser has one. */
  private pickVoice() {
    if (this.voice !== undefined) return this.voice;
    const score = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 8 : 0) + (/google/i.test(v.name) ? 4 : 0) + (/samantha|daniel|serena|karen|moira|aria|jenny|guy/i.test(v.name) ? 3 : 0) + (/en[-_](us|gb)/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0);
    const all = speechSynthesis.getVoices();
    if (!all.length) return null; // Not loaded yet: ask again next time.
    return this.voice = all.filter(v => /^en([-_]|$)/i.test(v.lang)).sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.clearSpeech(); this.disposed = true; this.abort.abort(); clearTimeout(this.unduckTimer);
    for (const e of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(e, this.unlock);
    window.removeEventListener('party-sound', this.preference); window.removeEventListener('pagehide', this.silence);
    document.removeEventListener('visibilitychange', this.visibility);
    globalThis.speechSynthesis?.removeEventListener?.('voiceschanged', this.voicesChanged);
    try { this.deck?.source.stop(); } catch { /* Already stopped. */ }
    this.limiter.disconnect(); void this.ctx.close().catch(() => {});
  }
}

/** Phone-local UI clicks: its own small context, created on first use (inside a tap), honouring the shared mute. */
export class LocalSfx {
  private ctx: AudioContext | null = null; private player: SfxPlayer | null = null; private abort = new AbortController(); private muted = isMuted();
  private preference = (e: Event) => { this.muted = !!(e as CustomEvent<{ muted?: boolean }>).detail?.muted; };
  constructor() { window.addEventListener('party-sound', this.preference); }
  play(id: SfxId, gain = .5) {
    if (this.muted || document.hidden) return;
    try {
      if (!this.ctx) { this.ctx = new AudioContext(); this.player = new SfxPlayer(this.ctx, this.ctx.destination, this.abort.signal); }
      if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.player?.play(id, gain)).catch(() => {});
      else this.player!.play(id, gain);
    } catch { /* Audio is optional. */ }
  }
  dispose() { window.removeEventListener('party-sound', this.preference); this.abort.abort(); void this.ctx?.close().catch(() => {}); this.ctx = null; }
}
