import { Check, Crown, LogOut, Play, Smartphone, Tv, Wifi, WifiOff, Cpu, MonitorSmartphone, Zap, UserX } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { GameClient } from '../client-types';
import type { Player } from '../types';
import { TRACKS } from '../tracks';
import { ArcadeButton, DriverAvatar, DriverChip, Eyebrow, Keycap, Logo, Panel, Spinner, ToggleRow } from './primitives';
import { RaceSettings, TrackCard } from './MenuScreen';
import { TrackOutline } from './Minimap';
import { DIFFICULTY_LABEL, TRACK_ORDER, driverOf, formatEstimate, speedLabel } from './format';
import { estimatedRaceSeconds } from '../race-timing';
import { useQr } from './useQr';
import { DEFAULT_GRID_SIZE, DRIVERS, MAX_PLAYERS } from '../types';

/** Host-only seat removal. Optional until the client contract ships removePlayer. */
type SeatActions = { onRemove?: (id: string) => void; busy?: boolean };

function SeatCard({ player, index, isHost, isYou, onRemove, busy, phoneSeat }: { player: Player | null; index: number; isHost: boolean; isYou: boolean; phoneSeat?: boolean } & SeatActions) {
  if (!player) {
    // Racing host: the empty seat is a CPU on the eight-kart grid. Watching host: it is a free phone seat; CPUs only fill the grid up to eight.
    return (
      <div className="flex items-center gap-3 rounded-2xl border-[3px] border-dashed border-kp-cream/12 bg-kp-ink/30 px-3 py-2.5 text-kp-cream/45">
        <span className="flex size-11 items-center justify-center rounded-full bg-kp-cream/5">
          {phoneSeat ? <Smartphone className="size-5" /> : <Cpu className="size-5" />}
        </span>
        <span className="flex-1">
          <span className="kp-display block text-sm tracking-wider">{phoneSeat ? `Phone seat ${index + 1}` : `Seat ${index + 1}`}</span>
          <span className="block text-xs font-bold">{phoneSeat ? (index < DEFAULT_GRID_SIZE ? 'Scan to join, or a CPU takes it' : 'Scan to join') : 'CPU fills this seat'}</span>
        </span>
      </div>
    );
  }
  const d = driverOf(player.driver);
  return (
    <div
      className={cn(
        'kp-anim-pop relative flex items-center gap-3 rounded-2xl border-[3px] bg-kp-ink/50 px-3 py-2.5',
        player.ready ? 'border-kp-lime/70' : 'border-kp-cream/15',
        !player.connected && 'opacity-60',
      )}
      style={{ boxShadow: player.ready ? `0 0 24px ${d.color}44` : undefined }}
    >
      <DriverAvatar driver={player.driver} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="kp-display truncate text-base" style={{ color: d.color }}>
            {player.name || d.name}
          </span>
          {isHost ? <Crown className="size-4 shrink-0 text-kp-sun" aria-label="Host" /> : null}
          {isYou ? <span className="rounded-full bg-kp-cream/15 px-2 text-xs font-black uppercase tracking-wider text-kp-cream">You</span> : null}
        </span>
        <span className="flex items-center gap-1 text-xs font-bold text-kp-cream/60">
          {player.connected ? <Wifi className="size-3 text-kp-lime" /> : <WifiOff className="size-3 text-kp-coral" />}
          {player.connected ? (player.ready ? 'Ready to race' : 'Choosing') : 'Reconnecting'}
        </span>
      </span>
      {!player.connected && onRemove && !isYou ? (
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded-full border-2 border-kp-coral/70 bg-kp-coral/15 px-2.5 text-xs font-black uppercase tracking-wider text-kp-coral transition hover:bg-kp-coral hover:text-kp-ink disabled:opacity-40"
          onClick={() => onRemove(player.id)}
          disabled={busy}
          aria-label={`Remove ${player.name || d.name} from the room`}
        >
          <UserX className="size-4" strokeWidth={2.5} /> Remove
        </button>
      ) : (
        <span
          className={cn(
            'flex size-8 items-center justify-center rounded-full border-2',
            player.ready ? 'border-kp-lime bg-kp-lime text-kp-ink' : 'border-kp-cream/25 text-transparent',
          )}
          aria-label={player.ready ? 'Ready' : 'Not ready'}
        >
          <Check className="size-5" strokeWidth={3.5} />
        </span>
      )}
    </div>
  );
}

