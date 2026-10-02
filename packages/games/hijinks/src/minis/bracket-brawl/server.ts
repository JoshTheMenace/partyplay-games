/* Bracket Brawl rules: three answer tournaments (Standard, Blind, Smackdown) with champion predictions. Server only. */
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { variant } from '../../core/narration';
import { dealFresh, freshDeck } from '../../core/server/deck';
import { integer, record } from '../../core/server/validate';
import { CATEGORIES, GENERIC, blindPool, smackPool, standardPool } from './content.server';
import {
  BRACKETS, CHAMP, JUDGE_MS, MAX_ANSWER, MIN_READ_MS, PREDICT_S, PTS, SCORES_MS, STAGE_MS, TWIST, TWIST_MS, WRITE_S,
  answersFor, resultBeats, roundsOf, showBeats, sizeFor, voteSeconds, weight, type BrawlPrivate, type BrawlPublic, type Kind, type Phase,
} from './types';

type Entry = { id: string; text: string; by: string | null };
type Bout = { sides: [string | null, string | null]; votes: Record<string, 0 | 1>; winner: 0 | 1 | null; flip: boolean; counts: [number, number] };
/** One bracket's content: the prompt (Smackdown: part one), Blind's category, Smackdown's judging questions and house answers. */
type Card = { kind: Kind; prompt: string; hint?: string; judges?: string[]; house: readonly string[] };
type Stat = 'wins' | 'crowns' | 'oracle' | 'votes';
export type BrawlState = {
  ids: string[]; online: Record<string, boolean>; per: number; size: number; rounds: number; cards: Card[];
  phase: Phase; bracket: number; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean;
  round: number; index: number;
  answers: Record<string, (string | null)[]>; entries: Entry[]; bouts: Bout[][]; picks: Record<string, string>; earned: Record<string, number>;
  champ: { entry: string; bonus: number; oracles: string[]; oracle: number } | null;
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>;
  coined: boolean; houseWins: number; done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
/** Comparison key: case, punctuation and a leading article don't count (“A sloth” is “sloth”). */
const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(?:a|an|the) (?=.)/, '') || text.toLowerCase();
const card = (s: BrawlState) => s.cards[s.bracket - 1]!;
const bout = (s: BrawlState) => s.bouts[s.round - 1]![s.index]!;
const entry = (s: BrawlState, id: string | null) => s.entries.find(e => e.id === id)!;
const authors = (s: BrawlState, b: Bout) => b.sides.map(id => entry(s, id).by);
const written = (s: BrawlState, id: string) => (s.answers[id] ?? []).every(text => text !== null);
/** Smackdown asks its sharpest question (the card's last) in the final, so 8-slot brackets skip the first one. */
const judge = (s: BrawlState) => card(s).judges?.[4 - (s.rounds - s.round) - 1];
/** Connected players who wrote neither side of the live matchup. */
const voters = (s: BrawlState) => { const by = authors(s, bout(s)); return s.ids.filter(id => s.online[id] && !by.includes(id)); };

/** Trims, collapses whitespace and drops control/bidi characters; 1–50 characters. */
function clean(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_ANSWER * 4) throw new Error(`Keep it under ${MAX_ANSWER} characters.`);
  const text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Type an answer first.');
  if (text.length > MAX_ANSWER) throw new Error(`Keep it under ${MAX_ANSWER} characters.`);
  return text;
}

function go(s: BrawlState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: BrawlState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }

function startBracket(s: BrawlState, api: MiniApi) {
  s.bracket++;
  const c = card(s), zero = () => Object.fromEntries(s.ids.map(id => [id, 0]));
  Object.assign(s, { round: 0, index: 0, entries: [], bouts: [], picks: {}, earned: zero(), champ: null, coined: false, prev: { ...s.scores } });
  s.answers = Object.fromEntries(s.ids.map(id => [id, Array.from({ length: s.per }, () => null)]));
  api.music(s.bracket === 2 ? 'think-2' : 'think');
  if (s.bracket > 1) api.sfx('gong');
  if (c.kind === 'blind') api.say('bracket-brawl.blind');
  if (c.kind === 'smackdown') { api.say('host.final-round'); api.say('bracket-brawl.smackdown'); }
  api.speak(c.hint ?? c.prompt);
  go(s, api, 'write', api.seconds(WRITE_S));
}

