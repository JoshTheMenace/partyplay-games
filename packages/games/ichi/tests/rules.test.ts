import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { rules, type State } from '../src/server';
import { colors, defaults, houseRules, options, points, type Action, type Card, type Color, type Settings, type Value } from '../src/types';

const ctx = (count = 3, seed = 1234) => ({ roomId: 'room', roundId: 'round', nowMs: 0, seed, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, color: '#ff5748' })) });
const classic = { ...defaults, ...Object.fromEntries(Object.keys(houseRules).map(k => [k, false])) } as Settings;
const view = (s: State) => rules.publicView(s, { nowMs: s.now, phase: 'playing' });
const own = (s: State, id: string) => rules.playerView(s, id, { nowMs: s.now, phase: 'playing' });
type Loose = { kind: Action['kind']; turnId?: string; cardId?: string; color?: Color; target?: string };
const act = (s: State, id: string, a: Loose, at = s.now + 1) => rules.applyAction(s, id, { turnId: view(s).turnId, ...a } as Action, at);
const play = (s: State, id: string, c: Card, extra: Partial<Loose> = {}) => act(s, id, { kind: 'play', cardId: c.id, ...extra });
const rejects = (s: State, fn: () => void, message = /./) => { const before = structuredClone(s); assert.throws(fn, message); assert.deepEqual(s, before); };
let serial = 0;
const card = (value: Value, color: Color = 'coral'): Card => ({ id: `x${serial++}`, color: value === 'wild' || value === 'wild4' ? 'wild' : color, value });
/** Three seats, coral 4 on top, hands of three unplayable cards and a deck of unplayable lime 3s (top of deck is the end). */
function table(settings: Partial<Settings> = {}, count = 3) {
  const s = rules.create(ctx(count), { ...classic, ...settings });
  s.discard = [card('4')]; s.color = 'coral'; s.deck = Array.from({ length: 20 }, () => card('3', 'lime'));
  for (const p of s.players) p.hand = [card('8', 'sky'), card('9', 'sky'), card('5', 'lime')];
  return s;
}
const hand = (s: State, i: number, ...cards: Card[]) => { s.players[i].hand = cards; return cards; };

test('settings default, merge and reject malformed values', () => {
  assert.deepEqual(rules.validateSettings({}), defaults);
  assert.deepEqual(rules.validateSettings({ target: 0, jumpIn: true }), { ...defaults, target: 0, jumpIn: true });
  for (const raw of [null, [], 'x', { bogus: true }, { handSize: 8 }, { target: '200' }, { turnSeconds: 30 }, { stacking: 1 }, { jumpIn: 'yes' }, { target: NaN }]) assert.throws(() => rules.validateSettings(raw));
});

test('parseAction is strict and never emits undefined fields', () => {
  assert.deepEqual(rules.parseAction({ kind: 'draw', turnId: 'h1:0' }), { kind: 'draw', turnId: 'h1:0' });
  assert.deepEqual(Object.keys(rules.parseAction({ kind: 'play', turnId: 'h1:0', cardId: 'c1' })), ['kind', 'turnId', 'cardId']);
  assert.deepEqual(rules.parseAction({ kind: 'play', turnId: 't', cardId: 'c', color: 'sun', target: 'p1' }), { kind: 'play', turnId: 't', cardId: 'c', color: 'sun', target: 'p1' });
  const long = 'x'.repeat(65);
  for (const raw of [null, [], { kind: 'pass', turnId: 't' }, { kind: 'draw' }, { kind: 'draw', turnId: '' }, { kind: 'draw', turnId: long }, { kind: 'draw', turnId: 't', cardId: 'c' },
    { kind: 'play', turnId: 't' }, { kind: 'play', turnId: 't', cardId: long }, { kind: 'play', turnId: 't', cardId: 'c', color: 'wild' }, { kind: 'play', turnId: 't', cardId: 'c', target: 5 },
    { kind: 'play', turnId: 't', cardId: 'c', cheat: true }, { kind: 'catch', turnId: 7 }]) assert.throws(() => rules.parseAction(raw));
});

