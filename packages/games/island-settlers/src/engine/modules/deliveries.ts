/**
 * Deliveries (the Traders & Barbarians scenario, 2025 rules). Each seat starts with 5 gold and a wagon
 * on its setup city; after building it drives between the castle, quarry and glassworks depots,
 * delivering cargo (1 VP each, gold by wagon level) and paying tolls on other seats' roads. Road
 * barbarians replace the robber (7s and Knights move them and rob a road owner). At 3–4 seats the 2
 * and 12 discs are left out and those rolls rerolled (5+ seats keep both). No Longest Road. With
 * Barbarian Attack the coastal invaders block wagon paths instead, the 7 and 2/12 follow Barbarian
 * Attack, and the purse is shared.
 */
import { axialKey } from '../../geometry';
import type { Command, DevKind, HudItem, SeatId } from '../../model';
import { numberFits } from '../board/numbers';
import type { BoardDraft, GenContext } from '../board/types';
import { choice, command, pickField } from '../commands';
import { placeUnit, updateUnit } from '../pieces';
import { int } from '../rng';
import { emit } from '../events';
import { openPrompt } from '../prompts';
import { pushEffect, random, seatName, type State } from '../state';
import { boardIndex } from '../board/lookup';
import {
  cargoDecks, decorateDepots, depots, dl, DRIVE, MP, upgradeCost, type DlExt,
} from './deliveries/depots';
import { emptyPurse, GOLD_IDS, goldCommands, goldTrade, mayBuild, mayMove } from './deliveries/gold';
import { invaderPrompt, openRaider, placeRaiders, raiderPrompt } from './deliveries/raiders';
import { drive, goal, leg, raiders, trips, wagon } from './deliveries/wagon';
import type { Answer, Module } from './registry';

const ID = 'deliveries' as const;
const BA = (s: State) => s.modules.includes('barbarian-attack');
const base = { module: ID, group: 'deliveries' as const };

/** T&B 3–4 (without Barbarian Attack): no 2 or 12 discs, and those rolls are rerolled. */
const noExtremes = (seats: number, scenarios: readonly string[]) =>
  seats <= 4 && !scenarios.includes('barbarian-attack');

/** The 2 and 12 hexes (and fog faces) take the nearest number that keeps the placement rules. */
function dropExtremes(d: BoardDraft, ctx: GenContext) {
  if (!noExtremes(ctx.seatCount, ctx.settings.scenarios)) return;
  const numbers = new Map(d.tiles.filter(t => t.number).map(t => [axialKey(t), t.number]));
  for (const t of d.tiles.filter(t => t.number === 2 || t.number === 12)) {
    const cell = { ...t, gold: t.terrain === 'gold' };
    const options = t.number === 2 ? [3, 4, 11, 10] : [11, 10, 3, 4];
    numbers.delete(axialKey(t));
    t.number = options.find(n => numberFits(cell, n, numbers)) ?? options[0];
    numbers.set(axialKey(t), t.number);
  }
  for (const f of Object.values(d.hidden)) {
    if (f.number === 2 || f.number === 12) f.number = f.number === 2 ? 3 : 11;
  }
}

/** T&B p.20: 16 Knight, 3 Road Building, 3 Victory Point (Swift Journey not yet), scaled for 5+ seats. */
const DECK: [DevKind, number][] = [['knight', 16], ['road-building', 3], ['victory', 3]];
const tbDeck = (seats: number) => DECK.flatMap(([kind, n]) =>
  Array<DevKind>(Math.round(n * (seats <= 4 ? 1 : seats <= 6 ? 1.5 : 2))).fill(kind));

const edgesAt = (s: State, v: string) => boardIndex(s.board).vertex.get(v)?.edges ?? [];

/** Seats' active C&K knights next to a road barbarian (they may chase it, like the robber). */
const chasers = (s: State, seat: SeatId) => Object.values(s.pieces.units).filter(u => u.kind === 'knight'
  && u.seat === seat && u.active && edgesAt(s, u.at).some(e => raiders(s).has(e)));

const addWagon = (s: State, seat: SeatId, at: string) =>
  placeUnit(s, { id: `w-${seat}`, kind: 'wagon', seat, at, level: 1, active: true, cargo: [] });

