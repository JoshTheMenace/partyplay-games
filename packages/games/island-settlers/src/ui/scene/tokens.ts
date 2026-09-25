/**
 * Number tokens (EXPERIENCE §1.4, an explicit user requirement): flat cardboard discs of radius
 * TOKEN_RADIUS at the hex centre, depth-tested, drawn after tiles and before pieces, never scaled.
 * Corner pieces start 0.78 wu out and the robber stands north-west, so nothing ever covers a token.
 */
import {
  CircleGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry,
} from 'three';
import { TOKEN_RADIUS } from '../../geometry';
import type { PublicView, TileId } from '../../model';
import { tileFace } from '../shared/board';
import { LAND_TOP, ORDER, SUN, TOKEN_Y } from './constants';
import type { Ctx } from './context';
import { isLand } from './terrain';
import { progress } from './motion';

const THICK = 0.035, FACE_Y = 0.336, ROBBED = new Color('#9a9486'), WHITE = new Color('#ffffff');
export const FLASH_MS = 500;

type Token = { root: Group; face: MeshBasicMaterial; rim: Mesh };

export function buildTokens(ctx: Ctx, view: PublicView) {
  const { scope, mats, tex } = ctx, group = new Group(), tokens = new Map<TileId, Token>();
  const side = mats.once('tokenSide', () => mats.standard({ color: '#d9ccb0' }));
  const rimMaterial = mats.once('tokenRim', () => scope.own(new MeshBasicMaterial({
    color: SUN, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })));
  const body = scope.own(new CylinderGeometry(TOKEN_RADIUS, TOKEN_RADIUS, THICK, 32));
  const disc = scope.own(new CircleGeometry(TOKEN_RADIUS, 32).rotateX(-Math.PI / 2));
  const ring = scope.own(new RingGeometry(TOKEN_RADIUS - 0.045, TOKEN_RADIUS, 32).rotateX(-Math.PI / 2));

  for (const tile of view.board.tiles) {
    const { terrain, number } = tileFace(view, tile.id);
    if (!number || !isLand(terrain)) continue;
    const root = new Group(), face = scope.own(new MeshBasicMaterial({
      map: tex.token(number), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    const cylinder = new Mesh(body, side), top = new Mesh(disc, face), rim = new Mesh(ring, rimMaterial);
    cylinder.position.y = TOKEN_Y - LAND_TOP;
    top.position.y = rim.position.y = FACE_Y - LAND_TOP;
    rim.position.y += 0.001;
    rim.visible = false;
    for (const mesh of [cylinder, top, rim]) mesh.renderOrder = ORDER.token;
    root.add(cylinder, top, rim);
    root.position.set(tile.x, LAND_TOP, tile.y);
    group.add(root);
    tokens.set(tile.id, { root, face, rim });
  }

  let flash: { tiles: Set<TileId>; start: number } | null = null;
  return {
    group,
    /** Production flash from `start` (ms, frame clock) for FLASH_MS. */
    flash(tiles: Iterable<TileId>, start: number) { flash = { tiles: new Set(tiles), start }; },
    /** Tokens on revealed fog tiles ride up with the land. */
    lift(tiles: ReadonlySet<TileId>, dy: number) {
      for (const id of tiles) { const token = tokens.get(id); if (token) token.root.position.y = LAND_TOP + dy; }
    },
    /** Robbed face tint, amount 0..1. */
    robbed(amounts: Map<TileId, number>) {
      for (const [id, token] of tokens) token.face.color.copy(WHITE).lerp(ROBBED, amounts.get(id) ?? 0);
    },
    frame(now: number, reduced: boolean) {
      if (!flash) return;
      const t = progress(now, flash.start, FLASH_MS), live = now >= flash.start && t < 1;
      for (const id of flash.tiles) {
        const token = tokens.get(id);
        if (!token) continue;
        token.rim.visible = live;
        token.root.position.y = LAND_TOP + (live && !reduced ? 0.05 * Math.sin(Math.PI * t) : 0);
      }
      if (t >= 1) flash = null;
    },
  };
}
export type TokenLayer = ReturnType<typeof buildTokens>;
