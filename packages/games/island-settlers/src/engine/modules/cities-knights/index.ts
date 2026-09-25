/**
 * Cities & Knights (2025 rulebook, classic card names) as one registry module: commodities, the
 * event die and barbarian ship, improvements with level-3 abilities and metropolises, city walls,
 * knights, and the three progress decks. Every decision is a command or prompt, so phones, CPUs and
 * the TV need nothing module-specific. Combination notes: Seafarers (ships count as roads; it holds
 * the pirate until our first attack; knights may not be stranded by a ship move), Explorers & Pirates
 * (city then harbor setup, knights avoid fog and never sail, Bishop activates the pirate fleet,
 * Medicine may build a harbor settlement, the Aqueduct also pays on a 7 with 1 gold), Barbarian Attack
 * (profile.coastalBarbarians: its coastal attacks and castle knights replace our ship and knights).
 */
import { COMMODITIES } from '../../../model';
import { why } from '../../legal';
import { setRobber } from '../../pieces';
import type { State } from '../../state';
import type { Module } from '../registry';
import { defenseDrawPrompt, eventDie, pillagePrompt } from './barbarians';
import {
  afterCityBuilt, applyCity, aqueduct, aqueductPrompt, cityCommands, cityRates, cityVeto, produceCommodities,
  wallBonus,
} from './city';
import { applyKnight, knightCommands, retreatPrompt, shipVeto } from './knights';
import {
  applyProgress, deserterPlacePrompt, deserterPrompt, givePrompt, keepPrompt, progressCommands, spyPrompt,
  takePrompt,
} from './play';
import { checkLimit } from './progress';
import { commodityStock, initState, knightAt, sx, type CkState } from './state';
import { badges, barbarianPath, hud, privateView, publicView, score } from './view';

const KNIGHT_COMMANDS = new Set(['recruit', 'activate', 'promote', 'move', 'chase']);

/** End of an opportunity: Merchant Fleet and Commercial Harbor lapse; the hand limit applies. */
function closeTurn(s: State, seat: string) {
  Object.assign(sx(s, seat), { fleet: [], harbor: null });
  checkLimit(s, seat, true);
}

export const citiesKnights: Module<CkState> = {
  id: 'cities-knights',
  profile(p, s) {
    p.devCards = false; p.largestArmy = false; p.commodities = true; p.robberWaitsForFirstAttack = true;
    p.roundLimitScale = 1.5;
    p.setupPieces = s.map === 'explorers' ? ['city', 'harbor'] : [p.setupPieces[0], 'city'];
  },
  board: { decorate: barbarianPath },
  /** Commodity stock joins the bank; the robber stays off the board until the first attack. */
  init(s) {
    const x = initState(s);
    for (const g of COMMODITIES) s.bank[g] += commodityStock(s.order.length);
    setRobber(s, null);
    return x;
  },

  beforeProduce: eventDie,
  produce: produceCommodities,
  afterProduce: aqueduct,
  onSeven(s) { if (s.modules.includes('explorers')) aqueduct(s, null); },

  legal: {
    settlement: (s, _seat, v) => (knightAt(s, v) ? why('rule', 'A knight stands here') : null),
    city: (s, seat, v) => cityVeto(s, seat, v),
    shipMove: (s, seat, from) => (shipVeto(s, seat, from) ? why('rule', 'A knight depends on this ship') : null),
  },
  rates: cityRates,
  discardLimit: (s, seat) => wallBonus(s, seat),
  blocksRoute: (s, seat, v) => { const k = knightAt(s, v); return !!k && k.seat !== seat; },

  commands: (s, seat) => [...cityCommands(s, seat), ...knightCommands(s, seat), ...progressCommands(s, seat)],
  apply(s, seat, id, a) {
    const what = id.split(':')[1];
    if (what === 'improve' || what === 'wall') return applyCity(s, seat, id, a);
    if (KNIGHT_COMMANDS.has(what)) return applyKnight(s, seat, id, a);
    applyProgress(s, seat, id, a);
  },
  /** A getter: specs are module constants, and this file may be evaluated inside an import cycle. */
  get prompts() {
    return {
      aqueduct: aqueductPrompt, pillage: pillagePrompt, 'defense-draw': defenseDrawPrompt, keep: keepPrompt,
      retreat: retreatPrompt, give: givePrompt, take: takePrompt, spy: spyPrompt, deserter: deserterPrompt,
      'deserter-place': deserterPlacePrompt,
    };
  },

  onBuild(s, _seat, placed) { if (placed.kind === 'building') afterCityBuilt(s, placed.piece.vertex); },
  onOpportunityStart: (s, seat) => { Object.assign(sx(s, seat), { fleet: [], harbor: null }); },
  onOpportunityEnd: closeTurn,

  score, publicView, privateView: (s, seat) => privateView(s, seat), hud, badges,
};
