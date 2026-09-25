"""Island Settlers art helpers (Blender 5.2, headless). Original work.

Geometry is written in glTF space: x east, y up, z south (toward the camera), in world units
(1 wu = hex circumradius = 1 Blender metre). `Part.build` converts to Blender's z-up space.
"""
import bpy, bmesh, math, sys
from pathlib import Path

INK, CREAM, SUN = '#05071a', '#fff6e5', '#ffd24a'
COLORS = {  # exact slot names from EXPERIENCE §1.8; bundles add their fixed colours
    'seat': '#d8352e', 'seat_dark': '#a3231e', 'ink': INK, 'cream': CREAM, 'stone': '#c9c2b3',
    'wood': '#8a5a36', 'metal': '#8d93a6', 'sail': CREAM, 'glow': SUN, 'outline': INK,
    'outline_cream': CREAM, 'decal': INK, 'shadow': INK,
}
OUTLINE = 0.014
EMIT = {'glow': 1.0}  # emission strength per material
TILT = math.radians(32)  # board camera: looks north, tilted 32 degrees from straight down
RIGHT, UP = (1, 0, 0), (0, math.sin(TILT), -math.cos(TILT))
AXES = {'x': lambda u, v, t: (t, v, u), 'y': lambda u, v, t: (u, t, v), 'z': lambda u, v, t: (u, v, t)}


def linear(hex_):
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x < 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1,)


def material(name):
    if name in bpy.data.materials: return bpy.data.materials[name]
    m = bpy.data.materials.new(name); m.use_nodes = True; m.use_backface_culling = True
    bsdf = m.node_tree.nodes['Principled BSDF']; col = linear(COLORS[name]); m.diffuse_color = col
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = 0.85; bsdf.inputs['Metallic'].default_value = 0
    if name in EMIT:
        bsdf.inputs['Emission Color'].default_value = col
        bsdf.inputs['Emission Strength'].default_value = EMIT[name]
    if name in ('decal', 'shadow'):
        m.surface_render_method = 'BLENDED'
        if name == 'decal': bsdf.inputs['Alpha'].default_value = 0.7
        else:  # blob shadow: alpha lives in the vertex colours
            attr = m.node_tree.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Color'
            m.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
            m.node_tree.links.new(attr.outputs['Alpha'], bsdf.inputs['Alpha'])
    return m


def dot(a, b): return sum(x * y for x, y in zip(a, b))
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def unit(a): n = math.sqrt(dot(a, a)); return tuple(x / n for x in a)


def newell(pts):
    n = [0.0, 0.0, 0.0]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return n


def pose(p, at=(0, 0, 0), yaw=0, pitch=0, roll=0, scale=(1, 1, 1)):
    """Scale, then roll (about z), pitch (about x), yaw (about y), then translate. Degrees."""
    x, y, z = (p[i] * scale[i] for i in range(3))
    r = math.radians(roll); x, y = x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r)
    r = math.radians(pitch); y, z = y * math.cos(r) - z * math.sin(r), y * math.sin(r) + z * math.cos(r)
    r = math.radians(yaw); x, z = x * math.cos(r) + z * math.sin(r), -x * math.sin(r) + z * math.cos(r)
    return (x + at[0], y + at[1], z + at[2])


