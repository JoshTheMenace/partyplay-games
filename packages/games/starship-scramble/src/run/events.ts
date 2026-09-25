/** Event library access, fleet requirements ("blue" choices) and effect application with plain result lines. */
import type { EventView, NodeKind, Ship, WeaponKind } from '../contracts';
import type { ChoiceDef, EventDef, EventEffect, Requirement, Who } from '../content/types';
import { EVENTS } from '../content/events';
import { ROLES, SPECIES, augmentDef, speciesDef, systemDef, weaponDef } from '../defs/catalog';
import { berths, item, refit } from './fleet';
import { pick, weighted } from './rng';
import { LIMITS, captainById, currentNode, earn, fleet, living, recruit, scrapScale, sector, shipOf, type State } from './state';

const CONTINUE: ChoiceDef = { id: 'continue', label: 'Continue', outcomes: [{ weight: 1, text: '', effects: [] }] };
const KIND_NAMES: Record<WeaponKind, string> = { laser: 'Laser', missile: 'Missile', beam: 'Beam', ion: 'Ion', flak: 'Flak', support: 'Support' };
export const VOTE_MS = 20000, ALL_VOTED_MS = 1500;

export const eventDef = (id: string) => { const found = EVENTS.find(e => e.id === id); if (!found) throw new Error(`Unknown event ${id}`); return found; };
export const choicesOf = (def: EventDef) => def.choices.length ? def.choices : [CONTINUE];

/** Quest steps: events with a choice that sets a flag some later event requires. */
const STEPS = new Set(EVENTS.filter(e => e.choices.some(ch => ch.outcomes.some(o => o.effects.some(f => f.kind === 'flag')))).map(e => e.id));
/**
 * Weighted draw for a beacon; events already seen this run are four times rarer, unique ones never repeat. A quest follow-up whose flag is set
 * comes up at the next beacon that can hold it, and no quest step starts in the final sector's last beacon column, where nothing could follow.
 */
export function pickEvent(s: State, kind: NodeKind): EventDef | null {
  const late = s.sectorIndex === s.sectors.length - 1 && currentNode(s).col >= s.map.columns - 2;
  const pool = EVENTS.filter(e => e.kinds.includes(kind) && (e.sectors === 'any' || e.sectors.includes(sector(s).id)) && !(e.unique && s.seen.includes(e.id)) && (!e.requiresFlag || s.flags.includes(e.requiresFlag)) && !(late && STEPS.has(e.id)));
  const due = pool.filter(e => e.requiresFlag);
  return pool.length ? weighted(s, due.length ? due : pool, e => s.seen.includes(e.id) ? e.weight / 4 : e.weight) : null;
}

const cost = (s: State, amount: number) => scrapScale(s, amount);
export function badge(s: State, req: Requirement) {
  switch (req.kind) {
    case 'system': return `${systemDef(req.system).name}${req.tier > 1 ? ` ${req.tier}` : ''}`;
    case 'weapon': return `${KIND_NAMES[req.weaponKind]} weapon`;
    case 'species': return `${speciesDef(req.species).name} crew`;
    case 'role': return `${ROLES.find(r => r.id === req.role)!.name} crew`;
    case 'augment': return augmentDef(req.augment).name;
    case 'scrap': return `${cost(s, req.amount)} scrap each`;
  }
}
export function meets(s: State, req: Requirement) {
  const ships = fleet(s), crew = s.captains.flatMap(c => living(s, c.id));
  switch (req.kind) {
    case 'system': return ships.some(ship => ship.rooms.some(r => r.system === req.system && r.tier >= req.tier));
    case 'weapon': return ships.some(ship => ship.weapons.some(w => weaponDef(w.defId).kind === req.weaponKind));
    case 'species': return crew.some(k => k.species === req.species);
    case 'role': return crew.some(k => k.role === req.role);
    case 'augment': return ships.some(ship => ship.augments.includes(req.augment));
    case 'scrap': return s.captains.reduce((sum, c) => sum + c.scrap, 0) >= cost(s, req.amount) * s.captains.length;
  }
}
export const available = (s: State, choice: ChoiceDef) => !choice.requires || meets(s, choice.requires);

export function eventView(s: State): EventView | null {
  if (!s.event) return null;
  const def = eventDef(s.event.defId), outcome = s.event.outcome;
  return { id: def.id, title: def.title, text: def.text, deadlineMs: s.deadline, result: outcome?.text ?? null, resultLines: outcome?.lines ?? [],
    choices: choicesOf(def).map(ch => ({ id: ch.id, label: ch.label, badge: ch.requires ? badge(s, ch.requires) : null, available: available(s, ch), votes: s.captains.filter(c => c.vote === ch.id).map(c => c.id) })) };
}

