import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDrawing } from '../../../party-contract/src/index';
import { createNight, loadBot, type Night, type NightOptions } from './harness';
import { miniInfo } from '../src/minis/catalog';
import { LINES } from '../src/minis/shirt-show/narration';
import { ADULT_HINTS, ADULT_SLOGANS, HINTS, HOUSE_DESIGNS, SLOGANS, SPARKS } from '../src/minis/shirt-show/content.server';
import type { ShirtState } from '../src/minis/shirt-show/server';
import { MAX_DESIGNS, MAX_SLOGAN, MAX_SLOGANS, PTS, type ShirtPrivate, type ShirtPublic } from '../src/minis/shirt-show/types';

const pub = (n: Night) => n.mini<ShirtPublic>();
const me = (n: Night, id: string) => n.miniMe<ShirtPrivate>(id);
const inner = (n: Night) => n.state.mini!.state as ShirtState;
const rejects = (result: { accepted: boolean; reason?: string }, pattern: RegExp) => { assert.equal(result.accepted, false); assert.match(result.reason!, pattern); };
const at = (n: Night, phase: ShirtPublic['phase']) => n.until(() => pub(n)?.phase === phase);
const doodle = { strokes: [{ color: '#ff5748', width: .02, points: [.2, .35, .5, .65, .8, .9].map(x => ({ x, y: 1 - x })) }] };

function start(players: number, options: NightOptions = {}) {
  const n = createNight({ players, seed: 5, ...options });
  n.startMini('shirt-show');
  return n;
}
/** Everyone listed sends one design (draw) or one traceable slogan (write) and finishes. */
function contribute(n: Night, ids = n.ids) {
  const { phase, turn, round } = pub(n);
  for (const id of ids) {
    n.send(id, phase === 'draw' ? { turn, k: 'design', drawing: doodle } : { turn, k: 'slogan', text: `${id} slogan r${round}` });
    n.send(id, { turn, k: 'done' });
  }
}
/** Everyone listed stitches their shirts from the first card of each hand; `prefer` deals a given artist's/writer's part there first. */
function stitchAll(n: Night, ids = n.ids, prefer: (id: string) => { artist?: string; writer?: string } = () => ({})) {
  for (const id of ids) while (me(n, id).hand) {
    const s = inner(n), want = prefer(id), hand = s.hands[id]!, d = s.designs.find(x => x.by === want.artist), w = s.slogans.find(x => x.by === want.writer);
    if (d) hand.designs[0] = d.key;
    if (w) hand.slogans[0] = w.id;
    n.send(id, { turn: pub(n).turn, k: 'shirt', design: hand.designs[0], slogan: hand.slogans[0], color: 2, pos: 'top' });
  }
}
/** Plays draw → write → make with one part each, then waits for the first bout's vote. */
function toVote(n: Night, prefer?: Parameters<typeof stitchAll>[2]) {
  at(n, 'draw'); contribute(n); n.advance(1600);
  at(n, 'write'); contribute(n); n.advance(1600);
  at(n, 'make'); stitchAll(n, n.ids, prefer); n.advance(1600);
  at(n, 'vote');
}
const voters = (n: Night) => n.ids.filter(id => !inner(n).clash!.sides.some(x => x.credits.maker === id));

test('content banks, house designs, narration budget and catalog entry', () => {
  for (const [bank, min] of [[HINTS, 120], [ADULT_HINTS, 15], [SLOGANS, 40], [ADULT_SLOGANS, 8], [SPARKS, 40]] as const) {
    assert.ok(bank.length >= min, `bank of ${bank.length} < ${min}`);
    assert.equal(new Set(bank.map(x => x.toLowerCase())).size, bank.length, 'unique');
    for (const line of bank) assert.equal(line, line.trim().replace(/\s+/g, ' '), line);
  }
  assert.equal(new Set([...HINTS, ...ADULT_HINTS]).size, HINTS.length + ADULT_HINTS.length);
  for (const slogan of [...SLOGANS, ...ADULT_SLOGANS]) assert.ok(slogan.length <= MAX_SLOGAN, slogan);
  assert.ok(HOUSE_DESIGNS.length >= 12);
  for (const { name, drawing } of HOUSE_DESIGNS) assert.deepEqual(parseDrawing(drawing), drawing, `${name} is a valid shared drawing`);
  const total = Object.values(LINES).reduce((sum, line) => sum + line.length, 0);
  assert.ok(total <= 250, `narration is ${total} characters`);
  for (const id of Object.keys(LINES)) assert.match(id, /^shirt-show\.[a-z0-9.-]+$/);
  const info = miniInfo('shirt-show')!;
  assert.deepEqual(info.players, { min: 3, max: 10 });
  for (const line of info.intro) assert.ok(Object.hasOwn(LINES, line), line);
});

