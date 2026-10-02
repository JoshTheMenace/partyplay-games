import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/bracket-brawl/narration';
import { BLIND, CATEGORIES, GENERIC, SMACKDOWN, STANDARD } from '../src/minis/bracket-brawl/content.server';
import type { BrawlState } from '../src/minis/bracket-brawl/server';
import { MAX_ANSWER, PTS, type BrawlPrivate, type BrawlPublic } from '../src/minis/bracket-brawl/types';

const pub = (n: Night) => n.mini<BrawlPublic>();
const me = (n: Night, id: string) => n.miniMe<BrawlPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as BrawlState;
const live = (n: Night) => inner(n).bouts[inner(n).round - 1]![inner(n).index]!;
const by = (n: Night, id: string | null) => inner(n).entries.find(e => e.id === id)!.by;
const authors = (n: Night) => live(n).sides.map(id => by(n, id));
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: BrawlPublic['phase']) => n.until(() => pub(n)?.phase === phase);

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('bracket-brawl');
  return n;
}
/** Every listed seat fills its open answer slots with a unique, traceable text. */
function writeAll(n: Night, ids = n.ids) {
  for (const id of ids) for (const a of me(n, id).answers) if (a.text === undefined) n.send(id, { turn: pub(n).turn, k: 'answer', slot: a.slot, text: `${id} says ${a.slot} in ${pub(n).bracket}` });
}
/** Connected seats that wrote neither side vote for `side` (or a per-seat side). */
function voteAll(n: Night, side: 0 | 1 | ((id: string, i: number) => 0 | 1)) {
  const voters = n.ids.filter(id => n.state.players.find(p => p.id === id)!.connected && !authors(n).includes(id));
  voters.forEach((id, i) => n.send(id, { turn: pub(n).turn, k: 'vote', side: typeof side === 'number' ? side : side(id, i) }));
  return voters;
}

