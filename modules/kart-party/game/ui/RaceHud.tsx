import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Coins, Pause, Play, LogOut, Flag, Timer } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GameClient } from '../client-types';
import type { Race, RaceEvent, Racer } from '../types';
import { MAX_PLAYERS } from '../types';
import { splitLayout } from '../split-screen';
import { TRACKS } from '../tracks';
import { Minimap } from './Minimap';
import { ArcadeButton, DriverAvatar, Eyebrow, Keycap, Logo, Panel } from './primitives';
import { DRIFT_FULL, DRIFT_TIER_COLOR, ITEM_COLOR, ITEM_LABEL, displayLap, driftTier, driverOf, humanRacers, ordinalSuffix, speedLabel, speedReadout, wrongWay } from './format';
import { TouchControls } from './Controller';
import { RaceMenu } from './RaceMenu';
import { Modal } from './Modal';
import { HowToPlayButton } from './HowToPlay';
import { ItemIcon, StatusBadges } from './items';
import { useCoarsePointer } from './useCoarsePointer';
import { useOrientation } from './orientation';
import { raceTimeRemaining } from '../race-timing';
import { itemRoulette } from '../item-roulette';

export { ItemIcon } from './items';

// Boost has no banner: the drift meter, screen glow, and audio already say it, and the text hid the road.
const EVENT_TEXT: Record<string, string> = {
  hit: 'Ouch!',
  item: 'Item get',
  coin: 'Coin',
  finish: 'Finish!',
};

/** Literal Tailwind classes for the shared split layout. The renderer scissors the same grid from game/split-screen.ts:
 *  1 = 1x1, 2 = 1x2, 3 and 4 = 2x2, 5 and 6 = 3x2, 7 to 9 = 3x3, 10 = 4x3, row-major. Unused cells stay dark in the
 *  renderer; the HUD fills the first one with standings (the three-player overhead view keeps its cell as before). */
const COLUMN_CLASS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4'] as const;
const ROW_CLASS = ['', 'grid-rows-1', 'grid-rows-2', 'grid-rows-3'] as const;
export function viewportGridClass(count: number) {
  const { columns, rows } = splitLayout(count);
  return `${COLUMN_CLASS[Math.min(4, Math.max(1, columns))]} ${ROW_CLASS[Math.min(3, Math.max(1, rows))]}`;
}

/** HUD density per human count: full (solo), compact (2 to 4), dense (5 to 10: name, rank, lap, item only). */
type Density = 'full' | 'compact' | 'dense';
function densityFor(count: number): Density {
  return count <= 1 ? 'full' : count <= 4 ? 'compact' : 'dense';
}

export function Countdown({ race }: { race: Race }) {
  if (race.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(race.countdown));
    if (n > 3) {
      return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="kp-display kp-anim-pop text-[clamp(2rem,6vw,4rem)] tracking-[0.2em] text-kp-cream">Get ready</span>
        </div>
      );
    }
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span key={n} className="kp-title kp-anim-countdown text-[clamp(6rem,22vw,16rem)] text-kp-sun">
          {n}
        </span>
      </div>
    );
  }
  if (race.phase === 'racing' && race.time < 1.1) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="kp-title kp-anim-countdown text-[clamp(6rem,24vw,18rem)] text-kp-lime">Go!</span>
      </div>
    );
  }
  return null;
}

