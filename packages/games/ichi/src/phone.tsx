import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArcadeButton, StatusNotice } from '../../../party-ui/src/index';
import { colors, type Action, type Color, type HandCard, type PrivateView, type PublicView } from './types';
import { CardFace, ColorChip, Emblem, art, cardLabel, colorName, sortCards } from './cards';
import { Clock, useNow, type Props } from './table';

type Draft = { turnId: string; cardId: string };
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
const matchHint = (v: PublicView) => `Match ${colorName[v.color]}${v.top.color === 'wild' ? '' : ` or ${cardLabel(v.top).split(' ').slice(1).join(' ')}`}`;

function Rivals({ v, playerId }: { v: PublicView; playerId: string }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }, [v.current]);
  return <ol className="ichi-rivals" ref={list} aria-label="Players">{v.players.map(p => <li key={p.id} style={{ '--seat': p.color } as CSSProperties} data-current={p.id === v.current} data-me={p.id === playerId} data-offline={!p.connected}>
    <strong>{p.id === playerId ? 'You' : p.name}</strong><b className="kp-numeral" aria-label={`${p.count} cards`}>{p.count}</b>{p.safe && p.count === 1 && <em>Ichi</em>}
  </li>)}</ol>;
}

function Break({ v, playerId, send, busy, serverNowMs }: { v: PublicView; playerId: string; send(a: Action): void; busy: boolean; serverNowMs(): number }) {
  const r = v.handResult, now = useNow(serverNowMs), mine = r?.hands.find(h => h.playerId === playerId), ready = v.ready.includes(playerId);
  const winner = v.players.find(p => p.id === r?.winnerId), target = v.settings.target;
  return <section className="ichi-break">
    <Emblem color="wild"/>
    <h2 className="kp-display">{winner ? winner.id === playerId ? 'You won the hand!' : `${winner.name} wins the hand` : 'Hand over'}</h2>
    <p>{winner && r ? `+${r.points} points. ` : ''}{mine && mine.points ? `Your leftovers gave away ${mine.points}.` : r?.reason}</p>
    <ol className="ichi-break-scores">{[...v.players].sort((a, b) => b.score - a.score).map(p => <li key={p.id} data-me={p.id === playerId} style={{ '--seat': p.color } as CSSProperties}>
      <strong>{p.id === playerId ? 'You' : p.name}</strong><span className="ichi-bar" aria-hidden="true"><i style={{ width: `${target ? Math.min(100, p.score / target * 100) : 0}%` }}/></span><b className="kp-numeral">{p.score}</b>
    </li>)}</ol>
    <ArcadeButton size="xl" tone="lime" disabled={ready || busy} onClick={() => send({ kind: 'next', turnId: v.handId })}>Next hand</ArcadeButton>
    <p className="ichi-break-note" role="status">{ready ? `You’re ready. ${v.ready.length}/${v.players.filter(p => p.connected).length} ready` : 'Tap when you’re set.'}{v.nextHandAt ? ` · Deal in ${Math.max(0, Math.ceil((v.nextHandAt - now) / 1000))}s` : ''}</p>
  </section>;
}

