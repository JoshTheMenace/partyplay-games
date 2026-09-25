/** WP-trade-ui logic: composer taps, bank lots, reasons, offer ordering and TV fitting. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Offer } from '../../src/model';
import { loadFixture } from '../fixtures/index';
import {
  bankFill, bankProblem, counterDraft, fullCount, lotNeedText, lots, offerProblem, quickOffers, railOrder, ratioText,
  summaryText, tapBankGet, tapBankGive, tapSide, waitingOnMe,
} from '../../src/ui/trade/logic';

const R = ['wood', 'brick', 'wool', 'grain', 'ore'] as const;
const four = { wood: 4, brick: 4, wool: 4, grain: 4, ore: 4 };

test('composer taps: give is capped by the hand and a good sits on one side only', () => {
  const hand = { wool: 2, ore: 1 };
  let d = tapSide({ give: {}, want: {} }, 'give', 'wool', hand);
  d = tapSide(d, 'give', 'wool', hand);
  assert.deepEqual(tapSide(d, 'give', 'wool', hand), d, 'no third wool');
  d = tapSide(d, 'want', 'wool', hand);
  assert.deepEqual(d, { give: {}, want: { wool: 1 } });
  assert.equal(summaryText({ give: { ore: 1 }, want: { wool: 2 } }), 'You give 1 ore, you get 2 wool');
  assert.equal(summaryText({ give: {}, want: { wool: 1 } }), 'You get 1 wool');
});

test('quick offers use the largest piles, never the wanted good, only while Give is empty', () => {
  const hand = { wood: 1, brick: 4, wool: 2, grain: 3, ore: 5 };
  assert.deepEqual(quickOffers(hand, { give: {}, want: { ore: 1 } }, [...R]),
    [{ brick: 1 }, { grain: 1 }, { wool: 1 }]);
  assert.deepEqual(quickOffers(hand, { give: {}, want: { ore: 3 } }, [...R]), [{ brick: 3 }, { grain: 3 }]);
  assert.deepEqual(quickOffers(hand, { give: { wood: 1 }, want: { ore: 1 } }, [...R]), []);
  assert.deepEqual(quickOffers(hand, { give: {}, want: { ore: 1, wool: 1 } }, [...R]), []);
});

test('offer reasons: paired turns quote why.propose; counters follow canCounter', () => {
  const f = loadFixture('paired-6'), me = f.views.p3;
  assert.equal(offerProblem(me, { give: {}, want: {} }, null), 'Build turns trade with the bank only');
  assert.equal(offerProblem(me, { give: { wool: 1 }, want: { ore: 1 } }, false), "You can't counter this offer");
  const mid = loadFixture('mid-4').views.p0;
  assert.equal(offerProblem(mid, { give: { ore: 1 }, want: {} }, null), 'Choose what you want');
  assert.equal(offerProblem(mid, { give: { ore: 9 }, want: { wool: 1 } }, null), 'You no longer have those cards');
  assert.equal(offerProblem(mid, { give: { ore: 1 }, want: { wool: 1 } }, null), null);
});

test('bank lots mix 4:1, 3:1 and 2:1 and must match the cards you get', () => {
  const rates = { wood: 4, brick: 3, wool: 2 }, hand = { wood: 8, brick: 3, wool: 4 }, bank = { ore: 5, grain: 1 };
  assert.equal(lots({ wood: 8, brick: 3, wool: 2 }, rates), 4);
  assert.equal(lots({ wood: 3 }, rates), -1);
  assert.equal(bankProblem({ wood: 4, wool: 2 }, { ore: 2 }, rates, hand, bank), null);
  assert.equal(bankProblem({ wood: 4, wool: 2 }, { ore: 1 }, rates, hand, bank), 'Pick 1 more to get');
  assert.equal(bankProblem({ wood: 4 }, { grain: 2 }, rates, hand, bank), 'The bank has only 1 grain');
  assert.equal(bankProblem({ wood: 4 }, { wood: 1 }, rates, hand, bank), 'Get a different good than you give');
  assert.equal(ratioText({ wood: 4, wool: 2 }, rates), '2:1 + 4:1');
});

test('bank taps: give fills a whole lot, get auto-fills and repeats lots while the hand allows', () => {
  const rates = { ...four, wool: 2 }, hand = { wool: 5, ore: 4 }, bank = { ore: 9, brick: 9, grain: 0 };
  let d = tapBankGive({ bankGive: {}, bankGet: {} }, 'wool', hand, rates);
  assert.deepEqual(d.bankGive, { wool: 2 });
  assert.deepEqual(tapBankGive(d, 'grain', hand, rates), d, 'no grain to give');
  d = tapBankGet(d, 'brick', hand, rates, bank, [...R]);
  d = tapBankGet(d, 'brick', hand, rates, bank, [...R]);
  assert.deepEqual(d, { bankGive: { wool: 4 }, bankGet: { brick: 2 } });
  assert.deepEqual(tapBankGet(d, 'brick', hand, rates, bank, [...R]), d, 'no third wool lot');
  assert.deepEqual(tapBankGet(d, 'grain', hand, rates, bank, [...R]), d, 'empty pile');
  const auto = tapBankGet({ bankGive: {}, bankGet: {} }, 'brick', hand, rates, bank, [...R]);
  assert.deepEqual(auto, { bankGive: { wool: 2 }, bankGet: { brick: 1 } }, 'best rate first');
  assert.deepEqual(bankFill({ ore: 4 }, { brick: 1 }, four, bank, [...R]), { ore: 4 });
  assert.equal(bankFill({ ore: 3 }, { brick: 1 }, four, bank, [...R]), null);
});

test('unaffordable bank text names the harbour or the better rates', () => {
  assert.equal(lotNeedText(four, [...R]), 'You need 4 of one resource (or a harbour)');
  assert.equal(lotNeedText({ ...four, wool: 2 }, [...R]), 'You need 2 wool or 4 of any other resource');
  assert.equal(lotNeedText({ wood: 3, brick: 3, wool: 3, grain: 3, ore: 3 }, [...R]), 'You need 3 of one resource');
});

test('counter drafts mirror the offer, target its proposer and clamp Give to the hand', () => {
  const offer = loadFixture('mid-4').pub.offers[0];
  assert.deepEqual(counterDraft(offer, { wool: 1 }),
    { seg: 'players', to: ['p0'], counterTo: 'o1', want: { ore: 1 }, give: { wool: 1 } });
});

test('rail order nests counters under their parent; waiting counts pending answers only', () => {
  const f = loadFixture('offers-12'), order = railOrder(f.pub.offers);
  const parent = (o: Offer) => order.findIndex(x => x.id === o.counterTo);
  for (const [i, o] of order.entries()) if (o.counterTo) assert.ok(parent(o) >= 0 && parent(o) < i, o.id);
  assert.equal(order.length, 12);
  const mid = loadFixture('mid-4');
  assert.deepEqual(waitingOnMe(mid.pub, 'p1').map(o => o.id), ['o1']);
  assert.deepEqual(waitingOnMe(mid.pub, 'p3'), [], 'p3 already accepted');
});

test('TV rail fits: up to 3 full cards, fewer when the slot is short', () => {
  assert.equal(fullCount(2), 2);
  assert.equal(fullCount(12), 3);
  assert.equal(fullCount(5, 632), 2);
  assert.equal(fullCount(12, 632), 1);
  assert.equal(fullCount(12, 400), 1, 'always at least one full card');
});
