/**
 * Fallback pieces built from primitives, used when a GLB bundle or node is missing. Same slot
 * names, origin (bottom centre) and sizes as EXPERIENCE §1.5, so swapping in the models changes
 * nothing else. Colours in slot names ('#rrggbb') are fixed colours.
 */
import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, ExtrudeGeometry,
  Float32BufferAttribute, IcosahedronGeometry, Matrix4, OctahedronGeometry, Quaternion, Shape, SphereGeometry,
  Vector2, Vector3,
} from 'three';
import type { Part } from './kit';

const OUTLINE = 0.014;
type Spec = {
  g: BufferGeometry; role: string; at?: [number, number, number]; yaw?: number; line?: boolean; tag?: string;
};

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d).translate(0, h / 2, 0);
const cyl = (r: number, h: number, n = 10, top = r) =>
  new CylinderGeometry(top, r, h, n).translate(0, h / 2, 0);
const cone = (r: number, h: number, n = 8) => new ConeGeometry(r, h, n).translate(0, h / 2, 0);

/** Gable roof: a triangle facing the camera (+z), extruded north–south. */
function gable(w: number, h: number, d: number) {
  const shape = new Shape([new Vector2(-w / 2, 0), new Vector2(w / 2, 0), new Vector2(0, h)]);
  return new ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

/** Baked blob shadow: a fan whose vertex alpha falls from 0.35 to 0, like the GLB `_shadow` nodes. */
function blob(rx: number, rz = rx, n = 14): BufferGeometry {
  const position: number[] = [], color: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    position.push(0, 0.002, 0, Math.cos(b) * rx, 0.002, Math.sin(b) * rz);
    position.push(Math.cos(a) * rx, 0.002, Math.sin(a) * rz);
    color.push(0, 0, 0, 0.35, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(position, 3));
  g.setAttribute('color', new Float32BufferAttribute(color, 4));
  return g;
}

/** Inverted hull: the part scaled about its box centre so the rim is OUTLINE thick. */
function hull(g: BufferGeometry, matrix: Matrix4, role: string): Part {
  g.computeBoundingBox();
  const b = g.boundingBox!, size = b.getSize(new Vector3()), centre = b.getCenter(new Vector3());
  const s = new Vector3(1 + (2 * OUTLINE) / size.x, 1 + (2 * OUTLINE) / size.y, 1 + (2 * OUTLINE) / size.z);
  const around = new Matrix4().makeTranslation(centre.x, centre.y, centre.z)
    .multiply(new Matrix4().makeScale(s.x, s.y, s.z))
    .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  return { geometry: g, role, matrix: matrix.clone().multiply(around) };
}

function build(specs: Spec[], shadow: [number, number], cream = false): Part[] {
  const parts: Part[] = [];
  for (const { g, role, at = [0, 0, 0], yaw = 0, line = true, tag } of specs) {
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const matrix = new Matrix4().compose(new Vector3(...at), turn, new Vector3(1, 1, 1));
    const tags = tag ? [tag] : [];
    parts.push({ geometry: g, role, matrix, tags });
    if (line) parts.push({ ...hull(g, matrix, cream ? 'outline_cream' : 'outline'), tags });
  }
  parts.push({ geometry: blob(...shadow), role: 'shadow', matrix: new Matrix4() });
  return parts;
}

const plinth = (r: number): Spec => ({ g: cyl(r, 0.025, 12), role: 'ink', line: false });
const house = (w: number, d: number, wall: number, x = 0, y = 0.025): Spec[] => [
  { g: box(w, wall, d), role: 'seat', at: [x, y, 0] },
  { g: gable(w + 0.04, 0.14, d + 0.04), role: 'seat_dark', at: [x, y + wall, 0] },
];

const NODES: Record<string, () => Part[]> = {
  settlement: () => build([plinth(0.2), ...house(0.28, 0.24, 0.2)], [0.27, 0.24]),
  harbor: () => build([plinth(0.2), ...house(0.28, 0.24, 0.2),
    { g: box(0.22, 0.03, 0.08), role: 'wood', at: [0, 0.02, -0.2] },
    { g: cyl(0.015, 0.4, 6), role: 'wood', at: [0.17, 0, 0.1], line: false },
    { g: new SphereGeometry(0.04, 8, 6), role: 'glow', at: [0.17, 0.42, 0.1], line: false }], [0.3, 0.26]),
  city: () => build([
    { g: box(0.58, 0.025, 0.42), role: 'ink', line: false },
    ...house(0.34, 0.3, 0.24, -0.1),
    { g: box(0.18, 0.44, 0.18), role: 'seat', at: [0.16, 0.025, 0] },
    { g: cone(0.15, 0.14, 4), role: 'seat_dark', at: [0.16, 0.465, 0], yaw: Math.PI / 4 },
  ], [0.4, 0.3]),
  road: () => build([
    { g: box(0.54, 0.05, 0.12), role: 'seat_dark' },
    { g: box(0.5, 0.04, 0.09), role: 'seat', at: [0, 0.05, 0], line: false },
  ], [0.34, 0.1]),
  ship: () => build([
    { g: box(0.52, 0.1, 0.18), role: 'seat' },
    { g: cyl(0.015, 0.34, 6), role: 'wood', at: [0, 0.1, 0], line: false },
    { g: box(0.24, 0.24, 0.02), role: 'sail', at: [0, 0.18, 0] },
  ], [0.34, 0.14]),
  robber: () => build([
    { g: cyl(0.17, 0.44, 12, 0.07), role: '#463a5c' },
    { g: new SphereGeometry(0.11, 12, 8).translate(0, 0.49, 0), role: '#352b47' },
    { g: box(0.12, 0.03, 0.02), role: 'glow', at: [0, 0.48, 0.1], line: false },
  ], [0.21, 0.21], true),
  pirate: () => build([
    { g: box(0.6, 0.12, 0.22), role: '#2a2433' },
    { g: cyl(0.015, 0.5, 6), role: 'wood', at: [0, 0.12, 0], line: false },
    { g: box(0.3, 0.3, 0.02), role: '#141019', at: [0, 0.22, 0] },
  ], [0.38, 0.16], true),
  // Module pieces with no Blender node: camel (Caravans), pirate lair and council hall (E&P), crate.
  camel: () => build([
    { g: box(0.26, 0.09, 0.1), role: '#c99a5b', at: [0, 0.1, 0] },
    { g: new SphereGeometry(0.05, 8, 6).scale(1, 1.2, 1), role: '#b3834a', at: [-0.03, 0.2, 0] },
    { g: box(0.05, 0.14, 0.05), role: '#c99a5b', at: [0.13, 0.12, 0] },
    { g: box(0.09, 0.05, 0.05), role: '#c99a5b', at: [0.16, 0.24, 0] },
    ...[-0.09, 0.09].map((x): Spec => ({ g: box(0.03, 0.1, 0.08), role: '#8a5a36', at: [x, 0, 0] })),
  ], [0.2, 0.09]),
  lair: () => build([
    { g: cyl(0.36, 0.1, 9, 0.3), role: '#5b5f6e' },
    { g: cone(0.22, 0.26, 6), role: '#474a57', at: [-0.08, 0.1, -0.08] },
    { g: cyl(0.012, 0.3, 5), role: 'wood', at: [0.14, 0.1, -0.02], line: false },
    { g: box(0.14, 0.09, 0.01), role: '#141019', at: [0.21, 0.3, -0.02], tag: 'pirate' },
    { g: box(0.14, 0.09, 0.01), role: 'seat', at: [0.21, 0.3, -0.02], tag: 'claimed' },
  ], [0.42, 0.38]),
  council: () => build([
    { g: cyl(0.3, 0.05, 10), role: 'stone' },
    ...[0, 1, 2, 3, 4, 5].map((i): Spec => ({
      g: cyl(0.03, 0.24, 6), role: 'cream', line: false,
      at: [Math.cos((i * Math.PI) / 3) * 0.22, 0.05, Math.sin((i * Math.PI) / 3) * 0.22],
    })),
    { g: cyl(0.28, 0.05, 10), role: 'stone', at: [0, 0.29, 0] },
    { g: new SphereGeometry(0.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), role: '#28c6e7', at: [0, 0.34, 0] },
  ], [0.36, 0.36]),
  crate: () => build([{ g: box(0.1, 0.1, 0.1), role: 'cargo' }], [0.07, 0.07]),
};

/** Prop fallbacks: [geometry, colour] per piece, no outline, small shadow. */
const PROPS: Record<string, () => Spec[]> = {
  prop_pine: () => [{ g: cone(0.1, 0.2, 6).translate(0, 0.03, 0), role: '#2f6b40' },
    { g: cyl(0.02, 0.04, 5), role: '#6b4a2e' }],
  prop_round_tree: () => [{ g: new IcosahedronGeometry(0.08).translate(0, 0.12, 0), role: '#3d7a4a' },
    { g: cyl(0.02, 0.06, 5), role: '#6b4a2e' }],
  prop_sheep: () => [{ g: box(0.12, 0.07, 0.08).translate(0, 0.02, 0), role: '#fff6e5' },
    { g: box(0.04, 0.04, 0.04), role: '#05071a', at: [0.07, 0.06, 0] }],
  prop_wheat: () => [{ g: cyl(0.03, 0.14, 5), role: '#efc860' }],
  prop_rock: () => [{ g: new DodecahedronGeometry(0.07).translate(0, 0.04, 0), role: '#a9aec0' }],
  prop_peak: () => [{ g: cone(0.14, 0.26, 5), role: '#a9aec0' },
    { g: cone(0.06, 0.08, 5), role: '#fff6e5', at: [0, 0.2, 0] }],
  prop_bricks: () => [{ g: box(0.14, 0.08, 0.1), role: '#c9754c' }],
  prop_kiln: () => [{ g: cyl(0.07, 0.14, 8, 0.05), role: '#7a3d28' }],
  prop_dune: () => [{ g: new SphereGeometry(0.14, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 0.7),
    role: '#e8d6a6' }],
  prop_cactus: () => [{ g: cyl(0.03, 0.16, 6), role: '#5f8f4e' }],
  prop_nugget: () => [{ g: new OctahedronGeometry(0.05).translate(0, 0.04, 0), role: 'glow' }],
  prop_palm: () => [{ g: cyl(0.02, 0.18, 5), role: '#8a5a36' },
    { g: cone(0.1, 0.05, 6), role: '#3f8f55', at: [0, 0.17, 0] }],
  prop_reeds: () => [{ g: cyl(0.012, 0.14, 4), role: '#6b8a63' }],
  prop_spice: () => [{ g: new SphereGeometry(0.06, 8, 6).translate(0, 0.05, 0), role: '#e0a060' }],
  fog_cloud: () => [{ g: new IcosahedronGeometry(0.22).scale(1.4, 0.55, 1), role: '#d9dde8' }],
};

export function procedural(node: string): Part[] {
  if (NODES[node]) return NODES[node]();
  if (node.startsWith('metropolis')) return NODES.city();
  const props = PROPS[node];
  if (!props) return build([{ g: box(0.12, 0.12, 0.12), role: 'seat' }], [0.12, 0.12]);
  const specs = props().map(s => ({ ...s, line: false }));
  return node === 'fog_cloud' ? build(specs, [0.01, 0.01]).slice(0, -1) : build(specs, [0.13, 0.11]);
}
