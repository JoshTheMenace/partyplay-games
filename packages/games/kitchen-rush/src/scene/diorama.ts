// The static kitchen: themed exterior, slab with pits, floor, back wall, stations and crate stock, batched per material.
import {
  AdditiveBlending, BoxGeometry, Color, Euler, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3, type Texture,
} from 'three';
import { INGREDIENTS, WALKABLE, type KitchenMap, type Level, type Tile } from '../model';
import { Instances, type Kit } from './kit';
import { gateHinges, itemAnchor } from './layout';
import { shade } from './procedural';
import { Shape, type Template } from './shapes';
import { radialTexture, sheenTexture, signTexture, swirlTexture } from './textures';
import type { Palette } from './themes';

const SLAB = .6, place = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), s = new Vector3();
const at = (x: number, y: number, z: number, yaw = 0, scale = 1) => place.compose(v.set(x, y, z), q.setFromEuler(e.set(0, yaw, 0)), s.set(scale, scale, scale)).clone();
/** Stations whose cabinets cover their whole tile, so no floor is laid under them. */
const COVERED = new Set(['counter', 'board', 'stove', 'sink', 'rack', 'return', 'serve', 'crate', 'belt']);
const STATION_NAMES: Record<string, string> = { counter: 'counter', board: 'board', stove: 'stove', oven: 'oven', sink: 'sink', rack: 'rack', return: 'return', serve: 'serve', bin: 'bin', crate: 'crate', belt: 'belt' };
/** Deterministic pseudo-random numbers so a level always decorates the same way. */
function random(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; }

export type TileAnchor = { x: number; y: number; z: number; scale: number; top: number; yaw: number };
export type Gate = { pivot: Group; alongX: boolean; sign: number };
export type Diorama = {
  group: Group; anchors: TileAnchor[]; gates: Gate[]; gateLamps: MeshStandardMaterial; portals: Mesh[]; sheen?: Texture; belts: Texture[]; water?: Mesh;
  /** Burner flames, drawn per frame only under stoves that are heating something. */
  flames: Instances; flameY: number;
};

