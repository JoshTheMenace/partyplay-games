/* Platform-facing views: avatar lobby, settings, instructions and the end-of-night results. */
import { useEffect, useRef, type CSSProperties } from 'react';
import { ArcadeButton, StatusNotice, ToggleRow, type InstructionsViewProps, type LobbyViewProps, type ResultsViewProps, type SettingsViewProps } from '../../../../../party-ui/src/index';
import type { RosterPlayer } from '../../../../../party-contract/src/protocol';
import { MINIS, miniInfo } from '../../minis/catalog';
import { MINI_CLIENTS } from '../../minis/registry.client';
import { AVATAR_COUNT, type LobbyChoice, type PackPublicView, type PackSettings, type TimerPace } from '../contract';
import { Avatar, AvatarBadge, CHARACTERS, Trophy, ordinal } from '../ui';
import { Logo } from './brand';

const avatarOf = (p: RosterPlayer) => (p.lobbyChoice as Partial<LobbyChoice> | undefined)?.avatar;
export const DEFAULT_SETTINGS: PackSettings = { family: true, timers: 'standard', readAloud: false, tutorials: true, startWith: '' };

export function LobbyView({ players, playerId, connected, error, onChoice, onReady }: LobbyViewProps<PackSettings>) {
  const me = players.find(p => p.id === playerId), mine = me && avatarOf(me), asked = useRef(false);
  const owner = (avatar: number) => players.find(p => p.id !== playerId && avatarOf(p) === avatar);
  useEffect(() => {
    if (!me || mine !== undefined || me.ready || !connected || asked.current) return;
    const free = Array.from({ length: AVATAR_COUNT }, (_, i) => i).filter(i => !owner(i));
    asked.current = true; onChoice({ avatar: free[[...me.id].reduce((h, c) => h + c.charCodeAt(0), 0) % Math.max(1, free.length)] ?? 0 });
  });
  if (!me) return <section className="hj-lobby-tv">
    <Logo size={.8} /><p className="hj-lobby-lead">Grab your phone and pick a character. Up to 10 players.</p>
    <ul className="hj-lobby-roster">{players.map(p => { const a = avatarOf(p); return <li key={p.id} data-ready={p.ready || undefined} style={{ '--c': p.color } as CSSProperties}>
      {a === undefined ? <span className="hj-lobby-blank" aria-hidden="true">?</span> : <Avatar avatar={a} color={p.color} size={96} mood={p.ready ? 'happy' : 'idle'} />}
      <b className="hj-name">{p.name}</b><small>{p.ready ? 'Ready!' : p.connected ? 'Choosing…' : 'Offline'}</small></li>; })}
      {Array.from({ length: Math.max(0, 3 - players.length) }, (_, i) => <li key={`open${i}`} className="hj-lobby-open"><span className="hj-lobby-blank" aria-hidden="true">+</span><small>Open seat</small></li>)}
    </ul>
  </section>;
  const locked = me.ready || !connected;
  return <section className="hj-lobby-phone" style={{ '--c': me.color } as CSSProperties}>
    <header><p className="hj-kicker">Hijinks</p><h2>{me.ready ? `Ready, ${me.name}!` : 'Pick your character'}</h2></header>
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    <div className="hj-avatar-grid" role="radiogroup" aria-label="Character">{CHARACTERS.map((c, i) => { const taken = owner(i);
      return <button key={c.name} type="button" role="radio" aria-checked={mine === i} disabled={locked || !!taken} className="hj-avatar-pick" data-taken={!!taken || undefined} onClick={() => onChoice({ avatar: i })}
        aria-label={taken ? `${c.name}, taken by ${taken.name}` : c.name}>
        <Avatar avatar={i} color={taken?.color ?? me.color} size={64} mood={mine === i ? 'happy' : 'idle'} /><span>{taken ? 'Taken' : c.name}</span>
      </button>; })}</div>
    <div className="hj-sticky">{me.ready
      ? <ArcadeButton tone="ghost" size="lg" disabled={!connected} onClick={() => onReady(false)}>Not ready</ArcadeButton>
      : <ArcadeButton tone="lime" size="lg" disabled={!connected || mine === undefined} onClick={() => onReady(true)}>I’m ready!</ArcadeButton>}
      <p className="hj-note">{players.filter(p => p.ready).length}/{players.length} ready · the host starts the show</p></div>
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
  return <div className="hj-instructions">
    <h2>A whole party night in one box</h2>
    <ol>
      <li><b>Vote</b> for a game on your phone. The VIP (crown) can lock it in early.</li>
      <li><b>Play.</b> The TV shows the action; your phone is your private controller.</li>
      <li><b>Win trophies.</b> Every game crowns a winner. Most trophies when the VIP ends the night takes the show.</li>
    </ol>
    <p className="kp-muted">{role === 'display' ? 'Keep this screen where everyone can see it. Turn the sound on for the host and music.' : 'Hold your phone upright. Everything secret stays on your screen.'}</p>
  </div>;
}

export function ResultsView({ outcome, publicView }: ResultsViewProps<PackPublicView>) {
  const players = publicView?.players ?? [], find = (id: string) => players.find(p => p.id === id);
  const champs = outcome.winners.map(find).filter(p => !!p), played = publicView?.played ?? [];
  return <section className="hj-results">
    <p className="hj-kicker">That’s a wrap!</p>
    <h1 className="kp-title">{champs.length ? champs.length === 1 ? `${champs[0]!.name} rules the night!` : 'Shared glory tonight!' : 'What a night!'}</h1>
    {champs.length > 0 && <div className="hj-results-champs">{champs.map(p => <span key={p.id}><Trophy /><Avatar avatar={p.avatar} color={p.color} size={120} mood="happy" /></span>)}</div>}
    <ol className="hj-results-rows" data-wide={outcome.rows.length > 5 || undefined} style={{ '--rows': Math.ceil(outcome.rows.length / 2) } as CSSProperties}>{outcome.rows.map(row => { const p = find(row.playerId); return p && <li key={row.playerId} data-top={row.rank === 1 || undefined}>
      <span className="kp-numeral">{row.rank ? ordinal(row.rank) : ''}</span><AvatarBadge player={p} size={48} mood={row.rank === 1 ? 'happy' : 'idle'} /><b>{row.label ?? row.score}</b></li>; })}</ol>
    {played.length > 0 && <p className="hj-note">Played tonight: {played.map(id => miniInfo(id)?.title ?? id).join(' · ')}</p>}
  </section>;
}
