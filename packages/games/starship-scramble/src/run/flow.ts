/** Phase flow: hangar launch, fleet votes, jumps and beacon arrivals, event continuation. */
import type { Captain, MapNode } from '../contracts';
import { sectorDef } from '../content/sectors';
import { PLAYER_HULLS, hullDef } from '../defs/hulls';
import { createShip } from '../sim';
import { startFight } from './combat';
import { ALL_VOTED_MS, available, choicesOf, eventDef, pickEvent, resolveChoice } from './events';
import { openLoot, openStore, refit } from './fleet';
import { generateMap } from './map';
import { pick } from './rng';
import { allReady, currentNode, enter, fleet, online, recruit, say, shipOf, type State } from './state';

/** Put a captain's chosen hull on the pad (a crewless preview until launch). Unnamed ships are "<captain>'s <hull>" when that fits 16 characters. */
export function commission(s: State, c: Captain, hullId: string, name: string, paint: string) {
  const hull = hullDef(hullId), slot = s.captains.indexOf(c), id = `s${slot}`, mine = `${c.name}'s ${hull.name}`;
  const ship = createShip({ id, faction: 'ally', captainId: c.id, enemyId: null, hullId, name: name || (mine.length <= 16 ? mine : hull.name), paint, slot, weapons: hull.startWeapons, ammo: hull.startAmmo, augments: [], ai: null, fleeBelow: 0, phases: [] });
  ship.autopilot = !c.connected;
  const at = s.ships.findIndex(other => other.id === id);
  if (at >= 0) s.ships[at] = ship; else s.ships.push(ship);
  c.shipId = id; c.hullId = hullId;
}
export function launch(s: State) {
  s.captains.forEach((c, i) => { if (!c.shipId) commission(s, c, PLAYER_HULLS[i % PLAYER_HULLS.length].id, '', c.color); });
  for (const c of s.captains) { const ship = shipOf(s, c); for (const k of hullDef(ship.hullId).startCrew) recruit(s, c.id, ship, k.species, k.role); refit(s, ship); }
  s.ships.sort((a, b) => a.slot - b.slot);
  enter(s, 'map'); say(s, `The fleet launches into ${s.map.name}`);
}

/** Plurality of cast votes once the deadline passes (1.5 s after every connected captain voted, else 20 s after the first vote); seeded ties. */
function tallyVotes(s: State, options: string[], nowMs: number) {
  if (s.deadline === null) return null;
  if (online(s).every(c => c.vote !== null)) s.deadline = Math.min(s.deadline, nowMs + ALL_VOTED_MS);
  if (nowMs < s.deadline) return null;
  const counts = options.map(id => s.captains.filter(c => c.vote === id).length), best = Math.max(...counts);
  if (best > 0) return pick(s, options.filter((_, i) => counts[i] === best));
  for (const c of s.captains) c.vote = null;
  s.deadline = null; return null;
}

export function tickMap(s: State, nowMs: number) {
  const winner = tallyVotes(s, currentNode(s).links, nowMs);
  if (winner) jump(s, s.map.nodes.find(n => n.id === winner)!);
}
export function tickEvent(s: State, nowMs: number) {
  const ev = s.event!;
  if (ev.outcome) { if (allReady(s) || nowMs >= s.deadline!) proceed(s); return; }
  const choices = choicesOf(eventDef(ev.defId)).filter(ch => available(s, ch)), winner = tallyVotes(s, choices.map(ch => ch.id), nowMs);
  if (!winner) return;
  resolveChoice(s, choices.find(ch => ch.id === winner)!, nowMs);
  if (!ev.outcome!.text && !ev.outcome!.lines.length) proceed(s);
}

function jump(s: State, node: MapNode) {
  node.visited = true; s.map.currentId = node.id; s.map.armadaCol++; s.fleetStats.jumps++;
  for (const ship of fleet(s)) if (ship.augments.includes('hull-welders')) ship.hull = Math.min(ship.maxHull, ship.hull + 2);
  if (node.kind === 'exit') return nextSector(s);
  if (node.kind === 'boss') return openEvent(s, 'flagship-hail');
  if (node.col <= s.map.armadaCol) return openEvent(s, 'armada-ambush');
  if (node.kind === 'store') return openStore(s);
  const def = pickEvent(s, node.kind);
  if (def) return openEvent(s, def.id);
  if (node.kind === 'hostile') return startFight(s, { kind: 'combat', enemies: 'sector' }, false);
  enter(s, 'map'); say(s, 'A quiet beacon. The fleet catches its breath.');
}
function nextSector(s: State) {
  s.sectorIndex++; s.revealed = false;
  s.map = generateMap(s, sectorDef(s.sectors[s.sectorIndex]), s.sectorIndex === s.sectors.length - 1);
  enter(s, 'map'); say(s, `Entering ${s.map.name}`);
}
export function openEvent(s: State, defId: string) {
  s.event = { defId, outcome: null, next: null };
  if (!s.seen.includes(defId)) s.seen.push(defId);
  enter(s, 'event'); say(s, eventDef(defId).title);
}
/** After Continue: chained event, battle, store, pending spoils, or back to the map. */
function proceed(s: State) {
  const { defId, next } = s.event!;
  s.event = null;
  if (next?.kind === 'event') return openEvent(s, next.eventId);
  if (next?.kind === 'combat') return startFight(s, next, defId === 'armada-ambush');
  if (next?.kind === 'store') return openStore(s);
  if (s.pending.length) return openLoot(s, 0, 0);
  enter(s, 'map');
}
/** Loot and store end when every connected captain is ready. */
export function leave(s: State) { s.loot = null; s.offers = null; enter(s, 'map'); say(s, 'Plot the next jump'); }
