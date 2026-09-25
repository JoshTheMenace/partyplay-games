/** CPU test helpers: seeded brains and a view-level legality check for CPU actions. */
import assert from 'node:assert/strict';
import { GOODS, type Action, type CpuLevel, type PrivateView, type PublicView } from '../../src/model';
import { decideStrict, type Brain } from '../../src/cpu/index';
import { validateAnswer } from '../../src/engine/commands';
import { seeded } from '../fixtures/board';

/**
 * This thread's CPU time in ms (not wall time), so decide() budgets hold while other suites or match
 * workers share the machine.
 */
export function cpuMs() {
  const u = process.threadCpuUsage?.() ?? process.cpuUsage();
  return (u.user + u.system) / 1000;
}

export const brain = (level: CpuLevel = 'normal', seed = 1, persona = 'trader'): Brain =>
  ({ level, persona, memory: null, random: seeded(seed) });

export const think = (pub: PublicView, me: PrivateView, b = brain()) => decideStrict(pub, me, b);

const n = (c: Partial<Record<string, number>>, g: string) => c[g] ?? 0;
const sum = (c: Partial<Record<string, number>>) => GOODS.reduce((s, g) => s + n(c, g), 0);

/** Asserts `a` is acceptable according to the views the CPU was given (mirrors the engine rules). */
export function assertLegal(pub: PublicView, me: PrivateView, a: Action | null, label = '') {
  if (!a) return;
  const at = `${label} ${JSON.stringify(a)}`;
  assert.equal(a.turnId, pub.turn.id, `turn id ${at}`);
  const hand = me.hand, mine = pub.offers.find(o => o.from === me.seat && !o.counterTo);
  switch (a.type) {
    case 'roll': return assert.ok(me.can.roll, at);
    case 'end': return assert.ok(me.can.end, at);
    case 'build': {
      const o = me.build.find(x => x.piece === a.piece);
      assert.ok(o && o.targets.includes(a.at) && (o.why === null || o.free > 0), at);
      return;
    }
    case 'buy-dev': return assert.equal(me.build.find(x => x.piece === 'development')?.why, null, at);
    case 'play-dev': return assert.ok(me.dev.find(d => d.id === a.card)?.playable, at);
    case 'answer': {
      const p = me.prompts.find(x => x.id === a.prompt);
      assert.ok(p, at);
      validateAnswer(p.command, a.picks, a.cards);
      return;
    }
    case 'command': {
      const c = me.commands.find(x => x.id === a.command);
      assert.ok(c, at);
      validateAnswer(c, a.picks, a.cards);
      return;
    }
    case 'bank': {
      assert.ok(me.can.bank, at);
      let lots = 0;
      for (const g of GOODS) {
        if (!n(a.give, g)) continue;
        assert.ok(n(a.give, g) % (me.rates[g] ?? 4) === 0 && !n(a.get, g) && n(hand, g) >= n(a.give, g), at);
        lots += n(a.give, g) / (me.rates[g] ?? 4);
      }
      assert.ok(lots === sum(a.get) && GOODS.every(g => n(pub.bank, g) >= n(a.get, g)), at);
      return;
    }
    case 'offer': {
      if (a.counterTo) assert.ok(me.offers.find(o => o.id === a.counterTo)?.canCounter, at);
      else assert.ok(me.can.propose && a.to.every(id => me.partners.includes(id)), at);
      assert.ok(sum(a.give) > 0 && sum(a.want) > 0 && GOODS.every(g => !(n(a.give, g) && n(a.want, g))), at);
      assert.ok(GOODS.every(g => n(hand, g) >= n(a.give, g)), at);
      return;
    }
    case 'respond': {
      const o = me.offers.find(x => x.id === a.offer);
      assert.ok(o && (a.answer === 'decline' || o.canAccept), at);
      return;
    }
    case 'confirm-trade': return assert.equal(mine?.responses[a.partner], 'accept', at);
    case 'withdraw': return assert.equal(mine?.id, a.offer, at);
    default: assert.fail(`unexpected ${at}`);
  }
}
