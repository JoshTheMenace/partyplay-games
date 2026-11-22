/* Snapshot projection sent to every screen at 30 Hz. Rounds per DESIGN §6 (positions/velocities 2 dp,
 * angles 3 dp, timers 2 dp), drops `rng`, `ai` and the ranking bookkeeping, and includes `stats` and lap times only once
 * results begin. net/wire.ts packs exactly these rounded values, so keep every number at the precision given here.
 * Events older than EVENT_WINDOW seconds are dropped (clients dedupe by id and have already seen them).
 * Every value is a finite number, string, boolean, null, array or plain object (no undefined). */
import { round } from './math';
import { hintAt, type Track } from './track';
import { getTrack } from '../tracks/index';
import type { Entity, KartState, Race, RaceEvent, RaceView, Racer, RacerView } from './types';

const r2 = (n: number) => round(n, 2), r3 = (n: number) => round(n, 3);
/** Events are resent in every snapshot for this long (the socket is reliable; this only has to outlast a Wi-Fi stall plus the
 * interpolation delay), then left out: clients dedupe by id. Crowded grids make ~100 events a second, so they resend for less. */
export const EVENT_WINDOW = 1;
export const eventWindow = (racers: number) => racers > 12 ? .4 : EVENT_WINDOW;

function racerView(r: Racer, results: boolean): RacerView {
  const view: RacerView = {
    id: r.id, name: r.name, color: r.color, bot: r.bot, connected: r.connected, character: r.character, kart: r.kart,
    x: r2(r.x), y: r2(r.y), z: r2(r.z), vx: r2(r.vx), vy: r2(r.vy), vz: r2(r.vz), heading: r3(r.heading), steer: r2(r.steer),
    grounded: r.grounded, air: r2(r.air), hint: r.hint, d: r2(r.d), lateral: r2(r.lateral), surface: r.surface, offroad: r.offroad, lastSafeD: r2(r.lastSafeD),
    drift: r.drift, driftCharge: r3(r.driftCharge), driftTier: r.driftTier, hopT: r2(r.hopT), boostT: r2(r.boostT), boostPower: r3(r.boostPower),
    slipT: r2(r.slipT), slipCharge: r2(r.slipCharge), trickT: r2(r.trickT), tricked: r.tricked,
    spinT: r2(r.spinT), tumbleT: r2(r.tumbleT), starT: r2(r.starT), shieldT: r2(r.shieldT), inkT: r2(r.inkT), shockT: r2(r.shockT),
    respawnT: r2(r.respawnT), invulnT: r2(r.invulnT), stallT: r2(r.stallT), launch: r.launch, loop: r3(r.loop), prevHop: r.prevHop, prevFire: r.prevFire, prevItem: r.prevItem,
    lap: r.lap, rank: r.rank, finishTime: r.finishTime === null ? null : r3(r.finishTime),
    lapTimes: results ? r.lapTimes.map(r3) : [], lapStart: r3(r.lapStart), item: r.item, itemCount: r.itemCount, rollT: r2(r.rollT), trailing: r.trailing,
    lastSeq: r.lastSeq, honkT: r2(r.honkT), flyT: r2(r.flyT), tank: r2(r.tank), prevFly: r.prevFly,
  };
  if (results) view.stats = { ...r.stats, airTime: r2(r.stats.airTime), topSpeed: r2(r.stats.topSpeed) };
  return view;
}
/** An entity's search hint is recomputed from its lap distance, so it need not travel. */
const entityView = (e: Entity, track: Track): Entity => ({ id: e.id, kind: e.kind, owner: e.owner, x: r2(e.x), y: r2(e.y), z: r2(e.z), vx: r2(e.vx), vy: r2(e.vy), vz: r2(e.vz),
  t: r2(e.t), hint: hintAt(track, r2(e.d)), d: r2(e.d), target: e.target, bounces: e.bounces, fuse: r2(e.fuse) });
const eventView = (e: RaceEvent): RaceEvent => ({ id: e.id, t: r3(e.t), type: e.type, racer: e.racer,
  ...(e.other !== undefined ? { other: e.other } : {}), ...(e.value !== undefined ? { value: r3(e.value) } : {}),
  ...(e.x !== undefined ? { x: r2(e.x) } : {}), ...(e.z !== undefined ? { z: r2(e.z) } : {}) });

export function toRaceView(race: Race): RaceView {
  const results = race.phase === 'results', track = getTrack(race.track), since = race.time - eventWindow(race.racers.length);
  return { track: race.track, laps: race.laps, speedClass: race.speedClass, difficulty: race.difficulty, items: race.items, viewMode: race.viewMode,
    phase: race.phase, time: r3(race.time), racers: race.racers.map(r => racerView(r, results)), entities: race.entities.map(e => entityView(e, track)),
    boxes: race.boxes.map(r2), events: race.events.filter(e => e.t >= since).map(eventView), serial: race.serial,
    firstFinish: race.firstFinish === null ? null : r3(race.firstFinish), endAt: race.endAt === null ? null : r3(race.endAt),
    cooldowns: { thunder: r2(race.cooldowns.thunder), comet: r2(race.cooldowns.comet) }, chaos: { ...race.chaos, t: r2(race.chaos.t), next: r2(race.chaos.next) } };
}
/** What only the seat driving a kart needs, for prediction and its own controls: these travel in that seat's private view. */
export const OWN_KEYS = ['lastSeq', 'prevHop', 'prevFire', 'prevItem', 'prevFly', 'launch', 'trickT', 'air', 'driftCharge', 'hint'] as const satisfies readonly (keyof RacerView)[];
/** A seat's private view: its racer's row in `racers`, then that racer's OWN_KEYS values. */
export type OwnView = [index: number, ...own: (number | boolean)[]];
export function toOwnView(race: Race, id: string): OwnView | null {
  const index = race.racers.findIndex(r => r.id === id); if (index < 0) return null;
  const view = racerView(race.racers[index], false);
  return [index, ...OWN_KEYS.map(k => view[k])];
}
/** Rebuild the physics state of one racer from a snapshot (used by client prediction). */
export function kartFromView(r: RacerView): KartState {
  const { x, y, z, vx, vy, vz, heading, steer, grounded, air, hint, d, lateral, surface, offroad, lastSafeD, drift, driftCharge, driftTier, hopT, boostT, boostPower,
    slipT, slipCharge, trickT, tricked, spinT, tumbleT, starT, shieldT, inkT, shockT, respawnT, invulnT, stallT, launch, loop, prevHop, prevFire, prevItem, flyT, tank, prevFly } = r;
  return { x, y, z, vx, vy, vz, heading, steer, grounded, air, hint, d, lateral, surface, offroad, lastSafeD, drift, driftCharge, driftTier, hopT, boostT, boostPower,
    slipT, slipCharge, trickT, tricked, spinT, tumbleT, starT, shieldT, inkT, shockT, respawnT, invulnT, stallT, launch, loop, prevHop, prevFire, prevItem, flyT, tank, prevFly };
}
