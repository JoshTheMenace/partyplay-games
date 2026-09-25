import { lazy, Suspense, type ComponentType } from 'react';
import type { GameClientModule } from '../../../party-ui/src/index';
import { AudioView } from './audio';
import type { Action, PrivateView, PublicView, Settings } from './model';
import { InstructionsView } from './ui/instructions';
import { SettingsView } from './ui/settings';
import { bridge } from './ui/shared/bridge';
import './ui/base.css';

/** Each view loads lazily, so the TV, phones and results only fetch what their role renders. */
function lazyView<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const View = lazy(async () => ({ default: await load() }));
  return props => <Suspense fallback={null}><View {...props}/></Suspense>;
}

export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = {
  AudioView,
  settingsWide: true,
  SceneView: lazyView(async () => (await import('./ui/scene/index')).SceneView),
  DisplayView: lazyView(async () => (await import('./ui/display/index')).DisplayView),
  ControllerView: lazyView(async () => (await import('./ui/controller/index')).ControllerView),
  PersonalView: lazyView(async () => (await import('./ui/personal/index')).PersonalView),
  ResultsView: lazyView(async () => (await import('./ui/results/index')).ResultsView),
  SettingsView,
  InstructionsView,
  prepare() {},
  dispose() { bridge.reset(); },
};
export default client;