test('decks: 108 cards, doubled at 7+, numbered first discard, seeded shuffle', () => {
  for (const [count, total] of [[2, 108], [6, 108], [7, 216], [10, 216]]) {
    const s = rules.create(ctx(count), defaults), all = [...s.deck, ...s.discard, ...s.players.flatMap(p => p.hand)];
    assert.equal(all.length, total); assert.equal(new Set(all.map(c => c.id)).size, total);
    const copies = total / 108, n = (v: Value) => all.filter(c => c.value === v).length;
    assert.equal(n('0'), 4 * copies); assert.equal(n('7'), 8 * copies); assert.equal(n('skip'), 8 * copies); assert.equal(n('draw2'), 8 * copies); assert.equal(n('wild'), 4 * copies); assert.equal(n('wild4'), 4 * copies);
    assert.ok(s.players.every(p => p.hand.length === 7));
  }
  for (let seed = 0; seed < 200; seed++) { const s = rules.create(ctx(4, seed), defaults); assert.match(s.discard[0].value, /^\d$/); assert.equal(s.color, s.discard[0].color); }
  assert.deepEqual(rules.create(ctx(4, 9), defaults), rules.create(ctx(4, 9), defaults));
  assert.notDeepEqual(rules.create(ctx(4, 9), defaults).deck, rules.create(ctx(4, 10), defaults).deck);
  assert.equal(rules.create(ctx(3), { ...defaults, handSize: 5 }).players[0].hand.length, 5);
  assert.throws(() => rules.create(ctx(1), defaults)); assert.throws(() => rules.create({ ...ctx(2), players: [ctx(2).players[0], ctx(2).players[0]] }, defaults));
});

test('matching by color, symbol or wild; illegal plays leave state untouched', () => {
  const s = table(), [sky4, lime9, wild] = hand(s, 0, card('4', 'sky'), card('9', 'lime'), card('wild'), card('1'));
  assert.deepEqual(own(s, 'p0').hand.map(c => c.playable), [true, false, true, true]);
  rejects(s, () => play(s, 'p0', lime9), /match/);
  rejects(s, () => play(s, 'p0', wild), /color/);
  rejects(s, () => play(s, 'p1', s.players[1].hand[0]), /Wait/);
  rejects(s, () => act(s, 'p1', { kind: 'draw' }), /Wait/);
  rejects(s, () => act(s, 'p0', { kind: 'play', cardId: 'nope' }), /hand/);
  play(s, 'p0', sky4); assert.equal(s.color, 'sky'); assert.equal(s.current, 1);
  s.current = 0; play(s, 'p0', wild, { color: 'sun' }); assert.equal(s.color, 'sun'); assert.equal(view(s).top.id, wild.id);
});

test('stale and duplicate actions are rejected with a friendly reason', () => {
  const s = table(), old = view(s).turnId, [c] = hand(s, 0, card('6'), card('7'), card('8'));
  play(s, 'p0', c, { turnId: old });
  rejects(s, () => act(s, 'p0', { kind: 'play', cardId: s.players[0].hand[0].id, turnId: old }), /Too slow/);
  rejects(s, () => act(s, 'p1', { kind: 'draw', turnId: old }), /Too slow/);
  rejects(s, () => act(s, 'p1', { kind: 'draw' }, s.deadline), /Time/);
  rejects(s, () => act(s, 'nobody', { kind: 'draw' }));
});

test('draw: unplayable ends the turn, playable may be played or kept', () => {
  const s = table(); act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 4); assert.equal(s.current, 1);
  s.deck.push(card('1')); act(s, 'p1', { kind: 'draw' }); const drawn = s.players[1].hand.at(-1)!;
  assert.equal(s.current, 1); assert.equal(own(s, 'p1').drawnId, drawn.id); assert.equal(own(s, 'p0').drawnId, null); assert.equal(view(s).drawn, true);
  assert.deepEqual(own(s, 'p1').hand.filter(c => c.playable).map(c => c.id), [drawn.id]);
  rejects(s, () => act(s, 'p1', { kind: 'draw' }), /drew/);
  s.players[1].hand.unshift(card('4', 'lime')); rejects(s, () => play(s, 'p1', s.players[1].hand[0]), /drew/);
  act(s, 'p1', { kind: 'keep' }); assert.equal(s.current, 2); assert.ok(s.players[1].hand.includes(drawn));
  rejects(s, () => act(s, 'p2', { kind: 'keep' }), /Draw/);
  s.deck.push(card('2')); act(s, 'p2', { kind: 'draw' }); play(s, 'p2', s.players[2].hand.at(-1)!); assert.equal(s.current, 0); assert.equal(s.players[2].hand.length, 3);
});

test('draw till you can keeps drawing until a playable card, and stops at exhaustion', () => {
  const s = table({ drawUntilPlayable: true }); s.deck = [card('1'), card('3', 'lime'), card('3', 'lime'), card('3', 'lime')];
  act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 7); assert.equal(s.drawn, s.players[0].hand.at(-1)!.id); assert.equal(s.current, 0);
  act(s, 'p0', { kind: 'keep' }); act(s, 'p1', { kind: 'draw' }); assert.equal(s.deck.length, 0); assert.equal(s.current, 2); assert.equal(s.drawn, null);
});