/** House answers that fit this bracket (the card's own pool first), unused tonight first, never a copy of a player's answer. */
function house(s: BrawlState, api: MiniApi, count: number, taken: string[]) {
  const seen = new Set(taken.map(norm)), out: string[] = [];
  for (const text of [...freshDeck(api, card(s).house, h => `house:${h}`), ...freshDeck(api, GENERIC, h => `house:${h}`)]) {
    if (out.length >= count) break;
    if (seen.has(norm(text))) continue;
    seen.add(norm(text)); out.push(text); api.used.add(`house:${text}`);
  }
  return out;
}

/**
 * Seeds the bracket. A player's two answers land in opposite halves (they can only meet in the final), player answers face
 * house answers before each other in round one, and nobody faces themselves.
 */
function seed(s: BrawlState, api: MiniApi) {
  const halves: { text: string; by: string | null }[][] = [[], []], halfOf: Record<string, number> = {}, order = api.shuffle(s.ids);
  let flip = 0;
  for (let k = 0; k < s.per; k++) for (const id of order) {
    const text = s.answers[id]![k];
    if (!text) continue;
    const h = k && id in halfOf ? 1 - halfOf[id]! : flip++ % 2;
    halfOf[id] = h; halves[h]!.push({ text, by: id });
  }
  const fill = house(s, api, s.size - halves[0]!.length - halves[1]!.length, halves.flat().map(e => e.text));
  const pairs = halves.flatMap(list => {
    const players = api.shuffle(list), homes = fill.splice(0, s.size / 2 - list.length).map(text => ({ text, by: null })), out: (typeof list)[] = [];
    while (players.length) {
      const a = players.pop()!, home = homes.pop();
      if (home) { out.push([a, home]); continue; }
      const j = players.findIndex(p => p.by !== a.by);
      out.push([a, players.splice(Math.max(0, j), 1)[0]!]);
    }
    while (homes.length) out.push([homes.pop()!, homes.pop()!]);
    return api.shuffle(out).map(pair => api.random() < .5 ? pair : [pair[1]!, pair[0]!]);
  });
  s.entries = pairs.flat().map((e, i) => ({ id: `e${i}`, ...e }));
  s.bouts = Array.from({ length: s.rounds }, (_, r) => Array.from({ length: s.size >> (r + 1) }, (_, i): Bout => ({
    sides: r ? [null, null] : [`e${2 * i}`, `e${2 * i + 1}`], votes: {}, winner: null, flip: false, counts: [0, 0],
  })));
}

function endWrite(s: BrawlState, api: MiniApi) {
  seed(s, api);
  api.sfx('whoosh');
  if (card(s).kind !== 'blind') return startPredict(s, api);
  api.music('reveal'); api.sfx('record-scratch');
  go(s, api, 'twist', TWIST_MS);
  hold(s, api, api.say(variant('host.reveal', api.random)));
}

function startPredict(s: BrawlState, api: MiniApi) {
  api.music('bracket-brawl'); api.sfx('swoosh-in');
  go(s, api, 'predict', api.seconds(PREDICT_S));
}

function startStage(s: BrawlState, api: MiniApi, round: number) {
  s.round = round; s.index = 0;
  const final = round === s.rounds, question = judge(s);
  api.music('bracket-brawl'); api.sfx('bell');
  if (final) api.sfx('airhorn');
  go(s, api, 'stage', question ? JUDGE_MS : STAGE_MS);
  if (question) api.speak(question);
}

function startMatch(s: BrawlState, api: MiniApi, index: number) {
  s.index = index;
  const b = bout(s), [a, z] = b.sides.map(id => entry(s, id).text) as [string, string];
  api.sfx('swoosh-in');
  if (s.round === 1 && index === 0) api.say(variant('host.vote', api.random));
  go(s, api, 'vote', showBeats(a, z).open + api.seconds(voteSeconds(s.round, s.rounds)));
}

