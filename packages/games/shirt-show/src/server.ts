import { parseDrawing } from '../../../party-contract/src/index';
import type { Drawing, GameRules, RoundContext } from '../../../party-contract/src/index';
import { artStarters, fallbackSlogans, sloganStarters } from './content';
import type { Action, Art, Design, MatchResult, Phase, PrivateView, PublicView, Selection, Settings, Shirt, Slogan } from './model';

type Work = { revision: number; committed: boolean; drawing: Drawing; text: string; selection: Selection | null };
type Seat = { id: string; name: string; connected: boolean; score: number; work: Work; art: string[]; slogans: string[]; starters: string[] };
type Match = { id: string; stage: number; entries: [string, string]; votes: { playerId: string; designId: string }[]; cheers: string[] };
export type State = {
  roundId: string; rng: number; settings: Settings; phase: Phase; slot: number; serial: number; turnId: string; deadline: number;
  players: Seat[]; art: Art[]; slogans: Slogan[]; designs: Design[]; history: MatchResult[];
  queue: string[][]; advancing: string[]; stage: number; match: Match | null; champion: string | null;
};
const emptyWork = (): Work => ({ revision: 0, committed: false, drawing: { strokes: [] }, text: '', selection: null });
function fail(message: string): never { throw new Error(message); }
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Expected an object.');
  return raw as Record<string, unknown>;
}
function keys(raw: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(raw).some(key => !allowed.includes(key))) fail('Unexpected action or setting field.');
}
function text(raw: unknown, max: number, blank = false): string {
  if (typeof raw !== 'string' || raw.length > max || [...raw].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fail('Text is invalid or too long.');
  const value = raw.trim();
  if (!blank && !value) fail('Enter some text first.');
  return value;
}
function selection(raw: unknown): Selection {
  const value = object(raw);
  keys(value, ['artId', 'sloganId', 'color']);
  if (!['cream', 'coral', 'sky', 'lime'].includes(value.color as string)) fail('Choose a valid shirt color.');
  return { artId: text(value.artId, 80), sloganId: text(value.sloganId, 80), color: value.color as Selection['color'] };
}
function parseAction(raw: unknown): Action {
  const value = object(raw), turnId = text(value.turnId, 256);
  if (value.type === 'cheer') { keys(value, ['type', 'turnId']); return { type: 'cheer', turnId }; }
  if (value.type === 'vote') { keys(value, ['type', 'turnId', 'designId']); return { type: 'vote', turnId, designId: text(value.designId, 80) }; }
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1 || (value.revision as number) > 10000 || typeof value.commit !== 'boolean') fail('Invalid draft revision or submission.');
  const base = { turnId, revision: value.revision as number, commit: value.commit };
  if (value.type === 'drawing') {
    keys(value, ['type', 'turnId', 'revision', 'commit', 'drawing']);
    const drawing = parseDrawing(value.drawing);
    if (value.commit && !drawing.strokes.length) fail('Draw something before submitting.');
    return { type: 'drawing', ...base, drawing };
  }
  if (value.type === 'slogan') {
    keys(value, ['type', 'turnId', 'revision', 'commit', 'text']);
    return { type: 'slogan', ...base, text: text(value.text, 72, !value.commit) };
  }
  if (value.type === 'design') {
    keys(value, ['type', 'turnId', 'revision', 'commit', 'selection']);
    return { type: 'design', ...base, selection: selection(value.selection) };
  }
  return fail('Unknown Shirt Show action.');
}
function random(state: State) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}
function shuffle<T>(state: State, values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function seat(state: State, id: string) { return state.players.find(player => player.id === id) ?? fail('This seat is not in the round.'); }
function design(state: State, id: string) { return state.designs.find(entry => entry.id === id) ?? fail('Unknown shirt.'); }
function shirt(state: State, entry: Design): Shirt {
  return { ...entry, art: state.art.find(art => art.id === entry.artId)!, slogan: state.slogans.find(slogan => slogan.id === entry.sloganId)! };
}
function duration(state: State, phase: Phase) {
  const seconds = phase === 'draw' || phase === 'design' ? 120 : phase === 'slogan' ? 60 : phase === 'reveal' ? 20 : phase === 'match-result' ? 8 : phase === 'vote' ? Math.max(20, Math.min(60, Math.floor(180 / (state.players.length - 1)))) : 0;
  return seconds * 1000 * (state.settings.pace === 'quick' ? 0.5 : 1);
}
function enter(state: State, phase: Phase, nowMs: number) {
  state.phase = phase;
  state.turnId = `${state.roundId}:shirt-show:${++state.serial}`;
  state.deadline = nowMs + duration(state, phase);
  if (phase === 'draw' || phase === 'slogan' || phase === 'design') {
    for (const player of state.players) {
      player.work = emptyWork();
      player.starters = phase === 'design' ? [] : shuffle(state, phase === 'draw' ? artStarters : sloganStarters).slice(0, 3);
    }
  }
}
function studioArt(index: number): Drawing {
  const offset = (index % 4) * 0.035;
  return { strokes: [
    { color: '#ff5748', width: 0.02, points: [{ x: 0.2, y: 0.68 }, { x: 0.28, y: 0.28 + offset }, { x: 0.7, y: 0.3 }, { x: 0.8, y: 0.72 }, { x: 0.2, y: 0.68 }] },
    { color: '#05071a', width: 0.016, points: [{ x: 0.36, y: 0.52 }, { x: 0.45, y: 0.58 }, { x: 0.63, y: 0.49 }] },
  ] };
}
function finishContributions(state: State, nowMs: number) {
  state.players.forEach((player, index) => {
    if (state.phase === 'draw') {
      const fallback = !player.work.drawing.strokes.length;
      state.art.push({ id: `art-${state.slot}-${index}`, owner: fallback ? null : player.id, fallback, drawing: fallback ? studioArt(index + state.slot) : player.work.drawing });
    } else {
      const fallback = !player.work.text;
      state.slogans.push({ id: `slogan-${state.slot}-${index}`, owner: fallback ? null : player.id, fallback, text: fallback ? fallbackSlogans[(index + state.slot) % fallbackSlogans.length] : player.work.text });
    }
  });
  if (state.slot === 0) { state.slot = 1; enter(state, state.phase, nowMs); }
  else if (state.phase === 'draw') { state.slot = 0; enter(state, 'slogan', nowMs); }
  else {
    // A seeded ring routes every contribution once; both source seats differ from the designer.
    const order = shuffle(state, state.players.map((_, index) => index));
    order.forEach((index, position) => {
      const next = order[(position + 1) % order.length], other = order[(position + 2) % order.length];
      state.players[index].art = [`art-0-${next}`, `art-1-${other}`];
      state.players[index].slogans = [`slogan-0-${other}`, `slogan-1-${next}`];
    });
    enter(state, 'design', nowMs);
  }
}
function finishDesigns(state: State, nowMs: number) {
  const priority = shuffle(state, state.players.map(player => player.id));
  state.designs = state.players.map((player, index) => ({
    ...(player.work.selection ?? { artId: player.art[0], sloganId: player.slogans[0], color: 'cream' as const }),
    id: `shirt-${index}`, designer: player.id, automatic: !player.work.committed, priority: priority.indexOf(player.id) + 1,
  }));
  enter(state, 'reveal', nowMs);
}
function startBracket(state: State, nowMs: number) {
  const entries = shuffle(state, state.designs.map(entry => entry.id));
  const nextPower = 2 ** Math.ceil(Math.log2(entries.length));
  const contests = entries.length - nextPower / 2;
  state.stage = 1;
  state.queue = Array.from({ length: contests }, (_, i) => entries.slice(i * 2, i * 2 + 2));
  state.advancing = entries.slice(contests * 2);
  state.history.push(...state.advancing.map(id => ({ id: `bye-${id}`, stage: 1, entries: [id], votes: [0], winner: id, policy: 'bye' as const, cheers: 0 })));
  nextMatch(state, nowMs);
}
function nextMatch(state: State, nowMs: number) {
  if (!state.queue.length) {
    if (state.advancing.length === 1) {
      state.champion = state.advancing[0];
      seat(state, design(state, state.champion).designer).score += 300;
      state.match = null;
      enter(state, 'gallery', nowMs);
      return;
    }
    state.stage++;
    state.queue = Array.from({ length: state.advancing.length / 2 }, (_, i) => state.advancing.slice(i * 2, i * 2 + 2));
    state.advancing = [];
  }
  enter(state, 'vote', nowMs);
  state.match = { id: state.turnId, stage: state.stage, entries: state.queue.shift() as [string, string], votes: [], cheers: [] };
}
function eligible(state: State, id: string) {
  return !!state.match && !state.match.entries.some(entry => design(state, entry).designer === id);
}
function finishVote(state: State, nowMs: number) {
  const match = state.match!;
  const votes = match.entries.map(id => match.votes.filter(vote => vote.designId === id).length);
  const tied = votes[0] === votes[1];
  const winner = tied ? [...match.entries].sort((a, b) => design(state, a).priority - design(state, b).priority)[0] : match.entries[votes[0] > votes[1] ? 0 : 1];
  state.history.push({ id: match.id, stage: match.stage, entries: [...match.entries], votes, winner, policy: tied ? 'tie-priority' : 'majority', cheers: match.cheers.length });
  state.advancing.push(winner);
  seat(state, design(state, winner).designer).score += 100;
  enter(state, 'match-result', nowMs);
}
function advance(state: State, nowMs: number) {
  if (state.phase === 'draw' || state.phase === 'slogan') finishContributions(state, nowMs);
  else if (state.phase === 'design') finishDesigns(state, nowMs);
  else if (state.phase === 'reveal') startBracket(state, nowMs);
  else if (state.phase === 'vote') finishVote(state, nowMs);
  else if (state.phase === 'match-result') nextMatch(state, nowMs);
}
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) {
    const value = object(raw); keys(value, ['pace']);
    if (value.pace !== undefined && value.pace !== 'standard' && value.pace !== 'quick') fail('Choose standard or quick pace.');
    return { pace: value.pace === 'quick' ? 'quick' : 'standard' };
  },
  parseInput(raw) { if (raw !== null) fail('Shirt Show only accepts discrete actions.'); return null; },
  neutralInput: () => null,
  parseAction,
  create(ctx: RoundContext, settings) {
    if (ctx.players.length < 3 || ctx.players.length > 10 || new Set(ctx.players.map(player => player.id)).size !== ctx.players.length || ctx.players.some(player => !player.id || typeof player.id !== 'string') || !Number.isFinite(ctx.seed) || !Number.isFinite(ctx.nowMs)) fail('Shirt Show needs 3–10 distinct players and a valid clock/seed.');
    const state: State = {
      roundId: ctx.roundId, rng: ctx.seed >>> 0, settings: rules.validateSettings(settings), phase: 'draw', slot: 0, serial: 0, turnId: '', deadline: ctx.nowMs,
      players: ctx.players.map(player => ({ id: player.id, name: player.name, connected: true, score: 0, work: emptyWork(), art: [], slogans: [], starters: [] })),
      art: [], slogans: [], designs: [], history: [], queue: [], advancing: [], stage: 0, match: null, champion: null,
    };
    enter(state, 'draw', ctx.nowMs); return state;
  },
  applyAction(state, playerId, raw, nowMs) {
    const action = parseAction(raw), player = seat(state, playerId);
    if (!Number.isFinite(nowMs) || nowMs >= state.deadline || nowMs < state.deadline - duration(state, state.phase) || action.turnId !== state.turnId || state.phase === 'gallery') fail('This task has closed. Follow the current screen.');
    if (action.type === 'vote' || action.type === 'cheer') {
      if (state.phase !== 'vote' || !state.match) fail('Voting is not open.');
      if (action.type === 'cheer') {
        if (state.match.cheers.includes(playerId)) fail('You already cheered.');
        state.match.cheers.push(playerId); return;
      }
      if (!eligible(state, playerId)) fail('Designers sit out votes involving their own shirt. You can cheer instead.');
      if (state.match.votes.some(vote => vote.playerId === playerId)) fail('Your vote is already locked.');
      if (!state.match.entries.includes(action.designId)) fail('Vote for a shirt in this matchup.');
      state.match.votes.push({ playerId, designId: action.designId });
      if (state.match.votes.length === state.players.length - 2) finishVote(state, nowMs);
      return;
    }
    if ((action.type === 'drawing' ? 'draw' : action.type) !== state.phase) fail('That action belongs to another task.');
    if (player.work.committed) fail('Your submission is already locked.');
    if (action.revision <= player.work.revision) fail('This draft was already saved or superseded.');
    if (action.type === 'design' && (!player.art.includes(action.selection.artId) || !player.slogans.includes(action.selection.sloganId))) fail('Use one drawing and one slogan from your assigned tray.');
    player.work.revision = action.revision;
    player.work.committed = action.commit;
    if (action.type === 'drawing') player.work.drawing = action.drawing;
    if (action.type === 'slogan') player.work.text = action.text;
    if (action.type === 'design') player.work.selection = action.selection;
    if (state.players.every(entry => entry.work.committed)) advance(state, nowMs);
  },
  tick(state, _inputs, dtSeconds, nowMs) {
    if (!Number.isFinite(dtSeconds) || dtSeconds < 0 || !Number.isFinite(nowMs)) fail('Invalid clock.');
    if (state.phase !== 'gallery' && nowMs >= state.deadline) advance(state, nowMs);
  },
  onPresenceChange(state, playerId, connected) { seat(state, playerId).connected = connected; },
  publicView(state) {
    const revealed = ['reveal', 'vote', 'match-result', 'gallery'].includes(state.phase);
    const match = state.match;
    return structuredClone({
      phase: state.phase, turnId: state.turnId, deadline: state.deadline, slot: state.slot, pace: state.settings.pace,
      players: state.players.map(({ id, name, connected, score }) => ({ id, name, connected, score })),
      submitted: state.players.filter(player => player.work.committed).length, total: state.players.length,
      shirts: revealed ? state.designs.map(entry => shirt(state, entry)) : [],
      match: match ? { id: match.id, stage: match.stage, entries: [...match.entries], tiePriority: [...match.entries].sort((a, b) => design(state, a).priority - design(state, b).priority)[0], voted: match.votes.length, eligible: state.players.length - 2, cheers: match.cheers.length } : null,
      history: state.history, champion: state.champion,
      gallery: state.phase === 'gallery' ? { art: state.art, slogans: state.slogans } : null,
    });
  },
  playerView(state, playerId) {
    const player = seat(state, playerId);
    return structuredClone({
      submitted: player.work.committed, revision: player.work.revision, drawing: player.work.drawing, slogan: player.work.text, selection: player.work.selection,
      art: state.phase === 'design' ? state.art.filter(art => player.art.includes(art.id)) : [],
      slogans: state.phase === 'design' ? state.slogans.filter(slogan => player.slogans.includes(slogan.id)) : [],
      starters: state.phase === 'draw' || state.phase === 'slogan' ? player.starters : [],
      canVote: state.phase === 'vote' && eligible(state, playerId),
      voted: !!state.match?.votes.some(vote => vote.playerId === playerId), cheered: !!state.match?.cheers.includes(playerId),
    });
  },
  outcome(state) {
    const ordered = [...state.players].sort((a, b) => b.score - a.score);
    return { complete: state.phase === 'gallery', winners: state.champion ? [design(state, state.champion).designer] : [], rows: ordered.map(player => ({ playerId: player.id, score: player.score, rank: 1 + ordered.filter(other => other.score > player.score).length, label: state.champion && design(state, state.champion).designer === player.id ? 'Champion designer' : 'Designer' })) };
  },
  dispose() {},
};
export default rules;
