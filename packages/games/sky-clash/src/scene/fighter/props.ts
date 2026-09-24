/**
 * Procedural hand-held props the fighter GLBs do not carry: Link's bow, nocked arrow, boomerang and bombs, Peach's turnip
 * and Toad, Ness's yo-yo, Game & Watch's Judge hammer, Oil Panic bucket and torch, Kirby's Final Cutter blade and the
 * Fox/Falco Shine. Each actor builds only its own fighter's items (a few draws, shown only by the moves that use them),
 * placed every frame from the solved hand bones in the actor group's space, so they work on every rig.
 */
import { AdditiveBlending, BoxGeometry, BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial,
  Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, RingGeometry, SphereGeometry, TorusGeometry, Vector3, type Material, type Texture } from 'three';
import type { FighterKind, LiveHit, MoveId } from '../../model';
import type { Rig } from './rig';

export type Item = 'bow' | 'boomerang' | 'bomb' | 'turnip' | 'toad' | 'yoyo' | 'hammer' | 'bucket' | 'torch' | 'cutter' | 'shine';
/**
 * hand holds the item (the bow's draw hand is the other one); hide retracts the GLB prop (Link's sword while he shoots);
 * show limits it to part of the move: 'wind' until the first active frame (thrown items become projectiles there),
 * with from as the fraction of the wind-up when it appears (pulled out).
 */
export type Held = { item: Item; hand: 'L' | 'R'; hide?: boolean; show?: 'wind'; from?: number };
const slots = (held: Held, ...moves: MoveId[]) => Object.fromEntries(moves.flatMap(m => [[m, held], [m + 'Air', held]])) as Partial<Record<MoveId, Held>>;
const HYLIAN = { ...slots({ item: 'bow', hand: 'L', hide: true }, 'nspecial'), ...slots({ item: 'boomerang', hand: 'R', show: 'wind' }, 'sspecial'), ...slots({ item: 'bomb', hand: 'R', show: 'wind', from: .3 }, 'dspecial') };
const SHINE = slots({ item: 'shine', hand: 'R' }, 'dspecial');
export const HELD: Partial<Record<FighterKind, Partial<Record<MoveId, Held>>>> = {
  link: HYLIAN, 'young-link': HYLIAN, fox: SHINE, falco: SHINE,
  peach: { ...slots({ item: 'turnip', hand: 'R', show: 'wind', from: .45 }, 'dspecial'), ...slots({ item: 'toad', hand: 'R' }, 'nspecial') },
  ness: { usmash: { item: 'yoyo', hand: 'R' }, dsmash: { item: 'yoyo', hand: 'R' } },
  'game-watch': { fsmash: { item: 'torch', hand: 'R', hide: true }, ...slots({ item: 'hammer', hand: 'R', hide: true }, 'sspecial'), ...slots({ item: 'bucket', hand: 'R', hide: true }, 'dspecial') },
  kirby: slots({ item: 'cutter', hand: 'R' }, 'uspecial'),
};
export const heldOf = (kind: FighterKind, move: MoveId | null) => move ? HELD[kind]?.[move] : undefined;

const LCD = '#1b1d1a';
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), v4 = new Vector3(), m1 = new Matrix4(), UP = new Vector3(0, 1, 0);
const along = (g: BufferGeometry, x0: number) => g.rotateZ(-Math.PI / 2).translate(x0, 0, 0); // cylinders/cones point +Y → +X

/** One actor's items. update() each frame after the rig solve; everything hides when no held item plays. */
export class HeldProps {
  readonly group = new Group();
  private items = new Map<Item, Group>();
  private owned: { dispose(): void }[] = [];
  private toon = new Map<string, MeshToonMaterial>();
  private arrow?: Group; private string?: Line; private yoyoString?: Line;

  constructor(kind: FighterKind, private gradient: Texture, private size: number) {
    this.group.name = 'held-props';
    const wanted = new Set(Object.values(HELD[kind] ?? {}).map(h => h!.item));
    for (const item of wanted) { const g = this.build(item); g.visible = false; this.items.set(item, g); this.group.add(g); }
  }

