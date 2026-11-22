/* Wire form of RaceView: what server.ts sends and every client view decodes (DESIGN §6).
 *
 * A snapshot goes to every phone 30 times a second, so a room's traffic is its size times the square of the roster.
 * Three things keep it small enough for 64 racers (about 50 B a racer instead of 380):
 *  - What never changes during a race (ids, names, colours, picks, settings) sits in `base` and `players`, which the
 *    platform's snapshot cache sends once per socket (manifest.snapshotCache). The results do the same: the room keeps
 *    sending snapshots while the results are up, so the final standings, stats and lap times move into the cached `final`
 *    (and `rev` steps from 1 to 2) instead of travelling 30 times a second.
 *  - Racers (`k`) and entities (`e`) are packed as bytes and sent as base64url text. Each number travels as the integer the
 *    view already rounded it to (x·100, heading·1000 …), so packing loses nothing, and the timers that are zero most of the
 *    time are left out (a 3-byte mask per racer says which are present).
 *  - The fields only prediction needs (input counters, the acknowledged sequence …: OWN_KEYS) travel in each seat's
 *    private view, for that seat's own kart. For every other racer they decode as neutral values.
 * decodeRaceView(wire, own) rebuilds the RaceView (memoized per snapshot object). */
import { ITEM_IDS, CHAOS_OWNER } from '../sim/items';
import { PHYSICS } from '../sim/physics';
import { hintAt } from '../sim/track';
import { OWN_KEYS, type OwnView } from '../sim/view';
import { getTrack } from '../tracks/index';
import type { Entity, EntityKind, RaceEvent, RaceEventType, RaceView, RacerStats, RacerView, Surface } from '../sim/types';

/** [key, bytes, units per 1, signed] */
type Field<K> = readonly [key: K, bytes: number, scale: number, signed?: boolean];
type Numeric<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];
const FIXED: readonly Field<Numeric<RacerView>>[] = [['x', 3, 100, true], ['y', 2, 100, true], ['z', 3, 100, true], ['vx', 2, 100, true], ['vz', 2, 100, true],
  ['heading', 2, 1000, true], ['steer', 1, 100, true], ['d', 3, 100], ['lateral', 2, 100, true], ['lap', 1, 1], ['rank', 1, 1]];
/** Sent only when not zero. One-byte timers never exceed 2.55 s (tests/view.test.ts round-trips whole races). */
const SPARSE: readonly Field<Numeric<RacerView>>[] = [['vy', 2, 100, true], ['hopT', 1, 100], ['boostT', 2, 100], ['boostPower', 2, 1000], ['slipT', 1, 100], ['slipCharge', 2, 100, true],
  ['spinT', 1, 100], ['tumbleT', 1, 100], ['starT', 2, 100], ['shieldT', 2, 100], ['inkT', 2, 100], ['shockT', 2, 100], ['respawnT', 1, 100], ['invulnT', 1, 100], ['stallT', 1, 100],
  ['loop', 2, 1000], ['rollT', 1, 100], ['honkT', 1, 100], ['flyT', 1, 100], ['lapStart', 4, 1000]];
/** Mask bits after SPARSE: a tank that is not full, a restart point that is not where the kart is, a finish time, an item. */
const TANK = SPARSE.length, SAFE = TANK + 1, FINISH = TANK + 2, ITEM = TANK + 3;
if (FIXED.map(f => f[0]).join() !== 'x,y,z,vx,vz,heading,steer,d,lateral,lap,rank' || SPARSE.map(f => f[0]).join() !== 'vy,hopT,boostT,boostPower,slipT,slipCharge,spinT,tumbleT,starT,shieldT,inkT,shockT,respawnT,invulnT,stallT,loop,rollT,honkT,flyT,lapStart') throw Error('net/wire.ts: decodeRaceView reads racers in the order FIXED and SPARSE had when it was written. Update it with them.');
const ENTITY: readonly Field<Numeric<Entity>>[] = [['id', 3, 1], ['x', 3, 100, true], ['y', 2, 100, true], ['z', 3, 100, true], ['vx', 2, 100, true], ['vy', 2, 100, true], ['vz', 2, 100, true],
  ['t', 2, 100], ['d', 3, 100], ['bounces', 1, 1], ['fuse', 2, 100]];
