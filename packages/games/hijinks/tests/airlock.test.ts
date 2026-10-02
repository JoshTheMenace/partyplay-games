import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { mix, pick as pickN, random, shuffle } from '../src/core/server/rng';
import type { MiniApi, PackPlayer } from '../src/core/contract';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/airlock/narration';
import { PAIRS, pairKey } from '../src/minis/airlock/content.server';
import { server, type AirState } from '../src/minis/airlock/server';
import { ICONS, KINDS, MAX_ANSWER, MIN_RESUME_MS, TESTS, artKey, type AirPrivate, type AirPublic, type Kind } from '../src/minis/airlock/types';

const pub = (n: Night) => n.mini<AirPublic>();
const me = (n: Night, id: string) => n.miniMe<AirPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as AirState;
const cur = (n: Night) => inner(n).tests.at(-1)!;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: AirPublic['phase']) => n.until(() => pub(n)?.phase === phase);
const crew = (n: Night) => n.ids.filter(id => !inner(n).aliens.includes(id));
const DOODLE = { strokes: [{ color: '#05071a', width: .01, points: [{ x: .2, y: .2 }, { x: .8, y: .8 }] }] };

function start(players: number, options: NightOptions & { order?: Kind[] } = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('airlock');
  if (options.order) inner(n).order = options.order;
  return n;
}
/** A legal answer for the current test. */
function legal(n: Night, id: string) {
  const kind = cur(n).pair.kind, turn = pub(n).turn;
  if (kind === 'draw') return { turn, k: 'draw', drawing: DOODLE };
  return { turn, k: 'answer', value: kind === 'answer' ? `${id} answers` : kind === 'rating' ? 5 : kind === 'pick' ? id : 2 };
}
function answerAll(n: Night, ids = n.ids) { for (const id of ids) n.send(id, legal(n, id)); }
/** Answers the current test and waits for the discussion. */
function toDiscuss(n: Night) { at(n, 'test'); answerAll(n); at(n, 'discuss'); }
function push(n: Night, by: string, suspect: string) { n.send(by, { turn: pub(n).turn, k: 'push', suspect }); }
function voteAll(n: Night, vote: 'airlock' | 'abort' | ((id: string) => 'airlock' | 'abort')) {
  const b = pub(n).ballot!;
  for (const id of n.ids) if (id !== b.by && id !== b.suspect && !pub(n).out.includes(id)) n.send(id, { turn: pub(n).turn, k: 'vote', vote: typeof vote === 'string' ? vote : vote(id) });
}

