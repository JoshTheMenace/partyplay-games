import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react';
import { Coins, Flag, Fuel, Maximize, Minimize, Octagon, Sparkles, WifiOff, Wind } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GameClient } from '../client-types';
import type { Input, Race, Racer } from '../types';
import { Countdown, EventBanner } from './RaceHud';
import { exitFullscreen, fullscreenAvailable, requestLandscape, useOrientation } from './orientation';
import { ItemIcon, StatusBadges } from './items';
import { DriverAvatar, Logo } from './primitives';
import { RaceMenu } from './RaceMenu';
import { DRIFT_FULL, DRIFT_TIER_COLOR, ITEM_COLOR, ITEM_LABEL, ITEM_SHORT, displayLap, driftTier, driverOf, ordinalSuffix, speedReadout } from './format';
import { itemRoulette } from '../item-roulette';

const DEAD_ZONE = 0.08;

/** Keeps the latest value in a ref so pointer handlers and effects never rebind when a 20 Hz snapshot re-renders. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

function useHold(send: (value: boolean) => void) {
  const latest = useLatest(send);
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const release = useCallback(() => {
    heldRef.current = false;
    setHeld(false);
    latest.current(false);
  }, [latest]);
  // A button removed mid-press (rotate prompt, pause, layout change) never sees pointerup, so let go on unmount.
  useEffect(
    () => () => {
      if (heldRef.current) latest.current(false);
    },
    [latest],
  );
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      heldRef.current = true;
      setHeld(true);
      latest.current(true);
    },
    [latest],
  );
  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      release();
    },
    [release],
  );
  const block = useCallback((event: SyntheticEvent) => event.preventDefault(), []);
  // Keyboard: Space or Enter holds while pressed, mirroring the pointer hold.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (event.repeat) return;
      heldRef.current = true;
      setHeld(true);
      latest.current(true);
    },
    [latest],
  );
  const onKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      release();
    },
    [release],
  );
  return {
    held,
    handlers: {
      onPointerDown,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: release,
      onContextMenu: block,
      onKeyDown,
      onKeyUp,
      onBlur: release,
    },
  };
}

export function HoldButton({
  label,
  announce,
  hint,
  color,
  send,
  className,
  children,
  icon,
  compact,
}: {
  /** Visible caption in the full layout and the accessible name unless `announce` overrides it. */
  label: string;
  /** Accessible name when the caption is a nickname, e.g. "Fire Comet Kick". */
  announce?: string;
  hint?: string;
  color: string;
  send: (value: boolean) => void;
  className?: string;
  children?: React.ReactNode;
  /** Glyph shown above the caption; the only content in compact mode. */
  icon?: React.ReactNode;
  compact?: boolean;
}) {
  const { held, handlers } = useHold(send);
  return (
    <button
      type="button"
      className={cn(
        'kp-touch relative flex min-h-11 min-w-11 select-none flex-col items-center justify-center border-[4px] border-kp-ink transition-transform duration-75',
        compact ? 'kp-touch-key gap-0 rounded-2xl [&_svg]:size-[clamp(1.5rem,7vmin,2.25rem)]' : 'gap-1 rounded-[2rem] [&>span>svg]:size-9',
        held ? 'translate-y-1 scale-[0.97] shadow-[0_2px_0_#05071a]' : 'shadow-[0_8px_0_#05071a]',
        className,
      )}
      style={{ background: held ? '#fff6e5' : color, color: '#05071a' }}
      aria-pressed={held}
      aria-label={announce ?? label}
      title={announce ?? label}
      {...handlers}
    >
      {children ?? (icon ? <span className="flex items-center justify-center">{icon}</span> : null)}
      {!compact ? <span className="kp-display max-w-full truncate px-1 text-xl sm:text-2xl">{label}</span> : null}
      {hint && !compact ? <span className="text-xs font-black uppercase tracking-widest opacity-60">{hint}</span> : null}
    </button>
  );
}

