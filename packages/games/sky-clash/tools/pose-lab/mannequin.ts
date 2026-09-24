/**
 * Procedural stand-in fighter with the exact contract rig (bone names, hierarchy, T-pose, facing +Z, left at +X, feet
 * at 0). Capsules are rigidly skinned to their bones and split per material, like a Blender export. Tests and the pose
 * lab use it before (and beside) the real GLBs. joints may come from assets/models/<kind>.json.
 */
import { Bone, BufferAttribute, CapsuleGeometry, Group, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, SphereGeometry, BoxGeometry, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FIGHTERS, type FighterKind } from '../../src/model';

type J = Record<string, [number, number, number]>;
const PARENTS: Record<string, string | null> = { root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', prop: 'hand_R' };
for (const S of ['L', 'R']) Object.assign(PARENTS, { [`shoulder_${S}`]: 'chest', [`upperarm_${S}`]: `shoulder_${S}`, [`forearm_${S}`]: `upperarm_${S}`, [`hand_${S}`]: `forearm_${S}`, [`thigh_${S}`]: 'hips', [`shin_${S}`]: `thigh_${S}`, [`foot_${S}`]: `shin_${S}` });

/** Mario-like proportions (from the Blender kit), scaled to height H. */
export function humanoidJoints(H: number, round = false): J {
  const k = H / 1.68, j: J = {
    root: [0, 0, 0], hips: [0, .5, 0], spine: [0, .6, 0], chest: [0, .74, 0], neck: [0, .93, 0], head: [0, 1, 0],
    shoulder_L: [.08, .86, 0], upperarm_L: [.24, .88, 0], forearm_L: [.44, .88, 0], hand_L: [.62, .88, 0],
    thigh_L: [.12, .47, 0], shin_L: [.12, .28, 0], foot_L: [.12, .11, 0], prop: [-.7, .88, 0],
  };
  if (round) Object.assign(j, { hips: [0, .45, 0], spine: [0, .55, 0], chest: [0, .7, 0], neck: [0, .9, 0], head: [0, .95, 0], shoulder_L: [.2, .7, 0], upperarm_L: [.38, .72, 0], forearm_L: [.5, .72, 0], hand_L: [.6, .72, 0],
    thigh_L: [.2, .25, 0], shin_L: [.22, .16, 0], foot_L: [.24, .08, .04], prop: [-.66, .72, 0] });
  for (const n of Object.keys(j)) if (n.endsWith('_L')) { const [x, y, z] = j[n]; j[n.replace('_L', '_R')] = [-x, y, z]; }
  for (const n of Object.keys(j)) j[n] = j[n].map(v => v * k) as [number, number, number];
  return j;
}

const MAT = (name: string, color: string) => Object.assign(new MeshStandardMaterial({ color }), { name });
export function mannequin(kind: FighterKind, joints?: J, opts: { sword?: boolean; scarf?: boolean } = {}) {
  const info = FIGHTERS[kind], round = info.style === 'round', H = info.height, j: J = { ...(joints ?? humanoidJoints(H, round)) };
  const parents = { ...PARENTS };
  if (opts.scarf) { const n = j.neck; j.extra_scarf_0 = [n[0], n[1], n[2] - .08]; j.extra_scarf_1 = [n[0], n[1] - .08, n[2] - .3]; j.extra_scarf_2 = [n[0], n[1] - .18, n[2] - .5]; Object.assign(parents, { extra_scarf_0: 'neck', extra_scarf_1: 'extra_scarf_0', extra_scarf_2: 'extra_scarf_1' }); }
  const names = Object.keys(parents).filter(n => j[n]), bones = new Map<string, Bone>();
  for (const n of names) { const b = new Bone(); b.name = n; bones.set(n, b); }
  for (const n of names) {
    const b = bones.get(n)!, p = parents[n], at = new Vector3(...j[n]);
    if (p) { bones.get(p)!.add(b); b.position.copy(at.sub(new Vector3(...j[p]))); } else b.position.copy(at);
  }
  const index = new Map(names.map((n, i) => [n, i])), parts = new Map<string, BufferGeometry[]>();
  const add = (mat: string, geo: BufferGeometry, bone: string) => {
    const n = geo.getAttribute('position').count, i = index.get(bone)!;
    geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(n * 4).map((_, k) => k % 4 ? 0 : i), 4));
    geo.setAttribute('skinWeight', new BufferAttribute(new Float32Array(n * 4).map((_, k) => k % 4 ? 0 : 1), 4));
    geo.deleteAttribute('uv');
    (parts.get(mat) ?? parts.set(mat, []).get(mat)!).push(geo);
  };
  const seg = (mat: string, a: string, b: string, r: number, bone = a) => {
    const pa = new Vector3(...j[a]), pb = new Vector3(...j[b]), d = pb.clone().sub(pa), len = d.length();
    const g = new CapsuleGeometry(r, Math.max(.001, len - r * .6), 4, 10);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize())); g.translate(...pa.clone().add(pb).multiplyScalar(.5).toArray());
    add(mat, g, bone);
  };
  const ball = (mat: string, c: [number, number, number], r: [number, number, number], bone: string) => { const g = new SphereGeometry(1, 16, 12); g.scale(...r); g.translate(...c); add(mat, g, bone); };
  const k = H / 1.68, head = j.head, hr = (round ? .12 : .28) * k;
  if (round) ball('primary', [0, j.hips[1] + .05 * k, 0], [.42 * k, .42 * k, .4 * k], 'chest');
  else { seg('primary', 'hips', 'chest', .13 * k, 'spine'); seg('primary', 'chest', 'neck', .15 * k, 'chest'); ball('secondary', [0, j.hips[1] - .02 * k, 0], [.15 * k, .1 * k, .12 * k], 'hips'); seg('skin', 'neck', 'head', .06 * k, 'neck'); }
  const hc: [number, number, number] = round ? [0, j.hips[1] + .1 * k, 0] : [head[0], head[1] + hr * .9, head[2] + .02 * k];
  if (!round) ball('skin', hc, [hr, hr * 1.05, hr], 'head');
  for (const s of [1, -1]) {
    ball('eye-white', [hc[0] + s * hr * .38, hc[1] + hr * .15, hc[2] + (round ? .38 * k : hr * .86)], [hr * .2, hr * .3, hr * .12], round ? 'chest' : 'head');
    ball('eye', [hc[0] + s * hr * .36, hc[1] + hr * .15, hc[2] + (round ? .4 * k : hr * .95)], [hr * .1, hr * .16, hr * .06], round ? 'chest' : 'head');
  }
  if (!round) ball('hair', [hc[0], hc[1] + hr * .55, hc[2] - hr * .1], [hr * 1.02, hr * .5, hr * 1.02], 'head');
  for (const S of ['L', 'R']) {
    const armR = (round ? .07 : .055) * k, legR = (round ? .09 : .07) * k;
    if (!round) seg('primary', `shoulder_${S}`, `upperarm_${S}`, .06 * k, `shoulder_${S}`);
    seg(round ? 'primary' : 'primary', `upperarm_${S}`, `forearm_${S}`, armR, `upperarm_${S}`);
    seg('skin', `forearm_${S}`, `hand_${S}`, armR * .9, `forearm_${S}`);
    ball('light', j[`hand_${S}`].map((v, i) => v + (i === 0 ? Math.sign(v) * .04 * k : 0)) as [number, number, number], [.06 * k, .055 * k, .06 * k], `hand_${S}`);
    if (!round) { seg('secondary', `thigh_${S}`, `shin_${S}`, legR, `thigh_${S}`); seg('secondary', `shin_${S}`, `foot_${S}`, legR * .85, `shin_${S}`); }
    const f = j[`foot_${S}`], box = new BoxGeometry(.11 * k, .09 * k, .24 * k); box.translate(f[0], Math.max(.045 * k, f[1] - .06 * k), f[2] + .06 * k); add('dark', box, `foot_${S}`);
  }
  if (opts.sword) { const g = new BoxGeometry(.03 * k, .9 * k, .07 * k); const pr = j.prop; g.translate(pr[0], pr[1] + .45 * k, pr[2]); add('metal', g, 'prop'); }
  if (opts.scarf) seg('accent', 'extra_scarf_0', 'extra_scarf_2', .05 * k, 'extra_scarf_1');
  const scene = new Group();
  scene.add(bones.get('root')!); scene.updateMatrixWorld(true);
  const skeleton = new Skeleton(names.map(n => bones.get(n)!));
  const colors: Record<string, string> = { primary: info.color, secondary: '#34406b', skin: '#f3c79d', hair: '#4a2a18', light: '#f5f3ee', dark: '#231a1c', eye: '#2f6fd8', 'eye-white': '#ffffff', metal: '#cfd8e6', accent: '#ffd23a' };
  for (const [mat, list] of parts) { const mesh = new SkinnedMesh(mergeGeometries(list, false)!, MAT(mat, colors[mat] ?? '#888')); mesh.bind(skeleton); scene.add(mesh); }
  scene.updateMatrixWorld(true);
  return scene;
}
