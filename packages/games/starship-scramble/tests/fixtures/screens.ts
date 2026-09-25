/** Maximum-content PublicView fixtures for every non-combat TV screen. No simulation required. */
import type { MapNode, NodeKind, PublicView } from '../../src/contracts';
import { PLAYER_HULLS } from '../../src/defs/hulls';
import { fixtureCombat } from './view';

export const NOW = 1_000_000;
export const NAMES = ['Captain Longname', 'Mira Vale', 'Oskar the Boldly', 'Maximilian Wolfe'];

/** A peaceful fleet of `n` captains (16-character names), ships and crew but no enemies. */
export function fleet(n = 4, phase: PublicView['phase'] = 'map'): PublicView {
  const view = fixtureCombat(n, 1);
  view.captains.forEach((c, i) => { c.name = NAMES[i]; c.scrap = [124, 38, 7, 260][i]; });
  view.ships = view.ships.filter(s => s.faction === 'ally').map((s, i) => ({ ...s, name: `${['Dawnrunner', 'Kestrel', 'Iron Aunt', 'Sunwake'][i]}` }));
  view.crew = view.crew.filter(c => c.faction === 'ally');
  return { ...view, phase, combat: null, map: sectorMap(), sectorIndex: 1, sectorCount: 3, reserves: 2, fleetStats: { jumps: 9, kills: 11, scrap: 612, lostShips: 1 } };
}

export function hangar(captains = 4, chosen = captains): PublicView {
  const view = fleet(captains, 'hangar');
  view.captains.forEach((c, i) => Object.assign(c, { shipId: null, hullId: i < chosen ? PLAYER_HULLS[[0, 4, 2, 1][i]].id : null, ready: i < chosen && i % 2 === 0 }));
  if (captains > 2) view.captains.at(-1)!.connected = false;
  return { ...view, ships: [], crew: [], map: { ...view.map, nodes: [] }, sectorIndex: 0 };
}

/** A 7-column map with 1–4 rows per column, the fleet two jumps in, the Armada one column behind. */
export function sectorMap(): PublicView['map'] {
  const rows = [1, 3, 4, 3, 4, 3, 1];
  const kinds: NodeKind[][] = [['start'], ['hostile', 'unknown', 'distress'], ['store', 'nebula', 'hostile', 'unknown'], ['distress', 'hostile', 'unknown'], ['unknown', 'store', 'hostile', 'nebula'], ['hostile', 'distress', 'unknown'], ['exit']];
  const at = (n: number, r: number) => n === 1 ? .5 : r / (n - 1);
  const nodes: MapNode[] = rows.flatMap((n, col) => Array.from({ length: n }, (_, row) => ({ id: `n${col}-${row}`, col, row, x: .06 + col / 6 * .88 + ((col * 7 + row * 3) % 5 - 2) * .012,
    y: .14 + .72 * at(n, row) + ((col * 5 + row) % 3 - 1) * .025, kind: kinds[col][row], links: [], visited: false, hazard: kinds[col][row] === 'nebula' ? 'nebula' : (col + row) % 4 === 1 ? 'asteroids' : 'none' })));
  for (const node of nodes) {
    const next = nodes.filter(m => m.col === node.col + 1), t = at(rows[node.col], node.row);
    node.links = next.filter(m => Math.abs(at(rows[m.col], m.row) - t) <= .34).map(m => m.id);
    if (!node.links.length && next.length) node.links = [next.reduce((a, b) => Math.abs(at(rows[a.col], a.row) - t) < Math.abs(at(rows[b.col], b.row) - t) ? a : b).id];
  }
  for (const id of ['n0-0', 'n1-1', 'n2-1']) nodes.find(n => n.id === id)!.visited = true;
  return { sectorId: 'veil', name: 'The Veil', theme: 'Vesk Hive space', nodes, currentId: 'n2-1', armadaCol: 1, columns: 7 };
}
export function mapVote(): PublicView {
  const view = fleet(4, 'map'), [a, b] = view.map.nodes.find(n => n.id === view.map.currentId)!.links;
  view.captains.forEach((c, i) => { c.vote = [a, a, b, null][i]; });
  return { ...view, voteDeadline: NOW + 14_000 };
}
/** First jump of a sector: the Armada has not arrived yet. */
export function mapStart(): PublicView {
  const view = fleet(2, 'map'); view.map.armadaCol = -1; view.map.currentId = 'n0-0';
  view.map.nodes.forEach(n => { n.visited = n.id === 'n0-0'; });
  return view;
}
/** The last sector ends at the Flagship. */
export function mapFinal(): PublicView {
  const view = mapVote(); view.map.nodes.at(-1)!.kind = 'boss';
  return { ...view, sectorIndex: 2, map: { ...view.map, sectorId: 'meridian', name: 'Meridian Deep', theme: 'Warden space', armadaCol: 2 } };
}

