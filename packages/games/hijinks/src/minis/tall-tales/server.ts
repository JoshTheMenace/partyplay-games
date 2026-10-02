/* Tall Tales rules: seven true-but-weird stories (3 ×1, 3 ×2, one ×3 finale). Write a lie, find the truth, like the best fibs. Server only. */
import type { MiniApi, MiniResult, MiniServer } from '../../core/contract';
import { variant } from '../../core/narration';
import { freshDeck } from '../../core/server/deck';
import { integer, record } from '../../core/server/validate';
import { factPool, type Fact } from './content.server';
import {
  CATEGORIES, CHOOSE_S, FINAL_MS, FOOL_PTS, HOUSE_RATE, LEAD_MS, LIKES, LIKES_MS, LIKE_GRACE_MS, LIKE_PTS, MAX_LIE, MIN_OPTIONS, MIN_READ_MS, PICKED_MS, PICK_S,
  QUESTIONS, ROUNDS, ROUND_MS, SCORES_MS, TRUTH_MS, TRUTH_PTS, WRITE_S, lieMs, roundOf, same, stampAt, type Beat, type Phase, type TallPrivate, type TallPublic,
} from './types';

type Filed = { text: string; house: boolean };
type Choice = { id: string; text: string; kind: 'truth' | 'lie' | 'house'; authors: { id: string; house: boolean }[] };
type Stat = 'fooled' | 'truths' | 'liked';
export type TallState = {
  ids: string[]; online: Record<string, boolean>;
  phase: Phase; q: number; turn: string; seq: number; at: number; deadline: number; hurried: boolean;
  /** Unused stories (shuffled), the four on offer, the pick, and the chooser rotation. */
  pool: Fact[]; cats: Fact[]; picked: number | null; chooser: string; rotation: number;
  fact: Fact | null; lies: Record<string, Filed>; offers: Record<string, string[]>; house: string[];
  options: Choice[]; choices: Record<string, string>; likes: Record<string, string[]>; lastPick: number;
  beats: Beat[]; stage: number; banked: number; points: Record<string, number>[];
  scores: Record<string, number>; prev: Record<string, number>; stats: Record<Stat, Record<string, number>>;
  done: boolean;
};

const own = <T>(rec: Record<string, T>, key: string): T | undefined => Object.hasOwn(rec, key) ? rec[key] : undefined;
const isTruth = (fact: Fact, text: string) => [fact.answer, ...fact.alts].some(a => same(a, text));
const mult = (s: TallState) => ROUNDS[roundOf(s.q) - 1]!.mult;

/** Trims, collapses whitespace and drops control/bidi characters; 1–45 characters. */
function clean(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_LIE * 4) throw new Error(`Keep it under ${MAX_LIE} characters.`);
  const text = raw.replace(/[\p{Cc}‪-‮⁦-⁩]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Type a lie first.');
  if (text.length > MAX_LIE) throw new Error(`Keep it under ${MAX_LIE} characters.`);
  return text;
}

function go(s: TallState, api: MiniApi, phase: Phase, span: number) {
  Object.assign(s, { phase, at: api.now, deadline: api.now + span, turn: `t${++s.seq}`, hurried: false });
}
function hold(s: TallState, api: MiniApi, spoken: number) { if (spoken) s.deadline = Math.max(s.deadline, api.now + spoken + 800); }

/** Round title card before questions 1, 4 and 7. */
function startRound(s: TallState, api: MiniApi) {
  s.prev = { ...s.scores };
  api.music('tall-tales'); api.sfx(s.q ? 'gong' : 'typewriter');
  go(s, api, 'round', ROUND_MS);
  if (s.q === QUESTIONS - 1) hold(s, api, api.say('host.final-round') + api.say('tall-tales.final'));
}

/** The next connected player in the rotation picks one of four teasers; the rotation resumes after them. */
function startPick(s: TallState, api: MiniApi) {
  const n = s.ids.length, order = Array.from({ length: n }, (_, i) => s.ids[(s.rotation + i) % n]!);
  s.chooser = order.find(id => s.online[id]) ?? order[0]!;
  s.rotation = s.ids.indexOf(s.chooser) + 1;
  s.cats = s.pool.splice(0, CATEGORIES); s.picked = null;
  api.music('tall-tales'); api.sfx('swoosh-in');
  go(s, api, 'pick', api.seconds(PICK_S));
}

