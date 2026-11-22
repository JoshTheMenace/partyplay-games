/* Trolley Court TV: a 1920×1080 junction scene scaled to fit. Trolley and lever on the left, North and South tracks on the right. */
import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import { Countdown, type GameViewProps } from '../../../party-ui/src/index';
import { CRASH, PHASES, SHOUTS, isPick, opposite, standOpen, type Action, type PrivateView, type PublicView, type Side, type TrackCard } from './types';
import { CardBack, CardFace, Cap, Chip, Dot, SHOUT, Skull, TEAM, art, clerkLine, credit, fromName, heading, heads, player, plural, sideOfSeat, slotName, standers, useNow, vars } from './cards';

export type Props = GameViewProps<null, Action, PublicView, PrivateView>;
const W = 1920, H = 1080, MAIN = 445, RAIL: Record<Side, number> = { north: 233, south: 657 }, ROW: Record<Side, number> = { north: 112, south: 536 };
/** Stage x of slot i's left edge, and of the showcase's centre. */
const slotX = (i: number) => 736 + 392 * i, SHOW = { x: 1316, y: 470 };
/** The trolley's route in stage pixels: parked on the main line, through the switch, then along a branch and off screen. */
const curve = (side: Side) => `C380 ${MAIN} 380 ${RAIL[side]} 470 ${RAIL[side]}`, route = (side: Side) => `M150 ${MAIN}H290${curve(side)}H2200`;
/** When the trolley's nose reaches stage x on a branch, in ms from the start of the crash (the route is ~2205px long). */
const LENGTH = 2205, hitAtX = (x: number) => Math.round(CRASH.runAt + CRASH.runMs * (x - 155) / LENGTH), hitAt = (i: number) => hitAtX(slotX(i) + 188);
const BONK = ['BONK!', 'POW!', 'KLUNK!'];
const STARS = [[90, 150, 0], [250, 96, 1.3], [400, 190, .6], [70, 330, 2.1], [330, 300, .2], [470, 80, 1.7], [1090, 500, .9], [1500, 520, 2.4], [1880, 470, .4], [700, 505, 1.5], [1700, 990, 1], [120, 1010, 1.9]];

