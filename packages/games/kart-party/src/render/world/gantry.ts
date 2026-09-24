/* Start/finish gantry over the line (props.glb `start_gantry` scaled to the course, or a primitive
 * truss with a banner) plus a light panel that runs the countdown: red, red, red, then all green. */
import * as THREE from 'three';
import { sampleAt, type Track } from '../../sim/track';
import type { RaceView } from '../../sim/types';
import type { TextureKit } from './textures';
import { RAINBOW_GLSL } from './space-sky';
import type { ThemeStyle } from './theme';

export type Gantry = { group: THREE.Group; update(race: RaceView, time: number): void };

export function buildGantry(track: Track, theme: ThemeStyle, kit: TextureKit, clone: (name: string) => THREE.Object3D | null): Gantry {
  const group = new THREE.Group(); group.name = 'gantry';
  const s = sampleAt(track, 0), span = 2 * s.halfWidth + Math.min(s.runoffL, s.runoffR) * 2 + 1.6;
  group.position.set(s.x, s.y, s.z); group.rotation.y = s.heading;
  let beamY = 6.4, panelW = 5.2, panelZ = -0.3, arch: THREE.ShaderMaterial | null = null;
  const model = theme.space ? null : clone('start_gantry');
  if (theme.space) ({ beamY, arch } = lightArch(group, span, kit));
  else if (model) {
    const box = new THREE.Box3().setFromObject(model), w = Math.max(1, box.max.x - box.min.x), k = span / w;
    model.scale.multiplyScalar(k); model.updateMatrixWorld(true);
    beamY = box.max.y * k - 1.2;
    // The model's static lamp bar becomes the live countdown panel.
    const lamps = new THREE.Box3(), part = new THREE.Box3();
    model.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      if ((Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(m => /lamp|light/i.test(m.name))) { lamps.union(part.setFromObject(mesh)); mesh.visible = false; }
    });
    if (!lamps.isEmpty()) { beamY = (lamps.min.y + lamps.max.y) / 2 + 0.65; panelW = Math.max(3, lamps.max.x - lamps.min.x + 0.6); panelZ = lamps.min.z + 0.05; }
    group.add(model);
  } else {
    const truss = new THREE.MeshStandardMaterial({ color: theme.night ? 0x3a3f58 : 0xe8e8ee, metalness: 0.5, roughness: 0.35 });
    const banner = new THREE.MeshStandardMaterial({ map: kit.banner('KART PARTY', theme.night ? '#2a1a66' : '#ff4f5a', '#ffffff'), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: theme.night ? 0.55 : 0.08, side: THREE.DoubleSide });
    const cap = new THREE.MeshStandardMaterial({ map: kit.checker(2, 8), roughness: 0.5 });
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 7.6, 1.1), [truss, truss, truss, truss, cap, cap]); leg.position.set(side * span / 2, 3.8, 0); leg.castShadow = true; group.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 1.8), truss); foot.position.set(side * span / 2, 0.2, 0); group.add(foot);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.2, 1.9, 0.9), truss); beam.position.y = 7; beam.castShadow = true; group.add(beam);
    for (const z of [-0.47, 0.47]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(span + 0.6, 1.7), banner); b.position.set(0, 7, z); if (z < 0) b.rotation.y = Math.PI; group.add(b); }
    beamY = 6.05;
  }
  // Countdown light panel facing the grid (karts approach from −Z).
  const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, 1.3, 0.4), new THREE.MeshStandardMaterial({ color: 0x15161e, roughness: 0.5 }));
  panel.position.set(0, beamY - 0.65, panelZ); group.add(panel);
  const lamps: THREE.MeshBasicMaterial[] = [], gap = Math.min(1.25, (panelW - 0.6) / 4);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false }); lamps.push(m);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(Math.min(0.44, gap * 0.4), 20), m); disc.position.set((i - 1.5) * gap, beamY - 0.65, panelZ - 0.22); disc.rotation.y = Math.PI; group.add(disc);
  }
  group.traverse(o => { o.matrixAutoUpdate = true; });
  const off = new THREE.Color(0.04, 0.04, 0.05), red = new THREE.Color(1, 0.06, 0.04), green = new THREE.Color(0.15, 1, 0.25), amber = new THREE.Color(1, 0.55, 0.05);
  return {
    group,
    update(race, time) {
      const t = race.time;
      if (arch) arch.uniforms.uTime.value = time;
      for (let i = 0; i < 4; i++) {
        let c = off;
        if (race.phase === 'countdown') c = t >= -3 + i && i < 3 ? red : t < -3 && Math.sin(time * 6) > 0 && i === 3 ? amber : off;
        else if (t < 2.5) c = green;
        lamps[i].color.copy(c);
      }
    },
  };
}

/** Rainbow Road start: a rainbow arch of light on two glowing pylons, with a hovering sign. */
function lightArch(group: THREE.Group, span: number, kit: TextureKit) {
  const R = span / 2, squash = 0.62;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; ${RAINBOW_GLSL}
      void main() { float pulse = pow(0.5 + 0.5 * sin(vUv.x * 40.0 - uTime * 5.0), 6.0);
        gl_FragColor = vec4(rainbow(vUv.x) * (0.75 + 1.4 * pulse), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const outer = new THREE.Mesh(new THREE.TorusGeometry(R, 0.42, 12, 96, Math.PI), mat); outer.scale.y = squash;
  const inner = new THREE.Mesh(new THREE.TorusGeometry(R - 1.1, 0.14, 8, 96, Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.8, 2.4) })); inner.scale.y = squash;
  group.add(outer, inner);
  const pylon = new THREE.MeshStandardMaterial({ color: 0x1c1238, metalness: 0.7, roughness: 0.25, emissive: 0x5a2bff, emissiveIntensity: 0.9 });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 1.6, 16), pylon); p.position.set(side * R, 0.8, 0); group.add(p);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2, 2.6) })); orb.position.set(side * R, 1.9, 0); group.add(orb);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.3), new THREE.MeshBasicMaterial({ map: kit.banner('RAINBOW ROAD', '#12072a', '#ffffff'), color: new THREE.Color(1.4, 1.3, 1.6), side: THREE.DoubleSide }));
  sign.position.set(0, R * squash + 1.35, 0); sign.rotation.y = Math.PI; group.add(sign);
  return { beamY: R * squash - 0.7, arch: mat };
}
