import type { Capability, Captain, ChoiceView, Definitions, EconomyCommand, EventChoice, EventEffect, Expedition, Item, Settings, Ship, State } from '../contracts';

import { SPECIES, speciesFor } from '../definitions/presentation/species';

export function random(expedition: Pick<Expedition, 'rng'>): number {
  expedition.rng = (Math.imul(expedition.rng, 1664525) + 1013904223) >>> 0;
  return expedition.rng / 4294967296;
}
function route(expedition: Expedition, training: boolean) {
  const columns = training ? 4 : 6;
  expedition.beacons = Array.from({ length: columns }, (_, column) => Array.from({ length: column === columns - 1 || training ? 1 : 2 }, (_, lane) => {
    const kind = column === columns - 1 ? 'exit' : training ? column === 0 ? 'store' : column === 2 ? 'combat' : 'event' : column === 2 && lane === 0 ? 'store' : column === 3 && lane === 1 ? 'combat' : 'event';
    return { id: `s${expedition.sectorIndex}-b${column}-${lane}`, column, lane, kind, label: kind === 'exit' ? 'Sector relay' : kind === 'store' ? 'Repair market' : kind === 'combat' ? 'Hostile signal' : ['Uncharted signal', 'Quiet crossing'][lane]!, next: [], visited: false, eventId: null } as Expedition['beacons'][number];
  })).flat();
  for (const beacon of expedition.beacons) beacon.next = expedition.beacons.filter(next => next.column === beacon.column + 1).map(next => next.id);
  expedition.currentBeaconId = '';
  expedition.event = null;
}
export function createExpedition(seed: number, settings: Settings, rosterSize: number, defs: Definitions): Expedition {
  if (!Number.isInteger(rosterSize) || rosterSize < 1 || rosterSize > 4 || defs.sectors.length < 5) throw new Error('An expedition needs one to four captains and at least five sectors.');
  const expedition: Expedition = { rng: seed >>> 0, sectorIds: [], sectorIndex: 0, beacons: [], currentBeaconId: '', seenRoots: [], event: null, items: [], rewardRemainder: 0, rewardSerial: 0, threat: settings.difficulty === 'relaxed' ? 0 : 1, flags: {}, reputation: {}, completedBeacons: 0, nextItemId: 1 };
  const first = defs.sectors.find(sector => sector.id === 'lantern-reach')?.id ?? defs.sectors[0]!.id;
  const last = defs.sectors.find(sector => sector.id === 'relay-crown')?.id ?? defs.sectors[defs.sectors.length - 1]!.id;
  expedition.sectorIds.push(first);
  const pool = defs.sectors.map(sector => sector.id).filter(id => id !== first && id !== last);
  if (settings.expedition !== 'training') {
    while (expedition.sectorIds.length < 4) expedition.sectorIds.push(pool.splice(Math.floor(random(expedition) * pool.length), 1)[0]!);
    expedition.sectorIds.push(last);
  }
  route(expedition, settings.expedition === 'training');
  return expedition;
}
const active = (state: State, id: string) => state.simulation.crew.some(crew => crew.ownerCaptainId === id && crew.status === 'alive');
const livingAllies = (state: State) => state.simulation.ships.filter(ship => ship.faction === 'allied' && ship.status === 'active' && ship.hull > 0).sort((a, b) => a.formation - b.formation);
function captain(state: State, id: string): Captain {
  const actor = state.captains.find(candidate => candidate.id === id);
  if (!actor || !active(state, id)) throw new Error('Only captains with surviving crew can act.');
  return actor;
}
function carrier(state: State, actor: Captain): Ship {
  const allies = livingAllies(state);
  const ship = allies.find(ship => ship.id === actor.cargoShipId) ?? allies.find(ship => ship.id === actor.currentOwnedShipId) ?? allies[0];
  if (!ship) throw new Error('There is no surviving allied cargo carrier.');
  return ship;
}
function ownShip(state: State, actor: Captain): Ship {
  const ship = livingAllies(state).find(ship => ship.id === actor.currentOwnedShipId && ship.ownerCaptainId === actor.id);
  if (!ship) throw new Error('This action requires your own surviving ship.');
  return ship;
}
function afford(actor: Captain, cost: number) {
  if (!Number.isFinite(cost) || cost < 0 || actor.wallet < cost) throw new Error(`You need ${cost} scrap for this action.`);
}
export function suppliesCapability(state: State, actorId: string, requirement: Capability | null, defs: Definitions): boolean {
  if (!requirement) return true;
  const ships = livingAllies(state).filter(ship => ship.ownerCaptainId === actorId);
  if (requirement.kind === 'system') return ships.some(ship => ship.systems.some(system => {
    const room = ship.rooms.find(room => room.system === system.id) ?? ship.rooms.find(room => room.system === null) ?? ship.rooms.find(room => room.system === 'weaponry');
    return system.id === requirement.id && system.tier >= (requirement.tier ?? 1) && !!room && room.tier - Math.ceil(room.damage / 10) >= (requirement.tier ?? 1) && room.disruptedUntilMs <= state.simulation.timeMs;
  }));
  if (requirement.kind === 'weapon-family') return ships.some(ship => {
    const room = ship.rooms.find(room => room.system === 'weaponry');
    const tier = room && room.disruptedUntilMs <= state.simulation.timeMs ? Math.min(ship.systems.find(system => system.id === 'weaponry')?.tier ?? 0, Math.max(0, room.tier - Math.ceil(room.damage / 10))) : 0;
    const slots = Math.min(tier, defs.hulls.find(hull => hull.id === ship.hullId)?.maxWeapons ?? 0);
    return ship.weapons.some((weapon, index) => index < slots && defs.weapons.some(def => def.id === weapon.definitionId && def.family === requirement.id && def.tier <= tier));
  });
  if (requirement.kind === 'crew-skill') return state.simulation.crew.some(crew => crew.ownerCaptainId === actorId && crew.status === 'alive' && crew.skill === requirement.id);
  return state.expedition.items.some(item => item.ownerCaptainId === actorId && ['cargo', 'installed'].includes(item.location) && livingAllies(state).some(ship => ship.id === item.carrierShipId) && itemDefinition(item, defs)?.tags.includes(requirement.id));
}
const ammunitionCost = (choice: EventChoice) => choice.effects.reduce((total, effect) => total + (effect.kind === 'ammo' && effect.amount < 0 ? -effect.amount : 0), 0);
function eligible(state: State, choice: EventChoice, actor: Captain, defs: Definitions) {
  const replacement = choice.effects.find(effect => effect.kind === 'replacement');
  return active(state, actor.id) && actor.wallet >= choice.cost + (replacement?.cost ?? 0) && (!replacement || actor.currentOwnedShipId === null) && livingAllies(state).every(ship => ship.ammo >= ammunitionCost(choice)) && suppliesCapability(state, actor.id, choice.requirement, defs);
}
export function availableChoices(state: State, defs: Definitions): ChoiceView[] {
  const instance = state.expedition.event;
  const event = defs.events.find(event => event.id === instance?.definitionId);
  if (!event || !instance || instance.resolved) return [];
  return event.choices.filter(choice => instance.optionIds.includes(choice.id)).map(choice => ({ id: choice.id, label: choice.label, text: choice.text, special: !!choice.requirement, available: state.captains.some(actor => eligible(state, choice, actor, defs)), requirement: [choice.requirement ? `${choice.requirement.id}${choice.requirement.tier ? ` tier ${choice.requirement.tier}` : ''}` : choice.effects.some(effect => effect.kind === 'replacement') ? 'Surviving captain without a ship' : '', ammunitionCost(choice) ? `${ammunitionCost(choice)} ammunition on each surviving allied ship` : ''].filter(Boolean).join('; '), cost: choice.cost + (choice.effects.find(effect => effect.kind === 'replacement')?.cost ?? 0), contributors: state.captains.filter(actor => actor.contribution === choice.id && eligible(state, choice, actor, defs)).map(actor => actor.id) }));
}
function weighted<T extends { weight: number }>(values: T[], expedition: Expedition): T {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  if (!values.length || !Number.isFinite(total) || total <= 0) throw new Error('No eligible encounters remain in this sector.');
  let point = random(expedition) * total;
  return values.find(value => (point -= value.weight) < 0) ?? values[values.length - 1]!;
}
export function enterBeacon(state: State, beaconId: string, defs: Definitions): EventEffect[] {
  const expedition = state.expedition;
  const beacon = expedition.beacons.find(beacon => beacon.id === beaconId);
  const current = expedition.beacons.find(beacon => beacon.id === expedition.currentBeaconId);
  if (!beacon || beacon.visited || (current ? !current.next.includes(beaconId) : beacon.column !== 0)) throw new Error('Choose an unvisited connected beacon.');
  if (expedition.event && !expedition.event.resolved) throw new Error('Resolve the current encounter before jumping.');
  let eventId: string | null = null;
  if (beacon.kind === 'event') {
    const forced = Object.keys(expedition.flags).find(flag => flag.startsWith('followup:') && expedition.flags[flag]);
    const candidates = defs.events.filter(event => (!event.sectors.length || event.sectors.includes(expedition.sectorIds[expedition.sectorIndex]!)) && (event.repeatable || !expedition.seenRoots.includes(event.id)) && (!event.requiresFlag || expedition.flags[event.requiresFlag]) && (!event.minReputation || (expedition.reputation[event.minReputation.faction] ?? 0) >= event.minReputation.amount));
    const sector = defs.sectors.find(sector => sector.id === expedition.sectorIds[expedition.sectorIndex]);
    const hasFutureEvent = expedition.sectorIndex < expedition.sectorIds.length - 1 || expedition.beacons.some(next => next.kind === 'event' && next.column > beacon.column);
    const pool = candidates.filter(event => !event.requiresFlag && event.id !== 'last-mirror' && (hasFutureEvent || ![...event.effects, ...event.choices.flatMap(choice => [...choice.effects, ...(choice.outcomes ?? []).flatMap(outcome => outcome.effects)])].some(effect => effect.kind === 'followup'))).map(event => ({ ...event, weight: event.weight * (event.tags.some(tag => sector?.tags.includes(tag)) ? 1.6 : 1) }));
    eventId = forced ? forced.slice(9) : weighted(pool, expedition).id;
    if (!defs.events.some(event => event.id === eventId)) throw new Error('The scheduled encounter is unavailable.');
    if (forced) expedition.flags[forced] = false;
  }
  beacon.visited = true;
  beacon.eventId = eventId;
  expedition.currentBeaconId = beaconId;
  expedition.completedBeacons++;
  expedition.threat = Math.min(32, expedition.threat + 1);
  expedition.event = null;
  if (beacon.kind === 'store') return [{ kind: 'store' }];
  if (beacon.kind === 'exit' && expedition.sectorIndex === expedition.sectorIds.length - 1) {
    const finale = defs.events.find(event => event.id === 'last-mirror')!;
    beacon.eventId = finale.id;
    expedition.seenRoots.push(finale.id);
    expedition.event = { id: `${beaconId}:${finale.id}`, definitionId: finale.id, resolved: false, choiceId: null, text: finale.text, result: '', optionIds: finale.choices.map(choice => choice.id) };
    return [];
  }
  if (beacon.kind === 'combat' || beacon.kind === 'exit') return [{ kind: 'combat', objective: 'destroy', threat: 1 + expedition.sectorIndex + (beacon.kind === 'exit' ? 2 : 0) }];
  const event = defs.events.find(event => event.id === eventId)!;
  expedition.seenRoots.push(event.id);
  expedition.event = { id: `${beaconId}:${event.id}`, definitionId: event.id, resolved: false, choiceId: null, text: event.text, result: '', optionIds: event.choices.map(choice => choice.id) };
  return [];
}
export function resolveEvent(state: State, choiceId: string | null, defs: Definitions): EventEffect[] {
  const instance = state.expedition.event;
  if (!instance) throw new Error('There is no event to resolve.');
  if (instance.resolved) return [];
  const event = defs.events.find(event => event.id === instance.definitionId)!;
  const choice = event.choices.find(choice => choice.id === choiceId);
  if (event.choices.length ? !choice || !instance.optionIds.includes(choice.id) : choiceId !== null) throw new Error('This choice is no longer available.');
  if (choice && livingAllies(state).some(ship => ship.ammo < ammunitionCost(choice))) throw new Error(`Each surviving allied ship needs ${ammunitionCost(choice)} ammunition for this choice.`);
  const needsContribution = choice && (choice.cost > 0 || choice.requirement || choice.effects.some(effect => effect.kind === 'replacement'));
  const contributor = choice && needsContribution ? state.captains.find(actor => actor.contribution === choice.id && eligible(state, choice, actor, defs)) : null;
  if (needsContribution && !contributor) throw new Error('An eligible captain must contribute and consent to this choice.');
  const outcome = choice?.outcomes?.length ? weighted(choice.outcomes, state.expedition) : null;
  if (contributor && choice) contributor.wallet -= choice.cost;
  instance.resolved = true;
  instance.choiceId = choiceId;
  instance.result = outcome?.text ?? choice?.text ?? 'The encounter is complete. Your fleet can continue.';
  return [...event.effects, ...(choice?.effects ?? []), ...(outcome?.effects ?? [])];
}
export function itemDefinition(item: Pick<Item, 'kind' | 'definitionId'>, defs: Definitions) {
  const table = item.kind === 'weapon' ? defs.weapons : item.kind === 'system' ? defs.systems : item.kind === 'drone' ? defs.drones : defs.augments;
  return table.find(def => def.id === item.definitionId);
}
function createItem(state: State, kind: Item['kind'], definitionId: string, price: number, location: Item['location'], stockCaptainId: string | null = null): Item {
  return { id: `item-${state.expedition.nextItemId++}`, definitionId, kind, price, location, ownerCaptainId: null, carrierShipId: null, version: 1, stockCaptainId };
}
export function awardRewards(state: State, totalScrap: number, itemCount: number, defs: Definitions, tags: string[] = []): void {
  if (!Number.isInteger(totalScrap) || totalScrap < 0 || !Number.isInteger(itemCount) || itemCount < 0 || itemCount > 32 || !state.captains.length) throw new Error('Invalid reward package.');
  const destination = livingAllies(state)[0];
  if (!destination) throw new Error('Rewards require a surviving allied carrier.');
  const rewardPool = (['weapon', 'drone', 'augment'] as const).flatMap(kind => (kind === 'weapon' ? defs.weapons : kind === 'drone' ? defs.drones : defs.augments).filter(def => !tags.length || tags.some(tag => def.tags.includes(tag))).map(def => ({ kind, def })));
  if (itemCount > 0 && !rewardPool.length) throw new Error('No equipment matches this reward.');
  const salvageBonus = livingAllies(state).reduce((sum, ship) => sum + ship.augments.reduce((bonus, id) => bonus + (defs.augments.find(def => def.id === id && def.effect === 'scrap')?.strength ?? 0), 0), 0) / state.captains.length;
  const total = totalScrap + Math.floor(totalScrap * Math.min(0.5, salvageBonus)) + state.expedition.rewardRemainder;
  const share = Math.floor(total / state.captains.length);
  state.expedition.rewardRemainder = total % state.captains.length;
  for (const actor of state.captains) actor.wallet += share;
  for (let i = 0; i < itemCount; i++) {
    const { kind, def } = rewardPool[Math.floor(random(state.expedition) * rewardPool.length)]!;
    const item = createItem(state, kind, def.id, def.price, 'loot');
    item.carrierShipId = destination.id;
    state.expedition.items.push(item);
  }
  state.expedition.rewardSerial++;
}
export function openStore(state: State, defs: Definitions): void {
  const flag = `store:${state.expedition.currentBeaconId}`;
  if (state.expedition.flags[flag]) return;
  state.expedition.items = state.expedition.items.filter(item => item.location !== 'store');
  for (const actor of state.captains) for (const kind of ['weapon', 'drone', 'augment', 'system'] as const) {
    const table = kind === 'weapon' ? defs.weapons : kind === 'drone' ? defs.drones : kind === 'augment' ? defs.augments : defs.systems.filter(system => system.cooldownMs > 0);
    for (let i = 0; i < 3; i++) {
      const def = kind === 'weapon' && i === 0 ? defs.weapons.find(weapon => weapon.id === 'laser-twin') ?? table[0]! : table[Math.floor(random(state.expedition) * table.length)]!;
      state.expedition.items.push(createItem(state, kind, def.id, def.price, 'store', actor.id));
    }
  }
  state.expedition.flags[flag] = true;
}
export function advanceSector(state: State, _defs: Definitions): void {
  const expedition = state.expedition;
  const current = expedition.beacons.find(beacon => beacon.id === expedition.currentBeaconId);
  if (current?.kind !== 'exit' || expedition.sectorIndex + 1 >= expedition.sectorIds.length) throw new Error('There is no next sector available here.');
  expedition.sectorIndex++;
  route(expedition, state.settings.expedition === 'training');
}
export function applyEconomyCommand(state: State, actorId: string, command: EconomyCommand, defs: Definitions): void {
  if (!['hangar', 'route', 'event', 'rewards', 'store'].includes(state.phase)) throw new Error('Refit and cargo actions are available only between battles.');
  const actor = command.type === 'recruitCrew' && state.phase === 'store' ? state.captains.find(actor => actor.id === actorId) : captain(state, actorId);
  if (!actor) throw new Error('Captain not found.');
  if (command.type === 'transferCargo') {
    const destination = livingAllies(state).find(ship => ship.id === command.shipId);
    if (!destination) throw new Error('Choose a surviving allied cargo carrier.');
    if (command.itemId === null) { actor.cargoShipId = destination.id; return; }
    const item = state.expedition.items.find(item => item.id === command.itemId);
    if (!item || item.ownerCaptainId !== actor.id || item.location !== 'cargo') throw new Error('You can transfer only your own unequipped cargo.');
    item.carrierShipId = destination.id;
    item.version++;
    return;
  }
  if (command.type === 'repairHull' || command.type === 'buyAmmo' || command.type === 'upgradeRoom') {
    if (state.phase !== 'store') throw new Error('Visit a store for supplies and room upgrades.');
    const ship = ownShip(state, actor);
    if (command.type === 'repairHull') {
      const amount = Math.min(20, ship.maxHull - ship.hull);
      if (amount <= 0) throw new Error('Your hull is already fully repaired.');
      const cost = Math.ceil(amount);
      afford(actor, cost); actor.wallet -= cost; ship.hull += amount;
    } else if (command.type === 'buyAmmo') {
      afford(actor, 10); actor.wallet -= 10; ship.ammo += 5;
    } else {
      const room = ship.rooms.find(room => room.id === command.roomId);
      const def = defs.systems.find(system => system.id === room?.system);
      if (!room || !def || room.tier >= def.maxTier || (room.system === 'weaponry' && room.tier >= defs.hulls.find(hull => hull.id === ship.hullId)!.maxWeapons)) throw new Error('This room cannot be upgraded further.');
      const cost = 20 + room.tier * 15;
      afford(actor, cost); actor.wallet -= cost; room.tier++;
      const system = ship.systems.find(system => system.id === room.system);
      if (system) system.tier = room.tier;
    }
    return;
  }
  if (command.type === 'recruitCrew') {
    if (state.phase !== 'store') throw new Error('Recruitment is available at stores.');
    if (command.species !== undefined && !SPECIES.some(species => species.id === command.species)) throw new Error('Unknown crew species.');
    const species = speciesFor(command.species);
    const ship = carrier(state, actor);
    const roster = state.simulation.crew.filter(crew => crew.ownerCaptainId === actorId && crew.status === 'alive');
    const replaced = command.replaceCrewId ? roster.find(crew => crew.id === command.replaceCrewId) : null;
    if (command.replaceCrewId && !replaced || roster.length >= 8 && !replaced) throw new Error('Choose one of your own living crew to replace, or decline recruitment.');
    const hull = defs.hulls.find(hull => hull.id === ship.hullId)!;
    const landing = hull.rooms.flatMap(room => {
      const occupied = state.simulation.crew.filter(crew => crew.status === 'alive' && crew.currentShipId === ship.id && crew.roomId === room.id && crew.id !== replaced?.id);
      if (occupied.length >= room.capacity) return [];
      const columns = Math.ceil(Math.sqrt(room.capacity * room.w / room.h));
      return Array.from({ length: room.capacity }, (_, i) => ({ room, x: room.x + (i % columns + 0.5) * room.w / columns, y: room.y + (Math.floor(i / columns) + 0.5) * room.h / Math.ceil(room.capacity / columns) })).filter(place => !occupied.some(crew => Math.hypot(crew.x - place.x, crew.y - place.y) < 0.35));
    })[0];
    if (!landing) throw new Error('The destination ship has no safe space for a recruit.');
    afford(actor, 60);
    actor.wallet -= 60;
    if (replaced) { replaced.status = 'dismissed'; replaced.controlEpoch++; }
    const id = `recruit-${state.simulation.nextId++}`;
    state.simulation.crew.push({ id, ownerCaptainId: actorId, homeShipId: ship.id, currentShipId: ship.id, name: `Recruit ${state.simulation.nextId}`, roomId: landing.room.id, x: landing.x, y: landing.y, species: species.id, hp: species.maxHp, maxHp: species.maxHp, status: 'alive', skill: command.skill, traits: [], order: { kind: 'hold', roomId: landing.room.id }, activity: 'idle', controlEpoch: 0 });
    return;
  }
  const item = state.expedition.items.find(item => item.id === command.itemId);
  if (!item || !itemDefinition(item, defs)) throw new Error('This item is unavailable.');
  if ('version' in command && item.version !== command.version) throw new Error(item.ownerCaptainId ? `Collected by ${state.captains.find(actor => actor.id === item.ownerCaptainId)?.name ?? 'another captain'}.` : 'The item changed. Please try again.');
  if (command.type === 'collectItem' || command.type === 'purchaseItem') {
    const purchase = command.type === 'purchaseItem';
    if (purchase ? state.phase !== 'store' || item.location !== 'store' || item.stockCaptainId !== actorId : item.ownerCaptainId !== null || item.location !== 'loot') throw new Error('This item is no longer available to you.');
    const destination = carrier(state, actor);
    if (purchase) afford(actor, item.price);
    if (purchase) actor.wallet -= item.price;
    item.ownerCaptainId = actorId; item.carrierShipId = destination.id; item.location = 'cargo'; item.version++; actor.stats.collected++;
    return;
  }
  if (item.ownerCaptainId !== actorId || !['cargo', 'installed'].includes(item.location)) throw new Error('You can modify only your own available equipment.');
  if (command.type === 'sellItem') {
    if (state.phase !== 'store' || item.location !== 'cargo') throw new Error('Only unequipped cargo can be sold at a store.');
    actor.wallet += Math.floor(item.price / 2); item.location = 'sold'; item.version++; return;
  }
  const ship = ownShip(state, actor);
  if (item.location !== 'cargo') throw new Error('This item is already installed.');
  const replaced = command.replaceItemId ? state.expedition.items.find(candidate => candidate.id === command.replaceItemId) : null;
  if (command.replaceItemId && (!replaced || replaced.ownerCaptainId !== actorId || replaced.location !== 'installed' || replaced.carrierShipId !== ship.id || replaced.kind !== item.kind)) throw new Error('Choose compatible installed equipment from your own ship.');
  if (item.kind === 'weapon') {
    const def = defs.weapons.find(def => def.id === item.definitionId)!;
    const tier = ship.rooms.find(room => room.system === 'weaponry')?.tier ?? 1;
    const limit = Math.min(tier, defs.hulls.find(hull => hull.id === ship.hullId)!.maxWeapons);
    if (def.tier > tier || ship.weapons.length - (replaced ? 1 : 0) >= limit) throw new Error('Upgrade weaponry or select an installed weapon to replace.');
    ship.weapons = ship.weapons.filter(weapon => weapon.itemId !== replaced?.id);
    ship.weapons.push({ itemId: item.id, definitionId: item.definitionId, chargeMs: 0, order: null });
  } else if (item.kind === 'system') {
    const def = defs.systems.find(def => def.id === item.definitionId)!;
    if (ship.systems.some(system => system.id === def.id)) throw new Error('This system is already installed; upgrade its room instead.');
    const room = ship.rooms.find(room => replaced && room.system === replaced.definitionId) ?? ship.rooms.find(room => room.system === def.id) ?? ship.rooms.find(room => room.system === null || !ship.systems.some(system => system.id === room.system));
    if (!room) throw new Error('There is no empty system bay on your ship.');
    if (replaced) ship.systems = ship.systems.filter(system => system.id !== replaced.definitionId);
    room.system = def.id; room.tier = 1; room.damage = 0;
    ship.systems.push({ id: def.id, tier: 1, cooldownUntilMs: 0, activeUntilMs: 0, targetShipId: null, targetRoomId: null });
  } else if (item.kind === 'augment') {
    if (ship.augments.length - (replaced ? 1 : 0) >= 4) throw new Error('Choose one of your four augments to replace.');
    if (replaced) ship.augments.splice(ship.augments.indexOf(replaced.definitionId), 1);
    ship.augments.push(item.definitionId);
  } else throw new Error('Drones launch directly from cargo using an operational drone bay.');
  if (replaced) { replaced.location = 'cargo'; replaced.version++; }
  item.location = 'installed'; item.carrierShipId = ship.id; item.version++;
}
