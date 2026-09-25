/**
 * SceneView: the 3D board behind the TV HUD and the seated host's dock. The renderer is built once
 * per round; snapshots flow in through a ref and are applied inside the frame loop, so a new view
 * never rebuilds anything heavy. onReady fires only after a frame with the board has been drawn.
 */
import { useEffect, useRef, type MouseEvent } from 'react';
import type { SceneViewProps } from '../../../../../party-ui/src/index';
import { mountThreeScene } from '../../../../../party-3d/src/index';
import { ResourceScope } from '../../../../../party-runtime/src/index';
import type { PrivateView, PublicView, Settings } from '../../model';
import { bridge } from '../shared/bridge';
import { reducedMotion } from '../shared/timeline';
import { createBoardScene, type BoardScene } from './board-scene';
import { loadKit } from './kit';

type Props = SceneViewProps<Settings, PublicView, PrivateView>;
/** With no snapshot at all, report ready after this long so the round can still start. */
const EMPTY_READY_MS = 4000;

export function SceneView(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props);
  const board = useRef<BoardScene | null>(null);
  latest.current = props;

  useEffect(() => {
    const scope = new ResourceScope(props.signal), el = canvas.current!, started = performance.now();
    const low = (navigator.hardwareConcurrency ?? 8) <= 4;
    let rendered = false, reported = false, shown: PublicView | null = null, viewer = '';
    const report = (scene: BoardScene) => {
      if (reported || !rendered || !(scene.ready() || performance.now() - started > EMPTY_READY_MS)) return;
      reported = true;
      latest.current.onReady();
    };
    const start = async () => {
      await document.fonts?.load('96px "Lilita One"').catch(() => undefined);
      const kit = await loadKit(scope, latest.current.settings);
      if (scope.signal.aborted) return;
      const scene = createBoardScene(scope, kit, low);
      board.current = scene;
      scope.defer(bridge.subscribe(() => scene.repick()));
      mountThreeScene(el, {
        signal: scope.signal, scene: scene.scene, camera: scene.camera, quality: low ? 'low' : 'balanced',
        resize: () => scene.resize({ width: el.clientWidth, height: el.clientHeight }),
        frame(now, dt) {
          report(scene); // the previous frame already drew the board
          const p = latest.current, view = p.publicView;
          const seat = view?.seats.find(s => s.id === p.playerId)?.seat ?? null;
          const host = !!p.isHost && !!p.playerId;
          if (`${seat}:${host}` !== viewer) { viewer = `${seat}:${host}`; scene.setViewer(seat, host); }
          if (view && view !== shown) { shown = view; scene.update(view, p.serverNowMs(), now); }
          scene.frame(now, dt, reducedMotion());
        },
        onReady: () => { rendered = true; },
        onError: error => latest.current.onError(error),
        onMetrics: m => Object.assign(el.dataset, { calls: m.calls, triangles: m.triangles, p95: m.p95Ms }),
      });
    };
    start().catch(error => { if (!scope.signal.aborted) latest.current.onError(error); });
    return () => { board.current = null; scope.dispose(); };
  }, [props.roundId, props.signal]);

  const spot = (e: MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return board.current?.pointer(e.clientX - rect.left, e.clientY - rect.top) ?? null;
  };
  return <canvas ref={canvas} className="island-settlers-scene" role="img" aria-label="Island board"
    onPointerMove={e => { e.currentTarget.style.cursor = spot(e) ? 'pointer' : ''; }}
    onPointerLeave={() => board.current?.pointer(-1e4, -1e4)}
    onClick={e => { const id = spot(e); if (id) bridge.pick.onPick?.(id); }}/>;
}
export default SceneView;