test('reshuffle keeps the top card; exhausted deck and the 30-card cap end the draw without deadlock', () => {
  const s = table(), top = s.discard[0]; s.deck = []; s.discard = [card('7', 'lime'), card('6', 'lime'), top];
  act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 4); assert.deepEqual(s.discard, [top]); assert.equal(s.deck.length, 1);
  s.deck = []; act(s, 'p1', { kind: 'draw' }); assert.equal(s.players[1].hand.length, 3); assert.equal(s.current, 2);
  s.deck = [card('1')]; hand(s, 2, ...Array.from({ length: 30 }, () => card('5', 'lime')));
  act(s, 'p2', { kind: 'draw' }); assert.equal(s.players[2].hand.length, 30); assert.equal(s.current, 0);
  const t = table({ stacking: true }); t.deck = Array.from({ length: 20 }, () => card('3', 'lime')); hand(t, 1, ...Array.from({ length: 29 }, () => card('5', 'lime')));
  play(t, 'p0', hand(t, 0, card('draw2'), card('1'), card('2'))[0]); act(t, 'p1', { kind: 'draw' }); assert.equal(t.players[1].hand.length, 30);
});

test('skip, reverse, two-player reverse and unstacked +2 / +4', () => {
  const s = table(); play(s, 'p0', hand(s, 0, card('skip'), card('1'), card('2'))[0]); assert.equal(s.current, 2);
  play(s, 'p2', hand(s, 2, card('reverse'), card('1'), card('2'))[0]); assert.equal(s.direction, -1); assert.equal(s.current, 1);
  play(s, 'p1', hand(s, 1, card('draw2'), card('1'), card('2'))[0]); assert.equal(s.players[0].hand.length, 4); assert.equal(s.current, 2); assert.equal(s.pending, null);
  play(s, 'p2', hand(s, 2, card('wild4'), card('1'), card('2'))[0], { color: 'lime' }); assert.equal(s.players[1].hand.length, 6); assert.equal(s.current, 0); assert.equal(s.color, 'lime');
  const two = table({}, 2); play(two, 'p0', hand(two, 0, card('reverse'), card('1'), card('2'))[0]); assert.equal(two.current, 0); assert.equal(two.direction, -1);
  play(two, 'p0', hand(two, 0, card('skip'), card('1'), card('2'))[0]); assert.equal(two.current, 0);
});

test('stacking grows the penalty; +4 only answers with +4; flags follow the pending rule', () => {
  const s = table({ stacking: true });
  play(s, 'p0', hand(s, 0, card('draw2'), card('1'), card('2'))[0]);
  assert.deepEqual(view(s).pending, { count: 2, kind: 'draw2', from: 'p0', before: null, challengeable: false }); assert.equal(s.current, 1);
  const [sky2, match] = hand(s, 1, card('draw2', 'sky'), card('4'), card('wild4'), card('wild'));
  assert.deepEqual(own(s, 'p1').hand.map(c => c.playable), [true, false, true, false]);
  rejects(s, () => play(s, 'p1', match), /Stack/);
  play(s, 'p1', sky2); assert.equal(s.pending!.count, 4); assert.equal(s.color, 'sky'); assert.match(view(s).events.at(-1)!.text, /stacked Sky \+2 → 4/);
  const [p2w4, p2d2] = hand(s, 2, card('wild4'), card('draw2', 'sky'), card('1'));
  play(s, 'p2', p2w4, { color: 'sun' }); assert.deepEqual(view(s).pending, { count: 8, kind: 'wild4', from: 'p2', before: null, challengeable: false });
  assert.equal(own(s, 'p0').hand.every(c => !c.playable), true);
  s.current = 2; s.pending = { count: 8, kind: 'wild4', from: 'p1', bluff: false, before: null }; rejects(s, () => play(s, 'p2', p2d2), /\+4/); s.current = 0;
  hand(s, 0, card('1'), card('2'), card('3'));
  act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 11); assert.equal(s.pending, null); assert.equal(s.current, 1);
});

