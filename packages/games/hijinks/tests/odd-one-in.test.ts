import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/odd-one-in/narration';
import { TASKS } from '../src/minis/odd-one-in/content.server';
import { bot } from '../src/minis/odd-one-in/bot';
import type { OddState } from '../src/minis/odd-one-in/server';
import { CATEGORIES, FACES, FAKER_BRIEF, NUMBERS, type Category, type OddPrivate, type OddPublic } from '../src/minis/odd-one-in/types';

const pub = (n: Night) => n.mini<OddPublic>();
const me = (n: Night, id: string) => n.miniMe<OddPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as OddState;
const faker = (n: Night) => inner(n).file.faker;
const innocents = (n: Night) => n.ids.filter(id => id !== faker(n));
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: OddPublic['phase']) => n.until(() => pub(n)?.phase === phase);
const valid = (n: Night, category: Category): readonly string[] => ({ hands: ['up', 'down'], number: NUMBERS, point: n.ids, face: FACES.map(f => f.id) })[category];

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('odd-one-in');
  return n;
}
/** Everyone answers with the first legal option; then the reveal and discussion run out. */
function answerAll(n: Night, ids = n.ids) {
  at(n, 'task');
  for (const id of ids) n.send(id, { turn: pub(n).turn, k: 'answer', value: valid(n, pub(n).category)[0]! });
}
/** Everyone votes for `suspect(id)` (skipping self-votes) in the vote phase. */
function voteAll(n: Night, suspect: (id: string) => string | null) {
  at(n, 'vote');
  for (const id of n.ids) { const s = suspect(id); if (s && s !== id) n.send(id, { turn: pub(n).turn, k: 'vote', suspect: s }); }
}
/** One whole task: answers, then votes from `suspect`, ending on the verdict screen. */
function playTask(n: Night, suspect: (id: string) => string | null) { answerAll(n); voteAll(n, suspect); at(n, 'verdict'); }

