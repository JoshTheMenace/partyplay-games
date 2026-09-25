/**
 * Seafarers: a first settlement on each new island pays +2 VP (not on Fog Islands), so those corners
 * score higher everywhere (setup excepted), and "Sail toward new land" is worth what it brings closer.
 */
import type { Command, VertexId } from '../../model';
import { distances, isLandVertex, openSpot } from '../board';
import type { Ctx } from '../context';
import { VP, type Advisor } from './index';

const ISLAND_VP = 2;

const cache = new WeakMap<Ctx, { claimed: number[]; home: Set<number> }>();

/** Islands already worth nothing to us: claimed ones, and home (islands of our unclaimed buildings). */
function home(c: Ctx) {
  const known = cache.get(c);
  if (known) return known;
  const claimed = c.pub.ext.seafarers?.claimed[c.seat] ?? [], out = new Set<number>();
  for (const b of Object.values(c.pub.pieces.buildings)) {
    if (b.seat !== c.seat) continue;
    for (const t of c.ix.vertex.get(b.vertex)?.tiles ?? []) {
      const i = c.ix.tile.get(t)?.island ?? -1;
      if (i >= 0 && !claimed.includes(i)) out.add(i);
    }
  }
  cache.set(c, { claimed, home: out });
  return { claimed, home: out };
}

function spot(c: Ctx, v: VertexId) {
  if (c.pub.turn.stage === 'setup' || c.pub.settings.seafarers === 'fog-islands') return 0;
  const { claimed, home: mine } = home(c);
  const islands = (c.ix.vertex.get(v)?.tiles ?? []).map(t => c.ix.tile.get(t)?.island ?? -1);
  return islands.some(i => i >= 0 && !mine.has(i) && !claimed.includes(i)) ? ISLAND_VP : 0;
}

/** A ship toward new land: a settlement (+ island bonus) discounted by the sea steps still to go. */
function worth(c: Ctx, cmd: Command): number | null {
  const first = cmd.fields[0]?.kind === 'pick' ? cmd.fields[0].options[0]?.value : undefined;
  const e = first ? c.ix.edge.get(first) : undefined;
  const goals = c.pub.board.vertices.filter(v => openSpot(c.ix, c.pub.pieces, v.id)
    && isLandVertex(c.ix, c.pub.pieces, v) && spot(c, v.id) > 0).map(v => v.id);
  if (!e || !goals.length) return 0.9;
  const dist = distances(c.ix, c.pub.pieces, c.seat, goals, true, 10);
  const d = Math.min(dist.get(e.a) ?? 12, dist.get(e.b) ?? 12);
  return (VP * (1 + ISLAND_VP) * 0.35) / (1 + 0.5 * d);
}

export const seafarers: Advisor = {
  spot, worth: (c, cmd) => (cmd.id === 'seafarers/sail' ? worth(c, cmd) : null),
};
