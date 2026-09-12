import { cookingStatus } from './presentation';
import type { View } from './model';

export const SOUND_LEVELS = { chop: .28, 'chop-alt': .28, simmer: .16, ignite: .3, fire: .3, dish: .22, wash: .22, deliver: .55, ready: .32, warning: .42, end: .6 } as const;
export type Sound = keyof typeof SOUND_LEVELS;
type Loop = 'simmer' | 'fire';
export function soundFrame(previous: View | null, view: View) {
  const cues = new Set<Sound>(), loops = new Set<Loop>();
  if (view.complete) return { cues, loops, chopping: false, washing: false };
  if (previous && view.now > previous.now && view.now - previous.now < 1500) {
    if (view.served > previous.served) cues.add('deliver');
    for (const station of view.stations) {
      const before = previous.stations.find(item => item.id === station.id);
      if (!before) continue;
      const status = cookingStatus(station, view.settings.practice)?.kind, oldStatus = cookingStatus(before, view.settings.practice)?.kind;
      if (status !== oldStatus) {
        if (status === 'cooking' && station.powered) cues.add('ignite');
        if (status === 'ready') cues.add('ready');
        if (status === 'warning' || status === 'burnt' || status === 'fire') cues.add('warning');
      }
      if (before.fire > 0 && !station.fire) cues.add('wash');
      if (before.working && before.progress < 1 && station.progress === 1 && ['board', 'sink'].includes(station.kind)) cues.add('dish');
    }
    if (view.players.some(chef => { const before = previous.players.find(p => p.id === chef.id); return before && before.held?.id !== chef.held?.id && (before.held?.kind === 'plate' || chef.held?.kind === 'plate'); })) cues.add('dish');
  }
  for (const station of view.stations) {
    if (station.fire || station.powered && cookingStatus(station, view.settings.practice)?.kind === 'burnt') loops.add('fire');
    else if (station.powered && station.item && ['stove', 'oven'].includes(station.kind)) loops.add('simmer');
  }
  return { cues, loops, chopping: view.stations.some(s => s.kind === 'board' && s.working && s.progress < 1), washing: view.stations.some(s => s.kind === 'sink' && s.working || s.fire > 0 && s.working) };
}

/** One mixer on the shared display. Snapshot state drives sound, never gameplay. */
export class KitchenAudio {
  readonly ready: Promise<void>;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<Sound, AudioBuffer>();
  private sources = new Map<AudioBufferSourceNode, GainNode>();
  private loops = new Map<Loop, AudioBufferSourceNode>();
  private lastPlayed = new Map<Sound, number>();
  private previous: View | null = null;
  private updatedAt = 0;
  private lastChop = 0;
  private lastWash = 0;
  private alternate = false;
  private muted = false;
  private disposed = false;
  private abort = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  constructor(private opening: 'start' | 'end' | null = null) {
    try { this.muted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* Storage can be unavailable. */ }
    try {
      this.context = new AudioContext(); this.master = this.context.createGain(); this.master.gain.value = .65; this.master.connect(this.context.destination);
    } catch { /* Audio is optional; a blocked device must still run the game. */ }
    const context = this.context, createdAt = performance.now();
    this.ready = Promise.all(Object.keys(SOUND_LEVELS).map(async key => {
      if (!context) return;
      const name = key as Sound;
      try {
        const response = await fetch(`/games/kitchen-rush/audio/${name}.wav`, { signal: this.abort.signal });
        if (!response.ok) return;
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!this.disposed) this.buffers.set(name, buffer);
      } catch { /* Missing clips are silent; other effects continue. */ }
    })).then(() => {
      if (this.disposed) return;
      if (performance.now() - createdAt < 1500) {
        if (this.opening === 'start') { this.play('deliver'); this.play('deliver', .22); }
        if (this.opening === 'end') this.play('end');
      }
      this.opening = null;
    });
    window.addEventListener('pointerdown', this.unlock); window.addEventListener('keydown', this.unlock);
    window.addEventListener('party-sound', this.soundPreference); document.addEventListener('visibilitychange', this.visibility);
    this.timer = setInterval(() => { if (performance.now() - this.updatedAt > 1500) this.stop(); }, 250);
    this.unlock();
  }
  private unlock = () => { if (!this.muted && !document.hidden && this.context?.state === 'suspended') void this.context.resume().catch(() => {}); };
  private soundPreference = (event: Event) => { this.muted = (event as CustomEvent<{ muted: boolean }>).detail.muted; if (this.muted) this.stop(); else this.unlock(); };
  private visibility = () => { if (document.hidden) this.stop(); else this.unlock(); };
  private audible() { return !this.disposed && !this.muted && !document.hidden && this.context?.state === 'running'; }
  private play(name: Sound, delay = 0, loop = false) {
    const context = this.context, buffer = this.buffers.get(name), now = performance.now();
    if (!context || !this.master || !buffer || !this.audible() || this.sources.size >= 8 || !delay && now - (this.lastPlayed.get(name) ?? -Infinity) < 120) return;
    this.lastPlayed.set(name, now);
    const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer; source.loop = loop;
    gain.gain.value = SOUND_LEVELS[name]; source.connect(gain); gain.connect(this.master); this.sources.set(source, gain);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); };
    source.start(context.currentTime + delay); return source;
  }
  update(view: View) {
    if (this.disposed || this.previous && view.now < this.previous.now) return;
    const frame = soundFrame(this.previous, view), now = performance.now(); this.previous = view; this.updatedAt = now;
    if (!this.audible() || view.complete) { this.stop(); return; }
    for (const [name, source] of this.loops) if (!frame.loops.has(name)) { source.stop(); this.loops.delete(name); }
    for (const name of frame.loops) if (!this.loops.has(name)) { const source = this.play(name, 0, true); if (source) this.loops.set(name, source); }
    for (const cue of frame.cues) this.play(cue);
    if (frame.chopping && now - this.lastChop > 310) { this.play(this.alternate ? 'chop-alt' : 'chop'); this.alternate = !this.alternate; this.lastChop = now; }
    if (frame.washing && now - this.lastWash > 650) { this.play('wash'); this.lastWash = now; }
  }
  private stop() {
    for (const [source, gain] of this.sources) { source.stop(); source.disconnect(); gain.disconnect(); }
    this.sources.clear(); this.loops.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); clearInterval(this.timer); this.stop(); this.buffers.clear();
    window.removeEventListener('pointerdown', this.unlock); window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('party-sound', this.soundPreference); document.removeEventListener('visibilitychange', this.visibility);
    this.master?.disconnect(); void this.context?.close().catch(() => {});
  }
}
