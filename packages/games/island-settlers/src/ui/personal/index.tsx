/**
 * PersonalView: the seated host (EXPERIENCE §4.9). The 3D board (SceneView) always shows behind the TV
 * HUD frame in host mode, with the controller dock at the bottom, so no tab ever hides the board.
 */
import type { GameViewProps } from '../../../../../party-ui/src/index';
import type { Action, PrivateView, PublicView } from '../../model';
import { HudFrame } from '../display/index';
import { Dock } from './Dock';
import './personal.css';

type Props = GameViewProps<null, Action, PublicView, PrivateView>;

export function PersonalView(props: Props) {
  const { publicView: pub, privateView: me, serverNowMs, isHost, playerId } = props;
  // Same test as SceneView's camera fit, so the board window and the reserved dock always agree.
  return <HudFrame pub={pub} serverNowMs={serverNowMs} host={!!isHost && !!playerId} sound={isHost}>
    {me && <Dock {...props} privateView={me}/>}
  </HudFrame>;
}
