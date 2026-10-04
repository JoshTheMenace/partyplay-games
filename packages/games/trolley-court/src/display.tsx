/* Trolley Court TV: a 1920×1080 junction scene scaled to fit. Trolley and lever on the left, North and South tracks on the right. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Countdown, type GameViewProps } from '../../../party-ui/src/index';
import { PHASES, isPick, opposite, type Action, type PrivateView, type PublicView, type Side, type TrackCard } from './types';
import { CardBack, CardFace, Cap, Chip, Skull, TEAM, art, credit, heading, player, plural, slotName, useNow, vars } from './cards';

export type Props = GameViewProps<null, Action, PublicView, PrivateView>;
const W = 1920, H = 1080, MAIN = 445, RAIL: Record<Side, number> = { north: 233, south: 657 };
/** The trolley's route in stage pixels: parked on the main line, through the switch, then along a branch and off screen. */
const curve = (side: Side) => `C380 ${MAIN} 380 ${RAIL[side]} 470 ${RAIL[side]}`, route = (side: Side) => `M150 ${MAIN}H290${curve(side)}H2200`;
/** Crash choreography (ms from the start of the crash phase). The route is ~2205px; slot i's centre sits at x = 924 + 392i. */
const RUN_AT = 1300, RUN_MS = 3000, LENGTH = 2205, SPARED_AT = 4600, TALLY_AT = 5200;
const hitAt = (i: number) => Math.round(RUN_AT + RUN_MS * (140 + 335 + 924 + 392 * i - 470 - 160) / LENGTH);
const BONK = ['BONK!', 'POW!', 'KLUNK!'];

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
  const beat = v.step > 0 ? `Card ${v.step} of ${v.steps - 1}` : 'Face down, for now…';
  switch (v.phase) {
    case 'deal': return { banner: v.round === v.rounds ? 'Final round' : `Round ${v.round}`, kicker: v.round === 1 ? 'Court is in session' : `Round ${v.round} of ${v.rounds}`, title: v.round === v.rounds ? 'Final case' : v.round === 1 ? 'First case' : 'Next case', sub: `${judge} takes the lever. Two bystanders are already tied to the tracks.` };
    case 'innocent': return { banner: 'Both teams: tie an Innocent to your own track', kicker: 'Pick an Innocent', title: 'Save someone', sub: 'Put someone worth sparing on your own track.' };
    case 'innocentReveal': return { banner: 'The Innocents', kicker: 'The Clerk reveals', title: 'The Innocents', sub: beat };
    case 'guilty': return { banner: 'Both teams: plant a Guilty on the other track', kicker: 'Pick a Guilty', title: 'Frame someone', sub: 'Put someone deserving on the other team’s track.' };
    case 'guiltyReveal': return { banner: 'The Guilty', kicker: 'The Clerk reveals', title: 'The Guilty', sub: beat };
    case 'modifier': return { banner: 'Pin Twists on any card, yours or theirs', kicker: 'Pick your Twists', title: 'Twist the case', sub: 'Make your side sweeter, or theirs worse.' };
    case 'modifierReveal': return { banner: 'The Twists', kicker: 'The Clerk reveals', title: 'The Twists', sub: v.step > 0 ? `Twist ${v.step} of ${v.steps - 1}` : 'Face down, for now…' };
    case 'plead': return { banner: `${fl} has the floor`, kicker: `Floor ${v.step + 1} of 2`, title: `${fl} has the floor`, sub: v.floor === v.defaultSide ? 'They’re in the trolley’s path, so they argue first.' : 'Rebuttal. Make it count.' };
    case 'lever': return { banner: 'Your Honour decides', kicker: 'Open floor: shout!', title: 'Decision time', sub: `${judge} has the lever.` };
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
  return <ul className="tc-mods" data-many={n > 3}>
    {shown.map(([m, k]) => <li key={m.card.id} className="tc-mod" data-from={m.from} data-spot={k === mine}>
      <span>+ {m.card.text}</span>{k === mine && <small>{TEAM[m.from as Side]} · {credit(v, m)}</small>}
    </li>)}
    {n > 3 && <li className="tc-more">+{n - 2} more twist{n - 2 === 1 ? '' : 's'}</li>}
  </ul>;
}