/** `lite` (low graphics quality) trims scenery and crate stock. */
export function buildDiorama(map: KitchenMap, level: Level, kit: Kit, palette: Palette, options: { shadows: boolean; lite: boolean }) {
  const group = new Group(), statics: { template: Template; matrix: Matrix4; color?: Color; all?: boolean }[] = [], rand = random(level.id);
  const stat = (template: Template, matrix: Matrix4, color?: Color, all = false) => statics.push({ template, matrix, color, all });
  const own = <T extends { dispose(): void }>(resource: T) => kit.own(resource);
  const solid = (tile: Tile | undefined) => !!tile && tile.kind !== 'void' && tile.kind !== 'gate';
  const tileAt = (col: number, row: number) => col < 0 || row < 0 || col >= map.cols || row >= map.rows ? undefined : map.tiles[row * map.cols + col];

  // ── Exterior ground, slab and pits ──
  const ground = new Mesh(own(new PlaneGeometry(160, 160).rotateX(-Math.PI / 2)), own(new MeshStandardMaterial({ color: palette.ground, roughness: palette.pit === 'water' && palette.ground === palette.pitColor ? .25 : .95 })));
  ground.position.y = -SLAB; ground.receiveShadow = options.shadows; group.add(ground);
  const blob = own(radialTexture(.2, 1)), halo = new Mesh(own(new PlaneGeometry(map.cols + 9, map.rows + 9).rotateX(-Math.PI / 2)), own(new MeshBasicMaterial({ map: blob, color: '#000000', transparent: true, opacity: .28, depthWrite: false })));
  halo.position.y = -SLAB + .012; group.add(halo);
  const apron = new Mesh(own(new PlaneGeometry(map.cols + 6, map.rows + 5).rotateX(-Math.PI / 2)), own(new MeshStandardMaterial({ color: palette.apron, roughness: .9 })));
  apron.position.set(0, -SLAB + .006, -.5); apron.receiveShadow = options.shadows; group.add(apron);
  const column = new Shape().box([1, SLAB, 1], { at: [0, -SLAB / 2 - .001, 0], color: palette.slab }).build(kit.materials, 'slab');
  column.parts.forEach(part => own(part.geometry));
  // Gaps must read as dangerous: unlit dark chasms, or glossy deep water with a lighter surface glint.
  const pitFloor = palette.pit === 'water'
    ? own(new MeshStandardMaterial({ color: palette.pitColor, emissive: shade(palette.pitColor, .35), roughness: .08, metalness: .1 }))
    : own(new MeshBasicMaterial({ color: shade(palette.pitColor, .45) }));
  const pits: Tile[] = [];
  for (const tile of map.tiles) { if (solid(tile)) stat(column, at(tile.x, 0, tile.z)); else pits.push(tile); }
  let water: Mesh | undefined;
  if (pits.length) {
    const pit = own(new InstancedMesh(own(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), pitFloor, pits.length));
    pits.forEach((tile, i) => pit.setMatrixAt(i, at(tile.x, palette.pit === 'water' ? -.42 : -SLAB + .02, tile.z)));
    group.add(pit); if (palette.pit === 'water') water = pit;
    // Pit walls get a darker band so gaps read as dangerous from the camera angle.
    const band = new Shape().box([1, .56, .04], { at: [0, -.3, 0], color: shade(palette.pitColor, .8) }).box([1, .05, .06], { at: [0, -.03, .01], color: palette.rim }).build(kit.materials, 'pit_wall');
    band.parts.forEach(part => own(part.geometry));
    for (const tile of pits) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (solid(tileAt(tile.col + dc, tile.row + dr))) stat(band, at(tile.x + dc * .47, 0, tile.z + dr * .47, dc ? Math.PI / 2 : 0));
  }
  // Rim trim around the slab.
  const rim = new Shape();
  rim.box([map.cols + .3, .14, .15], { at: [0, -.05, map.rows / 2 + .07], color: palette.rim, r: .03 }).box([map.cols + .3, .14, .15], { at: [0, -.05, -map.rows / 2 - .07], color: palette.rim, r: .03 })
    .box([.15, .14, map.rows + .3], { at: [map.cols / 2 + .07, -.05, 0], color: palette.rim, r: .03 }).box([.15, .14, map.rows + .3], { at: [-map.cols / 2 - .07, -.05, 0], color: palette.rim, r: .03 });
  stat(rim.build(kit.materials, 'rim'), new Matrix4());

  // ── Floor ──
  const floorA = new Color(palette.floorA), floorB = new Color(palette.floorB);
  // Low quality swaps the bevelled authored tiles and walls for flat procedural ones (a fraction of the triangles).
  const floor = options.lite ? kit.procedural('floor_flat') : kit.template('floor_tile'), ice = kit.template('ice_tile');
  const iceTiles: Tile[] = [];
  for (const tile of map.tiles) {
    if (tile.kind === 'ice') { stat(ice, at(tile.x, 0, tile.z)); iceTiles.push(tile); }
    else if (!COVERED.has(tile.kind) && tile.kind !== 'void' && tile.kind !== 'gate') stat(floor, at(tile.x, 0, tile.z), (tile.col + tile.row) % 2 ? floorB : floorA, options.lite || !kit.authored('floor_tile'));
    if (tile.kind === 'portal') stat(kit.template('portal_pad'), at(tile.x, .002, tile.z));
  }

  // ── Stations ──
  const anchors: TileAnchor[] = map.tiles.map(tile => ({ x: tile.x, y: WALKABLE.has(tile.kind) ? .02 : .9, z: tile.z, scale: 1, top: WALKABLE.has(tile.kind) ? .015 : .915, yaw: 0 }));
  const crateFloor = kit.authored('crate') ? .81 : .72;
  // Animated children leave the static batch: burner flames toggle per stove, belt ribs become a scrolling strip.
  const [stoveBody, stoveFlame] = kit.split(kit.template('stove'), /stove_flame/), [beltBody] = kit.split(kit.template('belt'), /belt_surface/);
  const flameTemplate = stoveFlame.parts.length ? stoveFlame : kit.template('stove_flame');
  const stoves = map.tiles.filter(tile => tile.kind === 'stove').length;
  for (const tile of map.tiles) {
    const name = STATION_NAMES[tile.kind];
    if (!name) continue;
    const yaw = tile.dir ? Math.atan2(-tile.dir.z, tile.dir.x) : facing(tile);
    const template = tile.kind === 'stove' ? stoveBody : tile.kind === 'belt' ? beltBody : kit.template(name);
    stat(template, at(tile.x, 0, tile.z, yaw), tile.ingredient ? new Color(INGREDIENTS[tile.ingredient].color) : undefined);
    if (tile.kind === 'belt') stat(kit.beltStrip, at(tile.x, 0, tile.z, yaw));
    const anchor = itemAnchor(tile.kind, kit.authored('oven'));
    anchors[tile.index] = { x: tile.x + Math.sin(yaw) * anchor.z, y: anchor.y, z: tile.z + Math.cos(yaw) * anchor.z, scale: anchor.scale, top: tile.kind === 'oven' ? .93 : .915, yaw };
    if (tile.kind === 'crate' && tile.ingredient) {
      const food = kit.template(`${tile.ingredient}_raw`);
      for (const [x, z, turn] of options.lite ? [[-.14, -.08, .4], [.15, .1, 2.1]] : [[-.2, -.18, .4], [.2, -.14, 2.1], [0, .18, 4], [-.22, .2, 1], [.23, .22, 5.2]]) stat(food, at(tile.x + x, crateFloor, tile.z + z, turn));
    }
  }
  function facing(tile: Tile) {
    const open = (dc: number, dr: number) => { const next = tileAt(tile.col + dc, tile.row + dr); return !!next && WALKABLE.has(next.kind); };
    if (open(0, 1) || tile.row === map.rows - 1) return 0;
    if (open(1, 0)) return Math.PI / 2;
    if (open(-1, 0)) return -Math.PI / 2;
    return 0;
  }

  // ── Back wall row (one tile behind the map), windows on its face and the location sign on top ──
  const wall = options.lite ? kit.procedural('wall') : kit.template('wall'), wallZ = -map.rows / 2 - .5;
  const wallTint = new Color(palette.wallTint);
  for (let col = 0; col < map.cols; col++) stat(wall, at(col + .5 - map.cols / 2, 0, wallZ), wallTint);
  let windowTemplate = kit.template('prop_window');
  if (!kit.authored('prop_window')) {
    const window = new Shape().box([.8, .5, .05], { at: [0, .92, .52], color: '#fdf7ea', r: .03 }).box([.66, .38, .02], { at: [0, .92, .55], color: palette.night ? '#ffd98a' : '#9fd8ef', finish: palette.night ? 'glow' : 'gloss' });
    for (let i = 0; i < 5; i++) window.box([.18, .04, .3], { at: [-.36 + i * .18, 1.22, .62], rot: [.45, 0, 0], color: i % 2 ? '#fff6e6' : palette.accent });
    windowTemplate = window.build(kit.materials, 'window'); windowTemplate.parts.forEach(part => own(part.geometry));
  }
  const signWidth = Math.min(5, map.cols * .4), signHeight = signWidth * 192 / 1024;
  for (let x = -map.cols / 2 + 1.5; x < map.cols / 2 - 1; x += map.cols > 16 ? 3 : 2.5) if (Math.abs(x) > signWidth / 2 + .6) stat(windowTemplate, at(x, 0, wallZ));
  const sign = new Mesh(own(new PlaneGeometry(signWidth, signHeight)), own(new MeshBasicMaterial({ map: own(signTexture(level.location, palette.trim, '#fff8e6')), transparent: true })));
  sign.position.set(0, 1.22 + signHeight / 2, wallZ + .1); sign.rotation.x = -.25; group.add(sign);

  // ── Theme props in tidy rows beside and behind the kitchen, turned toward it ──
  const halfX = map.cols / 2, halfZ = map.rows / 2, prop = (n: number) => palette.props[n % palette.props.length];
  let n = Math.floor(rand() * 4);
  for (const side of [-1, 1]) for (let z = -halfZ + .6; z < halfZ + 1.2; z += 1.7) {
    stat(kit.template(prop(n++)), at(side * (halfX + 1.3), -SLAB, z, -side * Math.PI / 2 + (rand() - .5) * .5, .95 + rand() * .15));
    if (rand() < .55 && !options.lite) stat(kit.template(prop(n++)), at(side * (halfX + 2.7 + rand() * .4), -SLAB, z + .8, rand() * 6, 1 + rand() * .2));
  }
  for (let x = -halfX + .5; x <= halfX; x += options.lite ? 4.4 : 2.2) stat(kit.template(prop(n++)), at(x + rand() * .6, -SLAB, -halfZ - 1.5, rand() * .6 - .3, 1.15));

  group.add(kit.batch(statics, { cast: options.shadows, receive: options.shadows }));

  // ── Drawbridges with warning lamps ──
  const gateLamps = own(new MeshStandardMaterial({ color: '#8a6a2a', emissive: '#000000', roughness: .4 }));
  const plank = kit.template('gate_plank'), gates: Gate[] = [];
  const lampShape = new Shape().cylinder(.05, .06, .5, { at: [0, .25, 0], color: '#4d545c', finish: 'metal' }).build(kit.materials, 'gate_post');
  lampShape.parts.forEach(part => own(part.geometry));
  const bulb = own(new BoxGeometry(.14, .14, .14));
  for (const gate of gateHinges(map)) {
    const pivot = new Group(); pivot.position.set(gate.hinge.x, 0, gate.hinge.z);
    const leaf = kit.spawn(plank); leaf.position.set(gate.tile.x - gate.hinge.x, 0, gate.tile.z - gate.hinge.z); pivot.add(leaf); group.add(pivot);
    gates.push({ pivot, alongX: gate.alongX, sign: gate.sign });
    if (gate.reach === .5) for (const side of [-.55, .55]) {
      if (!gate.edges[side < 0 ? 0 : 1]) continue;
      const post = kit.spawn(lampShape), lamp = new Mesh(bulb, gateLamps);
      post.position.set(gate.hinge.x + (gate.alongX ? gate.sign * .12 : side), 0, gate.hinge.z + (gate.alongX ? side : gate.sign * .12)); lamp.position.y = .55; post.add(lamp); group.add(post);
    }
  }

  // ── Portals and ice sheen ──
  const swirl = own(swirlTexture()), portals: Mesh[] = [], disc = own(new PlaneGeometry(.86, .86).rotateX(-Math.PI / 2)), band = own(new RingGeometry(.3, .44, 40).rotateX(-Math.PI / 2));
  const PORTAL_COLORS = ['#b77dff', '#1fd6bd', '#ff9a4a', '#ff6fae'];
  map.tiles.filter(tile => tile.kind === 'portal').forEach(tile => {
    const pair = Math.floor(map.tiles.filter(other => other.kind === 'portal' && other.index < Math.min(tile.index, tile.pair ?? tile.index)).length / 2);
    // Normal blending keeps each pair's colour distinct over the pad's own glow, so players can see which portals link.
    const color = PORTAL_COLORS[pair % PORTAL_COLORS.length], mesh = new Mesh(disc, own(new MeshBasicMaterial({ map: swirl, color, transparent: true, depthWrite: false })));
    mesh.add(new Mesh(band, own(new MeshBasicMaterial({ color, toneMapped: false }))));
    mesh.position.set(tile.x, .07, tile.z); group.add(mesh); portals.push(mesh);
  });
  let sheen: Texture | undefined;
  if (iceTiles.length) {
    sheen = own(sheenTexture());
    const overlay = own(new InstancedMesh(own(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), own(new MeshBasicMaterial({ map: sheen, transparent: true, opacity: .5, blending: AdditiveBlending, depthWrite: false })), iceTiles.length));
    iceTiles.forEach((tile, i) => overlay.setMatrixAt(i, at(tile.x, .006, tile.z)));
    group.add(overlay);
  }
  const flames = new Instances(flameTemplate, Math.max(1, stoves), own, false);
  group.add(flames.group);
  return { group, anchors, gates, gateLamps, portals, sheen, belts: [kit.beltMaterial.map!], water, flames, flameY: flameTemplate.box.min.y } satisfies Diorama;
}
