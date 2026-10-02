/* Sketch Bluff rules: everyone draws a secret prompt, then each piece is titled by forgers and guessed by the room. Server only. */
import { parseDrawing, type Drawing } from '../../../../../party-contract/src/index';
import type { MiniApi, MiniResult, MiniServer, SfxId } from '../../core/contract';
import { variant } from '../../core/narration';
import { freshDeck } from '../../core/server/deck';
import { bool, record } from '../../core/server/validate';
import { decoyPool, promptPool } from './content.server';
import {
  ART_PTS, DRAW_S, FAKE_SUB, FIND_PTS, FOOL_PTS, GUESS_S, LIKE_GRACE_MS, LIKE_PTS, MAX_LIKES, MAX_TITLE, MIN_OPTIONS, MIN_READ_MS, REAL_SUB,
  SCORES_MS, SUGGESTIONS, TITLE_S, artKey, revealPlan, roundsFor, titleKey, type Beat, type Phase, type SketchPrivate, type SketchPublic,
} from './types';

type Entry = { id: string; text: string; kind: 'fake' | 'house' | 'real'; author: string | null };
type Cue = { at: number; sfx: SfxId[]; say?: string; speak?: string };
type Stat = 'found' | 'fooled' | 'liked';
export type SketchState = {
  ids: string[]; online: Record<string, boolean>; rounds: number;
  phase: Phase; round: number; turn: string; seq: number; at: number; deadline: number; hurried: boolean;
  /** Prompt deck (unused tonight first, marked as dealt) and the shuffled house-title deck (both rotate as they are used). */
  prompts: string[]; decoys: string[];
  /** This round: each player's prompt and drawing; the gallery order (artists with a drawing) and the piece on the wall. */
  arts: Record<string, { prompt: string; drawing: Drawing | null }>; order: string[]; index: number;
  titles: Record<string, string>; suggestions: Record<string, string[]>;
  options: Entry[]; guesses: Record<string, string>; likes: Record<string, string[]>; lastGuess: number;
  plan: Beat[]; stage: number; cues: Cue[]; cue: number;
  pieces: { art: string; artist: string; title: string }[];
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const artist = (s: SketchState) => s.order[s.index]!;
const forgers = (s: SketchState) => s.ids.filter(id => id !== artist(s));
const mineOf = (s: SketchState, id: string) => s.options.find(o => id === artist(s) ? o.kind === 'real' : o.author === id)?.id;

/**
 * Trims, collapses whitespace and drops control/bidi characters; 1–40 characters. Stored in the gallery's house style
 * (lower case, curly apostrophes, no closing full stop) so typing habits never tell a forgery from the real title.
 */
function clean(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_TITLE * 4) throw new Error(`Keep it under ${MAX_TITLE} characters.`);
  const text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').replace(/['`‘]/g, '’').replace(/(?<!\.)\.\s*$/, '').trim();
  if (!text) throw new Error('Type a title first.');
  if (text.length > MAX_TITLE) throw new Error(`Keep it under ${MAX_TITLE} characters.`);
  if (!titleKey(text)) throw new Error('Give it a title with some real words.');
  return text.toLowerCase();
}
/** Next house titles from the rotating deck whose keys are not taken. */
function deal(s: SketchState, count: number, taken: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.decoys.length && out.length < count; i++) {
    const text = s.decoys.shift()!; s.decoys.push(text);
    if (!taken.has(titleKey(text))) { out.push(text); taken.add(titleKey(text)); }
  }
  return out;
}

function go(s: SketchState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, hurried: false });
}

function startRound(s: SketchState, api: MiniApi) {
  s.order.forEach((_, i) => api.media.remove(artKey(s.round, i)));
  s.round++; s.prev = { ...s.scores }; s.order = []; s.pieces = [];
  s.arts = Object.fromEntries(s.ids.map(id => { const prompt = s.prompts.shift()!; s.prompts.push(prompt); api.used.add(prompt); return [id, { prompt, drawing: null }]; }));
  api.music('sketch-bluff');
  if (s.round > 1) { api.sfx('gong'); api.say('host.final-round'); }
  go(s, api, 'draw', api.seconds(DRAW_S));
}

/** Pencils down: hang every finished drawing in a shuffled gallery (missing drawings skip their artist's turn). */
function endDraw(s: SketchState, api: MiniApi) {
  s.order = api.shuffle(s.ids.filter(id => s.arts[id]!.drawing));
  s.order.forEach((id, i) => api.media.put(artKey(s.round, i), s.arts[id]!.drawing));
  if (!s.order.length) { api.sfx('aww'); return scores(s, api); }
  showPiece(s, api, 0);
}

function showPiece(s: SketchState, api: MiniApi, index: number) {
  s.index = index; s.titles = {}; s.guesses = {}; s.likes = {}; s.options = []; s.plan = []; s.cues = []; s.stage = 0; s.cue = 0;
  const taken = new Set([titleKey(s.arts[artist(s)]!.prompt)]);
  s.suggestions = Object.fromEntries(forgers(s).map(id => [id, deal(s, SUGGESTIONS, taken)]));
  api.music('sketch-bluff'); api.sfx('camera'); api.sfx('swoosh-in');
  if (index === 0) api.say('sketch-bluff.unveil');
  go(s, api, 'title', api.seconds(TITLE_S));
}

/** Titles are in: forgeries + the real title + house decoys (at least four options), shuffled behind opaque ids. */
function endTitle(s: SketchState, api: MiniApi) {
  const real = s.arts[artist(s)]!.prompt, fakes = forgers(s).filter(id => own(s.titles, id) !== undefined);
  const taken = new Set([real, ...fakes.map(id => s.titles[id]!), ...Object.values(s.suggestions).flat()].map(titleKey));
  const entries: Omit<Entry, 'id'>[] = [
    ...fakes.map(id => ({ text: s.titles[id]!, kind: 'fake' as const, author: id })),
    { text: real, kind: 'real', author: null },
    ...deal(s, Math.max(0, MIN_OPTIONS - fakes.length - 1), taken).map(text => ({ text, kind: 'house' as const, author: null })),
  ];
  s.options = api.shuffle(entries).map((e, i) => ({ ...e, id: `o${i}` }));
  api.music('vote'); api.sfx('ding');
  if (s.index === 0) api.say(variant('host.vote', api.random));
  go(s, api, 'guess', api.seconds(GUESS_S));
}

/** Scores the piece and lays out the reveal: chosen forgeries (fewest fooled first), the real title, then the tally. */
function reveal(s: SketchState, api: MiniApi) {
  const mult = s.round, painter = artist(s), gains: Record<string, number> = {}, likes: Record<string, number> = {};
  const gain = (id: string, pts: number) => { s.scores[id]! += pts; gains[id] = (gains[id] ?? 0) + pts; };
  const fooled = (o: Entry) => s.ids.filter(id => own(s.guesses, id) === o.id);
  for (const o of s.options) {
    const who = fooled(o);
    if (o.kind === 'real') for (const id of who) { gain(id, FIND_PTS * mult); gain(painter, ART_PTS * mult); s.stats.found[painter]!++; }
    if (o.kind === 'fake' && who.length) { gain(o.author!, FOOL_PTS * mult * who.length); s.stats.fooled[o.author!]! += who.length; }
    const fan = o.kind === 'real' ? painter : o.author, hearts = s.ids.filter(id => own(s.likes, id)?.includes(o.id)).length;
    if (fan && hearts) { gain(fan, LIKE_PTS * hearts); likes[fan] = (likes[fan] ?? 0) + hearts; s.stats.liked[fan]! += hearts; }
  }
  const shown = s.options.filter(o => o.kind !== 'real' && fooled(o).length).sort((a, b) => fooled(a).length - fooled(b).length);
  const real = s.options.find(o => o.kind === 'real')!, found = fooled(real), t = revealPlan(shown.length), at = (ms: number) => api.now + ms;
  s.plan = [
    ...shown.map((o, i): Beat => o.kind === 'fake'
      ? { kind: 'fake', at: at(t.fakes[i]!), id: o.id, text: o.text, author: o.author!, fooled: fooled(o), points: FOOL_PTS * mult * fooled(o).length }
      : { kind: 'house', at: at(t.fakes[i]!), id: o.id, text: o.text, fooled: fooled(o) }),
    { kind: 'real', at: at(t.real), id: real.id, text: real.text, found, artist: painter, points: ART_PTS * mult * found.length },
    { kind: 'tally', at: at(t.tally), gains, likes },
  ];
  s.cues = [
    ...shown.flatMap((o, i) => [
      { at: at(t.fakes[i]! + FAKE_SUB[0]), sfx: ['swoosh-in'] as SfxId[], speak: o.text },
      { at: at(t.fakes[i]! + FAKE_SUB[1]), sfx: ['vote'] as SfxId[] },
      { at: at(t.fakes[i]! + FAKE_SUB[2]), sfx: ['stamp', o.kind === 'fake' ? 'laugh' : 'ooh'] as SfxId[] },
    ]),
    { at: at(t.real + REAL_SUB[0]), sfx: ['drumroll'], say: 'sketch-bluff.truth', speak: real.text },
    { at: at(t.real + REAL_SUB[1]), sfx: found.length ? ['correct', 'applause'] : ['aww'], ...(found.length ? {} : { say: 'sketch-bluff.nobody' }) },
    { at: at(t.real + REAL_SUB[2]), sfx: found.length ? ['cheer', 'score-up'] : ['sting'] },
    { at: at(t.tally), sfx: ['coin', 'score-up'] },
  ];
  s.pieces.push({ art: artKey(s.round, s.index), artist: painter, title: real.text });
  api.music('reveal'); api.say(variant('host.reveal', api.random));
  go(s, api, 'reveal', t.end);
}

function scores(s: SketchState, api: MiniApi) {
  api.music('sketch-bluff'); api.sfx('fanfare');
  go(s, api, 'scores', SCORES_MS);
  const spoken = api.say('host.scores');
  if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800);
}

export const server: MiniServer<SketchState, SketchPublic, SketchPrivate> = {
  id: 'sketch-bluff',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0]));
    const s: SketchState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])), rounds: roundsFor(ids.length),
      phase: 'draw', round: 0, turn: '', seq: 0, at: api.now, deadline: api.now, hurried: false,
      prompts: freshDeck(api, promptPool(api.settings.family)), decoys: api.shuffle(decoyPool(api.settings.family)),
      arts: {}, order: [], index: 0, titles: {}, suggestions: {}, options: [], guesses: {}, likes: {}, lastGuess: 0,
      plan: [], stage: 0, cues: [], cue: 0, pieces: [],
      scores: zero(), prev: zero(), stats: { found: zero(), fooled: zero(), liked: zero() }, done: false,
    };
    startRound(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The gallery has moved on.');
    switch (a.k) {
      case 'draw': {
        record(a, ['turn', 'k', 'drawing']);
        if (s.phase !== 'draw') throw new Error('The studio is closed.');
        const art = s.arts[id]!;
        if (art.drawing) throw new Error('Your masterpiece is already hanging.');
        const drawing = parseDrawing(a.drawing);
        if (!drawing.strokes.length) throw new Error('Draw something first!');
        art.drawing = drawing; api.sfx('scribble');
        return;
      }
      case 'title': {
        record(a, ['turn', 'k', 'text']);
        if (s.phase !== 'title') throw new Error('Titles are closed.');
        if (id === artist(s)) throw new Error('You drew this one! Just keep a straight face.');
        if (own(s.titles, id) !== undefined) throw new Error('Your title is already in.');
        const text = clean(a.text), key = titleKey(text);
        if (key === titleKey(s.arts[artist(s)]!.prompt)) throw new Error('Too close to the real title! Try another.');
        if (Object.values(s.titles).some(t => titleKey(t) === key)) throw new Error('Someone already forged that title. Try another!');
        s.titles[id] = text; api.sfx('submit');
        return;
      }
      case 'guess': {
        record(a, ['turn', 'k', 'option']);
        if (s.phase !== 'guess') throw new Error('Guessing opens in a moment.');
        if (id === artist(s)) throw new Error('It’s your masterpiece! Just watch them squirm.');
        if (own(s.guesses, id) !== undefined) throw new Error('Your guess is already in.');
        if (!s.options.some(o => o.id === a.option)) throw new Error('That title isn’t on the wall.');
        if (a.option === mineOf(s, id)) throw new Error('That’s your own forgery!');
        s.guesses[id] = a.option as string; s.lastGuess = api.now; api.sfx('vote');
        return;
      }
      case 'like': {
        record(a, ['turn', 'k', 'option', 'on']);
        if (s.phase !== 'guess') throw new Error('Likes are closed.');
        if (!s.options.some(o => o.id === a.option)) throw new Error('That title isn’t on the wall.');
        if (a.option === mineOf(s, id)) throw new Error('No liking your own title!');
        const mine = own(s.likes, id) ?? [], on = bool(a.on, 'Like'), option = a.option as string;
        if (on === mine.includes(option)) throw new Error(on ? 'You already liked that one.' : 'You haven’t liked that one.');
        if (on && mine.length >= MAX_LIKES) throw new Error(`Only ${MAX_LIKES} likes per piece.`);
        s.likes[id] = on ? [...mine, option] : mine.filter(o => o !== option);
        if (on) api.sfx('pop');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]);
    switch (s.phase) {
      case 'draw': {
        if (online.length && online.every(id => s.arts[id]!.drawing) && t >= MIN_READ_MS) { api.say('host.everyone-in'); return endDraw(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); api.say('host.pencils-down'); return endDraw(s, api); }
        if (!s.hurried && s.deadline - now <= 10_000 && s.deadline - s.at > 20_000) { s.hurried = true; api.sfx('tick-fast'); api.say(variant('host.hurry', api.random)); }
        return;
      }
      case 'title': {
        if (forgers(s).filter(id => s.online[id]).every(id => own(s.titles, id) !== undefined) && t >= MIN_READ_MS) return endTitle(s, api);
        if (now >= s.deadline) { api.sfx('timeup'); return endTitle(s, api); }
        if (!s.hurried && s.deadline - now <= 8000 && s.deadline - s.at > 16_000) { s.hurried = true; api.sfx('tick-fast'); }
        return;
      }
      case 'guess': {
        const all = forgers(s).filter(id => s.online[id]).every(id => own(s.guesses, id) !== undefined);
        if ((all && t >= MIN_READ_MS && now - s.lastGuess >= LIKE_GRACE_MS) || now >= s.deadline) reveal(s, api);
        return;
      }
      case 'reveal': {
        while (s.stage < s.plan.length && now >= s.plan[s.stage]!.at) s.stage++;
        for (; s.cue < s.cues.length && now >= s.cues[s.cue]!.at; s.cue++) {
          const c = s.cues[s.cue]!;
          c.sfx.forEach(id => api.sfx(id));
          if (c.say) api.say(c.say);
          if (c.speak) api.speak(c.speak);
        }
        if (now < s.deadline) return;
        return s.index + 1 < s.order.length ? showPiece(s, api, s.index + 1) : scores(s, api);
      }
      case 'scores':
        if (now < s.deadline) return;
        if (s.round < s.rounds) return startRound(s, api);
        s.done = true;
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const pub: SketchPublic = { phase: s.phase, round: s.round, rounds: s.rounds, turn: s.turn, at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [] };
    if (s.phase === 'draw') pub.done = s.ids.filter(id => s.arts[id]!.drawing);
    if (s.phase === 'title') pub.done = forgers(s).filter(id => own(s.titles, id) !== undefined);
    if (s.phase === 'guess') pub.done = forgers(s).filter(id => own(s.guesses, id) !== undefined);
    if (s.phase === 'title' || s.phase === 'guess' || s.phase === 'reveal') pub.piece = { index: s.index, count: s.order.length, artist: artist(s), art: artKey(s.round, s.index) };
    if (s.phase === 'guess' || s.phase === 'reveal') pub.options = s.options.map(o => ({ id: o.id, text: o.text }));
    if (s.phase === 'reveal') pub.beats = s.plan.slice(0, s.stage).map(b => structuredClone(b));
    if (s.phase === 'scores') { pub.prev = { ...s.prev }; pub.pieces = s.pieces.map(p => ({ ...p })); }
    return pub;
  },

  playerView(s, id) {
    const me: SketchPrivate = { turn: s.turn };
    if (!s.ids.includes(id)) return me;
    if (s.phase === 'draw') {
      me.prompt = s.arts[id]!.prompt;
      if (s.arts[id]!.drawing) me.drawn = true;
    }
    if (s.phase === 'title' || s.phase === 'guess' || s.phase === 'reveal') {
      if (id === artist(s)) Object.assign(me, { artist: true, prompt: s.arts[id]!.prompt });
      const title = own(s.titles, id), offers = own(s.suggestions, id), mine = mineOf(s, id), pick = own(s.guesses, id), likes = own(s.likes, id);
      if (title !== undefined) me.title = title;
      if (s.phase === 'title' && offers && title === undefined) me.suggestions = [...offers];
      if (mine) me.mine = mine;
      if (pick) me.pick = pick;
      if (likes?.length) me.likes = [...likes];
    }
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const top = Math.max(...s.ids.map(id => s.scores[id]!)), awards: { title: string; playerId: string }[] = [];
    const best = (title: string, rec: Record<string, number>) => {
      const max = Math.max(...s.ids.map(id => rec[id]!)), who = s.ids.filter(id => rec[id] === max);
      if (max > 0 && who.length === 1) awards.push({ title, playerId: who[0]! });
    };
    best('Best Artist', s.stats.found);
    best('Master Forger', s.stats.fooled);
    best('Crowd Pleaser', s.stats.liked);
    return { scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], ...(awards.length ? { awards } : {}) };
  },
};
export default server;
