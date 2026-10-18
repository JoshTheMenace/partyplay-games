/**
 * Mob, animal and player rigs. GLB models from the art pipeline are used when present (named pivot nodes at the
 * joints); a procedural blocky rig with the same pivots stands in for anything missing, so the game never shows
 * an empty entity. Attachments (armor, villager outfits) are extra boxes placed on the pivots in MC pixel units.
 */
import { BoxGeometry, Color, DataTexture, Group, Mesh, MeshLambertMaterial, NearestFilter, RGBAFormat, SRGBColorSpace, Vector3, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { armorOf } from '../../shared/items';
import { MOB_TYPES } from '../../shared/protocol';
import { ARMOR_BOXES, armorGeometry, armorSheet, texturePixels, VILLAGER_MODELS, type ArmorMaterial } from '../art/atlas';
import { hash } from '../art/pixels';

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Pivot = 'head' | 'body' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r' | 'leg_fl' | 'leg_fr' | 'leg_bl' | 'leg_br' | 'wool'
  | 'leg_0' | 'leg_1' | 'leg_2' | 'leg_3' | 'leg_4' | 'leg_5' | 'leg_6' | 'leg_7' | 'leg_8' | 'face_idle' | 'face_shoot'
  | 'jaw' | `rods_ring_${0 | 1 | 2}` | `seg_${0 | 1 | 2 | 3}` | `neck_${0 | 1 | 2 | 3 | 4}` | `tail_${Digit}` | 'wing_l' | 'wing_r' | 'wingtip_l' | 'wingtip_r'
  | 'frame_outer' | 'frame_inner' | 'core' | 'base';
/**
 * 'ghast': a floating head with nine tentacles (leg_0..8) and two faces; 'block': a single textured cube (primed TNT).
 * Endgame: 'blaze' (head over three spinning rings of rods), 'enderman' (humanoid pivots plus a jaw in the head),
 * 'silverfish' (body segments seg_0..3, head first), 'dragon' (body; chained neck_0..4 → head → jaw and tail_0..9;
 * wing_l/r → wingtip_l/r; four legs) and 'crystal' (nested frames around a core over a base).
 */
export type RigKind = 'humanoid' | 'quadruped' | 'spider' | 'creeper' | 'chicken' | 'ghast' | 'block' | 'blaze' | 'enderman' | 'silverfish' | 'dragon' | 'crystal';
/** Mob keys, the player, and one villager model per profession (VILLAGER_MODELS[p]; plain 'villager' is the farmer). */
export type ModelKey = typeof MOB_TYPES[number]['key'] | 'player' | typeof VILLAGER_MODELS[number];

/** One placed entity model: pivots for animation, per-instance materials for light/hurt tinting. */
export type Rig = {
  /** `ModelLibrary.version` when built: an older rig is swapped once its GLB arrives. */
  root: Group; kind: RigKind; version: number; pivots: Partial<Record<Pivot, Object3D>>;
  /** `glow`: self-lit (materials named eyes/glow/core: the enderman's and dragon's eyes, a crystal's core). */
  materials: { material: MeshLambertMaterial; base: Color; shirt: boolean; glow: boolean }[];
  /** Metres per model pixel inside the pivots (humanoids are 32 px tall), for attachments. */
  unit: number;
  /** A procedural stand-in (its GLB has not arrived or does not exist). */
  fallback: boolean;
};

export const RIG_KIND: Record<ModelKey, RigKind> = {
  player: 'humanoid', zombie: 'humanoid', skeleton: 'humanoid', creeper: 'creeper', spider: 'spider', cow: 'quadruped', pig: 'quadruped', sheep: 'quadruped', chicken: 'chicken',
  villager: 'humanoid', zombified_piglin: 'humanoid', ghast: 'ghast', tnt: 'block',
  villager_librarian: 'humanoid', villager_armorer: 'humanoid', villager_toolsmith: 'humanoid', villager_cleric: 'humanoid', villager_mason: 'humanoid',
  blaze: 'blaze', enderman: 'enderman', ender_dragon: 'dragon', end_crystal: 'crystal', silverfish: 'silverfish',
};
/** Model for a villager of profession p (0 farmer .. 5 mason). */
export const villagerModel = (p: number): ModelKey => VILLAGER_MODELS[p] ?? 'villager';

/** Accepted node names per pivot (the art pipeline's names first, older model names after). */
export function pivotAliases(pivot: Pivot, kind: RigKind): string[] {
  const side = (s: string) => s === 'l' ? 'left' : 'right';
  if (pivot === 'arm_l' || pivot === 'arm_r') return [pivot, `arm_${side(pivot.slice(4))}`];
  // Two-legged rigs (chicken) may number their legs.
  if (pivot === 'leg_l' || pivot === 'leg_r') return [pivot, `leg_${side(pivot.slice(4))}`, pivot === 'leg_l' ? 'leg_0' : 'leg_1'];
  const quad = ['leg_fl', 'leg_fr', 'leg_bl', 'leg_br'].indexOf(pivot);
  if (quad >= 0) return [pivot, `leg_${quad}`];
  if (pivot.startsWith('leg_') && kind === 'spider') {
    const i = Number(pivot.slice(4));
    return [pivot, i < 4 ? `leg_left_${i}` : `leg_right_${i - 4}`];
  }
  if (pivot === 'wool') return ['wool', 'coat'];
  if (pivot.startsWith('leg_') && kind === 'ghast') return [pivot, `tentacle_${pivot.slice(4)}`];
  return [pivot];
}
/** Blender appends `.001` to duplicate names; ignore that suffix and case. */
export const baseName = (name: string) => name.toLowerCase().replace(/\.\d+$/, '');

const PIVOTS: Record<RigKind, Pivot[]> = {
  humanoid: ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r'],
  creeper: ['head', 'body', 'leg_fl', 'leg_fr', 'leg_bl', 'leg_br'],
  quadruped: ['head', 'body', 'leg_fl', 'leg_fr', 'leg_bl', 'leg_br', 'wool'],
  chicken: ['head', 'body', 'leg_l', 'leg_r', 'arm_l', 'arm_r'],
  spider: ['head', 'body', 'leg_0', 'leg_1', 'leg_2', 'leg_3', 'leg_4', 'leg_5', 'leg_6', 'leg_7'],
  ghast: ['head', 'body', 'leg_0', 'leg_1', 'leg_2', 'leg_3', 'leg_4', 'leg_5', 'leg_6', 'leg_7', 'leg_8', 'face_idle', 'face_shoot'],
  block: ['body'],
  blaze: ['head', 'body', 'rods_ring_0', 'rods_ring_1', 'rods_ring_2'],
  enderman: ['head', 'body', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'jaw'],
  silverfish: ['seg_0', 'seg_1', 'seg_2', 'seg_3'],
  dragon: ['body', 'head', 'jaw', 'neck_0', 'neck_1', 'neck_2', 'neck_3', 'neck_4', ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `tail_${i}` as Pivot),
    'wing_l', 'wing_r', 'wingtip_l', 'wingtip_r', 'leg_fl', 'leg_fr', 'leg_bl', 'leg_br'],
  crystal: ['frame_outer', 'frame_inner', 'core', 'base'],
};

