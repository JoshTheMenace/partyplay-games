/** World saves: exportSave strips wall-clock and transient bits; loadSave validates every field and reseats the new roster. */
import type { RoundContext } from '../../../../party-contract/src/index';
import { assertSerializable } from '../../../../party-contract/src/serializable';
import { SAVE_VERSION, type Settings } from '../contracts';
import { ENEMY_IDS, SECTOR_IDS } from '../content/types';
import { EVENTS } from '../content/events';
import { AUGMENTS, ROLES, SPECIES, SYSTEMS, WEAPONS } from '../defs/catalog';
import { HULLS, PLAYER_HULLS, hullDef } from '../defs/hulls';
import { VOTE_MS } from './events';
import { LIMITS, shipById, type State } from './state';

type Check = (v: unknown, path: string) => void;
const bad = (path: string): never => { throw new Error(`This save file is damaged or from another version (${path}).`); };
const is = (ok: (v: unknown) => boolean): Check => (v, p) => { if (!ok(v)) bad(p); };
const num = is(v => typeof v === 'number' && Number.isFinite(v)), int = is(Number.isSafeInteger), bool = is(v => typeof v === 'boolean');
const str = (max: number) => is(v => typeof v === 'string' && v.length <= max);
const id = is(v => typeof v === 'string' && v.length <= 64 && /^[\w-]+$/.test(v));
const oneOf = (values: readonly unknown[]) => is(v => values.includes(v));
const ids = (list: readonly { id: string }[]) => oneOf(list.map(x => x.id));
const nul = (c: Check): Check => (v, p) => { if (v !== null) c(v, p); };
const opt = (c: Check): Check => (v, p) => { if (v !== undefined) c(v, p); };
const arr = (c: Check, max: number): Check => (v, p) => { if (!Array.isArray(v) || v.length > max) bad(p); (v as unknown[]).forEach((x, i) => c(x, `${p}.${i}`)); };
const record = (v: unknown, p: string) => { if (!v || typeof v !== 'object' || Array.isArray(v)) bad(p); return v as Record<string, unknown>; };
const obj = (shape: Record<string, Check>): Check => (v, p) => {
  const o = record(v, p); for (const k of Object.keys(o)) if (!Object.hasOwn(shape, k)) bad(`${p}.${k}`);
  for (const [k, c] of Object.entries(shape)) c(o[k], `${p}.${k}`);
};
const rec = (c: Check, max: number): Check => (v, p) => { const o = record(v, p); if (Object.keys(o).length > max) bad(p); for (const [k, x] of Object.entries(o)) { id(k, p); c(x, `${p}.${k}`); } };

const system = ids(SYSTEMS), weapon = ids(WEAPONS), augment = ids(AUGMENTS), faction = oneOf(['ally', 'enemy']), hazard = oneOf(['none', 'asteroids', 'solar', 'ion-storm', 'nebula']);
const levels = obj(Object.fromEntries(SYSTEMS.map(d => [d.id, opt(num)])));
const room = obj({ id, system: nul(system), tier: int, damage: num, ionMs: num, fire: num, breach: bool, oxygen: num, repair: num });
const ship = obj({ id, faction, captainId: nul(id), enemyId: nul(oneOf(ENEMY_IDS)), hullId: ids(HULLS), name: str(32), paint: is(v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)), slot: int,
  hull: num, maxHull: num, shields: num, shieldCharge: num, tempShield: num, tempShieldMs: num, rooms: arr(room, 16), ammo: num, augments: arr(augment, LIMITS.augments),
  weapons: arr(obj({ uid: id, defId: weapon, charge: num, target: nul(obj({ shipId: id, roomId: id })), auto: bool, powered: bool }), 8),
  status: oneOf(['active', 'destroyed', 'fled']), cloakMs: num, cloakCooldownMs: num, teleportCooldownMs: num, defenseCooldownMs: num, fleeAtMs: nul(num),
  phase: int, phases: arr(obj({ maxHull: num, weapons: arr(weapon, 8), systems: levels, line: str(200) }), 4),
  ai: nul(oneOf(['balanced', 'weapons', 'shields', 'boarder', 'hunter'])), fleeBelow: num, autopilot: bool, lastHitBy: nul(id) });