test('+4 challenge: bluff is judged at play time; guilty draws, innocent adds two', () => {
  const s = table({ challenge: true }), [w4] = hand(s, 0, card('wild4'), card('1'), card('2', 'sky'));
  play(s, 'p0', w4, { color: 'sky' }); assert.equal(view(s).pending!.before, 'coral'); assert.equal(own(s, 'p1').canChallenge, true); assert.equal(own(s, 'p2').canChallenge, false);
  assert.equal(own(s, 'p1').hand.every(c => !c.playable), true);
  hand(s, 0, card('5', 'lime'), card('6', 'lime')); // later hand changes don't matter
  const turn = view(s).turnId; act(s, 'p1', { kind: 'challenge' });
  assert.equal(s.players[0].hand.length, 6); assert.equal(s.current, 1); assert.notEqual(view(s).turnId, turn); assert.equal(s.pending, null);
  assert.equal(view(s).events.at(-2)!.success, true); assert.match(view(s).events.at(-2)!.text, /had Coral/);
  play(s, 'p1', hand(s, 1, card('1', 'sky'), card('2'), card('3'))[0]); assert.equal(s.current, 2);
  const t = table({ challenge: true }); play(t, 'p0', hand(t, 0, card('wild4'), card('1', 'sky'), card('2', 'sky'))[0], { color: 'lime' });
  act(t, 'p1', { kind: 'challenge' }); assert.equal(t.players[1].hand.length, 9); assert.equal(t.current, 2); assert.equal(t.players[0].hand.length, 2);
  const u = table({ challenge: true, stacking: true }); play(u, 'p0', hand(u, 0, card('draw2'), card('1'), card('2'))[0]);
  rejects(u, () => act(u, 'p1', { kind: 'challenge' }), /\+4/);
  const w = table({ challenge: true, stacking: true }); play(w, 'p0', hand(w, 0, card('wild4'), card('1'), card('2'))[0], { color: 'sky' });
  play(w, 'p1', hand(w, 1, card('wild4'), card('1', 'sky'), card('2'))[0], { color: 'lime' }); // stacked: only +2/+4 were legal, so never a bluff
  assert.deepEqual([view(w).pending!.before, view(w).pending!.challengeable, own(w, 'p2').canChallenge], [null, false, false]);
  rejects(w, () => act(w, 'p2', { kind: 'challenge' }), /stacked/);
  const v = table(); play(v, 'p0', hand(v, 0, card('wild4'), card('1'), card('2'))[0], { color: 'lime' }); assert.equal(v.pending, null);
  assert.equal(v.current, 2); rejects(v, () => act(v, 'p2', { kind: 'challenge' }), /\+4/);
});

test('Ichi: no early call, every drop to one card opens a race window with its own id, expiry and turn progress', () => {
  const s = table(); hand(s, 0, card('8'), card('9', 'sky'));
  assert.equal(own(s, 'p0').canCall, false); rejects(s, () => act(s, 'p0', { kind: 'ichi' }), /one card/);

  const t = table(); hand(t, 0, card('8'), card('9', 'sky')); play(t, 'p0', t.players[0].hand[0]);
  const w = view(t).ichiWindow!; assert.equal(w.playerId, 'p0'); assert.equal(w.until, t.now + 5000); assert.notEqual(w.id, view(t).turnId);
  assert.deepEqual([own(t, 'p0').canCall, own(t, 'p0').canCatch, own(t, 'p1').canCatch, own(t, 'p2').canCall], [true, false, true, false]);
  act(t, 'p1', { kind: 'draw' }); // play continues during the window
  rejects(t, () => act(t, 'p0', { kind: 'catch', turnId: w.id }), /Ichi/);
  rejects(t, () => act(t, 'p2', { kind: 'ichi', turnId: w.id }), /one card/);
  const before = view(t).turnId; act(t, 'p2', { kind: 'catch', turnId: w.id });
  assert.equal(t.players[0].hand.length, 3); assert.equal(t.window, null); assert.equal(view(t).turnId, before); assert.equal(view(t).events.at(-1)!.kind, 'catch');
  rejects(t, () => act(t, 'p1', { kind: 'catch', turnId: w.id }), /Too slow — that catch window already closed/); // lost the race to p2

  const u = table(); hand(u, 0, card('8'), card('9', 'sky')); play(u, 'p0', u.players[0].hand[0]);
  act(u, 'p0', { kind: 'ichi', turnId: u.window!.id }); assert.equal(u.players[0].safe, true); assert.equal(u.window, null);
  const x = table(); hand(x, 0, card('8'), card('9', 'sky')); play(x, 'p0', x.players[0].hand[0]); const id = x.window!.id;
  rules.tick(x, new Map(), 0, x.window!.until - 1); assert.ok(x.window);
  rejects(x, () => act(x, 'p1', { kind: 'catch', turnId: id }, x.window!.until), /Too slow/);
  rules.tick(x, new Map(), 0, x.window!.until); assert.equal(x.window, null); assert.equal(x.players[0].safe, true);
  x.deck.push(card('1', 'lime')); x.current = 0; act(x, 'p0', { kind: 'draw' }); assert.equal(x.players[0].safe, false);
});

test('a catch reports the cards actually drawn when the piles run dry', () => {
  const s = table(); hand(s, 0, card('8'), card('9', 'sky')); play(s, 'p0', s.players[0].hand[0]); s.deck = [card('1', 'lime')]; s.discard = [s.discard.at(-1)!];
  act(s, 'p1', { kind: 'catch', turnId: s.window!.id });
  assert.equal(s.players[0].hand.length, 2); assert.deepEqual([view(s).events.at(-1)!.count, view(s).events.at(-1)!.text], [1, 'Player1 caught Player0! +1']);
});

