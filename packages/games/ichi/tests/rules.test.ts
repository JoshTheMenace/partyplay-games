import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MESSAGE_BYTES, MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { SnapshotDecoder, SnapshotEncoder, snapshotForCursor } from '../../../party-contract/src/snapshot-cache';
import { manifest } from '../src/manifest';
import { due, rules, type State } from '../src/server';
import { ROUND_MS, colors, defaults, houseRules, options, points, roundCount, tableCount, type Action, type Card, type Color, type PublicView, type Settings, type Value } from '../src/types';

const ctx = (count = 3, seed = 1234) => ({ roomId: 'room', roundId: 'round', nowMs: 0, seed, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, color: '#ff5748' })) });
const classic = { ...defaults, ...Object.fromEntries(Object.keys(houseRules).map(k => [k, false])) } as Settings;
const pub = (s: State) => rules.publicView(s, { nowMs: s.now, phase: 'playing' });
/** The table the TV shows; with one table that is the whole game. */
const view = (s: State) => pub(s).feature!;
const own = (s: State, id: string) => rules.playerView(s, id, { nowMs: s.now, phase: 'playing' });
const T = (s: State) => s.tables[0];
const tick = (s: State, at: number) => rules.tick(s, new Map(), 0, at);
type Loose = { kind: Action['kind']; turnId?: string; cardId?: string; color?: Color; target?: string; give?: string };
const act = (s: State, id: string, a: Loose, at = s.now + 1) => rules.applyAction(s, id, { turnId: view(s).turnId, ...a } as Action, at);
const play = (s: State, id: string, c: Card, extra: Partial<Loose> = {}) => act(s, id, { kind: 'play', cardId: c.id, ...extra });
const rejects = (s: State, fn: () => void, message = /./) => { const before = structuredClone(s); assert.throws(fn, message); assert.deepEqual(s, before); };
let serial = 0;
const card = (value: Value, color: Color = 'coral'): Card => ({ id: `x${serial++}`, color: value === 'wild' || value === 'wild4' ? 'wild' : color, value });
/** Three seats at one table, coral 4 on top, hands of three unplayable cards and a deck of unplayable lime 3s (top of deck is the end). */
function table(settings: Partial<Settings> = {}, count = 3) {
  const s = rules.create(ctx(count), { ...classic, ...settings }), t = T(s);
  t.discard = [card('4')]; t.color = 'coral'; t.deck = Array.from({ length: 20 }, () => card('3', 'lime'));
  for (const p of s.players) p.hand = [card('8', 'sky'), card('9', 'sky'), card('5', 'lime')];
  return s;
}
const hand = (s: State, i: number, ...cards: Card[]) => { s.players[i].hand = cards; return cards; };

test('settings default, merge and reject malformed values', () => {
  assert.deepEqual(rules.validateSettings({}), defaults);
  assert.deepEqual(rules.validateSettings({ target: 0, jumpIn: true }), { ...defaults, target: 0, jumpIn: true });
  for (const raw of [null, [], 'x', { bogus: true }, { handSize: 8 }, { tableSize: 3 }, { gifts: 'on' }, { target: '200' }, { turnSeconds: 30 }, { stacking: 1 }, { jumpIn: 'yes' }, { target: NaN }]) assert.throws(() => rules.validateSettings(raw));
});

test('parseAction is strict and never emits undefined fields', () => {
  assert.deepEqual(rules.parseAction({ kind: 'draw', turnId: 'h1:0' }), { kind: 'draw', turnId: 'h1:0' });
  assert.deepEqual(Object.keys(rules.parseAction({ kind: 'play', turnId: 'h1:0', cardId: 'c1' })), ['kind', 'turnId', 'cardId']);
  assert.deepEqual(rules.parseAction({ kind: 'play', turnId: 't', cardId: 'c', color: 'sun', target: 'p1', give: 'c2' }), { kind: 'play', turnId: 't', cardId: 'c', color: 'sun', target: 'p1', give: 'c2' });
  const long = 'x'.repeat(65);
  for (const raw of [null, [], { kind: 'pass', turnId: 't' }, { kind: 'draw' }, { kind: 'draw', turnId: '' }, { kind: 'draw', turnId: long }, { kind: 'draw', turnId: 't', cardId: 'c' }, { kind: 'draw', turnId: 't', give: 'c' },
    { kind: 'play', turnId: 't' }, { kind: 'play', turnId: 't', cardId: long }, { kind: 'play', turnId: 't', cardId: 'c', color: 'wild' }, { kind: 'play', turnId: 't', cardId: 'c', target: 5 }, { kind: 'play', turnId: 't', cardId: 'c', give: '' },
    { kind: 'play', turnId: 't', cardId: 'c', cheat: true }, { kind: 'catch', turnId: 7 }]) assert.throws(() => rules.parseAction(raw));
});

test('decks: 108 cards plus four Gifts, doubled at 7+, numbered first discard, seeded shuffle', () => {
  for (const [count, copies, settings] of [[2, 1, classic], [6, 1, defaults], [7, 2, classic], [10, 2, defaults]] as const) {
    const s = rules.create(ctx(count), settings), all = [...T(s).deck, ...T(s).discard, ...s.players.flatMap(p => p.hand)], n = (v: Value) => all.filter(c => c.value === v).length;
    assert.equal(all.length, (settings.gifts ? 112 : 108) * copies); assert.equal(new Set(all.map(c => c.id)).size, all.length);
    assert.deepEqual([n('0'), n('7'), n('skip'), n('draw2'), n('wild'), n('wild4'), n('gift')], [4, 8, 8, 8, 4, 4, settings.gifts ? 4 : 0].map(k => k * copies));
    assert.ok(s.players.every(p => p.hand.length === 7));
  }
  for (let seed = 0; seed < 200; seed++) { const s = rules.create(ctx(4, seed), defaults); assert.match(T(s).discard[0].value, /^\d$/); assert.equal(T(s).color, T(s).discard[0].color); }
  assert.deepEqual(rules.create(ctx(4, 9), defaults), rules.create(ctx(4, 9), defaults));
  assert.notDeepEqual(T(rules.create(ctx(4, 9), defaults)).deck, T(rules.create(ctx(4, 10), defaults)).deck);
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
  play(s, 'p0', sky4); assert.equal(T(s).color, 'sky'); assert.equal(T(s).current, 1);
  T(s).current = 0; play(s, 'p0', wild, { color: 'sun' }); assert.equal(T(s).color, 'sun'); assert.equal(view(s).top.id, wild.id);
});

test('stale and duplicate actions are rejected with a friendly reason', () => {
  const s = table(), old = view(s).turnId, [c] = hand(s, 0, card('6'), card('7'), card('8'));
  play(s, 'p0', c, { turnId: old });
  rejects(s, () => act(s, 'p0', { kind: 'play', cardId: s.players[0].hand[0].id, turnId: old }), /Too slow/);
  rejects(s, () => act(s, 'p1', { kind: 'draw', turnId: old }), /Too slow/);
  rejects(s, () => act(s, 'p1', { kind: 'draw' }, T(s).deadline), /Time/);
  rejects(s, () => act(s, 'nobody', { kind: 'draw' }));
});

test('draw: unplayable ends the turn, playable may be played or kept', () => {
  const s = table(); act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 4); assert.equal(T(s).current, 1);
  T(s).deck.push(card('1')); act(s, 'p1', { kind: 'draw' }); const drawn = s.players[1].hand.at(-1)!;
  assert.equal(T(s).current, 1); assert.equal(own(s, 'p1').drawnId, drawn.id); assert.equal(own(s, 'p0').drawnId, null); assert.equal(view(s).drawn, true);
  assert.deepEqual(own(s, 'p1').hand.filter(c => c.playable).map(c => c.id), [drawn.id]);
  rejects(s, () => act(s, 'p1', { kind: 'draw' }), /drew/);
  s.players[1].hand.unshift(card('4', 'lime')); rejects(s, () => play(s, 'p1', s.players[1].hand[0]), /drew/);
  act(s, 'p1', { kind: 'keep' }); assert.equal(T(s).current, 2); assert.ok(s.players[1].hand.includes(drawn));
  rejects(s, () => act(s, 'p2', { kind: 'keep' }), /Draw/);
  T(s).deck.push(card('2')); act(s, 'p2', { kind: 'draw' }); play(s, 'p2', s.players[2].hand.at(-1)!); assert.equal(T(s).current, 0); assert.equal(s.players[2].hand.length, 3);
});