  private mat(color: string) { let m = this.toon.get(color); if (!m) { this.toon.set(color, m = this.own(new MeshToonMaterial({ color, gradientMap: this.gradient }))); } return m; }
  private own<T extends { dispose(): void }>(x: T): T { this.owned.push(x); return x; }
  private mesh(geo: BufferGeometry, mat: Material, at?: [number, number, number]) { const m = new Mesh(this.own(geo), mat); if (at) m.position.set(...at); m.renderOrder = 1; return m; }
  private line(color: string, points: number) {
    const geo = this.own(new BufferGeometry()); geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(points * 3), 3));
    const l = new Line(geo, this.own(new LineBasicMaterial({ color }))); l.frustumCulled = false; return l;
  }

  /** Items are authored in meters for a 1.8 m fighter: +X out of the fist (along the forearm), +Y up. */
  private build(item: Item): Group {
    const g = new Group(), s = this.size, wood = this.mat('#8a5a2b');
    switch (item) {
      case 'bow': {
        // Recurve bow: the grip at the origin, limbs curving back toward the archer; a nocked arrow and a live string.
        const R = .46, arc = 2.1;
        g.add(this.mesh(new TorusGeometry(R, .026, 6, 18, arc).rotateZ(-arc / 2).translate(-R, 0, 0), wood));
        g.add(this.mesh(new CylinderGeometry(.034, .034, .14, 8), this.mat('#e8d9a8')));
        const arrow = new Group();
        arrow.add(this.mesh(along(new CylinderGeometry(.016, .016, 1, 6), .5), this.mat('#e8d09a')));
        arrow.add(this.mesh(along(new ConeGeometry(.045, .13, 8), 1.04), this.mat('#dfe8f2')));
        arrow.add(this.mesh(new BoxGeometry(.12, .06, .004), this.mat('#e0484d'), [.07, 0, 0]));
        g.add(this.arrow = arrow, this.string = this.line('#f4efe0', 3)); break;
      }
      case 'boomerang': {
        for (const a of [.62, -.62]) { const arm = this.mesh(new BoxGeometry(.26, .06, .025), wood); arm.rotation.z = a; arm.position.set(.09, a * .1, 0); g.add(arm); }
        g.add(this.mesh(new SphereGeometry(.03, 8, 6), this.mat('#d63b3b'), [.0, 0, .01])); break;
      }
      case 'bomb':
        g.add(this.mesh(new SphereGeometry(.14, 16, 12), this.mat('#243a8c'), [.12, 0, 0]), this.mesh(new CylinderGeometry(.045, .045, .05, 10), this.mat('#8d97a8'), [.12, .15, 0]),
          this.mesh(new CylinderGeometry(.008, .008, .07, 5), this.mat('#e8d9a8'), [.12, .2, 0]), this.mesh(new SphereGeometry(.025, 8, 6), this.own(new MeshBasicMaterial({ color: '#ffd24a' })), [.12, .24, 0])); break;
      case 'turnip':
        g.add(this.mesh(new SphereGeometry(.15, 16, 12).scale(1, .85, 1), this.mat('#f5f2ea'), [.1, -.04, 0]), this.mesh(new ConeGeometry(.06, .14, 8).rotateX(Math.PI), this.mat('#f5f2ea'), [.1, -.2, 0]));
        for (const a of [-.5, 0, .5]) { const leaf = this.mesh(new ConeGeometry(.045, .2, 6), this.mat('#4caf3c'), [.1 + a * .08, .16, 0]); leaf.rotation.z = -a; g.add(leaf); }
        for (const z of [-.05, .05]) g.add(this.mesh(new SphereGeometry(.018, 6, 5), this.mat('#222222'), [.1 + z, 0, .14])); break;
      case 'toad': {
        // Held out in front by both hands: white spotted cap, face, blue vest.
        const cap = this.mesh(new SphereGeometry(.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .75, 1), this.mat('#f7f4ee'), [0, .1, 0]);
        g.add(cap, this.mesh(new SphereGeometry(.11, 12, 10), this.mat('#f2c9a0'), [0, .05, .04]), this.mesh(new CylinderGeometry(.1, .12, .16, 12), this.mat('#2f5fd0'), [0, -.1, 0]));
        for (const [x, z] of [[.12, .1], [-.12, .1], [0, .16]]) g.add(this.mesh(new SphereGeometry(.05, 8, 6), this.mat('#e0303a'), [x, .18, z]));
        for (const x of [-.04, .04]) g.add(this.mesh(new SphereGeometry(.018, 6, 5), this.mat('#222222'), [x, .07, .14])); break;
      }
      case 'yoyo':
        for (const z of [-.035, .035]) g.add(this.mesh(new CylinderGeometry(.11, .11, .05, 16).rotateX(Math.PI / 2), this.mat('#e03a3a'), [0, 0, z]));
        this.group.add(this.yoyoString = this.line('#f4efe0', 2)); break;
      case 'hammer': // Judge: an LCD mallet with a flat number sign
        g.add(this.mesh(along(new CylinderGeometry(.025, .025, .5, 6), .2), this.mat(LCD)), this.mesh(new BoxGeometry(.14, .16, .26), this.mat(LCD), [.45, 0, 0]),
          this.mesh(new BoxGeometry(.2, .24, .02), this.mat('#f5f5f0'), [.45, .26, 0])); break;
      case 'bucket':
        g.add(this.mesh(new CylinderGeometry(.17, .13, .28, 14, 1, true), this.mat(LCD), [.14, .08, 0]), this.mesh(new CircleGeometry(.13, 14).rotateX(Math.PI / 2), this.mat(LCD), [.14, -.06, 0]),
          this.mesh(new TorusGeometry(.16, .012, 5, 14, Math.PI), this.mat(LCD), [.14, .22, 0]));
        g.children[0].traverse(o => { if ((o as Mesh).material) ((o as Mesh).material as MeshToonMaterial).side = DoubleSide; }); break;
      case 'torch':
        g.add(this.mesh(along(new CylinderGeometry(.03, .02, .42, 8), .1), this.mat(LCD)), this.mesh(along(new ConeGeometry(.09, .3, 8), .45), this.mat(LCD)),
          this.mesh(new SphereGeometry(.08, 10, 8), this.mat(LCD), [.33, 0, 0])); break;
      case 'cutter':
        g.add(this.mesh(along(new CylinderGeometry(.022, .022, .16, 8), -.02), this.mat('#6b3d1f')), this.mesh(new BoxGeometry(.04, .18, .06), this.mat('#e8b93a'), [.07, 0, 0]),
          this.mesh(new BoxGeometry(.62, .075, .014), this.mat('#dfe6ee'), [.4, 0, 0]), this.mesh(new ConeGeometry(.038, .1, 4).rotateZ(-Math.PI / 2).scale(1, 1, .2), this.mat('#dfe6ee'), [.76, 0, 0])); break;
      case 'shine': {
        // Reflector hexagon: an additive fill and rim centered on the chest, facing the camera.
        const glow = (c: string, o: number) => this.own(new MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
        g.add(this.mesh(new CircleGeometry(.55, 6).rotateZ(Math.PI / 6), glow('#58c8ff', .35)), this.mesh(new RingGeometry(.52, .62, 6).rotateZ(Math.PI / 6), glow('#bff0ff', .9)));
        g.children.forEach(c => { c.renderOrder = 6; });
        break;
      }
    }
    g.scale.setScalar(s);
    return g;
  }

  /**
   * Place the playing move's item. at.wind is wind-up progress (0–1), at.struck turns true on the first active frame (the
   * arrow or the thrown item has left), at.yaw is the group's facing yaw (radians) that camera-facing items undo.
   */
  update(held: Held | undefined, rig: Rig, at: { wind: number; struck: boolean; hits?: readonly LiveHit[]; yaw: number; seconds: number }) {
    for (const [item, g] of this.items) g.visible = !!held && held.item === item;
    if (this.yoyoString) this.yoyoString.visible = held?.item === 'yoyo';
    if (!held) return;
    const g = this.items.get(held.item), parent = this.group.parent; if (!g || !parent) return;
    if (held.show === 'wind' && (at.struck || at.wind < (held.from ?? 0))) { g.visible = false; return; }
    const b = rig.bones, left = held.hand === 'L', hand = left ? b.hand_L : b.hand_R, fore = left ? b.forearm_L : b.forearm_R;
    if (!hand || !fore) { g.visible = false; return; }
    m1.copy(parent.matrixWorld).invert();
    const h = v1.setFromMatrixPosition(hand.matrixWorld).applyMatrix4(m1), e = v2.setFromMatrixPosition(fore.matrixWorld).applyMatrix4(m1);
    const other = left ? b.hand_R : b.hand_L, o = other ? v3.setFromMatrixPosition(other.matrixWorld).applyMatrix4(m1) : v3.copy(h);
    const orient = (x: Vector3) => { const z = v4.crossVectors(x.normalize(), UP); if (z.lengthSq() < 1e-6) z.set(0, 0, 1); z.normalize(); g.quaternion.setFromRotationMatrix(m1.makeBasis(x, v2.crossVectors(z, x), z)); };
    switch (held.item) {
      case 'shine': {
        const chest = b.chest ? v1.setFromMatrixPosition(b.chest.matrixWorld).applyMatrix4(m1) : h;
        g.position.copy(chest); g.quaternion.setFromAxisAngle(UP, -at.yaw); g.scale.setScalar(this.size * (1 + .06 * Math.sin(at.seconds * 40))); return;
      }
      case 'toad': g.position.lerpVectors(h, o, .5).add(v4.set(0, .04, 0)); g.quaternion.identity(); return;
      case 'bow': {
        // The bow aims along draw hand → bow hand; the arrow spans them (nocked at the draw hand), and the string meets it there.
        const aim = v4.subVectors(h, o); if (aim.lengthSq() < 1e-6) aim.set(0, 0, 1);
        const len = aim.length(); g.position.copy(h); orient(aim.clone());
        const draw = Math.min(.75, len / this.size), shows = !at.struck;
        this.arrow!.visible = shows; this.arrow!.position.set(-draw, 0, 0); this.arrow!.scale.set(draw + .12, 1, 1);
        const R = .46, a = 1.05, tip = (sy: number) => [R * Math.cos(a) - R, sy * R * Math.sin(a), 0];
        const pos = this.string!.geometry.getAttribute('position') as Float32BufferAttribute, nock = shows ? -draw : R * Math.cos(a) - R;
        pos.setXYZ(0, ...tip(1) as [number, number, number]); pos.setXYZ(1, nock, 0, 0); pos.setXYZ(2, ...tip(-1) as [number, number, number]); pos.needsUpdate = true;
        return;
      }
      case 'yoyo': {
        // The yo-yo rides the live hitbox (it is the hitbox) and hangs from a string to the hand.
        let far = -1; g.position.copy(h).add(v4.set(0, -.12 * this.size, 0));
        for (const hit of at.hits ?? []) { const p = v4.set(hit.x, hit.y, 0).applyMatrix4(m1); p.z = h.z; const d = p.distanceToSquared(h); if (d > far) { far = d; g.position.copy(p); } }
        g.quaternion.identity(); g.rotation.z = -at.seconds * 30;
        const pos = this.yoyoString!.geometry.getAttribute('position') as Float32BufferAttribute;
        pos.setXYZ(0, h.x, h.y, h.z); pos.setXYZ(1, g.position.x, g.position.y, g.position.z); pos.needsUpdate = true; return;
      }
      default: {
        g.position.copy(h); orient(v4.subVectors(h, e).lengthSq() > 1e-8 ? v4.subVectors(h, e).clone() : v4.set(0, 0, 1));
        if (held.item === 'boomerang') g.rotateZ(Math.sin(at.seconds * 9) * .2);
      }
    }
  }

  get count() { let n = 0; for (const g of this.items.values()) if (g.visible) n++; return n; }
  dispose() { this.group.removeFromParent(); for (const x of this.owned.splice(0)) x.dispose(); }
}
