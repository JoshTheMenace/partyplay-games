import type { GameClientModule } from '../../../party-ui/src/index';
import type { Action, Input, Settings, View } from './model';
import { NightJobScene } from './scene';
import { setAssetBase } from './render/assets';
import { AudioView } from './audio';
import { DisplayView } from './hud';
import { ControllerView } from './controller';
import { InstructionsView, LobbyView, SettingsView } from './lobby';
import { ResultsView } from './results';
import './style.css';

export const client: GameClientModule<Input, Action, Settings, View, null> = {
  AudioView, immersivePhone: true, SceneView: NightJobScene, LobbyView, DisplayView, ControllerView,
  settingsWide: true, SettingsView, InstructionsView, ResultsView,
  prepare({ assetBase }) { setAssetBase(assetBase); }, dispose() {},
};
export default client;
