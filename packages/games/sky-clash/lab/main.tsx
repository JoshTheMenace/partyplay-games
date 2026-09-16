import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACESFilmicToneMapping, CanvasTexture, CircleGeometry, CylinderGeometry, DirectionalLight, Fog, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, RingGeometry, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ArcadeButton, Panel } from '../../../party-ui/src/primitives';
import { ResourceScope } from '../../../party-runtime/src/resources';
import { foxData } from '../fidelity/fox-data';
import { foxAttributes, traceAir } from '../fidelity/physics';
import { decodeHitbox } from '../fidelity/commands';
import { POSES, applyPose, captureRig, poseAt, type PoseId, type Rig } from './animation';
import '../../../party-ui/src/style.css';
import './style.css';
const MODEL_URL = new URL('../assets/fox-replacement.glb', import.meta.url).href;
const num = (value: number, digits = 6) => String(parseFloat(value.toPrecision(digits)));
const describe = (error: unknown) => error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown graphics error.';
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const query = matchMedia('(prefers-reduced-motion: reduce)'), update = () => setReduced(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return reduced;
}
function disposeTree(root: Object3D) {
  root.traverse(object => {
    const mesh = object as Mesh; mesh.geometry?.dispose?.();
    for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) { for (const value of Object.values(material)) if (value instanceof Texture) value.dispose(); material.dispose(); }
  });
}
function gradientTexture(stops: [number, string][], width = 4, height = 512, radial = false) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const g = canvas.getContext('2d')!;
  const gradient = radial ? g.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2) : g.createLinearGradient(0, 0, 0, height);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  g.fillStyle = gradient; g.fillRect(0, 0, width, height); const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}
