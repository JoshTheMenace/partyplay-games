import { useEffect, useRef } from 'react';
import type { GameAudioProps } from '../../../party-ui/src/index';
import { ResourceScope } from '../../../party-runtime/src/index';
import type { PublicView } from './model';
import { Soundtrack } from './music';

/** Host authority owns the speakers, even when the host occupies a player seat. */
export function AudioView({ isHost, connected, phase }: GameAudioProps<PublicView>) {
  const active = useRef(false), sync = useRef<(retry?: boolean) => void>(() => {});
  active.current = connected && phase === 'playing';
  useEffect(() => {
    if (!isHost) return;
    const scope = new ResourceScope(), music = scope.own(new Soundtrack());
    let muted = false, away = false;
    try { muted = localStorage.getItem('party.sound.muted') === 'true'; } catch { /* Storage can be unavailable. */ }
    const update = (retry = false) => music.setPlaying(active.current && !muted && !document.hidden && !away, retry);
    sync.current = update;
    const unlock = (event: Event) => { if (event.isTrusted) update(true); };
    scope.listen(window, 'pointerdown', unlock, { capture: true });
    scope.listen(window, 'keydown', unlock, { capture: true });
    scope.listen(window, 'party-sound', event => { muted = !!(event as CustomEvent<{ muted: boolean }>).detail?.muted; update(true); });
    scope.listen(document, 'visibilitychange', () => update(true));
    scope.listen(window, 'online', () => update(true));
    scope.listen(window, 'pagehide', () => { away = true; update(); });
    scope.listen(window, 'pageshow', () => { away = false; update(true); });
    update();
    return () => { sync.current = () => {}; scope.dispose(); };
  }, [isHost]);
  useEffect(() => { sync.current(true); }, [isHost, connected, phase]);
  return null;
}
