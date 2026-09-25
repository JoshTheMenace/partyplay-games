/** WP-theatre: queue, fly-out batching, strip text, finale flips and the static render. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadFixture } from '../fixtures/index';
import type { GameEvent, PublicView, RollEvent } from '../../src/model';
import { freshEvents, ROLL_MS } from '../../src/ui/shared/timeline';
import { DiceChip } from '../../src/ui/display/theatre/Dice';
import { gainsAt } from '../../src/ui/display/theatre/Gains';
import { stripModel } from '../../src/ui/display/theatre/payout';
import { enqueue, FLY, toBeat } from '../../src/ui/display/theatre/plan';
import { flipsAt, REVEAL } from '../../src/ui/display/theatre/reveal';
import { ProductionStrip } from '../../src/ui/display/theatre/Strip';

const roll = (pub: PublicView, over: Partial<RollEvent> = {}): RollEvent =>
  ({ ...pub.lastRoll!, ...over });
const landedBy = (pub: PublicView, e: GameEvent) =>
  Math.max(...toBeat(e, pub).flights.map(f => f.delay + f.ms));

test('10 seats all producing: every card lands within 1.5 s of the roll, in seat order', () => {
  const { pub } = loadFixture('max-10'), beat = toBeat(pub.lastRoll!, pub);
  assert.equal(new Set(pub.lastRoll!.grants.map(g => g.seat)).size, 10);
  assert.ok(beat.flights.length <= FLY.cap);
  assert.ok(landedBy(pub, pub.lastRoll!) <= ROLL_MS.settle, `last landing ${landedBy(pub, pub.lastRoll!)}`);
  assert.deepEqual([...new Set(beat.flights.map(f => f.seat))], pub.seats.map(s => s.id));
  assert.equal(beat.flights[0].delay, ROLL_MS.flyStart);
});

test('one flight per (seat, good) from the highest-pip hex; past 14 each seat merges into one', () => {
  const { pub } = loadFixture('max-10'), tiles = pub.board.tiles;
  const six = tiles.find(t => t.number === 6)!, low = tiles.find(t => t.number === 2 || t.number === 12)!;
  const grants = [
    { seat: 'p0', tile: low.id, good: 'ore' as const, amount: 1 },
    { seat: 'p0', tile: six.id, good: 'ore' as const, amount: 2 },
  ];
  const one = toBeat(roll(pub, { grants }), pub).flights;
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].goods, [{ good: 'ore', amount: 3 }]);
  assert.deepEqual(one[0].from, { tile: six.id });
  const many = pub.seats.flatMap(s =>
    (['wood', 'ore'] as const).map(good => ({ seat: s.id, tile: six.id, good, amount: 1 })));
  const merged = toBeat(roll(pub, { grants: many }), pub).flights;
  assert.equal(merged.length, 10);
  assert.deepEqual(merged[0].goods.map(g => g.good), ['wood', 'ore']);
  const fourteen = many.slice(0, 14), last = landedBy(pub, roll(pub, { grants: fourteen }));
  assert.equal(toBeat(roll(pub, { grants: fourteen }), pub).flights.length, 14);
  assert.ok(last <= ROLL_MS.settle, `14 flights land by ${last}`);
});

test('the queue plays beats in id order and skips old work past the 2.5 s backlog', () => {
  const { pub } = loadFixture('mid-4'), r = pub.lastRoll!;
  const rolls = [1, 2, 3].map(i => ({ ...r, id: 100 + i }));
  const one = enqueue([], [rolls[0]], pub, 1000);
  assert.equal(one[0].start, 1000);
  const two = enqueue(one, [rolls[1]], pub, 2000);
  assert.deepEqual(two.map(b => b.start), [1000, 1000 + ROLL_MS.settle], 'waits for the playing roll');
  // A third roll now makes 3.2 s of work: the older rolls jump to their end state, the newest plays.
  const three = enqueue(two, [rolls[2]], pub, 2100);
  const playing = three.filter(b => b.start + b.ms > 2100);
  assert.deepEqual(playing.map(b => [b.event.id, b.start]), [[103, 2100]]);
  assert.equal(three.length, 3, 'skipped beats keep their tails ("+n" chips)');
  // Non-animated events never enter the queue.
  assert.equal(enqueue([], [{ ...r, kind: 'dev-buy', seat: 'p0' } as GameEvent], pub, 0).length, 0);
});

test('a reload replays nothing older than 3 s', () => {
  const { pub } = loadFixture('mid-4'), now = pub.lastRoll!.at + 3500;
  assert.equal(freshEvents(pub.events, 0, now).some(e => e.kind === 'roll'), false);
  assert.equal(freshEvents(pub.events, 0, pub.lastRoll!.at + 2000).some(e => e.kind === 'roll'), true);
});

test('strip: payout chips, blocked, nobody produced, bank short', () => {
  const { pub } = loadFixture('mid-4'), model = stripModel(pub)!;
  const payout = new Map<string, number>();
  for (const g of pub.lastRoll!.grants) payout.set(g.seat, (payout.get(g.seat) ?? 0) + g.amount);
  const order = pub.seats.map(s => s.id).filter(id => payout.has(id));
  assert.deepEqual(model.chips.map(c => c.kind === 'gain' && [c.seat, c.total]),
    order.map(id => [id, payout.get(id)]));
  assert.deepEqual(model.notes, []);
  const tile = pub.lastRoll!.grants[0].tile;
  pub.lastRoll = roll(pub, {
    grants: [], shortages: ['ore'], blocked: [{ seat: 'p2', tile, good: 'ore', amount: 1, by: 'robber' }],
  });
  const blocked = stripModel(pub)!;
  assert.deepEqual(blocked.chips, [{ kind: 'blocked', seat: 'p2', goods: ['ore'] }]);
  assert.deepEqual(blocked.notes, ['Nobody produced', '·', 'Bank short: no ore paid']);
});

test('strip on a 7: live discards, then the robber move', () => {
  const { pub } = loadFixture('seven-discard-4'), model = stripModel(pub)!;
  assert.equal(model.tone, 'seven');
  assert.deepEqual(model.notes, ['Discarding', ...pub.prompts.flatMap(p => [{ seat: p.seat }, `${p.count}`])]);
  const robbed = loadFixture('seven-robber-4').pub;
  const tile = robbed.robberChoices[0].tiles[0].tile;
  robbed.events.push({ id: 99, at: 0, text: '', kind: 'robber', seat: 'p0', piece: 'robber', from: null, tile,
    victim: 'p1' });
  const moved = stripModel(robbed)!.notes;
  assert.match(String(moved[0]), /^Robber moved to /);
  assert.deepEqual(moved.slice(1), ['·', { seat: 'p1' }, 'robbed']);
});

test('finale: hidden cards flip one seat at a time in seat order', () => {
  const { pub } = loadFixture('finale-6'), at = pub.results!.finaleAt + REVEAL.start;
  const seatIndex = (id: string) => pub.seats.findIndex(s => s.id === id);
  const [first] = pub.results!.standings.filter(s => s.parts.some(p => p.hidden)).map(s => s.seat)
    .sort((a, b) => seatIndex(a) - seatIndex(b));
  const slot = at + seatIndex(first) * REVEAL.step;
  assert.deepEqual(flipsAt(pub, slot - 1, false), []);
  assert.equal(flipsAt(pub, slot + 250, false)[0].seat, first);
  assert.equal(flipsAt(pub, slot + 250, false)[0].hidden, 2);
  assert.deepEqual(flipsAt(pub, slot + 250, true), [], 'reduced motion shows end states only');
  assert.deepEqual(flipsAt(pub, at + 6 * REVEAL.step, false), []);
});

test('"+n" chips appear when the cards land and fade after 2 s; at once under reduced motion', () => {
  const { pub } = loadFixture('mid-4'), [beat] = enqueue([], [pub.lastRoll!], pub, 0);
  const f = beat.flights[0], land = f.delay + f.ms;
  assert.deepEqual(gainsAt([beat], f.seat, land - 1, false), []);
  assert.equal(gainsAt([beat], f.seat, land + 800, false)[0].opacity, 1);
  assert.deepEqual(gainsAt([beat], f.seat, land + 2001, false), []);
  assert.equal(gainsAt([beat], f.seat, 1, true)[0].opacity, 1);
});

test('static render: settled dice and a readable strip', () => {
  const { pub } = loadFixture('max-10');
  const dice = renderToStaticMarkup(createElement(DiceChip, { pub, reduced: false }));
  assert.match(dice, new RegExp(`Rolled ${pub.lastRoll!.total}`));
  const strip = renderToStaticMarkup(createElement(ProductionStrip, { pub, reduced: false }));
  assert.equal(strip.match(/island-settlers-strip-chip/g)?.length, 10);
  assert.match(strip, /data-tone="hot"/);
  const ck = loadFixture('ck-4').pub;
  assert.equal(renderToStaticMarkup(createElement(DiceChip, { pub: ck, reduced: true }))
    .match(/island-settlers-die"/g)?.length, ck.lastRoll!.eventDie ? 3 : 2);
});
