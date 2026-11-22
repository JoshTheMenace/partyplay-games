import type { GameRules } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import { MAX_ROOM_PLAYERS } from '../../../party-contract/src/index';
import { RUN_SECTORS, wingCount, wingOf, type Action, type ActionType, type Captain, type Phase, type Settings } from './contracts';
import { SYSTEMS } from './defs/catalog';
import { PLAYER_HULLS } from './defs/hulls';
import { applyCombatCommand, orderCrew, stepIdle, type CombatWorld } from './sim';
import { tickCombat } from './run/combat';
import { VOTE_MS, available, badge, choicesOf, eventDef } from './run/events';
import { ammo, buy, claim, equip, repair, sell, unequip, upgrade } from './run/fleet';
import { commission, enterSector, launch, leave, tickEvent, tickMap } from './run/flow';
import { exportSave, loadSave } from './run/save';
import { currentNode, say, settled, shipById, shipOf, wings, type State } from './run/state';
import { publicView, wingView } from './run/view';
import { encode, encodeOwn, type Own, type Wire } from './wire';

type Field = (v: unknown) => boolean;
const id: Field = v => typeof v === 'string' && v.length <= 64 && /^[\w-]+$/.test(v);
const bool: Field = v => typeof v === 'boolean';
const among = (list: readonly { id: string }[]): Field => v => list.some(x => x.id === v);
const between = (lo: number, hi: number): Field => v => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const crewIds: Field = v => Array.isArray(v) && v.length >= 1 && v.length <= 4 && v.every(id) && new Set(v).size === v.length;
/** The exact payload fields of every action (besides type and turn). */
const FIELDS: { [K in ActionType]: Record<Exclude<keyof Extract<Action, { type: K }>, 'type' | 'turn'>, Field> } = {
  hangar: { hullId: id, name: v => typeof v === 'string' && v.length <= 64 && v.trim().length <= 16 && /^[^\p{C}]*$/u.test(v), paint: v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) },
  ready: { ready: bool }, vote: { nodeId: id }, choose: { choiceId: id },
  target: { weapon: id, shipId: id, roomId: id }, untarget: { weapon: id }, autofire: { weapon: id, auto: bool }, fire: {},
  crew: { crewIds, roomId: id }, stations: {}, teleport: { crewIds, shipId: id, roomId: id }, recall: { shipId: id }, cloak: {},
  pause: { paused: bool }, assist: { on: bool }, jump: { vote: bool }, claim: { itemId: id }, buy: { offerId: id }, sell: { itemId: id }, repair: { amount: between(1, 40) }, ammo: {},
  upgrade: { system: among(SYSTEMS) }, equip: { itemId: id, slot: between(0, 5) }, unequip: { slot: between(0, 5) },
};
const MANAGE: Phase[] = ['map', 'event', 'loot', 'store'];
/** Orders that check everything before they change anything; the rest run on a copy of the state so a rejection can never half-apply. */
const ATOMIC = new Set<ActionType>(['ready', 'vote', 'choose', 'target', 'untarget', 'autofire', 'fire', 'stations', 'teleport', 'recall', 'cloak', 'pause', 'assist', 'jump']);
/** In a fleet of several wings a pause is a breather, not a brake: it ends by itself and each captain has one per battle. */
const PAUSE_MS = 20000;
/** Big fleets close the hangar, salvage and store this long after half the captains are ready. */
const LAUNCH_MS = 30000, LOOT_MS = 30000, STORE_MS = 45000;
/**
 * Wingmates receive the same engagement, and building it is most of what a big room's snapshot costs. Every change the room makes to a state
 * bumps its version; one version's wing views are built once per wing and shared by its seats.
 */
const versions = new WeakMap<State, number>(), shared = new WeakMap<State, { version: number; wings: Map<number, Own['wing']> }>();
const touch = (s: State) => void versions.set(s, (versions.get(s) ?? 0) + 1);
function wingOwn(s: State, wing: number) {
  const version = versions.get(s) ?? 0; let cache = shared.get(s);
  if (cache?.version !== version) shared.set(s, cache = { version, wings: new Map() });
  return cache.wings.get(wing) ?? cache.wings.set(wing, encodeOwn(null, [], wingView(s, wing)).wing).get(wing)!;
}

