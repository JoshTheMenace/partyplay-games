/* Shirt Show rules: draw designs, write slogans, stitch shirts from other people's parts, then king-of-the-hill battles. Server only. */
import { parseDrawing } from '../../../../../party-contract/src/index';
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { variant } from '../../core/narration';
import { freshDeck } from '../../core/server/deck';
import { integer, record } from '../../core/server/validate';
import { HOUSE_DESIGNS, SPARKS, hintPool, sloganPool } from './content.server';
import {
  CHAMP_MS, DRAW_S, FINAL_RESULT, FINAL_SHOW_MS, FINAL_VOTE_S, HAND, MAKE_S, MAX_DESIGNS, MAX_SLOGAN, MAX_SLOGANS, MIN_INK, MIN_READ_MS, PTS, RESULT, ROUNDS, SHIRT_COLORS, VOTE_S, WRITE_S,
  inkOf, pack, shirtsFor, showMs, type ClashResult, type Credits, type Packed, type Phase, type Pos, type Pts, type ShirtPrivate, type ShirtPublic, type ShirtView,
} from './types';

type Design = { key: string; by: string | null; drawing: Packed; dealt: number };
type Slogan = { id: string; by: string | null; text: string; dealt: number };
type Hand = { designs: string[]; slogans: string[]; rd: boolean; rs: boolean };
type Shirt = ShirtView & { credits: Credits; part: string };
type Clash = { sides: [Shirt, Shirt]; votes: Record<string, 0 | 1>; result?: ClashResult };
type Stat = 'design' | 'slogan';
export type ShirtState = {
  ids: string[]; online: Record<string, boolean>; need: number;
  phase: Phase; round: number; turn: string; seq: number; at: number; deadline: number; stage: number; hurried: boolean; n: number;
  /** Rotating decks (unused tonight first, marked as dealt): slogan helper prompts, drawing ideas, house slogans. */
  hints: string[]; sparks: string[]; house: string[]; tv: string[];
  ideas: Record<string, string[]>; finished: Record<string, boolean>;
  /** This round's pools (player parts plus house fillers), hands and finished shirts. */
  designs: Design[]; slogans: Slogan[]; hands: Record<string, Hand>; made: Record<string, Shirt[]>;
  /** Battle: shirts in ring order, the next challenger, ring wins per shirt (a holder's streak), knock-outs this round. */
  order: Shirt[]; next: number; wins: Record<string, number>; ko: Shirt[]; clash: Clash | null;
  champs: { shirt: Shirt; wins: number }[];
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>; tailor: string | null;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const view = ({ id, design, slogan, color, pos }: Shirt): ShirtView => ({ id, design, slogan, color, pos });
const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const counted = (s: ShirtState, id: string) => s.phase === 'draw' ? s.designs.filter(d => d.by === id).length : s.slogans.filter(x => x.by === id).length;
const isDone = (s: ShirtState, id: string) => s.phase === 'make' ? (s.made[id]?.length ?? 0) >= s.need : !!s.finished[id] || counted(s, id) >= (s.phase === 'draw' ? MAX_DESIGNS : MAX_SLOGANS);
/** Rotates `count` items off the front of a deck to its back and returns them. */
/** Deals from the top of a rotating deck, marking each card as used tonight. */
function take(api: MiniApi, deck: string[], count: number) { const out = deck.splice(0, count); deck.push(...out); for (const card of out) api.used.add(card); return out; }

/** Trims, collapses whitespace and drops control/bidi characters; 1–40 characters. */
function clean(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_SLOGAN * 4) throw new Error(`Keep it under ${MAX_SLOGAN} characters.`);
  const text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Type a slogan first.');
  if (text.length > MAX_SLOGAN) throw new Error(`Keep it under ${MAX_SLOGAN} characters.`);
  return text;
}

function go(s: ShirtState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, stage: 0, hurried: false });
}
/** Keeps the phase open long enough for a narrator line that just started. */
function hold(s: ShirtState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }

function startRound(s: ShirtState, api: MiniApi) {
  // Only the champions' artwork is needed again (the final); everything else leaves the media store.
  for (const d of s.designs) if (!s.champs.some(c => c.shirt.design === d.key)) api.media.remove(d.key);
  Object.assign(s, { round: s.round + 1, prev: { ...s.scores }, designs: [], slogans: [], hands: {}, made: {}, order: [], ko: [], next: 0, clash: null, finished: {} });
  s.ideas = Object.fromEntries(s.ids.map(id => [id, take(api, s.sparks, 3)]));
  api.music('think');
  if (s.round > 1) api.sfx('gong');
  go(s, api, 'draw', api.seconds(DRAW_S));
}

function startWrite(s: ShirtState, api: MiniApi) {
  s.finished = {};
  s.ideas = Object.fromEntries(s.ids.map(id => [id, take(api, s.hints, 6)]));
  s.tv = take(api, s.hints, 6);
  api.music('think-2'); api.sfx('whoosh');
  go(s, api, 'write', api.seconds(WRITE_S));
}

/** Deals a hand: other players' parts first, then house fillers, your own last; least-dealt first so parts spread around. */
function deal(s: ShirtState, api: MiniApi, id: string, keep?: Hand, what?: 'design' | 'slogan'): Hand {
  const used = new Set((s.made[id] ?? []).flatMap(m => [m.design, m.part]));
  const rank = (by: string | null) => by === null ? 1 : by === id ? 2 : 0;
  function choose<T extends { by: string | null; dealt: number }>(pool: T[], key: (x: T) => string, skip: readonly string[]) {
    const fresh = api.shuffle(pool.filter(x => !skip.includes(key(x)) && !used.has(key(x)))).sort((a, b) => rank(a.by) - rank(b.by) || a.dealt - b.dealt).slice(0, HAND);
    fresh.forEach(x => x.dealt++);
    return fresh.map(key);
  }
  return {
    designs: keep && what !== 'design' ? keep.designs : choose(s.designs, d => d.key, keep?.designs ?? []),
    slogans: keep && what !== 'slogan' ? keep.slogans : choose(s.slogans, x => x.id, keep?.slogans ?? []),
    rd: !!keep?.rd || what === 'design', rs: !!keep?.rs || what === 'slogan',
  };
}

/** Writing closes: house parts join the pools, every design goes to the media store, and everyone gets a hand. */
function startMake(s: ShirtState, api: MiniApi) {
  for (const { drawing } of api.shuffle(HOUSE_DESIGNS)) s.designs.push({ key: `ss-${++s.n}`, by: null, drawing: pack(drawing), dealt: 0 });
  for (const text of take(api, s.house, Math.max(12, s.ids.length * 2))) s.slogans.push({ id: `s${++s.n}`, by: null, text, dealt: 0 });
  for (const d of s.designs) api.media.put(d.key, d.drawing);
  s.made = Object.fromEntries(s.ids.map(id => [id, []]));
  s.hands = Object.fromEntries(s.ids.map(id => [id, deal(s, api, id)]));
  api.music('shirt-show'); api.sfx('whoosh');
  go(s, api, 'make', api.seconds(MAKE_S));
}

function stitch(s: ShirtState, id: string, design: string, slogan: string, color: number, pos: Pos, auto: boolean): Shirt {
  const d = s.designs.find(x => x.key === design)!, x = s.slogans.find(y => y.id === slogan)!;
  return { id: `sh${++s.n}`, design, slogan: x.text, color, pos, part: slogan, credits: { maker: id, artist: d.by, writer: x.by, ...(auto ? { auto: true as const } : {}) } };
}

/** Time's up or every shirt is in: the house stitches missing shirts from each hand, then the ring opens. */
function startBattle(s: ShirtState, api: MiniApi) {
  for (const id of s.ids) while (s.made[id]!.length < s.need) {
    const hand = s.hands[id] ?? deal(s, api, id), pick = (list: string[]) => list[Math.floor(api.random() * list.length)]!;
    s.made[id]!.push(stitch(s, id, pick(hand.designs), pick(hand.slogans), Math.floor(api.random() * SHIRT_COLORS.length), api.random() < .5 ? 'top' : 'bottom', true));
    s.hands[id] = deal(s, api, id);
  }
  s.hands = {};
  s.order = api.shuffle(s.ids.flatMap(id => s.made[id]!));
  s.wins = { ...s.wins, ...Object.fromEntries(s.order.map(x => [x.id, 0])) };
  s.next = 1;
  if (s.order.length < 2) return crown(s, api);
  startBout(s, api);
}