test('draw till you can keeps drawing until a playable card, and stops at exhaustion', () => {
  const s = table({ drawUntilPlayable: true }); T(s).deck = [card('1'), card('3', 'lime'), card('3', 'lime'), card('3', 'lime')];
  act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 7); assert.equal(T(s).drawn, s.players[0].hand.at(-1)!.id); assert.equal(T(s).current, 0);
  act(s, 'p0', { kind: 'keep' }); act(s, 'p1', { kind: 'draw' }); assert.equal(T(s).deck.length, 0); assert.equal(T(s).current, 2); assert.equal(T(s).drawn, null);
});

test('reshuffle keeps the top card; exhausted deck and the 30-card cap end the draw without deadlock', () => {
  const s = table(), top = T(s).discard[0]; T(s).deck = []; T(s).discard = [card('7', 'lime'), card('6', 'lime'), top];
  act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 4); assert.deepEqual(T(s).discard, [top]); assert.equal(T(s).deck.length, 1);
  T(s).deck = []; act(s, 'p1', { kind: 'draw' }); assert.equal(s.players[1].hand.length, 3); assert.equal(T(s).current, 2);
  T(s).deck = [card('1')]; hand(s, 2, ...Array.from({ length: 30 }, () => card('5', 'lime')));
  act(s, 'p2', { kind: 'draw' }); assert.equal(s.players[2].hand.length, 30); assert.equal(T(s).current, 0);
  const t = table({ stacking: true }); T(t).deck = Array.from({ length: 20 }, () => card('3', 'lime')); hand(t, 1, ...Array.from({ length: 29 }, () => card('5', 'lime')));
  play(t, 'p0', hand(t, 0, card('draw2'), card('1'), card('2'))[0]); act(t, 'p1', { kind: 'draw' }); assert.equal(t.players[1].hand.length, 30);
});

test('skip, reverse, two-player reverse and unstacked +2 / +4', () => {
  const s = table(); play(s, 'p0', hand(s, 0, card('skip'), card('1'), card('2'))[0]); assert.equal(T(s).current, 2);
  play(s, 'p2', hand(s, 2, card('reverse'), card('1'), card('2'))[0]); assert.equal(T(s).direction, -1); assert.equal(T(s).current, 1);
  play(s, 'p1', hand(s, 1, card('draw2'), card('1'), card('2'))[0]); assert.equal(s.players[0].hand.length, 4); assert.equal(T(s).current, 2); assert.equal(T(s).pending, null);
  play(s, 'p2', hand(s, 2, card('wild4'), card('1'), card('2'))[0], { color: 'lime' }); assert.equal(s.players[1].hand.length, 6); assert.equal(T(s).current, 0); assert.equal(T(s).color, 'lime');
  const two = table({}, 2); play(two, 'p0', hand(two, 0, card('reverse'), card('1'), card('2'))[0]); assert.equal(T(two).current, 0); assert.equal(T(two).direction, -1);
  play(two, 'p0', hand(two, 0, card('skip'), card('1'), card('2'))[0]); assert.equal(T(two).current, 0);
});

test('stacking grows the penalty; +4 only answers with +4; flags follow the pending rule', () => {
  const s = table({ stacking: true });
  play(s, 'p0', hand(s, 0, card('draw2'), card('1'), card('2'))[0]);
  assert.deepEqual(view(s).pending, { count: 2, kind: 'draw2', from: 0, before: null, challengeable: false }); assert.equal(T(s).current, 1);
  const [sky2, match] = hand(s, 1, card('draw2', 'sky'), card('4'), card('wild4'), card('wild'));
  assert.deepEqual(own(s, 'p1').hand.map(c => c.playable), [true, false, true, false]);
  rejects(s, () => play(s, 'p1', match), /Stack/);
  play(s, 'p1', sky2); assert.equal(T(s).pending!.count, 4); assert.equal(T(s).color, 'sky'); assert.match(view(s).events.at(-1)!.text, /stacked Sky \+2 → 4/);
  const [p2w4, p2d2] = hand(s, 2, card('wild4'), card('draw2', 'sky'), card('1'));
  play(s, 'p2', p2w4, { color: 'sun' }); assert.deepEqual(view(s).pending, { count: 8, kind: 'wild4', from: 2, before: null, challengeable: false });
  assert.equal(own(s, 'p0').hand.every(c => !c.playable), true);
  T(s).current = 2; T(s).pending = { count: 8, kind: 'wild4', from: 1, bluff: false, before: null }; rejects(s, () => play(s, 'p2', p2d2), /\+4/); T(s).current = 0;
  hand(s, 0, card('1'), card('2'), card('3'));
  act(s, 'p0', { kind: 'draw' }); assert.equal(s.players[0].hand.length, 11); assert.equal(T(s).pending, null); assert.equal(T(s).current, 1);
});

test('+4 challenge: bluff is judged at play time; guilty draws, innocent adds two', () => {
  const s = table({ challenge: true }), [w4] = hand(s, 0, card('wild4'), card('1'), card('2', 'sky'));
  play(s, 'p0', w4, { color: 'sky' }); assert.equal(view(s).pending!.before, 'coral'); assert.equal(own(s, 'p1').canChallenge, true); assert.equal(own(s, 'p2').canChallenge, false);
  assert.equal(own(s, 'p1').hand.every(c => !c.playable), true);
  hand(s, 0, card('5', 'lime'), card('6', 'lime')); // later hand changes don't matter
  const turn = view(s).turnId; act(s, 'p1', { kind: 'challenge' });
  assert.equal(s.players[0].hand.length, 6); assert.equal(T(s).current, 1); assert.notEqual(view(s).turnId, turn); assert.equal(T(s).pending, null);
  assert.equal(view(s).events.at(-2)!.success, true); assert.match(view(s).events.at(-2)!.text, /had Coral/);
  play(s, 'p1', hand(s, 1, card('1', 'sky'), card('2'), card('3'))[0]); assert.equal(T(s).current, 2);
  const t = table({ challenge: true }); play(t, 'p0', hand(t, 0, card('wild4'), card('1', 'sky'), card('2', 'sky'))[0], { color: 'lime' });
  act(t, 'p1', { kind: 'challenge' }); assert.equal(t.players[1].hand.length, 9); assert.equal(T(t).current, 2); assert.equal(t.players[0].hand.length, 2);
  const u = table({ challenge: true, stacking: true }); play(u, 'p0', hand(u, 0, card('draw2'), card('1'), card('2'))[0]);
  rejects(u, () => act(u, 'p1', { kind: 'challenge' }), /\+4/);
  const w = table({ challenge: true, stacking: true }); play(w, 'p0', hand(w, 0, card('wild4'), card('1'), card('2'))[0], { color: 'sky' });
  play(w, 'p1', hand(w, 1, card('wild4'), card('1', 'sky'), card('2'))[0], { color: 'lime' }); // stacked: only +2/+4 were legal, so never a bluff
  assert.deepEqual([view(w).pending!.before, view(w).pending!.challengeable, own(w, 'p2').canChallenge], [null, false, false]);
  rejects(w, () => act(w, 'p2', { kind: 'challenge' }), /stacked/);
  const v = table(); play(v, 'p0', hand(v, 0, card('wild4'), card('1'), card('2'))[0], { color: 'lime' }); assert.equal(T(v).pending, null);
  assert.equal(T(v).current, 2); rejects(v, () => act(v, 'p2', { kind: 'challenge' }), /\+4/);
});