function parseAction(raw: unknown): Action {
  assertSerializable(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid action.');
  const a = raw as Record<string, unknown>, fields: Record<string, Field> | null = typeof a.type === 'string' && Object.hasOwn(FIELDS, a.type) ? FIELDS[a.type as ActionType] : null;
  if (!fields) throw new Error('Unknown action.');
  if (!Number.isSafeInteger(a.turn) || (a.turn as number) < 0) throw new Error('Invalid action turn.');
  if (Object.keys(a).length !== Object.keys(fields).length + 2 || Object.entries(fields).some(([k, ok]) => !(k in a) || !ok(a[k]))) throw new Error(`Invalid ${a.type} action.`);
  return (a.type === 'hangar' ? { ...a, name: (a.name as string).trim() } : { ...a }) as Action;
}

function validateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Settings must be an object.');
  const { difficulty = 'cadet', length = 'standard', ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length || (difficulty !== 'cadet' && difficulty !== 'captain') || typeof length !== 'string' || !Object.hasOwn(RUN_SECTORS, length)) throw new Error('Unknown Starship Scramble settings.');
  return { difficulty, length: length as Settings['length'] };
}

function act(s: State, c: Captain, a: Action, nowMs: number) {
  const only = (phases: Phase[], message: string) => { if (!phases.includes(s.phase)) throw new Error(message); };
  const battle = () => { only(['combat'], 'That order only works in battle.'); if (s.combat!.outcome) throw new Error('The battle is over.'); return s.combat!; };
  const vote = (choice: string) => { c.vote = choice; s.deadline ??= nowMs + VOTE_MS; };
  switch (a.type) {
    case 'hangar': {
      only(['hangar'], 'The fleet has already launched.');
      if (!PLAYER_HULLS.some(h => h.id === a.hullId)) throw new Error('Pick one of the hangar hulls.');
      return commission(s, c, a.hullId, a.name, a.paint.toLowerCase());
    }
    case 'ready':
      if (s.phase === 'hangar' && a.ready && !c.shipId) throw new Error('Pick a hull first.');
      if (s.phase === 'event' && !s.event!.outcome) throw new Error('Vote on a choice first.');
      only(['hangar', 'event', 'loot', 'store'], 'Nothing to get ready for right now.');
      c.ready = a.ready; return;
    case 'vote':
      only(['map'], 'Beacon votes happen on the sector map.');
      if (!currentNode(s).links.includes(a.nodeId)) throw new Error('Your drive cannot reach that beacon.');
      return vote(a.nodeId);
    case 'choose': {
      only(['event'], 'There is no event to decide.');
      if (s.event!.outcome) throw new Error('The fleet has already decided.');
      const choice = choicesOf(eventDef(s.event!.defId)).find(ch => ch.id === a.choiceId);
      if (!choice) throw new Error('That choice is not on the table.');
      if (!available(s, choice)) throw new Error(`The fleet needs ${badge(s, choice.requires!)} for that.`);
      return vote(choice.id);
    }
    case 'pause': { const combat = battle(), fight = s.fight!;
      if (a.paused && wings(s) > 1) {
        if (combat.paused) throw new Error('The battle is already paused.');
        if (fight.paused?.includes(c.id)) throw new Error('You have used your pause for this battle.');
        fight.paused = [...fight.paused ?? [], c.id]; fight.resumeAt = nowMs + PAUSE_MS;
      } else fight.resumeAt = null;
      combat.paused = a.paused; combat.pausedBy = a.paused ? c.name : null; return say(s, `${c.name} ${a.paused ? 'paused' : 'resumed'} the battle`); }
    case 'assist': only(['map', 'event', 'combat', 'loot', 'store'], 'Launch first.'); shipOf(s, c).assist = a.on; return;
    case 'jump': {
      const combat = battle();
      if (combat.objective === 'boss') throw new Error('There is no running from the Flagship.');
      if (a.vote && combat.ftl < 1) throw new Error('The FTL drive is still charging.');
      if (shipOf(s, c).status !== 'active') throw new Error('Your ship is wrecked. The fleet decides.');
      combat.jumpVotes = [...combat.jumpVotes.filter(v => v !== c.id), ...a.vote ? [c.id] : []];
      if (a.vote) say(s, `${c.name} votes to jump away`);
      return;
    }
    case 'crew': if (s.phase !== 'combat') { only(MANAGE, 'Crew are strapped in until launch.'); return orderCrew(s, c.id, a.crewIds, a.roomId); }
    // falls through: in battle, crew orders are combat commands
    case 'stations': case 'target': case 'untarget': case 'autofire': case 'fire': case 'teleport': case 'recall': case 'cloak': {
      battle(); const { turn, ...command } = a; void turn;
      return applyCombatCommand(s as CombatWorld, c.id, command);
    }
    case 'claim': only(['loot'], 'There is nothing to claim right now.'); return claim(s, c, a.itemId);
    case 'buy': only(['store'], 'Find a trading post first.'); return buy(s, c, a.offerId);
    case 'sell': only(['store'], 'Find a trading post first.'); return sell(s, c, a.itemId);
    case 'repair': only(['store'], 'Find a trading post first.'); return repair(s, c, a.amount);
    case 'ammo': only(['store'], 'Find a trading post first.'); return ammo(s, c);
    case 'upgrade': only(MANAGE, 'Refit your ship between battles.'); return upgrade(s, c, a.system);
    case 'equip': only(MANAGE, 'Refit your ship between battles.'); return equip(s, c, a.itemId, a.slot);
    case 'unequip': only(MANAGE, 'Refit your ship between battles.'); return unequip(s, c, a.slot);
  }
}

