/* Racer + kart picker (players) and the pick board (watching host). Picks go to rules.parseLobbyChoice
 * as soon as they are complete so everyone sees them; Ready without a racer reveals a random free one (the kart is kept). */
import { useState, type CSSProperties } from 'react';
import type { LobbyViewProps } from '../../../../party-ui/src/index';
import type { RosterPlayer } from '../../../../party-contract/src/protocol';
import { CHARACTERS, isKartBody, KART_BODIES, kartStats, type KartStats } from '../sim/stats';
import { TRACK_DEFS } from '../tracks/index';
import type { KartBodyId, LobbyChoice, Settings } from '../sim/types';
import { character, KartPreview, kartName, Portrait } from './common';
import { TrackShape } from './Minimap';

const pickOf = (p?: RosterPlayer): LobbyChoice | null => {
  const c = p?.lobbyChoice as Partial<LobbyChoice> | undefined;
  return c && Number.isInteger(c.character) && c.character! >= 0 && c.character! < CHARACTERS.length && isKartBody(c.kart) ? { character: c.character!, kart: c.kart } : null;
};
const STATS: { key: keyof KartStats; label: string }[] = [
  { key: 'speed', label: 'Speed' }, { key: 'accel', label: 'Accel' }, { key: 'handling', label: 'Handling' }, { key: 'traction', label: 'Grip' }, { key: 'weight', label: 'Weight' },
];
// Every combo's range per stat, so small multiplier differences read clearly as bars.
const RANGE = Object.fromEntries(STATS.map(({ key }) => {
  const all = CHARACTERS.flatMap((_, i) => KART_BODIES.map(k => kartStats(i, k.id)[key]));
  return [key, [Math.min(...all), Math.max(...all)]];
})) as Record<keyof KartStats, [number, number]>;
export const statFill = (key: keyof KartStats, value: number) => { const [lo, hi] = RANGE[key]; return .2 + .8 * (hi > lo ? (value - lo) / (hi - lo) : .5); };

function StatBars({ stats, compact }: { stats: KartStats; compact?: boolean }) {
  return <dl className={`kp2-stats ${compact ? 'is-compact' : ''}`}>
    {STATS.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd><i style={{ width: `${Math.round(statFill(key, stats[key]) * 100)}%` }}/></dd></div>)}
  </dl>;
}

function PlayerChip({ player, me }: { player: RosterPlayer; me: boolean }) {
  const pick = pickOf(player);
  return <li className={`kp2-chip ${player.ready ? 'is-ready' : ''} ${me ? 'is-me' : ''} ${player.connected ? '' : 'is-away'}`} style={{ '--c': player.color } as CSSProperties}>
    {pick ? <Portrait index={pick.character}/> : <span className="kp2-portrait kp2-portrait-unknown" aria-hidden="true"><span className="kp2-preview-fallback">?</span></span>}
    <span><b>{player.name}{me && <em> (you)</em>}</b><small>{pick ? `${character(pick.character).name} · ${kartName(pick.kart)}` : player.ready ? 'Surprise racer' : 'Choosing…'}</small></span>
    <span className="kp2-chip-state">{!player.connected ? 'Away' : player.ready ? 'Ready' : '…'}</span>
  </li>;
}

function CourseSummary({ settings }: { settings: Settings }) {
  const def = TRACK_DEFS[settings.track] ?? TRACK_DEFS['palm-bay'];
  return <div className={`kp2-course-summary kp2-theme-${def.theme}`}>
    <TrackShape id={def.id}/>
    <div><small>Next race</small><b>{def.name}</b><span>{settings.laps} {settings.laps === 1 ? 'lap' : 'laps'} · {settings.speedClass}cc · {settings.items === 'off' ? 'no items' : settings.items === 'frantic' ? 'frantic items' : 'items on'}</span></div>
  </div>;
}

