import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/quip-clash/narration';
import { ADULT, FAMILY, FINAL_ADULT, FINAL_FAMILY, SAFETY } from '../src/minis/quip-clash/content.server';
import type { QuipState } from '../src/minis/quip-clash/server';
import { MAX_ANSWER, RESULT, type QuipPrivate, type QuipPublic } from '../src/minis/quip-clash/types';

const pub = (n: Night) => n.mini<QuipPublic>();
const me = (n: Night, id: string) => n.miniMe<QuipPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as QuipState;
const duel = (n: Night) => inner(n).duels[inner(n).index]!;
const authors = (n: Night) => duel(n).sides.map(q => q.author);
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: QuipPublic['phase']) => n.until(() => pub(n)?.phase === phase);

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 11, ...options });
  n.startMini('quip-clash');
  return n;
}
/** Every listed seat answers its open prompts with a unique, traceable text. */
function writeAll(n: Night, ids = n.ids) {
  for (const id of ids) for (const p of me(n, id).prompts) if (p.answer === undefined) n.send(id, { turn: pub(n).turn, k: 'answer', slot: p.slot, text: `${id} says ${p.slot} in round ${pub(n).round}` });
}
/** Seats other than the authors vote for `side` (or the given per-seat sides). */
function voteAll(n: Night, side: number | ((id: string) => number)) {
  for (const id of n.ids) if (!authors(n).includes(id)) n.send(id, { turn: pub(n).turn, k: 'vote', side: typeof side === 'number' ? side : side(id) });
}