/** removePlayer is being added to GameClient by the root; the button only renders once it exists. */
type LobbyClient = GameClient & { removePlayer?: (id: string) => void };

export function LobbyScreen({ game }: { game: LobbyClient }) {
  const room = game.room;
  const isHost = Boolean(room && room.host === game.playerId);
  const remove = isHost && typeof game.removePlayer === 'function' ? (id: string) => game.removePlayer?.(id) : undefined;
  const stale = isHost ? (room?.players ?? []).filter((p) => !p.connected && p.id !== game.playerId).length : 0;
  const isController = game.mode === 'controller';
  const players = room?.players ?? [];
  const me = players.find((p) => p.id === game.playerId);
  const readyCount = players.filter((p) => p.ready && p.connected).length;
  // A host that only hosts has no seat in players, so the grid never shows a phantom host kart.
  const hostIsRacer = Boolean(room && players.some((p) => p.id === room.host));
  const phones = room ? players.filter((p) => p.id !== room.host) : [];
  const notReady = phones.filter((p) => p.connected && !p.ready).length;
  // A watching host needs at least one phone, and every connected phone ready, before the race can start.
  const displayHostBlock = isHost && !hostIsRacer ? (phones.length === 0 ? 'none' : notReady > 0 ? 'ready' : null) : null;
  const canStart = !game.busy && stale === 0 && displayHostBlock == null;
  const roleLabel = isHost ? (hostIsRacer ? 'Hosting and racing' : 'Hosting, this screen watches') : game.mode === 'display' ? 'Watching' : 'Lobby';
  const { dataUrl, failed } = useQr(game.joinUrl);
  const takenDrivers = new Set(players.filter((p) => p.id !== game.playerId).map((p) => p.driver));
  // The server owns seat drivers: show the seat's driver when we have one, and never send a pick for an occupied driver.
  const myDriver = me?.driver ?? game.driver;
  const pickDriver = (index: number) => {
    if (!takenDrivers.has(index)) game.setDriver(index);
  };
  const takenNames = DRIVERS.filter((_, index) => takenDrivers.has(index) && index !== myDriver).map((d) => d.name);
  const track = TRACKS[room?.track ?? game.track];
  const estimate = room ? formatEstimate(estimatedRaceSeconds(room.track, room.laps, room.speedClass)) : '';

  if (!room) {
    return (
      <div className="kp-layer flex items-center justify-center">
        <Panel className="flex items-center gap-4 px-6 py-5">
          <Spinner />
          <span className="kp-display text-lg tracking-wider text-kp-cream">Opening the room</span>
        </Panel>
      </div>
    );
  }

  if (isController) {
    return (
      <div className="kp-layer kp-scroll">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-[max(1rem,var(--safe-top))]">
          <div className="flex items-center justify-between">
            <Logo size="sm" />
            <span className="kp-display rounded-full bg-kp-ink/60 px-3 py-1.5 text-sm tracking-[0.3em] text-kp-sun">{room.code}</span>
          </div>
          {isHost && game.joinUrl ? (
            <p className="break-all text-center text-sm font-bold text-kp-cream/60">
              Others join at <span className="font-mono text-kp-cream">{game.joinUrl}</span> or enter code <span className="kp-display tracking-[0.2em] text-kp-sun">{room.code}</span>
            </p>
          ) : null}
          <Panel className="kp-anim-up p-4">
            <Eyebrow>You are in</Eyebrow>
            <div className="mt-2 flex items-center gap-3">
              <DriverAvatar driver={game.driver} size={56} />
              <div className="min-w-0 flex-1">
                <input className="kp-input py-2" value={game.name} maxLength={16} placeholder={DRIVERS[game.driver]?.name} onChange={(event) => game.setName(event.target.value)} spellCheck={false} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {DRIVERS.map((_, index) => (
                <div key={index} inert={takenDrivers.has(index) && myDriver !== index}>
                  <DriverChip driver={index} selected={myDriver === index} onSelect={pickDriver} taken={takenDrivers.has(index)} compact />
                </div>
              ))}
            </div>
            {takenNames.length ? <p className="sr-only">Already taken by other racers: {takenNames.join(', ')}.</p> : null}
            <div className="mt-3">
              <ToggleRow label="Auto gas" hint="Kart accelerates on its own. Turn off for a Gas button." checked={game.autoAccelerate} onChange={game.setAutoAccelerate} icon={<Zap />} />
            </div>
          </Panel>
          <Panel className="kp-anim-up kp-delay-1 p-4">
            <div className="flex items-center gap-3">
              <div className="w-20 shrink-0 rounded-xl p-1" style={{ background: track.sky }}>
                <TrackOutline id={room.track} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="kp-display block text-lg" style={{ color: track.color }}>{track.name}</span>
                <span className="block text-xs font-bold text-kp-cream/60">
                  {room.laps} {room.laps === 1 ? 'lap' : 'laps'} · {speedLabel(room.speedClass)} · {DIFFICULTY_LABEL[room.difficulty].title} CPUs{estimate ? ` · ${estimate}` : ''}
                </span>
              </div>
            </div>
            {isHost ? (
              <div className="mt-3 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TRACK_ORDER.map((id) => (
                    <TrackCard key={id} id={id} selected={room.track === id} onSelect={game.setTrack} compact />
                  ))}
                </div>
                <RaceSettings game={game} />
              </div>
            ) : null}
          </Panel>
          <Panel className="kp-anim-up kp-delay-2 p-4">
            <div className="mb-2 flex items-center justify-between">
              <Eyebrow>Grid</Eyebrow>
              <span className="text-xs font-black text-kp-cream/60">{readyCount}/{players.length} ready</span>
            </div>
            <div className="flex flex-col gap-2">
              {players.map((p) => (
                <SeatCard key={p.id} player={p} index={0} isHost={p.id === room.host} isYou={p.id === game.playerId} onRemove={remove} busy={game.busy} />
              ))}
            </div>
          </Panel>
          <div className="mt-auto flex flex-col gap-3 pt-2">
            <ArcadeButton tone={me?.ready ? 'lime' : 'sun'} size="xl" icon={<Check strokeWidth={3} />} onClick={game.ready} disabled={game.busy}>
              {me?.ready ? 'Ready!' : 'Ready up'}
            </ArcadeButton>
            {isHost ? (
              <>
                <ArcadeButton tone="coral" size="lg" icon={game.busy ? <Spinner /> : <Play />} onClick={game.start} disabled={!canStart}>
                  Start race
                </ArcadeButton>
                {stale > 0 ? (
                  <p className="text-center text-sm font-bold text-kp-coral">Remove disconnected seats or wait for them to return.</p>
                ) : displayHostBlock === 'none' ? (
                  <p className="text-center text-sm font-bold text-kp-cream/70">No phones have joined yet. Share the code with at least one phone to start.</p>
                ) : displayHostBlock === 'ready' ? (
                  <p className="text-center text-sm font-bold text-kp-cream/70">Waiting for {notReady === 1 ? 'one racer' : `${notReady} racers`} to tap Ready.</p>
                ) : null}
              </>
            ) : (
              <p className="text-center text-sm font-bold text-kp-cream/55">The host starts the race from their screen.</p>
            )}
            <ArcadeButton tone="ghost" size="sm" icon={<LogOut />} onClick={game.leave} disabled={game.busy}>
              Leave room
            </ArcadeButton>
          </div>
        </div>
      </div>
    );
  }

  // Always show the full joining capacity; the last two empty seats do not add CPUs.
  const seatCount = MAX_PLAYERS;
  const seats: (Player | null)[] = Array.from({ length: seatCount }, (_, i) => players[i] ?? null);

  return (
    <div className="kp-layer kp-scroll">
      <div className="kp-vignette pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid min-h-full w-full max-w-[1500px] grid-cols-1 gap-5 px-5 pb-8 pt-[max(1.25rem,var(--safe-top))] lg:grid-cols-[minmax(320px,4fr)_minmax(0,5fr)_minmax(280px,3fr)] lg:items-start lg:px-8">
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between lg:hidden">
            <Logo size="sm" />
            <span className="kp-display inline-flex items-center gap-1.5 rounded-full bg-kp-ink/60 px-3 py-1.5 text-xs tracking-[0.15em] text-kp-cream/80">
              {hostIsRacer || !isHost ? null : <Tv className="size-3.5 text-kp-sky" />}
              {roleLabel}
            </span>
          </div>
          <Panel className="kp-anim-up overflow-hidden p-0">
            <div className="kp-checker kp-anim-flag h-3" />
            <div className="p-5">
              <Eyebrow>Scan to join</Eyebrow>
              <div className="mt-3 flex flex-col items-center gap-4">
                <div className="relative w-full max-w-[320px] overflow-hidden rounded-2xl border-4 border-kp-ink bg-kp-cream p-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
                  {dataUrl ? (
                    // oxlint-disable-next-line next/no-img-element -- data URL rendered client side; next/image cannot optimize it
                    <img src={dataUrl} alt={`QR code for ${game.joinUrl}`} className="block aspect-square w-full" />
                  ) : (
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 text-kp-ink">
                      {failed || !game.joinUrl ? (
                        <>
                          <Smartphone className="size-8" />
                          <span className="px-6 text-center text-sm font-black">
                            {game.joinUrl ? 'QR could not be drawn. Type the code instead.' : 'Waiting for a network address.'}
                          </span>
                        </>
                      ) : (
                        <Spinner className="border-kp-ink/20 border-t-kp-ink" />
                      )}
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <span className="kp-display block text-xs tracking-[0.3em] text-kp-cream/60">Room code</span>
                  <span className="kp-numeral block text-[clamp(2.5rem,6vw,4rem)] tracking-[0.25em] text-kp-sun">{room.code}</span>
                </div>
                {game.joinUrl ? (
                  <p className="break-all text-center text-xs font-bold text-kp-cream/60">
                    Or open <span className="font-mono text-kp-cream">{game.joinUrl}</span> on your phone
                  </p>
                ) : null}
                {game.joinUrls.length > 1 ? (
                  <label className="flex w-full flex-col gap-1">
                    <span className="kp-display text-xs tracking-[0.2em] text-kp-cream/60">Network address for the QR code</span>
                    <select className="kp-input py-2 text-sm" value={game.joinUrl} onChange={(event) => game.setJoinUrl(event.target.value)}>
                      {game.joinUrls.map((url) => (
                        <option key={url} value={url}>
                          {url}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs font-bold text-kp-cream/50">Pick an address every player can reach.</span>
                  </label>
                ) : null}
              </div>
            </div>
          </Panel>
          <Panel className="kp-anim-up kp-delay-2 p-4">
            <Eyebrow className="mb-2">How to play</Eyebrow>
            <ul className="flex flex-col gap-2 text-sm font-bold text-kp-cream/75">
              <li className="flex items-start gap-2"><Smartphone className="mt-0.5 size-4 shrink-0 text-kp-sky" /> Phones scan the code and become controllers. Each phone drives one kart.</li>
              <li className="flex items-start gap-2"><MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-kp-sun" /> This screen splits into a view per human, up to ten. Fewer than eight racers? CPUs fill the grid to eight.</li>
              {hostIsRacer ? (
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 flex shrink-0 gap-1"><Keycap>W</Keycap><Keycap>A</Keycap><Keycap>S</Keycap><Keycap>D</Keycap></span>
                  Host drives with the keyboard: arrows or WASD to steer, <Keycap>Shift</Keycap> or <Keycap>Space</Keycap> to drift, <Keycap>E</Keycap> to fire.
                </li>
              ) : (
                <li className="flex items-start gap-2"><Tv className="mt-0.5 size-4 shrink-0 text-kp-lime" /> This screen only hosts and shows the race. Start, rematch, and close the room from here; phones do the driving.</li>
              )}
            </ul>
          </Panel>
        </section>

        <section className="flex flex-col gap-4">
          <div className="hidden items-center justify-between lg:flex">
            <Logo size="md" />
            <span className="kp-display inline-flex items-center gap-2 rounded-full bg-kp-ink/60 px-4 py-2 text-sm tracking-[0.2em] text-kp-cream/80">
              {hostIsRacer || !isHost ? null : <Tv className="size-4 text-kp-sky" />}
              {roleLabel}
            </span>
          </div>
          <Panel className="kp-anim-up kp-delay-1 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <Eyebrow>Starting grid</Eyebrow>
                <h2 className="kp-display mt-1 text-2xl text-kp-cream">
                  {hostIsRacer ? `${players.length} of ${seatCount} seats taken` : `${phones.length} of ${seatCount} phones joined`}
                </h2>
              </div>
              <span className="kp-display rounded-full bg-kp-lime/15 px-3 py-1.5 text-sm text-kp-lime">{readyCount} ready</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {seats.map((p, i) => (
                <SeatCard key={p?.id ?? `empty-${i}`} player={p} index={i} isHost={Boolean(p && p.id === room.host)} isYou={Boolean(p && p.id === game.playerId)} onRemove={remove} busy={game.busy} phoneSeat={!hostIsRacer || i >= DEFAULT_GRID_SIZE} />
              ))}
            </div>
          </Panel>
          {me ? (
            <Panel className="kp-anim-up kp-delay-2 p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Eyebrow>Your kart</Eyebrow>
                  <h2 className="kp-display mt-1 text-xl text-kp-cream">Driver and name</h2>
                </div>
                <input className="kp-input w-44 py-2" value={game.name} maxLength={16} placeholder={DRIVERS[game.driver]?.name} onChange={(event) => game.setName(event.target.value)} spellCheck={false} />
              </div>
              <div className="grid grid-cols-5 gap-2 lg:grid-cols-10">
                {DRIVERS.map((_, index) => (
                  <div key={index} inert={takenDrivers.has(index) && myDriver !== index}>
                    <DriverChip driver={index} selected={myDriver === index} onSelect={pickDriver} taken={takenDrivers.has(index)} compact />
                  </div>
                ))}
              </div>
              {takenNames.length ? <p className="sr-only">Already taken by other racers: {takenNames.join(', ')}.</p> : null}
            </Panel>
          ) : null}
        </section>

        <section className="flex flex-col gap-4">
          <Panel className="kp-anim-up kp-delay-2 p-4 sm:p-5">
            <Eyebrow className="mb-2">Race setup</Eyebrow>
            {isHost ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TRACK_ORDER.map((id) => (
                    <TrackCard key={id} id={id} selected={room.track === id} onSelect={game.setTrack} compact />
                  ))}
                </div>
                <RaceSettings game={game} />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-24 shrink-0 rounded-xl p-1" style={{ background: track.sky }}>
                  <TrackOutline id={room.track} />
                </div>
                <div>
                  <span className="kp-display block text-xl" style={{ color: track.color }}>{track.name}</span>
                  <span className="block text-xs font-bold text-kp-cream/60">{room.laps} {room.laps === 1 ? 'lap' : 'laps'} · {speedLabel(room.speedClass)} · {DIFFICULTY_LABEL[room.difficulty].title} CPUs{estimate ? ` · ${estimate}` : ''}</span>
                </div>
              </div>
            )}
          </Panel>
          <div className="flex flex-col gap-3">
            {me ? (
              <ArcadeButton tone={me.ready ? 'lime' : 'sun'} size="lg" icon={<Check strokeWidth={3} />} onClick={game.ready} disabled={game.busy}>
                {me.ready ? 'Ready!' : 'Ready up'}
              </ArcadeButton>
            ) : null}
            {isHost ? (
              <>
                <ArcadeButton tone="coral" size="xl" icon={game.busy ? <Spinner /> : <Play />} onClick={game.start} disabled={!canStart}>
                  Start race
                </ArcadeButton>
                {stale > 0 ? (
                  <p className="text-center text-sm font-bold text-kp-coral">
                    {stale === 1 ? 'One racer is disconnected.' : `${stale} racers are disconnected.`} Wait for them or remove their seats to start.
                  </p>
                ) : displayHostBlock === 'none' ? (
                  <p className="text-center text-sm font-bold text-kp-cream/70">No phones have joined yet. Scan the code with at least one phone to start.</p>
                ) : displayHostBlock === 'ready' ? (
                  <p className="text-center text-sm font-bold text-kp-cream/70">
                    Waiting for {notReady === 1 ? 'one racer' : `${notReady} racers`} to tap Ready.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-center text-sm font-bold text-kp-cream/55">Waiting for the host to start.</p>
            )}
            <ArcadeButton tone="ghost" size="sm" icon={<LogOut />} onClick={game.leave} disabled={game.busy}>
              {isHost ? 'Close room' : 'Leave room'}
            </ArcadeButton>
          </div>
        </section>
      </div>
    </div>
  );
}
