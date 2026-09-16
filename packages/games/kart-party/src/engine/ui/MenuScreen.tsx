import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Flag, Gauge, Gamepad2, Keyboard, Radio, Settings2, Sparkles, Timer, Tv, Users, Volume2, VolumeX, Zap, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GameClient } from '../client-types';
import type { TrackId } from '../types';
import { DRIVERS } from '../types';
import { TRACKS } from '../tracks';
import { ArcadeButton, DriverChip, Eyebrow, Logo, Panel, Segmented, Stepper, ToggleRow } from './primitives';
import { TrackOutline } from './Minimap';
import { Modal } from './Modal';
import { HowToPlayButton } from './HowToPlay';
import { PhonePlayButton } from './PhonePlayDialog';
import { DIFFICULTY_LABEL, MAX_LAPS, TRACK_ORDER, formatEstimate } from './format';
import { estimatedRaceSeconds } from '../race-timing';
import { SPEED_CLASSES } from '../speed';

export function TrackCard({
  id,
  selected,
  onSelect,
  compact,
}: {
  id: TrackId;
  selected: boolean;
  onSelect: (id: TrackId) => void;
  compact?: boolean;
}) {
  const track = TRACKS[id];
  // Rainbow Road previews as a star field so the spectrum road reads against it; other courses show sky over ground.
  const rainbow = id === 'rainbow';
  const preview = rainbow
    ? `radial-gradient(120% 90% at 50% 110%, #3b2a7a 0%, ${track.sky} 45%, #05071a 100%)`
    : `linear-gradient(180deg, ${track.sky} 0%, ${track.sky} 45%, ${track.ground} 46%, ${track.ground} 100%)`;
  return (
    <button
      type="button"
      className={cn('kp-chip group flex min-w-0 flex-col overflow-hidden rounded-3xl text-left', compact ? 'p-2' : 'p-3')}
      style={{ '--chip-color': track.color } as CSSProperties}
      data-selected={selected}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
    >
      <div className={cn('relative w-full overflow-hidden rounded-2xl', rainbow && 'kp-space')} style={{ background: preview }}>
        <div className={cn('mx-auto', compact ? 'w-3/4 py-2' : 'w-4/5 py-3')}>
          <TrackOutline id={id} />
        </div>
        <span className="kp-display absolute left-2 top-2 rounded-full bg-kp-ink/70 px-2.5 py-1 text-xs tracking-[0.15em] text-kp-cream">
          {Math.round(track.length)} m
        </span>
      </div>
      <span className={cn('kp-display mt-2 block text-balance text-kp-cream', compact ? 'text-sm sm:text-base' : 'text-lg sm:text-xl')} style={{ color: selected ? track.color : undefined }}>
        {track.name}
      </span>
      {!compact ? <span className="block text-xs font-bold text-kp-cream/70 sm:text-sm">{track.subtitle}</span> : null}
    </button>
  );
}