test('Ichi: no early call, every drop to one card opens a race window with its own id, expiry and turn progress', () => {
  const s = table(); hand(s, 0, card('8'), card('9', 'sky'));
  assert.equal(own(s, 'p0').canCall, false); rejects(s, () => act(s, 'p0', { kind: 'ichi' }), /one card/);

  const t = table(); hand(t, 0, card('8'), card('9', 'sky')); play(t, 'p0', t.players[0].hand[0]);
  const w = view(t).ichiWindow!; assert.equal(w.p, 0); assert.equal(w.until, t.now + 5000); assert.notEqual(w.id, view(t).turnId);
  assert.deepEqual([own(t, 'p0').canCall, own(t, 'p0').canCatch, own(t, 'p1').canCatch, own(t, 'p2').canCall], [true, false, true, false]);
  act(t, 'p1', { kind: 'draw' }); // play continues during the window
  rejects(t, () => act(t, 'p0', { kind: 'catch', turnId: w.id }), /Ichi/);
  rejects(t, () => act(t, 'p2', { kind: 'ichi', turnId: w.id }), /one card/);
  const before = view(t).turnId; act(t, 'p2', { kind: 'catch', turnId: w.id });
  assert.equal(t.players[0].hand.length, 3); assert.equal(T(t).window, null); assert.equal(view(t).turnId, before); assert.equal(view(t).events.at(-1)!.kind, 'catch');
  rejects(t, () => act(t, 'p1', { kind: 'catch', turnId: w.id }), /Too slow — that catch window already closed/); // lost the race to p2
  rejects(t, () => act(t, 'p0', { kind: 'ichi', turnId: w.id }), /Too slow — that catch window already closed/); // and so did the late call

  const u = table(); hand(u, 0, card('8'), card('9', 'sky')); play(u, 'p0', u.players[0].hand[0]);
  act(u, 'p0', { kind: 'ichi', turnId: T(u).window!.id }); assert.equal(u.players[0].safe, true); assert.equal(T(u).window, null);
  const x = table(); hand(x, 0, card('8'), card('9', 'sky')); play(x, 'p0', x.players[0].hand[0]); const id = T(x).window!.id;
  rules.tick(x, new Map(), 0, T(x).window!.until - 1); assert.ok(T(x).window);
  rejects(x, () => act(x, 'p1', { kind: 'catch', turnId: id }, T(x).window!.until), /Too slow/);
  rules.tick(x, new Map(), 0, T(x).window!.until); assert.equal(T(x).window, null); assert.equal(x.players[0].safe, true);
  T(x).deck.push(card('1', 'lime')); T(x).current = 0; act(x, 'p0', { kind: 'draw' }); assert.equal(x.players[0].safe, false);
});

test('a catch reports the cards actually drawn when the piles run dry', () => {
  const s = table(); hand(s, 0, card('8'), card('9', 'sky')); play(s, 'p0', s.players[0].hand[0]); T(s).deck = [card('1', 'lime')]; T(s).discard = [T(s).discard.at(-1)!];
  act(s, 'p1', { kind: 'catch', turnId: T(s).window!.id });
  assert.equal(s.players[0].hand.length, 2); assert.deepEqual([view(s).events.at(-1)!.count, view(s).events.at(-1)!.text], [1, 'Player1 caught Player0! +1']);
});

test('a second unannounced one-card hand closes the earlier window in its owner’s favor', () => {
  const s = table(); hand(s, 0, card('8'), card('9', 'sky')); hand(s, 1, card('1'), card('1', 'lime'));
  play(s, 'p0', s.players[0].hand[0]); const first = T(s).window!.id; play(s, 'p1', s.players[1].hand[0]);
  assert.equal(s.players[0].safe, true); assert.equal(T(s).window!.p, 1); assert.notEqual(T(s).window!.id, first);
});

test('Seven-O: 7 swaps with a chosen player, 0 rotates, one-card hands are automatically safe', () => {
  const s = table({ sevenZero: true }), [seven] = hand(s, 0, card('7'), card('1', 'lime'), card('2', 'lime')), p2 = [...s.players[2].hand];
  rejects(s, () => play(s, 'p0', seven), /swap/); rejects(s, () => play(s, 'p0', seven, { target: 'p0' }), /swap/); rejects(s, () => play(s, 'p0', seven, { target: 'zz' }), /swap/);
  play(s, 'p0', seven, { target: 'p2' }); assert.deepEqual(s.players[0].hand, p2); assert.equal(s.players[2].hand.length, 2); assert.equal(view(s).events.at(-1)!.kind, 'swap');
  const t = table({ sevenZero: true }); play(t, 'p0', hand(t, 0, card('7'), card('1', 'lime'))[0], { target: 'p1' });
  assert.equal(t.players[1].hand.length, 1); assert.equal(t.players[1].safe, true); assert.equal(T(t).window, null); assert.equal(t.players[0].safe, false);
  const u = table({ sevenZero: true }), hands = u.players.map(p => p.hand); hand(u, 0, card('0'), card('1', 'lime')); const mine = u.players[0].hand;
  play(u, 'p0', mine[0]); assert.deepEqual(u.players.map(p => p.hand), [hands[2], mine, hands[1]]); assert.equal(u.players[1].safe, true); assert.equal(T(u).window, null);
  const off = table(); play(off, 'p0', hand(off, 0, card('7'), card('1'), card('2'))[0]); assert.equal(off.players[0].hand.length, 2);
  const last = table({ sevenZero: true }); play(last, 'p0', hand(last, 0, card('7'))[0]); assert.equal(last.phase, 'intermission'); assert.equal(T(last).result!.winner, 0);
});

test('Jump in: exact non-wild copy out of turn, play continues from the jumper, races resolve by turnId', () => {
  const s = table({ jumpIn: true }), [copy] = hand(s, 2, card('4'), card('4', 'sky'), card('1')), old = view(s).turnId;
  assert.deepEqual(own(s, 'p2').hand.map(c => c.jumpable), [true, false, false]); assert.equal(own(s, 'p0').hand.some(c => c.jumpable), false);
  rejects(s, () => play(s, 'p2', s.players[2].hand[1]), /exact/);
  play(s, 'p2', copy); assert.equal(T(s).current, 0); assert.equal(view(s).events.at(-1)!.kind, 'jump');
  rejects(s, () => act(s, 'p0', { kind: 'draw', turnId: old }), /Too slow/);
  const t = table({ jumpIn: true }), late = view(t).turnId, [c] = hand(t, 1, card('4'), card('1'), card('2'));
  act(t, 'p0', { kind: 'draw' }); rejects(t, () => play(t, 'p1', c, { turnId: late }), /Too slow/);
  const u = table({ jumpIn: true, stacking: true }); hand(u, 2, card('draw2'), card('1'), card('2')); play(u, 'p0', hand(u, 0, card('draw2'), card('1'), card('2'))[0]);
  assert.equal(own(u, 'p2').hand[0].jumpable, false); rejects(u, () => play(u, 'p2', u.players[2].hand[0]), /right now/);
  const v = table({ jumpIn: true }); T(v).deck.push(card('1')); act(v, 'p0', { kind: 'draw' }); hand(v, 2, card('4'), card('1'), card('2'));
  assert.equal(own(v, 'p2').hand[0].jumpable, false);
  const w = table({ jumpIn: true }); T(w).discard.push(card('wild')); hand(w, 2, card('wild'), card('1'), card('2')); assert.equal(own(w, 'p2').hand[0].jumpable, false);
  const off = table(); hand(off, 2, card('4'), card('1'), card('2')); assert.equal(own(off, 'p2').hand[0].jumpable, false); rejects(off, () => play(off, 'p2', off.players[2].hand[0]), /Wait/);
});

test('hand end scores the other hands; the final +2 still lands; hands are revealed only afterwards', () => {
  const s = table(); hand(s, 0, card('draw2')); hand(s, 1, card('wild'), card('skip', 'sky'), card('5', 'lime')); hand(s, 2, card('9', 'lime'));
  assert.equal(view(s).handResult, null);
  play(s, 'p0', s.players[0].hand[0]);
  assert.equal(s.players[1].hand.length, 5); assert.equal(s.phase, 'intermission');
  const r = view(s).handResult!; assert.equal(r.winner, 0); assert.equal(r.points, 50 + 20 + 5 + 3 + 3 + 9);
  assert.equal(pub(s).roster[0].score, r.points); assert.equal(pub(s).roster[0].handsWon, 1); assert.deepEqual(r.hands.map(h => h.cards.length), [0, 5, 1]);
  assert.equal(points({ value: 'wild4' }), 50); assert.equal(points({ value: 'reverse' }), 20); assert.equal(points({ value: '7' }), 7);
  const t = table({ stacking: true, challenge: true }); play(t, 'p0', hand(t, 0, card('draw2'), card('1'), card('2'))[0]);
  hand(t, 1, card('wild4')); play(t, 'p1', t.players[1].hand[0], { color: 'sun' }); assert.equal(t.players[2].hand.length, 9); assert.equal(T(t).pending, null); assert.equal(T(t).result!.winner, 1);
});

