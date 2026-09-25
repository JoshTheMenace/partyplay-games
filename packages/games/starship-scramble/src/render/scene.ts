/** Pure battle-scene geometry shared by the TV renderer, its DOM plates, phone hit-testing and tests. No DOM access. */
import type { Combat, PublicView, ShipView } from '../contracts';
import { SPRITE_MARGIN_X, SPRITE_MARGIN_Y, shipLayout, toScreen, type Box, type ShipLayout } from '../defs/geometry';
import { hullDef } from '../defs/hulls';

export type SceneShip = { layout: ShipLayout; plate: Box };
export type SceneLayout = { width: number; height: number; /** CSS px per 1080p pixel. */ unit: number; /** Unit for text and plates, floored so short, wide scenes (the host's deck view) stay readable. */ ui: number; ships: Record<string, SceneShip> };
type Rect = readonly [x: number, y: number, w: number, h: number];
/** Formation boxes in a side's region, in the allies' frame (x = 1 is the front line); enemies mirror them. */
const FORMATIONS: readonly (readonly Rect[])[] = [
  [[.04, .06, .92, .88]],
  [[.34, 0, .66, .5], [0, .5, .66, .5]],
  [[.4, 0, .6, .34], [0, .33, .6, .34], [.4, .66, .6, .34]],
  [[.5, 0, .5, .36], [0, .21, .5, .36], [.5, .43, .5, .36], [0, .64, .5, .36]],
];
const BOSS: readonly Rect[] = [[0, .1, .74, .8], [.64, 0, .36, .3], [.64, .7, .36, .3], [.74, .35, .26, .3]];
const grid = (n: number): Rect[] => { const rows = Math.ceil(n / 2); return Array.from({ length: n }, (_, i) => [i % 2 ? 0 : .5, Math.floor(i / 2) / rows, .5, 1 / rows]); };
export const isBoss = (ship: Pick<ShipView, 'hullId' | 'phases'>) => ship.hullId === 'flagship' || ship.phases.length > 0;
const fit = (hullId: string, box: Box) => { const h = hullDef(hullId); return Math.min(box.w / (h.gridW + 2 * SPRITE_MARGIN_X), box.h / (h.gridH + 2 * SPRITE_MARGIN_Y)); };

/** Allies on the left facing right, enemies on the right facing left; ships on one side share a cell size; the boss dominates its half. */
export function sceneLayout(view: Pick<PublicView, 'ships'>, width: number, height: number): SceneLayout {
  const unit = Math.min(width / 1920, height / 1080), ui = Math.max(unit, Math.min(.62, width / 1920)), cap = (view.ships.some(isBoss) ? 44 : 62) * unit;
  const top = Math.max(height * .11, 96 * ui), bottom = height * .95, plateH = Math.max(44, 70 * ui), ships: Record<string, SceneShip> = {};
  for (const faction of ['ally', 'enemy'] as const) {
    const side = view.ships.filter(s => s.faction === faction).sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id)), facing = faction === 'ally' ? 1 : -1;
    const region = { x: faction === 'ally' ? width * .015 : width * .545, y: top, w: width * .44, h: bottom - top };
    const ordered = [...side.filter(isBoss), ...side.filter(s => !isBoss(s))], n = ordered.length;
    const rects = n && isBoss(ordered[0]) ? (n === 1 ? [[0, .04, 1, .92] as const] : BOSS) : FORMATIONS[n - 1] ?? grid(n);
    const boxes = ordered.map((ship, i) => { const [x, y, w, h] = rects[i] ?? rects[rects.length - 1], fx = facing === 1 ? x : 1 - x - w;
      return { ship, box: { x: region.x + fx * region.w, y: region.y + y * region.h, w: w * region.w, h: h * region.h - plateH } }; });
    const common = Math.min(cap, ...boxes.filter(b => !isBoss(b.ship)).map(b => fit(b.ship.hullId, b.box)));
    for (const { ship, box } of boxes) {
      const layout = shipLayout(hullDef(ship.hullId), box, facing, isBoss(ship) ? 84 * unit : common), { sprite, grid: g, cell } = layout;
      const w = Math.min(region.w, Math.max(250 * ui, Math.min(360 * ui, sprite.w * .8))), cx = g.x + g.w / 2;
      if (cell > 0) ships[ship.id] = { layout, plate: { x: Math.max(region.x, Math.min(region.x + region.w - w, cx - w / 2)), y: Math.min(sprite.y + sprite.h - cell * .35, box.y + box.h + plateH * .08), w, h: plateH } };
    }
  }
  return { width, height, unit, ui, ships };
}

/** Weapon mount `index`: alternating top/bottom hull edge above/below the weapons room, front-most first. side -1 = top edge. */
export function mountPoint(layout: ShipLayout, index: number) {
  const { hull } = layout, room = hull.rooms.find(r => r.system === 'weapons') ?? hull.rooms[0], below = index % 2 === 1;
  const cx = room.x + room.w * [.72, .28, .5, .9, .1][(index >> 1) % 5], col = Math.min(hull.gridW - 1, Math.floor(cx)), cover = hull.rooms.filter(r => col >= r.x && col < r.x + r.w);
  const cy = below ? Math.max(...cover.map(r => r.y + r.h)) + .24 : Math.min(...cover.map(r => r.y)) - .24;
  return { ...toScreen(layout, cx, cy), side: below ? 1 : -1 };
}
/** Screen center of a room, or of the grid for unknown rooms. */
export const roomCenter = (layout: ShipLayout, roomId: string | undefined) => { const r = (roomId && layout.rooms[roomId]) || layout.grid; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
/** The shield bubble ellipse: slightly larger than the sprite box so wing tips sit inside it. */
export const shieldEllipse = (layout: ShipLayout) => ({ x: layout.grid.x + layout.grid.w / 2, y: layout.grid.y + layout.grid.h / 2, rx: layout.sprite.w * .54, ry: layout.sprite.h * .53 });
/** Combat ms when a ship finishes warping in during the 3 s intro: allies first, then enemies, staggered by slot. */
export const arrivalMs = (combat: Pick<Combat, 'introUntilMs'>, ship: Pick<ShipView, 'faction' | 'slot'>) => combat.introUntilMs - 3000 + (ship.faction === 'ally' ? 500 : 1300) + ship.slot * 230;