function findPivots(root: Object3D, kind: RigKind) {
  const byName = new Map<string, Object3D>();
  root.traverse(node => { if (node.name && !byName.has(baseName(node.name))) byName.set(baseName(node.name), node); });
  const pivots: Rig['pivots'] = {};
  for (const pivot of PIVOTS[kind]) for (const alias of pivotAliases(pivot, kind)) {
    const node = byName.get(alias);
    if (node) { pivots[pivot] = node; break; }
  }
  return pivots;
}

/** Material names that light themselves (eyes, the blaze's rods, a crystal's core). */
const GLOW = /eyes|glow|core/i;
/** Give an instance its own Lambert materials (keeps map/vertex colours). Fallback rigs already own theirs (`copy` false). */
function ownMaterials(root: Object3D, copy: boolean): Rig['materials'] {
  const out: Rig['materials'] = [], copies = new Map<Material, MeshLambertMaterial>();
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const convert = (m: Material) => {
      let own = copies.get(m);
      if (!own && !copy && m instanceof MeshLambertMaterial) own = m;
      if (!own) {
        const source = m as Material & { map?: MeshLambertMaterial['map']; color?: Color; vertexColors?: boolean };
        own = new MeshLambertMaterial({ map: source.map ?? null, vertexColors: source.vertexColors ?? false, color: source.color?.clone() ?? new Color(1, 1, 1), transparent: m.transparent, alphaTest: m.alphaTest, side: m.side });
        own.name = m.name;
        // Self-lit parts glow in their own texture's colours (the entity tint sets the emissive strength).
        if (GLOW.test(m.name)) own.emissiveMap = own.map;
      }
      if (!copies.has(m)) {
        copies.set(m, own);
        out.push({ material: own, base: own.color.clone(), shirt: /shirt/i.test(m.name) || /shirt/i.test(node.name), glow: GLOW.test(m.name) });
      }
      return own;
    };
    node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
  });
  return out;
}

// Procedural fallback -------------------------------------------------------------------------------------------
/**
 * A box on a pivot (`size` null = an empty group, e.g. a ghast face); `tex` = block texture keys for +X, -X, +Y, -Y, +Z, -Z.
 * `glow` names the material so it lights itself (eyes); `opacity` < 1 makes it see-through (a crystal's glass).
 */