test('content banks, narration budget and catalog entry', () => {
  for (const c of CATEGORIES) {
    const { family, adult } = TASKS[c];
    assert.ok(family.length >= 60, `${c}: ${family.length} family tasks`);
    assert.ok(adult.length >= 10, `${c}: ${adult.length} adult tasks`);
    const all = [...family, ...adult];
    assert.equal(new Set(all.map(t => t.toLowerCase())).size, all.length, `${c} tasks are unique`);
    for (const t of all) { assert.equal(t, t.trim().replace(/\s+/g, ' '), t); assert.ok(t.length <= 90, t); }
  }
  for (const t of [...TASKS.hands.family, ...TASKS.hands.adult]) assert.match(t, /^Raise your hand if you’ve ever /);
  for (const t of [...TASKS.point.family, ...TASKS.point.adult]) assert.match(t, /^Point at the player most likely to /);
  for (const t of [...TASKS.face.family, ...TASKS.face.adult]) assert.match(t, /^Make the face you’d make if /);
  for (const t of [...TASKS.number.family, ...TASKS.number.adult]) assert.match(t, /^(How many|From 0 to 10)/);
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^odd-one-in\.[a-z0-9.-]+$/);
  for (const line of miniInfo('odd-one-in')!.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 3, 6 and 10 players reach a sane result', () => {
  for (const players of [3, 6, 10]) {
    const n = start(players, { seed: players }), begin = n.now, fakers: string[] = [];
    const { result, rejected } = n.runMini(input => { const f = faker(n); if (fakers.at(-1) !== f) fakers.push(f); return bot(input); });
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.equal(fakers.length, players >= 6 ? 4 : 3, 'one faker per case');
    for (let i = 1; i < fakers.length; i++) assert.notEqual(fakers[i], fakers[i - 1], 'never the same faker twice in a row');
    if (players === 3) assert.equal(new Set(fakers).size, 3, 'three players each fake once');
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 100 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.ok(top > 0);
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    assert.match(result.headline!, /caught/);
    assert.ok(n.now - begin < 20 * 60_000, 'fits the time budget even with bots');
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('caught on the first task: detectives +500 +100, other innocents +100, the faker nothing', () => {
  const n = start(5);
  at(n, 'case');
  assert.equal(pub(n).category, inner(n).categories[0]);
  const f = faker(n), [a, b, c, d] = innocents(n);
  // Three accuse the faker, one accuses b, the faker accuses a.
  playTask(n, id => id === f ? a! : id === d ? b! : f);
  const v = pub(n).verdict!;
  assert.equal(v.outcome, 'caught'); assert.equal(v.accused, f); assert.equal(pub(n).faker, f);
  assert.deepEqual(pub(n).scores, Object.fromEntries(n.ids.map(id => [id, 0])), 'points wait for the case file');
  at(n, 'closed');
  const closed = pub(n).closed!;
  assert.equal(closed.faker, f); assert.equal(closed.caught, true); assert.equal(closed.survived, 0); assert.equal(closed.trail.length, 1);
  assert.deepEqual(closed.gains, { [f]: 0, [a!]: 600, [b!]: 600, [c!]: 600, [d!]: 100 });
  assert.deepEqual(pub(n).scores, closed.gains);
  assert.ok(pub(n).prev);
});

test('framed, then a hung jury, then caught: the faker banks 500 per survived task', () => {
  const n = start(4);
  const f = faker(n), [a, b, c] = innocents(n);
  playTask(n, id => id === a ? b! : a!);
  let v = pub(n).verdict!;
  assert.equal(v.outcome, 'framed'); assert.equal(v.accused, a); assert.equal(pub(n).faker, undefined, 'faker stays secret');
  // Nothing marks the accused innocent before the stamp lands: "Cleared" waits for the verdict to end.
  while (pub(n).phase === 'verdict') { assert.deepEqual(pub(n).cleared, [], 'no spoiler during the verdict'); n.advance(100); }
  n.until(() => pub(n).phase === 'task' && pub(n).task === 2);
  assert.equal(faker(n), f, 'same faker, next task');
  assert.deepEqual(pub(n).cleared, [a]);
  // Two votes each on b and c: no strict majority.
  playTask(n, id => id === a || id === b ? c! : b!);
  v = pub(n).verdict!;
  assert.equal(v.outcome, 'hung'); assert.equal(v.accused, null);
  n.until(() => pub(n).phase === 'task' && pub(n).task === 3);
  playTask(n, id => id === f ? a! : f);
  assert.equal(pub(n).verdict!.outcome, 'caught');
  at(n, 'closed');
  assert.deepEqual(pub(n).closed!.gains, { [f]: 1000, [a!]: 600, [b!]: 600, [c!]: 600 });
});

test('a tie at the top that includes the faker is a hung jury; surviving three tasks is a Master of Disguise', () => {
  const n = start(4);
  const f = faker(n), [a, b, c] = innocents(n);
  playTask(n, id => id === f ? a! : id === a ? f : id === b ? f : a!);
  assert.equal(pub(n).verdict!.outcome, 'hung', '2–2 with the faker in it');
  n.until(() => pub(n).phase === 'task' && pub(n).task === 2);
  playTask(n, () => null);
  assert.equal(pub(n).verdict!.outcome, 'hung'); assert.deepEqual(pub(n).verdict!.votes, {});
  n.until(() => pub(n).phase === 'task' && pub(n).task === 3);
  playTask(n, id => id === b ? c! : b!);
  const v = pub(n).verdict!;
  assert.equal(v.outcome, 'framed'); assert.equal(v.escaped, true); assert.equal(pub(n).faker, undefined);
  at(n, 'closed');
  const closed = pub(n).closed!;
  assert.equal(closed.caught, false); assert.equal(closed.survived, 3); assert.equal(closed.trail.length, 3);
  assert.deepEqual(closed.gains, { [f]: 2500, [a!]: 500, [b!]: 500, [c!]: 0 }, 'correct votes pay even when the faker escapes');
  // A new case with a different faker follows.
  n.until(() => pub(n).phase === 'case' && pub(n).round === 2);
  assert.notEqual(faker(n), f);
});

test('missing answers become flagged random picks; nobody voting is a hung jury', () => {
  const n = start(3, { settings: { timers: 'speedy' } });
  at(n, 'task');
  assert.equal(pub(n).deadline - pub(n).at, 14_000, 'task timer follows the pace');
  const cat = pub(n).category;
  n.send('p0', { turn: pub(n).turn, k: 'answer', value: valid(n, cat)[1]! });
  at(n, 'reveal');
  const answers = pub(n).answers!;
  assert.deepEqual(answers.map(a => a.player), n.ids);
  assert.equal(answers[0]!.auto, undefined); assert.equal(answers[0]!.value, valid(n, cat)[1]);
  for (const a of answers.slice(1)) { assert.equal(a.auto, true); assert.ok(valid(n, cat).includes(a.value)); }
  assert.equal(me(n, 'p1').answer, answers[1]!.value);
  at(n, 'verdict');
  assert.equal(pub(n).verdict!.outcome, 'hung');
});

test('disconnects: offline players are not waited for; offline players are not picked as the faker', () => {
  const n = start(5);
  n.until(() => pub(n).phase === 'closed');
  n.connect('p1', false); n.connect('p2', false);
  n.until(() => pub(n).phase === 'case' && pub(n).round === 2);
  assert.ok(!['p1', 'p2'].includes(faker(n)));
  at(n, 'task');
  const online = n.ids.filter(id => id !== 'p1' && id !== 'p2'), deadline = pub(n).deadline;
  answerAll(n, online);
  n.advance(1600);
  assert.equal(pub(n).phase, 'reveal');
  assert.ok(n.now < deadline);
  at(n, 'discuss');
  for (const id of online) n.send(id, { turn: pub(n).turn, k: 'ready' });
  n.advance(1600);
  assert.equal(pub(n).phase, 'vote', 'everyone online is ready');
  for (const id of online) n.send(id, { turn: pub(n).turn, k: 'vote', suspect: id === 'p0' ? 'p3' : 'p0' });
  n.advance(1300);
  assert.equal(pub(n).phase, 'verdict');
  n.connect('p1', true);
  assert.equal(me(n, 'p1').turn, pub(n).turn);
});

test('validation: stale turns, out-of-phase moves, duplicates, bad values, self-accusation, strict fields', () => {
  const n = start(4);
  at(n, 'case');
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'answer', value: 'up' }), /No answers/);
  at(n, 'task');
  const turn = pub(n).turn, cat = pub(n).category, ok = valid(n, cat)[0]!;
  rejects(n.trySend('p0', { turn: 'old', k: 'answer', value: ok }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'answer', value: 'banana' }), /options/);
  rejects(n.trySend('p0', { turn, k: 'answer', value: 3 }), /options/);
  rejects(n.trySend('p0', { turn, k: 'answer', value: ok, extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'vote', suspect: 'p1' }), /moment/);
  rejects(n.trySend('p0', { turn, k: 'ready' }), /Not yet/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  n.send('p0', { turn, k: 'answer', value: ok });
  rejects(n.trySend('p0', { turn, k: 'answer', value: ok }), /already locked/);
  assert.equal(me(n, 'p0').answer, ok);
  answerAll(n, ['p1', 'p2', 'p3']);
  at(n, 'discuss');
  n.send('p0', { turn: pub(n).turn, k: 'ready' });
  rejects(n.trySend('p0', { turn: pub(n).turn, k: 'ready' }), /already ready/);
  assert.equal(me(n, 'p0').ready, true);
  rejects(n.trySend('p1', { turn, k: 'answer', value: ok }), /moved on/);
  at(n, 'vote');
  const vote = pub(n).turn;
  rejects(n.trySend('p0', { turn: vote, k: 'vote', suspect: 'p0' }), /accuse yourself/);
  rejects(n.trySend('p0', { turn: vote, k: 'vote', suspect: 'p9' }), /player in the room/);
  n.send('p0', { turn: vote, k: 'vote', suspect: 'p1' });
  rejects(n.trySend('p0', { turn: vote, k: 'vote', suspect: 'p2' }), /already in/);
  assert.equal(me(n, 'p0').vote, 'p1');
  at(n, 'verdict');
  rejects(n.trySend('p2', { turn: vote, k: 'vote', suspect: 'p1' }), /moved on/);
});

