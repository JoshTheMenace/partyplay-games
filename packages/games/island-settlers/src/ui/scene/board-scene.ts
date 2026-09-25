/**
 * The TV board for one round: scene, camera, lights and layers, fed by snapshots through update()
 * and animated by frame(). Static layers (terrain, tokens, harbours, props) rebuild only when the
 * board or fog reveals change; pieces and overlays diff every snapshot.
 */
import {
  Color, DirectionalLight, Group, HemisphereLight, OrthographicCamera, Scene,
} from 'three';
import type { GameEvent, PublicView, TileId } from '../../model';
import { boardIndex } from '../shared/board';
import { bridge, type ScreenPoint } from '../shared/bridge';
import { freshEvents } from '../shared/timeline';
import { ResourceScope } from '../../../../../party-runtime/src/index';
import { CAMERA_DIR, WATER, fitCamera, project, unproject, type Fit, type Stage } from './camera';
import { textures } from './canvas';
import { LAND_TOP, SEA_Y, pieceScale } from './constants';
import { context } from './context';
import type { Kit } from './kit';
import { materials } from './materials';
import { createOverlays } from './overlays';
import { createPieces, type Cues } from './pieces';
import { buildPorts } from './ports';
import { buildFeatures, type FeatureLayer } from './features';
import { buildProps } from './props';
import { buildTerrain, type TerrainLayer } from './terrain';
import { buildTokens, type TokenLayer } from './tokens';

const FLASH_AT = 450, TINT_MS = 300;