function moveCommands(s: State, seat: SeatId, w: NonNullable<ReturnType<typeof wagon>>): Command[] {
  const x = dl(s), out: Command[] = [], { steps, arrives } = leg(s, seat), boosted = leg(s, seat, 2);
  if (steps.length) {
    const where = depots(s).get(steps.at(-1)!.to);
    out.push(command({ ...base, id: 'dl-drive', hint: arrives ? 0.9 : 0.75,
      label: arrives ? `Drive to the ${where}` : 'Drive toward the next depot',
      detail: w.cargo[0] ? `Carrying ${w.cargo[0]}` : 'Pick up cargo at a depot' }));
  }
  if (!x.boosted.includes(seat)) {
    out.push(command({ ...base, id: 'dl-boost', label: '+2 movement (1 grain)', cost: { grain: 1 },
      detail: 'Once per turn', hint: boosted.arrives && !arrives ? 0.85 : 0.2 }));
  }
  const map = trips(s, seat, x.mp[seat]), reach = [...map].filter(([v]) => v !== w.at);
  if (reach.length) {
    out.push(command({ ...base, id: 'dl-move', label: `Move wagon (${x.mp[seat]} MP)`, hint: 0.2,
      detail: 'Roads: 1 MP (+1 gold toll on others’). Open land: 2. Barbarians: +2.',
      fields: [pickField('to', 'Corner', reach.map(([v, t]) =>
        choice(v, 'Corner', `${t.mp} MP${t.gold ? `, ${t.gold} gold` : ''}`)), 'vertex')] }));
  }
  const aim = DRIVE[w.level - 1];
  const near = edgesAt(s, w.at).filter(e => raiders(s).has(e) && !x.tried.includes(`${seat} ${e}`));
  if (aim <= 6 && near.length) {
    const useful = near.includes(steps[0]?.edge ?? '') || !steps.length;
    out.push(command({ ...base, id: 'dl-fight', label: `Drive off a barbarian (${aim}+ on a die)`,
      detail: 'One try per barbarian per turn', hint: useful ? 0.45 + (7 - aim) / 12 : 0.15,
      fields: [pickField('edge', 'Barbarian', near.map(e => choice(e, 'Barbarian')), 'edge')] }));
  }
  return out;
}

function commands(s: State, seat: SeatId): Command[] {
  const w = wagon(s, seat), target = w && goal(s, seat);
  const tolls = target ? trips(s, seat, Infinity).get(target)!.gold : 0;
  const out = goldCommands(s, seat, ID, tolls);
  if (!w) return out;
  if (mayBuild(s, seat) && w.level < 5) {
    out.push(command({ ...base, id: 'dl-upgrade', label: `Upgrade wagon to level ${w.level + 1}`,
      cost: upgradeCost(w.level), hint: w.level === 4 ? 0.76 : w.level === 1 ? 0.6 : 0.5,
      detail: w.level === 4 ? 'The final upgrade is worth 1 VP' : `${MP[w.level]} MP, drives off barbarians`,
    }));
  }
  const knights = !BA(s) && mayBuild(s, seat) ? chasers(s, seat) : [];
  if (knights.length) {
    out.push(command({ ...base, id: 'dl-chase', label: 'Chase a road barbarian', hint: 0.4,
      detail: 'An active knight moves an adjacent barbarian and robs the road owner.',
      fields: [pickField('knight', 'Knight', knights.map(k => choice(k.id, 'Knight')), 'unit')] }));
  }
  return mayMove(s, seat) ? [...moveCommands(s, seat, w), ...out] : out;
}

function apply(s: State, seat: SeatId, id: string, a: Answer) {
  const x = dl(s), w = wagon(s, seat)!;
  if (GOLD_IDS.has(id)) return goldTrade(s, seat, id, a);
  if (id === 'dl-drive') return drive(s, seat, leg(s, seat).steps);
  if (id === 'dl-move') return drive(s, seat, trips(s, seat, x.mp[seat]).get(a.picks.to)!.path);
  if (id === 'dl-boost') { x.mp[seat] += 2; x.boosted.push(seat); return; }
  if (id === 'dl-upgrade') return void updateUnit(s, w.id, { level: w.level + 1 });
  if (id === 'dl-chase') {
    const k = s.pieces.units[a.picks.knight], near = edgesAt(s, k.at).filter(e => raiders(s).has(e));
    updateUnit(s, k.id, { active: false });
    return openRaider(s, seat, 'self', { steal: true, only: near.map(e => raiders(s).get(e)!) });
  }
  const e = a.picks.edge, roll = 1 + int(random(s, 'cards'), 6), won = roll >= DRIVE[w.level - 1];
  x.tried.push(`${seat} ${e}`);
  s.seats[seat].moved = true;
  const text = `${seatName(s, seat)} rolled ${roll} against a road barbarian${won ? ', driven off' : ''}`;
  emit(s, { kind: 'module', module: ID, name: 'drive-off', seat, target: e, text });
  if (!won) return;
  const source = raiders(s).get(e)!;
  if (BA(s)) openPrompt(s, { seat, kind: `${ID}/invader`, scope: 'self', data: source });
  else openRaider(s, seat, 'self', { steal: false, only: [source] });
}