type Part = {
  pivot: Pivot | 'eye' | 'snout'; size: [number, number, number] | null; at: [number, number, number]; offset: [number, number, number]; color: number;
  shirt?: boolean; parent?: Pivot; tex?: readonly string[]; glow?: boolean; opacity?: number;
};
const SKIN = 0xc68e6a, PANTS = 0x3b4a8c;
function humanoid(skin: number, shirt: number, pants: number, thin = false): Part[] {
  const limb = thin ? 0.14 : 0.25;
  return [
    { pivot: 'leg_l', size: [limb, 0.75, limb], at: [-0.125, 0.75, 0], offset: [0, -0.375, 0], color: pants },
    { pivot: 'leg_r', size: [limb, 0.75, limb], at: [0.125, 0.75, 0], offset: [0, -0.375, 0], color: pants },
    { pivot: 'body', size: [0.5, 0.75, 0.25], at: [0, 0.75, 0], offset: [0, 0.375, 0], color: shirt, shirt: true },
    { pivot: 'arm_l', size: [limb, 0.75, limb], at: [-0.375, 1.375, 0], offset: [0, -0.3, 0], color: skin },
    { pivot: 'arm_r', size: [limb, 0.75, limb], at: [0.375, 1.375, 0], offset: [0, -0.3, 0], color: skin },
    { pivot: 'head', size: [0.5, 0.5, 0.5], at: [0, 1.5, 0], offset: [0, 0.25, 0], color: skin },
    { pivot: 'eye', parent: 'head', size: [0.12, 0.06, 0.02], at: [-0.11, 0.26, -0.255], offset: [0, 0, 0], color: 0x1d1d2a },
    { pivot: 'eye', parent: 'head', size: [0.12, 0.06, 0.02], at: [0.11, 0.26, -0.255], offset: [0, 0, 0], color: 0x1d1d2a },
  ];
}
function quadruped(body: number, head: number, h: number, woolly = false): Part[] {
  const leg = h * 0.42, parts: Part[] = [
    { pivot: 'body', size: [0.62, 0.55, 1.05], at: [0, leg, 0], offset: [0, 0.3, 0], color: body },
    { pivot: 'head', size: [0.45, 0.45, 0.4], at: [0, leg + 0.45, -0.5], offset: [0, 0.05, -0.2], color: head },
    { pivot: 'snout', parent: 'head', size: [0.26, 0.16, 0.06], at: [0, -0.05, -0.43], offset: [0, 0, 0], color: 0x8a6e5a },
    ...(['leg_fl', 'leg_fr', 'leg_bl', 'leg_br'] as const).map((pivot, i): Part => ({ pivot, size: [0.22, leg, 0.22], at: [i % 2 ? 0.18 : -0.18, leg, i < 2 ? -0.35 : 0.35], offset: [0, -leg / 2, 0], color: head })),
  ];
  if (woolly) parts.push({ pivot: 'wool', size: [0.78, 0.68, 1.15], at: [0, leg, 0], offset: [0, 0.3, 0], color: 0xf2f0ea });
  return parts;
}
/** A face detail box on a head's front (-Z) at z = -front. */
const facePart = (parent: Pivot, x: number, y: number, w: number, h: number, front: number, color: number): Part =>
  ({ pivot: 'eye', parent, size: [w, h, 0.02], at: [x, y, -front - 0.01], offset: [0, 0, 0], color });