test('content bank, narration budget and catalog entry', () => {
  const family = PAIRS.filter(p => !p.adult), adult = PAIRS.filter(p => p.adult);
  assert.ok(PAIRS.length >= 150, `${PAIRS.length} pairs`);
  assert.ok(adult.length >= 18 && adult.length <= 25, `${adult.length} adult pairs`);
  for (const kind of KINDS) {
    assert.ok(family.filter(p => p.kind === kind).length >= 24, `${kind} family pairs`);
    assert.ok(adult.some(p => p.kind === kind), `${kind} has adult pairs`);
  }
  assert.equal(new Set(PAIRS.map(pairKey)).size, PAIRS.length, 'crew prompts are unique');
  for (const p of PAIRS) {
    for (const text of [p.crew, p.alien]) assert.equal(text, text.trim().replace(/\s+/g, ' '), text);
    assert.notEqual(p.crew.toLowerCase(), p.alien.toLowerCase(), p.crew);
    if (p.kind === 'choice') { assert.equal(new Set(p.icons).size, 4, p.crew); for (const icon of p.icons!) assert.ok(Object.hasOwn(ICONS, icon), icon); }
    else assert.equal(p.icons, undefined);
  }
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^airlock\.[a-z0-9.-]+$/);
  const info = miniInfo('airlock')!;
  assert.deepEqual(info.players, { min: 4, max: 10 });
  for (const line of info.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 4, 6, 7 and 10 players reach a sane team result', async () => {
  for (const players of [4, 6, 7, 10]) for (const seed of [1, 2]) {
    const n = start(players, { seed }), begin = n.now, s = inner(n);
    assert.equal(s.aliens.length, players >= 7 ? 2 : 1);
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 500 === 0, `${score}`);
    const aliensWon = result.winners.every(id => s.aliens.includes(id));
    assert.deepEqual(result.winners, n.ids.filter(id => s.aliens.includes(id) === aliensWon), 'winners are exactly one team');
    for (const id of n.ids) assert.equal(result.scores[id]! > 0, result.winners.includes(id), 'only the winning team scores');
    assert.match(result.headline!, /aliens|alien|human/i);
    assert.ok(result.headline!.length <= 40);
    assert.ok(n.now - begin < 15 * 60_000, 'fits the time budget');
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('setup: aliens know each other, every kind is tested, seven tests, never opening on a doodle', () => {
  for (const players of [4, 6, 7, 10]) for (const seed of [1, 2, 3, 4]) {
    const n = start(players, { seed }), s = inner(n);
    assert.equal(s.order.length, TESTS);
    assert.deepEqual([...new Set(s.order)].sort(), [...KINDS].sort());
    assert.equal(s.order.filter(k => k === 'draw').length, 1);
    assert.notEqual(s.order[0], 'draw');
    for (let i = 1; i < TESTS; i++) assert.notEqual(s.order[i], s.order[i - 1], 'no kind twice in a row');
    for (const id of n.ids) {
      const view = me(n, id), alien = s.aliens.includes(id);
      assert.equal(view.role, alien ? 'alien' : 'crew');
      assert.deepEqual(view.allies, alien ? s.aliens.filter(x => x !== id) : []);
      assert.equal(view.prompt, undefined, 'no test during the briefing');
    }
    assert.equal(pub(n).aliens, s.aliens.length);
  }
});

test('prompts: crew see the real test, aliens the near miss; the TV shows the crew prompt only once the answers are in', () => {
  const n = start(7, { order: ['choice', 'answer', 'rating', 'pick', 'draw', 'answer', 'rating'] });
  at(n, 'test');
  const pair = cur(n).pair;
  assert.equal(pair.kind, 'choice');
  for (const id of n.ids) {
    assert.equal(me(n, id).prompt, inner(n).aliens.includes(id) ? pair.alien : pair.crew);
    assert.deepEqual(me(n, id).icons, pair.icons, 'everyone sees the same four pictures');
  }
  n.assertHidden(pair.crew); n.assertHidden(pair.alien);
  assert.equal(pub(n).board, undefined);
  answerAll(n);
  at(n, 'results');
  assert.equal(pub(n).board!.prompt, pair.crew);
  assert.deepEqual(pub(n).board!.icons, pair.icons);
  n.assertHidden(pair.alien);
  assert.deepEqual(pub(n).board!.answers.map(a => a.player), n.ids, 'answers in roster order');
});

test('privacy: the public view is identical whoever the aliens are, and private views never leak roles or the other prompt', () => {
  const n = start(8, { order: ['answer', 'rating', 'pick', 'choice', 'draw', 'answer', 'rating'] }), s = inner(n);
  const swap = () => { const real = s.aliens; s.aliens = crew(n).slice(0, real.length); const view = JSON.stringify(n.view()); s.aliens = real; return view; };
  const check = () => {
    assert.equal(JSON.stringify(n.view()), swap(), `public view in ${pub(n).phase} depends on who the aliens are`);
    const t = s.tests.at(-1);
    for (const id of crew(n)) {
      assert.deepEqual(me(n, id).allies, []);
      for (const alien of s.aliens) assert.ok(!JSON.stringify(me(n, id)).includes(`"${alien}"`), `${id} sees an alien id`);
      if (t) n.assertHiddenFrom(id, t.pair.alien);
    }
    for (const alien of s.aliens) if (t && !t.hacked) n.assertHiddenFrom(alien, t.pair.crew);
  };
  check();
  for (let i = 0; i < 3; i++) {
    at(n, 'test'); check();
    answerAll(n); check();
    at(n, 'results'); check();
    at(n, 'discuss'); check();
    for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
    n.until(() => pub(n).phase === 'test');
  }
  // A push names suspects publicly but never says who is an alien until the doors open.
  at(n, 'test'); answerAll(n); at(n, 'discuss');
  push(n, crew(n)[0]!, crew(n)[1]!); check();
  voteAll(n, 'abort'); at(n, 'verdict'); check();
  assert.equal(pub(n).verdict!.role, undefined, 'the role stays hidden on an abort');
});

test('hack and scan: aliens share one hack that reveals the crew prompt; a crew scan shows the same line; the TV never hears about it', () => {
  const n = start(7), s = inner(n), [a1, a2] = s.aliens, human = crew(n)[0]!;
  at(n, 'test');
  const cues = n.view().cues.length, before = JSON.stringify(pub(n)), pair = cur(n).pair;
  assert.equal(me(n, a1!).scan, true); assert.equal(me(n, human).scan, true);
  n.send(a1!, { turn: pub(n).turn, k: 'scan' });
  for (const alien of [a1!, a2!]) { assert.equal(me(n, alien).intercepted, pair.crew); assert.equal(me(n, alien).scan, false); }
  rejects(n.trySend(a2!, { turn: pub(n).turn, k: 'scan' }), /used up/);
  n.send(human, { turn: pub(n).turn, k: 'scan' });
  assert.equal(me(n, human).intercepted, pair.crew, 'a crew scan looks exactly like a hack'); assert.equal(me(n, human).scan, false);
  assert.equal(me(n, crew(n)[1]!).scan, true, 'each crewmate has their own scan');
  rejects(n.trySend(human, { turn: pub(n).turn, k: 'scan' }), /used up/);
  assert.equal(JSON.stringify(pub(n)), before, 'scans change nothing public');
  assert.equal(n.view().cues.length, cues, 'scans are silent on the TV');
  answerAll(n); at(n, 'discuss');
  rejects(n.trySend(crew(n)[1]!, { turn: pub(n).turn, k: 'scan' }), /during a test/);
  for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
  at(n, 'test');
  assert.equal(me(n, a1!).intercepted, undefined, 'the hack lasts one test');
  assert.equal(me(n, human).intercepted, undefined);
});

test('scoring: catching the alien pays the crew and the pusher; the result names the hero', () => {
  const n = start(5), alien = inner(n).aliens[0]!, team = crew(n), [hero] = team;
  toDiscuss(n);
  push(n, hero!, alien);
  assert.equal(pub(n).phase, 'vote');
  assert.deepEqual(pub(n).ballot, { by: hero, suspect: alien, saves: 1 });
  assert.equal(me(n, hero!).vote, 'airlock', 'the pusher votes airlock');
  rejects(n.trySend(alien, { turn: pub(n).turn, k: 'vote', vote: 'abort' }), /in the airlock/);
  voteAll(n, 'airlock');
  n.advance(1300);
  assert.equal(pub(n).phase, 'verdict');
  const v = pub(n).verdict!;
  assert.equal(v.eject, true); assert.equal(v.role, 'alien');
  assert.deepEqual(v.votes.map(x => x.player), n.ids.filter(id => id !== alien));
  at(n, 'end');
  const e = pub(n).end!;
  assert.deepEqual({ winner: e.winner, how: e.how, by: e.by, survived: e.survived }, { winner: 'crew', how: 'caught', by: hero, survived: 1 });
  n.until(() => n.state.phase === 'podium');
  const result = n.state.podium!.result;
  for (const id of team) assert.equal(result.scores[id], id === hero ? 1500 : 1000);
  assert.equal(result.scores[alien], 0);
  assert.deepEqual(result.winners, team, 'the whole crew wins, even with different scores');
  assert.equal(result.headline, 'The alien got spaced!');
  assert.ok(result.awards?.some(a => a.title === 'Airlock Hero' && a.playerId === hero));
});

test('scoring: spacing a human ends it at once; the aliens bank 500 per test survived, an alien pusher +500', () => {
  const n = start(4), alien = inner(n).aliens[0]!, [victim, other] = crew(n);
  toDiscuss(n);
  for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
  toDiscuss(n);
  push(n, alien, victim!);
  voteAll(n, 'airlock');
  at(n, 'verdict');
  assert.equal(pub(n).verdict!.role, 'crew');
  at(n, 'end');
  assert.deepEqual([pub(n).end!.winner, pub(n).end!.how, pub(n).end!.survived], ['aliens', 'framed', 2]);
  n.until(() => n.state.phase === 'podium');
  const result = n.state.podium!.result;
  assert.equal(result.scores[alien], 1000 + 2 * 500 + 500);
  assert.equal(result.scores[other!], 0);
  assert.deepEqual(result.winners, [alien]);
  assert.equal(result.headline, 'A human got spaced. Aliens win!');
  assert.ok(result.awards?.some(a => a.title === 'Master Framer' && a.playerId === alien));
});

test('two aliens: one suspect per push, two ABORTs save them, the hunt goes on until both are out', () => {
  const n = start(7, { order: ['answer', 'rating', 'pick', 'choice', 'draw', 'answer', 'rating'] }), [a1, a2] = inner(n).aliens, [c1, c2, c3] = crew(n);
  toDiscuss(n);
  rejects(n.trySend(c1!, { turn: pub(n).turn, k: 'push', suspects: [a1, a2] }), /Unknown field/);
  // The other alien's lone ABORT can't veto: it takes two while two aliens are aboard.
  push(n, c1!, a1!);
  assert.equal(pub(n).ballot!.saves, 2);
  rejects(n.trySend(a2!, { turn: pub(n).turn, k: 'vote', vote: 'maybe' }), /airlock or abort/);
  voteAll(n, id => id === a2 ? 'abort' : 'airlock');
  at(n, 'verdict');
  assert.deepEqual([pub(n).verdict!.eject, pub(n).verdict!.role], [true, 'alien']);
  at(n, 'discuss');
  assert.deepEqual(pub(n).out, [a1], 'the spaced alien is out and the discussion resumes');
  assert.ok(pub(n).deadline - pub(n).at >= MIN_RESUME_MS);
  rejects(n.trySend(a1!, { turn: pub(n).turn, k: 'ready' }), /spaced/);
  rejects(n.trySend(c2!, { turn: pub(n).turn, k: 'push', suspect: a1 }), /still aboard/);
  // With one alien left, a single ABORT saves the suspect again.
  push(n, c2!, a2!);
  assert.equal(pub(n).ballot!.saves, 1);
  voteAll(n, id => id === c3 ? 'abort' : 'airlock');
  at(n, 'verdict'); assert.equal(pub(n).verdict!.eject, false);
  at(n, 'discuss');
  for (const id of n.ids.filter(id => id !== a1)) n.send(id, { turn: pub(n).turn, k: 'ready' });
  // The next test skips the spaced alien: no answer slot, never waited for.
  at(n, 'test'); answerAll(n, n.ids.filter(id => id !== a1)); at(n, 'results');
  assert.ok(!pub(n).board!.answers.some(a => a.player === a1));
  at(n, 'discuss');
  push(n, c3!, a2!); voteAll(n, 'airlock');
  at(n, 'end');
  assert.deepEqual([pub(n).end!.winner, pub(n).end!.how, pub(n).end!.heroes], ['crew', 'caught', [c1, c3]]);
  n.until(() => n.state.phase === 'podium');
  const result = n.state.podium!.result;
  assert.equal(result.headline, 'Both aliens got spaced!');
  assert.deepEqual([result.scores[c1!], result.scores[c3!], result.scores[c2!], result.scores[a1!]], [1500, 1500, 1000, 0]);
  assert.deepEqual(result.awards?.filter(a => a.title === 'Airlock Hero').map(a => a.playerId), [c1, c3]);
});

test('two aliens: spacing a human after an alien still hands the aliens the win, spaced alien included', () => {
  const n = start(8), [a1, a2] = inner(n).aliens, [c1, c2] = crew(n);
  toDiscuss(n);
  push(n, c1!, a1!); voteAll(n, id => id === a2 ? 'abort' : 'airlock'); at(n, 'discuss');
  push(n, a2!, c2!); voteAll(n, 'airlock');
  at(n, 'end');
  assert.deepEqual([pub(n).end!.winner, pub(n).end!.how, pub(n).end!.by], ['aliens', 'framed', a2]);
  assert.equal(pub(n).scores[a1!], 1500); assert.equal(pub(n).scores[a2!], 2000); assert.equal(pub(n).scores[c1!], 0);
});

test('reaching Earth: seven tests without an ejection is an alien win worth 4500', () => {
  const n = start(6), alien = inner(n).aliens[0]!;
  for (let i = 1; i <= TESTS; i++) {
    toDiscuss(n);
    assert.equal(pub(n).test, i);
    n.advance(1500);
    for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
    n.advance(100);
  }
  assert.equal(pub(n).phase, 'end');
  assert.deepEqual([pub(n).end!.how, pub(n).end!.survived], ['arrived', TESTS]);
  n.until(() => n.state.phase === 'podium');
  const result = n.state.podium!.result;
  assert.equal(result.scores[alien], 4500); assert.equal(result.headline, 'The alien reached Earth!');
  assert.ok(result.awards?.some(a => a.title === 'Perfect Disguise' && a.playerId === alien));
});

test('aborts: one abort or a missing vote saves the suspects, the discussion resumes, and each player pushes at most twice', () => {
  const n = start(6), [p1, p2, p3] = crew(n);
  toDiscuss(n);
  n.advance(20_000);
  push(n, p1!, p2!);
  voteAll(n, id => id === p3 ? 'abort' : 'airlock');
  at(n, 'verdict');
  assert.equal(pub(n).verdict!.eject, false);
  at(n, 'discuss');
  assert.ok(pub(n).deadline - pub(n).at >= MIN_RESUME_MS, 'a failed push hands back at least ten seconds');
  assert.equal(pub(n).pushes[p1!], 1);
  rejects(n.trySend(p1!, { turn: pub(n).turn, k: 'push', suspect: p1 }), /yourself/);
  push(n, p1!, p3!);
  // Nobody else votes: missing votes count as abort at the buzzer.
  at(n, 'verdict');
  const v = pub(n).verdict!;
  assert.equal(v.eject, false);
  assert.ok(v.votes.filter(x => x.player !== p1).every(x => x.vote === 'abort' && x.auto));
  at(n, 'discuss');
  assert.equal(pub(n).pushes[p1!], 0);
  rejects(n.trySend(p1!, { turn: pub(n).turn, k: 'push', suspect: p2 }), /both of your button pushes/);
  n.until(() => n.state.phase === 'podium' || pub(n).phase === 'test');
  assert.equal(pub(n).test, 2, 'the discussion timed out into the next test');
});

test('validation: stale, duplicate and out-of-phase actions; strict fields and values per test kind', () => {
  const n = start(5, { order: ['answer', 'rating', 'pick', 'choice', 'draw', 'answer', 'rating'] }), [p0, p1] = n.ids;
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'answer', value: 'early' }), /No test/);
  at(n, 'test');
  const turn = pub(n).turn;
  rejects(n.trySend(p0!, { turn: 'old', k: 'answer', value: 'hi' }), /moved on/);
  rejects(n.trySend(p0!, { turn, k: 'answer', value: '   ' }), /Type an answer/);
  rejects(n.trySend(p0!, { turn, k: 'answer', value: 'x'.repeat(MAX_ANSWER + 1) }), /under 40/);
  rejects(n.trySend(p0!, { turn, k: 'answer', value: 'hi', extra: 1 }), /Unknown field/);
  rejects(n.trySend(p0!, { turn, k: 'draw', drawing: DOODLE }), /not this test/);
  rejects(n.trySend(p0!, { turn, k: 'dance' }), /Unknown move/);
  rejects(n.trySend(p0!, { turn, k: 'ready' }), /Talk it over/);
  rejects(n.trySend(p0!, { turn, k: 'push', suspect: p1 }), /only works during a discussion/);
  n.send(p0!, { turn, k: 'answer', value: '  Tabs\tand‮new\nlines ' });
  assert.equal(me(n, p0!).answer, 'Tabs and new lines');
  rejects(n.trySend(p0!, { turn, k: 'answer', value: 'again' }), /already locked/);
  answerAll(n, n.ids.slice(1)); at(n, 'discuss');
  n.send(p0!, { turn: pub(n).turn, k: 'ready' });
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'ready' }), /already ready/);
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'push', suspect: [p1] }), /still aboard/);
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'push', suspect: 'nobody' }), /still aboard/);
  for (const id of n.ids.slice(1)) n.send(id, { turn: pub(n).turn, k: 'ready' });
  at(n, 'test');
  for (const value of [0, 11, 2.5, '7']) rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'answer', value }), /whole number from 1 to 10/);
  n.send(p0!, { turn: pub(n).turn, k: 'answer', value: 10 });
  answerAll(n, n.ids.slice(1)); at(n, 'discuss');
  for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
  at(n, 'test');
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'answer', value: 'p99' }), /Pick a crewmate/);
  n.send(p0!, { turn: pub(n).turn, k: 'answer', value: p0 });
  answerAll(n, n.ids.slice(1)); at(n, 'discuss');
  for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
  at(n, 'test');
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'answer', value: 4 }), /whole number from 0 to 3/);
  n.send(p0!, { turn: pub(n).turn, k: 'answer', value: 3 });
  answerAll(n, n.ids.slice(1)); at(n, 'discuss');
  for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
  at(n, 'test');
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'draw', drawing: { strokes: [] } }), /Draw something/);
  rejects(n.trySend(p0!, { turn: pub(n).turn, k: 'answer', value: 'a cat' }), /not this test/);
  rejects(n.trySend('p99', { turn: pub(n).turn, k: 'draw', drawing: DOODLE }), /seated|watching/);
});

