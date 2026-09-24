/**
 * Projectile visuals by engine kind (src/sim and src/specials shot kinds), with a glowing orb fallback per HitEffect.
 * Meshes are pooled per kind; geometries and materials are shared across every projectile of that kind.
 */
import { AdditiveBlending, BoxGeometry, CapsuleGeometry, Color, ConeGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, ShaderMaterial, Shape, ShapeGeometry, TorusGeometry, type BufferGeometry, type Material, type Object3D } from 'three';
import type { HitEffect, ProjectileView } from '../../model';
import type { Particles } from './particles';

export const EFFECT_COLOR: Record<HitEffect, [number, number, number]> = {
  normal: [1, .82, .4], fire: [1, .42, .08], electric: [.55, .82, 1], slash: [.8, .95, 1], coin: [1, .8, .18], ice: [.6, .88, 1], sleep: [1, .66, .9],
  grass: [.45, .9, .3], darkness: [.62, .2, .9], water: [.3, .6, 1], star: [1, .9, .35], psychic: [1, .42, .92], magic: [.75, .55, 1],
};
type Visual = { kind: string; generic: boolean; root: Object3D; min: number; spin: number; orient: boolean; stretch: number; pulse: number; trail: ((p: ProjectileView, fx: Emit, t: number) => void) | null };
export type Emit = { add: Particles; norm: Particles; rand: () => number; reduced: boolean };

/** Additive sphere that is brightest where it faces the camera and fades to nothing at the silhouette: a soft halo. */
const HALO_VERT = `varying float vF; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = max(0.0, dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`;
const HALO_FRAG = `uniform vec3 uColor; varying float vF; void main() { float a = pow(vF, 2.2); gl_FragColor = vec4(uColor * a * 1.3, a); }`;