type ModelInfo = { triangles: number; bones: number; materials: number; missing: string[] };
type ViewerState = { kind: 'loading'; progress: number | null } | { kind: 'ready'; info: ModelInfo } | { kind: 'error'; message: string };
function Viewer({ pose, turntable, reduced, onInfo, resetSignal }: { pose: PoseId; turntable: boolean; reduced: boolean; onInfo(info: ModelInfo): void; resetSignal: number }) {
  const canvas = useRef<HTMLCanvasElement>(null), [attempt, setAttempt] = useState(0), [state, setState] = useState<ViewerState>({ kind: 'loading', progress: null });
  const live = useRef({ pose, turntable, reduced, onInfo }); live.current = { pose, turntable, reduced, onInfo };
  const resetView = useRef(() => {});
  useEffect(() => { if (resetSignal) resetView.current(); }, [resetSignal]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const scope = new ResourceScope(); setState({ kind: 'loading', progress: null });
    const fail = (message: string) => { if (scope.signal.aborted) return; scope.dispose(); setState({ kind: 'error', message }); };
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ canvas: element, antialias: true, powerPreference: 'high-performance' }); }
    catch (error) { setState({ kind: 'error', message: `WebGL is unavailable. ${describe(error)}` }); return; }
    scope.defer(() => { renderer.setAnimationLoop(null); renderer.dispose(); });
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = SRGBColorSpace; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    scope.listen(element, 'webglcontextlost', event => { event.preventDefault(); fail('The graphics context was lost. Retry to rebuild the viewer.'); });
    // Studio: gradient backdrop, dark floor with fog, lit pedestal, soft contact shadow.
    const scene = new Scene(); scene.background = scope.own(gradientTexture([[0, '#0b1030'], [.45, '#173d5e'], [.75, '#0f2a44'], [1, '#070c1f']])); scene.fog = new Fog('#0a1428', 9, 22);
    const own = <T extends { dispose(): void }>(resource: T) => scope.own(resource);
    const floor = new Mesh(own(new CircleGeometry(14, 64)), own(new MeshStandardMaterial({ color: '#0c1a33', roughness: .92, metalness: .05 }))); floor.rotation.x = -Math.PI / 2; floor.position.y = -.145; scene.add(floor);
    const pedestal = new Mesh(own(new CylinderGeometry(1.18, 1.3, .14, 56)), own(new MeshStandardMaterial({ color: '#1b2a4a', roughness: .55, metalness: .25 }))); pedestal.position.y = -.07; scene.add(pedestal);
    const trim = new Mesh(own(new RingGeometry(1.1, 1.18, 64)), own(new MeshBasicMaterial({ color: '#ffd24a' }))); trim.rotation.x = -Math.PI / 2; trim.position.y = .002; scene.add(trim);
    const shadow = new Mesh(own(new CircleGeometry(.9, 40)), own(new MeshBasicMaterial({ map: own(gradientTexture([[0, '#000000cc'], [.55, '#00000055'], [1, '#00000000']], 256, 256, true)), transparent: true, depthWrite: false }))); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .004; scene.add(shadow);
    scene.add(new HemisphereLight('#bfe3ff', '#2a1a3a', .9));
    const key = new DirectionalLight('#fff1dc', 2.6); key.position.set(3, 5, 4); scene.add(key);
    const rim = new DirectionalLight('#38d9e8', 1.5); rim.position.set(-4, 3, -3.5); scene.add(rim);
    const fill = new DirectionalLight('#ffb37a', .55); fill.position.set(-3, 1.5, 3); scene.add(fill);
    // Home framing covers the pedestal through the airborne pose (root lift .41 plus 1.875 m model and spread hands) with margin at 4:3 and 4:5 stages.
    const camera = new PerspectiveCamera(30, 1, .05, 60), home = { position: new Vector3(1.95, 1.55, 5.15), target: new Vector3(0, 1.08, 0) };
    const controls = new OrbitControls(camera, element); controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .08; controls.minDistance = 2.3; controls.maxDistance = 8.5; controls.minPolarAngle = .3; controls.maxPolarAngle = Math.PI * .56; controls.autoRotateSpeed = 1.1;
    resetView.current = () => { camera.position.copy(home.position); controls.target.copy(home.target); controls.update(); }; resetView.current(); scope.defer(() => controls.dispose());
    const resize = () => { const { width, height } = element.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(element); scope.defer(() => observer.disconnect()); resize();
    let rig: Rig | null = null;
    new GLTFLoader().load(MODEL_URL, gltf => {
      if (scope.signal.aborted) { disposeTree(gltf.scene); return; }
      let triangles = 0, materials = new Set<string>(), bones = 0;
      gltf.scene.traverse(object => { const mesh = object as Mesh; if (mesh.isMesh && mesh.geometry) { const g = mesh.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m.uuid); } if ((object as { isBone?: boolean }).isBone) bones++; });
      scene.add(gltf.scene); scope.defer(() => disposeTree(gltf.scene)); rig = captureRig(gltf.scene);
      const info = { triangles: Math.round(triangles), bones, materials: materials.size, missing: rig.missing }; setState({ kind: 'ready', info }); live.current.onInfo(info);
    }, event => { if (!scope.signal.aborted) setState(current => current.kind === 'loading' ? { kind: 'loading', progress: event.lengthComputable ? event.loaded / event.total : null } : current); }, error => fail(`The Fox model could not be loaded. ${describe(error)}`));
    renderer.setAnimationLoop(now => {
      try { controls.autoRotate = live.current.turntable && !live.current.reduced; controls.update(); if (rig) applyPose(rig, poseAt(live.current.pose, now / 1000, live.current.reduced)); renderer.render(scene, camera); }
      catch (error) { fail(describe(error)); }
    });
    return scope.dispose;
  }, [attempt]);
  return <div className="fx-stage">
    <canvas ref={canvas} aria-label="Fox replacement model on a studio pedestal. Drag to orbit."/>
    {state.kind === 'loading' && <p className="fx-stage-note" role="status">Loading the Fox model{state.progress !== null ? ` · ${Math.round(state.progress * 100)}%` : '…'}</p>}
    {state.kind === 'ready' && state.info.missing.length > 0 && <p className="fx-stage-note fx-stage-warn" role="status">Missing bones: {state.info.missing.join(', ')}. Poses skip them.</p>}
    {state.kind === 'error' && <div className="fx-stage-error" role="alert"><p>{state.message}</p><ArcadeButton tone="coral" onClick={() => setAttempt(value => value + 1)}>Retry</ArcadeButton></div>}
  </div>;
}
const STAT_ROWS: [string, keyof typeof foxAttributes, string][] = [
  ['Weight', 'weight', ''], ['Gravity', 'gravity', 'u/frame²'], ['Terminal fall', 'terminal_velocity', 'u/frame'], ['Fast fall', 'fast_fall_velocity', 'u/frame'],
  ['Walk max', 'walk_max_vel', 'u/frame'], ['Dash start', 'dash_initial_velocity', 'u/frame'], ['Dash max', 'dash_max_velocity', 'u/frame'],
  ['Jump squat', 'jump_startup_time', 'frames'], ['Full hop launch', 'jump_v_initial_velocity', 'u/frame'], ['Short hop launch', 'hop_v_initial_velocity', 'u/frame'],
  ['Air jump ×', 'air_jump_v_multiplier', ''], ['Max jumps', 'max_jumps', ''], ['Air drift max', 'air_drift_max', 'u/frame'], ['Shield size', 'initial_shield_size', ''],
];
function Stats() {
  const mapped = Object.keys(foxAttributes).length;
  return <Panel className="fx-panel fx-stats"><p className="kp-eyebrow">Reference stats · original values</p><dl>{STAT_ROWS.map(([label, key, unit]) => <div key={key}><dt>{label}<small>{key}</small></dt><dd className="kp-numeral">{num(foxAttributes[key])}<span>{unit}</span></dd></div>)}</dl>
    <p className="fx-fine">Showing {STAT_ROWS.length} of {mapped} mapped common attributes, kept as single-precision game units per frame. Additional parameter data is still needed.</p></Panel>;
}
function Probe({ reduced }: { reduced: boolean }) {
  const [launch, setLaunch] = useState<'full' | 'short'>('full'), [stick, setStick] = useState(0), [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  const vy = launch === 'full' ? foxAttributes.jump_v_initial_velocity : foxAttributes.hop_v_initial_velocity;
  const trace = useMemo(() => { const full = traceAir(vy, stick, 90), back = full.findIndex((s, i) => i > 0 && s.y <= 0); return back > 0 ? full.slice(0, back + 1) : full; }, [vy, stick]);
  const last = trace.length - 1, current = trace[Math.min(frame, last)], apex = trace.reduce((best, s) => s.y > best.y ? s : best, trace[0]);
  useEffect(() => { if (frame > last) setFrame(last); }, [last, frame]);
  useEffect(() => { if (!playing) return; const timer = setInterval(() => setFrame(f => { if (f >= last) { setPlaying(false); return f; } return f + 1; }), 1000 / 60); return () => clearInterval(timer); }, [playing, last]);
  const W = 320, H = 190, pad = 22, xs = trace.map(s => s.x), minX = Math.min(-1, ...xs), maxX = Math.max(1, ...xs), maxY = Math.max(1, apex.y), minY = Math.min(0, ...trace.map(s => s.y));
  const px = (x: number) => pad + (x - minX) / (maxX - minX) * (W - pad * 2), py = (y: number) => H - pad - (y - minY) / (maxY - minY) * (H - pad * 2);
  const path = trace.map((s, i) => `${i ? 'L' : 'M'}${px(s.x).toFixed(1)} ${py(s.y).toFixed(1)}`).join(' ');
  const rows: [string, number][] = [['Frame', current.frame], ['x', current.x], ['y', current.y], ['vx', current.vx], ['vy', current.vy]];
  return <Panel className="fx-panel fx-probe"><p className="kp-eyebrow">Movement probe · gravity and air drift</p>
    <div className="fx-probe-launch" role="group" aria-label="Launch velocity">{(['full', 'short'] as const).map(kind => <ArcadeButton key={kind} size="sm" tone={launch === kind ? 'sun' : 'ghost'} aria-pressed={launch === kind} onClick={() => { setLaunch(kind); setFrame(0); setPlaying(false); }}>{kind === 'full' ? 'Full hop' : 'Short hop'} <small>{num(kind === 'full' ? foxAttributes.jump_v_initial_velocity : foxAttributes.hop_v_initial_velocity)}</small></ArcadeButton>)}</div>
    <div className="fx-range"><label htmlFor="fx-stick">Analog direction</label><output htmlFor="fx-stick" aria-label="Analog direction value">{stick.toFixed(2)}</output><input id="fx-stick" type="range" min={-1} max={1} step={.05} value={stick} onChange={event => { setStick(Number(event.target.value)); setFrame(0); setPlaying(false); }}/></div>
    <svg className="fx-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trajectory of ${trace.length} frames, apex ${num(apex.y, 4)} at frame ${apex.frame}`}>
      <line x1={pad} x2={W - pad} y1={py(0)} y2={py(0)} className="fx-chart-axis"/><line x1={px(0)} x2={px(0)} y1={pad} y2={H - pad} className="fx-chart-axis"/>
      <path d={path} className="fx-chart-path"/>
      <circle cx={px(apex.x)} cy={py(apex.y)} r="3" className="fx-chart-apex"/><circle cx={px(current.x)} cy={py(current.y)} r="5" className="fx-chart-dot"/>
      <text x={W - pad} y={py(0) + 14} textAnchor="end" className="fx-chart-text">launch height</text><text x={px(apex.x) + 6} y={py(apex.y) - 6} className="fx-chart-text">apex f{apex.frame} · {num(apex.y, 4)}</text>
    </svg>
    <div className="fx-range"><label htmlFor="fx-frame">Frame</label><output htmlFor="fx-frame" aria-label="Frame position">{current.frame} / {last}</output><input id="fx-frame" type="range" min={0} max={last} step={1} value={Math.min(frame, last)} onChange={event => { setFrame(Number(event.target.value)); setPlaying(false); }}/></div>
    <div className="fx-probe-actions"><ArcadeButton size="sm" tone="ghost" aria-label="Step back one frame" disabled={frame <= 0} onClick={() => { setPlaying(false); setFrame(f => Math.max(0, f - 1)); }}>−1</ArcadeButton><ArcadeButton size="sm" tone={playing ? 'lime' : 'sky'} aria-pressed={playing} onClick={() => { if (frame >= last) setFrame(0); setPlaying(p => !p); }}>{playing ? 'Pause' : frame >= last ? 'Replay' : 'Play'}</ArcadeButton><ArcadeButton size="sm" tone="ghost" aria-label="Step forward one frame" disabled={frame >= last} onClick={() => { setPlaying(false); setFrame(f => Math.min(last, f + 1)); }}>+1</ArcadeButton></div>
    <dl className="fx-readout">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="kp-numeral">{label === 'Frame' ? value : value.toFixed(4)}</dd></div>)}</dl>
    <p className="fx-fine">Starts from the source launch velocity and applies only gravity, terminal velocity and air drift per frame. The trace stops where height returns to the launch level. No jump squat, landing, inputs, collisions or specials, and the pedestal pose above is not driven by it.{reduced ? ' Playback advances only while you press Play.' : ''}</p></Panel>;
}
function Attack11() {
  const action = foxData.actions.find(a => a.name === 'Attack11');
  if (!action) return null;
  const hitboxes = action.events.filter(e => e.name === 'hitbox').map(e => { try { return decodeHitbox(e.hex); } catch { return null; } }).filter(Boolean) as ReturnType<typeof decodeHitbox>[];
  return <Panel className="fx-panel"><details><summary><span className="kp-eyebrow">Command script · Attack11</span><span>{action.events.length} events · {hitboxes.length} hitboxes</span></summary>
    <div className="fx-table-wrap"><table className="fx-table"><thead><tr><th>ID</th><th>Damage</th><th>Angle</th><th>Size</th><th>Base KB</th><th>Growth</th><th>Bone</th><th>Offset x/y/z</th></tr></thead><tbody>{hitboxes.map(h => <tr key={h.id}><td>{h.id}</td><td>{h.damage}</td><td>{h.angle}°</td><td>{num(h.size, 4)}</td><td>{h.baseKnockback}</td><td>{h.growth}</td><td>{h.bone}</td><td>{num(h.offset.x, 4)} / {num(h.offset.y, 4)} / {num(h.offset.z, 4)}</td></tr>)}</tbody></table></div>
    <p className="fx-fine">Decoded parameters only. Offsets are relative to the original skeleton's bone transforms, so they are not placed on the replacement model and nothing here is a live collision.</p>
    <ol className="fx-events">{action.events.map((e, i) => <li key={i}><span>{e.name}</span><code>{e.hex}</code></li>)}</ol></details></Panel>;
}
function Source({ info }: { info: ModelInfo | null }) {
  const { source } = foxData;
  return <Panel className="fx-panel"><details><summary><span className="kp-eyebrow">Source and limits</span><span>Revision not independently verified</span></summary>
    <dl className="fx-source"><div><dt>Parameter dump</dt><dd><a href={source.url} rel="noreferrer">{source.url}</a></dd></div><div><dt>SHA-256</dt><dd><code>{source.sha256}</code></dd></div><div><dt>Archive</dt><dd>{source.archive}</dd></div><div><dt>Decompilation commit</dt><dd><code>{source.decompCommit}</code></dd></div><div><dt>Revision</dt><dd>{source.revisionVerified ? 'Verified' : 'Not independently verified'}</dd></div>
      <div><dt>Action scripts</dt><dd>{foxData.actions.length} preserved as raw commands. None execute in this viewer, and the combat port is unfinished.</dd></div>
      <div><dt>Attributes</dt><dd>{Object.keys(foxAttributes).length} common attributes mapped by offset. Additional parameter data is still needed and is not in this build.</dd></div>
      <div><dt>Model</dt><dd>Newly authored replacement, not extracted geometry.{info ? ` ${info.triangles.toLocaleString()} triangles · ${info.bones} bones · ${info.materials} materials.` : ''}</dd></div>
      <div><dt>Poses</dt><dd>Idle, Run and Airborne are authored presentation previews on the replacement rig, not recovered animation data. Original animation timing has not been ported.</dd></div></dl></details></Panel>;
}
function App() {
  const reduced = useReducedMotion(), [pose, setPose] = useState<PoseId>('idle'), [turntable, setTurntable] = useState(false), [resetSignal, setResetSignal] = useState(0), [info, setInfo] = useState<ModelInfo | null>(null);
  const note = POSES.find(p => p.id === pose)?.note;
  return <main className="fx-shell">
    <header className="fx-header"><div><p className="kp-eyebrow">Melee fidelity lab · reference viewer</p><h1 className="kp-title">Fox</h1></div><p className="fx-status" aria-label="Status"><span>Original parameter data</span><span>Replacement model</span><span>Combat port in progress</span></p></header>
    <section className="fx-hero" aria-label="Model viewer">
      <Viewer pose={pose} turntable={turntable} reduced={reduced} onInfo={setInfo} resetSignal={resetSignal}/>
      <div className="fx-stage-controls">
        <div className="fx-poses" role="group" aria-label="Presentation preview pose"><p className="kp-eyebrow">Presentation preview</p><div className="fx-pose-buttons">{POSES.map(p => <ArcadeButton key={p.id} size="sm" tone={pose === p.id ? 'sun' : 'ghost'} aria-pressed={pose === p.id} onClick={() => setPose(p.id)}>{p.label}</ArcadeButton>)}</div><p className="fx-fine">{note} Authored for review, not recovered animation.</p></div>
        <div className="fx-view-buttons" role="group" aria-label="Camera"><ArcadeButton size="sm" tone="sky" onClick={() => setResetSignal(v => v + 1)}>Reset view</ArcadeButton><ArcadeButton size="sm" tone={turntable ? 'lime' : 'ghost'} aria-pressed={turntable} disabled={reduced} title={reduced ? 'Off while reduced motion is on' : undefined} onClick={() => setTurntable(v => !v)}>Turntable</ArcadeButton></div>
      </div>
    </section>
    <aside className="fx-panels"><Stats/><Probe reduced={reduced}/><Attack11/><Source info={info}/></aside>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
