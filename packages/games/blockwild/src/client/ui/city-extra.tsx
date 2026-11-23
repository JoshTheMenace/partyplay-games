/**
 * Caper City's second helping of interface: the to-do card and the City Passport behind it (and, further down, the
 * sheets of the things the passport sends a player to). The HUD and the first sheets are in city.tsx.
 */
import { useEffect, useRef, useState } from 'react';
import { HATS } from '../../shared/city/economy';
import { STALLS } from '../../shared/city/extras';
import { STAMPS, hasStamp, stampCount, titleFor, todo } from '../../shared/city/passport';
import { CHARACTERS, stepOf } from '../../shared/city/story';
import { I } from '../../shared/items';
import { createStore, store } from '../store';
import { ItemIcon } from './icons';
import type { Career, PrivateView } from '../../shared/protocol';
import { feed } from '../game/feed';
import { closeScreen, sendCommand } from '../game/predict';
import { Sheet } from './screens';
import { openMenu, relockPointer, useStore } from './state';

const closeAndResume = () => { closeScreen(); relockPointer(); };
const NO_CAREER: Career = { st: [0, 0], fe: [0, 0], story: 0, rep: 0, look: 0, biz: 0 };
/** The seat's career as last sent (it rides in the bag). */
export const useCareer = () => useStore(feed, s => s.bag?.career) ?? NO_CAREER;
export const careerNow = () => feed.get().bag?.career ?? NO_CAREER;

/** Three things worth trying next. A tap opens the passport, which says how. */
export function TodoCard() {
  const career = useCareer(), next = todo(career.st);
  if (!next.length) return null;
  return <button type="button" className="bw-todo" aria-label={`To do: ${next.map(id => STAMPS[id]!.title).join(', ')}. Open the passport.`} onClick={() => openMenu('passport')}>
    <b>To do</b>
    {next.map(id => <span key={id}>{STAMPS[id]!.title}</span>)}
  </button>;
}

/** Every stamp, got or not, with how to get the ones still missing. */
export function Passport() {
  const career = useCareer(), count = stampCount(career.st), next = new Set(todo(career.st));
  return <Sheet title="City Passport" className="bw-passport-sheet" onClose={closeAndResume} tools={<span className="bw-passport-count"><b className="kp-numeral">{count}</b> of {STAMPS.length} · {titleFor(count)}</span>}>
    <ol className="bw-stamps">{STAMPS.map((stamp, id) => {
      const got = hasStamp(career.st, id);
      return <li key={stamp.key} className="bw-stamp" data-got={got} data-next={next.has(id)}>
        <i aria-hidden="true">{got ? '✓' : ''}</i>
        <span><b>{stamp.title}</b>{!got && <small>{stamp.hint}</small>}</span>
        <em className="kp-numeral" aria-label={`${stamp.coins} coins`}>{got ? '' : `+${stamp.coins}`}</em>
      </li>;
    })}</ol>
  </Sheet>;
}

/** Nabbed: the ways out of the lock-up. It stays up until one is taken (or a friend works the lock outside). */
export function LockUp({ pv }: { pv: PrivateView }) {
  const [left, fine] = pv.city!.cell as [number, number], coins = pv.city!.coins;
  return <div className="bw-death bw-cell" role="alertdialog" aria-labelledby="bw-cell-title">
    <h2 id="bw-cell-title" className="kp-title">In the lock-up</h2>
    <p>The Watch has you. Out in <b className="kp-numeral">{left}</b> seconds for half the fine, or:</p>
    <div className="bw-cell-ways">
      <button type="button" className="bw-resume" disabled={coins < fine} onClick={() => sendCommand({ t: 'city', a: 'cell', i: 0 })}>Pay the fine<small>{fine} coins, out now</small></button>
      <button type="button" className="bw-resume" data-alt="true" onClick={() => sendCommand({ t: 'city', a: 'cell', i: 1 })}>Community service<small>No fine: your next gig is unpaid</small></button>
    </div>
    <p className="bw-death-items" data-kept="true">A friend can spring you for nothing at the lock by the cage (and be Wanted for it).</p>
  </div>;
}