function startBout(s: ShirtState, api: MiniApi) {
  const holder = s.clash?.result ? s.clash.sides[s.clash.result.winner] : s.order[0]!;
  s.clash = { sides: [holder, s.order[s.next]!], votes: {} };
  api.music('shirt-show'); api.sfx('bell'); api.sfx('swoosh-in');
  const first = s.next === 1;
  go(s, api, 'show', showMs(s.next - 1));
  if (first) hold(s, api, api.say('shirt-show.bell'));
}

/** Points for one side of a clash: the maker per vote, plus borrowed parts (house parts and your own parts pay nobody extra). */
function award(s: ShirtState, shirt: Shirt, votes: number, final: boolean): Pts {
  const { maker, artist, writer } = shirt.credits, part = (by: string | null) => by !== null && by !== maker ? votes * (final ? PTS.finalPart : PTS.part) : 0;
  const pts = { maker: votes * (final ? PTS.finalMaker : PTS.maker), artist: part(artist), writer: part(writer) };
  s.scores[maker]! += pts.maker;
  if (artist !== null) { s.scores[artist]! += pts.artist; s.stats.design[artist]! += votes; }
  if (writer !== null) { s.scores[writer]! += pts.writer; s.stats.slogan[writer]! += votes; }
  return pts;
}

function tally(s: ShirtState, c: Clash, final: boolean): ClashResult {
  const voters = [0, 1].map(side => s.ids.filter(id => own(c.votes, id) === side)) as [string[], string[]];
  const tie = voters[0].length === voters[1].length;
  const winner: 0 | 1 = voters[1].length > voters[0].length ? 1 : 0;
  return { voters, winner, ...(tie ? { tie: true as const } : {}), credits: [c.sides[0].credits, c.sides[1].credits], points: [award(s, c.sides[0], voters[0].length, final), award(s, c.sides[1], voters[1].length, final)] };
}

/** Ties keep the holder in the ring but don't count as a ring win. */
function reveal(s: ShirtState, api: MiniApi) {
  const c = s.clash!, result = tally(s, c, false);
  if (!result.tie) s.wins[c.sides[result.winner].id]!++;
  c.result = result;
  go(s, api, 'result', RESULT.end);
}

function crown(s: ShirtState, api: MiniApi) {
  const shirt = s.clash?.result ? s.clash.sides[s.clash.result.winner] : s.order[0]!;
  s.scores[shirt.credits.maker]! += PTS.champ;
  s.champs.push({ shirt, wins: s.wins[shirt.id] ?? 0 });
  api.music('shirt-show'); api.sfx('fanfare'); api.sfx('applause');
  go(s, api, 'champ', CHAMP_MS);
  hold(s, api, api.say(variant('host.winner', api.random)));
}

function startFinal(s: ShirtState, api: MiniApi) {
  s.clash = { sides: [s.champs[0]!.shirt, s.champs[1]!.shirt], votes: {} };
  api.music('shirt-show'); api.sfx('gong'); api.sfx('airhorn');
  go(s, api, 'final-show', FINAL_SHOW_MS);
  hold(s, api, api.say('host.final-round') + api.say('shirt-show.main-event'));
}

/** Final: double rates; ties go to the shirt with more ring wins, then a coin flip. The winner's maker gets the big bonus. */
function finalReveal(s: ShirtState, api: MiniApi) {
  const c = s.clash!, result = tally(s, c, true), wins = s.champs.map(x => x.wins);
  if (result.tie) { result.winner = wins[1]! > wins[0]! ? 1 : wins[0]! > wins[1]! ? 0 : api.random() < .5 ? 0 : 1; Object.assign(result, { tiebreak: true }); }
  s.tailor = c.sides[result.winner].credits.maker;
  s.scores[s.tailor]! += PTS.finalWin;
  c.result = result;
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'final-result', FINAL_RESULT.end);
}