test('full games with bots: 3, 4, 6 and 10 players reach a sane result', async () => {
  for (const players of [3, 4, 6, 10]) {
    const n = start(players, { seed: players }), begin = n.now;
    const { result, rejected } = await n.playMini();
    assert.deepEqual(rejected, [], `${players}p bots were never rejected`);
    assert.deepEqual(Object.keys(result.scores).sort(), [...n.ids].sort());
    for (const score of Object.values(result.scores)) assert.ok(score >= 0 && score % 50 === 0, `${score}`);
    const top = Math.max(...Object.values(result.scores));
    assert.ok(top >= PTS.champ + PTS.finalWin, 'someone won a round and the final');
    assert.deepEqual(result.winners, n.ids.filter(id => result.scores[id] === top));
    assert.ok(result.awards?.some(a => a.title === 'Champion Tailor'));
    assert.ok(n.now - begin < 16 * 60_000, `${players}p fits the time budget`);
    n.toMenu(); assert.equal(n.state.phase, 'menu');
  }
});

test('phases: draw → write → make → king-of-the-hill bouts → champion, twice, then the main event', () => {
  for (const players of [3, 4, 5, 10]) {
    const n = start(players), need = players <= 4 ? 2 : 1;
    for (const round of [1, 2]) {
      toVote(n);
      const s = inner(n);
      assert.equal(s.order.length, players * need, `${players}p round ${round}: ${need} shirt(s) each`);
      assert.equal(pub(n).bout!.count, players * need - 1);
      // The winner stays on: every bout's side 0 is the previous winner, side 1 the next shirt in line.
      for (let bout = 0; bout < players * need - 1; bout++) {
        at(n, 'vote');
        assert.equal(inner(n).clash!.sides[1].id, s.order[bout + 1]!.id);
        const v = voters(n);
        v.forEach((id, i) => n.send(id, { turn: pub(n).turn, k: 'vote', side: i % 3 ? 1 : 0 }));
        at(n, 'result');
        const r = pub(n).bout!.result!, holder = inner(n).clash!.sides[r.winner];
        n.until(() => pub(n).phase !== 'result');
        if (pub(n).bout) assert.equal(inner(n).clash!.sides[0].id, holder.id);
      }
      at(n, 'champ');
      assert.equal(pub(n).champ!.shirt.id, inner(n).champs[round - 1]!.shirt.id);
    }
    at(n, 'final-vote');
    assert.deepEqual(pub(n).final!.sides.map(x => x.id), inner(n).champs.map(c => c.shirt.id));
  }
});

test('hands: three designs and slogans mostly from other players, one reroll each, parts not reused', () => {
  const n = start(6);
  at(n, 'draw');
  for (const id of n.ids) for (let i = 0; i < 2; i++) n.send(id, { turn: pub(n).turn, k: 'design', drawing: doodle });
  for (const id of n.ids) n.send(id, { turn: pub(n).turn, k: 'done' });
  n.advance(1600); at(n, 'write'); contribute(n); n.advance(1600); at(n, 'make');
  const s = inner(n);
  for (const id of n.ids) {
    const hand = me(n, id).hand!;
    assert.equal(hand.designs.length, 3); assert.equal(hand.slogans.length, 3);
    for (const key of hand.designs) assert.notEqual(s.designs.find(d => d.key === key)!.by, id, 'designs come from others first');
    assert.ok(hand.designs.every(k => Object.hasOwn(pub(n) && n.view().media, k)), 'dealt designs are in the media store');
  }
  const turn = pub(n).turn, before = me(n, 'p0').hand!;
  n.send('p0', { turn, k: 'reroll', what: 'design' });
  const after = me(n, 'p0').hand!;
  assert.ok(after.designs.every(k => !before.designs.includes(k)), 'a reroll deals fresh designs');
  assert.deepEqual(after.slogans, before.slogans);
  assert.deepEqual(after.reroll, { design: false, slogan: true });
  rejects(n.trySend('p0', { turn, k: 'reroll', what: 'design' }), /already rerolled/);
  n.send('p0', { turn, k: 'reroll', what: 'slogan' });
  rejects(n.trySend('p0', { turn, k: 'reroll', what: 'slogan' }), /already rerolled/);
  rejects(n.trySend('p0', { turn, k: 'shirt', design: before.designs[0], slogan: me(n, 'p0').hand!.slogans[0]!.id, color: 0, pos: 'top' }), /your designs/);
});

