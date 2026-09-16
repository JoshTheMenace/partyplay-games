import type { ComponentType } from 'react';
import type { RoomPhase, RosterPlayer } from '../../party-contract/src/protocol';
import type { ActionResult, GameClientContext, Outcome } from '../../party-contract/src/index';
export * from './primitives';
export * from './drawing';
export * from './action-controls';
export type GameViewProps<Input, Action, PublicView, PrivateView> = GameClientContext<Input, Action, PublicView, PrivateView>;
export type SettingsViewProps<Settings> = { settings: Settings; onChange(settings: Settings): void; disabled: boolean };
export type InstructionsViewProps = { role: 'display' | 'controller' | 'personal' };
export type ResultsViewProps<PublicView = unknown> = { outcome: Outcome; publicView: PublicView; playerId: string | null; isHost?: boolean };
export type PrepareContext = { role: 'display' | 'controller' | 'personal'; signal: AbortSignal; assetBase: string };
/** Mounted before round.ready and retained through play. No secret/server state exists during preparation. */
export type SceneViewProps<Settings, PublicView, PrivateView = unknown> = {
  roundId: string; phase: 'preparing' | 'playing' | 'results'; settings: Settings;
  playerId: string | null; viewRole: 'display' | 'controller'; isHost?: boolean; connected: boolean;
  privateView: PrivateView | null; setInput(input: unknown): void; releaseInput(): void; sendAction(action: unknown): Promise<ActionResult>;
  players: readonly { id: string; name: string; color: string }[];
  publicView: PublicView | null; snapshotTime: number | null; signal: AbortSignal;
  serverNowMs(): number; onReady(): void; onError(error: unknown): void;
};
/** Optional nonvisual audio owner, retained from lobby through results. Never receives private state. */
export type GameAudioProps<PublicView> = { phase: RoomPhase; roundId: string | null; publicView: PublicView | null; connected: boolean; viewRole: 'display' | 'controller'; isHost: boolean; serverNowMs(): number };
export type LobbyViewProps<Settings> = { roomId: string; lobbyId: string; players: RosterPlayer[]; playerId: string | null; isHost: boolean; settings: Settings; connected: boolean; error?: string | null; onChoice(choice: unknown): void; onReady(ready: boolean): void };
export type GameClientModule<Input, Action, Settings, PublicView, PrivateView> = {
  immersivePhone?: boolean;
  LobbyView?: ComponentType<LobbyViewProps<Settings>>;
  AudioView?: ComponentType<GameAudioProps<PublicView>>;
  /** Allow portrait menus in a landscape game. The shell still releases input when the gate returns. */
  allowPortraitController?(view: PublicView | null): boolean;
  sceneRoles?: readonly ('display' | 'controller')[];
  SceneView?: ComponentType<SceneViewProps<Settings, PublicView, PrivateView>>;
  DisplayView: ComponentType<GameViewProps<Input, Action, PublicView, PrivateView>>;
  ControllerView: ComponentType<GameViewProps<Input, Action, PublicView, PrivateView>>;
  PersonalView?: ComponentType<GameViewProps<Input, Action, PublicView, PrivateView>>;
  settingsWide?: boolean;
  SettingsView: ComponentType<SettingsViewProps<Settings>>;
  InstructionsView: ComponentType<InstructionsViewProps>;
  ResultsView?: ComponentType<ResultsViewProps<PublicView>>;
  prepare(ctx: PrepareContext): void | Promise<void>;
  dispose(): void;
};
