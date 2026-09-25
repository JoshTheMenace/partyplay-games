import type { GameRules } from '../../../party-contract/src/index';
import { assertSerializable } from '../../../party-contract/src/serializable';
import type { Action, ActionType, Captain, Phase, PrivateView, PublicView, Settings } from './contracts';
import { sectorDef } from './content/sectors';
import { SYSTEMS } from './defs/catalog';
import { PLAYER_HULLS } from './defs/hulls';
import { applyCombatCommand, orderCrew, stepIdle, type CombatWorld } from './sim';
import { tickCombat } from './run/combat';
import { VOTE_MS, available, badge, choicesOf, eventDef } from './run/events';
import { ammo, buy, claim, equip, repair, sell, unequip, upgrade } from './run/fleet';
import { commission, launch, leave, tickEvent, tickMap } from './run/flow';
import { COLUMNS, SHORT_COLUMNS, generateMap } from './run/map';
import { exportSave, loadSave } from './run/save';
import { allReady, currentNode, say, shipById, shipOf, type State } from './run/state';
import { publicView } from './run/view';

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
  pause: { paused: bool }, jump: { vote: bool }, claim: { itemId: id }, buy: { offerId: id }, sell: { itemId: id }, repair: { amount: between(1, 40) }, ammo: {},
  upgrade: { system: among(SYSTEMS) }, equip: { itemId: id, slot: between(0, 5) }, unequip: { slot: between(0, 5) },
};
const MANAGE: Phase[] = ['map', 'event', 'loot', 'store'];

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
  const { difficulty = 'captain', length = 'standard', ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length || (difficulty !== 'cadet' && difficulty !== 'captain') || (length !== 'short' && length !== 'standard')) throw new Error('Unknown Starship Scramble settings.');
  return { difficulty, length };
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
    case 'pause': { const combat = battle(); combat.paused = a.paused; combat.pausedBy = a.paused ? c.name : null; return say(s, `${c.name} ${a.paused ? 'paused' : 'resumed'} the battle`); }
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

export const rules: GameRules<State, null, Action, Settings, PublicView, PrivateView> = {
  validateSettings, parseAction, parseInput: () => null, neutralInput: () => null,
  create(ctx, settings) {
    const cadet = settings.difficulty === 'cadet', sectors = settings.length === 'short' ? ['rustbelt'] : ['rustbelt', 'veil', 'meridian'];
    const s: State = {
      settings, phase: 'hangar', turn: 0, rng: ctx.seed | 0, nextId: 1, ships: [], crew: [], combat: null, fight: null,
      captains: ctx.players.slice(0, 4).map((p, i) => ({ id: `c${i}`, playerId: p.id, name: p.name, color: p.color, connected: true, shipId: null, hullId: null, scrap: cadet ? 50 : 20,
        ready: false, vote: null, cargo: [], stats: { damage: 0, kills: 0, repairs: 0, scrapEarned: 0, saves: 0 } })),
      sectors, sectorIndex: 0, map: null!, revealed: false, event: null, loot: null, offers: null, pending: [], deadline: null,
      reserves: cadet ? 3 : 2, scrapCarry: 0, flags: [], seen: [], message: 'Choose your ships', result: null, fleetStats: { jumps: 0, kills: 0, scrap: 0, lostShips: 0 },
    };
    s.map = generateMap(s, sectorDef(sectors[0]), sectors.length === 1, sectors.length === 1 ? SHORT_COLUMNS : COLUMNS);
    return s;
  },
  applyAction(s, playerId, action, nowMs) {
    const index = s.captains.findIndex(c => c.playerId === playerId);
    if (index < 0) throw new Error('You are watching this expedition from the stands.');
    if (s.phase === 'over') throw new Error('The expedition is over.');
    if (action.turn !== s.turn) throw new Error('That moment has passed.');
    // Rejected actions must never half-apply: act on a copy and commit only on success.
    const next = structuredClone(s);
    act(next, next.captains[index], action, nowMs);
    Object.assign(s, next);
  },
  tick(s, _inputs, dtSeconds, nowMs) {
    const ms = dtSeconds * 1000;
    if (s.phase === 'hangar') { if (allReady(s)) launch(s); return; }
    if (s.phase === 'combat') return tickCombat(s, ms, nowMs);
    if (s.phase === 'over') return;
    stepIdle(s, ms);
    if (s.phase === 'map') tickMap(s, nowMs); else if (s.phase === 'event') tickEvent(s, nowMs); else if (allReady(s)) leave(s);
  },
  onPresenceChange(s, playerId, connected) {
    const c = s.captains.find(x => x.playerId === playerId);
    if (!c) return;
    c.connected = connected;
    const ship = shipById(s, c.shipId); if (ship) ship.autopilot = !connected;
  },
  publicView: s => publicView(s),
  playerView: (s, playerId) => ({ captainId: s.captains.find(c => c.playerId === playerId)?.id ?? null }),
  outcome: s => ({
    complete: s.result !== null,
    winners: s.result === 'victory' ? s.captains.flatMap(c => c.playerId ? [c.playerId] : []) : [],
    rows: s.captains.flatMap(c => c.playerId ? [{ playerId: c.playerId, score: c.stats.damage + 25 * c.stats.kills, label: `${c.stats.damage} dmg · ${c.stats.kills} kill${c.stats.kills === 1 ? '' : 's'}` }] : []),
  }),
  exportSave,
  loadSave: (ctx, raw) => loadSave(ctx, raw),
  finish(s) { if (s.result === null) { s.result = 'suspended'; say(s, 'Expedition saved. Resume any time.'); } },
  dispose() {},
};
export default rules;