test('Point Blank accepts any player, yourself included', () => {
  for (let seed = 1; seed < 40; seed++) {
    const n = createNight({ players: 3, seed });
    n.startMini('odd-one-in');
    if (pub(n).category !== 'point') continue;
    at(n, 'task');
    n.send('p0', { turn: pub(n).turn, k: 'answer', value: 'p0' });
    n.send('p1', { turn: pub(n).turn, k: 'answer', value: 'p2' });
    rejects(n.trySend('p2', { turn: pub(n).turn, k: 'answer', value: 'p7' }), /options/);
    return;
  }
  assert.fail('no seed opened on Point Blank');
});

test('privacy: the task stays off the TV and the faker phone; the faker stays hidden until caught or the case closes', () => {
  for (const seed of [2, 3, 4]) {
    const n = start(6, { seed });
    at(n, 'task');
    const f = faker(n), prompt = inner(n).file.tasks[0]!.prompt;
    n.assertHidden(prompt);
    n.assertHiddenFrom(f, prompt);
    assert.equal(me(n, f).brief, FAKER_BRIEF); assert.equal(me(n, f).faker, true);
    for (const id of innocents(n)) {
      assert.equal(me(n, id).brief, prompt); assert.equal(me(n, id).faker, false);
      n.assertHiddenFrom(id, FAKER_BRIEF);
    }
    // The faker's phone and a task phone carry exactly the same fields.
    assert.deepEqual(Object.keys(me(n, f)).sort(), Object.keys(me(n, innocents(n)[0]!)).sort());
    // No public field ever names the faker before a catch or the case file; scores don't move mid-case.
    const [a, b] = innocents(n);
    for (const phase of ['task', 'reveal', 'discuss', 'vote', 'verdict'] as const) {
      at(n, phase);
      if (phase === 'vote') for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'vote', suspect: id === a ? b! : a! });
      const view = pub(n);
      assert.equal(view.faker, undefined); assert.equal(view.closed, undefined);
      assert.ok(!JSON.stringify(view).includes('faker'), `${phase} public view mentions the faker`);
      assert.deepEqual(new Set(Object.values(view.scores)), new Set([0]));
      for (const id of n.ids) {
        const mine = me(n, id), named = JSON.stringify(mine).match(/"p\d"/g) ?? [];
        assert.ok(named.every(x => x === `"${mine.vote ?? ''}"` || x === `"${mine.answer ?? ''}"`), `${id} private view names only their own picks`);
      }
    }
    assert.equal(pub(n).verdict!.outcome, 'framed');
    n.until(() => pub(n).phase === 'task' && pub(n).task === 2);
    assert.equal(pub(n).prompt, undefined, 'the next task is secret again');
    assert.equal(pub(n).answers, undefined);
  }
});

