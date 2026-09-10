import { AlertTriangle, Info, Volume2, WifiOff, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GameClient } from '../client-types';
import { ArcadeButton, Spinner } from './primitives';

/** Error toast, notice toast, reconnect banner, and busy indicator. Rendered above every screen. */
export function SystemOverlays({ game }: { game: GameClient }) {
  const online = game.mode !== 'solo';
  const inRoom = game.view === 'lobby' || game.view === 'race' || game.view === 'results';
  const disconnected = online && inRoom && !game.connected;
  // A display opened from a ?display= link has had no click yet, so the browser will not play sound until one lands here.
  // Controllers stay silent on purpose; solo and host screens unlock on their own first click.
  const needsSoundGesture = game.mode === 'display' && !game.audioUnlocked && !game.muted;
  return (
    <>
      {needsSoundGesture ? (
        <div
          className={cn(
            'pointer-events-none fixed z-40 flex',
            // In the race the top edge of the first viewport, left of center, is clear of every rank block and item slot.
            game.view === 'race' ? 'left-1/4 top-[max(0.75rem,var(--safe-top))] -translate-x-1/2' : 'inset-x-0 bottom-[max(1rem,var(--safe-bottom))] justify-center px-4',
          )}
        >
          <button
            type="button"
            className="kp-panel kp-anim-pop pointer-events-auto flex min-h-11 items-center gap-2 rounded-full py-2 pl-3 pr-4 text-kp-cream transition hover:border-kp-cream/40 hover:bg-kp-cream/10"
            onClick={game.enableAudio}
            aria-label="Enable sound"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-kp-sun text-kp-ink">
              <Volume2 className="size-4" strokeWidth={2.5} />
            </span>
            <span className="kp-display text-sm tracking-wider">Enable sound</span>
          </button>
        </div>
      ) : null}

      {disconnected && game.mode !== 'controller' ? (
        <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,var(--safe-top))] z-40 flex justify-center">
          <div className="kp-panel pointer-events-auto flex items-center gap-3 rounded-full py-2 pl-3 pr-2">
            <WifiOff className="size-5 text-kp-coral" />
            <span className="kp-display text-sm tracking-wider text-kp-cream">Connection lost. Reconnecting</span>
            <Spinner className="size-4" />
            <ArcadeButton tone="ghost" size="sm" onClick={game.leave}>
              Leave
            </ArcadeButton>
          </div>
        </div>
      ) : null}

      {game.error ? (
        <div className="fixed inset-x-0 bottom-[max(1rem,var(--safe-bottom))] z-50 flex justify-center px-4">
          <div role="alert" className="kp-anim-up flex w-full max-w-md items-center gap-3 rounded-2xl border-[3px] border-kp-ink bg-kp-coral px-4 py-3 text-kp-ink shadow-[0_8px_0_#05071a]">
            <AlertTriangle className="size-6 shrink-0" strokeWidth={2.5} />
            <span className="flex-1 text-sm font-black">{game.error}</span>
            <button type="button" onClick={game.dismissError} className="rounded-full p-1.5 transition hover:bg-kp-ink/10" aria-label="Dismiss error">
              <X className="size-5" strokeWidth={3} />
            </button>
          </div>
        </div>
      ) : null}

      {game.notice && !game.error ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,var(--safe-bottom))] z-50 flex justify-center px-4">
          <output className="kp-anim-up flex w-full max-w-md items-center gap-3 rounded-2xl border-[3px] border-kp-ink bg-kp-sky px-4 py-3 text-kp-ink shadow-[0_8px_0_#05071a]">
            <Info className="size-6 shrink-0" strokeWidth={2.5} />
            <span className="flex-1 text-sm font-black">{game.notice}</span>
          </output>
        </div>
      ) : null}

      {game.busy && game.view !== 'race' ? (
        <div className="pointer-events-none fixed right-[max(1rem,var(--safe-right))] top-[max(1rem,var(--safe-top))] z-40">
          <Spinner className="size-6" />
        </div>
      ) : null}
    </>
  );
}