def rect(w, d, cx=0, cz=0):
    return [(cx + sx * w / 2, cz + sz * d / 2) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def ngon(n, r, phase=None, sx=1, sz=1):
    """Points of a regular n-gon in the xz plane. Phase 0.5 puts a flat side toward the camera; the
    default avoids sides facing exactly east or west (edge-on to the camera, so no outline shows)."""
    if phase is None: phase = 0 if n % 4 == 0 and n > 4 else 0.5
    return [(r * sx * math.cos(a), -r * sz * math.sin(a))
            for a in (math.tau * (k + phase) / n + math.pi / 2 for k in range(n))]


class Part:
    """Accumulates faces for one node. Faces carry a material and whether they get an outline."""

    def __init__(self, closed=True):
        """`closed` parts cap their bottoms by default (outlined pieces); props skip hidden faces."""
        self.v, self.f, self.decals, self.kids, self.shadow, self.closed = [], [], [], [], None, closed

    def add(self, verts, faces, mat, outline=True, paint=None, **kw):
        """`mat` is one material name or one per face; `paint(normal)` may override it per face."""
        o = len(self.v); self.v += [pose(p, **kw) for p in verts]
        mats = [mat] * len(faces) if isinstance(mat, str) else mat
        for face, m in zip(faces, mats):
            face = tuple(o + i for i in face)
            if paint:
                n = newell([self.v[i] for i in face]); size = math.sqrt(sum(c * c for c in n)) or 1
                m = paint(tuple(c / size for c in n)) or m
            self.f.append((face, m, outline))
        return self

    def extrude(self, pts, t0, t1, mat, axis='y', caps=None, side=None, **kw):
        """Prism of a 2D polygon from t0 to t1 along an axis. Caps are (start, end)."""
        caps = caps or (self.closed, True)
        f, d = AXES[axis], 'xyz'.index(axis)
        if newell([f(u, v, 0) for u, v in pts])[d] < 0: pts = pts[::-1]
        n = len(pts); verts = [f(u, v, t0) for u, v in pts] + [f(u, v, t1) for u, v in pts]
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        mats = [side or mat] * n
        if caps[1]: faces.append(tuple(range(n, 2 * n))); mats.append(mat)
        if caps[0]: faces.append(tuple(range(n - 1, -1, -1))); mats.append(side or mat)
        return self.add(verts, faces, mats, **kw)

    def box(self, w, h, d, mat, at=(0, 0, 0), caps=None, **kw):
        """Box with its bottom centre at `at`."""
        return self.extrude(rect(w, d), 0, h, mat, caps=caps, at=at, **kw)

    def loft(self, rings, mat, cap=True, top=None, base=None, **kw):
        """Skin 3D rings, bottom to top, of equal size or a single apex point. The last ring gets a
        cap unless it is an apex; `base` closes the first ring too (a closed hull outlines better)."""
        if newell(next(r for r in rings if len(r) > 2))[1] < 0: rings = [r[::-1] for r in rings]
        verts, idx = [], []
        for ring in rings: idx.append(list(range(len(verts), len(verts) + len(ring)))); verts += ring
        n, faces = max(len(r) for r in idx), []
        for lo, hi in zip(idx, idx[1:]):
            for k in range(n):
                quad = (lo[k % len(lo)], lo[(k + 1) % len(lo)], hi[(k + 1) % len(hi)], hi[k % len(hi)])
                faces.append(tuple(dict.fromkeys(quad)))
        mats = [mat] * len(faces)
        if cap and len(idx[-1]) > 1: faces.append(tuple(idx[-1])); mats.append(top or mat)
        if (cap and self.closed if base is None else base) and len(idx[0]) > 1:
            faces.append(tuple(idx[0][::-1])); mats.append(mat)
        return self.add(verts, faces, mats, **kw)

    def lathe(self, prof, mat, n=8, phase=None, sx=1, sz=1, **kw):
        """Surface of revolution from (radius, y) pairs, bottom to top. Radius 0 closes to a point."""
        rings = [[(x, y, z) for x, z in ngon(n, r, phase, sx, sz)] if r else [(0, y, 0)] for r, y in prof]
        return self.loft(rings, mat, **kw)

    def convex(self, pts, mat, **kw):
        """Convex hull of 3D points (gems, rocks, rounded boxes)."""
        bm = bmesh.new(); vs = [bm.verts.new(p) for p in pts]
        bmesh.ops.convex_hull(bm, input=vs); bm.verts.index_update(); bm.normal_update()
        c = [sum(p[i] for p in pts) / len(pts) for i in range(3)]
        faces = []
        for f in bm.faces:
            ids = [v.index for v in f.verts]
            if sum((f.calc_center_median()[i] - c[i]) * f.normal[i] for i in range(3)) < 0: ids.reverse()
            faces.append(ids)
        verts = [tuple(v.co) for v in bm.verts]; bm.free()
        return self.add(verts, faces, mat, **kw)

    def flat(self, pts, y, mat, **kw):
        """One upward-facing polygon at height y from (x, z) points in any winding."""
        verts = [(x, y, z) for x, z in pts]
        if newell(verts)[1] < 0: verts.reverse()
        return self.add(verts, [tuple(range(len(verts)))], mat, **kw)

    def decal(self, size, at, normal):
        """Emblem quad (UV 0..1) on the plane through `at` with `normal`, shaped so it shows as an
        upright `size` square from the fixed board camera. The runtime sets its atlas UVs."""
        n = unit(normal); t1 = unit([RIGHT[i] - dot(RIGHT, n) * n[i] for i in range(3)]); t2 = cross(n, t1)
        a, b, c, d = dot(t1, RIGHT), dot(t2, RIGHT), dot(t1, UP), dot(t2, UP); det = a * d - b * c
        def corner(x, y):
            s1, s2 = (d * x - b * y) / det, (a * y - c * x) / det
            return tuple(at[i] + s1 * t1[i] + s2 * t2[i] for i in range(3))
        h = size / 2; self.decals.append([corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)])
        return self

    def child(self, name, part):
        self.kids.append((name, part)); return self

    def blob(self, rx, rz=None, n=12):
        self.shadow = (rx, rz or rx, n); return self

    def tris(self):
        return sum(len(face) - 2 for face, _, _ in self.f)

    def build(self, name, parent=None, cream=False):
        root = mesh_object(name, self.v, [(f, m) for f, m, _ in self.f], parent)
        lines = [f for f, _, keep in self.f if keep]
        if lines:
            hull(mesh_object(name + '_outline', self.v, [(f, 'outline_cream' if cream else 'outline')
                                                         for f in lines], root))
        if self.decals:
            quads = [q for quad in self.decals for q in quad]
            o = mesh_object(name + '_decal', quads, [((i, i + 1, i + 2, i + 3), 'decal')
                                                     for i in range(0, len(quads), 4)], root)
            uv = o.data.uv_layers.new(name='UVMap')
            for loop in o.data.loops: uv.data[loop.index].uv = ((0, 0), (1, 0), (1, 1), (0, 1))[loop.index % 4]
        if self.shadow: blob_shadow(name + '_shadow', *self.shadow, root)
        for kid, part in self.kids: part.build(kid, root, cream)
        return root