const crew = obj({ id, name: str(24), species: ids(SPECIES), role: ids(ROLES), faction, ownerId: nul(id), shipId: id, roomId: id, x: num, y: num, hp: num, maxHp: num,
  state: oneOf(['idle', 'walking', 'manning', 'repairing', 'fighting', 'extinguishing', 'healing', 'dead']), station: nul(id), path: arr(id, 32), beam: opt(obj({ shipId: id, roomId: id })) });
const combat = obj({ id, t: num, paused: bool, pausedBy: nul(str(32)), hazard, objective: oneOf(['destroy', 'survive', 'boss']), surviveUntilMs: nul(num), ftl: num, jumpVotes: arr(id, 4),
  projectiles: arr(obj({ id, kind: oneOf(['laser', 'missile', 'beam', 'ion', 'flak', 'support']), weaponId: weapon, fromShipId: id, toShipId: id, roomId: id, mount: int, launchMs: num, arriveMs: num }), 256),
  events: arr(obj({ id, type: str(16), atMs: num, shipId: id, roomId: opt(id), amount: opt(num), weaponId: opt(weapon), fromShipId: opt(id), crewId: opt(id) }), 512),
  introUntilMs: num, enemyCharge: num, outcome: nul(oneOf(['victory', 'escaped', 'defeat'])), nextId: int, rng: int });
const item = (v: unknown, p: string) => { obj({ id, kind: oneOf(['weapon', 'augment']), defId: id, ownerId: nul(id) })(v, p); const it = v as { kind: string; defId: string }; (it.kind === 'weapon' ? weapon : augment)(it.defId, `${p}.defId`); };
const node = obj({ id, col: int, row: int, x: num, y: num, kind: oneOf(['start', 'unknown', 'hostile', 'distress', 'store', 'nebula', 'exit', 'boss']), links: arr(id, 4), visited: bool, hazard });
const event = ids(EVENTS), enemies = (v: unknown, p: string) => { if (v === 'sector') return; if (!Array.isArray(v) || !v.length) bad(p); arr(oneOf(ENEMY_IDS), 6)(v, p); };
const bonus = is(v => typeof v === 'number' && v >= 0 && v <= 2); // loot multiplier; content tops out at 1.5
const next: Check = (v, p) => { const kind = record(v, p).kind;
  obj(kind === 'event' ? { kind: str(8), eventId: event } : kind === 'store' ? { kind: str(8) } : kind === 'combat' ? { kind: str(8), enemies, hazard: opt(hazard), objective: opt(oneOf(['destroy', 'survive'])), bonus: opt(bonus) } : bad(p))(v, p); };
const count = is(v => Number.isSafeInteger(v) && (v as number) >= 0);
const state = obj({
  settings: obj({ difficulty: oneOf(['cadet', 'captain']), length: oneOf(['short', 'standard']) }), phase: oneOf(['hangar', 'map', 'event', 'combat', 'loot', 'store', 'over']),
  turn: count, rng: int, nextId: count, ships: arr(ship, 12), crew: arr(crew, 96), combat: nul(combat), fight: nul(obj({ bonus, ambush: bool, endAt: nul(num), counted: arr(id, 512) })),
  captains: arr(obj({ id, playerId: nul(str(128)), name: str(64), color: str(32), connected: bool, shipId: nul(id), hullId: nul(ids(PLAYER_HULLS)), scrap: count, ready: bool, vote: nul(id),
    cargo: arr(item, LIMITS.cargo), stats: obj({ damage: num, kills: num, repairs: num, scrapEarned: num, saves: num }) }), 4),
  sectors: arr(oneOf(SECTOR_IDS), 3), sectorIndex: count, revealed: bool,
  map: obj({ sectorId: oneOf(SECTOR_IDS), name: str(64), theme: str(64), nodes: arr(node, 40), currentId: id, armadaCol: int, columns: int }),
  event: nul(obj({ defId: event, outcome: nul(obj({ choiceId: id, text: str(1000), lines: arr(str(200), 32) })), next: nul(next) })),
  loot: nul(obj({ scrapEach: count, items: arr(item, 16), claims: rec(id, 16) })),
  offers: nul(arr(obj({ id, kind: oneOf(['weapon', 'augment', 'system', 'crew']), defId: id, price: count, soldTo: nul(id), crew: opt(obj({ name: str(24), species: ids(SPECIES), role: ids(ROLES) })) }), 16)), pending: arr(item, 16),
  deadline: nul(num), reserves: count, scrapCarry: count, flags: arr(str(64), 64), seen: arr(str(64), 256), message: str(200),
  result: nul(oneOf(['victory', 'defeat', 'suspended'])), fleetStats: obj({ jumps: count, kills: count, scrap: count, lostShips: count }),
});

