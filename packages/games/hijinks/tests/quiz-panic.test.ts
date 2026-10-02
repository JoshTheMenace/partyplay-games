import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/quiz-panic/narration';
import { CATEGORIES, TRIVIA, WORDS } from '../src/minis/quiz-panic/content.server';
import type { QuizState } from '../src/minis/quiz-panic/server';
import { EXIT, FINAL_TURNS, LONE_PRIZE, PRIZE, QUESTIONS, ROOMS, SEQUENCE, type Kind, type QuizPrivate, type QuizPublic } from '../src/minis/quiz-panic/types';

const pub = (n: Night) => n.mini<QuizPublic>();
const me = (n: Night, id: string) => n.miniMe<QuizPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as QuizState;
const right = (n: Night) => inner(n).questions[inner(n).q - 1]!.correct;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: QuizPublic['phase']) => n.until(() => pub(n)?.phase === phase);
const stage = (n: Night, s: string) => n.until(() => pub(n)?.phase === 'panic' && pub(n).panic!.stage === s);

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('quiz-panic');
  return n;
}
/** Answers the open question: listed seats answer wrong, everyone else right. */
function answer(n: Night, wrong: string[] = [], ids = n.ids) {
  const ok = right(n);
  for (const id of ids) n.send(id, { turn: pub(n).turn, k: 'answer', option: wrong.includes(id) ? (ok + 1) % 4 : ok });
}
/** Answers so `wrong` are doomed, forces the next Panic Room challenge, and waits for its first live stage. */
function doom(n: Night, wrong: string[], kind: Kind) {
  inner(n).bag = [kind];
  answer(n, wrong, n.ids.filter(id => n.state.players.find(p => p.id === id)!.connected));
  at(n, 'panic');
}
const toFinal = (n: Night) => { inner(n).q = QUESTIONS; answer(n); at(n, 'final-question'); };

test('content banks, narration budget and catalog entry', () => {
  const family = TRIVIA.filter(t => !t.adult), cats = CATEGORIES.filter(c => !c.adult);
  assert.ok(family.length >= 200, `${family.length} family questions`);
  assert.ok(TRIVIA.length - family.length >= 12, 'adult questions exist for family-off nights');
  assert.ok(new Set(family.map(t => t.category)).size >= QUESTIONS, 'enough categories for nine different ones');
  assert.equal(new Set(TRIVIA.map(t => t.text.toLowerCase())).size, TRIVIA.length, 'questions are unique');
  for (const t of TRIVIA) {
    const options = [t.answer, ...t.wrong];
    assert.equal(options.length, 4, t.text);
    assert.equal(new Set(options.map(o => o.toLowerCase())).size, 4, `options unique: ${t.text}`);
    assert.ok(t.text.length <= 110, `question too long for the TV: ${t.text}`);
    for (const o of options) { assert.ok(o.length && o.length <= 32, `option length: ${o}`); assert.equal(o, o.trim()); }
  }
  assert.ok(cats.length >= 60, `${cats.length} final categories`);
  assert.equal(new Set(CATEGORIES.map(c => c.name)).size, CATEGORIES.length);
  for (const c of CATEGORIES) {
    assert.ok(c.yes.length >= 6 && c.no.length >= 6, c.name);
    assert.equal(new Set([...c.yes, ...c.no]).size, c.yes.length + c.no.length, `no item is both in and out: ${c.name}`);
    for (const item of [...c.yes, ...c.no]) assert.ok(item.length <= 20, `item length: ${item}`);
  }
  assert.equal(new Set(WORDS).size, WORDS.length);
  for (const w of WORDS) assert.match(w, /^[A-Z]{5,8}$/);
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^quiz-panic\.[a-z0-9.-]+$/);
  const info = miniInfo('quiz-panic')!;
  assert.deepEqual(info.players, { min: 2, max: 10 });
  for (const line of info.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 2, 5 and 10 players reach a sane result', async () => {
  for (const players of [2, 5, 10]) {
    const n = start(players, { seed: players * 3 }), begin = n.now;
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    assert.ok(result.winners.length >= 1);
    const best = Math.max(...Object.values(result.scores));
    for (const id of result.winners) assert.equal(result.scores[id], best, 'the escapee tops the podium');
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 500 === 0, `${score}`);
    assert.ok(result.headline, 'headline names the escape');
    assert.ok(n.now - begin < 20 * 60_000, `${players}p fits the time budget`);
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('many seeds: every game finishes and every challenge gets played', async () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 6; seed++) {
    const n = start(6, { seed }), seen = () => { const p = pub(n)?.panic; if (p) kinds.add(p.kind); return false; };
    const original = n.advance.bind(n);
    n.advance = (ms: number) => { original(ms); seen(); };
    const { rejected } = await n.playMini();
    assert.deepEqual(rejected, []);
  }
  assert.deepEqual([...kinds].sort(), ['coin', 'hide', 'math', 'memory', 'poison', 'scramble']);
});