/** Voters for a clash: connected players who did not make either shirt. */
const voters = (s: ShirtState) => s.ids.filter(id => s.online[id] && !s.clash!.sides.some(x => x.credits.maker === id));

export const server: MiniServer<ShirtState, ShirtPublic, ShirtPrivate> = {
  id: 'shirt-show',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0]));
    const s: ShirtState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])), need: shirtsFor(ids.length),
      phase: 'draw', round: 0, turn: '', seq: 0, at: api.now, deadline: api.now, stage: 0, hurried: false, n: 0,
      hints: freshDeck(api, hintPool(api.settings.family)), sparks: freshDeck(api, SPARKS), house: freshDeck(api, sloganPool(api.settings.family)), tv: [],
      ideas: {}, finished: {}, designs: [], slogans: [], hands: {}, made: {},
      order: [], next: 0, wins: {}, ko: [], clash: null, champs: [],
      scores: zero(), prev: zero(), stats: { design: zero(), slogan: zero() }, tailor: null, done: false,
    };
    startRound(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The show has moved on.');
    switch (a.k) {
      case 'design': {
        record(a, ['turn', 'k', 'drawing']);
        if (s.phase !== 'draw') throw new Error('Drawing time is over.');
        if (isDone(s, id)) throw new Error(counted(s, id) >= MAX_DESIGNS ? `That’s ${MAX_DESIGNS} designs. The rack is full!` : 'You already finished drawing.');
        const drawing = parseDrawing(a.drawing);
        if (inkOf(drawing) < MIN_INK) throw new Error(drawing.strokes.length ? 'Draw a bit more first.' : 'Draw something first.');
        s.designs.push({ key: `ss-${++s.n}`, by: id, drawing: pack(drawing), dealt: 0 });
        api.sfx('scribble');
        return;
      }
      case 'slogan': {
        record(a, ['turn', 'k', 'text']);
        if (s.phase !== 'write') throw new Error('Slogan time is over.');
        if (isDone(s, id)) throw new Error(counted(s, id) >= MAX_SLOGANS ? `That’s ${MAX_SLOGANS} slogans. Plenty!` : 'You already finished writing.');
        const text = clean(a.text);
        if (s.slogans.some(x => x.by === id && norm(x.text) === norm(text))) throw new Error('You already wrote that one.');
        s.slogans.push({ id: `s${++s.n}`, by: id, text, dealt: 0 });
        api.sfx('typewriter');
        return;
      }
      case 'done': {
        record(a, ['turn', 'k']);
        if (s.phase !== 'draw' && s.phase !== 'write') throw new Error('Nothing to finish right now.');
        if (!counted(s, id)) throw new Error(s.phase === 'draw' ? 'Send at least one design first.' : 'Write at least one slogan first.');
        if (isDone(s, id)) throw new Error('You’re already done.');
        s.finished[id] = true; api.sfx('lock');
        return;
      }
      case 'reroll': {
        record(a, ['turn', 'k', 'what']);
        const hand = s.phase === 'make' ? own(s.hands, id) : undefined;
        if (!hand) throw new Error('No shirt to build right now.');
        if (a.what !== 'design' && a.what !== 'slogan') throw new Error('Reroll designs or slogans.');
        if (a.what === 'design' ? hand.rd : hand.rs) throw new Error(`You already rerolled your ${a.what}s.`);
        s.hands[id] = deal(s, api, id, hand, a.what); api.sfx('whoosh');
        return;
      }
      case 'shirt': {
        record(a, ['turn', 'k', 'design', 'slogan', 'color', 'pos']);
        const hand = s.phase === 'make' ? own(s.hands, id) : undefined;
        if (!hand) throw new Error(s.phase === 'make' ? 'Your shirts are all in!' : 'The sewing room is closed.');
        if (typeof a.design !== 'string' || !hand.designs.includes(a.design)) throw new Error('Pick one of your designs.');
        if (typeof a.slogan !== 'string' || !hand.slogans.includes(a.slogan)) throw new Error('Pick one of your slogans.');
        const color = integer(a.color, 0, SHIRT_COLORS.length - 1);
        if (a.pos !== 'top' && a.pos !== 'bottom') throw new Error('Put the slogan on the top or the bottom.');
        s.made[id]!.push(stitch(s, id, a.design, a.slogan, color, a.pos, false));
        if (s.made[id]!.length < s.need) s.hands[id] = deal(s, api, id); else delete s.hands[id];
        api.sfx('stamp');
        return;
      }
      case 'vote': {
        record(a, ['turn', 'k', 'side']);
        if (s.phase !== 'vote' && s.phase !== 'final-vote') throw new Error('Voting opens in a moment.');
        const c = s.clash!;
        if (c.sides.some(x => x.credits.maker === id)) throw new Error('No voting in your own bout!');
        if (Object.hasOwn(c.votes, id)) throw new Error('Your vote is already in.');
        c.votes[id] = integer(a.side, 0, 1) as 0 | 1; api.sfx('vote');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at;
    switch (s.phase) {
      case 'draw': case 'write': case 'make': {
        const online = s.ids.filter(id => s.online[id]), next = () => s.phase === 'draw' ? startWrite(s, api) : s.phase === 'write' ? startMake(s, api) : startBattle(s, api);
        if (online.length && online.every(id => isDone(s, id)) && t >= MIN_READ_MS) { api.say('host.everyone-in'); return next(); }
        if (now >= s.deadline) { api.sfx('timeup'); api.say(s.phase === 'draw' ? 'host.pencils-down' : variant('host.timeup', api.random)); return next(); }
        if (!s.hurried && s.deadline - now <= 10_000 && s.deadline - s.at > 20_000) { s.hurried = true; api.sfx('tick-fast'); api.say(variant('host.hurry', api.random)); }
        return;
      }
      case 'show': case 'final-show': {
        const c = s.clash!, final = s.phase === 'final-show';
        if (s.stage === 0 && t >= 900) { s.stage++; api.sfx('whoosh'); if (final || s.next === 1) api.speak(c.sides[0].slogan); api.speak(c.sides[1].slogan); }
        if (now < s.deadline) return;
        if (final || s.next === 1) api.say(variant('host.vote', api.random));
        if (final) api.music('vote');
        api.sfx('ding');
        return go(s, api, final ? 'final-vote' : 'vote', api.seconds(final ? FINAL_VOTE_S : VOTE_S));
      }
      case 'vote': case 'final-vote': {
        const c = s.clash!;
        if ((voters(s).every(id => Object.hasOwn(c.votes, id)) && t >= 1200) || now >= s.deadline) (s.phase === 'vote' ? reveal : finalReveal)(s, api);
        return;
      }
      case 'result': case 'final-result': {
        const final = s.phase === 'final-result', beats = final ? FINAL_RESULT : RESULT, r = s.clash!.result!, total = r.voters[0].length + r.voters[1].length;
        const steps = [beats.voters, beats.credits, beats.winner];
        if (s.stage < 3 && t >= steps[s.stage]!) {
          s.stage++;
          if (s.stage === 1) api.sfx(total ? 'vote' : 'pop');
          if (s.stage === 2) api.sfx('reveal');
          if (s.stage === 3) {
            api.sfx('bell'); api.sfx(final ? 'fanfare' : r.winner ? 'crash' : 'cheer');
            if (final) { api.sfx('applause'); hold(s, api, api.say(!total ? 'host.no-votes' : 'tiebreak' in r ? 'host.close' : variant('host.winner', api.random))); }
            else if (!total) { api.sfx('aww'); hold(s, api, api.say('host.no-votes')); }
            else if (r.tie) api.sfx('ooh');
            else if (total >= 3 && !r.voters[1 - r.winner]!.length) { api.sfx('airhorn'); hold(s, api, api.say('host.landslide')); }
            else if (r.winner === 0 && s.wins[s.clash!.sides[0].id]! >= 3) hold(s, api, api.say('shirt-show.streak'));
          }
        }
        if (now < s.deadline) return;
        if (final) { s.done = true; return; }
        s.ko.push(s.clash!.sides[1 - r.winner]!);
        if (++s.next < s.order.length) return startBout(s, api);
        return crown(s, api);
      }
      case 'champ':
        if (now < s.deadline) return;
        return s.round < ROUNDS ? startRound(s, api) : startFinal(s, api);
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const pub: ShirtPublic = { phase: s.phase, round: s.round, turn: s.turn, at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [] };
    if (s.phase === 'draw' || s.phase === 'write' || s.phase === 'make') pub.done = s.ids.filter(id => isDone(s, id));
    if (s.phase === 'draw' || s.phase === 'write') pub.counts = Object.fromEntries(s.ids.map(id => [id, counted(s, id)]));
    if (s.phase === 'write') pub.sparks = [...s.tv];
    if (s.phase === 'make') pub.sewn = [s.ids.reduce((n, id) => n + s.made[id]!.length, 0), s.ids.length * s.need];
    const c = s.clash;
    if ((s.phase === 'show' || s.phase === 'vote' || s.phase === 'result') && c) {
      const r = c.result, streak = s.wins[c.sides[0].id]! - (r && !r.tie && !r.winner ? 1 : 0);
      pub.bout = { index: s.next - 1, count: s.order.length - 1, sides: [view(c.sides[0]), view(c.sides[1])], streak, votes: Object.keys(c.votes).length };
      if (r) pub.bout.result = { ...structuredClone(r), streak: s.wins[c.sides[r.winner].id]! };
      pub.ko = s.ko.map(view); pub.left = s.order.length - s.next - 1;
    }
    if (s.phase === 'champ') {
      const champ = s.champs.at(-1)!;
      Object.assign(pub, { prev: { ...s.prev }, champ: { shirt: view(champ.shirt), credits: { ...champ.shirt.credits }, wins: champ.wins, bonus: PTS.champ } });
    }
    if (s.phase.startsWith('final') && c) pub.final = {
      sides: [view(c.sides[0]), view(c.sides[1])], credits: [{ ...c.sides[0].credits }, { ...c.sides[1].credits }], wins: [s.champs[0]!.wins, s.champs[1]!.wins], votes: Object.keys(c.votes).length,
      ...(c.result ? { result: { ...structuredClone(c.result), bonus: PTS.finalWin } } : {}),
    };
    return pub;
  },

  playerView(s, id) {
    const me: ShirtPrivate = { turn: s.turn };
    if (s.phase === 'draw' || s.phase === 'write') {
      if (s.phase === 'draw') me.designs = counted(s, id); else me.slogans = s.slogans.filter(x => x.by === id).map(x => x.text);
      if (isDone(s, id)) me.finished = true;
      me.ideas = [...(s.ideas[id] ?? [])];
    }
    if (s.phase === 'make') {
      const hand = own(s.hands, id);
      Object.assign(me, { need: s.need, made: (s.made[id] ?? []).map(view) });
      if (hand) me.hand = { designs: [...hand.designs], slogans: hand.slogans.map(x => ({ id: x, text: s.slogans.find(y => y.id === x)!.text })), reroll: { design: !hand.rd, slogan: !hand.rs } };
    }
    const c = s.clash;
    if (c && ['show', 'vote', 'result', 'final-show', 'final-vote', 'final-result'].includes(s.phase)) {
      const mine = ([0, 1] as const).filter(side => c.sides[side].credits.maker === id), vote = own(c.votes, id);
      if (mine.length) me.mine = [...mine];
      if (vote !== undefined) me.vote = vote;
    }
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const top = Math.max(...s.ids.map(id => s.scores[id]!)), awards: { title: string; playerId: string }[] = [];
    if (s.tailor) awards.push({ title: 'Champion Tailor', playerId: s.tailor });
    for (const [title, rec] of [['Best Designer', s.stats.design], ['Wordsmith', s.stats.slogan]] as const) {
      const max = Math.max(...s.ids.map(id => rec[id]!)), who = s.ids.filter(id => rec[id] === max);
      if (max > 0 && who.length === 1) awards.push({ title, playerId: who[0]! });
    }
    return { scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], ...(awards.length ? { awards } : {}) };
  },
};
export default server;