export function SteerPad({ send, className, compact }: { send: (steer: number) => void; className?: string; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useLatest(send);
  const [steer, setSteer] = useState(0);
  const [active, setActive] = useState(false);
  const pointer = useRef<number | null>(null);
  const update = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const half = rect.width / 2;
      let value = (clientX - rect.left - half) / (half * 0.85);
      value = Math.max(-1, Math.min(1, value));
      if (Math.abs(value) < DEAD_ZONE) value = 0;
      else value = Math.sign(value) * ((Math.abs(value) - DEAD_ZONE) / (1 - DEAD_ZONE));
      setSteer(value);
      latest.current(value);
    },
    [latest],
  );
  const release = useCallback(() => {
    pointer.current = null;
    setActive(false);
    setSteer(0);
    latest.current(0);
  }, [latest]);
  // Same unmount guard as the hold buttons: a pad removed under a thumb must centre the steering.
  useEffect(
    () => () => {
      if (pointer.current != null) latest.current(0);
    },
    [latest],
  );
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (pointer.current != null && pointer.current !== event.pointerId) return;
      pointer.current = event.pointerId;
      setActive(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      update(event.clientX);
    },
    [update],
  );
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointer.current !== event.pointerId) return;
      event.preventDefault();
      update(event.clientX);
    },
    [update],
  );
  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointer.current !== event.pointerId) return;
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      release();
    },
    [release],
  );
  const block = useCallback((event: SyntheticEvent) => event.preventDefault(), []);
  // Keyboard and assistive tech drive a native range. Arrow keys hold a full-lock steer and release to center.
  const onRangeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Math.max(-1, Math.min(1, Number(event.target.value) || 0));
      setSteer(value);
      latest.current(value);
    },
    [latest],
  );
  const onRangeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const dir = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0;
      if (!dir) return;
      event.preventDefault();
      if (event.repeat) return;
      setSteer(dir);
      latest.current(dir);
    },
    [latest],
  );
  const onRangeKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      release();
    },
    [release],
  );
  return (
    <div
      ref={ref}
      className={cn(
        'kp-touch relative overflow-hidden border-[4px] border-kp-ink bg-kp-navy/90 shadow-[0_8px_0_#05071a,inset_0_0_60px_rgba(0,0,0,0.5)]',
        compact ? 'rounded-3xl' : 'rounded-[2rem]',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={release}
      onContextMenu={block}
    >
      <input
        type="range"
        className="sr-only"
        aria-label="Steering"
        min={-1}
        max={1}
        step={0.05}
        value={steer}
        onChange={onRangeChange}
        onKeyDown={onRangeKeyDown}
        onKeyUp={onRangeKeyUp}
        onBlur={release}
      />
      <div className="kp-stripe pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute inset-x-6 top-1/2 h-3 -translate-y-1/2 rounded-full bg-kp-ink/70" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-kp-cream/40" />
      <span className="kp-display pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-3xl text-kp-cream/40">◀</span>
      <span className="kp-display pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-3xl text-kp-cream/40">▶</span>
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[4px] border-kp-ink transition-[background] duration-75',
          compact ? 'size-[clamp(48px,14vmin,80px)]' : 'size-[clamp(64px,22vmin,110px)]',
          active ? 'bg-kp-sun shadow-[0_0_30px_rgba(255,210,74,0.6),0_6px_0_#05071a]' : 'bg-kp-cream shadow-[0_6px_0_#05071a]',
        )}
        style={{ left: `calc(50% + ${steer * 0.85 * 50}%)`, transition: active ? 'none' : 'left 120ms ease-out, background 75ms' }}
      >
        <span className="absolute inset-[22%] rounded-full border-[3px] border-kp-ink/25" />
      </div>
      {!compact ? (
        <span className="kp-display pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs tracking-[0.25em] text-kp-cream/55">
          Slide to steer
        </span>
      ) : null}
    </div>
  );
}

