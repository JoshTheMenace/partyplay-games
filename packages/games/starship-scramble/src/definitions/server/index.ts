import type { Definitions, EnemyDefinition, SectorDefinition } from '../../contracts';
import { hulls, weapons, systems, drones, augments } from '../presentation';
import { events, followups } from './events';
import { travelEvents } from './events/travel';
import { distressEvents } from './events/distress';
import { hostileEvents } from './events/hostile';
import { tradeEvents } from './events/trade';
import { scienceEvents } from './events/science';
import { factionEvents } from './events/faction';
import { questEvents, questFollowups } from './events/quests';

const enemyRows: [string, string, string, string[], EnemyDefinition['ai']][] = [
  ['tin-raider', 'Tin Raider', 'kite', ['laser-twin'], 'aggressive'], ['glass-lancer', 'Glass Lancer', 'longbow', ['beam-thread'], 'artillery'], ['cinder-cutter', 'Cinder Cutter', 'moth', ['plasma-cinder'], 'aggressive'], ['tax-collector', 'Tax Collector', 'bulwark', ['missile-lance'], 'coward'], ['blue-warden', 'Blue Warden', 'cuttlefish', ['ion-chain', 'laser-needle'], 'shield-breaker'], ['nest-breaker', 'Nest Breaker', 'moth', ['boarding-charge'], 'boarder'], ['patch-tender', 'Patch Tender', 'hearth', ['support-patch', 'laser-needle'], 'support'], ['rift-hunter', 'Rift Hunter', 'kite', ['missile-needle', 'laser-rake'], 'hunter'],
  ['door-thief', 'Door Thief', 'cuttlefish', ['boarding-jammer', 'ion-tap'], 'saboteur'], ['scrap-ram', 'Scrap Ram', 'magpie', ['flak-storm'], 'aggressive'], ['long-watch', 'Long Watch', 'longbow', ['beam-prism', 'missile-drill'], 'artillery'], ['ember-priest', 'Ember Priest', 'wayfarer', ['plasma-rain', 'plasma-spark'], 'aggressive'], ['screen-eater', 'Screen Eater', 'cuttlefish', ['ion-breaker', 'beam-thread'], 'shield-breaker'], ['hollow-ferry', 'Hollow Ferry', 'moth', ['boarding-gas', 'boarding-spear'], 'boarder'], ['quiet-needle', 'Quiet Needle', 'kite', ['beam-needle', 'ion-needle'], 'hunter'], ['repair-abbot', 'Repair Abbot', 'hearth', ['support-relay', 'support-clinic'], 'support'],
  ['toll-runner', 'Toll Runner', 'kite', ['flak-flash', 'missile-anchor'], 'coward'], ['seal-cutter', 'Seal Cutter', 'magpie', ['beam-vacuum', 'flak-breach'], 'saboteur'], ['red-battery', 'Red Battery', 'longbow', ['plasma-sun', 'missile-cluster'], 'artillery'], ['white-shield', 'White Shield', 'bulwark', ['support-surge', 'laser-hammer'], 'support'], ['iron-choir', 'Iron Choir', 'bulwark', ['ion-lock', 'flak-scatter'], 'shield-breaker'], ['last-custodian', 'Last Custodian', 'wayfarer', ['laser-suture', 'boarding-torch'], 'saboteur'], ['mirror-blade', 'Mirror Blade', 'moth', ['boarding-swarm', 'plasma-crucible'], 'boarder'], ['relay-heart', 'Relay Heart', 'bulwark', ['laser-rake', 'missile-drill', 'ion-breaker'], 'artillery'],
];
const enemies: EnemyDefinition[] = enemyRows.map(([id, name, hullId, weapons, ai], i) => ({ id, name, hullId, weapons, ai, systems: ['shields', 'weaponry', 'engines', ...(ai === 'boarder' ? ['teleporter' as const] : ai === 'support' ? ['repair-relay' as const] : ai === 'saboteur' ? ['hacking' as const] : [])], threat: 1 + Math.floor(i / 8), tags: [ai] }));
const sectorRows = [
  ['lantern-reach', 'Lantern Reach', 'Working stations and a first glimpse of the pursuit.', '#d6b66e', 'trade'], ['glass-tide', 'Glass Tide', 'Mirror wreckage conceals patient hunters.', '#84c8d1', 'science'], ['cinder-march', 'Cinder March', 'Burning industry and hostile salvage crews.', '#de8b6b', 'hostile'], ['green-silence', 'Green Silence', 'Abandoned gardens and stubborn life.', '#91c69c', 'distress'], ['copper-crossing', 'Copper Crossing', 'Busy exchange lanes with disputed rules.', '#c6a77d', 'trade'], ['veil-current', 'Veil Current', 'Uncertain signals reward careful survey work.', '#b39ed8', 'science'], ['pilgrim-belt', 'Pilgrim Belt', 'Small communities caught between rival fleets.', '#d0a3ba', 'faction'], ['relay-crown', 'Relay Crown', 'The fortified communications heart of the region.', '#c8cbd6', 'hostile'],
] as const;
const sectors: SectorDefinition[] = sectorRows.map(([id, name, description, color, tag], i) => ({ id, name, description, color, tags: [tag], enemies: enemies.slice(i % 3 * 8, i % 3 * 8 + 8).map(enemy => enemy.id), boss: enemies[16 + i]!.id }));
export const scenarioRoots = [...events, ...travelEvents, ...distressEvents, ...hostileEvents, ...tradeEvents, ...scienceEvents, ...factionEvents, ...questEvents];
export const followupNodes = [...followups, ...questFollowups];
export const definitions: Definitions = { hulls, weapons, systems, drones, augments, enemies, sectors, events: [...scenarioRoots, ...followupNodes] };