export const rules: GameRules<State, null, Action, Settings, Wire, Own> = {
  validateSettings, parseAction, parseInput: () => null, neutralInput: () => null,
  create(ctx, settings) {
    const cadet = settings.difficulty === 'cadet';
    const s: State = {
      settings, phase: 'hangar', turn: 0, rng: ctx.seed | 0, nextId: 1, ships: [], crew: [], combat: null, fight: null,
      captains: ctx.players.slice(0, MAX_ROOM_PLAYERS).map((p, i, all) => ({ id: `c${i}`, playerId: p.id, name: p.name, color: p.color, connected: true, wing: wingOf(i, Math.min(all.length, MAX_ROOM_PLAYERS)), shipId: null, hullId: null, scrap: cadet ? 50 : 20,
        ready: false, vote: null, cargo: [], stats: { damage: 0, kills: 0, repairs: 0, scrapEarned: 0, saves: 0 } })),
      sectors: [], sectorIndex: 0, map: null!, revealed: false, event: null, loot: null, offers: null, pending: [], deadline: null,
      reserves: (cadet ? 3 : 2) * wingCount(ctx.players.length), scrapCarry: 0, flags: [], seen: [], message: 'Choose your ships', result: null, fleetStats: { jumps: 0, kills: 0, scrap: 0, lostShips: 0 },
    };
    enterSector(s, 'rustbelt');
    return s;
  },
  applyAction(s, playerId, action, nowMs) {
    const index = s.captains.findIndex(c => c.playerId === playerId);
    if (index < 0) throw new Error('You are watching this expedition from the stands.');
    if (s.phase === 'over') throw new Error('The expedition is over.');
    if (action.turn !== s.turn) throw new Error('That moment has passed.');
    // Rejected actions must never half-apply: act on a copy and commit only on success (battle orders validate first and skip the copy).
    touch(s);
    if (ATOMIC.has(action.type) || action.type === 'crew' && s.phase === 'combat') return act(s, s.captains[index], action, nowMs);
    const next = structuredClone(s);
    act(next, next.captains[index], action, nowMs);
    Object.assign(s, next);
  },
  tick(s, _inputs, dtSeconds, nowMs) {
    const ms = dtSeconds * 1000; touch(s);
    if (s.phase === 'hangar') { if (settled(s, nowMs, LAUNCH_MS)) launch(s); return; }
    if (s.phase === 'combat') return tickCombat(s, ms, nowMs);
    if (s.phase === 'over') return;
    stepIdle(s, ms);
    if (s.phase === 'map') tickMap(s, nowMs); else if (s.phase === 'event') tickEvent(s, nowMs); else if (settled(s, nowMs, s.phase === 'store' ? STORE_MS : LOOT_MS)) leave(s);
  },
  onPresenceChange(s, playerId, connected) {
    const c = s.captains.find(x => x.playerId === playerId);
    if (!c) return;
    c.connected = connected; touch(s);
    const ship = shipById(s, c.shipId); if (ship) ship.autopilot = !connected;
  },
  // What travels is packed (src/wire.ts); every screen decodes it back into the PublicView the UI is written against.
  publicView: s => encode(publicView(s)),
  playerView: (s, playerId) => { const c = s.captains.find(x => x.playerId === playerId); return { ...encodeOwn(c?.id ?? null, s.combat ? [] : c?.cargo ?? [], null), wing: c && wings(s) > 1 ? wingOwn(s, c.wing) : null }; },
  outcome: s => ({
    complete: s.result !== null,
    winners: s.result === 'victory' ? s.captains.flatMap(c => c.playerId ? [c.playerId] : []) : [],
    rows: s.captains.flatMap(c => c.playerId ? [{ playerId: c.playerId, score: c.stats.damage + 25 * c.stats.kills, label: `${c.stats.damage} dmg · ${c.stats.kills} kill${c.stats.kills === 1 ? '' : 's'}` }] : []),
  }),
  exportSave,
  loadSave: (ctx, raw) => loadSave(ctx, raw),
  finish(s) { touch(s); if (s.result === null) { s.result = 'suspended'; say(s, 'Expedition saved. Resume any time.'); } },
  dispose() {},
};
export default rules;
