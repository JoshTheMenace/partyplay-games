import { ArrowLeft, Gamepad2, Tv } from 'lucide-react';
import type { GameClient } from '../client-types';
import { DRIVERS } from '../types';
import { ArcadeButton, DriverChip, Eyebrow, Logo, Panel, Spinner } from './primitives';
import { ROOM_CODE_LENGTH, normalizeCode } from './format';

/** watch is being added to GameClient by the root: joins the room as a seatless display. */
type JoinClient = GameClient & { watch?: () => void };

export function JoinScreen({ game }: { game: JoinClient }) {
  const codeReady = game.joinCode.trim().length === ROOM_CODE_LENGTH;
  const canJoin = codeReady && !game.busy;
  const watch = typeof game.watch === 'function' ? game.watch : undefined;
  return (
    <div className="kp-layer kp-scroll">
      <div className="kp-vignette pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-5 px-5 pb-10 pt-[max(1.5rem,var(--safe-top))]">
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border-2 border-kp-cream/20 bg-kp-ink/50 px-4 py-2 text-xs font-black uppercase tracking-widest text-kp-cream/80 transition hover:border-kp-cream/50"
            onClick={game.leave}
            disabled={game.busy}
          >
            <ArrowLeft className="size-4" /> Back
          </button>
        </div>
        <Panel className="kp-anim-up p-5 sm:p-6">
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (canJoin) game.join();
            }}
          >
            <div>
              <Eyebrow>Join a party</Eyebrow>
              <h2 className="kp-display mt-1 text-3xl text-kp-cream">Enter the room code</h2>
              <p className="mt-1 text-sm font-bold text-kp-cream/60">It is on the host screen, next to the QR code.</p>
            </div>
            <label className="flex flex-col gap-2">
              <span className="kp-display text-xs tracking-[0.2em] text-kp-cream/70">Room code</span>
              <input
                className="kp-input kp-numeral text-center text-4xl tracking-[0.35em] uppercase"
                value={game.joinCode}
                onChange={(event) => game.setJoinCode(normalizeCode(event.target.value))}
                placeholder="ABC123"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(game.error) || undefined}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="kp-display text-xs tracking-[0.2em] text-kp-cream/70">Your name</span>
              <input
                className="kp-input"
                value={game.name}
                maxLength={16}
                placeholder={DRIVERS[game.driver]?.name ?? 'Racer'}
                onChange={(event) => game.setName(event.target.value)}
                spellCheck={false}
              />
            </label>
            <div>
              <span className="kp-display mb-2 block text-xs tracking-[0.2em] text-kp-cream/70">Driver</span>
              <div className="grid grid-cols-4 gap-2">
                {DRIVERS.map((_, index) => (
                  <DriverChip key={index} driver={index} selected={game.driver === index} onSelect={game.setDriver} compact />
                ))}
              </div>
            </div>
            <ArcadeButton type="submit" tone="sky" size="lg" icon={game.busy ? <Spinner /> : <Gamepad2 />} disabled={!canJoin}>
              {game.busy ? 'Connecting' : 'Join race'}
            </ArcadeButton>
            {watch ? (
              <div className="flex flex-col gap-2 border-t-2 border-kp-cream/10 pt-4">
                <ArcadeButton type="button" tone="ghost" size="md" icon={<Tv />} onClick={watch} disabled={!canJoin}>
                  Watch on this screen
                </ArcadeButton>
                <p className="text-center text-sm font-bold text-kp-cream/55">Shows the race on a TV or spare laptop without taking a seat.</p>
              </div>
            ) : null}
          </form>
        </Panel>
      </div>
    </div>
  );
}
