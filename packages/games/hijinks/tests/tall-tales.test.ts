import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/tall-tales/narration';
import { ADULT, FAMILY } from '../src/minis/tall-tales/content.server';
import type { TallState } from '../src/minis/tall-tales/server';
import { MAX_LIE, MIN_OPTIONS, QUESTIONS, same, tokens, type Beat, type TallPrivate, type TallPublic } from '../src/minis/tall-tales/types';

const pub = (n: Night) => n.mini<TallPublic>();
const me = (n: Night, id: string) => n.miniMe<TallPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as TallState;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: TallPublic['phase']) => n.until(() => pub(n)?.phase === phase);
const option = (n: Night, text: string) => pub(n).options!.find(o => same(o.text, text))!.id;

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('tall-tales');
  return n;
}
/** Skips to the next writing phase, with the chooser picking the first teaser. */
function toWrite(n: Night) {
  at(n, 'pick');
  n.send(pub(n).chooser!, { turn: pub(n).turn, k: 'pick', index: 0 });
  at(n, 'write');
  return inner(n).fact!;
}

test('content bank, narration budget and catalog entry', () => {
  assert.ok(FAMILY.length >= 150, `${FAMILY.length} family stories`);
  assert.ok(ADULT.length >= 20, `${ADULT.length} adult stories`);
  const all = [...FAMILY, ...ADULT];
  assert.equal(new Set(all.map(f => f.text)).size, all.length, 'stories are unique');
  for (const f of all) {
    assert.equal(f.text.split('___').length, 2, `one blank: ${f.text}`);
    assert.ok(f.teaser.length <= 28, f.teaser);
    assert.ok(f.answer.length <= MAX_LIE && f.text.length <= 130, f.text);
    assert.ok(f.lies.length >= 3, f.text);
    for (const lie of f.lies) {
      assert.ok(lie.length <= MAX_LIE, lie);
      assert.ok(![f.answer, ...f.alts].some(a => same(a, lie)), `house lie "${lie}" matches the truth of ${f.text}`);
      assert.equal(f.lies.filter(other => same(other, lie)).length, 1, `house lies are distinct: ${lie}`);
    }
    for (const s of [f.teaser, f.text, f.answer, ...f.alts, ...f.lies]) assert.equal(s, s.trim().replace(/\s+/g, ' '), s);
  }
  assert.ok(ADULT.every(f => f.adult) && FAMILY.every(f => !f.adult));
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^tall-tales\.[a-z0-9.-]+$/);
  for (const line of miniInfo('tall-tales')!.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('answer matching ignores case, punctuation, accents, articles, plurals, spacing and number words', () => {
  for (const [a, b] of [['The Cubes!', 'cube'], ['twenty-one', '21'], ['Flat foot', 'flatfoot'], ['Café', 'cafe'], ['tomatoes', 'a tomato'], ['Halley’s Comet', 'halleys comet'], ['1,000', '1000'], ['FLIES', 'fly']])
    assert.ok(same(a, b), `${a} = ${b}`);
  for (const [a, b] of [['cat', 'cats and dogs'], ['red', 'blue'], ['', 'the'], ['16', '61']]) assert.ok(!same(a, b), `${a} ≠ ${b}`);
  assert.deepEqual(tokens('An Ocean of Seventy  Five-ish eels'), ['ocean', 'of', '75', 'ish', 'eels']);
});

test('full games with bots: 3, 6 and 10 players finish with a sane result', async () => {
  for (const players of [3, 6, 10]) {
    const n = start(players, { seed: players }), begin = n.now;
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(Number.isInteger(score) && score >= 0 && score % 25 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.ok(top > 0);
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    for (const a of result.awards ?? []) assert.ok(['Master Liar', 'Truth Seeker', 'Most Liked'].includes(a.title), a.title);
    assert.match(result.headline!, /^Extra! Extra!/);
    assert.ok(n.now - begin < 20 * 60_000, 'fits the time budget');
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('flow: round cards, a chooser per story, seven stories, scores after rounds 1 and 2, pace-scaled timers', () => {
  const n = start(4, { settings: { timers: 'speedy' } }), seen: string[] = [], choosers: string[] = [];
  assert.equal(pub(n).phase, 'round'); assert.equal(pub(n).round, 1);
  const phases = new Set<string>();
  for (let q = 0; q < QUESTIONS; q++) {
    at(n, 'pick');
    assert.equal(pub(n).q, q); assert.equal(pub(n).cats!.length, 4);
    choosers.push(pub(n).chooser!);
    assert.equal(me(n, pub(n).chooser!).chooser, true);
    assert.equal(n.ids.filter(id => me(n, id).chooser).length, 1, 'only the chooser sees the pick');
    n.send(pub(n).chooser!, { turn: pub(n).turn, k: 'pick', index: q % 4 });
    assert.equal(pub(n).picked, q % 4);
    at(n, 'write');
    if (q === 0) assert.equal(pub(n).deadline - pub(n).at, 31_500);
    seen.push(inner(n).fact!.text);
    n.until(() => pub(n).phase !== 'write' && pub(n).phase !== 'choose' && pub(n).phase !== 'reveal');
    phases.add(`${q}:${pub(n).phase}`);
  }
  assert.deepEqual([...phases], ['0:pick', '1:pick', '2:scores', '3:pick', '4:pick', '5:scores', '6:final-scores']);
  assert.equal(new Set(seen).size, QUESTIONS, 'no story twice');
  assert.deepEqual(choosers.slice(0, 4).sort(), [...n.ids].sort(), 'the chooser rotates through everyone');
  n.until(() => n.state.phase === 'podium');
});

test('lies: the truth and its variants are refused; filed lies lock; "Lie for me" offers two house lies', () => {
  const n = start(3), fact = toWrite(n), turn = pub(n).turn;
  const variants = [fact.answer.toUpperCase(), `The ${fact.answer}!`, ...fact.alts];
  for (const text of variants) rejects(n.trySend('p0', { turn, k: 'lie', text }), /That’s the truth! Write a lie instead\./);
  n.send('p0', { turn, k: 'lie', text: '  A  wheel\tof‮ cheese  ' });
  assert.equal(me(n, 'p0').lie, 'A wheel of cheese'); assert.equal(me(n, 'p0').house, undefined);
  rejects(n.trySend('p0', { turn, k: 'lie', text: 'again' }), /already filed/);
  rejects(n.trySend('p0', { turn, k: 'help' }), /already filed/);
  rejects(n.trySend('p1', { turn, k: 'house', index: 0 }), /Lie for me/);
  n.send('p1', { turn, k: 'help' });
  const offers = me(n, 'p1').offers!;
  assert.equal(offers.length, 2); assert.notEqual(offers[0], offers[1]);
  assert.ok(offers.every(o => fact.lies.includes(o)));
  n.send('p1', { turn, k: 'help' });
  assert.deepEqual(me(n, 'p1').offers, offers, 'asking twice keeps the same offers');
  rejects(n.trySend('p1', { turn, k: 'house', index: 2 }), /whole number/);
  n.send('p1', { turn, k: 'house', index: 1 });
  assert.equal(me(n, 'p1').lie, offers[1]); assert.equal(me(n, 'p1').house, true);
});

test('scoring: truth 1000, each fooled 500 (house-assisted 375), merged authors both paid, likes 50, ×2 in round 2', () => {
  const n = start(4), fact = toWrite(n), turn = pub(n).turn;
  n.send('p0', { turn, k: 'lie', text: 'A herd of goats' });
  n.send('p1', { turn, k: 'lie', text: 'herd of GOATS!' });
  n.send('p2', { turn, k: 'help' });
  const house = me(n, 'p2').offers![0]!;
  n.send('p2', { turn, k: 'house', index: 0 });
  n.send('p3', { turn, k: 'lie', text: 'Tiny trombones' });
  at(n, 'choose');
  const options = pub(n).options!, c = pub(n).turn;
  assert.ok(options.length >= MIN_OPTIONS);
  assert.equal(options.filter(o => same(o.text, 'herd of goats')).length, 1, 'identical lies merge');
  const goats = option(n, 'herd of goats'), truth = option(n, fact.answer), help = option(n, house), trombones = option(n, 'tiny trombones');
  assert.deepEqual(me(n, 'p0').mine, [goats]); assert.deepEqual(me(n, 'p1').mine, [goats]);
  rejects(n.trySend('p0', { turn: c, k: 'choose', option: goats }), /your own lie/);
  rejects(n.trySend('p0', { turn: c, k: 'like', option: goats, on: true }), /own lie/);
  rejects(n.trySend('p0', { turn: c, k: 'choose', option: 'o99' }), /not on the list/);
  n.send('p3', { turn: c, k: 'like', option: goats, on: true });
  n.send('p3', { turn: c, k: 'like', option: goats, on: true });
  n.send('p3', { turn: c, k: 'like', option: help, on: true });
  rejects(n.trySend('p3', { turn: c, k: 'like', option: truth, on: true }), /Only 2 likes/);
  n.send('p3', { turn: c, k: 'like', option: help, on: false });
  assert.deepEqual(me(n, 'p3').likes, [goats]);
  n.send('p2', { turn: c, k: 'like', option: goats, on: true });
  n.send('p0', { turn: c, k: 'like', option: trombones, on: true });
  n.send('p2', { turn: c, k: 'choose', option: goats });
  n.send('p3', { turn: c, k: 'choose', option: goats });
  n.send('p0', { turn: c, k: 'choose', option: truth });
  n.send('p1', { turn: c, k: 'choose', option: help });
  rejects(n.trySend('p1', { turn: c, k: 'choose', option: truth }), /already in/);
  assert.equal(me(n, 'p1').choice, help);
  n.advance(1400);
  assert.equal(pub(n).phase, 'choose', 'waits a moment for late likes');
  at(n, 'reveal');
  assert.deepEqual(pub(n).beats, [], 'beats appear one at a time');
  n.until(() => pub(n).phase !== 'reveal');
  assert.deepEqual(pub(n).scores, { p0: 1000 + 1000 + 100, p1: 1000 + 100, p2: 375, p3: 50 });
  const s = inner(n);
  const kinds = s.beats.map(b => b.kind);
  assert.deepEqual(kinds, ['lie', 'lie', 'truth', 'likes'], 'house-assisted lie (1 fooled), merged lie (2 fooled), truth, likes');
  const merged = s.beats[1] as Extract<Beat, { kind: 'lie' }>;
  assert.deepEqual(merged.authors.map(a => [a.id, a.points]), [['p0', 1000], ['p1', 1000]]);
  assert.deepEqual(merged.fooled, ['p2', 'p3']);
  assert.equal((s.beats[0] as Extract<Beat, { kind: 'lie' }>).authors[0]!.house, true);
  assert.deepEqual(s.stats.fooled, { p0: 2, p1: 2, p2: 1, p3: 0 });
  assert.deepEqual(s.stats.liked, { p0: 2, p1: 2, p2: 0, p3: 1 });

  // Round 2 doubles everything: fast-forward with timeouts, then one fooled player and one truth finder.
  n.until(() => pub(n).phase === 'pick' && pub(n).q === 3);
  toWrite(n);
  const t2 = pub(n).turn;
  n.send('p0', { turn: t2, k: 'lie', text: 'Purple spaghetti' });
  at(n, 'choose');
  const before = { ...pub(n).scores };
  n.send('p1', { turn: pub(n).turn, k: 'choose', option: option(n, 'purple spaghetti') });
  n.send('p2', { turn: pub(n).turn, k: 'choose', option: option(n, inner(n).fact!.answer) });
  n.until(() => pub(n).phase !== 'reveal' && pub(n).phase !== 'choose');
  assert.equal(pub(n).scores.p0! - before.p0!, 1000);
  assert.equal(pub(n).scores.p2! - before.p2!, 2000);
});

test('missing input: the story auto-picks, silent writers get house lies, nobody choosing scores nothing', () => {
  const n = start(3);
  at(n, 'pick');
  const deadline = pub(n).deadline;
  n.until(() => pub(n).picked !== undefined);
  assert.ok(n.now >= deadline);
  at(n, 'choose');
  const s = inner(n);
  for (const id of n.ids) assert.equal(s.lies[id]!.house, true, `${id} got a house lie`);
  assert.ok(pub(n).options!.length >= MIN_OPTIONS);
  n.until(() => pub(n).phase === 'reveal' && inner(n).banked === inner(n).beats.length);
  assert.deepEqual(inner(n).beats.map(b => b.kind), ['truth']);
  assert.deepEqual(pub(n).scores, { p0: 0, p1: 0, p2: 0 });
});

test('disconnects: offline players are skipped as choosers, writers and pickers', () => {
  const n = start(4);
  at(n, 'pick');
  const chooser = pub(n).chooser!;
  n.connect(chooser, false);
  n.advance(1600);
  assert.notEqual(pub(n).picked, undefined, 'an offline chooser is auto-picked after a moment');
  at(n, 'write');
  const online = n.ids.filter(id => id !== chooser);
  for (const id of online) n.send(id, { turn: pub(n).turn, k: 'lie', text: `lie from ${id}` });
  n.advance(1600);
  assert.equal(pub(n).phase, 'choose', 'did not wait for the offline writer');
  assert.equal(inner(n).lies[chooser], undefined, 'offline players get no lie');
  for (const id of online) n.send(id, { turn: pub(n).turn, k: 'choose', option: pub(n).options!.find(o => !me(n, id).mine!.includes(o.id))!.id });
  n.advance(2600);
  assert.equal(pub(n).phase, 'reveal');
  n.connect(chooser, true);
  assert.equal(me(n, chooser).turn, pub(n).turn);
  n.until(() => pub(n).phase === 'pick');
  assert.notEqual(pub(n).chooser, chooser, 'the rotation moves on');
});

test('validation: stale turns, wrong phase, wrong player, strict fields, lengths and unknown moves', () => {
  const n = start(3);
  at(n, 'pick');
  const turn = pub(n).turn, chooser = pub(n).chooser!, other = n.ids.find(id => id !== chooser)!;
  rejects(n.trySend(other, { turn, k: 'pick', index: 0 }), /not your turn/);
  rejects(n.trySend(chooser, { turn, k: 'pick', index: 4 }), /whole number/);
  rejects(n.trySend(chooser, { turn, k: 'lie', text: 'early' }), /Writing is closed/);
  rejects(n.trySend(chooser, { turn: 'old', k: 'pick', index: 0 }), /moved on/);
  rejects(n.trySend(chooser, { turn, k: 'pick', index: 0, extra: 1 }), /Unknown field/);
  n.send(chooser, { turn, k: 'pick', index: 2 });
  rejects(n.trySend(chooser, { turn, k: 'pick', index: 1 }), /already picked/);
  at(n, 'write');
  const w = pub(n).turn;
  rejects(n.trySend('p0', { turn, k: 'lie', text: 'stale' }), /moved on/);
  rejects(n.trySend('p0', { turn: w, k: 'lie', text: '   ' }), /Type a lie/);
  rejects(n.trySend('p0', { turn: w, k: 'lie', text: 'x'.repeat(MAX_LIE + 1) }), /under 45/);
  rejects(n.trySend('p0', { turn: w, k: 'lie', text: 42 }), /under 45/);
  rejects(n.trySend('p0', { turn: w, k: 'choose', option: 'o0' }), /Choosing is closed/);
  rejects(n.trySend('p0', { turn: w, k: 'dance' }), /Unknown move/);
  n.send('p0', { turn: w, k: 'lie', text: 'x'.repeat(MAX_LIE) });
  for (const id of ['p1', 'p2']) n.send(id, { turn: w, k: 'lie', text: `my lie ${id}` });
  at(n, 'choose');
  const c = pub(n).turn, target = pub(n).options!.find(o => !me(n, 'p1').mine!.includes(o.id))!.id;
  rejects(n.trySend('p1', { turn: c, k: 'like', option: target, on: 'yes' }), /on or off/);
  rejects(n.trySend('p1', { turn: c, k: 'like', option: target }), /Unknown field|on or off/);
  rejects(n.trySend('p1', { turn: w, k: 'choose', option: target }), /moved on/);
  rejects(n.trySend('spectator', { turn: c, k: 'choose', option: target }), /seated|watching/);
});

test('privacy: lies, offers and the answer stay secret until their moment', () => {
  const n = start(4), fact = toWrite(n), turn = pub(n).turn;
  for (const text of [fact.answer, ...fact.lies]) n.assertHidden(text);
  for (const id of n.ids) n.assertHiddenFrom(id, fact.answer);
  n.send('p1', { turn, k: 'lie', text: 'Secret squirrel sauce' });
  n.assertHidden('Secret squirrel sauce');
  for (const id of ['p0', 'p2', 'p3']) n.assertHiddenFrom(id, 'Secret squirrel sauce');
  n.send('p2', { turn, k: 'help' });
  for (const offer of me(n, 'p2').offers!) { n.assertHidden(offer); for (const id of ['p0', 'p1', 'p3']) n.assertHiddenFrom(id, offer); }
  assert.deepEqual(pub(n).done, ['p1']);
  at(n, 'choose');
  for (const o of pub(n).options!) assert.deepEqual(Object.keys(o).sort(), ['id', 'text'], 'options carry no authors or labels');
  for (const id of n.ids) assert.ok(!/truth|house/.test(JSON.stringify(me(n, id))));
  at(n, 'reveal');
  assert.deepEqual(pub(n).beats, []);
  let shown = 0;
  while (pub(n).phase === 'reveal') {
    const beats = pub(n).beats!;
    assert.ok(beats.length >= shown); shown = beats.length;
    assert.ok(beats.every((b, i) => b.kind !== 'truth' || i === inner(n).beats.findIndex(x => x.kind === 'truth')), 'the truth is never early');
    n.advance(100);
  }
});

test('family filter: adult stories only appear with family mode off', () => {
  const adult = new Set(ADULT.map(f => f.text));
  const family = start(10, { seed: 3 }), open = start(10, { seed: 3, settings: { family: false } });
  assert.ok(inner(family).pool.every(f => !adult.has(f.text)));
  assert.ok(inner(open).pool.some(f => adult.has(f.text)));
});

test('no story repeats within a night, even across replays', () => {
  const n = start(3, { seed: 9 }), told: string[] = [];
  for (let game = 0; game < 2; game++) {
    if (game) n.startMini('tall-tales');
    for (let q = 0; q < QUESTIONS; q++) { told.push(toWrite(n).text); n.until(() => pub(n).phase !== 'write'); }
    n.until(() => n.state.phase === 'podium');
  }
  assert.equal(new Set(told).size, told.length);
});

test('teasers never give the answer away', () => {
  for (const f of [...FAMILY, ...ADULT]) {
    const teaser = tokens(f.teaser);
    for (const a of [f.answer, ...f.alts]) for (const w of tokens(a)) if (w.length >= 3) assert.ok(!teaser.some(t => same(t, w)), `"${f.teaser}" gives away "${a}"`);
  }
});

test('review fixes: rotation after an offline skip, auto-fill keeps your offer, every banked point is on a beat', () => {
  const n = start(5, { seed: 4 });
  at(n, 'pick');
  const first = pub(n).chooser!, next = n.ids[(n.ids.indexOf(first) + 1) % 5]!;
  n.connect(next, false);
  n.send(first, { turn: pub(n).turn, k: 'pick', index: 0 });
  at(n, 'write');
  n.connect(next, true);
  const w = pub(n).turn, [a, b, c, d, e] = n.ids as [string, string, string, string, string];
  n.send(a, { turn: w, k: 'help' });
  const offer = me(n, a).offers![0]!;
  n.send(b, { turn: w, k: 'lie', text: 'Tiny trombones' }); n.send(c, { turn: w, k: 'lie', text: 'Purple spaghetti' });
  n.send(d, { turn: w, k: 'lie', text: 'Wet socks' }); n.send(e, { turn: w, k: 'lie', text: 'Garden gnomes' });
  at(n, 'choose');
  assert.deepEqual(inner(n).lies[a], { text: offer, house: true }, 'a silent helper files their own first offer');
  const t = pub(n).turn, opts = pub(n).options!;
  n.ids.forEach((id, i) => {
    const others = opts.filter(o => !me(n, id).mine!.includes(o.id) && !same(o.text, inner(n).fact!.answer)), at = (k: number) => others[(i + k) % others.length]!.id;
    n.send(id, { turn: t, k: 'like', option: at(0), on: true }); n.send(id, { turn: t, k: 'like', option: at(1), on: true });
    n.send(id, { turn: t, k: 'choose', option: at(2) });
  });
  const before = { ...pub(n).scores };
  at(n, 'reveal');
  n.until(() => pub(n).phase !== 'reveal');
  const shown: Record<string, number> = Object.fromEntries(n.ids.map(id => [id, 0]));
  for (const beat of inner(n).beats) {
    if (beat.kind === 'lie') for (const x of beat.authors) shown[x.id]! += x.points;
    if (beat.kind === 'truth') for (const id of beat.found) shown[id]! += beat.points;
    if (beat.kind === 'likes') { assert.ok(beat.top.length > 3, 'all liked lies are listed'); for (const x of beat.top) for (const id of x.authors) shown[id]! += x.likes * 50; }
  }
  for (const id of n.ids) assert.equal(pub(n).scores[id]! - before[id]!, shown[id], id);
  at(n, 'pick');
  assert.notEqual(pub(n).chooser, first, 'the chooser who covered for an offline player does not pick twice in a row');
});
