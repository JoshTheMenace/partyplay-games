/* Static architecture and stateful map objects. Everything repeated is instanced; everything world-side is
 * patched by the fog so it turns to blueprint when the crew cannot see it. */
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhongMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, BoxGeometry, type Material,
} from 'three';
import type { ResourceScope } from '../../../../party-runtime/src/index';
import { castRay, doorObjects, type Grid } from '../geometry';
import { RADIUS, WALL_HEIGHT, cameraAngle, SIGHT, type Floor, type HeistMap, type MapObject, type PropKind, type View } from '../model';
import type { Kit } from './kit';
import { coneMaterial, coneMesh, fillCone } from './cones';
import type { Fog } from './fog';

const WALLISH = '#%', H = WALL_HEIGHT;
const TILEABLE: readonly PropKind[] = ['bar', 'counter', 'shelf', 'bookcase', 'slot', 'locker', 'flowerbed'];
const CANON: Partial<Record<PropKind, [number, number]>> = { car: [2, 1], van: [2, 2], boat: [3, 2], bed: [1, 2], sofa: [2, 1], bench: [2, 1], piano: [2, 1], roulette: [2, 2], cards: [2, 1], fountain: [2, 2], container: [3, 1], desk: [2, 1], table: [1, 1] };
const FLOOR_COLOUR: Record<Floor, string> = { carpet: '#8e3a52', tile: '#c9d2d6', marble: '#d8ccb6', wood: '#b27b47', grass: '#5b9a45', concrete: '#8d9299', asphalt: '#4a4f5a', deck: '#a8784c', checker: '#efece6' };
const FLOOR_SCALE: Record<Floor, number> = { carpet: 1, tile: 1, marble: .5, wood: 1, grass: .5, concrete: .5, asphalt: .5, deck: 1, checker: 1 };
const dummy = new Object3D(), child = new Object3D(); dummy.add(child);
const CAMERA_IDLE = new Color('#7fe3ff'), CAMERA_SEEING = new Color('#ff3b4e');
const yawOf = (dx: number, dy: number) => Math.atan2(dx, dy);

/* ── procedural textures (greyscale, tinted by vertex colour) ─────────────── */
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
function texture(scope: ResourceScope, size: number, paint: (g: CanvasRenderingContext2D, r: () => number, s: number) => void, seed = 7, height = size) {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = height;
  const g = canvas.getContext('2d')!; paint(g, rng(seed), size);
  const t = scope.own(new CanvasTexture(canvas)); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const grey = (v: number, a = 1) => `rgba(${v * 255 | 0},${v * 255 | 0},${v * 255 | 0},${a})`;
const speckle = (g: CanvasRenderingContext2D, r: () => number, s: number, n: number, lo: number, hi: number, size = 2) => { for (let i = 0; i < n; i++) { g.fillStyle = grey(lo + r() * (hi - lo), .5); g.fillRect(r() * s, r() * s, size, size); } };
const PAINT: Record<Floor, (g: CanvasRenderingContext2D, r: () => number, s: number) => void> = {
  carpet: (g, r, s) => { g.fillStyle = grey(.74); g.fillRect(0, 0, s, s); speckle(g, r, s, 1400, .6, .9, 2); g.strokeStyle = grey(.9, .7); g.lineWidth = 3; g.beginPath(); for (const [a, b] of [[0, s / 2], [s / 2, 0], [s, s / 2], [s / 2, s]]) g.lineTo(a, b); g.closePath(); g.stroke(); g.fillStyle = grey(1, .9); for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); } },
  tile: (g, r, s) => { for (let i = 0; i < 4; i++) { g.fillStyle = grey(.88 + r() * .1); g.fillRect((i % 2) * s / 2, (i >> 1) * s / 2, s / 2, s / 2); } speckle(g, r, s, 300, .8, 1); g.fillStyle = grey(.58); for (const o of [0, s / 2]) { g.fillRect(o, 0, 3, s); g.fillRect(0, o, s, 3); } },
  marble: (g, r, s) => { g.fillStyle = grey(.96); g.fillRect(0, 0, s, s); speckle(g, r, s, 500, .86, 1, 3); for (let i = 0; i < 7; i++) { g.strokeStyle = grey(.6 + r() * .2, .45); g.lineWidth = .8 + r() * 1.6; g.beginPath(); let x = r() * s, y = 0; g.moveTo(x, y); while (y < s) { x += (r() - .5) * 26; y += 10 + r() * 14; g.lineTo(x, y); } g.stroke(); } g.fillStyle = grey(.7); g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); },
  wood: (g, r, s) => { for (let i = 0; i < 4; i++) { const y = i * s / 4, v = .7 + r() * .22; g.fillStyle = grey(v); g.fillRect(0, y, s, s / 4); for (let k = 0; k < 9; k++) { g.fillStyle = grey(v - .08 - r() * .08, .5); g.fillRect(0, y + 2 + r() * (s / 4 - 4), s, 1); } g.fillStyle = grey(.35); g.fillRect(0, y, s, 2); g.fillRect(((i * 37) % 4) * s / 4 + r() * 20, y, 2, s / 4); } },
  grass: (g, r, s) => { g.fillStyle = grey(.62); g.fillRect(0, 0, s, s); for (let i = 0; i < 1400; i++) { const x = r() * s, y = r() * s; g.strokeStyle = grey(.45 + r() * .55, .8); g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 4, y - 3 - r() * 5); g.stroke(); } },
  concrete: (g, r, s) => { g.fillStyle = grey(.86); g.fillRect(0, 0, s, s); speckle(g, r, s, 1800, .7, 1, 2); g.fillStyle = grey(.62); g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); },
  asphalt: (g, r, s) => { g.fillStyle = grey(.78); g.fillRect(0, 0, s, s); speckle(g, r, s, 3200, .5, 1, 2); },
  deck: (g, r, s) => { for (let i = 0; i < 4; i++) { g.fillStyle = grey(.72 + r() * .2); g.fillRect(i * s / 4, 0, s / 4, s); for (let k = 0; k < 6; k++) { g.fillStyle = grey(.55, .4); g.fillRect(i * s / 4 + 3 + r() * (s / 4 - 6), 0, 1, s); } g.fillStyle = grey(.25); g.fillRect(i * s / 4, 0, 3, s); } },
  checker: (g, r, s) => { for (let i = 0; i < 4; i++) { g.fillStyle = grey((i % 2) ^ (i >> 1) ? .2 : .97); g.fillRect((i % 2) * s / 2, (i >> 1) * s / 2, s / 2, s / 2); } speckle(g, r, s, 400, .3, .9, 2); },
};

