import { MAX_ROOM_PLAYERS, type GameRules } from '../../../party-contract/src/index';
import { LAP_SECONDS, ROUND_MS, colors, defaults, houseRules, options, points, roundCount, tableCount, type Action, type Card, type Color, type FloorTile, type GameEvent, type HandResult, type Match, type PrivateView, type PublicView, type Settings, type TableView, type Value } from './types';

/** i is the player's place in the roster; table is where they sit and was where they sat last round (-1 before any move). */
type Player = { i: number; id: string; name: string; color: string; connected: boolean; hand: Card[]; score: number; handsWon: number; safe: boolean; table: number; was: number };
type Play = Extract<Action, { kind: 'play' }>;
/** One table's cards and turn order. seats holds roster indices and current indexes seats; window.p and pending.from are roster indices. lap: after the bell, the players still owed a last turn. */
export type Table = {
  id: number; seats: number[]; phase: TableView['phase']; deck: Card[]; discard: Card[]; color: Color; hand: number; revision: number; turn: number; current: number; direction: 1 | -1; deadline: number;
  /** A fresh +4 records the color it replaced (before) and whether its player held that color (bluff); a stacked +4 can't bluff. */
  pending: { count: number; kind: 'draw2' | 'wild4'; from: number; bluff: boolean; before: Color | null } | null;
  drawn: string | null; window: TableView['ichiWindow']; windows: number; lap: number[] | null; events: GameEvent[]; seq: number;
  result: HandResult | null; endedAt: number; nextHandAt: number | null; ready: number[]; shown: number;
};
/** parlor: several tables play timed rounds. nextAt: when a finished round or match moves on. rev counts changes of the public view, whose JSON is sig. */
export type State = {
  settings: Settings; rng: number; now: number; phase: Match['phase']; parlor: boolean; players: Player[]; tables: Table[];
  round: number; rounds: number; bellAt: number | null; rung: boolean; nextAt: number | null; pausedAt: number; ready: number[]; finishReason: string;
  feature: number; cutAt: number; floor: FloorTile[]; floorAt: number; rev: number; sig: string;
};

const TURN_CAP = 400, HAND_CAP = 12, HAND_MAX = 30, WINDOW_MS = 5000, AWAY_MS = 5000, BREAK_MS = 10000, EARLY_MS = 3000;
/** Parlor pacing: the pause between a table's hands, no new deal this close to the bell, the reseating pause and its shortest form, how long a finished hand or match stays up, and how often the floor rail refreshes. */
const TABLE_BREAK_MS = 8000, DEAL_MS = 30000, SEAT_MS = 14000, SEAT_EARLY_MS = 5000, SHOW_MS = 4500, FINALE_MS = 6000, FLOOR_MS = 2000;
const STALE = 'Too slow — the table moved on.';
function fail(message: string): never { throw new Error(message); }
const record = (raw: unknown) => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : fail('Expected an object.');
const text = (v: unknown, message: string) => typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : fail(message);
const clock = (s: State, now: number) => Number.isFinite(now) ? Math.max(now, s.now) : s.now;
const numeric = (v: Value) => /^\d$/.test(v);
const title = (w: string) => w[0].toUpperCase() + w.slice(1);
const name = (c: Card) => { const v = ({ skip: 'Skip', reverse: 'Reverse', draw2: '+2', gift: 'Gift', wild: 'Wild', wild4: 'Wild +4' } as Record<string, string>)[c.value] ?? c.value; return c.color === 'wild' ? v : `${title(c.color)} ${v}`; };
const handId = (s: State, t: Table) => s.parlor ? `r${s.round}t${t.id + 1}h${t.hand}` : `h${t.hand}`;
const turnId = (s: State, t: Table) => `${handId(s, t)}:${t.revision}`;
const top = (t: Table) => t.discard[t.discard.length - 1];
const next = (t: Table, i: number, steps = 1) => ((i + t.direction * steps) % t.seats.length + t.seats.length) % t.seats.length;
const seated = (s: State, t: Table) => t.seats.map(i => s.players[i]);
const who = (s: State, t: Table, i = t.current) => s.players[t.seats[i]];
const sum = (cards: Card[]) => cards.reduce((n, c) => n + points(c), 0);
const leaders = (s: State) => { const best = Math.max(...s.players.map(p => p.score)); return s.players.filter(p => p.score === best); };
function random(s: State, max: number) { s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return Math.floor(s.rng / 4294967296 * max); }
function shuffle<T>(s: State, values: T[]) { for (let i = values.length - 1; i > 0; i--) { const j = random(s, i + 1); [values[i], values[j]] = [values[j], values[i]]; } return values; }
function event(t: Table, e: Omit<GameEvent, 'seq'>) { t.events = [...t.events, { seq: ++t.seq, ...e }].slice(-12); }