test('a second unannounced one-card hand closes the earlier window in its owner’s favor', () => {
  const s = table(); hand(s, 0, card('8'), card('9', 'sky')); hand(s, 1, card('1'), card('1', 'lime'));
  play(s, 'p0', s.players[0].hand[0]); const first = s.window!.id; play(s, 'p1', s.players[1].hand[0]);
  assert.equal(s.players[0].safe, true); assert.equal(s.window!.playerId, 'p1'); assert.notEqual(s.window!.id, first);
});

test('Seven-O: 7 swaps with a chosen player, 0 rotates, one-card hands are automatically safe', () => {
  const s = table({ sevenZero: true }), [seven] = hand(s, 0, card('7'), card('1', 'lime'), card('2', 'lime')), p2 = [...s.players[2].hand];
  rejects(s, () => play(s, 'p0', seven), /swap/); rejects(s, () => play(s, 'p0', seven, { target: 'p0' }), /swap/); rejects(s, () => play(s, 'p0', seven, { target: 'zz' }), /swap/);
  play(s, 'p0', seven, { target: 'p2' }); assert.deepEqual(s.players[0].hand, p2); assert.equal(s.players[2].hand.length, 2); assert.equal(view(s).events.at(-1)!.kind, 'swap');
  const t = table({ sevenZero: true }); play(t, 'p0', hand(t, 0, card('7'), card('1', 'lime'))[0], { target: 'p1' });
  assert.equal(t.players[1].hand.length, 1); assert.equal(t.players[1].safe, true); assert.equal(t.window, null); assert.equal(t.players[0].safe, false);
  const u = table({ sevenZero: true }), hands = u.players.map(p => p.hand); hand(u, 0, card('0'), card('1', 'lime')); const mine = u.players[0].hand;
  play(u, 'p0', mine[0]); assert.deepEqual(u.players.map(p => p.hand), [hands[2], mine, hands[1]]); assert.equal(u.players[1].safe, true); assert.equal(u.window, null);
  const off = table(); play(off, 'p0', hand(off, 0, card('7'), card('1'), card('2'))[0]); assert.equal(off.players[0].hand.length, 2);
  const last = table({ sevenZero: true }); play(last, 'p0', hand(last, 0, card('7'))[0]); assert.equal(last.phase, 'intermission'); assert.equal(last.result!.winnerId, 'p0');
});

test('Jump in: exact non-wild copy out of turn, play continues from the jumper, races resolve by turnId', () => {
  const s = table({ jumpIn: true }), [copy] = hand(s, 2, card('4'), card('4', 'sky'), card('1')), old = view(s).turnId;
  assert.deepEqual(own(s, 'p2').hand.map(c => c.jumpable), [true, false, false]); assert.equal(own(s, 'p0').hand.some(c => c.jumpable), false);
  rejects(s, () => play(s, 'p2', s.players[2].hand[1]), /exact/);
  play(s, 'p2', copy); assert.equal(s.current, 0); assert.equal(view(s).events.at(-1)!.kind, 'jump');
  rejects(s, () => act(s, 'p0', { kind: 'draw', turnId: old }), /Too slow/);
  const t = table({ jumpIn: true }), late = view(t).turnId, [c] = hand(t, 1, card('4'), card('1'), card('2'));
  act(t, 'p0', { kind: 'draw' }); rejects(t, () => play(t, 'p1', c, { turnId: late }), /Too slow/);
  const u = table({ jumpIn: true, stacking: true }); hand(u, 2, card('draw2'), card('1'), card('2')); play(u, 'p0', hand(u, 0, card('draw2'), card('1'), card('2'))[0]);
  assert.equal(own(u, 'p2').hand[0].jumpable, false); rejects(u, () => play(u, 'p2', u.players[2].hand[0]), /right now/);
  const v = table({ jumpIn: true }); v.deck.push(card('1')); act(v, 'p0', { kind: 'draw' }); hand(v, 2, card('4'), card('1'), card('2'));
  assert.equal(own(v, 'p2').hand[0].jumpable, false);
  const w = table({ jumpIn: true }); w.discard.push(card('wild')); hand(w, 2, card('wild'), card('1'), card('2')); assert.equal(own(w, 'p2').hand[0].jumpable, false);
  const off = table(); hand(off, 2, card('4'), card('1'), card('2')); assert.equal(own(off, 'p2').hand[0].jumpable, false); rejects(off, () => play(off, 'p2', off.players[2].hand[0]), /Wait/);
});

