"""Validate shipped fighter assets by reading the GLB bytes directly (a true reimport check, no Blender state involved).

blender -b --factory-startup --python-exit-code 1 --python tools/blender/validate.py -- mario [fox ...]   (no kinds = every GLB)

Checks: contract bones, hierarchy and identity rest rotations; extra_* chains; every vertex weighted (sum 1);
feet at y=0 and head top within 3% of the roster height; left hand at +X and the face toward +Z; triangle and byte
budgets; materials from MATERIALS and no images/textures/animations; costumes JSON (exactly four, keyed by the GLB's
materials, costume 0 == GLB colors); models JSON agrees; and a linear-blend-skinning sweep that rotates every major
joint 60 degrees on each axis and flags stretched edges. Writes output/sky-clash-v2/models/<kind>-validate.json.
"""
import os, sys, json, struct, math, re
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from common import GAME, OUT, BONES, MATERIALS, PARENTS, EXTRA, ROSTER, TEST_ARMS, TEST_LEGS, pose_rotations

MAX_TRIS, MAX_BYTES, STRETCH = 20000, 1.5 * 1024 * 1024, 2.2
SWEEP = [b for b in BONES if b not in ('root', 'prop')]
TORSO = {'hips': 35, 'spine': 35, 'chest': 35, 'neck': 35}  # a round torso must stretch in a 60 degree side bend; test the torso's working range
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
SIZE = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def read_glb(path):
    data = open(path, 'rb').read(); magic, ver, _ = struct.unpack_from('<III', data)
    assert magic == 0x46546C67 and ver == 2, 'not a glTF 2 binary'
    n = struct.unpack_from('<I', data, 12)[0]; gl = json.loads(data[20:20 + n]); o = 20 + n
    bn = struct.unpack_from('<I', data, o)[0]; return gl, data[o + 8:o + 8 + bn]

def accessor(gl, bin_, i):
    a = gl['accessors'][i]; v = gl['bufferViews'][a['bufferView']]; dt = COMP[a['componentType']]; k = SIZE[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0); stride = v.get('byteStride'); size = np.dtype(dt).itemsize * k
    if stride and stride != size:
        arr = np.stack([np.frombuffer(bin_, dt, k, off + j * stride) for j in range(a['count'])])
    else: arr = np.frombuffer(bin_, dt, a['count'] * k, off).reshape(a['count'], k)
    if a.get('normalized'): arr = arr.astype(np.float32) / np.iinfo(dt).max
    return arr.astype(np.float64)

def lin2srgb(c): return [round(255 * (x * 12.92 if x <= .0031308 else 1.055 * x ** (1 / 2.4) - .055)) for x in c]

def euler(r):
    """Character-space XYZ Euler (degrees) matrix, same convention as common.rot3 (Blender Euler XYZ)."""
    x, y, z = (math.radians(a) for a in r); cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]]); Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]); Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx

