import { lazy, Suspense } from 'react';
import type { GameClientModule } from '../../../party-ui/src/index';
import { ControllerView } from './client/ui/controller';
import { DisplayView } from './client/ui/display';
import { InstructionsView, ResultsView, SettingsView } from './client/ui/lobby';
import type { Action, Input, PrivateView, Settings, View } from './shared/protocol';
import './client/style.css';

/** The 3D world (engine, game loop, audio) loads only when a scene mounts. */
const World = lazy(() => import('./client/scene'));
export const client: GameClientModule<Input, Action, Settings, View, PrivateView> = {
  immersivePhone: true,
  sceneRoles: ['display', 'controller'],
  SceneView: props => <Suspense fallback={null}><World {...props}/></Suspense>,
  DisplayView, ControllerView, SettingsView, InstructionsView, ResultsView,
  prepare() {},
  dispose() {},
};
export default client;