/** Majority wins; a tie (or nobody to vote) is a coin flip. Wins, predictions and votes are tallied privately until the crown. */
function decide(s: BrawlState, api: MiniApi) {
  const b = bout(s), w = weight(card(s).kind), counts = [0, 1].map(side => Object.values(b.votes).filter(v => v === side).length) as [number, number];
  b.counts = counts; b.flip = counts[0] === counts[1];
  b.winner = b.flip ? (api.random() < .5 ? 0 : 1) : counts[0] > counts[1] ? 0 : 1;
  const won = entry(s, b.sides[b.winner]);
  if (won.by) { s.earned[won.by]! += PTS.win * w; s.stats.wins[won.by]!++; }
  b.sides.forEach((id, side) => { const by = entry(s, id).by; if (by) s.stats.votes[by]! += counts[side]!; });
  for (const id of s.ids) if (own(s.picks, id) === won.id) s.earned[id]! += PTS.oracle;
  if (s.round < s.rounds) s.bouts[s.round]![s.index >> 1]!.sides[s.index & 1] = won.id;
  if (b.flip) api.sfx('drumroll');
  go(s, api, 'result', resultBeats(b.flip, s.round === s.rounds).end);
}

function beat(s: BrawlState, api: MiniApi) {
  const b = bout(s), total = b.counts[0] + b.counts[1], loser = b.counts[1 - b.winner!]!;
  if (s.stage === 1) api.sfx(total ? 'vote' : 'pop');
  if (s.stage === 2 && b.flip) {
    api.sfx('coin');
    if (!s.coined) { s.coined = true; hold(s, api, api.say('bracket-brawl.coin')); }
  }
  if (s.stage === 3) {
    api.sfx('crash');
    if (total >= 3 && !loser) { api.sfx('airhorn'); if (s.round >= s.rounds - 1) hold(s, api, api.say('host.landslide')); }
    else if (total >= 4 && Math.abs(b.counts[0] - b.counts[1]) === 1) { api.sfx('ooh'); if (s.round === s.rounds) hold(s, api, api.say('host.close')); }
    else api.sfx(entry(s, b.sides[b.winner!]).by ? 'cheer' : 'laugh');
  }
  if (s.stage === 4) api.sfx('ding');
}

/** The final is decided: crown the champion, pay the author and the oracles, and bank the bracket's points. */
function crown(s: BrawlState, api: MiniApi) {
  const final = s.bouts[s.rounds - 1]![0]!, champ = entry(s, final.sides[final.winner!]), bonus = champ.by ? PTS.champ * s.rounds : 0;
  if (champ.by) { s.earned[champ.by]! += bonus; s.stats.crowns[champ.by]!++; } else s.houseWins++;
  const oracles = s.ids.filter(id => own(s.picks, id) === champ.id);
  for (const id of oracles) s.stats.oracle[id]!++;
  s.champ = { entry: champ.id, bonus, oracles, oracle: PTS.oracle * s.rounds };
  for (const id of s.ids) s.scores[id]! += s.earned[id]!;
  api.sfx('fanfare'); api.sfx('applause');
  go(s, api, 'champ', CHAMP.end);
  hold(s, api, api.say(variant('host.winner', api.random)));
}

