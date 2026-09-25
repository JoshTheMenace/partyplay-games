import { bounds, distance } from '../../geometry';
import type { Board, ModuleId, Tile, TileId } from '../../model';
import { explorersPlan } from './explorers';
import { planTiles } from './faces';
import { buildGraph, setFlags } from './graph';
import { centroid } from './islands';
import { basePlan } from './layouts';
import { boardIndex, indexBoard } from './lookup';
import { placePorts, portSlots } from './ports';
import { seafarersPlan } from './seafarers';
import {
  tierOf, type BoardDraft, type BoardInput, type BoardResult, type Decorator, type GenContext,
} from './types';
import { isLand } from './util';

export * from './types';
export { boardIndex, coastCycle, indexBoard, type BoardIndex } from './lookup';
export { growIsland, placeIslands } from './islands';
export { spacedSlots } from './ports';
export { balance, numberFits, placeNumbers, tokenSet } from './numbers';
export { placeTerrain, terrainFits } from './terrain';
export { isLand, shuffled } from './util';

/** When several decorators want a desert: Barbarian Attack > Deliveries > Caravans > Fishing. */
const DESERT_PRIORITY: ModuleId[] = ['barbarian-attack', 'deliveries', 'caravans', 'fishing'];
function rank({ id }: Decorator) {
  const i = DESERT_PRIORITY.indexOf(id);
  return i < 0 ? DESERT_PRIORITY.length : i;
}

/** ENGINE §8.3 step 3: ports keep clear of lakes and landing hexes (plus any `noPorts`). */
function reserve(draft: BoardDraft) {
  const tiles = [
    ...draft.tiles.filter(t => t.terrain === 'lake').map(t => t.id),
    ...draft.features.flatMap(f => (f.kind === 'landing' ? [f.tile] : [])),
  ];
  for (const id of tiles) for (const v of draft.index.tileVertices.get(id)!) draft.noPorts.add(v);
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

/** The tile passing `pick` nearest the centre of the land, or null. */
function nearest(tiles: readonly Tile[], pick: (t: Tile) => boolean): TileId | null {
  const land = tiles.filter(t => isLand(t.terrain)), mid = centroid(land);
  return tiles.filter(pick).sort((a, b) => distance(a, mid) - distance(b, mid))[0]?.id ?? null;
}

/**
 * ENGINE §8: plan → terrain → numbers → sea frame → graph → decorations → ports → bounds.
 * Deterministic for a given `random`; the board is deep-frozen. Decorators may retype land
 * tiles and add features, hidden faces and `noPorts`, but never turn land into sea.
 */
export function makeBoard(input: BoardInput): BoardResult {
  const { seatCount, settings, random } = input;
  const ctx: GenContext = { seatCount, settings, random, tier: tierOf(seatCount) };
  const map = settings.map;
  const plan = map === 'seafarers' ? seafarersPlan(ctx) : map === 'explorers' ? explorersPlan(ctx) : basePlan(ctx);
  const { tiles, hidden } = planTiles(plan, ctx);
  const { vertices, edges } = buildGraph(tiles);
  setFlags(tiles, vertices, edges);
  const index = indexBoard({ tiles, vertices, edges, ports: [] });
  const draft: BoardDraft = {
    tiles, vertices, edges, features: [], hidden, index,
    portSlots: portSlots(index, plan.ports, ctx.tier, random), noPorts: new Set(),
  };
  for (const d of [...(input.decorators ?? [])].sort((a, b) => rank(a) - rank(b))) d.decorate(draft, ctx);
  setFlags(tiles, vertices, edges);
  reserve(draft);
  const ports = placePorts(index, draft.portSlots, draft.noPorts, ctx.tier, random);
  const land = tiles.filter(t => t.terrain !== 'sea');
  const board: Board = freeze({
    tiles, vertices, edges, ports, features: draft.features, bounds: bounds(land),
  });
  boardIndex(board);
  const sea = (t: Tile) => t.terrain === 'sea';
  const openSea = (t: Tile) => sea(t) && index.tileNeighbors.get(t.id)!.every(sea);
  return {
    board, hidden,
    robber: nearest(tiles, t => t.terrain === 'desert'),
    pirate: map === 'seafarers' ? nearest(tiles, openSea) : null,
  };
}
