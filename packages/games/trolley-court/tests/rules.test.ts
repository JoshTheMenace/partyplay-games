import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { rules, type State } from '../src/server';
import { botAction } from '../src/bot';
import { GUILTY, INNOCENT, MODIFIERS } from '../src/deck.server';
import {
  KINDS, SIDES, TIMING, cleanWriteIn, defaults, lapsFor, modifierSlots, opposite, revealMs, roundCount, seatTeams,
  type Action, type Card, type Phase, type Settings, type Side,
} from '../src/types';

const ctx = (n = 4, seed = 1) => ({ roomId: 'room', roundId: 'round', nowMs: 1000, seed, players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: '#ff5748' })) });
const game = (n = 4, settings: Partial<Settings> = {}, seed = 1) => rules.create(ctx(n, seed), { ...defaults, ...settings });
const view = (s: State) => rules.publicView(s, { nowMs: s.now, phase: 'playing' });
const me = (s: State, id: string) => rules.playerView(s, id, { nowMs: s.now, phase: 'playing' });
const tick = (s: State, at = s.deadline) => rules.tick(s, new Map(), 0, at);
const to = (s: State, phase: Phase, round = s.round) => { for (let i = 0; i < 2000 && !(s.phase === phase && s.round === round); i++) tick(s); assert.equal(`${s.round}.${s.phase}`, `${round}.${phase}`); };
type Loose = { [K in Action['kind']]: Omit<Extract<Action, { kind: K }>, 'turnId'> & { turnId?: string } }[Action['kind']];
const act = (s: State, id: string, a: Loose, at = s.now + 1) => rules.applyAction(s, id, { turnId: view(s).turnId, ...a } as Action, at);
const rejects = (s: State, fn: () => void, message: RegExp = /./) => { const before = structuredClone(s); assert.throws(fn, message); assert.deepEqual(s, before); };
const stock = (s: State, side: Side, kind: Card['kind']) => s.hands[side][kind].filter(c => !c.blank);
const cues = (s: State, kind: string) => s.cues.filter(c => c.kind === kind).map(c => c.id);
const BANKS = { innocent: INNOCENT, guilty: GUILTY, modifier: MODIFIERS };
const rng = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

/** Projection checks: serializable, no undefined fields, nothing unrevealed in public, no foreign hands in private views. */
function check(s: State) {
  const pub = view(s), json = JSON.stringify(pub);
  assertSerializable(pub); assert.deepEqual(JSON.parse(json), pub); assertSerializable(rules.outcome(s));
  const shown = SIDES.flatMap(side => s.tracks[side].slots.flatMap(x => x ? [x.card, ...x.mods.map(m => m.card)] : []));
  const ids = new Set(shown.map(c => c.id)), texts = new Set(shown.map(c => c.text));
  const secret = [...SIDES.flatMap(side => KINDS.flatMap(k => s.hands[side][k])), ...s.queue.map(q => q.placed.card)].filter(c => !ids.has(c.id));
  const drafts = SIDES.flatMap(side => s.slots[side].flatMap(x => [x.locked?.text, ...x.proposals.map(p => p.text)]));
  for (const c of secret) assert.ok(!json.includes(`"${c.id}"`), `public view leaks ${c.id}`);
  for (const t of [...secret.map(c => c.text), ...drafts]) if (t && !texts.has(t)) assert.ok(!json.includes(JSON.stringify(t)), `public view leaks "${t}"`);
  for (const kind of KINDS) assert.equal(s.deck[kind].length + s.discard[kind].length + s.dealt.filter(c => c.kind === kind).length, BANKS[kind].filter(c => !s.settings.family || !c.spicy).length);
  for (const p of s.players) {
    const mine = me(s, p.id), pj = JSON.stringify(mine);
    assertSerializable(mine); assert.deepEqual(JSON.parse(pj), mine);
    if (mine.role === 'conductor') { assert.equal(p.id, s.conductor); assert.deepEqual(mine, { role: 'conductor', side: null, turnId: pub.turnId, hands: { innocent: [], guilty: [], modifier: [] }, slots: [] }); continue; }
    assert.ok(s.teams[mine.side!].includes(p.id));
    for (const c of KINDS.flatMap(k => s.hands[opposite(mine.side!)][k])) assert.ok(!pj.includes(`"${c.id}"`), `${p.id} sees ${c.id}`);
  }
}

/** Drives a game with bots (or none) on a 250 ms fake clock until complete, checking projections at every step. */
function play(n: number, settings: Partial<Settings> = {}, seed = 1, bots = true) {
  const s = game(n, settings, seed), random = rng(seed), rejected: string[] = [];
  let accepted = 0, key = '';
  for (let i = 0; i < 200000 && s.phase !== 'complete'; i++) {
    if (bots) for (const p of s.players) {
      const a = botAction(view(s), me(s, p.id), p.id, random, s.now);
      if (a) try { rules.applyAction(s, p.id, a, s.now); accepted++; } catch (e) { rejected.push((e as Error).message); }
    }
    if (`${s.round}.${s.phase}.${s.step}` !== key) {
      key = `${s.round}.${s.phase}.${s.step}`; check(s);
      assert.equal(new Set(s.dealt.map(c => c.id)).size, s.dealt.length, 'a card repeated within a round');
    }
    tick(s, Math.min(s.deadline, s.now + 250));
  }
  check(s);
  return { s, accepted, rejected };
}
function finished(s: State, n: number, laps: Settings['laps'] = 'auto') {
  const out = rules.outcome(s), fewest = Math.min(...s.players.map(p => p.deaths));
  assert.equal(s.phase, 'complete'); assert.equal(s.history.length, roundCount(n, laps)); assert.equal(out.complete, true);
  assert.deepEqual(out.winners, s.players.filter(p => p.deaths === fewest).map(p => p.id));
  for (const p of s.players) {
    assert.equal(p.conducted, lapsFor(n, laps)); assert.equal(p.deaths + p.spared + p.conducted, s.history.length);
    assert.equal(p.deaths, s.history.filter(h => h.victims.includes(p.id)).length);
  }
  for (const h of s.history) assert.equal(h.struck, h.pulled ? opposite(h.defaultSide) : h.defaultSide);
  assert.deepEqual(s.cues.map(c => c.seq), s.cues.map((_, i) => s.seq - s.cues.length + 1 + i));
  assert.equal(s.cues.at(-1)!.id, out.winners.length > 1 ? 'tie' : 'end');
}