export const deliveries: Module<DlExt> = {
  id: ID,
  profile(p) {
    // Official Seafarers combination: neither the robber nor the pirate is used.
    Object.assign(p, { robber: false, pirate: false, longestRoad: false, movementLocksBuilding: true });
    Object.assign(p, { setupPieces: [p.setupPieces[0], 'city'] });
  },
  board: { decorate: (d, ctx) => { decorateDepots(d, ctx); dropExtremes(d, ctx); } },
  devDeck: tbDeck,
  init(s) {
    const zero = () => Object.fromEntries(s.order.map(id => [id, 0]));
    if (!BA(s)) placeRaiders(s);
    const decks = cargoDecks(s);
    return { ...emptyPurse(s, 5), delivered: zero(), decks, mp: zero(), boosted: [], tried: [] };
  },
  beforeProduce(s, roll) {
    if (!noExtremes(s.order.length, s.settings.scenarios)) return;
    const rnd = random(s, 'dice');
    while (roll.total === 2 || roll.total === 12) {
      roll.dice = [1 + int(rnd, 6), 1 + int(rnd, 6)];
      roll.total = roll.dice[0] + roll.dice[1];
    }
  },
  onSeven(s, seat) {
    if (BA(s)) return;
    if (seat) pushEffect(s, { type: 'module', module: ID, name: 'seven', data: seat });
    return 'replace';
  },
  effects: { seven: (s, seat) => openRaider(s, String(seat), 'table', { steal: true, only: null }) },
  onDevPlay(s, seat, kind) {
    if (kind === 'knight' && !BA(s)) openRaider(s, seat, 'self', { steal: true, only: null });
  },
  legal: { settlement: (s, _, v) => (depots(s).has(v) ? { code: 'rule', text: 'Depots stay open' } : null) },
  commands,
  apply,
  prompts: { raider: raiderPrompt, invader: invaderPrompt },
  onBuild(s, seat, piece) {
    const second = piece.kind === 'building' && s.turn.setup?.round === 2;
    if (second && !wagon(s, seat)) addWagon(s, seat, piece.piece.vertex);
  },
  onOpportunityStart(s, seat) {
    const x = dl(s), home = Object.values(s.pieces.buildings).find(b => b.seat === seat);
    if (!wagon(s, seat) && home) addWagon(s, seat, home.vertex); // round 2 had no legal spot
    x.mp[seat] = MP[(wagon(s, seat)?.level ?? 1) - 1];
    x.boosted = x.boosted.filter(id => id !== seat);
    x.tried = x.tried.filter(t => !t.startsWith(`${seat} `));
    x.bought[seat] = 0;
  },
  score(s, seat) {
    const n = dl(s).delivered[seat], full = wagon(s, seat)?.level === 5 ? 1 : 0;
    const parts = [{ key: 'deliveries', label: 'Deliveries', points: n, count: n }];
    if (full) parts.push({ key: 'wagon', label: 'Wagon fully upgraded', points: 1, count: 1 });
    return parts;
  },
  publicView(s) {
    const cargoLeft: Record<string, number> = {};
    for (const c of Object.values(dl(s).decks).flat()) cargoLeft[c] = (cargoLeft[c] ?? 0) + 1;
    return { delivered: { ...dl(s).delivered }, cargoLeft };
  },
  hud(s): HudItem[] {
    const level = Object.fromEntries(s.order.map(id => [id, wagon(s, id)?.level ?? 0]));
    return [{ kind: 'table', key: 'dl-table', label: 'Deliveries', rows: [
      { label: 'Delivered', values: { ...dl(s).delivered }, max: null },
      { label: 'Wagon level', values: level, max: 5 },
    ] }];
  },
  badges(s, seat) {
    const x = dl(s), cargo = wagon(s, seat)?.cargo[0];
    const out = [
      { key: 'delivered', icon: 'wagon', value: x.delivered[seat], label: 'Deliveries' },
      { key: 'gold', icon: 'gold', value: x.gold[seat], label: 'Gold' },
    ];
    if (cargo) out.push({ key: 'cargo', icon: cargo, value: 1, label: `Carrying ${cargo}` });
    return out;
  },
};

