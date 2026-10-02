import assert from 'node:assert/strict';
import test from 'node:test';
import { createNight, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/split-decision/narration';
import { DILEMMAS, DILEMMAS_ADULT, FINALS, FINALS_ADULT, HOUSE_CLAUSES, HOUSE_OPTIONS, RATHERS, RATHERS_ADULT } from '../src/minis/split-decision/content.server';
import type { SplitState } from '../src/minis/split-decision/server';
import { BLANK, MAX_FILL, RESULT, carousel, minority, splitPoints, verdictOf, type Side, type SplitPrivate, type SplitPublic } from '../src/minis/split-decision/types';

const pub = (n: Night) => n.mini<SplitPublic>();
const me = (n: Night, id: string) => n.miniMe<SplitPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as SplitState;
const card = (n: Night) => inner(n).cards[inner(n).index]!;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: SplitPublic['phase']) => n.until(() => pub(n)?.phase === phase);
const blanks = (text: string) => text.split(BLANK).length - 1;

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('split-decision');
  return n;
}
/** Every listed seat fills its open blanks with unique, traceable text. */
function fillAll(n: Night, ids = n.ids) {
  for (const id of ids) me(n, id).task?.slots.forEach((slot, i) => { if (slot.text === undefined) n.send(id, { turn: pub(n).turn, k: 'fill', slot: i, text: `${id} catch ${i} round ${pub(n).round}` }); });
}
/** Every seat but the author votes `side(id)`. */
function voteAll(n: Night, side: (id: string, i: number) => Side) {
  n.ids.filter(id => id !== card(n).author).forEach((id, i) => n.send(id, { turn: pub(n).turn, k: 'vote', side: side(id, i) }));
}

test('scoring table: perfect, scaled, floor, unanimous, odd rooms and the minority', () => {
  assert.equal(splitPoints(1, 1), 1000); assert.equal(splitPoints(4, 4), 1000); assert.equal(splitPoints(5, 4), 1000, 'evenest split with nine voters');
  assert.equal(splitPoints(2, 1), 1000); assert.equal(splitPoints(3, 1), 500); assert.equal(splitPoints(6, 3), 750);
  assert.equal(splitPoints(7, 2), 500); assert.equal(splitPoints(8, 1), 250); assert.equal(splitPoints(5, 2), 670); assert.equal(splitPoints(6, 1), 330);
  assert.equal(splitPoints(2, 0), 0); assert.equal(splitPoints(0, 9), 0); assert.equal(splitPoints(1, 0), 0); assert.equal(splitPoints(0, 0), 0);
  for (let y = 0; y <= 10; y++) for (let n = 0; n <= 10 - y; n++) {
    const p = splitPoints(y, n);
    assert.ok(p === 0 ? !y || !n : p >= 100 && p <= 1000 && p % 10 === 0, `${y}-${n} → ${p}`);
  }
  assert.equal(verdictOf(4, 4), 'perfect'); assert.equal(verdictOf(5, 3), 'close'); assert.equal(verdictOf(8, 1), 'lopsided');
  assert.equal(verdictOf(3, 0), 'unanimous'); assert.equal(verdictOf(0, 0), 'silent');
  assert.equal(minority(2, 5), 0); assert.equal(minority(5, 2), 1); assert.equal(minority(3, 3), null); assert.equal(minority(4, 0), null);
  assert.deepEqual(carousel([{ id: 'e0' }, { id: 'e1' }, { id: 'e2' }, { id: 'e3' }], 'e1').map(e => e.id), ['e2', 'e3', 'e0']);
  assert.deepEqual(carousel([{ id: 'e0' }, { id: 'e1' }]).map(e => e.id), ['e0', 'e1'], 'no take of your own: judge them all');
});

