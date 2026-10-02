import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, loadBot, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/sketch-bluff/narration';
import { ADULT, ADULT_DECOYS, DECOYS, PROMPTS } from '../src/minis/sketch-bluff/content.server';
import type { SketchState } from '../src/minis/sketch-bluff/server';
import { FAKE_SUB, MAX_TITLE, artKey, revealPlan, roundsFor, titleKey, type Beat, type SketchPrivate, type SketchPublic } from '../src/minis/sketch-bluff/types';

const pub = (n: Night) => n.mini<SketchPublic>();
const me = (n: Night, id: string) => n.miniMe<SketchPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as SketchState;
const artistOf = (n: Night) => pub(n).piece!.artist;
const realOf = (n: Night) => inner(n).arts[artistOf(n)]!.prompt;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: SketchPublic['phase']) => n.until(() => pub(n)?.phase === phase);
const tallied = (n: Night) => n.until(() => !!pub(n).beats?.some(b => b.kind === 'tally'));
const LINE = { strokes: [{ color: '#05071a', width: .01, points: [{ x: .1, y: .1 }, { x: .9, y: .9 }] }] };

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('sketch-bluff');
  return n;
}
function drawAll(n: Night, ids = n.ids) { for (const id of ids) n.send(id, { turn: pub(n).turn, k: 'draw', drawing: LINE }); }
/** Every listed forger files a unique, traceable title. */
function titleAll(n: Night, ids = n.ids) { for (const id of ids) if (id !== artistOf(n)) n.send(id, { turn: pub(n).turn, k: 'title', text: `forgery number ${id} round ${pub(n).round}` }); }
const optionOf = (n: Night, text: string) => pub(n).options!.find(o => o.text === text)!.id;
const realId = (n: Night) => inner(n).options.find(o => o.kind === 'real')!.id;

test('content banks, narration budget and catalog entry', () => {
  for (const [bank, min] of [[PROMPTS, 250], [ADULT, 25], [DECOYS, 100], [ADULT_DECOYS, 8]] as const) {
    assert.ok(bank.length >= min, `bank of ${bank.length} < ${min}`);
    for (const line of bank) { assert.equal(line, line.trim().replace(/\s+/g, ' '), line); assert.ok(line.length <= MAX_TITLE, line); assert.equal(line, line.toLowerCase(), line); }
  }
  const all = [...PROMPTS, ...ADULT, ...DECOYS, ...ADULT_DECOYS];
  assert.equal(new Set(all.map(titleKey)).size, all.length, 'every prompt and decoy is distinct, even loosely matched');
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^sketch-bluff\.[a-z0-9.-]+$/);
  const info = miniInfo('sketch-bluff')!;
  for (const line of info.intro) assert.ok(Object.hasOwn(LINES, line), line);
  assert.deepEqual(info.players, { min: 3, max: 10 });
});