test('content banks, narration budget and catalog entry', () => {
  for (const [bank, min] of [[FAMILY, 200], [ADULT, 60], [SAFETY, 50], [FINAL_FAMILY, 25], [FINAL_ADULT, 8]] as const) {
    assert.ok(bank.length >= min, `bank of ${bank.length} < ${min}`);
    for (const line of bank) assert.equal(line, line.trim().replace(/\s+/g, ' '), line);
  }
  const all = [...FAMILY, ...ADULT, ...FINAL_FAMILY, ...FINAL_ADULT];
  assert.equal(new Set(all.map(p => p.toLowerCase())).size, all.length, 'prompts are unique across banks');
  assert.equal(new Set(SAFETY).size, SAFETY.length);
  for (const quip of SAFETY) assert.ok(quip.length <= MAX_ANSWER, quip);
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^quip-clash\.[a-z0-9.-]+$/);
  for (const line of miniInfo('quip-clash')!.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 3, 4, 7 and 10 players reach a sane result', async () => {
  for (const players of [3, 4, 7, 10]) {
    const n = start(players, { seed: players }), begin = n.now;
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 25 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.ok(top > 0);
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    assert.ok(n.now - begin < 15 * 60_000, 'fits the time budget even with bots');
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('pairing: every player gets two prompts with two rivals; every prompt is shared by exactly two (odd and even rosters)', () => {
  for (const players of [3, 4, 5, 9, 10]) {
    const n = start(players);
    for (const round of [1, 2]) {
      n.until(() => pub(n).phase === 'write' && pub(n).round === round);
      const duels = inner(n).duels;
      assert.equal(duels.length, players);
      assert.equal(new Set(duels.map(d => d.prompt)).size, players);
      for (const d of duels) assert.notEqual(d.sides[0].author, d.sides[1].author);
      for (const id of n.ids) {
        const mine = duels.filter(d => d.sides.some(q => q.author === id));
        assert.equal(mine.length, 2, `${id} in round ${round}`);
        assert.equal(me(n, id).prompts.length, 2);
        assert.deepEqual(me(n, id).prompts.map(p => p.prompt), mine.map(d => d.prompt));
        if (players > 3) assert.notEqual(mine[0]!.sides.find(q => q.author !== id)!.author, mine[1]!.sides.find(q => q.author !== id)!.author, 'two different rivals');
      }
      if (round === 1) at(n, 'scores');
    }
  }
});

test('scoring: votes × 100 × round, winner bonus, quipwipe, ties, safety at half points', () => {
  const n = start(4);
  writeAll(n);
  at(n, 'show');
  rejects(n.trySend(n.ids.find(id => !authors(n).includes(id))!, { turn: pub(n).turn, k: 'vote', side: 0 }), /moment/);
  at(n, 'vote');
  const [a0, a1] = authors(n);
  voteAll(n, 0);
  at(n, 'result');
  let r = pub(n).match!.result!;
  assert.equal(r.wipe, true); assert.equal(r.winner, 0);
  assert.deepEqual(r.sides.map(s => s.points), [2 * 100 + 100 + 250, 0]);
  assert.deepEqual(r.sides.map(s => s.author), [a0, a1]);
  assert.equal(r.sides[0]!.voters.length, 2);
  assert.equal(pub(n).scores[a0!], 550);
  n.advance(RESULT.end + RESULT.bonus);

  at(n, 'vote');
  const voters = n.ids.filter(id => !authors(n).includes(id));
  voteAll(n, id => voters.indexOf(id));
  at(n, 'result');
  r = pub(n).match!.result!;
  assert.equal(r.winner, null); assert.equal(r.wipe, undefined);
  assert.deepEqual(r.sides.map(s => s.points), [100, 100], 'a tie scores votes only');

  // Round 2: a quipwipe on a safety quip doubles, then halves.
  n.until(() => pub(n).phase === 'write' && pub(n).round === 2);
  for (const id of n.ids) for (const p of me(n, id).prompts) n.send(id, { turn: pub(n).turn, k: 'safety', slot: p.slot });
  assert.ok(me(n, 'p0').prompts.every(p => p.safety && SAFETY.includes(p.answer!)));
  at(n, 'vote');
  voteAll(n, 1);
  at(n, 'result');
  r = pub(n).match!.result!;
  assert.deepEqual(r.sides.map(s => s.points), [0, (2 * 200 + 200 + 500) / 2]);
  assert.equal(r.sides[1]!.safety, true);
});

test('jinx: identical answers skip the vote and score nothing', () => {
  const n = start(4);
  const first = inner(n).duels[0]!, turn = pub(n).turn;
  const slotOf = (id: string) => me(n, id).prompts.findIndex(p => p.prompt === first.prompt);
  n.send(first.sides[0].author, { turn, k: 'answer', slot: slotOf(first.sides[0].author), text: 'A Very Tired Goose!' });
  n.send(first.sides[1].author, { turn, k: 'answer', slot: slotOf(first.sides[1].author), text: 'a very tired goose' });
  writeAll(n);
  at(n, 'show');
  n.until(() => pub(n).phase !== 'show');
  assert.equal(pub(n).phase, 'result', 'no vote phase');
  const r = pub(n).match!.result!;
  assert.equal(r.jinx, true); assert.deepEqual(r.sides.map(s => s.points), [0, 0]);
});

test('missing answers become house safety quips; timers follow the pace setting', () => {
  const n = start(3, { settings: { timers: 'speedy' } });
  assert.equal(pub(n).deadline - pub(n).at, 52_500);
  n.send('p0', { turn: pub(n).turn, k: 'answer', slot: 0, text: 'Only one from me' });
  at(n, 'show');
  const answers = inner(n).duels.flatMap(d => d.sides);
  assert.equal(answers.filter(q => !q.safety).length, 1);
  for (const q of answers.filter(q => q.safety)) assert.ok(SAFETY.includes(q.text!));
  assert.equal(new Set(answers.map(q => q.text)).size, answers.length, 'house answers never repeat');
});

test('disconnects: absent writers and voters are not waited for', () => {
  const n = start(5);
  n.connect('p4', false);
  writeAll(n, n.ids.filter(id => id !== 'p4'));
  n.advance(1600);
  assert.equal(pub(n).phase, 'show', 'advanced without p4 after the readable minimum');
  assert.ok(inner(n).duels.flatMap(d => d.sides).filter(q => q.author === 'p4').every(q => q.safety));
  n.until(() => pub(n).phase === 'vote' && !authors(n).includes('p4'));
  const deadline = pub(n).deadline;
  for (const id of n.ids) if (id !== 'p4' && !authors(n).includes(id)) n.send(id, { turn: pub(n).turn, k: 'vote', side: 0 });
  n.advance(1300);
  assert.equal(pub(n).phase, 'result');
  assert.ok(n.now < deadline);
  n.connect('p4', true);
  assert.equal(me(n, 'p4').turn, pub(n).turn);
});

test('validation: stale turns, ownership, duplicates, lengths and strict fields', () => {
  const n = start(4), turn = pub(n).turn;
  rejects(n.trySend('p0', { turn: 'old', k: 'answer', slot: 0, text: 'hi' }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 2, text: 'hi' }), /whole number/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: '   ' }), /Type an answer/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: 'x'.repeat(MAX_ANSWER + 1) }), /under 80/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: 'hi', extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  rejects(n.trySend('p0', { turn, k: 'vote', side: 0 }), /moment/);
  n.send('p0', { turn, k: 'answer', slot: 0, text: '  Tabs\tand‮new\nlines  ' });
  assert.equal(me(n, 'p0').prompts[0]!.answer, 'Tabs and new lines');
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: 'again' }), /already locked/);
  rejects(n.trySend('p0', { turn, k: 'safety', slot: 0 }), /already locked/);
  writeAll(n);
  at(n, 'vote');
  const [author] = authors(n), voter = n.ids.find(id => !authors(n).includes(id))!, vote = pub(n).turn;
  rejects(n.trySend(author!, { turn: vote, k: 'vote', side: 1 }), /own matchup/);
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 2 }), /whole number/);
  n.send(voter, { turn: vote, k: 'vote', side: 1 });
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /already in/);
  assert.equal(me(n, voter).side, 1); assert.equal(me(n, voter).role, 'voter'); assert.equal(me(n, author!).role, 'author');
  at(n, 'result');
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /moved on/);
});