const TEXT = 'A Vesk brood-ship drifts across the beacon, hull split and weeping green light. Its distress call repeats in eight languages, all of them wrong. Something inside is still moving. Your sensors count forty life signs, then four, then forty again. The Armada is two jumps behind you.';
export function event(result = false): PublicView {
  const view = fleet(4, 'event');
  view.captains.forEach((c, i) => { c.vote = ['board', 'board', 'scan', null][i]; c.ready = result && i < 2; });
  view.event = { id: 'brood-drift', title: 'The Weeping Brood-Ship', text: TEXT, deadlineMs: null, result: result ? 'Your Ember brawlers kick open the airlock. The brood is asleep, mostly. You leave with a cargo hold of chitin plating and one very small stowaway who refuses to leave the medbay.' : null,
    resultLines: result ? ['+24 scrap each', 'Kestrel −3 hull', 'A Skitter engineer joins Mira Vale', 'Weapon added to salvage', 'The Armada advances one beacon'] : [],
    choices: [
      { id: 'board', label: 'Send a boarding party through the ruptured cargo bay and take what we can', badge: 'Teleporter', available: true, votes: ['cap0', 'cap1'] },
      { id: 'scan', label: 'Scan the brood from a safe distance first', badge: 'Engines 3', available: true, votes: ['cap2'] },
      { id: 'hail', label: 'Hail them in their own tongue', badge: 'Bastion crew', available: false, votes: [] },
      { id: 'leave', label: 'Leave them to the dark and jump away', badge: null, available: true, votes: [] }] };
  return { ...view, voteDeadline: result ? null : NOW + 9_000 };
}

export function loot(): PublicView {
  const view = fleet(4, 'loot'), ids = ['burst-laser-ii', 'hellfire-missile', 'aegis-projector', 'halberd-beam'];
  const items = [...ids.map((defId, i) => ({ id: `it${i}`, kind: 'weapon' as const, defId, ownerId: null })), { id: 'it4', kind: 'augment' as const, defId: 'shield-capacitor', ownerId: null }, { id: 'it5', kind: 'augment' as const, defId: 'precision-optics', ownerId: null }];
  view.captains.forEach((c, i) => { c.ready = i === 1; });
  return { ...view, loot: { scrapEach: 38, items, claims: { it0: 'cap2', it3: 'cap0', it4: 'cap3' } } };
}

export function store(): PublicView {
  const view = fleet(4, 'store');
  const offers = [['weapon', 'flak-cannon', 70, null], ['weapon', 'breach-missile', 70, 'cap1'], ['weapon', 'medic-pulse', 40, null], ['augment', 'auto-loader', 60, null], ['augment', 'hull-welders', 55, 'cap3'], ['augment', 'missile-recycler', 45, null], ['system', 'teleporter', 75, null]] as const;
  view.captains.forEach((c, i) => { c.ready = i === 2; });
  const recruit = { id: 'of7', kind: 'crew' as const, defId: 'engineer', price: 45, soldTo: null, crew: { name: 'Bartholomew', species: 'bastion' as const, role: 'engineer' as const } };
  return { ...view, store: { offers: [...offers.map(([kind, defId, price, soldTo], i) => ({ id: `of${i}`, kind, defId, price, soldTo })), recruit], repairPrice: 2, ammoPrice: 12 } };
}

export function over(result: 'victory' | 'defeat' = 'victory'): PublicView {
  const view = fleet(4, 'over');
  const stats = [[48, 6, 9, 310, 2], [31, 3, 22, 190, 4], [48, 2, 4, 205, 0], [12, 0, 9, 160, 1]];
  view.captains.forEach((c, i) => { const [damage, kills, repairs, scrapEarned, saves] = stats[i]; c.stats = { damage, kills, repairs, scrapEarned, saves }; c.hullId = PLAYER_HULLS[i].id; });
  if (result === 'defeat') view.captains[2].status = 'wrecked';
  return { ...view, result, message: result === 'victory' ? 'The Flagship breaks apart over Armada Reach.' : 'The fleet was lost in The Veil.' };
}

export const SCREENS: Record<string, () => PublicView> = {
  'hangar-0': () => hangar(4, 0), 'hangar-1': () => hangar(1, 1), 'hangar-2': () => hangar(2, 2), 'hangar-3': () => hangar(3, 2), 'hangar-4': () => hangar(4, 4),
  map: mapVote, 'map-start': mapStart, 'map-final': mapFinal, event: () => event(false), 'event-result': () => event(true), loot, store, victory: () => over('victory'), defeat: () => over('defeat'),
};
