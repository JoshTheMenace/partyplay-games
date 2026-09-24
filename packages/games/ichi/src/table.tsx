import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameViewProps } from '../../../party-ui/src/index';
import { houseRules, type Action, type GameEvent, type HouseRule, type PrivateView, type PublicView } from './types';
import { CardBack, CardFace, ColorChip, Emblem, art, cardLabel, colorName, tilt } from './cards';
import { play as sfx, type Sfx } from './sfx';

export type Props = GameViewProps<null, Action, PublicView, PrivateView>;
type Spot = { x: number; y: number };
type Fx = { id: number; kind: 'backs' | 'bubble' | 'splash' | 'burst'; at?: Spot; n?: number; text?: string; sub?: string; tone?: string };
const DECK: Spot = { x: 38, y: 47 }, PILE: Spot = { x: 50, y: 47 };
/** Seat i of n on the table oval, seat 0 at the bottom, increasing clockwise (direction 1). */
const seatSpot = (i: number, n: number): Spot => { const a = Math.PI / 2 + i * 2 * Math.PI / n; return { x: 50 + 38.5 * Math.cos(a), y: 50 + 38.5 * Math.sin(a) }; };
const maxSeq = (events: GameEvent[]) => events.reduce((m, e) => Math.max(m, e.seq), 0);
const css = (vars: Record<string, string | number>) => vars as CSSProperties;
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useNow(serverNowMs: () => number, ms = 250) {
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => { const timer = setInterval(() => setNow(serverNowMs()), ms); return () => clearInterval(timer); }, [serverNowMs, ms]);
  return now;
}
export function TimerRing({ deadline, total, now, label = 'Seconds remaining' }: { deadline: number; total: number; now: number; label?: string }) {
  const left = Math.max(0, deadline - now), share = Math.min(1, left / Math.max(total, left, 1));
  return <span className="ichi-timer" data-low={left < 5500}><svg viewBox="0 0 40 40" aria-hidden="true"><circle className="track" cx="20" cy="20" r="17"/><circle className="drain" cx="20" cy="20" r="17" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - share * 100}/></svg><output className="kp-numeral" aria-label={label}>{Math.ceil(left / 1000)}</output></span>;
}

export const Clock = ({ deadline, total, serverNowMs }: { deadline: number; total: number; serverNowMs(): number }) => <TimerRing deadline={deadline} total={total} now={useNow(serverNowMs)}/>;

