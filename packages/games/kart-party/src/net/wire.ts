/* Compact wire form of RaceView: what server.ts publicView sends (DESIGN §6).
 *
 * Keyed JSON spends ~500 B per racer on field names alone, so 10 racers can't meet the DESIGN §6
 * 4.5 KB target however the numbers are rounded. This codec sends racers and entities as value
 * arrays in a fixed field order shared by server and client code, cutting a 10-racer snapshot to
 * roughly a third. Racer ids inside events and entities (platform UUIDs, 36 chars each) travel as
 * racer row indices. server.ts sends `encodeRaceView(toRaceView(s))`; client.tsx hands every view
 * `decodeRaceView(props.publicView)` (memoized per object). `players` lists the human racer ids, so
 * platform code can count seats without knowing the row layout. */
import type { Entity, RaceEvent, RaceView, RacerView } from '../sim/types';

const RACER_KEYS = ['id', 'name', 'color', 'bot', 'connected', 'character', 'kart', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'heading', 'steer', 'grounded', 'air', 'hint',
  'd', 'lateral', 'surface', 'offroad', 'lastSafeD', 'drift', 'driftCharge', 'driftTier', 'hopT', 'boostT', 'boostPower', 'slipT', 'slipCharge', 'trickT', 'tricked',
  'spinT', 'tumbleT', 'starT', 'shieldT', 'inkT', 'shockT', 'respawnT', 'invulnT', 'stallT', 'launch', 'loop', 'prevHop', 'prevFire', 'prevItem', 'lap', 'checkpoint',
  'progress', 'rank', 'finishTime', 'lapTimes', 'lapStart', 'item', 'itemCount', 'rollT', 'trailing', 'lastSeq', 'honkT'] as const satisfies readonly (keyof RacerView)[];
const ENTITY_KEYS = ['id', 'kind', 'owner', 'x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'hint', 'd', 'target', 'bounces', 'fuse'] as const satisfies readonly (keyof Entity)[];
const EVENT_KEYS = ['id', 't', 'type', 'racer', 'other', 'value', 'x', 'z'] as const satisfies readonly (keyof RaceEvent)[];
const REFS = new Set<string>(['owner', 'target', 'racer', 'other']);   // racer-id fields sent as row indices
// Compile-time guard: adding a field to RacerView/Entity/RaceEvent without listing it here is a type error.
type Unlisted = Exclude<keyof RacerView, typeof RACER_KEYS[number] | 'stats'> | Exclude<keyof Entity, typeof ENTITY_KEYS[number]> | Exclude<keyof RaceEvent, typeof EVENT_KEYS[number]>;
const complete: [Unlisted] extends [never] ? true : Unlisted = true; void complete;

type Value = RacerView[keyof RacerView] | Entity[keyof Entity] | RaceEvent[keyof RaceEvent];
export type RaceWire = Omit<RaceView, 'racers' | 'entities' | 'events'> & { wire: 1; players: string[]; racers: Value[][]; entities: Value[][]; events: Value[][] };

export function encodeRaceView(view: RaceView): RaceWire {
  const index = new Map(view.racers.map((r, i) => [r.id, i]));
  const ref = (k: string, v: Value) => REFS.has(k) && typeof v === 'string' ? index.get(v) ?? v : v;
  const racers = view.racers.map(r => { const row: Value[] = RACER_KEYS.map(k => r[k]); if (r.stats) row.push(r.stats); return row; });
  // Optional event fields are null (trailing ones dropped); unknown ids stay strings.
  const events = view.events.map(e => { const row = EVENT_KEYS.map(k => e[k] === undefined ? null : ref(k, e[k])); while (row.at(-1) === null) row.pop(); return row; });
  return { ...view, wire: 1, players: view.racers.filter(r => !r.bot).map(r => r.id), racers, entities: view.entities.map(e => ENTITY_KEYS.map(k => ref(k, e[k]))), events };
}

const cache = new WeakMap<object, RaceView>();
/** Accepts a RaceWire (or an already-decoded RaceView, returned as is). Same input object → same output object. */
export function decodeRaceView<T extends RaceWire | RaceView | null>(value: T): T extends null ? null : RaceView {
  type Out = T extends null ? null : RaceView;
  if (!value || !('wire' in value)) return value as unknown as Out;
  const hit = cache.get(value); if (hit) return hit as Out;
  const { wire: _wire, players: _players, racers, entities, events, ...rest } = value as RaceWire; void _wire; void _players;
  const id = (k: string, v: Value) => REFS.has(k) && typeof v === 'number' ? racers[v][0] : v;
  const view: RaceView = { ...rest,
    racers: racers.map(row => { const r = Object.fromEntries(RACER_KEYS.map((k, i) => [k, row[i]])) as RacerView; if (row.length > RACER_KEYS.length) r.stats = row[RACER_KEYS.length] as RacerView['stats']; return r; }),
    entities: entities.map(row => Object.fromEntries(ENTITY_KEYS.map((k, i) => [k, id(k, row[i])])) as Entity),
    events: events.map(row => Object.fromEntries(EVENT_KEYS.flatMap((k, i) => row[i] === null || row[i] === undefined ? [] : [[k, id(k, row[i])]])) as RaceEvent) };
  cache.set(value, view);
  return view as Out;
}
