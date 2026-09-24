import type { GameRules } from '../../../party-contract/src/index';
import { colors, defaults, houseRules, options, points, type Action, type Card, type Color, type GameEvent, type HandResult, type PrivateView, type PublicView, type Settings, type Value } from './types';

type Player = { id: string; name: string; color: string; connected: boolean; hand: Card[]; score: number; handsWon: number; safe: boolean };
type Play = Extract<Action, { kind: 'play' }>;
export type State = {
  settings: Settings; rng: number; now: number; phase: PublicView['phase']; players: Player[];
  deck: Card[]; discard: Card[]; color: Color; hand: number; revision: number; turn: number; current: number; direction: 1 | -1; deadline: number;
  /** A fresh +4 records the color it replaced (before) and whether its player held that color (bluff); a stacked +4 can't bluff. */
  pending: { count: number; kind: 'draw2' | 'wild4'; from: string; bluff: boolean; before: Color | null } | null;
  drawn: string | null; window: PublicView['ichiWindow']; windows: number; events: GameEvent[]; seq: number;
  result: HandResult | null; endedAt: number; nextHandAt: number | null; ready: string[]; finishReason: string;
};

const TURN_CAP = 400, HAND_CAP = 12, HAND_MAX = 30, WINDOW_MS = 5000, AWAY_MS = 5000, BREAK_MS = 10000, EARLY_MS = 3000;
const STALE = 'Too slow — the table moved on.';
function fail(message: string): never { throw new Error(message); }
const record = (raw: unknown) => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : fail('Expected an object.');
const text = (v: unknown, message: string) => typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : fail(message);
const clock = (s: State, now: number) => Number.isFinite(now) ? Math.max(now, s.now) : s.now;
const numeric = (v: Value) => /^\d$/.test(v);
const title = (w: string) => w[0].toUpperCase() + w.slice(1);
const name = (c: Card) => { const v = ({ skip: 'Skip', reverse: 'Reverse', draw2: '+2', wild: 'Wild', wild4: 'Wild +4' } as Record<string, string>)[c.value] ?? c.value; return c.color === 'wild' ? v : `${title(c.color)} ${v}`; };
const handId = (s: State) => `h${s.hand}`;
const turnId = (s: State) => `${handId(s)}:${s.revision}`;
const top = (s: State) => s.discard[s.discard.length - 1];
const seat = (s: State, i: number, steps = 1) => ((i + s.direction * steps) % s.players.length + s.players.length) % s.players.length;
const byId = (s: State, id: string) => s.players.find(p => p.id === id)!;
const sum = (cards: Card[]) => cards.reduce((t, c) => t + points(c), 0);
const leaders = (s: State) => { const best = Math.max(...s.players.map(p => p.score)); return s.players.filter(p => p.score === best); };
function random(s: State, max: number) { s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0; return Math.floor(s.rng / 4294967296 * max); }
function shuffle<T>(s: State, values: T[]) { for (let i = values.length - 1; i > 0; i--) { const j = random(s, i + 1); [values[i], values[j]] = [values[j], values[i]]; } return values; }
function event(s: State, e: Omit<GameEvent, 'seq'>) { s.events = [...s.events, { seq: ++s.seq, ...e }].slice(-12); }

