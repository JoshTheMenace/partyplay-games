/* Platform-facing views: avatar lobby, settings, instructions and the end-of-night results. */
import { useEffect, useRef, type CSSProperties } from 'react';
import { ArcadeButton, StatusNotice, ToggleRow, type InstructionsViewProps, type LobbyViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../../../party-ui/src/index';
import type { RosterPlayer } from '../../../../../party-contract/src/protocol';
import { MINIS, miniInfo } from '../../minis/catalog';
import { MINI_CLIENTS } from '../../minis/registry.client';
import { manifest } from '../../manifest';
import { COSY } from '../crowd';
import { AVATAR_COUNT, type LobbyChoice, type PackPublicView, type PackSettings, type TimerPace } from '../contract';
import { Avatar, AvatarBadge, AvatarStack, BigTitle, CHARACTERS, Confetti, Stage, Trophy, ordinal } from '../ui';
import { Emblem, Logo } from './brand';

const avatarOf = (p: RosterPlayer) => (p.lobbyChoice as Partial<LobbyChoice> | undefined)?.avatar;
export const DEFAULT_SETTINGS: PackSettings = { family: true, timers: 'standard', readAloud: false, tutorials: true, startWith: '' };

export function LobbyView({ players, playerId, connected, error, onChoice, onReady }: LobbyViewProps<PackSettings>) {
  const me = players.find(p => p.id === playerId), mine = me && avatarOf(me), asked = useRef(false);
  // Sixteen characters: up to sixteen players each own one; a bigger room shares them and tells seats apart by colour and name.
  const share = players.length > AVATAR_COUNT, wearers = (avatar: number) => players.filter(p => p.id !== playerId && avatarOf(p) === avatar);
  useEffect(() => {
    if (!me || mine !== undefined || me.ready || !connected || asked.current) return;
    const worn = Array.from({ length: AVATAR_COUNT }, (_, i) => wearers(i).length), least = Math.min(...worn), free = worn.flatMap((n, i) => n === least ? [i] : []);
    asked.current = true; onChoice({ avatar: free[[...me.id].reduce((h, c) => h + c.charCodeAt(0), 0) % free.length] ?? 0 });
  });
  if (!me) { const crowd = players.length > 12, ready = players.filter(p => p.ready).length; return <section className="hj-lobby-tv">
    <Logo size={crowd ? .5 : .8} /><p className="hj-lobby-lead">Grab your phone and pick a character. {players.length > COSY ? `${ready} of ${players.length} ready · room for ${manifest.players.max}.` : `Up to ${manifest.players.max} players.`}</p>
    {/* More than a dozen seats: a wall of faces that light up when ready. The shell's "Who's here" list right above has the names. */}
    <ul className="hj-lobby-roster" data-crowd={crowd || undefined}>{players.map(p => { const a = avatarOf(p), status = p.ready ? 'Ready!' : p.connected ? 'Choosing…' : 'Offline'; return <li key={p.id} data-ready={p.ready || undefined} data-offline={!p.connected || undefined} style={{ '--c': p.color } as CSSProperties}>
      {a === undefined ? <span className="hj-lobby-blank" aria-hidden="true">?</span> : <Avatar avatar={a} color={p.color} size={crowd ? 60 : 96} mood={p.ready ? 'happy' : 'idle'} />}
      {crowd ? <span className="hj-sr">{p.name}: {status}</span> : <><b className="hj-name">{p.name}</b><small>{status}</small></>}</li>; })}
      {Array.from({ length: Math.max(0, 3 - players.length) }, (_, i) => <li key={`open${i}`} className="hj-lobby-open"><span className="hj-lobby-blank" aria-hidden="true">+</span><small>Open seat</small></li>)}
    </ul>
  </section>; }
  const locked = me.ready || !connected;
  return <section className="hj-lobby-phone hj-fit" style={{ '--c': me.color } as CSSProperties}>
    <header><p className="hj-kicker">Hijinks</p><h2>{me.ready ? `Ready, ${me.name}!` : 'Pick your character'}</h2></header>
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    <div className="hj-avatar-grid" role="radiogroup" aria-label="Character">{CHARACTERS.map((c, i) => { const others = wearers(i), taken = share ? undefined : others[0];
      return <button key={c.name} type="button" role="radio" aria-checked={mine === i} disabled={locked || !!taken} className="hj-avatar-pick" data-taken={!!taken || undefined} onClick={() => onChoice({ avatar: i })}
        aria-label={taken ? `${c.name}, taken by ${taken.name}` : share && others.length ? `${c.name}, also picked by ${others.length}` : c.name}>
        <Avatar avatar={i} color={taken?.color ?? me.color} size={64} mood={mine === i ? 'happy' : 'idle'} /><span>{taken ? 'Taken' : c.name}{share && others.length > 0 && <small> ×{others.length + (mine === i ? 1 : 0)}</small>}</span>
      </button>; })}</div>
    <div className="hj-sticky">{me.ready
      ? <ArcadeButton tone="ghost" size="lg" disabled={!connected} onClick={() => onReady(false)}>Not ready</ArcadeButton>
      : <ArcadeButton tone="lime" size="lg" disabled={!connected || mine === undefined} onClick={() => onReady(true)}>I’m ready!</ArcadeButton>}
      <p className="hj-note">{players.filter(p => p.ready).length}/{players.length} ready{share ? ' · big room: characters are shared, your colour is yours' : ''} · the host starts the show</p></div>
  </section>;
}

const PACES: { id: TimerPace; label: string }[] = [{ id: 'relaxed', label: 'Relaxed' }, { id: 'standard', label: 'Standard' }, { id: 'speedy', label: 'Speedy' }];
export function SettingsView({ settings, onChange, disabled }: SettingsViewProps<PackSettings>) {
  const value = { ...DEFAULT_SETTINGS, ...settings }, set = (patch: Partial<PackSettings>) => onChange({ ...value, ...patch });
  const ready = MINIS.filter(m => Object.hasOwn(MINI_CLIENTS, m.id));
  return <div className="hj-settings">
    <ToggleRow label="Family friendly: skip grown-up prompts" checked={value.family} disabled={disabled} onChange={family => set({ family })} />
    <div className="hj-settings-row"><span id="hj-pace">Timers</span><div className="hj-seg" role="radiogroup" aria-labelledby="hj-pace">{PACES.map(p =>
      <button key={p.id} type="button" role="radio" aria-checked={value.timers === p.id} disabled={disabled} onClick={() => set({ timers: p.id })}>{p.label}</button>)}</div></div>
    <ToggleRow label="Read answers aloud on the TV" checked={value.readAloud} disabled={disabled} onChange={readAloud => set({ readAloud })} />
    <ToggleRow label="How-to intros before each game" checked={value.tutorials} disabled={disabled} onChange={tutorials => set({ tutorials })} />
    <label className="hj-settings-row"><span>Start with</span><select value={value.startWith} disabled={disabled} onChange={e => set({ startWith: e.target.value })}>
      <option value="">The game menu</option>{ready.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
  </div>;
}

export function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="hj-instructions hj-fit">
    <h2>A whole party night in one box</h2>
    <ol>
      <li><b>Vote</b> for a game on your phone. The VIP (crown) can lock it in early.</li>
      <li><b>Play.</b> The TV shows the action; your phone is your private controller.</li>
      <li><b>Win trophies.</b> Every game crowns a winner. Most trophies when the VIP ends the night takes the show.</li>
    </ol>
    <p className="kp-muted">{role === 'display' ? 'Keep this screen where everyone can see it. Turn the sound on for the host and music.' : 'Hold your phone upright. Everything secret stays on your screen.'}</p>
  </div>;
}

/** Night trophies as cups (up to four, then a count). */
const Cups = ({ n }: { n: number }) => <span className="hj-cups" aria-label={`${n} ${n === 1 ? 'trophy' : 'trophies'}`}>{Array.from({ length: Math.min(n, 4) }, (_, i) => <Trophy key={i} />)}{n > 4 && <b className="kp-numeral">×{n}</b>}</span>;
const FINALE_ROWS = 10, FINALE_GAMES = 7;

/**
 * End of the night. The host display gets a last full stage: the champion in the lights, the games the room played with who
 * took each trophy, and the top of the table. A phone gets its own night: place, trophies and the games it won.
 */
export function ResultsView({ outcome, publicView, playerId }: ResultsViewProps<PackPublicView>) {
  const players = publicView?.players ?? [], find = (id: string) => players.find(p => p.id === id), me = playerId ? find(playerId) : undefined;
  const champs = outcome.rows.filter(r => outcome.winners.includes(r.playerId)).map(r => find(r.playerId)).filter(p => !!p), played = publicView?.played ?? [], champions = publicView?.champions ?? [];
  const headline = champs.length ? champs.length === 1 ? `${champs[0]!.name} rules the night!` : champs.length === 2 ? `${champs[0]!.name} & ${champs[1]!.name} share the night!` : 'Shared glory tonight!' : 'What a night!';
  const trophies = (id: string) => publicView?.trophies[id] ?? 0, row = (id: string) => outcome.rows.find(r => r.playerId === id);
  if (playerId === null) {
    const rows = outcome.rows.slice(0, outcome.rows.length > FINALE_ROWS ? FINALE_ROWS - 1 : FINALE_ROWS), games = played.slice(-FINALE_GAMES), skipped = played.length - games.length;
    // One champion stands alone, two or three stand named; a bigger tie is a row of crowned faces and the table names them.
    const tie = champs.length > 3, shown = champs.slice(0, tie ? 5 : 3);
    return <Stage accent="#ffd24a" reserve={112}><section className="hj-finale" data-champs={champs.length || undefined}>
      {champs.length > 0 && <Confetti burst="night" count={160} />}
      <BigTitle kicker="That’s a wrap!" size={headline.length > 34 ? 84 : 108}>{headline}</BigTitle>
      <div className="hj-finale-main">
        <div className="hj-finale-champs">{champs.length > 0 && <i className="hj-step-rays" aria-hidden="true" />}
          {champs.length ? shown.map(p => <span key={p.id} className="hj-finale-champ" style={{ '--c': p.color } as CSSProperties}>
            <Avatar avatar={p.avatar} color={p.color} size={champs.length === 1 ? 250 : champs.length === 2 ? 190 : tie ? 120 : 140} mood="happy" crown />
            {champs.length > 1 && !tie && <b className="hj-name">{p.name}</b>}</span>)
            : players.slice(0, 5).map(p => <Avatar key={p.id} avatar={p.avatar} color={p.color} size={130} mood="idle" />)}
          {champs.length > shown.length && <b className="hj-step-more kp-numeral">+{champs.length - shown.length}</b>}
          {champs.length > 0 && <p className="hj-finale-haul"><Cups n={trophies(champs[0]!.id)} /><span>{champs.length === 1 ? row(champs[0]!.id)?.label : tie ? `each · ${champs.length} champions` : 'each'}</span></p>}
          {!champs.length && <p className="hj-finale-haul"><span>No trophies were won. Everybody’s a winner. Or nobody is.</span></p>}
        </div>
        {games.length > 0 && <div className="hj-finale-games"><h3>Tonight’s games</h3><ol>{games.map((id, i) => { const info = miniInfo(id), won = (champions[skipped + i] ?? []).map(find).filter(p => !!p);
          return <li key={skipped + i} style={{ '--accent': info?.accent ?? '#ffd24a', animationDelay: `${900 + i * 180}ms` } as CSSProperties}>
            <span className="hj-finale-emblem"><Emblem id={id} /></span><b>{info?.title ?? id}</b>
            {won.length ? <AvatarStack players={won} size={44} max={4} /> : <small>No trophy</small>}</li>; })}</ol>
          {skipped > 0 && <p>…and {skipped} more before that.</p>}</div>}
      </div>
      <ol className="hj-finale-rows">{rows.map((r, i) => { const p = find(r.playerId); return p && <li key={r.playerId} data-top={r.rank === 1 || undefined} style={{ animationDelay: `${1600 + i * 90}ms` }}>
        <span className="kp-numeral">{r.rank ? ordinal(r.rank) : ''}</span><AvatarBadge player={p} size={46} mood={r.rank === 1 ? 'happy' : 'idle'} /><Cups n={trophies(p.id)} /><b className="kp-numeral">{r.label?.split(' · ')[1] ?? r.score}</b></li>; })}
        {outcome.rows.length > rows.length && <li className="hj-finale-more" style={{ animationDelay: `${1600 + rows.length * 90}ms` }}>+{outcome.rows.length - rows.length} more · your night is on your phone</li>}</ol>
    </section></Stage>;
  }
  const mine = me && row(me.id), won = me ? played.filter((_, i) => champions[i]?.includes(me.id)) : [], top = outcome.rows.slice(0, 5);
  return <section className="hj-results hj-fit">
    <p className="hj-kicker">That’s a wrap!</p>
    <h1 className="kp-title">{me && champs.includes(me) ? 'You rule the night!' : headline}</h1>
    {me && mine ? <div className="hj-place" data-won={champs.includes(me) || undefined}>
      <Avatar avatar={me.avatar} color={me.color} size={132} mood={(mine.rank ?? 99) <= 3 ? 'happy' : 'idle'} crown={champs.includes(me)} />
      <p><b className="kp-title">{ordinal(mine.rank ?? players.length)}</b> of {players.length}</p>
      <p><Cups n={trophies(me.id)} /> <span className="kp-numeral">{mine.label}</span></p>
      {won.length > 0 && <p className="hj-note">You won {won.map(id => miniInfo(id)?.title ?? id).join(', ')}.</p>}
    </div> : champs.length > 0 && <div className="hj-results-champs">{champs.slice(0, 4).map(p => <span key={p.id}><Trophy /><Avatar avatar={p.avatar} color={p.color} size={120} mood="happy" /></span>)}</div>}
    <ol className="hj-results-rows">{top.map(r => { const p = find(r.playerId); return p && <li key={r.playerId} data-top={r.rank === 1 || undefined}>
      <span className="kp-numeral">{r.rank ? ordinal(r.rank) : ''}</span><AvatarBadge player={p} size={40} mood={r.rank === 1 ? 'happy' : 'idle'} /><b>{r.label ?? r.score}</b></li>; })}</ol>
    {outcome.rows.length > top.length && <p className="hj-note">Top {top.length} of {outcome.rows.length}. The full table is on the big screen.</p>}
    {played.length > 0 && <p className="hj-note">Played tonight: {played.map(id => miniInfo(id)?.title ?? id).join(' · ')}</p>}
  </section>;
}