function pick(s: TallState, api: MiniApi, index: number) {
  s.picked = index; s.fact = s.cats[index]!;
  s.pool.push(...s.cats.filter((_, i) => i !== index));
  api.used.add(s.fact.text);
  api.sfx('stamp');
  s.deadline = api.now + PICKED_MS;
}

function startWrite(s: TallState, api: MiniApi) {
  const fact = s.fact!;
  s.lies = {}; s.offers = {}; s.house = api.shuffle(fact.lies);
  api.sfx('typewriter'); api.speak(fact.text.replace('___', 'blank'));
  go(s, api, 'write', api.seconds(WRITE_S));
}
/** Next house lie in rotation (two players asking for help may see the same suggestion). */
function nextHouse(s: TallState) { const text = s.house.shift()!; s.house.push(text); return text; }
const filed = (s: TallState, id: string) => Object.hasOwn(s.lies, id);

/** Writing is over: absent-minded players get a house lie (their first offer if they asked for help), identical lies merge, the truth joins, decoys top up to four. */
function endWrite(s: TallState, api: MiniApi) {
  const fact = s.fact!, groups: Choice[] = [];
  for (const id of s.ids) if (!filed(s, id) && s.online[id]) s.lies[id] = { text: own(s.offers, id)?.[0] ?? nextHouse(s), house: true };
  for (const id of s.ids) {
    const lie = own(s.lies, id);
    if (!lie) continue;
    const group = groups.find(g => same(g.text, lie.text));
    if (group) group.authors.push({ id, house: lie.house });
    else groups.push({ id: '', text: lie.text, kind: 'lie', authors: [{ id, house: lie.house }] });
  }
  groups.push({ id: '', text: fact.answer, kind: 'truth', authors: [] });
  const offered = new Set(Object.values(s.offers).flat());
  for (const text of [...fact.lies.filter(l => !offered.has(l)), ...fact.lies.filter(l => offered.has(l))]) {
    if (groups.length >= MIN_OPTIONS) break;
    if (!groups.some(g => same(g.text, text))) groups.push({ id: '', text, kind: 'house', authors: [] });
  }
  s.options = api.shuffle(groups).map((g, i) => ({ ...g, id: `o${i}` }));
  s.choices = {}; s.likes = {}; s.lastPick = 0;
  api.music('vote'); api.sfx('whoosh');
  go(s, api, 'choose', api.seconds(CHOOSE_S));
}

/** Plans the reveal: fooling lies and decoys (fewest suckers first), the truth, then the readers' favourites. */
function startReveal(s: TallState, api: MiniApi) {
  const m = mult(s), pickers = (o: Choice) => s.ids.filter(id => own(s.choices, id) === o.id);
  const fooling = s.options.filter(o => o.kind !== 'truth' && pickers(o).length).sort((a, b) => pickers(a).length - pickers(b).length);
  const truth = s.options.find(o => o.kind === 'truth')!, liked = (o: Choice) => s.ids.filter(id => own(s.likes, id)?.includes(o.id)).length;
  const lead = Math.max(LEAD_MS, api.say(variant('host.reveal', api.random)) + 300), step = lieMs(fooling.length);
  let at = api.now + lead;
  const beats: Beat[] = [], points: Record<string, number>[] = [];
  for (const o of fooling) {
    const fooled = pickers(o);
    if (o.kind === 'house') { beats.push({ kind: 'house', at, id: o.id, text: o.text, fooled }); points.push({}); }
    else {
      const authors = o.authors.map(a => ({ id: a.id, points: Math.round(fooled.length * FOOL_PTS * m * (a.house ? HOUSE_RATE : 1)), ...(a.house ? { house: true as const } : {}) }));
      beats.push({ kind: 'lie', at, id: o.id, text: o.text, authors, fooled });
      points.push(Object.fromEntries(authors.map(a => [a.id, a.points])));
    }
    at += step;
  }
  const found = pickers(truth);
  beats.push({ kind: 'truth', at, id: truth.id, text: truth.text, found, points: TRUTH_PTS * m });
  points.push(Object.fromEntries(found.map(id => [id, TRUTH_PTS * m])));
  at += TRUTH_MS;
  // Every liked lie, most liked first: the TV shows the top three, phones show their own.
  const top = s.options.filter(o => o.kind === 'lie' && liked(o)).sort((a, b) => liked(b) - liked(a));
  if (top.length) {
    beats.push({ kind: 'likes', at, top: top.map(o => ({ id: o.id, text: o.text, likes: liked(o), authors: o.authors.map(a => a.id) })) });
    const gain: Record<string, number> = {};
    for (const o of s.options) if (o.kind === 'lie') for (const a of o.authors) gain[a.id] = (gain[a.id] ?? 0) + liked(o) * LIKE_PTS;
    points.push(gain); at += LIKES_MS;
  }
  Object.assign(s, { beats, points, stage: 0, banked: 0 });
  api.music('reveal'); api.sfx('drumroll');
  go(s, api, 'reveal', at - api.now);
}

