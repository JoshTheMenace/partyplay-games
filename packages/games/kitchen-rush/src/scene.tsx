import { useEffect, useRef, useState } from 'react';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import type { SceneMetrics } from '../../../party-3d/src/index';
import { lineSizes, type Own, type Restaurant, type Settings } from './model';
import { phoneScene } from './phone-scene';
import { startKitchen } from './scene/world';
import { decodeWire, type Wire } from './wire';

/**
 * The 3D kitchen. A shared display (and a host playing on it) always draws it. A phone draws its own kitchen only in a
 * restaurant of several; with one kitchen on the shared screen it reports ready at once and keeps the classic controller.
 * One child scope per round owns every GPU resource; snapshots are buffered and interpolated, and the renderer is never
 * rebuilt for a new snapshot.
 */
export default function KitchenScene(props: SceneViewProps<Settings, Wire, Own>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props);
  const buffer = useRef(new SnapshotBuffer<Restaurant>(100, 32, { adaptive: {}, monotonic: true, resetGapMs: 1500 }));
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  const phone = props.viewRole === 'controller' && !props.isHost, draws = !phone || lineSizes(props.players.length).length > 1;
  latest.current = props;
  useEffect(() => {
    if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, decodeWire(props.publicView), performance.now());
  }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    if (!draws) { props.onReady(); return; }
    const scope = new ResourceScope(props.signal);
    startKitchen(canvas.current!, scope, latest, buffer.current, setMetrics).catch(error => {
      if (scope.signal.aborted) return;
      scope.dispose();
      // One phone that cannot draw its kitchen must not stop the round for the whole room: it carries on with the classic controller.
      if (phone) { console.warn('Kitchen Rush: this phone could not draw its kitchen and uses the classic controller.', error); phoneScene.fail(); latest.current.onReady(); }
      else latest.current.onError(error);
    });
    return scope.dispose;
  }, [props.roundId, props.signal]);
  if (!draws) return null;
  const showMetrics = typeof location !== 'undefined' && new URLSearchParams(location.search).has('metrics');
  return <>
    <canvas ref={canvas} aria-label="Kitchen Rush 3D kitchen with numbered chefs, ingredient crates, chopping boards, stoves and the serving hatch"/>
    <details className="kr-metrics" hidden={!showMetrics}><summary>Scene stats</summary><pre data-testid="scene-metrics">{metrics ? JSON.stringify(metrics, null, 2) : 'Warming up…'}</pre></details>
  </>;
}