test('small rooms make two shirts each, from two different hands', () => {
  const n = start(3);
  at(n, 'draw'); contribute(n); n.advance(1600); at(n, 'write'); contribute(n); n.advance(1600); at(n, 'make');
  assert.equal(me(n, 'p0').need, 2);
  const first = me(n, 'p0').hand!;
  n.send('p0', { turn: pub(n).turn, k: 'shirt', design: first.designs[0], slogan: first.slogans[0]!.id, color: 1, pos: 'bottom' });
  const second = me(n, 'p0').hand!;
  assert.ok(!second.designs.includes(first.designs[0]!) && !second.slogans.some(x => x.id === first.slogans[0]!.id), 'used parts are not dealt again');
  assert.equal(me(n, 'p0').made!.length, 1);
  assert.deepEqual(pub(n).sewn, [1, 6]);
  assert.ok(!pub(n).done.includes('p0'));
});

test('scoring: maker 100 a vote, borrowed parts 50 a vote, own and house parts nothing extra, ties keep the champ', () => {
  // Each player wears the next player's design and the slogan of the one after.
  const n = start(5);
  toVote(n, id => ({ artist: `p${(Number(id[1]) + 1) % 5}`, writer: `p${(Number(id[1]) + 2) % 5}` }));
  const c = inner(n).clash!, [a, b] = c.sides, before = { ...pub(n).scores };
  assert.equal(b.credits.artist, `p${(Number(b.credits.maker[1]) + 1) % 5}`);
  const v = voters(n);
  assert.equal(v.length, 3);
  for (const id of v) n.send(id, { turn: pub(n).turn, k: 'vote', side: 1 });
  at(n, 'result');
  const r = pub(n).bout!.result!;
  assert.equal(r.winner, 1); assert.equal(r.tie, undefined);
  assert.deepEqual(r.points[1], { maker: 300, artist: 150, writer: 150 });
  assert.deepEqual(r.points[0], { maker: 0, artist: 0, writer: 0 });
  assert.deepEqual(r.credits, [a!.credits, b!.credits]);
  const gained = (id: string) => pub(n).scores[id]! - before[id]!;
  assert.equal(gained(b!.credits.maker), 300); assert.equal(gained(b!.credits.artist!), 150); assert.equal(gained(b!.credits.writer!), 150);
  assert.equal(pub(n).bout!.result!.streak, 1);

  // Next bout: a tie keeps the holder in the ring (and still pays each side for its votes).
  n.until(() => pub(n).phase === 'vote');
  const holder = inner(n).clash!.sides[0], tied = voters(n).slice(0, 2), wins = inner(n).wins[holder.id];
  n.send(tied[0]!, { turn: pub(n).turn, k: 'vote', side: 0 }); n.send(tied[1]!, { turn: pub(n).turn, k: 'vote', side: 1 });
  n.advance(13_000);
  const t = pub(n).bout!.result!;
  assert.equal(t.tie, true); assert.equal(t.winner, 0);
  assert.equal(t.points[0].maker, 100); assert.equal(t.points[1].maker, 100);
  assert.equal(inner(n).wins[holder.id], wins, 'a tie is not a ring win'); assert.equal(t.streak, wins); assert.equal(pub(n).bout!.streak, wins);
  n.until(() => pub(n).phase !== 'result');
  assert.equal(inner(n).clash!.sides[0].id, holder.id, 'the champ keeps the belt');

  // Your own art and house words pay nothing extra: only the maker's per-vote points.
  at(n, 'vote');
  const c2 = inner(n).clash!, maker = c2.sides[1].credits.maker, before2 = { ...pub(n).scores };
  c2.sides[1].credits = { maker, artist: maker, writer: null };
  const v2 = voters(n);
  for (const id of v2) n.send(id, { turn: pub(n).turn, k: 'vote', side: 1 });
  at(n, 'result');
  assert.deepEqual(pub(n).bout!.result!.points[1], { maker: v2.length * 100, artist: 0, writer: 0 });
  assert.equal(pub(n).scores[maker]! - before2[maker]!, v2.length * 100);
});

