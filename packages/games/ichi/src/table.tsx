import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameViewProps } from '../../../party-ui/src/index';
import { houseRules, type Action, type GameEvent, type HouseRule, type PrivateView, type PublicView, type RosterEntry, type TableView } from './types';
import { CardBack, CardFace, ColorChip, Emblem, art, cardLabel, colorName, tilt } from './cards';
import { play as sfx, type Sfx } from './sfx';

export type Props = GameViewProps<null, Action, PublicView, PrivateView>;
/** A place on the stage in percent, and the angle from the table's middle (90 is straight down). */
type Spot = { x: number; y: number; a: number };
type Fx = { id: number; kind: 'backs' | 'gift' | 'bubble' | 'splash' | 'burst' | 'petals' | 'stamp'; at?: Spot; from?: Spot; n?: number; text?: string; sub?: string; tone?: string };
const DECK: Spot = { x: 39, y: 47, a: 0 }, PILE: Spot = { x: 50, y: 47, a: 0 };
/** Seat i of n on the table oval, seat 0 at the bottom, increasing clockwise (direction 1). Name plates sit on the rim, hands on the felt in front of them. */
const seatSpot = (i: number, n: number, rx = 38.5, ry = 38.5): Spot => { const a = 90 + i * 360 / n, r = a * Math.PI / 180; return { x: 50 + rx * Math.cos(r), y: 50 + ry * Math.sin(r), a }; };
/** The parlor's stage is narrower, so its hands sit closer in and its plates stay clear of them. */
const handSpot = (i: number, n: number, parlor = false) => seatSpot(i, n, parlor ? 23 : 26, 28.5);
const maxSeq = (events: GameEvent[]) => events.reduce((m, e) => Math.max(m, e.seq), 0);
export const css = (vars: Record<string, string | number>) => vars as CSSProperties;
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** Place by score, ties sharing it. */
export const rankOf = (roster: RosterEntry[], p: number) => 1 + roster.filter(o => o.score > roster[p].score).length;
const standings = (roster: RosterEntry[]) => roster.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score || b.handsWon - a.handsWon || a.i - b.i);

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
export const Bell = () => <svg className="ichi-bell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6c-.9 0-1.6.7-1.6 1.6v.5C7.6 5.5 5.9 8 5.9 10.9v3.6L4 17.4v1.1h16v-1.1l-1.9-2.9v-3.6c0-2.9-1.7-5.4-4.5-6.2v-.5c0-.9-.7-1.6-1.6-1.6zM9.9 19.6a2.1 2.1 0 0 0 4.2 0z"/></svg>;

