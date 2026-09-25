import type { Axial } from '../../geometry';
import type {
  Board, BoardFeature, Edge, ModuleId, Reveal, Settings, Terrain, Tile, TileId, Vertex, VertexId,
} from '../../model';
import type { BoardIndex } from './lookup';

/** Size class: 0 = 3–4 seats, 1 = 5–6, 2 = 7–10. Every per-size table is indexed by it. */
export type Tier = 0 | 1 | 2;
export const tierOf = (seats: number): Tier => (seats <= 4 ? 0 : seats <= 6 ? 1 : 2);

export type GenContext = { seatCount: number; tier: Tier; settings: Settings; random: () => number };

export type PlanCell = Axial & { island: number };

/** A group of cells that shares one terrain mix and one number-token set. */
export type Region = {
  cells: PlanCell[];
  /** Exactly one terrain per cell, placed under the §8.2 constraints. */
  mix: Terrain[];
  /** Faces go to `hidden`; the public tile shows `fog` (island -1, no number). */
  hidden?: true;
};

export type CellPlan = {
  regions: Region[];
  /** Extra visible sea cells (gaps between islands). */
  sea: Axial[];
  /** Sea rings added around every cell. */
  frame: number;
  /** Which coasts get ports: the home island, every island weighted by coast, or none. */
  ports: 'home' | 'islands' | 'none';
};

/** What module decorators see and may edit (tile terrain, features, hidden faces, noPorts). */
export type BoardDraft = {
  tiles: Tile[];
  vertices: Vertex[];
  edges: Edge[];
  features: BoardFeature[];
  hidden: Record<TileId, Reveal>;
  index: BoardIndex;
  /** Planned port edges (evenly spaced), so decorators such as fishing can sit between them. */
  portSlots: string[];
  /** Vertices a port must not touch. */
  noPorts: Set<VertexId>;
};

export type Decorator = { id: ModuleId; decorate(draft: BoardDraft, ctx: GenContext): void };

export type BoardInput = {
  seatCount: number;
  settings: Settings;
  random: () => number;
  decorators?: Decorator[];
};

/** `robber`: the desert nearest the centre. `pirate`: Seafarers only, open sea nearest the centre. */
export type BoardResult = {
  board: Board; hidden: Record<TileId, Reveal>; robber: TileId | null; pirate: TileId | null;
};
