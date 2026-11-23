"""Validate crew fighter and arena models as the game will load them. Plain Python (no Blender needed):
  python3 packages/games/sky-clash/tools/blender/crew/validate.py [id ...]      (no ids: every model that has tools/blender/crew/<id>.py)

Fighters: the contract skeleton plus face and hand bones, world-aligned rest frames (identity joint rotations, as src/anim/core.ts assumes), at most four
normalised weights per vertex, UVs inside the unit square, one material per metadata slot and no strays, two WebP maps, four complete costumes with swatches,
spring chains, anchors on real bones, and the triangle, byte and texture budgets. Arenas: one static mesh, slots, maps, collision recorded, budgets.
Exits 1 if anything fails."""
import json, os, struct, sys

HERE = os.path.dirname(os.path.realpath(__file__)); GAME = os.path.realpath(os.path.join(HERE, '..', '..', '..'))
BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'prop',
         'jaw', 'lid_L', 'lid_R', 'brow_L', 'brow_R', 'fingers1_L', 'fingers2_L', 'thumb_L', 'fingers1_R', 'fingers2_R', 'thumb_R']
COMPONENTS = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}; COUNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def read_glb(path):
    data = open(path, 'rb').read(); magic, version, length = struct.unpack_from('<4sII', data, 0); assert magic == b'glTF' and length == len(data), 'not a complete GLB'
    off = 12; doc = None; blob = b''
    while off < len(data):
        n, kind = struct.unpack_from('<I4s', data, off); chunk = data[off + 8:off + 8 + n]; off += 8 + n
        if kind == b'JSON': doc = json.loads(chunk)
        elif kind == b'BIN\x00': blob = chunk
    return doc, blob, len(data)
def accessor(doc, blob, i):
    a = doc['accessors'][i]; v = doc['bufferViews'][a['bufferView']]; fmt = COMPONENTS[a['componentType']]; n = COUNT[a['type']]; size = struct.calcsize(fmt) * n
    stride = v.get('byteStride') or size; base = v.get('byteOffset', 0) + a.get('byteOffset', 0); norm = a.get('normalized') and {'B': 255, 'H': 65535}.get(fmt)
    out = [struct.unpack_from('<' + fmt * n, blob, base + k * stride) for k in range(a['count'])]
    return [tuple(x / norm for x in row) for row in out] if norm else out