test('settings: defaults, merging and strict rejection', () => {
  assert.deepEqual(rules.validateSettings({}), defaults);
  assert.deepEqual(rules.validateSettings({ laps: 2, blanks: false, leverSeconds: 10 }), { ...defaults, laps: 2, blanks: false, leverSeconds: 10 });
  for (const raw of [null, undefined, [], 'x', 5, { bogus: 1 }, { laps: 3 }, { laps: '1' }, { pickSeconds: 25 }, { modifierSeconds: NaN }, { floorSeconds: null }, { leverSeconds: '20' }, { blanks: 'yes' }, { family: 1 }, { toString: true }])
    assert.throws(() => rules.validateSettings(raw), /./, JSON.stringify(raw));
  assert.throws(() => rules.create(ctx(4), { ...defaults, laps: 5 } as unknown as Settings));
});

test('parseAction is strict and never emits undefined fields', () => {
  assert.deepEqual(rules.parseAction({ kind: 'propose', turnId: '1.innocent', slot: 0, cardId: null }), { kind: 'propose', turnId: '1.innocent', slot: 0, cardId: null });
  assert.deepEqual(Object.keys(rules.parseAction({ kind: 'lock', turnId: 't', slot: 1, cardId: 'm001' })), ['kind', 'turnId', 'slot', 'cardId']);
  assert.deepEqual(rules.parseAction({ kind: 'lock', turnId: 't', slot: 5, cardId: 'w1n', text: 'x'.repeat(60), target: { side: 'south', slot: 2 } }), { kind: 'lock', turnId: 't', slot: 5, cardId: 'w1n', text: 'x'.repeat(60), target: { side: 'south', slot: 2 } });
  assert.deepEqual(rules.parseAction({ kind: 'lean', turnId: 't', pulled: true }), { kind: 'lean', turnId: 't', pulled: true });
  assert.deepEqual(rules.parseAction({ kind: 'next', turnId: 't', step: 1 }), { kind: 'next', turnId: 't', step: 1 });
  assert.deepEqual(rules.parseAction({ kind: 'decide', turnId: 't', pull: false }), { kind: 'decide', turnId: 't', pull: false });
  const long = 'x'.repeat(33);
  for (const raw of [null, [], 'lock', { kind: 'pass', turnId: 't' }, { kind: 'toString', turnId: 't' }, { kind: 'lean', pulled: true }, { kind: 'lean', turnId: '', pulled: true }, { kind: 'lean', turnId: long, pulled: true },
    { kind: 'lean', turnId: 't', pulled: 1 }, { kind: 'lean', turnId: 't', pulled: true, extra: 1 }, { kind: 'decide', turnId: 't' }, { kind: 'next', turnId: 't', step: 2 }, { kind: 'next', turnId: 't', step: 0.5 },
    { kind: 'lock', turnId: 't', slot: 0, cardId: null }, { kind: 'lock', turnId: 't', slot: 0 }, { kind: 'lock', turnId: 't', slot: -1, cardId: 'c' }, { kind: 'lock', turnId: 't', slot: 6, cardId: 'c' },
    { kind: 'lock', turnId: 't', slot: '0', cardId: 'c' }, { kind: 'lock', turnId: 't', slot: 0, cardId: long }, { kind: 'propose', turnId: 't', slot: 0, cardId: 'c', text: 'x'.repeat(61) },
    { kind: 'propose', turnId: 't', slot: 0, cardId: 'c', text: 7 }, { kind: 'lock', turnId: 't', slot: 0, cardId: 'c', target: { side: 'east', slot: 0 } }, { kind: 'lock', turnId: 't', slot: 0, cardId: 'c', target: { side: 'north', slot: 3 } },
    { kind: 'lock', turnId: 't', slot: 0, cardId: 'c', target: { side: 'north', slot: 0, mod: 1 } }, { kind: 'lock', turnId: 't', slot: 0, cardId: 'c', target: null }, { kind: 'decide', turnId: 't', pull: true, slot: 0 }])
    assert.throws(() => rules.parseAction(raw), /./, JSON.stringify(raw));
  assert.equal(rules.parseInput(null), null); assert.equal(rules.neutralInput(), null); assert.throws(() => rules.parseInput({}));
});

