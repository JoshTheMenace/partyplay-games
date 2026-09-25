/**
 * Movement-phase commands (E&P rulebook "Movement phase"): sail, land settlers and crews, load and
 * deliver fish hauls and spice sacks, take crews back from captured lairs, chase the pirate, buy
 * extra moves, roll for fish. The first one locks building and trading for the rest of the turn.
 */
import type { CargoKind, Command, Field, SeatId } from '../../../model';
import { choice, command, pickField } from '../../commands';
import { emit } from '../../events';
import { face } from '../../legal';
import { need } from '../../need';
import { placeBuilding, removeUnit, updateUnit } from '../../pieces';
import { int } from '../../rng';
import { random, seatName, type State } from '../../state';
import type { Answer } from '../registry';
import { crewDemand, onBuilt, phase, settleable } from './rules';
import { chart, has, sail, sailCommand, shipName, siteValue } from './course';
import { advance, capture, useful } from './missions';
import { openPirate } from './pirate';
import { movesLeft } from './sea';
import {
  aboard, benefits, council, ends, ext, lairAt, nearTiles, openLair, room, ships, shoals, spiceFarms, voyage,
  voyageFor,
} from './state';

type Target = 'tile' | 'vertex';

export function moveCommands(s: State, seat: SeatId): Command[] {
  if (!phase(s, seat, 'move')) return [];
  const out: Command[] = [], v = voyage(s, seat), x = ext(s), c = chart(s, seat), hall = council(s);
  const cmd = (id: string, label: string, detail: string, hint: number, fields: Field[] = []) => out.push(
    command({ id: `explorers/${id}`, module: 'explorers', group: 'ships', label, detail, hint, fields }));
  const pick = (key: string, label: string, ids: string[], say: (x: string) => string, on: Target) =>
    [pickField(key, label, ids.map(id => choice(id, say(id))), on)];
  if (s.settings.missions.includes('fish') && !v.fished && shoals(s).length) {
    cmd('fish', 'Roll for a fish haul', 'A matching explored shoal gets a haul (once per turn)',
      useful(s, seat, 'fish') ? 0.69 : 0.2);
  }
  for (const u of ships(s, seat)) {
    const name = shipName(s, u), near = nearTiles(s, u), mine = x.spiceVisits[seat] ?? [];
    const sites = has(u, 'settler') ? ends(s, u).filter(at => settleable(s, seat, at)) : [];
    if (sites.length) {
      cmd(`settle:${u.id}`, `${name}: found a settlement`, 'The ship and settler become a settlement here',
        sites.some(at => c.good.has(at)) ? 0.7 : 0.35,
        pick('at', 'Corner', sites, at => `${siteValue(s, at)} pips`, 'vertex'));
    }
    const lairs = x.lairs.filter(l => openLair(l) && near.includes(l.tile)).map(l => l.tile);
    const farms = spiceFarms(s).filter(f => near.includes(f.tile) && !mine.includes(f.tile)).map(f => f.tile);
    if (has(u, 'crew') && lairs.length + farms.length) {
      cmd(`crew:${u.id}`, `${name}: land a crew`, 'Crews take pirate lairs and trade for spice sacks', 0.7,
        pick('tile', 'Hex', [...lairs, ...farms], t => (lairs.includes(t) ? 'Pirate lair' : 'Spice farm'),
          'tile'));
    }
    const hauls = x.hauls.filter(t => near.includes(t));
    if (!u.cargo.length && hauls.length) {
      cmd(`haul:${u.id}`, `${name}: load a fish haul`, 'A haul fills both cargo slots',
        useful(s, seat, 'fish') ? 0.7 : 0.2, pick('tile', 'Shoal', hauls, () => 'Fish haul', 'tile'));
    }
    if (hall && near.includes(hall) && (has(u, 'fish') || has(u, 'spice'))) {
      cmd(`deliver:${u.id}`, `${name}: deliver to the Council`, 'Each haul or sack is a mission step', 0.7);
    }
    const back = x.lairs.filter(l => l.captured && (l.crews[seat] ?? 0) > 0 && l.at !== s.turn.id
      && near.includes(l.tile)).map(l => l.tile);
    if (room(u) >= 1 && back.length) {
      cmd(`recover:${u.id}`, `${name}: take a crew back`, 'Reload a crew from a captured lair',
        crewDemand(s, seat) > aboard(s, seat, 'crew') ? 0.6 : 0.2,
        pick('tile', 'Lair', back, () => 'Captured lair', 'tile'));
    }
    const fresh = !(u.id in v.moves) && !v.done.includes(u.id) && !v.chased.includes(u.id);
    if (fresh && s.pieces.pirate && x.pirate && x.pirate !== seat && near.includes(s.pieces.pirate)) {
      cmd(`chase:${u.id}`, `${name}: chase the pirate`,
        `Roll ${6 - benefits(s, seat, 'pirate')} or more to take over the pirate ship`, 0.3);
    }
    const sailing = sailCommand(s, u, c);
    if (sailing) out.push(sailing);
    if (movesLeft(s, u) > 0 && !v.boosted.includes(u.id)) {
      out.push(command({ id: `explorers/boost:${u.id}`, module: 'explorers', group: 'ships',
        label: `${name}: extra moves`, detail: '+2 moves this turn', hint: 0.3, cost: { wool: 1 } }));
    }
    if (u.cargo.length) {
      cmd(`dump:${u.id}`, `${name}: return cargo`, 'Send one piece back to your supply', 0,
        [pickField('cargo', 'Cargo', [...new Set(u.cargo)].map(k => choice(k, k)))]);
    }
  }
  return out;
}