/** Villager: a taller head with the big nose, and a robe (the shirt material, tinted by profession) down to the knees. */
function villager(): Part[] {
  const skin = 0xb98a68, parts = humanoid(skin, 0x7a5c3a, 0x4a3524).filter(part => part.pivot !== 'eye' && part.pivot !== 'head');
  return [...parts,
    { pivot: 'head', size: [0.5, 0.625, 0.5], at: [0, 1.5, 0], offset: [0, 0.31, 0], color: skin },
    { pivot: 'snout', parent: 'head', size: [0.125, 0.25, 0.125], at: [0, 0.2, -0.31], offset: [0, 0, 0], color: 0xa77a5c },
    facePart('head', -0.11, 0.34, 0.1, 0.06, 0.25, 0x2e5c2a), facePart('head', 0.11, 0.34, 0.1, 0.06, 0.25, 0x2e5c2a),
    facePart('head', 0, 0.46, 0.36, 0.05, 0.25, 0x5a3a26),
    { pivot: 'eye', parent: 'body', size: [0.54, 0.4, 0.3], at: [0, -0.2, 0], offset: [0, 0, 0], color: 0x7a5c3a, shirt: true },
  ];
}
/** Zombified piglin: pink, part rotten, with a snout, floppy ears and a loincloth. */
function piglin(): Part[] {
  const skin = 0xe39a92;
  return [...humanoid(skin, 0x6e5634, 0x5c4a34).map((part): Part => part.pivot === 'head' ? { ...part, size: [0.62, 0.5, 0.5] } : part),
    { pivot: 'snout', parent: 'head', size: [0.25, 0.16, 0.08], at: [0, 0.14, -0.28], offset: [0, 0, 0], color: 0xd08480 },
    { pivot: 'eye', parent: 'head', size: [0.06, 0.24, 0.14], at: [-0.34, 0.26, 0], offset: [0, 0, 0], color: 0xd7867e },
    { pivot: 'eye', parent: 'head', size: [0.06, 0.24, 0.14], at: [0.34, 0.26, 0], offset: [0, 0, 0], color: 0xd7867e },
    { pivot: 'eye', parent: 'head', size: [0.2, 0.3, 0.02], at: [0.18, 0.25, 0.26], offset: [0, 0, 0], color: 0x6f8f4e },
    { pivot: 'eye', parent: 'body', size: [0.2, 0.3, 0.14], at: [0.08, 0.35, -0.08], offset: [0, 0, 0], color: 0x9fb0a0 },
  ];
}
/** Ghast: a 16 px (3.2 m) head floating over nine tentacles, with a sleepy face and a crying, open-mouthed firing face. */
function ghast(): Part[] {
  const size = 3.2, bottom = 0.9, front = size / 2, white = 0xefefec;
  return [
    { pivot: 'body', size: null, at: [0, bottom, 0], offset: [0, 0, 0], color: white },
    { pivot: 'head', size: [size, size, size], at: [0, bottom, 0], offset: [0, size / 2, 0], color: white },
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i): Part => {
      const length = 0.9 + hash(i, 3, 17) * 0.8;
      return { pivot: `leg_${i}` as Pivot, parent: 'head', size: [0.3, length, 0.3], at: [(i % 3 - 1) * 1.05, 0, (Math.floor(i / 3) - 1) * 1.05], offset: [0, -length / 2, 0], color: 0xe6e6e2 };
    }),
    { pivot: 'face_idle', parent: 'head', size: null, at: [0, size / 2, 0], offset: [0, 0, 0], color: 0 },
    facePart('face_idle', -0.62, 0.25, 0.55, 0.12, front, 0x3a3a3a), facePart('face_idle', 0.62, 0.25, 0.55, 0.12, front, 0x3a3a3a),
    facePart('face_idle', 0, -0.6, 0.5, 0.12, front, 0x3a3a3a),
    { pivot: 'face_shoot', parent: 'head', size: null, at: [0, size / 2, 0], offset: [0, 0, 0], color: 0 },
    facePart('face_shoot', -0.62, 0.25, 0.55, 0.45, front, 0x2a1616), facePart('face_shoot', 0.62, 0.25, 0.55, 0.45, front, 0x2a1616),
    facePart('face_shoot', -0.62, -0.08, 0.14, 0.4, front + 0.005, 0xb8323a), facePart('face_shoot', 0.62, -0.08, 0.14, 0.4, front + 0.005, 0xb8323a),
    facePart('face_shoot', 0, -0.62, 0.8, 0.55, front, 0x160c0c),
  ];
}
/** Blaze: a glowing head over three rings of four golden rods (MC: 2 × 8 px), each ring a pivot that spins. */
function blaze(): Part[] {
  const rods = [[1.05, 0.5], [0.62, 0.42], [0.2, 0.32]] as const, parts: Part[] = [
    { pivot: 'body', size: [0.16, 0.9, 0.16], at: [0, 0.35, 0], offset: [0, 0.45, 0], color: 0x9a5a1a },
    { pivot: 'head', size: [0.5, 0.5, 0.5], at: [0, 1.3, 0], offset: [0, 0.25, 0], color: 0xe2a42c },
    facePart('head', -0.11, 0.27, 0.12, 0.08, 0.25, 0x2a1406), facePart('head', 0.11, 0.27, 0.12, 0.08, 0.25, 0x2a1406), facePart('head', 0, 0.12, 0.26, 0.05, 0.25, 0x6a3a0e),
  ];
  rods.forEach(([y, r], ring) => {
    const pivot = `rods_ring_${ring}` as Pivot;
    parts.push({ pivot, size: null, at: [0, y, 0], offset: [0, 0, 0], color: 0 });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + ring * 0.4;
      parts.push({ pivot: 'eye', parent: pivot, size: [0.125, 0.5, 0.125], at: [Math.cos(a) * r, 0, Math.sin(a) * r], offset: [0, 0, 0], color: i % 2 ? 0xf6c636 : 0xe8a822 });
    }
  });
  return parts;
}
/** Enderman: a 2.9 m stick figure in near-black with long limbs, glowing purple eyes and a jaw that drops when it is angry. */
function enderman(): Part[] {
  const black = 0x15111a, limb = 1.7, shoulder = 2.38;
  return [
    { pivot: 'leg_l', size: [0.12, limb, 0.12], at: [-0.1, limb, 0], offset: [0, -limb / 2, 0], color: black },
    { pivot: 'leg_r', size: [0.12, limb, 0.12], at: [0.1, limb, 0], offset: [0, -limb / 2, 0], color: black },
    { pivot: 'body', size: [0.46, 0.72, 0.24], at: [0, limb, 0], offset: [0, 0.36, 0], color: 0x1b1620 },
    { pivot: 'arm_l', size: [0.12, limb, 0.12], at: [-0.29, shoulder, 0], offset: [0, -limb / 2 + 0.06, 0], color: black },
    { pivot: 'arm_r', size: [0.12, limb, 0.12], at: [0.29, shoulder, 0], offset: [0, -limb / 2 + 0.06, 0], color: black },
    { pivot: 'head', size: [0.46, 0.34, 0.46], at: [0, 2.42, 0], offset: [0, 0.29, 0], color: 0x18131c },
    { pivot: 'jaw', parent: 'head', size: [0.44, 0.12, 0.44], at: [0, 0.12, 0.22], offset: [0, -0.06, -0.22], color: 0x100c13 },
    { pivot: 'eye', parent: 'head', size: [0.15, 0.045, 0.02], at: [-0.11, 0.25, -0.235], offset: [0, 0, 0], color: 0xe27cff, glow: true },
    { pivot: 'eye', parent: 'head', size: [0.15, 0.045, 0.02], at: [0.11, 0.25, -0.235], offset: [0, 0, 0], color: 0xe27cff, glow: true },
  ];
}
/** Silverfish: four grey segments, widest in the middle, head first (towards -Z). */
const silverfish = (): Part[] => [[0.2, 0.16, 0.14], [0.32, 0.22, 0.16], [0.26, 0.18, 0.16], [0.14, 0.12, 0.16]].map(([w, h, l], i): Part =>
  ({ pivot: `seg_${i}` as Pivot, size: [w!, h!, l!], at: [0, 0, -0.2 + i * 0.15], offset: [0, h! / 2, 0], color: i ? 0x8d9097 : 0x777a82 }));