export function Lobby({ players, playerId, settings, connected, error, onChoice, onReady }: LobbyViewProps<Settings>) {
  const me = players.find(p => p.id === playerId), saved = pickOf(me);
  const [char, setChar] = useState<number | null>(saved?.character ?? null);
  const [kart, setKart] = useState<KartBodyId>(saved?.kart ?? 'zoomer');
  const pick = (c: number | null, k: KartBodyId) => { setChar(c); setKart(k); if (c !== null) onChoice({ character: c, kart: k }); };
  const others = players.filter(p => p.id !== playerId);
  const takenBy = (i: number) => others.filter(p => pickOf(p)?.character === i);
  /** "Surprise me": reveal a random racer nobody else has, keeping the chosen kart. */
  const surprise = () => { const all = CHARACTERS.map((_, i) => i), free = all.filter(i => !takenBy(i).length); const pool = free.length ? free : all; return pool[Math.floor(Math.random() * pool.length)]; };
  if (!me) return <section className="kp2-lobby kp2-lobby-board" aria-label="Racers">
    <CourseSummary settings={settings}/>
    <h2 className="kp2-lobby-heading">Racers <small>{players.filter(p => p.ready).length}/{players.length} ready</small></h2>
    {players.length ? <ul className="kp2-board">{players.map(p => { const c = pickOf(p); return <li key={p.id} className={p.ready ? 'is-ready' : ''} style={{ '--c': p.color } as CSSProperties}>
      {c ? <Portrait index={c.character}/> : <span className="kp2-portrait kp2-portrait-unknown" aria-hidden="true"><span className="kp2-preview-fallback">?</span></span>}
      <b>{p.name}</b><small>{c ? `${character(c.character).name} · ${kartName(c.kart)}` : p.ready ? 'Surprise racer' : 'Choosing…'}</small>
      <span className="kp2-board-state">{!p.connected ? 'Away' : p.ready ? 'Ready!' : 'Picking'}</span>
    </li>; })}</ul> : <p className="kp2-muted">Scan the code to join. Everyone picks a racer and a kart on their phone.</p>}
  </section>;
  const stats = kartStats(char ?? 1, kart), c = char === null ? null : CHARACTERS[char];
  return <section className="kp2-lobby" aria-label="Choose your racer">
    <header className="kp2-lobby-hero" style={{ '--c': c?.color ?? me.color } as CSSProperties}>
      {char === null ? <span className="kp2-portrait kp2-portrait-unknown" aria-hidden="true"><span className="kp2-preview-fallback">?</span></span> : <Portrait index={char}/>}
      <div><small>{me.ready ? 'Ready! Waiting for the host' : 'Pick your racer'}</small><b>{c ? c.name : 'Who’s driving?'}</b>
        <span>{c ? <span className="kp2-cap">{c.species} · {c.weight} · {kartName(kart)}</span> : 'Tap a racer below, or ready up for a surprise.'}</span>
        {char !== null && takenBy(char).length > 0 && <em className="kp2-lobby-clash">Also picked by {takenBy(char).map(p => p.name).join(', ')}</em>}</div>
      <StatBars stats={stats} compact/>
    </header>
    {error && <p className="kp2-lobby-error" role="alert">{error}</p>}
    <div className="kp2-lobby-cols">
      <fieldset className="kp2-pick-group"><legend>Racer</legend>
        <div className="kp2-char-grid">{CHARACTERS.map((ch, i) => { const by = takenBy(i); return <button key={ch.name} type="button" className={`kp2-char ${char === i ? 'is-picked' : ''}`} aria-pressed={char === i}
          style={{ '--c': ch.color } as CSSProperties} disabled={!connected} onClick={() => pick(i, kart)}>
          <Portrait index={i}/><b>{ch.name}</b><small>{ch.weight}</small>
          {by.length > 0 && <span className="kp2-char-by" style={{ '--p': by[0].color } as CSSProperties} title={`Also picked by ${by.map(p => p.name).join(', ')}`}>{by[0].name}{by.length > 1 && ` +${by.length - 1}`}</span>}
        </button>; })}</div>
      </fieldset>
      <fieldset className="kp2-pick-group"><legend>Kart</legend>
        <div className="kp2-kart-list">{KART_BODIES.map(k => <button key={k.id} type="button" className={`kp2-kart ${kart === k.id ? 'is-picked' : ''}`} aria-pressed={kart === k.id} disabled={!connected} onClick={() => pick(char, k.id)}>
          <KartPreview id={k.id}/><span><b>{k.name}</b><small>{k.blurb}</small></span><StatBars stats={kartStats(char ?? 1, k.id)} compact/>
        </button>)}</div>
      </fieldset>
    </div>
    {others.length > 0 && <details className="kp2-lobby-roster" open><summary>Racers · {players.filter(p => p.ready).length}/{players.length} ready</summary>
      <ul>{players.map(p => <PlayerChip key={p.id} player={p} me={p.id === playerId}/>)}</ul></details>}
    <div className="kp2-ready-bar">
      <button type="button" className={`kp2-ready ${me.ready ? 'is-ready' : ''}`} disabled={!connected} onClick={() => { if (!me.ready) pick(char ?? surprise(), kart); onReady(!me.ready); }}>
        {me.ready ? 'Not ready' : char === null ? 'Ready — surprise me!' : `Ready with ${c!.name}!`}
      </button>
    </div>
  </section>;
}
