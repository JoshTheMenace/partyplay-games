/* Quip Clash rules: two rounds of head-to-head prompts (×1, ×2), then the Last Laugh all-play (×3). Server only. */
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { isCrowd } from '../../core/crowd';
import { variant } from '../../core/narration';
import { dealBallots } from '../../core/server/ballots';
import { dealFresh } from '../../core/server/deck';
import { integer, record } from '../../core/server/validate';
import { SAFETY, finalPool, promptPool } from './content.server';
import { BALLOT, FINAL_SHOWN, FINAL_VOTES, FINAL_VOTE_S, HEATS, HEAT_HOLD_MS, HEAT_SIZE, LAST_ROUND, heatVotes, MAX_ANSWER, MIN_READ_MS, RESULT, VOTE_S, WRITE_S, finalBeats, showBeats, type FinalReveal, type Phase, type QuipPrivate, type QuipPublic } from './types';

type Quip = { author: string; text: string | null; safety: boolean };
type Duel = { prompt: string; sides: [Quip, Quip]; votes: Record<string, number>; points: [number, number]; winner: number | null; wipe: boolean; jinx: boolean };
type Stat = 'votes' | 'wipes' | 'safeties';
export type QuipState = {
  ids: string[]; online: Record<string, boolean>;
  phase: Phase; round: number; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean;
  /** Unused head-to-head prompts, the Last Laugh prompt and the shuffled safety bank (rotated as it is used). */
  prompts: string[]; finalPrompt: string; safety: string[];
  duels: Duel[]; index: number;
  answers: Record<string, Quip>; entries: { id: string; quip: Quip }[]; picks: Record<string, string[]>; reveal: FinalReveal[]; laughs: string[];
  /** Big rooms: this round's heats (prompt and writers), the halves of a room above 32 (one writes per round), votes per player on
      the open board, the Last Laugh ballots (entry ids per phone) and the entries its TV reveal skips. */
  heats: { prompt: string; ids: string[] }[]; halves: string[][]; boardVotes: number; ballots: Record<string, string[]>; hidden: FinalReveal[];
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const quip = (author: string): Quip => ({ author, text: null, safety: false });
const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || text.toLowerCase();
const duel = (s: QuipState) => s.duels[s.index]!;
const texts = (d: Duel) => d.sides.map(q => ({ text: q.text ?? '' }));

/** Trims, collapses whitespace and drops control/bidi characters; 1–80 characters. */
function clean(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_ANSWER * 4) throw new Error(`Keep it under ${MAX_ANSWER} characters.`);
  const text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Type an answer first.');
  if (text.length > MAX_ANSWER) throw new Error(`Keep it under ${MAX_ANSWER} characters.`);
  return text;
}
function nextSafety(s: QuipState) { const text = s.safety.shift()!; s.safety.push(text); return text; }

/** The prompts a player still owns in a writing phase, in slot order. */
function slotsOf(s: QuipState, id: string): { prompt: string; quip: Quip }[] {
  if (s.phase === 'final-write') { const q = own(s.answers, id); return q ? [{ prompt: s.finalPrompt, quip: q }] : []; }
  if (s.phase === 'write' && s.heats.length) { const q = own(s.answers, id), heat = s.heats.find(h => h.ids.includes(id)); return q && heat ? [{ prompt: heat.prompt, quip: q }] : []; }
  return s.phase === 'write' ? s.duels.flatMap(d => d.sides.filter(q => q.author === id).map(q => ({ prompt: d.prompt, quip: q }))) : [];
}
const written = (s: QuipState, id: string) => slotsOf(s, id).every(x => x.quip.text !== null);

function go(s: QuipState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: QuipState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }

