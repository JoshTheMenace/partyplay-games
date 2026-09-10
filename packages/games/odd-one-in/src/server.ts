import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import { prompts } from './content';
import type { Prompt } from './content';
import type { Action, Answer, Clue, Guest, Phase, PrivateView, PublicView, Settings } from './types';

export const durations = { answer: 25_000, discuss: 20_000, vote: 12_000, resolution: 10_000 } as const;
export type State = {
  gameId: string; players: Guest[]; settings: Settings; phase: Phase; round: number; clue: number;
  deadline: number; turnId: string; roleOrder: string[]; blufferId: string; deck: Prompt[]; cursor: number;
  prompt: Prompt; answers: Map<string, Answer>; votes: Map<string, string | null>;
  scores: Map<string, number>; pending: Map<string, number>; reveals: Clue[]; result: PublicView['result'];
};
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object.');
  return raw as Record<string, unknown>;
}
function exact(raw: Record<string, unknown>, keys: string[]) {
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('Unexpected field.');
}
function finite(now: number) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid clock.');
}
function parseAction(raw: unknown): Action {
  const value = record(raw);
  if (typeof value.turnId !== 'string' || !value.turnId.length || value.turnId.length > 200) throw new Error('Missing clue identifier.');
  if (value.type === 'answer') {
    exact(value, ['type', 'turnId', 'answer']);
    const answer = value.answer;
    if (typeof answer === 'number' && Number.isFinite(answer) && Number.isInteger(answer)) return { type: 'answer', turnId: value.turnId, answer };
    if (typeof answer === 'string' && answer.length <= 48 && answer.trim().length && ![...answer].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return { type: 'answer', turnId: value.turnId, answer: answer.trim() };
    throw new Error('Enter a number or a short, nonempty answer.');
  }
  if (value.type === 'vote') {
    exact(value, ['type', 'turnId', 'target']);
    if (value.target !== null && (typeof value.target !== 'string' || !value.target.length || value.target.length > 128)) throw new Error('Choose a guest or abstain.');
    return { type: 'vote', turnId: value.turnId, target: value.target as string | null };
  }
  throw new Error('Unknown action.');
}
function validateSettings(raw: unknown): Settings {
  const value = record(raw);
  exact(value, ['rounds']);
  const rounds = value.rounds === undefined ? 4 : value.rounds;
  if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 3 || rounds > 6) throw new Error('Choose 3–6 rounds.');
  return { rounds };
}
function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function setPhase(state: State, phase: Exclude<Phase, 'complete'>, now: number) {
  state.phase = phase;
  state.deadline = now + durations[phase];
  state.turnId = `${state.gameId}:${state.round}:${state.clue}:${phase}`;
}
function nextClue(state: State, now: number) {
  state.prompt = state.deck[state.cursor++];
  state.answers.clear();
  state.votes.clear();
  setPhase(state, 'answer', now);
}
function nextRound(state: State, now: number) {
  state.round++;
  state.clue = 1;
  state.blufferId = state.roleOrder[(state.round - 1) % state.roleOrder.length];
  state.reveals = [];
  state.result = null;
  state.pending.clear();
  nextClue(state, now);
}
function reveal(state: State, now: number) {
  state.reveals.push({ number: state.clue, question: state.prompt.question, answers: state.players.map(player => ({ playerId: player.id, answer: state.answers.get(player.id) ?? null })) });
  setPhase(state, 'discuss', now);
}
function points(state: State, id: string, amount: number) {
  state.pending.set(id, (state.pending.get(id) ?? 0) + amount);
}
function settleVote(state: State, now: number) {
  let accusations = 0;
  for (const [id, target] of state.votes) {
    if (target === state.blufferId) {
      accusations++;
      points(state, id, 100);
    }
  }
  const caught = accusations > state.players.length / 2;
  if (!caught) points(state, state.blufferId, 100);
  if (caught || state.clue === 3) {
    if (!caught) points(state, state.blufferId, 200);
    for (const [id, score] of state.pending) state.scores.set(id, state.scores.get(id)! + score);
    state.result = { caught, blufferId: state.blufferId, awards: state.players.map(p => ({ playerId: p.id, points: state.pending.get(p.id) ?? 0 })), attempts: state.clue, reason: caught ? 'caught' : 'escaped' };
    setPhase(state, 'resolution', now);
  } else {
    state.clue++;
    nextClue(state, now);
  }
}
function create(ctx: RoundContext, settings: Settings): State {
  finite(ctx.nowMs);
  if (!Number.isInteger(ctx.seed) || !ctx.roundId || ctx.roundId.length > 128) throw new Error('Invalid round context.');
  if (ctx.players.length < 4 || ctx.players.length > 10 || new Set(ctx.players.map(p => p.id)).size !== ctx.players.length || ctx.players.some(p => !p.id || p.id.length > 128)) throw new Error('Odd One In needs 4–10 distinct guests.');
  let seed = (ctx.seed >>> 0) || 0x9e3779b9;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const state: State = {
    gameId: ctx.roundId, players: ctx.players.map(({ id, name, color }) => ({ id, name, color })), settings: validateSettings(settings), phase: 'answer', round: 0, clue: 1,
    deadline: ctx.nowMs, turnId: '', roleOrder: shuffle(ctx.players.map(p => p.id), next), blufferId: '', deck: shuffle(prompts, next), cursor: 0,
    prompt: prompts[0], answers: new Map(), votes: new Map(), scores: new Map(ctx.players.map(p => [p.id, 0])), pending: new Map(), reveals: [], result: null,
  };
  nextRound(state, ctx.nowMs);
  return state;
}
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings, parseAction,
  parseInput(raw) { if (raw !== null) throw new Error('This game uses actions only.'); return null; },
  neutralInput: () => null, create,
  applyAction(state, playerId, raw, now) {
    finite(now);
    const action = parseAction(raw);
    if (!state.scores.has(playerId)) throw new Error('Only participating guests can act.');
    if (action.turnId !== state.turnId) throw new Error('That clue or phase has ended.');
    if (now >= state.deadline || state.phase === 'complete') throw new Error('Time is up.');
    if (action.type === 'answer') {
      if (state.phase !== 'answer') throw new Error('Answers are closed.');
      if (state.answers.has(playerId)) throw new Error('Your answer is already locked.');
      const { format } = state.prompt;
      if (format.kind === 'number' && (typeof action.answer !== 'number' || action.answer < format.min || action.answer > format.max)) throw new Error(`Use a whole number from ${format.min} to ${format.max}.`);
      if (format.kind === 'choice' && (typeof action.answer !== 'string' || !format.options.includes(action.answer))) throw new Error('Choose one of the listed answers.');
      if (format.kind === 'text' && typeof action.answer !== 'string') throw new Error('Enter a short answer.');
      state.answers.set(playerId, action.answer);
      if (state.answers.size === state.players.length) reveal(state, now);
    } else {
      if (state.phase !== 'vote') throw new Error('Voting is closed.');
      if (state.votes.has(playerId)) throw new Error('Your vote is already locked.');
      if (action.target === playerId) throw new Error('You cannot accuse yourself.');
      if (action.target !== null && !state.scores.has(action.target)) throw new Error('Choose a participating guest.');
      state.votes.set(playerId, action.target);
      if (state.votes.size === state.players.length) settleVote(state, now);
    }
  },
  tick(state, _inputs, _dt, now) {
    finite(now);
    // Each step consumes a phase. At most 10 phases per round; no unbounded catch-up.
    for (let step = 0; step < state.settings.rounds * 10 && state.phase !== 'complete' && now >= state.deadline; step++) {
      const at = state.deadline;
      if (state.phase === 'answer') reveal(state, at);
      else if (state.phase === 'discuss') setPhase(state, 'vote', at);
      else if (state.phase === 'vote') settleVote(state, at);
      else if (state.round < state.settings.rounds) nextRound(state, at);
      else { state.phase = 'complete'; state.turnId = `${state.gameId}:complete`; }
    }
  },
  onPresenceChange(_state, _playerId, _connected, _now) { /* Keep seat, secrets and deadlines unchanged. */ },
  publicView(state) {
    return {
      phase: state.phase, turnId: state.turnId, round: state.round, rounds: state.settings.rounds, clue: state.clue, deadline: state.deadline,
      category: state.prompt.category, format: state.prompt.format.kind === 'choice' ? { ...state.prompt.format, options: [...state.prompt.format.options] } : { ...state.prompt.format },
      players: state.players.map(p => ({ ...p, score: state.scores.get(p.id)! })), submitted: state.answers.size, voted: state.votes.size, majority: Math.floor(state.players.length / 2) + 1,
      reveals: state.reveals.map(clue => ({ ...clue, answers: clue.answers.map(a => ({ ...a })) })), result: state.result ? { ...state.result, awards: state.result.awards.map(a => ({ ...a })) } : null,
    };
  },
  playerView(state, playerId) {
    if (!state.scores.has(playerId)) return null;
    return { turnId: state.turnId, role: playerId === state.blufferId ? 'bluffer' : 'guest', question: playerId === state.blufferId ? null : state.prompt.question,
      answered: state.answers.has(playerId), answer: state.answers.get(playerId) ?? null, voted: state.votes.has(playerId), target: state.votes.get(playerId) ?? null };
  },
  outcome(state) {
    const rows = state.players.map(p => ({ playerId: p.id, score: state.scores.get(p.id)! }));
    const highest = Math.max(...rows.map(row => row.score));
    return { complete: state.phase === 'complete', winners: state.phase === 'complete' ? rows.filter(row => row.score === highest).map(row => row.playerId) : [],
      rows: rows.map(row => ({ ...row, rank: 1 + rows.filter(other => other.score > row.score).length })) };
  },
  dispose() {},
};
export default rules;
