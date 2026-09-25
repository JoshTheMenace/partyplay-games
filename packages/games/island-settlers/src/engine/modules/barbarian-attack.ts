/**
 * Barbarian Attack (Traders & Barbarians, 2025 rules). Every building placed after setup lands 3
 * barbarians on the coast; 3 on a hex conquer it. Seats buy defense cards for guards, march them
 * after building, and expel invaders at the end of each turn for prisoners (2 = 1 VP). No robber:
 * a 7 robs a player of the roller's choice. With Cities & Knights (official combination) the ship
 * event die and each city improvement land barbarians instead of the barbarian track, guards are
 * C&K knights (recruit, activate, promote; strength 1–3), and 3 prisoners make 1 VP.
 */
import { COSTS, type Command, type Good, type HudItem, type SeatId, type Why } from '../../model';
import { boardIndex } from '../board/lookup';
import { command } from '../commands';
import { openPrompt } from '../prompts';
import { shuffle } from '../rng';
import { pushEffect, random, seatName, type State } from '../state';
import { expel } from './barbarian-attack/battle';
import { defenseDeck, drawDefense, openSteal, PROMPTS } from './barbarian-attack/cards';
import {
  ba, ck, conquered, conqueredAt, decorateCastle, facts, invade, invaded, onBoard, setInvaders,
  stake, touchesConquered, type BaExt,
} from './barbarian-attack/coast';
import { guardCommands, guards, march, movePrompt } from './barbarian-attack/guards';
import { ckCommands, ckApply, landForImprovements } from './barbarian-attack/knights';
import {
  emptyPurse, GOLD_IDS, goldCommands, goldTrade, mayBuild, purse, purseOwner,
} from './deliveries/gold';
import type { Module } from './registry';

const HOLD: Why = { code: 'rule', text: 'Barbarians hold this hex' };
const corner = (s: State, v: string) =>
  (touchesConquered(s, boardIndex(s.board).vertex.get(v)!.tiles) ? HOLD : null);
const ID = 'barbarian-attack' as const;

function commands(s: State, seat: SeatId): Command[] {
  const out = [...guardCommands(s, seat), ...goldCommands(s, seat, ID)];
  if (ck(s)) return [...ckCommands(s, seat), ...out];
  if (mayBuild(s, seat)) {
    const threat = invaded(s).filter(t => stake(s, seat, t) > 0).length > guards(s, seat).length;
    out.unshift(command({
      id: 'ba-card', module: ID, group: 'barbarians', label: 'Buy a defense card', cost: COSTS.development,
      detail: 'Played at once: Knighthood, Swift Knight, Capture or Treason.',
      hint: threat ? 0.8 : 0.55,
    }));
  }
  return out;
}

/** Ports next to conquered buildings do not trade. */
function rates(s: State, seat: SeatId, r: Record<Good, number>) {
  const { portAt } = boardIndex(s.board);
  const mine = Object.values(s.pieces.buildings).filter(b => b.seat === seat);
  const lost = mine.filter(b => conqueredAt(s, b.vertex)).flatMap(b => portAt.get(b.vertex) ?? []);
  const kept = mine.filter(b => !conqueredAt(s, b.vertex)).flatMap(b => portAt.get(b.vertex) ?? []);
  for (const g of Object.keys(r) as Good[]) {
    const fits = (p: { good: string; ratio: number }) => p.good === 'any' || p.good === g;
    const honest = Math.min(s.profile.bankRate, ...kept.filter(fits).map(p => p.ratio));
    if (r[g] < honest && lost.some(p => fits(p) && p.ratio === r[g])) r[g] = honest;
  }
}