test('intermission: next uses handId, duplicates rejected, early start after 3 s once connected players are ready', () => {
  const s = table(); hand(s, 0, card('1')); play(s, 'p0', s.players[0].hand[0]); const ended = s.now;
  assert.equal(view(s).nextHandAt, ended + 10000); assert.equal(view(s).handId, 'h1');
  rejects(s, () => act(s, 'p1', { kind: 'draw' }), /hasn’t started/);
  rejects(s, () => act(s, 'p1', { kind: 'next', turnId: 'h0' }));
  rules.onPresenceChange(s, 'p2', false, ended + 1);
  act(s, 'p0', { kind: 'next', turnId: 'h1' }); rejects(s, () => act(s, 'p0', { kind: 'next', turnId: 'h1' }), /already/);
  assert.equal(view(s).nextHandAt, ended + 10000); act(s, 'p1', { kind: 'next', turnId: 'h1' });
  assert.deepEqual(view(s).ready, [0, 1]); assert.equal(view(s).nextHandAt, ended + 3000);
  rules.tick(s, new Map(), 0, ended + 2999); assert.equal(s.phase, 'intermission');
  rules.tick(s, new Map(), 0, ended + 3000); assert.equal(s.phase, 'playing'); assert.equal(view(s).hand, 2); assert.equal(view(s).current, 1);
  assert.equal(s.players[0].score, 44); assert.ok(s.players.every(p => p.hand.length === 7)); assert.equal(view(s).handResult, null); assert.deepEqual(view(s).ready, []);
  assert.equal(T(s).deadline, s.now + 25000);
  rejects(s, () => act(s, 'p0', { kind: 'next', turnId: 'h1' }), /already started/);
  const t = table(); hand(t, 0, card('1')); play(t, 'p0', t.players[0].hand[0]); rules.tick(t, new Map(), 0, t.now + 10000); assert.equal(t.phase, 'playing');
});

test('match target, one-hand match, ties share the win and rank', () => {
  const s = table({ target: 0 }); hand(s, 0, card('1')); play(s, 'p0', s.players[0].hand[0]);
  assert.equal(s.phase, 'complete'); assert.deepEqual(rules.outcome(s).winners, ['p0']); assert.deepEqual(pub(s).match.winners, [0]); assert.match(pub(s).match.finishReason, /One-hand/);
  rejects(s, () => act(s, 'p1', { kind: 'next', turnId: 'h1' }), /over/);
  const t = table(); t.players[1].score = 190; hand(t, 0, card('1')); T(t).current = 1; hand(t, 1, card('1')); play(t, 'p1', t.players[1].hand[0]);
  assert.equal(t.phase, 'complete'); assert.deepEqual(rules.outcome(t).rows[0], { playerId: 'p1', score: 190 + 1 + 22, rank: 1, label: '213 pts · 1 hand' });
  const u = table(); T(u).hand = 12; T(u).turn = 399; u.players.forEach((p, i) => { p.score = [100, 100, 40][i]; });
  act(u, 'p0', { kind: 'draw' }); // turn 400: p1 and p2 tie for fewest cards, no winner
  assert.equal(T(u).result!.winner, null); assert.equal(u.phase, 'complete');
  const o = rules.outcome(u); assert.deepEqual(o.winners, ['p0', 'p1']); assert.deepEqual(o.rows.map(r => [r.playerId, r.rank]), [['p0', 1], ['p1', 1], ['p2', 3]]);
  assert.equal(o.rows[2].label, '40 pts · 0 hands'); assert.match(pub(u).match.finishReason, /12 hands.*share the win/);
  assert.deepEqual(rules.outcome(table()).winners, []); assert.equal(rules.outcome(table()).complete, false);
});

test('400-turn cap: fewest cards wins the hand and scores the rest', () => {
  const s = table(); T(s).turn = 399; hand(s, 2, card('1'), card('2'));
  act(s, 'p0', { kind: 'draw' });
  assert.equal(T(s).result!.winner, 2); assert.equal(T(s).result!.points, (3 + 8 + 9 + 5) + (8 + 9 + 5)); assert.match(T(s).result!.reason, /Turn limit/); assert.equal(s.phase, 'intermission');
});

test('timeouts accept penalties, keep drawn cards or draw one; disconnected turns last 5 s; reconnect keeps everything', () => {
  const s = table({ stacking: true }); play(s, 'p0', hand(s, 0, card('draw2'), card('1'), card('2'))[0]);
  rules.tick(s, new Map(), 0, T(s).deadline - 1); assert.equal(T(s).current, 1);
  rules.tick(s, new Map(), 0, T(s).deadline); assert.equal(s.players[1].hand.length, 5); assert.equal(T(s).current, 2); assert.equal(T(s).pending, null);
  T(s).deck.push(card('1', 'lime')); T(s).color = 'lime'; act(s, 'p2', { kind: 'draw' }); rules.tick(s, new Map(), 0, T(s).deadline); assert.equal(s.players[2].hand.length, 4); assert.equal(T(s).current, 0);
  rules.tick(s, new Map(), 0, T(s).deadline); assert.equal(s.players[0].hand.length, 3); assert.equal(T(s).current, 1); assert.equal(view(s).events.at(-1)!.kind === 'timeout' || view(s).events.some(e => e.kind === 'timeout'), true);
  const t = table(); t.players[0].score = 42; const cards = [...t.players[0].hand];
  rules.onPresenceChange(t, 'p0', false, 1000); assert.equal(T(t).deadline, 6000); assert.equal(pub(t).roster[0].connected, false);
  rules.onPresenceChange(t, 'p1', false, 2000); assert.equal(T(t).deadline, 6000);
  rules.tick(t, new Map(), 0, 6000); assert.equal(T(t).current, 1); assert.equal(T(t).deadline, 11000);
  rules.onPresenceChange(t, 'p0', true, 7000); assert.equal(t.players[0].score, 42); assert.deepEqual(t.players[0].hand.slice(0, 3), cards); assert.equal(pub(t).roster[0].connected, true);
  const u = table({ challenge: true }); play(u, 'p0', hand(u, 0, card('wild4'), card('1'), card('2'))[0], { color: 'sky' }); rules.tick(u, new Map(), 0, T(u).deadline);
  assert.equal(u.players[1].hand.length, 7); assert.equal(T(u).current, 2);
});

test('time is monotonic and non-finite times are ignored', () => {
  const s = table(); rules.tick(s, new Map(), 0, 500); rules.tick(s, new Map(), 0, NaN); rules.tick(s, new Map(), 0, 100); assert.equal(s.now, 500);
  rules.onPresenceChange(s, 'p1', false, Infinity); assert.equal(s.now, 500);
  act(s, 'p0', { kind: 'draw' }, 10); assert.equal(s.now, 500); assert.equal(T(s).deadline, 5500); // p1 is away
  rules.applyAction(s, 'p1', { kind: 'draw', turnId: view(s).turnId }, NaN); assert.equal(s.now, 500);
});

test('projections are private, pure and serializable; events stay short and ordered', () => {
  const s = rules.create(ctx(4), { ...defaults, jumpIn: true, sevenZero: true });
  const all = JSON.stringify(pub(s)); assertSerializable(pub(s));
  for (const p of s.players) {
    for (const c of p.hand) assert.ok(!all.includes(`"${c.id}"`));
    const mine = own(s, p.id); assertSerializable(mine); assert.deepEqual(mine.hand.map(c => c.id), p.hand.map(c => c.id)); assert.ok(!('table' in mine));
    const others = JSON.stringify(mine); for (const o of s.players) if (o !== p) for (const c of o.hand) assert.ok(!others.includes(`"${c.id}"`));
  }
  const before = structuredClone(s); pub(s); own(s, 'p0'); rules.outcome(s); assert.deepEqual(s, before);
  const v = pub(s); v.roster[0].score = 999; v.feature!.top.value = 'wild'; v.feature!.events.length = 0; v.settings.target = 0; v.match.ready.push(1); assert.deepEqual(s, before);
  assert.throws(() => own(s, 'ghost'));
  for (let i = 0; i < 40; i++) tick(s, T(s).deadline);
  const events = view(s).events; assert.equal(events.length, 12); assert.ok(events.every((e, i) => !i || e.seq === events[i - 1].seq + 1)); assert.ok(events.every(e => e.text.length < 80));
  assert.ok(!('card' in events.find(e => e.kind === 'draw' || e.kind === 'timeout')!));
});

test('a finished match holds its last table for six seconds, then completes', () => {
  const s = table({ target: 0 }); hand(s, 0, card('1')); play(s, 'p0', s.players[0].hand[0]); const ended = s.now;
  assert.deepEqual([s.phase, pub(s).match.nextAt, rules.outcome(s).complete, view(s).handResult!.winner, view(s).phase], ['complete', ended + 6000, false, 0, 'idle']);
  assert.deepEqual([own(s, 'p1').hand.some(c => c.playable), own(s, 'p1').canCatch, due(s)], [false, false, ended + 6000]);
  tick(s, ended + 5999); assert.equal(rules.outcome(s).complete, false); tick(s, ended + 6000); assert.equal(rules.outcome(s).complete, true);
});