test('round champion +500; the final pays double, ties go to the shirt with more ring wins, winner +1000', () => {
  const n = start(5, { seed: 9 });
  for (const round of [1, 2]) {
    // Round 1: the challenger always wins (champion: the last shirt, one win). Round 2: the first shirt defends every bout.
    let last = { ...inner(n).scores };
    while (pub(n).phase !== 'champ') {
      last = { ...inner(n).scores };
      const { phase, turn } = pub(n);
      if (phase === 'draw' || phase === 'write') contribute(n, n.ids.filter(id => !me(n, id).finished));
      if (phase === 'make') stitchAll(n);
      if (phase === 'vote') for (const id of voters(n)) if (me(n, id).vote === undefined) n.send(id, { turn, k: 'vote', side: round === 1 ? 1 : 0 });
      n.advance(100);
    }
    const champ = inner(n).champs.at(-1)!, maker = champ.shirt.credits.maker;
    assert.equal(champ.wins, round === 1 ? 1 : 4);
    assert.equal(pub(n).champ!.bonus, PTS.champ);
    assert.equal(inner(n).scores[maker]! - last[maker]!, PTS.champ);
    if (round === 1) at(n, 'draw');
  }
  at(n, 'final-vote');
  assert.equal(n.view().music, 'vote', 'the main event vote gets the vote bed');
  const s = inner(n), [r1, r2] = s.clash!.sides, before = { ...s.scores };
  // Split the room evenly: round 2's champion has more ring wins and takes the tie.
  const v = voters(n), half = v.length % 2 ? v.slice(0, -1) : v;
  half.forEach((id, i) => n.send(id, { turn: pub(n).turn, k: 'vote', side: i % 2 }));
  at(n, 'final-result');
  const r = pub(n).final!.result!, maker = r2!.credits.maker;
  assert.equal(r.tie, true); assert.equal(r.tiebreak, true); assert.equal(r.winner, 1); assert.equal(r.bonus, PTS.finalWin);
  assert.equal(r.points[0].maker, half.length / 2 * PTS.finalMaker);
  if (r1!.credits.maker !== maker) assert.equal(s.scores[maker]! - before[maker]!, r.points[1].maker + PTS.finalWin + sumParts(r, maker));
  n.until(() => n.state.phase === 'podium');
  assert.ok(n.state.podium!.result.awards?.some(a => a.title === 'Champion Tailor' && a.playerId === maker));
});
/** Points a player earned from parts (not as maker) in a clash result. */
function sumParts(r: { credits: { maker: string; artist: string | null; writer: string | null }[]; points: { artist: number; writer: number }[] }, id: string) {
  return r.credits.reduce((sum, c, i) => sum + (c.artist === id && c.maker !== id ? r.points[i]!.artist : 0) + (c.writer === id && c.maker !== id ? r.points[i]!.writer : 0), 0);
}

test('missing input: house designs and slogans fill the hands; missing shirts are auto-stitched; pace scales timers', () => {
  const n = start(4, { settings: { timers: 'speedy' } });
  assert.equal(pub(n).deadline - pub(n).at, Math.round(75_000 * .7));
  at(n, 'write'); at(n, 'make');
  const s = inner(n);
  assert.ok(s.designs.length >= 12 && s.designs.every(d => d.by === null), 'nobody drew: house designs only');
  assert.ok(s.slogans.length >= 12 && s.slogans.every(x => x.by === null));
  for (const id of n.ids) assert.equal(me(n, id).hand!.designs.length, 3);
  at(n, 'show');
  assert.equal(s.order.length, 8);
  assert.ok(s.order.every(x => x.credits.auto && x.credits.artist === null && x.credits.writer === null));
  assert.equal(pub(n).bout!.sides[0].slogan.length > 0, true);
});

