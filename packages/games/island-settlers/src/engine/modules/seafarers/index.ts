/**
 * Seafarers (2025 rulebook): ships, the pirate, gold fields, island bonus VP and fog discovery.
 * Ships, ship moves and the pirate's robber-prompt field live in the core (legal.ts, prompts.ts,
 * gated by the profile); this module adds the scenario rules through registry hooks only.
 */
import type { CitiesKnightsPublic, EdgeId, HudItem, SeatId, TileId, VertexId } from '../../../model';
import { boardIndex } from '../../board/lookup';
import { face, why } from '../../legal';
import { setPirate } from '../../pieces';
import { hooks, moduleById, type Module } from '../registry';
import type { State } from '../../state';
import { discover } from './fog';
import { SAIL, sail, sailCommand } from './sail';

export type SeafarersState = {
  /** Ships each seat built this opportunity (they may not move until the next one). */
  fresh: Record<SeatId, EdgeId[]>;
  /** Islands where the seat placed its starting buildings (never pay the bonus). */
  home: Record<SeatId, number[]>;
  /** Islands that paid this seat the +2 VP bonus. */
  claimed: Record<SeatId, number[]>;
  /** With Cities & Knights the pirate waits off the board (here) until the first barbarian attack. */
  pirate: TileId | null;
};

const ISLAND_VP = 2;
const ext = (s: State) => s.ext.seafarers as SeafarersState;
const bonus = (s: State) => s.settings.seafarers !== 'fog-islands';

/** Islands (≥ 0) this corner touches. */
function islandsAt(s: State, v: VertexId): number[] {
  const ix = boardIndex(s.board);
  const ids = (ix.vertex.get(v)?.tiles ?? []).map(t => ix.tile.get(t)?.island ?? -1);
  return [...new Set(ids.filter(i => i >= 0))];
}

/** Robber on the hex, or a module blocker (barbarians). */
const blocked = (s: State, tile: string) =>
  s.pieces.robber === tile || hooks(s, 'blocksTile').some(m => m.blocksTile(s, tile));

function settled(s: State, seat: SeatId, v: VertexId) {
  const x = ext(s), setup = s.turn.stage === 'setup';
  for (const island of islandsAt(s, v)) {
    const list = setup ? (x.home[seat] ??= []) : (x.claimed[seat] ??= []);
    if (list.includes(island) || (!setup && (!bonus(s) || x.home[seat]?.includes(island)))) continue;
    list.push(island);
  }
}

/** C&K + Seafarers: the held pirate enters at its start hex once the barbarians have attacked. */
function release(s: State) {
  const x = ext(s);
  if (!x.pirate) return;
  const ck = moduleById('cities-knights')?.publicView?.(s) as CitiesKnightsPublic | undefined;
  if ((ck?.barbarian?.attacks ?? 0) > 0) { setPirate(s, x.pirate); x.pirate = null; }
}

export const seafarers: Module<SeafarersState> = {
  id: 'seafarers',
  profile(p) { p.routeKinds = ['road', 'ship']; p.pirate = true; },
  init(s) {
    const held = s.modules.includes('cities-knights') ? s.pieces.pirate : null;
    if (held) setPirate(s, null);
    return { fresh: {}, home: {}, claimed: {}, pirate: held };
  },
  beforeProduce: release,
  onSeven: s => { release(s); },

  legal: {
    /** New Shores and Fog Islands: starting buildings go on the home island. */
    settlement(s, _seat, v) {
      const free = s.turn.stage !== 'setup' || s.settings.seafarers === 'four-islands';
      return free || islandsAt(s, v).includes(0) ? null : why('rule', 'Start on the home island');
    },
    shipMove(s, seat, from) {
      return ext(s).fresh[seat]?.includes(from) ? why('rule', 'Ships built this turn cannot move') : null;
    },
  },

  commands(s, seat) {
    const c = s.turn.stage === 'setup' ? null : sailCommand(s, seat, ext(s).home[seat] ?? []);
    return c ? [c] : [];
  },
  apply(s, seat, id, a) { if (id === SAIL) sail(s, seat, a.picks.at); },

  /** Gold fields: 1 resource of choice per settlement, 2 per city (bank-limited by the gold prompt). */
  produce(s, roll) {
    const ix = boardIndex(s.board), owed: Record<SeatId, number> = {};
    for (const b of Object.values(s.pieces.buildings)) for (const tile of ix.vertex.get(b.vertex)!.tiles) {
      const f = face(s, tile);
      if (f.terrain !== 'gold' || f.number !== roll.total || blocked(s, tile)) continue;
      owed[b.seat] = (owed[b.seat] ?? 0) + (b.kind === 'city' ? 2 : 1);
    }
    for (const [seat, n] of Object.entries(owed)) roll.gold[seat] = Math.max(roll.gold[seat] ?? 0, n);
  },

  onBuild(s, seat, placed) {
    if (placed.kind === 'building') return settled(s, seat, placed.piece.vertex);
    if (placed.kind !== 'route') return;
    const { kind, edge } = placed.piece;
    if (kind === 'ship' && s.turn.stage !== 'setup') (ext(s).fresh[seat] ??= []).push(edge);
    discover(s, seat, edge);
  },
  onOpportunityStart(s, seat) { delete ext(s).fresh[seat]; },
  onOpportunityEnd(s, seat) { delete ext(s).fresh[seat]; },

  score(s, seat) {
    if (!bonus(s)) return [];
    const n = ext(s).claimed[seat]?.length ?? 0;
    return [{ key: 'islands', label: 'Island bonus', points: n * ISLAND_VP, count: n }];
  },

  publicView: s => ({ claimed: ext(s).claimed }),
  badges(s, seat) {
    const n = ext(s).claimed[seat]?.length ?? 0;
    const label = `${n} new ${n > 1 ? 'islands' : 'island'}`;
    return n ? [{ key: 'islands', icon: 'ship', value: n, label }] : [];
  },
  hud(s): HudItem[] {
    const max = Object.keys(s.hidden).length;
    const value = Object.keys(s.pieces.reveals).filter(t => s.hidden[t]).length;
    const item: HudItem = {
      kind: 'track', key: 'fog', label: 'Fog explored', value, max,
      alert: false, icon: 'eye',
    };
    return max ? [item] : [];
  },
};
