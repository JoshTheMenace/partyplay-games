/**
 * The room on the wire → the island views the rest of the UI is written against (wire.ts).
 * The TV shows the island the director features; a seat always sees its own island.
 */
import { useEffect } from 'react';
import type { GameViewProps } from '../../../../../party-ui/src/index';
import type { Action, PrivateView, PublicView } from '../../model';
import { islandOf, seatView, type LeagueView, type RoomView, type SeatView } from '../../wire';

export type RoomProps = GameViewProps<null, Action, RoomView, SeatView>;
export type IslandProps = GameViewProps<null, Action, PublicView, PrivateView>;

/** The island on the shared display. */
export const featuredIsland = (room: RoomView) => islandOf(room.league, room.league.island);

/** How often a page that is still missing its views asks again. */
const RETRY_MS = 1500;

/**
 * This seat's island and private view. A page that never received the current revision in full (it
 * joined or reloaded mid-round, or skipped a frame) asks the server for it and keeps the last copy up.
 */
export function useSeat(props: Pick<RoomProps, 'roundId' | 'playerId' | 'publicView' | 'privateView' | 'sendAction'>) {
  const { view, stale } = seatView(props.roundId, props.playerId ?? '', props.publicView, props.privateView);
  const { sendAction } = props;
  useEffect(() => {
    if (!stale) return;
    const ask = () => { void sendAction({ type: 'sync', turnId: 0 }).catch(() => undefined); };
    ask();
    const timer = setInterval(ask, RETRY_MS);
    return () => clearInterval(timer);
  }, [stale, sendAction]);
  return view;
}

/** The island-level props the existing views take. */
export const islandProps = (props: RoomProps, pub: PublicView, me: PrivateView | null): IslandProps =>
  ({ ...props, publicView: pub, privateView: me });

/** League context for island views: null with one island. */
export const sharedLeague = (room: RoomView): LeagueView | null => (room.league.shared ? room.league : null);
