/* Client module: controller, display, lobby, settings, results. The 3D scene is lazy-loaded so TV-mode
 * phones (controls only) never download the renderer. The server sends the compact wire form
 * (net/wire.ts); every view below receives the decoded RaceView (memoized per snapshot object). */
import { lazy, Suspense, useEffect, useRef } from 'react';
import type { GameClientModule, SceneViewProps } from '../../../party-ui/src/index';
import { resolveViewMode, screenMode } from './views';
import type { Action, Input, RaceView, Settings } from './sim/types';
import { decodeRaceView, type RaceWire } from './net/wire';
import { KartAudio } from './audio/audio';
import { Controller } from './ui/Controller';
import { Lobby } from './ui/Lobby';
import { Results } from './ui/Results';
import { SettingsPanel } from './ui/Settings';
import { Instructions } from './ui/Instructions';
import './ui/kart.css';

type Wire = RaceWire | RaceView;
const Scene = lazy(() => import('./scene'));
/** Controls-only phones draw nothing: report ready after two frames (the platform's DOM-client barrier).
 * They still voice their own racer's hits, pickups, roulette and honks, quietly ('controller' audio). */
function ControlsOnly({ roundId, onReady, race, playerId, track }: { roundId: string; onReady(): void; race: RaceView | null; playerId: string | null; track: string }) {
  const ready = useRef(onReady); ready.current = onReady;
  const audio = useRef<KartAudio | null>(null);
  useEffect(() => {
    let second = 0; const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => ready.current()); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [roundId]);
  useEffect(() => { const a = audio.current = new KartAudio('controller', track); return () => { a.dispose(); audio.current = null; }; }, [roundId, track]);
  useEffect(() => { if (playerId) audio.current?.update(race, [playerId], [], 0); }, [race, playerId]);
  return null;
}
function SceneView(props: SceneViewProps<Settings, Wire, null>) {
  const publicView = decodeRaceView(props.publicView);
  const mode = publicView?.viewMode ?? resolveViewMode(props.settings.views, props.players.length);
  if (screenMode(mode, props.playerId, !!props.isHost) === 'controls')
    return <ControlsOnly roundId={props.roundId} onReady={props.onReady} race={publicView} playerId={props.playerId} track={props.settings.track}/>;
  return <Suspense fallback={null}><Scene {...props} publicView={publicView}/></Suspense>;
}

export const client: GameClientModule<Input, Action, Settings, Wire, null> = {
  immersivePhone: true, sceneRoles: ['display', 'controller'], SceneView,
  DisplayView: () => null, ControllerView: props => <Controller {...props} publicView={decodeRaceView(props.publicView)}/>, LobbyView: Lobby,
  settingsWide: true, SettingsView: SettingsPanel, InstructionsView: Instructions,
  ResultsView: props => <Results {...props} publicView={decodeRaceView(props.publicView)}/>,
  prepare() {}, dispose() {},
};
export default client;