function Slot({ v, side, i }: { v: PublicView; side: Side; i: number }) {
  const c = v.tracks[side].slots[i], spot = v.spotlight?.side === side && v.spotlight.slot === i ? v.spotlight : null;
  const h = c ? null : hidden(v, side, i);
  return <div className="tc-slot" data-spot={!!spot && spot.mod === undefined} data-target={!!spot && spot.mod !== undefined} style={vars({ '--hit': `${hitAt(i)}ms` })}>
    {c ? <CardFace key={c.card.id} card={c.card} label={slotName(side, i)} className={spot && spot.mod === undefined ? 'tc-flip' : ''}>
      {spot && spot.mod === undefined && <span className="tc-credit">{credit(v, c)}</span>}
      <b className="tc-struck-stamp" aria-hidden="true">Struck</b><i className="tc-bonk" aria-hidden="true">{BONK[i]}</i>
    </CardFace>
      : h!.back ? <CardBack stamp={h!.stamp}><small>{slotName(side, i)}</small></CardBack>
      : <div className="tc-empty-slot"><small>{slotName(side, i)}</small>{h!.note && <span>{h!.note}</span>}</div>}
    {c && <Mods v={v} c={c}/>}
  </div>;
}

function Plate({ v, side }: { v: PublicView; side: Side }) {
  const t = v.tracks[side], p = v.progress[side], hit = v.phase === 'crash' && v.struck === side;
  const revealed = (['north', 'south'] as const).reduce((n, s) => n + v.tracks[s].slots.reduce((m, c) => m + (c?.mods.filter(x => x.from === side).length ?? 0), 0), 0);
  const backs = v.phase === 'modifier' ? p.locked : v.phase === 'modifierReveal' ? Math.max(0, p.total - revealed) : 0;
  return <aside className="tc-plate" data-side={side} data-big={t.team.length > 3}>
    <h2 className="kp-display">{TEAM[side]}</h2>
    {v.struck ? <span className="tc-tag" data-hit={v.struck === side}>{v.struck === side ? 'Struck' : 'Spared'}</span> : v.defaultSide === side && <span className="tc-tag">In the path</span>}
    <ul>{t.team.map(id => { const q = player(v, id); return <li key={id}><Chip p={q}>{!!q?.deaths && <span className="tc-pips" aria-label={plural(q.deaths, 'death')}><Skull/>{hit ? <><s>{q.deaths - 1}</s><b>{q.deaths}</b></> : q.deaths}</span>}</Chip>{v.underdogs.includes(id) && <em className="tc-underdog">Underdog</em>}</li>; })}</ul>
    {(v.phase === 'modifier' || v.phase === 'modifierReveal') && <div className="tc-twist-count"><span>{v.phase === 'modifier' ? `Twists ${p.locked}/${p.total} locked` : backs ? `${plural(backs, 'twist')} to reveal` : 'Twists revealed'}</span><span className="tc-mini-backs" aria-hidden="true">{Array.from({ length: backs }, (_, k) => <i key={k}/>)}</span></div>}
  </aside>;
}

function Row({ v, side }: { v: PublicView; side: Side }) {
  const crash = v.phase === 'crash' || v.phase === 'complete', struck = crash && v.struck === side;
  const lit = v.phase === 'lever' || (v.phase === 'plead' && v.floor === side), dim = v.phase === 'plead' && v.floor !== side;
  return <section className="tc-row" data-side={side} data-lit={lit} data-dim={dim} data-struck={struck} data-spared={crash && !struck} aria-label={`${TEAM[side]} track`}>
    <Plate v={v} side={side}/>
    {[0, 1, 2].map(i => <Slot key={i} v={v} side={side} i={i}/>)}
    {v.phase === 'plead' && v.floor === side && <b className="tc-floor-flag kp-display">{TEAM[side]} has the floor</b>}
    {crash && !struck && <b className="tc-ribbon kp-display">Spared</b>}
  </section>;
}