test('seats, teams, round counts and slot counts for 3–10 players', () => {
  const table = [[3, 1, 1, 1, 1, 6], [4, 2, 1, 1, 1, 8], [5, 2, 2, 1, 1, 5], [6, 3, 2, 1, 1, 6], [7, 3, 3, 1, 1, 7], [8, 4, 3, 2, 1, 8], [9, 4, 4, 2, 2, 9], [10, 5, 4, 3, 2, 10]];
  for (const [n, north, south, tn, ts, rounds] of table) {
    const seats = Array.from({ length: n }, (_, i) => `p${i}`), conducted = new Map<string, number>();
    assert.equal(roundCount(n, 'auto'), rounds); assert.equal(roundCount(n, 1), n); assert.equal(roundCount(n, 2), 2 * n);
    for (let r = 1; r <= rounds; r++) {
      const t = seatTeams(seats, r);
      assert.equal(t.conductor, seats[(r - 1) % n]); assert.equal(t.north.length, north); assert.equal(t.south.length, south);
      assert.deepEqual([t.conductor, ...t.north, ...t.south].sort(), [...seats].sort());
      conducted.set(t.conductor, (conducted.get(t.conductor) ?? 0) + 1);
    }
    assert.deepEqual([...new Set(conducted.values())], [lapsFor(n, 'auto')]); assert.equal(conducted.size, n);
    assert.equal(modifierSlots(north, false, false), tn); assert.equal(modifierSlots(south, false, false), ts);
    const s = game(n);
    assert.equal(s.rounds, rounds); assert.deepEqual(s.teams, { north: seatTeams(seats, 1).north, south: seatTeams(seats, 1).south });
    assert.equal(s.hands.north.modifier.length, 3 * tn); assert.equal(s.hands.south.modifier.length, 3 * ts);
  }
  assert.equal(modifierSlots(5, true, true), 6); assert.equal(modifierSlots(6, true, true), 6); assert.equal(modifierSlots(1, false, true), 2);
});

test('create validates the roster and is deterministic per seed', () => {
  for (const c of [ctx(2), ctx(11), { ...ctx(3), players: [ctx(3).players[0], ctx(3).players[0], ctx(3).players[1]] }, { ...ctx(3), nowMs: NaN }]) assert.throws(() => rules.create(c, defaults));
  assert.deepEqual(game(5, {}, 9), game(5, {}, 9));
  assert.notDeepEqual(game(5, {}, 9).deck, game(5, {}, 10).deck);
  const s = game(4);
  assert.equal(s.phase, 'deal'); assert.equal(s.round, 1); assert.equal(view(s).turnId, '1.deal'); assert.equal(s.deadline - s.startedAt, TIMING.dealMs + TIMING.welcomeMs);
  assert.deepEqual(cues(s, 'line'), ['welcome', `heading.${s.defaultSide}`]); assert.deepEqual(cues(s, 'sfx'), ['deal']);
  for (const side of SIDES) {
    assert.equal(s.hands[side].innocent.length, 3); assert.equal(s.hands[side].guilty.length, 3);
    assert.deepEqual(s.hands[side].innocent.filter(c => c.blank), [{ id: `w1${side[0]}`, kind: 'innocent', text: '', blank: true }]);
  }
  assert.ok(KINDS.every(k => SIDES.every(side => game(4, { blanks: false }).hands[side][k].every(c => !c.blank))));
});

test('full phase order, timing and turn ids with no input', () => {
  const s = game(4), seen: string[] = [];
  let last = '';
  for (let i = 0; i < 1000 && s.round === 1; i++) {
    const key = `${view(s).turnId}#${s.step}/${s.steps}`;
    if (key !== last) seen.push(key); last = key;
    if (s.phase === 'innocent') assert.equal(s.deadline - s.startedAt, defaults.pickSeconds * 1000);
    if (s.phase === 'modifier') assert.equal(s.deadline - s.startedAt, defaults.modifierSeconds * 1000);
    if (s.phase === 'plead') { assert.equal(s.deadline - s.startedAt, defaults.floorSeconds * 1000); assert.equal(s.floor, s.step ? opposite(s.defaultSide) : s.defaultSide); }
    if (s.phase === 'lever') assert.equal(s.deadline - s.startedAt, defaults.leverSeconds * 1000);
    if (s.phase === 'crash') assert.equal(s.deadline - s.startedAt, TIMING.crashMs);
    tick(s, Math.min(s.deadline, s.now + 1000));
  }
  seen.push(`${view(s).turnId}#${s.step}/${s.steps}`);
  assert.deepEqual(seen, ['1.deal#0/3', '1.deal#1/3', '1.deal#2/3', '1.innocent#0/1', '1.innocentReveal#0/3', '1.innocentReveal#1/3', '1.innocentReveal#2/3', '1.guilty#0/1',
    '1.guiltyReveal#0/3', '1.guiltyReveal#1/3', '1.guiltyReveal#2/3', '1.modifier#0/1', '1.modifierReveal#0/3', '1.modifierReveal#1/3', '1.modifierReveal#2/3',
    '1.plead#0/2', '1.plead#1/2', '1.lever#0/1', '1.crash#0/1', '2.deal#0/3']);
  assert.equal(s.deadline - s.startedAt, TIMING.dealMs); assert.equal(s.conductor, 'p1');
  const h = s.history[0];
  assert.deepEqual(h, { round: 1, conductor: 'p0', defaultSide: h.defaultSide, pulled: false, timedOut: true, struck: h.defaultSide, victims: h.defaultSide === 'north' ? ['p1', 'p2'] : ['p3'] });
});

