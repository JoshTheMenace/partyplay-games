/* Comment Section rules: answer an innocent question, twist a friend's answer into an out-of-context post, vote for the most
   ruinous. Three rounds (×1, ×2, then the Final Feed: profile status updates, ×3, two votes each). Server only. */
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { variant } from '../../core/narration';
import { dealFresh } from '../../core/server/deck';
import { record } from '../../core/server/validate';
import { HOUSE_ANSWERS, REPLIES, formatPool, questionPool, twistPool, type FormatItem } from './content.server';
import {
  ANSWER_S, AUTHOR_PTS, FEED_LEAD, FINAL_VOTE_S, KINDS, MAX_ANSWER, MAX_TWIST, MIN_READ_MS, POST, ROUNDS, ROUND_MS, SCORES_MS, TWIST_PTS, TWIST_S, VOTE_S,
  postMs, revealBeats, type CommentPrivate, type CommentPublic, type Kind, type Phase, type Post, type Reply, type Verdict,
} from './types';

type Entry = { id: string; author: string; question: string; answer: string | null; house: boolean; twister: string; format: FormatItem; twist: string | null; auto: boolean; likes: number; replies: Reply[] };
type Stat = 'ruinous' | 'ruined' | 'autos';
export type CommentState = {
  ids: string[]; online: Record<string, boolean>;
  phase: Phase; round: number; turn: string; seq: number; at: number; deadline: number; hurried: boolean;
  /** Feed: posts started and the beat reached inside the current one. Results: verdicts revealed (+1 once reported). */
  stage: number; sub: number;
  /** This round's posts in display order; twister→author pairs and apps dealt earlier this game. */
  entries: Entry[]; pairs: string[]; kinds: Kind[];
  houseAnswers: string[]; houseTwists: Partial<Record<Kind, string[]>>; replies: Reply[];
  feedAt: number[]; votes: Record<string, string[]>; verdicts: Verdict[]; reported: string[];
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>; reportedTotal: number;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const rotate = <T>(list: T[]) => { const item = list.shift()!; list.push(item); return item; };
const authorOf = (s: CommentState, id: string) => s.entries.find(e => e.author === id);
const twisterOf = (s: CommentState, id: string) => s.entries.find(e => e.twister === id);

/** Trims, collapses whitespace and drops control/bidi characters; 1–max characters. */
function clean(raw: unknown, max: number, empty: string): string {
  if (typeof raw !== 'string' || raw.length > max * 4) throw new Error(`Keep it under ${max} characters.`);
  const text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(empty);
  if (text.length > max) throw new Error(`Keep it under ${max} characters.`);
  return text;
}

function go(s: CommentState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, sub: 0, hurried: false });
}
/** Keeps the phase open long enough for narration that just started. */
function hold(s: CommentState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }

function houseTwist(s: CommentState, api: MiniApi, kind: Kind) { return rotate(s.houseTwists[kind] ??= api.shuffle(twistPool(api.settings.family, kind))); }

/** Deals questions, twister→author pairs and a post format per answer. */
function startRound(s: CommentState, api: MiniApi) {
  s.round++; s.prev = { ...s.scores };
  const n = s.ids.length, final = s.round === ROUNDS.length, family = api.settings.family, pair = (a: string, b: string) => `${a}>${b}`;
  const questions = dealFresh(api, questionPool(family), n);
  // Twisters: a derangement of the room (nobody twists their own answer), preferring pairs not used earlier this game.
  const repeats = (t: string[]) => t.filter((id, i) => s.pairs.includes(pair(id, s.ids[i]!))).length;
  const twisters = Array.from({ length: 200 }, () => api.shuffle(s.ids)).filter(t => t.every((id, i) => id !== s.ids[i]))
    .reduce<string[] | null>((a, b) => !a || repeats(b) < repeats(a) ? b : a, null) ?? s.ids.map((_, i) => s.ids[(i + 1) % n]!);
  // Rounds 1–2: a different app per answer, preferring apps not seen yet this game. The Final Feed: profile status updates.
  const fresh = KINDS.filter(k => !s.kinds.includes(k)), kinds = [...api.shuffle(fresh), ...api.shuffle(KINDS.filter(k => s.kinds.includes(k)))].slice(0, n);
  const formats = final ? dealFresh(api, formatPool(family, 'status'), n, f => f.id) : kinds.map(kind => dealFresh(api, formatPool(family, kind), 1, f => f.id)[0]!);
  s.kinds.push(...kinds);
  const raw = s.ids.map((author, i) => {
    const twister = twisters[i]!;
    s.pairs.push(pair(twister, author));
    return { author, twister, question: questions[i % questions.length]!, format: formats[i % formats.length]! };
  });
  s.entries = api.shuffle(raw).map((e, i) => ({ ...e, id: `f${i}`, answer: null, house: false, twist: null, auto: false, likes: 0, replies: [] }));
  s.votes = {}; s.verdicts = []; s.reported = [];
  api.music('comment-section'); api.sfx('swoosh-in'); api.sfx('ding');
  go(s, api, 'round', ROUND_MS);
  if (final) hold(s, api, api.say('host.final-round') + api.say('comment-section.final'));
}