const faces: Value[] = ['0', ...(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'] as const).flatMap(v => [v, v])];
function build(copies: number) {
  const cards: Card[] = [];
  for (let k = 0; k < copies; k++) {
    for (const color of colors) for (const value of faces) cards.push({ id: `c${cards.length}`, color, value });
    for (const value of ['wild', 'wild4'] as const) for (let i = 0; i < 4; i++) cards.push({ id: `c${cards.length}`, color: 'wild', value });
  }
  return cards;
}

const challengeable = (s: State) => s.settings.challenge && s.pending?.kind === 'wild4' && !!s.pending.before;
const matches = (s: State, c: Card) => c.color === 'wild' || c.color === s.color || c.value === top(s).value;
/** Why the current player can't play c right now ('' means legal). */
function why(s: State, c: Card) {
  if (s.pending) return s.settings.stacking && (c.value === 'wild4' || c.value === 'draw2' && s.pending.kind === 'draw2') ? '' : s.settings.stacking ? `Stack ${s.pending.kind === 'draw2' ? 'a +2 or +4' : 'a +4'}, or take the cards.` : 'Take the cards or challenge the +4.';
  if (s.drawn && s.drawn !== c.id) return 'Play the card you drew, or keep it.';
  return matches(s, c) ? '' : 'That card doesn’t match the color or symbol.';
}
/** Why another player can't jump in with c ('' means legal). */
const jumpWhy = (s: State, c: Card) => !s.settings.jumpIn ? 'Wait for your turn.' : s.pending || s.drawn ? 'No jumping in right now.'
  : c.color === 'wild' || c.color !== top(s).color || c.value !== top(s).value ? 'Jump in only with the exact same card.' : '';

function draw(s: State, p: Player, count: number) {
  const got: Card[] = [];
  while (got.length < count && p.hand.length < HAND_MAX) {
    if (!s.deck.length && s.discard.length > 1) { s.deck = shuffle(s, s.discard.splice(0, s.discard.length - 1)); event(s, { kind: 'draw', text: 'The discard pile was reshuffled.' }); }
    const c = s.deck.pop(); if (!c) break;
    p.hand.push(c); got.push(c);
  }
  if (got.length) { p.safe = false; if (s.window?.playerId === p.id) s.window = null; }
  return got;
}
function penalty(s: State, p: Player, count: number) {
  const got = draw(s, p, count).length;
  event(s, { kind: 'penalty', text: `${p.name} draws ${got}${got < count ? ` (${count - got} short)` : ''}.`, playerId: p.id, count: got });
}
const schedule = (s: State, now: number) => { s.deadline = now + (s.players[s.current].connected ? s.settings.turnSeconds * 1000 : AWAY_MS); };
function advance(s: State, now: number, steps = 1) {
  s.drawn = null; s.revision++; s.turn++;
  if (s.turn >= TURN_CAP) return endHand(s, now);
  s.current = seat(s, s.current, steps); schedule(s, now);
}
function accept(s: State, p: Player, now: number) { const { count } = s.pending!; s.pending = null; penalty(s, p, count); advance(s, now); }
/** Closes the catch window in the offender's favor. */
function settle(s: State) { const o = byId(s, s.window!.playerId); o.safe = true; s.window = null; event(s, { kind: 'ichi', text: `${o.name} slipped through — safe.`, playerId: o.id }); }
function moved(s: State, p: Player) { p.safe = p.hand.length === 1; if (s.window?.playerId === p.id) s.window = null; }

function startHand(s: State, now: number) {
  Object.assign(s, { phase: 'playing', hand: s.hand + 1, revision: 0, turn: 0, direction: 1, pending: null, drawn: null, window: null, result: null, nextHandAt: null, ready: [] });
  s.deck = shuffle(s, build(s.players.length >= 7 ? 2 : 1)); s.discard = [];
  for (const p of s.players) { p.hand = s.deck.splice(s.deck.length - s.settings.handSize); p.safe = false; }
  s.discard.push(s.deck.splice(s.deck.findIndex(c => numeric(c.value)), 1)[0]); s.color = top(s).color as Color;
  s.current = (s.hand - 1) % s.players.length; schedule(s, now);
  event(s, { kind: 'deal', text: `Hand ${s.hand} · ${s.players[s.current].name} leads.`, playerId: s.players[s.current].id, card: { ...top(s) } });
}
/** Ends the hand; without a winner (400-turn cap) the fewest cards, then fewest points, wins. */
function endHand(s: State, now: number, winner?: Player) {
  let reason = winner ? `${winner.name} went out.` : '';
  if (!winner) {
    const key = (p: Player) => p.hand.length * 10000 + sum(p.hand), best = Math.min(...s.players.map(key)), tied = s.players.filter(p => key(p) === best);
    winner = tied.length === 1 ? tied[0] : undefined;
    reason = winner ? `Turn limit — ${winner.name} holds the fewest cards.` : 'Turn limit — tied for the fewest cards.';
  }
  const hands = s.players.map(p => ({ playerId: p.id, cards: p.hand.map(c => ({ ...c })), points: sum(p.hand) }));
  const won = winner ? hands.reduce((t, h) => h.playerId === winner.id ? t : t + h.points, 0) : 0;
  if (winner) { winner.score += won; winner.handsWon++; }
  s.result = { winnerId: winner?.id ?? null, points: won, reason, hands };
  Object.assign(s, { pending: null, drawn: null, window: null, revision: s.revision + 1, endedAt: now, ready: [] });
  event(s, winner ? { kind: 'handEnd', text: `${winner.name} wins hand ${s.hand} · +${won}`, playerId: winner.id, count: won } : { kind: 'handEnd', text: `Hand ${s.hand} is a draw.` });
  const best = leaders(s), score = best[0].score, target = s.settings.target;
  if (target && score < target && s.hand < HAND_CAP) { s.phase = 'intermission'; s.nextHandAt = now + BREAK_MS; return; }
  s.phase = 'complete'; s.nextHandAt = null;
  s.finishReason = `${!target ? 'One-hand match.' : score >= target ? `${target} points reached.` : `${HAND_CAP} hands played.`} ${best.map(p => p.name).join(' & ')} ${best.length > 1 ? 'share the win' : 'wins'} with ${score} pts.`;
}
/** Starts the next hand early once every connected player is ready and 3 s have passed. */
function hurry(s: State) { if (s.phase === 'intermission' && s.players.every(p => !p.connected || s.ready.includes(p.id))) s.nextHandAt = Math.min(s.nextHandAt!, s.endedAt + EARLY_MS); }

function play(s: State, p: Player, c: Card, a: Play, target: Player | undefined, jump: boolean, now: number) {
  const stack = !!s.pending, before = s.color, bluff = c.value === 'wild4' && !stack && p.hand.some(h => h !== c && h.color === before);
  const count = (s.pending?.count ?? 0) + (c.value === 'draw2' ? 2 : 4);
  p.hand.splice(p.hand.indexOf(c), 1); s.discard.push(c); s.color = c.color === 'wild' ? a.color! : c.color;
  s.current = s.players.indexOf(p); s.drawn = null;
  const victim = s.players[seat(s, s.current)];
  event(s, { kind: jump ? 'jump' : stack ? 'stack' : 'play', text: jump ? `${p.name} jumped in with ${name(c)}!` : stack ? `${p.name} stacked ${name(c)} → ${count}!` : `${p.name} played ${name(c)}.`, playerId: p.id, card: { ...c } });
  if (c.color === 'wild') event(s, { kind: 'color', text: `${title(s.color)} is up.`, playerId: p.id });
  // A final +2/+4 still lands; the hand is over, so nobody can stack or challenge it.
  if (!p.hand.length) { if (c.value === 'draw2' || c.value === 'wild4') penalty(s, victim, count); return endHand(s, now, p); }
  if (s.settings.sevenZero && c.value === '7' && target) {
    [p.hand, target.hand] = [target.hand, p.hand]; moved(s, p); moved(s, target);
    event(s, { kind: 'swap', text: `${p.name} swapped hands with ${target.name}.`, playerId: p.id, targetId: target.id });
  } else if (s.settings.sevenZero && c.value === '0') {
    const hands = s.players.map(o => o.hand); s.players.forEach((o, i) => { o.hand = hands[seat(s, i, -1)]; moved(s, o); });
    event(s, { kind: 'rotate', text: 'Every hand passed along!', playerId: p.id });
  } else if (p.hand.length === 1 && !p.safe) {
    if (s.window) settle(s);
    s.window = { id: `${handId(s)}:ichi${++s.windows}`, playerId: p.id, until: now + WINDOW_MS };
  }
  let steps = 1;
  if (c.value === 'reverse') { s.direction = -s.direction as 1 | -1; event(s, { kind: 'reverse', text: s.players.length === 2 ? `Reverse — ${victim.name} is skipped.` : 'Direction reversed.', playerId: p.id }); }
  if (c.value === 'skip' || c.value === 'reverse' && s.players.length === 2) steps = 2;
  if (c.value === 'skip') event(s, { kind: 'skip', text: `${victim.name} is skipped.`, targetId: victim.id });
  if (c.value === 'draw2' || c.value === 'wild4') {
    if (s.settings.stacking || c.value === 'wild4' && s.settings.challenge) s.pending = { count, kind: c.value, from: p.id, bluff, before: c.value === 'wild4' && !stack ? before : null };
    else { penalty(s, victim, count); steps = 2; }
  }
  advance(s, now, steps);
}

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
    if (Object.keys(a).some(k => !(a.kind === 'play' ? ['kind', 'turnId', 'cardId', 'color', 'target'] : ['kind', 'turnId']).includes(k))) fail('Unknown action field.');
    if (a.kind !== 'play') return { kind: a.kind as Exclude<Action['kind'], 'play'>, turnId };
    if (a.color !== undefined && !colors.includes(a.color as Color)) fail('Choose a valid color.');
    return { kind: 'play', turnId, cardId: text(a.cardId, 'Choose a card.'), ...(a.color === undefined ? {} : { color: a.color as Color }), ...(a.target === undefined ? {} : { target: text(a.target, 'Choose a player.') }) };
  },
  create(ctx, raw) {
    const settings = rules.validateSettings(raw);
    if (ctx.players.length < 2 || ctx.players.length > 10 || new Set(ctx.players.map(p => p.id)).size !== ctx.players.length) fail('Ichi needs 2–10 players.');
    if (!Number.isFinite(ctx.nowMs)) fail('Invalid start time.');
    const s: State = {
      settings, rng: ctx.seed >>> 0, now: ctx.nowMs, phase: 'playing', players: ctx.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: true, hand: [], score: 0, handsWon: 0, safe: false })),
      deck: [], discard: [], color: 'coral', hand: 0, revision: 0, turn: 0, current: 0, direction: 1, deadline: 0, pending: null, drawn: null, window: null, windows: 0,
      events: [], seq: 0, result: null, endedAt: 0, nextHandAt: null, ready: [], finishReason: '',
    };
    startHand(s, ctx.nowMs); return s;
  },
  applyAction(s, id, raw, rawNow) {
    const a = rules.parseAction(raw), p = s.players.find(p => p.id === id) ?? fail('You are not seated at this table.'), now = clock(s, rawNow);
    if (s.phase === 'complete') fail('The match is over.');
    if (a.kind === 'next') {
      if (s.phase !== 'intermission' || a.turnId !== handId(s)) fail('The next hand has already started.');
      if (s.ready.includes(p.id)) fail('You are already ready.');
      s.now = now; s.ready.push(p.id); hurry(s); return;
    }
    if (s.phase !== 'playing') fail('The next hand hasn’t started yet.');
    const w = s.window;
    if (a.kind === 'catch' || a.kind === 'ichi' && w?.id === a.turnId) {
      if (!w || w.id !== a.turnId || now >= w.until) fail('Too slow — that catch window already closed.');
      if (a.kind === 'catch' && w.playerId === p.id) fail('Call Ichi! instead.');
      if (a.kind === 'ichi' && w.playerId !== p.id) fail('Only the player on one card can call it.');
      const o = byId(s, w.playerId); s.now = now; s.window = null;
      if (a.kind === 'ichi') { o.safe = true; event(s, { kind: 'ichi', text: `${o.name} won the race — Ichi!`, playerId: o.id }); return; }
      const got = draw(s, o, 2).length; event(s, { kind: 'catch', text: `${p.name} caught ${o.name}! +${got}`, playerId: p.id, targetId: o.id, count: got, success: true }); return;
    }
    if (a.kind === 'ichi') fail('Call Ichi! once you’re down to one card.');
    if (a.turnId !== turnId(s)) fail(STALE);
    if (now >= s.deadline) fail('Time’s up for this turn.');
    const mine = s.players[s.current] === p;
    if (a.kind === 'play') {
      const c = p.hand.find(c => c.id === a.cardId) ?? fail('That card isn’t in your hand.'), reason = mine ? why(s, c) : jumpWhy(s, c);
      if (reason) fail(reason);
      if (c.color === 'wild' && !a.color) fail('Choose the next color.');
      const target = s.settings.sevenZero && c.value === '7' && p.hand.length > 1 ? s.players.find(o => o.id === a.target && o !== p) ?? fail('Choose a player to swap with.') : undefined;
      s.now = now; return play(s, p, c, a, target, !mine, now);
    }
    if (!mine) fail('Wait for your turn.');
    if (a.kind === 'challenge' && !challengeable(s)) fail(s.pending?.kind === 'wild4' && s.settings.challenge ? 'A stacked +4 can’t be a bluff.' : 'There’s no +4 to challenge.');
    if (a.kind === 'keep' && !s.drawn) fail('Draw a card first.');
    if (a.kind === 'draw' && s.drawn) fail('Play the card you drew, or keep it.');
    s.now = now;
    if (a.kind === 'keep') { event(s, { kind: 'draw', text: `${p.name} kept the card.`, playerId: p.id }); return advance(s, now); }
    if (a.kind === 'challenge') {
      const { count, bluff, from, before } = s.pending!, o = byId(s, from), was = title(before!); s.pending = null;
      event(s, { kind: 'challenge', text: bluff ? `${o.name} had ${was}! Draws ${count}.` : `No bluff. ${p.name} draws ${count + 2}.`, playerId: p.id, targetId: o.id, success: bluff });
      if (!bluff) { penalty(s, p, count + 2); return advance(s, now); }
      penalty(s, o, count); s.revision++; return schedule(s, now);
    }
    if (s.pending) return accept(s, p, now);
    let got: Card | undefined, n = 0;
    do { got = draw(s, p, 1)[0]; if (got) n++; } while (got && s.settings.drawUntilPlayable && !matches(s, got));
    event(s, { kind: 'draw', text: n ? `${p.name} drew ${n === 1 ? 'a card' : `${n} cards`}.` : `${p.name} couldn’t draw.`, playerId: p.id, count: n });
    if (got && matches(s, got)) { s.drawn = got.id; s.revision++; } else advance(s, now);
  },
  tick(s, _inputs, _dt, rawNow) {
    if (!Number.isFinite(rawNow)) return;
    const now = s.now = clock(s, rawNow);
    if (s.phase === 'intermission' && now >= s.nextHandAt!) return startHand(s, now);
    if (s.phase !== 'playing') return;
    if (s.window && now >= s.window.until) settle(s);
    if (now < s.deadline) return;
    const p = s.players[s.current];
    event(s, { kind: 'timeout', text: `${p.name} ran out of time.`, playerId: p.id });
    if (s.pending) return accept(s, p, now);
    if (!s.drawn) draw(s, p, 1);
    advance(s, now);
  },
  onPresenceChange(s, id, connected, rawNow) {
    const p = s.players.find(p => p.id === id); if (!p) return;
    const now = s.now = clock(s, rawNow);
    p.connected = connected;
    if (!connected && s.phase === 'playing' && s.players[s.current] === p) s.deadline = Math.min(s.deadline, now + AWAY_MS);
    hurry(s);
  },
  publicView(s) {
    return {
      phase: s.phase, handId: handId(s), hand: s.hand, turnId: turnId(s), turn: s.turn, deadline: s.deadline, current: s.players[s.current].id, direction: s.direction,
      color: s.color, top: { ...top(s) }, drawCount: s.deck.length, discardCount: s.discard.length,
      pending: s.pending && { count: s.pending.count, kind: s.pending.kind, from: s.pending.from, before: s.pending.before, challengeable: challengeable(s) },
      drawn: !!s.drawn, ichiWindow: s.window && { ...s.window }, events: structuredClone(s.events), settings: { ...s.settings },
      players: s.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, count: p.hand.length, score: p.score, handsWon: p.handsWon, safe: p.safe })),
      handResult: s.result && structuredClone(s.result), nextHandAt: s.nextHandAt, ready: [...s.ready],
      winners: s.phase === 'complete' ? leaders(s).map(p => p.id) : [], finishReason: s.finishReason,
    };
  },
  playerView(s, id) {
    const p = s.players.find(p => p.id === id) ?? fail('Unknown seat.'), live = s.phase === 'playing', mine = live && s.players[s.current] === p;
    return {
      hand: p.hand.map(c => ({ ...c, playable: mine && !why(s, c), jumpable: live && !mine && !jumpWhy(s, c) })), drawnId: mine ? s.drawn : null,
      canCall: live && s.window?.playerId === p.id,
      canCatch: live && !!s.window && s.window.playerId !== p.id, canChallenge: mine && challengeable(s),
    };
  },
  outcome(s) {
    const complete = s.phase === 'complete';
    const rows = s.players.map(p => ({ playerId: p.id, score: p.score, rank: 1 + s.players.filter(o => o.score > p.score).length, label: `${p.score} pts · ${p.handsWon} hand${p.handsWon === 1 ? '' : 's'}` })).sort((a, b) => a.rank - b.rank);
    return { complete, winners: complete ? leaders(s).map(p => p.id) : [], rows };
  },
  dispose() {},
};
export default rules;