test('Gift: four join the deck; playing one hands another card, face down, to a chosen player', () => {
  const full = rules.create(ctx(4), defaults), cards = [...T(full).deck, ...T(full).discard, ...full.players.flatMap(p => p.hand)];
  assert.equal(cards.length, 112); assert.deepEqual(cards.filter(c => c.value === 'gift').map(c => c.color).sort(), [...colors].sort()); assert.equal(points({ value: 'gift' }), 20);
  const s = table({ gifts: true }), [gift, junk, keep] = hand(s, 0, card('gift'), card('9', 'lime'), card('1', 'sky'));
  assert.equal(own(s, 'p0').hand[0].playable, true);
  for (const give of [undefined, gift.id, 'nope', s.players[1].hand[0].id]) rejects(s, () => play(s, 'p0', gift, { give, target: 'p1' }), /give away/);
  for (const target of [undefined, 'p0', 'zz']) rejects(s, () => play(s, 'p0', gift, { give: junk.id, target }), /who gets/);
  play(s, 'p0', gift, { give: junk.id, target: 'p2' });
  assert.deepEqual(s.players[0].hand, [keep]); assert.equal(s.players[2].hand.at(-1), junk); assert.equal(s.players[2].hand.length, 4); assert.equal(T(s).current, 1); assert.equal(view(s).top.id, gift.id);
  const e = view(s).events.find(e => e.kind === 'gift')!; assert.deepEqual([e.by, e.to, 'card' in e, e.text], [0, 2, false, 'Player0 handed Player2 a card.']);
  // Only the two players involved ever see which card moved.
  assert.ok(!JSON.stringify(pub(s)).includes(`"${junk.id}"`)); assert.ok(!JSON.stringify(own(s, 'p1')).includes(`"${junk.id}"`)); assert.ok(own(s, 'p2').hand.some(c => c.id === junk.id));
  assert.equal(view(s).ichiWindow!.p, 0); // down to one card: the race opens as usual
});

test('Gift: a last Gift needs nothing, giving your last card goes out, and a gift breaks the receiver’s Ichi', () => {
  const s = table({ gifts: true }); play(s, 'p0', hand(s, 0, card('gift'))[0]); assert.equal(T(s).result!.winner, 0); assert.equal(s.players[1].hand.length, 3);
  const t = table({ gifts: true }), [gift, last] = hand(t, 0, card('gift'), card('wild4'));
  play(t, 'p0', gift, { give: last.id, target: 'p1' });
  assert.deepEqual([T(t).result!.winner, T(t).result!.points, T(t).result!.hands[1].cards.length, T(t).window], [0, 22 * 2 + 50, 4, null]);
  const u = table({ gifts: true }); hand(u, 1, card('2', 'lime')); u.players[1].safe = true; T(u).window = { id: 'h1:ichi9', p: 1, until: 9000 };
  play(u, 'p0', hand(u, 0, card('gift'), card('9', 'lime'), card('1', 'sky'), card('2', 'sky'))[0], { give: u.players[0].hand[1].id, target: 'p1' });
  assert.deepEqual([u.players[1].hand.length, u.players[1].safe, T(u).window], [2, false, null]);
  const big = table({ gifts: true }); hand(big, 1, ...Array.from({ length: 30 }, () => card('5', 'lime')));
  const [wrapped, spare] = hand(big, 0, card('gift'), card('1', 'sky'), card('2', 'sky')); rejects(big, () => play(big, 'p0', wrapped, { give: spare.id, target: 'p1' }), /can’t hold/);
  const two = table({ gifts: true, stacking: true }); play(two, 'p0', hand(two, 0, card('draw2'), card('1'), card('2'))[0]); hand(two, 1, card('gift'), card('1'), card('2'));
  assert.equal(own(two, 'p1').hand[0].playable, false); // a Gift can't answer a +2
  const jump = table({ gifts: true, jumpIn: true }); T(jump).discard.push(card('gift', 'sky')); T(jump).color = 'sky'; const [g, x] = hand(jump, 2, card('gift', 'sky'), card('1'), card('2'));
  rejects(jump, () => play(jump, 'p2', g), /give away/); play(jump, 'p2', g, { give: x.id, target: 'p0' }); assert.equal(jump.players[0].hand.length, 4); assert.equal(T(jump).current, 0);
});

/** Several tables with the same controlled cards as table(): coral 4 on top, unplayable hands, a deck of lime 3s, and turns that never time out by themselves. */
const fix = (s: State, tables = s.tables) => { for (const t of tables) { t.discard = [card('4')]; t.color = 'coral'; t.deck = Array.from({ length: 40 }, () => card('3', 'lime')); t.deadline = s.now + 900000; for (const i of t.seats) s.players[i].hand = [card('8', 'sky'), card('9', 'sky'), card('5', 'lime')]; } return s; };
const parlor = (count: number, settings: Partial<Settings> = {}) => fix(rules.create(ctx(count, 7), { ...classic, ...settings }));
/** Acts with the turn id of the player's own table. */
const go = (s: State, p: { id: string }, a: Loose, when = s.now + 1) => rules.applyAction(s, p.id, { turnId: own(s, p.id).table!.turnId, ...a } as Action, when);
const sat = (s: State, t: number) => s.tables[t].seats.map(i => s.players[i]);