function useFit() {
  const ref = useRef<HTMLDivElement>(null), [fit, setFit] = useState({ scale: .5, left: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const width = el.clientWidth, height = Math.max(240, document.documentElement.clientHeight - el.getBoundingClientRect().top - window.scrollY - 12);
      const scale = Math.min(width / W, height / H), left = (width - W * scale) / 2;
      setFit(old => old.scale === scale && old.left === left ? old : { scale, left });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el); window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return [ref, fit] as const;
}

function words(v: PublicView) {
  const judge = player(v, v.conductor)?.name ?? 'The Conductor', fl = v.floor ? TEAM[v.floor] : '', st = v.struck ? TEAM[v.struck] : '';
  const beat = v.step > 0 ? `Card ${v.step} of ${v.steps - 1}` : 'Face down, for now…', toll = `${heads(v, 'north')} on North, ${heads(v, 'south')} on South.`;
  switch (v.phase) {
    case 'deal': return { banner: v.round === v.rounds ? 'Final case' : `Case ${v.round}`, kicker: v.round === 1 ? 'Court is in session' : `Case ${v.round} of ${v.rounds}`, title: v.round === v.rounds ? 'Final case' : v.round === 1 ? 'First case' : 'Next case', sub: `${judge} takes the lever. Two bystanders are already tied to the tracks.` };
    case 'innocent': return { banner: 'Counsel: tie an Innocent to your own track', kicker: 'Pick an Innocent', title: 'Save someone', sub: 'Put someone worth sparing on your own track.' };
    case 'innocentReveal': return { banner: 'The Innocents', kicker: 'The Clerk reveals', title: 'The Innocents', sub: beat };
    case 'guilty': return { banner: 'Counsel: plant a Guilty on the other track', kicker: 'Pick a Guilty', title: 'Frame someone', sub: 'Put someone deserving on the other team’s track.' };
    case 'guiltyReveal': return { banner: 'The Guilty', kicker: 'The Clerk reveals', title: 'The Guilty', sub: beat };
    case 'modifier': return { banner: 'Pin Twists on any card, yours or theirs', kicker: 'Pick your Twists', title: 'Twist the case', sub: 'Make your side sweeter, or theirs worse.' };
    case 'modifierReveal': return { banner: 'The Twists', kicker: 'The Clerk reveals', title: 'The Twists', sub: v.step > 0 ? `Twist ${v.step} of ${v.steps - 1}` : 'Face down, for now…' };
    case 'plead': return { banner: `${fl} has the floor`, kicker: `Floor ${v.step + 1} of 2`, title: `${fl} has the floor`, sub: v.crowd ? 'Gallery: hop tracks while you still can.' : v.floor === v.defaultSide ? 'In the path, so they argue first.' : 'Rebuttal. Make it count.' };
    case 'lever': return { banner: 'Your Honour decides', kicker: 'Open floor: shout!', title: 'Decision time', sub: v.crowd ? `${toll} ${judge} has the lever.` : `${judge} has the lever.` };
    case 'crash': return { banner: `${st} is struck`, kicker: 'Verdict', title: `${st} is struck`, sub: v.lever.timedOut ? 'Your Honour dithered. The lever stayed put.' : v.lever.pulled ? 'Your Honour pulled the lever.' : 'Your Honour did nothing.' };
    default: return { banner: 'Court adjourned', kicker: 'Final verdict', title: 'Court adjourned', sub: 'Fewest deaths walks free.' };
  }
}

/** What an unrevealed slot shows: a face-down card (maybe stamped LOCKED), or an empty outline with a note. */
function hidden(v: PublicView, side: Side, i: number): { back: boolean; stamp?: string; note?: string } {
  const at = PHASES.indexOf(v.phase);
  if (i === 0) return { back: v.phase === 'deal', note: 'Bystander' };
  const pick = i === 1 ? 'innocent' : 'guilty', owner = i === 1 ? side : opposite(side);
  if (v.phase === pick) return v.progress[owner].locked ? { back: true, stamp: 'Locked' } : { back: false, note: `${TEAM[owner]} is choosing…` };
  return { back: at > PHASES.indexOf(pick) && v.phase !== 'complete' };
}

function Mods({ v, c }: { v: PublicView; c: TrackCard }) {
  const n = c.mods.length, spot = v.spotlight, mine = spot && v.tracks[spot.side].slots[spot.slot] === c ? spot.mod : undefined, [tick, setTick] = useState(0);
  useEffect(() => { if (n <= 3) return; const t = setInterval(() => setTick(k => k + 1), 3500); return () => clearInterval(t); }, [n]);
  if (!n) return null;
  // Up to three chips; beyond that two at a time, cycling, with a "+N more" chip. The spotlit twist is always in view.
  const start = n <= 3 ? 0 : mine !== undefined ? Math.max(0, mine - 1) : tick * 2 % n;
  const shown = n <= 3 ? c.mods.map((m, k) => [m, k] as const) : [0, 1].map(o => [c.mods[(start + o) % n], (start + o) % n] as const);
  return <ul className="tc-mods" data-many={n > 3} data-n={shown.length}>
    {shown.map(([m, k]) => <li key={m.card.id} className="tc-mod" data-from={m.from} data-spot={k === mine}><span>+ {m.card.text}</span></li>)}
    {n > 3 && <li className="tc-more">+{n - 2} more twist{n - 2 === 1 ? '' : 's'}</li>}
  </ul>;
}

function Slot({ v, side, i }: { v: PublicView; side: Side; i: number }) {
  const c = v.tracks[side].slots[i], spot = v.spotlight?.side === side && v.spotlight.slot === i ? v.spotlight : null;
  const h = c ? null : hidden(v, side, i);
  return <div className="tc-slot" data-spot={!!spot && spot.mod === undefined} data-target={!!spot && spot.mod !== undefined} style={vars({ '--hit': `${hitAt(i)}ms` })}>
    {c ? <CardFace key={c.card.id} card={c.card} label={slotName(side, i)} className={spot && spot.mod === undefined ? 'tc-flip' : ''}>
      <b className="tc-struck-stamp" aria-hidden="true">Struck</b><i className="tc-bonk" aria-hidden="true">{BONK[i]}</i>
    </CardFace>
      : h!.back ? <CardBack stamp={h!.stamp}><small>{slotName(side, i)}</small></CardBack>
      : <div className="tc-empty-slot"><small>{slotName(side, i)}</small>{h!.note && <span>{h!.note}</span>}</div>}
    {c && <Mods v={v} c={c}/>}
  </div>;
}

function Plate({ v, side }: { v: PublicView; side: Side }) {
  const t = v.tracks[side], p = v.progress[side], hit = v.phase === 'crash' && v.struck === side, stood = standers(v, side).length;
  const revealed = (['north', 'south'] as const).reduce((n, s) => n + v.tracks[s].slots.reduce((m, c) => m + (c?.mods.filter(x => x.from === side).length ?? 0), 0), 0);
  const backs = v.phase === 'modifier' ? p.locked : v.phase === 'modifierReveal' ? Math.max(0, p.total - revealed) : 0;
  return <aside className="tc-plate" data-side={side} data-big={t.team.length > 3}>
    <h2 className="kp-display">{TEAM[side]}</h2>
    {v.struck ? <span className="tc-tag" data-hit={v.struck === side}>{v.struck === side ? 'Struck' : 'Spared'}</span> : v.defaultSide === side && <span className="tc-tag">In the path</span>}
    <ul>{t.team.map(id => { const q = player(v, id); return <li key={id}><Chip p={q}>{!!q?.deaths && <span className="tc-pips" aria-label={plural(q.deaths, 'death')}><Skull/>{hit ? <><s>{q.deaths - 1}</s><b>{q.deaths}</b></> : q.deaths}</span>}</Chip>{v.underdogs.includes(id) && <em className="tc-underdog">Underdog</em>}</li>; })}</ul>
    {v.crowd && <p className="tc-heads" data-hit={hit}><b className="kp-numeral">{t.team.length + stood}</b><span>on this track<small>{t.team.length} counsel + {stood} standing</small></span></p>}
    {(v.phase === 'modifier' || v.phase === 'modifierReveal') && <div className="tc-twist-count"><span>{v.phase === 'modifier' ? `Twists ${p.locked}/${p.total} locked` : backs ? `${plural(backs, 'twist')} to reveal` : 'Twists revealed'}</span><span className="tc-mini-backs" aria-hidden="true">{Array.from({ length: backs }, (_, k) => <i key={k}/>)}</span></div>}
    {v.phase === 'plead' && v.floor === side && <b className="tc-floor-flag kp-display">Has the floor</b>}
  </aside>;
}

/** Crowd: the Gallery members standing on this track, lined up along its edge. The trolley flattens them in passing. */
function Band({ v, side }: { v: PublicView; side: Side }) {
  // Newcomers join the end of the line, so a hop moves one dot and the rest stay put.
  const here = standers(v, side), line = useRef<number[]>([]), seats = line.current = [...line.current.filter(s => here.includes(s)), ...here.filter(s => !line.current.includes(s))];
  const pitch = Math.min(40, 1126 / Math.max(1, seats.length));
  return <div className="tc-band" aria-label={`${plural(seats.length, 'Gallery member')} standing on ${TEAM[side]}`}>
    {seats.map((seat, k) => <Dot key={seat} p={v.players[seat]} style={vars({ left: `${k * pitch}px`, '--hit': `${hitAtX(slotX(0) + 20 + k * pitch)}ms` })}/>)}
    {!seats.length && standOpen(v.phase) && <span>Nobody is standing here yet</span>}
  </div>;
}

function Row({ v, side }: { v: PublicView; side: Side }) {
  const crash = v.phase === 'crash' || v.phase === 'complete', struck = crash && v.struck === side;
  const lit = v.phase === 'lever' || (v.phase === 'plead' && v.floor === side), dim = v.phase === 'plead' && v.floor !== side;
  return <section className="tc-row" data-side={side} data-lit={lit} data-dim={dim} data-struck={struck} data-spared={crash && !struck} aria-label={`${TEAM[side]} track`}>
    <Plate v={v} side={side}/>
    {[0, 1, 2].map(i => <Slot key={i} v={v} side={side} i={i}/>)}
    {v.crowd && <Band v={v} side={side}/>}
    {crash && !struck && <><b className="tc-ribbon kp-display">Spared</b><span className="tc-confetti" aria-hidden="true">{Array.from({ length: 16 }, (_, k) => <i key={k} style={vars({ '--k': k })}/>)}</span></>}
  </section>;
}

/** The judge-conductor: seat-coloured robe, powdered wig, conductor's cap. The eyes follow the lever. */
export function Judge({ color, look, shock }: { color: string; look?: Side; shock?: boolean }) {
  return <svg className="tc-judge" viewBox="0 0 220 300" style={vars({ '--seat': color })} data-look={look} data-shock={shock} aria-hidden="true">
    <path d="M150 205l55-30" stroke="var(--seat)" strokeWidth="24" strokeLinecap="round"/><circle cx="205" cy="175" r="13" fill="#f2c9a0" stroke="var(--kp-ink)" strokeWidth="4"/>
    <path d="M40 300c0-90 22-128 70-128s70 38 70 128z" fill="var(--seat)" stroke="var(--kp-ink)" strokeWidth="6"/>
    <path d="M90 174l20 40 20-40z" fill="var(--kp-cream)" stroke="var(--kp-ink)" strokeWidth="4"/>
    {[[62, 118], [56, 146], [60, 172], [158, 118], [164, 146], [160, 172]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="17" fill="var(--kp-cream)" stroke="var(--kp-ink)" strokeWidth="4"/>)}
    <circle cx="110" cy="122" r="44" fill="#f2c9a0" stroke="var(--kp-ink)" strokeWidth="6"/>
    <path className="tc-brow" d="M86 112l16 4M134 112l-16 4" stroke="var(--kp-ink)" strokeWidth="6" strokeLinecap="round"/>
    <g className="tc-eyes"><circle cx="95" cy="126" r="5" fill="var(--kp-ink)"/><circle cx="125" cy="126" r="5" fill="var(--kp-ink)"/></g>
    <path d="M98 148q12 -6 24 0" stroke="var(--kp-ink)" strokeWidth="5" fill="none" strokeLinecap="round"/>
    <path d="M60 92c0-40 100-40 100 0z" fill="#1d2a6b" stroke="var(--kp-ink)" strokeWidth="6"/><path d="M52 92h116l-8 14H60z" fill="var(--kp-ink)"/><circle cx="110" cy="72" r="9" fill="var(--kp-sun)" stroke="var(--kp-ink)" strokeWidth="3"/>
  </svg>;
}

export function Lever({ pulled, locked }: { pulled: boolean; locked?: boolean }) {
  return <svg className="tc-lever" viewBox="0 0 160 300" data-pulled={pulled} aria-hidden="true">
    <g className="tc-lever-arm"><rect x="72" y="50" width="16" height="200" rx="8" fill="#c7cbe0" stroke="var(--kp-ink)" strokeWidth="5"/><circle cx="80" cy="52" r="26" fill="var(--kp-coral)" stroke="var(--kp-ink)" strokeWidth="6"/><circle cx="72" cy="44" r="7" fill="#fff8"/></g>
    <path d="M20 296v-38a60 40 0 0 1 120 0v38z" fill="#3a3f63" stroke="var(--kp-ink)" strokeWidth="6"/><rect x="10" y="280" width="140" height="20" rx="6" fill="#262a4a" stroke="var(--kp-ink)" strokeWidth="5"/>
    {locked && <g transform="translate(62 236)"><rect y="14" width="36" height="28" rx="5" fill="var(--kp-sun)" stroke="var(--kp-ink)" strokeWidth="4"/><path d="M8 16V8a10 10 0 0 1 20 0v8" fill="none" stroke="var(--kp-ink)" strokeWidth="5"/></g>}
  </svg>;
}

/** The Clerk: green eyeshade, half-moon glasses, a quill behind the ear. */
const Clerk = () => <svg className="tc-clerk-face" viewBox="0 0 48 48" aria-hidden="true">
  <path d="M38 6l6-4-2 12z" fill="var(--kp-cream)" stroke="var(--kp-ink)" strokeWidth="2" strokeLinejoin="round"/>
  <circle cx="24" cy="27" r="15" fill="#e8b98f" stroke="var(--kp-ink)" strokeWidth="3"/>
  <path d="M6 22c2-13 34-13 36 0l4 3H2z" fill="var(--kp-lime)" stroke="var(--kp-ink)" strokeWidth="3" strokeLinejoin="round"/>
  <path d="M13 30a5 5 0 0 0 10 0zM25 30a5 5 0 0 0 10 0z" fill="#fff8" stroke="var(--kp-ink)" strokeWidth="2.5"/><path d="M19 39h10" stroke="var(--kp-ink)" strokeWidth="3" strokeLinecap="round"/>
</svg>;
const Gavel = () => <svg className="tc-gavel" viewBox="0 0 120 120" aria-hidden="true"><g stroke="var(--kp-ink)" strokeWidth="6" strokeLinejoin="round" transform="rotate(-40 60 60)"><rect x="52" y="48" width="16" height="66" rx="7" fill="#b07a4a"/><rect x="26" y="18" width="68" height="36" rx="9" fill="var(--kp-coral)"/><rect x="26" y="18" width="14" height="36" rx="5" fill="var(--kp-sun)"/><rect x="80" y="18" width="14" height="36" rx="5" fill="var(--kp-sun)"/></g></svg>;

function Track({ d, className }: { d: string; className?: string }) {
  return <g className={className}><path d={d} className="tc-bed"/><path d={d} className="tc-ties"/><path d={d} className="tc-rails"/><path d={d} className="tc-gap"/><path d={d} className="tc-ties tc-ties-in"/></g>;
}

function Junction({ v }: { v: PublicView }) {
  const h = heading(v), crash = v.phase === 'crash', judge = player(v, v.conductor);
  return <>
    <svg className="tc-tracks" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <Track d={`M-40 ${MAIN}H300`}/>
      {(['north', 'south'] as const).map(s => <Track key={s} className={`tc-branch${s === h ? ' is-hot' : ''}`} d={`M285 ${MAIN}H290${curve(s)}H${W + 40}`}/>)}
      <g className="tc-signal" data-side={h} transform="translate(440 432)"><rect x="-5" y="0" width="10" height="92" rx="4"/><rect x="-19" y="-58" width="38" height="66" rx="12"/><circle className="tc-lamp-n" cy="-40" r="11"/><circle className="tc-lamp-s" cy="-10" r="11"/></g>
      <g className="tc-default" transform={`translate(${v.defaultSide === 'north' ? '392 350' : '392 600'})`}><rect x="-68" y="-20" width="136" height="36" rx="8"/><text y="7">DEFAULT</text></g>
    </svg>
    <div className="tc-trolley" data-run={crash} data-mood={v.phase === 'lever' ? 'rev' : 'idle'} style={{ offsetPath: `path('${route(h)}')` }}>
      <span className="tc-beam"/><span className="tc-streaks"/>
      <img src={`${art.base}art/trolley.svg`} alt="" draggable={false}/>
    </div>
    <div className="tc-heading" data-side={h}><span>{crash || v.phase === 'complete' ? 'Ran down' : 'Heading'}</span><b className="kp-display">{TEAM[h]}</b><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M2 12h28M22 3l12 9-12 9" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
    <div className="tc-bench">
      <Judge color={judge?.color ?? '#888'} look={h} shock={crash}/>
      <Lever pulled={v.lever.pulled} locked={v.lever.decided || crash}/>
      <p className="tc-nameplate"><Cap/><span><small>Your Honour</small><b>{judge?.name ?? '—'}</b></span></p>
      <p className="tc-lever-state" data-pulled={v.lever.pulled}>{v.lever.decided || crash ? v.lever.timedOut ? 'Left as it was' : v.lever.pulled ? 'Pulled!' : 'Untouched' : v.lever.pulled ? 'Leaning: pull' : 'Lever: untouched'}</p>
    </div>
  </>;
}

function Board({ v, now, serverNowMs }: { v: PublicView; now: number; serverNowMs(): number }) {
  const w = words(v), live = (isPick(v.phase) || v.phase === 'plead' || v.phase === 'lever') && v.deadline > now;
  const both = isPick(v.phase) && (['north', 'south'] as const).every(s => v.progress[s].locked >= v.progress[s].total && v.progress[s].total > 0);
  const seats = [...v.gallery].filter(c => c !== '-'), done = v.phase === 'innocent' ? seats.filter(c => c !== '?').length : v.ballots;
  return <div className="tc-board" data-phase={v.phase} data-floor={v.floor ?? undefined}>
    <p className="tc-kicker">{w.kicker}</p>
    <h1 className="kp-display" key={`${v.turnId}`}>{w.title}</h1>
    {isPick(v.phase) ? <ul className="tc-progress">{(['north', 'south'] as const).map(s => { const p = v.progress[s], ok = p.total > 0 && p.locked >= p.total; return <li key={s} data-side={s} data-done={ok}><b>{TEAM[s]}</b><span>{ok ? '✓ Locked' : `${p.locked}/${p.total} locked…`}</span></li>; })}
      {v.crowd && <li className="tc-jury" data-done={done >= seats.length}><b>Gallery</b><span>{done}/{seats.length} {v.phase === 'innocent' ? 'standing' : v.phase === 'guilty' ? 'voted on its twist' : 'aimed its twist'}</span></li>}
      {both && !v.crowd && <li className="tc-all">All locked!</li>}</ul>
      : <p className="tc-sub">{w.sub}</p>}
    {live && (v.phase === 'plead' || v.phase === 'lever') && <div className="tc-big-clock" data-low={v.deadline - now < 5500}><Countdown deadline={v.deadline} serverNowMs={serverNowMs}/></div>}
  </div>;
}

/** The card or twist being revealed, big and centre stage for the beat, then back to its slot. */
function Showcase({ v }: { v: PublicView }) {
  const sp = v.spotlight, host = sp && v.tracks[sp.side].slots[sp.slot];
  if (!sp || !host) return null;
  const mod = sp.mod === undefined ? null : host.mods[sp.mod], beat = v.deadline - v.startedAt;
  return <div className="tc-showcase" data-side={sp.side} style={vars({ '--dx': `${slotX(sp.slot) + 188 - SHOW.x}px`, '--dy': `${ROW[sp.side] + 85 - SHOW.y}px`, '--beat': `${beat}ms` })} aria-hidden="true">
    <p className="tc-show-where"><b>{TEAM[sp.side]} track</b>{!mod && <span>{credit(v, host)}</span>}</p>
    <CardFace card={host.card} label={slotName(sp.side, sp.slot)}/>
    {mod && <p className="tc-show-mod" data-from={mod.from}><b>+ {mod.card.text}</b><small>{mod.from === 'gallery' ? 'The Gallery’s twist' : `${fromName(mod.from)}’s twist`} · {credit(v, mod)}</small></p>}
  </div>;
}

/** The ruling, stamped across the stage before the trolley moves. */
function Verdict({ v }: { v: PublicView }) {
  if (v.phase !== 'crash' || !v.struck) return null;
  const how = v.lever.timedOut ? 'dithered' : v.lever.pulled ? 'pulled' : 'nothing', toll = heads(v, v.struck);
  return <div className="tc-verdict-card" data-how={how} data-side={v.struck} aria-hidden="true">
    <Gavel/>
    <small>Your Honour {player(v, v.conductor)?.name}</small>
    <b className="kp-display">{how === 'pulled' ? 'Pulls the lever!' : how === 'nothing' ? 'Does nothing.' : 'Dithers…'}</b>
    <span>{how === 'dithered' ? 'The lever stays where it was. ' : ''}The trolley takes <em>{TEAM[v.struck]}</em>{v.crowd ? `, with ${toll} on the track` : ''}</span>
  </div>;
}

/** Heckles float up from wherever the heckler is: their team's plate, the track they stand on, or the waiting strip. */
function Shouts({ v }: { v: PublicView }) {
  const seen = useRef<number | null>(null), live = useRef<{ seq: number; seat: number; kind: number; born: number; x: number; y: number }[]>([]), clock = performance.now();
  const top = v.shouts.at(-1)?.[0] ?? 0;
  if (seen.current === null || top < seen.current) seen.current = top;
  for (const [seq, seat, kind] of v.shouts) if (seq > seen.current) {
    const side = sideOfSeat(v, seat), counsel = !!side && v.tracks[side].team.includes(v.players[seat]?.id), r = seq * 73 % 100 / 100, r2 = seq * 37 % 100 / 100;
    live.current.push({ seq, seat, kind, born: clock, x: counsel ? 476 + r * 30 : 780 + r * 880, y: side ? ROW[side] + (counsel ? 170 + r2 * 170 : v.crowd ? 300 + r2 * 30 : 230 + r2 * 60) : 930 });
  }
  // A big room can heckle faster than anyone can read: keep the newest few so the cards stay visible.
  seen.current = top; live.current = live.current.filter(b => clock - b.born < 2600).slice(v.crowd ? -6 : -10);
  return <div className="tc-shouts" aria-hidden="true">{live.current.map(b => <p key={b.seq} className="tc-shout" data-kind={SHOUTS[b.kind]} style={{ left: b.x, top: b.y }}><b className="kp-display">{SHOUT[SHOUTS[b.kind]]}</b><small>{v.players[b.seat]?.name}</small></p>)}</div>;
}

/** Up to ten players: every seat's deaths. */
function Tally({ v }: { v: PublicView }) {
  const victims = v.phase === 'crash' && v.struck ? v.tracks[v.struck].team : [];
  return <ol className="tc-tally" data-dense={v.players.length > 8} aria-label="Deaths so far">{v.players.map(p => {
    const side = v.tracks.north.team.includes(p.id) ? 'north' : v.tracks.south.team.includes(p.id) ? 'south' : undefined, hit = victims.includes(p.id);
    return <li key={p.id} data-side={side} data-judge={p.id === v.conductor} data-hit={hit} data-off={!p.connected} style={vars({ '--seat': p.color })}>
      <b className="tc-tally-name">{p.name}</b>
      <span className="tc-tally-count" aria-label={plural(p.deaths, 'death')}>{p.id === v.conductor ? <Cap/> : <i aria-hidden="true"/>}<Skull/>{hit ? <><s className="kp-numeral">{p.deaths - 1}</s><b className="kp-numeral">{p.deaths}</b><em className="tc-fall" aria-hidden="true"><Skull/></em></> : <b className="kp-numeral">{p.deaths}</b>}</span>
    </li>;
  })}</ol>;
}

/** A crowd: the Gallery members still deciding, and who is ahead and behind. The tally moves once the trolley has passed. */
function Strip({ v, now }: { v: PublicView; now: number }) {
  const last = v.history.at(-1), early = v.phase === 'crash' && now < v.startedAt + CRASH.tallyAt;
  const deaths = v.players.map((p, seat) => p.deaths - (early && last?.victims.includes(seat) ? 1 : 0)), min = Math.min(...deaths), max = Math.max(...deaths);
  const waiting = [...v.gallery].flatMap((c, seat) => c === '?' ? [seat] : []), pitch = Math.min(34, 400 / Math.max(1, waiting.length));
  const group = (d: number, cap: number, label: string, kind: string) => { const all = v.players.filter((_, i) => deaths[i] === d); return <p className="tc-rank" data-kind={kind}><small>{label}</small><b><Skull/>{d}</b><span>{all.slice(0, cap).map(p => <Chip key={p.id} p={p}/>)}{all.length > cap && <em>+{all.length - cap} more</em>}</span></p>; };
  return <div className="tc-strip" aria-label="The Gallery and the standings">
    <p className="tc-wait" data-open={standOpen(v.phase)}><small>The Gallery</small><b>{waiting.length ? `${waiting.length} still deciding` : v.phase === 'deal' ? `${[...v.gallery].filter(c => c !== '-').length} seats` : v.phase === 'lever' || v.phase === 'crash' ? 'Feet glued' : 'Everyone is standing'}</b>
      <span className="tc-wait-dots" style={vars({ '--lap': `${Math.min(0, pitch - 34)}px` })}>{waiting.map(seat => <Dot key={seat} p={v.players[seat]}/>)}</span></p>
    {max === 0 ? <p className="tc-rank" data-kind="best"><small>Standings</small><span>Nobody has been flattened. Yet.</span></p> : <>{group(min, 4, 'Fewest deaths', 'best')}{max > min && group(max, 2, 'Most deaths', 'worst')}</>}
  </div>;
}

export function DisplayView({ publicView: v, serverNowMs }: Props) {
  const [frame, fit] = useFit(), now = useNow(serverNowMs), w = words(v), judge = player(v, v.conductor), say = clerkLine(v, now);
  // Reveal and crash animations run on CSS delays; offset them by time already elapsed so a reload mid-beat stays in sync.
  const t0 = useMemo(() => -Math.max(0, serverNowMs() - v.startedAt), [v.turnId, v.step]);
  const timer = (isPick(v.phase) || v.phase === 'plead' || v.phase === 'lever') && v.deadline > now;
  const stage = { '--t0': `${t0}ms`, '--stamp-at': `${CRASH.stampAt}ms`, '--run-at': `${CRASH.runAt}ms`, '--run-ms': `${CRASH.runMs}ms`, '--spared-at': `${CRASH.sparedAt}ms`, '--tally-at': `${CRASH.tallyAt}ms`, '--hit0': `${hitAt(0)}ms`, '--hit1': `${hitAt(1)}ms`, '--hit2': `${hitAt(2)}ms` };
  return <div ref={frame} className="tc tc-frame" style={{ height: H * fit.scale }}>
    <div className="tc-stage" data-phase={v.phase} data-crowd={v.crowd} style={{ transform: `translateX(${fit.left}px) scale(${fit.scale})`, ...vars(stage) }}>
      <div className="tc-shaker">
        <div className="tc-sky" style={{ backgroundImage: `url(${art.base}art/backdrop.svg)` }} aria-hidden="true">{STARS.map(([x, y, d]) => <i key={`${x}${y}`} style={{ left: x, top: y, animationDelay: `${d}s` }}/>)}<b/><b/></div>
        <header className="tc-top">
          <p className="tc-round"><small>Case</small><b className="kp-numeral">{v.round}</b><small>of {v.rounds}</small></p>
          <div className="tc-banner"><p className="kp-display" aria-live="polite">{w.banner}</p>{say && <p className="tc-clerk" key={say}><Clerk/><span>{say}</span></p>}</div>
          <p className="tc-top-judge"><Cap/><span><small>Your Honour</small><b style={{ color: judge?.color }}>{judge?.name}</b></span></p>
          <div className="tc-clock" data-low={v.deadline - now < 10500}>{timer ? <Countdown deadline={v.deadline} serverNowMs={serverNowMs}/> : <span aria-hidden="true">⚖</span>}</div>
        </header>
        <Junction v={v}/>
        <Board v={v} now={now} serverNowMs={serverNowMs}/>
        <Row v={v} side="north"/>
        <Row v={v} side="south"/>
        {v.crowd ? <Strip v={v} now={now}/> : <Tally v={v}/>}
        <Shouts v={v}/>
      </div>
      <Showcase key={`${v.turnId}:${v.step}`} v={v}/>
      <Verdict v={v}/>
    </div>
  </div>;
}