test('disconnects: absent players are not waited for, sit out votes and still get a shirt', () => {
  const n = start(5);
  n.connect('p4', false);
  at(n, 'draw'); contribute(n, n.ids.slice(0, 4)); n.advance(1600);
  assert.equal(pub(n).phase, 'write', 'advanced without p4');
  contribute(n, n.ids.slice(0, 4)); n.advance(1600);
  assert.equal(pub(n).phase, 'make');
  stitchAll(n, n.ids.slice(0, 4)); n.advance(1600);
  assert.equal(pub(n).phase, 'show');
  const auto = inner(n).order.find(x => x.credits.maker === 'p4')!;
  assert.equal(auto.credits.auto, true);
  n.until(() => pub(n).phase === 'vote' && !inner(n).clash!.sides.some(x => x.credits.maker === 'p4'));
  const deadline = pub(n).deadline;
  for (const id of voters(n)) if (id !== 'p4') n.send(id, { turn: pub(n).turn, k: 'vote', side: 0 });
  n.advance(1300);
  assert.equal(pub(n).phase, 'result'); assert.ok(n.now < deadline);
  n.connect('p4', true);
  assert.equal(me(n, 'p4').turn, pub(n).turn);
});

test('validation: stale turns, wrong phases, limits, duplicates, own bouts and strict fields', () => {
  const n = start(4), turn = pub(n).turn;
  rejects(n.trySend('p0', { turn: 'old', k: 'design', drawing: doodle }), /moved on/);
  rejects(n.trySend('p0', { turn, k: 'done' }), /at least one design/);
  rejects(n.trySend('p0', { turn, k: 'slogan', text: 'early' }), /Slogan time is over/);
  rejects(n.trySend('p0', { turn, k: 'design', drawing: { strokes: [] } }), /Draw something/);
  rejects(n.trySend('p0', { turn, k: 'design', drawing: { strokes: [{ color: '#05071a', width: .012, points: [{ x: .5, y: .5 }, { x: .5, y: .5 }] }] } }), /a bit more/);
  rejects(n.trySend('p0', { turn, k: 'design', drawing: { strokes: [{ color: 'red', width: .02, points: [{ x: 0, y: 0 }] }] } }), /Invalid drawing/);
  rejects(n.trySend('p0', { turn, k: 'design', drawing: doodle, extra: 1 }), /Unknown field/);
  rejects(n.trySend('p0', { turn, k: 'dance' }), /Unknown move/);
  for (let i = 0; i < MAX_DESIGNS; i++) n.send('p0', { turn, k: 'design', drawing: doodle });
  rejects(n.trySend('p0', { turn, k: 'design', drawing: doodle }), /rack is full/);
  assert.equal(me(n, 'p0').finished, true, 'a full rack counts as done');
  rejects(n.trySend('p0', { turn, k: 'done' }), /already done/);
  rejects(n.trySend('p1', { turn, k: 'vote', side: 0 }), /Voting opens/);
  rejects(n.trySend('p1', { turn, k: 'shirt', design: 'ss-1', slogan: 's1', color: 0, pos: 'top' }), /sewing room is closed/);
  contribute(n, ['p1', 'p2', 'p3']); n.advance(1600);
  const write = pub(n).turn;
  rejects(n.trySend('p1', { turn: write, k: 'slogan', text: '   ' }), /Type a slogan/);
  rejects(n.trySend('p1', { turn: write, k: 'slogan', text: 'x'.repeat(MAX_SLOGAN + 1) }), /under 40/);
  n.send('p1', { turn: write, k: 'slogan', text: '  Born\tto‮ Nap  ' });
  assert.deepEqual(me(n, 'p1').slogans, ['Born to Nap']);
  rejects(n.trySend('p1', { turn: write, k: 'slogan', text: 'born to nap!' }), /already wrote/);
  for (let i = 1; i < MAX_SLOGANS; i++) n.send('p1', { turn: write, k: 'slogan', text: `Slogan ${i}` });
  rejects(n.trySend('p1', { turn: write, k: 'slogan', text: 'one more' }), /Plenty/);
  contribute(n, ['p0', 'p2', 'p3']); n.advance(1600);
  const make = pub(n).turn, hand = me(n, 'p0').hand!;
  const shirt = { turn: make, k: 'shirt', design: hand.designs[0], slogan: hand.slogans[0]!.id, color: 0, pos: 'top' };
  rejects(n.trySend('p0', { ...shirt, color: 6 }), /whole number/);
  rejects(n.trySend('p0', { ...shirt, pos: 'middle' }), /top or the bottom/);
  rejects(n.trySend('p0', { ...shirt, slogan: 'nope' }), /your slogans/);
  rejects(n.trySend('p0', { turn: make, k: 'reroll', what: 'colour' }), /Reroll designs or slogans/);
  stitchAll(n); n.advance(1600);
  at(n, 'vote');
  const vote = pub(n).turn, maker = inner(n).clash!.sides[0].credits.maker, voter = voters(n)[0]!;
  rejects(n.trySend(maker, { turn: vote, k: 'vote', side: 1 }), /own bout/);
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 2 }), /whole number/);
  n.send(voter, { turn: vote, k: 'vote', side: 1 });
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /already in/);
  assert.equal(me(n, voter).vote, 1); assert.deepEqual(me(n, maker).mine, [0]);
  rejects(n.trySend(voter, { turn: vote, k: 'design', drawing: doodle }), /Drawing time is over/);
  at(n, 'result');
  rejects(n.trySend(voter, { turn: vote, k: 'vote', side: 0 }), /moved on/);
});

