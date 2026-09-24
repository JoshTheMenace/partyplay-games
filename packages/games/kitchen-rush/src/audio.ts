// Shared-screen sound: one mixer on the host (display or solo). Phones stay silent. Sound follows View.events, never gameplay.
import { useEffect, useRef } from 'react';
import type { GameAudioProps } from '../../../party-ui/src/index';
import type { RoomPhase } from '../../../party-contract/src/protocol';
import { assetUrl } from './asset-url';
import { kitchenMap } from './levels';
import type { EventType, KitchenMap, View } from './model';

export const SOUND_LEVELS = { chop: .3, 'chop-alt': .3, simmer: .14, ignite: .32, fire: .24, dish: .18, wash: .24, deliver: .55, ready: .3, warning: .4, end: .6, ticket: .16, tick: .22 } as const;
export type Sound = keyof typeof SOUND_LEVELS;
/** Variants replay another clip at a fixed pitch: a soft high bell for new tickets, a sharper one for the final seconds. */
export const VARIANTS: Partial<Record<Sound, { clip: Sound; rate: number }>> = { ticket: { clip: 'ready', rate: 1.35 }, tick: { clip: 'ready', rate: 1.75 } };
export const CLIPS = (Object.keys(SOUND_LEVELS) as Sound[]).filter(name => !VARIANTS[name]);
export type Loop = 'simmer' | 'fire';
export const EVENT_SOUNDS: Partial<Record<EventType, Sound>> = {
  serve: 'deliver', star: 'ready', done: 'ready', portal: 'ready', chop: 'chop', wash: 'wash', extinguish: 'wash', splash: 'wash', fall: 'wash',
  fire: 'ignite', warn: 'warning', expire: 'warning', wrong: 'warning', gate: 'warning', place: 'dish', pickup: 'dish', catch: 'dish', order: 'ticket',
};
const secondsLeft = (view: View) => Math.ceil((view.endsAt - view.now) / 1000);
/** Events older than this at arrival are history (join, reconnect, tab return) and stay silent. */
const FRESH_MS = 1500;
export type SoundFrame = { cues: Sound[]; loops: Set<Loop>; chopping: boolean };

/** Music (audio/compose-music.mjs): bossa in the lobby, the swing theme during service, its faster rush in the last 30 s. */
export type Track = 'lobby' | 'service' | 'rush';
export type Sting = 'win' | 'no-stars';
export const MUSIC_LEVELS: Record<Track | Sting, number> = { lobby: .3, service: .28, rush: .3, win: .4, 'no-stars': .4 };
/** Loops are whole bars; the files carry an extra second copied from the start, so looping from 0.5 s is gapless. */
export const LOOPS: Record<Track, { bpm: number; bars: number }> = { lobby: { bpm: 100, bars: 16 }, service: { bpm: 132, bars: 32 }, rush: { bpm: 152, bars: 32 } };
export const barSeconds = (track: Track) => 240 / LOOPS[track].bpm;
export const RUSH_SECONDS = 30;
export function musicFor(phase: RoomPhase, view: View | null): Track | null {
  if (phase === 'lobby') return 'lobby';
  if (phase !== 'playing' || !view || view.complete) return null;
  return view.endsAt - view.now <= RUSH_SECONDS * 1000 ? 'rush' : 'service';
}

/** Pure mapping from two consecutive snapshots to one-shot cues and the loops that should be running. */
export function soundFrame(previous: View | null, view: View, map: KitchenMap): SoundFrame {
  const cues: Sound[] = [], loops = new Set<Loop>();
  if (previous?.complete) return { cues, loops, chopping: false };
  if (!previous) { if (!view.complete && view.now - view.startedAt < FRESH_MS) cues.push('deliver', 'deliver'); }
  else {
    const seen = previous.events.reduce((max, event) => Math.max(max, event.id), -1);
    // Opening tickets arrive with the start bells, so only mid-service orders chime.
    for (const event of view.events) if (event.id > seen && view.now - event.at < FRESH_MS && EVENT_SOUNDS[event.type] && !(event.type === 'order' && event.at <= view.startedAt)) cues.push(EVENT_SOUNDS[event.type]!);
    // Final countdown: a warning bell at 10 s, then a tick for each of the last five seconds.
    const left = secondsLeft(view);
    if (!view.complete && left < secondsLeft(previous) && (left === 10 || left >= 1 && left <= 5)) cues.push(left === 10 ? 'warning' : 'tick');
    if (view.complete) cues.push('end');
  }
  if (view.complete) return { cues, loops, chopping: false };
  for (const state of view.tiles) {
    const item = state.item, kind = map.tiles[state.at]?.kind;
    if (state.fire) loops.add('fire');
    else if (item?.parts.length && !item.parts.some(part => part.state === 'burnt') && (kind === 'oven' || kind === 'stove' && (item.kind === 'pot' || item.kind === 'pan'))) loops.add('simmer');
  }
  return { cues, loops, chopping: view.players.some(chef => chef.work === 'chop') };
}

