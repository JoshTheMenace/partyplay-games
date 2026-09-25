/** Rules text for the lobby details. Plain strings; each line is one bullet. */
import { COSTS, type Mission, type ModuleId, type Purchase, type SeafarersScenario } from '../../model';
import { cardsText } from './format';
import { MISSION_NAMES, SCENARIO_NAMES, SEAFARERS_NAMES, VARIANT_NAMES } from './labels';

export type Topic = { id: string; title: string; lines: string[] };

const cost = (piece: Purchase, label: string) => `${label}: ${cardsText(COSTS[piece])}.`;

export const TURN_HELP = {
  standard: [
    'The active player rolls, then trades and builds in any order and ends the turn.',
    'With 5 or more players, the next player then gets a build turn: bank trades and building only.',
  ],
  connect: [
    'One shared roll pays everyone. Then all players trade and build at the same time.',
    'The round ends when the timer runs out or everyone is done. The first confirmed placement wins a spot.',
    'Victory is checked at the end of each round. This is our adaptation for big groups.',
  ],
};

// Module summaries below are read from the engine modules (src/engine/modules/*); keep them in step.

const SEAFARERS = [
  `${cost('ship', 'Ship')} Ships go on sea edges. A road and a ship join only at your own building.`,
  'Once per turn move one ship at the open end of a line, unless you built it this turn or the pirate '
    + 'is beside it.',
  'Gold fields pay 1 resource of your choice per settlement, 2 per city.',
  'On a 7 or a Knight you may move the pirate instead. No ship is built or moved beside it, and it robs a '
    + 'ship owner there.',
];
const SEAFARERS_SCENARIO: Record<SeafarersScenario, string> = {
  'new-shores': `${SEAFARERS_NAMES['new-shores']}: start on the main island. Your first settlement on each `
    + 'other island earns 2 extra points.',
  'four-islands': `${SEAFARERS_NAMES['four-islands']}: start on any islands. Your first settlement on each `
    + 'island without one of your starting buildings earns 2 extra points.',
  'fog-islands': `${SEAFARERS_NAMES['fog-islands']}: start on the main island. A road or ship touching fog `
    + 'turns it over: land pays 1 of its resource, gold 1 of your choice. There is no island bonus.',
};

const EXPLORERS = [
  'Most of the sea starts in fog. Ships carry settlers and crews out to explore it.',
  'No robber, ports, development cards, Longest Road or Largest Army, and no cities without Cities & '
    + 'Knights. The bank trades 3:1.',
  'Harbor settlement (2 points): upgrade a coastal settlement for 2 grain and 2 ore. Ships launch and '
    + 'load there.',
  'Build and trade first: your first ship move ends building and trading for the turn.',
  'Ships sail 4 edges (+2 for 1 wool). Stopping beside fog reveals it and ends the move: land pays 1 of '
    + 'its resource, other hexes 2 gold.',
  `A settler (${cardsText(COSTS.settlement)}) fills a ship: land it on an explored coast to found a `
    + 'settlement. A crew costs 1 wool and 1 ore.',
  'Gold: 2 buys 1 resource, twice a turn. A roll that pays you nothing gives 1 gold.',
];
const MISSION_HELP: Record<Mission, string> = {
  lairs: `${MISSION_NAMES.lairs}: land crews on a lair. The third crew takes it: each crew's owner gets 2 `
    + 'gold and a step, the battle winner one more. Its gold field then pays 2 gold per building.',
  fish: `${MISSION_NAMES.fish}: once a turn roll for a fish haul on explored shoals with that number. A `
    + 'haul fills a ship; each one delivered to the Council is a step.',
  spices: `${MISSION_NAMES.spices}: a crew landed on a spice farm brings back a sack and a lasting perk `
    + '(faster ships, easier pirate chases or 1 card for 1 gold). Each sack delivered to the Council is '
    + 'a step.',
};
const MISSIONS_ON = [
  'Mission steps score up to 3 points per track; whoever is furthest along a track scores 1 more.',
  'A 7 lets the roller place their pirate ship and rob a ship there. Sailing near another player\'s pirate '
    + 'costs 1 gold.',
];
const LAND_HO = 'Land Ho! only: explore and settle. There is no pirate ship.';

