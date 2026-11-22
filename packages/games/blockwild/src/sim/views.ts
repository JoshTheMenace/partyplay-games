/** Projections sent to clients: the public View, per-player PrivateView and the results Outcome. */
import type { Outcome } from '../../../../party-contract/src/index';
import { awards } from '../shared/awards';
import { dimensionAt } from '../shared/constants';
import { cellIndex } from '../shared/coords';
import { SMELT_SECONDS } from '../shared/inventory';
import { armorPoints, type Slot } from '../shared/items';
import { breakTime, crackStage } from '../shared/mining';
import { encodeLedger,
  encodeArrow, encodeFx, encodeItem, encodeMob, encodePlayer, encodeRoster, MOB, MS, nearEvery, PF, q2, rosterEvery, tvEvery,
  type Bag, type FxKind, type JournalEntry, type PrivateView, type PubMob, type PubPlayer, type Screen, type View, type Who, type WireScene,
} from '../shared/protocol';
import { cityLedger, cityOutcome, cityPrivate, cityPublic, cityScene, PARKED_EVERY } from './city';
import { mobState } from './combat';
import { screenSlots } from './containers';
import { bossView } from './dragon';
import { victoryView } from './end';
import { newPlayer, sleepNeed } from './players';
import { activePlayers, fxList, playerById, type Frame, type Mob, type Player, type State } from './state';
import { tradeScreen } from './villagers';

const copySlot = (slot: Slot | null): Slot | null => !slot ? null : slot.d ? { id: slot.id, n: slot.n, d: slot.d } : { id: slot.id, n: slot.n };
const copySlots = (slots: readonly (Slot | null)[]) => slots.map(copySlot);

/**
 * How far (blocks, measured across the ground) each kind of thing is sent to a screen. Players show furthest so a
 * friend on the next hill is still there; `wide` mobs are the ones seen from across a region (ghasts, the dragon and
 * its crystals). The watching display gets a tighter set around the player its camera follows.
 */
const NEAR = { players: 96, mobs: 72, items: 40, arrows: 72 }, TV = { players: 64, mobs: 56, items: 24, arrows: 56 };
/** Every phone receives the display's feed too, so it also has a size: the nearest few of each kind round the followed player. */
const TV_MOST = { players: 24, mobs: 24, items: 12, arrows: 16, fx: 24 };
const FX_RANGE = 64, FX_FAR = 128, FAR_FX: ReadonlySet<FxKind> = new Set(['explode', 'crystal', 'portalOpen', 'ghast', 'fireball', 'blazeShoot', 'scream']);
const WIDE: Partial<Record<number, number>> = { [MOB.ghast]: 128, [MOB.ender_dragon]: 320, [MOB.end_crystal]: 320 };

/** Consolidated edits as [cellIndex, value] pairs, rebuilt only when the tail is folded in (sim/journal.ts). */
function editList(state: State): [number, number][] {
  if (state.editsCache.revision !== state.revision) state.editsCache = { revision: state.revision, list: [...state.world.edits] };
  return state.editsCache.list;
}

function flagsOf(player: Player): number {
  return (player.sneaking ? PF.SNEAKING : 0) | (player.sleeping ? PF.SLEEPING : 0) | (player.dead ? PF.DEAD : 0)
    | (player.flying ? PF.FLYING : 0) | (player.useStart >= 0 ? PF.USING : 0) | (player.connected ? 0 : PF.OFFLINE) | (player.fire > 0 ? PF.BURNING : 0);
}
/** Flags with the city's two: riding a vehicle (the body is not drawn) and seeing stars. */
function flagsIn(state: State, player: Player): number {
  const cp = state.city?.players[player.seat];
  return flagsOf(player) | (cp?.ride ? PF.RIDING : 0) | (cp && state.clock < cp.dizzyUntil ? PF.DIZZY : 0);
}
const armorIds = (armor: readonly (Slot | null)[]): PubPlayer['armor'] => [armor[0]?.id ?? 0, armor[1]?.id ?? 0, armor[2]?.id ?? 0, armor[3]?.id ?? 0];
function playerTuple(state: State, player: Player): number[] {
  const held = player.inv[player.slot]?.id ?? 0, mine = player.mine;
  let crack: [number, number, number, number] | undefined;
  if (mine && state.settings.mode !== 'creative' && !player.dead) {
    const seconds = breakTime(state.get(mine.x, mine.y, mine.z), held, player.onGround, player.inWater);
    if (seconds > 0 && seconds < Infinity) crack = [mine.x, mine.y, mine.z, crackStage((state.clock - mine.start) / seconds)];
  }
  return encodePlayer(player.seat, {
    x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, held, swing: player.swing, hurt: player.hurt, health: player.health,
    flags: flagsIn(state, player), armor: armorIds(player.armor), ...crack ? { mine: crack } : {},
  });
}

