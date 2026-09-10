import { WebGLRenderer, type Camera, type Scene } from 'three';
import { FrameMetrics, ResourceScope } from '../../party-runtime/src/index';
export type SceneMetrics = ReturnType<FrameMetrics['snapshot']> & { loadMs: number; calls: number; triangles: number; geometries: number; textures: number; pixelRatio: number };
export type Quality = 'low' | 'balanced';
/** Caller owns scene assets. This scope owns the renderer, resize observer, and animation loop. */
export function mountThreeScene(canvas: HTMLCanvasElement, options: {
  signal: AbortSignal; scene: Scene; camera: Camera; quality?: Quality;
  resize(aspect: number): void; frame(nowMs: number, dtSeconds: number): void;
  onReady(): void; onError(error: unknown): void; onMetrics?(metrics: SceneMetrics): void;
}) {
  const scope = new ResourceScope(options.signal), frames = new FrameMetrics(), began = performance.now();
  if (scope.signal.aborted) return scope;
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: options.quality !== 'low', powerPreference: 'high-performance' }); }
  catch (error) { scope.dispose(); options.onError(error); return scope; }
  scope.defer(() => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); });
  let sized = false, warmed = false, ready = false, previous = 0, reported = 0, loadMs = 0;
  const fail = (error: unknown) => { if (scope.signal.aborted) return; scope.dispose(); options.onError(error); };
  scope.listen(canvas, 'webglcontextlost', event => { event.preventDefault(); fail(new Error('Graphics context lost. Return to the lobby and start again.')); });
  renderer.debug.onShaderError = () => fail(new Error('A shader could not compile. Try low graphics quality or another browser.'));
  const resize = () => {
    if (scope.signal.aborted) return;
    const { width, height } = canvas.getBoundingClientRect(); sized = width > 0 && height > 0;
    if (!sized) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, options.quality === 'low' ? 1 : 2));
    renderer.setSize(width, height, false); options.resize(width / height);
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); scope.defer(() => observer.disconnect());
  scope.listen(window, 'resize', resize); scope.listen(document, 'visibilitychange', () => { previous = 0; }); resize();
  renderer.setAnimationLoop(now => {
    if (scope.signal.aborted || !sized || !warmed || document.hidden) return;
    try {
      const delta = previous ? now - previous : 0; previous = now;
      options.frame(now, Math.min(delta / 1000, .1)); renderer.render(options.scene, options.camera);
      if (!ready) { ready = true; loadMs = performance.now() - began; options.onReady(); }
      else if (delta) frames.record(delta);
      if (now - reported >= 1000) { reported = now; const { render, memory } = renderer.info; options.onMetrics?.({ ...frames.snapshot(), loadMs, calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, pixelRatio: renderer.getPixelRatio() }); }
    } catch (error) { fail(error); }
  });
  void renderer.compileAsync(options.scene, options.camera).then(() => { if (!scope.signal.aborted) warmed = true; }).catch(fail);
  return scope;
}