test('money: $1000 per right answer, $1500 for a lone right answer; wrong living players are doomed; ghosts earn but never die twice', () => {
  const n = start(4);
  assert.equal(pub(n).q, 1); assert.equal(pub(n).total, QUESTIONS);
  assert.equal(pub(n).question!.options.length, 4);
  inner(n).bag = ['coin'];
  answer(n, ['p2', 'p3']);
  n.advance(1500);
  assert.equal(pub(n).phase, 'answer');
  let a = pub(n).answer!;
  assert.deepEqual(a.earned, { p0: PRIZE, p1: PRIZE });
  assert.deepEqual(a.doomed, ['p2', 'p3']);
  assert.equal(a.correct, right(n));
  assert.deepEqual(pub(n).money, { p0: PRIZE, p1: PRIZE, p2: 0, p3: 0 });
  // Kill p3 by hand, then a lone right answer pays 1.5×; the ghost earns money and is never doomed.
  at(n, 'panic');
  inner(n).alive.p3 = false;
  n.until(() => pub(n).phase === 'question' && pub(n).q === 2);
  assert.deepEqual(pub(n).ghosts.includes('p3'), true);
  answer(n, ['p0', 'p1', 'p2']);
  n.advance(1500);
  a = pub(n).answer!;
  assert.deepEqual(a.earned, { p3: LONE_PRIZE });
  assert.deepEqual(a.doomed, ['p0', 'p1', 'p2'], 'everyone alive and wrong faces the challenge');
  assert.equal(me(n, 'p3').alive, false);
});

test('defaults: silent players are doomed, offline silent players are skipped, and the question ends early once everyone is in', () => {
  const n = start(4);
  n.connect('p3', false);
  const deadline = pub(n).deadline;
  answer(n, [], ['p0', 'p1']);
  n.advance(2000);
  assert.equal(pub(n).phase, 'question', 'waits for p2');
  n.until(() => pub(n).phase === 'answer');
  assert.ok(n.now >= deadline, 'the timer ran out');
  assert.deepEqual(pub(n).answer!.doomed, ['p2'], 'p2 (online, silent) is doomed; p3 (offline) is skipped');
  n.connect('p3', true);
  n.until(() => pub(n).phase === 'question' && pub(n).q === 2);
  const opened = n.now;
  answer(n);
  n.advance(1600);
  assert.equal(pub(n).phase, 'answer');
  assert.ok(n.now - opened < 2000, 'advanced after the readable minimum');
  assert.deepEqual(pub(n).answer!.doomed, []);
});

test('a room that drops entirely waits for deadlines instead of racing through questions and challenges', () => {
  const n = start(3), deadline = pub(n).deadline;
  for (const id of n.ids) n.connect(id, false);
  n.advance(3000);
  assert.equal(pub(n).phase, 'question', 'nobody online is not "everyone answered"');
  n.until(() => pub(n).phase === 'answer');
  assert.ok(n.now >= deadline);
  for (const id of n.ids) n.connect(id, true);
  n.until(() => pub(n).phase === 'question' && pub(n).q === 2);
  doom(n, ['p1'], 'hide');
  for (const id of n.ids) n.connect(id, false);
  const hide = pub(n).deadline;
  n.advance(3000);
  assert.equal(pub(n).phase, 'panic', 'the challenge keeps its timer');
  n.until(() => pub(n).phase === 'panic-reveal');
  assert.ok(n.now >= hide);
});

test('timers follow the pace setting', () => {
  const n = start(3, { settings: { timers: 'speedy' } });
  assert.equal(pub(n).deadline - pub(n).at, 10_500);
});

