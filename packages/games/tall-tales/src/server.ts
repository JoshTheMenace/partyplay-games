import type { GameRules, RoundContext } from '../../../party-contract/src/index';
import { FACTS } from './content.server';
import type { Fact } from './content.server';
import type { Action, Phase, PrivateView, PublicView, Settings } from './types';
export type State = {
  roundId: string; phase: Phase; index: number; deck: Fact[]; settings: Settings; rng: number; openedAt: number; deadline: number;
  players: PublicView['players']; lies: Record<string, string>; votes: Record<string, string>;
  options: { id: string; text: string; truth: boolean; authors: string[] }[];
};
const ROUNDS = 7;
const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', fourteen: '14' };
/** Conservative spelling normalization; semantic equivalents are explicitly curated in each fact's aliases. */
export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(a|an|the)\s+/, '').split(' ').map(word => words[word] ?? word).join('');
}
export function isTruth(fact: Fact, text: string): boolean { return [fact.answer, ...fact.aliases].some(answer => normalize(answer) === normalize(text)); }
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object.');
  return raw as Record<string, unknown>;
}
function exact(raw: Record<string, unknown>, keys: string[]) { if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('Unexpected field.'); }
function parseAction(raw: unknown): Action {
  const value = object(raw);
  if (typeof value.turnId !== 'string' || !value.turnId.length || value.turnId.length > 160) throw new Error('Missing or invalid specimen ID.');
  if (value.type === 'lie') {
    exact(value, ['type', 'turnId', 'text']);
    if (typeof value.text !== 'string' || value.text.length > 80 || !normalize(value.text) || /[\p{Cc}\p{Cf}]/u.test(value.text)) throw new Error('Write 1–80 characters without control characters.');
    const text = value.text.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (text.length > 80) throw new Error('Write at most 80 characters.');
    return { type: 'lie', turnId: value.turnId, text };
  }
  if (value.type === 'vote') {
    exact(value, ['type', 'turnId', 'optionId']);
    if (typeof value.optionId !== 'string' || !/^option-\d{1,2}$/.test(value.optionId)) throw new Error('Choose an available answer.');
    return { type: 'vote', turnId: value.turnId, optionId: value.optionId };
  }
  throw new Error('Unknown action.');
}
function validateSettings(raw: unknown): Settings {
  const value = object(raw); exact(value, ['pace']);
  if (value.pace !== undefined && value.pace !== 'standard' && value.pace !== 'relaxed') throw new Error('Choose standard or relaxed pace.');
  return { pace: value.pace === 'relaxed' ? 'relaxed' : 'standard' };
}
function random(state: State): number { state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0; return state.rng / 4294967296; }
function shuffle<T>(state: State, values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random(state) * (i + 1)); [result[i], result[j]] = [result[j]!, result[i]!]; }
  return result;
}
function duration(state: State, phase: Phase): number {
  const relaxed = state.settings.pace === 'relaxed';
  return (phase === 'writing' ? relaxed ? 50 : 45 : phase === 'voting' ? relaxed ? 30 : 25 : relaxed ? 18 : 15) * 1000;
}
function turnId(state: State): string { return `${state.roundId}:${state.index + 1}`; }
function multiplier(state: State): number { return state.index === ROUNDS - 1 ? 2 : 1; }
function open(state: State, phase: Phase, now: number) { state.phase = phase; state.openedAt = now; state.deadline = now + duration(state, phase); }
function create(ctx: RoundContext, rawSettings: Settings): State {
  if (ctx.players.length < 3 || ctx.players.length > 10 || new Set(ctx.players.map(p => p.id)).size !== ctx.players.length || ctx.players.some(p => !p.id) || !Number.isFinite(ctx.nowMs) || !Number.isInteger(ctx.seed)) throw new Error('Tall Tales needs 3–10 distinct players and valid time/seed.');
  const state: State = { roundId: ctx.roundId, phase: 'writing', index: 0, deck: [], settings: validateSettings(rawSettings), rng: ctx.seed >>> 0, openedAt: ctx.nowMs, deadline: 0,
    players: ctx.players.map(p => ({ ...p, score: 0, gain: 0, connected: true })), lies: Object.create(null), votes: Object.create(null), options: [] };
  // One question per source per game avoids adjacent facts teaching later answers.
  const seen = new Set<string>();
  state.deck = shuffle(state, FACTS).filter(fact => { if (seen.has(fact.sourceUrl)) return false; seen.add(fact.sourceUrl); return true; }).slice(0, ROUNDS);
  open(state, 'writing', ctx.nowMs); return state;
}
function collectOptions(state: State) {
  const fact = state.deck[state.index]!;
  const entries: State['options'] = [{ id: '', text: fact.answer, truth: true, authors: [] }];
  // Iterate the roster, not arrival order: duplicate presentation and ownership are deterministic.
  for (const player of state.players) {
    const text = state.lies[player.id]; if (!text) continue;
    const existing = entries.find(entry => normalize(entry.text) === normalize(text));
    if (existing) existing.authors.push(player.id);
    else entries.push({ id: '', text, truth: false, authors: [player.id] });
  }
  for (const text of fact.decoys) {
    if (!entries.some(entry => normalize(entry.text) === normalize(text))) entries.push({ id: '', text, truth: false, authors: [] });
  }
  state.options = shuffle(state, entries).map((entry, index) => ({ ...entry, id: `option-${index}` }));
}
function score(state: State) {
  for (const player of state.players) player.gain = 0;
  for (const voter of state.players) {
    const option = state.options.find(entry => entry.id === state.votes[voter.id]);
    if (!option) continue;
    if (option.truth) voter.gain += 500 * multiplier(state);
    else for (const author of option.authors) state.players.find(p => p.id === author)!.gain += 300 * multiplier(state);
  }
  for (const player of state.players) player.score += player.gain;
}
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings, parseAction,
  parseInput(raw) { if (raw !== null) throw new Error('Tall Tales has no continuous input.'); return null; },
  neutralInput: () => null, create,
  applyAction(state, playerId, raw, now) {
    const action = parseAction(raw);
    if (!state.players.some(p => p.id === playerId)) throw new Error('Only participating players can act.');
    if (!Number.isFinite(now) || now < state.openedAt || now >= state.deadline) throw new Error('This submission window is closed.');
    if (action.turnId !== turnId(state)) throw new Error('That specimen is no longer active.');
    if (action.type === 'lie') {
      if (state.phase !== 'writing') throw new Error('Writing has ended.');
      if (state.lies[playerId] !== undefined) throw new Error('Your lie is already filed.');
      if (isTruth(state.deck[state.index]!, action.text)) throw new Error('That matches the truth. Invent a different answer before time runs out.');
      state.lies[playerId] = action.text;
    } else {
      if (state.phase !== 'voting') throw new Error('Voting is not open.');
      if (state.votes[playerId] !== undefined) throw new Error('Your vote is already filed.');
      const option = state.options.find(entry => entry.id === action.optionId);
      if (!option) throw new Error('Choose an available answer.');
      if (option.authors.includes(playerId)) throw new Error('You cannot vote for your own lie, including a shared lie.');
      state.votes[playerId] = option.id;
    }
  },
  tick(state, _inputs, _dt, now) {
    if (!Number.isFinite(now) || state.phase === 'complete' || now < state.deadline) return;
    // One transition per tick: a delayed server cannot skip an unseen writing/voting window.
    if (state.phase === 'writing') { collectOptions(state); open(state, 'voting', now); }
    else if (state.phase === 'voting') { score(state); open(state, 'reveal', now); }
    else if (state.index === ROUNDS - 1) { state.phase = 'complete'; state.deadline = now; }
    else { state.index++; state.lies = Object.create(null); state.votes = Object.create(null); state.options = []; state.players.forEach(p => { p.gain = 0; }); open(state, 'writing', now); }
  },
  onPresenceChange(state, playerId, connected) { const player = state.players.find(p => p.id === playerId); if (player) player.connected = connected; },
  publicView(state) {
    const fact = state.deck[state.index]!;
    const revealed = state.phase === 'reveal' || state.phase === 'complete';
    return { phase: state.phase, turnId: turnId(state), round: state.index + 1, totalRounds: ROUNDS, multiplier: multiplier(state), deadline: state.deadline,
      prompt: fact.prompt, category: fact.category, submitted: Object.keys(state.lies).length, voted: Object.keys(state.votes).length,
      players: state.players.map(p => ({ ...p })), options: state.options.map(({ id, text }) => ({ id, text })),
      reveal: revealed ? { answer: fact.answer, explanation: fact.explanation, sourceUrl: fact.sourceUrl,
        options: state.options.map(option => ({ ...option, authors: [...option.authors], voters: state.players.filter(p => state.votes[p.id] === option.id).map(p => p.id) })) } : null };
  },
  playerView(state, playerId) {
    if (!state.players.some(p => p.id === playerId)) return null;
    return { lie: state.lies[playerId] ?? null, votedOptionId: state.votes[playerId] ?? null, ownOptionIds: state.options.filter(o => o.authors.includes(playerId)).map(o => o.id) };
  },
  outcome(state) {
    const sorted = [...state.players].sort((a, b) => b.score - a.score || state.players.indexOf(a) - state.players.indexOf(b));
    return { complete: state.phase === 'complete', winners: state.phase === 'complete' ? sorted.filter(p => p.score === sorted[0]!.score).map(p => p.id) : [],
      rows: sorted.map(p => ({ playerId: p.id, score: p.score, rank: 1 + sorted.filter(other => other.score > p.score).length, label: `${p.score} points` })) };
  },
  dispose() {},
};
export default rules;