test('content banks, narration budget and catalog entry', () => {
  for (const [bank, min, holes] of [[DILEMMAS, 125, 1], [DILEMMAS_ADULT, 22, 1], [RATHERS, 54, 2], [RATHERS_ADULT, 8, 2], [FINALS, 30, 1], [FINALS_ADULT, 5, 1]] as const) {
    assert.ok(bank.length >= min, `bank of ${bank.length} < ${min}`);
    for (const t of bank) { assert.equal(blanks(t), holes, t); assert.ok(t.endsWith('?'), t); assert.equal(t, t.trim().replace(/\s+/g, ' '), t); }
  }
  assert.ok(DILEMMAS.length + DILEMMAS_ADULT.length >= 150 && RATHERS.length + RATHERS_ADULT.length >= 60 && FINALS.length + FINALS_ADULT.length >= 30);
  const all = [...DILEMMAS, ...DILEMMAS_ADULT, ...RATHERS, ...RATHERS_ADULT, ...FINALS, ...FINALS_ADULT];
  assert.equal(new Set(all.map(p => p.toLowerCase())).size, all.length, 'templates are unique across banks');
  assert.ok(HOUSE_CLAUSES.length >= 60 && HOUSE_OPTIONS.length >= 40);
  for (const bank of [HOUSE_CLAUSES, HOUSE_OPTIONS]) { assert.equal(new Set(bank).size, bank.length); for (const h of bank) assert.ok(h.length <= MAX_FILL && !h.includes(BLANK), h); }
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^split-decision\.[a-z0-9.-]+$/);
  for (const line of miniInfo('split-decision')!.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 3, 6 and 10 players reach a sane result', async () => {
  for (const players of [3, 6, 10]) {
    const n = start(players, { seed: players }), begin = n.now;
    const { result, rejected, accepted } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.ok(accepted > players * 3);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 5 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.ok(top > 0);
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    assert.ok(result.headline);
    assert.ok(n.now - begin < 15 * 60_000, `fits the time budget (${Math.round((n.now - begin) / 1000)} s)`);
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('round 1: everyone gets their own dilemma; a perfect split pays the author 1000 and the room nothing extra', () => {
  const n = start(5);
  const templates = n.ids.map(id => me(n, id).task!);
  assert.equal(new Set(templates.map(t => t.parts.join(BLANK))).size, 5, 'five different templates');
  for (const t of templates) { assert.equal(t.kind, 'dilemma'); assert.equal(t.slots.length, 1); assert.equal(t.parts.length, 2); }
  fillAll(n);
  at(n, 'show');
  rejects(n.trySend(n.ids.find(id => id !== card(n).author)!, { turn: pub(n).turn, k: 'vote', side: 0 }), /moment/);
  assert.equal(pub(n).card!.fills[0], `${card(n).author} catch 0 round 1`);
  at(n, 'vote');
  const author = card(n).author, before = { ...pub(n).scores };
  voteAll(n, (_, i) => (i % 2) as Side);
  n.advance(1300);
  assert.equal(pub(n).phase, 'result');
  const o = pub(n).card!.outcome!;
  assert.equal(o.author, author); assert.equal(o.verdict, 'perfect'); assert.equal(o.points, 1000); assert.equal(o.bold, 0);
  assert.equal(o.sides[0].length, 2); assert.equal(o.sides[1].length, 2);
  assert.equal(pub(n).scores[author], before[author]! + 1000);
  for (const id of n.ids.filter(id => id !== author)) assert.equal(pub(n).scores[id], before[id], 'a tie has no minority');

  // Next card: 3–1 scales to 500 and the lone dissenter gets the Bold bonus.
  n.until(() => pub(n).phase === 'vote' && pub(n).card!.index === 1);
  const second = card(n).author, voters = n.ids.filter(id => id !== second), rebel = voters[2]!, mid = { ...pub(n).scores };
  voteAll(n, id => id === rebel ? 1 : 0);
  at(n, 'result');
  const o2 = pub(n).card!.outcome!;
  assert.equal(o2.points, 500); assert.equal(o2.verdict, 'close'); assert.equal(o2.bold, 50);
  assert.deepEqual(o2.sides[1], [rebel]);
  assert.equal(pub(n).scores[rebel], mid[rebel]! + 50);
  assert.equal(pub(n).scores[second], mid[second]! + 500);
  assert.equal(me(n, rebel).side, 1); assert.equal(me(n, second).role, 'author');
});

test('unanimous scores nothing; nobody voting scores nothing; house blanks halve the points', () => {
  const n = start(4);
  const [house, ...rest] = n.ids;
  n.send(house!, { turn: pub(n).turn, k: 'house', slot: 0 });
  assert.equal(me(n, house!).task!.slots[0]!.house, true);
  assert.ok(HOUSE_CLAUSES.includes(me(n, house!).task!.slots[0]!.text!));
  rejects(n.trySend(house!, { turn: pub(n).turn, k: 'fill', slot: 0, text: 'again' }), /already locked/);
  fillAll(n, rest);
  for (let i = 0; i < 4; i++) {
    n.until(() => pub(n).phase === 'vote' && pub(n).card!.index === i);
    const author = card(n).author, before = pub(n).scores[author]!;
    if (author === house) voteAll(n, (_, k) => (k ? 0 : 1) as Side);       // 2–1: perfect, halved
    else if (i % 2) voteAll(n, () => 0);                                     // unanimous
    // else: nobody votes
    at(n, 'result');
    const o = pub(n).card!.outcome!;
    if (author === house) { assert.equal(o.house, true); assert.equal(o.points, 500); assert.equal(o.verdict, 'perfect'); }
    else if (i % 2) { assert.equal(o.verdict, 'unanimous'); assert.equal(o.points, 0); assert.equal(o.bold, 0); }
    else { assert.equal(o.verdict, 'silent'); assert.equal(o.points, 0); }
    assert.equal(pub(n).scores[author], before + o.points);
  }
});

test('round 2: would-you-rather with two blanks, both filled by the author, double points', () => {
  const n = start(3);
  n.until(() => pub(n).phase === 'write' && pub(n).round === 2);
  const task = me(n, 'p0').task!;
  assert.equal(task.kind, 'rather'); assert.equal(task.slots.length, 2); assert.equal(task.parts.length, 3);
  const turn = pub(n).turn;
  n.send('p0', { turn, k: 'fill', slot: 0, text: 'Juggle Chainsaws' });
  rejects(n.trySend('p0', { turn, k: 'fill', slot: 1, text: 'juggle chainsaws.' }), /different/);
  n.send('p0', { turn, k: 'fill', slot: 1, text: 'Eat a cold sock' });
  assert.deepEqual(me(n, 'p0').task!.slots.map(s => s.text), ['Juggle Chainsaws', 'Eat a cold sock']);
  n.send('p1', { turn, k: 'house', slot: 1 });
  assert.ok(HOUSE_OPTIONS.includes(me(n, 'p1').task!.slots[1]!.text!));
  // p2 writes nothing: both blanks become two different house options at the buzzer.
  n.send('p1', { turn, k: 'fill', slot: 0, text: 'Sing opera at breakfast' });
  at(n, 'show');
  const p2 = inner(n).cards.find(c => c.author === 'p2')!;
  assert.ok(p2.fills.every(f => f.house && HOUSE_OPTIONS.includes(f.text!)));
  assert.notEqual(p2.fills[0]!.text, p2.fills[1]!.text);
  n.until(() => pub(n).phase === 'vote' && card(n).author === 'p0');
  assert.deepEqual(pub(n).card!.fills, ['Juggle Chainsaws', 'Eat a cold sock']);
  const before = pub(n).scores.p0!;
  n.send('p1', { turn: pub(n).turn, k: 'vote', side: 0 }); n.send('p2', { turn: pub(n).turn, k: 'vote', side: 1 });
  at(n, 'result');
  assert.equal(pub(n).card!.outcome!.points, 2000);
  assert.equal(pub(n).scores.p0, before + 2000);
});

test('The Big Split: one template, every take judged in a carousel, triple points and Bold bonuses', () => {
  const n = start(4);
  n.until(() => pub(n).phase === 'final-write');
  const template = pub(n).final!.parts.join(BLANK);
  for (const id of n.ids) assert.equal(me(n, id).task!.parts.join(BLANK), template);
  assert.deepEqual(pub(n).final!.entries, []);
  fillAll(n, ['p0', 'p1', 'p2']);
  n.connect('p3', false);
  n.advance(1600);
  assert.equal(pub(n).phase, 'final-vote');
  assert.equal(pub(n).final!.entries.length, 3, 'offline players without a take sit out');
  const turn = pub(n).turn, mine = (id: string) => me(n, id).mine!;
  rejects(n.trySend('p0', { turn, k: 'judge', entry: mine('p0'), side: 0 }), /own take/);
  rejects(n.trySend('p0', { turn, k: 'judge', entry: 'e9', side: 0 }), /not on the board/);
  rejects(n.trySend('p0', { turn, k: 'judge', entry: mine('p1'), side: 2 }), /whole number/);
  rejects(n.trySend('p0', { turn, k: 'vote', side: 0 }), /opens in a moment/);
  // p1's take splits 1–1 (perfect), p2's is unanimous yes, p0's gets one yes from p1 and nothing else.
  n.send('p0', { turn, k: 'judge', entry: mine('p1'), side: 0 });
  rejects(n.trySend('p0', { turn, k: 'judge', entry: mine('p1'), side: 1 }), /already judged/);
  n.send('p2', { turn, k: 'judge', entry: mine('p1'), side: 1 });
  n.send('p0', { turn, k: 'judge', entry: mine('p2'), side: 0 }); n.send('p1', { turn, k: 'judge', entry: mine('p2'), side: 0 });
  assert.deepEqual(pub(n).done, ['p0']);
  assert.deepEqual(me(n, 'p0').judged, { [mine('p1')]: 0, [mine('p2')]: 0 });
  const before = { ...pub(n).scores };
  n.send('p1', { turn, k: 'judge', entry: mine('p0'), side: 0 });
  n.send('p2', { turn, k: 'judge', entry: mine('p0'), side: 1 });
  n.advance(1500);
  assert.equal(pub(n).phase, 'final-result');
  const r = pub(n).final!.result!;
  assert.deepEqual(r.entries.map(e => e.points), [0, 3000, 3000], 'revealed fewest points first');
  assert.deepEqual([...r.best].sort(), ['p0', 'p1']);
  assert.deepEqual(r.bold, {}, 'no minorities: every split was even or unanimous');
  assert.equal(pub(n).scores.p1, before.p1! + 3000);
  assert.equal(r.entries[0]!.verdict, 'unanimous');
  n.until(() => n.state.phase === 'podium');
  const podium = n.state.podium!.result;
  assert.ok(podium.headline!.includes('perfect split'));
});

test('The Big Split Bold bonus: minority judges earn 150 per take', () => {
  const n = start(5);
  n.until(() => pub(n).phase === 'final-write');
  fillAll(n);
  at(n, 'final-vote');
  const turn = pub(n).turn, target = me(n, 'p0').mine!;
  for (const id of ['p1', 'p2', 'p3']) n.send(id, { turn, k: 'judge', entry: target, side: 0 });
  n.send('p4', { turn, k: 'judge', entry: target, side: 1 });
  const before = { ...pub(n).scores };
  n.until(() => pub(n).phase === 'final-result');
  const r = pub(n).final!.result!, mine = r.entries.find(e => e.id === target)!;
  assert.equal(mine.yes, 3); assert.equal(mine.no, 1); assert.equal(mine.points, 1500);
  assert.equal(r.bold.p4, 150);
  assert.equal(pub(n).scores.p4, before.p4! + 150 + r.entries.find(e => e.author === 'p4')!.points);
});

test('missing input defaults: house blanks for silent writers; timers follow the pace setting', () => {
  const n = start(3, { settings: { timers: 'relaxed' } });
  assert.equal(pub(n).deadline - pub(n).at, 90_000);
  n.send('p0', { turn: pub(n).turn, k: 'fill', slot: 0, text: 'Only one from me' });
  at(n, 'show');
  const fills = inner(n).cards.flatMap(c => c.fills);
  assert.equal(fills.filter(f => !f.house).length, 1);
  for (const f of fills.filter(f => f.house)) assert.ok(HOUSE_CLAUSES.includes(f.text!));
  assert.equal(new Set(fills.map(f => f.text)).size, fills.length, 'house blanks never repeat');
});

test('disconnects: absent writers sit out, absent voters are not waited for', () => {
  const n = start(5);
  n.connect('p4', false);
  fillAll(n, n.ids.filter(id => id !== 'p4'));
  n.advance(1600);
  assert.equal(pub(n).phase, 'show', 'advanced without p4 after the readable minimum');
  assert.equal(inner(n).cards.length, 4, 'p4 wrote nothing and is offline: no card');
  at(n, 'vote');
  const deadline = pub(n).deadline;
  for (const id of n.ids) if (id !== 'p4' && id !== card(n).author) n.send(id, { turn: pub(n).turn, k: 'vote', side: 0 });
  n.advance(1300);
  assert.equal(pub(n).phase, 'result');
  assert.ok(n.now < deadline);
  n.connect('p4', true);
  assert.equal(me(n, 'p4').turn, pub(n).turn);
  assert.equal(me(n, 'p4').role, 'voter');
});

test('validation: stale turns, ownership, duplicates, lengths, strict fields and out-of-phase moves', () => {
  const n = start(4), turn = pub(n).turn;
  rejects(n.trySend('p0', { turn: 'old', k: 'fill', slot: 0, text: 'hi' }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'fill', slot: 1, text: 'hi' }), /whole number/);
  rejects(n.trySend('p0', { turn, k: 'fill', slot: 0, text: '  ...  ' }), /Fill in the blank/);
  rejects(n.trySend('p0', { turn, k: 'fill', slot: 0, text: 'x'.repeat(MAX_FILL + 1) }), /under 60/);
  rejects(n.trySend('p0', { turn, k: 'fill', slot: 0, text: 'hi', extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  rejects(n.trySend('p0', { turn, k: 'vote', side: 0 }), /moment/);
  rejects(n.trySend('p0', { turn, k: 'judge', entry: 'e0', side: 0 }), /closed/);
  n.send('p0', { turn, k: 'fill', slot: 0, text: '  you\tmust‮ hop\nforever!!  ' });
  assert.equal(me(n, 'p0').task!.slots[0]!.text, 'you must hop forever', 'cleaned, trailing punctuation dropped');
  rejects(n.trySend('p0', { turn, k: 'fill', slot: 0, text: 'again' }), /already locked/);
  rejects(n.trySend('p0', { turn, k: 'house', slot: 0 }), /already locked/);
  fillAll(n);
  at(n, 'vote');
  const author = card(n).author, voter = n.ids.find(id => id !== author)!, vote = pub(n).turn;
  rejects(n.trySend(author, { turn: vote, k: 'vote', side: 1 }), /own dilemma/);
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 2 }), /whole number/);
  rejects(n.trySend(voter, { turn: vote, k: 'fill', slot: 0, text: 'late' }), /No writing/);
  n.send(voter, { turn: vote, k: 'vote', side: 1 });
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /already in/);
  at(n, 'result');
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /moved on/);
  rejects(n.trySend(voter, { turn: pub(n).turn, k: 'vote', side: 0 }), /opens in a moment/);
});