/** Rounds 1–2: shuffle the room, pair neighbours cyclically (each player gets two prompts, each prompt two players). */
function startRound(s: QuipState, api: MiniApi) {
  s.round++; s.prev = { ...s.scores };
  api.music('quip-clash');
  if (s.round > 1) api.sfx('gong');
  s.heats = [];
  if (s.round === LAST_ROUND) {
    s.answers = Object.fromEntries(s.ids.map(id => [id, quip(id)]));
    api.say('host.final-round'); api.say('quip-clash.last-laugh');
    return go(s, api, 'final-write', api.seconds(WRITE_S));
  }
  // A big room would sit through a duel per player: instead up to four heats, one prompt each, and the whole room votes on every heat.
  if (isCrowd(s.ids.length)) {
    const cast = s.halves.length ? s.halves[s.round - 1]! : api.shuffle(s.ids), count = Math.min(HEATS, Math.ceil(cast.length / 2));
    s.heats = s.prompts.splice(0, count).map((prompt, h) => ({ prompt, ids: cast.filter((_, i) => i % count === h) }));
    s.answers = Object.fromEntries(cast.map(id => [id, quip(id)])); s.duels = []; s.index = 0;
    return go(s, api, 'write', api.seconds(WRITE_S));
  }
  const order = api.shuffle(s.ids), n = order.length, prompts = s.prompts.splice(0, n);
  // Evens then odds, so nobody plays two matchups back to back (unavoidable with three players).
  const sequence = [...order.keys()].sort((a, b) => a % 2 - b % 2 || a - b);
  s.duels = sequence.map(i => {
    const pair = [order[i]!, order[(i + 1) % n]!], [a, b] = api.random() < .5 ? pair : pair.reverse();
    return { prompt: prompts[i]!, sides: [quip(a!), quip(b!)], votes: {}, points: [0, 0], winner: null, wipe: false, jinx: false };
  });
  s.index = 0;
  go(s, api, 'write', api.seconds(WRITE_S));
}

/** Time's up or everyone is in: house answers fill the gaps, then the matchups (or the Last Laugh vote) begin. */
function endWrite(s: QuipState, api: MiniApi) {
  if (s.phase === 'write' && s.heats.length) { s.index = 0; return openBoard(s, api, s.heats[0]!.ids); }
  if (s.phase === 'write') {
    for (const d of s.duels) {
      for (const q of d.sides) if (q.text === null) { q.text = nextSafety(s); q.safety = true; }
      d.jinx = norm(d.sides[0].text!) === norm(d.sides[1].text!);
    }
    return showDuel(s, api);
  }
  openBoard(s, api, s.ids);
}
/** The room is on a heat (big rooms, rounds 1–2) rather than the Last Laugh. */
const heat = (s: QuipState) => s.round < LAST_ROUND && s.heats.length > 0;

/** Opens the vote on an all-play board: the Last Laugh, or one heat. Offline players who never answered sit it out. */
function openBoard(s: QuipState, api: MiniApi, ids: readonly string[]) {
  const writers = ids.filter(id => s.answers[id]!.text !== null || s.online[id]);
  for (const id of writers) { const q = s.answers[id]!; if (q.text === null) { q.text = nextSafety(s); q.safety = true; } }
  s.entries = api.shuffle(writers).map((id, i) => ({ id: `e${i}`, quip: s.answers[id]! }));
  Object.assign(s, { picks: {}, reveal: [], laughs: [], hidden: [], ballots: {}, boardVotes: heat(s) ? heatVotes(s.entries.length) : FINAL_VOTES });
  // More answers than the TV can list: every phone gets eight it did not write, dealt evenly.
  if (isCrowd(s.ids.length) && s.entries.length > BALLOT + 2) {
    const hands = dealBallots(api, s.ids, s.entries, BALLOT, (e, id) => e.quip.author === id);
    s.ballots = Object.fromEntries(s.ids.map(id => [id, hands[id]!.map(e => e.id)]));
  }
  api.music('vote'); api.speak(heat(s) ? s.heats[s.index]!.prompt : s.finalPrompt);
  if (!heat(s) || s.index === 0) api.say(variant('host.vote', api.random));
  go(s, api, 'final-vote', api.seconds(FINAL_VOTE_S));
}

function showDuel(s: QuipState, api: MiniApi) {
  const d = duel(s);
  api.music('vote'); api.sfx('swoosh-in'); api.speak(d.prompt);
  go(s, api, 'show', showBeats(texts(d))[3]);
}