const faces: Value[] = ['0', ...(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'] as const).flatMap(v => [v, v])];
/** Card ids are unique across the room: each table numbers its own thousand. */
function build(copies: number, gifts: boolean, table: number) {
  const cards: Card[] = [], add = (color: Card['color'], value: Value) => cards.push({ id: `c${table * 1000 + cards.length}`, color, value });
  for (let k = 0; k < copies; k++) {
    for (const color of colors) for (const value of gifts ? [...faces, 'gift' as const] : faces) add(color, value);
    for (const value of ['wild', 'wild4'] as const) for (let i = 0; i < 4; i++) add('wild', value);
  }
  return cards;
}
const table = (id: number, seats: number[]): Table => ({ id, seats, phase: 'idle', deck: [], discard: [], color: 'coral', hand: 0, revision: 0, turn: 0, current: 0, direction: 1, deadline: 0, pending: null, drawn: null, window: null, windows: 0, lap: null, events: [], seq: 0, result: null, endedAt: 0, nextHandAt: null, ready: [], shown: 0 });

const challengeable = (s: State, t: Table) => s.settings.challenge && t.pending?.kind === 'wild4' && !!t.pending.before;
const matches = (t: Table, c: Card) => c.color === 'wild' || c.color === t.color || c.value === top(t).value;
/** Why the current player can't play c right now ('' means legal). */
function why(s: State, t: Table, c: Card) {
  if (t.pending) return s.settings.stacking && (c.value === 'wild4' || c.value === 'draw2' && t.pending.kind === 'draw2') ? '' : s.settings.stacking ? `Stack ${t.pending.kind === 'draw2' ? 'a +2 or +4' : 'a +4'}, or take the cards.` : 'Take the cards or challenge the +4.';
  if (t.drawn && t.drawn !== c.id) return 'Play the card you drew, or keep it.';
  return matches(t, c) ? '' : 'That card doesn’t match the color or symbol.';
}
/** Why another player can't jump in with c ('' means legal). */
const jumpWhy = (s: State, t: Table, c: Card) => !s.settings.jumpIn ? 'Wait for your turn.' : t.pending || t.drawn || t.lap ? 'No jumping in right now.'
  : c.color === 'wild' || c.color !== top(t).color || c.value !== top(t).value ? 'Jump in only with the exact same card.' : '';

/** A hand that grew is no longer safe on one card, and any race over it is off. */
function grew(t: Table, p: Player) { p.safe = false; if (t.window?.p === p.i) t.window = null; }
function draw(s: State, t: Table, p: Player, count: number) {
  const got: Card[] = [];
  while (got.length < count && p.hand.length < HAND_MAX) {
    if (!t.deck.length && t.discard.length > 1) { t.deck = shuffle(s, t.discard.splice(0, t.discard.length - 1)); event(t, { kind: 'draw', text: 'The discard pile was reshuffled.' }); }
    const c = t.deck.pop(); if (!c) break;
    p.hand.push(c); got.push(c);
  }
  if (got.length) grew(t, p);
  return got;
}
function penalty(s: State, t: Table, p: Player, count: number) {
  const got = draw(s, t, p, count).length;
  event(t, { kind: 'penalty', text: `${p.name} draws ${got}${got < count ? ` (${count - got} short)` : ''}.`, by: p.i, count: got });
}
/** After the bell every turn is short. */
const limit = (s: State, t: Table) => (t.lap ? Math.min(s.settings.turnSeconds, LAP_SECONDS) : s.settings.turnSeconds) * 1000;
const schedule = (s: State, t: Table, now: number) => { t.deadline = now + (who(s, t).connected ? limit(s, t) : AWAY_MS); };
/**
 * Passes the turn. After the bell the player who just played and anyone skipped have had their last turn, and the turn goes to the nearest
 * seat still owed one: a Reverse can't hand anybody a second. A +2 or +4 played with the hand's last turn still lands; nobody is left to answer it.
 */
function advance(s: State, t: Table, now: number, steps = 1) {
  t.drawn = null; t.revision++; t.turn++;
  const gone = Array.from({ length: steps }, (_, k) => t.seats[next(t, t.current, k)]), lap = t.lap && t.lap.filter(i => !gone.includes(i));
  if (lap && !lap.length || t.turn >= TURN_CAP) { if (t.pending) penalty(s, t, who(s, t, next(t, t.current)), t.pending.count); return endHand(s, t, now); }
  t.lap = lap; t.current = next(t, t.current, steps);
  while (lap && !lap.includes(t.seats[t.current])) t.current = next(t, t.current);
  schedule(s, t, now);
}
function accept(s: State, t: Table, p: Player, now: number) { const { count } = t.pending!; t.pending = null; penalty(s, t, p, count); advance(s, t, now); }
/** Closes the catch window in the offender's favor. */
function settle(s: State, t: Table) { const o = s.players[t.window!.p]; o.safe = true; t.window = null; event(t, { kind: 'ichi', text: `${o.name} slipped through — safe.`, by: o.i }); }
function moved(t: Table, p: Player) { p.safe = p.hand.length === 1; if (t.window?.p === p.i) t.window = null; }

function startHand(s: State, t: Table, now: number) {
  Object.assign(t, { phase: 'playing', hand: t.hand + 1, revision: 0, turn: 0, direction: 1, pending: null, drawn: null, window: null, lap: null, result: null, nextHandAt: null, ready: [] });
  t.deck = shuffle(s, build(t.seats.length >= 7 ? 2 : 1, s.settings.gifts, t.id)); t.discard = [];
  for (const p of seated(s, t)) { p.hand = t.deck.splice(t.deck.length - s.settings.handSize); p.safe = false; }
  t.discard.push(t.deck.splice(t.deck.findIndex(c => numeric(c.value)), 1)[0]); t.color = top(t).color as Color;
  t.current = (t.hand - 1) % t.seats.length; schedule(s, t, now);
  if (!s.parlor) s.phase = 'playing';
  event(t, { kind: 'deal', text: `Hand ${t.hand} · ${who(s, t).name} leads.`, by: who(s, t).i, card: { ...top(t) } });
}
/** The match is decided; the final table stays up for a moment before the results. */
function finish(s: State, now: number, how: string) {
  const best = leaders(s);
  Object.assign(s, { phase: 'complete', nextAt: now + FINALE_MS, bellAt: null, finishReason: `${how} ${best.length > 3 ? `${best.length} players` : best.map(p => p.name).join(' & ')} ${best.length > 1 ? 'share the win' : 'wins'} with ${best[0].score} pts.` });
}
/** Ends the hand. Without a winner (the bell's final lap or the 400-turn cap) the fewest cards, then fewest points, wins; a hand the bell cut short pays half. */
function endHand(s: State, t: Table, now: number, winner?: Player) {
  const sat = seated(s, t), bell = !!t.lap && !winner;
  let reason = winner ? `${winner.name} went out.` : '';
  if (!winner) {
    const key = (p: Player) => p.hand.length * 10000 + sum(p.hand), best = Math.min(...sat.map(key)), tied = sat.filter(p => key(p) === best), cause = bell ? 'The bell' : 'Turn limit';
    winner = tied.length === 1 ? tied[0] : undefined;
    reason = winner ? `${cause} — ${winner.name} holds the fewest cards${bell ? ' and takes half the pot' : ''}.` : `${cause} — tied for the fewest cards.`;
  }
  const hands = sat.map(p => ({ p: p.i, cards: p.hand.map(c => ({ ...c })), points: sum(p.hand) }));
  const pot = winner ? hands.reduce((n, h) => h.p === winner.i ? n : n + h.points, 0) : 0, won = bell ? Math.ceil(pot / 2) : pot;
  if (winner) { winner.score += won; winner.handsWon++; }
  t.result = { winner: winner?.i ?? null, points: won, reason, hands };
  Object.assign(t, { phase: 'idle', pending: null, drawn: null, window: null, lap: null, revision: t.revision + 1, endedAt: now, nextHandAt: null, ready: [] });
  event(t, winner ? { kind: 'handEnd', text: `${winner.name} wins hand ${t.hand} · +${won}`, by: winner.i, count: won } : { kind: 'handEnd', text: `Hand ${t.hand} is a draw.` });
  if (s.parlor) {
    if (!s.rung && s.bellAt! - now >= DEAL_MS) { t.phase = 'intermission'; t.nextHandAt = now + TABLE_BREAK_MS; }
    survey(s, now, true); return closing(s, now);
  }
  const score = leaders(s)[0].score, target = s.settings.target;
  if (target && score < target && t.hand < HAND_CAP) { t.phase = s.phase = 'intermission'; t.nextHandAt = now + BREAK_MS; return; }
  finish(s, now, !target ? 'One-hand match.' : score >= target ? `${target} points reached.` : `${HAND_CAP} hands played.`);
}
/** Starts the next hand early once every connected player is ready and 3 s have passed; the parlor's reseating pause shortens the same way. */
function hurry(s: State, t: Table) {
  const all = (players: Player[], ready: number[]) => players.every(p => !p.connected || ready.includes(p.i));
  if (s.phase === 'seating') { if (all(s.players, s.ready)) s.nextAt = Math.min(s.nextAt!, s.pausedAt + SEAT_EARLY_MS); }
  else if (t.phase === 'intermission' && all(seated(s, t), t.ready)) t.nextHandAt = Math.min(t.nextHandAt!, t.endedAt + EARLY_MS);
}

/** Seats everyone for the next round: by lot at first, then by standing, so table 1 holds the leaders. Earlier tables take the spare seats. */
function seat(s: State) {
  const place = (p: Player) => s.tables[p.table].seats.indexOf(p.i);
  const order = s.round ? [...s.players].sort((a, b) => b.score - a.score || b.handsWon - a.handsWon || a.table - b.table || place(a) - place(b)) : shuffle(s, [...s.players]);
  const count = tableCount(order.length, s.settings.tableSize), base = Math.floor(order.length / count), extra = order.length % count;
  s.tables = Array.from({ length: count }, (_, id) => table(id, order.splice(0, base + (id < extra ? 1 : 0)).map(p => { p.was = s.round ? p.table : -1; p.table = id; p.hand = []; return p.i; })));
}
function startRound(s: State, now: number) {
  Object.assign(s, { round: s.round + 1, phase: 'playing', rung: false, bellAt: now + ROUND_MS, nextAt: null, ready: [], feature: 0, cutAt: now });
  for (const t of s.tables) startHand(s, t, now);
  survey(s, now, true);
}
/** Once every table is done the round lingers on its last hands for a moment (nextAt), then reseats or ends the match. */
function closing(s: State, now: number) { if (s.nextAt === null && s.tables.every(t => t.phase === 'idle')) s.nextAt = now + SHOW_MS; }
function endRound(s: State, now: number) {
  if (s.round >= s.rounds) return finish(s, now, s.rounds === 1 ? 'One round played.' : `${s.rounds} rounds played.`);
  seat(s); Object.assign(s, { phase: 'seating', bellAt: null, nextAt: now + SEAT_MS, pausedAt: now, ready: [] }); survey(s, now, true);
}
/** The bell: no table deals again, and every hand still in play gets a final lap: one short last turn each, starting with the turn in progress. */
function ring(s: State, now: number) {
  s.rung = true;
  for (const t of s.tables) {
    if (t.phase === 'intermission') { t.phase = 'idle'; t.nextHandAt = null; }
    if (t.phase !== 'playing') continue;
    t.lap = [...t.seats]; t.deadline = Math.min(t.deadline, now + limit(s, t));
    event(t, { kind: 'bell', text: 'The bell! One last turn each.' });
  }
  closing(s, now);
}
/** The TV's director. A race, a hand about to end or a growing stack pulls the camera; a finished hand lets it go; nothing holds it past 14 s. */
function direct(s: State, now: number) {
  if (!s.parlor || s.phase !== 'playing') return;
  const heat = (t: Table) => {
    if (t.phase !== 'playing') return t.phase === 'intermission' || t.result && now - t.endedAt < SHOW_MS ? now - t.endedAt < SHOW_MS ? 50 : -500 : -1000;
    const low = Math.min(...seated(s, t).map(p => p.hand.length));
    return 10 + (t.window ? 80 : 0) + (low === 1 ? 40 : low === 2 ? 15 : 0) + (t.pending ? 10 + 3 * t.pending.count : 0) + (t.lap ? 20 : 0) + (t.id ? 0 : 5);
  };
  const rank = (t: Table) => heat(t) + Math.min(60, (now - t.shown) / 1000), on = s.tables[s.feature], dwell = now - s.cutAt;
  const best = s.tables.reduce((a, b) => b !== on && (a === on || rank(b) > rank(a)) ? b : a);
  if (best !== on && heat(best) >= 0 && (heat(on) < 0 ? dwell >= 1500 : dwell >= 14000 || dwell >= 6000 && heat(best) >= heat(on) + 40)) { s.feature = best.id; s.cutAt = now; }
  s.tables[s.feature].shown = now;
}
/** Refreshes the floor rail, at most every two seconds unless a hand or round just changed: each refresh resends the shared view to the whole room. */
function survey(s: State, now: number, force = false) {
  if (!s.parlor || !force && now - s.floorAt < FLOOR_MS) return;
  s.floorAt = now;
  s.floor = s.tables.map(t => ({ id: t.id, phase: t.phase, hand: t.hand, color: t.color, top: top(t)?.value ?? '0', current: t.phase === 'playing' ? t.seats[t.current] : -1, seats: [...t.seats], counts: seated(s, t).map(p => p.hand.length), ichi: !!t.window, pending: t.pending?.count ?? 0 }));
}

function play(s: State, t: Table, p: Player, c: Card, a: Play, target: Player | undefined, give: Card | undefined, jump: boolean, now: number) {
  const stack = !!t.pending, before = t.color, bluff = c.value === 'wild4' && !stack && p.hand.some(h => h !== c && h.color === before);
  const count = (t.pending?.count ?? 0) + (c.value === 'draw2' ? 2 : 4);
  p.hand.splice(p.hand.indexOf(c), 1); t.discard.push(c); t.color = c.color === 'wild' ? a.color! : c.color;
  t.current = t.seats.indexOf(p.i); t.drawn = null;
  const victim = who(s, t, next(t, t.current));
  event(t, { kind: jump ? 'jump' : stack ? 'stack' : 'play', text: jump ? `${p.name} jumped in with ${name(c)}!` : stack ? `${p.name} stacked ${name(c)} → ${count}!` : `${p.name} played ${name(c)}.`, by: p.i, card: { ...c } });
  if (c.color === 'wild') event(t, { kind: 'color', text: `${title(t.color)} is up.`, by: p.i });
  // The gift itself stays face down: only its two players ever know which card moved.
  if (give) { p.hand.splice(p.hand.indexOf(give), 1); target!.hand.push(give); grew(t, target!); event(t, { kind: 'gift', text: `${p.name} handed ${target!.name} a card.`, by: p.i, to: target!.i }); }
  // A final +2/+4 still lands; the hand is over, so nobody can stack or challenge it.
  if (!p.hand.length) { if (c.value === 'draw2' || c.value === 'wild4') penalty(s, t, victim, count); return endHand(s, t, now, p); }
  if (s.settings.sevenZero && c.value === '7' && target) {
    [p.hand, target.hand] = [target.hand, p.hand]; moved(t, p); moved(t, target);
    event(t, { kind: 'swap', text: `${p.name} swapped hands with ${target.name}.`, by: p.i, to: target.i });
  } else if (s.settings.sevenZero && c.value === '0') {
    const sat = seated(s, t), hands = sat.map(o => o.hand); sat.forEach((o, i) => { o.hand = hands[next(t, i, -1)]; moved(t, o); });
    event(t, { kind: 'rotate', text: 'Every hand passed along!', by: p.i });
  } else if (p.hand.length === 1 && !p.safe) {
    if (t.window) settle(s, t);
    t.window = { id: `${handId(s, t)}:ichi${++t.windows}`, p: p.i, until: now + WINDOW_MS };
  }
  let steps = 1;
  if (c.value === 'reverse') { t.direction = -t.direction as 1 | -1; event(t, { kind: 'reverse', text: t.seats.length === 2 ? `Reverse — ${victim.name} is skipped.` : 'Direction reversed.', by: p.i }); }
  if (c.value === 'skip' || c.value === 'reverse' && t.seats.length === 2) steps = 2;
  if (c.value === 'skip') event(t, { kind: 'skip', text: `${victim.name} is skipped.`, to: victim.i });
  if (c.value === 'draw2' || c.value === 'wild4') {
    if (s.settings.stacking || c.value === 'wild4' && s.settings.challenge) t.pending = { count, kind: c.value, from: p.i, bluff, before: c.value === 'wild4' && !stack ? before : null };
    else { penalty(s, t, victim, count); steps = 2; }
  }
  advance(s, t, now, steps);
}

function apply(s: State, id: string, raw: unknown, rawNow: number) {
  const a = rules.parseAction(raw), p = s.players.find(p => p.id === id) ?? fail('You are not seated at this table.'), now = clock(s, rawNow);
  if (s.phase === 'complete') fail('The match is over.');
  const t = s.tables[p.table], between = s.phase === 'seating';
  if (a.kind === 'next') {
    const ready = between ? s.ready : t.ready;
    if (between ? a.turnId !== `r${s.round}` : t.phase !== 'intermission' || a.turnId !== handId(s, t)) fail('The next hand has already started.');
    if (ready.includes(p.i)) fail('You are already ready.');
    s.now = now; ready.push(p.i); return hurry(s, t);
  }
  if (between || t.phase !== 'playing') fail('The next hand hasn’t started yet.');
  const w = t.window;
  if (a.kind === 'catch' || a.kind === 'ichi' && w?.id === a.turnId) {
    if (!w || w.id !== a.turnId || now >= w.until) fail('Too slow — that catch window already closed.');
    if (a.kind === 'catch' && w.p === p.i) fail('Call Ichi! instead.');
    if (a.kind === 'ichi' && w.p !== p.i) fail('Only the player on one card can call it.');
    const o = s.players[w.p]; s.now = now; t.window = null;
    if (a.kind === 'ichi') { o.safe = true; event(t, { kind: 'ichi', text: `${o.name} won the race — Ichi!`, by: o.i }); return; }
    const got = draw(s, t, o, 2).length; event(t, { kind: 'catch', text: `${p.name} caught ${o.name}! +${got}`, by: p.i, to: o.i, count: got, success: true }); return;
  }
  // A press that names a race lost it: the window closed or a catch got there first.
  if (a.kind === 'ichi') fail(/:ichi\d+$/.test(a.turnId) ? 'Too slow — that catch window already closed.' : 'Call Ichi! once you’re down to one card.');
  if (a.turnId !== turnId(s, t)) fail(STALE);
  if (now >= t.deadline) fail('Time’s up for this turn.');
  const mine = who(s, t) === p;
  if (a.kind === 'play') {
    const c = p.hand.find(c => c.id === a.cardId) ?? fail('That card isn’t in your hand.'), reason = mine ? why(s, t, c) : jumpWhy(s, t, c);
    if (reason) fail(reason);
    if (c.color === 'wild' && !a.color) fail('Choose the next color.');
    const give = c.value === 'gift' && p.hand.length > 1 ? p.hand.find(h => h.id === a.give && h !== c) ?? fail('Choose a card to give away.') : undefined;
    const target = give || s.settings.sevenZero && c.value === '7' && p.hand.length > 1 ? seated(s, t).find(o => o.id === a.target && o !== p) ?? fail(give ? 'Choose who gets your card.' : 'Choose a player to swap with.') : undefined;
    if (give && target!.hand.length >= HAND_MAX) fail(`${target!.name} can’t hold any more cards.`);
    s.now = now; return play(s, t, p, c, a, target, give, !mine, now);
  }
  if (!mine) fail('Wait for your turn.');
  if (a.kind === 'challenge' && !challengeable(s, t)) fail(t.pending?.kind === 'wild4' && s.settings.challenge ? 'A stacked +4 can’t be a bluff.' : 'There’s no +4 to challenge.');
  if (a.kind === 'keep' && !t.drawn) fail('Draw a card first.');
  if (a.kind === 'draw' && t.drawn) fail('Play the card you drew, or keep it.');
  s.now = now;
  if (a.kind === 'keep') { event(t, { kind: 'draw', text: `${p.name} kept the card.`, by: p.i }); return advance(s, t, now); }
  if (a.kind === 'challenge') {
    const { count, bluff, from, before } = t.pending!, o = s.players[from], was = title(before!); t.pending = null;
    event(t, { kind: 'challenge', text: bluff ? `${o.name} had ${was}! Draws ${count}.` : `No bluff. ${p.name} draws ${count + 2}.`, by: p.i, to: o.i, success: bluff });
    if (!bluff) { penalty(s, t, p, count + 2); return advance(s, t, now); }
    penalty(s, t, o, count); t.revision++; return schedule(s, t, now);
  }
  if (t.pending) return accept(s, t, p, now);
  let got: Card | undefined, n = 0;
  do { got = draw(s, t, p, 1)[0]; if (got) n++; } while (got && s.settings.drawUntilPlayable && !matches(t, got));
  event(t, { kind: 'draw', text: n ? `${p.name} drew ${n === 1 ? 'a card' : `${n} cards`}.` : `${p.name} couldn’t draw.`, by: p.i, count: n });
  if (got && matches(t, got)) { t.drawn = got.id; t.revision++; } else advance(s, t, now);
}

function tableView(s: State, t: Table, events = 12): TableView {
  return {
    id: t.id, phase: t.phase, handId: handId(s, t), hand: t.hand, turnId: turnId(s, t), turn: t.turn, deadline: t.deadline, current: t.seats[t.current], direction: t.direction,
    color: t.color, top: { ...top(t) }, drawCount: t.deck.length, discardCount: t.discard.length,
    pending: t.pending && { count: t.pending.count, kind: t.pending.kind, from: t.pending.from, before: t.pending.before, challengeable: challengeable(s, t) },
    drawn: !!t.drawn, ichiWindow: t.window && { ...t.window }, lap: t.lap && t.lap.length, events: structuredClone(t.events.slice(-events)),
    seats: seated(s, t).map(p => ({ p: p.i, count: p.hand.length, safe: p.safe })), handResult: t.result && structuredClone(t.result), nextHandAt: t.nextHandAt, ready: [...t.ready],
  };
}
const shared = (s: State): Omit<PublicView, 'rev'> => ({
  match: { phase: s.phase, parlor: s.parlor, round: s.round, rounds: s.rounds, bellAt: s.bellAt, rung: s.rung, nextAt: s.nextAt, ready: [...s.ready], featured: s.feature, winners: s.phase === 'complete' ? leaders(s).map(p => p.i) : [], finishReason: s.finishReason },
  settings: { ...s.settings },
  roster: s.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, score: p.score, handsWon: p.handsWon, table: p.table, was: p.was })),
  feature: s.phase === 'seating' ? null : tableView(s, s.tables[s.feature]), floor: structuredClone(s.floor),
});
/** Every way into the rules ends here: rev moves exactly when the public view does, which is what lets it ride in the snapshot cache. */
function sync(s: State) { const sig = JSON.stringify(shared(s)); if (sig !== s.sig) { s.sig = sig; s.rev++; } }
/** When tick next has something to do. Tests and offline simulations step straight to it. */
export const due = (s: State) => s.phase === 'complete' || s.phase === 'seating' ? s.nextAt! : Math.min(s.nextAt ?? Infinity, s.parlor && !s.rung ? s.bellAt! : Infinity,
  ...s.tables.map(t => t.phase === 'intermission' ? t.nextHandAt! : t.phase === 'playing' ? Math.min(t.deadline, t.window?.until ?? Infinity) : Infinity));

