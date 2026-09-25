/** Roll production (ENGINE §3.4) with the bank-shortage rule (port of legacy `production`). */
import { GOODS, RESOURCES, type Resource } from '../model';
import { boardIndex } from './board/lookup';
import { transfer } from './cards';
import { face } from './legal';
import { hooks } from './modules/registry';
import { bump, gained } from './stats';
import type { RollDraft, State } from './state';

/** Why a hex yields nothing this roll: the robber first, then module blockers (barbarians). */
function blocker(s: State, tile: string): 'robber' | 'barbarians' | null {
  if (s.pieces.robber === tile) return 'robber';
  for (const m of hooks(s, 'blocksTile')) {
    const by = m.blocksTile(s, tile);
    if (by) return by;
  }
  return null;
}

/**
 * Grants per building-hex pair (settlement or harbor 1, city 2), blocked yields, module `produce`
 * hooks, then the shortage rule: when the bank cannot pay everyone a good, nobody gets it, unless a
 * single seat is owed it, who gets what is left. Fills `roll.grants` (as paid), `blocked`, `shortages`.
 */
export function produce(s: State, roll: RollDraft) {
  const ix = boardIndex(s.board);
  for (const b of Object.values(s.pieces.buildings)) {
    const amount = b.kind === 'city' ? 2 : 1;
    for (const tile of ix.vertex.get(b.vertex)?.tiles ?? []) {
      const { terrain, number } = face(s, tile), good = terrain as Resource;
      if (number !== roll.total || !RESOURCES.includes(good)) continue;
      const by = blocker(s, tile);
      if (by) roll.blocked.push({ seat: b.seat, tile, good, amount, by });
      else roll.grants.push({ seat: b.seat, tile, good, amount });
    }
  }
  for (const m of hooks(s, 'produce')) m.produce(s, roll);
  for (const x of roll.blocked) bump(s, x.seat, 'blocked', x.amount);
  pay(s, roll);
}

function pay(s: State, roll: RollDraft) {
  const wanted = GOODS.filter(g => roll.grants.some(x => x.good === g));
  const refused = new Set(wanted.filter(g => {
    const list = roll.grants.filter(x => x.good === g), sum = list.reduce((n, x) => n + x.amount, 0);
    return sum > s.bank[g] && new Set(list.map(x => x.seat)).size > 1;
  }));
  const left = { ...s.bank };
  roll.grants = roll.grants.flatMap(x => {
    const amount = refused.has(x.good) ? 0 : Math.min(x.amount, left[x.good]);
    left[x.good] -= amount;
    return amount ? [{ ...x, amount }] : [];
  });
  roll.shortages = wanted.filter(g => !roll.grants.some(x => x.good === g));
  for (const x of roll.grants) {
    const cards = { [x.good]: x.amount };
    transfer(s.bank, s.seats[x.seat].hand, cards);
    gained(s, x.seat, cards, true);
  }
}