test('content banks, narration budget and catalog entry', () => {
  const family = STANDARD.filter(p => !p.adult), adult = STANDARD.length - family.length + BLIND.filter(b => b.adult).length + SMACKDOWN.filter(x => x.adult).length;
  assert.ok(STANDARD.length >= 120 && family.length >= 100, `${STANDARD.length} standard prompts`);
  assert.ok(BLIND.length >= 50, `${BLIND.length} blind pairs`);
  assert.ok(SMACKDOWN.length >= 30, `${SMACKDOWN.length} smackdown sets`);
  assert.ok(adult >= 22 && adult <= 32, `${adult} adult items`);
  // House pools: two bespoke answers per Standard prompt, one pool per category, and the generic pool.
  assert.ok(STANDARD.length + Object.keys(CATEGORIES).length + 1 >= 60);
  assert.ok(GENERIC.length >= 60);
  for (const pool of Object.values(CATEGORIES)) assert.ok(pool.house.length >= 12, pool.hint);
  for (const b of [...BLIND, ...SMACKDOWN]) assert.ok(Object.hasOwn(CATEGORIES, b.cat), b.cat);
  const house = [...STANDARD.flatMap(p => p.house), ...GENERIC, ...Object.values(CATEGORIES).flatMap(c => c.house)];
  for (const text of house) assert.ok(text.length <= MAX_ANSWER && text === text.trim(), text);
  for (const p of STANDARD) assert.equal(p.house.length, 2, p.text);
  for (const x of SMACKDOWN) assert.equal(new Set(x.judges).size, 4, x.ask);
  for (const bank of [STANDARD.map(p => p.text), BLIND.map(b => b.prompt), SMACKDOWN.map(x => x.ask), GENERIC]) assert.equal(new Set(bank.map(t => t.toLowerCase())).size, bank.length, 'unique within a bank');
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^bracket-brawl\.[a-z0-9.-]+$/);
  for (const line of miniInfo('bracket-brawl')!.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 3, 6 and 10 players reach a sane result', async () => {
  for (const players of [3, 6, 10]) {
    const n = start(players, { seed: players }), begin = n.now;
    assert.equal(pub(n).size, players === 10 ? 16 : 8);
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 50 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.deepEqual(result.winners, top > 0 ? n.ids.filter(id => result.scores[id] === top) : []);
    for (const award of result.awards ?? []) assert.ok(['Undefeated', 'Oracle', 'Crowd favourite'].includes(award.title));
    assert.ok(n.now - begin < (players === 10 ? 17 : 12) * 60_000, `${players}p took ${Math.round((n.now - begin) / 1000)} s`);
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('seeding: small rooms write two answers in opposite halves; nobody faces themselves; players meet the House first', () => {
  for (const players of [3, 4, 5, 8, 9, 10]) for (const seed of [1, 2, 3]) {
    const n = start(players, { seed });
    writeAll(n);
    at(n, 'predict');
    const s = inner(n), per = players <= 4 ? 2 : 1, half = s.size / 2;
    assert.equal(s.entries.length, s.size);
    assert.equal(s.entries.filter(e => e.by === null).length, s.size - players * per);
    for (const id of n.ids) {
      const mine = s.entries.filter(e => e.by === id).map(e => Number(e.id.slice(1)));
      assert.equal(mine.length, per);
      if (per === 2) assert.notEqual(mine[0]! < half, mine[1]! < half, `${players}p ${id} in opposite halves`);
    }
    for (const [h, list] of [s.bouts[0]!.slice(0, s.size / 4), s.bouts[0]!.slice(s.size / 4)].entries()) {
      const sides = list.map(b => b.sides.map(id => by(n, id)));
      for (const [a, b] of sides) assert.ok(a === null || a !== b, 'no self matchup');
      const people = sides.flat().filter(x => x !== null).length, homes = half - people;
      assert.equal(sides.filter(([a, b]) => a !== null && b !== null).length, Math.max(0, (people - homes) / 2), `${players}p half ${h}: players face the House first`);
    }
  }
});

test('scoring: wins pay 100 × round, predictions 50 per round won, the champion 500 × bracket; all hidden until the crown', () => {
  const n = start(4);
  writeAll(n);
  at(n, 'predict');
  const turn = pub(n).turn;
  rejects(n.trySend('p0', { turn, k: 'predict', entry: 'e99' }), /not in the bracket/);
  for (const id of n.ids) n.send(id, { turn, k: 'predict', entry: 'e0' });
  rejects(n.trySend('p0', { turn, k: 'predict', entry: 'e1' }), /already locked/);
  assert.equal(me(n, 'p0').pick, 'e0');
  // Side 0 always wins, so e0 (top of the bracket) takes the title.
  for (let voted = ''; pub(n).phase !== 'champ';) {
    if (pub(n).phase === 'vote' && pub(n).turn !== voted) {
      voted = pub(n).turn;
      voteAll(n, 0);
      assert.deepEqual(pub(n).scores, Object.fromEntries(n.ids.map(id => [id, 0])), 'public scores stay banked mid-bracket');
    }
    n.advance(100);
  }
  const champ = pub(n).champ!, s = inner(n), wins: Record<string, number> = Object.fromEntries(n.ids.map(id => [id, 0]));
  assert.equal(champ.entry, 'e0');
  assert.equal(champ.bonus, PTS.champ * 1);
  assert.deepEqual(champ.oracles, n.ids);
  assert.equal(champ.oracle, PTS.oracle * 3);
  s.bouts.forEach((round, r) => round.forEach(b => { const w = by(n, b.sides[b.winner!]); if (w) wins[w]! += PTS.win * (r + 1); }));
  for (const id of n.ids) assert.equal(pub(n).scores[id], wins[id]! + PTS.oracle * 3 + (champ.by === id ? PTS.champ : 0), id);
  assert.ok(pub(n).entries.every(e => e.by || e.house), 'the crown unmasks every author');

  // Smackdown (bracket 3) doubles wins and predictions; the champion bonus is 500 × 3.
  n.until(() => pub(n).bracket === 3 && pub(n).phase === 'write');
  writeAll(n);
  at(n, 'predict');
  const before = { ...pub(n).scores }, pick = pub(n).turn;
  for (const id of n.ids) n.send(id, { turn: pick, k: 'predict', entry: 'e0' });
  at(n, 'stage');
  assert.ok(pub(n).judge, 'a judging question each round');
  at(n, 'vote');
  const [a0] = authors(n);
  voteAll(n, 0);
  at(n, 'result');
  assert.equal(me(n, a0!).earned, PTS.win * 2 + PTS.oracle * 2, 'round-one win ×2 plus the doubled prediction');
  assert.deepEqual(pub(n).scores, before);
  n.until(() => pub(n).phase === 'champ');
  assert.equal(pub(n).champ!.bonus, PTS.champ * 3);
  n.until(() => n.state.phase === 'podium');
});

test('ties go to an animated coin flip; a matchup nobody can vote on flips too', () => {
  const n = start(3, { seed: 2 });
  writeAll(n);
  at(n, 'predict');
  let split = false;
  while (!split) {
    at(n, 'vote');
    if (voteAll(n, (_, i) => i % 2 as 0 | 1).length === 2) split = true;
    at(n, 'result');
  }
  let b = pub(n).bouts[inner(n).round - 1]![inner(n).index]!;
  assert.equal(b.flip, true); assert.deepEqual(b.votes, [1, 1]); assert.ok(b.winner === 0 || b.winner === 1);
  const end = pub(n).deadline - pub(n).at;
  // Nobody left to vote: both voters drop out, the next matchup flips at the read-out.
  at(n, 'vote');
  for (const id of n.ids) if (!authors(n).includes(id)) n.connect(id, false);
  const turn = pub(n).turn;
  n.until(() => pub(n).turn !== turn, 8000);
  b = pub(n).bouts[inner(n).round - 1]![inner(n).index]!;
  assert.equal(pub(n).phase, 'result'); assert.equal(b.flip, true); assert.deepEqual(b.votes, [0, 0]);
  assert.ok(end > 6000, 'a coin flip holds the result longer');
});

test('missing answers: the House fills in, uncredited; timers follow the pace setting', () => {
  const n = start(5, { settings: { timers: 'speedy' } });
  assert.equal(pub(n).deadline - pub(n).at, 42_000);
  writeAll(n, ['p0', 'p1', 'p2', 'p3']);
  at(n, 'predict');
  assert.equal(inner(n).entries.filter(e => e.by === null).length, 4);
  assert.deepEqual(me(n, 'p4').answers, [{ slot: 0, house: true }]);
  assert.deepEqual(me(n, 'p4').mine, []);
  const texts = inner(n).entries.map(e => e.text.toLowerCase());
  assert.equal(new Set(texts).size, texts.length, 'house answers never repeat or copy a player');
  assert.ok(inner(n).entries.filter(e => e.by === null).every(e => STANDARD.some(p => p.house.includes(e.text)) || GENERIC.includes(e.text)));
});

test('disconnects: absent writers, predictors and voters are not waited for', () => {
  const n = start(5);
  n.connect('p4', false);
  writeAll(n, ['p0', 'p1', 'p2', 'p3']);
  n.advance(1600);
  assert.equal(pub(n).phase, 'predict', 'advanced without p4 after the readable minimum');
  for (const id of ['p0', 'p1', 'p2', 'p3']) n.send(id, { turn: pub(n).turn, k: 'predict', entry: 'e1' });
  n.advance(1600);
  assert.equal(pub(n).phase, 'stage');
  at(n, 'vote');
  const deadline = pub(n).deadline;
  voteAll(n, 1);
  n.until(() => pub(n).phase === 'result');
  assert.ok(n.now < deadline, 'closed early once every connected voter was in');
  n.connect('p4', true);
  assert.equal(me(n, 'p4').turn, pub(n).turn);
});

test('validation: stale turns, phases, ownership, duplicates, lengths and strict fields', () => {
  const n = start(4), turn = pub(n).turn;
  rejects(n.trySend('p0', { turn: 'old', k: 'answer', slot: 0, text: 'hi' }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 2, text: 'hi' }), /whole number/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: '   ' }), /Type an answer/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: 'x'.repeat(MAX_ANSWER + 1) }), /under 50/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: 'hi', extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  rejects(n.trySend('p0', { turn, k: 'vote', side: 0 }), /closed/);
  rejects(n.trySend('p0', { turn, k: 'predict', entry: 'e0' }), /closed/);
  n.send('p0', { turn, k: 'answer', slot: 0, text: '  Tabs\tand‮new\nlines  ' });
  assert.equal(me(n, 'p0').answers[0]!.text, 'Tabs and new lines');
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 0, text: 'again' }), /already locked/);
  rejects(n.trySend('p0', { turn, k: 'answer', slot: 1, text: 'TABS and new lines!' }), /already sent/);
  writeAll(n);
  at(n, 'vote');
  const [author] = authors(n), voter = n.ids.find(id => !authors(n).includes(id))!, vote = pub(n).turn;
  rejects(n.trySend(author!, { turn: vote, k: 'vote', side: 1 }), /own matchup/);
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 2 }), /whole number/);
  n.send(voter, { turn: vote, k: 'vote', side: 1 });
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /already in/);
  assert.equal(me(n, voter).vote, 1); assert.equal(me(n, voter).role, 'voter'); assert.equal(me(n, author!).role, 'author');
  at(n, 'result');
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /moved on/);
});

