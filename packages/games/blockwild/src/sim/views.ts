/** Projections sent to clients: the public View, per-player PrivateView and the results Outcome. */
import type { Outcome } from '../../../../party-contract/src/index';
import { awards } from '../shared/awards';
import { inNether } from '../shared/constants';
import { cellIndex } from '../shared/coords';
import { SMELT_SECONDS } from '../shared/inventory';
import { armorPoints, type Slot } from '../shared/items';
import { breakTime, crackStage } from '../shared/mining';
import { MOB, MS, PF, q2, q3, type JournalEntry, type PrivateView, type PubMob, type PubPlayer, type Screen, type View } from '../shared/protocol';
import { mobState } from './combat';
import { screenSlots } from './containers';
import { newPlayer } from './players';
import { fxList, playerById, type Mob, type Player, type State } from './state';
import { tradeScreen } from './villagers';

const copySlot = (slot: Slot | null): Slot | null => !slot ? null : slot.d ? { id: slot.id, n: slot.n, d: slot.d } : { id: slot.id, n: slot.n };
const copySlots = (slots: readonly (Slot | null)[]) => slots.map(copySlot);

/** Edits as [cellIndex, value] pairs, rebuilt only when the revision changes. */
function editList(state: State): [number, number][] {
  if (state.editsCache.revision !== state.revision) state.editsCache = { revision: state.revision, list: [...state.world.edits] };
  return state.editsCache.list;
}

function flagsOf(player: Player): number {
  return (player.sneaking ? PF.SNEAKING : 0) | (player.sleeping ? PF.SLEEPING : 0) | (player.dead ? PF.DEAD : 0)
    | (player.flying ? PF.FLYING : 0) | (player.useStart >= 0 ? PF.USING : 0) | (player.connected ? 0 : PF.OFFLINE) | (player.fire > 0 ? PF.BURNING : 0);
}
const armorIds = (armor: readonly (Slot | null)[]): PubPlayer['armor'] => [armor[0]?.id ?? 0, armor[1]?.id ?? 0, armor[2]?.id ?? 0, armor[3]?.id ?? 0];
function pubPlayer(state: State, player: Player): PubPlayer {
  const view: PubPlayer = {
    id: player.id, name: player.name, color: player.color, x: q2(player.x), y: q2(player.y), z: q2(player.z), yaw: q3(player.yaw), pitch: q3(player.pitch),
    held: player.inv[player.slot]?.id ?? 0, swing: player.swing, hurt: player.hurt, health: q2(player.health), flags: flagsOf(player), armor: armorIds(player.armor),
  };
  const mine = player.mine;
  if (mine && state.settings.mode === 'survival' && !player.dead) {
    const seconds = breakTime(state.get(mine.x, mine.y, mine.z), view.held, player.onGround, player.inWater);
    if (seconds > 0 && seconds < Infinity) view.mine = [mine.x, mine.y, mine.z, crackStage((state.clock - mine.start) / seconds)];
  }
  return view;
}

export function publicView(state: State): View {
  const { settings } = state;
  const view: View = {
    seed: settings.seed, worldId: state.worldId, mode: settings.mode, difficulty: settings.difficulty, time: Math.floor(state.time), day: state.day,
    revision: state.revision, edits: editList(state),
    players: state.players.map(player => pubPlayer(state, player)),
    mobs: state.mobs.map(mob => pubMob(state, mob)),
    items: state.items.map(item => ({ id: item.id, item: item.item, n: item.n, x: q2(item.x), y: q2(item.y), z: q2(item.z) })),
    arrows: state.arrows.map(a => {
      const arrow = { id: a.id, x: q2(a.x), y: q2(a.y), z: q2(a.z), vx: q2(a.vx), vy: q2(a.vy), vz: q2(a.vz) };
      return a.k ? { ...arrow, k: a.k } : arrow;
    }),
    fx: fxList(state), sleeping: state.players.filter(player => player.sleeping).length, stats: { ...state.stats },
  };
  if (state.finished) view.journal = journalOf(state);
  return view;
}

