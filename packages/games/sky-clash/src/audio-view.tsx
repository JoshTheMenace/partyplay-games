import { useEffect, useRef } from 'react';
import type { GameAudioProps } from '../../../party-ui/src/index';
import { SkyAudio } from './audio';
import type { View } from './model';
/** One speaker: the host display. Controllers and secondary displays do not fetch or play audio. */
export function AudioView(props: GameAudioProps<View>) {
  const mixer = useRef<SkyAudio | null>(null), enabled = props.isHost && props.viewRole === 'display';
  useEffect(() => { if (!enabled) return; const audio = mixer.current = new SkyAudio(); return () => { audio.dispose(); mixer.current = null; }; }, [enabled]);
  useEffect(() => { mixer.current?.update(props); }, [props]);
  return null;
}
