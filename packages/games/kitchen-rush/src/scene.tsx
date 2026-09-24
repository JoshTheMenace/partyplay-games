import { useEffect, useRef, useState } from 'react';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import type { SceneMetrics } from '../../../party-3d/src/index';
import type { Settings, View } from './model';
import { startKitchen } from './scene/world';

/**
 * The shared 3D kitchen (TV display and solo view). One child scope per round owns every GPU resource; snapshots are
 * buffered and interpolated, and the renderer is never rebuilt for a new snapshot.
 */
export default function KitchenScene(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props);
  const buffer = useRef(new SnapshotBuffer<View>(100, 32, { adaptive: {}, monotonic: true, resetGapMs: 1500 }));
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  latest.current = props;
  useEffect(() => {
    if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, props.publicView, performance.now());
  }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    const scope = new ResourceScope(props.signal);
    startKitchen(canvas.current!, scope, latest, buffer.current, setMetrics).catch(error => {
      if (!scope.signal.aborted) { latest.current.onError(error); scope.dispose(); }
    });
    return scope.dispose;
  }, [props.roundId, props.signal]);
  const showMetrics = typeof location !== 'undefined' && new URLSearchParams(location.search).has('metrics');
  return <>
    <canvas ref={canvas} aria-label="Kitchen Rush 3D kitchen with numbered chefs, ingredient crates, chopping boards, stoves and the serving hatch"/>
    <details className="kr-metrics" hidden={!showMetrics}><summary>Scene stats</summary><pre data-testid="scene-metrics">{metrics ? JSON.stringify(metrics, null, 2) : 'Warming up…'}</pre></details>
  </>;
}
