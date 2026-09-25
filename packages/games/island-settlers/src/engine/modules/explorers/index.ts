/**
 * Explorers & Pirates (2025 rulebook and mission guide), wired through registry hooks only.
 * No robber, ports, development cards, cities (unless Cities & Knights joins), Longest Road or
 * Largest Army; the bank trades 3:1. Setup: a harbor settlement plus a ship carrying a settler, then
 * a settlement and road that pay the starting resources (with C&K: city and road, then harbor and
 * ship). Each opportunity builds and trades first, then moves ships; missions add points.
 */
import type { Grant, SeatId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { face, why } from '../../legal';
import { openPrompt } from '../../prompts';
import { pushEffect, seatName, type State } from '../../state';
import { emit } from '../../events';
import type { Module } from '../registry';
import { decorate } from './board';
import { applyBuild, buildCommands } from './build';
import { cornerWhy, edgeWhy } from './rules';
import { hudItems, missionParts } from './missions';
import { openPirate, PROMPTS } from './pirate';
import { applyMove, moveCommands } from './sail';
import { movesLeft } from './sea';
import { addCoins, coins, ext, freshVoyage, lairAt, ships, type ExplorersState } from './state';

const BUILD = new Set(['harbor', 'ship', 'settler', 'crew', 'buy', 'sell', 'fast-gold']);

/** Captured lairs pay 2 gold per building on a roll; a seat that got no cards gets 1 gold. */
function gold(s: State, grants: Grant[], total: number) {
  const ix = boardIndex(s.board), paid: Record<SeatId, number> = {};
  for (const b of Object.values(s.pieces.buildings)) for (const t of ix.vertex.get(b.vertex)?.tiles ?? []) {
    if (lairAt(s, t)?.captured && face(s, t).number === total) paid[b.seat] = (paid[b.seat] ?? 0) + 2;
  }
  for (const id of s.order) if (!paid[id] && !grants.some(g => g.seat === id)) paid[id] = 1;
  const list = Object.entries(paid);
  for (const [id, n] of list) addCoins(s, id, n);
  if (!list.length) return;
  const text = `Gold: ${list.map(([id, n]) => `${seatName(s, id)} +${n}`).join(', ')}`;
  emit(s, { kind: 'module', module: 'explorers', name: 'gold', seat: null, target: null, text });
}

export const explorers: Module<ExplorersState> = {
  id: 'explorers',
  profile(p, s) {
    Object.assign(p, { devCards: false, largestArmy: false, longestRoad: false, robber: false });
    Object.assign(p, { ports: false, bankRate: 3, movementLocksBuilding: true });
    p.setupPieces = ['harbor', 'settlement'];
    p.cities = s.citiesKnights;
  },
  board: { decorate },
  init: s => ({
    coins: Object.fromEntries(s.order.map(id => [id, 2])), missions: {}, leaders: {}, lairs: [],
    spiceVisits: {}, hauls: [], pirate: null, voyages: {},
  }),
  /** The ship with its settler replaces the route after the harbor settlement (see onBuild). */
  setupPlan: plan => plan.filter((step, i) => !(step.anchorRequired && plan[i - 1]?.piece === 'harbor')),

  afterProduce: (s, roll) => gold(s, roll.grants, roll.total),
  onSeven(s, seat) {
    // Land Ho! (no missions) has no pirate ship.
    if (seat && s.settings.missions.length) {
      pushEffect(s, { type: 'module', module: 'explorers', name: 'pirate', data: seat });
    }
    return 'replace';
  },
  effects: { pirate: (s, seat) => openPirate(s, seat as SeatId, 'table') },

  legal: {
    settlement: cornerWhy,
    route: (s, seat, e, kind) => (kind === 'road' ? edgeWhy(s, seat, e) : why('rule', 'No route ships here')),
  },
  commands: (s, seat) => [...buildCommands(s, seat), ...moveCommands(s, seat)],
  apply(s, seat, id, a) {
    const key = id.slice('explorers/'.length);
    return BUILD.has(key) ? applyBuild(s, seat, key, a) : applyMove(s, seat, key, a);
  },
  prompts: PROMPTS,

  onBuild(s, seat, placed) {
    const harbor = placed.kind === 'building' && placed.piece.kind === 'harbor';
    if (harbor && s.turn.stage === 'setup') {
      openPrompt(s, { seat, kind: 'explorers/launch', scope: 'self', data: { vertex: placed.piece.vertex } });
    }
  },
  onOpportunityStart(s, seat) { ext(s).voyages[seat] = freshVoyage(); },
  onOpportunityEnd(s, seat) { delete ext(s).voyages[seat]; },

  score: missionParts,
  publicView(s) {
    const x = ext(s), each = <T>(f: (id: SeatId) => T) => Object.fromEntries(s.order.map(id => [id, f(id)]));
    return {
      coins: each(id => coins(s, id)), missions: each(id => ({ ...x.missions[id] })),
      lairs: x.lairs.map(l => ({ tile: l.tile, crews: { ...l.crews }, captured: l.captured })),
      spiceVisits: each(id => [...(x.spiceVisits[id] ?? [])]), hauls: [...x.hauls], pirate: x.pirate,
    };
  },
  privateView: (s, seat) =>
    ({ movesLeft: Object.fromEntries(ships(s, seat).map(u => [u.id, movesLeft(s, u)])) }),
  hud: hudItems,
  badges: (s, seat) => [{ key: 'coins', icon: 'coin', value: coins(s, seat), label: 'Gold' }],
};