export const server: MiniServer<BrawlState, BrawlPublic, BrawlPrivate> = {
  id: 'bracket-brawl',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0])), family = api.settings.family, size = sizeFor(ids.length);
    const [standard] = dealFresh(api, standardPool(family), 1, p => p.text), [blind] = dealFresh(api, blindPool(family), 1, b => b.prompt), [smack] = dealFresh(api, smackPool(family), 1, x => x.ask);
    const s: BrawlState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])), per: answersFor(ids.length), size, rounds: roundsOf(size),
      cards: [
        { kind: 'standard', prompt: standard!.text, house: standard!.house },
        { kind: 'blind', prompt: blind!.prompt, hint: CATEGORIES[blind!.cat]!.hint, house: CATEGORIES[blind!.cat]!.house },
        { kind: 'smackdown', prompt: smack!.ask, judges: [...smack!.judges], house: CATEGORIES[smack!.cat]!.house },
      ],
      phase: 'write', bracket: 0, turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false, round: 0, index: 0,
      answers: {}, entries: [], bouts: [], picks: {}, earned: zero(), champ: null,
      scores: zero(), prev: zero(), stats: { wins: zero(), crowns: zero(), oracle: zero(), votes: zero() }, coined: false, houseWins: 0, done: false,
    };
    startBracket(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The bracket has moved on.');
    switch (a.k) {
      case 'answer': {
        record(a, ['turn', 'k', 'slot', 'text']);
        if (s.phase !== 'write') throw new Error('Writing time is over.');
        const slots = s.answers[id]!, slot = integer(a.slot, 0, slots.length - 1);
        if (slots[slot] !== null) throw new Error('That answer is already locked in.');
        const text = clean(a.text);
        if (slots.some(other => other !== null && norm(other) === norm(text))) throw new Error('You already sent that one. Try another!');
        slots[slot] = text; api.sfx('submit');
        return;
      }
      case 'predict': {
        record(a, ['turn', 'k', 'entry']);
        if (s.phase !== 'predict') throw new Error('Predictions are closed.');
        if (Object.hasOwn(s.picks, id)) throw new Error('Your pick is already locked in.');
        if (typeof a.entry !== 'string' || !s.entries.some(e => e.id === a.entry)) throw new Error('That answer is not in the bracket.');
        s.picks[id] = a.entry; api.sfx('lock');
        return;
      }
      case 'vote': {
        record(a, ['turn', 'k', 'side']);
        if (s.phase !== 'vote') throw new Error('Voting is closed.');
        const b = bout(s);
        if (authors(s, b).includes(id)) throw new Error('No voting in your own matchup!');
        if (Object.hasOwn(b.votes, id)) throw new Error('Your vote is already in.');
        b.votes[id] = integer(a.side, 0, 1) as 0 | 1; api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]);
    switch (s.phase) {
      case 'write': {
        if (online.length && online.every(id => written(s, id)) && t >= MIN_READ_MS) { api.say('host.everyone-in'); return endWrite(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); api.say(variant('host.timeup', api.random)); return endWrite(s, api); }
        if (!s.hurried && s.deadline - now <= 10_000 && s.deadline - s.at > 20_000) { s.hurried = true; api.sfx('tick-fast'); api.say(variant('host.hurry', api.random)); }
        return;
      }
      case 'twist':
        if (s.stage === 0 && t >= TWIST.reveal) { s.stage++; api.sfx('stamp'); api.speak(card(s).prompt); }
        if (now >= s.deadline) startPredict(s, api);
        return;
      case 'predict':
        if ((online.every(id => Object.hasOwn(s.picks, id)) && t >= MIN_READ_MS) || now >= s.deadline) startStage(s, api, 1);
        return;
      case 'stage':
        if (now >= s.deadline) startMatch(s, api, 0);
        return;
      case 'vote': {
        const b = bout(s), beats = showBeats(entry(s, b.sides[0]).text, entry(s, b.sides[1]).text);
        if (s.stage < 2 && t >= (s.stage ? beats.b : beats.a)) { api.sfx('pop'); api.speak(entry(s, b.sides[s.stage]!).text); s.stage++; }
        if ((t >= beats.open && voters(s).every(v => Object.hasOwn(b.votes, v))) || now >= s.deadline) decide(s, api);
        return;
      }
      case 'result': {
        const b = bout(s), beats = resultBeats(b.flip, s.round === s.rounds), steps = [beats.tally, beats.flip, beats.verdict, beats.advance];
        while (s.stage < steps.length && t >= steps[s.stage]!) { s.stage++; beat(s, api); }
        if (now < s.deadline) return;
        if (s.index + 1 < s.bouts[s.round - 1]!.length) return startMatch(s, api, s.index + 1);
        return s.round < s.rounds ? startStage(s, api, s.round + 1) : crown(s, api);
      }
      case 'champ': {
        const steps = [CHAMP.answer, CHAMP.author, CHAMP.oracles, CHAMP.unmask];
        while (s.stage < steps.length && t >= steps[s.stage]!) {
          s.stage++;
          if (s.stage === 1) api.sfx('reveal');
          if (s.stage === 2) api.sfx(entry(s, s.champ!.entry).by ? 'cheer' : 'laugh');
          if (s.stage === 3) api.sfx(s.champ!.oracles.length ? 'coin' : 'aww');
          if (s.stage === 4) api.sfx('sparkle');
        }
        if (now < s.deadline) return;
        if (s.bracket >= BRACKETS) { s.done = true; return; }
        go(s, api, 'scores', SCORES_MS); hold(s, api, api.say('host.scores'));
        return;
      }
      case 'scores':
        if (now >= s.deadline) startBracket(s, api);
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const c = card(s), crowned = s.phase === 'champ' || s.phase === 'scores', question = s.round ? judge(s) : undefined;
    const out = new Set(s.bouts.flat().filter(b => b.winner !== null).map(b => b.sides[1 - b.winner!]));
    const pub: BrawlPublic = {
      phase: s.phase, bracket: s.bracket, kind: c.kind, turn: s.turn, at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [],
      size: s.size, rounds: s.rounds, round: s.round,
      entries: s.entries.map(e => ({ id: e.id, text: e.text, ...(crowned || out.has(e.id) ? e.by ? { by: e.by } : { house: true as const } : {}) })),
      bouts: s.bouts.map(round => round.map(b => ({ sides: [...b.sides], ...(b.winner === null ? {} : { winner: b.winner, votes: [...b.counts], ...(b.flip ? { flip: true as const } : {}) }) }))),
    };
    if (c.kind !== 'blind' || s.phase !== 'write') pub.prompt = c.prompt;
    if (c.hint) pub.hint = c.hint;
    if (question) pub.judge = question;
    if (s.phase === 'write') pub.done = s.ids.filter(id => written(s, id));
    if (s.phase === 'predict') pub.done = s.ids.filter(id => Object.hasOwn(s.picks, id));
    if (s.phase === 'vote' || s.phase === 'result') pub.match = { index: s.index, votes: Object.keys(bout(s).votes).length };
    if (crowned) {
      const { entry: id, ...rest } = s.champ!, e = entry(s, id);
      pub.prev = { ...s.prev };
      pub.champ = { entry: id, ...(e.by ? { by: e.by } : { house: true as const }), ...rest, oracles: [...rest.oracles] };
    }
    return pub;
  },

  playerView(s, id) {
    const me: BrawlPrivate = {
      turn: s.turn, earned: s.earned[id] ?? 0, mine: s.entries.filter(e => e.by === id).map(e => e.id),
      answers: (s.answers[id] ?? []).map((text, slot) => ({ slot, ...(text !== null ? { text } : s.phase !== 'write' ? { house: true as const } : {}) })),
    };
    const pick = own(s.picks, id);
    if (pick) me.pick = pick;
    if (s.phase === 'vote' || s.phase === 'result') {
      const b = bout(s), vote = own(b.votes, id);
      me.role = authors(s, b).includes(id) ? 'author' : 'voter';
      if (vote !== undefined) me.vote = vote;
    }
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const top = Math.max(...s.ids.map(id => s.scores[id]!)), awards: { title: string; playerId: string }[] = [];
    /** Unique leader of a stat (ties broken by `then`), if they reached `min`. */
    const best = (title: string, rec: Record<string, number>, then?: Record<string, number>) => {
      const max = Math.max(...s.ids.map(id => rec[id]!));
      let who = s.ids.filter(id => rec[id] === max);
      if (then && who.length > 1) { const next = Math.max(...who.map(id => then[id]!)); who = who.filter(id => then[id] === next); }
      if (max >= 1 && who.length === 1) awards.push({ title, playerId: who[0]! });
    };
    best('Undefeated', s.stats.crowns, s.stats.wins);
    best('Oracle', s.stats.oracle);
    best('Crowd favourite', s.stats.votes);
    const headline = s.houseWins === BRACKETS ? 'The House swept every bracket. Shameful.' : s.houseWins > 1 ? 'The House won two brackets. Embarrassing.' : s.houseWins ? 'The House stole a bracket. Embarrassing.' : undefined;
    return { scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], ...(awards.length ? { awards } : {}), ...(headline ? { headline } : {}) };
  },
};
export default server;