/** A beat's stamp lands: bank its points, tally stats and play the reaction. */
function bank(s: TallState, api: MiniApi) {
  const beat = s.beats[s.banked]!, gain = s.points[s.banked]!;
  for (const [id, n] of Object.entries(gain)) s.scores[id]! += n;
  s.banked++;
  if (beat.kind === 'lie') {
    for (const a of beat.authors) s.stats.fooled[a.id]! += beat.fooled.length;
    api.sfx('stamp'); api.sfx(beat.fooled.length >= 3 ? 'gasp' : 'laugh');
    if (beat.fooled.length >= 3) hold(s, api, api.say('tall-tales.fooled'));
  } else if (beat.kind === 'house') { api.sfx('stamp'); api.sfx('boo'); }
  else if (beat.kind === 'truth') {
    for (const id of beat.found) s.stats.truths[id]!++;
    api.sfx('reveal'); api.sfx(beat.found.length ? 'correct' : 'aww');
    if (!beat.found.length) hold(s, api, api.say('tall-tales.nobody'));
    else if (beat.found.length > 1) api.sfx('applause');
  } else {
    for (const o of s.options) if (o.kind === 'lie') for (const a of o.authors) s.stats.liked[a.id]! += s.ids.filter(id => own(s.likes, id)?.includes(o.id)).length;
    api.sfx('sparkle'); api.sfx('score-up');
  }
}

function afterReveal(s: TallState, api: MiniApi) {
  if (s.q === QUESTIONS - 1) { api.music('finale'); api.sfx('fanfare'); api.sfx('applause'); go(s, api, 'final-scores', FINAL_MS); hold(s, api, api.say(variant('host.winner', api.random))); return; }
  if (s.q === 2 || s.q === 5) { api.music('tall-tales'); go(s, api, 'scores', SCORES_MS); hold(s, api, api.say('host.scores')); return; }
  s.q++; startPick(s, api);
}