test('full games with bots: 3, 5, 7 and 10 players finish in time with sane scores', async () => {
  for (const players of [3, 5, 7, 10]) {
    const n = start(players, { seed: players }), begin = n.now;
    assert.equal(pub(n).rounds, roundsFor(players));
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 50 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.ok(top > 0);
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    assert.ok(n.now - begin < 15 * 60_000, `${players}p fits the time budget even with bots (${Math.round((n.now - begin) / 1000)} s)`);
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
  assert.deepEqual([3, 4, 5, 6, 10].map(roundsFor), [2, 2, 2, 1, 1]);
  for (const fakes of [2, 5, 6, 9]) {
    const plan = revealPlan(fakes), next = [...plan.fakes.slice(1), plan.real];
    plan.fakes.forEach((at, i) => assert.ok(next[i]! - at - FAKE_SUB[2] >= 1600, `${fakes} forgeries: each verdict stays readable`));
  }
});

test('scoring: finding the truth, fooling, artist bonus, likes and the reveal order', () => {
  const n = start(4);
  drawAll(n);
  at(n, 'title');
  assert.equal(n.view().media[artKey(1, 0)] !== undefined, true, 'drawings are hung as media');
  const artist = artistOf(n), [b, c, d] = n.ids.filter(id => id !== artist) as [string, string, string];
  titleAll(n);
  at(n, 'guess');
  assert.equal(pub(n).options!.length, 4, 'three forgeries and the truth: no decoys needed');
  const fake = (id: string) => optionOf(n, inner(n).titles[id]!), turn = pub(n).turn;
  n.send(b, { turn, k: 'guess', option: realId(n) });
  n.send(c, { turn, k: 'guess', option: fake(b) });
  n.send(d, { turn, k: 'guess', option: fake(c) });
  n.send(d, { turn, k: 'like', option: fake(b), on: true });
  n.send(artist, { turn, k: 'like', option: fake(b), on: true });
  n.send(artist, { turn, k: 'like', option: fake(c), on: true });
  n.send(b, { turn, k: 'like', option: realId(n), on: true });
  at(n, 'reveal');
  assert.deepEqual(pub(n).scores, { [artist]: 500 + 50, [b]: 1000 + 500 + 100, [c]: 500 + 50, [d]: 0 });
  tallied(n);
  const beats = pub(n).beats!;
  assert.deepEqual(beats.map(x => x.kind), ['fake', 'fake', 'real', 'tally']);
  const real = beats[2] as Extract<Beat, { kind: 'real' }>, tally = beats[3] as Extract<Beat, { kind: 'tally' }>;
  assert.deepEqual(real.found, [b]); assert.equal(real.artist, artist); assert.equal(real.points, 500); assert.equal(real.text, realOf(n));
  assert.deepEqual(beats.slice(0, 2).map(x => x.kind === 'fake' && [x.author, x.fooled, x.points]).sort(), [[b, [c], 500], [c, [d], 500]].sort());
  assert.deepEqual(tally.likes, { [b]: 2, [c]: 1, [artist]: 1 });
  assert.deepEqual(tally.gains, { [artist]: 550, [b]: 1600, [c]: 550 });
});

test('round two doubles; house decoys pad the list and score nothing; Best Artist award', () => {
  const n = start(3);
  for (let round = 1; round <= 2; round++) {
    at(n, 'draw'); drawAll(n);
    for (let piece = 0; piece < 3; piece++) {
      n.until(() => pub(n).phase === 'title' && pub(n).piece!.index === piece);
      const artist = artistOf(n), [b, c] = n.ids.filter(id => id !== artist) as [string, string];
      n.send(b, { turn: pub(n).turn, k: 'title', text: `a lie by ${b} ${round} ${piece}` });
      at(n, 'guess');
      assert.equal(pub(n).options!.length, 4, 'one forgery, the truth and two house decoys');
      const house = inner(n).options.filter(o => o.kind === 'house');
      assert.equal(house.length, 2);
      const before = { ...pub(n).scores };
      n.send(b, { turn: pub(n).turn, k: 'guess', option: realId(n) });
      n.send(c, { turn: pub(n).turn, k: 'guess', option: house[0]!.id });
      at(n, 'reveal');
      assert.equal(pub(n).scores[b]! - before[b]!, 1000 * round);
      assert.equal(pub(n).scores[artist]! - before[artist]!, 500 * round);
      assert.equal(pub(n).scores[c], before[c]);
      tallied(n);
      assert.deepEqual(pub(n).beats!.map(x => x.kind), ['house', 'real', 'tally']);
    }
    at(n, 'scores');
    assert.equal(pub(n).pieces!.length, 3);
  }
  n.until(() => n.state.phase === 'podium');
  // Every artist was found exactly twice, so Best Artist is a tie and is not awarded.
  assert.ok(!n.state.podium!.result.awards?.some(a => a.title === 'Best Artist'));
});

test('titles: too close to the truth, duplicates, the artist, lengths and suggestions', () => {
  const n = start(4);
  drawAll(n);
  at(n, 'title');
  const artist = artistOf(n), real = realOf(n), [b, c, d] = n.ids.filter(id => id !== artist) as [string, string, string], turn = pub(n).turn;
  rejects(n.trySend(b, { turn, k: 'title', text: real.toUpperCase() }), /Too close to the real title/);
  rejects(n.trySend(b, { turn, k: 'title', text: `The ${real.replace(/^an? /, '')}!!` }), /Too close/);
  rejects(n.trySend(artist, { turn, k: 'title', text: 'my own art' }), /You drew this one/);
  rejects(n.trySend(b, { turn, k: 'title', text: 'x'.repeat(MAX_TITLE + 1) }), /under 40/);
  rejects(n.trySend(b, { turn, k: 'title', text: '   ' }), /Type a title/);
  rejects(n.trySend(b, { turn, k: 'title', text: '!!!' }), /real words/);
  n.send(b, { turn, k: 'title', text: '  A Bold\tNew‮ Forgery ' });
  assert.equal(me(n, b).title, 'a bold new forgery', 'cleaned and lower-cased');
  assert.equal(me(n, b).suggestions, undefined, 'suggestions go away once filed');
  rejects(n.trySend(b, { turn, k: 'title', text: 'again' }), /already in/);
  rejects(n.trySend(c, { turn, k: 'title', text: 'A BOLD NEW FORGERY!' }), /already forged/);
  // Typing habits are not tells: straight apostrophes become the gallery's curly ones and a closing full stop goes.
  const habits = createNight({ players: 3, seed: 5 });
  habits.startMini('sketch-bluff'); drawAll(habits); at(habits, 'title');
  const forger = habits.ids.find(id => id !== artistOf(habits))!;
  habits.send(forger, { turn: pub(habits).turn, k: 'title', text: "A Cat's `Big` Day." });
  assert.equal(me(habits, forger).title, 'a cat’s ’big’ day');
  const offers = me(n, c).suggestions!;
  assert.equal(offers.length, 3);
  assert.equal(new Set([...offers, ...me(n, d).suggestions!]).size, 6, 'suggestions differ between forgers');
  assert.ok(offers.every(o => DECOYS.includes(o)));
  n.send(c, { turn, k: 'title', text: offers[0]! });
  n.send(d, { turn, k: 'title', text: 'something else entirely' });
  at(n, 'guess');
  const texts = pub(n).options!.map(o => o.text);
  assert.equal(new Set(texts.map(titleKey)).size, texts.length, 'no two options match');
  assert.ok(!texts.includes(offers[1]!) && !texts.includes(offers[2]!), 'unused suggestions never become decoys');
});

test('missing drawings skip that artist; an empty studio skips the gallery', () => {
  const n = start(4);
  drawAll(n, ['p0', 'p1', 'p2']);
  at(n, 'title');
  assert.equal(pub(n).piece!.count, 3);
  assert.ok(!inner(n).order.includes('p3'));
  assert.equal(Object.keys(n.view().media).length, 3);
  n.until(() => pub(n).phase === 'draw' || pub(n).phase === 'scores');
  assert.equal(pub(n).phase, 'scores');
  assert.equal(pub(n).pieces!.length, 3);
  at(n, 'draw');
  assert.equal(pub(n).round, 2);
  assert.equal(Object.keys(n.view().media).length, 0, 'last round’s drawings are taken down');
  n.until(() => pub(n).phase !== 'draw');
  assert.equal(pub(n).phase, 'scores', 'nobody drew: straight to the exhibition');
  assert.deepEqual(pub(n).pieces, []);
  n.until(() => n.state.phase === 'podium');
  assert.deepEqual(n.state.podium!.result.winners, []);
});

test('timers follow the pace setting; everyone-in advances early; disconnects are not waited for', () => {
  const n = start(5, { settings: { timers: 'speedy' } });
  assert.equal(pub(n).deadline - pub(n).at, 56_000);
  n.connect('p4', false);
  drawAll(n, ['p0', 'p1', 'p2', 'p3']);
  n.advance(1600);
  assert.equal(pub(n).phase, 'title', 'advanced without p4 after the readable minimum');
  assert.equal(pub(n).deadline - pub(n).at, 24_500);
  titleAll(n, ['p0', 'p1', 'p2', 'p3']);
  n.advance(1600);
  assert.equal(pub(n).phase, 'guess');
  const turn = pub(n).turn;
  for (const id of ['p0', 'p1', 'p2', 'p3']) if (id !== artistOf(n)) n.send(id, { turn, k: 'guess', option: realId(n) });
  n.advance(1000);
  assert.equal(pub(n).phase, 'guess', 'a short grace for late likes');
  n.advance(700);
  assert.equal(pub(n).phase, 'reveal');
  n.connect('p4', true);
  assert.equal(me(n, 'p4').turn, pub(n).turn);
});

test('validation: stale turns, wrong phases, own titles, artists and likes', () => {
  const n = start(4), turn = pub(n).turn;
  rejects(n.trySend('p0', { turn: 'old', k: 'draw', drawing: LINE }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'draw', drawing: { strokes: [] } }), /Draw something/);
  rejects(n.trySend('p0', { turn, k: 'draw', drawing: { strokes: [{ color: '#123456', width: .01, points: [{ x: 0, y: 0 }] }] } }), /Invalid drawing/);
  rejects(n.trySend('p0', { turn, k: 'draw', drawing: LINE, extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'title', text: 'early' }), /Titles are closed/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  n.send('p0', { turn, k: 'draw', drawing: LINE });
  assert.equal(me(n, 'p0').drawn, true);
  rejects(n.trySend('p0', { turn, k: 'draw', drawing: LINE }), /already hanging/);
  drawAll(n, ['p1', 'p2', 'p3']);
  at(n, 'title');
  rejects(n.trySend('p1', { turn: pub(n).turn, k: 'guess', option: 'o0' }), /moment/);
  titleAll(n);
  at(n, 'guess');
  const g = pub(n).turn, artist = artistOf(n), forger = n.ids.find(id => id !== artist)!, mine = me(n, forger).mine!;
  assert.equal(me(n, artist).mine, realId(n), 'the artist owns the real title');
  rejects(n.trySend(artist, { turn: g, k: 'guess', option: 'o0' }), /your masterpiece/);
  rejects(n.trySend(forger, { turn: g, k: 'guess', option: mine }), /own forgery/);
  rejects(n.trySend(forger, { turn: g, k: 'guess', option: 'o9' }), /isn’t on the wall/);
  rejects(n.trySend(forger, { turn: g, k: 'like', option: mine, on: true }), /own title/);
  rejects(n.trySend(artist, { turn: g, k: 'like', option: realId(n), on: true }), /own title/);
  const others = pub(n).options!.map(o => o.id).filter(id => id !== mine);
  n.send(forger, { turn: g, k: 'guess', option: others[0]! });
  rejects(n.trySend(forger, { turn: g, k: 'guess', option: others[1]! }), /already in/);
  assert.equal(me(n, forger).pick, others[0]);
  n.send(forger, { turn: g, k: 'like', option: others[0]!, on: true });
  rejects(n.trySend(forger, { turn: g, k: 'like', option: others[0]!, on: true }), /already liked/);
  n.send(forger, { turn: g, k: 'like', option: others[1]!, on: true });
  rejects(n.trySend(forger, { turn: g, k: 'like', option: others[2]!, on: true }), /Only 2 likes/);
  n.send(forger, { turn: g, k: 'like', option: others[0]!, on: false });
  rejects(n.trySend(forger, { turn: g, k: 'like', option: others[0]!, on: false }), /haven’t liked/);
  rejects(n.trySend(forger, { turn: g, k: 'like', option: others[2]!, on: 'yes' }), /on or off/);
  n.send(forger, { turn: g, k: 'like', option: others[2]!, on: true });
  assert.deepEqual(me(n, forger).likes, [others[1], others[2]]);
  at(n, 'reveal');
  rejects(n.trySend(forger, { turn: g, k: 'like', option: others[0]!, on: true }), /moved on/);
});

test('privacy: prompts, titles and authors stay secret until the reveal', () => {
  const n = start(4);
  const prompts = Object.fromEntries(n.ids.map(id => [id, inner(n).arts[id]!.prompt]));
  for (const id of n.ids) {
    assert.equal(me(n, id).prompt, prompts[id]);
    n.assertHidden(prompts[id]!);
    for (const other of n.ids) if (other !== id) n.assertHiddenFrom(other, prompts[id]!);
  }
  drawAll(n);
  at(n, 'title');
  const artist = artistOf(n), real = prompts[artist]!, forgers = n.ids.filter(id => id !== artist);
  n.assertHidden(real);
  for (const id of forgers) n.assertHiddenFrom(id, real);
  assert.equal(me(n, artist).prompt, real);
  assert.equal(me(n, artist).artist, true);
  for (const id of forgers) for (const offer of me(n, id).suggestions!) for (const other of n.ids) if (other !== id) n.assertHiddenFrom(other, offer);
  titleAll(n);
  for (const id of forgers) {
    const text = inner(n).titles[id]!;
    n.assertHidden(text);
    for (const other of n.ids) if (other !== id) n.assertHiddenFrom(other, text);
  }
  at(n, 'guess');
  const options = JSON.stringify(pub(n).options);
  for (const id of n.ids) assert.ok(!options.includes(`"${id}"`), `options leak ${id}`);
  assert.ok(pub(n).options!.every(o => Object.keys(o).join() === 'id,text'), 'options carry no kinds or authors');
  for (const id of forgers) assert.equal(me(n, id).mine, optionOf(n, inner(n).titles[id]!));
  at(n, 'reveal');
  assert.deepEqual(pub(n).beats, [], 'beats appear only as they start');
});

test('family filter: adult prompts and decoys only when family mode is off', () => {
  const adult = new Set([...ADULT, ...ADULT_DECOYS]);
  let seen = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const family = start(10, { seed });
    assert.ok([...inner(family).prompts, ...inner(family).decoys].every(p => !adult.has(p)), `seed ${seed}`);
    const open = start(10, { seed, settings: { family: false } });
    seen += Object.values(inner(open).arts).filter(a => adult.has(a.prompt)).length;
    assert.ok(inner(open).decoys.some(d => adult.has(d)));
  }
  assert.ok(seen > 0, 'adult prompts are dealt with family mode off');
});

test('ties share the win; awards need a single leader', () => {
  const n = start(3);
  const s = inner(n);
  s.scores = { p0: 3000, p1: 3000, p2: 500 };
  s.stats = { found: { p0: 2, p1: 1, p2: 0 }, fooled: { p0: 1, p1: 1, p2: 0 }, liked: { p0: 0, p1: 0, p2: 0 } };
  s.done = true;
  n.advance(200);
  const result = n.state.podium!.result;
  assert.deepEqual(result.winners, ['p0', 'p1']);
  assert.deepEqual(result.awards, [{ title: 'Best Artist', playerId: 'p0' }]);
});

test('night memory: a replay in the same night draws none of the first game’s prompts', async () => {
  const n = start(4, { seed: 8 }), bot = await loadBot('sketch-bluff');
  const session = () => { const seen = new Set<string>(); n.runMini(input => { for (const art of Object.values(inner(n).arts)) seen.add(art.prompt); return bot(input); }); return seen; };
  const first = session();
  n.startMini('sketch-bluff');
  const second = session();
  assert.equal(second.size, 4 * roundsFor(4));
  assert.deepEqual([...second].filter(p => first.has(p)), []);
});