/** Answers are in (or time is up): the house answers for anyone silent, then everyone twists somebody else's answer. */
function endAnswer(s: CommentState, api: MiniApi) {
  for (const e of s.entries) if (e.answer === null) { e.answer = rotate(s.houseAnswers); e.house = true; }
  api.music('think-2'); api.sfx('glitch'); api.say('comment-section.twist');
  go(s, api, 'twist', api.seconds(TWIST_S));
}

/** Twists are in: the house fills gaps (half points), then the feed plays every post with its own server-timed beat. */
function startFeed(s: CommentState, api: MiniApi) {
  let at = api.now + FEED_LEAD;
  s.feedAt = [];
  for (const e of s.entries) {
    if (e.twist === null) { e.twist = houseTwist(s, api, e.format.kind); e.auto = true; }
    e.likes = Math.round(20 + api.random() ** 3 * 98_000); e.replies = [rotate(s.replies), rotate(s.replies)];
    s.feedAt.push(at); at += postMs({ twist: e.twist, answer: e.answer! });
  }
  api.music('comment-section'); api.sfx('whoosh');
  go(s, api, 'feed', at - api.now);
}

function startVote(s: CommentState, api: MiniApi) {
  api.music('vote'); api.sfx('ding'); api.say(variant('host.vote', api.random));
  go(s, api, 'vote', api.seconds(s.round === ROUNDS.length ? FINAL_VOTE_S : VOTE_S));
}

/** Scores every post: twister 100 × votes × round (half for a house twist), author 50 × other players' votes × round (none for a house answer). */
function reveal(s: CommentState, api: MiniApi) {
  const m = ROUNDS[s.round - 1]!.mult;
  const rows: Verdict[] = s.entries.map(e => {
    const voters = s.ids.filter(id => own(s.votes, id)?.includes(e.id)), others = voters.filter(id => id !== e.author).length, raw = voters.length * TWIST_PTS * m;
    const points = e.auto ? Math.round(raw / 2) : raw, authorPoints = e.house ? 0 : others * AUTHOR_PTS * m;
    s.scores[e.twister]! += points; s.scores[e.author]! += authorPoints;
    s.stats.ruinous[e.twister]! += voters.length; s.stats.ruined[e.author]! += others;
    return { id: e.id, twister: e.twister, votes: voters.length, voters, points, authorPoints, ...(e.auto ? { auto: true as const } : {}), ...(e.house ? { house: true as const } : {}) };
  });
  const top = Math.max(0, ...rows.map(r => r.votes));
  s.reported = top ? rows.filter(r => r.votes === top).map(r => r.id) : [];
  s.verdicts = rows.sort((a, b) => a.votes - b.votes);
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'results', revealBeats(rows.length).end);
}