export const server: MiniServer<TallState, TallPublic, TallPrivate> = {
  id: 'tall-tales',
  create(players, api) {
    const ids = players.map(p => p.id), zero = () => Object.fromEntries(ids.map(id => [id, 0]));
    // Stories told earlier tonight go to the back of the deck; every pick marks its story as told.
    const pool = freshDeck(api, factPool(api.settings.family), f => f.text);
    const s: TallState = {
      ids, online: Object.fromEntries(players.map(p => [p.id, p.connected])),
      phase: 'round', q: 0, turn: '', seq: 0, at: api.now, deadline: api.now, hurried: false,
      pool, cats: [], picked: null, chooser: ids[0]!, rotation: Math.floor(api.random() * ids.length),
      fact: null, lies: {}, offers: {}, house: [], options: [], choices: {}, likes: {}, lastPick: 0,
      beats: [], stage: 0, banked: 0, points: [],
      scores: zero(), prev: zero(), stats: { fooled: zero(), truths: zero(), liked: zero() }, done: false,
    };
    startRound(s, api);
    return s;
  },

  action(s, id, raw, api) {
    if (!s.ids.includes(id)) throw new Error('You are watching this one.');
    const a = record(raw);
    if (a.turn !== s.turn) throw new Error('Too late! The game has moved on.');
    const option = (value: unknown) => { const o = s.options.find(x => x.id === value); if (!o) throw new Error('That answer is not on the list.'); return o; };
    const mine = (o: Choice) => o.authors.some(x => x.id === id);
    switch (a.k) {
      case 'pick': {
        record(a, ['turn', 'k', 'index']);
        if (s.phase !== 'pick') throw new Error('No story to pick right now.');
        if (id !== s.chooser) throw new Error('It’s not your turn to pick.');
        if (s.picked !== null) throw new Error('The story is already picked.');
        return pick(s, api, integer(a.index, 0, s.cats.length - 1));
      }
      case 'lie': case 'help': case 'house': {
        record(a, a.k === 'lie' ? ['turn', 'k', 'text'] : a.k === 'house' ? ['turn', 'k', 'index'] : ['turn', 'k']);
        if (s.phase !== 'write') throw new Error('Writing is closed.');
        if (filed(s, id)) throw new Error('Your lie is already filed.');
        if (a.k === 'help') {
          if (!own(s.offers, id)) { s.offers[id] = [nextHouse(s), nextHouse(s)]; api.sfx('pop'); }
          return;
        }
        if (a.k === 'house') {
          const offers = own(s.offers, id);
          if (!offers) throw new Error('Tap “Lie for me” first.');
          s.lies[id] = { text: offers[integer(a.index, 0, offers.length - 1)]!, house: true }; api.sfx('boing');
          return;
        }
        const text = clean(a.text);
        if (isTruth(s.fact!, text)) throw new Error('That’s the truth! Write a lie instead.');
        s.lies[id] = { text, house: false }; api.sfx('submit');
        return;
      }
      case 'choose': {
        record(a, ['turn', 'k', 'option']);
        if (s.phase !== 'choose') throw new Error('Choosing is closed.');
        if (Object.hasOwn(s.choices, id)) throw new Error('Your pick is already in.');
        const o = option(a.option);
        if (mine(o)) throw new Error('That’s your own lie!');
        s.choices[id] = o.id; s.lastPick = api.now; api.sfx('vote');
        return;
      }
      case 'like': {
        record(a, ['turn', 'k', 'option', 'on']);
        if (s.phase !== 'choose') throw new Error('Choosing is closed.');
        if (typeof a.on !== 'boolean') throw new Error('Expected on or off.');
        const o = option(a.option), likes = own(s.likes, id) ?? [];
        if (mine(o)) throw new Error('No liking your own lie!');
        if (!a.on) { s.likes[id] = likes.filter(x => x !== o.id); return; }
        if (likes.includes(o.id)) return;
        if (likes.length >= LIKES) throw new Error(`Only ${LIKES} likes per story.`);
        s.likes[id] = [...likes, o.id]; api.sfx('pop');
        return;
      }
      default: throw new Error('Unknown move.');
    }
  },

  tick(s, api) {
    const now = api.now, t = now - s.at, online = s.ids.filter(id => s.online[id]);
    switch (s.phase) {
      case 'round':
        if (now >= s.deadline) startPick(s, api);
        return;
      case 'pick':
        if (s.picked === null && (now >= s.deadline || (!s.online[s.chooser] && t >= MIN_READ_MS))) pick(s, api, Math.floor(api.random() * s.cats.length));
        else if (s.picked !== null && now >= s.deadline) startWrite(s, api);
        return;
      case 'write': {
        if (online.length && online.every(id => filed(s, id)) && t >= MIN_READ_MS) { api.say('host.everyone-in'); return endWrite(s, api); }
        if (now >= s.deadline) { api.sfx('timeup'); api.say(variant('host.timeup', api.random)); return endWrite(s, api); }
        if (!s.hurried && s.deadline - now <= 10_000 && s.deadline - s.at > 20_000) { s.hurried = true; api.sfx('tick-fast'); api.say(variant('host.hurry', api.random)); }
        return;
      }
      case 'choose': {
        const all = online.length > 0 && online.every(id => Object.hasOwn(s.choices, id));
        if ((all && t >= MIN_READ_MS && now - s.lastPick >= LIKE_GRACE_MS) || now >= s.deadline) startReveal(s, api);
        return;
      }
      case 'reveal': {
        // Catch up on every beat whose time has passed, so a slow tick never skips points.
        while (s.stage < s.beats.length && now >= s.beats[s.stage]!.at) { s.stage++; api.sfx(s.beats[s.stage - 1]!.kind === 'truth' ? 'drumroll' : 'swoosh-in'); }
        while (s.banked < s.stage && now >= stampAt(s.beats[s.banked]!)) bank(s, api);
        if (now >= s.deadline && s.banked === s.beats.length) afterReveal(s, api);
        return;
      }
      case 'scores':
        if (now >= s.deadline) { s.q++; startRound(s, api); }
        return;
      case 'final-scores':
        if (now >= s.deadline) s.done = true;
    }
  },

  presence(s, id, connected) { if (Object.hasOwn(s.online, id)) s.online[id] = connected; },

  publicView(s) {
    const pub: TallPublic = { phase: s.phase, turn: s.turn, q: s.q, round: roundOf(s.q), at: s.at, deadline: s.deadline, scores: { ...s.scores }, done: [] };
    if (s.phase === 'scores' || s.phase === 'final-scores' || s.phase === 'round') pub.prev = { ...s.prev };
    if (s.phase === 'pick') Object.assign(pub, { chooser: s.chooser, cats: s.cats.map(f => f.teaser) }, s.picked === null ? {} : { picked: s.picked });
    if (s.fact && (s.phase === 'write' || s.phase === 'choose' || s.phase === 'reveal')) pub.fact = { teaser: s.fact.teaser, text: s.fact.text };
    if (s.phase === 'write') pub.done = s.ids.filter(id => filed(s, id));
    if (s.phase === 'choose') pub.done = s.ids.filter(id => Object.hasOwn(s.choices, id));
    if (s.phase === 'choose' || s.phase === 'reveal') pub.options = s.options.map(o => ({ id: o.id, text: o.text }));
    if (s.phase === 'reveal') pub.beats = structuredClone(s.beats.slice(0, s.stage));
    return pub;
  },

  playerView(s, id) {
    const me: TallPrivate = { turn: s.turn };
    if (s.phase === 'pick' && id === s.chooser && s.picked === null) me.chooser = true;
    if (s.phase === 'write') {
      const lie = own(s.lies, id), offers = own(s.offers, id);
      if (lie) Object.assign(me, { lie: lie.text }, lie.house ? { house: true } : {});
      else if (offers) me.offers = [...offers];
    }
    if (s.phase === 'choose' || s.phase === 'reveal') {
      const choice = own(s.choices, id), likes = own(s.likes, id);
      me.mine = s.options.filter(o => o.authors.some(a => a.id === id)).map(o => o.id);
      if (choice) me.choice = choice;
      if (likes?.length) me.likes = [...likes];
    }
    return me;
  },

  result(s): MiniResult | null {
    if (!s.done) return null;
    const top = Math.max(...s.ids.map(id => s.scores[id]!)), awards: { title: string; playerId: string }[] = [];
    // Shared awards are fine for a pair; three or more tied leaders get none.
    const best = (title: string, rec: Record<string, number>) => {
      const max = Math.max(...s.ids.map(id => rec[id]!)), who = s.ids.filter(id => rec[id] === max);
      if (max > 0 && who.length <= 2) for (const playerId of who) awards.push({ title, playerId });
    };
    best('Master Liar', s.stats.fooled); best('Truth Seeker', s.stats.truths); best('Most Liked', s.stats.liked);
    const fooled = Object.values(s.stats.fooled).reduce((a, b) => a + b, 0);
    return {
      scores: { ...s.scores }, winners: top > 0 ? s.ids.filter(id => s.scores[id] === top) : [], ...(awards.length ? { awards } : {}),
      headline: fooled ? `Extra! Extra! ${fooled} ${fooled === 1 ? 'reader swallowed a lie' : 'readers swallowed lies'} whole.` : 'Extra! Extra! Nobody believed a word.',
    };
  },
};
export default server;
