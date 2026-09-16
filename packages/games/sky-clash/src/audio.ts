import type { GameAudioProps } from '../../../party-ui/src/index';
import type { View } from './model';
import { stageFrame } from './stages';
export const AUDIO_ROOT = '/games/sky-clash/audio/';
export const BATTLE_TRACKS = ['adventure-forward.mp3', 'adventures-final-frontier.mp3', 'bouken-no-jokyoku.mp3', 'triumph-of-the-brave.mp3'] as const;
export const EFFECTS = {
  hit: ['impact-hit-0.wav', .5, 1], attack: ['swish.wav', .25, 1], land: ['impact-hit-0.wav', .15, .7],
  jump: ['jump.wav', .22, 1], laser: ['laser.wav', .25, 1], block: ['block.wav', .35, 1], break: ['break.wav', .45, 1],
  ko: ['ko.wav', .65, 1], count: ['count.wav', .4, 1], start: ['start.wav', .5, 1], end: ['end.wav', .5, 1], select: ['select.wav', .3, 1], warning: ['warning.wav', .35, 1],
} as const;
export type Sound = keyof typeof EFFECTS;
type Cue = { sound: Sound; pan: number };
type Mode = 'lobby' | 'battle' | 'results' | 'silent';
export function audioMode(phase: GameAudioProps<View>['phase'], view: View | null): Mode {
  if (phase === 'picker') return 'silent';
  if (phase === 'results' || view?.phase === 'complete') return 'results';
  return phase === 'playing' && view?.phase === 'fight' ? 'battle' : 'lobby';
}
/** Only fresh authoritative changes make sounds; reconnect snapshots never replay the old fight. */
export function soundFrame(previous: View | null, view: View): Cue[] {
  if (!previous || previous.turnId !== view.turnId || view.frame < previous.frame || view.frame - previous.frame > 90 || view.frame === previous.frame && view.phase === previous.phase) return [];
  const cues: Cue[] = [], add = (sound: Sound, x = 0) => cues.push({ sound, pan: Math.max(-.7, Math.min(.7, x / 15)) });
  if (view.phase === 'fight' && previous.phase !== 'fight') add('start');
  if (view.phase === 'complete' && previous.phase !== 'complete') add('end');
  if (view.phase === 'select') for (const p of view.players) if (p.chosen && !previous.players.find(q => q.id === p.id)?.chosen) add('select', p.x);
  if (view.phase === 'vote' && view.mapVotes.length > previous.mapVotes.length) add('select');
  if (view.phase !== 'fight' || previous.phase !== 'fight') return cues;
  const seen = Math.max(0, ...previous.impacts.map(i => i.id));
  for (const impact of view.impacts) if (impact.id > seen) add(impact.kind, impact.x);
  for (const shot of view.projectiles) if (!previous.projectiles.some(p => p.id === shot.id)) add('laser', shot.x);
  for (const p of view.players) {
    const before = previous.players.find(q => q.id === p.id);
    if (!before || !p.stocks || p.mode === 'respawn' || before.mode === 'respawn') continue;
    if (p.move && (!before.move || p.moveFrame < before.moveFrame) && !['laser', 'reflect'].includes(p.move)) add('attack', p.x);
    if (p.jumps < before.jumps && p.vy > 0 && p.mode !== 'hurt') add('jump', p.x);
    if (p.grounded && !before.grounded) add('land', p.x);
  }
  if (stageFrame(view.stageId, view.stageTick, view.hazards).hazard?.warning && !stageFrame(previous.stageId, previous.stageTick, previous.hazards).hazard?.warning) add('warning');
  return cues;
}

