/** Merchant Trains: oasis, camel trains, sealed simultaneous bids, placement, bonuses, CPU matches. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Settings } from '../../src/model';
import { boardIndex } from '../../src/engine/board/lookup';
import { camelSites, cx, nextVote, placeCamel } from '../../src/engine/modules/caravans';
import type { State } from '../../src/engine/state';
import { runMatch } from '../cpu/match';
import { act, answer, edit, game, inventory, pub, serializable, tick, unchanged, view } from '../helpers';
import { blank, give, lay, last, settle, toMain } from '../rules/helpers';

const CARAVANS: Partial<Settings> = { scenarios: ['caravans'] };
const bids = (s: State) => pub(s).prompts.filter(p => p.kind === 'caravans/bid').map(p => p.seat);

/** Active seat `a` upgrades a settlement (collecting a camel) and ends its turn: the vote opens. */
function collect(settings = CARAVANS) {
  const s = blank(game(4, settings)), [a] = s.order, v = s.board.vertices.find(x => x.tiles.length === 3)!.id;
  settle(s, a, v);
  toMain(s, 3);
  give(s, a, { grain: 2, ore: 3 });
  act(s, a, { type: 'build', piece: 'city', at: v });
  return { s, v };
}

test('board: the oasis replaces the desert, the robber starts off the board, 3 alternate starts', () => {
  for (const seats of [4, 6, 10]) {
    const s = game(seats, CARAVANS), ix = boardIndex(s.board);
    const oasis = s.board.tiles.filter(t => t.terrain === 'oasis');
    assert.equal(oasis.length, 1);
    assert.equal(oasis[0].number, 0);
    if (seats === 4) assert.equal(s.pieces.robber, null, 'the only desert became the oasis');
    const corners = ix.tileVertices.get(oasis[0].id)!, starts = cx(s).starts;
    assert.equal(starts.length, 3);
    const at = starts.map(v => corners.indexOf(v));
    assert.ok(at.every(i => i % 2 === at[0] % 2), 'alternate corners');
    assert.ok(camelSites(s).every(e => !ix.edge.get(e)!.tiles.includes(oasis[0].id)), 'trains face away');
    assert.deepEqual(game(seats, CARAVANS).board, s.board, 'deterministic');
  }
});

test('trains: nose to tail, no branching, each start corner used once', () => {
  const s = game(4, CARAVANS), ix = boardIndex(s.board), [a] = s.order, start = cx(s).starts[0];
  const first = camelSites(s).find(e => [ix.edge.get(e)!.a, ix.edge.get(e)!.b].includes(start))!;
  edit(s, n => placeCamel(n, a, first));
  const seg = cx(s).trains[0];
  assert.equal(seg.from, start);
  const next = camelSites(s);
  const at = (v: string) => (e: string) => [ix.edge.get(e)!.a, ix.edge.get(e)!.b].includes(v);
  assert.ok(next.some(at(seg.to)), 'extends from the front');
  assert.ok(!next.some(at(start)), 'the start is taken');
  assert.equal(Object.values(s.pieces.units).filter(u => u.kind === 'camel').length, 1);
  edit(s, n => placeCamel(n, a, next.find(at(seg.to))!));
  assert.ok(!camelSites(s).some(at(seg.to)), 'no branching');
});

test('vote: sealed simultaneous bids; the most-voted edge wins; bids are paid to the bank', () => {
  const { s } = collect(), [a, b, c] = s.order;
  give(s, b, { wool: 2 });
  give(s, c, { grain: 1 });
  const stock = inventory(s);
  act(s, a, { type: 'end' });
  assert.deepEqual(bids(s).sort(), [b, c].sort(), 'only seats holding wool or grain bid');
  assert.equal(pub(s).ext.caravans!.bidding, true);
  const [e1, e2] = camelSites(s);
  unchanged(s, () => answer(s, b, 'caravans/bid', {}, { bid: { wool: 2 } }), /where your votes go/);
  answer(s, b, 'caravans/bid', { edge: e1 }, { bid: { wool: 2 } });
  assert.equal(pub(s).seats.find(x => x.id === b)!.cards, 2, 'nothing is paid before the reveal');
  assert.ok(!JSON.stringify(pub(s).ext).includes(e1), 'the bid stays secret');
  assert.throws(() => act(s, s.order[1], { type: 'end' }), /Waiting/);
  answer(s, c, 'caravans/bid', { edge: e2 }, { bid: { grain: 1 } });
  assert.deepEqual(cx(s).trains.map(t => t.edge), [e1]);
  assert.equal(s.seats[b].hand.wool, 0);
  assert.deepEqual(inventory(s), stock, 'bids go to the bank');
  assert.match(last(s, 'module')!.text, /camel/);
  assert.ok(s.events.some(e => e.kind === 'module' && e.name === 'bids'), 'bids revealed together');
  assert.equal(s.turn.active, s.order[1], 'the turn moved on');
});

