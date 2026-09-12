import { useState } from 'react';
import { Menu, Play, Users, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GameClient } from '../client-types';
import { ArcadeButton, Eyebrow, Panel } from './primitives';
import { Modal } from './Modal';

export function isRoomHost(game: GameClient) {
  return Boolean(game.room && game.room.host === game.playerId && game.mode !== 'solo');
}

/** Host-only race menu for online rooms. The simulation keeps running while it is open; ending the race takes a second, explicit button. */
export function RaceMenu({ game, className }: { game: GameClient; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!isRoomHost(game)) return null;
  return (
    <>
      <button
        type="button"
        className={cn(
          'flex h-10 items-center gap-1.5 rounded-full border-2 border-kp-cream/30 bg-kp-ink/60 px-3 text-sm font-black uppercase tracking-wider text-kp-cream transition hover:bg-kp-ink/90',
          className,
        )}
        onClick={(event) => {
          event.currentTarget.blur();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Menu className="size-4" strokeWidth={2.5} /> Menu
      </button>
      {open ? (
        <Modal label="Race menu" onClose={() => setOpen(false)} initialFocus="[data-autofocus]">
          <Panel className="kp-anim-pop flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Eyebrow>Host</Eyebrow>
                <h2 className="kp-display mt-1 text-2xl text-kp-cream">Race menu</h2>
                <p className="mt-1 text-sm font-bold text-kp-cream/65">The race keeps running while this is open.</p>
              </div>
              <button type="button" className="rounded-full p-2 text-kp-cream/80 transition hover:bg-kp-cream/10 hover:text-kp-cream" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <ArcadeButton tone="sun" size="lg" icon={<Play />} onClick={() => setOpen(false)} data-autofocus>
              Resume racing
            </ArcadeButton>
            <ArcadeButton tone="ghost" size="md" icon={<Users />} onClick={game.lobby} disabled={game.busy || !game.connected}>
              Return everyone to lobby
            </ArcadeButton>
            <p className="text-sm font-bold text-kp-cream/65">Ends this race for every racer. Results will not be kept.</p>
          </Panel>
        </Modal>
      ) : null}
    </>
  );
}
