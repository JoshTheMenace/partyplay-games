/** Trade fairness: same answers for humans and CPUs, leader embargo, never offers what it would refuse. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cards, CpuLevel, Offer } from '../../src/model';
import { loadFixture } from '../fixtures/index';
import { me } from '../fixtures/private';
import { brain, think } from './helpers';

/** mid-4 with a single open offer from `from` to `to`, and `to`'s view. */
function offered(from: string, to: string, give: Cards, want: Cards, o: { vp?: number; cpu?: boolean } = {}) {
  const f = loadFixture('mid-4'), seat = f.pub.seats.find(s => s.id === from)!;
  Object.assign(seat, { cpu: o.cpu ?? seat.cpu, vp: o.vp ?? seat.vp });
  const offer: Offer = {
    id: 'ox', at: f.now, from, to: [to], broadcast: false, give, want, counterTo: null,
    responses: { [to]: 'pending' }, reasons: {}, expires: null,
  };
  f.pub.offers = [offer];
  return { pub: f.pub, view: me(f.pub, to, f.views[to].hand) };
}

const answer = (from: string, to: string, give: Cards, want: Cards, level: CpuLevel, o = {}) => {
  const { pub, view } = offered(from, to, give, want, o);
  return think(pub, view, brain(level, 5)).action;
};

test('identical offers from a human and a CPU get identical answers', () => {
  const deals: [Cards, Cards][] = [
    [{ ore: 1 }, { wool: 1 }], [{ wood: 1 }, { wool: 2 }], [{ grain: 1 }, { wool: 1 }],
  ];
  for (const level of ['easy', 'normal', 'sharp'] as const) for (const [give, want] of deals) {
    assert.deepEqual(answer('p0', 'p1', give, want, level, { cpu: false }),
      answer('p0', 'p1', give, want, level, { cpu: true }));
  }
});

test('Normal and Sharp decline anything from a seat at target - 2 VP, with a reason', () => {
  for (const level of ['normal', 'sharp'] as const) {
    const a = answer('p0', 'p1', { ore: 2, grain: 1 }, { wool: 1 }, level, { vp: 8 });
    assert.ok(a?.type === 'respond' && a.answer === 'decline' && a.reason?.includes('8 VP'), JSON.stringify(a));
  }
});

test('a generous offer is accepted when not embargoed', () => {
  const a = answer('p0', 'p1', { ore: 2, grain: 1 }, { wool: 1 }, 'normal', { vp: 3 });
  assert.ok(a?.type === 'respond' && a.answer === 'accept', JSON.stringify(a));
});

test('never offers what it would not accept: its own proposal, mirrored, is accepted', () => {
  let checked = 0;
  for (const name of ['concurrent-8', 'ck-4', 'mid-4', 'connect-6'] as const) {
    const f = loadFixture(name);
    for (const view of Object.values(f.views)) {
      f.pub.offers = [];
      const fresh = me(f.pub, view.seat, view.hand, { commands: view.commands, prompts: view.prompts });
      const a = think(f.pub, fresh, brain('normal', 2)).action;
      if (a?.type !== 'offer') continue;
      const partner = f.pub.seats.find(s => s.id !== view.seat && s.vp < 5)!;
      f.pub.offers = [{
        id: 'mirror', at: f.now, from: partner.id, to: [view.seat], broadcast: false,
        give: a.want, want: a.give, counterTo: null, responses: { [view.seat]: 'pending' }, reasons: {}, expires: null,
      }];
      const again = me(f.pub, view.seat, view.hand, { commands: view.commands });
      const back = think(f.pub, again, brain('normal', 2)).action;
      assert.ok(back?.type === 'respond' && back.answer === 'accept', `${name}/${view.seat} ${JSON.stringify(back)}`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'at least one proposal was checked');
});

test('Easy never proposes; Sharp may counter an unattractive offer', () => {
  const f = loadFixture('concurrent-8');
  f.pub.offers = [];
  const view = me(f.pub, 'p2', f.views.p2.hand);
  assert.notEqual(think(f.pub, view, brain('easy', 1)).action?.type, 'offer');
  const counter = answer('p0', 'p1', { wood: 1 }, { wool: 3 }, 'sharp', { vp: 3 });
  assert.ok(counter?.type === 'offer' || counter?.type === 'respond');
  if (counter?.type === 'offer') assert.equal(counter.counterTo, 'ox');
});
