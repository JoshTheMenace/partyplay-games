/* Ballpark rules: everyone answers a secret yes/no survey, one rotating agent estimates the % of the room who said yes,
   everyone else bets higher or lower; two rounds, then the Most Wanted final. Server only. */
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { variant } from '../../core/narration';
import { bool, integer, record } from '../../core/server/validate';
import { questionPool, wantedPool, type Question, type WantedSet } from './content.server';
import {
  AIM_MS, BETS, BET_POINTS, BET_S, GUESS_S, LOCK_MS, MIN_READ_MS, PICK_S, REVEAL, SCORES_MS, TICK_S, TIERS, WANTED_PICKS, WANTED_POINTS,
  WANTED_SIZE, possible, surveySeconds, tierOf, wantedBeats, wins,
  type BallparkPrivate, type BallparkPublic, type Bet, type Phase, type Reveal, type WantedResult,
} from './types';

type Turn = {
  q: Question; agent: string; answers: Record<string, boolean>;
  dial: number | null; aimAt: number; guess: number | null; lockedAt: number; auto: boolean;
  bets: Record<string, Bet>; reveal: Reveal | null;
};
type Stat = 'bullseyes' | 'bets' | 'longshots' | 'hunted';
export type BallparkState = {
  ids: string[]; online: Record<string, boolean>;
  phase: Phase; round: number; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean;
  /** Questions and Most Wanted sets in deal order (unused this night first). */
  deck: Question[]; sets: WantedSet[];
  /** Agents still to play this round, the questions asked so far this round and the last agent. */
  queue: string[]; asked: number; last: string | null;
  cur: Turn | null;
  set: WantedSet | null; ticks: Record<string, number[]>; picks: Record<string, number[]>; wanted: WantedResult | null;
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>;
  /** Night summary for the podium headline: yes answers out of all answers. */
  yes: number; answered: number;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const ROUND_PHASES: readonly Phase[] = ['survey', 'guess', 'bet', 'reveal'];

/** Unused content first (shuffled), then the rest, so a second game in one night feels fresh. */
function deal<T extends { id: string }>(pool: readonly T[], api: MiniApi): T[] {
  return [...api.shuffle(pool.filter(x => !api.used.has(x.id))), ...api.shuffle(pool.filter(x => api.used.has(x.id)))];
}
function go(s: BallparkState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: BallparkState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }
/** Runs `play(stage)` once for every beat (ms from the phase start) that has been reached. */
function beats(s: BallparkState, api: MiniApi, at: readonly number[], play: (stage: number) => void) {
  while (s.stage < at.length && api.now - s.at >= at[s.stage]!) play(s.stage++);
}

/** Round 1: everyone in random order. Round 2: everyone again (≤ 6 players) or the three lowest scorers. Round 3: Most Wanted. */
function startRound(s: BallparkState, api: MiniApi) {
  s.round++; s.prev = { ...s.scores }; s.asked = 0;
  if (s.round === 3) return startWanted(s, api);
  let queue = api.shuffle(s.ids);
  if (s.round === 2) {
    api.sfx('gong');
    if (s.ids.length >= 7) queue = queue.filter(id => s.online[id]).sort((a, b) => s.scores[a]! - s.scores[b]!).slice(0, 3);
    else if (queue[0] === s.last) queue.push(queue.shift()!);
  }
  s.queue = queue;
  startQuestion(s, api);
}

/** The next online agent takes the dial (offline agents wait their turn; a round ends early if only offline agents are left). */
function startQuestion(s: BallparkState, api: MiniApi) {
  const at = s.queue.findIndex(id => s.online[id]);
  if (at < 0) return endRound(s, api);
  const agent = s.queue.splice(at, 1)[0]!;
  if (!s.deck.length) s.deck = deal(questionPool(api.settings.family), api);
  const q = s.deck.shift()!;
  api.used.add(q.id);
  s.cur = { q, agent, answers: {}, dial: null, aimAt: 0, guess: null, lockedAt: 0, auto: false, bets: {}, reveal: null };
  s.asked++; s.last = agent;
  api.music('ballpark'); api.sfx('swoosh-in'); api.speak(q.text);
  go(s, api, 'survey', api.seconds(surveySeconds(q.text)));
}

function endRound(s: BallparkState, api: MiniApi) {
  api.music('ballpark'); api.sfx('whoosh');
  go(s, api, 'scores', SCORES_MS); hold(s, api, api.say('host.scores'));
}

function lock(s: BallparkState, api: MiniApi, value: number, auto = false) {
  const c = s.cur!;
  Object.assign(c, { guess: value, dial: value, lockedAt: api.now, auto });
  api.sfx('lock'); api.sfx('stamp');
}

/** Scores the question: the agent by distance, bettors 500 for the right side (1000 for a right "much" bet).
    Fewer than two answers would expose the lone respondent, so the lab makes up a number instead. */
function reveal(s: BallparkState, api: MiniApi) {
  const c = s.cur!, guess = c.guess!, values = Object.values(c.answers), house = values.length < 2;
  const yes = house ? 0 : values.filter(Boolean).length, no = house ? 0 : values.length - yes;
  const truth = house ? Math.floor(api.random() * 101) : Math.round(yes / values.length * 100), tier = tierOf(guess, truth);
  const gains: Record<string, number> = { [c.agent]: tier >= 0 ? TIERS[tier]!.points : 0 };
  for (const [id, bet] of Object.entries(c.bets)) {
    const much = bet.startsWith('much'), won = wins(bet, guess, truth);
    gains[id] = won ? much ? BET_POINTS.much : BET_POINTS.plain : 0;
    if (won) { s.stats.bets[id]!++; if (much) s.stats.longshots[id]!++; }
  }
  for (const [id, n] of Object.entries(gains)) s.scores[id]! += n;
  if (tier === 0) s.stats.bullseyes[c.agent]!++;
  s.yes += yes; s.answered += yes + no;
  const ids = (said: boolean) => s.ids.filter(id => own(c.answers, id) === said);
  c.reveal = {
    truth, guess, yes, no, bets: { ...c.bets }, tier, gains,
    ...(house ? { house: true as const } : {}), ...(c.auto ? { auto: true as const } : {}),
    ...(c.q.open && !house ? { yesIds: ids(true), noIds: ids(false) } : {}),
  };
  api.music('reveal');
  go(s, api, 'reveal', REVEAL.end);
  if (s.asked === 1 && s.round === 1) api.say(variant('host.reveal', api.random));
}

function verdict(s: BallparkState, api: MiniApi, r: Reveal) {
  const miss = Math.abs(r.guess - r.truth), winners = Object.keys(r.bets).filter(id => r.gains[id]! > 0).length;
  if (r.tier === 0) { api.sfx('airhorn'); api.sfx('cheer'); hold(s, api, api.say('ballpark.bullseye')); }
  else if (r.tier > 0) { api.sfx(r.tier === 1 ? 'ooh' : 'score-up'); if (winners) api.sfx('coin'); }
  else { api.sfx(miss >= 35 ? 'record-scratch' : 'aww'); if (miss >= 35) hold(s, api, api.say('ballpark.way-off')); else if (winners) api.sfx('coin'); }
}

function startWanted(s: BallparkState, api: MiniApi) {
  if (!s.sets.length) s.sets = deal(wantedPool(api.settings.family), api);
  s.set = s.sets.shift()!; s.cur = null;
  api.used.add(s.set.id);
  api.music('think-2'); api.sfx('stamp');
  go(s, api, 'tick', api.seconds(TICK_S));
  api.say('host.final-round'); api.say('ballpark.wanted');
}

/** Ranks the statements by ticks (competition ranking) and pays each pick by its statement's rank: 1000, 700, 500. */
function wantedReveal(s: BallparkState, api: MiniApi) {
  const filed = Object.values(s.ticks), counts = Array.from({ length: WANTED_SIZE }, (_, i) => filed.filter(t => t.includes(i)).length);
  const ranks = counts.map(n => n ? 1 + counts.filter(m => m > n).length : 0);
  const order = [...counts.keys()].sort((a, b) => counts[a]! - counts[b]! || b - a);
  const worth = (i: number) => ranks[i]! >= 1 && ranks[i]! <= WANTED_POINTS.length ? WANTED_POINTS[ranks[i]! - 1]! : 0;
  const gains = Object.fromEntries(Object.entries(s.picks).map(([id, picks]) => [id, picks.reduce((sum, i) => sum + worth(i), 0)]));
  for (const [id, n] of Object.entries(gains)) { s.scores[id]! += n; s.stats.hunted[id]! += n; }
  s.wanted = { counts, ranks, order, filed: filed.length, picks: Object.fromEntries(s.ids.filter(id => own(s.picks, id)).map(id => [id, [...s.picks[id]!]])), gains };
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'wanted', wantedBeats().end);
}