test('privacy: slogans, hands and makers stay secret until their reveal; drawings reach media only for sewing', () => {
  const n = start(4);
  n.send('p1', { turn: pub(n).turn, k: 'design', drawing: doodle });
  assert.deepEqual(n.view().media, {}, 'no drawings in media while drawing');
  assert.deepEqual(pub(n).counts, { p0: 0, p1: 1, p2: 0, p3: 0 });
  contribute(n); n.advance(1600);
  n.send('p2', { turn: pub(n).turn, k: 'slogan', text: 'Secret Sauce Slogan' });
  n.assertHidden('Secret Sauce Slogan');
  for (const id of ['p0', 'p1', 'p3']) n.assertHiddenFrom(id, 'Secret Sauce Slogan');
  contribute(n); n.advance(1600);
  at(n, 'make');
  assert.ok(Object.keys(n.view().media).length >= 16, 'designs are published for sewing');
  for (const id of n.ids) for (const x of me(n, id).hand!.slogans) n.assertHidden(x.text);
  const mine = me(n, 'p0').hand!;
  n.send('p0', { turn: pub(n).turn, k: 'shirt', design: mine.designs[0], slogan: mine.slogans[0]!.id, color: 3, pos: 'top' });
  for (const id of ['p1', 'p2', 'p3']) assert.ok(!JSON.stringify(me(n, id)).includes(me(n, 'p0').made![0]!.id), 'other phones never see your shirt');
  stitchAll(n); n.advance(1600);
  for (const phase of ['show', 'vote'] as const) {
    at(n, phase);
    const bout = JSON.stringify(pub(n).bout) + JSON.stringify(pub(n).ko);
    for (const id of n.ids) assert.ok(!bout.includes(`"${id}"`), `${phase} leaks ${id}`);
    assert.deepEqual(pub(n).done, []);
  }
  at(n, 'result');
  assert.deepEqual(pub(n).bout!.result!.credits.map(c => c.maker), inner(n).clash!.sides.map(x => x.credits.maker));
  for (const x of inner(n).order) assert.match(x.id, /^sh\d+$/);
  // Round 2: round 1's artwork leaves the media store, except the champion's (needed for the final).
  at(n, 'champ');
  const champ = inner(n).champs[0]!.shirt.design, old = Object.keys(n.view().media);
  at(n, 'draw');
  assert.deepEqual(Object.keys(n.view().media), [champ]);
  assert.ok(old.length > 1);
});

test('family filter: adult hints and house slogans only appear when family mode is off', () => {
  const adult = new Set([...ADULT_HINTS, ...ADULT_SLOGANS]);
  let seen = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const family = inner(start(10, { seed })), open = inner(start(10, { seed, settings: { family: false } }));
    assert.ok([...family.hints, ...family.house].every(x => !adult.has(x)), `seed ${seed}`);
    seen += [...open.hints, ...open.house].filter(x => adult.has(x)).length;
  }
  assert.ok(seen > 0, 'adult content is in the pool with family mode off');
});

test('night memory: a replay in the same night deals none of the first game’s ideas, hints or house slogans', async () => {
  const n = start(3, { seed: 8 }), bot = await loadBot('shirt-show');
  const read = () => { const s = inner(n); return [...Object.values(s.ideas).flat(), ...s.tv, ...s.slogans.filter(x => x.by === null).map(x => x.text)]; };
  const session = () => { const seen = new Set<string>(); n.runMini(input => { for (const x of read()) seen.add(x); return bot(input); }); return seen; };
  const first = session();
  n.startMini('shirt-show');
  const second = session();
  assert.ok(second.size >= 60, `${second.size} cards dealt`);
  assert.deepEqual([...second].filter(x => first.has(x)), []);
});