export const barbarianAttack: Module<BaExt> = {
  id: ID,
  profile(p) {
    // Official Seafarers combination: neither the robber nor the pirate is used.
    Object.assign(p, { robber: false, pirate: false, largestArmy: false, coastalBarbarians: true });
    Object.assign(p, { devCards: false, movementLocksBuilding: true, setupPieces: [p.setupPieces[0], 'city'] });
  },
  board: { decorate: decorateCastle },
  init(s) {
    const x: BaExt = {
      ...emptyPurse(s, 0), prisoners: Object.fromEntries(s.order.map(id => [id, 0])),
      deck: shuffle(defenseDeck(), random(s, 'cards')), discard: [],
      moved: [], promoted: [], improvements: {},
    };
    const start = (t: string) => [2, 12].includes(boardIndex(s.board).tile.get(t)?.number ?? 0);
    for (const t of facts(s).coast.filter(start)) setInvaders(s, t, 1);
    return x;
  },
  beforeProduce(s, roll) {
    landForImprovements(s);
    if (ck(s) && roll.eventDie === 'ship' && roll.total !== 7) invade(s, 1, 'ship', roll.total);
    const edge = roll.total === 2 || roll.total === 12;
    if (edge && s.modules.includes('deliveries')) invade(s, 1, 'roll', roll.total);
  },
  onSeven(s, seat) {
    if (seat) pushEffect(s, { type: 'module', module: ID, name: 'seven', data: seat });
    return 'replace';
  },
  effects: { seven: (s, seat) => openSteal(s, String(seat)) },
  blocksTile: (s, t) => (conquered(s, t) ? 'barbarians' : null),
  legal: {
    settlement: (s, _, v) => corner(s, v),
    city: (s, _, v) => corner(s, v),
    // Ships may still be built beside conquered hexes (official Seafarers combination).
    route: (s, _, e, kind) => (kind === 'road' && touchesConquered(s, boardIndex(s.board).edge.get(e)!.tiles)
      ? HOLD : null),
  },
  rates,
  commands,
  apply(s, seat, id, a) {
    if (id === 'ba-card') return drawDefense(s, seat);
    if (id === 'ba-march') return march(s, seat);
    if (GOLD_IDS.has(id)) return goldTrade(s, seat, id, a);
    const data = a.picks.guard;
    if (id === 'ba-move') return void openPrompt(s, { seat, kind: `${ID}/move`, scope: 'self', data });
    ckApply(s, seat, id, a);
  },
  prompts: { ...PROMPTS, move: movePrompt },
  onBuild(s, seat, piece) {
    landForImprovements(s);
    if (s.turn.stage !== 'setup' && piece.kind === 'building') invade(s, 3, seatName(s, seat));
  },
  onOpportunityStart(s, seat) {
    const x = ba(s), mine = new Set(guards(s, seat).map(g => g.id));
    x.moved = x.moved.filter(id => !mine.has(id));
    x.promoted = x.promoted.filter(id => !mine.has(id));
    if (purseOwner(s) === ID) x.bought[seat] = 0;
  },
  onOpportunityEnd(s, seat) {
    landForImprovements(s);
    const castle = new Set(facts(s).castleEdges), stuck = guards(s, seat).filter(g => castle.has(g.at));
    if (stuck.length) march(s, seat, stuck.map(g => g.id));
    expel(s);
  },
  score(s, seat) {
    const n = ba(s).prisoners[seat], per = ck(s) ? 3 : 2;
    const parts = [{ key: 'prisoners', label: 'Prisoners', points: Math.floor(n / per), count: n }];
    const lost = Object.values(s.pieces.buildings).filter(b => b.seat === seat && conqueredAt(s, b.vertex));
    const points = lost.reduce((p, b) => p + (b.kind === 'city' ? 2 : 1), 0);
    if (lost.length) {
      parts.push({ key: 'conquered', label: 'Conquered buildings', points: -points, count: lost.length });
    }
    return parts;
  },
  publicView: s => ({ castle: facts(s).castle ?? '', prisoners: { ...ba(s).prisoners } }),
  hud(s): HudItem[] {
    const hexes = invaded(s), castle = new Set(facts(s).castleEdges);
    const defense = guards(s).filter(g => !castle.has(g.at)).length;
    return [
      { kind: 'track', key: 'ba-invaders', label: `Invaders on ${hexes.length} hexes`, value: onBoard(s),
        max: facts(s).coast.length * 3, alert: hexes.some(t => conquered(s, t)), icon: 'barbarian' },
      { kind: 'versus', key: 'ba-defense', label: 'Coast defense', left: { label: 'Guards', value: defense },
        right: { label: 'Invaders', value: onBoard(s) } },
    ];
  },
  badges(s, seat) {
    const n = ba(s).prisoners[seat], per = ck(s) ? 3 : 2, out = [
      { key: 'prisoners', icon: 'barbarian', value: n, label: `${n} prisoners (${Math.floor(n / per)} VP)` },
      { key: 'guards', icon: 'guard', value: guards(s, seat).length, label: 'Guards on the island' },
    ];
    const gold = purse(s).gold[seat];
    if (purseOwner(s) === ID) out.push({ key: 'gold', icon: 'gold', value: gold, label: 'Gold' });
    return out;
  },
};