test('privacy: answers, the blind prompt and live authors stay secret', () => {
  const n = start(4);
  n.send('p1', { turn: pub(n).turn, k: 'answer', slot: 0, text: 'Secret sauce answer' });
  n.assertHidden('Secret sauce answer');
  for (const id of ['p0', 'p2', 'p3']) n.assertHiddenFrom(id, 'Secret sauce answer');
  writeAll(n);
  at(n, 'predict');
  const mine = (id: string) => inner(n).entries.filter(e => e.by === id).map(e => e.id);
  for (const id of n.ids) assert.deepEqual(me(n, id).mine, mine(id), 'each phone knows only its own entries');
  assert.ok(pub(n).entries.every(e => !e.by && !e.house), 'no authors before the matches');
  at(n, 'vote');
  assert.deepEqual(pub(n).done, [], 'no voter list during matchups');
  for (const id of n.ids) assert.ok(!JSON.stringify(pub(n).entries).includes(`"${id}"`), `vote leaks ${id}`);
  at(n, 'result');
  const b = pub(n).bouts[0]![0]!, loser = pub(n).entries.find(e => e.id === b.sides[1 - b.winner!])!, winner = pub(n).entries.find(e => e.id === b.sides[b.winner!])!;
  assert.ok(loser.by || loser.house, 'a knocked-out answer is unmasked');
  assert.ok(!winner.by && !winner.house, 'the winner stays anonymous');
  n.until(() => pub(n).bracket === 2 && pub(n).phase === 'write');
  const secret = inner(n).cards[1]!.prompt;
  assert.equal(pub(n).prompt, undefined); assert.ok(pub(n).hint);
  n.assertHidden(secret);
  for (const id of n.ids) n.assertHiddenFrom(id, secret);
  writeAll(n);
  at(n, 'twist');
  assert.equal(pub(n).prompt, secret, 'revealed at the twist');
});