function pubMob(state: State, mob: Mob): PubMob {
  const s = mobState(mob) | (mob.target !== null && state.clock < mob.aggroUntil ? MS.ANGRY : 0) | (mob.fire > 0 ? MS.BURNING : 0);
  const view: PubMob = { id: mob.id, t: mob.t, x: q2(mob.x), y: q2(mob.y), z: q2(mob.z), yaw: q3(mob.yaw), hurt: mob.hurt, a: mob.a };
  if (s) view.s = s;
  if (mob.t === MOB.villager) view.p = mob.p;
  return view;
}

function screenView(state: State, player: Player): Screen | null {
  const screen = player.screen;
  if (!screen) return null;
  if (screen.kind === 'trade') return tradeScreen(state, player);
  const base = { kind: screen.kind, x: screen.x, y: screen.y, z: screen.z, slots: copySlots(screenSlots(state, player) ?? []) };
  if (screen.kind !== 'furnace') return base;
  const furnace = state.furnaces.get(cellIndex(screen.x, screen.y, screen.z));
  return { ...base, burn: q2(furnace?.burn ?? 0), burnMax: q2(furnace?.burnMax ?? 0), cook: q2(furnace?.cook ?? 0), cookMax: SMELT_SECONDS };
}

export function playerView(state: State, playerId: string): PrivateView {
  const player = playerById(state, playerId) ?? newPlayer(playerId, '', '#ffffff', state.spawn);
  const view: PrivateView = {
    ack: player.ack, tp: { ...player.tp }, imp: { ...player.imp },
    inv: copySlots(player.inv), cursor: copySlot(player.cursor), grid: copySlots(player.grid), out: copySlot(player.out), screen: screenView(state, player),
    health: q2(player.health), food: player.food, saturation: q2(player.saturation), air: Math.round(player.air),
    dead: player.dead, spawn: player.bed ? [...player.bed] : [q2(state.spawn[0]), q2(state.spawn[1]), q2(state.spawn[2])], mode: state.settings.mode,
    keepInventory: state.settings.keepInventory, armor: copySlots(player.armor), armorPoints: armorPoints(player.armor),
    dimension: inNether(player.x, player.z) ? 'nether' : 'overworld',
  };
  const burning = Math.ceil(player.fire * 20), portal = q2(player.portal);
  if (burning > 0) view.burning = burning;
  if (portal > 0) view.portal = portal;
  const protectedTicks = Math.ceil((player.protectedUntil - state.clock) * 20);
  if (protectedTicks > 0 && !player.dead) view.protectedTicks = protectedTicks;
  if (player.dead) view.deathMessage = player.deathMessage;
  if (player.toast) view.toast = { ...player.toast };
  return view;
}

const journalOf = (state: State): JournalEntry[] => state.players.map(({ id, stats }) => ({ ...stats, id, distance: Math.round(stats.distance) }));

/** Cooperative results: everyone wins once the host finishes; each row reads as a short highlight reel led by its awards. */
export function outcome(state: State): Outcome {
  const won = awards(journalOf(state));
  const rows = state.players.map(player => {
    const s = player.stats, parts = [...won.filter(award => award.ids.includes(player.id)).map(award => award.title), `${s.mined} mined`, `${s.placed} placed`, `${s.crafted} crafted`];
    if (s.mobs) parts.push(`${s.mobs} mob${s.mobs === 1 ? '' : 's'}`);
    parts.push(`${Math.round(s.distance)} m walked`);
    if (s.deaths) parts.push(`${s.deaths} death${s.deaths === 1 ? '' : 's'}`);
    return { playerId: player.id, score: s.mined + s.placed + s.crafted + s.mobs * 5, label: parts.join(' · ') };
  });
  return { complete: state.finished, winners: state.finished ? state.players.map(player => player.id) : [], rows };
}