test('reveal beats: one card per step, spotlight, read-aloud timing and cues', () => {
  const s = game(4);
  assert.deepEqual(s.tracks.north.slots, [null, null, null]); assert.equal(s.spotlight, null);
  tick(s);
  const bystander = s.tracks.north.slots[0]!;
  assert.equal(s.step, 1); assert.deepEqual(s.spotlight, { side: 'north', slot: 0 }); assert.equal(bystander.from, 'deck'); assert.equal(bystander.card.kind, 'innocent');
  assert.equal(s.tracks.south.slots[0], null); assert.equal(s.deadline - s.startedAt, revealMs(bystander.card.text, true));
  assert.deepEqual(s.cues.slice(-2).map(c => c.id), ['flip', bystander.card.id]);
  tick(s); assert.deepEqual(s.spotlight, { side: 'south', slot: 0 }); assert.ok(s.tracks.south.slots[0]);
  tick(s); assert.equal(s.phase, 'innocent');
  const north = stock(s, 'north', 'innocent')[0], guilty = () => stock(s, 'south', 'guilty')[0];
  act(s, 'p1', { kind: 'lock', slot: 0, cardId: north.id });
  to(s, 'innocentReveal');
  assert.equal(s.tracks.north.slots[1], null); assert.equal(s.deadline - s.startedAt, TIMING.introMs); assert.equal(cues(s, 'line').at(-1), 'reveal.innocent');
  tick(s); assert.deepEqual(s.tracks.north.slots[1], { card: north, from: 'north', by: 'p1', mods: [] }); assert.equal(s.tracks.south.slots[1], null);
  tick(s); assert.equal(s.tracks.south.slots[1]!.auto, true); assert.equal(s.tracks.south.slots[1]!.by, undefined);
  to(s, 'guilty'); const g = guilty(); act(s, 'p3', { kind: 'lock', slot: 0, cardId: g.id }); to(s, 'guiltyReveal');
  assert.ok(cues(s, 'sfx').includes('drumroll'));
  tick(s); assert.deepEqual(s.tracks.north.slots[2], { card: g, from: 'south', by: 'p3', mods: [] }); assert.deepEqual(s.spotlight, { side: 'north', slot: 2 });
  assert.deepEqual(s.cues.slice(-2).map(c => c.id), ['reveal', g.id]);
  to(s, 'modifier');
  const [m1] = stock(s, 'north', 'modifier'), [m2] = stock(s, 'south', 'modifier');
  act(s, 'p2', { kind: 'lock', slot: 0, cardId: m1.id, target: { side: 'south', slot: 1 } });
  act(s, 'p3', { kind: 'lock', slot: 0, cardId: m2.id, target: { side: 'south', slot: 1 } });
  to(s, 'modifierReveal'); assert.equal(s.steps, 3);
  tick(s); assert.deepEqual(s.spotlight, { side: 'south', slot: 1, mod: 0 }); assert.deepEqual(s.tracks.south.slots[1]!.mods, [{ card: m1, from: 'north', by: 'p2' }]);
  assert.deepEqual(s.cues.slice(-2).map(c => c.id), ['stamp', m1.id]);
  tick(s); assert.deepEqual(s.spotlight, { side: 'south', slot: 1, mod: 1 }); assert.equal(s.tracks.south.slots[1]!.mods[1].card.id, m2.id);
  tick(s); assert.equal(s.phase, 'plead'); assert.equal(s.spotlight, null);

  const quiet = game(4, { readAloud: false }); tick(quiet);
  assert.equal(quiet.deadline - quiet.startedAt, 2200); assert.deepEqual(cues(quiet, 'card'), []);
});

test('interleaved twist reveal order with uneven teams', () => {
  const s = game(10, { accomplices: true }); to(s, 'modifier');
  assert.equal(s.slots.north.length, 5); assert.equal(s.slots.south.length, 4); assert.equal(s.hands.north.modifier.length, 12);
  to(s, 'modifierReveal'); assert.equal(s.steps, 10);
  assert.deepEqual(s.queue.map(q => q.placed.from), ['north', 'south', 'north', 'south', 'north', 'south', 'north', 'south', 'north']);
  assert.ok(s.queue.every(q => q.mod && q.placed.auto && q.target));
  assert.equal(new Set(s.queue.map(q => q.placed.card.id)).size, 9);
});