test('missing answers and disconnects: nobody stalls the ship; absent voters are not counted', () => {
  const n = start(6, { order: ['answer', 'rating', 'pick', 'choice', 'draw', 'answer', 'rating'] }), [p0, p1, p2] = crew(n), off = n.ids.at(-1)!;
  at(n, 'test');
  n.connect(off, false);
  answerAll(n, n.ids.filter(id => id !== off && id !== p0));
  n.advance(1600);
  assert.equal(pub(n).phase, 'test', 'still waiting for an online player');
  n.until(() => pub(n).phase === 'results');
  const board = pub(n).board!;
  assert.deepEqual(board.answers.find(a => a.player === p0), { player: p0 }, 'no answer, no value');
  assert.deepEqual(board.answers.find(a => a.player === off), { player: off });
  at(n, 'discuss');
  for (const id of n.ids.filter(id => id !== off)) n.send(id, { turn: pub(n).turn, k: 'ready' });
  n.advance(1600);
  assert.equal(pub(n).phase, 'test', 'an offline player is not waited for in the discussion');
  answerAll(n, n.ids.filter(id => id !== off)); at(n, 'discuss');
  push(n, p1!, p2!);
  for (const id of n.ids) if (![p1, p2, off].includes(id)) n.send(id, { turn: pub(n).turn, k: 'vote', vote: 'abort' });
  n.advance(1300);
  assert.equal(pub(n).phase, 'verdict', 'the offline voter is not waited for');
  assert.ok(!pub(n).verdict!.votes.some(x => x.player === off), 'nor counted');
  n.connect(off, true);
  assert.equal(me(n, off).turn, pub(n).turn);
});