function Hand({ props, own }: { props: Props; own: PrivateView }) {
  const { publicView: v, playerId, roundId, connected } = props, me = playerId!;
  const draftKey = `ichi:draft:${roundId}:${me}`;
  const [draft, setDraft] = useState<Draft | null>(() => read(() => sessionStorage, draftKey, null));
  const [sort, setSort] = useState<'color' | 'number'>(() => read(() => localStorage, 'ichi.sort', 'color'));
  const [pending, setPending] = useState(false), [error, setError] = useFlash(3500), [hint, setHint] = useState(''), [ouch, setOuch] = useFlash(2600);
  const busy = useRef(false), handRef = useRef<HTMLElement>(null);
  const myTurn = v.phase === 'playing' && v.current === me, current = v.players.find(p => p.id === v.current);
  const at = v.players.findIndex(p => p.id === v.current), n = v.players.length, upNext = v.phase === 'playing' && !myTurn && v.players[(at + v.direction + n) % n]?.id === me;
  const win = v.ichiWindow, windowMine = win?.playerId === me;
  const selected = draft?.turnId === v.turnId ? own.hand.find(c => c.id === draft.cardId && (c.playable || c.jumpable)) : undefined;
  // A fresh +4 is a bluff while you still hold the active color; the server judges it the same way.
  const bluffs = (c: HandCard) => v.settings.challenge && c.value === 'wild4' && !v.pending && own.hand.some(h => h.id !== c.id && h.color === v.color);
  const accuser = v.players.find(p => p.id === v.pending?.from)?.name ?? 'They', before = v.pending?.before;
  const needsColor = selected?.color === 'wild', needsTarget = !!selected && v.settings.sevenZero && selected.value === '7' && selected.color !== 'wild';
  // An ack lands up to one server tick before its snapshot; stay locked until the view actually moves on.
  const mark = `${v.turnId}|${v.events.at(-1)?.seq}|${v.ichiWindow?.id}`, [settled, setSettled] = useState('');
  const waiting = pending || settled === mark, disabled = waiting || connected === false;
  useEffect(() => write(() => sessionStorage, draftKey, selected ? draft : null), [draftKey, selected?.id, draft]);
  useEffect(() => write(() => localStorage, 'ichi.sort', sort), [sort]);
  useEffect(() => { setHint(''); }, [v.turnId]);
  // Keep the card that matters in view: the pick, else a fresh draw, else the first playable card on a new turn.
  const focus = selected?.id ?? own.drawnId ?? (myTurn ? own.hand.find(c => c.playable)?.id : undefined);
  useEffect(() => { if (focus) handRef.current?.querySelector(`[data-card-id="${focus}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [focus, v.turnId]);
  useEffect(() => { if (myTurn) buzz(90); }, [myTurn]);
  useEffect(() => { if (own.canCatch) buzz([60, 40, 60]); if (windowMine) buzz(220); }, [own.canCatch, windowMine]);
  useEffect(() => { if (upNext && n > 2) buzz(40); }, [upNext, n]);
  // Cards that just arrived (draws, penalties, swaps) rise in; layout effect so they never flash in place first.
  const ids = own.hand.map(c => c.id).join(), prevIds = useRef<Set<string> | null>(null), [arrived, setArrived] = useState(new Set<string>());
  useLayoutEffect(() => { const was = prevIds.current; prevIds.current = new Set(own.hand.map(c => c.id)); if (was) setArrived(new Set(own.hand.filter(c => !was.has(c.id)).map(c => c.id))); }, [ids]);
  // Tell me who just made me draw: the newest penalty or catch, credited to the last +2/+4 or challenge before it.
  const hits = v.events.filter(e => e.kind === 'penalty' || e.kind === 'catch'), hit = hits.at(-1), hitSeq = useRef(hit?.seq ?? 0);
  useEffect(() => {
    if (!hit || hit.seq <= hitSeq.current) return;
    hitSeq.current = hit.seq;
    if ((hit.kind === 'catch' ? hit.targetId : hit.playerId) !== me || !hit.count) return;
    const cause = hit.kind === 'catch' ? hit : v.events.slice(0, v.events.indexOf(hit)).reverse().find(e => e.kind === 'challenge' || e.card?.value === 'draw2' || e.card?.value === 'wild4');
    const from = v.players.find(p => p.id === (cause?.kind === 'challenge' && cause.playerId === me ? cause.targetId : cause?.playerId));
    setOuch(`+${hit.count}${from && from.id !== me ? ` from ${from.name}` : ''}`); buzz([80, 40, 80]);
  }, [hit?.seq]);

  async function send(action: Action) {
    if (busy.current || settled === mark) return;
    busy.current = true; setPending(true); setError(''); setHint('');
    const sentMark = mark;
    try { const result = await props.sendAction(action); if (!result.accepted) setError(result.reason ?? 'The table didn’t accept that move.'); else { setSettled(sentMark); if (action.kind === 'play') setDraft(null); } }
    catch { setError('Couldn’t reach the table. Check your connection and try again.'); }
    finally { busy.current = false; setPending(false); }
  }
  const commit = (c: HandCard, color?: Color, target?: string) => {
    if ((c.color === 'wild' && !color) || (needsTarget && !target)) return;
    void send({ kind: 'play', turnId: v.turnId, cardId: c.id, ...(color ? { color } : {}), ...(target ? { target } : {}) });
  };
  function tap(c: HandCard) {
    setError('');
    if (!(c.playable || c.jumpable)) {
      setDraft(null);
      return setHint(!myTurn ? v.settings.jumpIn ? 'Only the exact same card can jump in.' : `Wait for ${current?.name ?? 'your turn'}.` : v.pending ? `Stack a ${v.pending.kind === 'wild4' ? '+4' : '+2 or +4'}, or draw ${v.pending.count}.` : v.drawn ? 'Only your new card can be played now.' : `${cardLabel(c)} doesn’t fit. ${matchHint(v)}.`);
    }
    setHint('');
    if (selected?.id === c.id) commit(c); else setDraft({ turnId: v.turnId, cardId: c.id });
  }
  const shout = (kind: 'ichi' | 'catch') => void send({ kind, turnId: kind === 'catch' || windowMine ? win!.id : v.turnId });
  const hand = sortCards(own.hand, sort);
  const prompt = windowMine ? 'Say Ichi! before someone catches you!' : own.canCatch ? `${v.players.find(p => p.id === win?.playerId)?.name ?? 'Someone'} forgot to say Ichi!`
    : myTurn ? own.canChallenge ? 'Bluff?' : v.pending ? `Stack or draw ${v.pending.count}` : v.drawn ? own.drawnId ? 'Play your new card or keep it' : 'Drawing…' : matchHint(v)
    : upNext ? 'You’re next!' : `${current?.name ?? 'Someone'} is playing`;
  const sub = windowMine ? 'Tap Ichi! now or draw two.' : own.canCatch ? 'First tap wins. They draw two.' : myTurn ? own.canChallenge && before ? `Did ${accuser} have ${colorName[before]}?` : selected ? 'Tap the card again or press Play.' : own.hand.some(c => c.playable) ? 'Tap a glowing card to pick it.' : v.pending ? 'Nothing to stack. Take the cards.' : 'Nothing fits. Draw a card.'
    : own.hand.some(c => c.jumpable) ? 'You hold the exact card. Jump in!' : v.pending ? `+${v.pending.count} is heading down the table.` : v.events.at(-1)?.text ?? 'Plan your next move.';
  // Past ten cards the hand wraps into two overlapping rows; cards size themselves to fit (see --cols in CSS).
  const rows = hand.length > 10 ? 2 : 1, cols = Math.ceil(hand.length / rows);
  // Measured once per window: re-measuring on every render would change the running bar's duration.
  const drain = useMemo(() => win ? { '--left': `${Math.max(0, win.until - props.serverNowMs())}ms` } as CSSProperties : undefined, [win?.id]);

  return <>
    <header className="ichi-strip" data-mine={myTurn}>
      <span className="ichi-strip-top" aria-label={`Top card ${cardLabel(v.top)}`}><CardFace key={v.top.id} className="ichi-land" card={v.top}/></span>
      <span className="ichi-strip-info"><span><ColorChip color={v.color}/>{v.pending && <span className="ichi-strip-penalty" aria-label={`${v.pending.count} card penalty pending`}>+{v.pending.count}</span>}</span><strong className={myTurn ? 'kp-display' : ''}>{myTurn ? 'Your turn' : `${current?.name ?? ''}’s turn`}</strong></span>
      <Clock deadline={v.deadline} total={v.settings.turnSeconds * 1000} serverNowMs={props.serverNowMs}/>
    </header>
    <Rivals v={v} playerId={me}/>
    <section className="ichi-sheet" aria-live="polite">
      {needsColor && selected ? <div className="ichi-colors" role="group" aria-label="Choose the next color"><p>Pick the next color</p>{colors.map(c => <ArcadeButton key={c} tone={c} disabled={disabled} onClick={() => commit(selected, c)}><Emblem color={c}/>{colorName[c]}</ArcadeButton>)}</div>
        : needsTarget && selected ? <div className="ichi-targets" role="group" aria-label="Choose who to swap with"><p>Swap hands with…</p>{v.players.filter(p => p.id !== me).map(p => <ArcadeButton key={p.id} tone="ghost" aria-label={`Swap with ${p.name}`} disabled={disabled} onClick={() => commit(selected, undefined, p.id)} style={{ '--seat': p.color } as CSSProperties}>Swap with {p.name}<b className="kp-numeral">{p.count}</b></ArcadeButton>)}</div>
        : <><div className="ichi-peek" data-color={v.color} aria-hidden="true"><span className="ichi-halo"/><CardFace key={v.top.id} className="ichi-land" card={v.top}/></div><div className="ichi-prompt" data-mine={myTurn || windowMine || own.canCatch || upNext}><strong>{prompt}</strong>{ouch ? <b className="ichi-ouch" key={ouch}>{ouch}</b> : <span>{waiting ? 'Sending to the table…' : sub}</span>}</div></>}
      {connected === false && <StatusNotice>Reconnecting. Your hand and seat are safe.</StatusNotice>}
      {hint && !error && <p className="ichi-hint">{hint}</p>}
      {error && <div className="ichi-toast"><StatusNotice tone="error">{error}</StatusNotice></div>}
    </section>
    <section className="ichi-hand" ref={handRef} aria-label={`Your hand, ${hand.length} cards`}>
      <div className="ichi-hand-head"><strong>Your hand <b className="kp-numeral">{hand.length}</b></strong>
        <span className="ichi-sort" role="group" aria-label="Sort hand">{(['color', 'number'] as const).map(s => <button key={s} aria-pressed={sort === s} aria-label={`Sort by ${s}`} onClick={() => setSort(s)}>{s === 'color' ? 'Color' : '1–9'}</button>)}</span></div>
      {Array.from({ length: rows }, (_, r) => <div key={r} className="ichi-hand-row" style={{ '--cols': Math.max(cols, 1), '--rows': rows } as CSSProperties}>
        {hand.slice(r * cols, (r + 1) * cols).map(c => <button key={c.id} className="ichi-card-button" data-card-id={c.id} data-playable={c.playable} data-jumpable={c.jumpable} data-new={c.id === own.drawnId} data-arrive={arrived.has(c.id)} aria-pressed={selected?.id === c.id} aria-disabled={!(c.playable || c.jumpable)} aria-label={`${cardLabel(c)}${bluffs(c) ? ', bluff' : ''}`} disabled={connected === false} onClick={() => tap(c)}><CardFace card={c}/>{bluffs(c) && <em className="ichi-card-tag">Bluff</em>}</button>)}
        {!hand.length && <p className="ichi-hint">No cards. You’re out!</p>}
      </div>)}
    </section>
    <div className="ichi-actions" aria-busy={waiting}>
      {own.canCatch && <button key={win?.id} className="ichi-shout ichi-catch" style={drain} disabled={disabled} onClick={() => shout('catch')}>Catch!</button>}
      {(own.canCall || windowMine) && <button key={`ichi:${win?.id}`} className="ichi-shout" data-urgent={windowMine} style={windowMine ? drain : undefined} disabled={disabled} onClick={() => shout('ichi')}>Ichi!</button>}
      {selected && !needsColor && !needsTarget && <ArcadeButton size="lg" tone="lime" className="ichi-play" disabled={disabled} onClick={() => commit(selected)}>Play {cardLabel(selected)}</ArcadeButton>}
      {own.canChallenge && <ArcadeButton size="lg" tone="grape" disabled={disabled} onClick={() => void send({ kind: 'challenge', turnId: v.turnId })}>Challenge</ArcadeButton>}
      {myTurn && !v.drawn && <ArcadeButton size="lg" tone={v.pending ? 'coral' : selected ? 'ghost' : 'sun'} disabled={disabled} onClick={() => void send({ kind: 'draw', turnId: v.turnId })}>{v.pending ? `Draw ${v.pending.count}` : 'Draw'}</ArcadeButton>}
      {myTurn && v.drawn && own.drawnId && <ArcadeButton size="lg" tone="sky" disabled={disabled} onClick={() => void send({ kind: 'keep', turnId: v.turnId })}>Keep card</ArcadeButton>}
    </div>
  </>;
}

export function ControllerView(props: Props) {
  const { publicView: v, privateView: own, playerId } = props, [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState('');
  const seated = v.players.some(p => p.id === playerId);
  const next = async (action: Action) => { setBusy(true); setError(''); try { const r = await props.sendAction(action); if (!r.accepted) setError(r.reason ?? 'Not accepted.'); else setSent(action.turnId); } catch { setError('Couldn’t reach the table.'); } finally { setBusy(false); } };
  return <main className="ichi ichi-phone" data-art={art.table} data-phase={v.phase} data-my-turn={v.phase === 'playing' && v.current === playerId}>
    {v.phase === 'intermission' && seated ? <><Break v={v} playerId={playerId!} send={a => void next(a)} busy={busy || sent === v.handId || props.connected === false} serverNowMs={props.serverNowMs}/>{error && <StatusNotice tone="error">{error}</StatusNotice>}</>
      : v.phase === 'complete' ? <section className="ichi-break"><Emblem color="wild"/><h2 className="kp-display">Match over</h2><p>{v.finishReason || 'Look up at the TV for the final standings.'}</p></section>
      : own && seated ? <Hand key={`${props.roundId}:${playerId}`} props={props} own={own}/>
      : <section className="ichi-break"><Emblem color="wild"/><h2 className="kp-display">{seated ? 'Dealing you in…' : 'You’re watching'}</h2><p>{seated ? props.connected === false ? 'Reconnecting. Your hand and seat are safe.' : 'Your hand appears here in a moment.' : 'This match started without you. Watch the TV; you’ll be dealt into the next round.'}</p></section>}
  </main>;
}