test('hand end scores the other hands; the final +2 still lands; hands are revealed only afterwards', () => {
  const s = table(); hand(s, 0, card('draw2')); hand(s, 1, card('wild'), card('skip', 'sky'), card('5', 'lime')); hand(s, 2, card('9', 'lime'));
  assert.equal(view(s).handResult, null);
  play(s, 'p0', s.players[0].hand[0]);
  assert.equal(s.players[1].hand.length, 5); assert.equal(s.phase, 'intermission');
  const r = view(s).handResult!; assert.equal(r.winnerId, 'p0'); assert.equal(r.points, 50 + 20 + 5 + 3 + 3 + 9);
  assert.equal(view(s).players[0].score, r.points); assert.equal(view(s).players[0].handsWon, 1); assert.deepEqual(r.hands.map(h => h.cards.length), [0, 5, 1]);
  assert.equal(points({ value: 'wild4' }), 50); assert.equal(points({ value: 'reverse' }), 20); assert.equal(points({ value: '7' }), 7);
  const t = table({ stacking: true, challenge: true }); play(t, 'p0', hand(t, 0, card('draw2'), card('1'), card('2'))[0]);
  hand(t, 1, card('wild4')); play(t, 'p1', t.players[1].hand[0], { color: 'sun' }); assert.equal(t.players[2].hand.length, 9); assert.equal(t.pending, null); assert.equal(t.result!.winnerId, 'p1');
});

test('intermission: next uses handId, duplicates rejected, early start after 3 s once connected players are ready', () => {
  const s = table(); hand(s, 0, card('1')); play(s, 'p0', s.players[0].hand[0]); const ended = s.now;
  assert.equal(view(s).nextHandAt, ended + 10000); assert.equal(view(s).handId, 'h1');
  rejects(s, () => act(s, 'p1', { kind: 'draw' }), /hasn’t started/);
  rejects(s, () => act(s, 'p1', { kind: 'next', turnId: 'h0' }));
  rules.onPresenceChange(s, 'p2', false, ended + 1);
  act(s, 'p0', { kind: 'next', turnId: 'h1' }); rejects(s, () => act(s, 'p0', { kind: 'next', turnId: 'h1' }), /already/);
  assert.equal(view(s).nextHandAt, ended + 10000); act(s, 'p1', { kind: 'next', turnId: 'h1' });
  assert.deepEqual(view(s).ready, ['p0', 'p1']); assert.equal(view(s).nextHandAt, ended + 3000);
  rules.tick(s, new Map(), 0, ended + 2999); assert.equal(s.phase, 'intermission');
  rules.tick(s, new Map(), 0, ended + 3000); assert.equal(s.phase, 'playing'); assert.equal(view(s).hand, 2); assert.equal(view(s).current, 'p1');
  assert.equal(s.players[0].score, 44); assert.ok(s.players.every(p => p.hand.length === 7)); assert.equal(view(s).handResult, null); assert.deepEqual(view(s).ready, []);
  assert.equal(s.deadline, s.now + 25000);
  rejects(s, () => act(s, 'p0', { kind: 'next', turnId: 'h1' }), /already started/);
  const t = table(); hand(t, 0, card('1')); play(t, 'p0', t.players[0].hand[0]); rules.tick(t, new Map(), 0, t.now + 10000); assert.equal(t.phase, 'playing');
});

test('match target, one-hand match, ties share the win and rank', () => {
  const s = table({ target: 0 }); hand(s, 0, card('1')); play(s, 'p0', s.players[0].hand[0]);
  assert.equal(s.phase, 'complete'); assert.deepEqual(rules.outcome(s).winners, ['p0']); assert.deepEqual(view(s).winners, ['p0']); assert.match(view(s).finishReason, /One-hand/);
  rejects(s, () => act(s, 'p1', { kind: 'next', turnId: 'h1' }), /over/);
  const t = table(); t.players[1].score = 190; hand(t, 0, card('1')); t.current = 1; hand(t, 1, card('1')); play(t, 'p1', t.players[1].hand[0]);
  assert.equal(t.phase, 'complete'); assert.deepEqual(rules.outcome(t).rows[0], { playerId: 'p1', score: 190 + 1 + 22, rank: 1, label: '213 pts · 1 hand' });
  const u = table(); u.hand = 12; u.turn = 399; u.players.forEach((p, i) => { p.score = [100, 100, 40][i]; });
  act(u, 'p0', { kind: 'draw' }); // turn 400: p1 and p2 tie for fewest cards, no winner
  assert.equal(u.result!.winnerId, null); assert.equal(u.phase, 'complete');
  const o = rules.outcome(u); assert.deepEqual(o.winners, ['p0', 'p1']); assert.deepEqual(o.rows.map(r => [r.playerId, r.rank]), [['p0', 1], ['p1', 1], ['p2', 3]]);
  assert.equal(o.rows[2].label, '40 pts · 0 hands'); assert.match(view(u).finishReason, /12 hands.*share the win/);
  assert.deepEqual(rules.outcome(table()).winners, []); assert.equal(rules.outcome(table()).complete, false);
});