/** Turns new events (by seq) into short-lived flourishes. Events present at mount are history, not replayed, so a camera cut never re-fires a table's past. */
function useEventFx(t: TableView, roster: RosterEntry[], plate: (p?: number) => Spot | null, hand: (p?: number) => Spot | null, hands: Spot[]) {
  const seen = useRef(maxSeq(t.events)), mountSeq = useRef(seen.current).current;
  const [items, setItems] = useState<Fx[]>([]), [spin, setSpin] = useState(0);
  const timers = useRef(new Set<number>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const fresh = t.events.filter(e => e.seq > seen.current);
    if (!fresh.length) return;
    seen.current = maxSeq(fresh);
    const add: Fx[] = [], sounds = new Set<Sfx>();
    let pile = 0; // biggest penalty in this batch; the thud rises with it
    fresh.forEach((e, k) => {
      const id = e.seq * 16 + k, at = plate(e.by), fan = hand(e.by), victim = plate(e.to ?? e.by), name = roster[e.by ?? -1]?.name ?? 'Someone';
      const push = (f: Omit<Fx, 'id'>, offset = 0) => add.push({ id: id + offset / 100, ...f });
      const splash = (text: string, tone: string, sub: string | undefined = e.text) => push({ kind: 'splash', text, sub, tone }, 9);
      if (e.kind === 'deal') { hands.forEach((at, i) => push({ kind: 'backs', at, n: 4 }, i)); sounds.add('swish'); }
      if (e.kind === 'play' || e.kind === 'jump' || e.kind === 'stack') { sounds.add('flick'); if (e.kind === 'jump') splash('Jump in!', 'sky'); }
      if ((e.kind === 'draw' || e.kind === 'penalty') && fan && e.count) { push({ kind: 'backs', at: fan, n: Math.min(e.count, 8) }); sounds.add(e.kind === 'penalty' ? 'thud' : 'swish'); if (e.kind === 'penalty') pile = Math.max(pile, e.count); }
      if (e.kind === 'penalty' && at && e.count) push({ kind: 'bubble', at, text: `+${e.count}`, tone: 'coral' }, 1);
      if (e.kind === 'skip' && victim) push({ kind: 'bubble', at: victim, text: 'Skipped', tone: 'sun' });
      if (e.kind === 'timeout' && at) push({ kind: 'bubble', at, text: 'Time!', tone: 'sun' });
      if (e.kind === 'reverse') { splash('Reverse!', 'lime'); setSpin(n => n + 1); sounds.add('swish'); }
      // A stacked +4 already has its splash; the burst and felt wash carry the new color.
      if (e.kind === 'color') { push({ kind: 'burst', at: PILE, tone: t.color }); if (!add.some(f => f.kind === 'splash')) splash(`${colorName[t.color]}!`, t.color, undefined); }
      if (e.kind === 'stack') { splash(`Stack!${t.pending ? ` +${t.pending.count}` : ''}`, 'coral'); sounds.add('thud'); pile = Math.max(pile, t.pending?.count ?? 0); }
      if (e.kind === 'challenge') { splash(e.success ? 'Bluff caught!' : 'Challenge failed', e.success ? 'lime' : 'coral'); sounds.add('alarm'); }
      if (e.kind === 'swap' || e.kind === 'rotate') { splash(e.kind === 'swap' ? 'Hands swapped!' : 'Hands pass!', 'grape'); sounds.add('swish'); }
      if (e.kind === 'gift' && fan && hand(e.to)) { push({ kind: 'gift', from: fan, at: hand(e.to)! }); if (victim) push({ kind: 'bubble', at: victim, text: 'Gift!', tone: 'grape' }, 1); splash('A gift!', 'grape'); sounds.add('chime'); }
      if (e.kind === 'ichi') { const called = /race/.test(e.text); if (at && called) push({ kind: 'stamp', at }); splash(called ? 'Ichi!' : 'Safe!', 'sun'); sounds.add('chime'); }
      if (e.kind === 'catch') { splash('Caught!', 'coral'); if (victim) { push({ kind: 'bubble', at: victim, text: `+${e.count ?? 2}`, tone: 'coral' }, 1); push({ kind: 'backs', at: hand(e.to) ?? victim, n: e.count ?? 2 }, 2); } sounds.add('alarm'); }
      if (e.kind === 'bell') { splash('Last turn!', 'sun'); sounds.add('bell'); }
      if (e.kind === 'handEnd') { sounds.add('chime'); if (at) { push({ kind: 'petals', at }); push({ kind: 'burst', at, tone: 'sun' }, 1); splash(t.handResult?.hands.find(h => h.p === e.by)?.cards.length ? `${name} takes it!` : `${name} goes out!`, 'sun', undefined); } }
    });
    sounds.forEach(k => sfx(k, pile));
    if (!add.length) return;
    setItems(list => [...list, ...add].slice(-40));
    for (const f of add) {
      const timer = window.setTimeout(() => { timers.current.delete(timer); setItems(list => list.filter(x => x.id !== f.id)); }, f.kind === 'splash' ? 1800 : f.kind === 'petals' || f.kind === 'stamp' ? 1700 : 1300);
      timers.current.add(timer);
    }
  }, [t.events]);
  return { items, mountSeq, spin };
}

