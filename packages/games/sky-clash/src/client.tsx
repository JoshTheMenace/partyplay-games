import { lazy, Suspense } from 'react';
import type { GameClientModule } from '../../../party-ui/src/index';
import type { Action, Input, Settings, View } from './model';
import { AudioView } from './audio-view';
import { ControllerView } from './ui/controller';
import { DisplayView } from './ui/hud';
import { LobbyView } from './ui/lobby';
import { ResultsView } from './ui/results';
import { InstructionsView, SettingsView } from './ui/settings';
import './style.css';
/** Display-only 3D scene. Phones never load this chunk (three.js, the fighter models or the stages). */
const loadScene = () => import('./scene/index'), Scene = lazy(loadScene);
export const client: GameClientModule<Input, Action, Settings, View, null> = {
  immersivePhone: true,
  // Preparation and the post-match beat may be portrait; countdown and combat use the landscape gate.
  allowPortraitController: view => !view || view.phase === 'complete',
  SceneView: props => <Suspense fallback={null}><Scene {...props}/></Suspense>,
  LobbyView, DisplayView, ControllerView, SettingsView, InstructionsView, ResultsView, AudioView,
  prepare: ({ role, signal }) => role === 'display' ? loadScene().then(scene => scene.loadSceneAssets(signal)).then(() => undefined) : undefined,
  dispose() {},
};
export default client;