/** Stable senders plus a focus-loss reset. Depends only on the input function and auto-accelerate flag through refs. */
function useTouchSenders(game: GameClient) {
  const input = useLatest(game.input);
  const auto = useLatest(game.autoAccelerate);
  const sendSteer = useCallback((steer: number) => input.current({ steer }), [input]);
  const sendDrift = useCallback((drift: boolean) => input.current({ drift }), [input]);
  const sendBrake = useCallback((brake: boolean) => input.current({ brake }), [input]);
  const sendUse = useCallback((use: boolean) => input.current({ use }), [input]);
  const sendThrottle = useCallback((throttle: boolean) => input.current({ throttle }), [input]);
  useEffect(() => {
    const neutral = () => {
      const reset: Partial<Input> = { steer: 0, brake: false, drift: false, use: false };
      if (!auto.current) reset.throttle = false;
      input.current(reset);
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') neutral();
    };
    window.addEventListener('blur', neutral);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', neutral);
      document.removeEventListener('visibilitychange', onVisibility);
      neutral();
    };
  }, [input, auto]);
  return { sendSteer, sendDrift, sendBrake, sendUse, sendThrottle };
}

function OwnHud({ race, racer }: { race: Race; racer: Racer }) {
  const d = driverOf(racer.driver);
  const tier = driftTier(racer);
  const ratio = Math.min(1, racer.drift / DRIFT_FULL);
  const finalLap = race.phase === 'racing' && racer.finishTime == null && racer.lap >= race.laps;
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="kp-hud-text flex items-end">
        <span className="kp-title text-5xl text-kp-cream">{racer.rank}</span>
        <span className="kp-display mb-1 text-lg text-kp-sun">{ordinalSuffix(racer.rank)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <DriverAvatar driver={racer.driver} size={22} />
          <span className="kp-display truncate text-sm" style={{ color: d.color }}>{racer.name}</span>
          <span className={cn('kp-display ml-auto text-sm', finalLap ? 'text-kp-coral' : 'text-kp-cream')}>
            {racer.finishTime != null ? 'Finished' : finalLap ? 'Final lap' : `Lap ${displayLap(racer, race)}/${race.laps}`}
          </span>
        </span>
        <div className="kp-meter h-2.5">
          <i style={{ width: `${racer.boost > 0 ? 100 : ratio * 100}%`, background: racer.boost > 0 ? 'linear-gradient(90deg,#ffd24a,#ff5748)' : DRIFT_TIER_COLOR[tier] }} />
        </div>
        <span className="flex items-center gap-3 text-xs font-black text-kp-cream/70">
          <span><span className="kp-numeral text-base text-kp-cream">{speedReadout(racer)}</span> km/h</span>
          <span className="inline-flex items-center gap-1 text-kp-sun"><Coins className="size-3.5" strokeWidth={3} /> {racer.coins}</span>
          <StatusBadges racer={racer} size={18} className="ml-auto" />
        </span>
      </div>
    </div>
  );
}

/** Landscape header for a phone that is only a controller: place, lap, and a thin drift charge. The TV shows the rest. */
function SlimHud({ race, racer }: { race: Race; racer: Racer }) {
  const tier = driftTier(racer);
  const ratio = Math.min(1, racer.drift / DRIFT_FULL);
  const finalLap = race.phase === 'racing' && racer.finishTime == null && racer.lap >= race.laps;
  return (
    <div className="flex min-w-0 items-center gap-3 px-1">
      <span className="kp-hud-text flex shrink-0 items-end">
        <span className="kp-title text-3xl leading-none text-kp-cream">{racer.rank}</span>
        <span className="kp-display mb-0.5 text-sm text-kp-sun">{ordinalSuffix(racer.rank)}</span>
      </span>
      <span className={cn('kp-display shrink-0 text-sm', finalLap ? 'text-kp-coral' : 'text-kp-cream/85')}>
        {racer.finishTime != null ? 'Finished' : finalLap ? 'Final lap' : `Lap ${displayLap(racer, race)}/${race.laps}`}
      </span>
      <div className="kp-meter h-2 min-w-0 flex-1" aria-hidden="true">
        <i style={{ width: `${racer.boost > 0 ? 100 : ratio * 100}%`, background: racer.boost > 0 ? 'linear-gradient(90deg,#ffd24a,#ff5748)' : DRIFT_TIER_COLOR[tier] }} />
      </div>
    </div>
  );
}