test('propose, lock, first lock wins, blanks, targets and team checks', () => {
  const s = game(4, { accomplices: true }); to(s, 'innocent');
  const hand = s.hands.north.innocent, card = stock(s, 'north', 'innocent')[0], blank = hand.find(c => c.blank)!;
  rejects(s, () => act(s, 'p0', { kind: 'propose', slot: 0, cardId: card.id }), /Conductor/);
  rejects(s, () => act(s, 'p3', { kind: 'lock', slot: 0, cardId: card.id }), /hand/);
  rejects(s, () => act(s, 'p9', { kind: 'lock', slot: 0, cardId: card.id }), /seated/);
  rejects(s, () => act(s, 'p1', { kind: 'propose', slot: 1, cardId: card.id }), /slot/);
  rejects(s, () => act(s, 'p1', { kind: 'propose', slot: 0, cardId: 'i999' }), /hand/);
  rejects(s, () => act(s, 'p1', { kind: 'propose', slot: 0, cardId: card.id, target: { side: 'north', slot: 0 } }), /twists/);
  rejects(s, () => act(s, 'p1', { kind: 'propose', slot: 0, cardId: card.id, text: 'hi' }), /blank/);
  act(s, 'p1', { kind: 'propose', slot: 0, cardId: card.id });
  act(s, 'p2', { kind: 'propose', slot: 0, cardId: blank.id, text: '' });
  assert.deepEqual(me(s, 'p2').slots, [{ index: 0, kind: 'innocent', locked: null, proposals: [{ by: 'p1', cardId: card.id }, { by: 'p2', cardId: blank.id, text: '' }] }]);
  assert.deepEqual(me(s, 'p3').slots[0].proposals, []); assert.deepEqual(me(s, 'p0').slots, []);
  act(s, 'p1', { kind: 'propose', slot: 0, cardId: null }); assert.deepEqual(s.slots.north[0].proposals.map(p => p.by), ['p2']);
  rejects(s, () => act(s, 'p2', { kind: 'lock', slot: 0, cardId: blank.id }), /Write something/);
  rejects(s, () => act(s, 'p2', { kind: 'lock', slot: 0, cardId: blank.id, text: '  \t ' }), /Write something/);
  act(s, 'p2', { kind: 'lock', slot: 0, cardId: blank.id, text: ' A  very\ttidy   ghost ' });
  assert.deepEqual(s.slots.north[0].locked, { cardId: blank.id, text: 'A very tidy ghost', by: 'p2' });
  rejects(s, () => act(s, 'p1', { kind: 'lock', slot: 0, cardId: card.id }), /Player 2 already locked this/);
  rejects(s, () => act(s, 'p1', { kind: 'propose', slot: 0, cardId: card.id }), /already locked/);
  assert.deepEqual(view(s).progress, { north: { locked: 1, total: 1 }, south: { locked: 0, total: 1 } });
  assert.ok(!JSON.stringify(view(s)).includes('tidy ghost')); check(s);
  to(s, 'innocentReveal'); tick(s);
  assert.deepEqual(s.tracks.north.slots[1]!.card, { id: 'w1n', kind: 'innocent', text: 'A very tidy ghost', blank: true });

  to(s, 'modifier');
  const [a, b] = stock(s, 'north', 'modifier');
  assert.equal(s.slots.north.length, 2);
  rejects(s, () => act(s, 'p1', { kind: 'lock', slot: 0, cardId: a.id }), /Choose which card/);
  act(s, 'p1', { kind: 'propose', slot: 0, cardId: a.id });
  act(s, 'p1', { kind: 'propose', slot: 1, cardId: a.id, target: { side: 'north', slot: 2 } });
  act(s, 'p2', { kind: 'lock', slot: 0, cardId: a.id, target: { side: 'south', slot: 0 } });
  rejects(s, () => act(s, 'p1', { kind: 'lock', slot: 1, cardId: a.id, target: { side: 'south', slot: 0 } }), /already played/);
  rejects(s, () => act(s, 'p1', { kind: 'propose', slot: 1, cardId: a.id }), /already played/);
  act(s, 'p1', { kind: 'lock', slot: 1, cardId: b.id, target: { side: 'north', slot: 2 } });
  assert.deepEqual(me(s, 'p1').slots.map(x => x.locked), [{ cardId: a.id, target: { side: 'south', slot: 0 }, by: 'p2' }, { cardId: b.id, target: { side: 'north', slot: 2 }, by: 'p1' }]);
  check(s);
});

test('stale, duplicate, late and out-of-phase actions leave state unchanged', () => {
  const s = game(4);
  rejects(s, () => act(s, 'p1', { kind: 'propose', slot: 0, cardId: s.hands.north.innocent[0].id }), /Nothing to pick/);
  rejects(s, () => act(s, 'p0', { kind: 'lean', pulled: true }), /locked right now/);
  rejects(s, () => act(s, 'p0', { kind: 'decide', pull: true }), /Hear both sides/);
  rejects(s, () => act(s, 'p0', { kind: 'next', step: 0 }), /Nobody has the floor/);
  to(s, 'innocent');
  const card = stock(s, 'north', 'innocent')[0], old = view(s).turnId;
  rejects(s, () => act(s, 'p1', { kind: 'lock', slot: 0, cardId: card.id, turnId: '1.deal' }), /Too late/);
  rejects(s, () => act(s, 'p1', { kind: 'lock', slot: 0, cardId: card.id }, s.deadline), /Time/);
  rejects(s, () => act(s, 'p1', { kind: 'lock', slot: 0, cardId: card.id, turnId: '2.innocent' }), /Too late/);
  act(s, 'p1', { kind: 'lock', slot: 0, cardId: card.id });
  rejects(s, () => act(s, 'p1', { kind: 'lock', slot: 0, cardId: card.id }), /already locked/);
  rejects(s, () => act(s, 'p0', { kind: 'lean', pulled: true }), /locked right now/);
  to(s, 'innocentReveal');
  rejects(s, () => act(s, 'p2', { kind: 'lock', slot: 0, cardId: stock(s, 'north', 'guilty')[0].id, turnId: old }), /Too late/);
  to(s, 'plead');
  rejects(s, () => act(s, 'p1', { kind: 'lean', pulled: true }), /Only the Conductor/);
  rejects(s, () => act(s, 'p2', { kind: 'next', step: 0 }, s.startedAt + 6000), /Only the Conductor/);
  rejects(s, () => act(s, 'p0', { kind: 'decide', pull: true }), /Hear both sides/);
  rejects(s, () => act(s, 'p0', { kind: 'next', step: 0 }, s.startedAt + 4999), /speak a little longer/);
  rejects(s, () => act(s, 'p0', { kind: 'next', step: 1 }, s.startedAt + 6000), /already over/);
  act(s, 'p0', { kind: 'next', step: 0 }, s.startedAt + 6000); assert.equal(s.step, 1);
  rejects(s, () => act(s, 'p0', { kind: 'next', step: 0 }, s.startedAt + 6000), /already over/);
  act(s, 'p0', { kind: 'next', step: 1 }, s.startedAt + TIMING.floorMinMs); assert.equal(s.phase, 'lever');
  rejects(s, () => act(s, 'p3', { kind: 'decide', pull: true }), /Only the Conductor/);
  act(s, 'p0', { kind: 'decide', pull: true });
  assert.equal(s.phase, 'crash'); assert.deepEqual(s.lever, { pulled: true, decided: true, timedOut: false });
  rejects(s, () => act(s, 'p0', { kind: 'decide', pull: false, turnId: '1.lever' }), /Too late/);
  rejects(s, () => act(s, 'p0', { kind: 'lean', pulled: false, turnId: '1.plead' }), /Too late/);
  s.round = s.rounds; to(s, 'complete', s.rounds);
  rejects(s, () => act(s, 'p0', { kind: 'decide', pull: false }), /adjourned/);
});