/** The judge-conductor: seat-coloured robe, powdered wig, conductor's cap. */
export function Judge({ color }: { color: string }) {
  return <svg className="tc-judge" viewBox="0 0 220 300" style={vars({ '--seat': color })} aria-hidden="true">
    <path d="M150 205l55-30" stroke="var(--seat)" strokeWidth="24" strokeLinecap="round"/><circle cx="205" cy="175" r="13" fill="#f2c9a0" stroke="var(--kp-ink)" strokeWidth="4"/>
    <path d="M40 300c0-90 22-128 70-128s70 38 70 128z" fill="var(--seat)" stroke="var(--kp-ink)" strokeWidth="6"/>
    <path d="M90 174l20 40 20-40z" fill="var(--kp-cream)" stroke="var(--kp-ink)" strokeWidth="4"/>
    {[[62, 118], [56, 146], [60, 172], [158, 118], [164, 146], [160, 172]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="17" fill="var(--kp-cream)" stroke="var(--kp-ink)" strokeWidth="4"/>)}
    <circle cx="110" cy="122" r="44" fill="#f2c9a0" stroke="var(--kp-ink)" strokeWidth="6"/>
    <path d="M86 112l16 4M134 112l-16 4" stroke="var(--kp-ink)" strokeWidth="6" strokeLinecap="round"/><circle cx="95" cy="126" r="5" fill="var(--kp-ink)"/><circle cx="125" cy="126" r="5" fill="var(--kp-ink)"/>
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

function Track({ d, className }: { d: string; className?: string }) {
  return <g className={className}><path d={d} className="tc-bed"/><path d={d} className="tc-ties"/><path d={d} className="tc-rails"/><path d={d} className="tc-gap"/><path d={d} className="tc-ties tc-ties-in"/></g>;
}

function Junction({ v, t0 }: { v: PublicView; t0: number }) {
  const h = heading(v), crash = v.phase === 'crash', judge = player(v, v.conductor);
  return <>
    <svg className="tc-tracks" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <Track d={`M-40 ${MAIN}H300`}/>
      {(['north', 'south'] as const).map(s => <Track key={s} className={`tc-branch${s === h ? ' is-hot' : ''}`} d={`M285 ${MAIN}H290${curve(s)}H${W + 40}`}/>)}
      <g className="tc-default" transform={`translate(${v.defaultSide === 'north' ? '392 350' : '392 600'})`}><rect x="-68" y="-20" width="136" height="36" rx="8"/><text y="7">DEFAULT</text></g>
    </svg>
    <div className="tc-trolley" data-run={crash} style={{ offsetPath: `path('${route(h)}')`, ...vars({ '--t0': `${t0}ms`, '--run-at': `${RUN_AT}ms`, '--run-ms': `${RUN_MS}ms` }) }}>
      <img src={`${art.base}art/trolley.svg`} alt="" draggable={false}/>
    </div>
    <div className="tc-heading" data-side={h}><span>{crash || v.phase === 'complete' ? 'Ran down' : 'Heading'}</span><b className="kp-display">{TEAM[h]}</b><svg viewBox="0 0 40 24" aria-hidden="true"><path d="M2 12h28M22 3l12 9-12 9" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
    <div className="tc-bench">
      <Judge color={judge?.color ?? '#888'}/>
      <Lever pulled={v.lever.pulled} locked={v.lever.decided || crash}/>
      <p className="tc-nameplate"><Cap/><span><small>Your Honour</small><b>{judge?.name ?? '—'}</b></span></p>
      <p className="tc-lever-state" data-pulled={v.lever.pulled}>{v.lever.decided || crash ? v.lever.timedOut ? 'Left as it was' : v.lever.pulled ? 'Pulled!' : 'Untouched' : v.lever.pulled ? 'Leaning: pull' : 'Lever: untouched'}</p>
    </div>
  </>;
}

function Board({ v, now, serverNowMs }: { v: PublicView; now: number; serverNowMs(): number }) {
  const w = words(v), live = (isPick(v.phase) || v.phase === 'plead' || v.phase === 'lever') && v.deadline > now;
  const both = isPick(v.phase) && (['north', 'south'] as const).every(s => v.progress[s].locked >= v.progress[s].total && v.progress[s].total > 0);
  return <div className="tc-board" data-phase={v.phase} data-floor={v.floor ?? undefined}>
    <p className="tc-kicker">{w.kicker}</p>
    <h1 className="kp-display" key={`${v.turnId}`}>{w.title}</h1>
    {isPick(v.phase) ? <ul className="tc-progress">{(['north', 'south'] as const).map(s => { const p = v.progress[s], done = p.total > 0 && p.locked >= p.total; return <li key={s} data-side={s} data-done={done}><b>{TEAM[s]}</b><span>{done ? '✓ Locked' : `${p.locked}/${p.total} locked…`}</span></li>; })}{both && <li className="tc-all">All locked!</li>}</ul>
      : <p className="tc-sub">{w.sub}</p>}
    {live && (v.phase === 'plead' || v.phase === 'lever') && <div className="tc-big-clock" data-low={v.deadline - now < 5500}><Countdown deadline={v.deadline} serverNowMs={serverNowMs}/></div>}
  </div>;
}

export function DisplayView({ publicView: v, serverNowMs }: Props) {
  const [frame, fit] = useFit(), now = useNow(serverNowMs), w = words(v), judge = player(v, v.conductor);
  // Crash animations run on CSS delays; offset them by time already elapsed so a reload mid-crash stays in sync.
  const t0 = useMemo(() => -Math.max(0, serverNowMs() - v.startedAt), [v.turnId]);
  const crash = v.phase === 'crash', victims = crash && v.struck ? v.tracks[v.struck].team : [];
  const timer = (isPick(v.phase) || v.phase === 'plead' || v.phase === 'lever') && v.deadline > now;
  return <div ref={frame} className="tc tc-frame" style={{ height: H * fit.scale }}>
    <div className="tc-stage" data-phase={v.phase} style={{ transform: `translateX(${fit.left}px) scale(${fit.scale})`, ...vars({ '--t0': `${t0}ms`, '--spared-at': `${SPARED_AT}ms`, '--tally-at': `${TALLY_AT}ms` }) }}>
      <div className="tc-sky" style={{ backgroundImage: `url(${art.base}art/backdrop.svg)` }} aria-hidden="true"/>
      <header className="tc-top">
        <p className="tc-round"><small>Round</small><b className="kp-numeral">{v.round}</b><small>of {v.rounds}</small></p>
        <p className="tc-banner kp-display" aria-live="polite">{w.banner}</p>
        <p className="tc-top-judge"><Cap/><span><small>Your Honour</small><b style={{ color: judge?.color }}>{judge?.name}</b></span></p>
        <div className="tc-clock" data-low={v.deadline - now < 10500}>{timer ? <Countdown deadline={v.deadline} serverNowMs={serverNowMs}/> : <span aria-hidden="true">⚖</span>}</div>
      </header>
      <Junction v={v} t0={t0}/>
      <Board v={v} now={now} serverNowMs={serverNowMs}/>
      <Row v={v} side="north"/>
      <Row v={v} side="south"/>
      <ol className="tc-tally" data-dense={v.players.length > 8} aria-label="Deaths so far">{v.players.map(p => {
        const side = v.tracks.north.team.includes(p.id) ? 'north' : v.tracks.south.team.includes(p.id) ? 'south' : undefined, hit = victims.includes(p.id);
        return <li key={p.id} data-side={side} data-judge={p.id === v.conductor} data-hit={hit} data-off={!p.connected} style={vars({ '--seat': p.color })}>
          <b className="tc-tally-name">{p.name}</b>
          <span className="tc-tally-count" aria-label={plural(p.deaths, 'death')}>{p.id === v.conductor ? <Cap/> : <i aria-hidden="true"/>}<Skull/>{hit ? <><s className="kp-numeral">{p.deaths - 1}</s><b className="kp-numeral">{p.deaths}</b><em className="tc-fall" aria-hidden="true"><Skull/></em></> : <b className="kp-numeral">{p.deaths}</b>}</span>
        </li>;
      })}</ol>
    </div>
  </div>;
}