/** Scores a matchup: votes × 100 × round, +100 × round to the winner, +250 × round for a quipwipe; safety quips score half. */
function reveal(s: QuipState, api: MiniApi) {
  const d = duel(s), mult = s.round, counts = [0, 1].map(side => Object.values(d.votes).filter(v => v === side).length) as [number, number];
  d.winner = d.jinx || counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
  d.wipe = d.winner !== null && counts[0] + counts[1] >= 2 && counts[1 - d.winner] === 0;
  d.sides.forEach((q, i) => {
    const raw = d.jinx ? 0 : counts[i]! * 100 * mult + (d.winner === i ? 100 * mult : 0) + (d.wipe && d.winner === i ? 250 * mult : 0);
    d.points[i] = q.safety ? Math.round(raw / 2) : raw;
    s.scores[q.author]! += d.points[i]; s.stats.votes[q.author]! += counts[i]!;
    if (d.wipe && d.winner === i) s.stats.wipes[q.author]!++;
  });
  api.music('reveal');
  go(s, api, 'result', RESULT.end + (d.wipe || d.jinx ? RESULT.bonus : 0));
}

function callout(s: QuipState, api: MiniApi, d: Duel) {
  const votes = Object.keys(d.votes).length;
  if (d.jinx) { api.sfx('record-scratch'); hold(s, api, api.say('quip-clash.jinx')); }
  else if (d.wipe) { api.sfx('airhorn'); api.sfx('cheer'); hold(s, api, api.say('quip-clash.quipwipe')); }
  else if (!votes) { api.sfx('aww'); hold(s, api, api.say('host.no-votes')); }
  else if (d.winner === null) { api.sfx('ooh'); hold(s, api, api.say('host.tie')); }
  else { api.sfx('laugh'); api.sfx('score-up'); if (api.random() < .25) hold(s, api, api.say(variant('host.quip', api.random))); }
}

/** Last Laugh: 300 per vote, +300 to the top answer(s); a heat pays 100 × round the same way. Safety quips score half. Revealed fewest votes first. */
function finalReveal(s: QuipState, api: MiniApi) {
  const cast = Object.values(s.picks).flat(), mult = heat(s) ? s.round : LAST_ROUND;
  const rows = s.entries.map(e => ({ e, votes: cast.filter(id => id === e.id).length }));
  const top = Math.max(0, ...rows.map(r => r.votes));
  s.laughs = top ? rows.filter(r => r.votes === top).map(r => r.e.quip.author) : [];
  s.reveal = rows.map(({ e, votes }) => {
    const author = e.quip.author, raw = votes * 100 * mult + (top && votes === top ? 100 * mult : 0), points = e.quip.safety ? Math.round(raw / 2) : raw;
    s.scores[author]! += points; s.stats.votes[author]! += votes;
    return { id: e.id, text: e.quip.text!, author, votes, voters: s.ids.filter(id => own(s.picks, id)?.includes(e.id)), points, ...(e.quip.safety ? { safety: true as const } : {}) };
  }).sort((a, b) => a.votes - b.votes);
  // A dealt board reveals its top eight on the TV; everyone else's result is on their phone.
  if (Object.keys(s.ballots).length) s.hidden = s.reveal.splice(0, Math.max(0, s.reveal.length - FINAL_SHOWN));
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'final-result', finalBeats(s.reveal.length, heat(s) ? HEAT_HOLD_MS : undefined).end);
}