def check(kind):
    errs = []; fail = errs.append; stage = os.path.exists(os.path.join(GAME, 'assets', 'stages', f'{kind}.glb'))
    path = os.path.join(GAME, 'assets', 'stages' if stage else 'fighters', f'{kind}.glb'); meta = json.load(open(os.path.join(GAME, 'assets', 'models', f'{kind}.json')))
    doc, blob, nbytes = read_glb(path); names = [n.get('name', '') for n in doc['nodes']]; slots = [s['name'] for s in meta['slots']]
    tris = 0; used = set()
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            attrs = p['attributes']; tris += doc['accessors'][p['indices']]['count'] // 3; used.add(doc['materials'][p['material']]['name'].split('.')[0])
            for need in ('POSITION', 'NORMAL', 'TEXCOORD_0') + (() if stage else ('JOINTS_0', 'WEIGHTS_0')):
                if need not in attrs: fail(f'a primitive lacks {need}')
            uv = accessor(doc, blob, attrs['TEXCOORD_0']); lo = min(min(u) for u in uv); hi = max(max(u) for u in uv)
            if lo < -1e-4 or hi > 1 + 1e-4: fail(f'UVs leave the unit square ({lo:.3f}..{hi:.3f}) in {doc["materials"][p["material"]]["name"]}')
            if not stage and 'WEIGHTS_0' in attrs:
                bad = sum(1 for w in accessor(doc, blob, attrs['WEIGHTS_0']) if abs(sum(w) - 1) > .02 or max(w) <= 0)
                if bad: fail(f'{bad} vertices with weights that do not sum to 1')
            if 'JOINTS_1' in attrs: fail('more than four influences per vertex')
    if tris != meta['tris']: fail(f'metadata says {meta["tris"]} triangles, the GLB has {tris}')
    if nbytes != meta['bytes']: fail(f'metadata says {meta["bytes"]} bytes, the GLB is {nbytes} (rebuild, or run --stage rig/meta)')
    for u in sorted(used - set(slots)): fail(f'material {u} is not a metadata slot')
    images = doc.get('images', [])
    if len(images) != 2 or any(i.get('mimeType') != 'image/webp' for i in images): fail(f'expected two WebP maps, found {[i.get("mimeType") for i in images]}')
    limit = (60000, 4_000_000, 2048, 16) if stage else (50000, 3_000_000, 1024, 20)
    if tris > limit[0]: fail(f'{tris} triangles over the {limit[0]} budget')
    if nbytes > limit[1]: fail(f'{nbytes} bytes over the {limit[1]} budget')
    if meta['texture'] > limit[2]: fail(f'{meta["texture"]} px maps over the {limit[2]} budget')
    if len(slots) > limit[3]: fail(f'{len(slots)} slots over the {limit[3]} the shader carries')
    if stage:
        if doc.get('skins'): fail('an arena must be a static mesh')
        if not meta.get('extras', {}).get('collision'): fail('no collision recorded in the metadata')
        return errs, f'{tris} tris, {nbytes / 1e6:.2f} MB, {len(slots)} slots'
    joints = [names[j] for j in doc['skins'][0]['joints']] if doc.get('skins') else []
    for b in BONES:
        if b not in joints: fail(f'missing bone {b}')
    for j in doc['skins'][0]['joints'] if doc.get('skins') else []:
        r = doc['nodes'][j].get('rotation', [0, 0, 0, 1])
        if abs(abs(r[3]) - 1) > 1e-4: fail(f'bone {names[j]} has a rest rotation {r}; rest frames must be world-aligned')
    if sorted(joints) != sorted(meta['bones']): fail('metadata bones differ from the GLB joints')
    if len(meta.get('chains', {})) < 2: fail('fewer than two secondary-motion chains')
    for name, a in meta.get('anchors', {}).items():
        if a['bone'] not in joints: fail(f'anchor {name} is on a bone that does not exist ({a["bone"]})')
    costumes = json.load(open(os.path.join(GAME, 'assets', 'costumes', f'{kind}.json')))
    if len(costumes) != 4: fail(f'{len(costumes)} costumes, expected 4')
    for c in costumes:
        if len(c.get('swatch', [])) != 3: fail(f'costume {c["name"]} has no three-colour swatch')
        for s in slots:
            if s not in c['colors']: fail(f'costume {c["name"]} has no colour for {s}')
    if len({json.dumps(c['colors'], sort_keys=True) for c in costumes}) != 4: fail('two costumes are identical')
    top = meta['bounds']['max'][1]
    if abs(min(meta['bounds']['min'][1], 0)) > .02: fail(f'the model reaches {meta["bounds"]["min"][1]} below the floor')
    return errs, f'{tris} tris, {nbytes / 1e6:.2f} MB, {len(joints)} bones, {len(meta.get("chains", {}))} chains, {len(slots)} slots, top {top:.2f} m'

ids = [a for a in sys.argv[1:] if not a.startswith('-') and not a.endswith('.py')] or sorted(f[:-3].replace('_', '-') for f in os.listdir(HERE) if f.endswith('.py') and f[:-3] not in ('kit', 'body', 'head', 'validate'))
failed = False
for kind in ids:
    try: errs, summary = check(kind)
    except Exception as e: errs, summary = [f'{type(e).__name__}: {e}'], ''
    print(f'{"FAIL" if errs else "ok  "} {kind}: {summary}'); failed |= bool(errs)
    for e in errs: print(f'       {e}')
sys.exit(1 if failed else 0)