test('privacy: fills stay private while writing; authors and votes stay hidden until the reveal', () => {
  const n = start(4);
  n.send('p1', { turn: pub(n).turn, k: 'fill', slot: 0, text: 'secret catch text' });
  n.assertHidden('secret catch text');
  for (const id of ['p0', 'p2', 'p3']) n.assertHiddenFrom(id, 'secret catch text');
  const p2template = me(n, 'p2').task!.parts.join(BLANK);
  for (const id of ['p0', 'p1', 'p3']) n.assertHiddenFrom(id, p2template);
  assert.deepEqual(pub(n).done, ['p1']);
  fillAll(n);
  for (const phase of ['show', 'vote'] as const) {
    at(n, phase);
    const c = JSON.stringify(pub(n).card);
    for (const id of n.ids) assert.ok(!c.includes(`"${id}"`), `${phase} card leaks ${id}`);
    assert.deepEqual(pub(n).done, [], 'no voter list during cards');
  }
  const voter = n.ids.find(id => id !== card(n).author)!, other = n.ids.find(id => id !== card(n).author && id !== voter)!;
  n.send(voter, { turn: pub(n).turn, k: 'vote', side: 1 });
  assert.equal(me(n, voter).side, 1); assert.equal(me(n, other).side, undefined);
  assert.equal(pub(n).card!.votes, 1);
  assert.ok(!JSON.stringify(pub(n)).includes('"sides"'));
  n.until(() => pub(n).phase === 'final-vote');
  const final = JSON.stringify(pub(n).final);
  for (const id of n.ids) assert.ok(!final.includes(`"${id}"`), `final entries leak ${id}`);
  const entry = me(n, 'p1').mine!;
  n.send('p0', { turn: pub(n).turn, k: 'judge', entry, side: 1 });
  assert.equal(me(n, 'p1').judged![entry], undefined, 'judgements are private');
  assert.ok(!JSON.stringify(pub(n)).includes('"judged"'));
});

