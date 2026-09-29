/** Phone/Personal fixtures for every phase at maximum content (4 captains, long names, full menus). Builds on fixtureCombat. */
import type { ActionResult } from '../../../../party-contract/src/index';
import type { Action, ClientProps, PublicView } from '../../src/contracts';
import { hullDef } from '../../src/defs/hulls';
import { sectorMap } from './screens';
import { fixtureCombat } from './view';

/** Combat as captain 0: teleporter and cloak installed, three weapons (one held, one support), an away team on the first enemy, FTL ready. */
export function phoneCombat(opts: { paused?: boolean; wrecked?: boolean; boss?: boolean } = {}): PublicView {
  const v = fixtureCombat(4, 3, opts.boss), ship = v.ships[0], foe = v.ships.find(s => s.faction === 'enemy')!;
  for (const r of ship.rooms) if (r.system === 'teleporter' || r.system === 'cloak') r.tier = 1;
  ship.levels = { ...ship.levels, teleporter: 1, cloak: 1 };
  ship.weapons.push({ uid: 'ally0-w2', defId: 'nanite-lance', charge: .5, target: { shipId: 'ally1', roomId: 'shields' }, auto: true, powered: false });
  ship.weapons[0].charge = 1; ship.weapons[1].auto = false; ship.weapons[1].charge = .8; ship.cloakCooldownMs = 12000;
  const crew = v.crew.filter(c => c.shipId === 'ally0'), room = hullDef(foe.hullId).rooms.find(r => r.system === 'weapons') ?? hullDef(foe.hullId).rooms[0];
  Object.assign(crew[2], { shipId: foe.id, roomId: room.id, x: room.x + .5, y: room.y + .5, state: 'fighting' });
  v.crew.push({ ...crew[0], id: 'ally0-c9', name: 'Wilhelmina', species: 'skitter', role: 'soldier', roomId: 'teleporter', x: 2.5, y: 3.5, hp: 40, state: 'idle' });
  v.combat = { ...v.combat!, ftl: 1, jumpVotes: ['cap1'], paused: !!opts.paused, pausedBy: opts.paused ? v.captains[2].name : null }; // the run stores the captain's name
  if (opts.wrecked) { ship.status = 'destroyed'; ship.hull = 0; }
  return v;
}
const menu = (phase: PublicView['phase'], patch: Partial<PublicView> = {}): PublicView => {
  const v = fixtureCombat(4, 1);
  v.captains.forEach((c, i) => { c.ready = i === 2; c.cargo = i ? [] : [{ id: 'cargo1', kind: 'weapon', defId: 'heavy-laser', ownerId: 'cap0' }, { id: 'cargo2', kind: 'weapon', defId: 'halberd-beam', ownerId: 'cap0' }]; });
  v.captains[0].scrap = 95;
  return { ...v, phase, combat: null, ships: v.ships.filter(s => s.faction === 'ally'), crew: v.crew.filter(c => c.faction === 'ally'), ...patch };
};
export const phoneHangar = () => { const v = menu('hangar'); v.captains[1].hullId = null; v.captains[3].ready = true; return { ...v, ships: v.ships.filter(s => s.captainId !== 'cap1') }; };