/**
 * Ender dragon (−Z forward, the body centred 2 m up like its hit boxes): a long dark body, a chained neck of five
 * segments to a horned head with a jaw and glowing eyes, a ten-segment tail, two jointed wings and folded legs.
 */
function dragon(): Part[] {
  const hide = 0x1d1922, belly = 0x2a2431, spine = 0x4b4458, skin = 0x3b2d4b, parts: Part[] = [
    { pivot: 'body', size: [3, 2.4, 7], at: [0, 2, 0], offset: [0, 0, 0], color: hide },
    { pivot: 'eye', parent: 'body', size: [2.6, 0.3, 6.4], at: [0, -1.2, 0], offset: [0, 0, 0], color: belly },
    ...[-2.4, -0.8, 0.8, 2.4].map((z): Part => ({ pivot: 'eye', parent: 'body', size: [0.3, 0.6, 0.6], at: [0, 1.45, z], offset: [0, 0, 0], color: spine })),
    ...(['leg_fl', 'leg_fr', 'leg_bl', 'leg_br'] as const).map((pivot, i): Part =>
      ({ pivot, parent: 'body', size: [0.6, 1.6, 0.7], at: [i % 2 ? 1.1 : -1.1, -1.1, i < 2 ? -2.2 : 2.2], offset: [0, -0.7, 0.2], color: hide })),
  ];
  let parent: Pivot = 'body';
  for (let i = 0; i < 5; i++) {
    const pivot = `neck_${i}` as Pivot;
    parts.push({ pivot, parent, size: [1.1, 1.1, 1.25], at: [0, i ? 0 : 0.5, i ? -1.2 : -3.5], offset: [0, 0, -0.6], color: i % 2 ? belly : hide },
      { pivot: 'eye', parent: pivot, size: [0.25, 0.4, 0.4], at: [0, 0.7, -0.6], offset: [0, 0, 0], color: spine });
    parent = pivot;
  }
  parts.push(
    { pivot: 'head', parent, size: [1.9, 1.3, 2.4], at: [0, 0, -1.2], offset: [0, 0.15, -1.2], color: hide },
    { pivot: 'eye', parent: 'head', size: [0.3, 0.5, 0.7], at: [-0.55, 1.0, -0.2], offset: [0, 0, 0], color: spine },
    { pivot: 'eye', parent: 'head', size: [0.3, 0.5, 0.7], at: [0.55, 1.0, -0.2], offset: [0, 0, 0], color: spine },
    { pivot: 'eye', parent: 'head', size: [0.4, 0.16, 0.06], at: [-0.6, 0.45, -1.9], offset: [0, 0, 0], color: 0xd85cff, glow: true },
    { pivot: 'eye', parent: 'head', size: [0.4, 0.16, 0.06], at: [0.6, 0.45, -1.9], offset: [0, 0, 0], color: 0xd85cff, glow: true },
    { pivot: 'jaw', parent: 'head', size: [1.6, 0.4, 2.2], at: [0, -0.5, -0.1], offset: [0, -0.2, -1.1], color: belly },
  );
  parent = 'body';
  for (let i = 0; i < 10; i++) {
    const pivot = `tail_${i}` as Pivot, w = 1.05 - i * 0.07;
    parts.push({ pivot, parent, size: [w, w, 0.85], at: [0, i ? 0 : 0.2, i ? 0.8 : 3.5], offset: [0, 0, 0.4], color: i % 2 ? belly : hide });
    if (i % 2 === 0) parts.push({ pivot: 'eye', parent: pivot, size: [0.2, 0.35, 0.3], at: [0, w / 2 + 0.15, 0.4], offset: [0, 0, 0], color: spine });
    parent = pivot;
  }
  for (const side of [-1, 1]) {
    const wing = side < 0 ? 'wing_l' : 'wing_r', tip = side < 0 ? 'wingtip_l' : 'wingtip_r';
    parts.push(
      { pivot: wing, parent: 'body', size: [6, 0.4, 0.4], at: [side * 1.4, 1.0, -1.6], offset: [side * 3, 0, 0], color: hide },
      { pivot: 'eye', parent: wing, size: [6, 0.08, 4.6], at: [side * 3, 0, 2.3], offset: [0, 0, 0], color: skin },
      { pivot: tip, parent: wing, size: [5, 0.3, 0.3], at: [side * 6, 0, 0], offset: [side * 2.5, 0, 0], color: hide },
      { pivot: 'eye', parent: tip, size: [5, 0.06, 4.2], at: [side * 2.5, 0, 2.1], offset: [0, 0, 0], color: skin },
    );
  }
  return parts;
}
/** End crystal: two see-through glass frames turning around a glowing pink core, floating over a bedrock base. */
const crystal = (): Part[] => [
  { pivot: 'base', size: [1.5, 0.4, 1.5], at: [0, 0, 0], offset: [0, 0.2, 0], color: 0x5a5a5a, tex: Array<string>(6).fill('bedrock') },
  { pivot: 'frame_outer', size: [1, 1, 1], at: [0, 1.25, 0], offset: [0, 0, 0], color: 0xe8dcff, opacity: 0.32 },
  { pivot: 'frame_inner', parent: 'frame_outer', size: [0.78, 0.78, 0.78], at: [0, 0, 0], offset: [0, 0, 0], color: 0xd7c6ff, opacity: 0.42 },
  { pivot: 'core', parent: 'frame_inner', size: [0.5, 0.5, 0.5], at: [0, 0, 0], offset: [0, 0, 0], color: 0xff6ad5, glow: true },
];
const FALLBACK: Record<ModelKey, () => Part[]> = {
  villager, villager_librarian: villager, villager_armorer: villager, villager_toolsmith: villager, villager_cleric: villager, villager_mason: villager,
  zombified_piglin: piglin,
  ghast,
  tnt: () => [{ pivot: 'body', size: [0.98, 0.98, 0.98], at: [0, 0, 0], offset: [0, 0.49, 0], color: 0xffffff, tex: ['tnt_side', 'tnt_side', 'tnt_top', 'tnt_bottom', 'tnt_side', 'tnt_side'] }],
  blaze, enderman, ender_dragon: dragon, end_crystal: crystal, silverfish,
  player: () => humanoid(SKIN, 0xffffff, PANTS),
  zombie: () => humanoid(0x5c8f4e, 0x2f8f9a, 0x3a3f8f),
  skeleton: () => humanoid(0xcfcfcf, 0xbdbdbd, 0xa8a8a8, true),
  creeper: () => [
    { pivot: 'body', size: [0.5, 0.75, 0.25], at: [0, 0.4, 0], offset: [0, 0.375, 0], color: 0x4f9e3c },
    { pivot: 'head', size: [0.5, 0.5, 0.5], at: [0, 1.15, 0], offset: [0, 0.25, 0], color: 0x5fb247 },
    { pivot: 'eye', parent: 'head', size: [0.12, 0.12, 0.02], at: [-0.11, 0.3, -0.255], offset: [0, 0, 0], color: 0x111111 },
    { pivot: 'eye', parent: 'head', size: [0.12, 0.12, 0.02], at: [0.11, 0.3, -0.255], offset: [0, 0, 0], color: 0x111111 },
    ...(['leg_fl', 'leg_fr', 'leg_bl', 'leg_br'] as const).map((pivot, i): Part => ({ pivot, size: [0.24, 0.4, 0.24], at: [i % 2 ? 0.12 : -0.12, 0.4, i < 2 ? -0.25 : 0.25], offset: [0, -0.2, 0], color: 0x4f9e3c })),
  ],
  spider: () => [
    { pivot: 'body', size: [0.9, 0.55, 0.9], at: [0, 0.35, 0.35], offset: [0, 0.2, 0.1], color: 0x3a2f2a },
    { pivot: 'head', size: [0.5, 0.45, 0.45], at: [0, 0.5, -0.1], offset: [0, 0.05, -0.2], color: 0x2e2622 },
    { pivot: 'eye', parent: 'head', size: [0.1, 0.08, 0.02], at: [-0.12, 0.1, -0.43], offset: [0, 0, 0], color: 0xd0202a },
    { pivot: 'eye', parent: 'head', size: [0.1, 0.08, 0.02], at: [0.12, 0.1, -0.43], offset: [0, 0, 0], color: 0xd0202a },
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): Part => ({ pivot: `leg_${i}` as Pivot, size: [0.8, 0.1, 0.1], at: [i < 4 ? -0.2 : 0.2, 0.45, -0.3 + (i % 4) * 0.2], offset: [i < 4 ? -0.4 : 0.4, 0, 0], color: 0x2a221e })),
  ],
  cow: () => quadruped(0x5a3d2b, 0x4a3223, 1.4),
  pig: () => quadruped(0xe8a0a0, 0xe39292, 0.9),
  sheep: () => quadruped(0xd9c9b0, 0xcdb79b, 1.3, true),
  chicken: () => [
    { pivot: 'body', size: [0.34, 0.3, 0.42], at: [0, 0.3, 0], offset: [0, 0.15, 0], color: 0xf4f4f0 },
    { pivot: 'head', size: [0.22, 0.3, 0.18], at: [0, 0.5, -0.2], offset: [0, 0.1, -0.02], color: 0xf4f4f0 },
    { pivot: 'snout', parent: 'head', size: [0.12, 0.08, 0.1], at: [0, 0.12, -0.15], offset: [0, 0, 0], color: 0xe8a33a },
    { pivot: 'arm_l', size: [0.05, 0.22, 0.3], at: [-0.2, 0.52, 0], offset: [0, -0.1, 0], color: 0xe6e6e0 },
    { pivot: 'arm_r', size: [0.05, 0.22, 0.3], at: [0.2, 0.52, 0], offset: [0, -0.1, 0], color: 0xe6e6e0 },
    { pivot: 'leg_l', size: [0.06, 0.3, 0.06], at: [-0.08, 0.3, 0.02], offset: [0, -0.15, 0], color: 0xe8a33a },
    { pivot: 'leg_r', size: [0.06, 0.3, 0.06], at: [0.08, 0.3, 0.02], offset: [0, -0.15, 0], color: 0xe8a33a },
  ],
};

