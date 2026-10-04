/* Trolley Court phone: team counsel share a hand (propose, then first lock wins); the Conductor works the lever. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArcadeButton, Countdown, HoldButton, StatusNotice, TextInput } from '../../../party-ui/src/index';
import { KINDS, TIMING, WRITE_IN_MAX, cleanWriteIn, isPick, opposite, type Action, type Card, type CardKind, type PrivateView, type PublicView, type Side, type Target } from './types';
import { CardFace, Cap, Chip, KIND, Skull, TEAM, TrackList, cardText, heading, player, plural, slotName, useNow, vars } from './cards';
import { Lever, type Props } from './display';
import { cue } from './audio';

const read = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* Storage is optional. */ } };
const sameTarget = (a?: Target, b?: Target) => !!a && !!b && a.side === b.side && a.slot === b.slot;
const PHASE_LINE: Record<PublicView['phase'], string> = { deal: 'Dealing', innocent: 'Pick an Innocent', innocentReveal: 'Revealing Innocents', guilty: 'Plant a Guilty', guiltyReveal: 'Revealing the Guilty', modifier: 'Pick Twists', modifierReveal: 'Revealing Twists', plead: 'Pleading', lever: 'Your Honour decides', crash: 'The trolley runs', complete: 'Court adjourned' };

function useSend(props: Props) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const send = async (action: Action) => {
    setBusy(true); setError('');
    try { const r = await props.sendAction(action); if (!r.accepted) setError(r.reason ?? 'The court didn’t accept that.'); return r.accepted; }
    catch { setError('Couldn’t reach the court. Check your connection.'); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, setError, send };
}

function Pips({ v, ids, label }: { v: PublicView; ids: string[]; label: string }) {
  if (!ids.length) return null;
  const names = ids.map(id => player(v, id)?.name ?? 'Teammate');
  return <span className="tc-pip-row" aria-label={`${label} ${names.join(', ')}`}>{ids.map((id, k) => <i key={id} style={vars({ '--seat': player(v, id)?.color ?? '#888' })} aria-hidden="true">{[...names[k]][0]?.toUpperCase()}</i>)}</span>;
}