function mobTuple(state: State, mob: Mob): number[] {
  const s = mobState(mob) | (mob.target !== null && state.clock < mob.aggroUntil ? MS.ANGRY : 0) | (mob.fire > 0 ? MS.BURNING : 0);
  const view: PubMob = { id: mob.id, t: mob.t, x: mob.x, y: mob.y, z: mob.z, yaw: mob.yaw, hurt: mob.hurt, a: mob.a };
  if (s) view.s = s;
  if (mob.t === MOB.villager) view.p = mob.p;
  if (mob.pt) view.pt = mob.pt;
  if (mob.t === MOB.ender_dragon) view.ph = mob.ph;
  return encodeMob(view);
}

/** Every entity of this tick as a wire tuple, built once and then filtered for each screen. */
function buildFrame(state: State): Frame {
  const fx = fxList(state);
  return state.frame = {
    tick: state.ticks, players: state.players.map(player => playerTuple(state, player)),
    mobs: state.mobs.map(mob => mobTuple(state, mob)), mobRange: state.mobs.map(mob => WIDE[mob.t] ?? 0),
    items: state.items.map(item => encodeItem(item)), arrows: state.arrows.map(arrow => encodeArrow(arrow)),
    fx: fx.map(encodeFx), fxRange: fx.map(entry => entry.k === 'dragonDeath' ? 320 : FAR_FX.has(entry.k) ? FX_FAR : FX_RANGE),
  };
}
/** The frame of the current tick: `publicView` always builds a fresh one, the private views after it reuse that. */
const frameOf = (state: State) => state.frame?.tick === state.ticks && state.frame.players.length === state.players.length ? state.frame : buildFrame(state);

/** The tuples within reach of (x, z); `at` is the index of x in a tuple (z is two further on). */
function within(tuples: readonly number[][], at: number, x: number, z: number, range: number, wider?: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < tuples.length; i++) {
    const tuple = tuples[i]!, dx = tuple[at]! - x, dz = tuple[at + 2]! - z, r = Math.max(range, wider?.[i] ?? 0);
    if (dx * dx + dz * dz <= r * r) out.push(tuple);
  }
  return out;
}
/** The `most` tuples nearest (x, z), in their original order (so a scene's seats stay sorted). */
function nearest(tuples: number[][], at: number, x: number, z: number, most: number): number[][] {
  if (tuples.length <= most) return tuples;
  const far = (tuple: number[]) => (tuple[at]! - x) ** 2 + (tuple[at + 2]! - z) ** 2, keep = new Set([...tuples].sort((a, b) => far(a) - far(b)).slice(0, most));
  return tuples.filter(tuple => keep.has(tuple));
}
function tvScene(frame: Frame, x: number, z: number): WireScene {
  const scene = sceneAround(frame, x, z, TV);
  return { p: nearest(scene.p, 1, x, z, TV_MOST.players), m: nearest(scene.m, 2, x, z, TV_MOST.mobs), i: nearest(scene.i, 3, x, z, TV_MOST.items), a: nearest(scene.a, 1, x, z, TV_MOST.arrows), f: scene.f.slice(-TV_MOST.fx) };
}
function sceneAround(frame: Frame, x: number, z: number, range: typeof NEAR): WireScene {
  return {
    p: within(frame.players, 1, x, z, range.players), m: within(frame.mobs, 2, x, z, range.mobs, frame.mobRange), i: within(frame.items, 3, x, z, range.items),
    a: within(frame.arrows, 1, x, z, range.arrows), f: within(frame.fx, 2, x, z, 0, frame.fxRange),
  };
}

const whoCache = new WeakMap<readonly Player[], Who[]>();
function whoOf(players: readonly Player[]): Who[] {
  let who = whoCache.get(players);
  if (!who || who.length !== players.length) whoCache.set(players, who = players.map((player): Who => [player.id, player.name, player.color]));
  return who;
}