/** Turns new events (by seq) into short-lived flourishes. Events present at mount are history, not replayed. */
function useEventFx(v: PublicView, seat: (id?: string) => Spot | null) {
  const seen = useRef(maxSeq(v.events)), mountSeq = useRef(seen.current).current;
  const [items, setItems] = useState<Fx[]>([]);
  const timers = useRef(new Set<number>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const fresh = v.events.filter(e => e.seq > seen.current);
    if (!fresh.length) return;
    seen.current = maxSeq(fresh);
    const add: Fx[] = [], sounds = new Set<Sfx>();
    let pile = 0; // biggest penalty in this batch; the thud rises with it
    fresh.forEach((e, k) => {
      const id = e.seq * 16 + k, at = seat(e.playerId), victim = seat(e.targetId ?? e.playerId);
      const push = (f: Omit<Fx, 'id'>, offset = 0) => add.push({ id: id + offset / 100, ...f });
      if (e.kind === 'deal') { v.players.forEach((_, i) => push({ kind: 'backs', at: seatSpot(i, v.players.length), n: 3 }, i)); sounds.add('swish'); }
      if (e.kind === 'play' || e.kind === 'jump' || e.kind === 'stack') { sounds.add('flick'); if (e.kind === 'jump') push({ kind: 'splash', text: 'Jump in!', sub: e.text, tone: 'sky' }); }
      if ((e.kind === 'draw' || e.kind === 'penalty') && at && e.count) { push({ kind: 'backs', at, n: Math.min(e.count, 8) }); sounds.add(e.kind === 'penalty' ? 'thud' : 'swish'); if (e.kind === 'penalty') pile = Math.max(pile, e.count); }
      if (e.kind === 'penalty' && at && e.count) push({ kind: 'bubble', at, text: `+${e.count}`, tone: 'coral' }, 1);
      if (e.kind === 'skip' && victim) push({ kind: 'bubble', at: victim, text: 'Skipped', tone: 'sun' });
      if (e.kind === 'timeout' && at) push({ kind: 'bubble', at, text: 'Time!', tone: 'sun' });
      if (e.kind === 'reverse') { push({ kind: 'splash', text: 'Reverse!', sub: e.text, tone: 'lime' }); sounds.add('swish'); }
      // A stacked +4 already has its splash; the burst and felt wash carry the new color.
      if (e.kind === 'color') { push({ kind: 'burst', at: PILE, tone: v.color }); if (!add.some(f => f.kind === 'splash')) push({ kind: 'splash', text: `${colorName[v.color]}!`, tone: v.color }, 1); }
      if (e.kind === 'stack') { push({ kind: 'splash', text: `Stack!${v.pending ? ` +${v.pending.count}` : ''}`, sub: e.text, tone: 'coral' }); sounds.add('thud'); pile = Math.max(pile, v.pending?.count ?? 0); }
      if (e.kind === 'challenge') { push({ kind: 'splash', text: e.success ? 'Bluff caught!' : 'Challenge failed', sub: e.text, tone: e.success ? 'lime' : 'coral' }); sounds.add('alarm'); }
      if (e.kind === 'swap' || e.kind === 'rotate') { push({ kind: 'splash', text: e.kind === 'swap' ? 'Hands swapped!' : 'Hands pass!', sub: e.text, tone: 'grape' }); sounds.add('swish'); }
      if (e.kind === 'ichi') { push({ kind: 'splash', text: 'Ichi!', sub: e.text, tone: 'sun' }); sounds.add('chime'); }
      if (e.kind === 'catch') { push({ kind: 'splash', text: 'Caught!', sub: e.text, tone: 'coral' }); if (victim) { push({ kind: 'bubble', at: victim, text: `+${e.count ?? 2}`, tone: 'coral' }, 1); push({ kind: 'backs', at: victim, n: e.count ?? 2 }, 2); } sounds.add('alarm'); }
      if (e.kind === 'handEnd') { sounds.add('chime'); if (at && !v.handResult?.hands.find(h => h.playerId === e.playerId)?.cards.length) { push({ kind: 'burst', at, tone: 'sun' }); push({ kind: 'splash', text: `${v.players.find(p => p.id === e.playerId)?.name} goes out!`, tone: 'sun' }, 1); } }
    });
    sounds.forEach(k => sfx(k, pile));
    if (!add.length) return;
    setItems(list => [...list, ...add].slice(-30));
    for (const f of add) {
      const timer = window.setTimeout(() => { timers.current.delete(timer); setItems(list => list.filter(x => x.id !== f.id)); }, f.kind === 'splash' ? 1800 : 1300);
      timers.current.add(timer);
    }
  }, [v.events]);
  return { items, mountSeq };
}

function Seat({ v, i, spot }: { v: PublicView; i: number; spot: Spot }) {
  const p = v.players[i], n = v.players.length, cur = v.players.findIndex(q => q.id === v.current);
  const playing = v.phase === 'playing', current = playing && p.id === v.current, next = playing && !current && (cur + v.direction + n) % n === i;
  const exposed = v.ichiWindow?.playerId === p.id, fan = Math.min(p.count, 3), incoming = current && v.pending;
  const tag = !p.connected ? 'Reconnecting' : incoming ? `+${v.pending!.count} incoming` : current ? 'Playing' : next ? 'Next' : '';
  return <li className="ichi-seat" style={css({ left: `${spot.x}%`, top: `${spot.y}%`, '--seat': p.color })} data-current={current} data-next={next} data-offline={!p.connected} data-exposed={exposed} data-incoming={!!incoming}
    aria-label={`${p.name}, ${p.count} ${p.count === 1 ? 'card' : 'cards'}, ${p.score} points${p.safe && p.count === 1 ? ', safe on Ichi' : ''}${tag ? `, ${tag.toLowerCase()}` : ''}`}>
    <span className="ichi-seat-fan" aria-hidden="true">{Array.from({ length: fan }, (_, k) => <CardBack key={k} style={css({ '--r': `${(k - (fan - 1) / 2) * 14}deg` })}/>)}<b className="kp-numeral">{p.count}</b></span>
    <span className="ichi-seat-text"><strong>{p.name}</strong>{v.settings.target > 0 && <span><b className="kp-numeral">{p.score}</b> pts{p.handsWon > 0 && <i aria-hidden="true">{'●'.repeat(Math.min(p.handsWon, 5))}</i>}</span>}</span>
    {tag && <span className="ichi-seat-tag">{tag}</span>}
    {(p.safe && p.count === 1 || exposed) && <span className="ichi-hanko" data-exposed={exposed}>{exposed ? 'One card!' : 'Ichi!'}</span>}
  </li>;
}