function writingTick(s: CommentState, api: MiniApi, ready: (id: string) => boolean, end: () => void) {
  const now = api.now, online = s.ids.filter(id => s.online[id]);
  if (online.length && online.every(ready) && now - s.at >= MIN_READ_MS) { api.say('host.everyone-in'); return end(); }
  if (now >= s.deadline) { api.sfx('timeup'); api.say(variant('host.timeup', api.random)); return end(); }
  if (!s.hurried && s.deadline - now <= 10_000 && s.deadline - s.at > 20_000) { s.hurried = true; api.sfx('tick-fast'); api.say(variant('host.hurry', api.random)); }
}

export const server: MiniServer<CommentState, CommentPublic, CommentPrivate> = {
  id: 'comment-section',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0]));
    const s: CommentState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])),
      phase: 'round', round: 0, turn: '', seq: 0, at: api.now, deadline: api.now, hurried: false, stage: 0, sub: 0,
      entries: [], pairs: [], kinds: [], houseAnswers: api.shuffle(HOUSE_ANSWERS), houseTwists: {}, replies: api.shuffle(REPLIES),
      feedAt: [], votes: {}, verdicts: [], reported: [],
      scores: zero(), prev: zero(), stats: { ruinous: zero(), ruined: zero(), autos: zero() }, reportedTotal: 0, done: false,
    };
    startRound(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The feed has moved on.');
    switch (a.k) {
      case 'answer': {
        record(a, ['turn', 'k', 'text']);
        if (s.phase !== 'answer') throw new Error('Answering is closed.');
        const e = authorOf(s, id)!;
        if (e.answer !== null) throw new Error('Your answer is already posted.');
        e.answer = clean(a.text, MAX_ANSWER, 'Type an answer first.'); api.sfx('submit');
        return;
      }
      case 'twist': case 'auto': {
        record(a, a.k === 'twist' ? ['turn', 'k', 'text'] : ['turn', 'k']);
        if (s.phase !== 'twist') throw new Error('Twisting is closed.');
        const e = twisterOf(s, id)!;
        if (e.twist !== null) throw new Error('Your twist is already posted.');
        if (a.k === 'twist') { e.twist = clean(a.text, MAX_TWIST, 'Write the missing context first.'); api.sfx('pop'); }
        else { e.twist = houseTwist(s, api, e.format.kind); e.auto = true; s.stats.autos[id]!++; api.sfx('boing'); }
        return;
      }
      case 'vote': {
        record(a, ['turn', 'k', 'posts']);
        if (s.phase !== 'vote') throw new Error('Voting opens after the feed.');
        if (Object.hasOwn(s.votes, id)) throw new Error('Your vote is already in.');
        const max = ROUNDS[s.round - 1]!.votes, picks = a.posts;
        if (!Array.isArray(picks) || !picks.length || picks.length > max) throw new Error(max > 1 ? `Pick one or ${max} posts.` : 'Pick one post.');
        if (new Set(picks).size !== picks.length) throw new Error('Pick different posts.');
        for (const pick of picks) {
          const e = s.entries.find(x => x.id === pick);
          if (!e) throw new Error('That post isn’t on the feed.');
          if (e.twister === id) throw new Error('Nice try! You can’t vote for your own twist.');
        }
        s.votes[id] = [...picks as string[]]; api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at;
    switch (s.phase) {
      case 'round':
        if (now >= s.deadline) { api.sfx('pop'); go(s, api, 'answer', api.seconds(ANSWER_S)); }
        return;
      case 'answer': return writingTick(s, api, id => authorOf(s, id)!.answer !== null, () => endAnswer(s, api));
      case 'twist': return writingTick(s, api, id => twisterOf(s, id)!.twist !== null, () => startFeed(s, api));
      case 'feed': {
        if (s.stage < s.entries.length && now >= s.feedAt[s.stage]!) {
          const e = s.entries[s.stage++]!;
          s.sub = 0; api.sfx('swoosh-in'); api.speak(`${e.format.label}: ${e.twist}. ${e.answer}`);
        }
        const since = now - (s.feedAt[s.stage - 1] ?? Infinity);
        if (s.sub === 0 && since >= POST.answer) { s.sub++; api.sfx('pop'); }
        else if (s.sub === 1 && since >= POST.reply1) { s.sub++; api.sfx(api.random() < .6 ? 'laugh' : 'ooh'); }
        if (now >= s.deadline) startVote(s, api);
        return;
      }
      case 'vote': {
        const online = s.ids.filter(id => s.online[id]);
        if ((online.every(id => Object.hasOwn(s.votes, id)) && t >= 1200) || now >= s.deadline) reveal(s, api);
        return;
      }
      case 'results': {
        const n = s.verdicts.length, beats = revealBeats(n);
        if (s.stage < n && t >= beats.reveals[s.stage]!) api.sfx(s.verdicts[s.stage++]!.votes ? 'score-up' : 'pop');
        else if (s.stage === n && t >= beats.reported) {
          s.stage++;
          if (!s.reported.length) { api.sfx('aww'); hold(s, api, api.say('host.no-votes')); }
          else {
            s.reportedTotal += s.reported.length; api.sfx('stamp'); api.sfx('airhorn'); api.sfx('cheer');
            hold(s, api, api.say(s.reported.length > 1 ? 'host.tie' : 'comment-section.reported'));
          }
        }
        if (now < s.deadline || s.stage <= n) return;
        if (s.round === ROUNDS.length) { s.done = true; return; }
        api.music('comment-section'); go(s, api, 'scores', SCORES_MS); hold(s, api, api.say('host.scores'));
        return;
      }
      case 'scores':
        if (now >= s.deadline) startRound(s, api);
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const pub: CommentPublic = { phase: s.phase, round: s.round, turn: s.turn, at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [] };
    const post = (e: Entry): Post => ({ id: e.id, author: e.author, kind: e.format.kind, label: e.format.label, meta: e.format.meta, twist: e.twist!, answer: e.answer!, likes: e.likes, replies: e.replies.map(r => ({ ...r })) });
    if (s.phase === 'scores') pub.prev = { ...s.prev };
    if (s.phase === 'answer') pub.done = s.ids.filter(id => authorOf(s, id)!.answer !== null);
    if (s.phase === 'twist') pub.done = s.ids.filter(id => twisterOf(s, id)!.twist !== null);
    if (s.phase === 'vote') pub.done = s.ids.filter(id => Object.hasOwn(s.votes, id));
    if (s.phase === 'feed') Object.assign(pub, { stage: s.stage, posts: s.entries.slice(0, s.stage).map(post), beats: s.feedAt.slice(0, s.stage) });
    if (s.phase === 'vote' || s.phase === 'results') pub.posts = s.entries.map(post);
    if (s.phase === 'results') pub.result = { verdicts: structuredClone(s.verdicts), reported: [...s.reported] };
    return pub;
  },

  playerView(s, id) {
    const me: CommentPrivate = { turn: s.turn }, mine = authorOf(s, id), twisting = twisterOf(s, id);
    if (!mine || !twisting || s.phase === 'round' || s.phase === 'scores') return me;
    if (s.phase === 'answer' || s.phase === 'twist') {
      if (s.phase === 'answer') me.question = mine.question;
      if (mine.answer !== null) Object.assign(me, { answer: mine.answer }, mine.house ? { house: true } : {});
    }
    if (s.phase === 'twist') {
      const { kind, ask, label, meta } = twisting.format;
      me.target = { author: twisting.author, answer: twisting.answer!, format: { kind, ask, label, meta } };
      if (twisting.twist !== null) Object.assign(me, { twist: twisting.twist }, twisting.auto ? { auto: true } : {});
    }
    if (s.phase === 'feed' || s.phase === 'vote' || s.phase === 'results') {
      Object.assign(me, { mine: twisting.id, about: mine.id });
      const votes = own(s.votes, id);
      if (votes) me.votes = [...votes];
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
    best('Most ruinous', s.stats.ruinous); best('Most ruined', s.stats.ruined); best('On autopilot', s.stats.autos, 2);
    const n = s.reportedTotal;
    return {
      scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], ...(awards.length ? { awards } : {}),
      headline: n ? `${n} ${n === 1 ? 'post' : 'posts'} reported. Zero apologies.` : 'Nothing reported. Suspiciously wholesome.',
    };
  },
};
export default server;