export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings(raw) {
    const value = record(raw);
    if (Object.keys(value).some(k => !Object.hasOwn(defaults, k))) fail('Unknown Ichi setting.');
    const s: Record<string, unknown> = { ...defaults, ...value };
    if (Object.keys(houseRules).some(k => typeof s[k] !== 'boolean')) fail('House rules must be on or off.');
    for (const [k, list] of Object.entries(options)) if (!(list as readonly unknown[]).includes(s[k])) fail(`Invalid ${k}.`);
    return s as Settings;
  },
  parseInput(raw) { if (raw !== null) fail('Ichi uses card actions.'); return null; }, neutralInput: () => null,
  parseAction(raw) {
    const a = record(raw);
    if (!['play', 'draw', 'keep', 'challenge', 'ichi', 'catch', 'next'].includes(a.kind as string)) fail('Unknown action.');
    const turnId = text(a.turnId, 'Missing turn.');
    if (Object.keys(a).some(k => !(a.kind === 'play' ? ['kind', 'turnId', 'cardId', 'color', 'target', 'give'] : ['kind', 'turnId']).includes(k))) fail('Unknown action field.');
    if (a.kind !== 'play') return { kind: a.kind as Exclude<Action['kind'], 'play'>, turnId };
    if (a.color !== undefined && !colors.includes(a.color as Color)) fail('Choose a valid color.');
    return { kind: 'play', turnId, cardId: text(a.cardId, 'Choose a card.'), ...(a.color === undefined ? {} : { color: a.color as Color }), ...(a.target === undefined ? {} : { target: text(a.target, 'Choose a player.') }), ...(a.give === undefined ? {} : { give: text(a.give, 'Choose a card to give away.') }) };
  },
  create(ctx, raw) {
    const settings = rules.validateSettings(raw), n = ctx.players.length;
    if (n < 2 || n > MAX_ROOM_PLAYERS || new Set(ctx.players.map(p => p.id)).size !== n) fail(`Ichi needs 2–${MAX_ROOM_PLAYERS} players.`);
    if (!Number.isFinite(ctx.nowMs)) fail('Invalid start time.');
    const parlor = tableCount(n, settings.tableSize) > 1;
    const s: State = {
      settings, rng: ctx.seed >>> 0, now: ctx.nowMs, phase: 'playing', parlor, players: ctx.players.map((p, i) => ({ i, id: p.id, name: p.name, color: p.color, connected: true, hand: [], score: 0, handsWon: 0, safe: false, table: 0, was: -1 })),
      tables: [], round: 0, rounds: parlor ? roundCount(settings.target) : 1, bellAt: null, rung: false, nextAt: null, pausedAt: 0, ready: [], finishReason: '', feature: 0, cutAt: ctx.nowMs, floor: [], floorAt: 0, rev: 0, sig: '',
    };
    // One table keeps join order around the table, as it always has; the parlor draws lots.
    if (parlor) { seat(s); startRound(s, ctx.nowMs); } else { s.tables = [table(0, s.players.map(p => p.i))]; s.round = 1; startHand(s, s.tables[0], ctx.nowMs); }
    sync(s); return s;
  },
  applyAction(s, id, raw, rawNow) { apply(s, id, raw, rawNow); sync(s); },
  tick(s, _inputs, _dt, rawNow) {
    if (!Number.isFinite(rawNow)) return;
    const now = s.now = clock(s, rawNow);
    if (s.phase === 'complete') return;
    if (s.phase === 'seating') { if (now >= s.nextAt!) startRound(s, now); return sync(s); }
    if (s.nextAt !== null && now >= s.nextAt) { endRound(s, now); return sync(s); }
    if (s.parlor && !s.rung && now >= s.bellAt!) ring(s, now);
    for (const t of s.tables) {
      if (t.phase === 'intermission' && now >= t.nextHandAt!) { startHand(s, t, now); continue; }
      if (t.phase !== 'playing') continue;
      if (t.window && now >= t.window.until) settle(s, t);
      if (now < t.deadline) continue;
      const p = who(s, t);
      event(t, { kind: 'timeout', text: `${p.name} ran out of time.`, by: p.i });
      if (t.pending) { accept(s, t, p, now); continue; }
      if (!t.drawn) draw(s, t, p, 1);
      advance(s, t, now);
    }
    direct(s, now); survey(s, now); sync(s);
  },
  onPresenceChange(s, id, connected, rawNow) {
    const p = s.players.find(p => p.id === id); if (!p) return;
    const now = s.now = clock(s, rawNow), t = s.tables[p.table];
    p.connected = connected;
    if (!connected && s.phase !== 'seating' && t.phase === 'playing' && who(s, t) === p) t.deadline = Math.min(t.deadline, now + AWAY_MS);
    hurry(s, t); sync(s);
  },
  publicView: s => ({ rev: s.rev, ...shared(s) }),
  playerView(s, id) {
    const p = s.players.find(p => p.id === id) ?? fail('Unknown seat.'), t = s.tables[p.table], between = s.phase === 'seating', live = !between && t.phase === 'playing', mine = live && who(s, t) === p;
    // A phone needs its own table, not the TV's: five events and no leftover cards keep ten snapshots a second small.
    const own = s.parlor && !between ? tableView(s, t, 5) : undefined;
    for (const h of own?.handResult?.hands ?? []) h.cards = [];
    return {
      ...(own ? { table: own } : {}), hand: between ? [] : p.hand.map(c => ({ ...c, playable: mine && !why(s, t, c), jumpable: live && !mine && !jumpWhy(s, t, c) })), drawnId: mine ? t.drawn : null,
      canCall: live && t.window?.p === p.i, canCatch: live && !!t.window && t.window.p !== p.i, canChallenge: mine && challengeable(s, t),
    };
  },
  outcome(s) {
    const rows = s.players.map(p => ({ playerId: p.id, score: p.score, rank: 1 + s.players.filter(o => o.score > p.score).length, label: `${p.score} pts · ${p.handsWon} hand${p.handsWon === 1 ? '' : 's'}` })).sort((a, b) => a.rank - b.rank);
    return { complete: s.phase === 'complete' && s.now >= s.nextAt!, winners: s.phase === 'complete' ? leaders(s).map(p => p.id) : [], rows };
  },
  dispose() {},
};
export default rules;