// Characters -----------------------------------------------------------------------------------------------------------
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
/** The errand in hand, on the HUD. */
export function ErrandChip({ errand }: { errand: number[] }) {
  const [who, done, need] = errand as [number, number, number], character = CHARACTERS[who], step = character?.errands[stepOf(careerNow().story, who)];
  if (!character || !step) return null;
  return <p className="bw-gig bw-errand" data-done={done >= need} role="status">
    <b>{step.goal}</b>
    <span>{done >= need ? `Done: back to ${character.name}` : `For ${character.name}${need > 1 ? ` · ${done.toLocaleString()} of ${need.toLocaleString()}` : ''}`}</span>
  </p>;
}
/** Talking to one of the people with errands: what they say, and what can be said back. */
export function Talk({ pv }: { pv: PrivateView }) {
  const city = pv.city!, who = city.talk ?? -1, character = CHARACTERS[who], career = useCareer();
  if (!character) return null;
  const step = stepOf(career.story, who), errand = character.errands[step], mine = city.errand?.[0] === who, busy = !!city.errand && !mine, done = mine && city.errand![1]! >= city.errand![2]!;
  const say = (i: number) => { sendCommand({ t: 'city', a: 'say', i }); store.set({ screen: null }); relockPointer(); };
  const line = !errand ? character.bye : done ? errand.done : mine ? `Still at it? ${errand.goal}: ${city.errand![1]} of ${city.errand![2]} so far.` : step === 0 ? `${character.hello} ${errand.ask}` : errand.ask;
  return <Sheet title={character.name} className="bw-talk-sheet" onClose={() => say(1)}>
    <div className="bw-talk">
      <i className="bw-talk-face" aria-hidden="true" style={{ background: hex(character.look.skin), borderTopColor: hex(character.look.hat ? character.look.hatColor : character.look.hair), borderBottomColor: hex(character.look.top) }}/>
      <div>
        <p className="bw-talk-role">{character.role} · errand {Math.min(step + 1, character.errands.length)} of {character.errands.length}</p>
        <p className="bw-talk-line">{line}</p>
        {busy && errand && <p className="bw-note">You are on an errand for {CHARACTERS[city.errand![0]!]?.name}. Finish that first.</p>}
      </div>
    </div>
    <div className="bw-talk-ways">
      {errand && (done ? <button type="button" className="bw-resume" onClick={() => say(0)}>Here you are<small>{errand.pay} coins</small></button>
        : !mine && <button type="button" className="bw-resume" disabled={busy} onClick={() => say(0)}>I will do it<small>{errand.goal} · {errand.pay} coins</small></button>)}
      <button type="button" className="bw-resume" data-alt="true" onClick={() => say(1)}>{errand && !mine && !done ? 'Not now' : 'Goodbye'}</button>
    </div>
  </Sheet>;
}

// The funfair ----------------------------------------------------------------------------------------------------------
/** Which stall's sheet is open (3 = the prize booth). */
export const stallAt = createStore<{ stall: number }>({ stall: 0 });
const PRIZE_LIST: readonly (readonly [number, string, number])[] = [[6, 'Candy floss', I.candy_floss], [15, 'Plush gull', I.plush_gull], [40, HATS[3]!.name, 0], [120, HATS[9]!.name, 0]];
const STALL_BLURB = ['Stop the marker as near the top as you can. Hit the bell for ten tickets.', 'Stop the marker dead centre to knock every can down.', 'Reach in and see. No skill in it whatever.'];
/** A stall: a marker sweeps a bar and one press stops it. The prize booth lists what tickets buy. */
export function Stall({ pv }: { pv: PrivateView }) {
  const stall = useStore(stallAt, s => s.stall), inv = useStore(store, s => s.inv), tickets = inv.reduce((n, slot) => n + (slot?.id === I.fair_ticket ? slot.n : 0), 0), coins = pv.city!.coins;
  const marker = useRef<HTMLElement>(null), at = useRef(0), [last, setLast] = useState<number | null>(null);
  useEffect(() => {
    if (stall > 1) return;
    let frame = 0;
    const start = performance.now(), step = (now: number) => {
      // High Striker climbs and falls; Tin Can Alley swings side to side, a little quicker.
      const t = (now - start) / (stall === 0 ? 900 : 700), wave = 1 - Math.abs(t % 2 - 1);
      at.current = Math.round((stall === 0 ? wave * wave : wave) * 1000);
      marker.current?.style.setProperty('left', `${at.current / 10}%`);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [stall]);
  const close = () => { store.set({ screen: null }); relockPointer(); };
  const head = <span className="bw-passport-count"><b className="kp-numeral">{tickets}</b> tickets · {coins} coins</span>;
  if (stall === 3) return <Sheet title="Prize booth" className="bw-counter-sheet" onClose={close} tools={head}>
    <ul className="bw-offers">{PRIZE_LIST.map(([cost, name, icon], i) => <li key={name} className="bw-offer" data-state={tickets >= cost ? 'ready' : 'short'}>
      <span className="bw-offer-deal">{icon > 0 && <span className="bw-deal"><ItemIcon id={icon}/></span>}<span className="bw-offer-name">{name}{icon === 0 && <small>A hat: worn at once</small>}{icon === I.plush_gull && <small>Pawn shops pay 30 for one</small>}</span></span>
      <button type="button" className="bw-offer-go" disabled={tickets < cost} aria-label={`${name} for ${cost} tickets`} onClick={() => sendCommand({ t: 'city', a: 'stall', i: 10 + i })}>{cost} tickets</button>
    </li>)}</ul>
  </Sheet>;
  return <Sheet title={STALLS[stall] ?? 'Stall'} className="bw-counter-sheet bw-stall-sheet" onClose={close} tools={head}>
    <p className="bw-note bw-stall-note">{STALL_BLURB[stall]} A go is 5 coins.</p>
    {stall < 2 && <div className="bw-stall-bar" data-stall={stall} aria-hidden="true"><i/><b ref={marker}/></div>}
    <button type="button" className="bw-resume" disabled={coins < 5} onClick={() => { setLast(at.current); sendCommand({ t: 'city', a: 'stall', i: stall, j: at.current }); }}>{stall === 0 ? 'Swing!' : stall === 1 ? 'Throw!' : 'Dip!'}<small>5 coins</small></button>
    {last !== null && stall < 2 && <p className="bw-note bw-stall-note">Stopped at {Math.round(stall === 0 ? last / 10 : 100 - Math.abs(last - 500) / 5)} of 100.</p>}
  </Sheet>;
}
