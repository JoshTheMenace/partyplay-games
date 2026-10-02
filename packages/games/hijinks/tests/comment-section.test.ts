import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/comment-section/narration';
import { ADULT_QUESTIONS, ADULT_TWISTS, FORMATS, HOUSE_ANSWERS, HOUSE_TWISTS, QUESTIONS, REPLIES } from '../src/minis/comment-section/content.server';
import type { CommentState } from '../src/minis/comment-section/server';
import { KINDS, MAX_ANSWER, MAX_TWIST, type CommentPrivate, type CommentPublic, type Kind } from '../src/minis/comment-section/types';

const pub = (n: Night) => n.mini<CommentPublic>();
const me = (n: Night, id: string) => n.miniMe<CommentPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as CommentState;
const entryBy = (n: Night, key: 'author' | 'twister', id: string) => inner(n).entries.find(e => e[key] === id)!;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: CommentPublic['phase'], round?: number) => n.until(() => pub(n)?.phase === phase && (round === undefined || pub(n).round === round));

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('comment-section');
  return n;
}
const answerAll = (n: Night, ids = n.ids) => { for (const id of ids) n.send(id, { turn: pub(n).turn, k: 'answer', text: `${id} answer r${pub(n).round}` }); };
const twistAll = (n: Night, ids = n.ids) => { for (const id of ids) n.send(id, { turn: pub(n).turn, k: 'twist', text: `${id} twist r${pub(n).round}` }); };
/** Plays a round up to the vote with traceable answers and twists. */
function toVote(n: Night, round: number) {
  at(n, 'answer', round); answerAll(n);
  at(n, 'twist', round); twistAll(n);
  at(n, 'vote', round);
}

