/**
 * Events replay: re-publishes the fixture's recent events as fresh snapshots (new ids, `at` = the
 * preview clock), keeping their original spacing, so timeline animations play as they would live.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameEvent, PublicView, RollEvent } from '../../../src/model';
import type { Clock } from './clock';

/** Events this close to the fixture's `now` count as recent; the rest stay as history. */
const RECENT_MS = 15_000;
const MAX_GAP_MS = 2500;

export function useReplay(initial: PublicView, fixtureNow: number, clock: Clock, auto: boolean) {
  const [snap, setSnap] = useState({ pub: initial, time: clock.now() });
  const timers = useRef<number[]>([]), nextId = useRef(0);

  const replay = useCallback(() => {
    timers.current.forEach(clearTimeout);
    const recent = initial.events.filter(e => e.at >= fixtureNow - RECENT_MS);
    const older = initial.events.filter(e => !recent.includes(e));
    const roll = (list: GameEvent[]) =>
      ([...list].reverse().find(e => e.kind === 'roll') as RollEvent | undefined) ?? null;
    const before = recent.some(e => e.kind === 'roll') ? roll(older) : initial.lastRoll;
    let played: GameEvent[] = [], delay = 400;
    nextId.current = Math.max(nextId.current, ...initial.events.map(e => e.id));
    const publish = () => setSnap({
      pub: { ...initial, events: [...older, ...played].slice(-40), lastRoll: roll(played) ?? before },
      time: clock.now(),
    });
    publish();
    timers.current = recent.map((event, i) => {
      if (i) delay += Math.min(MAX_GAP_MS, Math.max(150, event.at - recent[i - 1].at));
      return window.setTimeout(() => {
        played = [...played, { ...event, id: ++nextId.current, at: clock.now() } as GameEvent];
        publish();
      }, delay);
    });
  }, [initial, fixtureNow, clock]);

  useEffect(() => {
    if (auto) replay();
    return () => timers.current.forEach(clearTimeout);
  }, [auto, replay]);

  return { ...snap, replay };
}