/** The dense 11-column sector (every beacon kind); the fleet sits on a wormhole with a shortcut two columns ahead. */
export function phoneMap(): PublicView {
  const v = menu('map', { voteDeadline: Date.now() + 14000 }), map = sectorMap(), links = map.nodes.find(n => n.id === map.currentId)!.links;
  v.map = map; v.captains[0].vote = links[0]; v.captains[1].vote = links[0]; v.captains[2].vote = links.at(-1)!;
  return v;
}
/** One jump from the two sector exits. */
export function phoneRoutes(): PublicView {
  const v = phoneMap(); v.map.currentId = 'n9-1'; v.map.armadaCol = 7;
  v.captains.forEach((c, i) => { c.vote = ['n10-0', 'n10-1', 'n10-1', null][i]; });
  return v;
}
const TEXT = 'A derelict Vesk brood-ship drifts across your bow, its chitin hull split open like a seed pod. Something inside is still broadcasting a distress loop in three languages, one of which your translator insists is "polite screaming". Scans show scrap, a working teleporter pad and eggs.';
export function phoneEvent(result = false): PublicView {
  return menu('event', { voteDeadline: result ? null : Date.now() + 18000, event: { id: 'ev1', title: 'The Screaming Derelict', text: TEXT, deadlineMs: null,
    choices: [{ id: 'a', label: 'Board it carefully and strip the salvage bays', badge: null, available: true, votes: ['cap0', 'cap2'] },
      { id: 'b', label: 'Beam a team straight to the pad', badge: 'Teleporter', available: true, votes: ['cap1'] },
      { id: 'c', label: 'Let the Bastion crew talk to it', badge: 'Bastion crew', available: false, votes: [] },
      { id: 'd', label: 'Pay the salvage guild to tow it (15 scrap each)', badge: '15 scrap', available: true, votes: ['cap3'] }],
    result: result ? 'The eggs hatch the moment you dock. The hatchlings are mostly teeth, but the salvage bays are full.' : null,
    resultLines: result ? ['+24 scrap each', "Captain's Wayfarer −3 hull", 'A Heavy Laser joins the salvage pool', 'Skitter engineer Vex joins Mira'] : [] } });
}
export function phoneLoot(): PublicView {
  return menu('loot', { loot: { scrapEach: 34, claims: { l2: 'cap1', l3: 'cap0' }, items: [
    { id: 'l1', kind: 'weapon', defId: 'burst-laser-ii', ownerId: null }, { id: 'l2', kind: 'augment', defId: 'shield-capacitor', ownerId: null },
    { id: 'l3', kind: 'weapon', defId: 'hellfire-missile', ownerId: null }, { id: 'l4', kind: 'augment', defId: 'precision-optics', ownerId: null }] } });
}
export function phoneStore(): PublicView {
  const v = menu('store', { store: { repairPrice: 3, ammoPrice: 12, offers: [
    { id: 'o1', kind: 'weapon', defId: 'flak-cannon', price: 70, soldTo: null }, { id: 'o2', kind: 'weapon', defId: 'breach-missile', price: 70, soldTo: 'cap2' },
    { id: 'o3', kind: 'weapon', defId: 'aegis-projector', price: 55, soldTo: null }, { id: 'o4', kind: 'augment', defId: 'auto-loader', price: 60, soldTo: null },
    { id: 'o5', kind: 'augment', defId: 'fire-suppressant', price: 40, soldTo: null }, { id: 'o6', kind: 'system', defId: 'teleporter', price: 75, soldTo: null },
    { id: 'o7', kind: 'crew', defId: 'soldier', price: 50, soldTo: null, crew: { name: 'Wilhelmina', species: 'ember', role: 'soldier' } }] } });
  v.ships[0].augments = ['scrap-magnet', 'hull-welders'];
  return v;
}
export const phoneOver = (): PublicView => { const v = menu('over', { result: 'victory', message: 'The Flagship breaks apart over Armada Reach. Drinks are on Mira.' }); v.captains.forEach((c, i) => c.stats = { damage: 40 + i * 17, kills: 3 + i, repairs: 11 - i, scrapEarned: 210 + i * 33, saves: i }); return v; };

export const PHASES = { hangar: phoneHangar, map: phoneMap, routes: phoneRoutes, event: phoneEvent, result: () => phoneEvent(true), loot: phoneLoot, store: phoneStore, combat: phoneCombat, paused: () => phoneCombat({ paused: true }), wrecked: () => phoneCombat({ wrecked: true }), boss: () => phoneCombat({ boss: true }), over: phoneOver };
/** Client props for captain 0 (player p0) with a recording mock sendAction. */
export function phoneProps(view: PublicView, patch: Partial<ClientProps> = {}, log: Action[] = []): ClientProps {
  return { roomId: 'r1', roundId: 'round1', playerId: 'p0', viewRole: 'controller', isHost: false, publicView: view, privateView: { captainId: 'cap0' }, connected: true,
    serverNowMs: () => Date.now(), setInput() {}, assetsReady() {}, sendAction: async (action: Action): Promise<ActionResult> => { log.push(action); return { accepted: true }; }, ...patch };
}