const SURFACES: readonly Surface[] = ['road', 'offroad', 'ice', 'water', 'boost', 'air'];
const KINDS: readonly EntityKind[] = ['peel', 'bouncer', 'seeker', 'comet', 'bomb', 'blast'];
const EVENT_TYPES = ['hit', 'bump', 'wall', 'boost-pad', 'mini-turbo', 'trick', 'rocket-start', 'stall', 'slipstream', 'pickup', 'item', 'shield-pop', 'explode', 'thunder', 'comet', 'lap',
  'final-lap', 'chaos', 'finish', 'respawn', 'fall', 'honk', 'overtake', 'ring', 'spring', 'bumper', 'loop', 'thrust'] as const satisfies readonly RaceEventType[];
const EVENT_KEYS = ['id', 't', 'type', 'racer', 'other', 'value', 'x', 'z'] as const satisfies readonly (keyof RaceEvent)[];
// Compile-time guard: a new event type or event field must be listed above.
type Unlisted = Exclude<RaceEventType, typeof EVENT_TYPES[number]> | Exclude<keyof RaceEvent, typeof EVENT_KEYS[number]>;
const complete: [Unlisted] extends [never] ? true : Unlisted = true; void complete;
const NOBODY = 255, CHAOS = 254;   // owner/target bytes that are not a racer row

type Value = string | number | boolean | null;
type Roster = [id: string, name: string, color: string, bot: boolean, character: number, kart: RacerView['kart']];
type Base = Pick<RaceView, 'track' | 'laps' | 'speedClass' | 'difficulty' | 'items' | 'viewMode'> & { chaos: RaceView['chaos']['mode']; racers: Roster[] };
type Head = [phase: RaceView['phase'], time: number, serial: number, firstFinish: number | null, endAt: number | null, thunder: number, comet: number,
  chaos: RaceView['chaos']['kind'], last: RaceView['chaos']['last'], t: number, next: number];
export type RaceWire = { wire: 2; rev: number; base: Base; players: string[]; final: { k: string; e: string; stats: [RacerStats, number[]][] } | null;
  h: Head; boxes: number[]; k: string; e: string; events: Value[][] };
export type { OwnView };