def mesh_object(name, verts, faces, parent=None):
    used = sorted({i for f, _ in faces for i in f}); at = {i: k for k, i in enumerate(used)}
    mats = list(dict.fromkeys(m for _, m in faces))
    me = bpy.data.meshes.new('m_' + name)
    me.from_pydata([(verts[i][0], -verts[i][2], verts[i][1]) for i in used], [],
                   [[at[i] for i in f] for f, _ in faces])
    for m in mats: me.materials.append(material(m))
    for poly, (_, m) in zip(me.polygons, faces): poly.material_index = mats.index(m)
    me.validate(); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); o.parent = parent
    return o


def hull(o):
    """Inverted-hull outline: push every vertex out along its normal by OUTLINE (even thickness).
    Normals stay outward; the runtime draws it with side: BackSide. Nothing sinks below y = 0.004,
    so a closed base leaves an ink rim on the table instead of vanishing into the tile."""
    bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update()
    moves = [v.normal * OUTLINE * min(v.calc_shell_factor(), 2.0) for v in bm.verts]
    for v, d in zip(bm.verts, moves): v.co += d; v.co.z = max(v.co.z, 0.004)
    bm.to_mesh(o.data); bm.free()


def blob_shadow(name, rx, rz, n, parent):
    """Baked blob shadow: a fan at y = 0.002 whose vertex alpha falls from 0.35 to 0."""
    verts = [(0, 0.002, 0)] + [(x, 0.002, z) for x, z in ngon(n, 1, 0, rx, rz)]
    o = mesh_object(name, verts, [((0, k + 1, (k + 1) % n + 1), 'shadow') for k in range(n)], parent)
    col = o.data.color_attributes.new(name='Color', type='BYTE_COLOR', domain='POINT')
    for i, c in enumerate(col.data): c.color = (0.0015, 0.002, 0.01, 0.35 if i == 0 else 0)
    return o


def reset():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = Path(argv[0]) if argv else None
    prev = Path(argv[argv.index('--preview') + 1]) if '--preview' in argv else None
    return out, prev


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons) + sum(triangles(c) for c in o.children)


def export(roots, path, budgets=None):
    """Write roots (at the origin) to a GLB and print the per-node triangle report."""
    for r in roots:
        n = triangles(r); cap = (budgets or {}).get(r.name)
        print(f'{r.name:22} {n:5} tris' + (f' / {cap}' + ('  OVER' if n > cap else '') if cap else ''))
    print(f'{"total":22} {sum(triangles(r) for r in roots):5} tris')
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=False, export_materials='EXPORT',
        export_vertex_color='MATERIAL', export_draco_mesh_compression_enable=False,
        export_extras=False, export_animations=False, export_cameras=False, export_lights=False)
    print(f'wrote {path.resolve()} ({path.stat().st_size} bytes)')