test('400-turn cap: fewest cards wins the hand and scores the rest', () => {
  const s = table(); s.turn = 399; hand(s, 2, card('1'), card('2'));
  act(s, 'p0', { kind: 'draw' });
  assert.equal(s.result!.winnerId, 'p2'); assert.equal(s.result!.points, (3 + 8 + 9 + 5) + (8 + 9 + 5)); assert.match(s.result!.reason, /Turn limit/); assert.equal(s.phase, 'intermission');
});

test('timeouts accept penalties, keep drawn cards or draw one; disconnected turns last 5 s; reconnect keeps everything', () => {
  const s = table({ stacking: true }); play(s, 'p0', hand(s, 0, card('draw2'), card('1'), card('2'))[0]);
  rules.tick(s, new Map(), 0, s.deadline - 1); assert.equal(s.current, 1);
  rules.tick(s, new Map(), 0, s.deadline); assert.equal(s.players[1].hand.length, 5); assert.equal(s.current, 2); assert.equal(s.pending, null);
  s.deck.push(card('1', 'lime')); s.color = 'lime'; act(s, 'p2', { kind: 'draw' }); rules.tick(s, new Map(), 0, s.deadline); assert.equal(s.players[2].hand.length, 4); assert.equal(s.current, 0);
  rules.tick(s, new Map(), 0, s.deadline); assert.equal(s.players[0].hand.length, 3); assert.equal(s.current, 1); assert.equal(view(s).events.at(-1)!.kind === 'timeout' || view(s).events.some(e => e.kind === 'timeout'), true);
  const t = table(); t.players[0].score = 42; const cards = [...t.players[0].hand];
  rules.onPresenceChange(t, 'p0', false, 1000); assert.equal(t.deadline, 6000); assert.equal(view(t).players[0].connected, false);
  rules.onPresenceChange(t, 'p1', false, 2000); assert.equal(t.deadline, 6000);
  rules.tick(t, new Map(), 0, 6000); assert.equal(t.current, 1); assert.equal(t.deadline, 11000);
  rules.onPresenceChange(t, 'p0', true, 7000); assert.equal(t.players[0].score, 42); assert.deepEqual(t.players[0].hand.slice(0, 3), cards); assert.equal(view(t).players[0].connected, true);
  const u = table({ challenge: true }); play(u, 'p0', hand(u, 0, card('wild4'), card('1'), card('2'))[0], { color: 'sky' }); rules.tick(u, new Map(), 0, u.deadline);
  assert.equal(u.players[1].hand.length, 7); assert.equal(u.current, 2);
});

test('time is monotonic and non-finite times are ignored', () => {
  const s = table(); rules.tick(s, new Map(), 0, 500); rules.tick(s, new Map(), 0, NaN); rules.tick(s, new Map(), 0, 100); assert.equal(s.now, 500);
  rules.onPresenceChange(s, 'p1', false, Infinity); assert.equal(s.now, 500);
  act(s, 'p0', { kind: 'draw' }, 10); assert.equal(s.now, 500); assert.equal(s.deadline, 5500); // p1 is away
  rules.applyAction(s, 'p1', { kind: 'draw', turnId: view(s).turnId }, NaN); assert.equal(s.now, 500);
});

test('projections are private, pure and serializable; events stay short and ordered', () => {
  const s = rules.create(ctx(4), { ...defaults, jumpIn: true, sevenZero: true });
  const pub = JSON.stringify(view(s)); assertSerializable(view(s));
  for (const p of s.players) {
    for (const c of p.hand) assert.ok(!pub.includes(`"${c.id}"`));
    const mine = own(s, p.id); assertSerializable(mine); assert.deepEqual(mine.hand.map(c => c.id), p.hand.map(c => c.id));
    const others = JSON.stringify(mine); for (const o of s.players) if (o !== p) for (const c of o.hand) assert.ok(!others.includes(`"${c.id}"`));
  }
  const before = structuredClone(s); view(s); own(s, 'p0'); rules.outcome(s); assert.deepEqual(s, before);
  const v = view(s); v.players[0].score = 999; v.top.value = 'wild'; v.events.length = 0; assert.deepEqual(s, before);
  assert.throws(() => own(s, 'ghost'));
  for (let i = 0; i < 40; i++) rules.tick(s, new Map(), 0, s.deadline);
  const events = view(s).events; assert.equal(events.length, 12); assert.ok(events.every((e, i) => !i || e.seq === events[i - 1].seq + 1)); assert.ok(events.every(e => e.text.length < 80));
  assert.ok(!('card' in events.find(e => e.kind === 'draw' || e.kind === 'timeout')!));
});