/* ---------------- bytes ⇄ base64url ---------------- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', UN64 = new Uint8Array(128);
for (let i = 0; i < 64; i++) UN64[B64.charCodeAt(i)] = i;
let buf = new Uint8Array(4096), at = 0;
function put(n: number, size: number, signed = false) {
  const span = 2 ** (size * 8), lo = signed ? -span / 2 : 0, v = Math.round(n), c = v < lo ? lo : v >= lo + span ? lo + span - 1 : v;
  if (at + size > buf.length) { const grown = new Uint8Array(buf.length * 2); grown.set(buf); buf = grown; }
  for (let s = (size - 1) * 8, u = c < 0 ? c + span : c; s >= 0; s -= 8) buf[at++] = Math.floor(u / 2 ** s) & 255;
}
function text() {
  let s = '';
  for (let i = 0; i < at; i += 3) {
    const n = buf[i] << 16 | (i + 1 < at ? buf[i + 1] << 8 : 0) | (i + 2 < at ? buf[i + 2] : 0);
    s += B64[n >> 18] + B64[n >> 12 & 63] + (i + 1 < at ? B64[n >> 6 & 63] : '') + (i + 2 < at ? B64[n & 63] : '');
  }
  at = 0; return s;
}
let src = new Uint8Array(0), rp = 0;
function open(s: string) {
  const n = Math.floor(s.length * 3 / 4), code = (i: number) => i < s.length ? UN64[s.charCodeAt(i) & 127] : 0;
  src = new Uint8Array(n); rp = 0;
  for (let i = 0, o = 0; i < s.length; i += 4) { const v = code(i) << 18 | code(i + 1) << 12 | code(i + 2) << 6 | code(i + 3); src[o++] = v >> 16; if (o < n) src[o++] = v >> 8 & 255; if (o < n) src[o++] = v & 255; }
}
function get(size: number, signed = false) {
  let n = 0; for (let i = 0; i < size; i++) n = n * 256 + src[rp++];
  return signed && n >= 2 ** (size * 8 - 1) ? n - 2 ** (size * 8) : n;
}

/* ---------------- encode (server) ---------------- */
export function encodeRaceView(view: RaceView): RaceWire {
  const index = new Map(view.racers.map((r, i) => [r.id, i])), ref = (id: string | null | undefined) => id === CHAOS_OWNER ? CHAOS : index.get(id ?? '') ?? NOBODY;
  for (const r of view.racers) {
    for (const [k, size, scale, signed] of FIXED) put(r[k] * scale, size, signed);
    put(Number(r.grounded) | Number(r.offroad) << 1 | Number(r.tricked) << 2 | Number(r.trailing) << 3 | Number(r.connected) << 4 | (r.drift + 1) << 5 | r.driftTier << 7 | SURFACES.indexOf(r.surface) << 9, 2);
    let mask = 0;
    SPARSE.forEach(([k], bit) => { if (r[k] !== 0) mask |= 1 << bit; });
    if (r.tank !== PHYSICS.flyTank) mask |= 1 << TANK;
    if (r.lastSafeD !== r.d) mask |= 1 << SAFE;
    if (r.finishTime !== null) mask |= 1 << FINISH;
    if (r.item !== null) mask |= 1 << ITEM;
    put(mask, 3);
    SPARSE.forEach(([k, size, scale, signed], bit) => { if (mask & 1 << bit) put(r[k] * scale, size, signed); });
    if (mask & 1 << TANK) put(r.tank * 100, 2);
    if (mask & 1 << SAFE) put(r.lastSafeD * 100, 3);
    if (r.finishTime !== null) put(r.finishTime * 1000, 4);
    if (r.item !== null) put(ITEM_IDS.indexOf(r.item) | r.itemCount << 4, 1);
  }
  const k = text();
  for (const e of view.entities) {
    for (const [key, size, scale, signed] of ENTITY) put(e[key] * scale, size, signed);
    put(KINDS.indexOf(e.kind), 1); put(ref(e.owner), 1); put(ref(e.target), 1);
  }
  const e = text(), c = view.chaos, results = view.phase === 'results';
  // Optional event fields are null (trailing ones dropped); a racer travels as its row, anything else as the string it is.
  const events = view.events.map(ev => {
    const row: Value[] = EVENT_KEYS.map(key => { const v = ev[key]; return v === undefined ? null : key === 'type' ? EVENT_TYPES.indexOf(ev.type) : key === 'racer' || key === 'other' ? index.get(v as string) ?? v : v; });
    while (row.at(-1) === null) row.pop();
    return row;
  });
  return { wire: 2, rev: results ? 2 : 1,
    base: { track: view.track, laps: view.laps, speedClass: view.speedClass, difficulty: view.difficulty, items: view.items, viewMode: view.viewMode, chaos: c.mode,
      racers: view.racers.map(r => [r.id, r.name, r.color, r.bot, r.character, r.kart]) },
    players: view.racers.filter(r => !r.bot).map(r => r.id),
    final: results ? { k, e, stats: view.racers.map(r => [r.stats!, r.lapTimes]) } : null,
    h: [view.phase, view.time, view.serial, view.firstFinish, view.endAt, view.cooldowns.thunder, view.cooldowns.comet, c.kind, c.last, c.t, c.next], boxes: view.boxes,
    k: results ? '' : k, e: results ? '' : e, events };
}

/* ---------------- decode (clients) ---------------- */
const cache = new WeakMap<object, RaceView>();
/** Accepts a RaceWire (or an already-decoded RaceView, returned as is). `own` is the seat's private view: its kart then
 * carries the prediction fields. Same input objects → same output object. */