/** A hand lying face down on the felt: one back per card up to twelve, fanned toward the middle of the table. */
function Fan({ count, spot, small }: { count: number; spot: Spot; small: boolean }) {
  const shown = Math.min(count, 12);
  return <span className="ichi-fan" data-small={small} style={css({ left: `${spot.x}%`, top: `${spot.y}%`, '--rot': `${spot.a - 90}deg`, '--n': shown })}>{Array.from({ length: shown }, (_, k) => <CardBack key={k} style={css({ '--k': k })}/>)}</span>;
}

function Seat({ v, t, i, spot, now, total }: { v: PublicView; t: TableView; i: number; spot: Spot; now: number; total: number }) {
  const seat = t.seats[i], p = v.roster[seat.p], n = t.seats.length, cur = t.seats.findIndex(s => s.p === t.current);
  const playing = t.phase === 'playing', current = playing && seat.p === t.current, next = playing && !current && (cur + t.direction + n) % n === i;
  const exposed = t.ichiWindow?.p === seat.p, incoming = current && t.pending, scored = v.match.parlor || v.settings.target > 0;
  const tag = !p.connected ? 'Reconnecting' : incoming ? `+${t.pending!.count} incoming` : current ? 'Playing' : next ? 'Next' : '';
  return <li className="ichi-seat" style={css({ left: `${spot.x}%`, top: `${spot.y}%`, '--seat': p.color })} data-current={current} data-next={next} data-offline={!p.connected} data-exposed={exposed} data-incoming={!!incoming} data-low={playing && seat.count <= 2}
    aria-label={`${p.name}, ${seat.count} ${seat.count === 1 ? 'card' : 'cards'}, ${p.score} points${seat.safe && seat.count === 1 ? ', safe on Ichi' : ''}${tag ? `, ${tag.toLowerCase()}` : ''}`}>
    <b className="ichi-seat-count kp-numeral" key={seat.count} aria-hidden="true">{seat.count}</b>
    <span className="ichi-seat-text"><strong>{p.name}</strong>{scored && <span><b className="kp-numeral">{p.score}</b> pts{p.handsWon > 0 && <i aria-hidden="true">{'●'.repeat(Math.min(p.handsWon, 5))}</i>}</span>}</span>
    {current && <TimerRing deadline={t.deadline} total={p.connected ? total : 5000} now={now}/>}
    {tag && <span className="ichi-seat-tag">{tag}</span>}
    {(seat.safe && seat.count === 1 || exposed) && <span className="ichi-hanko" data-exposed={exposed}>{exposed ? 'One card!' : 'Ichi!'}</span>}
  </li>;
}

