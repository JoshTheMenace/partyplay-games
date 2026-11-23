/**
 * PersonalView: the seated host (EXPERIENCE §4.9). The 3D board (SceneView) always shows behind the TV
 * HUD frame in host mode, with the controller dock at the bottom, so no tab ever hides the board.
 * A seated host watches their own island, as a phone does.
 */
import { HudFrame } from '../display/index';
import { featuredIsland, islandProps, sharedLeague, useSeat, type RoomProps } from '../league/adapt';
import { Dock } from './Dock';
import './personal.css';

export function PersonalView(props: RoomProps) {
  const { publicView: room, serverNowMs, isHost, playerId } = props, seat = useSeat(props);
  const pub = seat?.pub ?? featuredIsland(room);
  // Same test as SceneView's camera fit, so the board window and the reserved dock always agree.
  return <HudFrame pub={pub} league={sharedLeague(room)} home={seat?.home} serverNowMs={serverNowMs}
    host={!!isHost && !!playerId} sound={isHost}>
    {seat && <Dock {...islandProps(props, seat.pub, seat.me)} privateView={seat.me}/>}
  </HudFrame>;
}