const boxes = new Map<string, BufferGeometry>();
const box = (size: readonly number[]) => {
  const key = size.join(',');
  let geometry = boxes.get(key);
  if (!geometry) boxes.set(key, geometry = new BoxGeometry(size[0], size[1], size[2]));
  return geometry;
};
/** Block textures for textured fallback parts (primed TNT), flipped so the painted top row sits at the top. */
const textures = new Map<string, Texture>();
function blockTexture(key: string): Texture {
  let texture = textures.get(key);
  if (!texture) {
    const source = texturePixels(key), data = new Uint8Array(source.length);
    for (let y = 0; y < 16; y++) data.set(source.subarray(y * 64, y * 64 + 64), (15 - y) * 64);
    texture = new DataTexture(data, 16, 16, RGBAFormat);
    texture.magFilter = texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    textures.set(key, texture);
  }
  return texture;
}
function buildFallback(key: ModelKey): Group {
  const root = new Group(), nodes = new Map<string, Object3D>();
  for (const part of FALLBACK[key]()) {
    const pivot = new Group(), name = part.shirt ? 'shirt' : part.glow ? 'eyes' : part.pivot, see = part.opacity !== undefined;
    if (part.size) {
      const material = part.tex ? part.tex.map(tex => new MeshLambertMaterial({ map: blockTexture(tex), name }))
        : new MeshLambertMaterial({ color: part.color, name, transparent: see, opacity: part.opacity ?? 1, depthWrite: !see });
      const mesh = new Mesh(box(part.size), material);
      mesh.position.set(...part.offset);
      pivot.add(mesh);
    }
    pivot.position.set(...part.at);
    pivot.name = part.pivot;
    (part.parent ? nodes.get(part.parent)! : root).add(pivot);
    if (!nodes.has(part.pivot)) nodes.set(part.pivot, pivot);
  }
  return root;
}