test('family filter: adult prompts only appear when family mode is off', () => {
  const adult = new Set([...STANDARD.filter(p => p.adult).map(p => p.text), ...BLIND.filter(b => b.adult).map(b => b.prompt), ...SMACKDOWN.filter(x => x.adult).map(x => x.ask)]);
  let seen = 0;
  for (let seed = 1; seed <= 24; seed++) {
    assert.ok(inner(start(3, { seed })).cards.every(c => !adult.has(c.prompt)), `seed ${seed}`);
    seen += inner(start(3, { seed, settings: { family: false } })).cards.filter(c => adult.has(c.prompt)).length;
  }
  assert.ok(seen > 0, 'adult prompts are in the pool with family mode off');
});

test('night memory: a replay in the same night deals fresh prompts and house answers', async () => {
  const n = start(3, { seed: 8 }), prompts = () => inner(n).cards.map(c => c.prompt);
  const first = prompts();
  await n.playMini();
  const used = n.state.used['bracket-brawl']!;
  n.startMini('bracket-brawl');
  assert.deepEqual(prompts().filter(p => first.includes(p)), []);
  assert.ok(first.every(p => used.includes(p)), 'every dealt prompt is marked');
  assert.ok(used.some(k => k.startsWith('house:')), 'house answers are marked too');
});