export function RaceSettings({ game, className }: { game: GameClient; className?: string }) {
  const speed = SPEED_CLASSES.find((option) => option.value === game.speedClass) ?? SPEED_CLASSES[1];
  const estimate = formatEstimate(estimatedRaceSeconds(game.track, game.laps, game.speedClass));
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stepper label="Laps" value={game.laps} min={1} max={MAX_LAPS} onChange={game.setLaps} />
        {estimate ? (
          <output className="inline-flex items-center gap-1.5 rounded-full bg-kp-ink/50 px-3 py-1.5 text-xs font-black text-kp-cream/80" title="Typical time for a full grid. Slower drivers get extra time to finish.">
            <Timer className="size-3.5 text-kp-sun" strokeWidth={3} /> {TRACKS[game.track].name}, {estimate}
          </output>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <Segmented
          label="Speed"
          value={game.speedClass}
          onChange={game.setSpeedClass}
          options={SPEED_CLASSES.map((option) => ({ value: option.value, label: option.label, hint: option.description }))}
        />
        <p className="text-xs font-bold text-kp-cream/60 sm:pl-[calc(4rem+0.75rem)]" aria-live="polite">{speed.description}</p>
      </div>
      <Segmented
        label="CPUs"
        value={game.difficulty}
        onChange={game.setDifficulty}
        options={(['easy', 'normal', 'hard'] as const).map((value) => ({ value, label: DIFFICULTY_LABEL[value].title, hint: DIFFICULTY_LABEL[value].blurb }))}
      />
    </div>
  );
}

export function PreferenceToggles({ game }: { game: GameClient }) {
  return (
    <div className="flex flex-col gap-2">
      <ToggleRow
        label="Sound"
        hint={game.muted ? 'Muted' : 'Engine, item, and race sounds'}
        checked={!game.muted}
        onChange={(on) => game.setMuted(!on)}
        icon={game.muted ? <VolumeX /> : <Volume2 />}
      />
      <ToggleRow
        label="Auto accelerate"
        hint="Kart drives forward on its own. Steer, drift, and fire."
        checked={game.autoAccelerate}
        onChange={game.setAutoAccelerate}
        icon={<Zap />}
      />
      <ToggleRow
        label="Performance mode"
        hint="Lower detail for older laptops and big split screens."
        checked={game.quality === 'performance'}
        onChange={(on) => game.setQuality(on ? 'performance' : 'high')}
        icon={<Gauge />}
      />
    </div>
  );
}

export function MenuScreen({ game }: { game: GameClient }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const busy = game.busy;
  return (
    <div className="kp-layer kp-scroll">
      <div className="kp-vignette pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid min-h-full w-full max-w-[1400px] grid-cols-1 gap-6 px-5 pb-10 pt-[max(1.5rem,var(--safe-top))] lg:grid-cols-[minmax(340px,5fr)_minmax(0,7fr)] lg:items-center lg:gap-10 lg:px-10">
        <section className="kp-menu-intro min-w-0 flex flex-col gap-6 lg:gap-8">
          <a href="/" className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border-2 border-kp-cream/25 bg-kp-ink/50 px-4 py-2 text-sm font-black text-kp-cream">← All games</a>
          <div className="kp-anim-in">
            <Eyebrow className="mb-3">Festival kart racing</Eyebrow>
            <Logo size="xl" />
            <p className="mt-4 max-w-md text-base font-bold text-kp-cream/75 sm:text-lg">
              Up to ten friends on one screen, phones as controllers, CPUs filling the grid to eight. Drift for boosts, grab items, and steal the finish.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:max-w-md">
            <ArcadeButton tone="sun" size="xl" icon={<Flag />} className="kp-anim-rise kp-delay-1 justify-start" onClick={game.solo} disabled={busy}>
              Solo race
            </ArcadeButton>
            <ArcadeButton tone="coral" size="xl" icon={<Users />} className="kp-anim-rise kp-delay-2 justify-start" onClick={game.host} disabled={busy}>
              Host a party
            </ArcadeButton>
            {/* Host choice travels with game.host(). Off: this screen only hosts and shows the race. On: it also takes a racer seat. */}
            <div className="kp-anim-rise kp-delay-2">
              <ToggleRow
                label="Play from this device"
                hint={game.hostPlays ? 'You race from here too. Phones fill the other seats.' : 'Shared screen for up to ten phones. This device hosts and shows the race.'}
                checked={game.hostPlays}
                onChange={game.setHostPlays}
                icon={game.hostPlays ? <Keyboard /> : <Tv />}
              />
            </div>
            <ArcadeButton tone="sky" size="xl" icon={<Gamepad2 />} className="kp-anim-rise kp-delay-3 justify-start" onClick={game.showJoin} disabled={busy}>
              Join with code
            </ArcadeButton>
            <div className="kp-anim-rise kp-delay-4 mt-1 flex flex-wrap gap-2">
              <HowToPlayButton />
              <PhonePlayButton />
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border-2 border-kp-cream/25 bg-kp-ink/50 px-4 py-2 text-sm font-black uppercase tracking-widest text-kp-cream/85 transition hover:border-kp-cream/60 hover:text-kp-cream"
                onClick={() => setSettingsOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
              >
                <Settings2 className="size-4" /> Settings
              </button>
            </div>
          </div>
          <div className="hidden items-center gap-4 text-xs font-bold text-kp-cream/50 lg:flex">
            <span className="inline-flex items-center gap-1.5"><Radio className="size-4 text-kp-lime" /> Play in your browser</span>
            <span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-kp-sun" /> Four courses, four speed classes</span>
          </div>
        </section>

        <section className="flex flex-col gap-5">
          <Panel className="kp-anim-up kp-delay-1 p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <Eyebrow>Your driver</Eyebrow>
                <h2 className="kp-display mt-1 text-2xl text-kp-cream">Pick a racer</h2>
              </div>
              <label className="flex items-center gap-2">
                <span className="kp-display text-xs tracking-[0.2em] text-kp-cream/70">Name</span>
                <input
                  className="kp-input w-40 py-2"
                  value={game.name}
                  maxLength={16}
                  placeholder={DRIVERS[game.driver]?.name ?? 'Racer'}
                  onChange={(event) => game.setName(event.target.value)}
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 sm:gap-3">
              {DRIVERS.map((_, index) => (
                <DriverChip key={index} driver={index} selected={game.driver === index} onSelect={game.setDriver} compact />
              ))}
            </div>
          </Panel>

          <Panel className="kp-anim-up kp-delay-2 p-4 sm:p-5">
            <div className="mb-3">
              <Eyebrow>Circuit</Eyebrow>
              <h2 className="kp-display mt-1 text-2xl text-kp-cream">Choose a track</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
              {TRACK_ORDER.map((id) => (
                <TrackCard key={id} id={id} selected={game.track === id} onSelect={game.setTrack} />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <RaceSettings game={game} />
              <p className="self-end text-xs font-bold text-kp-cream/50 md:text-right">
                Solo runs you against seven CPUs. Hosting opens a room for phones and fills empty seats with CPUs. Speed sets how fast everyone goes; CPUs sets how sharp they drive.
              </p>
            </div>
          </Panel>
        </section>
      </div>

      {settingsOpen ? (
        <Modal label="Settings" onClose={() => setSettingsOpen(false)} initialFocus="[data-autofocus]">
          <Panel className="kp-anim-pop p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <Eyebrow>Options</Eyebrow>
                <h2 className="kp-display mt-1 text-2xl text-kp-cream">Settings</h2>
              </div>
              <button type="button" data-autofocus className="rounded-full p-2 text-kp-cream/80 transition hover:bg-kp-cream/10 hover:text-kp-cream" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X className="size-5" />
              </button>
            </div>
            <PreferenceToggles game={game} />
          </Panel>
        </Modal>
      ) : null}
    </div>
  );
}