function Intermission({ v, now }: { v: PublicView; now: number }) {
  // The tally waits 1.5 s (CSS delay on .ichi-overlay-late) so the winning card and "goes out" splash are seen first.
  const r = v.handResult!, [t, setT] = useState(() => reducedMotion() ? 1 : 0);
  useEffect(() => { if (t >= 1) return; const start = performance.now() + 1500; let frame = requestAnimationFrame(function step(time) { const k = Math.min(1, Math.max(0, (time - start) / 1600)); setT(k); if (k < 1) frame = requestAnimationFrame(step); }); return () => cancelAnimationFrame(frame); }, [v.handId]);
  const winner = v.players.find(p => p.id === r.winnerId), target = v.settings.target;
  const rows = [...v.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return <section className="ichi-overlay ichi-overlay-late" aria-label="Hand results">
    <div className="ichi-tally">
      <header><Emblem color="wild"/><div><h2 className="kp-display">{winner ? `${winner.name} wins hand ${v.hand}` : `Hand ${v.hand} ends`}</h2><p>{r.reason}{winner && <> · <b className="kp-numeral">+{Math.round(r.points * t)}</b> points</>}</p></div>
        {v.nextHandAt && <div className="ichi-next"><span className="kp-numeral">{Math.max(0, Math.ceil((v.nextHandAt - now) / 1000))}</span><small>{v.ready.length}/{v.players.filter(p => p.connected).length} ready</small></div>}</header>
      <ol>{rows.map(p => { const h = r.hands.find(x => x.playerId === p.id), cards = h?.cards ?? [], ready = v.ready.includes(p.id);
        return <li key={p.id} data-winner={p.id === r.winnerId} style={css({ '--seat': p.color })}>
          <span className="ichi-ready" data-ready={ready} aria-label={ready ? 'Ready' : 'Not ready'}>{ready ? '✓' : ''}</span>
          <strong>{p.name}</strong>
          <span className="ichi-leftover" style={css({ '--n': Math.max(cards.length, 1) })} aria-label={cards.length ? cards.map(cardLabel).join(', ') : 'No cards left'}>{p.id === r.winnerId && !cards.length ? <em>Went out</em> : cards.map((c, k) => <CardFace key={c.id} card={c} className={k / cards.length < t ? 'is-in' : ''}/>)}</span>
          <span className="ichi-leftover-points kp-numeral">{p.id === r.winnerId ? `+${Math.round(r.points * t)}` : h?.points ? Math.round(h.points * t) : '–'}</span>
          <span className="ichi-bar" aria-hidden="true"><i style={{ width: `${target ? Math.min(100, p.score / target * 100) : p.id === r.winnerId ? 100 : 0}%` }}/></span>
          <b className="kp-numeral">{p.score}</b>
        </li>; })}</ol>
      <p className="ichi-tally-foot">{target ? `First to ${target} points wins the match.` : 'One hand decides the match.'} Tap Next hand on your phone to skip ahead.</p>
    </div>
  </section>;
}

export function DisplayView({ publicView: v, serverNowMs }: Props) {
  const now = useNow(serverNowMs), n = v.players.length, spots = v.players.map((_, i) => seatSpot(i, n));
  const seat = (id?: string) => { const i = v.players.findIndex(p => p.id === id); return i < 0 ? null : spots[i]; };
  const { items, mountSeq } = useEventFx(v, seat);
  const current = v.players.find(p => p.id === v.current), name = (id?: string | null) => v.players.find(p => p.id === id)?.name ?? 'Someone';
  const plays = v.events.filter(e => (e.kind === 'play' || e.kind === 'jump' || e.kind === 'stack') && e.card);
  const last = plays.at(-1), from = last && last.card!.id === v.top.id && last.seq > mountSeq ? seat(last.playerId) : null;
  const under = plays.filter(e => e.card!.id !== v.top.id).slice(-Math.min(3, Math.max(0, v.discardCount - 1))).map(e => e.card!);
  const rules = (Object.keys(houseRules) as HouseRule[]).filter(k => v.settings[k]);
  const splash = items.filter(f => f.kind === 'splash').at(-1), win = v.ichiWindow;
  const playing = v.phase === 'playing';
  return <main className="ichi ichi-display" data-phase={v.phase} data-art={art.table} style={css({ '--table': `url(${art.base}table.webp)` })}>
    <div className="ichi-stage">
      <span className="ichi-wash" key={v.color} data-color={v.color} aria-hidden="true"/>
      <div className="ichi-orbit" data-dir={v.direction} aria-hidden="true">{[0, 1, 2, 3].map(k => <span key={k} style={css({ '--k': k })}/>)}</div>
      <div className="ichi-hud"><strong className="kp-display">Hand {v.hand}</strong><span>{v.settings.target ? `First to ${v.settings.target}` : 'One-hand match'}</span><span className="ichi-dir" data-dir={v.direction}>{v.direction === 1 ? 'Clockwise' : 'Counter-clockwise'}</span>{rules.length > 0 && <span className="ichi-rules">{rules.map(k => <em key={k}>{houseRules[k][0]}</em>)}</span>}</div>
      <ol className="ichi-seats" aria-label="Players">{v.players.map((p, i) => <Seat key={p.id} v={v} i={i} spot={spots[i]}/>)}</ol>
      <div className="ichi-deck" style={css({ left: `${DECK.x}%`, top: `${PILE.y}%` })} aria-label={`Draw pile, ${v.drawCount} cards`}><CardBack/><CardBack/><CardBack/><span className="kp-numeral">{v.drawCount}</span></div>
      <div className="ichi-pile" style={css({ left: `${PILE.x}%`, top: `${PILE.y}%` })} data-color={v.color} aria-label={`Discard pile: ${cardLabel(v.top)}. Active color ${v.color}.`}>
        <span className="ichi-halo" aria-hidden="true"/>
        {under.map(c => <span key={c.id} className="ichi-under" style={css({ '--r': `${tilt(c.id, 18)}deg` })}><CardFace card={c}/></span>)}
        <span className="ichi-top" key={v.top.id} data-fly={!!from} style={css({ '--r': `${tilt(v.top.id, 6)}deg`, '--dx': from ? from.x - PILE.x : 0, '--dy': from ? from.y - PILE.y : 0 })}><CardFace card={v.top}/></span>
        {v.pending && <span className="ichi-stack" key={v.pending.count} style={css({ '--n': v.pending.count })} aria-label={`${v.pending.count} cards pending`}>+{v.pending.count}</span>}
        <ColorChip color={v.color}/>
      </div>
      {playing && current && <div className="ichi-turn" style={css({ '--seat': current.color })}>
        <TimerRing deadline={v.deadline} total={current.connected ? v.settings.turnSeconds * 1000 : 5000} now={now}/>
        <strong>{current.name}</strong>
        <span>{v.pending ? v.pending.challengeable && v.settings.challenge ? `Stack, challenge or draw ${v.pending.count}` : `Stack or draw ${v.pending.count}` : v.drawn ? 'Play the new card or keep it' : !current.connected ? 'Reconnecting… turn will pass' : 'to play'}</span>
      </div>}
      <div className="ichi-fx" aria-hidden="true">{items.map(f => f.kind === 'backs' ? Array.from({ length: f.n! }, (_, k) => <CardBack key={`${f.id}:${k}`} className="ichi-fly-back" style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%`, '--dx': DECK.x - f.at!.x, '--dy': DECK.y - f.at!.y, '--d': `${k * 70}ms` })}/>)
        : f.kind === 'bubble' ? <span key={f.id} className="ichi-bubble" data-tone={f.tone} data-below={f.at!.y < 30} style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%` })}>{f.text}</span>
        : f.kind === 'burst' ? <span key={f.id} className="ichi-burst" data-color={f.tone} style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%` })}/> : null)}</div>
      {win && playing && <div className="ichi-window" role="alert"><strong className="kp-display">Ichi race!</strong><span>{name(win.playerId)} has one card!</span><i style={{ width: `${Math.max(0, Math.min(100, (win.until - now) / 50))}%` }}/></div>}
      {splash && <div className="ichi-splash" key={splash.id} data-tone={splash.tone} role="status"><strong className="kp-display">{splash.text}</strong>{splash.sub && <span>{splash.sub}</span>}</div>}
      <ol className="ichi-ticker" aria-label="Recent moves" aria-live="polite">{v.events.slice(-3).map(e => <li key={e.seq}>{e.text}</li>)}</ol>
      {v.phase === 'intermission' && v.handResult && <Intermission v={v} now={now}/>}
      {v.phase === 'complete' && <section className="ichi-overlay ichi-overlay-late" aria-label="Match over"><div className="ichi-tally ichi-final"><Emblem color="wild"/><h2 className="kp-display">{v.winners.map(id => name(id)).join(' & ')} {v.winners.length > 1 ? 'share the win' : 'wins the match'}</h2><p>{v.finishReason}</p></div></section>}
    </div>
  </main>;
}