test('family filter: adult templates only appear when family mode is off', () => {
  const adult = new Set([...DILEMMAS_ADULT, ...RATHERS_ADULT, ...FINALS_ADULT]);
  const dealt = (n: Night) => [...inner(n).dilemmas, ...inner(n).rathers, inner(n).finalParts.join(BLANK)];
  let seen = 0;
  for (let seed = 1; seed <= 12; seed++) {
    assert.ok(dealt(start(10, { seed })).every(p => !adult.has(p)), `seed ${seed}`);
    seen += dealt(start(10, { seed, settings: { family: false } })).filter(p => adult.has(p)).length;
  }
  assert.ok(seen > 0, 'adult templates are in the pool with family mode off');
});

test('night memory: a replay in the same night deals none of the first game’s templates', async () => {
  const n = start(4, { seed: 8 }), dealt = () => new Set([...inner(n).dilemmas, ...inner(n).rathers, inner(n).finalParts.join(BLANK)]);
  const first = dealt();
  await n.playMini();
  n.startMini('split-decision');
  const second = dealt();
  assert.equal(second.size, 9);
  assert.deepEqual([...second].filter(p => first.has(p)), []);
  assert.ok([...first, ...second].every(p => n.state.used['split-decision']!.includes(p)), 'every dealt template is marked');
});

test('reveal beats: result phase holds longer for perfect and unanimous verdicts', () => {
  const n = start(3);
  fillAll(n);
  at(n, 'vote');
  voteAll(n, (_, i) => (i % 2) as Side);
  at(n, 'result');
  assert.equal(pub(n).deadline - pub(n).at >= RESULT.end + RESULT.bonus, true);
});