export const server: MiniServer<QuipState, QuipPublic, QuipPrivate> = {
  id: 'quip-clash',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0]));
    const s: QuipState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])),
      phase: 'write', round: 0, turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false,
      prompts: dealFresh(api, promptPool(api.settings.family), isCrowd(ids.length) ? HEATS * 2 : ids.length * 2), finalPrompt: dealFresh(api, finalPool(api.settings.family), 1)[0]!, safety: api.shuffle(SAFETY),
      duels: [], index: 0, answers: {}, entries: [], picks: {}, reveal: [], laughs: [], heats: [], boardVotes: FINAL_VOTES, ballots: {}, hidden: [],
      halves: ids.length > HEATS * HEAT_SIZE ? (order => [0, 1].map(half => order.filter((_, i) => i % 2 === half)))(api.shuffle(ids)) : [],
      scores: zero(), prev: zero(), stats: { votes: zero(), wipes: zero(), safeties: zero() }, done: false,
    };
    startRound(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The game has moved on.');
    switch (a.k) {
      case 'answer': case 'safety': {
        record(a, a.k === 'answer' ? ['turn', 'k', 'slot', 'text'] : ['turn', 'k', 'slot']);
        const mine = slotsOf(s, id);
        if (!mine.length) throw new Error('No writing right now.');
        const slot = mine[integer(a.slot, 0, mine.length - 1)]!.quip;
        if (slot.text !== null) throw new Error('That answer is already locked in.');
        if (a.k === 'answer') { slot.text = clean(a.text); api.sfx('submit'); }
        else { slot.text = nextSafety(s); slot.safety = true; s.stats.safeties[id]!++; api.sfx('boing'); }
        return;
      }
      case 'vote': {
        record(a, ['turn', 'k', 'side']);
        if (s.phase !== 'vote') throw new Error('Voting opens in a moment.');
        const d = duel(s);
        if (d.sides.some(q => q.author === id)) throw new Error('No voting in your own matchup!');
        if (Object.hasOwn(d.votes, id)) throw new Error('Your vote is already in.');
        d.votes[id] = integer(a.side, 0, 1); api.sfx('vote');
        return;
      }
      case 'picks': {
        record(a, ['turn', 'k', 'picks']);
        if (s.phase !== 'final-vote') throw new Error('Voting is closed.');
        if (Object.hasOwn(s.picks, id)) throw new Error('Your votes are already in.');
        if (!Array.isArray(a.picks) || a.picks.length !== s.boardVotes) throw new Error(s.boardVotes === 1 ? 'Place your vote first.' : `Place all ${s.boardVotes} votes first.`);
        const mine = s.entries.find(e => e.quip.author === id)?.id, dealt = own(s.ballots, id);
        for (const pick of a.picks) {
          if (!s.entries.some(e => e.id === pick) || dealt?.includes(pick as string) === false) throw new Error('That answer is not on the board.');
          if (pick === mine) throw new Error('Nice try! You can’t vote for yourself.');
        }
        s.picks[id] = [...a.picks as string[]]; api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]);
    switch (s.phase) {
      case 'write': case 'final-write': {
        if (online.length && online.every(id => written(s, id)) && t >= MIN_READ_MS) { api.say('host.everyone-in'); return endWrite(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); api.say(variant('host.timeup', api.random)); return endWrite(s, api); }
        if (!s.hurried && s.deadline - now <= 10_000 && s.deadline - s.at > 20_000) { s.hurried = true; api.sfx('tick-fast'); api.say(variant('host.hurry', api.random)); }
        return;
      }
      case 'show': {
        const d = duel(s), beats = showBeats(texts(d));
        if (s.stage < 2 && t >= beats[s.stage + 1]!) { api.sfx('pop'); api.speak(d.sides[s.stage]!.text!); s.stage++; }
        if (now < s.deadline) return;
        if (d.jinx) return reveal(s, api);
        if (s.index === 0) api.say(variant('host.vote', api.random));
        api.sfx('ding');
        return go(s, api, 'vote', api.seconds(VOTE_S));
      }
      case 'vote': {
        const d = duel(s), voters = online.filter(id => !d.sides.some(q => q.author === id));
        if ((voters.every(id => Object.hasOwn(d.votes, id)) && t >= 1200) || now >= s.deadline) reveal(s, api);
        return;
      }
      case 'result': {
        const d = duel(s), beats = [RESULT.voters, RESULT.authors, RESULT.points];
        if (s.stage < 3 && t >= beats[s.stage]!) {
          s.stage++;
          if (s.stage === 1 && Object.keys(d.votes).length) api.sfx('vote');
          if (s.stage === 2) api.sfx('reveal');
          if (s.stage === 3) callout(s, api, d);
        }
        if (now < s.deadline) return;
        if (++s.index < s.duels.length) return showDuel(s, api);
        go(s, api, 'scores', 7500); hold(s, api, api.say('host.scores'));
        return;
      }
      case 'scores':
        if (now >= s.deadline) startRound(s, api);
        return;
      case 'final-vote': {
        const voters = online.filter(id => s.entries.some(e => e.quip.author !== id));
        if ((voters.every(id => Object.hasOwn(s.picks, id)) && t >= MIN_READ_MS) || now >= s.deadline) finalReveal(s, api);
        return;
      }
      case 'final-result': {
        const n = s.reveal.length, beats = finalBeats(n);
        if (s.stage < n && t >= beats.reveals[s.stage]!) { api.sfx(s.reveal[s.stage]!.votes ? 'score-up' : 'pop'); s.stage++; }
        else if (s.stage === n && t >= beats.winner) {
          s.stage++; api.sfx(heat(s) ? 'cheer' : 'fanfare'); api.sfx('applause');
          const line = !s.laughs.length ? 'host.no-votes' : s.laughs.length > 1 ? 'host.tie' : heat(s) ? null : variant('host.winner', api.random);
          if (line) hold(s, api, api.say(line));
        }
        if (now < s.deadline || s.stage <= n) return;
        if (!heat(s)) { s.done = true; return; }
        if (++s.index < s.heats.length) return openBoard(s, api, s.heats[s.index]!.ids);
        go(s, api, 'scores', 7500); hold(s, api, api.say('host.scores'));
      }
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const pub: QuipPublic = { phase: s.phase, round: s.round, turn: s.turn, at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [] };
    if (s.phase === 'scores') pub.prev = { ...s.prev };
    if (s.phase === 'write' || s.phase === 'final-write') pub.done = s.ids.filter(id => written(s, id));
    if (s.phase === 'final-vote') pub.done = s.ids.filter(id => Object.hasOwn(s.picks, id));
    if (s.phase === 'show' || s.phase === 'vote' || s.phase === 'result') {
      const d = duel(s);
      pub.match = { index: s.index, count: s.duels.length, prompt: d.prompt, answers: texts(d), votes: Object.keys(d.votes).length };
      if (s.phase === 'result') pub.match.result = {
        sides: d.sides.map((q, i) => ({ text: q.text!, author: q.author, voters: s.ids.filter(id => own(d.votes, id) === i), points: d.points[i]!, ...(q.safety ? { safety: true as const } : {}) })),
        winner: d.winner, ...(d.wipe ? { wipe: true as const } : {}), ...(d.jinx ? { jinx: true as const } : {}),
      };
    }
    const dealt = Object.keys(s.ballots).length > 0;
    if (s.phase === 'final-write' || s.phase === 'final-vote' || s.phase === 'final-result') pub.final = {
      prompt: heat(s) ? s.heats[s.index]!.prompt : s.finalPrompt, votes: s.boardVotes,
      // A dealt board never lists every answer in public: nothing while phones vote, then only the entries the TV reveals.
      entries: s.phase === 'final-write' ? [] : dealt ? s.reveal.map(r => ({ id: r.id, text: r.text })) : s.entries.map(e => ({ id: e.id, text: e.quip.text! })),
      ...(heat(s) ? { heat: { index: s.index, count: s.heats.length } } : {}),
      ...(dealt ? { field: { answers: s.entries.length, ballot: BALLOT } } : {}),
      ...(s.phase === 'final-result' ? { result: { entries: s.reveal.map(r => ({ ...r, voters: [...r.voters] })), winners: [...s.laughs] } } : {}),
    };
    return pub;
  },

  playerView(s, id) {
    const me: QuipPrivate = { turn: s.turn, prompts: slotsOf(s, id).map(({ prompt, quip: q }, slot) => ({ slot, prompt, ...(q.text !== null ? { answer: q.text } : {}), ...(q.safety ? { safety: true as const } : {}) })) };
    if (s.phase === 'show' || s.phase === 'vote' || s.phase === 'result') {
      const d = duel(s), side = d.sides.findIndex(q => q.author === id), vote = own(d.votes, id);
      if (side >= 0) Object.assign(me, { role: 'author', side });
      else Object.assign(me, { role: 'voter' }, vote === undefined ? {} : { side: vote });
    }
    if (s.phase === 'final-vote' || s.phase === 'final-result') {
      const mine = s.entries.find(e => e.quip.author === id), picks = own(s.picks, id), dealt = own(s.ballots, id);
      if (mine) me.mine = mine.id;
      if (picks) me.picks = [...picks];
      if (dealt) me.ballot = dealt.map(x => ({ id: x, text: s.entries.find(e => e.id === x)!.quip.text! }));
      const unshown = s.phase === 'final-result' ? s.hidden.find(r => r.author === id) : undefined;
      if (unshown) me.own = { ...unshown, voters: [...unshown.voters] };
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
    best('Crowd favourite', s.stats.votes);
    if (s.laughs.length === 1) awards.push({ title: 'Got the Last Laugh', playerId: s.laughs[0]! });
    best('Quipwipe machine', s.stats.wipes);
    best('Safety first', s.stats.safeties, 2);
    return { scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], ...(awards.length ? { awards } : {}) };
  },
};
export default server;