/** One summary per rule module; line 1 is also the lobby toggle blurb. */
export const MODULE_HELP: Record<ModuleId, Topic> = {
  seafarers: { id: 'seafarers', title: 'Seafarers',
    lines: [...SEAFARERS, ...Object.values(SEAFARERS_SCENARIO)] },
  explorers: { id: 'explorers', title: 'Explorers & Pirates',
    lines: [...EXPLORERS, ...MISSIONS_ON, ...Object.values(MISSION_HELP), LAND_HO] },
  'cities-knights': { id: 'cities-knights', title: 'Cities & Knights', lines: [
    'Cities make commodities, knights guard against the barbarian ship, and progress cards replace '
      + 'development cards.',
    'A city on forest, pasture or mountains takes 1 resource plus 1 paper, cloth or coin.',
    'Paper, cloth and coin buy Science, Trade and Politics levels (level n costs n). Level 3 adds an '
      + 'ability; the first to level 4 takes that metropolis (+2 points).',
    'The event die moves the barbarian ship, or opens a track: everyone at level 1 or more whose level + 1 '
      + 'is at least the red die draws a progress card.',
    'When the ship lands, active knights must match every city on the island. If not, the weakest '
      + 'defenders lose a city; if so, the single strongest earns 1 point.',
    'Knights: recruit for wool + ore, activate for grain, promote for wool + ore. They defend, block roads '
      + 'and chase the robber.',
    'The robber waits until the first attack. City walls (2 brick) raise your discard limit by 2. Hold at '
      + 'most 4 progress cards.',
  ] },
  fishing: { id: 'fishing', title: SCENARIO_NAMES.fishing, lines: [
    'Buildings beside fishing grounds and the lake catch fish tokens when their number rolls.',
    'A settlement catches 1 token, a city 2; hold at most 7. Fish are never robbed, discarded or traded.',
    'On your turn spend fish: 2 takes the robber off the board, 3 steals a card, 4 takes a resource, 5 '
      + 'builds a free road, 7 takes a development card. Extra fish are lost.',
    'Whoever fishes up the old boot needs 1 more point to win, and may pass it to a player with at least '
      + 'as many points.',
  ] },
  rivers: { id: 'rivers', title: SCENARIO_NAMES.rivers, lines: [
    'Building beside rivers earns gold. The richest player gains a point; the poorest lose 2.',
    'River edges take only bridges (2 brick, 1 wood; up to 3, counting as roads). A bridge earns 3 gold.',
    'Each road or ship along a river hex, and each settlement on its corner, earns 1 gold.',
    'Spend 2 gold for a resource (twice a turn), sell cards at your bank rate for 1 gold, or offer gold '
      + 'for a card.',
    'Only a single richest player is Wealthiest (+1 point); everyone tied for least gold is Poor (−2).',
  ] },
  caravans: { id: 'caravans', title: SCENARIO_NAMES.caravans, lines: [
    'Camel trains leave the oasis: roads under them count double, buildings between two camels score.',
    'Build a settlement or city on your turn and a camel arrives when the turn ends.',
    'Everyone bids wool and grain (brick and wood with Cities & Knights) in secret; each card votes for '
      + 'an edge.',
    'The most-voted edge gets the camel; on a tie the top bidder (else its owner) places it. Bids are paid.',
    'A road under a camel counts double for Longest Road; each building touching two camels earns 1 point.',
  ] },
  'barbarian-attack': { id: 'barbarian-attack', title: SCENARIO_NAMES['barbarian-attack'], lines: [
    'Every new building lands barbarians on the coast; knights drive them off for prisoners.',
    'Each settlement or city lands 3, rolled onto numbered coastal hexes. 3 on a hex conquer it: it stops '
      + 'producing and nobody builds there.',
    'Buildings touching only conquered land lose their points and their ports.',
    'There is no robber: a 7 lets the roller steal a card from any player. Defense cards replace '
      + 'development cards.',
    'After building, move each knight up to 3 edges (5 for 1 grain). Gold buys 1 resource for 2, twice a '
      + 'turn.',
    'At the end of each turn, knights stronger than a hex\'s barbarians capture them. 2 prisoners score '
      + '1 point.',
    'With Cities & Knights, ship rolls and improvements land barbarians; 3 prisoners score 1 point.',
  ] },
  deliveries: { id: 'deliveries', title: SCENARIO_NAMES.deliveries, lines: [
    'Drive your wagon between the castle, quarry and glassworks to deliver cargo for points.',
    'You start with 5 gold and a wagon on your city. After building, drive: 1 MP per road, 2 across open '
      + 'land, +2 past a road barbarian.',
    'Each edge of another player\'s road costs 1 gold, paid to its owner. Gold buys 1 resource for 2, '
      + 'twice a turn.',
    'Entering a depot ends the move: deliver cargo it wants for 1 point and gold by wagon level, then '
      + 'load more.',
    'Upgrades add MP and drive-off power; level 5 is worth 1 point. 1 grain adds 2 MP once a turn.',
    'Road barbarians replace the robber: a 7 or a Knight moves one and robs a road owner. 2s and 12s are '
      + 'rerolled. No Longest Road.',
  ] },
  'friendly-robber': { id: 'friendly-robber', title: VARIANT_NAMES['friendly-robber'], lines: [
    'The robber cannot block a hex beside a player with 2 or fewer points, or rob them.',
    'If every hex is protected, it may go to the desert.',
  ] },
  harbormaster: { id: 'harbormaster', title: VARIANT_NAMES.harbormaster, lines: [
    'Buildings on ports earn harbor points: 1 per settlement, 2 per city.',
    'The first to 3 takes the Harbormaster award (+2 points); only a strictly higher total takes it away.',
  ] },
};

const BASICS: Topic = { id: 'basics', title: 'Building', lines: [
  cost('road', 'Road'), cost('settlement', 'Settlement (1 point)'),
  cost('city', 'City (2 points, pays double)'),
  cost('development', 'Development card'),
  'Settlements need an empty corner between them and must touch your road.',
  'Trade 4:1 with the bank, 3:1 or 2:1 at your harbors, or post offers to other players.',
] };

const SEVEN: Topic = { id: 'seven', title: 'Rolling a 7', lines: [
  'Anyone above their card limit discards half. The roller then moves the robber to block a hex.',
  'The robber steals 1 random card from a player beside that hex.',
] };

const TABLE: Topic = { id: 'table', title: 'CPUs and timers', lines: [
  'CPUs fill empty seats up to the table size. They only see public information and their own cards.',
  'With timers on, a move that runs out of time is played for you. A disconnected player gets 30 s first.',
] };

/** Everything, for the lobby: turns plus one section per expansion. */
export const ALL_TOPICS: Topic[] = [
  BASICS, SEVEN,
  { id: 'turns', title: 'Turns', lines: TURN_HELP.standard },
  { id: 'connect', title: 'Connect rounds', lines: TURN_HELP.connect },
  ...Object.values(MODULE_HELP), TABLE,
];