export function createBoardScene(scope: ResourceScope, kit: Kit, low: boolean) {
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  scene.background = new Color('#0b2d4f');
  camera.position.set(CAMERA_DIR.x * 80, CAMERA_DIR.y * 80, CAMERA_DIR.z * 80);
  camera.lookAt(0, 0, 0);
  const key = new DirectionalLight('#fff1d6', 2.2), fill = new DirectionalLight('#9fd6ff', 0.5);
  key.position.set(-12, 24, 14);
  fill.position.set(16, 10, -12);
  scene.add(new HemisphereLight('#dcecff', '#2a4f6e', 1.7), key, fill);

  const mats = materials(scope), tex = textures(scope), ctx = context(scope, mats, tex, kit);
  const pieces = createPieces(ctx, scene), overlays = createOverlays(ctx, scene);
  let view: PublicView | null = null, staticKey = '', layer: ResourceScope | null = null;
  let terrain: TerrainLayer | null = null, tokens: TokenLayer | null = null, statics: Group | null = null;
  let props: ReturnType<typeof buildProps> | null = null, river: FeatureLayer | null = null;
  let stage: Stage | null = null, fit: Fit | null = null, host = false, lastSeen = 0;
  let me: number | null = null;
  const tint = new Map<TileId, number>();

  function rebuildStatics(next: PublicView, fresh: Set<TileId>, now: number) {
    layer?.dispose();
    statics?.removeFromParent();
    layer = new ResourceScope(scope.signal);
    const local = context(layer, mats, tex, kit);
    terrain = buildTerrain(local, next, fresh, now);
    tokens = buildTokens(local, next);
    const ports = buildPorts(local, next), features = buildFeatures(local, next);
    props = buildProps(local, next, low, fresh);
    statics = new Group().add(terrain.group, tokens.group, ports.group, props.group, features.group);
    river = features;
    scene.add(statics);
    terrain.tint(tint);
    tokens.robbed(tint);
  }

  function refit() {
    if (!view || !stage) return;
    fit = fitCamera(view.board, stage, host);
    Object.assign(camera, { left: fit.left, right: fit.right, top: fit.top, bottom: fit.bottom });
    camera.updateProjectionMatrix();
    const scale = pieceScale(fit.scale), index = boardIndex(view.board), f = fit;
    pieces.setScale(scale);
    overlays.setScale(scale);
    const point = (x: number, y: number, h: number): ScreenPoint => project(f, x, h, y);
    bridge.publish({
      pxPerWu: fit.scale,
      tiles: Object.fromEntries(view.board.tiles.map(t =>
        [t.id, point(t.x, t.y, WATER.has(t.terrain) ? SEA_Y : LAND_TOP + 0.035)])),
      vertices: Object.fromEntries([...index.vertices.values()].map(v => [v.id, point(v.x, v.y, LAND_TOP)])),
    });
  }

  /** Turn fresh events into scene cues; rolls schedule the token flash on the shared timeline. */
  function cues(events: GameEvent[], now: number): Cues {
    const out: Cues = { drops: new Set(), moves: new Map(), paths: new Map() };
    for (const e of events) {
      if (e.kind === 'build' && e.spot) out.drops.add(e.spot);
      else if (e.kind === 'move' && e.unit) {
        const id = `unit:${e.unit}`;
        out.paths.set(id, [...(out.paths.get(id) ?? []), e.to]);
      } else if (e.kind === 'move' && e.piece === 'ship') out.moves.set(e.to, e.from);
      else if (e.kind === 'roll') tokens?.flash(new Set(e.grants.map(g => g.tile)), now + FLASH_AT);
    }
    return out;
  }

  return {
    scene, camera,
    update(next: PublicView, serverNow: number, now: number) {
      const fresh = freshEvents(next.events, lastSeen, serverNow);
      lastSeen = Math.max(lastSeen, ...next.events.map(e => e.id));
      const revealed = new Set(fresh.flatMap(e => (e.kind === 'reveal' ? [e.tile] : [])));
      const nextKey = JSON.stringify(next.pieces.reveals);
      const boardChanged = next.board !== view?.board;
      if (boardChanged && next.pieces.robber) tint.set(next.pieces.robber, 1);
      if (boardChanged || nextKey !== staticKey) rebuildStatics(next, revealed, now);
      staticKey = nextKey;
      view = next;
      if (boardChanged) refit();
      pieces.sync(next, now, cues(fresh, now));
      overlays.sync(next, pieces, bridge.pick, me);
    },
    /** Re-read bridge.pick (host placement) without a new snapshot. */
    repick() { if (view) overlays.sync(view, pieces, bridge.pick, me); },
    setViewer(seat: number | null, isHost: boolean) { me = seat; host = isHost; refit(); },
    resize(next: Stage) { stage = next; refit(); if (view) overlays.sync(view, pieces, bridge.pick, me); },
    frame(now: number, dt: number, reduced: boolean) {
      const robbed = view?.pieces.robber ?? null;
      let changed = false;
      for (const id of new Set([...tint.keys(), ...(robbed ? [robbed] : [])])) {
        const target = id === robbed ? 1 : 0, value = tint.get(id) ?? 0;
        if (value === target) continue;
        const step = reduced ? 1 : (dt * 1000) / TINT_MS;
        tint.set(id, target > value ? Math.min(1, value + step) : Math.max(0, value - step));
        changed = true;
      }
      if (changed) { terrain?.tint(tint); tokens?.robbed(tint); }
      terrain?.frame(now, reduced);
      const up = terrain?.rising(now, reduced);
      if (up && props) {
        tokens?.lift(up.tiles, up.lift);
        props.rising.position.y = up.lift;
        pieces.rise(up.tiles, up.lift);
      }
      tokens?.frame(now, reduced);
      river?.frame(now, reduced);
      pieces.frame(now, reduced);
      overlays.frame(now, reduced);
    },
    /** Hover at stage px; returns the spot under the pointer. */
    pointer(px: number, py: number) {
      if (!fit) return null;
      const p = unproject(fit, px, py, LAND_TOP), id = overlays.nearest(p.x, p.z);
      overlays.hover(id);
      return id;
    },
    ready: () => !!view && !!fit,
  };
}
export type BoardScene = ReturnType<typeof createBoardScene>;