test('content banks, narration budget and catalog entry', () => {
  assert.ok(QUESTIONS.length >= 150, `${QUESTIONS.length} questions`);
  assert.ok(ADULT_QUESTIONS.length >= 10);
  const questions = [...QUESTIONS, ...ADULT_QUESTIONS];
  assert.equal(new Set(questions.map(q => q.toLowerCase())).size, questions.length, 'questions are unique');
  for (const q of questions) assert.equal(q, q.trim().replace(/\s+/g, ' '));
  assert.ok(FORMATS.filter(f => f.kind !== 'status').length >= 80, 'format variants');
  for (const kind of [...KINDS, 'status'] as Kind[]) {
    assert.ok(FORMATS.filter(f => f.kind === kind && !f.adult).length >= 8, `${kind} variants`);
    assert.ok(HOUSE_TWISTS[kind].length >= 10, `${kind} house twists`);
    for (const t of [...HOUSE_TWISTS[kind], ADULT_TWISTS[kind]]) assert.ok(t.length <= MAX_TWIST, t);
  }
  assert.equal(new Set(FORMATS.map(f => f.id)).size, FORMATS.length);
  assert.ok(Object.values(HOUSE_TWISTS).flat().length >= 100);
  const adult = ADULT_QUESTIONS.length + FORMATS.filter(f => f.adult).length + Object.keys(ADULT_TWISTS).length;
  assert.ok(adult >= 28 && adult <= 40, `${adult} adult-tagged items`);
  for (const a of HOUSE_ANSWERS) assert.ok(a.length <= MAX_ANSWER, a);
  assert.equal(new Set(HOUSE_ANSWERS).size, HOUSE_ANSWERS.length);
  assert.ok(REPLIES.length >= 30);
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^comment-section\.[a-z0-9.-]+$/);
  for (const line of miniInfo('comment-section')!.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 3, 6 and 10 players reach a sane result', async () => {
  for (const players of [3, 6, 10]) {
    const n = start(players, { seed: players }), begin = n.now;
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 25 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.ok(top > 0);
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    assert.match(result.headline!, /reported|wholesome/);
    assert.ok(n.now - begin < 16 * 60_000, `fits the time budget even with bots (${Math.round((n.now - begin) / 1000)} s)`);
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('dealing: everyone twists exactly one other answer; distinct apps; the Final Feed is all status updates; no repeat pairs in a game', () => {
  for (const players of [3, 6, 10]) {
    const n = start(players), pairs = new Set<string>();
    for (const round of [1, 2, 3]) {
      at(n, 'answer', round);
      const entries = inner(n).entries;
      assert.equal(entries.length, players);
      assert.deepEqual(entries.map(e => e.author).sort(), [...n.ids].sort());
      assert.deepEqual(entries.map(e => e.twister).sort(), [...n.ids].sort());
      for (const e of entries) assert.notEqual(e.author, e.twister);
      assert.equal(new Set(entries.map(e => e.question)).size, players, 'a different question each');
      const kinds = entries.map(e => e.format.kind);
      if (round < 3) assert.equal(new Set(kinds).size, players, 'a different app each');
      else assert.ok(kinds.every(k => k === 'status'));
      for (const id of n.ids) assert.equal(me(n, id).question, entryBy(n, 'author', id).question);
      if (players >= 6) for (const e of entries) { assert.ok(!pairs.has(`${e.twister}>${e.author}`), 'no repeat twister→author pair'); pairs.add(`${e.twister}>${e.author}`); }
      if (round < 3) at(n, 'scores', round);
    }
  }
});

test('scoring: twister 100 × votes × round, author 50 × other votes × round, house twists half, house answers nothing, ties all reported', () => {
  const n = start(4, { seed: 3 });
  at(n, 'answer', 1);
  answerAll(n, ['p0', 'p1', 'p2']);                      // p3's answer becomes a house answer
  at(n, 'twist', 1);
  assert.equal(entryBy(n, 'author', 'p3').house, true);
  twistAll(n, ['p0', 'p1', 'p2']);
  n.send('p3', { turn: pub(n).turn, k: 'auto' });       // p3 lets the house twist
  assert.equal(me(n, 'p3').auto, true);
  at(n, 'vote', 1);
  const e0 = entryBy(n, 'twister', 'p0'), e3 = entryBy(n, 'twister', 'p3'), turn = pub(n).turn;
  // e0 gets three votes, including one from its own (ruined) author; e3 (house twist) gets one.
  const forE0 = n.ids.filter(id => id !== 'p0');
  for (const id of forE0) n.send(id, { turn, k: 'vote', posts: [e0.id] });
  n.send('p0', { turn, k: 'vote', posts: [e3.id] });
  at(n, 'results', 1);
  const v = (id: string) => pub(n).result!.verdicts.find(x => x.id === id)!;
  assert.equal(v(e0.id).votes, 3); assert.equal(v(e0.id).points, 300);
  assert.equal(v(e0.id).authorPoints, e0.house ? 0 : 50 * 2, 'the author’s own vote earns no consolation');
  assert.equal(v(e3.id).points, 50, 'house twist scores half'); assert.equal(v(e3.id).auto, true);
  assert.equal(v(entryBy(n, 'author', 'p3').id).house, true);
  assert.deepEqual(pub(n).result!.reported, [e0.id]);
  assert.deepEqual(pub(n).result!.verdicts.map(x => x.votes), [0, 0, 1, 3], 'revealed fewest votes first');
  const expect: Record<string, number> = { p0: 0, p1: 0, p2: 0, p3: 0 };
  for (const x of pub(n).result!.verdicts) {
    const e = inner(n).entries.find(y => y.id === x.id)!, others = x.voters.filter(id => id !== e.author).length;
    assert.equal(x.authorPoints, e.house ? 0 : others * 50);
    expect[x.twister]! += x.points; expect[e.author]! += x.authorPoints;
  }
  assert.deepEqual(pub(n).scores, expect);

  // Round 2: a two-way tie is reported twice, at double points.
  toVote(n, 2);
  const a = entryBy(n, 'twister', 'p0'), b = entryBy(n, 'twister', 'p1'), t2 = pub(n).turn;
  n.send('p0', { turn: t2, k: 'vote', posts: [b.id] }); n.send('p1', { turn: t2, k: 'vote', posts: [a.id] });
  n.send('p2', { turn: t2, k: 'vote', posts: [a.id] }); n.send('p3', { turn: t2, k: 'vote', posts: [b.id] });
  at(n, 'results', 2);
  assert.deepEqual([...pub(n).result!.reported].sort(), [a.id, b.id].sort());
  assert.equal(pub(n).result!.verdicts.find(x => x.id === a.id)!.points, 2 * 100 * 2);
});

test('Final Feed: up to two distinct votes, never your own twist, triple points', () => {
  const n = start(4, { seed: 9 });
  toVote(n, 3);
  const turn = pub(n).turn, mine = me(n, 'p0').mine!, others = pub(n).posts!.map(p => p.id).filter(id => id !== mine);
  rejects(n.trySend('p0', { turn, k: 'vote', posts: [mine] }), /own twist/);
  rejects(n.trySend('p0', { turn, k: 'vote', posts: [others[0], others[0]] }), /different/);
  rejects(n.trySend('p0', { turn, k: 'vote', posts: others }), /one or 2/);
  rejects(n.trySend('p0', { turn, k: 'vote', posts: [] }), /one or 2/);
  n.send('p0', { turn, k: 'vote', posts: [others[0]!, others[1]!] });
  assert.deepEqual(me(n, 'p0').votes, [others[0], others[1]]);
  rejects(n.trySend('p0', { turn, k: 'vote', posts: [others[2]!] }), /already in/);
  const target = others[0]!, before = { ...pub(n).scores }, e = inner(n).entries.find(x => x.id === target)!;
  for (const id of ['p1', 'p2', 'p3']) if (id !== e.twister) n.send(id, { turn, k: 'vote', posts: [target] });
  at(n, 'results', 3);
  const verdict = pub(n).result!.verdicts.find(x => x.id === target)!;
  assert.equal(verdict.points, verdict.votes * 300);
  assert.ok(pub(n).scores[e.twister]! >= before[e.twister]! + verdict.points);
  n.until(() => n.state.phase === 'podium');
  assert.ok(n.state.podium!.result.headline);
});

test('missing inputs become house answers and twists; timers follow the pace setting', () => {
  const n = start(3, { settings: { timers: 'speedy' } });
  at(n, 'answer', 1);
  assert.equal(pub(n).deadline - pub(n).at, 31_500);
  n.send('p0', { turn: pub(n).turn, k: 'answer', text: 'Only mine is real' });
  at(n, 'twist', 1);
  const answers = inner(n).entries;
  assert.equal(answers.filter(e => !e.house).length, 1);
  for (const e of answers.filter(e => e.house)) assert.ok(HOUSE_ANSWERS.includes(e.answer!));
  assert.equal(new Set(answers.map(e => e.answer)).size, 3, 'house answers never repeat in a round');
  at(n, 'feed', 1);
  for (const e of inner(n).entries) { assert.equal(e.auto, true); assert.ok(HOUSE_TWISTS[e.format.kind].includes(e.twist!)); }
  at(n, 'results', 1);
  assert.deepEqual(pub(n).result!.reported, [], 'nobody voted');
});

test('disconnects: absent players are not waited for, and still get a post', () => {
  const n = start(5);
  at(n, 'answer', 1);
  n.connect('p4', false);
  answerAll(n, n.ids.filter(id => id !== 'p4'));
  n.advance(1600);
  assert.equal(pub(n).phase, 'twist', 'advanced without p4');
  assert.equal(entryBy(n, 'author', 'p4').house, true);
  twistAll(n, n.ids.filter(id => id !== 'p4'));
  n.advance(1600);
  assert.equal(pub(n).phase, 'feed');
  assert.equal(entryBy(n, 'twister', 'p4').auto, true);
  at(n, 'vote', 1);
  const deadline = pub(n).deadline;
  for (const id of n.ids.filter(id => id !== 'p4')) n.send(id, { turn: pub(n).turn, k: 'vote', posts: [pub(n).posts!.find(p => p.id !== me(n, id).mine)!.id] });
  n.advance(1300);
  assert.equal(pub(n).phase, 'results');
  assert.ok(n.now < deadline);
  n.connect('p4', true);
  assert.equal(me(n, 'p4').turn, pub(n).turn);
});

test('validation: stale turns, phases, duplicates, lengths and strict fields', () => {
  const n = start(4);
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'answer', text: 'early' }), /closed/);
  at(n, 'answer', 1);
  const turn = pub(n).turn;
  rejects(n.trySend('p0', { turn: 'old', k: 'answer', text: 'hi' }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'answer', text: '   ' }), /Type an answer/);
  rejects(n.trySend('p0', { turn, k: 'answer', text: 'x'.repeat(MAX_ANSWER + 1) }), /under 70/);
  rejects(n.trySend('p0', { turn, k: 'answer', text: 'hi', extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'twist', text: 'hi' }), /closed/);
  rejects(n.trySend('p0', { turn, k: 'vote', posts: ['f0'] }), /after the feed/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  rejects(n.trySend('p0', 'nope' as never), /object/);
  n.send('p0', { turn, k: 'answer', text: '  Tabs\tand‮new\nlines  ' });
  assert.equal(me(n, 'p0').answer, 'Tabs and new lines');
  rejects(n.trySend('p0', { turn, k: 'answer', text: 'again' }), /already posted/);
  answerAll(n, ['p1', 'p2', 'p3']);
  at(n, 'twist', 1);
  const twist = pub(n).turn;
  rejects(n.trySend('p1', { turn, k: 'twist', text: 'stale' }), /moved on/);
  rejects(n.trySend('p1', { turn: twist, k: 'twist', text: 'y'.repeat(MAX_TWIST + 1) }), /under 50/);
  rejects(n.trySend('p1', { turn: twist, k: 'auto', text: 'x' }), /Unknown field/);
  n.send('p1', { turn: twist, k: 'twist', text: 'Haunted canoe' });
  rejects(n.trySend('p1', { turn: twist, k: 'auto' }), /already posted/);
  twistAll(n, ['p0', 'p2', 'p3']);
  at(n, 'vote', 1);
  const vote = pub(n).turn;
  rejects(n.trySend('p2', { turn: vote, k: 'vote', posts: ['f99'] }), /isn’t on the feed/);
  rejects(n.trySend('p2', { turn: vote, k: 'vote', posts: 'f0' }), /Pick one post/);
  const others = pub(n).posts!.filter(p => p.id !== me(n, 'p2').mine);
  rejects(n.trySend('p2', { turn: vote, k: 'vote', posts: [others[0]!.id, others[1]!.id] }), /Pick one post/);
  n.send('p2', { turn: vote, k: 'vote', posts: [others[0]!.id] });
  rejects(n.trySend('p2', { turn: vote, k: 'vote', posts: [others[1]!.id] }), /already in/);
  at(n, 'results', 1);
  rejects(n.trySend('p3', { turn: vote, k: 'vote', posts: [others[0]!.id] }), /moved on/);
});

