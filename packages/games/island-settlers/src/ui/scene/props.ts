/**
 * Terrain props (EXPERIENCE §1.3): 3–7 small instanced models per land tile, scattered by hash in
 * the ring between the token and the corners, skipping the robber and merchant spots and the strip
 * just south of the token (a tall prop there would reach over it on screen).
 */
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { PublicView, Terrain, TileId } from '../../model';
import { tileFace } from '../shared/board';
import { LAND_TOP, ORDER, hashUnit } from './constants';
import type { Ctx } from './context';
import type { Instance } from './batch';
import { isLand } from './terrain';

const PROPS: Partial<Record<Terrain, string[]>> = {
  wood: ['prop_pine', 'prop_pine', 'prop_round_tree'], brick: ['prop_bricks', 'prop_kiln', 'prop_bricks'],
  wool: ['prop_sheep', 'prop_sheep', 'prop_round_tree'], grain: ['prop_wheat'],
  ore: ['prop_peak', 'prop_rock', 'prop_peak'], desert: ['prop_dune', 'prop_cactus', 'prop_dune'],
  gold: ['prop_nugget', 'prop_rock', 'prop_nugget'], lake: ['prop_reeds'], oasis: ['prop_palm', 'prop_reeds'],
  spice: ['prop_spice', 'prop_palm'], castle: ['prop_rock'], quarry: ['prop_rock'],
  council: ['prop_round_tree'],
};

/** Plan angles (y-down radians) kept clear: robber (north-west), merchant (north-east). */
const CLEAR = [(240 * Math.PI) / 180, (300 * Math.PI) / 180];
const gap = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

/** Props on freshly revealed tiles go in `rising`, which follows the land up (EXPERIENCE §1.3). */
export function buildProps(ctx: Ctx, view: PublicView, low: boolean, fresh: ReadonlySet<TileId>) {
  const group = new Group(), rising = new Group(), up = new Vector3(0, 1, 0);
  const byNode = new Map<string, Instance[]>(), risingNode = new Map<string, Instance[]>();
  group.add(rising);
  for (const tile of view.board.tiles) {
    const { terrain } = tileFace(view, tile.id), kinds = PROPS[terrain];
    if (!kinds || !isLand(terrain)) continue;
    const want = low ? 3 : 3 + Math.floor(hashUnit(tile.id, 99) * 5);
    for (let i = 0, placed = 0; i < 24 && placed < want; i++) {
      const a = hashUnit(tile.id, i) * Math.PI * 2, r = 0.42 + hashUnit(tile.id, i + 40) * 0.24;
      const southOfToken = gap(a, Math.PI / 2) < 0.7 && r < 0.56;
      if (southOfToken || CLEAR.some(c => gap(a, c) < 0.5)) continue;
      const node = kinds[placed % kinds.length], s = 0.8 + hashUnit(tile.id, i + 70) * 0.35;
      const matrix = new Matrix4().compose(
        new Vector3(tile.x + Math.cos(a) * r, LAND_TOP, tile.y + Math.sin(a) * r),
        new Quaternion().setFromAxisAngle(up, hashUnit(tile.id, i + 60) * Math.PI * 2), new Vector3(s, s, s));
      const into = fresh.has(tile.id) ? risingNode : byNode;
      into.set(node, [...(into.get(node) ?? []), { matrix, seat: 0 }]);
      placed++;
    }
  }
  for (const [node, instances] of byNode) ctx.batch(node, group, ORDER.tile).write(instances);
  for (const [node, instances] of risingNode) ctx.batch(node, rising, ORDER.tile).write(instances);
  return { group, rising };
}
