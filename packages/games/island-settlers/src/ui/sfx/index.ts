import { ResourceScope } from '../../../../../party-runtime/src/index';
import type { GameEvent, Good } from '../../model';
import { soundsFor } from './events';
import { haptic, type HapticKind } from './haptics';
import { RECIPES, type SoundName } from './recipes';
import { noiseBuffer, synth } from './synth';

export { soundsFor, type Shot } from './events';
export { HAPTICS, haptic, type HapticKind } from './haptics';
export { GOOD_PITCH, RECIPES, type SoundName } from './recipes';
export { useSfx } from './use-sfx';

/** Phone personal cues (EXPERIENCE §4.5) and the recipe each reuses. */
export type CueKind = 'turn' | 'resource' | 'robbed' | 'offer';
const CUES: Record<CueKind, SoundName> = {
  turn: 'turn', resource: 'resource', robbed: 'steal', offer: 'offer',
};

const PERSONAL = 0.6, STALE_MS = 3000, BLIPS = 6, BLIP_WINDOW = 0.2, REMEMBER = 512;
const WARN_AT = new Set([10, 5, 4, 3, 2, 1]);

export type Sfx = {
  /** Creates or resumes the one AudioContext. Runs on every trusted pointer/key press already. */
  unlock(): void;
  /** Public event sounds, once per event id. With `serverNow`, events older than 3 s stay silent. */
  play(event: GameEvent, serverNow?: number): void;
  /** Personal phone cue at 0.6× the TV level. `good` picks the resource pitch. */
  cue(kind: CueKind, good?: Good): void;
  /** Countdown tick at 10, 5, 4, 3, 2 and 1 s. `key` (e.g. the deadline) stops re-render repeats. */
  warn(seconds: number, key?: string | number): void;
  haptic(kind: HapticKind): void;
  dispose(): void;
};

export type SfxOptions = { createContext?: () => AudioContext };

/** SFX voices → master 0.35 → gentle compressor → speakers (EXPERIENCE §5). */
function output(ctx: AudioContext) {
  const master = ctx.createGain(), squeeze = ctx.createDynamicsCompressor();
  master.gain.value = 0.35;
  squeeze.threshold.value = -18; squeeze.ratio.value = 4;
  squeeze.attack.value = 0.003; squeeze.release.value = 0.15;
  master.connect(squeeze).connect(ctx.destination);
  return master;
}

export function createSfx({ createContext = () => new AudioContext() }: SfxOptions = {}): Sfx {
  const scope = new ResourceScope(), live = new Set<AudioScheduledSourceNode>(), heard = new Set<number>();
  let ctx: AudioContext | null = null, master: GainNode, noise: AudioBuffer;
  let muted = false, blips: number[] = [], warned = '';
  try { muted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* No storage. */ }
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const audible = () => !muted && !hidden() && !scope.signal.aborted;
  const sync = () => { if (ctx) void (audible() ? ctx.resume() : ctx.suspend()).catch(() => {}); };
  const unlock = () => {
    try {
      if (!ctx && audible()) { ctx = createContext(); master = output(ctx); noise = noiseBuffer(ctx); }
    } catch { /* No audio device: stay silent. */ }
    sync();
  };
  const sound = (name: SoundName, delayMs: number, level: number, good?: Good) => {
    if (!ctx || ctx.state !== 'running' || !audible()) return;
    const now = ctx.currentTime, start = now + 0.01 + delayMs / 1000;
    if (name === 'resource') {
      blips = blips.filter(t => t > now - 1);
      if (blips.filter(t => Math.abs(t - start) < BLIP_WINDOW).length >= BLIPS) return;
      blips.push(start);
    }
    RECIPES[name](synth(ctx, master, noise, start, level, live), good);
  };
  if (typeof window !== 'undefined') {
    const gesture = (event: Event) => { if (event.isTrusted) unlock(); };
    scope.listen(window, 'pointerdown', gesture, { capture: true });
    scope.listen(window, 'keydown', gesture, { capture: true });
    scope.listen(window, 'party-sound', event => {
      muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted;
      unlock();
    });
    scope.listen(document, 'visibilitychange', sync);
  }
  scope.defer(() => {
    for (const source of live) try { source.stop(); } catch { /* Already ended. */ }
    void ctx?.close().catch(() => {});
    ctx = null;
  });
  return {
    unlock,
    play(event, serverNow) {
      if (heard.has(event.id)) return;
      heard.add(event.id);
      if (heard.size > REMEMBER) heard.delete(heard.values().next().value!);
      if (serverNow !== undefined && serverNow - event.at > STALE_MS) return;
      for (const shot of soundsFor(event)) sound(shot.sound, shot.delay, 1, shot.good);
    },
    cue: (kind, good) => sound(CUES[kind], 0, PERSONAL, good),
    warn(seconds, key = '') {
      const id = `${key}:${seconds}`;
      if (!WARN_AT.has(seconds) || id === warned) return;
      warned = id;
      sound('tick', 0, 1);
    },
    haptic,
    dispose: scope.dispose,
  };
}
