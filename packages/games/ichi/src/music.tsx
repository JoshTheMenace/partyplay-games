import { useEffect } from 'react';
import type { GameAudioProps } from '../../../party-ui/src/index';
import type { PublicView } from './types';

// Rendered by music/render.ts: Lantern Lounge is 32 bars at 78 BPM.
const SRC = '/games/ichi/music/lantern-lounge.mp3', LOOP = 32 * 4 * 60 / 78, VOLUME = 0.3, LAME_DELAY = 1105;
const storedMute = () => { try { return localStorage.getItem('party.sound.muted') === 'true'; } catch { return false; } };

/** TV-only background music: a gapless Web Audio loop that waits for a gesture and follows the shared sound toggle. */
export function AudioView({ viewRole }: GameAudioProps<PublicView>) {
  useEffect(() => {
    if (viewRole !== 'display' || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext(), gain = ctx.createGain(), abort = new AbortController();
    let muted = storedMute();
    gain.gain.value = 0; gain.connect(ctx.destination);
    const level = (to: number, seconds: number) => gain.gain.setTargetAtTime(to, ctx.currentTime, seconds / 3);
    const resume = () => { if (!muted && !document.hidden) void ctx.resume().catch(() => {}); };
    const preference = (event: Event) => { muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted; level(muted ? 0 : VOLUME, 0.4); resume(); };
    const visibility = () => { if (document.hidden) void ctx.suspend().catch(() => {}); else resume(); };
    fetch(SRC, { signal: abort.signal }).then(r => r.arrayBuffer()).then(data => ctx.decodeAudioData(data)).then(buffer => {
      if (abort.signal.aborted) return;
      // Some decoders keep the MP3 encoder delay; skip it so the loop points land on the musical loop.
      const lead = buffer.duration - LOOP > 0.02 ? LAME_DELAY / buffer.sampleRate : 0, source = ctx.createBufferSource();
      source.buffer = buffer; source.loop = true; source.loopStart = lead; source.loopEnd = lead + Math.min(LOOP, buffer.duration - lead);
      source.connect(gain); source.start(0, lead); if (!muted) level(VOLUME, 2);
    }).catch(() => { /* Music is optional. */ });
    for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, resume, { signal: abort.signal });
    window.addEventListener('party-sound', preference, { signal: abort.signal });
    document.addEventListener('visibilitychange', visibility, { signal: abort.signal });
    resume();
    return () => { abort.abort(); void ctx.close().catch(() => {}); };
  }, [viewRole]);
  return null;
}