/** Fullscreen toggle. A gesture here is also the moment browsers allow a landscape lock, so it goes through requestLandscape. */
function FullscreenButton({ fullscreen }: { fullscreen: boolean }) {
  if (!fullscreenAvailable()) return null;
  return (
    <button
      type="button"
      className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-kp-cream/30 bg-kp-ink/60 text-kp-cream transition hover:bg-kp-ink/90"
      onClick={(event) => {
        event.currentTarget.blur();
        void (fullscreen ? exitFullscreen() : requestLandscape());
      }}
      aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
      title={fullscreen ? 'Exit full screen' : 'Full screen'}
    >
      {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
    </button>
  );
}

/** Full-screen phone controller for mode "controller". Landscape is the designed layout: steering left, big keys right.
 *  Upright phones are covered by PartyApp's rotate prompt; the portrait grid below only serves tablets. */
export function Controller({ game }: { game: GameClient }) {
  const race = game.race;
  const racer = race?.racers.find((r) => r.id === game.playerId) ?? null;
  const auto = game.autoAccelerate;
  const { sendSteer, sendDrift, sendBrake, sendUse, sendThrottle } = useTouchSenders(game);
  const roulette=race&&racer?itemRoulette(race,racer):{active:false,item:null},item=roulette.item;
  const orientation = useOrientation();

  return (
    <div className="kp-layer kp-touch bg-kp-ink">
      <div className="kp-stripe pointer-events-none absolute inset-0 opacity-40" />
      <div
        className={cn(
          'relative grid h-full w-full gap-3 p-3',
          'pt-[max(0.75rem,var(--safe-top))] pb-[max(0.75rem,var(--safe-bottom))] pl-[max(0.75rem,var(--safe-left))] pr-[max(0.75rem,var(--safe-right))]',
          'portrait:grid-rows-[auto_minmax(0,1fr)_auto] portrait:grid-cols-1',
          'landscape:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] landscape:grid-rows-[auto_minmax(0,1fr)]',
        )}
      >
        <div className="flex items-center gap-2 landscape:col-span-2">
          <div className="min-w-0 flex-1">
            {race && racer ? (
              <>
                <div className="landscape:hidden"><OwnHud race={race} racer={racer} /></div>
                <div className="portrait:hidden"><SlimHud race={race} racer={racer} /></div>
              </>
            ) : (
              <div className="flex items-center gap-3 px-1">
                <Logo size="sm" />
                <span className="kp-display text-sm tracking-widest text-kp-cream/60">{race ? 'Spectating' : 'Waiting for the race'}</span>
              </div>
            )}
          </div>
          <FullscreenButton fullscreen={orientation.fullscreen} />
          <RaceMenu game={game} className="shrink-0" />
        </div>

        <SteerPad send={sendSteer} className="min-h-[120px] portrait:min-h-[38vh] landscape:row-start-2" />

        {/* Landscape: a two by two block of large keys under the right thumb. Drift is the big key, spanning the bottom row when Auto gas is on. */}
        <div
          className={cn(
            'grid gap-3 landscape:row-start-2 landscape:h-full landscape:grid-cols-2 landscape:grid-rows-2',
            auto ? 'portrait:grid-cols-3 portrait:h-[22vh]' : 'portrait:grid-cols-2 portrait:grid-rows-2 portrait:h-[30vh]',
          )}
        >
          <HoldButton label="Brake" hint="slow" color="#ff5748" send={sendBrake} />
          <HoldButton
            label={roulette.active?'Choosing':item ? ITEM_SHORT[item] : 'Item'}
            announce={roulette.active?'Choosing item':item ? `Fire ${ITEM_LABEL[item]}` : 'Item, empty'}
            hint={roulette.active?'wait':item ? 'fire' : 'empty'}
            color={item ? ITEM_COLOR[item] : '#3a3f6b'}
            send={roulette.active?()=>{}:sendUse}
            icon={item ? <ItemIcon item={item} /> : <Sparkles className="opacity-40" />}
          />
          <HoldButton label="Drift" hint="hold" color="#28c6e7" send={sendDrift} className={auto ? 'landscape:col-span-2' : undefined} />
          {!auto ? <HoldButton label="Gas" hint="hold" color="#78d955" send={sendThrottle} /> : null}
        </div>
      </div>

      {race ? <Countdown race={race} /> : null}
      {race && racer ? <EventBanner race={race} racer={racer} compact className="pointer-events-none" /> : null}

      {race && racer && racer.finishTime != null ? (
        <div className="pointer-events-none absolute inset-x-0 top-[30%] flex flex-col items-center gap-1">
          <Flag className="size-8 text-kp-sun" />
          <span className="kp-title kp-anim-pop text-6xl text-kp-sun">{racer.rank}{ordinalSuffix(racer.rank)}</span>
          <span className="kp-display text-sm tracking-widest text-kp-cream/70">Waiting for the others</span>
        </div>
      ) : null}

      {!game.connected ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-kp-ink/85 text-center backdrop-blur-sm">
          <WifiOff className="size-10 text-kp-coral" />
          <span className="kp-display text-2xl text-kp-cream">Reconnecting</span>
          <span className="max-w-xs text-sm font-bold text-kp-cream/60">Your kart keeps its seat. Stay on the host&apos;s Wi-Fi and this will resume on its own.</span>
        </div>
      ) : null}
    </div>
  );
}