function DriftMeter({ racer, compact }: { racer: Racer; compact?: boolean }) {
  const tier = driftTier(racer);
  const ratio = Math.min(1, racer.drift / DRIFT_FULL);
  const active = racer.drift > 0 || racer.boost > 0;
  return (
    <div className={cn('flex items-center gap-2', compact ? 'w-32' : 'w-44')}>
      <span className={cn('kp-display kp-hud-text text-sm tracking-[0.15em]', active ? 'text-kp-cream' : 'text-kp-cream/50')}>
        {racer.boost > 0 ? 'Turbo' : 'Drift'}
      </span>
      <div className={cn('kp-meter flex-1', compact ? 'h-2.5' : 'h-3.5')}>
        <i
          style={{
            width: `${racer.boost > 0 ? 100 : ratio * 100}%`,
            background: racer.boost > 0 ? 'linear-gradient(90deg,#ffd24a,#ff5748)' : DRIFT_TIER_COLOR[tier],
            boxShadow: tier >= 2 || racer.boost > 0 ? `0 0 12px ${DRIFT_TIER_COLOR[tier]}` : undefined,
          }}
        />
      </div>
    </div>
  );
}

function ItemSlot({ race, racer, size }: { race:Race; racer: Racer; size: number }) {
  const roulette=itemRoulette(race,racer),item=roulette.item;
  return (
    <div
      key={item ?? 'empty'}
      className={cn(
        'relative flex items-center justify-center rounded-2xl border-[3px] border-kp-ink bg-kp-navy/80 shadow-[0_6px_0_rgba(5,7,26,0.8)]',
        item && 'kp-anim-pop',roulette.active&&'kp-item-roulette',
      )}
      style={{ width: size, height: size, borderColor: item ? ITEM_COLOR[item] : undefined, boxShadow: item ? `0 6px 0 rgba(5,7,26,0.8), 0 0 24px ${ITEM_COLOR[item]}66` : undefined }}
      aria-label={roulette.active?'Choosing item':item ? `Holding ${ITEM_LABEL[item]}` : 'No item'}
    >
      {item ? (
        <span className="p-[22%]" style={{ color: ITEM_COLOR[item] }}>
          <ItemIcon item={item} />
        </span>
      ) : (
        <span className="kp-display text-sm tracking-[0.2em] text-kp-cream/65">Item</span>
      )}
    </div>
  );
}

/** Lap banners stay up a little longer than hit or item flashes so a glance at the TV or phone still catches them. */
const BANNER_SECONDS: Partial<Record<RaceEvent['type'], number>> = { lap: 2.4, finish: 2.4 };
const BANNER_DEFAULT_SECONDS = 1.5;
const BANNER_MAX_SECONDS = 2.4;
/** Finish beats lap, lap beats hit and item. Within one rank the newest event wins. */
const BANNER_PRIORITY: Partial<Record<RaceEvent['type'], number>> = { finish: 3, lap: 2, hit: 1, item: 1 };
const bannerSeconds = (type: RaceEvent['type']) => BANNER_SECONDS[type] ?? BANNER_DEFAULT_SECONDS;

/** Highest-priority live event for this racer. Lap banners come only from the simulation's `lap` event, never from snapshot deltas.
 *  Expired newer events are skipped rather than ending the search, so a fresh hit cannot hide a lap banner that is still live. */
export function EventBanner({ race, racer, compact, className }: { race: Race; racer: Racer; compact?: boolean; className?: string }) {
  const event = useMemo(() => {
    let best: RaceEvent | null = null;
    for (let i = race.events.length - 1; i >= 0; i--) {
      const e = race.events[i];
      const age = race.time - e.time;
      if (age > BANNER_MAX_SECONDS) break;
      if (e.racer !== racer.id) continue;
      const priority = BANNER_PRIORITY[e.type];
      if (priority == null || age > bannerSeconds(e.type)) continue;
      if (!best || priority > (BANNER_PRIORITY[best.type] ?? 0)) best = e;
    }
    return best;
  }, [race.events, race.time, racer.id]);
  if (!event) return null;
  const color = event.type === 'hit' ? 'text-kp-coral' : event.type === 'finish' || event.type === 'lap' ? 'text-kp-sun' : 'text-kp-grape';
  // event.lap is the lap just completed. The line under it announces the final lap when the next one is the last.
  const lapDone = event.type === 'lap' ? event.lap : undefined;
  const text = event.type === 'lap' ? (lapDone != null ? `Lap ${lapDone} complete` : 'Lap complete') : (EVENT_TEXT[event.type] ?? event.type);
  const sub = event.type === 'lap' && lapDone != null && lapDone === race.laps - 1 ? 'Final lap next' : null;
  return (
    <span
      key={event.id}
      className={cn('kp-anim-banner absolute left-1/2 flex flex-col items-center', compact ? 'top-[22%]' : 'top-[28%]', className)}
      // The keyframes fade out at 100%, so the animation must run exactly as long as the event is considered live.
      style={{ animationDuration: `${Math.round(bannerSeconds(event.type) * 1000)}ms` }}
    >
      <span className={cn('kp-title whitespace-nowrap', compact ? 'text-[clamp(1.5rem,7vmin,2.5rem)]' : 'text-[clamp(2rem,6vw,4.5rem)]', color)}>{text}</span>
      {sub ? <span className={cn('kp-display mt-1 rounded-full bg-kp-coral px-3 py-1 tracking-[0.2em] text-kp-ink', compact ? 'text-xs' : 'text-sm sm:text-base')}>{sub}</span> : null}
    </span>
  );
}

