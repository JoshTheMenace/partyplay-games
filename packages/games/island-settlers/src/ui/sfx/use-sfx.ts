import { useEffect, useMemo, useRef } from 'react';
import { createSfx, type Sfx } from './index';

/**
 * Component-lifetime SFX. `enabled` false (e.g. a non-host display) keeps every call a no-op.
 * The returned object is stable, so it is safe in effect dependency lists.
 */
export function useSfx(enabled = true): Omit<Sfx, 'dispose'> {
  const ref = useRef<Sfx | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const sfx = ref.current = createSfx();
    return () => { sfx.dispose(); ref.current = null; };
  }, [enabled]);
  return useMemo(() => ({
    unlock: () => ref.current?.unlock(),
    play: (event, serverNow) => ref.current?.play(event, serverNow),
    cue: (kind, good) => ref.current?.cue(kind, good),
    warn: (seconds, key) => ref.current?.warn(seconds, key),
    haptic: kind => ref.current?.haptic(kind),
  }), []);
}
