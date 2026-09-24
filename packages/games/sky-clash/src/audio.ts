import type { GameAudioProps } from '../../../party-ui/src/index';
import type { GameEvent, HitEffect, View } from './model';
export const AUDIO_ROOT = '/games/sky-clash/audio/';
export const LOBBY_TRACK = 'lobby.mp3';
export const BATTLE_TRACKS = ['adventure-forward.mp3', 'adventures-final-frontier.mp3', 'bouken-no-jokyoku.mp3', 'triumph-of-the-brave.mp3'] as const;
/** Short decoded samples. Per-event variation comes from gain, playbackRate and layering, not extra files. */
export const SAMPLES = {
  impact: 'impact-hit-0.wav', swish: 'swish.wav', jump: 'jump.wav', laser: 'laser.wav', block: 'block.wav', break: 'break.wav', ko: 'ko.wav',
  count: 'count.wav', start: 'start.wav', end: 'end.wav', select: 'select.wav', warning: 'warning.wav',
  parry: 'parry.wav', clash: 'clash.wav', heavy: 'heavy.wav', go: 'go.wav', fanfare: 'fanfare.wav', coin: 'coin.wav', zap: 'zap.wav', burn: 'burn.wav', star: 'star.wav',
} as const;
export type Sample = keyof typeof SAMPLES;
export type Cue = { sound: Sample; gain: number; rate: number; pan: number };
export type Mode = 'lobby' | 'battle' | 'hush' | 'results' | 'silent';
/** Lobby song through preparation and the countdown, the battle playlist while fighting, a hush on GAME!, a fanfare at results. */
export function audioMode(phase: GameAudioProps<View>['phase'], view: View | null): Mode {
  if (phase === 'picker') return 'silent';
  if (phase === 'results') return 'results';
  if (phase === 'playing' && view) return view.phase === 'complete' ? 'hush' : view.phase === 'countdown' ? 'lobby' : 'battle';
  return 'lobby';
}
const EFFECT: Record<HitEffect, { rate: number; layer?: [Sample, number, number] }> = {
  normal: { rate: 1 }, fire: { rate: .92, layer: ['burn', .3, 1] }, electric: { rate: 1.12, layer: ['zap', .28, 1] }, slash: { rate: 1.08, layer: ['swish', .22, 1.3] },
  coin: { rate: 1.1, layer: ['coin', .32, 1] }, ice: { rate: 1.2, layer: ['block', .16, 1.7] }, sleep: { rate: .8, layer: ['star', .16, .7] }, grass: { rate: 1.25, layer: ['swish', .12, 1.6] },
  darkness: { rate: .78, layer: ['burn', .22, .7] }, water: { rate: .88, layer: ['swish', .14, .7] }, star: { rate: 1.22, layer: ['star', .26, 1.1] },
  psychic: { rate: 1.05, layer: ['zap', .16, .7] }, magic: { rate: 1.12, layer: ['star', .2, 1.3] },
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Deterministic ±4% pitch jitter per event id, so repeated hits never sound identical. */
const jitter = (id: number) => 1 + (((id * 2654435761) >>> 0) % 81 - 40) / 1000;
export function eventCues(e: GameEvent): Cue[] {
  const pan = clamp(e.x / 14, -.8, .8), p = clamp(e.power ?? .3, 0, 1), fx = EFFECT[e.effect ?? 'normal'] ?? EFFECT.normal, j = jitter(e.id);
  const c = (sound: Sample, gain: number, rate = 1): Cue => ({ sound, gain: clamp(gain, 0, 1), rate: clamp(rate * j, .35, 2.5), pan });
  const center = (cue: Cue) => ({ ...cue, pan: 0 }), layer = fx.layer ? [c(fx.layer[0], fx.layer[1] * (.6 + .6 * p), fx.layer[2])] : [];
  switch (e.kind) {
    case 'hit': return [c('impact', .28 + .55 * p, (1.18 - .38 * p) * fx.rate), ...(p > .55 ? [c('heavy', .25 + .6 * (p - .55) / .45, 1.05 - .2 * p)] : []), ...layer];
    case 'shield': return [c('block', .22 + .22 * p, 1.05 - .15 * p)];
    case 'parry': return [c('parry', .55), c('block', .2, 1.6)];
    case 'shieldbreak': return [c('break', .6, .9), c('heavy', .45, .8)];
    case 'ko': return [c('ko', .7), c('heavy', .55, .7)];
    case 'star-ko': return [c('star', .55, .9)];
    case 'jump': return [c('jump', .16)];
    case 'airjump': return [c('jump', .15, 1.22), c('swish', .08, 1.6)];
    case 'land': return [c('impact', .06 + .08 * p, .62)];
    case 'swing': return [c('swish', .12 + .16 * p, (1.3 - .35 * p) * (fx.rate > 1 ? 1.08 : .96))];
    case 'projectile': return [c(e.effect === 'fire' ? 'burn' : e.effect === 'electric' ? 'zap' : 'laser', .16, fx.rate)];
    case 'grab': return [c('swish', .14, .78), c('block', .1, .6)];
    case 'throw': return [c('swish', .22 + .15 * p, .7)];
    case 'tech': return [c('block', .16, 1.35)];
    case 'ledge': return [c('impact', .08, 1.45)];
    case 'respawn': return [c('start', .14, 1.35)];
    case 'counter': return [c('parry', .45, .85), c('impact', .3, .9)];
    case 'reflect': return [c('laser', .22, 1.5), c('parry', .25, 1.2)];
    case 'absorb': return [c('parry', .3, .7)];
    case 'armor': return [c('block', .22, .6)];
    case 'clash': return [c('clash', .5), c('impact', .22, 1.3)];
    case 'dodge': return [c('swish', .1, 1.45)];
    case 'hazard-warn': return [center(c('warning', .42))];
    case 'hazard': return [c('break', .32, .8), c('heavy', .3, .9)];
    case 'taunt': return [c('select', .18, 1.2)];
    case 'sudden-death': return [center(c('warning', .5, .8))];
    default: return [];
  }
}
/**
 * Follows one round's snapshots and fires each event id once. The first snapshot after a mount, reconnect, round change,
 * frame regression or long gap is a silent baseline, so reconnects and duplicate snapshots never replay the fight.
 */
export class CueTracker {
  private turn = ''; private lastId = -1; private frame = -1; private phase: View['phase'] | null = null;
  next(view: View): Cue[] {
    const maxId = view.events.reduce((m, e) => Math.max(m, e.id), -1), previous = this.phase;
    const fresh = view.turnId !== this.turn || view.frame < this.frame || view.frame - this.frame > 90;
    this.phase = view.phase;
    if (fresh) { this.turn = view.turnId; this.lastId = maxId; this.frame = view.frame; return []; }
    this.frame = view.frame;
    const cues: Cue[] = [];
    if (previous === 'countdown' && view.phase === 'fight') cues.push({ sound: 'go', gain: .6, rate: 1, pan: 0 });
    if (previous !== 'complete' && view.phase === 'complete') cues.push({ sound: 'end', gain: .55, rate: 1, pan: 0 });
    for (const e of view.events) if (e.id > this.lastId) cues.push(...eventCues(e));
    this.lastId = Math.max(this.lastId, maxId);
    return cues.slice(0, 16);
  }
}
const COOLDOWN: Partial<Record<Sample, number>> = { impact: 28, swish: 45, jump: 50, laser: 40, block: 40, zap: 60, burn: 60, coin: 50, count: 300, warning: 400, fanfare: 4000 };
const RESULTS_MUSIC_MS = 2600;
type Deck = { audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; file: string; timer?: ReturnType<typeof setTimeout> };
/** One host-display mixer from lobby through results: streamed music decks, decoded effects, mute, unlock and safe disposal. */
export class SkyAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private decks = new Set<Deck>();
  private current: Deck | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Map<AudioBufferSourceNode, AudioNode[]>();
  private lastPlayed = new Map<string, number>();
  private tracker = new CueTracker();
  private props: GameAudioProps<View> | null = null;
  private mode: Mode = 'silent';
  private lastRound = ''; private trackIndex = -1; private countdown = -1; private playedRound: string | null = null; private resultsRound: string | null = null; private resultsAt = 0;
  private muted = false; private disposed = false; private updatedAt = 0; private lastFrame = -1;
  private abort = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  constructor() {
    try { this.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* Optional storage. */ }
    try { const saved = JSON.parse(sessionStorage.getItem('sky-clash.music') ?? 'null'); if (typeof saved?.round === 'string' && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < BATTLE_TRACKS.length) { this.lastRound = saved.round; this.trackIndex = saved.index; } } catch { /* A fresh playlist works without storage. */ }
    try {
      const ctx = this.context = new AudioContext(), master = this.master = ctx.createGain(), music = this.music = ctx.createGain(), compressor = this.compressor = ctx.createDynamicsCompressor();
      master.gain.value = .85; music.gain.value = .8; compressor.threshold.value = -12; compressor.knee.value = 8; compressor.ratio.value = 5;
      music.connect(master); master.connect(compressor); compressor.connect(ctx.destination);
      for (const file of new Set(Object.values(SAMPLES))) void fetch(AUDIO_ROOT + file, { signal: this.abort.signal }).then(r => { if (!r.ok) throw new Error('Missing effect'); return r.arrayBuffer(); })
        .then(bytes => ctx.decodeAudioData(bytes)).then(buffer => { if (!this.disposed) this.buffers.set(file, buffer); }).catch(() => {});
    } catch { /* Audio failure must never prevent a match. */ }
    window.addEventListener('pointerdown', this.unlock); window.addEventListener('keydown', this.unlock); window.addEventListener('party-sound', this.preference); window.addEventListener('pagehide', this.hide);
    document.addEventListener('visibilitychange', this.visibility);
    this.timer = setInterval(this.heartbeat, 100);
  }
  /** Sound only while unmuted, visible, connected and (during play) receiving live snapshots. */
  private allowed() { return !this.disposed && !this.muted && !document.hidden && !!this.props?.connected && !(this.props.phase === 'playing' && performance.now() - this.updatedAt > 1800); }
  private unlock = () => {
    const ctx = this.context;
    if (!ctx || !this.allowed()) return;
    if (ctx.state === 'running' && [...this.decks].every(deck => !deck.audio.paused)) return;
    void ctx.resume().then(() => { if (this.allowed()) for (const deck of this.decks) if (deck.audio.paused) void deck.audio.play().catch(() => {}); }).catch(() => {});
  };
  private preference = (event: Event) => { this.muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted; if (this.muted) this.pause(); else this.unlock(); };
  private visibility = () => { if (document.hidden) this.pause(); else this.unlock(); };
  private hide = () => this.pause();
  private pause() { for (const deck of this.decks) deck.audio.pause(); this.stopEffects(); void this.context?.suspend().catch(() => {}); }
  private saveTrack() { try { sessionStorage.setItem('sky-clash.music', JSON.stringify({ round: this.lastRound, index: this.trackIndex })); } catch { /* Optional storage. */ } }
  private removeDeck(deck: Deck) { clearTimeout(deck.timer); deck.audio.onended = null; deck.audio.pause(); deck.audio.removeAttribute('src'); deck.audio.load(); deck.audio.remove(); deck.source.disconnect(); deck.gain.disconnect(); this.decks.delete(deck); }
  private song(file: string | null) {
    const ctx = this.context;
    if (!ctx || !this.music || (this.current?.file ?? null) === file) return;
    // Keep at most the new stream and its fading predecessor, even across rapid phase changes.
    for (const deck of this.decks) if (deck !== this.current) this.removeDeck(deck);
    const old = this.current; this.current = null;
    if (old) { const g = old.gain.gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(g.value, ctx.currentTime); g.linearRampToValueAtTime(0, ctx.currentTime + .5); old.timer = setTimeout(() => this.removeDeck(old), 560); }
    if (!file) return;
    const audio = new Audio(AUDIO_ROOT + file), gain = ctx.createGain(), source = ctx.createMediaElementSource(audio);
    audio.preload = 'auto'; audio.loop = file === LOBBY_TRACK; audio.hidden = true; audio.dataset.skyTrack = file; document.body.append(audio);
    source.connect(gain); gain.connect(this.music); gain.gain.value = 0; gain.gain.linearRampToValueAtTime(file === LOBBY_TRACK ? .3 : .34, ctx.currentTime + .7);
    const deck: Deck = { audio, gain, source, file }; this.decks.add(deck); this.current = deck;
    audio.onended = () => { if (this.current === deck && this.mode === 'battle') { this.trackIndex = (this.trackIndex + 1) % BATTLE_TRACKS.length; this.saveTrack(); this.song(BATTLE_TRACKS[this.trackIndex]); } };
    this.unlock();
  }
  private effect({ sound, gain: volume, rate, pan }: Cue) {
    // Soft and loud uses of one sample throttle separately, so a landing never swallows a hit.
    const ctx = this.context, now = performance.now(), buffer = this.buffers.get(SAMPLES[sound]), key = `${sound}:${volume > .25 ? 1 : 0}`;
    if (!ctx || !this.master || !buffer || !this.allowed() || ctx.state !== 'running' || this.voices.size >= 14 || now - (this.lastPlayed.get(key) ?? -Infinity) < (COOLDOWN[sound] ?? 24)) return;
    this.lastPlayed.set(key, now);
    const source = ctx.createBufferSource(), gain = ctx.createGain(), stereo = ctx.createStereoPanner();
    source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = volume; stereo.pan.value = pan;
    source.connect(gain); gain.connect(stereo); stereo.connect(this.master); this.voices.set(source, [gain, stereo]);
    source.onended = () => { source.disconnect(); gain.disconnect(); stereo.disconnect(); this.voices.delete(source); }; source.start();
  }
  private stopEffects() { for (const [source, nodes] of this.voices) { source.onended = null; try { source.stop(); } catch { /* Already stopped. */ } source.disconnect(); nodes.forEach(n => n.disconnect()); } this.voices.clear(); }
  /** Music for the current mode; results wait for the fanfare before the lobby song returns. */
  private playMusic() {
    const m = this.mode;
    this.song(m === 'lobby' || m === 'results' && performance.now() - this.resultsAt > RESULTS_MUSIC_MS ? LOBBY_TRACK : m === 'battle' ? BATTLE_TRACKS[Math.max(0, this.trackIndex)] : null);
  }
  private heartbeat = () => {
    if (!this.allowed()) { this.pause(); return; }
    this.unlock(); this.playMusic();
    const view = this.props?.publicView;
    if (this.props?.phase === 'playing' && view?.phase === 'countdown') {
      const n = Math.ceil((view.phaseEndsAt - this.props.serverNowMs()) / 1000);
      if (n >= 1 && n <= 3 && n !== this.countdown) { this.countdown = n; this.effect({ sound: 'count', gain: .42, rate: n === 1 ? 1.12 : 1, pan: 0 }); }
    } else this.countdown = -1;
  };
  update(props: GameAudioProps<View>) {
    if (this.disposed) return;
    const view = props.publicView;
    if (!this.props || props.phase !== this.props.phase || (view?.frame ?? -1) !== this.lastFrame) this.updatedAt = performance.now();
    this.props = props; this.lastFrame = view?.frame ?? -1;
    const mode = this.mode = audioMode(props.phase, view);
    if (mode === 'battle' && view && this.lastRound !== view.turnId) { this.lastRound = view.turnId; this.trackIndex = (this.trackIndex + 1) % BATTLE_TRACKS.length; this.saveTrack(); }
    // One fanfare per round, only when this mount saw the round being played (a reload onto results stays calm).
    if (props.phase === 'playing') this.playedRound = props.roundId;
    if (mode === 'results' && this.resultsRound !== props.roundId) { if (this.playedRound === props.roundId) this.effect({ sound: 'fanfare', gain: .6, rate: 1, pan: 0 }); this.resultsRound = props.roundId; this.resultsAt = performance.now(); }
    this.playMusic();
    if (view && props.phase === 'playing') for (const cue of this.tracker.next(view)) this.effect(cue);
    if (!this.allowed()) this.pause(); else this.unlock();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; clearInterval(this.timer); this.abort.abort(); this.stopEffects();
    for (const deck of this.decks) this.removeDeck(deck); this.current = null; this.buffers.clear();
    window.removeEventListener('pointerdown', this.unlock); window.removeEventListener('keydown', this.unlock); window.removeEventListener('party-sound', this.preference); window.removeEventListener('pagehide', this.hide);
    document.removeEventListener('visibilitychange', this.visibility);
    this.music?.disconnect(); this.master?.disconnect(); this.compressor?.disconnect(); void this.context?.close().catch(() => {});
  }
}