function starShape() {
  const s = new Shape();
  for (let i = 0; i <= 10; i++) { const r = i % 2 ? .45 : 1, a = Math.PI / 2 + i * Math.PI / 5; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  return new ShapeGeometry(s);
}

export class ProjectileArt {
  private live = new Map<number, Visual>();
  private pool = new Map<string, Visual[]>();
  private geos: Record<string, BufferGeometry> = {
    orb: new IcosahedronGeometry(1, 2), capsule: new CapsuleGeometry(.5, 1, 4, 10).rotateZ(Math.PI / 2), box: new BoxGeometry(1, 1, 1), cone: new ConeGeometry(.5, 1, 10).rotateZ(-Math.PI / 2),
    arc: new TorusGeometry(.7, .16, 6, 20, Math.PI * 1.2), ring: new TorusGeometry(1, .1, 6, 32), star: starShape(), shaft: new BoxGeometry(1, .06, .06),
  };
  private mats = new Map<string, Material>();
  constructor(private parent: Object3D) {}

  private mat(key: string, make: () => Material) { let m = this.mats.get(key); if (!m) this.mats.set(key, m = make()); return m; }
  private glow(c: [number, number, number] | string, opacity = 1) { const k = `g${c}${opacity}`; return this.mat(k, () => new MeshBasicMaterial({ color: typeof c === 'string' ? c : new Color(...c), transparent: true, opacity, blending: AdditiveBlending, depthWrite: false })); }
  private halo(c: [number, number, number]) { return this.mat(`h${c}`, () => new ShaderMaterial({ vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, uniforms: { uColor: { value: new Color(...c) } }, transparent: true, blending: AdditiveBlending, depthWrite: false })); }
  private solid(c: string) { return this.mat(`s${c}`, () => new MeshLambertMaterial({ color: c, emissive: new Color(c).multiplyScalar(.25) })); }
  private mesh(geo: string, mat: Material, sx = 1, sy = sx, sz = sx, x = 0) { const m = new Mesh(this.geos[geo], mat); m.scale.set(sx, sy, sz); m.position.x = x; return m; }

  /** A pooled visual for an engine projectile kind; unknown kinds get a glowing orb in their effect color (generic). */
  build(kind: string, effect: HitEffect): Visual {
    const c = EFFECT_COLOR[effect] ?? EFFECT_COLOR.normal, g = new Group();
    const v: Visual = { kind, generic: false, root: g, min: .12, spin: 0, orient: false, stretch: 0, pulse: 0, trail: null };
    const orb = (col: [number, number, number], core = true) => { g.add(this.mesh('orb', this.halo(col), 1.7), this.mesh('orb', this.glow(col, .9), .82)); if (core) g.add(this.mesh('orb', this.glow([1, 1, .9]), .5)); v.pulse = 1; };
    const embers = (col: [number, number, number], n = 1, size = .5) => (p: ProjectileView, fx: Emit) => {
      for (let i = 0; i < n; i++) fx.add.spawn({ x: p.x + (fx.rand() - .5) * p.r, y: p.y + (fx.rand() - .5) * p.r, vx: -p.vx * 10 + (fx.rand() - .5), vy: -p.vy * 10 + fx.rand() * .8, life: .28, size: p.r * size * 2, grow: -.6, color: col, shape: 'glow', drag: 3 });
    };
    switch (kind) {
      case 'fireball': case 'dins-fire': case 'pk-fire': orb([1, .45, .1]); v.trail = embers([1, .5, .12], 2); break;
      case 'flame': orb([1, .4, .08], false); v.trail = embers([1, .55, .15], 4, .9); break;
      case 'pill': v.min = 0.28; g.add(this.mesh('capsule', this.solid('#f4f4f4'), .9, .9, .9, -.22), this.mesh('capsule', this.solid('#e53a4a'), .9, .9, .9, .22)); v.spin = 14; break;
      case 'laser': v.min = 0.1; g.add(this.mesh('capsule', this.glow([1, .25, .3]), 1, .16, .16), this.mesh('capsule', this.glow([1, .9, .9]), .9, .06, .06)); v.orient = true; v.stretch = 6; break;
      case 'thunder-jolt': orb([1, .9, .3]); v.trail = (p, fx) => fx.add.spawn({ x: p.x + (fx.rand() - .5) * p.r * 2, y: p.y + (fx.rand() - .5) * p.r * 2, life: .12, size: p.r * .9, color: [1, 1, .6], shape: 'spark', angle: fx.rand() * 6 }); break;
      case 'thunder': g.add(this.mesh('box', this.glow([1, .95, .5]), .35, 6, .1), this.mesh('box', this.glow([1, 1, 1]), .12, 6, .05)); v.pulse = 3; v.trail = (p, fx) => fx.add.spawn({ x: p.x + (fx.rand() - .5) * .6, y: p.y + (fx.rand() - .5) * 4, life: .1, size: .35, color: [1, 1, .7], shape: 'spark', angle: fx.rand() * 6 }); break;
      case 'charge-shot': orb([1, .75, .25]); v.trail = (p, fx) => { const a = fx.rand() * 6.28; fx.add.spawn({ x: p.x + Math.cos(a) * p.r * 1.4, y: p.y + Math.sin(a) * p.r * 1.4, vx: -Math.cos(a) * p.r * 4, vy: -Math.sin(a) * p.r * 4, life: .2, size: p.r * .5, color: [1, .9, .5], shape: 'spark' }); }; break;
      case 'shadow-ball': g.add(this.mesh('orb', this.solid('#24102f'), .9), this.mesh('orb', this.glow([.6, .2, .9], .7), 1.3)); v.pulse = 1; v.trail = (p, fx) => fx.add.spawn({ x: p.x + (fx.rand() - .5) * p.r * 2, y: p.y + (fx.rand() - .5) * p.r * 2, life: .15, size: p.r * .7, color: [.7, .4, 1], shape: 'spark', angle: fx.rand() * 6 }); break;
      case 'pk-flash': orb([.4, 1, .45]); v.pulse = 2; v.trail = embers([.5, 1, .55], 1, .35); break;
      case 'arrow': case 'fire-arrow': v.min = 0.6; g.add(this.mesh('shaft', this.solid('#c9a46a'), .9, 1.6, 1.6), this.mesh('cone', this.solid('#d8dde6'), .2, .12, .12, .5), this.mesh('box', this.solid('#e8e2d4'), .12, .14, .02, -.42)); v.orient = true; if (kind === 'fire-arrow') v.trail = embers([1, .5, .1], 2, .4); break;
      case 'needle': v.min = 0.45; g.add(this.mesh('shaft', this.solid('#e8eef8'), .5, .5, .5), this.mesh('shaft', this.glow([.8, .9, 1], .6), .6, 1, 1)); v.orient = true; break;
      case 'boomerang': v.min = 0.38; g.add(this.mesh('arc', this.solid('#b0763a'), .8, .8, .8)); v.spin = 22; break;
      case 'bomb': v.min = 0.26; g.add(this.mesh('orb', this.solid('#2c3040'), 1), this.mesh('cone', this.solid('#c9b37a'), .25, .12, .12, .9)); v.trail = (p, fx) => fx.add.spawn({ x: p.x + p.r * .9, y: p.y + p.r * .9, vy: .8, life: .15, size: p.r * .6, color: [1, .7, .2], shape: 'spark', angle: fx.rand() * 6 }); break;
      case 'missile': v.min = 0.32; g.add(this.mesh('capsule', this.solid('#9aa3ad'), 1.4, .5, .5), this.mesh('cone', this.solid('#d7473e'), .45, .5, .5, .9)); v.orient = true;
        v.trail = (p, fx) => fx.norm.spawn({ x: p.x - Math.sign(p.vx || 1) * p.r, y: p.y, vy: .4, life: .5, size: p.r * .9, grow: 1.4, color: [.75, .75, .78], alpha: .6, shape: 'puff' }); break;
      case 'egg': v.min = 0.26; g.add(this.mesh('orb', this.solid('#fbfaf2'), .85, 1.05, .85)); v.spin = 6; break;
      case 'turnip': v.min = 0.28; g.add(this.mesh('orb', this.solid('#f4f1ea'), 1, .9, 1), this.mesh('cone', this.solid('#4fae4a'), .9, .7, .7, 1.25)); g.rotation.z = Math.PI / 2; v.spin = 8; break;
      case 'sausage': v.min = 0.28; g.add(this.mesh('capsule', this.solid('#141414'), 1.2, .6, .6)); v.spin = 10; break;
      case 'ice': v.min = 0.3; g.add(this.mesh('box', this.mat('ice', () => new MeshLambertMaterial({ color: '#bfe8ff', transparent: true, opacity: .8, emissive: new Color('#4aa8e0') })), 1.4)); v.spin = 7; break;
      case 'blizzard': orb([.7, .9, 1], false); v.trail = (p, fx) => fx.add.spawn({ x: p.x, y: p.y, vx: p.vx * 20 + (fx.rand() - .5), vy: (fx.rand() - .5), life: .4, size: .12, color: [.85, .95, 1], shape: 'glow', drag: 2 }); break;
      case 'star': v.min = 0.3; g.add(this.mesh('star', this.glow([1, .9, .35]), 1.3), this.mesh('star', this.glow([1, 1, .85]), .6)); v.spin = 12; v.trail = embers([1, .9, .4], 1, .4); break;
      case 'pk-thunder': orb([.7, .85, 1]); v.pulse = 3; v.trail = (p, fx) => { embers([.55, .75, 1], 2, .5)(p, fx); fx.add.spawn({ x: p.x + (fx.rand() - .5) * p.r * 2, y: p.y + (fx.rand() - .5) * p.r * 2, life: .1, size: p.r * .8, color: [1, 1, .7], shape: 'spark', angle: fx.rand() * 6 }); }; break;
      case 'spark-shot': orb([.55, .82, 1]); v.trail = (p, fx) => fx.add.spawn({ x: p.x + (fx.rand() - .5) * p.r * 2, y: p.y + (fx.rand() - .5) * p.r * 2, life: .1, size: p.r * .7, color: [.8, .95, 1], shape: 'spark', angle: fx.rand() * 6 }); break;
      case 'finger-bullet': v.min = 0.14; g.add(this.mesh('capsule', this.glow([1, .95, .8]), 1, .45, .45), this.mesh('orb', this.halo([1, .8, .4]), .9)); v.orient = true; v.stretch = 2.2; break;
      case 'energy-orb': orb([.75, .55, 1]); v.pulse = 2; g.add(this.mesh('ring', this.glow([.9, .8, 1], .6), 1.2)); v.spin = 9; v.trail = embers([.7, .5, 1], 1, .35); break;
      case 'sand': v.min = 0.2; g.add(this.mesh('orb', this.mat('sand', () => new MeshLambertMaterial({ color: '#d9c08a', transparent: true, opacity: .7 })), 1, .8, 1)); v.trail = (p, fx) => fx.norm.spawn({ x: p.x, y: p.y, vx: p.vx * 8, vy: (fx.rand() - .3) * .6, life: .35, size: p.r * .8, grow: 1.2, color: [.85, .75, .55], alpha: .5, shape: 'puff' }); break;
      case 'explosion': g.add(this.mesh('orb', this.halo([1, .55, .15]), 1.25), this.mesh('orb', this.glow([1, .75, .3], .85), .9), this.mesh('orb', this.glow([1, 1, .85]), .5)); v.pulse = 4; v.trail = embers([1, .5, .1], 3, .6); break;
      case 'wave': case 'disable': { const col = EFFECT_COLOR[kind === 'disable' ? 'psychic' : effect] ?? c; g.add(this.mesh('ring', this.glow(col), 1), this.mesh('orb', this.halo(col), 1.1)); v.pulse = 2; break; }
      default: orb(c); v.trail = embers(c, 1, .4); v.generic = true;
    }
    this.parent.add(g);
    return v;
  }

  /** Sync visuals to this frame's projectiles (ids persist across snapshots). */
  update(list: readonly ProjectileView[], seconds: number, fx: Emit) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.live.get(p.id);
      if (!v) { const key = `${p.kind}|${p.effect}`; v = this.pool.get(key)?.pop() ?? this.build(p.kind, p.effect); v.kind = key; v.root.visible = true; this.live.set(p.id, v); }
      const r = Math.max(v.min, p.r), g = v.root;
      g.position.set(p.x, p.y, .1);
      g.scale.setScalar(r * (1 + (v.pulse ? .12 * Math.sin(seconds * 18 * v.pulse + p.id) : 0)));
      if (v.orient) { g.rotation.set(0, 0, Math.atan2(p.vy, p.vx)); if (v.stretch) g.scale.x = r * v.stretch; }
      else if (v.spin) g.rotation.z = -seconds * v.spin * Math.sign(p.vx || 1);
      if (v.trail && (!fx.reduced || (p.id + Math.floor(seconds * 60)) % 2 === 0)) v.trail(p, fx, seconds);
    }
    for (const [id, v] of this.live) if (!seen.has(id)) { v.root.visible = false; this.live.delete(id); (this.pool.get(v.kind) ?? this.pool.set(v.kind, []).get(v.kind)!).push(v); }
  }
  get count() { return this.live.size; }
  dispose() {
    for (const v of [...this.live.values(), ...[...this.pool.values()].flat()]) v.root.removeFromParent();
    this.live.clear(); this.pool.clear();
    for (const g of Object.values(this.geos)) g.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
