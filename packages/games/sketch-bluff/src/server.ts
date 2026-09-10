import { parseDrawing } from '../../../party-contract/src/index';
import type { Drawing, GameRules, RoundContext } from '../../../party-contract/src/index';
import { prompts, houseCaptions } from './content';
import type { Action, Choice, Phase, PrivateView, PublicView, Settings } from './types';
export type { Action, PrivateView, PublicView, Settings } from './types';

type Seat = RoundContext['players'][number] & { score: number; connected: boolean };
type Art = { artistId: string; prompt: string; draft: Drawing | null; drawing: Drawing | null; submitted: boolean };
type SecretChoice = Choice & { truth: boolean; authors: string[] };
export type State = {
  players: Seat[]; settings: Settings; roundId: string; seed: number; promptDeck: string[];
  phase: Phase; turnId: string; deadline: number; gallery: number; galleries: number;
  art: Art[]; exhibits: Art[]; exhibit: number; captions: Record<string, string>; votes: Record<string, string>;
  choices: SecretChoice[]; gains: Record<string, number>; skipped: number;
};
const own = (value: object, key: string) => Object.hasOwn(value, key);
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object.');
  return raw as Record<string, unknown>;
}
function exact(raw: Record<string, unknown>, keys: string[]) {
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('Unexpected field.');
}
function text(raw: unknown, max: number) {
  if (typeof raw !== 'string' || raw.length > max || !raw.trim()) throw new Error('Use plain text within the length limit.');
  const cleaned = raw.trim().replace(/\s+/gu, ' ');
  for (const char of cleaned) {
    const code = char.codePointAt(0)!;
    if (code < 32 || code === 127 || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x206f)) throw new Error('Use visible plain text.');
  }
  return cleaned;
}
export const normalizeCaption = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
function random(state: State) {
  state.seed = (Math.imul(1664525, state.seed) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
function shuffle<T>(state: State, values: readonly T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random(state) * (i + 1)); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; }
  return copy;
}
const currentArt = (state: State) => state.exhibits[state.exhibit];
const eligible = (state: State) => state.players.filter(player => player.id !== currentArt(state)?.artistId);
function phase(state: State, next: Phase, now: number, duration: number) {
  state.phase = next;
  state.turnId = `${state.roundId}:${state.gallery}:${state.exhibit}:${next}`;
  state.deadline = now + duration * 1000;
}
function startGallery(state: State, now: number) {
  state.art = state.players.map(player => ({ artistId: player.id, prompt: state.promptDeck.pop()!, draft: null, drawing: null, submitted: false }));
  state.exhibits = []; state.exhibit = 0; state.choices = []; state.captions = {}; state.votes = {}; state.gains = {};
  phase(state, 'drawing', now, state.settings.drawingSeconds);
}
function startExhibit(state: State, now: number) {
  state.captions = {}; state.votes = {}; state.choices = []; state.gains = {};
  phase(state, 'caption', now, state.settings.captionSeconds);
}
function finishGallery(state: State, now: number) {
  if (state.gallery < state.galleries) { state.gallery++; startGallery(state, now); }
  else phase(state, 'results', now, 0);
}
function buildChoices(state: State, now: number) {
  const answer = normalizeCaption(currentArt(state)!.prompt);
  const choices: SecretChoice[] = [{ id: '', text: answer, truth: true, authors: [] }];
  for (const player of eligible(state)) {
    const caption = state.captions[player.id];
    if (!caption) continue;
    const key = normalizeCaption(caption);
    const existing = choices.find(choice => choice.text === key);
    if (existing) existing.authors.push(player.id);
    else choices.push({ id: '', text: key, truth: false, authors: [player.id] });
  }
  for (const caption of shuffle(state, houseCaptions)) {
    if (choices.length >= 3) break;
    if (!choices.some(choice => choice.text === caption)) choices.push({ id: '', text: caption, truth: false, authors: [] });
  }
  state.choices = shuffle(state, choices).map((choice, index) => ({ ...choice, id: `choice-${index + 1}` }));
  phase(state, 'vote', now, state.settings.voteSeconds);
}
function reveal(state: State, now: number) {
  state.gains = Object.fromEntries(state.players.map(player => [player.id, 0]));
  for (const player of eligible(state)) {
    const choice = state.choices.find(item => item.id === state.votes[player.id]);
    if (!choice) continue;
    if (choice.truth) { state.gains[player.id]! += 1000; state.gains[currentArt(state)!.artistId]! += 250; }
    else for (const author of choice.authors) if (author !== player.id) state.gains[author]! += 500;
  }
  for (const player of state.players) player.score += state.gains[player.id]!;
  phase(state, 'reveal', now, state.settings.length === 'short' ? 8 : 12);
}
function advance(state: State, now: number) {
  switch (state.phase) {
    case 'drawing':
      state.exhibits = shuffle(state, state.art.filter(art => art.submitted && art.drawing?.strokes.length));
      state.skipped += state.art.length - state.exhibits.length;
      if (state.exhibits.length) startExhibit(state, now); else finishGallery(state, now);
      break;
    case 'caption': buildChoices(state, now); break;
    case 'vote': reveal(state, now); break;
    case 'reveal':
      state.exhibit++;
      if (state.exhibit < state.exhibits.length) startExhibit(state, now); else finishGallery(state, now);
      break;
    case 'results': break;
  }
}
function maybeAdvance(state: State, now: number) {
  if (state.phase === 'drawing' && state.art.every(art => art.submitted)) advance(state, now);
  else if (state.phase === 'caption' && eligible(state).every(player => own(state.captions, player.id))) advance(state, now);
  else if (state.phase === 'vote' && eligible(state).every(player => own(state.votes, player.id))) advance(state, now);
}
function validateTime(now: number) { if (!Number.isFinite(now) || now < 0) throw new Error('Invalid time.'); }
export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) {
    const value = object(raw); exact(value, ['length', 'drawingSeconds', 'captionSeconds', 'voteSeconds']);
    const length = value.length ?? 'standard';
    if (length !== 'standard' && length !== 'short') throw new Error('Choose standard or short.');
    function seconds(key: string, fallback: number, min: number, max: number) {
      const number = value[key] ?? fallback;
      if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) throw new Error(`Invalid ${key}.`);
      return number;
    }
    return { length, drawingSeconds: seconds('drawingSeconds', length === 'short' ? 60 : 120, 30, 180), captionSeconds: seconds('captionSeconds', length === 'short' ? 25 : 45, 15, 90), voteSeconds: seconds('voteSeconds', length === 'short' ? 20 : 30, 10, 60) };
  },
  parseInput(raw) { if (raw !== null) throw new Error('This game uses actions.'); return null; },
  neutralInput: () => null,
  parseAction(raw) {
    const value = object(raw); const turnId = text(value.turnId, 200);
    if (value.type === 'drawing' || value.type === 'save-draft') { exact(value, ['type', 'turnId', 'drawing']); return { type: value.type, turnId, drawing: parseDrawing(value.drawing) }; }
    if (value.type === 'caption') { exact(value, ['type', 'turnId', 'text']); return { type: 'caption', turnId, text: text(value.text, 100) }; }
    if (value.type === 'vote') { exact(value, ['type', 'turnId', 'choiceId']); return { type: 'vote', turnId, choiceId: text(value.choiceId, 40) }; }
    throw new Error('Unknown action.');
  },
  create(ctx, settings) {
    validateTime(ctx.nowMs);
    if (ctx.players.length < 3 || ctx.players.length > 10 || new Set(ctx.players.map(player => player.id)).size !== ctx.players.length || ctx.players.some(player => !player.id || ['__proto__', 'constructor', 'prototype'].includes(player.id)) || !Number.isInteger(ctx.seed)) throw new Error('Sketch Bluff needs 3–10 unique players and an integer seed.');
    const checked = rules.validateSettings(settings);
    const state: State = { players: ctx.players.map(({ id, name, color }) => ({ id, name, color, connected: true, score: 0 })), settings: checked, roundId: ctx.roundId, seed: ctx.seed >>> 0, promptDeck: [], phase: 'drawing', turnId: '', deadline: 0, gallery: 1, galleries: checked.length === 'standard' && ctx.players.length <= 5 ? 2 : 1, art: [], exhibits: [], exhibit: 0, captions: {}, votes: {}, choices: [], gains: {}, skipped: 0 };
    state.promptDeck = shuffle(state, prompts); startGallery(state, ctx.nowMs); return state;
  },
  applyAction(state, playerId, raw, now) {
    validateTime(now);
    const action = rules.parseAction(raw);
    const player = state.players.find(seat => seat.id === playerId);
    if (!player || !player.connected) throw new Error('A connected player seat is required.');
    if (state.phase === 'results' || action.turnId !== state.turnId || now >= state.deadline) throw new Error('This turn has ended.');
    if (action.type === 'drawing' || action.type === 'save-draft') {
      if (state.phase !== 'drawing') throw new Error('Drawing time has ended.');
      const art = state.art.find(item => item.artistId === playerId)!;
      if (art.submitted) throw new Error('Drawing already submitted.');
      art.draft = action.drawing;
      if (action.type === 'drawing') { art.drawing = action.drawing; art.submitted = true; }
    } else {
      if (currentArt(state)?.artistId === playerId) throw new Error('The artist sits this exhibit out.');
      if (action.type === 'caption') {
        if (state.phase !== 'caption' || own(state.captions, playerId)) throw new Error('Caption unavailable or already submitted.');
        // Accept truth collisions exactly like every other caption: no answer oracle.
        state.captions[playerId] = action.text;
      } else {
        if (state.phase !== 'vote' || own(state.votes, playerId) || !state.choices.some(choice => choice.id === action.choiceId)) throw new Error('Vote unavailable, invalid, or already submitted.');
        state.votes[playerId] = action.choiceId;
      }
    }
    maybeAdvance(state, now);
  },
  tick(state, _inputs, _dt, now) { validateTime(now); if (state.phase !== 'results' && now >= state.deadline) advance(state, now); },
  onPresenceChange(state, playerId, connected, now) {
    validateTime(now); const player = state.players.find(seat => seat.id === playerId);
    if (!player) throw new Error('Unknown player.'); player.connected = connected;
  },
  publicView(state) {
    const art = currentArt(state);
    const exhibited = ['caption', 'vote', 'reveal'].includes(state.phase);
    return {
      phase: state.phase, turnId: state.turnId, deadline: state.deadline, gallery: state.gallery, galleries: state.galleries,
      exhibit: exhibited ? state.exhibit + 1 : 0, exhibitCount: state.exhibits.length, artistId: exhibited ? art!.artistId : null,
      drawing: exhibited ? structuredClone(art!.drawing) : null,
      choices: ['vote', 'reveal'].includes(state.phase) ? state.choices.map(({ id, text: caption }) => ({ id, text: caption })) : [],
      reveal: state.phase === 'reveal' ? { answer: art!.prompt, choices: state.choices.map(choice => ({ ...choice, authors: [...choice.authors], voters: state.players.filter(player => state.votes[player.id] === choice.id).map(player => player.id) })), gains: { ...state.gains } } : null,
      players: state.players.map(({ id, name, color, score, connected }) => ({ id, name, color, score, connected })), skipped: state.skipped,
      submitted: state.phase === 'drawing' ? state.art.filter(item => item.submitted).length : state.phase === 'caption' ? Object.keys(state.captions).length : state.phase === 'vote' ? Object.keys(state.votes).length : 0,
      expected: state.phase === 'drawing' ? state.players.length : ['caption', 'vote'].includes(state.phase) ? eligible(state).length : 0,
    };
  },
  playerView(state, playerId) {
    if (!state.players.some(player => player.id === playerId)) throw new Error('Unknown player.');
    const art = state.art.find(item => item.artistId === playerId)!;
    return { prompt: state.phase === 'drawing' ? art.prompt : null, draft: state.phase === 'drawing' ? structuredClone(art.draft) : null,
      submitted: state.phase === 'drawing' ? art.submitted : state.phase === 'caption' ? own(state.captions, playerId) : state.phase === 'vote' ? own(state.votes, playerId) : false,
      caption: own(state.captions, playerId) ? state.captions[playerId]! : null, vote: own(state.votes, playerId) ? state.votes[playerId]! : null,
      isArtist: currentArt(state)?.artistId === playerId };
  },
  outcome(state) {
    const sorted = [...state.players].sort((a, b) => b.score - a.score || state.players.indexOf(a) - state.players.indexOf(b));
    return { complete: state.phase === 'results', winners: state.phase === 'results' ? sorted.filter(player => player.score === sorted[0]!.score).map(player => player.id) : [], rows: sorted.map(player => ({ playerId: player.id, score: player.score, rank: sorted.findIndex(other => other.score === player.score) + 1 })) };
  },
  dispose() {},
};
export default rules;