/* ── merged quads with per-vertex colour ─────────────────────────────────── */
class Quads {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], normal: number[], colour: Color, uvs = [0, 0, 1, 0, 1, 1, 0, 1]) {
    for (const i of [0, 1, 2, 0, 2, 3]) { this.p.push(...[a, b, c, d][i]); this.n.push(...normal); this.uv.push(uvs[i * 2], uvs[i * 2 + 1]); this.c.push(colour.r, colour.g, colour.b); }
  }
  /** Axis box with only the listed faces (n s e w t = −z +z +x −x top). Side UVs run along the face and up the wall. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: string, side: Color, top = side) {
    const v0 = y0 / H, v1 = y1 / H;
    if (faces.includes('t')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top, [.5, .98, .5, .98, .5, .98, .5, .98]);
    if (faces.includes('s')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side, [x0, v0, x1, v0, x1, v1, x0, v1]);
    if (faces.includes('n')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], side, [x1, v0, x0, v0, x0, v1, x1, v1]);
    if (faces.includes('e')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], side, [z1, v0, z0, v0, z0, v1, z1, v1]);
    if (faces.includes('w')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side, [z0, v0, z1, v0, z1, v1, z0, v1]);
  }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new Float32BufferAttribute(this.c, 3));
    return g;
  }
}

function batch(parent: Group, geometry: BufferGeometry, material: Material, count: number) {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, count)); mesh.count = count; mesh.frustumCulled = false; parent.add(mesh);
  const hide = (i: number) => { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.instanceMatrix.needsUpdate = true; };
  return {
    mesh, hide,
    set(i: number, x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1) {
      dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.instanceMatrix.needsUpdate = true;
    },
    /** Child transform (local offset + yaw) of a parent placement. */
    child(i: number, x: number, z: number, yaw: number, lx: number, ly: number, lz: number, lyaw: number) {
      dummy.position.set(x, 0, z); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(1); child.position.set(lx, ly, lz); child.rotation.set(0, lyaw, 0);
      dummy.updateMatrixWorld(true); mesh.setMatrixAt(i, child.matrixWorld); mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

export type World = ReturnType<typeof createWorld>;
export function createWorld(map: HeistMap, kit: Kit, fog: Fog, scope: ResourceScope) {
  const root = new Group(), at = (x: number, y: number) => map.tiles[y]?.[x] ?? ' ';
  const broken = new Set<number>(), tile = (x: number, y: number) => broken.has(y * map.width + x) ? '.' : at(x, y);
  const roomAt = (x: number, y: number) => { for (let i = map.rooms.length - 1; i >= 0; i--) { const r = map.rooms[i]; if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r; } };
  const openSide = (x: number, y: number) => ([[0, 1], [1, 0], [-1, 0], [0, -1]] as const).find(([dx, dy]) => '.,'.includes(at(x + dx, y + dy))) ?? [0, 1];
  /** Front faces away from the nearest wall (safes, terminals, closets stand with their back to it). */
  const faceAway = (x: number, y: number) => { const back = ([[0, -1], [-1, 0], [1, 0], [0, 1]] as const).find(([dx, dy]) => WALLISH.includes(at(x + dx, y + dy))); const [dx, dy] = back ? [-back[0], -back[1]] : openSide(x, y); return yawOf(dx, dy); };
  const outdoor = (x: number, y: number) => at(x, y) === ',' || roomAt(x, y)?.floor === 'grass';
  const own = <T extends { dispose(): void }>(v: T) => scope.own(v);

  /* floors: one merged mesh per floor type, room tint in vertex colours */
  const floorOf = (x: number, y: number): [Floor, string] => {
    const room = roomAt(x, y) ?? [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => roomAt(x + dx, y + dy)).find(Boolean);
    if (at(x, y) === ',' && !room) return [map.outdoor, FLOOR_COLOUR[map.outdoor]];
    if (room) return [room.floor, room.tint ?? FLOOR_COLOUR[room.floor]];
    const floor = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => at(x + dx, y + dy) === ',') ? map.outdoor : 'tile';
    return [floor, FLOOR_COLOUR[floor]];
  };
  /** Water cells plus cells under a moored boat, so the boat floats even though the map stands it on the pier. */
  const afloat = new Set<number>();
  map.tiles.forEach((row, y) => [...row].forEach((c, x) => { if (c === '~') afloat.add(y * map.width + x); }));
  for (const p of map.props) if (p.kind === 'boat') for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) afloat.add((p.y + dy) * map.width + p.x + dx);
  const wet = (x: number, y: number) => afloat.has(y * map.width + x);
  const floors = new Map<Floor, Quads>();
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const c = at(x, y); if (c === ' ' || c === '#' || wet(x, y)) continue;
    const [kind, colour] = floorOf(x, y), q = floors.get(kind) ?? new Quads(), s = FLOOR_SCALE[kind]; floors.set(kind, q);
    q.quad([x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y], [0, 1, 0], new Color(colour), [x * s, (y + 1) * s, (x + 1) * s, (y + 1) * s, (x + 1) * s, y * s, x * s, y * s]);
  }
  for (const [kind, q] of floors) root.add(new Mesh(own(q.geometry()), fog.patch(own(new MeshLambertMaterial({ vertexColors: true, map: texture(scope, 128, PAINT[kind], kind.length * 31) })), { reach: 0, grid: 1 })));

  /* the blueprint sheet the building sits on */
  const sheet = new Mesh(own(new PlaneGeometry(map.width + 80, map.height + 60).rotateX(-Math.PI / 2).translate(map.width / 2, -.2, map.height / 2)), fog.patch(own(new MeshBasicMaterial({ color: '#1b2c52' })), { reach: 0, grid: 1, light: 0 }));
  root.add(sheet);

  /* water: dark teal with drifting moon glints, a pale foam line along every shore, still readable as water in the blueprint */
  const water = new Quads(), foam = new Quads(), W = -.08, F = .14, white = new Color('#ffffff');
  for (const i of afloat) {
    const x = i % map.width, y = Math.floor(i / map.width);
    water.quad([x, W, y + 1], [x + 1, W, y + 1], [x + 1, W, y], [x, W, y], [0, 1, 0], white, [x, y + 1, x + 1, y + 1, x + 1, y, x, y]);
    const dry = (dx: number, dy: number) => { const c = at(x + dx, y + dy); return c !== ' ' && !wet(x + dx, y + dy); };
    if (dry(0, -1)) foam.quad([x, W + .01, y + F], [x + 1, W + .01, y + F], [x + 1, W + .01, y], [x, W + .01, y], [0, 1, 0], white);
    if (dry(0, 1)) foam.quad([x, W + .01, y + 1], [x + 1, W + .01, y + 1], [x + 1, W + .01, y + 1 - F], [x, W + .01, y + 1 - F], [0, 1, 0], white);
    if (dry(-1, 0)) foam.quad([x, W + .01, y + 1], [x + F, W + .01, y + 1], [x + F, W + .01, y], [x, W + .01, y], [0, 1, 0], white);
    if (dry(1, 0)) foam.quad([x + 1 - F, W + .01, y + 1], [x + 1, W + .01, y + 1], [x + 1, W + .01, y], [x + 1 - F, W + .01, y], [0, 1, 0], white);
  }
  const waterTex = texture(scope, 128, (g, r, s) => {
    g.fillStyle = '#123f4c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) { g.strokeStyle = `rgba(${r() < .25 ? '255,236,190' : '120,200,215'},${.15 + r() * .4})`; g.lineWidth = 1 + r() * 1.6; g.beginPath(); const x = r() * s, y = r() * s, l = 8 + r() * 16; g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 3, x + l, y); g.stroke(); }
  }, 3);
  if (water.p.length) {
    root.add(new Mesh(own(water.geometry()), fog.patch(own(new MeshLambertMaterial({ map: waterTex, emissive: '#06212b' })), { reach: 0, keep: .45 })));
    root.add(new Mesh(own(foam.geometry()), fog.patch(own(new MeshBasicMaterial({ color: '#cfeef2', transparent: true, opacity: .55, depthWrite: false })), { reach: 0, keep: .5, light: 0 })));
  }

  /* walls, lintels, rims, glass: rebuilt when cells break */
  const wallTex = texture(scope, 64, (g, r, s) => { g.fillStyle = grey(.9); g.fillRect(0, 0, s, s * 2); speckle(g, r, s, 400, .8, 1, 2); g.fillStyle = grey(.3); g.fillRect(0, s * 2 - 12, s, 12); g.fillStyle = grey(.7); g.fillRect(0, s * .9, s, 3); g.fillStyle = grey(.9); g.fillRect(0, 0, s, 8); }, 5, 128);
  const crackTex = texture(scope, 64, (g, r, s) => {
    g.fillStyle = grey(.82); g.fillRect(0, 0, s, s * 2); speckle(g, r, s, 500, .6, .95, 3);
    for (let i = 0; i < 5; i++) { g.fillStyle = grey(.5 + r() * .15); g.fillRect(r() * s, 20 + r() * 90, 14, 7); }
    g.strokeStyle = grey(.12); g.lineWidth = 2.2; for (let k = 0; k < 3; k++) { g.beginPath(); let x = 10 + r() * 44, y = 10; g.moveTo(x, y); while (y < 118) { x += (r() - .5) * 18; y += 6 + r() * 10; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = grey(.3); g.fillRect(0, s * 2 - 12, s, 12); g.fillStyle = grey(.9); g.fillRect(0, 0, s, 8);
  }, 9, 128);
  const wallMat = fog.patch(own(new MeshLambertMaterial({ vertexColors: true, map: wallTex })), { reach: .55, top: 1 });
  const crackMat = fog.patch(own(new MeshLambertMaterial({ vertexColors: true, map: crackTex })), { reach: .55, top: 1, keep: .15 });
  const rimMat = fog.patch(own(new MeshBasicMaterial({ color: '#f7e6c2' })), { reach: 0, top: 1, line: 1, light: 0 });
  const glassTex = texture(scope, 64, (g, r, s) => { g.fillStyle = grey(.75); g.fillRect(0, 0, s, s); g.fillStyle = grey(1); for (const o of [8, 30]) { g.beginPath(); g.moveTo(o, s); g.lineTo(o + 14, s); g.lineTo(o + 34, 0); g.lineTo(o + 20, 0); g.fill(); } });
  const glassMat = fog.patch(own(new MeshPhongMaterial({ color: '#b5ecff', map: glassTex, transparent: true, opacity: .38, shininess: 140, specular: '#ffffff', depthWrite: false, side: DoubleSide })), { reach: .4, keep: .5 });
  const SIDE = new Color('#c9b69a'), TOP = new Color('#6e645c'), CRACK = new Color('#b8a58a'), METAL = new Color('#3c4250'), SILL = new Color('#8a7f70');
  const walls = new Mesh(undefined, wallMat), cracked = new Mesh(undefined, crackMat), rims = new Mesh(undefined, rimMat), glass = new Mesh(undefined, glassMat);
  glass.renderOrder = 1; root.add(walls, cracked, rims, glass);
  const faceFor = (x: number, y: number) => ([['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]] as const).filter(([, dx, dy]) => !WALLISH.includes(tile(x + dx, y + dy))).map(([f]) => f).join('');
  const horizontal = (x: number, y: number) => '#%=wd'.includes(at(x - 1, y)) && '#%=wd'.includes(at(x + 1, y));
  function buildArchitecture() {
    const w = new Quads(), k = new Quads(), r = new Quads(), gl = new Quads(), T = .06;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const c = tile(x, y), across = horizontal(x, y) ? 'ns' : 'ew';
      if (c === '#' || c === '%') {
        const faces = faceFor(x, y);
        (c === '%' ? k : w).box(x, 0, y, x + 1, H, y + 1, faces + 't', c === '%' ? CRACK : SIDE, TOP);
        const e = H + .004;
        if (faces.includes('n')) r.box(x, H, y, x + 1, e, y + T, 't', SIDE);
        if (faces.includes('s')) r.box(x, H, y + 1 - T, x + 1, e, y + 1, 't', SIDE);
        if (faces.includes('w')) r.box(x, H, y, x + T, e, y + 1, 't', SIDE);
        if (faces.includes('e')) r.box(x + 1 - T, H, y, x + 1, e, y + 1, 't', SIDE);
      } else if (c === 'd') w.box(x, 1.45, y, x + 1, H, y + 1, across + 't', SIDE, TOP);
      else if (c === 'w') { w.box(x, 0, y, x + 1, .52, y + 1, across + 't', SILL); w.box(x, 1.56, y, x + 1, H, y + 1, across + 't', SIDE, TOP); }
      else if (c === '=') {
        const hz = horizontal(x, y), [x0, x1, z0, z1] = hz ? [x, x + 1, y + .42, y + .58] : [x + .42, x + .58, y, y + 1];
        w.box(x0, 0, z0, x1, .1, z1, 'nsewt', METAL); w.box(x0, 1.46, z0, x1, 1.56, z1, 'nsewt', METAL);
        const [g0, g1, h0, h1] = hz ? [x, x + 1, y + .47, y + .53] : [x + .47, x + .53, y, y + 1];
        gl.box(g0, .1, h0, g1, 1.46, h1, hz ? 'ns' : 'ew', new Color('#ffffff'));
      }
    }
    for (const [mesh, q] of [[walls, w], [cracked, k], [rims, r], [glass, gl]] as const) { mesh.geometry.dispose(); mesh.geometry = q.geometry(); }
  }
  scope.defer(() => [walls, cracked, rims, glass].forEach(m => m.geometry.dispose()));
  buildArchitecture();

  /* shared materials */
  const solid = fog.patch(own(new MeshLambertMaterial({ vertexColors: true, flatShading: true })), { reach: .15 });
  const doorMat = fog.patch(own(new MeshLambertMaterial({ vertexColors: true, flatShading: true })), { reach: .35 });
  const loot = fog.patch(own(new MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#3a2600' })), { reach: .1, keep: .9 });
  const glow = (colour: string) => own(new MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  const flat = own(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));

  /* props */
  const placements = new Map<string, [number, number, number, number, number, number][]>();
  for (const p of map.props) {
    const name = `prop_${p.kind}`, list = placements.get(name) ?? []; placements.set(name, list);
    const yaw = -p.rot * Math.PI / 2, odd = p.rot % 2 !== 0;
    if (TILEABLE.includes(p.kind)) { for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) list.push([p.x + dx + .5, 0, p.y + dy + .5, yaw, 1, 1]); continue; }
    const [cw, ch] = CANON[p.kind] ?? [1, 1], cx = p.x + p.w / 2, cz = p.y + p.h / 2;
    if (p.kind === 'painting') { const f = [[0, 1], [-1, 0], [0, -1], [1, 0]][p.rot % 4]; list.push([cx - f[0] * .5, 0, cz - f[1] * .5, yaw, 1, 1]); continue; }
    list.push([cx, 0, cz, yaw, (odd ? p.h : p.w) / cw, (odd ? p.w : p.h) / ch]);
  }
  for (const [name, list] of placements) { const b = batch(root, kit.geometry(name), solid, list.length); list.forEach(([x, y, z, yaw, sx, sz], i) => b.set(i, x, y, z, yaw, sx, 1, sz)); }

  /* objects */
  const byKind = (kind: MapObject['kind']) => map.objects.filter(o => o.kind === kind);
  const place = (kind: MapObject['kind'], name: string, material: Material, filter: (o: MapObject) => boolean = () => true, y = 0) => {
    const list = byKind(kind).filter(filter), b = batch(root, kit.geometry(name), material, list.length);
    list.forEach((o, i) => b.set(i, o.x, y, o.y, faceAway(Math.floor(o.x), Math.floor(o.y)))); return { list, b };
  };
  const safes = place('safe', 'obj_safe', solid), safeDoors = batch(root, kit.geometry('fx_safe_door'), solid, safes.list.length), gold = batch(root, kit.geometry('fx_gold'), loot, safes.list.length);
  const terminals = place('terminal', 'obj_terminal', solid);
  const screenMat = fog.patch(own(new MeshBasicMaterial({ color: '#ffffff' })), { convert: 0, light: 0 }), screens = batch(root, kit.geometry('fx_screen'), screenMat, terminals.list.length);
  terminals.list.forEach((o, i) => screens.set(i, o.x, 0, o.y, faceAway(Math.floor(o.x), Math.floor(o.y))));
  place('vent', 'obj_vent', solid); const medkits = place('medkit', 'obj_medkit', solid);
  place('hide', 'obj_bush', solid, o => outdoor(Math.floor(o.x), Math.floor(o.y))); place('hide', 'obj_closet', solid, o => !outdoor(Math.floor(o.x), Math.floor(o.y)));

  const mounted = (kind: 'camera' | 'laser', name: string) => {
    const list = byKind(kind), b = batch(root, kit.geometry(name), solid, list.length);
    list.forEach((o, i) => { const f = o.facing ?? 0; b.set(i, o.x + Math.cos(f) * .5, 1.3, o.y + Math.sin(f) * .5, Math.PI / 2 - f); });
    return { list, b };
  };
  const cameras = mounted('camera', 'obj_camera'), lasers = mounted('laser', 'obj_laser');
  const cameraCones = cameras.list.map(() => { const m = own(coneMaterial()), mesh = coneMesh(fog.patch(m, { fade: 1, convert: 0, light: 0, reach: 0 })); own(mesh.geometry); root.add(mesh); return mesh; });
  const beamGeo = own(new BoxGeometry(1, .035, .035).translate(.5, 0, 0)), stripGeo = own(new PlaneGeometry(1, .14).rotateX(-Math.PI / 2).translate(.5, 0, 0));
  const beams = lasers.list.map(() => {
    const beam = new Mesh(beamGeo, fog.patch(glow('#ff2a3a'), { fade: 1, convert: 0, light: 0, reach: 0, floor: .25 })), strip = new Mesh(stripGeo, fog.patch(glow('#ff2a3a'), { fade: 1, convert: 0, light: 0, reach: 0 }));
    (strip.material as MeshBasicMaterial).opacity = .35; root.add(beam, strip); return { beam, strip, key: '' };
  });

  /* doors and windows (View.doors order) */
  const openings = doorObjects(map), doorList = openings.filter(o => o.kind === 'door'), windowList = openings.filter(o => o.kind === 'window');
  const windowMat = fog.patch(own(new MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true })), { reach: .45 });
  const doors = batch(root, kit.geometry('obj_door'), doorMat, doorList.length), windows = batch(root, kit.geometry('obj_window'), windowMat, windowList.length);
  const lockMat = own(new MeshBasicMaterial({ color: '#ff4a3a' })), locks = batch(root, own(new BoxGeometry(.14, .16, .2)), lockMat, doorList.length);
  const doorState = doorList.map(o => {
    const base = o.horizontal ? 0 : Math.PI / 2, ax = Math.cos(base), az = -Math.sin(base), hx = o.x - ax * .5, hz = o.y - az * .5;
    const side = (s: number) => { const a = base + s * Math.PI / 2; return '.,'.includes(at(Math.floor(hx + Math.cos(a) * .5 + ax * .3), Math.floor(hz - Math.sin(a) * .5 + az * .3))); };
    return { o, base, hx, hz, swing: side(-1) ? -1.45 : side(1) ? 1.45 : -1.45, angle: 0, target: 0, visible: true, locked: !!o.locked };
  });
  windowList.forEach((o, i) => windows.set(i, o.x, 0, o.y, o.horizontal ? 0 : Math.PI / 2));

  /* objective, exit, coins */
  const objective = map.objects.find(o => o.kind === 'objective')!, exit = map.objects.find(o => o.kind === 'exit')!;
  const pedestal = batch(root, kit.geometry('obj_pedestal'), solid, 1); pedestal.set(0, objective.x, 0, objective.y);
  const item = new Mesh(kit.geometry(`obj_${map.objectiveKind}`), fog.patch(own(new MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#302010' })), { keep: .9 }));
  const halo = new Mesh(flat, glow('#ffd36b')); halo.renderOrder = 2; root.add(item, halo);
  const ringTex = texture(scope, 256, (g, _r, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, s * .1, s / 2, s / 2, s / 2); grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(.75, 'rgba(255,255,255,.18)'); grad.addColorStop(.92, 'rgba(255,255,255,.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s); g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.setLineDash([18, 14]); g.beginPath(); g.arc(s / 2, s / 2, s * .4, 0, 7); g.stroke();
  });
  const exitRing = new Mesh(flat, own(new MeshBasicMaterial({ map: ringTex, color: '#5cffb0', transparent: true, depthWrite: false, blending: AdditiveBlending })));
  exitRing.position.set(exit.x, .03, exit.y); exitRing.scale.setScalar(RADIUS.exit * 2.2); exitRing.renderOrder = 2;
  const columnTex = texture(scope, 16, (g, _r, s) => { const grad = g.createLinearGradient(0, 0, 0, 64); grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = grad; g.fillRect(0, 0, s, 64); }, 1, 64);
  const column = new Mesh(own(new CylinderGeometry(RADIUS.exit, RADIUS.exit, 2.4, 40, 1, true).translate(0, 1.2, 0)), own(new MeshBasicMaterial({ map: columnTex, color: '#5cffb0', transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })));
  column.position.set(exit.x, 0, exit.y); column.renderOrder = 2; root.add(exitRing, column);
  const coinMat = fog.patch(own(new MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#5a3c00' })), { keep: .75, reach: 0 }); coinMat.defines = { NJ_SPIN: '' };
  const coins = batch(root, kit.geometry('obj_coin'), coinMat, map.coins.length);

  /* room names: blueprint annotations that fade where the crew can see */
  const labels = document.createElement('canvas'), L = 32; labels.width = map.width * L; labels.height = map.height * L;
  const lg = labels.getContext('2d')!; lg.fillStyle = '#9cc4ff'; lg.textBaseline = 'top';
  map.rooms.forEach((r, i) => {
    // A room whose corner is covered by a later (nested) room labels its opposite corner instead.
    const covered = map.rooms.slice(i + 1).some(o => r.x >= o.x && r.x < o.x + o.w && r.y >= o.y && r.y < o.y + o.h);
    lg.font = `${L * .42}px 'Lilita One', 'Arial Black', sans-serif`; lg.letterSpacing = `${L * .06}px`; lg.textAlign = covered ? 'right' : 'left';
    lg.fillText(r.name, (covered ? r.x + r.w - .25 : r.x + .25) * L, (r.y + .2) * L, (r.w - .5) * L);
  });
  lg.font = `${L * .5}px 'Lilita One', sans-serif`; lg.fillStyle = '#7dffc0'; lg.textAlign = 'center'; lg.fillText('GETAWAY', exit.x * L, (exit.y + RADIUS.exit + .2) * L);
  const labelTex = own(new CanvasTexture(labels)); labelTex.colorSpace = SRGBColorSpace; labelTex.anisotropy = 8;
  const labelPlane = new Mesh(own(new PlaneGeometry(map.width, map.height).rotateX(-Math.PI / 2).translate(map.width / 2, .012, map.height / 2)), fog.patch(own(new MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, depthTest: false })), { fade: 2, floor: .8, convert: 0, light: 0, reach: 0 }));
  labelPlane.renderOrder = 5; root.add(labelPlane);

  let doorKey: string | null = null, brokenCount = -1, coinKey = '-', objectKey = '-', objectView: View | null | undefined;
  const stateOf = (view: View, id: string) => { for (const s of view.objects) if (s.id === id) return s; };
  const pulse = new Color();
  return {
    root, objective,
    sync(view: View | null, grid: Grid, now: number, dt: number, reduced: boolean, intelCameras: ReadonlySet<string>) {
      const t = performance.now() / 1000;
      if (view && view.broken.length !== brokenCount) { brokenCount = view.broken.length; broken.clear(); view.broken.forEach(i => broken.add(i)); buildArchitecture(); }
      const doorString = view?.doors ?? '';
      if (doorString !== doorKey) {
        doorKey = doorString; let d = 0;
        openings.forEach((o, n) => {
          const s = doorString[n] ?? (o.locked ? 'l' : 'c');
          if (o.kind === 'window') { const i = windowList.indexOf(o); if (s === 'b') windows.hide(i); else windows.set(i, o.x, 0, o.y, o.horizontal ? 0 : Math.PI / 2); return; }
          const st = doorState[d++]; st.target = s === 'o' ? st.swing : 0; st.visible = s !== 'b'; st.locked = s === 'l';
        });
      }
      doorState.forEach((st, i) => {
        st.angle += (st.target - st.angle) * (reduced ? 1 : 1 - Math.exp(-dt * 10));
        if (!st.visible) { doors.hide(i); locks.hide(i); return; }
        const a = st.base + st.angle;
        doors.set(i, st.hx + Math.cos(a) * .5, 0, st.hz - Math.sin(a) * .5, a);
        if (st.locked) locks.child(i, st.o.x, st.o.y, st.base, .3, .75, 0, 0); else locks.hide(i);
      });
      const coinString = view?.coins ?? '';
      if (coinString !== coinKey) { coinKey = coinString; map.coins.forEach((c, i) => coinString[i] === '0' ? coins.hide(i) : coins.set(i, c.x, 0, c.y)); }
      if (!reduced) { fog.shared.njSpin.value += dt * 2.4; waterTex.offset.set(t * .02, Math.sin(t * .4) * .06); }

      // Stateful objects: only touch instances when their state string changes.
      const key = view === objectView ? objectKey : view ? view.objects.map(s => s.state).join('') : '';
      objectView = view;
      if (key !== objectKey) {
        objectKey = key;
        safes.list.forEach((o, i) => { const s = view && stateOf(view, o.id)?.state, yaw = faceAway(Math.floor(o.x), Math.floor(o.y)); if (!s || s === 'ready') { safeDoors.hide(i); gold.hide(i); return; } safeDoors.child(i, o.x, o.y, yaw, -.32, 0, .37, -1.9); if (s === 'open') gold.child(i, o.x, o.y, yaw, 0, .02, .05, 0); else gold.hide(i); });
        terminals.list.forEach((o, i) => screens.mesh.setColorAt(i, pulse.set(view && stateOf(view, o.id)?.state !== 'ready' && stateOf(view, o.id) ? '#1b2533' : '#7df3ff')));
        if (screens.mesh.instanceColor) screens.mesh.instanceColor.needsUpdate = true;
        medkits.list.forEach((o, i) => { const s = view && stateOf(view, o.id)?.state; if (s === 'used' || s === 'empty') medkits.b.hide(i); else medkits.b.set(i, o.x, 0, o.y, faceAway(Math.floor(o.x), Math.floor(o.y))); });
      }
      const smoke = view?.smoke ?? [], beamKey = `${doorKey}${brokenCount}`;
      cameras.list.forEach((o, i) => {
        const s = view && stateOf(view, o.id), off = !!s && s.state !== 'ready', a = cameraAngle(o, now), f = o.facing ?? 0, meter = Math.min(1, (s?.progress ?? 0) * 4);
        cameras.b.set(i, o.x + Math.cos(f) * .5, 1.3, o.y + Math.sin(f) * .5, Math.PI / 2 - a);
        const cone = cameraCones[i]; cone.visible = !off;
        // Same origin as security.ts (the camera cell centre); the wall cell itself never blocks and hides the tip.
        if (!off) { fillCone(cone, grid, smoke, now, o.x, o.y, a - SIGHT.cameraHalfAngle, a + SIGHT.cameraHalfAngle, SIGHT.cameraRange, pulse.lerpColors(CAMERA_IDLE, CAMERA_SEEING, meter), .05, .14 + .14 * meter, .5 + .3 * meter); (cone.material as Material).userData.nj.njB.value.y = intelCameras.has(o.id) ? .7 : 0; }
      });
      lasers.list.forEach((o, i) => {
        const off = !!view && (stateOf(view, o.id)?.state ?? 'ready') !== 'ready', f = o.facing ?? 0, b = beams[i];
        b.beam.visible = b.strip.visible = !off;
        (b.beam.material as MeshBasicMaterial).userData.nj.njB.value.y = intelCameras.has(o.id) ? .8 : .25;
        if (off || b.key === beamKey) return;
        b.key = beamKey; const sx = o.x + Math.cos(f) * .55, sz = o.y + Math.sin(f) * .55, len = castRay(grid, sx, sz, Math.cos(f), Math.sin(f), 40) + .05;
        b.beam.position.set(sx, 1.3, sz); b.beam.rotation.y = -f; b.beam.scale.set(len, 1, 1); b.strip.position.set(sx, .03, sz); b.strip.rotation.y = -f; b.strip.scale.set(len, 1, 1);
      });
      for (const b of beams) (b.beam.material as MeshBasicMaterial).opacity = reduced ? .9 : .7 + .3 * Math.sin(t * 9);

      // Objective on its pedestal, dropped on the floor, or carried (drawn with the thief).
      const obj = view?.objective, carried = !!obj?.carrier, dropped = !!obj?.taken && !carried;
      item.visible = !carried; halo.visible = !carried;
      const bob = reduced ? 0 : Math.sin(t * 2.2) * .04;
      if (dropped) { item.position.set(obj!.x, -.7, obj!.y); item.rotation.y = 0; } else { item.position.set(objective.x, .03 + bob, objective.y); item.rotation.y = reduced ? 0 : t * .6; }
      halo.position.set(dropped ? obj!.x : objective.x, .04, dropped ? obj!.y : objective.y); halo.scale.setScalar(1.6 + (reduced ? 0 : Math.sin(t * 3) * .15));
      (halo.material as MeshBasicMaterial).opacity = .35 + (reduced ? 0 : Math.sin(t * 3) * .1);

      const escape = view?.phase === 'escape', beat = reduced ? .5 : .5 + .5 * Math.sin(t * (escape ? 6 : 2));
      exitRing.rotation.y = reduced ? 0 : t * .25; exitRing.scale.setScalar(RADIUS.exit * 2.2 * (escape ? 1 + beat * .06 : 1));
      (exitRing.material as MeshBasicMaterial).opacity = escape ? .75 + beat * .25 : .45 + beat * .15;
      column.visible = escape; (column.material as MeshBasicMaterial).opacity = .25 + beat * .25;
    },
  };
}