/** Unique whole numbers 0–8, at most `max` (exactly `max` when `exact`). */
function indices(raw: unknown, max: number, exact: boolean, what: string): number[] {
  if (!Array.isArray(raw) || raw.length > max || (exact && raw.length !== max)) throw new Error(exact ? `Pick exactly ${max} ${what}.` : `Too many ${what}.`);
  const list = raw.map(i => integer(i, 0, WANTED_SIZE - 1));
  if (new Set(list).size !== list.length) throw new Error(`Each ${what.replace(/s$/, '')} only once.`);
  return list;
}

export const server: MiniServer<BallparkState, BallparkPublic, BallparkPrivate> = {
  id: 'ballpark',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0]));
    const s: BallparkState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])),
      phase: 'survey', round: 0, turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false,
      deck: deal(questionPool(api.settings.family), api), sets: deal(wantedPool(api.settings.family), api),
      queue: [], asked: 0, last: null, cur: null, set: null, ticks: {}, picks: {}, wanted: null,
      scores: zero(), prev: zero(), stats: { bullseyes: zero(), bets: zero(), longshots: zero(), hunted: zero() }, yes: 0, answered: 0, done: false,
    };
    startRound(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw), c = s.cur;
    if (a.turn !== s.turn) throw new Error('Too late! The game has moved on.');
    switch (a.k) {
      case 'answer': {
        record(a, ['turn', 'k', 'yes']);
        if (s.phase !== 'survey' || !c) throw new Error('The survey is closed.');
        if (Object.hasOwn(c.answers, id)) throw new Error('Your answer is already in.');
        c.answers[id] = bool(a.yes, 'Your answer'); api.sfx('submit');
        return;
      }
      case 'aim': case 'lock': {
        record(a, ['turn', 'k', 'value']);
        if (s.phase !== 'guess' || !c) throw new Error('The dial is not live right now.');
        if (c.agent !== id) throw new Error('Only the agent turns the dial.');
        if (c.guess !== null) throw new Error('Your guess is already locked in.');
        const value = integer(a.value, 0, 100);
        if (a.k === 'lock') return lock(s, api, value);
        // Faster than the phone's throttle: keep the old position (never an error, the next update catches up).
        if (api.now - c.aimAt < AIM_MS * .6) return;
        c.dial = value; c.aimAt = api.now;
        return;
      }
      case 'bet': {
        record(a, ['turn', 'k', 'bet']);
        if (s.phase !== 'bet' || !c) throw new Error('Betting is closed.');
        if (c.agent === id) throw new Error('You’re the agent: no betting on yourself!');
        if (Object.hasOwn(c.bets, id)) throw new Error('Your bet is already in.');
        const bet = BETS.find(b => b === a.bet);
        if (!bet) throw new Error('Pick higher or lower.');
        if (bet.startsWith('much') && s.round < 2) throw new Error('Long shots open in round 2.');
        if (!possible(bet, c.guess!)) throw new Error('That bet can’t win from this guess.');
        c.bets[id] = bet; api.sfx('vote');
        return;
      }
      case 'ticks': {
        record(a, ['turn', 'k', 'ticks']);
        if (s.phase !== 'tick') throw new Error('Ticking is closed.');
        if (Object.hasOwn(s.ticks, id)) throw new Error('Your ticks are already filed.');
        s.ticks[id] = indices(a.ticks, WANTED_SIZE, false, 'ticks'); api.sfx('submit');
        return;
      }
      case 'picks': {
        record(a, ['turn', 'k', 'picks']);
        if (s.phase !== 'pick') throw new Error('Picking is closed.');
        if (Object.hasOwn(s.picks, id)) throw new Error('Your picks are already in.');
        s.picks[id] = indices(a.picks, WANTED_PICKS, true, 'statements'); api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]), c = s.cur;
    // Nobody online (a Wi-Fi blip) waits for the buzzer instead of racing through empty phases.
    const all = (has: (id: string) => boolean, ids = online, min = MIN_READ_MS) => online.length > 0 && ids.every(has) && t >= min;
    const hurry = (ms: number) => { if (!s.hurried && s.deadline - now <= ms && s.deadline - s.at > ms * 2) { s.hurried = true; api.sfx('tick-fast'); } };
    switch (s.phase) {
      case 'survey':
        if (all(id => Object.hasOwn(c!.answers, id)) || now >= s.deadline) { api.sfx(now >= s.deadline ? 'timeup' : 'lock'); api.sfx('glitch'); return go(s, api, 'guess', api.seconds(GUESS_S)); }
        return hurry(3000);
      case 'guess':
        if (c!.guess === null) {
          if (now >= s.deadline) { lock(s, api, c!.dial ?? 50, c!.dial === null); api.sfx('timeup'); }
          else if (!s.online[c!.agent] && t >= MIN_READ_MS) lock(s, api, c!.dial ?? 50, c!.dial === null);
          else hurry(5000);
        } else if (now - c!.lockedAt >= LOCK_MS) { api.sfx('ding'); go(s, api, 'bet', api.seconds(BET_S)); }
        return;
      case 'bet':
        if (all(id => Object.hasOwn(c!.bets, id), online.filter(id => id !== c!.agent), 1200) || now >= s.deadline) return reveal(s, api);
        return hurry(4000);
      case 'reveal': {
        const r = c!.reveal!;
        beats(s, api, [REVEAL.bets, REVEAL.sweep, REVEAL.land, REVEAL.score], stage => {
          if (stage === 0 && Object.keys(r.bets).length) api.sfx('whoosh');
          if (stage === 1) api.sfx('drumroll');
          if (stage === 2) api.sfx('reveal');
          if (stage === 3) verdict(s, api, r);
        });
        if (now >= s.deadline) return s.queue.length ? startQuestion(s, api) : endRound(s, api);
        return;
      }
      case 'scores':
        if (now >= s.deadline) startRound(s, api);
        return;
      case 'tick':
        if (all(id => Object.hasOwn(s.ticks, id)) || now >= s.deadline) {
          api.say(now >= s.deadline ? variant('host.timeup', api.random) : 'host.everyone-in'); api.music('vote'); api.sfx('ding');
          return go(s, api, 'pick', api.seconds(PICK_S));
        }
        return hurry(8000);
      case 'pick':
        if (all(id => Object.hasOwn(s.picks, id)) || now >= s.deadline) return wantedReveal(s, api);
        return hurry(6000);
      case 'wanted': {
        const b = wantedBeats();
        beats(s, api, [...b.reveals, b.totals], stage => {
          if (stage < WANTED_SIZE) api.sfx(stage >= WANTED_SIZE - 3 ? 'stamp' : 'pop');
          else { api.sfx('fanfare'); api.sfx('applause'); hold(s, api, api.say(variant('host.winner', api.random))); }
        });
        if (now >= s.deadline && s.stage > WANTED_SIZE) s.done = true;
      }
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const c = s.cur, pub: BallparkPublic = { phase: s.phase, round: s.round, turn: s.turn, at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [] };
    if (s.phase === 'scores') pub.prev = { ...s.prev };
    if (c && ROUND_PHASES.includes(s.phase)) {
      pub.q = { index: s.asked - 1, count: s.asked + s.queue.length, text: c.q.text, agent: c.agent, dial: s.phase === 'survey' ? null : c.dial, locked: c.guess !== null, ...(c.q.open ? { open: true as const } : {}) };
      if (s.phase !== 'survey') pub.q.respondents = Object.keys(c.answers).length;
      if (s.phase === 'survey') pub.done = s.ids.filter(id => Object.hasOwn(c.answers, id));
      if (s.phase === 'bet') pub.done = s.ids.filter(id => Object.hasOwn(c.bets, id));
      if (s.phase === 'reveal' && c.reveal) {
        const r = c.reveal;
        pub.result = { ...r, bets: { ...r.bets }, gains: { ...r.gains }, ...(r.yesIds ? { yesIds: [...r.yesIds], noIds: [...r.noIds!] } : {}) };
      }
    }
    if (s.set && (s.phase === 'tick' || s.phase === 'pick' || s.phase === 'wanted')) {
      pub.wanted = { title: s.set.title, items: [...s.set.items] };
      if (s.phase === 'tick') pub.done = s.ids.filter(id => Object.hasOwn(s.ticks, id));
      if (s.phase === 'pick') pub.done = s.ids.filter(id => Object.hasOwn(s.picks, id));
      const w = s.wanted;
      if (s.phase === 'wanted' && w) pub.wanted.result = {
        counts: [...w.counts], ranks: [...w.ranks], order: [...w.order], filed: w.filed, gains: { ...w.gains },
        picks: Object.fromEntries(Object.entries(w.picks).map(([id, p]) => [id, [...p]])),
      };
    }
    return pub;
  },

  playerView(s, id) {
    const c = s.cur, me: BallparkPrivate = { turn: s.turn };
    if (c && ROUND_PHASES.includes(s.phase)) {
      me.role = c.agent === id ? 'agent' : 'bettor';
      const answer = own(c.answers, id), bet = own(c.bets, id);
      if (answer !== undefined) me.answer = answer ? 'yes' : 'no';
      if (bet) me.bet = bet;
    }
    if (s.phase === 'tick' || s.phase === 'pick' || s.phase === 'wanted') {
      const ticks = own(s.ticks, id), picks = own(s.picks, id);
      if (ticks) me.ticks = [...ticks];
      if (picks) me.picks = [...picks];
    }
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const top = Math.max(...s.ids.map(id => s.scores[id]!)), awards: { title: string; playerId: string }[] = [];
    const best = (title: string, rec: Record<string, number>, min = 1) => {
      const max = Math.max(...s.ids.map(id => rec[id]!)), who = s.ids.filter(id => rec[id] === max);
      if (max >= min && who.length === 1) awards.push({ title, playerId: who[0]! });
    };
    best('Human calculator', s.stats.bullseyes);
    best('Mind reader', s.stats.bets, 2);
    best('Long-shot legend', s.stats.longshots);
    best('Most Wanted hunter', s.stats.hunted);
    const headline = s.answered ? `This room said yes ${Math.round(s.yes / s.answered * 100)}% of the time.` : undefined;
    return { scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], ...(headline ? { headline } : {}), ...(awards.length ? { awards } : {}) };
  },
};
export default server;
