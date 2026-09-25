/** Development card timing: knights, Road Building, Year of Plenty and Monopoly. */
import { RESOURCES, type Action, type Cards, type DevKind, type Resource } from '../model';
import { count, missing, total } from './cards';
import { act, type Ctx } from './context';
import { option, type Target } from './plan';
import { robbedPips } from './robber';

const card = (c: Ctx, kind: DevKind) => c.me.dev.find(d => d.kind === kind && d.playable);

/** Bank supply per resource by table size (ENGINE §8.1), to estimate what others hold. */
const supply = (n: number) => (n <= 4 ? 19 : n <= 6 ? 24 : n <= 8 ? 30 : 35);

/** A knight now: the robber blocks us, or it wins or defends Largest Army. */
export function knightWorth(c: Ctx) {
  const mine = c.pub.seats.find(s => s.id === c.seat)?.knights ?? 0;
  const top = Math.max(0, ...c.pub.seats.filter(s => s.id !== c.seat).map(s => s.knights));
  const army = c.pub.awards['largest-army'] !== c.seat && mine + 1 >= 3 && mine + 1 > top;
  const behind = c.k.blocking && c.leader !== null && (c.vp.get(c.leader) ?? 0) >= c.me.vp + 2;
  return robbedPips(c) >= 3 || army || behind;
}

export function devAction(c: Ctx, top: Target | undefined, rolling: boolean): Action | null {
  const knight = card(c, 'knight');
  if (knight && knightWorth(c)) return act(c, { type: 'play-dev', card: knight.id, goods: [] });
  if (rolling || !top) return null;
  const lack = missing(c.me.hand, top.next.cost);
  const roads = card(c, 'road-building'), road = option(c, 'road') ?? option(c, 'ship');
  if (roads && top.goal === 'road' && road && road.targets.length && (road.left ?? 0) >= 2) {
    return act(c, { type: 'play-dev', card: roads.id, goods: [] });
  }
  const plenty = card(c, 'plenty'), need = missing(c.me.hand, top.cost);
  if (plenty && total(lack) > 0 && total(lack) <= 2) {
    // Exactly two cards (fewer only when the bank is that short): what we lack, then what the plan needs.
    const left: Cards = { ...c.pub.bank }, goods: Resource[] = [];
    const fewest = [...RESOURCES].sort((a, b) => count(c.me.hand, a) - count(c.me.hand, b));
    const wish = [...RESOURCES.flatMap(r => Array<Resource>(count(lack, r)).fill(r)),
      ...RESOURCES.filter(r => count(need, r) > count(lack, r)), ...fewest, ...fewest];
    for (const r of wish) {
      if (goods.length < 2 && count(left, r) > 0) { goods.push(r); left[r] = count(left, r) - 1; }
    }
    if (goods.length === Math.min(2, total(c.pub.bank))) {
      return act(c, { type: 'play-dev', card: plenty.id, goods });
    }
  }
  const monopoly = card(c, 'monopoly');
  if (monopoly) {
    const held = (r: Resource) => supply(c.pub.seats.length) - count(c.pub.bank, r) - count(c.me.hand, r);
    const worth = (r: Resource) => held(r) + 2 * count(need, r);
    const r = RESOURCES.reduce((a, b) => (worth(b) > worth(a) ? b : a));
    if (held(r) >= (count(need, r) ? 4 : 6)) return act(c, { type: 'play-dev', card: monopoly.id, goods: [r] });
  }
  return null;
}