/** Apply the winning choice: pay its scrap cost (richer captains cover poorer ones), roll an outcome, apply effects, open the Continue step. */
export function resolveChoice(s: State, choice: ChoiceDef, nowMs: number) {
  const ev = s.event!, lines: string[] = [];
  if (choice.requires?.kind === 'scrap') {
    const each = cost(s, choice.requires.amount); let short = 0;
    for (const c of s.captains) { const paid = Math.min(c.scrap, each); c.scrap -= paid; short += each - paid; }
    for (const c of [...s.captains].sort((a, b) => b.scrap - a.scrap)) { const paid = Math.min(c.scrap, short); c.scrap -= paid; short -= paid; }
    lines.push(`−${each} scrap each`);
  }
  const outcome = weighted(s, choice.outcomes, o => o.weight);
  for (const effect of outcome.effects) {
    if (effect.kind === 'event' || effect.kind === 'combat' || effect.kind === 'store') ev.next ??= effect;
    else { const line = apply(s, effect); if (line) lines.push(line); }
  }
  ev.outcome = { choiceId: choice.id, text: outcome.text, lines };
  for (const c of s.captains) c.ready = false;
  s.deadline = nowMs + VOTE_MS;
}

const signed = (n: number) => n >= 0 ? `+${n}` : `−${-n}`;
const plural = (n: number, word: string) => `${Math.abs(n)} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
export const shipLabel = (s: State, ship: Ship) => { const own = `${captainById(s, ship.captainId)?.name ?? 'The fleet'}'s `; return ship.name.startsWith(own) ? ship.name : own + ship.name; };
function targets(s: State, who: Who) {
  const ships = fleet(s);
  if (who === 'fleet' || !ships.length) return ships;
  return [who === 'random' ? pick(s, ships) : ships.reduce((a, b) => b.hull / b.maxHull < a.hull / a.maxHull ? b : a)];
}
const onShips = (s: State, ships: Ship[], who: Who, text: string) => !ships.length ? null : who === 'fleet' && ships.length > 1 ? `Every ship ${text}` : ships.map(ship => `${shipLabel(s, ship)} ${text}`).join(' · ');

function apply(s: State, e: Exclude<EventEffect, { kind: 'event' | 'combat' | 'store' }>): string | null {
  switch (e.kind) {
    case 'scrap': { const amount = scrapScale(s, e.amount);
      for (const c of s.captains) if (amount > 0) earn(s, c, amount); else c.scrap = Math.max(0, c.scrap + amount);
      return `${signed(amount)} scrap each`; }
    case 'hull': { const ships = targets(s, e.who); for (const ship of ships) ship.hull = Math.max(1, Math.min(ship.maxHull, ship.hull + e.amount)); return onShips(s, ships, e.who, `${signed(e.amount)} hull`); }
    case 'ammo': { const ships = targets(s, e.who); for (const ship of ships) ship.ammo = Math.max(0, Math.min(LIMITS.ammo, ship.ammo + e.amount)); return onShips(s, ships, e.who, `${signed(e.amount)} missiles`); }
    case 'crewDamage': { const ships = targets(s, e.who);
      for (const k of s.crew) if (k.faction === 'ally' && ships.some(ship => ship.id === k.shipId)) k.hp = Math.max(1, k.hp - e.amount);
      return onShips(s, ships, e.who, `crew −${e.amount} health`); }
    case 'systemDamage': { const ships = targets(s, e.who).filter(ship => ship.rooms.some(r => r.system === e.system && r.tier));
      for (const room of ships.flatMap(ship => ship.rooms.filter(r => r.system === e.system))) room.damage = Math.min(room.tier, room.damage + e.amount);
      return onShips(s, ships, e.who, `${systemDef(e.system).name.toLowerCase()} damaged`); }
    case 'upgrade': { const max = systemDef(e.system).maxTier, ships = targets(s, e.who).filter(ship => ship.rooms.some(r => r.system === e.system && r.tier < max));
      for (const ship of ships) { ship.rooms.find(r => r.system === e.system)!.tier++; refit(s, ship); }
      return onShips(s, ships, e.who, `${systemDef(e.system).name.toLowerCase()} upgraded`); }
    case 'item': { const found = item(s, e.item, e.tier, e.id); s.pending.push(found);
      return `${(found.kind === 'weapon' ? weaponDef : augmentDef)(found.defId).name} added to the spoils`; }
    case 'crew': {
      const c = [...s.captains].sort((a, b) => living(s, a.id).length - living(s, b.id).length)[0], ship = shipOf(s, c);
      if (living(s, c.id).length >= LIMITS.crew || berths(s, ship) < 1) return 'No free berth for a new recruit';
      const species = e.species ?? pick(s, SPECIES).id, role = e.role ?? pick(s, ROLES).id;
      recruit(s, c.id, ship, species, role);
      return `A ${speciesDef(species).name} ${role} joins ${c.name}`; }
    case 'crewLoss': {
      const pool = s.captains.filter(c => living(s, c.id).length > 1).flatMap(c => living(s, c.id));
      if (!pool.length) return null;
      const lost = pick(s, pool); s.crew = s.crew.filter(k => k !== lost);
      return `${lost.name} of ${captainById(s, lost.ownerId)!.name}'s crew was lost`; }
    case 'armada': s.map.armadaCol += e.amount; return `The Armada ${e.amount > 0 ? 'gains' : 'falls back'} ${plural(e.amount, 'beacon')}`;
    case 'reveal': s.revealed = true; return 'Sector map revealed';
    case 'reserves': s.reserves = Math.max(0, s.reserves + e.amount); return `${signed(e.amount)} fleet reserve ${Math.abs(e.amount) === 1 ? 'hull' : 'hulls'}`;
    case 'flag': if (!s.flags.includes(e.flag)) s.flags.push(e.flag); return null;
  }
}
