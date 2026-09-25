import type { GameViewProps } from '../../../../../party-ui/src/index';
import type { Action, PrivateView, PublicView } from '../../model';
import { HudFrame } from './frame';

export { HudFrame, type HudFrameProps } from './frame';

/** TV HUD over SceneView. Public sounds play only on the host's screen, like the music (audio.tsx). */
type Props = GameViewProps<null, Action, PublicView, PrivateView>;

export function DisplayView({ publicView, serverNowMs, isHost }: Props) {
  return <HudFrame pub={publicView} serverNowMs={serverNowMs} sound={isHost}/>;
}