function WrongWay({ race, racer }: { race: Race; racer: Racer }) {
  if (!wrongWay(race, racer)) return null;
  return (
    <span className="kp-display kp-anim-blink absolute left-1/2 top-[18%] -translate-x-1/2 rounded-full bg-kp-coral px-4 py-1.5 text-lg tracking-[0.2em] text-kp-ink">
      Wrong way
    </span>
  );
}

/** Seconds until the race is closed for anyone still driving. Only meaningful while racing. */
export const CUTOFF_WARNING_SECONDS = 30;
function cutoffSeconds(race: Race) {
  if (race.phase !== 'racing') return Infinity;
  const remaining = raceTimeRemaining(race);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : Infinity;
}

/** Plain-language finish countdown shown for the last 30 seconds before the cutoff. */
function CutoffPill({ seconds, className }: { seconds: number; className?: string }) {
  const n = Math.ceil(seconds);
  return (
    <output className={cn('kp-display kp-anim-blink inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-kp-sun px-3 py-1.5 text-sm tracking-[0.15em] text-kp-ink', className)}>
      <Timer className="size-3.5" strokeWidth={3} /> {n > 0 ? `Race ends in ${n} s` : 'Race over'}
    </output>
  );
}

export function ViewportHud({
  race,
  racer,
  compact,
  finishedLabel,
  touch,
  dense,
  side,
  corner,
}: {
  race: Race;
  racer: Racer;
  compact: boolean;
  finishedLabel?: boolean;
  /** Solo race with the touch strip on screen: bottom widgets lift above the strip and the map shrinks. */
  touch?: boolean;
  /** Five or more humans: only name, rank, lap, and item, in small type, so the road stays visible in a small cell. */
  dense?: boolean;
  /** Landscape phone: controls flank the road, so the top-right cluster shrinks to leave room for the keys below it. */
  side?: boolean;
  /** Extra control for the top-right cluster in touch mode, e.g. the pause button. */
  corner?: ReactNode;
}) {
  const d = driverOf(racer.driver);
  const lap = displayLap(racer, race);
  const finalLap = race.phase === 'racing' && racer.finishTime == null && racer.lap >= race.laps;
  const finished = racer.finishTime != null;
  const cutoff = cutoffSeconds(race);
  // Speed and drift: bottom-left on a laptop, but in touch mode they join the top-left column so the bottom band stays clear for the kart.
  const speedBlock = (
    <div className={cn('flex flex-col gap-1.5', touch && 'mt-1.5 flex-row items-center gap-3')}>
      <DriftMeter racer={racer} compact={compact || touch} />
      <span className="kp-hud-text flex items-end gap-1">
        <span className={cn('kp-numeral text-kp-cream', compact ? 'text-3xl' : touch ? 'text-2xl' : 'text-5xl')}>{speedReadout(racer)}</span>
        <span className={cn('kp-display text-kp-cream/80', touch ? 'mb-0.5 text-xs tracking-[0.1em]' : 'mb-1.5 text-sm tracking-[0.15em]')}>km/h</span>
      </span>
    </div>
  );
  const minimap = (
    <Minimap track={race.track} racers={race.racers} hazards={race.hazards} focusId={racer.id} size={compact ? 110 : side ? 64 : touch ? 72 : 170} className="opacity-90 drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)]" />
  );
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className={cn('absolute left-0 top-0 flex flex-col', dense ? 'right-14 p-1.5' : compact ? 'p-2.5' : 'p-4', touch && 'right-24')}>
      <div className={cn('flex items-start', dense ? 'gap-1.5' : 'gap-2')}>
        <div className="kp-hud-text flex items-end">
          <span className={cn('kp-title leading-none text-kp-cream', dense ? 'text-4xl' : compact ? 'text-6xl' : 'text-[clamp(4rem,9vw,7.5rem)]')}>{racer.rank}</span>
          <span className={cn('kp-display ml-0.5 text-kp-sun', dense ? 'mb-0.5 text-sm' : compact ? 'mb-1 text-xl' : 'mb-1 text-3xl')}>{ordinalSuffix(racer.rank)}</span>
        </div>
        <div className={cn('flex min-w-0 flex-col', dense ? 'mt-0.5 gap-0.5' : 'mt-1 gap-1')}>
          <span className={cn('kp-display kp-hud-text', dense ? 'text-xs' : compact ? 'text-sm' : 'text-lg', finalLap ? 'text-kp-coral' : 'text-kp-cream')}>
            {finished ? 'Finished' : finalLap ? 'Final lap' : `Lap ${lap}/${race.laps}`}
          </span>
          <span className={cn('flex items-center', dense ? 'gap-1' : 'gap-1.5')}>
            <DriverAvatar driver={racer.driver} size={dense ? 18 : compact ? 22 : 28} />
            <span className={cn('kp-display kp-hud-text min-w-0 truncate', dense || compact ? 'text-xs' : 'text-sm')} style={{ color: d.color }} title={racer.name}>
              {racer.name}
            </span>
            {!racer.connected && !racer.bot ? <span className="kp-anim-blink rounded-full bg-kp-coral px-2 text-xs font-black uppercase text-kp-ink">Away</span> : null}
          </span>
        </div>
      </div>
      {touch ? speedBlock : null}
      </div>

      {/* Touch mode is a grid so the corner control sits under the coins in portrait and beside the item in landscape. */}
      <div className={cn('absolute right-0 top-0 grid justify-items-end', dense ? 'gap-1 p-1.5' : compact ? 'gap-2 p-2.5' : 'gap-2 p-4', touch && 'landscape:grid-cols-[auto_auto] landscape:items-start')}>
        <div className={cn(touch && 'landscape:col-start-2 landscape:row-start-1')}>
          <ItemSlot race={race} racer={racer} size={dense ? 40 : compact ? 52 : side ? 60 : touch ? 72 : 84} />
        </div>
        {!dense ? <StatusBadges racer={racer} size={compact ? 22 : 30} showTime={!compact} className={cn(touch && 'landscape:col-span-2')} /> : null}
        {!dense ? (
          <span className={cn('kp-display kp-hud-text flex items-center gap-1 text-kp-sun', touch && 'landscape:col-span-2')} style={{ fontSize: compact ? '0.875rem' : '1.125rem' }}>
            <Coins className="size-[1em]" strokeWidth={3} /> {racer.coins}
          </span>
        ) : null}
        {corner ? <div className={cn(touch && 'landscape:col-start-1 landscape:row-start-1')}>{corner}</div> : null}
        {touch ? <div className="landscape:col-span-2">{minimap}</div> : null}
      </div>

      {/* Dense cells drop speed, drift, and the minimap: the road is the point of the cell and the standings cell carries the overview. */}
      {!touch && !dense ? <div className={cn('absolute bottom-0 left-0', compact ? 'p-2.5' : 'p-4')}>{speedBlock}</div> : null}
      {!touch && !dense ? <div className={cn('absolute bottom-0 right-0', compact ? 'p-2.5' : 'p-4')}>{minimap}</div> : null}

      {/* Split-screen: each cell warns its own driver at the top middle, clear of the rank block and item slot. */}
      {compact && !finished && cutoff <= CUTOFF_WARNING_SECONDS ? (
        <CutoffPill seconds={cutoff} className={cn('absolute left-1/2 -translate-x-1/2', dense ? 'bottom-1.5 px-2 py-1 text-xs' : 'top-2.5')} />
      ) : null}

      {racer.stun > 0 ? <div className="pointer-events-none absolute inset-0 bg-kp-coral/15" /> : null}
      {racer.boost > 0 ? <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_80px_rgba(255,210,74,0.35)]" /> : null}
      {racer.star > 0 ? <div className="pointer-events-none absolute inset-0 kp-anim-blink shadow-[inset_0_0_90px_rgba(255,241,138,0.45)]" /> : null}
      {racer.frost > 0 ? <div className="pointer-events-none absolute inset-0 bg-kp-sky/10 shadow-[inset_0_0_70px_rgba(164,239,255,0.45)]" /> : null}
      {racer.oil > 0 ? <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_70px_rgba(183,138,255,0.4)]" /> : null}
      <EventBanner race={race} racer={racer} compact={dense} />
      <WrongWay race={race} racer={racer} />
      {finished && finishedLabel ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className={cn('kp-title kp-anim-pop text-kp-sun', dense ? 'text-[clamp(1.75rem,4vw,3rem)]' : 'text-[clamp(2.5rem,7vw,5rem)]')}>{racer.rank}{ordinalSuffix(racer.rank)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Shared standings for a spare split cell. Dense splits get small type and two columns for grids past nine karts. */
function Standings({ race, dense }: { race: Race; dense?: boolean }) {
  const sorted = [...race.racers].sort((a, b) => a.rank - b.rank);
  const twoColumns = dense && sorted.length > 9;
  return (
    <div className={cn('flex h-full w-full flex-col justify-center', dense ? 'p-2' : 'p-4')}>
      <Panel className={cn('min-h-0 overflow-hidden', dense ? 'p-2' : 'p-3')}>
        <Eyebrow className={cn(dense ? 'mb-1' : 'mb-2')}>Standings</Eyebrow>
        <ol className={cn('grid gap-x-3', dense ? 'gap-y-0.5' : 'gap-y-1', twoColumns ? 'grid-cols-2' : 'grid-cols-1')}>
          {sorted.map((r) => (
            <li key={r.id} className={cn('flex items-center gap-2', dense ? 'text-xs' : 'text-sm')}>
              <span className={cn('kp-numeral text-right text-kp-sun', dense ? 'w-4' : 'w-6')}>{r.rank}</span>
              <DriverAvatar driver={r.driver} size={dense ? 16 : 20} />
              <span className="kp-display min-w-0 truncate" style={{ color: driverOf(r.driver).color }}>{r.name}</span>
              <span className={cn('ml-auto shrink-0 font-bold text-kp-cream/60', dense ? 'text-[0.65rem]' : 'text-xs')}>{r.finishTime != null ? 'Fin' : `L${displayLap(r, race)}`}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

/** Spare cell with nothing to show: the renderer leaves it dark, the HUD adds a quiet brand mark so it never looks broken. */
function EmptyCell() {
  return (
    <div className="flex h-full w-full items-center justify-center border border-kp-ink/60 bg-kp-ink/40">
      <Logo size="sm" className="opacity-30" />
    </div>
  );
}

/** Short landscape phones (375px tall) get a compact panel: no logo or keyboard hint, secondary actions side by side,
 *  and the panel scrolls inside the viewport if anything still does not fit. Resume stays first and focused. */
function PauseMenu({ game }: { game: GameClient }) {
  // The modal owns Escape while open and stops it before useGame's window listener, so this is the only toggle.
  return (
    <Modal label="Paused" onClose={game.togglePause} initialFocus="[data-autofocus]">
      <Panel className={cn('kp-anim-pop kp-scroll flex max-h-[calc(100dvh-1.5rem)] flex-col gap-3 overflow-y-auto p-6', `[@media(max-height:430px)]:gap-2 [@media(max-height:430px)]:p-4`)}>
        <div className="text-center">
          <Logo size="sm" className={cn('mx-auto', `[@media(max-height:430px)]:hidden`)} />
          <h2 className={cn('kp-display mt-3 text-3xl text-kp-cream', `[@media(max-height:430px)]:mt-0 [@media(max-height:430px)]:text-2xl`)}>Paused</h2>
        </div>
        <ArcadeButton tone="sun" size="lg" icon={<Play />} onClick={game.togglePause} data-autofocus>
          Resume
        </ArcadeButton>
        <div className={cn('flex flex-col gap-3', `[@media(max-height:430px)]:grid [@media(max-height:430px)]:grid-cols-2 [@media(max-height:430px)]:gap-2`)}>
          <HowToPlayButton tone="arcade" />
          <ArcadeButton tone="ghost" size="md" icon={<LogOut />} onClick={game.leave}>
            Quit to menu
          </ArcadeButton>
        </div>
        <p className={cn('text-center text-sm font-bold text-kp-cream/65', `[@media(max-height:430px)]:hidden`)}>
          <Keycap>Esc</Keycap> resumes. Arrows or WASD steer, <Keycap>Shift</Keycap> drifts, <Keycap>E</Keycap> fires.
        </p>
      </Panel>
    </Modal>
  );
}

export function RaceHud({ game }: { game: GameClient }) {
  const race = game.race;
  const touch = useCoarsePointer();
  const orientation = useOrientation();
  if (!race) {
    return (
      <div className="kp-layer flex items-center justify-center">
        <Panel className="flex items-center gap-3 px-6 py-4">
          <span className="kp-anim-spin size-5 rounded-full border-[3px] border-kp-cream/25 border-t-kp-sun" />
          <span className="kp-display text-lg tracking-wider">Loading the grid</span>
        </Panel>
      </div>
    );
  }
  const humans = humanRacers(race, game.mode, game.playerId);
  const count = Math.min(MAX_PLAYERS, Math.max(1, humans.length));
  const shown = humans.slice(0, MAX_PLAYERS);
  const density = densityFor(count);
  const compact = density !== 'full';
  const dense = density === 'dense';
  // Cells beyond the humans: the first hosts the standings, the rest a quiet placeholder. Three humans keep the overhead cell.
  const { columns, rows } = splitLayout(count);
  const spare = Math.max(0, columns * rows - shown.length);
  const soloPauseAllowed = game.mode === 'solo';
  const track = TRACKS[race.track];
  // Solo on a coarse pointer: the touch strip covers the bottom, so the HUD moves its widgets and the pause button.
  const soloTouch = soloPauseAllowed && touch && count === 1;
  // Landscape phone: steering pad bottom-left and keys bottom-right over a full-height road view. Upright phones are
  // covered by PartyApp's rotate prompt and paused, so the pause menu must not float above that prompt.
  const sideTouch = soloTouch && orientation.phone && !orientation.portrait;
  const rotateBlocked = soloTouch && orientation.phone && orientation.portrait;
  // Host menu for shared screens. In split screen it sits inside the first viewport's top-right cluster, under the item slot
  // and coins, so it never straddles a seam or covers another player's rank or minimap. RaceMenu renders nothing for non-hosts.
  const hostMenu = !soloPauseAllowed ? <RaceMenu game={game} /> : null;
  const cutoff = cutoffSeconds(race);
  const meFinished = humans.length > 0 && humans.every((r) => r.finishTime != null);
  const pauseButton = soloPauseAllowed ? (
    <button
      type="button"
      className={cn(
        'flex size-11 items-center justify-center rounded-full border-2 border-kp-cream/30 bg-kp-ink/60 text-kp-cream transition hover:bg-kp-ink/90',
        !soloTouch && 'absolute right-[max(0.75rem,var(--safe-right))] top-1/2 -translate-y-1/2',
      )}
      onClick={(event) => {
        // Keep focus off the button so useGame's keyboard handler keeps receiving arrow and Escape keys.
        event.currentTarget.blur();
        game.togglePause();
      }}
      aria-label={game.paused ? 'Resume' : 'Pause'}
    >
      {game.paused ? <Play className="size-5" /> : <Pause className="size-5" />}
    </button>
  ) : null;
  return (
    <div className="kp-layer">
      {/* Touch mode: the HUD grid ends where the strip begins, matching the shortened 3D stage. */}
      <div className={cn('grid w-full', soloTouch && !sideTouch ? 'h-[calc(100%-var(--kp-touch-strip))]' : 'h-full', viewportGridClass(count))}>
        {shown.map((racer, index) => (
          <div key={racer.id} className={cn('relative', compact && 'border border-kp-ink/60')}>
            <ViewportHud
              race={race}
              racer={racer}
              compact={compact}
              dense={dense}
              finishedLabel={humans.length > 1}
              touch={soloTouch}
              side={sideTouch}
              corner={soloTouch ? pauseButton : compact && index === 0 ? hostMenu : undefined}
            />
          </div>
        ))}
        {Array.from({ length: spare }, (_, i) => (i === 0 ? <Standings key="standings" race={race} dense={dense} /> : <EmptyCell key={`spare-${i}`} />))}
      </div>

      {/* Touch mode: the pill tucks under the rank block on the left; centered it would sit on top of the lap text at 320px.
          Split-screen: hidden, since it would straddle the seam over one player's item slot and another's rank. */}
      {!compact ? (
      <div
        className={cn(
          'pointer-events-none absolute flex flex-wrap items-center gap-2',
          soloTouch ? 'left-[max(0.75rem,var(--safe-left))] right-24 top-[calc(max(0.5rem,var(--safe-top))+7.75rem)]' : 'left-1/2 top-[max(0.5rem,var(--safe-top))] -translate-x-1/2',
        )}
      >
        <span className="kp-display whitespace-nowrap rounded-full bg-kp-ink/60 px-4 py-1.5 text-sm tracking-[0.2em] text-kp-cream/80" style={{ color: track.color }}>
          {track.name}
          <span className="ml-2 text-kp-cream/70">{speedLabel(race.speedClass)}</span>
        </span>
        {!meFinished && cutoff <= CUTOFF_WARNING_SECONDS ? (
          <CutoffPill seconds={cutoff} />
        ) : race.phase === 'racing' && race.firstFinish != null ? (
          <span className="kp-display whitespace-nowrap rounded-full bg-kp-sun px-4 py-1.5 text-sm tracking-[0.2em] text-kp-ink">
            <Flag className="mr-1 inline size-3" /> Leader finished
          </span>
        ) : null}
      </div>
      ) : null}

      <Countdown race={race} />

      {!soloTouch ? pauseButton : null}
      {hostMenu && !compact ? (
        <div className="absolute right-[max(0.75rem,var(--safe-right))] top-1/2 -translate-y-1/2">
          {hostMenu}
        </div>
      ) : null}
      {game.mode === 'solo' && touch && !game.paused && !rotateBlocked ? <TouchControls game={game} layout={sideTouch ? 'side' : 'strip'} /> : null}
      {soloPauseAllowed && game.paused && !rotateBlocked ? <PauseMenu game={game} /> : null}
    </div>
  );
}
