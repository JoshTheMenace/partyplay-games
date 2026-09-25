/** Server-only run state and the small helpers every run module shares. */
import type { Captain, Combat, CrewRole, Item, Loot, Offer, Phase, PublicView, SectorMap, Settings, Ship, SpeciesId } from '../contracts';
import type { EventEffect } from '../content/types';
import { sectorDef } from '../content/sectors';
import { createCrew, type World } from '../sim';
import { pick } from './rng';

export type Next = Extract<EventEffect, { kind: 'event' | 'combat' | 'store' }>;
export type EventState = { defId: string; outcome: { choiceId: string; text: string; lines: string[] } | null; next: Next | null };
/** Per-battle bookkeeping. endAt is wall-clock ms (the outcome beat before leaving combat); counted holds processed combat event ids. */
export type Fight = { bonus: number; ambush: boolean; endAt: number | null; counted: string[] };
export type State = World & {
  settings: Settings; phase: Phase; turn: number; rng: number; nextId: number;
  captains: Captain[]; combat: Combat | null; fight: Fight | null;
  sectors: string[]; sectorIndex: number; map: SectorMap; revealed: boolean;
  event: EventState | null; loot: Loot | null; offers: Offer[] | null;
  /** Event items waiting for the next loot screen. */ pending: Item[];
  /** Wall-clock ms when the open vote or Continue step resolves. */ deadline: number | null;
  reserves: number; scrapCarry: number; flags: string[]; seen: string[];
  message: string; result: PublicView['result']; fleetStats: PublicView['fleetStats'];
};

export const LIMITS = { cargo: 8, augments: 4, crew: 8, ammo: 40 };
export const CREW_NAMES = ['Ada', 'Bex', 'Cato', 'Dax', 'Edda', 'Fenn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kip', 'Lark', 'Milo', 'Nell', 'Otto', 'Pia', 'Quill', 'Rook', 'Sol', 'Tam',
  'Uma', 'Vox', 'Wren', 'Xan', 'Yuki', 'Zed', 'Arlo', 'Bree', 'Cy', 'Dune', 'Esme', 'Flint', 'Gale', 'Hux', 'Iris', 'Jax', 'Kai', 'Lumi', 'Moss', 'Nova'];

export const uid = (s: State, prefix: string) => `${prefix}${s.nextId++}`;
export const sector = (s: State) => sectorDef(s.sectors[s.sectorIndex]);
export const currentNode = (s: State) => s.map.nodes.find(n => n.id === s.map.currentId)!;
/** Scrap scaling by sector tier. */
export const scrapScale = (s: State, amount: number) => Math.round(amount * [1, 1.3, 1.6, 1.6][sector(s).tier - 1]);
export const captainById = (s: State, id: string | null) => s.captains.find(c => c.id === id) ?? null;
export const shipById = (s: State, id: string | null) => s.ships.find(ship => ship.id === id) ?? null;
export const shipOf = (s: State, c: Captain) => { const ship = shipById(s, c.shipId); if (!ship) throw new Error('Pick a hull in the hangar first.'); return ship; };
export const fleet = (s: State) => s.ships.filter(ship => ship.faction === 'ally' && ship.status === 'active');
export const living = (s: State, ownerId: string) => s.crew.filter(k => k.ownerId === ownerId && k.state !== 'dead' && k.hp > 0);
export const online = (s: State) => s.captains.filter(c => c.connected);
export const allReady = (s: State) => online(s).length > 0 && online(s).every(c => c.ready);
export const say = (s: State, message: string) => { s.message = message; };
/** Credit scrap to a captain (Scrap Magnet: +15%). */
export function earn(s: State, c: Captain, amount: number) {
  const gain = amount > 0 && shipById(s, c.shipId)?.augments.includes('scrap-magnet') ? Math.round(amount * 1.15) : amount;
  c.scrap += gain; c.stats.scrapEarned += gain; s.fleetStats.scrap += gain;
}

/** Every phase change and every new event or battle bumps the turn, which invalidates stale phone actions. */
export function enter(s: State, phase: Phase) {
  s.phase = phase; s.turn++; s.deadline = null;
  for (const c of s.captains) { c.ready = false; c.vote = null; }
}

/** Add a crew member aboard `ship` with a name no one else in the run is using. */
/** A name not yet used by anyone aboard (falls back to reuse once the list runs out). */
export const crewName = (s: State, reserved: readonly string[] = []) => { const taken = new Set([...s.crew.map(k => k.name), ...reserved]), free = CREW_NAMES.filter(name => !taken.has(name)); return pick(s, free.length ? free : CREW_NAMES); };
export function recruit(s: State, ownerId: string | null, ship: Ship, species: SpeciesId, role: CrewRole, name = crewName(s)) {
  const member = createCrew({ id: uid(s, 'k'), name, species, role, faction: ship.faction, ownerId }, ship, s);
  s.crew.push(member);
  return member;
}