test('Poison Punch: survivors spike cups secretly; at least one cup stays safe; poisoned drinkers become ghosts', () => {
  const n = start(5);
  doom(n, ['p3', 'p4'], 'poison');
  let p = pub(n).panic!;
  assert.equal(p.kind, 'poison'); assert.equal(p.stage, 'poison');
  assert.equal(p.cups, 3); assert.deepEqual(p.poisoners, ['p0', 'p1', 'p2']);
  assert.equal(me(n, 'p0').task, 'poison'); assert.equal(me(n, 'p3').task, 'watch');
  rejects(n.trySend('p3', { turn: pub(n).turn, k: 'cup', cup: 0 }), /survivors/);
  n.send('p0', { turn: pub(n).turn, k: 'cup', cup: 0 });
  n.send('p1', { turn: pub(n).turn, k: 'cup', cup: 1 });
  n.send('p2', { turn: pub(n).turn, k: 'cup', cup: 2 });
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'cup', cup: 1 }), /already/);
  assert.ok(!JSON.stringify(pub(n)).includes('"poisons"'));
  n.assertHiddenFrom('p1', '"cup":0');
  stage(n, 'drink');
  const poisoned = inner(n).panic!.poisoned;
  assert.equal(poisoned.length, 2, 'all three cups were spiked, so one is quietly made safe');
  const safe = [0, 1, 2].find(c => !poisoned.includes(c))!;
  assert.equal(me(n, 'p3').task, 'drink');
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'cup', cup: 0 }), /doomed/);
  rejects(n.trySend('p3', { turn: pub(n).turn, k: 'cup', cup: 3 }), /whole number/);
  n.send('p3', { turn: pub(n).turn, k: 'cup', cup: safe });
  n.send('p4', { turn: pub(n).turn, k: 'cup', cup: poisoned[0]! });
  at(n, 'panic-reveal');
  p = pub(n).panic!;
  assert.deepEqual(p.reveal!.dead, ['p4']);
  assert.deepEqual(p.reveal!.drinks, { p3: safe, p4: poisoned[0] });
  assert.deepEqual(pub(n).ghosts, ['p4']);
});

test('Poison Punch with nobody safe: the ghoul spikes one cup and missing drinkers get a random cup', () => {
  const n = start(3);
  doom(n, n.ids, 'poison');
  const p = pub(n).panic!;
  assert.equal(p.stage, 'drink'); assert.deepEqual(p.poisoners, []); assert.equal(p.cups, 4);
  assert.equal(inner(n).panic!.poisoned.length, 1);
  at(n, 'panic-reveal');
  assert.equal(Object.keys(pub(n).panic!.reveal!.drinks!).length, 3);
});

test('Mad Math: three sums each; any wrong or missing answer is fatal', () => {
  const n = start(4);
  doom(n, ['p1', 'p2', 'p3'], 'math');
  const sums = me(n, 'p1').sums!, solve = (s: { a: number; op: string; b: number }) => s.op === '+' ? s.a + s.b : s.op === '−' ? s.a - s.b : s.a * s.b;
  assert.equal(sums.length, 3); assert.equal(me(n, 'p0').sums, undefined);
  assert.ok(!JSON.stringify(pub(n)).includes('"sums"'));
  rejects(n.trySend('p1', { turn: pub(n).turn, k: 'math', answers: [1, 2] }), /Finish/);
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'math', answers: [1, 2, 3] }), /No sums/);
  n.send('p1', { turn: pub(n).turn, k: 'math', answers: sums.map(solve) });
  const wrong = me(n, 'p2').sums!.map(solve); wrong[2]! += 1;
  n.send('p2', { turn: pub(n).turn, k: 'math', answers: wrong });
  at(n, 'panic-reveal');
  const r = pub(n).panic!.reveal!;
  assert.deepEqual(r.dead, ['p2', 'p3']);
  assert.equal(r.sums!.p3![0]!.given, null);
  assert.equal(r.sums!.p1![1]!.given, r.sums!.p1![1]!.answer);
});

