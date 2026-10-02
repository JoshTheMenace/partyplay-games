/* Hijinks GameClientModule: the TV stage and phone controller for every pack phase. */
import { useEffect } from 'react';
import type { GameClientModule } from '../../../party-ui/src/index';
import type { PackAction, PackPrivateView, PackPublicView, PackSettings } from './core/contract';
import { miniInfo } from './minis/catalog';
import { Enter, Stage } from './core/ui';
import { AudioView } from './core/audio/audio-view';
import { MenuController, MenuDisplay } from './core/client/menu';
import { IntroController, IntroDisplay } from './core/client/intro';
import { PodiumController, PodiumDisplay } from './core/client/podium';
import { MiniHost, preloadMini, resetMiniChunks } from './core/client/mini';
import { InstructionsView, LobbyView, ResultsView, SettingsView } from './core/client/lobby';
import { DEFAULT_ACCENT, type PackProps } from './core/client/shared';
import './styles.css';

const PHASE_NAMES = { menu: 'Game menu: vote for the next game.', intro: 'Up next: ', mini: 'Game on: ', podium: 'Final standings for ' } as const;

function DisplayView(ctx: PackProps) {
  const view = ctx.publicView, id = view.current?.id ?? '', props = { view, now: ctx.serverNowMs };
  useEffect(() => { if (view.phase === 'intro' && id) preloadMini(id); }, [view.phase, id]);
  return <Stage fill accent={view.phase === 'menu' ? DEFAULT_ACCENT : miniInfo(id)?.accent ?? DEFAULT_ACCENT}>
    <Enter k={`${view.phase}:${view.current?.session ?? 0}`} variant={view.phase === 'mini' ? 'zoom' : 'rise'} className="hj-fill">
      {view.phase === 'menu' ? <MenuDisplay {...props} /> : view.phase === 'intro' ? <IntroDisplay {...props} /> : view.phase === 'podium' ? <PodiumDisplay {...props} /> : <MiniHost ctx={ctx} role="display" />}
    </Enter>
  </Stage>;
}

function ControllerView(ctx: PackProps) {
  const view = ctx.publicView, me = view.players.find(p => p.id === ctx.playerId), id = view.current?.id ?? '';
  useEffect(() => { if (view.phase === 'intro' && id) preloadMini(id); }, [view.phase, id]);
  const props = me && { view, now: ctx.serverNowMs, me, send: (action: PackAction) => ctx.sendAction(action) };
  return <div className="hj-phone-root">
    <p className="hj-sr" aria-live="polite">{view.phase === 'menu' ? PHASE_NAMES.menu : `${PHASE_NAMES[view.phase]}${miniInfo(id)?.title ?? 'the next game'}.`}</p>
    {!props ? <p className="hj-note">You’re watching this round. You’ll get a seat after the host starts a new one.</p>
      : view.phase === 'menu' ? <MenuController {...props} vote={ctx.privateView?.vote ?? null} />
      : view.phase === 'intro' ? <IntroController {...props} />
      : view.phase === 'podium' ? <PodiumController {...props} />
      : <MiniHost ctx={ctx} role="controller" />}
  </div>;
}

export const client: GameClientModule<null, PackAction, PackSettings, PackPublicView, PackPrivateView> = {
  DisplayView, ControllerView, LobbyView, SettingsView, InstructionsView, ResultsView, AudioView,
  async prepare({ signal }) {
    const fonts = document.fonts ? Promise.all(['64px "Lilita One"', '600 24px Nunito', '900 24px Nunito'].map(font => document.fonts.load(font))).catch(() => undefined) : undefined;
    await Promise.race([fonts, new Promise(done => { const id = setTimeout(done, 2500); signal.addEventListener('abort', () => { clearTimeout(id); done(undefined); }); })]);
  },
  dispose() { resetMiniChunks(); },
};
export default client;
