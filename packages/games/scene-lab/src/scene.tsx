import { useEffect, useRef, useState } from 'react';
import { Scene, Color, PerspectiveCamera, HemisphereLight, DirectionalLight, Mesh, BoxGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial, CanvasTexture, SpriteMaterial, Sprite } from 'three';
import type { SceneViewProps } from '../../../party-ui/src/index';
import { ResourceScope, SnapshotBuffer } from '../../../party-runtime/src/index';
import { mountThreeScene, type SceneMetrics, type Quality } from '../../../party-3d/src/index';
import { ARENA, interpolate, type Settings, type View } from './model';
export default function Arena(props: SceneViewProps<Settings, View>) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(props), buffer = useRef(new SnapshotBuffer<View>());
  latest.current = props;
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null), [quality] = useState<Quality>(() => localStorage.getItem('party.sceneQuality') === 'low' ? 'low' : 'balanced');
  useEffect(() => { if (props.publicView && props.snapshotTime !== null) buffer.current.push(props.snapshotTime, props.publicView); }, [props.publicView, props.snapshotTime]);
  useEffect(() => {
    const scope = new ResourceScope(props.signal), scene = new Scene(); scene.background = new Color('#d9f0ef');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const camera = new PerspectiveCamera(42, 1, .1, 100); camera.position.set(0, 18, 13); camera.lookAt(0, 0, 0);
    scene.add(new HemisphereLight('#ffffff', '#7088a3', 2.6)); const light = new DirectionalLight('#fff6d5', 3); light.position.set(-5, 12, 5); scene.add(light);
    const material = (color: string) => scope.own(new MeshStandardMaterial({ color, roughness: .55 }));
    const box = scope.own(new BoxGeometry(1, 1, 1));
    function block(x: number, y: number, z: number, w: number, h: number, d: number, color: string) { const mesh = new Mesh(box, material(color)); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); scene.add(mesh); return mesh; }
    block(0, -.35, 0, 16.8, .7, 10.8, '#345780'); block(0, .01, 0, 16, .08, 10, '#effbf2');
    for (const x of [-8.2, 8.2]) block(x, .35, 0, .3, .7, 10.6, '#32bdd1');
    for (const z of [-5.2, 5.2]) block(0, .35, z, 16.6, .7, .3, '#32bdd1');
    const pillar = new Mesh(scope.own(new CylinderGeometry(ARENA.pillarRadius, ARENA.pillarRadius, 1.4, 32)), material('#bca6ef')); pillar.position.y = .7; scene.add(pillar);
    const puck = scope.own(new CylinderGeometry(ARENA.radius, ARENA.radius * 1.12, .45, 24));
    const players = props.players.map((player, index) => {
      const mesh = new Mesh(puck, material(player.color)); scene.add(mesh);
      const label = document.createElement('canvas'); label.width = 128; label.height = 64; const context = label.getContext('2d')!;
      context.fillStyle = '#132941'; context.beginPath(); context.roundRect(8, 3, 112, 58, 24); context.fill(); context.font = 'bold 38px sans-serif'; context.fillStyle = '#ffffff'; context.textAlign = 'center'; context.fillText(String(index + 1), 64, 47);
      const texture = scope.own(new CanvasTexture(label)), badge = new Sprite(scope.own(new SpriteMaterial({ map: texture, depthTest: false }))); badge.scale.set(.85, .43, 1); mesh.add(badge); badge.position.y = .75;
      const angle = index / props.players.length * Math.PI * 2; mesh.position.set(Math.cos(angle) * 6, .35, Math.sin(angle) * 3.6); return { id: player.id, mesh };
    });
    const starGeometry = scope.own(new IcosahedronGeometry(.28, 0)), starMaterial = material('#f9b918');
    const stars = Array.from({ length: 8 }, () => { const mesh = new Mesh(starGeometry, starMaterial); mesh.visible = false; scene.add(mesh); return mesh; });
    scope.defer(() => { scene.clear(); buffer.current.clear(); });
    mountThreeScene(canvas.current!, { signal: scope.signal, scene, camera, quality,
      resize(aspect) { camera.aspect = aspect; const distance = Math.max(1, 1.6 / aspect); camera.position.set(0, 18 * distance, 13 * distance); camera.updateProjectionMatrix(); },
      frame(now) { const view = buffer.current.sample(latest.current.serverNowMs(), interpolate); if (!view) return; for (const item of players) { const player = view.players.find(p => p.id === item.id); if (player) item.mesh.position.set(player.x, .35, player.z); } stars.forEach((mesh, index) => { const star = view.stars[index]; mesh.visible = !!star; if (star) mesh.position.set(star.x, .5, star.z); mesh.rotation.y = reducedMotion.matches ? 0 : now / 1200; }); },
      onReady: () => latest.current.onReady(), onError: error => latest.current.onError(error), onMetrics: setMetrics,
    });
    return scope.dispose;
  }, [props.roundId, props.signal, quality]);
  return <><canvas ref={canvas} aria-label="3D collection arena"/><details className="sl-metrics"><summary>Scene diagnostics · {quality}</summary><pre data-testid="scene-metrics">{metrics ? JSON.stringify(metrics, null, 2) : 'Warming up…'}</pre></details></>;
}