/** Solo touch controls drawn over the 3D view.
 *  `strip`: a bottom band (tablets and upright layouts), icon-only keys at 44px or more, stage shortened to match.
 *  `side`: landscape phones. Steering pad bottom-left, a two by two key block bottom-right, full-height road between them. */
export function TouchControls({ game, layout = 'strip' }: { game: GameClient; layout?: 'strip' | 'side' }) {
  const auto = game.autoAccelerate;
  const racer=game.race?.racers.find((r) => r.id === game.playerId),roulette=game.race&&racer?itemRoulette(game.race,racer):{active:false,item:null},item=roulette.item;
  const { sendSteer, sendDrift, sendBrake, sendUse, sendThrottle } = useTouchSenders(game);
  const keys = (
    <>
      <HoldButton compact label="Brake" color="#ff5748" send={sendBrake} icon={<Octagon />} className={layout === 'side' ? 'kp-side-key' : undefined} />
      <HoldButton
        compact
        label={roulette.active?'Choosing item':item ? `Fire ${ITEM_LABEL[item]}` : 'Item, empty'}
        color={item ? ITEM_COLOR[item] : '#3a3f6b'}
        send={roulette.active?()=>{}:sendUse}
        icon={item ? <ItemIcon item={item} /> : <Sparkles className="opacity-40" />}
        className={layout === 'side' ? 'kp-side-key' : undefined}
      />
      <HoldButton
        compact
        label="Drift"
        color="#28c6e7"
        send={sendDrift}
        icon={<Wind />}
        className={cn(layout === 'side' ? 'kp-side-key' : undefined, auto && (layout === 'side' ? 'col-span-2' : 'portrait:col-span-2'))}
      />
      {!auto ? <HoldButton compact label="Gas" color="#78d955" send={sendThrottle} icon={<Fuel />} className={layout === 'side' ? 'kp-side-key' : undefined} /> : null}
    </>
  );
  if (layout === 'side') {
    return (
      <>
        <div className="kp-touch absolute bottom-[max(0.5rem,var(--safe-bottom))] left-[max(0.5rem,var(--safe-left))] opacity-90">
          <SteerPad send={sendSteer} compact className="kp-side-pad" />
        </div>
        <div className="kp-touch absolute bottom-[max(0.5rem,var(--safe-bottom))] right-[max(0.5rem,var(--safe-right))] grid grid-cols-2 grid-rows-2 gap-2 opacity-90">{keys}</div>
      </>
    );
  }
  return (
    <div
      className={cn(
        'kp-touch kp-touch-strip absolute inset-x-0 bottom-0 grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-2 opacity-90',
        'pl-[max(0.5rem,var(--safe-left))] pr-[max(0.5rem,var(--safe-right))]',
      )}
    >
      <SteerPad send={sendSteer} compact className="min-w-0" />
      <div className={cn('grid gap-2 portrait:grid-cols-2 portrait:grid-rows-2 landscape:grid-flow-col landscape:grid-rows-1', auto ? 'landscape:grid-cols-3' : 'landscape:grid-cols-4')}>{keys}</div>
    </div>
  );
}
