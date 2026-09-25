/**
 * Robber and pirate: hit the leader's best production, never our own hexes, rob the leader.
 * Only public facts are used (VP, card counts, buildings); human or CPU never matters.
 */
import { pips } from '../geometry';
import type { Choice, Command, PickField, Picks, SeatId, TileId } from '../model';
import { face } from './board';
import type { Ctx } from './context';

type Spot = { picks: Picks; tile: TileId; option: Choice; victims: SeatId[]; piece: string };

/** Every (piece, hex) the robber command offers, with the picks that select it. */
function spots(c: Ctx, cmd: Command): Spot[] {
  const out: Spot[] = [];
  const walk = (fields: readonly PickField[], picks: Picks, piece: string) => {
    for (const f of fields) {
      if (f.target === 'tile') {
        for (const o of f.options) {
          const victims = victimsOf(c, o, piece);
          out.push({ picks: { ...picks, [f.key]: o.value }, tile: o.value, option: o, victims, piece });
        }
      } else {
        for (const o of f.options) walk((o.then ?? []).filter(isPick), { ...picks, [f.key]: o.value }, o.value);
      }
    }
  };
  walk(cmd.fields.filter(isPick), {}, 'robber');
  return out;
}

const isPick = (f: Command['fields'][number]): f is PickField => f.kind === 'pick';

function victimsOf(c: Ctx, o: Choice, piece: string): SeatId[] {
  const field = o.then?.find(isPick);
  if (field) return field.options.map(x => x.value);
  const choice = c.pub.robberChoices.find(r => r.seat === c.seat && r.piece === piece)
    ?.tiles.find(t => t.tile === o.value);
  if (choice) return choice.victims;
  const owners = (c.ix.tileVertices.get(o.value) ?? []).map(v => c.pub.pieces.buildings[v]?.seat);
  return [...new Set(owners)].filter((s): s is SeatId => !!s && s !== c.seat
    && (c.pub.seats.find(x => x.id === s)?.cards ?? 0) > 0);
}

/** Victim order: the leader, then most VP, then most cards. */
export function bestVictim(c: Ctx, victims: SeatId[]): SeatId | null {
  const card = (id: SeatId) => c.pub.seats.find(s => s.id === id)?.cards ?? 0;
  const rank = (id: SeatId) => (id === c.leader ? 1e6 : 0) + (c.vp.get(id) ?? 0) * 100 + card(id);
  return victims.reduce<SeatId | null>((a, b) => (a === null || rank(b) > rank(a) ? b : a), null);
}

/** Pirate: ships it blocks (building and moving next to it), the leader's most; ours count against. */
function shipScore(c: Ctx, tile: TileId) {
  return (c.ix.tileEdges.get(tile) ?? []).reduce((n, e) => {
    const r = c.pub.pieces.routes[e.id];
    if (r?.kind !== 'ship') return n;
    return n + (r.seat === c.seat ? -3 : r.seat === c.leader ? 2 : 0.5);
  }, 0);
}

/** Harm to others' production on this hex, weighted toward the leader; ours counts hugely against. */
function hexScore(c: Ctx, s: Spot) {
  const t = c.ix.tile.get(s.tile), p = t ? pips(face(c.pub.pieces, t).number) : 0;
  const top = c.vp.get(c.leader ?? '') ?? 0;
  let score = (s.victims.length ? 2 + (s.victims.includes(c.leader ?? '') ? 4 : 0) : 0)
    + (s.piece === 'pirate' ? shipScore(c, s.tile) : 0);
  for (const v of c.ix.tileVertices.get(s.tile) ?? []) {
    const b = c.pub.pieces.buildings[v];
    if (!b) continue;
    const size = b.kind === 'city' ? 2 : 1;
    if (b.seat === c.seat) { score -= 1000; continue; }
    const weight = b.seat === c.leader ? 4 : 1 + Math.max(0, (c.vp.get(b.seat) ?? 0) - top + 2) * 0.5;
    score += p * size * weight;
  }
  return score;
}

/** Picks for a robber prompt (or a knight's robber prompt). */
export function robberPicks(c: Ctx, cmd: Command): Picks | null {
  const all = spots(c, cmd);
  if (!all.length) return null;
  const ours = (s: Spot) => (c.ix.tileVertices.get(s.tile) ?? [])
    .some(v => c.pub.pieces.buildings[v]?.seat === c.seat);
  const safe = all.filter(s => !ours(s));
  const pool = safe.length ? safe : all;
  const scored = pool.map(s => ({ s, v: c.jitter(hexScore(c, s)) }));
  const naive = pool.filter(s => s.victims.length).length ? pool.filter(s => s.victims.length) : pool;
  const pick = c.k.smartRobber ? scored.reduce((a, b) => (b.v > a.v ? b : a)).s
    : naive[Math.floor(c.random() * naive.length)];
  const then = pick.option.then?.find(isPick);
  const values = then?.options.map(o => o.value) ?? [];
  const victim = then && (c.k.smartRobber ? bestVictim(c, values) : values[0]);
  return victim && then ? { ...pick.picks, [then.key]: victim } : pick.picks;
}

/** Our own production the robber sits on (pips × building size). */
export function robbedPips(c: Ctx) {
  const tile = c.pub.pieces.robber, t = tile ? c.ix.tile.get(tile) : undefined;
  if (!t) return 0;
  return (c.ix.tileVertices.get(t.id) ?? []).reduce((n, v) => {
    const b = c.pub.pieces.buildings[v];
    return b?.seat === c.seat ? n + pips(face(c.pub.pieces, t).number) * (b.kind === 'city' ? 2 : 1) : n;
  }, 0);
}