function Tally({ v, t, now }: { v: PublicView; t: TableView; now: number }) {
  // The tally waits 1.5 s (CSS delay on .ichi-overlay-late) so the winning card and "goes out" splash are seen first.
  const r = t.handResult!, [k, setK] = useState(() => reducedMotion() ? 1 : 0);
  useEffect(() => { if (k >= 1) return; const start = performance.now() + 1500; let frame = requestAnimationFrame(function step(time) { const done = Math.min(1, Math.max(0, (time - start) / 1600)); setK(done); if (done < 1) frame = requestAnimationFrame(step); }); return () => cancelAnimationFrame(frame); }, [t.handId]);
  const winner = v.roster[r.winner ?? -1], target = v.match.parlor ? 0 : v.settings.target, best = Math.max(1, ...t.seats.map(s => v.roster[s.p].score));
  const rows = [...t.seats].sort((a, b) => v.roster[b.p].score - v.roster[a.p].score || v.roster[a.p].name.localeCompare(v.roster[b.p].name));
  return <section className="ichi-overlay ichi-overlay-late" aria-label="Hand results">
    <div className="ichi-tally">
      <header><Emblem color="wild"/><div><h2 className="kp-display">{winner ? `${winner.name} wins hand ${t.hand}` : `Hand ${t.hand} ends`}</h2><p>{r.reason}{winner && <> · <b className="kp-numeral">+{Math.round(r.points * k)}</b> points</>}</p></div>
        {t.nextHandAt && <div className="ichi-next"><span className="kp-numeral">{Math.max(0, Math.ceil((t.nextHandAt - now) / 1000))}</span><small>{t.ready.length}/{t.seats.filter(s => v.roster[s.p].connected).length} ready</small></div>}</header>
      <ol>{rows.map(({ p: i }) => { const p = v.roster[i], h = r.hands.find(x => x.p === i), cards = h?.cards ?? [], ready = t.ready.includes(i);
        return <li key={i} data-winner={i === r.winner} style={css({ '--seat': p.color })}>
          <span className="ichi-ready" data-ready={ready} aria-label={ready ? 'Ready' : 'Not ready'}>{ready ? '✓' : ''}</span>
          <strong>{p.name}</strong>
          <span className="ichi-leftover" style={css({ '--n': Math.max(cards.length, 1) })} aria-label={cards.length ? cards.map(cardLabel).join(', ') : 'No cards left'}>{i === r.winner && !cards.length ? <em>Went out</em> : cards.map((c, n) => <CardFace key={c.id} card={c} className={n / cards.length < k ? 'is-in' : ''}/>)}</span>
          <span className="ichi-leftover-points kp-numeral">{i === r.winner ? `+${Math.round(r.points * k)}` : h?.points ? Math.round(h.points * k) : '–'}</span>
          <span className="ichi-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, p.score / (target || best) * 100)}%` }}/></span>
          <b className="kp-numeral">{p.score}</b>
        </li>; })}</ol>
      <p className="ichi-tally-foot">{v.match.parlor ? t.nextHandAt ? 'Another hand before the bell. Tap Next hand on your phone to skip ahead.' : 'This table is done for the round.' : `${target ? `First to ${target} points wins the match.` : 'One hand decides the match.'} Tap Next hand on your phone to skip ahead.`}</p>
    </div>
  </section>;
}