export function decodeRaceView<T extends RaceWire | RaceView | null>(value: T, own?: OwnView | null): T extends null ? null : RaceView {
  type Out = T extends null ? null : RaceView;
  if (!value || !('wire' in value)) return value as unknown as Out;
  const key = own ?? value, hit = cache.get(key); if (hit) return hit as Out;
  const { base, h, boxes, final } = value as RaceWire, results = final?.stats, track = getTrack(base.track), id = (n: number) => n === CHAOS ? CHAOS_OWNER : base.racers[n]?.[0] ?? null;
  open(final?.k ?? value.k);
  // Written out field by field (the order FIXED, the flags, the mask and SPARSE give: tests/view.test.ts round-trips whole races):
  // one object literal per racer keeps this a fraction of a millisecond for 64 racers on a phone, 30 times a second.
  const racers = base.racers.map(([rid, name, color, bot, character, kart], i): RacerView => {
    const x = get(3, true) / 100, y = get(2, true) / 100, z = get(3, true) / 100, vx = get(2, true) / 100, vz = get(2, true) / 100, heading = get(2, true) / 1000, steer = get(1, true) / 100;
    const d = get(3) / 100, lateral = get(2, true) / 100, lap = get(1), rank = get(1), flags = get(2), mask = get(3);
    const opt = (bit: number, size: number, scale: number, signed = false) => mask & 1 << bit ? get(size, signed) / scale : 0;
    const vy = opt(0, 2, 100, true), hopT = opt(1, 1, 100), boostT = opt(2, 2, 100), boostPower = opt(3, 2, 1000), slipT = opt(4, 1, 100), slipCharge = opt(5, 2, 100, true), spinT = opt(6, 1, 100);
    const tumbleT = opt(7, 1, 100), starT = opt(8, 2, 100), shieldT = opt(9, 2, 100), inkT = opt(10, 2, 100), shockT = opt(11, 2, 100), respawnT = opt(12, 1, 100), invulnT = opt(13, 1, 100);
    const stallT = opt(14, 1, 100), loop = opt(15, 2, 1000), rollT = opt(16, 1, 100), honkT = opt(17, 1, 100), flyT = opt(18, 1, 100), lapStart = opt(19, 4, 1000);
    const tank = mask & 1 << TANK ? get(2) / 100 : PHYSICS.flyTank, lastSafeD = mask & 1 << SAFE ? get(3) / 100 : d, finishTime = mask & 1 << FINISH ? get(4) / 1000 : null, held = mask & 1 << ITEM ? get(1) : -1;
    const r: RacerView = { id: rid, name, color, bot, connected: !!(flags & 16), character, kart, x, y, z, vx, vy, vz, heading, steer, grounded: !!(flags & 1), air: 0, hint: hintAt(track, d), d, lateral,
      surface: SURFACES[flags >> 9 & 7], offroad: !!(flags & 2), lastSafeD, drift: (flags >> 5 & 3) - 1 as RacerView['drift'], driftCharge: 0, driftTier: (flags >> 7 & 3) as RacerView['driftTier'], hopT, boostT, boostPower,
      slipT, slipCharge, trickT: 0, tricked: !!(flags & 4), spinT, tumbleT, starT, shieldT, inkT, shockT, respawnT, invulnT, stallT, launch: 0, loop, prevHop: 0, prevFire: 0, prevItem: false, lap, rank, finishTime,
      lapTimes: results?.[i]?.[1] ?? [], lapStart, item: held < 0 ? null : ITEM_IDS[held & 15], itemCount: held < 0 ? 0 : held >> 4, rollT, trailing: !!(flags & 8), lastSeq: 0, honkT, flyT, tank, prevFly: 0 };
    if (results?.[i]) r.stats = results[i][0];
    return r;
  });
  if (own && racers[own[0]]) Object.assign(racers[own[0]], Object.fromEntries(OWN_KEYS.map((k, i) => [k, own[i + 1]])));
  open(final?.e ?? value.e);
  const entities: Entity[] = [];
  while (rp < src.length) {   // ENTITY order, then kind, owner, target
    const eid = get(3), x = get(3, true) / 100, y = get(2, true) / 100, z = get(3, true) / 100, vx = get(2, true) / 100, vy = get(2, true) / 100, vz = get(2, true) / 100, t = get(2) / 100, d = get(3) / 100, bounces = get(1), fuse = get(2) / 100;
    entities.push({ id: eid, kind: KINDS[get(1)], owner: id(get(1)) ?? '', x, y, z, vx, vy, vz, t, hint: hintAt(track, d), d, target: id(get(1)), bounces, fuse });
  }
  const events = value.events.map(row => Object.fromEntries(EVENT_KEYS.flatMap((k, i) => { const v = row[i]; return v === null || v === undefined ? []
    : [[k, k === 'type' ? EVENT_TYPES[v as number] : (k === 'racer' || k === 'other') && typeof v === 'number' ? base.racers[v][0] : v]]; })) as RaceEvent);
  const view: RaceView = { track: base.track, laps: base.laps, speedClass: base.speedClass, difficulty: base.difficulty, items: base.items, viewMode: base.viewMode,
    phase: h[0], time: h[1], racers, entities, boxes, events, serial: h[2], firstFinish: h[3], endAt: h[4], cooldowns: { thunder: h[5], comet: h[6] },
    chaos: { mode: base.chaos, kind: h[7], last: h[8], t: h[9], next: h[10] } };
  cache.set(key, view);
  return view as Out;
}