test('Memory Lane: the sequence shows for 5 s, then hides; exact repeats survive', () => {
  const n = start(3);
  doom(n, ['p1', 'p2'], 'memory');
  assert.equal(pub(n).panic!.stage, 'memorize');
  const seq = pub(n).panic!.sequence!;
  assert.equal(seq.length, SEQUENCE);
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], 'no symbol twice in a row');
  rejects(n.trySend('p1', { turn: pub(n).turn, k: 'memory', seq }), /No sequence/);
  assert.equal(pub(n).deadline - pub(n).at, 5000);
  stage(n, 'recall');
  assert.equal(pub(n).panic!.sequence, undefined, 'hidden while players repeat it');
  n.send('p1', { turn: pub(n).turn, k: 'memory', seq });
  n.send('p2', { turn: pub(n).turn, k: 'memory', seq: [...seq].reverse() });
  rejects(n.trySend('p2', { turn: pub(n).turn, k: 'memory', seq }), /already/);
  at(n, 'panic-reveal');
  assert.deepEqual(pub(n).panic!.reveal!.dead, ['p2']);
  assert.deepEqual(pub(n).panic!.reveal!.sequence, seq);
});

test('Hide & Shriek: rooms stay secret until the ghoul searches 2–3 of them', () => {
  const n = start(4);
  doom(n, ['p1', 'p2', 'p3'], 'hide');
  n.send('p1', { turn: pub(n).turn, k: 'room', room: 0 });
  n.send('p2', { turn: pub(n).turn, k: 'room', room: 5 });
  assert.ok(!JSON.stringify(pub(n)).includes('"rooms"'));
  n.assertHiddenFrom('p2', '"room":0');
  assert.equal(me(n, 'p1').room, 0);
  at(n, 'panic-reveal');
  const r = pub(n).panic!.reveal!;
  assert.ok(r.searched!.length >= 2 && r.searched!.length <= 3);
  assert.ok(r.rooms!.p3! >= 0 && r.rooms!.p3! < ROOMS, 'missing hider gets a random room');
  assert.deepEqual(r.dead, ['p1', 'p2', 'p3'].filter(id => r.searched!.includes(r.rooms![id]!)));
});

test('Scramble: private words, three tries, solvers live', () => {
  const n = start(4);
  doom(n, ['p1', 'p2', 'p3'], 'scramble');
  const word = (id: string) => inner(n).panic!.words[id]!.word;
  assert.notEqual(me(n, 'p1').letters!.join(''), word('p1'));
  assert.deepEqual([...me(n, 'p1').letters!].sort(), [...word('p1')].sort());
  n.assertHidden(word('p1'));
  n.assertHiddenFrom('p2', word('p1'));
  rejects(n.trySend('p1', { turn: pub(n).turn, k: 'word', text: ' ' }), /Spell/);
  n.send('p1', { turn: pub(n).turn, k: 'word', text: word('p1').toLowerCase() });
  assert.equal(me(n, 'p1').solved, true);
  rejects(n.trySend('p1', { turn: pub(n).turn, k: 'word', text: 'x' }), /cracked/);
  for (let i = 0; i < 3; i++) n.send('p2', { turn: pub(n).turn, k: 'word', text: 'nope' });
  assert.equal(me(n, 'p2').misses, 3); assert.equal(me(n, 'p2').miss, 'NOPE');
  rejects(n.trySend('p2', { turn: pub(n).turn, k: 'word', text: word('p2') }), /Out of tries/);
  assert.deepEqual(pub(n).done, ['p1', 'p2']);
  at(n, 'panic-reveal');
  assert.deepEqual(pub(n).panic!.reveal!.dead, ['p2', 'p3']);
  assert.equal(pub(n).panic!.reveal!.words!.p1, word('p1'));
});

test('Coin of Fate: best two of three; calls stay hidden until the flip', () => {
  const n = start(3);
  doom(n, ['p1', 'p2'], 'coin');
  const flipAndCall = (calls: Record<string, 'H' | 'T'>) => { for (const [id, side] of Object.entries(calls)) n.send(id, { turn: pub(n).turn, k: 'call', side }); };
  // p1 always calls heads, p2 always tails; whoever wins two flips lives.
  for (let flip = 0; flip < 3; flip++) {
    stage(n, 'call');
    const p = inner(n).panic!, mine = me(n, 'p1').calls!.length;
    assert.equal(mine, flip);
    rejects(n.trySend('p1', { turn: pub(n).turn, k: 'call', side: 'X' }), /Heads or tails/);
    flipAndCall({ ...(p.safe.includes('p1') || p.out.includes('p1') ? {} : { p1: 'H' }), ...(p.safe.includes('p2') || p.out.includes('p2') ? {} : { p2: 'T' }) });
    assert.deepEqual(pub(n).panic!.calls!.p1!.length, flip, 'this flip’s call is hidden');
    stage(n, 'flip');
    n.until(() => pub(n).phase === 'panic-reveal' || pub(n).panic?.stage === 'call');
    if (pub(n).phase === 'panic-reveal') break;
  }
  at(n, 'panic-reveal');
  const p = inner(n).panic!, record = (id: string) => p.calls[id]!.filter((c, i) => c === p.flips[i]).length;
  assert.ok(p.flips.length >= 2 && p.flips.length <= 3);
  for (const id of ['p1', 'p2']) assert.equal(p.dead.includes(id), record(id) < 2, `${id} lives with two right calls`);
});