/** Cross-references the shape check cannot see. */
function consistent(s: State) {
  const unique = (list: string[], what: string) => { if (new Set(list).size !== list.length) bad(what); };
  unique(s.ships.map(x => x.id), 'ships'); unique(s.crew.map(x => x.id), 'crew'); unique(s.captains.map(x => x.id), 'captains');
  if (!s.captains.length) bad('captains');
  for (const c of s.captains) { const own = shipById(s, c.shipId); if (c.shipId && own?.captainId !== c.id) bad(`captain ${c.id}`); if (s.phase !== 'hangar' && (!own || !c.hullId)) bad(`captain ${c.id}`); }
  for (const x of s.ships) { const rooms = hullDef(x.hullId).rooms; if (x.rooms.length !== rooms.length || x.rooms.some((r, i) => r.id !== rooms[i].id) || (x.faction === 'enemy') !== !!x.enemyId || x.phase < 0 || x.phase >= Math.max(1, x.phases.length)) bad(`ship ${x.id}`); }
  // Generated ids are prefix + counter; a counter at or below an existing id would mint duplicates.
  const used = [...s.ships, ...s.crew, ...s.captains.flatMap(c => c.cargo), ...s.loot?.items ?? [], ...s.pending, ...s.offers ?? [], ...s.combat ? [s.combat] : []].map(x => Number(/^[ebiok](\d+)$/.exec(x.id)?.[1] ?? -1));
  if (used.some(n => n >= s.nextId)) bad('nextId');
  for (const k of s.crew) { const at = shipById(s, k.shipId); if (!at || !at.rooms.some(r => r.id === k.roomId) || k.ownerId && !s.captains.some(c => c.id === k.ownerId)) bad(`crew ${k.id}`); }
  if (s.sectorIndex >= s.sectors.length || s.map.sectorId !== s.sectors[s.sectorIndex]) bad('sector');
  const nodes = new Set(s.map.nodes.map(n => n.id));
  if (!nodes.has(s.map.currentId) || s.map.nodes.some(n => n.links.some(l => !nodes.has(l)))) bad('map');
  for (const o of s.offers ?? []) { (o.kind === 'weapon' ? weapon : o.kind === 'augment' ? augment : o.kind === 'crew' ? ids(ROLES) : system)(o.defId, 'offers'); if ((o.kind === 'crew') !== !!o.crew || o.crew && o.crew.role !== o.defId) bad('offers'); }
  const needs = { combat: !!s.combat && !!s.fight, event: !!s.event, loot: !!s.loot, store: !!s.offers } as Record<string, boolean>;
  if (needs[s.phase] === false || s.phase !== 'combat' && s.combat) bad('phase');
}

export function exportSave(s: State) {
  const state = structuredClone(s);
  state.deadline = null;
  for (const c of state.captains) { c.ready = false; c.vote = null; }
  if (state.combat) { state.combat.events = []; state.combat.jumpVotes = []; }
  if (state.fight) { state.fight.endAt = null; state.fight.counted = []; }
  return { v: SAVE_VERSION, state };
}

export function loadSave(ctx: RoundContext, raw: unknown): { state: State; settings: Settings } {
  assertSerializable(raw);
  const save = record(raw, 'save');
  if (save.v !== SAVE_VERSION) throw new Error('This save is from a different version of Starship Scramble.');
  state(save.state, 'state');
  const s = structuredClone(save.state) as State;
  consistent(s);
  s.captains.forEach((c, i) => {
    const player = ctx.players[i];
    c.playerId = player?.id ?? null; c.connected = !!player;
    if (player) { c.name = player.name; c.color = player.color; }
    const own = shipById(s, c.shipId); if (own) own.autopilot = !player;
  });
  if (s.result === 'suspended') s.result = null;
  if (s.combat) { s.combat.paused = true; s.combat.pausedBy = null; }
  if (s.fight?.endAt === null && s.combat?.outcome) s.fight.endAt = ctx.nowMs;
  if (s.event?.outcome) s.deadline = ctx.nowMs + VOTE_MS;
  s.message = s.combat ? 'Battle paused. Resume when the crew is ready.' : 'Expedition restored';
  return { state: s, settings: s.settings };
}
