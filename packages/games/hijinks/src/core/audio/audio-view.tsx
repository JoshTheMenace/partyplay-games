import { useCallback, useEffect, useRef } from 'react';
import type { GameAudioProps } from '../../../../../party-ui/src/index';
import type { PackPublicView, SfxId } from '../contract';
import { LocalSfx, PackMixer } from './mixer';

/** One speaker for the night: only the host's watching display plays music, cues, narration and read-aloud. */
export function AudioView({ isHost, viewRole, phase, roundId, publicView, connected, serverNowMs }: GameAudioProps<PackPublicView>) {
  const mixer = useRef<PackMixer | null>(null), enabled = isHost && viewRole === 'display';
  useEffect(() => {
    if (!enabled) return;
    let audio: PackMixer;
    try { audio = mixer.current = new PackMixer(); } catch { return; } // No Web Audio: play silently.
    return () => { audio.dispose(); mixer.current = null; };
  }, [enabled]);
  useEffect(() => { mixer.current?.update({ phase, roundId, view: publicView, connected, now: serverNowMs() }); }, [enabled, phase, roundId, publicView, connected, serverNowMs]);
  return null;
}

/** Optional phone-local UI clicks, off by default: `const click = useSfx(on); click('tap')`. Honours the shared mute. */
export function useSfx(enabled = false) {
  const player = useRef<LocalSfx | null>(null);
  useEffect(() => { if (!enabled) return; const sfx = player.current = new LocalSfx(); return () => { sfx.dispose(); player.current = null; }; }, [enabled]);
  return useCallback((id: SfxId) => player.current?.play(id), []);
}