test('vote: tied edges go to the unique top bidder; a full tie lets the owner place', () => {
  const { s } = collect(), [a, b, c, d] = s.order;
  give(s, b, { wool: 2 });
  give(s, c, { grain: 1 });
  give(s, d, { wool: 1 });
  act(s, a, { type: 'end' });
  const [e1, e2] = camelSites(s);
  answer(s, b, 'caravans/bid', { edge: e1 }, { bid: { wool: 2 } });
  answer(s, c, 'caravans/bid', { edge: e2 }, { bid: { grain: 1 } });
  answer(s, d, 'caravans/bid', { edge: e2 }, { bid: { wool: 1 } });
  assert.deepEqual(cx(s).trains.map(t => t.edge), [e1]);
  assert.equal(cx(s).lastWinner, b);
  const t = collect(), [a2, b2, c2] = t.s.order;
  give(t.s, b2, { wool: 1 });
  give(t.s, c2, { wool: 1 });
  act(t.s, a2, { type: 'end' });
  const [f1, f2, f3] = camelSites(t.s);
  answer(t.s, b2, 'caravans/bid', { edge: f1 }, { bid: { wool: 1 } });
  answer(t.s, c2, 'caravans/bid', { edge: f2 }, { bid: { wool: 1 } });
  assert.deepEqual(pub(t.s).prompts.map(p => [p.seat, p.kind]), [[a2, 'caravans/place']]);
  answer(t.s, a2, 'caravans/place', { edge: f3 });
  assert.deepEqual(cx(t.s).trains.map(x => x.edge), [f3]);
});

test('vote: nobody able to bid means the owner places; auto bids nothing and places for the owner', () => {
  const { s } = collect(), [a] = s.order;
  act(s, a, { type: 'end' });
  assert.deepEqual(pub(s).prompts.map(p => [p.seat, p.kind]), [[a, 'caravans/place']]);
  tick(s, pub(s).prompts[0].deadline! + 1);
  assert.equal(cx(s).trains.length, 1, 'the auto-placement used the owner\'s best edge');
  assert.ok(!view(s, a).prompts.length);
});

test('bonuses: a camel doubles its route edge; a building between two camels earns +1 VP', () => {
  const s = blank(game(4, CARAVANS)), ix = boardIndex(s.board), [a] = s.order, start = cx(s).starts[0];
  const first = camelSites(s).find(e => [ix.edge.get(e)!.a, ix.edge.get(e)!.b].includes(start))!;
  edit(s, n => placeCamel(n, a, first));
  const mid = cx(s).trains[0].to;
  const second = camelSites(s).find(e => [ix.edge.get(e)!.a, ix.edge.get(e)!.b].includes(mid))!;
  edit(s, n => placeCamel(n, a, second));
  lay(s, a, [first]);
  assert.equal(s.seats[a].longestRoute, 2, 'one road under a camel counts as two');
  settle(s, a, mid);
  const part = view(s, a).parts.find(p => p.key === 'caravans');
  assert.deepEqual(part, { key: 'caravans', label: 'Between two camels', points: 1, count: 1 });
  assert.ok(pub(s).hud.some(h => h.key === 'camels' && h.kind === 'track' && h.value === 2));
});

test('Cities & Knights: bids are brick and wood (official combination)', () => {
  const s = blank(game(4, { ...CARAVANS, citiesKnights: true })), [a, b] = s.order;
  give(s, b, { brick: 1, wool: 3 });
  edit(s, n => { cx(n).owed.push(a); nextVote(n); });
  const p = view(s, b).prompts.find(x => x.kind === 'caravans/bid')!, f = p.command.fields[0];
  assert.deepEqual(f.kind === 'cards' && f.allowed, ['brick', 'wood']);
});

test('Connect: camels collected in the window are voted on when the round ends', () => {
  const { s } = collect({ ...CARAVANS, mode: 'connect' }), [, b] = s.order;
  give(s, b, { grain: 1 });
  for (const id of s.order) act(s, id, { type: 'end' });
  tick(s, s.now + 3000);
  assert.ok(bids(s).includes(b));
  answer(s, b, 'caravans/bid', {}, { bid: {} });
  assert.equal(cx(s).trains.length, 0, 'a zero bid leaves the owner to place');
  assert.equal(pub(s).prompts[0].kind, 'caravans/place');
});

for (const mode of ['standard', 'connect'] as const) {
  test(`CPU matches (${mode}, 4 and 10 seats) finish by target; goods conserved`, () => {
    for (const seats of [4, 10]) for (const seed of [1, 2]) {
      const r = runMatch({ seats, seed, settings: { ...CARAVANS, mode } });
      assert.deepEqual(r.rejected.slice(0, 3), [], `${seats} seats seed ${seed}`);
      assert.equal(r.reason, 'target', `${seats} seats seed ${seed}: ${r.reason} after ${r.rounds} rounds`);
      assert.ok(cx(r.s).trains.length > 0, 'camels were placed');
      assert.deepEqual(inventory(r.s), inventory(game(seats, { ...CARAVANS, mode }, seed)));
      serializable(r.s);
    }
  });
}