test('table plan: one table up to ten, fours beyond, or the size the host picks', () => {
  assert.deepEqual([2, 10, 11, 12, 13, 32, 64].map(n => tableCount(n, 0)), [1, 1, 3, 3, 4, 8, 16]);
  assert.deepEqual([4, 5, 6, 9].map(n => tableCount(n, 4)), [1, 2, 2, 3]); assert.deepEqual([6, 7, 10, 64].map(n => tableCount(n, 6)), [1, 2, 2, 11]);
  assert.deepEqual(options.target.map(roundCount), [1, 3, 5]);
  for (const [count, tableSize, sizes] of [[10, 0, [10]], [11, 0, [4, 4, 3]], [13, 0, [4, 3, 3, 3]], [32, 0, Array(8).fill(4)], [64, 0, Array(16).fill(4)], [6, 4, [3, 3]], [64, 5, [...Array(12).fill(5), 4]], [64, 6, [...Array(9).fill(6), 5, 5]]] as const) {
    const s = rules.create(ctx(count), { ...defaults, tableSize });
    assert.deepEqual(s.tables.map(t => t.seats.length), sizes); assert.equal(s.parlor, sizes.length > 1); assert.equal(s.rounds, s.parlor ? 3 : 1);
    assert.deepEqual(s.tables.flatMap(t => t.seats).sort((a, b) => a - b), s.players.map(p => p.i));
    for (const t of s.tables) for (const i of t.seats) assert.equal(s.players[i].table, t.id);
    assert.ok(s.players.every(p => p.hand.length === 7 && p.was === -1));
    const ids = [...s.tables.flatMap(t => [...t.deck, ...t.discard]), ...s.players.flatMap(p => p.hand)].map(c => c.id); assert.equal(new Set(ids).size, ids.length); // unique across the room
  }
  assert.deepEqual(rules.create(ctx(10), defaults).tables[0].seats, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // one table keeps join order
  assert.notDeepEqual(rules.create(ctx(12), defaults).tables.flatMap(t => t.seats), Array.from({ length: 12 }, (_, i) => i)); // the parlor draws lots
  assert.throws(() => rules.create(ctx(MAX_ROOM_PLAYERS + 1), defaults)); assert.equal(manifest.players.max, MAX_ROOM_PLAYERS);
});

for (const count of [11, 32, MAX_ROOM_PLAYERS]) test(`parlor at ${count}: every phone gets its own table and nobody else’s cards`, () => {
  const s = rules.create(ctx(count), defaults), v = pub(s), all = JSON.stringify(v);
  assertSerializable(v); assert.deepEqual([v.match.parlor, v.roster.length, v.floor.length, v.feature!.id, v.match.round], [true, count, s.tables.length, 0, 1]);
  for (const p of s.players) {
    const mine = own(s, p.id), json = JSON.stringify(mine); assertSerializable(mine);
    assert.deepEqual(mine.hand.map(c => c.id), p.hand.map(c => c.id)); assert.equal(mine.table!.id, p.table); assert.deepEqual(mine.table!.seats.map(seat => seat.p), s.tables[p.table].seats);
    for (const c of p.hand) assert.ok(!all.includes(`"${c.id}"`));
    for (const o of s.players) if (o !== p) for (const c of o.hand) assert.ok(!json.includes(`"${c.id}"`));
  }
  // Leftover hands are shown on the TV when a hand ends; a phone's own copy of its table never carries them.
  const t = s.tables.at(-1)!, winner = s.players[t.seats[t.current]]; winner.hand = [winner.hand.find(c => c.color === t.color || c.color === 'wild') ?? { id: 'x', color: t.color, value: '1' }];
  rules.applyAction(s, winner.id, { kind: 'play', turnId: own(s, winner.id).table!.turnId, cardId: winner.hand[0].id, color: 'sun' }, 1);
  const done = own(s, s.players[t.seats[1]].id).table!; assert.equal(done.handResult!.winner, winner.i); assert.ok(done.handResult!.hands.every(h => h.cards.length === 0) && done.handResult!.hands.some(h => h.points > 0));
});

test('parlor tables play apart: turn ids, catches and hands stay at their own table', () => {
  const s = parlor(8, { tableSize: 4 }), [a, b] = s.tables, [A, B] = [sat(s, 0), sat(s, 1)];
  assert.deepEqual([own(s, A[0].id).table!.turnId, own(s, B[0].id).table!.turnId, view(s).id], ['r1t1h1:0', 'r1t2h1:0', 0]);
  rejects(s, () => rules.applyAction(s, B[0].id, { kind: 'draw', turnId: 'r1t1h1:0' }, 1), /Too slow/); // another table's turn
  rejects(s, () => go(s, B[1], { kind: 'draw' }), /Wait/);
  go(s, A[0], { kind: 'draw' }); assert.deepEqual([a.current, b.current, A[0].hand.length, own(s, B[0].id).table!.turnId], [1, 0, 4, 'r1t2h1:0']);
  hand(s, B[0].i, card('8'), card('9', 'sky')); go(s, B[0], { kind: 'play', cardId: B[0].hand[0].id });
  const w = b.window!; assert.equal(w.p, B[0].i); assert.equal(own(s, B[1].id).canCatch, true);
  for (const p of A) { assert.equal(own(s, p.id).canCatch, false); rejects(s, () => rules.applyAction(s, p.id, { kind: 'catch', turnId: w.id }, s.now + 1), /Too slow/); }
  rejects(s, () => rules.applyAction(s, B[1].id, { kind: 'play', turnId: own(s, B[1].id).table!.turnId, cardId: A[1].hand[0].id }, s.now + 1), /hand/); // a card from the other table
  go(s, B[1], { kind: 'catch', turnId: w.id }); assert.equal(B[0].hand.length, 3);
  hand(s, B[1].i, card('gift'), card('1', 'sky'), card('2', 'sky')); rejects(s, () => go(s, B[1], { kind: 'play', cardId: B[1].hand[0].id, give: B[1].hand[1].id, target: A[0].id }), /who gets/); // gifts stay at the table
});

test('the bell: no new deal in the last 30 s, one short last turn each, and the fewest cards takes half the pot', () => {
  const s = parlor(8, { tableSize: 4 }), bell = pub(s).match.bellAt!, [a, b] = s.tables, [A, B] = [sat(s, 0), sat(s, 1)];
  assert.equal(bell, ROUND_MS); assert.deepEqual([pub(s).match.round, pub(s).match.rounds, pub(s).match.rung], [1, 3, false]);
  // With more than 30 s left a finished table takes a short break and deals again.
  hand(s, B[0].i, card('1')); go(s, B[0], { kind: 'play', cardId: B[0].hand[0].id }, bell - 40000);
  assert.deepEqual([b.phase, b.nextHandAt, B[0].score, s.phase, own(s, B[1].id).table!.handResult!.points], ['intermission', bell - 32000, 66, 'playing', 66]);
  go(s, B[1], { kind: 'next', turnId: 'r1t2h1' }); rejects(s, () => go(s, B[1], { kind: 'next', turnId: 'r1t2h1' }), /already ready/); rejects(s, () => go(s, A[1], { kind: 'next', turnId: 'r1t1h1' }), /already started/);
  tick(s, bell - 32000); assert.deepEqual([b.phase, b.hand, b.current, own(s, B[0].id).table!.turnId], ['playing', 2, 1, 'r1t2h2:0']);
  // Inside the last 30 s it waits for the bell instead.
  fix(s, [b]); hand(s, B[1].i, card('1')); go(s, B[1], { kind: 'play', cardId: B[1].hand[0].id }, bell - 29999);
  assert.deepEqual([b.phase, b.nextHandAt, B[1].score, pub(s).match.nextAt, own(s, B[1].id).table!.phase], ['idle', null, 66, null, 'idle']);
  // The bell: the hand still in play gets a final lap of 12-second turns, and a move already in flight still counts.
  go(s, A[0], { kind: 'draw' }, bell - 1); const turn = own(s, A[1].id).table!.turnId; assert.equal(a.deadline, bell - 1 + 25000);
  tick(s, bell);
  assert.deepEqual([pub(s).match.rung, a.lap, a.deadline, b.lap, a.events.at(-1)!.kind, own(s, A[2].id).table!.lap], [true, a.seats, bell + 12000, null, 'bell', 4]);
  hand(s, A[1].i, card('skip'), card('1', 'sky')); go(s, A[1], { kind: 'play', cardId: A[1].hand[0].id, turnId: turn }, bell + 1000);
  assert.deepEqual([a.lap, a.current, a.deadline, own(s, A[3].id).table!.lap], [[A[0].i, A[3].i], 3, bell + 13000, 2]); // the skipped seat loses its last turn
  go(s, A[3], { kind: 'draw' }, bell + 2000); assert.deepEqual([a.lap, a.current], [[A[0].i], 0]);
  go(s, A[0], { kind: 'draw' }, bell + 3000);
  assert.deepEqual([a.phase, a.lap, a.result!.winner, a.result!.points, A[1].score, A[1].handsWon], ['idle', null, A[1].i, 38, 38, 1]); assert.match(a.result!.reason, /The bell — Player\d holds the fewest cards and takes half the pot\./);
  // Every table is done: the round lingers 4.5 s on its last hands, then the room reseats by standing.
  assert.equal(pub(s).match.nextAt, bell + 7500); tick(s, bell + 7499); assert.equal(s.phase, 'playing'); tick(s, bell + 7500);
  const v = pub(s); assert.deepEqual([v.match.phase, v.match.nextAt, v.feature, v.match.bellAt, v.match.round], ['seating', bell + 21500, null, null, 1]);
  assert.deepEqual(s.tables.map(t => t.seats), [[B[0].i, B[1].i, A[1].i, A[0].i], [A[2].i, A[3].i, B[2].i, B[3].i]]);
  assert.deepEqual([v.roster[B[0].i].table, v.roster[B[0].i].was, v.roster[A[2].i].table, v.roster[A[2].i].was, v.floor.length], [0, 1, 1, 0, 2]);
  const mine = own(s, A[1].id); assert.deepEqual([mine.hand, 'table' in mine, mine.canCall], [[], false, false]);
  rejects(s, () => rules.applyAction(s, A[1].id, { kind: 'draw', turnId: turn }, s.now + 1), /hasn’t started/);
  rejects(s, () => rules.applyAction(s, A[1].id, { kind: 'next', turnId: 'r2' }, s.now + 1), /already started/);
  for (const p of s.players) rules.applyAction(s, p.id, { kind: 'next', turnId: 'r1' }, bell + 8000);
  rejects(s, () => rules.applyAction(s, A[1].id, { kind: 'next', turnId: 'r1' }, s.now + 1), /already ready/);
  assert.equal(pub(s).match.nextAt, bell + 12500); tick(s, bell + 12500);
  assert.deepEqual([s.phase, s.round, pub(s).match.bellAt, pub(s).match.rung, own(s, B[0].id).table!.turnId, own(s, B[3].id).table!.turnId], ['playing', 2, bell + 12500 + ROUND_MS, false, 'r2t1h1:0', 'r2t2h1:0']);
  assert.ok(s.players.every(p => p.hand.length === 7)); rejects(s, () => rules.applyAction(s, B[0].id, { kind: 'draw', turnId: 'r1t2h1:0' }, s.now + 1), /Too slow/);
});

test('the final lap: going out still pays in full, a tie pays nobody, and the last round ends the match', () => {
  const s = parlor(6, { tableSize: 4, target: 0 }), bell = ROUND_MS, [a, b] = s.tables, [A, B] = [sat(s, 0), sat(s, 1)];
  assert.equal(pub(s).match.rounds, 1); tick(s, bell); assert.deepEqual([a.lap, b.lap, a.deadline], [a.seats, b.seats, bell + 12000]);
  hand(s, A[0].i, card('1')); go(s, A[0], { kind: 'play', cardId: A[0].hand[0].id }, bell + 1000); assert.deepEqual([a.result!.winner, a.result!.points, a.phase], [A[0].i, 44, 'idle']);
  for (const p of B) go(s, p, { kind: 'draw' }, bell + 2000); // everyone draws: three equal hands
  assert.deepEqual([b.result!.winner, b.result!.points, b.phase], [null, 0, 'idle']); assert.match(b.result!.reason, /The bell — tied/);
  tick(s, bell + 6500); assert.equal(s.phase, 'complete'); assert.match(pub(s).match.finishReason, /^One round played\. Player\d wins with 44 pts\.$/);
  assert.deepEqual([pub(s).match.winners, rules.outcome(s).complete], [[A[0].i], false]); tick(s, bell + 12500); assert.deepEqual([rules.outcome(s).complete, rules.outcome(s).winners], [true, [A[0].id]]);
  // A timed-out final turn counts as a turn, so the lap always ends.
  const u = parlor(6, { tableSize: 4 }); tick(u, bell); for (let i = 0; i < 3; i++) tick(u, due(u)); assert.ok(u.tables.every(t => t.phase === 'idle')); assert.equal(u.now, bell + 36000);
});

test('the final lap: one last turn each even through a Reverse, the last +2 still lands, and nobody jumps in', () => {
  const s = parlor(8, { tableSize: 4, jumpIn: true, stacking: true }), bell = ROUND_MS, [a, b] = s.tables, [A, B] = [sat(s, 0), sat(s, 1)], order: number[] = [];
  hand(s, A[2].i, card('4'), card('1', 'sky'), card('2', 'sky')); assert.equal(own(s, A[2].id).hand[0].jumpable, true);
  tick(s, bell); assert.equal(own(s, A[2].id).hand[0].jumpable, false); rejects(s, () => go(s, A[2], { kind: 'play', cardId: A[2].hand[0].id }, bell + 1), /No jumping in/);
  // Seats 0 and 1 play, seat 1 with a Reverse. Seat 0 has had its turn, so play passes it and runs 3, then 2.
  const turn = (p: typeof A[0], c?: Card) => { order.push(a.seats.indexOf(p.i)); if (c) { p.hand.push(c); go(s, p, { kind: 'play', cardId: c.id }); } else go(s, p, { kind: 'draw' }); };
  turn(A[0]); turn(A[1], card('reverse')); assert.deepEqual([a.direction, a.current, a.lap], [-1, 3, [A[2].i, A[3].i]]);
  rejects(s, () => go(s, A[0], { kind: 'draw' }), /Wait/);
  turn(A[3]); assert.equal(a.current, 2); assert.equal(a.phase, 'playing');
  // The lap's last turn is a +2: the next seat in the direction of play draws it, with nobody left to stack.
  const before = A[1].hand.length; turn(A[2], card('draw2'));
  assert.deepEqual([order, a.phase, a.pending, A[1].hand.length - before], [[0, 1, 3, 2], 'idle', null, 2]); assert.ok(a.events.some(e => e.kind === 'penalty' && e.by === A[1].i && e.count === 2));
  // A stack still travelling when the lap ends lands in full.
  go(s, B[0], { kind: 'draw' }); go(s, B[1], { kind: 'draw' }); hand(s, B[2].i, card('draw2'), card('1', 'sky'), card('2', 'sky')); go(s, B[2], { kind: 'play', cardId: B[2].hand[0].id });
  hand(s, B[3].i, card('draw2', 'lime'), card('wild4'), card('1', 'sky')); assert.equal(b.pending!.count, 2);
  const held = B[0].hand.length; go(s, B[3], { kind: 'play', cardId: B[3].hand[0].id }); assert.deepEqual([b.phase, b.pending, B[0].hand.length - held, b.result!.winner], ['idle', null, 4, B[2].i]);
});

test('the director: the TV follows a race, moves on after 14 s and lets go of a finished hand', () => {
  const s = parlor(12), [, b, c] = s.tables, on = () => pub(s).match.featured;
  tick(s, 1000); assert.deepEqual([on(), view(s).id], [0, 0]);
  // A race elsewhere pulls the camera once the current shot has had six seconds.
  const racer = sat(s, 2)[0]; hand(s, racer.i, card('8'), card('9', 'sky')); go(s, racer, { kind: 'play', cardId: racer.hand[0].id }, 2000); assert.ok(c.window);
  tick(s, 5900); assert.equal(on(), 0); tick(s, 6000); assert.deepEqual([on(), view(s).id, view(s).ichiWindow!.p], [2, 2, racer.i]);
  // Nothing holds the shot past 14 s: the table that has waited longest is next.
  tick(s, 19900); assert.equal(on(), 2); tick(s, 20000); assert.equal(on(), 1);
  // A finished hand keeps the shot for 4.5 s, then the camera returns to a table in play.
  const out = sat(s, 1)[0]; hand(s, out.i, card('1')); go(s, out, { kind: 'play', cardId: out.hand[0].id }, 21000); assert.equal(b.phase, 'intermission');
  tick(s, 25400); assert.equal(on(), 1); tick(s, 25600); assert.notEqual(on(), 1); assert.equal(s.tables[on()].phase, 'playing');
});

test('rev moves exactly when the shared view does, and the snapshot cache then carries all of it', () => {
  assert.deepEqual(manifest.snapshotCache, { revisionField: 'rev', fields: ['match', 'settings', 'roster', 'feature', 'floor'] });
  const s = parlor(12), policy = manifest.snapshotCache, enc = new SnapshotEncoder(), dec = new SnapshotDecoder(), [A, B] = [sat(s, 0), sat(s, 1)];
  let cursor: { roundId: string; revision: number } | undefined;
  /** One snapshot to one socket, as the room server sends it. */
  const wire = () => {
    const full = pub(s), sent = snapshotForCursor('r', full, enc.encode('r', full, policy), policy, cursor), got = dec.decode({ roundId: 'r', revision: 0, serverTime: s.now, privateView: null, ...sent }, policy)!;
    cursor = { roundId: 'r', revision: sent.publicCache!.revision }; assert.deepEqual(got.publicView, full);
    return { rev: full.rev, keys: Object.keys(sent.publicView as PublicView).length, bytes: Buffer.byteLength(JSON.stringify(sent.publicView)) };
  };
  tick(s, 2000); const first = wire(); assert.equal(first.keys, 6);
  tick(s, 2100); tick(s, 2200); const idle = wire(); assert.deepEqual([idle.rev, idle.keys], [first.rev, 1]); assert.ok(idle.bytes < 20); // nothing changed: only rev travels
  go(s, A[0], { kind: 'draw' }, 2300); const featured = wire(); assert.deepEqual([featured.rev, featured.keys], [first.rev + 1, 6]); // the TV's table moved
  rejects(s, () => go(s, A[0], { kind: 'draw' }, 2400), /Wait/); assert.equal(wire().rev, first.rev + 1);
  // Another table's move reaches its own phones at once and the shared view at the next floor refresh.
  go(s, B[0], { kind: 'draw' }, 2500); assert.equal(own(s, B[1].id).table!.seats[0].count, 4); assert.deepEqual([wire().rev, pub(s).floor[1].counts[0]], [first.rev + 1, 3]);
  tick(s, 4100); assert.deepEqual([wire().rev, pub(s).floor[1].counts[0], pub(s).floor[1].current], [first.rev + 2, 4, B[1].i]);
  rules.onPresenceChange(s, B[2].id, false, 4200); assert.deepEqual([wire().rev, pub(s).roster[B[2].i].connected], [first.rev + 3, false]);
  tick(s, 4300); assert.equal(wire().keys, 1);
});

test('snapshots stay small at 64 players and under the message cap at their worst', () => {
  const wide = (count: number) => ({ ...ctx(count), players: Array.from({ length: count }, (_, i) => ({ id: `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, '0')}`, name: `Bartholomew Ke${String(i).padStart(2, '0')}`, color: 'hsl(128 85% 66%)' })) });
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  const s = rules.create(wide(MAX_ROOM_PLAYERS), { ...defaults, turnSeconds: 15 }); for (let i = 0; i < 10; i++) tick(s, due(s)); // timeouts fill the event logs
  assert.ok(bytes(pub(s)) < 16000, `public view at 64: ${bytes(pub(s))} bytes`);
  for (const p of s.players) assert.ok(bytes(own(s, p.id)) < 2600, `private view at 64: ${bytes(own(s, p.id))} bytes`);
  // The largest snapshot the game can produce: ten 30-card hands laid out when a hand ends.
  const big = rules.create(wide(10), { ...defaults, target: 500 }); for (const p of big.players) p.hand = Array.from({ length: 30 }, (_, i) => ({ id: `c${1000 + p.i * 30 + i}`, color: 'coral', value: 'reverse' }));
  T(big).turn = 399; act(big, big.players[0].id, { kind: 'draw' }); assert.equal(view(big).handResult!.hands.length, 10);
  assert.ok(bytes(pub(big)) + bytes(own(big, big.players[0].id)) < MAX_MESSAGE_BYTES, `largest snapshot: ${bytes(pub(big))} bytes`);
});

/** Plays a whole match using only what each seat's phone would see, with occasional timeouts and disconnects. One table steps 100 ms at a time; the parlor steps a second so a six-minute round stays cheap. */
function bot(count: number, settings: Settings, seed: number) {
  const s = rules.create(ctx(count, seed), settings), ids = s.players.map(p => p.id), used = new Set<string>(), step = s.parlor ? 1000 : 100, prev = new Map<number, string>();
  let r = seed * 7919 + 1, now = 0, steps = 0;
  const rand = (n: number) => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return (r >>> 8) % n; };
  const send = (i: number, a: Loose & { turnId: string }) => { rules.applyAction(s, ids[i], a as Action, now); used.add(a.kind); };
  for (;;) {
    assert.ok(++steps < 60000, `match ${count}p seed ${seed} did not finish`);
    now += step; tick(s, now);
    if (rules.outcome(s).complete) break;
    const v = pub(s);
    if (steps % 40 === 1) { assertSerializable(v); for (const id of ids) assertSerializable(own(s, id)); }
    if (v.match.phase === 'complete') { now = v.match.nextAt! - step; continue; }
    if (steps % 700 === 0) { const p = s.players[rand(count)]; rules.onPresenceChange(s, p.id, !p.connected, now); continue; }
    if (v.match.phase === 'seating') {
      used.add('seating'); assert.equal(v.feature, null);
      const i = s.players.findIndex(p => p.connected && !v.match.ready.includes(p.i));
      if (i >= 0 && rand(4)) send(i, { kind: 'next', turnId: `r${v.match.round}` }); else now = v.match.nextAt! - step;
      continue;
    }
    if (s.parlor) { const shown = s.tables[v.match.featured]; assert.ok(shown.phase === 'playing' || now - shown.endedAt < 8000 || s.tables.every(t => t.phase !== 'playing'), 'the TV sat on a finished table'); }
    let busy = false;
    for (const t of s.tables) {
      const seen = (i: number) => own(s, ids[i]), tv = s.parlor ? seen(t.seats[0]).table! : v.feature!, live = t.seats.filter(i => s.players[i].connected);
      if (tv.phase === 'intermission') { const i = live.find(i => !tv.ready.includes(i)); if (i !== undefined) { send(i, { kind: 'next', turnId: tv.handId }); busy = true; } continue; }
      if (tv.phase !== 'playing') continue;
      busy = true;
      // A full hand can't take a gift, so targets come from the seats with room.
      const was = prev.get(t.id), cur = tv.current, roll = rand(100), room = (i: number) => tv.seats.filter(o => o.p !== i && o.count < 30), other = (i: number) => { const rest = room(i).length ? room(i) : tv.seats.filter(o => o.p !== i); return ids[rest[rand(rest.length)].p]; };
      if (was && was !== tv.turnId && steps % 11 === 0) assert.throws(() => rules.applyAction(s, ids[cur], { kind: 'draw', turnId: was }, now), /Too slow/);
      prev.set(t.id, tv.turnId);
      const catcher = tv.ichiWindow ? live.find(i => seen(i).canCatch) : undefined, caller = tv.ichiWindow ? live.find(i => seen(i).canCall) : undefined;
      if (catcher !== undefined && roll < 20) { send(catcher, { kind: 'catch', turnId: tv.ichiWindow!.id }); continue; }
      if (caller !== undefined && roll < 50) { send(caller, { kind: 'ichi', turnId: tv.ichiWindow!.id }); continue; }
      const jumper = settings.jumpIn ? live.find(i => seen(i).hand.some(c => c.jumpable)) : undefined;
      if (jumper !== undefined && roll < 70 && room(jumper).length) { const cards = seen(jumper).hand, c = cards.find(c => c.jumpable)!; send(jumper, { kind: 'play', turnId: tv.turnId, cardId: c.id, give: cards.find(o => o.id !== c.id)?.id, target: other(jumper) }); used.add('jump'); continue; }
      const me = seen(cur);
      if (!s.players[cur].connected || roll > 97) { if (!s.parlor) now = Math.max(now, tv.deadline - step); used.add('timeout'); continue; }
      const c = me.hand.find(c => c.playable && (c.value !== 'gift' || me.hand.length === 1 || room(cur).length)), bad = me.hand.find(c => !c.playable);
      if (bad && roll % 9 === 0) assert.throws(() => rules.applyAction(s, ids[cur], { kind: 'play', turnId: tv.turnId, cardId: bad.id, color: 'sun', target: other(cur) }, now));
      if (me.canChallenge && roll < 60) send(cur, { kind: 'challenge', turnId: tv.turnId });
      else if (me.drawnId && roll < 30) send(cur, { kind: 'keep', turnId: tv.turnId });
      else if (c) { send(cur, { kind: 'play', turnId: tv.turnId, cardId: c.id, color: colors[rand(4)], give: me.hand.find(o => o.id !== c.id)?.id, target: other(cur) }); if (c.value === 'gift' && me.hand.length > 1) used.add('gift'); if (tv.lap !== null) used.add('lap'); }
      else send(cur, { kind: me.drawnId ? 'keep' : 'draw', turnId: tv.turnId });
    }
    if (!busy) now = Math.max(now, due(s) - step);
  }
  const o = rules.outcome(s), best = Math.max(...s.players.map(p => p.score)), hands = T(s).hand; assertSerializable(o); assertSerializable(rules.publicView(s, { nowMs: now, phase: 'results' }));
  assert.ok(o.complete); assert.deepEqual(o.winners, s.players.filter(p => p.score === best).map(p => p.id)); assert.equal(o.rows.length, count);
  if (s.parlor) assert.equal(s.round, s.rounds); else assert.ok(settings.target === 0 ? hands === 1 : best >= settings.target || hands === 12);
  return { used, outcome: o };
}