/** Loads GLB templates in the background and hands out rig instances (procedural stand-ins until they arrive). */
export class ModelLibrary {
  /** Bumped whenever a template arrives. */
  version = 0;
  private readonly templates = new Map<ModelKey, Object3D>();
  private readonly owned: { dispose(): void }[] = [];

  async load(base: string, signal: AbortSignal) {
    const loader = new GLTFLoader();
    await Promise.all((Object.keys(RIG_KIND) as ModelKey[]).map(async key => {
      try {
        const gltf = await loader.loadAsync(`${base}models/${key}.glb`);
        if (signal.aborted) return;
        gltf.scene.traverse(node => {
          if (!(node instanceof Mesh)) return;
          this.owned.push(node.geometry);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) this.owned.push(material, ...(material.map ? [material.map] : []));
        });
        this.templates.set(key, gltf.scene);
        this.version++;
      } catch { /* missing model: procedural rig */ }
    }));
  }

  instance(key: ModelKey): Rig {
    const kind = RIG_KIND[key], template = this.templates.get(key), model = template ? template.clone(true) : buildFallback(key);
    const root = new Group();
    root.add(model);
    const materials = ownMaterials(model, !!template), pivots = findPivots(model, kind);
    return { root, kind, version: this.version, pivots, materials, unit: pixelUnit(root, kind, pivots), fallback: !template };
  }
  /** Dispose one instance's own materials (geometry is shared by all instances). */
  release(rig: Rig) { for (const { material } of rig.materials) material.dispose(); }
  dispose() {
    for (const resource of this.owned) resource.dispose();
    for (const geometry of boxes.values()) geometry.dispose();
    for (const texture of textures.values()) texture.dispose();
    for (const geometry of armorGeometries.values()) geometry.dispose();
    for (const texture of armorTextures.values()) texture.dispose();
    boxes.clear();
    textures.clear();
    armorGeometries.clear();
    armorTextures.clear();
    grainTexture?.dispose();
    grainTexture = null;
  }
}

// Attachments ---------------------------------------------------------------------------------------------------
/** Humanoid heads sit 24 px up; pivots may carry the model's scale, so the unit is measured in pivot space. */
function pixelUnit(root: Group, kind: RigKind, pivots: Rig['pivots']) {
  const head = pivots.head;
  if (kind !== 'humanoid' || !head) return 1 / 16;
  root.updateMatrixWorld(true);
  const at = head.getWorldPosition(new Vector3()), scale = head.getWorldScale(new Vector3()).y;
  return at.y > 0.5 ? at.y / 24 / scale : 1 / 16;
}

/** One attached box in MC pixels, relative to a pivot: [x0, y0, z0, x1, y1, z1] and a colour. */
export type Piece = { pivot: Pivot; box: readonly [number, number, number, number, number, number]; color: number };
/** Boxes added to a rig, removable as one (their materials join the rig's for light and hurt tinting). */
export type Attachment = { meshes: Mesh[] };

