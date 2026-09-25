/** Captain combat orders. Every check runs before anything changes. */
import type { Ship } from '../contracts';
import { alive, context, crewOn, dest, level, roomDef, slotsOf, space, stationOf, wdef } from './core';
import { beam, orderCrew, send, teleportCapacity } from './crew';
import { cloak, fire } from './combat';
import type { CombatCommand, CombatWorld } from './index';

function fail(message: string): never { throw new Error(message); }

export function applyCombatCommand(world: CombatWorld, captainId: string, command: CombatCommand) {
  if (world.combat.outcome) fail('The battle is over.');
  if (command.type === 'crew') return orderCrew(world, captainId, command.crewIds, command.roomId);
  const ctx = context(world, world.combat), ship = world.ships.find(s => s.captainId === captainId && s.status === 'active') ?? fail('Your ship is out of action.');
  const weapon = (uid: string) => ship.weapons.find(w => w.uid === uid) ?? fail("That weapon isn't yours.");
  switch (command.type) {
    case 'target': {
      const w = weapon(command.weapon), ally = wdef(w.defId).target === 'ally', to = ctx.ships.get(command.shipId);
      if (to?.status !== 'active') fail('That ship is out of the fight.');
      if (ally !== (to.faction === ship.faction)) fail(ally ? 'Support weapons target allies.' : 'Target an enemy ship.');
      if (!roomDef(to, command.roomId)) fail("That room isn't on that ship.");
      w.target = { shipId: to.id, roomId: command.roomId };
      return;
    }
    case 'untarget': weapon(command.weapon).target = null; return;
    case 'autofire': weapon(command.weapon).auto = command.auto; return;
    case 'fire': if (!ship.weapons.map((_, i) => fire(ctx, ship, i)).some(Boolean)) fail('No weapons are ready to fire.'); return;
    case 'stations':
      for (const m of crewOn(ctx, ship)) {
        const st = m.ownerId === captainId && stationOf(ship, m);
        if (st && dest(m) !== st && space(ship, st, m.faction, crewOn(ctx, ship)) > 0) send(ship, m, st);
      }
      return;
    case 'cloak': {
      const room = ship.rooms.find(r => r.system === 'cloak' && r.tier) ?? fail('Your ship has no cloak.');
      if (!level(room)) fail('Your cloak is offline.');
      if (ship.cloakMs > 0) fail('Already cloaked.');
      if (ship.cloakCooldownMs > 0) fail('Cloak is recharging.');
      return cloak(ctx, ship);
    }
    case 'teleport': {
      // Crew anywhere aboard may be sent: they walk to the pad and depart together once all of them stand on it and it is ready (see departures()).
      const pad = ship.rooms.find(r => r.system === 'teleporter' && r.tier) ?? fail('Your ship has no teleporter.'), to = ctx.ships.get(command.shipId);
      const capacity = Math.min(teleportCapacity(pad.tier), slotsOf(roomDef(ship, pad.id)!).length), crew = [...new Set(command.crewIds)].map(id => {
        const m = world.crew.find(k => k.id === id);
        if (!m || m.ownerId !== captainId) fail("That crew member isn't yours.");
        if (!alive(m)) fail('That crew member has fallen.');
        if (m.shipId !== ship.id) fail('Only crew aboard your own ship can use its teleporter.');
        return m;
      });
      if (!crew.length) fail('Pick crew to teleport.');
      if (crew.length > capacity) fail(`Your teleporter carries ${capacity} crew.`);
      if (to?.status !== 'active') fail('That ship is out of the fight.');
      if (to === ship) fail('Pick another ship.');
      if (!roomDef(to, command.roomId)) fail("That room isn't on that ship.");
      if (space(to, command.roomId, 'ally', crewOn(ctx, to)) < crew.length) fail('Not enough space in that room.');
      if (level(pad) && ship.teleportCooldownMs <= 0 && crew.every(m => m.roomId === pad.id && !m.path.length)) return beam(ctx, ship, crew, to, command.roomId);
      const walking = crew.filter(m => dest(m) !== pad.id);
      if (space(ship, pad.id, 'ally', crewOn(ctx, ship)) < walking.length) fail('Your teleporter room is full.');
      for (const m of crew) m.beam = { shipId: to.id, roomId: command.roomId };
      for (const m of walking) send(ship, m, pad.id);
      return;
    }
    case 'recall': {
      const { room, capacity } = teleporter(ship, true), from = ctx.ships.get(command.shipId);
      if (!from || from === ship) fail('Pick another ship.');
      const away = crewOn(ctx, from).filter(m => m.ownerId === captainId);
      if (!away.length) fail('None of your crew are aboard that ship.');
      const n = Math.min(capacity, space(ship, room.id, 'ally', crewOn(ctx, ship)));
      if (n <= 0) fail('Your teleporter room is full.');
      return beam(ctx, ship, away.slice(0, n), ship, room.id);
    }
  }
}
/** Recall is the panic button: it works while the teleporter recharges (and restarts the cooldown). */
function teleporter(ship: Ship, recall = false) {
  const room = ship.rooms.find(r => r.system === 'teleporter' && r.tier) ?? fail('Your ship has no teleporter.');
  if (!level(room)) fail('Your teleporter is offline.');
  if (ship.teleportCooldownMs > 0 && !recall) fail('Teleporter is recharging.');
  return { room, capacity: teleportCapacity(level(room)) };
}
