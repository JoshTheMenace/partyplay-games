import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, StatusNotice } from '../../../party-ui/src/index';
import { colors, type Action, type Color, type HandCard, type PrivateView, type PublicView, type TableView } from './types';
import { CardFace, ColorChip, Emblem, art, cardLabel, colorName, sortCards } from './cards';
import { Bell, Clock, css, mmss, ordinal, rankOf, useNow, type Props } from './table';

/** give: the card a Gift hands over, picked before its receiver. */
type Draft = { turnId: string; cardId: string; give?: string };
type Ghost = { card: HandCard; left: number; top: number; size: string };
const read = <T,>(store: () => Storage, key: string, fallback: T): T => { try { const raw = store().getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const write = (store: () => Storage, key: string, value: unknown) => { try { if (value == null) store().removeItem(key); else store().setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } };
// Chrome logs an intervention for vibrate() before the first tap (e.g. right after a reload), so wait for one.
const buzz = (pattern: number | number[]) => { try { if (typeof navigator.vibrate === 'function' && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(pattern); } catch { /* Unsupported. */ } };
/** A message that clears itself after ms. */
function useFlash(ms: number) {
  const [text, setText] = useState('');
  useEffect(() => { if (!text) return; const t = setTimeout(() => setText(''), ms); return () => clearTimeout(t); }, [text, ms]);
  return [text, setText] as const;
}
const matchHint = (t: TableView) => `Match ${colorName[t.color]}${t.top.color === 'wild' ? '' : ` or ${cardLabel(t.top).split(' ').slice(1).join(' ')}`}`;
const place = (v: PublicView, me: number) => `${ordinal(rankOf(v.roster, me))} of ${v.roster.length}`;

/** The parlor's line on a phone: which table, which round, and the bell. */
function Room({ v, t, serverNowMs }: { v: PublicView; t: TableView; serverNowMs(): number }) {
  const m = v.match, left = (m.bellAt ?? 0) - useNow(serverNowMs, 500);
  return <p className="ichi-room"><strong>Table {t.id + 1}</strong><span>Round {m.round} of {m.rounds}</span>
    <span className="ichi-bell" data-rung={m.rung} data-soon={!m.rung && left < 60000}><Bell/>{m.rung ? <b>Last turn!</b> : <output className="kp-numeral" aria-label="Time to the bell">{mmss(left)}</output>}</span></p>;
}

function Rivals({ v, t, me }: { v: PublicView; t: TableView; me: number }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }, [t.current]);
  return <ol className="ichi-rivals" ref={list} aria-label="Players">{t.seats.map(seat => { const p = v.roster[seat.p];
    return <li key={seat.p} style={css({ '--seat': p.color })} data-current={seat.p === t.current} data-me={seat.p === me} data-offline={!p.connected}>
      <strong>{seat.p === me ? 'You' : p.name}</strong><b className="kp-numeral" aria-label={`${seat.count} cards`}>{seat.count}</b>{seat.safe && seat.count === 1 && <em>Ichi</em>}
    </li>; })}</ol>;
}

const Scores = ({ v, seats, me, target }: { v: PublicView; seats: number[]; me: number; target: number }) => <ol className="ichi-break-scores">{[...seats].sort((a, b) => v.roster[b].score - v.roster[a].score).map(i => { const p = v.roster[i];
  return <li key={i} data-me={i === me} style={css({ '--seat': p.color })}><strong>{i === me ? 'You' : p.name}</strong><span className="ichi-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, p.score / target * 100)}%` }}/></span><b className="kp-numeral">{p.score}</b></li>; })}</ol>;

/** Between hands at a table: the tally, then Next hand, or the wait for the bell. */
function Break({ v, t, me, send, busy, serverNowMs }: { v: PublicView; t: TableView; me: number; send(a: Action): void; busy: boolean; serverNowMs(): number }) {
  const r = t.handResult, m = v.match, now = useNow(serverNowMs), mine = r?.hands.find(h => h.p === me), ready = t.ready.includes(me), winner = v.roster[r?.winner ?? -1], seats = t.seats.map(s => s.p);
  return <section className="ichi-break">
    <Emblem color="wild"/>
    <h2 className="kp-display">{winner ? r!.winner === me ? 'You won the hand!' : `${winner.name} wins the hand` : 'Hand over'}</h2>
    <p>{winner && r ? `+${r.points} points. ` : ''}{mine && mine.points && r?.winner !== me ? `Your leftovers gave away ${mine.points}.` : r?.reason}</p>
    <Scores v={v} seats={seats} me={me} target={m.parlor ? Math.max(1, ...seats.map(i => v.roster[i].score)) : v.settings.target || 1}/>
    {m.parlor && <p className="ichi-standing">You’re <b>{place(v, me)}</b> in the room.</p>}
    {t.phase === 'intermission' ? <>
      <ArcadeButton size="xl" tone="lime" disabled={ready || busy} onClick={() => send({ kind: 'next', turnId: t.handId })}>Next hand</ArcadeButton>
      <p className="ichi-break-note" role="status">{ready ? `You’re ready. ${t.ready.length}/${t.seats.filter(s => v.roster[s.p].connected).length} ready` : 'Tap when you’re set.'}{t.nextHandAt ? ` · Deal in ${Math.max(0, Math.ceil((t.nextHandAt - now) / 1000))}s` : ''}</p>
    </> : <p className="ichi-break-note" role="status">{m.phase === 'complete' ? 'Look up at the TV for the final standings.' : m.rung ? 'The other tables are playing their last turns.' : 'Too close to the bell for another hand. New tables in a moment.'}</p>}
  </section>;
}

/** Between rounds: where this player sits next and with whom. */
function Move({ v, me, send, busy, serverNowMs }: { v: PublicView; me: number; send(a: Action): void; busy: boolean; serverNowMs(): number }) {
  const m = v.match, p = v.roster[me], now = useNow(serverNowMs), ready = m.ready.includes(me), move = p.was < 0 || p.was === p.table ? 'stay' : p.table < p.was ? 'up' : 'down';
  const table = v.roster.map((_, i) => i).filter(i => v.roster[i].table === p.table);
  return <section className="ichi-break ichi-move" data-move={move}>
    <p className="ichi-kicker">Round {m.round} done · round {m.round + 1} of {m.rounds} next</p>
    <h2 className="kp-display">Table {p.table + 1}</h2>
    <p>{move === 'up' ? `You move up from table ${p.was + 1}.` : move === 'down' ? `You move down from table ${p.was + 1}.` : 'You keep your table.'} You’re <b>{place(v, me)}</b> with {p.score} points.</p>
    <Scores v={v} seats={table} me={me} target={Math.max(1, ...table.map(i => v.roster[i].score))}/>
    <ArcadeButton size="xl" tone="lime" disabled={ready || busy} onClick={() => send({ kind: 'next', turnId: `r${m.round}` })}>Ready</ArcadeButton>
    <p className="ichi-break-note" role="status">{ready ? 'You’re ready.' : 'Tap when you know your table.'}{m.nextAt ? ` · Cards in ${Math.max(0, Math.ceil((m.nextAt - now) / 1000))}s` : ''}</p>
  </section>;
}

function Hand({ props, own, t, me }: { props: Props; own: PrivateView; t: TableView; me: number }) {
  const { publicView: v, roundId, connected } = props, name = (p?: number | null) => v.roster[p ?? -1]?.name;
  const draftKey = `ichi:draft:${roundId}:${me}`;
  const [draft, setDraft] = useState<Draft | null>(() => read(() => sessionStorage, draftKey, null));
  const [sort, setSort] = useState<'color' | 'number'>(() => read(() => localStorage, 'ichi.sort', 'color'));
  const [pending, setPending] = useState(false), [error, setError] = useFlash(3500), [hint, setHint] = useState(''), [ouch, setOuch] = useFlash(2600), [ghost, setGhost] = useState<Ghost | null>(null);
  const busy = useRef(false), handRef = useRef<HTMLElement>(null);
  const myTurn = t.current === me, current = name(t.current);
  const at = t.seats.findIndex(s => s.p === t.current), n = t.seats.length, upNext = !myTurn && t.seats[(at + t.direction + n) % n]?.p === me;
  const win = t.ichiWindow, windowMine = win?.p === me;
  const selected = draft?.turnId === t.turnId ? own.hand.find(c => c.id === draft.cardId && (c.playable || c.jumpable)) : undefined;
  // A fresh +4 is a bluff while you still hold the active color; the server judges it the same way.
  const bluffs = (c: HandCard) => v.settings.challenge && c.value === 'wild4' && !t.pending && own.hand.some(h => h.id !== c.id && h.color === t.color);
  const accuser = name(t.pending?.from) ?? 'They', before = t.pending?.before;
  const needsColor = selected?.color === 'wild', needsTarget = !!selected && v.settings.sevenZero && selected.value === '7';
  // A Gift first picks the card to hand over, then who gets it; a full hand can't take one.
  const gifting = selected?.value === 'gift' && own.hand.length > 1, give = gifting ? own.hand.find(c => c.id === draft!.give && c.id !== selected!.id) : undefined, takers = t.seats.filter(s => s.p !== me && s.count < 30);
  // An ack lands up to one server tick before its snapshot; stay locked until the view actually moves on.
  const mark = `${t.turnId}|${t.events.at(-1)?.seq}|${win?.id}`, [settled, setSettled] = useState('');
  const waiting = pending || settled === mark, disabled = waiting || connected === false;
  useEffect(() => write(() => sessionStorage, draftKey, selected ? draft : null), [draftKey, selected?.id, draft]);
  useEffect(() => write(() => localStorage, 'ichi.sort', sort), [sort]);
  useEffect(() => { setHint(''); }, [t.turnId]);
  // Keep the card that matters in view: the pick, else a fresh draw, else the first playable card on a new turn.
  const focus = selected?.id ?? own.drawnId ?? (myTurn ? own.hand.find(c => c.playable)?.id : undefined);
  useEffect(() => { if (focus) handRef.current?.querySelector(`[data-card-id="${focus}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [focus, t.turnId]);
  useEffect(() => { if (myTurn) buzz(90); }, [myTurn]);
  useEffect(() => { if (own.canCatch) buzz([60, 40, 60]); if (windowMine) buzz(220); }, [own.canCatch, windowMine]);
  useEffect(() => { if (upNext && n > 2) buzz(40); }, [upNext, n]);
  useEffect(() => { if (t.lap !== null) buzz([120, 60, 120]); }, [t.lap !== null]);
  // Cards that just arrived (draws, penalties, swaps, gifts) rise in; layout effect so they never flash in place first.
  const ids = own.hand.map(c => c.id).join(), prevIds = useRef<Set<string> | null>(null), [arrived, setArrived] = useState(new Set<string>());
  useLayoutEffect(() => { const was = prevIds.current; prevIds.current = new Set(own.hand.map(c => c.id)); if (was) setArrived(new Set(own.hand.filter(c => !was.has(c.id)).map(c => c.id))); }, [ids]);
  useEffect(() => { if (!ghost) return; const timer = setTimeout(() => setGhost(null), 420); return () => clearTimeout(timer); }, [ghost]);
  // Tell me who just made me draw: the newest penalty, catch or gift, credited to the last +2/+4 or challenge before it.
  const hits = t.events.filter(e => e.kind === 'penalty' || e.kind === 'catch' || e.kind === 'gift'), hit = hits.at(-1), hitSeq = useRef(hit?.seq ?? 0);
  useEffect(() => {
    if (!hit || hit.seq <= hitSeq.current) return;
    hitSeq.current = hit.seq;
    if ((hit.kind === 'penalty' ? hit.by : hit.to) !== me) return;
    if (hit.kind === 'gift') { setOuch(`A gift from ${name(hit.by) ?? 'someone'}`); return buzz([40, 40, 40]); }
    if (!hit.count) return;
    const cause = hit.kind === 'catch' ? hit : t.events.slice(0, t.events.indexOf(hit)).reverse().find(e => e.kind === 'challenge' || e.card?.value === 'draw2' || e.card?.value === 'wild4');
    const from = cause?.kind === 'challenge' && cause.by === me ? cause.to : cause?.by;
    setOuch(`+${hit.count}${from !== undefined && from !== me ? ` from ${name(from)}` : ''}`); buzz([80, 40, 80]);
  }, [hit?.seq]);

  async function send(action: Action) {
    if (busy.current || settled === mark) return;
    busy.current = true; setPending(true); setError(''); setHint('');
    const sentMark = mark, played = action.kind === 'play' ? own.hand.find(c => c.id === action.cardId) : undefined, el = played && handRef.current?.querySelector<HTMLElement>(`[data-card-id="${played.id}"]`), box = el?.getBoundingClientRect(), host = handRef.current?.getBoundingClientRect();
    try {
      const result = await props.sendAction(action);
      if (!result.accepted) setError(result.reason ?? 'The table didn’t accept that move.');
      else { setSettled(sentMark); if (played) { setDraft(null); if (box && host) setGhost({ card: played, left: box.left - host.left, top: box.top - host.top, size: getComputedStyle(el!).fontSize }); } }
    } catch { setError('Couldn’t reach the table. Check your connection and try again.'); }
    finally { busy.current = false; setPending(false); }
  }
  const commit = (c: HandCard, color?: Color, target?: string) => {
    if ((c.color === 'wild' && !color) || ((needsTarget || gifting) && !target) || (gifting && !give)) return;
    void send({ kind: 'play', turnId: t.turnId, cardId: c.id, ...(color ? { color } : {}), ...(target ? { target } : {}), ...(gifting ? { give: give!.id } : {}) });
  };
  function tap(c: HandCard) {
    setError('');
    if (gifting && c.id !== selected!.id) { setHint(''); return setDraft({ ...draft!, give: draft!.give === c.id ? undefined : c.id }); }
    if (!(c.playable || c.jumpable)) {
      setDraft(null);
      return setHint(!myTurn ? v.settings.jumpIn ? 'Only the exact same card can jump in.' : `Wait for ${current ?? 'your turn'}.` : t.pending ? `Stack a ${t.pending.kind === 'wild4' ? '+4' : '+2 or +4'}, or draw ${t.pending.count}.` : t.drawn ? 'Only your new card can be played now.' : `${cardLabel(c)} doesn’t fit. ${matchHint(t)}.`);
    }
    setHint('');
    if (selected?.id !== c.id) setDraft({ turnId: t.turnId, cardId: c.id }); else if (gifting) setDraft(null); else commit(c);
  }
  const shout = (kind: 'ichi' | 'catch') => void send({ kind, turnId: kind === 'catch' || windowMine ? win!.id : t.turnId });
  const hand = sortCards(own.hand, sort), fits = (c: HandCard) => !myTurn && !t.pending && (c.color === 'wild' || c.color === t.color || c.value === t.top.value);
  const prompt = windowMine ? 'Say Ichi! before someone catches you!' : own.canCatch ? `${name(win?.p) ?? 'Someone'} forgot to say Ichi!`
    : myTurn ? own.canChallenge ? 'Bluff?' : t.pending ? `Stack or draw ${t.pending.count}` : t.drawn ? own.drawnId ? 'Play your new card or keep it' : 'Drawing…' : matchHint(t)
    : upNext ? 'You’re next!' : `${current ?? 'Someone'} is playing`;
  const sub = windowMine ? 'Tap Ichi! now or draw two.' : own.canCatch ? 'First tap wins. They draw two.' : myTurn ? own.canChallenge && before ? `Did ${accuser} have ${colorName[before]}?` : selected ? 'Tap the card again or press Play.' : own.hand.some(c => c.playable) ? 'Tap a glowing card to pick it.' : t.pending ? 'Nothing to stack. Take the cards.' : 'Nothing fits. Draw a card.'
    : own.hand.some(c => c.jumpable) ? 'You hold the exact card. Jump in!' : t.pending ? `+${t.pending.count} is heading down the table.` : t.events.at(-1)?.text ?? 'Plan your next move.';
  // Past ten cards the hand wraps into two overlapping rows; cards size themselves to fit (see --cols in CSS).
  const rows = hand.length > 10 ? 2 : 1, cols = Math.ceil(hand.length / rows);
  // Measured once per window: re-measuring on every render would change the running bar's duration.
  const drain = useMemo(() => win ? { '--left': `${Math.max(0, win.until - props.serverNowMs())}ms` } as CSSProperties : undefined, [win?.id]);
  const total = (t.lap !== null ? Math.min(v.settings.turnSeconds, 12) : v.settings.turnSeconds) * 1000;

  return <>
    <header className="ichi-strip" data-mine={myTurn} data-lap={t.lap !== null}>
      {v.match.parlor && <Room v={v} t={t} serverNowMs={props.serverNowMs}/>}
      <span className="ichi-strip-top" aria-label={`Top card ${cardLabel(t.top)}`}><CardFace key={t.top.id} className="ichi-land" card={t.top}/></span>
      <span className="ichi-strip-info"><span><ColorChip color={t.color}/>{t.pending && <span className="ichi-strip-penalty" aria-label={`${t.pending.count} card penalty pending`}>+{t.pending.count}</span>}</span><strong className={myTurn ? 'kp-display' : ''}>{myTurn ? t.lap !== null ? 'Your last turn' : 'Your turn' : `${current ?? ''}’s turn`}</strong></span>
      <Clock deadline={t.deadline} total={total} serverNowMs={props.serverNowMs}/>
    </header>
    <Rivals v={v} t={t} me={me}/>
    <section className="ichi-sheet" aria-live="polite">
      {needsColor && selected ? <div className="ichi-colors" role="group" aria-label="Choose the next color"><p>Pick the next color</p>{colors.map(c => <ArcadeButton key={c} tone={c} disabled={disabled} onClick={() => commit(selected, c)}><Emblem color={c}/>{colorName[c]}</ArcadeButton>)}</div>
        : gifting && selected ? <div className="ichi-targets ichi-gift" role="group" aria-label="Give a card away"><p>{give ? `Hand ${cardLabel(give)} to…` : 'Tap the card you want to give away'}</p>
          {give && takers.map(s => <ArcadeButton key={s.p} tone="ghost" aria-label={`Give to ${name(s.p)}`} disabled={disabled} onClick={() => commit(selected, undefined, v.roster[s.p].id)} style={css({ '--seat': v.roster[s.p].color })}><span><i>Give to </i>{name(s.p)}</span><b className="kp-numeral">{s.count}</b></ArcadeButton>)}
          {give && !takers.length && <p className="ichi-hint">Every other hand is full. Play something else.</p>}</div>
        : needsTarget && selected ? <div className="ichi-targets" role="group" aria-label="Choose who to swap with"><p>Swap hands with…</p>{t.seats.filter(s => s.p !== me).map(s => <ArcadeButton key={s.p} tone="ghost" aria-label={`Swap with ${name(s.p)}`} disabled={disabled} onClick={() => commit(selected, undefined, v.roster[s.p].id)} style={css({ '--seat': v.roster[s.p].color })}><span><i>Swap with </i>{name(s.p)}</span><b className="kp-numeral">{s.count}</b></ArcadeButton>)}</div>
        : <><div className="ichi-peek" data-color={t.color} aria-hidden="true"><span className="ichi-halo"/><CardFace key={t.top.id} className="ichi-land" card={t.top}/></div><div className="ichi-prompt" data-mine={myTurn || windowMine || own.canCatch || upNext}><strong>{prompt}</strong>{ouch ? <b className="ichi-ouch" key={ouch} data-gift={ouch.startsWith('A gift')}>{ouch}</b> : <span>{waiting ? 'Sending to the table…' : sub}</span>}</div></>}
      {connected === false && <StatusNotice>Reconnecting. Your hand and seat are safe.</StatusNotice>}
      {hint && !error && <p className="ichi-hint">{hint}</p>}
      {error && <div className="ichi-toast"><StatusNotice tone="error">{error}</StatusNotice></div>}
    </section>
    <section className="ichi-hand" ref={handRef} data-turn={myTurn} data-gifting={gifting} aria-label={`Your hand, ${hand.length} cards`}>
      <div className="ichi-hand-head"><strong>Your hand <b className="kp-numeral">{hand.length}</b></strong>
        <span className="ichi-sort" role="group" aria-label="Sort hand">{(['color', 'number'] as const).map(s => <button key={s} aria-pressed={sort === s} aria-label={`Sort by ${s}`} onClick={() => setSort(s)}>{s === 'color' ? 'Color' : '1–9'}</button>)}</span></div>
      {Array.from({ length: rows }, (_, r) => <div key={r} className="ichi-hand-row" data-rows={rows} style={css({ '--cols': Math.max(cols, 1), '--rows': rows })}>
        {hand.slice(r * cols, (r + 1) * cols).map((c, i) => { const giving = gifting && c.id !== selected!.id, live = c.playable || c.jumpable || giving;
          return <button key={c.id} className="ichi-card-button" style={css({ '--i': i })} data-card-id={c.id} data-playable={c.playable} data-jumpable={c.jumpable} data-fits={fits(c)} data-giving={giving} data-give={give?.id === c.id} data-new={c.id === own.drawnId} data-arrive={arrived.has(c.id)} data-gone={ghost?.card.id === c.id}
            aria-pressed={selected?.id === c.id} aria-disabled={!live} aria-label={`${cardLabel(c)}${bluffs(c) ? ', bluff' : ''}${give?.id === c.id ? ', to give away' : ''}`} disabled={connected === false} onClick={() => tap(c)}><CardFace card={c}/>{bluffs(c) && <em className="ichi-card-tag">Bluff</em>}{give?.id === c.id && <em className="ichi-card-tag ichi-card-tag-give">Give</em>}</button>; })}
        {!hand.length && <p className="ichi-hint">No cards. You’re out!</p>}
      </div>)}
      {ghost && <span className="ichi-ghost" aria-hidden="true" style={{ left: ghost.left, top: ghost.top, fontSize: ghost.size }}><CardFace card={ghost.card}/></span>}
    </section>
    <div className="ichi-actions" aria-busy={waiting}>
      {own.canCatch && <button key={win?.id} className="ichi-shout ichi-catch" style={drain} disabled={disabled} onClick={() => shout('catch')}>Catch!</button>}
      {(own.canCall || windowMine) && <button key={`ichi:${win?.id}`} className="ichi-shout" data-urgent={windowMine} style={windowMine ? drain : undefined} disabled={disabled} onClick={() => shout('ichi')}>Ichi!</button>}
      {selected && !needsColor && !needsTarget && !gifting && <ArcadeButton size="lg" tone="lime" className="ichi-play" disabled={disabled} onClick={() => commit(selected)}>Play {cardLabel(selected)}</ArcadeButton>}
      {gifting && give && takers.length === 1 && <ArcadeButton size="lg" tone="lime" className="ichi-play" disabled={disabled} onClick={() => commit(selected!, undefined, v.roster[takers[0].p].id)}>Play Gift</ArcadeButton>}
      {own.canChallenge && <ArcadeButton size="lg" tone="grape" disabled={disabled} onClick={() => void send({ kind: 'challenge', turnId: t.turnId })}>Challenge</ArcadeButton>}
      {myTurn && !t.drawn && <ArcadeButton size="lg" tone={t.pending ? 'coral' : selected ? 'ghost' : 'sun'} disabled={disabled} onClick={() => void send({ kind: 'draw', turnId: t.turnId })}>{t.pending ? `Draw ${t.pending.count}` : 'Draw'}</ArcadeButton>}
      {myTurn && t.drawn && own.drawnId && <ArcadeButton size="lg" tone="sky" disabled={disabled} onClick={() => void send({ kind: 'keep', turnId: t.turnId })}>Keep card</ArcadeButton>}
    </div>
  </>;
}

export function ControllerView(props: Props) {
  const { publicView: v, privateView: own, playerId } = props, [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState('');
  const m = v.match, me = own ? v.roster.findIndex(p => p.id === playerId) : -1, t = own?.table ?? (m.parlor ? null : v.feature);
  const next = async (action: Action) => { setBusy(true); setError(''); try { const r = await props.sendAction(action); if (!r.accepted) setError(r.reason ?? 'Not accepted.'); else setSent(action.turnId); } catch { setError('Couldn’t reach the table.'); } finally { setBusy(false); } };
  const phase = me < 0 ? 'watching' : m.phase === 'complete' || m.phase === 'seating' ? m.phase : t?.phase === 'playing' ? 'playing' : 'intermission', off = busy || props.connected === false;
  return <main className="ichi ichi-phone" data-art={art.table} data-phase={phase} data-my-turn={phase === 'playing' && t!.current === me}>
    {phase === 'watching' ? <section className="ichi-break"><Emblem color="wild"/><h2 className="kp-display">You’re watching</h2><p>This match started without you. Watch the TV; you’ll be dealt into the next one.</p></section>
      : phase === 'complete' ? <section className="ichi-break"><Emblem color="wild"/><h2 className="kp-display">Match over</h2><p>You finished <b>{place(v, me)}</b> with {v.roster[me].score} points.</p><p>{m.finishReason}</p></section>
      : phase === 'seating' ? <><Move v={v} me={me} send={a => void next(a)} busy={off || sent === `r${m.round}`} serverNowMs={props.serverNowMs}/>{error && <StatusNotice tone="error">{error}</StatusNotice>}</>
      : !t ? <section className="ichi-break"><Emblem color="wild"/><h2 className="kp-display">Dealing you in…</h2><p>{props.connected === false ? 'Reconnecting. Your hand and seat are safe.' : 'Your hand appears here in a moment.'}</p></section>
      : phase === 'playing' ? <Hand key={`${props.roundId}:${playerId}:${m.round}`} props={props} own={own!} t={t} me={me}/>
      : <>{m.parlor && <header className="ichi-strip"><Room v={v} t={t} serverNowMs={props.serverNowMs}/></header>}<Break v={v} t={t} me={me} send={a => void next(a)} busy={off || sent === t.handId} serverNowMs={props.serverNowMs}/>{error && <StatusNotice tone="error">{error}</StatusNotice>}</>}
  </main>;
}
