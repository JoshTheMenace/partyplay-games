import { useEffect } from 'react';
import type { PublicView } from '../../model';
import { secondsLeft } from '../shared/format';
import { useSfx } from '../sfx';

/**
 * Public table sounds from the host device (EXPERIENCE §5): every new event once (the sfx dedupes by id and
 * skips events older than 3 s, so a reload replays nothing), plus countdown ticks on the table clock.
 */
export function useTableSfx(pub: PublicView, serverNowMs: () => number, enabled: boolean) {
  const sfx = useSfx(enabled), deadline = pub.clock?.deadline ?? null;
  useEffect(() => {
    for (const event of pub.events) sfx.play(event, serverNowMs());
  }, [pub.events, sfx, serverNowMs]);
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => sfx.warn(secondsLeft(deadline, serverNowMs()), deadline), 200);
    return () => clearInterval(timer);
  }, [deadline, sfx, serverNowMs]);
}