export class KitchenAudio {
  readonly ready: Promise<void>;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<Sound, AudioBuffer>();
  private sources = new Map<AudioBufferSourceNode, GainNode>();
  private loops = new Map<Loop, AudioBufferSourceNode>();
  private lastPlayed = new Map<Sound, number>();
  private previous: View | null = null;
  private pending: { cues: Sound[]; at: number } = { cues: [], at: 0 };
  private updatedAt = 0;
  private lastChop = 0;
  private alternate = false;
  private muted = false;
  private disposed = false;
  private abort = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  private musicBus: GainNode | null = null;
  private tracks = new Map<Track | Sting, AudioBuffer>();
  private playing: { track: Track; source: AudioBufferSourceNode; gain: GainNode; startedAt: number } | null = null;
  private wanted: Track | null = null;
  /** Round (startedAt) this browser heard live, and the one whose results sting already played. */
  private liveRound = -1;
  private stungRound = -1;
  constructor() {
    try { this.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* Storage can be unavailable. */ }
    try {
      this.context = new AudioContext(); this.master = this.context.createGain(); this.master.gain.value = .7; this.master.connect(this.context.destination);
      this.musicBus = this.context.createGain(); this.musicBus.connect(this.master);
    } catch { /* Audio is optional; a blocked device still runs the game. */ }
    const context = this.context;
    this.ready = Promise.all(CLIPS.map(async key => {
      if (!context) return;
      try {
        const response = await fetch(assetUrl(`audio/${key}.wav`), { signal: this.abort.signal });
        if (!response.ok) return;
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed) this.buffers.set(key, buffer);
      } catch { /* Missing clips are silent; other effects continue. */ }
    })).then(() => { if (performance.now() - this.pending.at < FRESH_MS) this.cue(this.pending.cues); });
    // Music loads after the effects; the current track starts as soon as its file is ready.
    void this.ready.then(() => Promise.all((['lobby', 'service', 'rush', 'win', 'no-stars'] as const).map(async name => {
      if (!context) return;
      try {
        const response = await fetch(assetUrl(`music/${name}.mp3`), { signal: this.abort.signal });
        if (!response.ok) return;
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed) { this.tracks.set(name, buffer); this.syncMusic(); }
      } catch { /* Music is optional. */ }
    })));
    window.addEventListener('pointerdown', this.unlock); window.addEventListener('keydown', this.unlock);
    window.addEventListener('party-sound', this.preference); document.addEventListener('visibilitychange', this.visibility);
    // Loops stop when snapshots stall (disconnect, results); one-shots finish naturally.
    this.timer = setInterval(() => { if (performance.now() - this.updatedAt > FRESH_MS) this.stopLoops(); }, 250);
    this.unlock();
  }
  private unlock = () => { if (!this.muted && !document.hidden && this.context?.state === 'suspended') void this.context.resume().then(() => this.syncMusic()).catch(() => {}); else this.syncMusic(); };
  private preference = (event: Event) => { this.muted = (event as CustomEvent<{ muted: boolean }>).detail.muted; if (this.muted) { this.stop(); this.stopMusic(); } else this.unlock(); };
  private visibility = () => { if (document.hidden) { this.stop(); this.stopMusic(); } else this.unlock(); };
  private audible() { return !this.disposed && !this.muted && !document.hidden && this.context?.state === 'running'; }
  private play(name: Sound, delay = 0, loop = false) {
    const context = this.context, variant = VARIANTS[name], buffer = this.buffers.get(variant?.clip ?? name), now = performance.now();
    if (!context || !this.master || !buffer || !this.audible() || this.sources.size >= 8 || !delay && now - (this.lastPlayed.get(name) ?? -Infinity) < 110) return;
    this.lastPlayed.set(name, now);
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = loop; gain.gain.value = SOUND_LEVELS[name];
    // A little pitch variety keeps repeated chops and clinks from sounding mechanical.
    if (!loop && source.playbackRate) source.playbackRate.value = variant?.rate ?? .94 + Math.random() * .12;
    source.connect(gain); gain.connect(this.master); this.sources.set(source, gain);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); };
    source.start(context.currentTime + delay); return source;
  }
  /** Plays a burst with at most two of each sound; the second is offset so a double bell reads as "ding-ding". */
  private cue(cues: Sound[]) {
    const counts = new Map<Sound, number>();
    for (let name of cues) {
      if (name === 'chop') { name = this.alternate ? 'chop-alt' : 'chop'; this.alternate = !this.alternate; }
      const n = counts.get(name) ?? 0; counts.set(name, n + 1);
      if (n < 2) this.play(name, n * .22);
    }
  }
  update(view: View | null) {
    if (this.disposed) return;
    if (!view) { this.previous = null; this.stopLoops(); return; }
    if (this.previous && (view.now < this.previous.now || view.startedAt !== this.previous.startedAt)) this.previous = null;
    let map: KitchenMap;
    try { map = kitchenMap(view.settings.level, view.players.length); } catch { return; }
    const frame = soundFrame(this.previous, view, map), now = performance.now();
    this.previous = view; this.updatedAt = now;
    if (!this.buffers.size) { if (frame.cues.length) this.pending = { cues: frame.cues, at: now }; return; }
    if (!this.audible()) { this.stop(); return; }
    for (const [name, source] of this.loops) if (!frame.loops.has(name)) { source.stop(); this.loops.delete(name); }
    for (const name of frame.loops) if (!this.loops.has(name)) { const source = this.play(name, 0, true); if (source) this.loops.set(name, source); }
    this.cue(frame.cues);
    if (frame.chopping && now - this.lastChop > 300) { this.cue(['chop']); this.lastChop = now; }
  }
  /** Follows the room: lobby → service → rush, then a results sting once the service this browser heard is over. */
  music(phase: RoomPhase, view: View | null) {
    if (this.disposed) return;
    this.wanted = musicFor(phase, view);
    if (this.wanted === 'service' || this.wanted === 'rush') this.liveRound = view!.startedAt;
    if (view?.complete && view.startedAt === this.liveRound && this.stungRound !== view.startedAt) {
      this.stungRound = view.startedAt;
      this.sting(view.stars > 0 ? 'win' : 'no-stars', 1.4); // after the closing gong
    }
    this.syncMusic();
  }
  private syncMusic() {
    const context = this.context, bus = this.musicBus;
    if (!context || !bus || this.disposed) return;
    const want = this.audible() ? this.wanted : null, old = this.playing;
    if (old?.track === want) return;
    const buffer = want ? this.tracks.get(want) : undefined;
    if (want && !buffer && old) return; // keep the current track until the next file is ready
    // Service → rush changes on the next bar line so the faster tune lands on a downbeat.
    const now = context.currentTime, bar = old && barSeconds(old.track);
    const at = old && bar && want === 'rush' ? old.startedAt + Math.ceil((now + .05 - old.startedAt) / bar) * bar : now + .03;
    if (old) {
      old.gain.gain.cancelScheduledValues(now); old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, at); old.gain.gain.linearRampToValueAtTime(0, at + (want === 'rush' ? .35 : 1.2));
      old.source.stop(at + 1.3); this.playing = null;
    }
    if (!want || !buffer) return;
    const source = context.createBufferSource(), gain = context.createGain(), { bpm, bars } = LOOPS[want];
    source.buffer = buffer; source.loop = true; source.loopStart = .5; source.loopEnd = .5 + bars * 240 / bpm;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(MUSIC_LEVELS[want], at + (want === 'rush' ? .05 : .8));
    source.connect(gain); gain.connect(bus); source.start(at);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    this.playing = { track: want, source, gain, startedAt: at };
  }
  private sting(name: Sting, delay: number) {
    const context = this.context, buffer = this.tracks.get(name);
    if (!context || !this.musicBus || !buffer || !this.audible()) return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.value = MUSIC_LEVELS[name];
    source.connect(gain); gain.connect(this.musicBus); source.start(context.currentTime + delay);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
  }
  private stopMusic() { this.playing?.source.stop(); this.playing = null; }
  private stopLoops() { for (const source of this.loops.values()) source.stop(); this.loops.clear(); }
  private stop() {
    for (const [source, gain] of this.sources) { source.stop(); source.disconnect(); gain.disconnect(); }
    this.sources.clear(); this.loops.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); clearInterval(this.timer); this.stop(); this.stopMusic(); this.buffers.clear(); this.tracks.clear();
    window.removeEventListener('pointerdown', this.unlock); window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('party-sound', this.preference); document.removeEventListener('visibilitychange', this.visibility);
    this.master?.disconnect(); void this.context?.close().catch(() => {});
  }
}

/** Retained by the shell from lobby through results, so music carries across rounds and the end cue plays as results appear. */
export function AudioView({ isHost, publicView, phase }: GameAudioProps<View>) {
  const mixer = useRef<KitchenAudio | null>(null);
  useEffect(() => { if (!isHost) return; const audio = new KitchenAudio(); mixer.current = audio; return () => { mixer.current = null; audio.dispose(); }; }, [isHost]);
  useEffect(() => { mixer.current?.update(publicView); mixer.current?.music(phase, publicView); }, [publicView, phase]);
  return null;
}
