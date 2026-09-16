import { Group, Mesh, Object3D, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial, type Scene, type Sprite } from 'three';
import type { PublicView } from './model';
import { CARGO_META, TRACK_META, WAGON_CARGO, boardBounds, boardCenter, edgeGeometry, pushOutward, type BoardIndex } from './presentation';

export type LayerContext = {
  scene: Scene; index: BoardIndex; land: number; ink: string;
  geo: { box: BufferGeometry; cone: BufferGeometry; cylinder: BufferGeometry; sphere: BufferGeometry; ring: BufferGeometry; nugget: BufferGeometry };
  material(color: string, flat?: boolean): MeshStandardMaterial; color(playerId: string): string; pop(object: Object3D, now: number): void; sign(text: string, background: string): Sprite;
  /** Expanding, fading ring used for landings, awards and reveals. */
  burst(x: number, y: number, z: number, color: string, now: number): void; reduced(): boolean;
};
type Move = { object: Object3D; from: Vector3; to: Vector3; fromYaw: number; toYaw: number; start: number; duration: number; hop: number; style: 'hop' | 'sail' | 'roll' };
type CubeHop = { mesh: Mesh; from: Vector3; to: Vector3 | null; start: number };
const yawFor = (dx: number, dz: number) => Math.atan2(-dz, dx);
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const lerpAngle = (a: number, b: number, t: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/** Procedural expansion pieces diffed against the public view. Keys with a stable signature glide when their position changes; changed pieces are rebuilt and popped in. */
export class ExpansionLayers {
  private objects = new Map<string, { object: Object3D; signature: string }>();
  private moves: Move[] = []; private cubes: CubeHop[] = []; private shake: { object: Object3D; start: number } | null = null;
  private cargoAt = new Map<string, { position: Vector3; kinds: string[] }>();
  private barbarian: { position: number; attacks: number } | null = null;
  private lastView: PublicView | null = null;
  constructor(private ctx: LayerContext) {}
  private block(parent: Object3D, g: BufferGeometry, m: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) { const mesh = new Mesh(g, m); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.rotation.y = yaw; parent.add(mesh); return mesh; }
  private place(seen: Set<string>, key: string, signature: string, build: () => Object3D, target: Vector3, yaw: number | null, now: number, style: Move['style'] = 'hop', snap = false) {
    seen.add(key); let entry = this.objects.get(key);
    if (entry && entry.signature !== signature) { this.ctx.scene.remove(entry.object); entry = undefined; }
    if (!entry) { const object = build(); object.position.copy(target); if (yaw !== null) object.rotation.y = yaw; this.ctx.scene.add(object); this.objects.set(key, { object, signature }); this.ctx.pop(object, now); return object; }
    const moving = this.moves.find(move => move.object === entry!.object), current = moving ? moving.to : entry.object.position;
    if (current.distanceTo(target) > .01 || (yaw !== null && Math.abs(lerpAngle(entry.object.rotation.y, yaw, 1) - entry.object.rotation.y) > .01)) {
      this.moves = this.moves.filter(move => move.object !== entry!.object);
      if (snap || this.ctx.reduced()) { entry.object.position.copy(target); if (yaw !== null) entry.object.rotation.y = yaw; }
      else this.moves.push({ object: entry.object, from: entry.object.position.clone(), to: target.clone(), fromYaw: entry.object.rotation.y, toYaw: yaw ?? entry.object.rotation.y, start: now, duration: style === 'sail' ? 1300 : style === 'roll' ? 1000 : 650, hop: style === 'hop' ? .5 : 0, style });
    }
    return entry.object;
  }
  /** Cargo that left one place and arrived at another hops between them; consumed cargo lifts and fades. */
  private cargoDelta(next: Map<string, { position: Vector3; kinds: string[] }>, now: number) {
    const losers: { position: Vector3; kinds: string[] }[] = [], gainers: { position: Vector3; kinds: string[] }[] = [];
    const counts = (kinds: string[]) => kinds.reduce<Record<string, number>>((acc, kind) => { acc[kind] = (acc[kind] ?? 0) + 1; return acc; }, {});
    for (const [key, before] of this.cargoAt) { const after = next.get(key), a = counts(before.kinds), b = counts(after?.kinds ?? []); const lost: string[] = []; for (const kind of Object.keys(a)) for (let i = 0; i < a[kind] - (b[kind] ?? 0); i++) lost.push(kind); if (lost.length) losers.push({ position: before.position, kinds: lost }); }
    for (const [key, after] of next) { const before = this.cargoAt.get(key), a = counts(before?.kinds ?? []), b = counts(after.kinds); const gained: string[] = []; for (const kind of Object.keys(b)) for (let i = 0; i < b[kind] - (a[kind] ?? 0); i++) gained.push(kind); if (gained.length) gainers.push({ position: after.position, kinds: gained }); }
    if (this.cargoAt.size && !this.ctx.reduced()) for (const loser of losers) { let nearest: { position: Vector3; kinds: string[] } | null = null; for (const gainer of gainers) if (!nearest || gainer.position.distanceTo(loser.position) < nearest.position.distanceTo(loser.position)) nearest = gainer; for (const kind of loser.kinds) { const mesh = new Mesh(this.ctx.geo.box, this.ctx.material((CARGO_META as Record<string, { color: string }>)[kind]?.color ?? '#fff6e5', true)); mesh.scale.setScalar(.16); mesh.position.copy(loser.position); this.ctx.scene.add(mesh); this.cubes.push({ mesh, from: loser.position.clone(), to: nearest && nearest.kinds.includes(kind) ? nearest.position.clone() : null, start: now }); } }
    this.cargoAt = next;
  }
  sync(view: PublicView, now: number) {
    if (view === this.lastView) return; this.lastView = view;
    const exp = view.expansions, seen = new Set<string>(), { geo, material, color, index, land, ink } = this.ctx, M = (c: string) => material(c, true), V = (x: number, z: number, y = land) => new Vector3(x, y, z);
    if (exp) {
      const vertex = (id: string) => index.vertices.get(id), tile = (id: string) => index.tiles.get(id), edge = (id: string) => edgeGeometry(index, id), cargo = new Map<string, { position: Vector3; kinds: string[] }>();
      for (const knight of exp.knights) { const v = vertex(knight.vertex); if (!v) continue; this.place(seen, `knight:${knight.id}`, `${knight.strength}|${knight.active}|${knight.playerId}`, () => { const g = new Group(); this.block(g, geo.cylinder, M(ink), 0, .015, 0, .5, .03, .5); this.block(g, geo.cylinder, M(color(knight.playerId)), 0, .2, 0, .34, .36, .34); this.block(g, geo.cone, M(knight.active ? '#ffd24a' : '#8d93a6'), 0, .5, 0, .34, .3, .34); for (let i = 0; i < knight.strength; i++) this.block(g, geo.sphere, M('#fff6e5'), Math.cos(i * 2.1) * .2, .34, Math.sin(i * 2.1) * .2, .1, .1, .1); return g; }, V(v.x, v.y), null, now); }
      for (const id of exp.walls) { const v = vertex(id); if (!v) continue; this.place(seen, `wall:${id}`, id, () => { const g = new Group(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; this.block(g, geo.box, M('#7d6b52'), Math.cos(a) * .36, .07, Math.sin(a) * .36, .3, .14, .08, -a); } return g; }, V(v.x, v.y), null, now); }
      for (const m of exp.metropolises) { const v = vertex(m.vertex); if (!v) continue; const key = `metro:${m.vertex}`, fresh = !this.objects.has(key) || this.objects.get(key)!.signature !== `${m.track}|${m.playerId}`; this.place(seen, key, `${m.track}|${m.playerId}`, () => { const g = new Group(); this.block(g, geo.cylinder, M(color(m.playerId)), 0, .55, 0, .26, 1.1, .26); this.block(g, geo.cone, M(TRACK_META[m.track].color), 0, 1.28, 0, .4, .36, .4); return g; }, V(v.x, v.y), null, now); if (fresh && this.lastViewHadBoard) this.ctx.burst(v.x, land + .05, v.y, TRACK_META[m.track].color, now); }
      if (exp.rivers) {
        for (const id of exp.rivers.edges) { const g = edge(id); if (!g) continue; this.place(seen, `river:${id}`, id, () => { const group = new Group(); this.block(group, geo.box, M('#3aa6e8'), 0, .012, 0, .96, .025, .22); return group; }, V(g.x, g.y), yawFor(g.b.x - g.a.x, g.b.y - g.a.y), now); }
        for (const id of exp.rivers.bridgeSites) { const g = edge(id); if (!g) continue; this.place(seen, `site:${id}`, id, () => { const group = new Group(); const ring = this.block(group, geo.ring, M('#fff6e5'), 0, .03, 0, .22, .22, 1); ring.rotation.x = -Math.PI / 2; return group; }, V(g.x, g.y), null, now); }
        for (const id of exp.rivers.bridges) { const g = edge(id); if (!g) continue; this.place(seen, `bridge:${id}`, id, () => { const group = new Group(); this.block(group, geo.box, M('#8a6136'), 0, .12, 0, .56, .07, .28); for (const x of [-.24, .24]) for (const z of [-.12, .12]) this.block(group, geo.box, M('#5d3f22'), x, .18, z, .05, .2, .05); return group; }, V(g.x, g.y), yawFor(g.b.x - g.a.x, g.b.y - g.a.y), now); }
      }
      for (const seg of exp.caravans?.segments ?? []) { const g = edge(seg.edge); if (!g) continue; this.place(seen, `caravan:${seg.edge}`, seg.edge, () => { const group = new Group(); this.block(group, geo.box, M('#d9b27a'), 0, .03, 0, .72, .05, .18); for (const x of [-.14, .14]) { this.block(group, geo.sphere, M('#8a6136'), x, .16, 0, .16, .16, .12); this.block(group, geo.sphere, M('#8a6136'), x, .2, 0, .1, .14, .1); } return group; }, V(g.x, g.y), yawFor(g.b.x - g.a.x, g.b.y - g.a.y), now); }
      for (const item of exp.attack?.barbarians ?? []) { const t = tile(item.tile); if (!t) continue; this.place(seen, `barb:${item.tile}`, String(item.count), () => { const group = new Group(); for (let i = 0; i < Math.min(item.count, 6); i++) this.block(group, geo.cone, M('#2b2540'), (i % 3) * .2 - .2, .17, Math.floor(i / 3) * .2 - .1, .18, .34, .18); return group; }, V(t.x - .45, t.y + .35), null, now); }
      for (const guard of exp.attack?.guards ?? []) { const g = edge(guard.edge); if (!g) continue; this.place(seen, `guard:${guard.id}`, `${guard.strength}|${guard.active}|${guard.playerId}`, () => { const group = new Group(); this.block(group, geo.box, M(color(guard.playerId)), 0, .16, 0, .24, .3, .24); this.block(group, geo.cylinder, M('#8a6136'), .16, .3, 0, .03, .6, .03); this.block(group, geo.cone, M(guard.active ? '#ffd24a' : '#8d93a6'), .16, .64, 0, .08, .12, .08); for (let i = 0; i < guard.strength; i++) this.block(group, geo.sphere, M('#fff6e5'), -.16, .1 + i * .12, 0, .07, .07, .07); return group; }, V(g.x, g.y), null, now); }
      for (const id of exp.deliveries?.barbarians ?? []) { const g = edge(id); if (!g) continue; this.place(seen, `roadbarb:${id}`, id, () => { const group = new Group(); this.block(group, geo.cone, M('#2b2540'), 0, .2, 0, .22, .4, .22); this.block(group, geo.sphere, M('#2b2540'), 0, .42, 0, .12, .12, .12); return group; }, V(g.x, g.y), null, now); }
      for (const wagon of exp.deliveries?.wagons ?? []) { const v = vertex(wagon.vertex); if (!v) continue; this.place(seen, `wagon:${wagon.playerId}`, `${wagon.cargo}|${wagon.level}`, () => { const group = new Group(); this.block(group, geo.box, M(color(wagon.playerId)), 0, .18, 0, .42, .16, .26); const wheels: Mesh[] = []; for (const x of [-.14, .14]) for (const z of [-.15, .15]) { const wheel = this.block(group, geo.cylinder, M(ink), x, .08, z, .16, .04, .16); wheel.rotation.x = Math.PI / 2; wheels.push(wheel); } group.userData.wheels = wheels; if (wagon.cargo) this.block(group, geo.box, M(WAGON_CARGO[wagon.cargo].color), 0, .34, 0, .18, .16, .18); return group; }, V(v.x, v.y - .35), null, now, 'roll'); }
      if (exp.explorers) {
        for (const ship of exp.explorers.ships) { const g = edge(ship.edge); if (!g) continue; const position = V(g.x, g.y, 0); cargo.set(`ship:${ship.id}`, { position, kinds: ship.cargo.map(c => c.kind) }); this.place(seen, `eship:${ship.id}`, `${ship.playerId}|${ship.cargo.map(c => c.kind).join()}`, () => { const group = new Group(); this.block(group, geo.box, M(color(ship.playerId)), 0, .12, 0, .78, .18, .3); this.block(group, geo.box, M(ink), 0, .22, 0, .56, .03, .2); this.block(group, geo.cylinder, M('#6b4a2b'), -.12, .5, 0, .05, .56, .05); this.block(group, geo.cone, M('#fff6e5'), -.04, .56, 0, .42, .5, .2); ship.cargo.forEach((c, i) => this.block(group, geo.box, M(CARGO_META[c.kind].color), .12 + i * .14, .3, 0, .12, .12, .12)); return group; }, position, yawFor(g.b.x - g.a.x, g.b.y - g.a.y), now, 'sail'); }
        for (const h of exp.explorers.harbors) { const v = vertex(h.vertex); if (!v) continue; cargo.set(`harbor:${h.vertex}`, { position: V(v.x, v.y + .34), kinds: h.cargo.map(c => c.kind) }); if (!h.cargo.length) continue; this.place(seen, `hcargo:${h.vertex}`, h.cargo.map(c => c.kind).join(), () => { const group = new Group(); h.cargo.forEach((c, i) => this.block(group, geo.box, M(CARGO_META[c.kind].color), (i - (h.cargo.length - 1) / 2) * .15, .07, .34, .13, .13, .13)); return group; }, V(v.x, v.y), null, now); }
        for (const lair of exp.explorers.lairs) { const t = tile(lair.tile); if (!t) continue; this.place(seen, `lair:${lair.tile}`, `${lair.captured}|${lair.crews.join()}`, () => { const group = new Group(); this.block(group, geo.cone, M(lair.captured ? '#6b7385' : '#2b2540'), 0, .3, 0, .7, .6, .7); if (lair.captured) { this.block(group, geo.cylinder, M('#6b4a2b'), 0, .75, 0, .03, .5, .03); this.block(group, geo.box, M('#fff6e5'), .1, .9, 0, .2, .12, .02); } lair.crews.slice(0, 4).forEach((id, i) => this.block(group, geo.sphere, M(color(id)), Math.cos(i * 1.6) * .5, .1, Math.sin(i * 1.6) * .5, .14, .14, .14)); return group; }, V(t.x, t.y + .2), null, now); }
        for (const shoal of exp.explorers.shoals) { const t = tile(shoal.tile); if (!t) continue; if (shoal.number > 0 && !t.number) this.place(seen, `shoalnum:${shoal.tile}`, String(shoal.number), () => this.ctx.sign(String(shoal.number), '#3a8fb8'), V(t.x, t.y, .3), null, now); if (shoal.fish) this.place(seen, `fish:${shoal.tile}`, 'fish', () => { const group = new Group(); this.block(group, geo.sphere, M('#6cc3e8'), 0, .1, 0, .3, .16, .16); this.block(group, geo.cone, M('#6cc3e8'), -.22, .1, 0, .12, .16, .06).rotation.z = Math.PI / 2; return group; }, V(t.x + .45, t.y - .4, 0), null, now); }
        for (const spice of exp.explorers.spices) { const t = tile(spice.tile); if (!t) continue; this.place(seen, `spice:${spice.tile}`, `${spice.benefit}|${spice.visitors.join()}`, () => { const group = new Group(); this.block(group, geo.cylinder, M(spice.benefit === 'gold' ? '#ffd24a' : spice.benefit === 'pirate' ? '#2b2540' : '#28c6e7'), 0, .2, 0, .3, .4, .3); this.block(group, geo.cylinder, M('#e07a5f'), 0, .44, 0, .18, .08, .18); spice.visitors.slice(0, 4).forEach((id, i) => this.block(group, geo.sphere, M(color(id)), Math.cos(i * 1.6) * .32, .08, Math.sin(i * 1.6) * .32, .12, .12, .12)); return group; }, V(t.x + .42, t.y + .38), null, now); }
        this.cargoDelta(cargo, now);
      }
      for (const ground of exp.fishing?.grounds ?? []) { const points = ground.vertices.map(vertex).filter((v): v is NonNullable<typeof v> => !!v); if (!points.length) continue; const cx = points.reduce((s, p) => s + p.x, 0) / points.length, cz = points.reduce((s, p) => s + p.y, 0) / points.length; const away = pushOutward(boardCenter(view.board), cx, cz, .6); this.place(seen, `ground:${ground.id}`, ground.numbers.join(), () => { const group = new Group(); this.block(group, geo.cylinder, M('#3b9ad8'), 0, .02, 0, 1.4, .04, 1); const sprite = this.ctx.sign(ground.numbers.join(' · '), '#25689a'); sprite.userData.factor = .8; sprite.position.set(away.x - cx, .5, away.y - cz); group.add(sprite); return group; }, V(cx, cz, 0), null, now); }
      if (exp.merchant) { const t = tile(exp.merchant.tile); if (t) this.place(seen, 'merchant', exp.merchant.playerId, () => { const group = new Group(); this.block(group, geo.cone, M(color(exp.merchant!.playerId)), 0, .3, 0, .6, .6, .6); this.block(group, geo.cone, M('#fff6e5'), 0, .5, 0, .24, .24, .24); return group; }, V(t.x - .45, t.y - .3), null, now); }
      if (exp.barbarian) {
        // The fleet sails down the western coast from station 0 to the landing at 7, then resets after an attack.
        const box = boardBounds({ ...view.board, tiles: view.board.tiles.filter(t => t.terrain !== 'sea') }), b = exp.barbarian, progress = Math.min(1, Math.max(0, b.position / 7)), target = new Vector3(box.minX - 1.4, 0, box.minY + (box.maxY - box.minY) * progress);
        const previous = this.barbarian, landed = !!previous && (b.attacks > previous.attacks || (b.position >= 7 && previous.position < 7)), reset = !!previous && b.position < previous.position;
        const ship = this.place(seen, 'barbship', String(b.attacks), () => { const group = new Group(); this.block(group, geo.box, M('#2b2540'), 0, .14, 0, 1.1, .22, .4); this.block(group, geo.cylinder, M('#6b4a2b'), 0, .6, 0, .06, .7, .06); this.block(group, geo.cone, M('#8d93a6'), .12, .68, 0, .6, .64, .26); for (let i = 0; i < Math.min(b.attacks, 5); i++) this.block(group, geo.sphere, M('#ff5748'), -.4 + i * .2, .3, .16, .08, .08, .08); return group; }, target, null, now, 'sail', reset);
        if (landed && this.lastViewHadBoard) { this.shake = { object: ship, start: now }; this.ctx.burst(box.minX - .6, .05, box.minY + (box.maxY - box.minY) * Math.min(1, (previous?.position ?? 7) / 7), '#ff5748', now); }
        this.barbarian = { position: b.position, attacks: b.attacks };
      }
    }
    for (const [key, entry] of this.objects) if (!seen.has(key)) { this.ctx.scene.remove(entry.object); this.objects.delete(key); }
    this.lastViewHadBoard = true;
  }
  private lastViewHadBoard = false;
  /** Per-frame motion: glides, wagon wheels, cargo hops and the landing shake. Reduced motion never queues these. */
  animate(now: number) {
    for (let i = this.moves.length - 1; i >= 0; i--) {
      const move = this.moves[i], t = Math.min(1, (now - move.start) / move.duration), k = ease(t);
      move.object.position.lerpVectors(move.from, move.to, k); move.object.rotation.y = lerpAngle(move.fromYaw, move.toYaw, k);
      if (move.style === 'hop') move.object.position.y += Math.sin(t * Math.PI) * move.hop;
      else if (move.style === 'sail') { move.object.position.y += Math.sin(now / 160) * .02; move.object.rotation.z = Math.sin(now / 200) * .05 * (1 - t); }
      else { move.object.position.y += Math.abs(Math.sin(t * Math.PI * 6)) * .03; for (const wheel of (move.object.userData.wheels as Mesh[] | undefined) ?? []) wheel.rotation.y += .25; }
      if (t >= 1) { move.object.position.copy(move.to); move.object.rotation.y = move.toYaw; move.object.rotation.z = 0; this.moves.splice(i, 1); }
    }
    for (let i = this.cubes.length - 1; i >= 0; i--) {
      const cube = this.cubes[i], t = Math.min(1, (now - cube.start) / 800);
      if (cube.to) { cube.mesh.position.lerpVectors(cube.from, cube.to, ease(t)); cube.mesh.position.y += Math.sin(t * Math.PI) * .9; }
      else { cube.mesh.position.copy(cube.from); cube.mesh.position.y += t * 1.1; cube.mesh.scale.setScalar(.16 * (1 - t) + .001); }
      cube.mesh.rotation.y = t * Math.PI * 2;
      if (t >= 1) { this.ctx.scene.remove(cube.mesh); this.cubes.splice(i, 1); }
    }
    if (this.shake) { const t = (now - this.shake.start) / 700; if (t >= 1) { this.shake.object.rotation.z = 0; this.shake = null; } else this.shake.object.rotation.z = Math.sin(t * 40) * .12 * (1 - t); }
  }
}