test('auto-pick: most proposed, then earliest, then a random non-blank card', () => {
  const s = game(7); to(s, 'innocent');
  const [a, b] = stock(s, 'north', 'innocent'), [c, d] = stock(s, 'south', 'innocent'), blank = s.hands.south.innocent.find(x => x.blank)!;
  act(s, 'p1', { kind: 'propose', slot: 0, cardId: a.id }); act(s, 'p2', { kind: 'propose', slot: 0, cardId: b.id }); act(s, 'p3', { kind: 'propose', slot: 0, cardId: b.id });
  act(s, 'p4', { kind: 'propose', slot: 0, cardId: blank.id, text: '' }); act(s, 'p6', { kind: 'propose', slot: 0, cardId: blank.id, text: '!!' });
  act(s, 'p5', { kind: 'propose', slot: 0, cardId: d.id }); act(s, 'p6', { kind: 'propose', slot: 0, cardId: c.id });
  tick(s, s.deadline - 5000); to(s, 'innocentReveal');
  assert.deepEqual(s.queue.map(q => [q.target, q.placed]), [[{ side: 'north', slot: 1 }, { card: b, from: 'north', auto: true }], [{ side: 'south', slot: 1 }, { card: d, from: 'south', auto: true }]]);
  assert.deepEqual(s.cues.filter(x => x.id === 'timeup').map(x => x.kind), ['sfx', 'line']);
  assert.ok(s.cues.some(x => x.id === 'hurry'));

  // Round 3 (twist write-ins): Conductor p2, North p3 p4 p5, South p6 p0 p1.
  const w = game(7); to(w, 'modifier', 3);
  const [m, n] = stock(w, 'south', 'modifier');
  act(w, 'p6', { kind: 'propose', slot: 0, cardId: m.id, target: { side: 'north', slot: 0 } });
  act(w, 'p0', { kind: 'propose', slot: 0, cardId: n.id, target: { side: 'north', slot: 1 } });
  act(w, 'p1', { kind: 'propose', slot: 0, cardId: n.id, target: { side: 'south', slot: 2 } });
  act(w, 'p3', { kind: 'propose', slot: 0, cardId: 'w3n', text: 'with a  spare  umbrella' });
  to(w, 'modifierReveal');
  assert.deepEqual(w.queue.map(q => [q.target, q.placed.card.id, q.placed.auto]), [[w.queue[0].target, 'w3n', true], [{ side: 'north', slot: 1 }, n.id, true]]);
  assert.equal(w.queue[0].placed.card.text, 'with a spare umbrella');

  for (let seed = 1; seed < 40; seed++) {
    const r = game(4, {}, seed); to(r, 'innocentReveal');
    for (const q of r.queue) { assert.equal(q.placed.card.blank, undefined); assert.equal(q.placed.auto, true); }
  }
  // A blank never gets auto-picked without valid text, and an auto twist always gets a target.
  const t = game(4, {}, 3); to(t, 'modifierReveal', 3); assert.ok(t.queue.every(q => q.target && q.placed.card.blank === undefined));
});