test('final: start positions, moves, wrong picks, body swaps, the ghoul and the escape', () => {
  const n = start(4);
  inner(n).money = { p0: 3000, p1: 2000, p2: 1000, p3: 4000 };
  inner(n).alive.p3 = false;
  inner(n).q = QUESTIONS;
  answer(n);
  at(n, 'final-intro');
  let f = pub(n).final!;
  assert.deepEqual(f.pos, { p0: 4, p1: 3, p2: 2, p3: 0 }, 'living start at 2 + money rank bonus; ghosts at 0');
  assert.deepEqual(f.bonus, { p0: 2, p1: 1, p2: 0 });
  at(n, 'final-question');
  f = pub(n).final!;
  assert.equal(f.turn, 1); assert.equal(f.items.length, 3);
  const fits = inner(n).final!.fits, yes = [0, 1, 2].filter(i => fits[i]), no = [0, 1, 2].filter(i => !fits[i]);
  assert.ok(yes.length >= 1);
  assert.ok(!JSON.stringify(pub(n)).includes('"fits"'), 'answers hidden');
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'items', picks: [0, 0] }), /once/);
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'items', picks: [3] }), /whole number/);
  n.send('p0', { turn: pub(n).turn, k: 'items', picks: yes });
  n.send('p1', { turn: pub(n).turn, k: 'items', picks: no.length ? [...yes, no[0]!] : [] });
  n.send('p2', { turn: pub(n).turn, k: 'items', picks: [] });
  inner(n).final!.pos.p3 = 3 - yes.length; // the ghost will land on 3: past p2 (2), so it steals p2's body
  n.send('p3', { turn: pub(n).turn, k: 'items', picks: yes });
  rejects(n.trySend('p3', { turn: pub(n).turn, k: 'items', picks: [] }), /already/);
  at(n, 'final-answer');
  const r = pub(n).final!.result!;
  assert.equal(r.moves.p0, yes.length); assert.equal(r.moves.p1, 0, 'any wrong pick moves you nowhere'); assert.equal(r.moves.p2, 0);
  assert.deepEqual(r.swaps, [{ ghost: 'p3', living: 'p2' }]);
  assert.deepEqual(pub(n).ghosts, ['p2']);
  assert.deepEqual(r.caught, [], 'the ghoul waits on turn 1');
  // Turn 2: the ghoul steps to space 1. Fast-forward p0 to the door.
  at(n, 'final-question');
  inner(n).final!.pos.p0 = EXIT - 1;
  const fits2 = inner(n).final!.fits, one = [0, 1, 2].find(i => fits2[i])!;
  n.send('p0', { turn: pub(n).turn, k: 'items', picks: [one] });
  at(n, 'final-answer');
  assert.deepEqual(pub(n).final!.result!.escaped, ['p0']);
  at(n, 'final-end');
  assert.deepEqual(pub(n).final!.winners, ['p0']); assert.equal(pub(n).final!.how, 'escaped');
  n.until(() => n.state.phase === 'podium');
  const result = n.state.podium!.result;
  assert.deepEqual(result.winners, ['p0']);
  assert.equal(result.scores.p0, 4000 + 5000, 'money plus the escape bonus');
  assert.match(result.headline!, /escaped the hotel/);
  assert.ok(result.awards!.some(a => a.title === 'Body snatcher' && a.playerId === 'p3'));
});