test('drawings: published to media only once the answers flip, removed for the next test', () => {
  const n = start(4, { order: ['draw', 'answer', 'rating', 'pick', 'choice', 'answer', 'rating'] });
  at(n, 'test');
  n.send('p0', { turn: pub(n).turn, k: 'draw', drawing: DOODLE });
  assert.equal(me(n, 'p0').answer, artKey(1, 0));
  assert.deepEqual(Object.keys(n.view().media).filter(k => k.startsWith('al-')), [], 'no drawing before the reveal');
  answerAll(n, n.ids.slice(1));
  at(n, 'results');
  assert.deepEqual(n.view().media[artKey(1, 0)], DOODLE);
  assert.equal(pub(n).board!.answers[0]!.value, artKey(1, 0));
  at(n, 'discuss');
  for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'ready' });
  at(n, 'test');
  assert.deepEqual(Object.keys(n.view().media).filter(k => k.startsWith('al-')), []);
});

test('timers follow the pace setting; the family filter keeps adult pairs out', () => {
  const n = start(4, { settings: { timers: 'speedy' }, order: ['answer', 'rating', 'pick', 'choice', 'draw', 'answer', 'rating'] });
  at(n, 'test');
  assert.equal(pub(n).deadline - pub(n).at, Math.round(35_000 * .7));
  let seen = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const family = start(10, { seed }), open = start(10, { seed, settings: { family: false } });
    const dealt = (night: Night) => KINDS.flatMap(k => inner(night).decks[k]);
    assert.ok(dealt(family).every(p => !p.adult), `seed ${seed}`);
    seen += dealt(open).filter(p => p.adult).length;
  }
  assert.ok(seen > 0, 'adult pairs are in the pool with family mode off');
});