test('early advance after everyone locks, and a disconnected team is auto-picked', () => {
  const s = game(4); to(s, 'innocent');
  const start = s.startedAt;
  act(s, 'p1', { kind: 'lock', slot: 0, cardId: stock(s, 'north', 'innocent')[0].id }, start + 500);
  assert.equal(s.deadline, start + 30000);
  act(s, 'p3', { kind: 'lock', slot: 0, cardId: stock(s, 'south', 'innocent')[0].id }, start + 1000);
  assert.equal(s.deadline, start + TIMING.minPickMs); assert.equal(s.cues.at(-1)!.id, 'all-locked');
  to(s, 'guilty');
  const g = s.startedAt;
  act(s, 'p2', { kind: 'lock', slot: 0, cardId: stock(s, 'north', 'guilty')[0].id }, g + 4000);
  act(s, 'p3', { kind: 'lock', slot: 0, cardId: stock(s, 'south', 'guilty')[0].id }, g + 5000);
  assert.equal(s.deadline, g + 5000 + TIMING.settleMs);
  tick(s, g + 6000); assert.equal(s.phase, 'guilty'); assert.ok(!s.cues.some(c => c.id === 'hurry' && c.at >= g));
  tick(s, g + 6500); assert.equal(s.phase, 'guiltyReveal'); assert.ok(!s.cues.some(c => c.id === 'timeup' && c.at >= g));

  const d = game(4); to(d, 'innocent');
  rules.onPresenceChange(d, 'p3', false, d.now + 100);
  act(d, 'p2', { kind: 'lock', slot: 0, cardId: stock(d, 'north', 'innocent')[0].id }, d.startedAt + 200);
  assert.equal(d.deadline, d.startedAt + TIMING.minPickMs);
  rules.onPresenceChange(d, 'p3', true, d.now + 100); assert.equal(d.deadline, d.startedAt + TIMING.minPickMs);
  to(d, 'innocentReveal'); assert.equal(d.queue[0].placed.by, 'p2'); assert.equal(d.queue[1].placed.auto, true);

  const e = game(4); to(e, 'innocent');
  rules.onPresenceChange(e, 'p1', false, e.now + 10); rules.onPresenceChange(e, 'p2', false, e.now + 10);
  assert.equal(e.deadline, e.startedAt + 30000);
  rules.onPresenceChange(e, 'p3', false, e.now + 10); assert.equal(e.deadline, e.startedAt + TIMING.minPickMs);
  assert.ok(!e.cues.some(c => c.id === 'all-locked'));
  to(e, 'guilty'); assert.equal(e.deadline, e.startedAt + TIMING.minPickMs);
  to(e, 'plead'); assert.equal(e.deadline - e.startedAt, defaults.floorSeconds * 1000);
});

test('Conductor away shortens floors and the lever; timeouts keep the lever where it was', () => {
  const s = game(4); to(s, 'plead');
  rules.onPresenceChange(s, 'p0', false, s.startedAt + 1000);
  assert.equal(s.deadline, s.startedAt + 1000 + TIMING.awayMs);
  tick(s); assert.equal(s.step, 1); assert.equal(s.deadline - s.startedAt, TIMING.awayMs);
  rules.onPresenceChange(s, 'p0', true, s.startedAt + 100); assert.equal(s.deadline - s.startedAt, TIMING.awayMs);
  rules.onPresenceChange(s, 'p0', false, s.now + 100);
  tick(s); assert.equal(s.phase, 'lever'); assert.equal(s.deadline - s.startedAt, TIMING.awayMs);
  tick(s); assert.equal(s.phase, 'crash');
  assert.deepEqual(s.lever, { pulled: false, decided: false, timedOut: true }); assert.equal(s.struck, s.defaultSide);
  assert.deepEqual(cues(s, 'line').slice(-2), ['dither', 'struck']);

  const l = game(4); to(l, 'plead');
  act(l, 'p0', { kind: 'lean', pulled: true }); assert.equal(view(l).lever.pulled, true); assert.equal(l.cues.at(-1)!.id, 'lever');
  const seq = l.seq; act(l, 'p0', { kind: 'lean', pulled: true }); assert.equal(l.seq, seq);
  to(l, 'lever');
  assert.equal(l.deadline - l.startedAt, defaults.leverSeconds * 1000);
  act(l, 'p0', { kind: 'lean', pulled: false, turnId: '1.plead' }); act(l, 'p0', { kind: 'lean', pulled: true });
  for (let t = l.startedAt; t < l.deadline; t += 500) tick(l, t);
  assert.equal(cues(l, 'sfx').filter(id => id === 'tick').length, 5);
  tick(l);
  assert.equal(l.struck, opposite(l.defaultSide)); assert.deepEqual(l.lever, { pulled: true, decided: false, timedOut: true });
  assert.deepEqual(l.history[0], { round: 1, conductor: 'p0', defaultSide: l.defaultSide, pulled: true, timedOut: true, struck: opposite(l.defaultSide), victims: l.teams[opposite(l.defaultSide)] });
});

test('scoring: struck team dies, others spared, Conductor conducts; ties share the win', () => {
  const s = game(4); to(s, 'lever');
  const struck = opposite(s.defaultSide);
  act(s, 'p0', { kind: 'decide', pull: true });
  assert.equal(s.struck, struck); assert.equal(view(s).struck, struck);
  for (const p of s.players) assert.deepEqual([p.deaths, p.spared, p.conducted], p.id === 'p0' ? [0, 0, 1] : s.teams[struck].includes(p.id) ? [1, 0, 0] : [0, 1, 0]);
  assert.deepEqual(cues(s, 'line').slice(-2), ['pull', 'struck']); assert.ok(cues(s, 'sfx').includes('gasp'));
  assert.equal(s.deadline - s.startedAt, TIMING.crashMs);

  s.players.forEach((p, i) => { p.deaths = [2, 0, 1, 0][i]; p.spared = i; });
  const out = rules.outcome(s);
  assert.deepEqual(out, { complete: false, winners: [], rows: [
    { playerId: 'p1', score: 0, rank: 1, label: '0 deaths · spared 1' }, { playerId: 'p3', score: 0, rank: 1, label: '0 deaths · spared 3' },
    { playerId: 'p2', score: 1, rank: 3, label: '1 death · spared 2' }, { playerId: 'p0', score: 2, rank: 4, label: '2 deaths · spared 0' }] });
  assert.deepEqual(view(s).winners, []);

  s.round = s.rounds - 1; tick(s); to(s, 'crash', s.rounds); assert.equal(s.deadline - s.startedAt, TIMING.lastCrashMs);
  s.players.forEach((p, i) => { p.deaths = [5, 1, 1, 3][i]; });
  tick(s); assert.equal(s.phase, 'complete');
  assert.deepEqual(rules.outcome(s).winners, ['p1', 'p2']); assert.deepEqual(view(s).winners, ['p1', 'p2']); assert.equal(s.cues.at(-1)!.id, 'tie');
  assert.equal(view(s).turnId, `${s.rounds}.complete`); assert.equal(rules.outcome(s).complete, true);
  const before = structuredClone(s); tick(s, s.now + 60000); assert.deepEqual(s, { ...before, now: s.now });

  const solo = game(3); solo.round = solo.rounds; to(solo, 'crash', solo.rounds);
  solo.players.forEach((p, i) => { p.deaths = [2, 0, 1][i]; });
  tick(solo); assert.deepEqual(rules.outcome(solo).winners, ['p1']); assert.equal(solo.cues.at(-1)!.id, 'end');
});