test('seeded full matches at 2 and 10 players across all 64 house-rule combinations and targets', () => {
  const used = new Set<string>(), keys = Object.keys(houseRules) as (keyof typeof houseRules)[];
  for (let bits = 0; bits < 64; bits++) for (const count of [2, 10]) for (const target of options.target) {
    const settings = { ...defaults, target, handSize: options.handSize[bits % 3], turnSeconds: options.turnSeconds[bits % 3], ...Object.fromEntries(keys.map((k, i) => [k, !!(bits & 1 << i)])) } as Settings;
    for (const kind of bot(count, settings, bits * 31 + count + target).used) used.add(kind);
  }
  for (const kind of ['play', 'draw', 'keep', 'challenge', 'ichi', 'catch', 'next', 'jump', 'gift', 'timeout']) assert.ok(used.has(kind), `bot never used ${kind}`);
  const settings = { ...defaults, jumpIn: true, sevenZero: true };
  assert.deepEqual(bot(4, settings, 77).outcome, bot(4, settings, 77).outcome);
});

test('seeded parlor matches at 9, 11, 32 and 64 players reseat between rounds and finish', () => {
  const used = new Set<string>(), chaos = { ...defaults, sevenZero: true, jumpIn: true, drawUntilPlayable: true, turnSeconds: 15 } as Settings;
  for (const [count, settings] of [[9, { ...defaults, tableSize: 4, target: 0, gifts: false }], [11, { ...defaults, target: 0 }], [32, defaults], [MAX_ROOM_PLAYERS, chaos], [MAX_ROOM_PLAYERS, { ...classic, tableSize: 6, handSize: 5 }]] as [number, Settings][])
    for (const kind of bot(count, settings, count * 13).used) used.add(kind);
  for (const kind of ['play', 'draw', 'keep', 'challenge', 'ichi', 'catch', 'next', 'jump', 'gift', 'seating', 'lap']) assert.ok(used.has(kind), `parlor bot never used ${kind}`);
  assert.deepEqual(bot(32, defaults, 5).outcome, bot(32, defaults, 5).outcome);
});

test('timeouts alone finish a parlor match', () => {
  const s = rules.create(ctx(32), { ...defaults, turnSeconds: 15 }); let steps = 0;
  while (!rules.outcome(s).complete) { assert.ok(++steps < 20000, 'timeouts alone must finish the match'); tick(s, due(s)); }
  assert.deepEqual([s.round, s.phase], [3, 'complete']); assert.ok(s.now > 3 * ROUND_MS && s.now < 3 * ROUND_MS + 300000);
});