/** Plays a whole match using only the public and private view flags, with occasional timeouts and disconnects. */
function bot(count: number, settings: Settings, seed: number) {
  const s = rules.create(ctx(count, seed), settings), ids = s.players.map(p => p.id), used = new Set<string>();
  let r = seed * 7919 + 1, now = 0, steps = 0, prev = '';
  const rand = (n: number) => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return (r >>> 8) % n; };
  const send = (id: string, a: Loose) => { rules.applyAction(s, id, { turnId: view(s).turnId, ...a } as Action, now); used.add(a.kind); };
  for (;;) {
    assert.ok(++steps < 60000, `match ${count}p seed ${seed} did not finish`);
    now += 100; rules.tick(s, new Map(), 0.1, now);
    if (s.phase === 'complete') break;
    const v = view(s), views = ids.map(id => own(s, id)); assertSerializable(v); views.forEach(assertSerializable);
    if (steps % 700 === 0) { const p = s.players[rand(count)]; rules.onPresenceChange(s, p.id, !p.connected, now); continue; }
    const live = ids.filter((_, i) => s.players[i].connected);
    if (v.phase === 'intermission') {
      const id = live.find(id => !v.ready.includes(id));
      if (id) send(id, { kind: 'next', turnId: v.handId }); else now = v.nextHandAt! - 100;
      continue;
    }
    if (prev && prev !== v.turnId && steps % 11 === 0) assert.throws(() => rules.applyAction(s, v.current, { kind: 'draw', turnId: prev }, now), /Too slow/);
    prev = v.turnId;
    const roll = rand(100), at = (pred: (i: number) => boolean) => live.find(id => pred(ids.indexOf(id)));
    const catcher = at(i => views[i].canCatch), caller = at(i => views[i].canCall);
    if (catcher && roll < 20) { send(catcher, { kind: 'catch', turnId: v.ichiWindow!.id }); continue; }
    if (caller && roll < 50) { send(caller, { kind: 'ichi', turnId: v.ichiWindow?.playerId === caller ? v.ichiWindow.id : v.turnId }); continue; }
    const jumper = at(i => views[i].hand.some(c => c.jumpable));
    if (jumper && roll < 70) { send(jumper, { kind: 'play', cardId: views[ids.indexOf(jumper)].hand.find(c => c.jumpable)!.id, target: ids.find(id => id !== jumper) }); used.add('jump'); continue; }
    const me = views[ids.indexOf(v.current)];
    if (!s.players[ids.indexOf(v.current)].connected || roll > 97) { now = Math.max(now, v.deadline - 100); used.add('timeout'); continue; }
    const card = me.hand.find(c => c.playable), bad = me.hand.find(c => !c.playable), target = ids.find(id => id !== v.current)!;
    if (bad && roll % 9 === 0) assert.throws(() => rules.applyAction(s, v.current, { kind: 'play', turnId: v.turnId, cardId: bad.id, color: 'sun', target }, now));
    if (me.canChallenge && roll < 60) send(v.current, { kind: 'challenge' });
    else if (me.drawnId && roll < 30) send(v.current, { kind: 'keep' });
    else if (card) send(v.current, { kind: 'play', cardId: card.id, color: colors[rand(4)], target: ids.filter(id => id !== v.current)[rand(count - 1)] });
    else send(v.current, { kind: 'draw' });
  }
  const o = rules.outcome(s); assertSerializable(o); assertSerializable(rules.publicView(s, { nowMs: now, phase: 'results' }));
  const best = Math.max(...s.players.map(p => p.score));
  assert.ok(o.complete); assert.deepEqual(o.winners, s.players.filter(p => p.score === best).map(p => p.id)); assert.ok(s.hand <= 12);
  assert.ok(settings.target === 0 ? s.hand === 1 : best >= settings.target || s.hand === 12);
  return { used, outcome: o, hands: s.hand };
}

test('seeded full matches at 2 and 10 players across all 32 house-rule combinations and targets', () => {
  const used = new Set<string>(), keys = Object.keys(houseRules) as (keyof typeof houseRules)[];
  for (let bits = 0; bits < 32; bits++) for (const count of [2, 10]) for (const target of options.target) {
    const settings = { ...defaults, target, handSize: options.handSize[bits % 3], turnSeconds: options.turnSeconds[bits % 3], ...Object.fromEntries(keys.map((k, i) => [k, !!(bits & 1 << i)])) } as Settings;
    for (const kind of bot(count, settings, bits * 31 + count + target).used) used.add(kind);
  }
  for (const kind of ['play', 'draw', 'keep', 'challenge', 'ichi', 'catch', 'next', 'jump', 'timeout']) assert.ok(used.has(kind), `bot never used ${kind}`);
  const settings = { ...defaults, jumpIn: true, sevenZero: true };
  assert.deepEqual(bot(4, settings, 77).outcome, bot(4, settings, 77).outcome);
});