/** Villager professions for stand-in rigs (the GLBs dress each profession): robe colour (the shirt tint) and outfit pieces. */
export const PROFESSIONS: readonly { robe: number; pieces: Piece[] }[] = [
  { robe: 0x7a5a36, pieces: [{ pivot: 'head', box: [-6.5, 9.4, -6.5, 6.5, 10.2, 6.5], color: 0xd9c27a }, { pivot: 'head', box: [-4.4, 10.2, -4.4, 4.4, 12, 4.4], color: 0xcdb46a }] },
  { robe: 0xe6e0d0, pieces: [{ pivot: 'head', box: [-4.5, 9.6, -4.5, 4.5, 11, 4.5], color: 0xb8322c }, { pivot: 'body', box: [-4.4, 11, -2.4, 4.4, 12.2, 2.4], color: 0xb8322c }] },
  { robe: 0x55565e, pieces: [{ pivot: 'head', box: [-3.4, 4.6, -4.3, -0.6, 6.4, -4.05], color: 0x141414 }, { pivot: 'body', box: [-4.3, 0.5, -2.45, 4.3, 11, -2.1], color: 0x2c2c30 }] },
  { robe: 0x8a6f4e, pieces: [{ pivot: 'body', box: [-4.3, 0.5, -2.45, 4.3, 11, -2.1], color: 0x2e2620 }, { pivot: 'body', box: [-4.4, 5, -2.5, 4.4, 5.8, 2.5], color: 0x5a4632 }] },
  { robe: 0x6c3a8e, pieces: [{ pivot: 'body', box: [-4.4, 11, -2.4, 4.4, 12.2, 2.4], color: 0xd8b040 }, { pivot: 'head', box: [-4.6, 7.6, -4.6, 4.6, 10.6, 4.6], color: 0x5a2e78 }] },
  { robe: 0x6a4c30, pieces: [{ pivot: 'body', box: [-4.3, 0.5, -2.45, 4.3, 11, -2.1], color: 0x8a8a86 }, { pivot: 'body', box: [-4.4, 8.6, -2.5, 4.4, 9.4, 2.5], color: 0x4a4a48 }] },
];

/** Faint cloth grain shared by outfit boxes (multiplies their colour). */
let grainTexture: DataTexture | null = null;
function grain(): DataTexture {
  if (grainTexture) return grainTexture;
  const data = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const edge = x === 0 || y === 0 || x === 7 || y === 7, v = Math.round(255 * (edge ? 0.78 : 0.9 + hash(x, y, 91) * 0.1));
    data.set([v, v, v, 255], (y * 8 + x) * 4);
  }
  return grainTexture = pixelTexture(data, 8, 8);
}
const pixelTexture = (data: Uint8Array, w: number, h: number) => {
  const texture = new DataTexture(data, w, h, RGBAFormat);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

/** The art's armor skins and boxes (shared by every wearer; materials are per wearer so light and hurt tint apply). */
const armorTextures = new Map<ArmorMaterial, DataTexture>(), armorGeometries = new Map<string, BufferGeometry>();
/** Put worn armor (item ids head, chest, legs, feet; 0 = none) on a humanoid rig's pivots. Remove it with `detach`. */
export function wearArmor(rig: Rig, worn: readonly number[]): Attachment {
  const meshes: Mesh[] = [];
  ARMOR_BOXES.forEach((box, index) => {
    const armor = armorOf(worn[box.slot] ?? 0), node = rig.pivots[box.pivot];
    if (!armor || !node) return;
    let map = armorTextures.get(armor.material), geometry = armorGeometries.get(`${index}:${rig.unit}`);
    if (!map) armorTextures.set(armor.material, map = pixelTexture(armorSheet(armor.material).data, 64, 64));
    if (!geometry) armorGeometries.set(`${index}:${rig.unit}`, geometry = armorGeometry(box, rig.unit));
    const material = new MeshLambertMaterial({ map, alphaTest: 0.5, name: 'armor' }), mesh = new Mesh(geometry, material);
    node.add(mesh);
    meshes.push(mesh);
    rig.materials.push({ material, base: material.color.clone(), shirt: false, glow: false });
  });
  return { meshes };
}

/** Add pieces to a rig (skipping pivots it lacks). Remove them with `detach`. */
export function attach(rig: Rig, pieces: readonly Piece[]): Attachment {
  const meshes: Mesh[] = [];
  for (const { pivot, box: b, color } of pieces) {
    const node = rig.pivots[pivot];
    if (!node) continue;
    const u = rig.unit, material = new MeshLambertMaterial({ color, map: grain(), name: 'attachment' });
    const mesh = new Mesh(box([(b[3] - b[0]) * u, (b[4] - b[1]) * u, (b[5] - b[2]) * u].map(v => Math.round(v * 1e4) / 1e4)), material);
    mesh.position.set((b[0] + b[3]) / 2 * u, (b[1] + b[4]) / 2 * u, (b[2] + b[5]) / 2 * u);
    node.add(mesh);
    meshes.push(mesh);
    rig.materials.push({ material, base: material.color.clone(), shirt: false, glow: false });
  }
  return { meshes };
}
export function detach(rig: Rig, attachment: Attachment | null) {
  if (!attachment) return;
  for (const mesh of attachment.meshes) {
    mesh.removeFromParent();
    const index = rig.materials.findIndex(entry => entry.material === mesh.material);
    if (index >= 0) rig.materials.splice(index, 1);
    (mesh.material as Material).dispose();
  }
}
