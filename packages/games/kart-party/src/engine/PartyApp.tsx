import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useGame } from './useGame';
import type { GameClient, GameView } from './client-types';
import { MenuScreen } from './ui/MenuScreen';
import { JoinScreen } from './ui/JoinScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { RaceHud } from './ui/RaceHud';
import { Controller } from './ui/Controller';
import { ResultsScreen } from './ui/ResultsScreen';
import { SystemOverlays } from './ui/SystemOverlays';
import { useCoarsePointer } from './ui/useCoarsePointer';
import { RotatePrompt, useOrientation } from './ui/orientation';

/** `controllerKey` changes when the rotate prompt appears or clears. The controller stays mounted behind the prompt otherwise,
 *  so remounting it is what discards held-button visuals and pointer state. useGame and the renderer live above this and are untouched. */
function Screen({ game, controllerKey }: { game: GameClient; controllerKey: string }) {
  const phone = game.mode === 'controller';
  switch (game.view) {
    case 'menu':
      return <MenuScreen game={game} />;
    case 'join':
      return <JoinScreen game={game} />;
    case 'lobby':
      return <LobbyScreen game={game} />;
    case 'race':
      return phone ? <Controller key={controllerKey} game={game} /> : <RaceHud game={game} />;
    case 'results':
      return <ResultsScreen game={game} />;
  }
}

/** Three.js mount point. Isolated so the ref attaches to a plain prop rather than to a field on the client object. */
function Stage({ canvasRef, quality, view, mode, touch }: { canvasRef: RefObject<HTMLDivElement | null>; quality: string; view: GameView; mode: string; touch?: 'strip' | 'side' }) {
  // data-touch="true" shortens the stage to end at the bottom touch strip (see .kp-stage in globals.css).
  // data-touch="side" keeps the full stage: landscape phones put the controls beside the road, not under it.
  return <div ref={canvasRef} className="kp-stage" aria-hidden="true" data-quality={quality} data-view={view} data-mode={mode} data-touch={touch === 'strip' ? 'true' : touch} />;
}

/** Keyboard driving, pause keys, and focus handling live in useGame. This component only owns the hook and routes screens. */
export function PartyApp() {
  const game = useGame();
  const coarse = useCoarsePointer();
  const orientation = useOrientation();
  const driving = game.view === 'race';
  const touchRace = driving && game.mode === 'solo' && coarse;
  // Phones race sideways. Upright, the race input is blocked and a rotate prompt covers the controls.
  const racingPhone = driving && orientation.phone && (game.mode === 'solo' || game.mode === 'controller');
  const blocked = racingPhone && orientation.portrait;
  const stageTouch = touchRace ? (orientation.phone && !orientation.portrait ? 'side' : 'strip') : undefined;

  // The client object is rebuilt every render, so the effects read the latest functions through refs.
  const client = useRef(game);
  useLayoutEffect(() => {
    client.current = game;
  });
  useEffect(() => {
    if (!racingPhone) return;
    client.current.setControlsEnabled(!blocked);
    return () => client.current.setControlsEnabled(true);
  }, [racingPhone, blocked]);
  // Solo pauses while upright. Resuming is left to the player through the pause menu once they have turned.
  const soloShouldPause = blocked && game.mode === 'solo' && !game.paused && game.race != null && game.race.phase !== 'results';
  useEffect(() => {
    if (soloShouldPause) client.current.togglePause();
  }, [soloShouldPause]);

  return (
    <>
      <Stage canvasRef={game.canvasRef} quality={game.quality} view={game.view} mode={game.mode} touch={stageTouch} />
      <div className={driving ? 'kp-touch' : undefined}>
        <Screen game={game} controllerKey={blocked ? 'portrait' : 'landscape'} />
      </div>
      <SystemOverlays game={game} />
      {blocked ? <RotatePrompt mode={game.mode} connected={game.connected} /> : null}
    </>
  );
}

export default PartyApp;