test('privacy: answers stay private while writing; authors stay hidden until the result', () => {
  const n = start(4);
  n.send('p1', { turn: pub(n).turn, k: 'answer', slot: 0, text: 'Secret sauce answer' });
  n.assertHidden('Secret sauce answer');
  for (const id of ['p0', 'p2', 'p3']) n.assertHiddenFrom(id, 'Secret sauce answer');
  assert.deepEqual(pub(n).done, []);
  writeAll(n);
  assert.deepEqual(pub(n).done, n.ids);
  for (const phase of ['show', 'vote'] as const) {
    at(n, phase);
    const match = JSON.stringify(pub(n).match);
    for (const id of n.ids) assert.ok(!match.includes(`"${id}"`), `${phase} match leaks ${id}`);
    assert.deepEqual(pub(n).done, [], 'no voter list during matchups');
  }
  at(n, 'result');
  assert.deepEqual(pub(n).match!.result!.sides.map(s => s.author), authors(n));
  n.until(() => pub(n).phase === 'final-write');
  const final = pub(n).final!;
  assert.deepEqual(final.entries, []);
  writeAll(n);
  at(n, 'final-vote');
  const entries = JSON.stringify(pub(n).final);
  for (const id of n.ids) assert.ok(!entries.includes(`"${id}"`), `final entries leak ${id}`);
});

test('Last Laugh: one prompt each, three stackable votes, no self votes, triple scoring', () => {
  const n = start(4);
  n.until(() => pub(n).phase === 'final-write');
  for (const id of n.ids) assert.equal(me(n, id).prompts.length, 1);
  assert.equal(me(n, 'p0').prompts[0]!.prompt, pub(n).final!.prompt);
  const before = { ...pub(n).scores };
  writeAll(n, ['p0', 'p1', 'p2']);
  n.connect('p3', false);
  n.advance(1600);
  assert.equal(pub(n).phase, 'final-vote');
  assert.equal(pub(n).final!.entries.length, 3, 'offline players without an answer sit out');
  const turn = pub(n).turn, mine = (id: string) => me(n, id).mine!, p0 = mine('p0');
  rejects(n.trySend('p1', { turn, k: 'picks', picks: [p0, p0] }), /all 3/);
  rejects(n.trySend('p1', { turn, k: 'picks', picks: [p0, p0, mine('p1')] }), /yourself/);
  rejects(n.trySend('p1', { turn, k: 'picks', picks: [p0, p0, 'e9'] }), /not on the board/);
  n.send('p1', { turn, k: 'picks', picks: [p0, p0, p0] });
  rejects(n.trySend('p1', { turn, k: 'picks', picks: [p0, p0, p0] }), /already in/);
  assert.deepEqual(me(n, 'p1').picks, [p0, p0, p0]);
  n.send('p2', { turn, k: 'picks', picks: [p0, mine('p1'), mine('p1')] });
  n.send('p0', { turn, k: 'picks', picks: [mine('p1'), mine('p2'), mine('p2')] });
  n.advance(1500);
  assert.equal(pub(n).phase, 'final-result');
  const result = pub(n).final!.result!;
  assert.deepEqual(result.winners, ['p0']);
  assert.deepEqual(result.entries.map(e => e.votes), [2, 3, 4], 'revealed fewest votes first');
  const top = result.entries.at(-1)!;
  assert.equal(top.author, 'p0'); assert.equal(top.points, 4 * 300 + 300); assert.deepEqual(top.voters, ['p1', 'p2']);
  assert.equal(pub(n).scores.p0, before.p0! + 1500);
  n.until(() => n.state.phase === 'podium');
  const podium = n.state.podium!.result;
  assert.ok(podium.awards?.some(a => a.title === 'Got the Last Laugh' && a.playerId === 'p0'));
});

test('family filter: adult prompts only appear when family mode is off', () => {
  const adult = new Set([...ADULT, ...FINAL_ADULT]);
  let seen = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const family = start(10, { seed }), prompts = [...inner(family).duels.map(d => d.prompt), ...inner(family).prompts, inner(family).finalPrompt];
    assert.ok(prompts.every(p => !adult.has(p)), `seed ${seed}`);
    const open = start(10, { seed, settings: { family: false } }), mixed = [...inner(open).duels.map(d => d.prompt), ...inner(open).prompts];
    seen += mixed.filter(p => adult.has(p)).length;
  }
  assert.ok(seen > 0, 'adult prompts are in the pool with family mode off');
});

test('night memory: a replay in the same night deals none of the first game’s prompts', async () => {
  const n = start(4, { seed: 8 }), dealt = () => new Set([...inner(n).duels.map(d => d.prompt), ...inner(n).prompts, inner(n).finalPrompt]);
  const first = dealt();
  await n.playMini();
  n.startMini('quip-clash');
  const second = dealt();
  assert.equal(second.size, 9);
  assert.deepEqual([...second].filter(p => first.has(p)), []);
  assert.ok([...first, ...second].every(p => n.state.used['quip-clash']!.includes(p)), 'every dealt prompt is marked');
});