type Deck = { audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; file: string; timer?: ReturnType<typeof setTimeout> };
/** One host-owned mixer spanning lobby, preparation, play and results. Songs stream; only tiny effects decode. */
export class SkyAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private decks = new Set<Deck>();
  private current: Deck | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Map<AudioBufferSourceNode, AudioNode[]>();
  private lastPlayed = new Map<Sound, number>();
  private previous: View | null = null;
  private props: GameAudioProps<View> | null = null;
  private mode: Mode = 'silent';
  private lastRound = '';
  private trackIndex = -1;
  private countdown = -1;
  private muted = false;
  private disposed = false;
  private updatedAt = 0;
  private abort = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  constructor() {
    try { this.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* Optional storage. */ }
    try { const saved = JSON.parse(sessionStorage.getItem('sky-clash.music') ?? 'null'); if (typeof saved?.round === 'string' && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < BATTLE_TRACKS.length) { this.lastRound = saved.round; this.trackIndex = saved.index; } } catch { /* A fresh playlist works without storage. */ }
    try {
      const ctx = this.context = new AudioContext(), master = this.master = ctx.createGain(), compressor = this.compressor = ctx.createDynamicsCompressor();
      master.gain.value = .8; compressor.threshold.value = -10; compressor.ratio.value = 5; master.connect(compressor); compressor.connect(ctx.destination);
      for (const file of new Set(Object.values(EFFECTS).map(s => s[0]))) void fetch(AUDIO_ROOT + file, { signal: this.abort.signal }).then(r => { if (!r.ok) throw new Error('Missing effect'); return r.arrayBuffer(); }).then(bytes => ctx.decodeAudioData(bytes)).then(buffer => { if (!this.disposed) this.buffers.set(file, buffer); }).catch(() => {});
    } catch { /* Audio failure must not prevent a match. */ }
    window.addEventListener('pointerdown', this.unlock); window.addEventListener('keydown', this.unlock); window.addEventListener('party-sound', this.preference); window.addEventListener('pagehide', this.hide);
    document.addEventListener('visibilitychange', this.visibility);
    this.timer = setInterval(this.heartbeat, 100);
  }
  private allowed() { return !this.disposed && !this.muted && !document.hidden && !!this.props?.connected && !(this.props.phase === 'playing' && performance.now() - this.updatedAt > 1800); }
  private unlock = () => {
    const ctx = this.context;
    if (!ctx || !this.allowed()) return;
    if (ctx.state === 'running' && [...this.decks].every(deck => !deck.audio.paused)) return;
    void ctx.resume().then(() => { if (this.allowed()) for (const deck of this.decks) if (deck.audio.paused) void deck.audio.play().catch(() => {}); }).catch(() => {});
  };
  private preference = (event: Event) => { this.muted = !!(event as CustomEvent<{ muted: boolean }>).detail.muted; if (this.muted) this.pause(); else this.unlock(); };
  private visibility = () => { if (document.hidden) this.pause(); else this.unlock(); };
  private hide = () => this.pause();
  private pause() { for (const deck of this.decks) deck.audio.pause(); this.stopEffects(); void this.context?.suspend().catch(() => {}); }
  private saveTrack() { try { sessionStorage.setItem('sky-clash.music', JSON.stringify({ round: this.lastRound, index: this.trackIndex })); } catch { /* Optional storage. */ } }
  private removeDeck(deck: Deck) { clearTimeout(deck.timer); deck.audio.onended = null; deck.audio.pause(); deck.audio.removeAttribute('src'); deck.audio.load(); deck.audio.remove(); deck.source.disconnect(); deck.gain.disconnect(); this.decks.delete(deck); }
  private song(file: string | null) {
    const ctx = this.context;
    if (!ctx || !this.master || (this.current?.file ?? null) === file) return;
    // Retain at most the new stream and its fading predecessor, including rapid phase changes.
    for (const deck of this.decks) if (deck !== this.current) this.removeDeck(deck);
    const old = this.current; this.current = null;
    if (old) { old.gain.gain.cancelScheduledValues(ctx.currentTime); old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime); old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + .4); old.timer = setTimeout(() => this.removeDeck(old), 450); }
    if (!file) return;
    const audio = new Audio(AUDIO_ROOT + file), gain = ctx.createGain(), source = ctx.createMediaElementSource(audio);
    audio.preload = 'auto'; audio.loop = file === 'lobby.mp3'; audio.hidden = true; audio.dataset.skyTrack = file; document.body.append(audio);
    source.connect(gain); gain.connect(this.master); gain.gain.value = 0; gain.gain.linearRampToValueAtTime(.3, ctx.currentTime + .65);
    const deck = { audio, gain, source, file }; this.decks.add(deck); this.current = deck;
    audio.onended = () => { if (this.current === deck && this.mode === 'battle') { this.trackIndex = (this.trackIndex + 1) % BATTLE_TRACKS.length; this.saveTrack(); this.song(BATTLE_TRACKS[this.trackIndex]); } };
    this.unlock();
  }
  private effect(sound: Sound, pan = 0) {
    const ctx = this.context, now = performance.now(), [file, volume, rate] = EFFECTS[sound], buffer = this.buffers.get(file);
    if (!ctx || !this.master || !buffer || !this.allowed() || ctx.state !== 'running' || this.voices.size >= 12 || now - (this.lastPlayed.get(sound) ?? -Infinity) < (sound === 'attack' || sound === 'land' ? 130 : 75)) return;
    this.lastPlayed.set(sound, now);
    const source = ctx.createBufferSource(), gain = ctx.createGain(), stereo = ctx.createStereoPanner();
    source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = volume; stereo.pan.value = pan;
    source.connect(gain); gain.connect(stereo); stereo.connect(this.master); this.voices.set(source, [gain, stereo]);
    source.onended = () => { source.disconnect(); gain.disconnect(); stereo.disconnect(); this.voices.delete(source); }; source.start();
  }
  private stopEffects() { for (const [source, nodes] of this.voices) { source.onended = null; source.stop(); source.disconnect(); nodes.forEach(n => n.disconnect()); } this.voices.clear(); }
  private heartbeat = () => {
    if (!this.allowed()) { this.pause(); return; }
    this.unlock();
    const view = this.props?.publicView;
    if (view?.phase === 'countdown') {
      const number = Math.ceil((view.phaseEndsAt - this.props!.serverNowMs()) / 1000);
      if (number >= 1 && number <= 3 && number !== this.countdown) { this.countdown = number; this.effect('count'); }
    } else this.countdown = -1;
  };
  update(props: GameAudioProps<View>) {
    if (this.disposed) return;
    if (!this.props || props.phase !== this.props.phase || props.publicView?.frame !== this.previous?.frame) this.updatedAt = performance.now();
    this.props = props;
    const view = props.publicView, mode = audioMode(props.phase, view);
    if (mode === 'battle' && view && this.lastRound !== view.turnId) { this.lastRound = view.turnId; this.trackIndex = (this.trackIndex + 1) % BATTLE_TRACKS.length; this.saveTrack(); }
    this.mode = mode;
    this.song(mode === 'lobby' ? 'lobby.mp3' : mode === 'battle' ? BATTLE_TRACKS[Math.max(0, this.trackIndex)] : null);
    if (view) for (const cue of soundFrame(this.previous, view)) this.effect(cue.sound, cue.pan);
    this.previous = view;
    if (!this.allowed()) this.pause(); else this.unlock();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; clearInterval(this.timer); this.abort.abort(); this.stopEffects();
    for (const deck of this.decks) this.removeDeck(deck); this.current = null; this.buffers.clear();
    window.removeEventListener('pointerdown', this.unlock); window.removeEventListener('keydown', this.unlock); window.removeEventListener('party-sound', this.preference); window.removeEventListener('pagehide', this.hide); document.removeEventListener('visibilitychange', this.visibility);
    this.master?.disconnect(); this.compressor?.disconnect(); void this.context?.close().catch(() => {});
  }
}