function PickPanel({ props, own, kind }: { props: Props; own: PrivateView; kind: CardKind }) {
  const { publicView: v, playerId, roomId, roundId } = props, me = playerId!, side = own.side!, now = useNow(props.serverNowMs);
  const { busy, error, setError, send } = useSend(props);
  const slots = own.slots, hand = own.hands[kind], open = slots.filter(s => !s.locked);
  const [active, setActive] = useState(() => open[0]?.index ?? slots[0]?.index ?? 0);
  const slot = slots.find(s => s.index === active) ?? slots[0];
  // A teammate may lock the slot you're on; move to the next open one.
  useEffect(() => { if (slot?.locked && open.length) setActive(open[0].index); }, [slot?.locked?.by, open.length]);
  const [drafts, setDrafts] = useState<Record<number, { cardId: string; target?: Target }>>({});
  const mine = slot?.proposals.find(p => p.by === me), choice = drafts[active] ?? (mine ? { cardId: mine.cardId, target: mine.target } : null);
  const card = choice && hand.find(c => c.id === choice.cardId), list = useRef<HTMLUListElement>(null);
  // Keep the chosen card (and its target/write-in panel) clear of the sticky Lock button.
  useEffect(() => { list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' }); }, [card?.id, active]);
  const usedIn = (id: string) => slots.find(s => s.index !== active && s.locked?.cardId === id);
  const key = `trolley-court:${roomId}:${roundId}:${v.turnId}:${active}`;
  const [texts, setTexts] = useState<Record<number, string>>({});
  // A teammate's latest write-in draft for a blank, so the team can read it and anyone can lock it in.
  const draft = (id: string) => slot?.proposals.filter(p => p.cardId === id && p.text).at(-1)?.text;
  const text = texts[active] ?? read(key) ?? mine?.text ?? (card?.blank ? draft(card.id) : undefined) ?? '';
  let textError = '';
  try { if (card?.blank) cleanWriteIn(text); } catch (e) { textError = (e as Error).message; }
  const late = now >= v.deadline, locked = !!slot?.locked, off = props.connected === false, taken = card ? usedIn(card.id) : undefined;
  const canLock = !!card && !taken && !locked && !late && !busy && !off && !textError && (kind !== 'modifier' || !!choice?.target);
  const extra = (c: Card | undefined, target?: Target, t = text) => ({ ...(kind === 'modifier' && target ? { target } : {}), ...(c?.blank && t ? { text: t } : {}) });
  // Mirror the write-in draft to teammates (and to auto-pick) a moment after typing stops.
  useEffect(() => {
    if (!card?.blank || locked) return;
    const t = setTimeout(() => void props.sendAction({ kind: 'propose', turnId: v.turnId, slot: active, cardId: card.id, ...extra(card, choice?.target) }).catch(() => undefined), 700);
    return () => clearTimeout(t);
  }, [text, card?.id]);

  async function propose(cardId: string, target?: Target) {
    const c = hand.find(x => x.id === cardId), before = drafts[active];
    cue('tap'); setDrafts(d => ({ ...d, [active]: { cardId, target } }));
    if (!(await send({ kind: 'propose', turnId: v.turnId, slot: active, cardId, ...extra(c, target) }))) setDrafts(d => { const n = { ...d }; if (before) n[active] = before; else delete n[active]; return n; });
  }
  async function lock() {
    if (!card || !canLock) return;
    let clean: string | undefined;
    if (card.blank) { try { clean = cleanWriteIn(text); } catch (e) { return setError((e as Error).message); } }
    if (await send({ kind: 'lock', turnId: v.turnId, slot: active, cardId: card.id, ...(clean ? { text: clean } : {}), ...(kind === 'modifier' && choice?.target ? { target: choice.target } : {}) })) { cue('lock'); write(key, null); }
  }
  const lockedCard = (s = slot) => { const l = s!.locked!, c = hand.find(x => x.id === l.cardId); return { ...(c ?? { id: l.cardId, kind, text: '' }), ...(l.text ? { text: l.text } : {}) } as Card; };
  const targetText = (t: Target) => { const c = v.tracks[t.side].slots[t.slot]; return c ? cardText(c.card) : slotName(t.side, t.slot); };
  const name = (id: string) => id === me ? 'you' : player(v, id)?.name ?? 'a teammate';
  const slotLabel = (i: number) => kind === 'modifier' ? `Twist ${i + 1}` : KIND[kind];
  const goal = kind === 'innocent' ? `Tie an Innocent to your own track (${TEAM[side]}).` : kind === 'guilty' ? `Plant a Guilty on ${TEAM[opposite(side)]}’s track.` : 'Pin each Twist on any card, yours or theirs.';
  const other = v.progress[opposite(side)], otherDone = other.total > 0 && other.locked >= other.total;
  const status = off ? 'Reconnecting…' : late ? 'Time’s up. The Clerk is auto-picking.' : busy ? 'Sending…' : !card ? 'Tap a card to suggest it to your team.' : taken ? `That card is in ${slotLabel(taken.index)}. Pick another.` : kind === 'modifier' && !choice?.target ? 'Now choose which card it sticks to.' : card.blank && textError ? 'Write your card, then lock it in.' : 'Suggested. Anyone on your team can lock it in.';

  if (!slot) return <section className="tc-wait"><h2 className="kp-display">Waiting for your hand…</h2></section>;
  return <section className="tc-pick" aria-label={`${PHASE_LINE[v.phase]} for ${TEAM[side]}`}>
    <p className="tc-goal">{goal}</p>
    <div className="tc-slots" role="group" aria-label="Your team’s picks">{slots.map(s => <button key={s.index} className="tc-slot-tab" aria-pressed={s.index === active} data-locked={!!s.locked} onClick={() => setActive(s.index)}>
      <b>{slotLabel(s.index)}</b><small>{s.locked ? `✓ ${name(s.locked.by)}` : s.proposals.length ? plural(s.proposals.length, 'idea') : 'Open'}</small>
    </button>)}</div>
    {locked ? <div className="tc-locked">
      <CardFace card={lockedCard()} label={slotLabel(slot.index)}><b className="tc-stamp">Locked by {name(slot.locked!.by)}</b></CardFace>
      {slot.locked!.target && <p className="tc-target-note">On: <b>{TEAM[slot.locked!.target.side]}</b> · {targetText(slot.locked!.target)}</p>}
      <p className="tc-waiting">{open.length ? `${plural(open.length, 'pick')} still open.` : otherDone ? 'Both teams locked. Watch the TV!' : `Waiting for ${TEAM[opposite(side)]}…`}</p>
    </div>
      : <ul className="tc-hand" ref={list} aria-label={`${KIND[kind]} hand`}>{hand.map(c => {
        const used = usedIn(c.id), on = choice?.cardId === c.id, ids = slot.proposals.filter(p => p.cardId === c.id).map(p => p.by), shown = c.blank && (on ? text : draft(c.id));
        return <Fragment key={c.id}><li>
          <button className="tc-hand-card" aria-pressed={on} disabled={!!used || late || off} onClick={() => { if (!on) void propose(c.id, choice?.target); }}>
            <CardFace card={shown ? { ...c, text: shown } : c}>{used ? <em className="tc-used">In {slotLabel(used.index)}</em> : <Pips v={v} ids={ids} label="Suggested by"/>}</CardFace>
          </button>
        </li>
          {on && (c.blank || kind === 'modifier') && <li className="tc-detail">
            {c.blank && <label className="tc-write"><span>Your write-in ({[...text].length}/{WRITE_IN_MAX})</span>
              <TextInput value={text} placeholder="A pigeon with a law degree" autoComplete="off" enterKeyHint="done" disabled={late || off}
                onChange={e => { const t = [...e.target.value].slice(0, WRITE_IN_MAX).join(''); setTexts(x => ({ ...x, [active]: t })); write(key, t); }}/>
              {text && textError && <small role="alert">{textError}</small>}</label>}
            {kind === 'modifier' && <div className="tc-targets" role="group" aria-label="Stick this twist on">
              <p>Stick it on…</p>
              {(side === 'north' ? ['north', 'south'] as const : ['south', 'north'] as const).map(s => <div key={s} className="tc-target-row" data-side={s}><h4>{TEAM[s]}{s === side ? ' · yours' : ''}</h4>
                {([0, 1, 2] as const).map(i => { const t = { side: s, slot: i }; return <button key={i} className="tc-target" data-side={s} aria-pressed={sameTarget(choice?.target, t)} disabled={late || off} onClick={() => void propose(c.id, t)}>
                  <small>{slotName(s, i)}</small><span>{targetText(t)}</span><Pips v={v} ids={slot.proposals.filter(p => sameTarget(p.target, t)).map(p => p.by)} label="Aimed here by"/>
                </button>; })}
              </div>)}
            </div>}
          </li>}
        </Fragment>;
      })}</ul>}
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    {!locked && <div className="tc-dock"><p role="status">{status}</p><ArcadeButton size="lg" tone="lime" disabled={!canLock} onClick={() => void lock()}>{busy ? 'Locking…' : 'Lock it in'}</ArcadeButton></div>}
  </section>;
}

function Indicator({ v, side }: { v: PublicView; side?: Side | null }) {
  const h = heading(v);
  return <p className="tc-indicator" data-side={h}><Lever pulled={v.lever.pulled}/><span><small>Trolley heading</small><b className="kp-display">{TEAM[h]}</b>{side && <em>{h === side ? 'That’s your track!' : 'Not your track… yet'}</em>}</span></p>;
}

function Tracks({ v, side }: { v: PublicView; side?: Side | null }) {
  const order = side === 'south' ? ['south', 'north'] as const : ['north', 'south'] as const;
  return <div className="tc-tracklists">{order.map(s => <TrackList key={s} v={v} side={s} mine={s === side}/>)}</div>;
}

function Hands({ own, open }: { own: PrivateView; open?: CardKind }) {
  const kinds = KINDS.filter(k => own.hands[k].length);
  if (!kinds.length) return null;
  return <div className="tc-peek"><p className="kp-eyebrow">Your team’s hands (secret)</p>{kinds.map(k => <details key={k} open={k === open}><summary>{KIND[k]} hand · {plural(own.hands[k].length, 'card')}</summary>
    <ul>{own.hands[k].map(c => <li key={c.id}><CardFace card={c}/></li>)}</ul></details>)}</div>;
}

function HoldConfirm({ label, side, disabled, onConfirm, children }: { label: string; side: Side; disabled: boolean; onConfirm(): void; children: ReactNode }) {
  const [held, setHeld] = useState(false);
  useEffect(() => { if (!held) return; const t = setTimeout(() => { setHeld(false); onConfirm(); }, 1000); return () => clearTimeout(t); }, [held]);
  return <div className="tc-hold" data-side={side} data-held={held}><HoldButton label={label} disabled={disabled} onChange={setHeld}>{children}<small>{held ? 'Keep holding…' : 'Press and hold'}</small></HoldButton></div>;
}

function Conductor({ props }: { props: Props }) {
  const { publicView: v } = props, now = useNow(props.serverNowMs), { busy, error, send } = useSend(props);
  const [lean, setLean] = useState<boolean | null>(null);
  useEffect(() => setLean(null), [v.lever.pulled, v.turnId]);
  const pulled = lean ?? v.lever.pulled, h = pulled ? opposite(v.defaultSide) : v.defaultSide, off = props.connected === false;
  const floorStart = v.step === 0 ? v.startedAt : Math.max(v.startedAt, v.deadline - v.settings.floorSeconds * 1000), nextAt = floorStart + TIMING.floorMinMs;
  const toggle = async () => { const next = !pulled; setLean(next); cue('lever'); if (!(await send({ kind: 'lean', turnId: v.turnId, pulled: next }))) setLean(null); };
  const lever = <button className="tc-switch" role="switch" aria-checked={pulled} aria-label={`Trolley heading: ${TEAM[h].toUpperCase()}`} data-side={h} disabled={off || v.lever.decided} onClick={() => void toggle()}>
    <Lever pulled={pulled}/><span><small>Trolley heading</small><b className="kp-display">{TEAM[h]}</b><em>{pulled ? 'Pulled. Tap to put it back.' : 'Untouched. Tap to pull.'}</em></span>
  </button>;
  const building = !['plead', 'lever', 'crash', 'complete'].includes(v.phase);
  return <section className="tc-conductor">
    {building && <><h2 className="kp-display">You’re the Conductor</h2>
      <p>Watch both tracks fill up. Then each team pleads, and you decide. The trolley heads <b className={`tc-team-${v.defaultSide}`}>{TEAM[v.defaultSide]}</b> unless you pull the lever.</p>
      {isPick(v.phase) && <ul className="tc-progress-mini">{(['north', 'south'] as const).map(s => { const p = v.progress[s]; return <li key={s} data-side={s}><b>{TEAM[s]}</b> {p.total && p.locked >= p.total ? '✓ locked' : `${p.locked}/${p.total} locked…`}</li>; })}</ul>}</>}
    {v.phase === 'plead' && <>
      <h2 className="kp-display">{TEAM[v.floor ?? v.defaultSide]} has the floor</h2>
      <p>Listen, lean the lever as they sway you, and move things along when you’ve heard enough.</p>
      {lever}
      <ArcadeButton size="lg" tone="sky" disabled={busy || off || now < nextAt} onClick={() => void send({ kind: 'next', turnId: v.turnId, step: v.step })}>{v.step === 0 ? 'Next speaker ▶' : 'To the lever ▶'}</ArcadeButton>
      {now < nextAt && <p className="tc-hint">Available in {Math.ceil((nextAt - now) / 1000)} s</p>}
    </>}
    {v.phase === 'lever' && (v.lever.decided ? <div className="tc-verdict"><h2 className="kp-display">Verdict delivered</h2><p>The trolley heads <b>{TEAM[h]}</b>.</p></div> : <>
      <h2 className="kp-display">Decide now</h2>
      <p>Press and hold for one second. Time out and the lever stays where it is.</p>
      <div className="tc-verdicts"><HoldConfirm label={`Pull the lever: hits ${TEAM[opposite(v.defaultSide)]}`} side={opposite(v.defaultSide)} disabled={busy || off} onConfirm={() => void send({ kind: 'decide', turnId: v.turnId, pull: true })}><b className="kp-display">Pull the lever</b><span>→ hits {TEAM[opposite(v.defaultSide)]}</span></HoldConfirm>
      <HoldConfirm label={`Do nothing: hits ${TEAM[v.defaultSide]}`} side={v.defaultSide} disabled={busy || off} onConfirm={() => void send({ kind: 'decide', turnId: v.turnId, pull: false })}><b className="kp-display">Do nothing</b><span>→ hits {TEAM[v.defaultSide]}</span></HoldConfirm></div>
      {lever}
    </>)}
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    <Tracks v={v}/>
  </section>;
}

function Result({ v, side, me }: { v: PublicView; side?: Side | null; me?: string }) {
  const p = player(v, me), hit = !!side && v.struck === side;
  if (!v.struck) return null;
  return <section className="tc-result" data-hit={hit} data-side={side ?? undefined}>
    {side ? <><h2 className="kp-display">{hit ? 'Struck!' : 'Spared!'}</h2><p>{hit ? '+1 death for your whole team.' : `${TEAM[opposite(side)]} took the hit.`}</p></>
      : <><h2 className="kp-display">{TEAM[v.struck]} is struck</h2><p>{v.lever.timedOut ? 'You dithered. The lever stayed put.' : v.lever.pulled ? 'You pulled the lever.' : 'You did nothing.'} Conductors never score.</p></>}
    {p && <p className="tc-total"><Skull/> {plural(p.deaths, 'death')} so far</p>}
  </section>;
}

function Team({ props, own }: { props: Props; own: PrivateView }) {
  const { publicView: v } = props, side = own.side!, kind = isPick(v.phase) ? v.phase : null;
  const next: CardKind | undefined = v.phase === 'deal' ? 'innocent' : v.phase === 'innocentReveal' ? 'guilty' : v.phase === 'guiltyReveal' ? 'modifier' : undefined;
  if (kind && own.slots.length) return <PickPanel key={v.turnId} props={props} own={own} kind={kind}/>;
  if (v.phase === 'crash' || v.phase === 'complete') return <><Result v={v} side={side} me={props.playerId!}/><Tracks v={v} side={side}/></>;
  if (v.phase === 'plead' || v.phase === 'lever') {
    const mine = v.floor === side;
    return <section className="tc-plead" data-mine={v.phase === 'plead' && mine}>
      <h2 className="kp-display">{v.phase === 'lever' ? 'Shout now!' : mine ? 'Your floor: argue out loud!' : `${TEAM[v.floor ?? opposite(side)]} has the floor`}</h2>
      <p>{v.phase === 'lever' ? 'The Conductor is deciding. Make your case!' : mine ? 'Convince Your Honour to send the trolley the other way.' : 'Listen, then get ready to answer.'}</p>
      <Indicator v={v} side={side}/>
      <Tracks v={v} side={side}/>
    </section>;
  }
  return <section className="tc-watch"><h2 className="kp-display">Watch the TV</h2><p>{kind ? 'Time’s up. The Clerk picked for your team.' : 'Cards are being revealed. Plan quietly with your team.'}</p><Tracks v={v} side={side}/><Hands own={own} open={next}/></section>;
}

export function ControllerView(props: Props) {
  const { publicView: v, privateView: own, playerId } = props, me = player(v, playerId ?? undefined);
  const side = own?.side ?? null, mates = side ? v.tracks[side].team.filter(id => id !== playerId).map(id => (player(v, id)?.name ?? '').split(' ')[0]) : [];
  const withWho = mates.length > 2 ? `${mates.slice(0, 2).join(', ')} +${mates.length - 2}` : mates.join(', ');
  const timer = (isPick(v.phase) || v.phase === 'plead' || v.phase === 'lever');
  return <main className="tc tc-phone" data-side={side ?? undefined} data-role={own?.role}>
    <header className="tc-phone-head">
      {own?.role === 'conductor' ? <span className="tc-role" data-role="conductor"><Cap/>Conductor</span>
        : side ? <span className="tc-role" data-side={side}><b>{TEAM[side].toUpperCase()}</b>{mates.length ? ` · with ${withWho}` : ' · solo counsel'}</span>
        : <span className="tc-role">Watching</span>}
      <span className="tc-phase">Round {v.round}/{v.rounds} · {PHASE_LINE[v.phase]}</span>
      {timer && <span className="tc-phone-clock" data-low={v.deadline - props.serverNowMs() < 10500}><Countdown deadline={v.deadline} serverNowMs={props.serverNowMs}/></span>}
    </header>
    {props.connected === false && <StatusNotice>Reconnecting. Your seat and your team’s picks are safe.</StatusNotice>}
    {!me ? <section className="tc-watch"><h2 className="kp-display">You’re watching</h2><p>This case started without you. You’ll get a seat when the host starts the next game.</p><Tracks v={v}/></section>
      : !own ? <section className="tc-watch"><h2 className="kp-display">Taking your seat…</h2><p>Your role appears here in a moment.</p></section>
      : own.role === 'conductor' ? (v.phase === 'crash' || v.phase === 'complete' ? <><Result v={v} me={playerId!}/><Tracks v={v}/></> : <Conductor props={props}/>)
      : <Team props={props} own={own}/>}
    {me && <p className="tc-me"><Chip p={me}/> <span><Skull/> {plural(me.deaths, 'death')}</span></p>}
  </main>;
}