export function publicView(state: State): View {
  const { settings, players } = state, frame = buildFrame(state), recent: number[] = [];
  for (const [index, value] of state.world.recent) recent.push(index, value);
  const view: View = {
    seed: settings.seed, worldId: state.worldId, mode: settings.mode, difficulty: settings.difficulty, time: Math.floor(state.time), day: state.day,
    revision: state.revision, edits: editList(state), recent, er: state.editRev, who: whoOf(players),
    sleeping: players.filter(player => player.sleeping).length, sleepNeed: sleepNeed(activePlayers(state).length), stats: { ...state.stats },
  };
  if (state.ticks % rosterEvery(players.length) === 0) view.roster = players.map(player => encodeRoster({
    seat: player.seat, x: player.x, y: player.y, z: player.z, health: player.health, held: player.inv[player.slot]?.id ?? 0, flags: flagsIn(state, player), armor: armorPoints(player.armor),
  }));
  if (state.ticks % tvEvery(players.length) === 0) {
    const subject = players[state.focus];
    view.tv = subject ? { ...tvScene(frame, subject.x, subject.z), focus: state.focus } : { p: [], m: [], i: [], a: [], f: [], focus: -1 };
    if (state.city && subject) Object.assign(view.tv, cityScene(state, subject.x, subject.z, state.ticks % PARKED_EVERY < tvEvery(players.length)));
  }
  if (state.city) {
    const city = cityPublic(state);
    if (city) view.city = city;
    if (state.finished) view.ledger = cityLedger(state).map(encodeLedger);
  }
  const boss = bossView(state), victory = victoryView(state);
  // The results screen and the victory celebration both read the journal.
  if (state.finished && !state.city || victory) view.journal = journalOf(state);
  if (boss) view.boss = boss;
  if (victory) view.victory = victory;
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

/**
 * The bag, with its revision moved on if anything in it changed since the last projection. Inventories change rarely
 * and are the bulk of a private view, so the view carries the bag only until the client's input confirms the revision.
 */
function bagOf(state: State, player: Player): Bag {
  const bag = { inv: copySlots(player.inv), cursor: copySlot(player.cursor), grid: copySlots(player.grid), out: copySlot(player.out), screen: screenView(state, player), armor: copySlots(player.armor) };
  const text = JSON.stringify(bag);
  if (text !== player.bagText) {
    player.bagText = text;
    player.bagRev++;
  }
  return { rev: player.bagRev, ...bag };
}

export function playerView(state: State, playerId: string): PrivateView {
  const player = playerById(state, playerId) ?? newPlayer(playerId, '', '#ffffff', state.spawn), bag = bagOf(state, player);
  const view: PrivateView = {
    ack: player.ack, tp: { ...player.tp }, imp: { ...player.imp }, bagRev: bag.rev,
    health: q2(player.health), food: player.food, saturation: q2(player.saturation), air: Math.round(player.air),
    dead: player.dead, mode: state.settings.mode,
    keepInventory: state.settings.keepInventory, armorPoints: armorPoints(player.armor), dimension: dimensionAt(player.x, player.z),
  };
  if ((state.ticks + player.seat) % nearEvery(state.players.length) === 0) {
    view.near = sceneAround(frameOf(state), player.x, player.z, NEAR);
    if (state.city) Object.assign(view.near, cityScene(state, player.x, player.z, player.parkedAsk || (state.ticks + player.seat) % PARKED_EVERY < nearEvery(state.players.length)));
  }
  if (state.city) view.city = cityPrivate(state, player);
  if (player.bagAck !== bag.rev) view.bag = bag;
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

/** Players credited with the victory (Victory.by holds names). */
export const slayerIds = (state: State) => state.players.filter(player => state.end.victory?.by.includes(player.name)).map(player => player.id);

/** Cooperative results: everyone wins once the host finishes; each row reads as a short highlight reel led by its awards. */
export function outcome(state: State): Outcome {
  if (state.city) return cityOutcome(state);
  const won = awards(journalOf(state), slayerIds(state));
  const rows = state.players.map(player => {
    const s = player.stats, parts = [...won.filter(award => award.ids.includes(player.id)).map(award => award.title), `${s.mined} mined`, `${s.placed} placed`, `${s.crafted} crafted`];
    if (s.mobs) parts.push(`${s.mobs} mob${s.mobs === 1 ? '' : 's'}`);
    parts.push(`${Math.round(s.distance)} m walked`);
    if (s.deaths) parts.push(`${s.deaths} death${s.deaths === 1 ? '' : 's'}`);
    return { playerId: player.id, score: s.mined + s.placed + s.crafted + s.mobs * 5, label: parts.join(' · ') };
  });
  return { complete: state.finished, winners: state.finished ? state.players.map(player => player.id) : [], rows };
}
