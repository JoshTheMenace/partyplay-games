import { Home, RotateCcw, Trophy, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GameClient } from '../client-types';
import type { Race, Racer } from '../types';
import { TRACKS } from '../tracks';
import { ArcadeButton, DriverAvatar, Eyebrow, Logo, Panel, Spinner } from './primitives';
import { DIFFICULTY_LABEL, driverOf, formatGap, formatTime, ordinal, ordinalSuffix, standings, speedLabel } from './format';

const PODIUM_HEIGHT = ['h-32 sm:h-40', 'h-24 sm:h-30', 'h-16 sm:h-22'];
const PODIUM_ORDER = [1, 0, 2];

function Podium({ order, playerId }: { order: Racer[]; playerId: string }) {
  const top = PODIUM_ORDER.map((i) => order[i]).filter((r): r is Racer => Boolean(r));
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4">
      {top.map((racer) => {
        const place = order.indexOf(racer);
        const d = driverOf(racer.driver);
        return (
          <div key={racer.id} className={cn('kp-anim-up flex w-24 flex-col items-center sm:w-32', place === 0 ? 'kp-delay-2' : place === 1 ? 'kp-delay-1' : 'kp-delay-3')}>
            <DriverAvatar driver={racer.driver} size={place === 0 ? 84 : 64} className={cn(place === 0 && 'kp-anim-pulse')} />
            <span className="kp-display mt-1 max-w-full truncate text-base" style={{ color: d.color }}>
              {racer.name}
            </span>
            {racer.id === playerId ? <span className="rounded-full bg-kp-cream/15 px-2 text-xs font-black uppercase tracking-wider">You</span> : null}
            <div
              className={cn('mt-2 flex w-full flex-col items-center justify-start rounded-t-2xl border-[3px] border-b-0 border-kp-ink pt-2', PODIUM_HEIGHT[place])}
              style={{ background: `linear-gradient(180deg, ${d.color}, ${d.color}88)` }}
            >
              <span className="kp-title text-4xl text-kp-cream">{place + 1}</span>
              <span className="kp-numeral text-xs text-kp-ink/80">{racer.finishTime != null ? formatTime(racer.finishTime) : 'DNF'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StandingsTable({ race, order, playerId }: { race: Race; order: Racer[]; playerId: string }) {
  const leader = order[0]?.finishTime ?? null;
  return (
    <ol className="flex flex-col gap-1.5">
      {order.map((racer, i) => {
        const d = driverOf(racer.driver);
        const you = racer.id === playerId;
        const dnf = racer.finishTime == null;
        return (
          <li
            key={racer.id}
            className={cn(
              'kp-anim-in flex items-center gap-3 rounded-2xl border-[3px] px-3 py-2',
              you ? 'border-kp-sun bg-kp-sun/10' : 'border-kp-cream/10 bg-kp-ink/40',
              dnf && 'opacity-70',
            )}
            style={{ animationDelay: `${120 + i * 60}ms` }}
          >
            <span className="kp-numeral w-10 text-right text-2xl text-kp-sun">
              {i + 1}
              <span className="text-xs text-kp-cream/60">{ordinalSuffix(i + 1)}</span>
            </span>
            <DriverAvatar driver={racer.driver} size={36} />
            <span className="min-w-0 flex-1">
              <span className="kp-display block truncate text-base" style={{ color: d.color }}>
                {racer.name}
                {racer.bot ? <span className="ml-2 text-xs tracking-widest text-kp-cream/50">CPU</span> : null}
                {you ? <span className="ml-2 text-xs tracking-widest text-kp-sun">You</span> : null}
              </span>
              <span className="block text-xs font-bold text-kp-cream/55">
                {dnf ? (race.phase === 'results' ? 'Did not finish' : `Lap ${Math.min(race.laps, racer.lap)}`) : i === 0 ? 'Winner' : leader != null && racer.finishTime != null ? formatGap(racer.finishTime - leader) : ''}
              </span>
            </span>
            <span className="kp-numeral text-lg text-kp-cream">{dnf ? 'DNF' : formatTime(racer.finishTime)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ResultsScreen({ game }: { game: GameClient }) {
  const race = game.race;
  if (!race) {
    return (
      <div className="kp-layer flex items-center justify-center">
        <Panel className="flex items-center gap-3 px-6 py-4">
          <Spinner />
          <span className="kp-display text-lg tracking-wider">Fetching results</span>
        </Panel>
      </div>
    );
  }
  const order = standings(race);
  const me = order.find((r) => r.id === game.playerId);
  const myPlace = me ? order.indexOf(me) + 1 : null;
  const track = TRACKS[race.track];
  const isSolo = game.mode === 'solo';
  const isHost = Boolean(game.room && game.room.host === game.playerId);
  const controlsRematch = isSolo || isHost;
  const isController = game.mode === 'controller';
  const pending = race.phase !== 'results';

  return (
    <div className="kp-layer kp-scroll">
      <div className="kp-vignette pointer-events-none absolute inset-0" />
      <div className={cn('relative mx-auto flex min-h-full w-full flex-col gap-5 px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-[max(1.25rem,var(--safe-top))]', isController ? 'max-w-md' : 'max-w-5xl')}>
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <div className="text-right">
            <Eyebrow>{pending ? 'Race in progress' : 'Final results'}</Eyebrow>
            <span className="kp-display block text-lg" style={{ color: track.color }}>{track.name}</span>
            <span className="block text-xs font-bold text-kp-cream/55">{race.laps} {race.laps === 1 ? 'lap' : 'laps'} · {speedLabel(race.speedClass)} · {DIFFICULTY_LABEL[race.difficulty].title}</span>
          </div>
        </div>

        {!me && isHost ? (
          <p className="text-center text-sm font-bold text-kp-cream/60">This screen hosted the race. Pick a rematch or head back to the lobby for everyone.</p>
        ) : null}
        {me && myPlace ? (
          <div className="kp-anim-pop flex flex-col items-center text-center">
            <Trophy className={cn('size-10', myPlace === 1 ? 'text-kp-sun' : 'text-kp-cream/40')} />
            <span className="kp-title mt-1 text-[clamp(4rem,14vw,8rem)] text-kp-sun">{ordinal(myPlace)}</span>
            <span className="kp-display text-lg text-kp-cream/80">
              {me.finishTime != null ? formatTime(me.finishTime) : 'Did not finish'}
            </span>
          </div>
        ) : null}

        <div className={cn('grid gap-5', isController ? 'grid-cols-1' : 'md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-start')}>
          {!isController ? (
            <Panel className="kp-anim-up p-5">
              <Eyebrow className="mb-4">Podium</Eyebrow>
              <Podium order={order} playerId={game.playerId} />
              <div className="kp-checker mt-0 h-3 rounded-b-xl" />
            </Panel>
          ) : null}
          <Panel className="kp-anim-up kp-delay-1 p-4 sm:p-5">
            <Eyebrow className="mb-3">Standings</Eyebrow>
            <StandingsTable race={race} order={order} playerId={game.playerId} />
          </Panel>
        </div>

        <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:justify-center">
          {controlsRematch ? (
            <ArcadeButton tone="sun" size="xl" icon={game.busy ? <Spinner /> : <RotateCcw />} onClick={game.rematch} disabled={game.busy}>
              Rematch
            </ArcadeButton>
          ) : (
            <p className="flex items-center justify-center gap-2 text-sm font-bold text-kp-cream/60">
              <Spinner className="size-4" /> Waiting for the host to pick the next race
            </p>
          )}
          {isSolo ? (
            <ArcadeButton tone="ghost" size="lg" icon={<Home />} onClick={game.leave} disabled={game.busy}>
              Back to menu
            </ArcadeButton>
          ) : (
            <>
              {isHost ? (
                <ArcadeButton tone="sky" size="lg" icon={<Users />} onClick={game.lobby} disabled={game.busy}>
                  Back to lobby
                </ArcadeButton>
              ) : null}
              <ArcadeButton tone="ghost" size="lg" icon={<Home />} onClick={game.leave} disabled={game.busy}>
                {isHost ? 'Close room' : 'Leave'}
              </ArcadeButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