test('privacy: answers, twists and twisters stay secret until their moment', () => {
  const n = start(4);
  at(n, 'answer', 1);
  n.send('p1', { turn: pub(n).turn, k: 'answer', text: 'My secret honest answer' });
  n.assertHidden('My secret honest answer');
  for (const id of ['p0', 'p2', 'p3']) n.assertHiddenFrom(id, 'My secret honest answer');
  for (const id of n.ids) for (const other of n.ids) if (other !== id) n.assertHiddenFrom(other, entryBy(n, 'author', id).question);
  answerAll(n, ['p0', 'p2', 'p3']);
  at(n, 'twist', 1);
  const twister = entryBy(n, 'author', 'p1').twister;
  n.assertHidden('My secret honest answer');
  for (const id of n.ids) if (id !== twister && id !== 'p1') n.assertHiddenFrom(id, 'My secret honest answer');
  assert.equal(me(n, twister).target!.answer, 'My secret honest answer');
  assert.equal(me(n, twister).target!.author, 'p1');
  n.send('p2', { turn: pub(n).turn, k: 'twist', text: 'A very secret twist' });
  n.assertHidden('A very secret twist');
  for (const id of ['p0', 'p1', 'p3']) n.assertHiddenFrom(id, 'A very secret twist');
  twistAll(n, ['p0', 'p1', 'p3']);
  for (const phase of ['feed', 'vote'] as const) {
    at(n, phase, 1);
    n.assertHidden('twister');
    if (phase === 'feed') assert.ok((pub(n).posts?.length ?? 0) <= (pub(n).stage ?? 0), 'only started posts are public');
    for (const id of n.ids) { const mine = me(n, id); assert.equal(inner(n).entries.find(e => e.id === mine.mine)!.twister, id); }
  }
  assert.equal(pub(n).done.length, 0);
  at(n, 'results', 1);
  assert.deepEqual(pub(n).result!.verdicts.map(v => v.twister).sort(), [...n.ids].sort());
});