test('family filter: adult tasks only appear when family mode is off', () => {
  const adult = new Set(CATEGORIES.flatMap(c => TASKS[c].adult));
  let seen = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const family = start(10, { seed });
    assert.ok(Object.values(inner(family).decks).flat().every(t => !adult.has(t)), `seed ${seed}`);
    const open = start(10, { seed, settings: { family: false } });
    seen += Object.values(inner(open).decks).flat().filter(t => adult.has(t)).length;
  }
  assert.ok(seen > 0, 'adult tasks are in the pool with family mode off');
});

test('awards: Smoothest Faker, Usual Suspect and Best Detective', () => {
  const n = start(3);
  // Case 1: the faker escapes by framing the same innocent three times.
  const f1 = faker(n), [x, y] = innocents(n);
  for (let k = 1; k <= 3; k++) { n.until(() => pub(n).phase === 'task' && pub(n).task === k); playTask(n, id => id === x ? y! : x!); }
  // Cases 2 and 3: the innocents name the faker at once (each player fakes exactly once with three players).
  for (const round of [2, 3]) {
    n.until(() => pub(n).phase === 'task' && pub(n).round === round);
    const f = faker(n);
    assert.notEqual(f, f1);
    playTask(n, id => id === f ? n.ids.find(o => o !== f)! : f);
  }
  n.until(() => n.state.phase === 'podium');
  const awards = n.state.podium!.result.awards ?? [];
  assert.deepEqual(awards.find(a => a.title === 'Smoothest Faker')?.playerId, f1);
  assert.deepEqual(awards.find(a => a.title === 'Usual Suspect')?.playerId, x);
  assert.deepEqual(awards.find(a => a.title === 'Best Detective')?.playerId, f1, 'two correct votes against one each');
});

test('ten players: strictly the most votes catches the faker without a majority; a tie at the top is hung', () => {
  const n = start(10, { seed: 3 }), f = faker(n), i = innocents(n);
  // Three of ten name the faker; every innocent gets at most two. A plurality, not a majority.
  const pairs: Record<string, string> = { [f]: i[0]!, [i[3]!]: i[4]!, [i[4]!]: i[3]!, [i[5]!]: i[6]!, [i[6]!]: i[5]!, [i[7]!]: i[8]!, [i[8]!]: i[7]! };
  playTask(n, id => pairs[id] ?? f);
  assert.equal(pub(n).verdict!.outcome, 'caught');
  at(n, 'closed');
  assert.deepEqual(pub(n).closed!.gains, Object.fromEntries(n.ids.map(id => [id, id === f ? 0 : [i[0], i[1], i[2]].includes(id) ? 600 : 100])));
  // Next case: three on the faker and three on one innocent is a tie at the top.
  n.until(() => pub(n).phase === 'case' && pub(n).round === 2);
  const g = faker(n), j = innocents(n), tie: Record<string, string> = { [j[3]!]: j[8]!, [j[4]!]: j[8]!, [j[5]!]: j[8]!, [g]: j[0]!, [j[6]!]: j[7]!, [j[7]!]: j[6]!, [j[8]!]: j[0]! };
  playTask(n, id => tie[id] ?? g);
  assert.equal(pub(n).verdict!.outcome, 'hung');
  assert.equal(pub(n).verdict!.accused, null);
});

test('night memory: a replay in the same night deals none of the first game’s tasks', () => {
  const n = start(4, { seed: 8 });
  const session = () => { const seen = new Set<string>(); n.runMini(input => { for (const t of inner(n).file.tasks) seen.add(t.prompt); return bot(input); }); return seen; };
  const first = session();
  n.startMini('odd-one-in');
  const second = session();
  assert.ok(second.size >= 3);
  assert.deepEqual([...second].filter(x => first.has(x)), []);
});