/** One table, as the TV shows it. Keyed by table and round, so a cut remounts it and its hands fan in. */
function Table({ v, t, now }: { v: PublicView; t: TableView; now: number }) {
  const n = t.seats.length, m = v.match, plates = t.seats.map((_, i) => seatSpot(i, n, m.parlor ? 35.5 : 38.5)), hands = t.seats.map((_, i) => handSpot(i, n, m.parlor));
  const at = (p?: number) => t.seats.findIndex(s => s.p === p), plate = (p?: number) => plates[at(p)] ?? null, hand = (p?: number) => hands[at(p)] ?? null;
  const { items, mountSeq, spin } = useEventFx(t, v.roster, plate, hand, hands);
  const current = v.roster[t.current], name = (p?: number | null) => v.roster[p ?? -1]?.name ?? 'Someone', playing = t.phase === 'playing';
  const plays = t.events.filter(e => (e.kind === 'play' || e.kind === 'jump' || e.kind === 'stack') && e.card);
  const last = plays.at(-1), from = last && last.card!.id === t.top.id && last.seq > mountSeq ? hand(last.by) : null;
  const under = plays.filter(e => e.card!.id !== t.top.id).slice(-Math.min(5, Math.max(0, t.discardCount - 1))).map(e => e.card!);
  const rules = (Object.keys(houseRules) as HouseRule[]).filter(k => v.settings[k]);
  const splash = items.filter(f => f.kind === 'splash').at(-1), win = t.ichiWindow, lit = playing && win ? plate(win.p) : null, beam = playing && !win ? plate(t.current) : null;
  const total = (t.lap !== null ? Math.min(v.settings.turnSeconds, 12) : v.settings.turnSeconds) * 1000;
  return <div className="ichi-table" data-felt={m.parlor ? t.id % 6 : 0} data-phase={t.phase} data-seats={n}>
    <span className="ichi-felt" aria-hidden="true"/>
    <span className="ichi-wash" key={t.color} data-color={t.color} aria-hidden="true"/>
    {beam && <svg className="ichi-beam" key={t.current} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={css({ '--seat': current.color })}><polygon points={`${PILE.x},${PILE.y} ${beam.x - (beam.y - PILE.y) * .16},${beam.y + (beam.x - PILE.x) * .16} ${beam.x + (beam.y - PILE.y) * .16},${beam.y - (beam.x - PILE.x) * .16}`}/></svg>}
    <div className="ichi-orbit" key={`orbit${spin}`} data-dir={t.direction} data-spin={spin > 0} aria-hidden="true">{[0, 1, 2, 3].map(k => <span key={k} style={css({ '--k': k })}/>)}</div>
    <div className="ichi-hud">{m.parlor ? <><strong className="kp-display">Table {t.id + 1}</strong><span>Hand {t.hand} this round</span></> : <><strong className="kp-display">Hand {t.hand}</strong><span>{v.settings.target ? `First to ${v.settings.target}` : 'One-hand match'}</span></>}
      <span className="ichi-dir" data-dir={t.direction}>{t.direction === 1 ? 'Clockwise' : 'Counter-clockwise'}</span>{rules.length > 0 && <span className="ichi-rules">{rules.map(k => <em key={k}>{houseRules[k][0]}</em>)}</span>}</div>
    <div className="ichi-fans" key={t.handId} aria-hidden="true">{t.seats.map((seat, i) => <Fan key={seat.p} count={seat.count} spot={hands[i]} small={n > 7}/>)}</div>
    <ol className="ichi-seats" aria-label="Players">{t.seats.map((seat, i) => <Seat key={seat.p} v={v} t={t} i={i} spot={plates[i]} now={now} total={total}/>)}</ol>
    <div className="ichi-deck" style={css({ left: `${DECK.x}%`, top: `${DECK.y}%` })} aria-label={`Draw pile, ${t.drawCount} cards`}><CardBack/><CardBack/><CardBack/><CardBack/><span className="kp-numeral">{t.drawCount}</span></div>
    <div className="ichi-pile" style={css({ left: `${PILE.x}%`, top: `${PILE.y}%` })} data-color={t.color} aria-label={`Discard pile: ${cardLabel(t.top)}. Active color ${t.color}.`}>
      <span className="ichi-halo" aria-hidden="true"/>
      {from && <span className="ichi-thump" key={`thump${t.top.id}`} aria-hidden="true"/>}
      {under.map(c => <span key={c.id} className="ichi-under" style={css({ '--r': `${tilt(c.id, 22)}deg`, '--ox': tilt(`${c.id}x`, 5), '--oy': tilt(`${c.id}y`, 4) })}><CardFace card={c}/></span>)}
      <span className="ichi-top" key={t.top.id} data-fly={!!from} style={css({ '--r': `${tilt(t.top.id, 7)}deg`, '--dx': from ? from.x - PILE.x : 0, '--dy': from ? from.y - PILE.y : 0 })}><CardFace card={t.top}/></span>
      {t.pending && <span className="ichi-stack" key={t.pending.count} style={css({ '--n': t.pending.count })} aria-label={`${t.pending.count} cards pending`}>+{t.pending.count}</span>}
      <ColorChip color={t.color}/>
      {playing && current && <p className="ichi-now" style={css({ '--seat': current.color })}><b>{current.name}</b> {t.pending ? t.pending.challengeable ? `can stack, challenge or draw ${t.pending.count}` : `can stack or draw ${t.pending.count}` : t.drawn ? 'drew: play it or keep it' : !current.connected ? 'is reconnecting…' : 'to play'}</p>}
    </div>
    {lit && <span className="ichi-spot" aria-hidden="true" style={css({ '--x': `${lit.x}%`, '--y': `${lit.y}%` })}/>}
    <div className="ichi-fx" aria-hidden="true">{items.map(f => f.kind === 'backs' ? Array.from({ length: f.n! }, (_, k) => <CardBack key={`${f.id}:${k}`} className="ichi-fly-back" style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%`, '--dx': DECK.x - f.at!.x, '--dy': DECK.y - f.at!.y, '--d': `${k * 70}ms` })}/>)
      : f.kind === 'gift' ? <span key={f.id} className="ichi-fly-gift" style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%`, '--dx': f.from!.x - f.at!.x, '--dy': f.from!.y - f.at!.y })}><CardBack/><i/></span>
      : f.kind === 'bubble' ? <span key={f.id} className="ichi-bubble" data-tone={f.tone} data-below={f.at!.y < 30} style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%` })}>{f.text}</span>
      : f.kind === 'burst' ? <span key={f.id} className="ichi-burst" data-color={f.tone} style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%` })}/>
      : f.kind === 'petals' ? <span key={f.id} className="ichi-petal-burst" style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%` })}>{Array.from({ length: 14 }, (_, k) => <i key={k} style={css({ '--k': k })}/>)}</span>
      : f.kind === 'stamp' ? <span key={f.id} className="ichi-stamp" style={css({ left: `${f.at!.x}%`, top: `${f.at!.y}%` })}>一</span> : null)}</div>
    {win && playing && <div className="ichi-window" role="alert"><strong className="kp-display">Ichi race!</strong><span>{name(win.p)} is on one card</span><i style={{ width: `${Math.max(0, Math.min(100, (win.until - now) / 50))}%` }}/></div>}
    {t.lap !== null && playing && !win && <div className="ichi-lap" role="status"><Bell/><strong className="kp-display">Last turn</strong><span>{t.lap} still to play</span></div>}
    {splash && <div className="ichi-splash" key={splash.id} data-tone={splash.tone} role="status"><strong className="kp-display">{splash.text}</strong>{splash.sub && <span>{splash.sub}</span>}</div>}
    <ol className="ichi-ticker" aria-label="Recent moves" aria-live="polite">{t.events.slice(-3).map(e => <li key={e.seq}>{e.text}</li>)}</ol>
    {m.phase !== 'complete' && !playing && t.handResult && <Tally v={v} t={t} now={now}/>}
  </div>;
}

/** The parlor's side rail: the round clock, every table at a glance and the room's leaders. */
function Floor({ v, now }: { v: PublicView; now: number }) {
  const m = v.match, dense = v.floor.length > 8, left = (m.bellAt ?? now) - now;
  return <aside className="ichi-floor" data-dense={dense} aria-label="All tables">
    <header><strong className="kp-display">Round {m.round}<small> of {m.rounds}</small></strong>
      <span className="ichi-bell" data-rung={m.rung && m.phase === 'playing'} data-soon={!m.rung && left < 60000}><Bell/>{m.phase === 'complete' ? <b>Match over</b> : m.rung ? <b>Last turn!</b> : <output className="kp-numeral" aria-label="Time to the bell">{mmss(left)}</output>}</span></header>
    <ol className="ichi-tiles" style={css({ '--tiles': v.floor.length })}>{v.floor.map(f => <li key={f.id} data-on={f.id === m.featured} data-phase={f.phase} data-ichi={f.ichi} data-color={f.color}>
      <span className="ichi-tile-card" aria-hidden="true">{f.phase === 'playing' ? <CardFace card={{ id: 'top', color: f.top === 'wild' || f.top === 'wild4' ? 'wild' : f.color, value: f.top }}/> : <CardBack/>}</span>
      <strong>Table {f.id + 1}</strong>
      <span className="ichi-tile-top">{f.phase === 'playing' ? f.pending ? `+${f.pending} stack` : `Hand ${f.hand}` : f.phase === 'idle' ? 'Done' : 'Dealing'}</span>
      <span className="ichi-tile-seats">{f.seats.map((p, k) => <span key={p} data-current={p === f.current} data-low={f.phase === 'playing' && f.counts[k] <= 2} style={css({ '--seat': v.roster[p].color })}>{!dense && <em>{v.roster[p].name}</em>}<b className="kp-numeral">{f.counts[k]}</b></span>)}</span>
    </li>)}</ol>
    <ol className="ichi-leaders" aria-label="Leaders">{standings(v.roster).slice(0, dense ? 7 : v.floor.length > 6 ? 3 : v.floor.length > 4 ? 5 : 8).map((p, k) => <li key={p.i} style={css({ '--seat': p.color })}><span className="kp-numeral">{k + 1}</span><strong>{p.name}</strong><b className="kp-numeral">{p.score}</b></li>)}</ol>
  </aside>;
}

/** Between rounds: who sits where next. Table 1 holds the leaders. */
function Seating({ v, now }: { v: PublicView; now: number }) {
  const m = v.match, live = v.roster.filter(p => p.connected).length;
  return <section className="ichi-seating" aria-label="Seating for the next round" style={css({ '--tables': v.floor.length, '--cols': v.floor.length > 12 ? 4 : v.floor.length > 6 ? 4 : v.floor.length > 3 ? 3 : v.floor.length })}>
    <header><Emblem color="wild"/><div><h2 className="kp-display">Round {m.round + 1} seating</h2><p>Table 1 seats the leaders. Find your name, then check your phone.</p></div>
      {m.nextAt && <div className="ichi-next"><span className="kp-numeral">{Math.max(0, Math.ceil((m.nextAt - now) / 1000))}</span><small>{m.ready.length}/{live} ready</small></div>}</header>
    <ol>{v.floor.map(f => <li key={f.id} data-top={f.id === 0}><strong className="kp-display">Table {f.id + 1}</strong>
      <ul>{f.seats.map(i => { const p = v.roster[i], move = p.was < 0 || p.was === f.id ? 'stay' : f.id < p.was ? 'up' : 'down';
        return <li key={i} data-move={move} style={css({ '--seat': p.color })}><i aria-label={move === 'up' ? 'moves up' : move === 'down' ? 'moves down' : 'stays'}>{move === 'up' ? '▲' : move === 'down' ? '▼' : '•'}</i><span>{p.name}</span><b className="kp-numeral">{p.score}</b></li>; })}</ul></li>)}</ol>
  </section>;
}

function Finale({ v }: { v: PublicView }) {
  const winners = v.match.winners.map(p => v.roster[p]);
  return <section className="ichi-overlay ichi-overlay-late ichi-finale" aria-label="Match over">
    <div className="ichi-petals" aria-hidden="true">{Array.from({ length: 26 }, (_, k) => <i key={k} style={{ left: `${k * 37 % 100}%`, animationDelay: `${-(k % 9) * .45}s`, animationDuration: `${3.4 + k % 5 * .6}s` }}/>)}</div>
    <div className="ichi-tally ichi-final"><Emblem color="wild"/><p className="ichi-kicker">Match over</p>
      <h2 className="kp-display">{winners.length > 3 ? `${winners.length} players share the win` : `${winners.map(p => p.name).join(' & ')} ${winners.length > 1 ? 'share the win' : 'wins the match'}`}</h2><p>{v.match.finishReason}</p></div>
  </section>;
}

export function DisplayView({ publicView: v, serverNowMs }: Props) {
  const now = useNow(serverNowMs), m = v.match, t = v.feature;
  // A cut to another table is announced on a card that sweeps across the stage.
  const [cut, setCut] = useState<number | null>(null), shown = useRef(m.featured);
  useEffect(() => { if (shown.current === m.featured) return; shown.current = m.featured; setCut(m.featured); const timer = setTimeout(() => setCut(null), 900); return () => clearTimeout(timer); }, [m.featured]);
  return <main className="ichi ichi-display" data-phase={m.phase} data-mode={m.parlor ? 'parlor' : 'table'} data-bell={m.rung} data-art={art.table} style={css({ '--table': `url(${art.base}table.webp)` })}>
    <div className="ichi-stage">
      {t && <Table key={`${m.round}:${t.id}`} v={v} t={t} now={now}/>}
      {cut !== null && m.phase === 'playing' && <div className="ichi-cut" key={cut} aria-hidden="true"><strong className="kp-display">Table {cut + 1}</strong></div>}
      {m.phase === 'complete' && <Finale v={v}/>}
    </div>
    {m.parlor && m.phase !== 'seating' && <Floor v={v} now={now}/>}
    {m.phase === 'seating' && <Seating v={v} now={now}/>}
  </main>;
}