test('family filter: adult questions, formats and house twists only appear with family mode off', () => {
  const adultQ = new Set(ADULT_QUESTIONS), adultF = new Set(FORMATS.filter(f => f.adult).map(f => f.id)), adultT = new Set(Object.values(ADULT_TWISTS));
  let seen = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const family = start(10, { seed });
    for (const round of [1, 2, 3]) {
      at(family, 'feed', round);
      for (const e of inner(family).entries) assert.ok(!adultQ.has(e.question) && !adultF.has(e.format.id) && !adultT.has(e.twist!), `seed ${seed}`);
      if (round < 3) at(family, 'scores', round);
    }
    const open = start(10, { seed, settings: { family: false } });
    seen += inner(open).entries.filter(e => adultQ.has(e.question) || adultF.has(e.format.id)).length;
  }
  assert.ok(seen > 0, 'adult content is in the pool with family mode off');
});

test('night memory: a replay deals fresh questions and formats', async () => {
  const n = start(4, { seed: 8 }), dealt = new Set<string>(), formats = new Set<string>();
  const note = () => { for (const e of inner(n).entries) { dealt.add(e.question); formats.add(e.format.id); } };
  for (const round of [1, 2, 3]) { at(n, 'answer', round); note(); }
  const first = new Set(dealt), firstFormats = new Set(formats);
  await n.playMini();
  n.startMini('comment-section');
  at(n, 'answer', 1);
  for (const e of inner(n).entries) { assert.ok(!first.has(e.question), e.question); assert.ok(!firstFormats.has(e.format.id), e.format.id); }
  assert.ok([...first].every(q => n.state.used['comment-section']!.includes(q)), 'every dealt question is marked');
});
