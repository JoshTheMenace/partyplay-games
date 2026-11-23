import { featuredIsland, sharedLeague, type RoomProps } from '../league/adapt';
import { HudFrame } from './frame';

export { HudFrame, type HudFrameProps } from './frame';

/**
 * TV HUD over SceneView, on the island the director features. A cut remounts the frame, so the new
 * island's history never replays. Public sounds play only on the host's screen, like the music (audio.tsx).
 */
export function DisplayView({ publicView: room, serverNowMs, isHost }: RoomProps) {
  return <HudFrame key={room.league.featured} pub={featuredIsland(room)} league={sharedLeague(room)}
    serverNowMs={serverNowMs} sound={isHost}/>;
}
