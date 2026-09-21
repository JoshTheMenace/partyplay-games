import { useEffect, useRef, useState } from 'react';
import { ArcadeButton, Countdown, Eyebrow, Panel, StatusNotice, ToggleRow, type GameClientModule, type GameViewProps, type SettingsViewProps, type ResultsViewProps } from '../../../party-ui/src/index';
import { colors, defaults, packs, type Action, type CardView, type Color, type Face, type Pack, type PrivateView, type PublicView, type Settings } from './types';
import './styles.css';
type Props = GameViewProps<null, Action, PublicView, PrivateView>;
const symbols: Record<string, string> = { skip: '⊘', reverse: '⇄', '+2': '+2', wild: '✦', mission: '◆', eye: '◎', trade: '⇆', flip: '↻', mask: '?' };
const names: Record<string, string> = { skip: 'Skip', reverse: 'Reverse', '+2': 'Draw two', wild: 'Wild', mission: 'Mission', eye: 'Reveal', trade: 'Trade hands', flip: 'Flip', mask: 'Decoy' };
const glyphs = { coral: '●', sky: '◆', lime: '▲', sun: '✚', wild: '✦' };
const label = (c: Face) => `${c.color} ${names[c.value] ?? c.value}`;
function CardFace({ card }: { card: Face }) {
  return <span className="ichi-card" data-color={card.color}><span className="ichi-card-corner">{glyphs[card.color]} {card.color}</span><b>{symbols[card.value] ?? card.value}</b><span className="ichi-card-name">{names[card.value] ?? card.value}</span></span>;
}
function Header({ publicView: v, serverNowMs }: Props) {
  return <header className="ichi-header"><div><Eyebrow>Turn {v.turn + 1} / {v.settings.maxTurns} · {v.direction === 1 ? 'Clockwise ↻' : 'Counterclockwise ↺'}{v.settings.flip ? ` · Side ${v.side ? 'B' : 'A'}` : ''}</Eyebrow><h1 className="kp-display">ichi<span>.</span></h1></div><div className="ichi-timer"><Countdown deadline={v.deadline} serverNowMs={serverNowMs}/><small>seconds</small></div></header>;
}
function Table({ view: v }: { view: PublicView }) {
  const current = v.players.find(p => p.id === v.current)!;
  return <section className="ichi-table" aria-label="Discard pile"><div className="ichi-deck" aria-hidden="true"><span>一</span></div><div className="ichi-discard" key={`${v.topId}:${v.side}`}><CardFace card={v.top}/></div><div className="ichi-table-caption"><span className="ichi-color-tag" data-color={v.color}>{glyphs[v.color]} {v.color}</span><h2>{current.name}'s turn</h2><p>Match {v.color}{v.top.color !== 'wild' && ` or ${names[v.top.value] ?? v.top.value}`}</p><small>Next seat: {v.players[(v.players.findIndex(p => p.id === v.current) + v.direction + v.players.length) % v.players.length].name}</small></div></section>;
}
function Players({ view: v }: { view: PublicView }) {
  return <ol className="ichi-players" aria-label="Players">{v.players.map((p, index) => <li key={`${p.id}:${v.side}`} data-active={p.id === v.current}><span className="ichi-seat">{index + 1}</span><div><strong>{p.name}</strong><small>{!p.connected ? 'Reconnecting · timer continues' : p.count === 1 ? 'ICHI! One card left' : p.id === v.current ? 'Choosing a card' : 'Watching the table'}</small>{p.revealed.length > 0 && <div className="ichi-exposed" aria-label="Exposed cards">{p.revealed.map((c, i) => <span key={i} data-color={c.color} title={label(c)} aria-label={label(c)}>{glyphs[c.color]}{symbols[c.value] ?? c.value}</span>)}</div>}</div><b className="kp-numeral">{p.count}</b></li>)}</ol>;
}
function DisplayView(props: Props) {
  const v = props.publicView;
  return <main className="ichi ichi-display" data-dense-reveals={v.players.reduce((sum, p) => sum + p.revealed.length, 0) > 40}><Header {...props}/><div className="ichi-display-body"><div><Table view={v}/><div className="ichi-log" aria-live="polite">{v.log.map((line, i) => <p key={`${i}:${line}`}>{line}</p>)}</div></div><Players view={v}/></div><footer className="ichi-packs">{Object.entries(packs).filter(([key]) => v.settings[key as Pack]).map(([key, [name]]) => <span key={key}>{name}</span>)}{v.settings.drift && <strong>Drift in {2 - v.turn % 2} turns</strong>}</footer></main>;
}
function Controls(props: Props) {
  const { publicView: v, privateView: own, playerId } = props;
  const draftKey = `ichi:${props.roomId}:${props.roundId}:${playerId}`;
  type Choice = { turnId: string; cardId: string; color: Color; target: string };
  const [choice, setChoice] = useState<Choice | null>(() => { try { return JSON.parse(sessionStorage.getItem(draftKey) || 'null'); } catch { return null; } });
  const selected = choice?.turnId === v.turnId ? own?.hand.find(c => c.id === choice.cardId && c.playable) : null;
  const chosen = choice && colors.includes(choice.color) ? choice.color : 'coral', target = choice?.target ?? '';
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [showBack, setShowBack] = useState(false);
  const choiceRef = useRef<HTMLElement>(null), busy = useRef(false), myTurn = playerId === v.current;
  useEffect(() => { if (selected) choiceRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected?.id]);
  useEffect(() => { setShowBack(false); }, [v.side, v.transfers]);
  useEffect(() => { try { if (selected) sessionStorage.setItem(draftKey, JSON.stringify(choice)); else sessionStorage.removeItem(draftKey); } catch { /* A browser draft is optional. */ } }, [draftKey, choice, !!selected]);
  if (!own) return <StatusNotice>{playerId ? 'Waiting for your hand to reconnect.' : 'Watch the shared screen. Join the next round to play.'}</StatusNotice>;
  const disabled = pending || props.connected === false;
  async function send(action: Action) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { const result = await props.sendAction(action); if (!result.accepted) setError(result.reason ?? 'That move was not accepted.'); else { try { sessionStorage.removeItem(draftKey); } catch { /* Optional draft. */ } setChoice(null); } }
    catch { setError('Could not confirm your move. Reconnect and try again.'); }
    finally { busy.current = false; setPending(false); }
  }
  function play(c: CardView) {
    if (c.disguised) return void send({ kind: 'inspect', cardId: c.id, turnId: v.turnId });
    if (c.color === 'wild' || c.value === 'eye') { setChoice({ turnId: v.turnId, cardId: c.id, color: 'coral', target: v.players.find(p => p.id !== playerId)!.id }); return; }
    void send({ kind: 'play', cardId: c.id, turnId: v.turnId });
  }
  return <><div className="ichi-turn-banner" data-active={myTurn} aria-live="polite"><strong>{myTurn ? v.drawn ? 'Play your new card or pass' : 'Your turn. Make your move.' : `${v.players.find(p => p.id === v.current)!.name}'s turn`}</strong><span>{pending ? 'Sending move…' : myTurn ? 'Tap a highlighted card to play' : v.settings.jump ? 'An identical number? Tap to jump in.' : 'Plan your next move.'}</span></div>
    {props.connected === false && <StatusNotice>Reconnecting. Your hand is saved.</StatusNotice>}{error && <StatusNotice tone="error">{error}</StatusNotice>}
    {selected && <section ref={choiceRef} className="ichi-choice" aria-label="Card options"><h3>{selected.color === 'wild' ? 'Choose the next color' : 'Whose card will you reveal?'}</h3>{selected.color === 'wild' ? <div className="ichi-color-picker">{colors.map(color => <ArcadeButton key={color} tone={color} aria-pressed={chosen === color} onClick={() => choice && setChoice({ ...choice, color })}>{chosen === color ? '✓ ' : ''}{color}</ArcadeButton>)}</div> : <label className="ichi-target">Rival<select value={target} onChange={e => choice && setChoice({ ...choice, target: e.target.value })}>{v.players.filter(p => p.id !== playerId).map(p => <option key={p.id} value={p.id}>{p.name} · {p.count} cards</option>)}</select></label>}<ArcadeButton disabled={disabled} onClick={() => void send({ kind: 'play', turnId: v.turnId, cardId: selected.id, ...(selected.color === 'wild' ? { color: chosen } : { target }) })}>Play {names[selected.value]}</ArcadeButton><ArcadeButton tone="ghost" disabled={pending} onClick={() => setChoice(null)}>Cancel</ArcadeButton></section>}
    <div className="ichi-hand-heading"><h2>Your hand <span>{own.hand.length}</span></h2>{v.settings.flip && <ArcadeButton size="sm" tone="ghost" aria-pressed={showBack} onClick={() => setShowBack(!showBack)}>{showBack ? 'Show active side' : 'Preview flip side'}</ArcadeButton>}</div>
    {showBack && <p className="ichi-hint">Preview only. Return to the active side to play.</p>}
    <div className="ichi-hand" key={`${v.side}:${v.transfers}`} data-side={v.side} data-preview={showBack}>{[...own.hand].sort((a, b) => a.color.localeCompare(b.color) || a.value.localeCompare(b.value, undefined, { numeric: true })).map(c => <div className="ichi-hand-slot" key={c.id}><button className="ichi-card-button" disabled={disabled || showBack || !(c.playable || c.jumpable || c.disguised)} data-playable={c.playable || c.jumpable} aria-label={c.disguised ? `Inspect disguised card ${label(c)}` : `${c.jumpable ? 'Jump in: ' : 'Play '}${label(c)}${c.progress !== null && c.progress.length < 3 ? ', mission locked' : ''}`} onClick={() => play(c)}><CardFace card={showBack ? c.back : c}/></button>{c.disguised && <span className="ichi-card-note">Tap to inspect</span>}{(c.id === own.drawnId || c.id === own.mutatedId || c.jumpable) && <span className="ichi-card-note">{c.jumpable ? 'SLAP! Jump in' : c.id === own.drawnId ? 'New card' : 'Mutated'}</span>}{c.progress !== null ? <span className="ichi-card-note">{c.progress.length < 3 ? `Locked · ${c.progress.length}/3 colors` : 'Mission unlocked'}</span> : c.revealed ? <span className="ichi-card-note">Visible to everyone</span> : null}</div>)}</div>
    {own.hand.some(c => c.progress !== null && c.progress.length < 3) && <p className="ichi-hint">Mission: play three different colors. Collected: {own.hand.find(c => c.progress !== null && c.progress.length < 3)!.progress!.join(', ') || 'none yet'}. The locked card is a wild when complete.</p>}
    {myTurn && <div className="ichi-actions"><ArcadeButton tone="sun" disabled={disabled} onClick={() => void send({ kind: v.drawn ? 'pass' : 'draw', turnId: v.turnId })}>{v.drawn ? 'Pass turn' : own.hand.length >= 30 ? 'Pass · hand full' : 'Draw one card'}</ArcadeButton></div>}

  </>;
}
function ControllerView(props: Props) {
  const v = props.publicView;
  return <main className="ichi ichi-phone"><div className="ichi-phone-top"><span className="ichi-color-tag" data-color={v.color}>{glyphs[v.color]} {v.color}</span><strong>{v.top.color === 'wild' ? `Match ${v.color}` : `Match ${names[v.top.value] ?? v.top.value}`}</strong><Countdown deadline={v.deadline} serverNowMs={props.serverNowMs}/></div><Controls key={`${props.roundId}:${props.playerId}`} {...props}/><details className="ichi-phone-details"><summary>Table & recent moves</summary><Players view={v}/>{v.log.map((line, i) => <p key={i}>{line}</p>)}</details></main>;
}
function SettingsView({ settings, onChange, disabled }: SettingsViewProps<Settings>) {
  const s = { ...defaults, ...settings };
  return <div className="ichi ichi-settings"><p>Start with strategy, then mix in as much chaos as your table likes.</p><div className="ichi-presets"><ArcadeButton size="sm" tone="ghost" disabled={disabled} onClick={() => onChange({ ...s, ...Object.fromEntries(Object.keys(packs).map(k => [k, false])) })}>Classic</ArcadeButton><ArcadeButton size="sm" tone="sky" disabled={disabled} onClick={() => onChange({ ...defaults, handSize: s.handSize, turnSeconds: s.turnSeconds, maxTurns: s.maxTurns })}>Strategy</ArcadeButton><ArcadeButton size="sm" tone="coral" disabled={disabled} onClick={() => onChange({ ...s, ...Object.fromEntries(Object.keys(packs).map(k => [k, true])) })}>Everything</ArcadeButton></div><div className="ichi-settings-grid">{Object.entries(packs).map(([key, [name, description]]) => <Panel key={key}><ToggleRow label={name} checked={s[key as Pack]} disabled={disabled} onChange={value => onChange({ ...s, [key]: value })}/><p>{description}</p></Panel>)}</div><div className="ichi-config">{([['handSize', 'Starting cards', [5,7,9]], ['turnSeconds', 'Seconds per turn', [15,30,45]], ['maxTurns', 'Round turn limit', [80,160,240]]] as const).map(([key, title, options]) => <label key={key}>{title}<select value={s[key]} disabled={disabled} onChange={e => onChange({ ...s, [key]: Number(e.target.value) })}>{options.map(n => <option key={n}>{n}</option>)}</select></label>)}</div></div>;
}
function Instructions() {
  return <div className="ichi"><p>Match the discard’s color or symbol. Wilds choose the next color. Empty your hand to win; “Ichi!” is called automatically when you have one card.</p><p>You may draw even with a playable card. After drawing, play only the new card or pass. Draw two and Decoy skip the next player; penalties never stack. Reverse acts as Skip with two players.</p><p>Strategy mode starts with missions and reveal cards. Missions unlock after playing three different colors. Other packs are optional in Settings. A trade passes every hand in the direction of play, including an empty hand, so the recipient can win!</p><p>The timer draws and passes for missing players. Hands hold at most 30 cards. At the turn limit, fewest cards wins and ties share the win. A shared screen and 2–10 phone players are required.</p></div>;
}
function ResultsView({ publicView: v, outcome }: ResultsViewProps<PublicView>) {
  return <div className="ichi ichi-results"><Eyebrow>Round complete</Eyebrow><h2 className="kp-display">{outcome.winners.map(id => v.players.find(p => p.id === id)!.name).join(' & ')} {outcome.winners.length > 1 ? 'win' : 'wins'}!</h2><p>{v.finishReason}</p><ol>{outcome.rows.map(row => <li key={row.playerId}><span>#{row.rank}</span><strong>{v.players.find(p => p.id === row.playerId)!.name}</strong><span>{row.label}</span></li>)}</ol><p>The host can replay with the same packs or return to the lobby to remix them.</p></div>;
}
export const client: GameClientModule<null, Action, Settings, PublicView, PrivateView> = { DisplayView, ControllerView, SettingsView, InstructionsView: Instructions, ResultsView, settingsWide: true, prepare() {}, dispose() {} };
export default client;
