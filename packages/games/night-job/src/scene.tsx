/* The shared TV scene. The renderer is lazy-loaded so phones (which never mount this) skip three.js. */
import { useEffect, useRef } from 'react';
import { ResourceScope } from '../../../party-runtime/src/index';
import type { SceneViewProps } from '../../../party-ui/src/index';
import type { Settings, View } from './model';

export function NightJobScene(props: SceneViewProps<Settings, View, null>) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null), live = useRef(props); live.current = props;
  useEffect(() => {
    const scope = new ResourceScope(props.signal);
    import('./render/index')
      .then(({ mountNightJob }) => mountNightJob(canvas.current!, overlay.current!, () => live.current, scope))
      .catch(error => { if (!scope.signal.aborted) { live.current.onError(error); scope.dispose(); } });
    return scope.dispose;
  }, [props.roundId, props.signal]);
  return <div style={{ position: 'absolute', inset: 0 }}>
    <canvas ref={canvas} aria-label="Heist floor plan: the crew's sight reveals lit rooms; the rest of the building is a blueprint"/>
    <canvas ref={overlay} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}/>
  </div>;
}
