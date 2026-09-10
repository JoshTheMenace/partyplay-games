import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import type { Action, Phase, PrivateView, PublicView, Reveal, Settings } from './types';
import { prompts } from './content';

type Entry = { id: string; author: string; prompt: string; draft: string; answer: string | null };
type Match = { entries: [Entry, Entry]; votes: Record<string, 0 | 1>; reveal: Reveal | null };
export type State = {
  roundId: string; players: { id: string; name: string; color: string; connected: boolean; score: number }[];
  settings: Settings; seed: number; deck: string[]; round: number; phase: Phase; turnId: string;
  startedAt: number; deadline: number; entries: Entry[]; matches: Match[]; matchIndex: number;
};
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object.');
  return raw as Record<string, unknown>;
}
function keys(raw: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('Unknown field.');
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Expected a whole number from ${min} to ${max}.`);
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 200) throw new Error('Invalid turn or question.');
  return value;
}
function shuffle<T>(state: { seed: number }, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state.seed / 4294967296 * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
/** A closed cycle has two incident edges per seat, including odd rosters. */
export function cyclicPairs(ids: readonly string[]): [string, string][] {
  return ids.map((player, i) => [player, ids[(i + 1) % ids.length]!]);
}
function startWriting(state: State, now: number) {
  state.phase = 'writing';
  state.startedAt = now;
  state.turnId = `${state.roundId}:write:${state.round}`;
  state.deadline = now + state.settings.writingSeconds * 1000;
  state.entries = [];
  state.matchIndex = 0;
  const pairs = cyclicPairs(shuffle(state, state.players.map(player => player.id)));
  const finalPrompt = state.round === 3 ? state.deck.pop()! : '';
  function entry(author: string, prompt: string): Entry {
    const item: Entry = { id: `${state.turnId}:q${state.entries.length}`, author, prompt, draft: '', answer: null };
    state.entries.push(item);
    return item;
  }
  state.matches = shuffle(state, pairs.map(pair => {
    const prompt = finalPrompt || state.deck.pop()!;
    const entries = shuffle(state, pair.map(author => entry(author, prompt))) as [Entry, Entry];
    return { entries, votes: Object.create(null) as Record<string, 0 | 1>, reveal: null };
  }));
}
function reveal(state: State, now: number) {
  const match = state.matches[state.matchIndex]!;
  if (match.reveal) return;
  const votes: [string[], string[]] = [[], []];
  for (const [player, choice] of Object.entries(match.votes)) votes[choice].push(player);
  const missing = match.entries.some(entry => entry.answer === null);
  const total = votes[0].length + votes[1].length;
  const winner = missing || votes[0].length === votes[1].length ? null : votes[0].length > votes[1].length ? 0 : 1;
  const points: [number, number] = [0, 1].map(side => missing ? 0 : (votes[side]!.length * 100 + (winner === side ? 200 : 0)) * state.round) as [number, number];
  match.reveal = { authors: [match.entries[0].author, match.entries[1].author], votes, points, winner,
    result: missing ? 'missing' : !total ? 'no-votes' : winner === null ? 'tie' : 'winner' };
  match.entries.forEach((entry, side) => { state.players.find(player => player.id === entry.author)!.score += points[side]!; });
  state.phase = 'reveal';
  state.startedAt = now;
  state.deadline = now + state.settings.revealSeconds * 1000;
}
function startMatch(state: State, now: number) {
  state.phase = 'voting';
  state.startedAt = now;
  state.turnId = `${state.roundId}:vote:${state.round}:${state.matchIndex}`;
  const seconds = state.settings.votingSeconds || Math.max(8, Math.min(25, Math.round(80 / state.players.length)));
  state.deadline = now + seconds * 1000;
  if (state.matches[state.matchIndex]!.entries.some(entry => entry.answer === null)) reveal(state, now);
}
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) {
    const value = object(raw); keys(value, ['writingSeconds', 'votingSeconds', 'revealSeconds']);
    return { writingSeconds: integer(value.writingSeconds ?? 100, 30, 150),
      votingSeconds: value.votingSeconds === undefined || value.votingSeconds === 0 ? 0 : integer(value.votingSeconds, 8, 30),
      revealSeconds: integer(value.revealSeconds ?? 6, 4, 12) };
  },
  parseInput(raw) { if (raw !== null) throw new Error('Quip Clash uses actions only.'); return null; },
  neutralInput() { return null; },
  parseAction(raw) {
    const value = object(raw);
    const turnId = id(value.turnId);
    if (value.type === 'vote') {
      keys(value, ['type', 'turnId', 'choice']);
      return { type: 'vote', turnId, choice: integer(value.choice, 0, 1) as 0 | 1 };
    }
    if (value.type !== 'draft' && value.type !== 'answer') throw new Error('Unknown action.');
    keys(value, ['type', 'turnId', 'questionId', 'text']);
    if (typeof value.text !== 'string' || value.text.length > 160 || [...value.text].some(char => char.charCodeAt(0) === 127 || char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t')) throw new Error('Use at most 160 printable characters.');
    const text = value.text.trim();
    if (value.type === 'answer' && !text) throw new Error('Write an answer before submitting.');
    return { type: value.type, turnId, questionId: id(value.questionId), text };
  },
  create(ctx: RoundContext, settings) {
    if (ctx.players.length < 3 || ctx.players.length > 10 || new Set(ctx.players.map(player => player.id)).size !== ctx.players.length || ctx.players.some(player => !player.id)) throw new Error('Quip Clash needs 3–10 unique players.');
    if (!Number.isFinite(ctx.nowMs) || !Number.isInteger(ctx.seed)) throw new Error('Invalid clock or seed.');
    const state: State = { roundId: ctx.roundId, players: ctx.players.map(player => ({ ...player, score: 0, connected: true })),
      settings: rules.validateSettings(settings), seed: ctx.seed >>> 0, deck: [], round: 1, phase: 'writing', turnId: '', startedAt: ctx.nowMs, deadline: 0, entries: [], matches: [], matchIndex: 0 };
    state.deck = shuffle(state, prompts); startWriting(state, ctx.nowMs); return state;
  },
  applyAction(state, playerId, raw, now) {
    const action = rules.parseAction(raw);
    if (!state.players.some(player => player.id === playerId)) throw new Error('Only participants can act.');
    if (!Number.isFinite(now) || now < state.startedAt || now >= state.deadline || action.turnId !== state.turnId) throw new Error('That turn has ended.');
    if (action.type === 'vote') {
      if (state.phase !== 'voting') throw new Error('Voting is closed.');
      const match = state.matches[state.matchIndex]!;
      if (match.entries.some(entry => entry.author === playerId)) throw new Error('Authors cannot vote in their own matchup.');
      if (Object.hasOwn(match.votes, playerId)) throw new Error('Your vote is already locked.');
      match.votes[playerId] = action.choice;
    } else {
      if (state.phase !== 'writing') throw new Error('Writing is closed.');
      const entry = state.entries.find(item => item.id === action.questionId && item.author === playerId);
      if (!entry) throw new Error('That prompt is not yours.');
      if (entry.answer !== null) throw new Error('Your answer is already locked.');
      if (action.type === 'answer' && state.round === 3 && state.entries.some(other => other.author === playerId && other.answer?.toLowerCase() === action.text.toLowerCase())) throw new Error('Write a different punchline for your second finale answer.');
      if (action.type === 'draft') entry.draft = action.text;
      else { entry.answer = action.text; entry.draft = ''; }
    }
  },
  tick(state, _inputs, _dt, now) {
    if (!Number.isFinite(now) || now < state.startedAt || state.phase === 'results') return;
    if (state.phase === 'writing' && (now >= state.deadline || state.entries.every(entry => entry.answer !== null))) startMatch(state, now);
    else if (state.phase === 'voting' && (now >= state.deadline || now - state.startedAt >= 3500 && Object.keys(state.matches[state.matchIndex]!.votes).length === state.players.length - 2)) reveal(state, now);
    else if (now >= state.deadline && state.phase === 'reveal') {
      if (++state.matchIndex < state.matches.length) startMatch(state, now);
      else if (state.round < 3) { state.round++; startWriting(state, now); }
      else { state.phase = 'results'; state.turnId = `${state.roundId}:results`; state.deadline = now; }
    }
  },
  onPresenceChange(state, playerId, connected) { const player = state.players.find(item => item.id === playerId); if (player) player.connected = connected; },
  publicView(state) {
    const match = state.matches[state.matchIndex];
    return { phase: state.phase, round: state.round, turnId: state.turnId, deadline: state.deadline, multiplier: state.round,
      players: state.players.map(player => ({ ...player })), submitted: state.entries.filter(entry => entry.answer !== null).length,
      expected: state.entries.length, matchNumber: Math.min(state.matchIndex + 1, state.matches.length), matchCount: state.matches.length,
      matchup: match && (state.phase === 'voting' || state.phase === 'reveal') ? { prompt: match.entries[0].prompt,
        answers: [match.entries[0].answer, match.entries[1].answer], reveal: match.reveal ? { ...match.reveal,
          authors: [...match.reveal.authors], votes: [[...match.reveal.votes[0]], [...match.reveal.votes[1]]], points: [...match.reveal.points] } : null } : null };
  },
  playerView(state, playerId) {
    const match = state.matches[state.matchIndex];
    const isAuthor = !!match?.entries.some(entry => entry.author === playerId);
    const participant = state.players.some(player => player.id === playerId);
    return { questions: state.phase === 'writing' ? state.entries.filter(entry => entry.author === playerId).map(entry => ({ id: entry.id, prompt: entry.prompt, draft: entry.draft, answer: entry.answer })) : [],
      canVote: participant && state.phase === 'voting' && !isAuthor && !Object.hasOwn(match!.votes, playerId),
      voted: participant && state.phase !== 'writing' ? match?.votes[playerId] ?? null : null,
      isAuthor: participant && state.phase !== 'writing' && isAuthor };
  },
  outcome(state) {
    const players = [...state.players].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const complete = state.phase === 'results';
    return { complete, winners: complete ? players.filter(player => player.score === players[0]!.score).map(player => player.id) : [],
      rows: players.map(player => ({ playerId: player.id, score: player.score, rank: 1 + players.filter(other => other.score > player.score).length })) };
  },
  dispose() {},
};
export default rules;