def check(kind):
    errs, warn, info = [], [], {}
    path = os.path.join(GAME, 'assets', 'fighters', f'{kind}.glb'); gl, bin_ = read_glb(path); nbytes = os.path.getsize(path)
    H = ROSTER[kind]['height']
    for key in ('images', 'textures', 'samplers', 'animations'):
        if gl.get(key): errs.append(f'GLB has {key}')
    if nbytes > MAX_BYTES: errs.append(f'{nbytes} bytes > 1.5 MB')
    if len(gl.get('skins', [])) != 1: errs.append('expected exactly one skin')
    nodes = gl['nodes']; skin = gl['skins'][0]; joints = skin['joints']; names = [nodes[j]['name'] for j in joints]
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []): parent[c] = i
    jparent = {nodes[j]['name']: (nodes[parent[j]]['name'] if parent.get(j) in joints else None) for j in joints}
    for b in BONES:
        if b not in names: errs.append(f'missing bone {b}'); continue
        want = PARENTS[b]
        if b == 'prop' and jparent[b] in ('hand_L', 'hand_R'): continue
        if jparent[b] != want: errs.append(f'{b} parent is {jparent[b]}, expected {want}')
    for n in names:
        if n not in BONES and not n.startswith(EXTRA): errs.append(f'unexpected bone {n}')
        if n.startswith(EXTRA) and not re.fullmatch(EXTRA + r'[a-zA-Z0-9]+_\d+', n): errs.append(f'bad extra bone name {n}')
    for j in joints:
        nd = nodes[j]; r = nd.get('rotation', [0, 0, 0, 1]); s = nd.get('scale', [1, 1, 1])
        if max(abs(a - b) for a, b in zip(r, [0, 0, 0, 1])) > 1e-4 or max(abs(x - 1) for x in s) > 1e-4: errs.append(f'{nd["name"]} rest is not identity (rotation {r}, scale {s})')
    # Joint world rest positions (translations only because rests are identity) and inverse binds.
    world = {}
    def wpos(j):
        if j in world: return world[j]
        t = np.array(nodes[j].get('translation', [0, 0, 0])); p = parent.get(j); world[j] = t + (wpos(p) if p is not None else 0); return world[j]
    ibm = accessor(gl, bin_, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    rest = {nodes[j]['name']: wpos(j) for j in joints}
    for k, j in enumerate(joints):
        if np.abs(ibm[k][:3, 3] + rest[nodes[j]['name']]).max() > 1e-3: errs.append(f'{nodes[j]["name"]} bind matrix disagrees with its rest position')
    if 'hand_L' in rest and rest['hand_L'][0] <= 0: errs.append('hand_L is not at +X')
    # Geometry.
    mats = [m['name'] for m in gl.get('materials', [])]; pos, jw, tris, mat_of_vert, V = [], [], [], [], 0
    for m in gl.get('materials', []):
        if m['name'] not in MATERIALS: errs.append(f'material {m["name"]} is not in MATERIALS')
        if 'extensions' in m and set(m['extensions']) - {'KHR_materials_emissive_strength'}: warn.append(f'{m["name"]} uses extensions {list(m["extensions"])}')
    for mesh in gl['meshes']:
        for pr in mesh['primitives']:
            at = pr['attributes']; P = accessor(gl, bin_, at['POSITION']); Jn = accessor(gl, bin_, at['JOINTS_0']).astype(int); W = accessor(gl, bin_, at['WEIGHTS_0'])
            if 'JOINTS_1' in at: errs.append('more than 4 influences')
            idx = accessor(gl, bin_, pr['indices']).astype(int).reshape(-1, 3) + V if 'indices' in pr else np.arange(len(P)).reshape(-1, 3) + V
            pos.append(P); jw.append((Jn, W)); tris.append(idx); mat_of_vert += [mats[pr.get('material', 0)] if mats else ''] * len(P); V += len(P)
    P = np.concatenate(pos); Jn = np.concatenate([a for a, _ in jw]); W = np.concatenate([b for _, b in jw]); T = np.concatenate(tris); mv = np.array(mat_of_vert)
    ntri = len(T); info.update(tris=ntri, vertices=len(P), bytes=nbytes)
    if ntri > MAX_TRIS: errs.append(f'{ntri} triangles > {MAX_TRIS}')
    ws = W.sum(1); bad = np.where((ws < .99) | (ws > 1.01) | (W.max(1) <= 0))[0]
    if len(bad): errs.append(f'{len(bad)} vertices without normalized weights (e.g. at {P[bad[0]].round(3).tolist()})')
    lo, hi = P.min(0), P.max(0); info.update(min=lo.round(4).tolist(), max=hi.round(4).tolist())
    if abs(lo[1]) > .012: errs.append(f'lowest point y={lo[1]:.3f}, feet must be at 0')
    dom = np.array([names[Jn[i][np.argmax(W[i])]] for i in range(len(P))])
    body = dom != 'prop'; top = P[body, 1].max(); info['bodyTop'] = round(float(top), 4)
    meta = json.load(open(os.path.join(GAME, 'assets', 'models', f'{kind}.json'))); ht = meta.get('headTop', top); info['headTop'] = ht
    if abs(ht - H) / H > .03: errs.append(f'head top {ht:.3f} is not within 3% of {H}')
    if top < ht - .01: errs.append(f'GLB top {top:.3f} is below the recorded head top {ht:.3f}')
    for key, val in (('tris', ntri), ('bytes', nbytes)):
        if meta.get(key) != val: errs.append(f'models JSON {key}={meta.get(key)} but GLB has {val}')
    if sorted(meta.get('bones', [])) != sorted(names): errs.append('models JSON bones differ from GLB joints')
    if sorted(meta.get('materials', [])) != sorted(mats): errs.append('models JSON materials differ from GLB')
    eyes = np.isin(mv, ['eye', 'eye-white'])
    if eyes.any() and P[eyes, 2].mean() <= P[:, 2].mean(): errs.append('eyes are not on the +Z side: the fighter must face +Z')
    # Costumes.
    cos = json.load(open(os.path.join(GAME, 'assets', 'costumes', f'{kind}.json')))
    if not isinstance(cos, list) or len(cos) != 4: errs.append('costumes JSON must be a list of exactly four')
    else:
        if len({c.get('name') for c in cos}) != 4: errs.append('costume names must be unique')
        for c in cos:
            if set(c.get('colors', {})) != set(mats): errs.append(f'costume {c.get("name")} keys differ from GLB materials')
            if not all(re.fullmatch(r'#[0-9a-f]{6}', h) for h in c.get('colors', {}).values()): errs.append(f'costume {c.get("name")} has bad hex')
        for m in gl.get('materials', []):
            want = cos[0]['colors'].get(m['name']); got = lin2srgb(m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3])
            if want and max(abs(a - int(want[1 + 2 * i:3 + 2 * i], 16)) for i, a in enumerate(got)) > 2: errs.append(f'costume 0 {m["name"]} {want} != GLB {got}')
    # Linear blend skinning sweep: rotate each joint 60 degrees about each axis, measure edge stretch.
    E = np.unique(np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), 1), axis=0); L0 = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
    L0b = np.where((dom[E[:, 0]] == 'prop') | (dom[E[:, 1]] == 'prop'), 0, L0)
    if L0b.max() > .3 * H: warn.append(f'edge of {L0b.max():.2f} m at {P[E[np.argmax(L0b)][0]].round(3).tolist()}: stray vertex or spike?')
    ok = L0 > 1e-4; E, L0 = E[ok], L0[ok]; order = sorted(range(len(joints)), key=lambda k: len(_chain(parent, joints[k], joints)))
    Ph = np.c_[P, np.ones(len(P))]; worst = (1.0, None, None)
    poses = [(f'{b} {r}', {b: r}) for b in SWEEP for a in (TORSO.get(b, 60),) for r in ((a, 0, 0), (-a, 0, 0), (0, a, 0), (0, -a, 0), (0, 0, a), (0, 0, -a))]
    poses += [('TEST_ARMS', pose_rotations(TEST_ARMS)), ('TEST_LEGS', pose_rotations(TEST_LEGS))]
    for label, rots in poses:
        M = {}
        for k in order:
            j = joints[k]; nm = nodes[j]['name']; p = parent.get(j); Mt = np.eye(4); Mt[:3, 3] = nodes[j].get('translation', [0, 0, 0])
            if nm in rots: Mt[:3, :3] = euler(rots[nm])
            M[k] = (M[joints.index(p)] if p in joints else np.eye(4)) @ Mt
        S = np.stack([M[k] @ ibm[k] for k in range(len(joints))])
        Q = np.einsum('vk,vkij,vj->vi', W, S[Jn], Ph)[:, :3]
        ratio = np.linalg.norm(Q[E[:, 0]] - Q[E[:, 1]], axis=1) / L0; i = int(np.argmax(ratio))
        if ratio[i] > worst[0]: worst = (float(ratio[i]), label, E[i])
    info['maxStretch'] = round(worst[0], 3); info['worstPose'] = worst[1]
    if worst[0] > STRETCH:
        v = worst[2][0]; wd = {names[Jn[v][k]]: round(float(W[v][k]), 3) for k in range(4) if W[v][k] > 0}
        errs.append(f'edge stretches x{worst[0]:.2f} at {worst[1]} near {P[v].round(3).tolist()} weights {wd}')
    report = {'kind': kind, 'ok': not errs, 'errors': errs, 'warnings': warn, **info}
    os.makedirs(OUT, exist_ok=True); json.dump(report, open(os.path.join(OUT, f'{kind}-validate.json'), 'w'), indent=1)
    print(f'[{kind}] {"OK" if not errs else "FAIL"} tris={ntri} bytes={nbytes} top={info["bodyTop"]} stretch={info["maxStretch"]} ({info["worstPose"]})')
    for e in errs: print('   error:', e)
    for w in warn: print('   warning:', w)
    return not errs

def _chain(parent, j, joints):
    out = []
    while j in parent and parent[j] in joints: j = parent[j]; out.append(j)
    return out

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    kinds = argv or sorted(f[:-4] for f in os.listdir(os.path.join(GAME, 'assets', 'fighters')) if f.endswith('.glb'))
    results = [check(k) for k in kinds]; print(f'{sum(results)}/{len(results)} fighters valid'); sys.exit(0 if all(results) else 1)
