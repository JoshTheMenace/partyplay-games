/* Transient world effects, all derived statelessly from snapshot timestamps: noise rings, EMP and alarm pulses,
 * shot tracers and smoke clouds. Pools are fixed; nothing is created per frame. */
import { AdditiveBlending, BoxGeometry, CanvasTexture, Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Quaternion, RingGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { ResourceScope } from '../../../../party-runtime/src/index';
import type { Noise, Shot, View } from '../model';

const RINGS = 28, TRACERS = 24, PUFFS = 12, CLOUDS = 6;
const NOISE: Record<Noise['kind'], [colour: string, ms: number, width: number]> = { step: ['#d8ecff', 650, .5], loud: ['#ffae4a', 1000, 1], decoy: ['#c49cff', 1100, .9], scream: ['#ff7ab8', 1000, .9], alarm: ['#ff3b3b', 1200, 1] };
const SHOT: Record<Shot['kind'], string> = { guard: '#ff5a3a', tranq: '#8dffa8', shotgun: '#ffd27a' };
const dummy = new Object3D(), spin = new Quaternion(), AXIS = new Vector3(0, 0, 1);

/** Soft, lumpy smoke puff: a few overlapping radial blobs. */
function puffTexture() {
  const canvas = document.createElement('canvas'), s = 128; canvas.width = canvas.height = s;
  const g = canvas.getContext('2d')!;
  for (const [x, y, r] of [[.5, .5, .46], [.36, .42, .3], [.64, .44, .28], [.5, .64, .3]]) {
    const grad = g.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s); grad.addColorStop(0, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grad; g.fillRect(0, 0, s, s);
  }
  const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace; return t;
}

export function createEffects(scope: ResourceScope) {
  const root = new Group(), ringGeo = [.9, .95, .98].map(inner => scope.own(new RingGeometry(inner, 1, 64).rotateX(-Math.PI / 2))), barGeo = scope.own(new BoxGeometry(1, .05, .05).translate(.5, 0, 0));
  const additive = (colour = '#ffffff') => scope.own(new MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  const rings = Array.from({ length: RINGS }, () => { const m = new Mesh(ringGeo[0], additive()); m.visible = false; m.renderOrder = 3; root.add(m); return m; });
  const tracers = Array.from({ length: TRACERS }, () => { const m = new Mesh(barGeo, additive()); m.visible = false; m.renderOrder = 3; root.add(m); return m; });
  // Smoke: soft camera-facing puffs. Drawn before thieves (actors.ts renderOrder 4), so a thief inside stays visible.
  const puffs = new InstancedMesh(scope.own(new PlaneGeometry(1, 1)), scope.own(new MeshBasicMaterial({ map: scope.own(puffTexture()), color: '#d6d0e6', transparent: true, depthWrite: false })), CLOUDS * PUFFS);
  puffs.frustumCulled = false; puffs.count = 0; puffs.renderOrder = 1; root.add(puffs);
  const tint = new Color();
  let ring = 0, tracer = 0, shakeSeen = 0, trauma = 0;
  const pulse = (x: number, y: number, radius: number, age: number, ms: number, colour: string, width = 1) => {
    if (age < 0 || age > ms || ring >= RINGS) return;
    const k = age / ms, m = rings[ring++], r = .3 + (radius - .3) * (1 - (1 - k) ** 3);
    m.visible = true; m.position.set(x, .06, y); m.scale.set(r, 1, r); m.geometry = ringGeo[radius > 7 ? 2 : radius > 2.6 ? 1 : 0];
    const mat = m.material as MeshBasicMaterial; mat.color.set(colour); mat.opacity = (1 - k) ** 1.5 * width * (radius > 7 ? .7 : 1);
  };
  const bar = (x0: number, z0: number, x1: number, z1: number, y: number, colour: string, alpha: number, thick = 1) => {
    if (tracer >= TRACERS) return;
    const m = tracers[tracer++], dx = x1 - x0, dz = z1 - z0; m.visible = true;
    m.position.set(x0, y, z0); m.rotation.set(0, -Math.atan2(dz, dx), 0); m.scale.set(Math.hypot(dx, dz), thick, thick);
    const mat = m.material as MeshBasicMaterial; mat.color.set(colour); mat.opacity = alpha;
  };

  return {
    root,
    /** Returns camera shake (tiles) for loud events since the last call. */
    sync(view: View | null, now: number, t: number, dt: number, reduced: boolean, facing: Quaternion) {
      ring = 0; tracer = 0;
      if (view) {
        for (const n of view.noises) { const [c, ms, w] = NOISE[n.kind]; pulse(n.x, n.y, n.radius, now - n.at, ms, c, w); if (n.kind === 'loud' && n.at > shakeSeen && now - n.at < 400) { shakeSeen = n.at; trauma = Math.min(1, trauma + .6); } }
        for (const e of view.effects) {
          const age = now - e.at;
          if (e.kind === 'emp') { pulse(e.x, e.y, 10, age, 900, '#6fe8ff'); pulse(e.x, e.y, 7, age - 150, 900, '#b8f4ff', .6); }
          else if (e.kind === 'break' || e.kind === 'hurt' || e.kind === 'down') { if (e.at > shakeSeen && age < 400) { shakeSeen = e.at; trauma = Math.min(1, trauma + (e.kind === 'break' ? .5 : .35)); } }
          else if (e.kind === 'spotted') pulse(e.x, e.y, 1.6, age, 500, '#ff4a3a', .8);
          else if (e.kind === 'unlock' || e.kind === 'hack') pulse(e.x, e.y, 1.4, age, 600, e.kind === 'hack' ? '#7df3ff' : '#ffd36b', .7);
          else if (e.kind === 'rescue' || e.kind === 'heal') pulse(e.x, e.y, 2.5, age, 800, '#7dffb0', .8);
        }
        for (const s of view.shots) {
          const age = now - s.at, ms = s.kind === 'shotgun' ? 320 : 260; if (age < 0 || age > ms) continue;
          const a = 1 - age / ms, y = .7;
          if (s.kind === 'shotgun') {
            const base = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x);
            for (let i = -2; i <= 2; i++) { const d = base + i * Math.PI / 14, r = 4.5 * (.8 + .2 * Math.cos(i * 2.1)); bar(s.from.x, s.from.y, s.from.x + Math.cos(d) * r, s.from.y + Math.sin(d) * r, y, SHOT.shotgun, a * .9, 1.4); }
            if (s.at > shakeSeen && age < 200) { shakeSeen = s.at; trauma = Math.min(1, trauma + .7); }
          } else bar(s.from.x, s.from.y, s.to.x, s.to.y, y, SHOT[s.kind], a, s.kind === 'guard' ? 1.6 : 1);
          if (s.hit) pulse(s.to.x, s.to.y, .9, age, 300, SHOT[s.kind], .8);
        }
        if (view.alarm && view.alarm.until > now) { const beat = (now % 1100); pulse(view.alarm.x, view.alarm.y, 3.2, beat, 1100, '#ff3b3b'); pulse(view.alarm.x, view.alarm.y, 3.2, (beat + 550) % 1100, 1100, '#ff6b5b', .6); }
        // Smoke: puffs swell in, churn slowly and shrink away.
        let p = 0;
        for (const s of view.smoke) {
          if (s.until <= now || p >= CLOUDS * PUFFS) continue;
          const grow = Math.min(1, (now - s.born) / 450), fade = Math.min(1, (s.until - now) / 1200), life = (1 - (1 - grow) ** 3) * fade;
          for (let i = 0; i < PUFFS && p < CLOUDS * PUFFS; i++, p++) {
            const a = i * 2.39996 + s.born * .001, d = s.radius * (i === 0 ? 0 : .35 + .5 * ((i * 7) % 5) / 4), drift = reduced ? 0 : Math.sin(t * .7 + i) * .12;
            const size = s.radius * (1.1 + .45 * ((i * 3) % 4) / 3) * life;
            dummy.position.set(s.x + Math.cos(a) * d + drift, .35 + ((i * 5) % 3) * .28 + (reduced ? 0 : Math.sin(t * 1.3 + i * 1.7) * .06), s.y + Math.sin(a) * d * .9);
            dummy.quaternion.copy(facing).multiply(spin.setFromAxisAngle(AXIS, i * 1.3 + (reduced ? 0 : t * (i % 2 ? .25 : -.2)))); dummy.scale.set(size, size, 1); dummy.updateMatrix(); puffs.setMatrixAt(p, dummy.matrix);
            puffs.setColorAt(p, tint.setScalar(.82 + .18 * ((i * 11) % 7) / 6));
          }
        }
        puffs.count = p; puffs.instanceMatrix.needsUpdate = true; if (puffs.instanceColor) puffs.instanceColor.needsUpdate = true;
      }
      for (let i = ring; i < RINGS; i++) rings[i].visible = false;
      for (let i = tracer; i < TRACERS; i++) tracers[i].visible = false;
      trauma = Math.max(0, trauma - dt * 1.6);
      return reduced ? 0 : trauma * trauma * .35;
    },
  };
}