test('night memory: a replay in the same night deals none of the first game’s tests', async () => {
  const n = start(4, { seed: 9 }), one = inner(n);
  await n.playMini();
  const first = one.tests.map(t => pairKey(t.pair));
  assert.ok(first.every(k => n.state.used.airlock!.includes(k)), 'every dealt pair is marked');
  n.startMini('airlock');
  const two = inner(n);
  await n.playMini();
  const second = two.tests.map(t => pairKey(t.pair));
  assert.deepEqual(second.filter(k => first.includes(k)), []);
});

/**
 * Table model for balance (also in output/hijinks/gaps/games/airlock-sim.ts): each test an answer "looks off" with a chance
 * (aliens 45 %, humans 15 %), every crewmate perceives it with personal noise; the most confident crewmate pushes once their
 * top suspect clearly stands out (bolder near Earth); an alien frames the most suspected human now and then; crew vote
 * AIRLOCK on a suspect near the top of their own list; aliens always protect each other; a visible ABORT looks suspicious.
 */
function simulate(players: number, seed: number) {
  const rng = { seed: mix(seed) }, r = () => random(rng), gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()), used = new Set<string>();
  let now = 1000;
  const api: MiniApi = {
    get now() { return now; }, random: r, shuffle: items => shuffle(rng, items), pick: (items, n) => pickN(rng, items, n),
    seconds: b => b * 1000, say: () => 0, sfx() {}, music() {}, speak() {}, media: { put() {}, remove() {} },
    settings: { family: true, timers: 'standard', readAloud: false, tutorials: true, startWith: '' }, used: { has: k => used.has(k), add: k => void used.add(k) },
  };
  const roster: PackPlayer[] = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff', avatar: i, connected: true }));
  const s = server.create(roster, api), { ids, aliens } = s, team = ids.filter(id => !aliens.includes(id));
  const susp = Object.fromEntries(ids.map(i => [i, Object.fromEntries(ids.map(p => [p, 0]))])) as Record<string, Record<string, number>>;
  const act = (id: string, a: Record<string, unknown>) => { try { server.action(s, id, { turn: s.turn, ...a }, api); return true; } catch { return false; } };
  const alive = () => ids.filter(id => !s.out.includes(id)), rank = (i: string) => alive().filter(p => p !== i).sort((a, b) => susp[i]![b]! - susp[i]![a]!);
  const avg = (p: string) => team.filter(i => i !== p).reduce((t, i) => t + susp[i]![p]!, 0);
  let pushes = 0, seen = 0;
  while (!server.result(s)) {
    const t = s.tests.length;
    if (t !== seen) { seen = t; pushes = 0; }
    if (s.phase === 'test') {
      const kind = s.tests.at(-1)!.pair.kind;
      for (const id of alive()) act(id, kind === 'draw' ? { k: 'draw', drawing: DOODLE } : { k: 'answer', value: kind === 'answer' ? 'toast' : kind === 'pick' ? id : 1 });
      for (const p of alive()) { const off = r() < (aliens.includes(p) ? .45 : .15) ? 1 : 0; for (const i of team) if (i !== p) susp[i]![p]! += off + gauss() * .6; }
    } else if (s.phase === 'discuss') {
      let pushed = false;
      if (pushes < 2) {
        const best = team.filter(i => alive().includes(i) && s.pushes[i]! < 2).map(i => { const list = rank(i); return { i, top: list[0]!, z: susp[i]![list[0]!]! - list.reduce((x, p) => x + susp[i]![p]!, 0) / list.length }; }).sort((a, b) => b.z - a.z)[0];
        if (best && t >= 2 && best.z >= 2.2 - .25 * (t - 1)) pushed = act(best.i, { k: 'push', suspect: best.top });
        const framer = aliens.find(a => alive().includes(a) && s.pushes[a]! < 2);
        if (!pushed && framer && r() < .12) pushed = act(framer, { k: 'push', suspect: team.filter(c => alive().includes(c)).sort((a, b) => avg(b) - avg(a))[0] });
      }
      if (pushed) { pushes++; continue; }
      for (const id of ids) act(id, { k: 'ready' });
    } else if (s.phase === 'vote') {
      const b = s.ballot!;
      for (const id of alive()) if (id !== b.suspect) act(id, { k: 'vote', vote: aliens.includes(id) ? (aliens.includes(b.suspect) ? 'abort' : 'airlock')
        : rank(id).slice(0, b.saves + 1 + (t >= 6 ? 1 : 0)).includes(b.suspect) ? 'airlock' : 'abort' });
    } else if (s.phase === 'verdict') {
      const b = s.ballot!;
      now = s.deadline; server.tick(s, api);
      for (const [id, v] of Object.entries(b.votes)) if (v === 'abort') for (const i of team) if (i !== id) susp[i]![id]! += b.eject && aliens.includes(b.suspect) ? 1.5 : .4;
      continue;
    }
    now = Math.max(now + 1600, ['brief', 'results', 'end'].includes(s.phase) ? s.deadline : 0); server.tick(s, api);
  }
  return s.ending!;
}

test('balance: seeded table-model games give the crew a fair shot with two aliens, as with one', t => {
  const rate = (players: number) => Array.from({ length: 300 }, (_, k) => simulate(players, 1000 + k)).filter(e => e.winner === 'crew').length / 300;
  const rates = Object.fromEntries([5, 7, 10].map(p => [p, rate(p)]));
  t.diagnostic(`crew win rate: ${Object.entries(rates).map(([p, x]) => `${p}p ${Math.round(x * 100)}%`).join(', ')}`);
  for (const p of [7, 10]) assert.ok(rates[p]! >= .25 && rates[p]! <= .6, `${p} players: crew win ${rates[p]}`);
  assert.ok(Math.abs(rates[7]! - rates[5]!) < .15, 'two aliens at 7 play like one alien at 5');
});