const without = (cargo: CargoKind[], c: CargoKind) => {
  const i = cargo.indexOf(c);
  return [...cargo.slice(0, i), ...cargo.slice(i + 1)];
};

/** A seat that starts moving trades no more: its answers to open offers become "no". */
function stopTrading(s: State, seat: SeatId) {
  for (const o of Object.values(s.offers)) {
    if (o.from === seat || !['pending', 'accept'].includes(o.responses[seat] ?? '')) continue;
    o.responses[seat] = 'decline';
    o.reasons[seat] = 'Started sailing';
  }
}

/** Die roll: each explored shoal with that number gets a haul (supply, pirate, one per shoal permitting). */
function fish(s: State, seat: SeatId) {
  const x = ext(s), roll = 1 + int(random(s, 'dice'), 6);
  const aboard = Object.values(s.pieces.units).flatMap(w => w.cargo).filter(k => k === 'fish').length;
  const supply = Object.values(s.hidden).filter(f => f.terrain === 'shoal').length - x.hauls.length - aboard;
  const open = (t: string) => face(s, t).number === roll && !x.hauls.includes(t) && s.pieces.pirate !== t;
  const hits = shoals(s).filter(open);
  const placed = hits.slice(0, Math.max(0, supply));
  x.hauls.push(...placed);
  voyageFor(s, seat).fished = true;
  const text = `${seatName(s, seat)} rolled ${roll} for fish${placed.length ? ': a haul appeared' : ''}`;
  emit(s, { kind: 'module', module: 'explorers', name: 'fish', seat, target: placed[0] ?? null, text });
}

export function applyMove(s: State, seat: SeatId, id: string, a: Answer) {
  const [op, unit] = id.split(':'), u = s.pieces.units[unit], v = voyageFor(s, seat), x = ext(s);
  const note = (what: string, target: string | null) => emit(s,
    { kind: 'module', module: 'explorers', name: op, seat, target, text: `${seatName(s, seat)} ${what}` });
  if (!s.seats[seat].moved) stopTrading(s, seat);
  s.seats[seat].moved = true;
  if (op === 'fish') return fish(s, seat);
  need(u && u.seat === seat, 'That ship is gone.');
  const tile = a.picks.tile, lair = lairAt(s, tile ?? '');
  switch (op) {
    case 'sail': return sail(s, seat, u, a.picks.to);
    case 'settle': {
      removeUnit(s, u.id);
      if (v.active === u.id) v.active = null;
      const piece = { vertex: a.picks.at, seat, kind: 'settlement' as const };
      placeBuilding(s, piece);
      emit(s, { kind: 'build', seat, piece: 'settlement', spot: piece.vertex, free: true,
        text: `${seatName(s, seat)}'s settlers founded a settlement` });
      return onBuilt(s, seat, { kind: 'building', piece });
    }
    case 'crew':
      if (lair) {
        lair.crews[seat] = (lair.crews[seat] ?? 0) + 1;
        updateUnit(s, u.id, { cargo: without(u.cargo, 'crew') });
        note('landed a crew on a pirate lair', tile);
        return capture(s, tile, seat);
      }
      (x.spiceVisits[seat] ??= []).push(tile);
      updateUnit(s, u.id, { cargo: [...without(u.cargo, 'crew'), 'spice'] });
      return note('traded with a spice farm', tile);
    case 'haul':
      x.hauls = x.hauls.filter(t => t !== tile);
      updateUnit(s, u.id, { cargo: ['fish'] });
      return note('loaded a fish haul', tile);
    case 'deliver': {
      const n = (k: CargoKind) => u.cargo.filter(c => c === k).length;
      advance(s, seat, 'fish', n('fish'));
      advance(s, seat, 'spices', n('spice'));
      updateUnit(s, u.id, { cargo: u.cargo.filter(c => c !== 'fish' && c !== 'spice') });
      return note('delivered to the Council of Catan', council(s));
    }
    case 'recover':
      lair!.crews[seat]--;
      updateUnit(s, u.id, { cargo: [...u.cargo, 'crew'] });
      return note('took a crew back aboard', tile);
    case 'chase': {
      v.chased.push(u.id);
      const roll = 1 + int(random(s, 'dice'), 6), won = roll >= 6 - benefits(s, seat, 'pirate');
      note(`rolled ${roll} against the pirate${won ? ' and took the pirate ship' : ''}`, s.pieces.pirate);
      return won ? openPirate(s, seat, 'self') : undefined;
    }
    case 'boost': v.boosted.push(u.id); v.moves[u.id] = movesLeft(s, u) + 2; return;
    case 'dump': return updateUnit(s, u.id, { cargo: without(u.cargo, a.picks.cargo as CargoKind) });
  }
}