test('deck reshuffle, family filter, Underdog and Accomplices', () => {
  const s = game(4, { blanks: false }); const first = s.dealt.filter(c => c.kind === 'innocent').map(c => c.id);
  s.deck.innocent = s.deck.innocent.slice(-3);
  to(s, 'deal', 2);
  const second = s.dealt.filter(c => c.kind === 'innocent').map(c => c.id);
  assert.equal(second.length, 8); assert.equal(new Set(second).size, 8); assert.deepEqual(s.discard.innocent, []);
  assert.equal(second.filter(id => first.includes(id)).length, 5);
  assert.equal(s.deck.innocent.length, 3);

  const f = game(5, { family: true });
  const all = [...KINDS.flatMap(k => f.deck[k]), ...f.dealt];
  assert.ok(all.every(c => !c.spicy)); assert.equal(all.length, KINDS.reduce((t, k) => t + BANKS[k].filter(c => !c.spicy).length, 0)); check(f);
  const g = game(5); assert.ok(g.deck.innocent.some(c => c.spicy)); check(g);

  const u = game(7, { catchUp: true }); to(u, 'crash');
  u.players.forEach((p, i) => { p.deaths = [0, 9, 0, 0, 3, 3, 0][i]; });
  tick(u); assert.equal(u.conductor, 'p1');
  assert.deepEqual(view(u).underdogs, ['p4', 'p5']); assert.deepEqual(u.teams, { north: ['p2', 'p3', 'p4'], south: ['p5', 'p6', 'p0'] });
  assert.equal(u.hands.north.modifier.length, 6); assert.equal(u.hands.south.modifier.length, 6);
  to(u, 'modifier'); assert.deepEqual([u.slots.north.length, u.slots.south.length], [2, 2]);
  assert.deepEqual(game(7, { catchUp: true }).underdogs, []);

  const acc = game(8, { accomplices: true, catchUp: true }); to(acc, 'crash');
  acc.players.forEach((p, i) => { p.deaths = i === 3 ? 1 : 0; });
  tick(acc); to(acc, 'modifier');
  assert.deepEqual(acc.underdogs, ['p3']); assert.deepEqual([acc.slots.north.length, acc.slots.south.length], [5, 3]);
});

test('cleanWriteIn drops invisible format characters but keeps emoji joiners', () => {
  assert.equal(cleanWriteIn('A nice man\u202e ylno\u2066 sdrawkcab\u200b\ufeff'), 'A nice man ylno sdrawkcab');
  assert.equal(cleanWriteIn('Judge \u{1F469}\u200d\u2696\ufe0f'), 'Judge \u{1F469}\u200d\u2696\ufe0f');
  assert.throws(() => cleanWriteIn('\u202e\u200b'), /Write something/);
  assert.throws(() => cleanWriteIn('a\u0007b'), /can’t print/);
});

test('write-ins rotate by round and blank ids are per team', () => {
  const s = game(3, { laps: 1 });
  for (let r = 1; r <= 3; r++) {
    to(s, 'deal', r);
    const kind = KINDS[(r - 1) % 3];
    for (const side of SIDES) assert.deepEqual(KINDS.map(k => s.hands[side][k].filter(c => c.blank).map(c => c.id)), KINDS.map(k => k === kind ? [`w${r}${side[0]}`] : []));
  }
});

test('privacy across a full bot game with write-ins', () => {
  const { s, rejected } = play(7, { accomplices: true, catchUp: true }, 5);
  assert.deepEqual(rejected, []); finished(s, 7);
  assert.ok(s.history.length === 7);
});

for (const n of [3, 4, 7, 10]) test(`bots play a full ${n}-player game to an outcome`, () => {
  const { s, accepted, rejected } = play(n, {}, 11 + n);
  assert.deepEqual(rejected, []); assert.ok(accepted > 0); finished(s, n);
  assert.ok(s.history.some(h => !h.timedOut));
});

test('a 10-player two-lap game reshuffles every deck and never repeats a card in a round', () => {
  const { s, rejected } = play(10, { laps: 2, accomplices: true, readAloud: false }, 4);
  assert.deepEqual(rejected, []); finished(s, 10, 2);
});

for (const n of [3, 10]) test(`no input at all still completes a ${n}-player game on timeouts`, () => {
  const { s, accepted } = play(n, { pickSeconds: 20, modifierSeconds: 30, floorSeconds: 20, leverSeconds: 10 }, 2, false);
  assert.equal(accepted, 0); finished(s, n);
  assert.ok(s.history.every(h => h.timedOut && !h.pulled && h.struck === h.defaultSide));
});