test('final: the ghoul catches stragglers; after eight turns the furthest living player wins, ties by money', () => {
  const n = start(3);
  inner(n).money = { p0: 1000, p1: 2000, p2: 0 };
  toFinal(n);
  for (let turn = 1; turn <= FINAL_TURNS; turn++) {
    n.until(() => pub(n).phase === 'final-question' || pub(n).phase === 'final-end');
    if (pub(n).phase === 'final-end') break;
    assert.equal(pub(n).final!.turn, turn);
    const f = inner(n).final!;
    Object.assign(f.pos, { p0: 8, p1: 8, p2: Math.min(f.pos.p2!, 2) });
    at(n, 'final-answer');
    if (turn === 3) assert.deepEqual(pub(n).final!.result!.caught, ['p2'], 'the ghoul (space 2) catches p2');
  }
  at(n, 'final-end');
  assert.equal(pub(n).final!.turn, FINAL_TURNS);
  assert.equal(pub(n).final!.how, 'furthest');
  assert.deepEqual(pub(n).final!.winners, ['p1'], 'p0 and p1 tie on space 8; p1 has more money');
});

test('final: when everyone is a ghost, the richest ghost gets a body back', () => {
  const n = start(3);
  for (const id of n.ids) inner(n).alive[id] = false;
  inner(n).money = { p0: 0, p1: 3000, p2: 1000 };
  inner(n).q = QUESTIONS;
  answer(n, n.ids);
  at(n, 'final-intro');
  assert.deepEqual(pub(n).ghosts, ['p0', 'p2']);
  assert.equal(pub(n).final!.pos.p1, 4);
});

test('validation: stale turns, wrong phase, strict fields, duplicates', () => {
  const n = start(3), turn = pub(n).turn;
  rejects(n.trySend('p0', { turn: 'old', k: 'answer', option: 0 }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'answer', option: 4 }), /whole number/);
  rejects(n.trySend('p0', { turn, k: 'answer', option: 1, extra: true }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  rejects(n.trySend('p0', { turn, k: 'room', room: 1 }), /No hiding/);
  rejects(n.trySend('p0', { turn, k: 'items', picks: [] }), /No category/);
  rejects(n.trySend('p0', { turn, k: 'call', side: 'H' }), /No coin/);
  n.send('p0', { turn, k: 'answer', option: 2 });
  assert.equal(me(n, 'p0').pick, 2);
  rejects(n.trySend('p0', { turn, k: 'answer', option: 1 }), /already locked/);
  n.assertHiddenFrom('p1', '"pick":2');
  answer(n, [], ['p1', 'p2']);
  n.advance(1600);
  rejects(n.trySend('p1', { turn, k: 'answer', option: 0 }), /moved on/);
});

test('privacy: the answer key never appears before the reveal', () => {
  const n = start(4);
  assert.equal(pub(n).answer, undefined);
  assert.ok(!JSON.stringify(pub(n)).includes('"correct"'));
  for (const id of n.ids) assert.ok(!JSON.stringify(n.me(id)).includes('"correct"'));
  answer(n);
  n.advance(1600);
  assert.equal(pub(n).answer!.correct, right(n));
});

test('disconnects: absent doomed players never stall a challenge', () => {
  const n = start(4);
  doom(n, ['p2', 'p3'], 'hide');
  n.connect('p3', false);
  n.send('p2', { turn: pub(n).turn, k: 'room', room: 1 });
  n.advance(1600);
  assert.equal(pub(n).phase, 'panic-reveal', 'did not wait for offline p3');
  n.connect('p3', true);
  assert.equal(me(n, 'p3').turn, pub(n).turn);
});

test('family filter: adult questions and categories only appear when family mode is off', () => {
  const adultQ = new Set(TRIVIA.filter(t => t.adult).map(t => t.text)), adultC = new Set(CATEGORIES.filter(c => c.adult).map(c => c.name));
  let seen = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const family = start(4, { seed }), s = inner(family);
    assert.ok(s.questions.every(q => !adultQ.has(q.text)) && s.cats.every(c => !adultC.has(c.name)), `seed ${seed}`);
    const open = inner(start(4, { seed, settings: { family: false } }));
    seen += open.questions.filter(q => adultQ.has(q.text)).length + open.cats.filter(c => adultC.has(c.name)).length;
  }
  assert.ok(seen > 0, 'adult content is in the pool with family mode off');
});

test('night memory: a replay in the same night asks none of the first game’s questions or final categories', async () => {
  const n = start(3, { seed: 8 }), dealt = () => new Set([...inner(n).questions.map(q => q.text), ...inner(n).cats.map(c => c.name)]);
  const first = dealt();
  await n.playMini();
  n.startMini('quiz-panic');
  const second = dealt();
  assert.equal(second.size, QUESTIONS + FINAL_TURNS);
  assert.deepEqual([...second].filter(x => first.has(x)), []);
});
