"""Sky Clash fighter kit for headless Blender 5.2. Read tools/blender/README.md first.

Character space everywhere: +X is the fighter's LEFT, +Y up, +Z forward (facing), meters, feet at y=0.
This is glTF space, so a point you author is the point that ships. Blender's own Z-up space is only
touched inside this file (the C matrix). Bones point straight up with zero roll, so every exported
joint has an identity rest rotation and a pose is a plain character-space rotation per bone.

Geometry helpers return bmesh objects in character space. Hand them to Model.add with a material
(name or painter) and a bone (name, {bone: weight}, or weight function). Model.finish() scales the
fighter to its roster height, rigs and joins; Model.export() writes the GLB, costumes and model JSON.
"""
import bpy, bmesh, math, os, re, sys, json, contextlib, shutil
import numpy as np
from mathutils import Vector, Matrix, Euler, geometry
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.realpath(__file__))
GAME = os.path.normpath(os.path.join(HERE, '..', '..'))
REPO = os.path.normpath(os.path.join(GAME, '..', '..', '..', '..'))
OUT = os.path.join(REPO, 'output', 'sky-clash-v2', 'models')
sys.dont_write_bytecode = True  # keep tools/blender free of __pycache__ (Blender ignores PYTHONDONTWRITEBYTECODE)
for _d in ('', 'fighters'): shutil.rmtree(os.path.join(HERE, _d, '__pycache__'), ignore_errors=True)

def _ts_list(name):
    src = open(os.path.join(GAME, 'src', 'model.ts')).read()
    return re.findall(r"'([^']+)'", re.search(rf'export const {name} = \[(.*?)\] as const', src, re.S).group(1))
BONES, MATERIALS, EXTRA = _ts_list('BONES'), _ts_list('MATERIALS'), 'extra_'
PARENTS = {'root': None, 'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'prop': 'hand_R'}
for _S in 'LR':
    PARENTS.update({f'shoulder_{_S}': 'chest', f'upperarm_{_S}': f'shoulder_{_S}', f'forearm_{_S}': f'upperarm_{_S}', f'hand_{_S}': f'forearm_{_S}',
                    f'thigh_{_S}': 'hips', f'shin_{_S}': f'thigh_{_S}', f'foot_{_S}': f'shin_{_S}'})
assert set(PARENTS) == set(BONES), 'model.ts BONES changed; update PARENTS'

def roster():
    src = open(os.path.join(GAME, 'src', 'roster.ts')).read(); start = src.index('{', src.index('ROSTER_DATA'))
    return json.loads(src[start:src.index('} as const') + 1])
ROSTER = roster()

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # character -> Blender
CI = C.inverted(); C3, CI3 = C.to_3x3(), CI.to_3x3()

# ── Math ─────────────────────────────────────────────────────────────────────
def v3(p): return Vector(p) if len(p) == 3 else Vector((p[0], p[1], 0))
def mx(p, s): return Vector((p[0] * s, p[1], p[2]))  # mirror a point to side s (+1 left, -1 right)
def lerp(a, b, t): return v3(a).lerp(v3(b), t)
def rot3(rot): return Euler([math.radians(a) for a in rot]).to_matrix() if rot else Matrix.Identity(3)
def rot4(rot): return rot3(rot).to_4x4()
def smooth01(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
def aim(z, up=(0, 1, 0)):
    """Rotation whose Z axis is z and whose Y axis leans toward up."""
    z = v3(z).normalized(); x = v3(up).cross(z)
    if x.length < 1e-5: x = Vector((1, 0, 0)).cross(z)
    x.normalize(); return Matrix((x, z.cross(x), z)).transposed()
def bez(a, b, c, n=6):
    a, b, c = v3(a), v3(b), v3(c); return [a * (1 - t) ** 2 + b * 2 * t * (1 - t) + c * t * t for t in np.linspace(0, 1, n)]
def spline(pts, n=12):
    """Catmull-Rom curve through pts with n samples (for hair, tails, brows, piping)."""
    P = [v3(p) for p in pts]; P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]; out = []
    for k in range(n):
        t = k / (n - 1) * (len(P) - 3); i = min(int(t), len(P) - 4); u = t - i; p0, p1, p2, p3 = P[i:i + 4]
        out.append(.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u ** 3))
    return out

# ── Primitive meshes (bmesh, character space) ────────────────────────────────
def sphere(c, r, seg=16, rings=None, rot=None):
    """Sphere or ellipsoid (r may be (rx, ry, rz)); poles on the Y axis."""
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings or max(6, seg // 2 + 1), radius=1)
    rr = (r, r, r) if isinstance(r, (int, float)) else r
    bmesh.ops.transform(bm, matrix=Matrix.Translation(v3(c)) @ rot4(rot) @ Matrix.Diagonal((*rr, 1)) @ rot4((90, 0, 0)), verts=bm.verts)
    return bm

def rbox(c, size, bevel=.02, rot=None, seg=2):
    """Bevelled box with full size (w, h, d)."""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); bmesh.ops.transform(bm, matrix=Matrix.Diagonal((*size, 1)), verts=bm.verts)
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=min(bevel, min(size) * .49), segments=seg, profile=.5, affect='EDGES')
    bmesh.ops.transform(bm, matrix=Matrix.Translation(v3(c)) @ rot4(rot), verts=bm.verts)
    return bm

def _skin(rings, cap0=True, cap1=True):
    bm = bmesh.new(); loops = [[bm.verts.new(p) for p in r] for r in rings]
    for a, b in zip(loops, loops[1:]):
        n = max(len(a), len(b))
        for i in range(n):
            if len(a) == 1: bm.faces.new((a[0], b[i], b[(i + 1) % n]))
            elif len(b) == 1: bm.faces.new((a[i], b[0], a[(i + 1) % n]))
            else: bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap0 and len(loops[0]) > 2: bm.faces.new(loops[0][::-1])
    if cap1 and len(loops[-1]) > 2: bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); return bm

def lathe(a, b, prof, seg=16, sq=(1, 1), up=(0, 0, 1), shape=None):
    """Surface of revolution along a->b. prof: [(d, r)] with d meters from a; r=0 closes a pole.
    sq squashes the section (side, up-hint axes); shape(angle)->scale deforms it (e.g. a flat-backed boot)."""
    a, b = v3(a), v3(b); u = (b - a).normalized(); R = aim(u, up); rings = []
    for d, r in prof:
        o = a + u * d; ring = []
        for i in range(seg):
            t = 2 * math.pi * i / seg; k = shape(t) if shape else 1
            ring.append(o + R @ Vector((math.cos(t) * r * sq[0] * k, math.sin(t) * r * sq[1] * k, 0)))
        rings.append([o] if r < 1e-6 else ring)
    return _skin(rings)

def capsule(a, b, ra, rb=None, seg=16, sq=(1, 1), up=(0, 0, 1), caps=4):
    """Capsule whose hemispherical ends are centered exactly on a and b: put a and b on joints and the part
    rotates about the joint without opening a gap (a clean ball joint)."""
    rb = ra if rb is None else rb; L = (v3(b) - v3(a)).length
    prof = [(-ra * math.cos(t), ra * math.sin(t)) for t in (math.pi / 2 * i / caps for i in range(caps + 1))]
    prof += [(L + rb * math.sin(t), rb * math.cos(t)) for t in (math.pi / 2 * i / caps for i in range(caps + 1))]
    return lathe(a, b, prof, seg, sq, up)

def cyl(a, b, r, rb=None, seg=16, bevel=0.0, sq=(1, 1), up=(0, 0, 1)):
    rb = r if rb is None else rb; L = (v3(b) - v3(a)).length; e = bevel
    prof = [(0, 0), (0, r - e), (e * .3, r - e * .3), (e, r), (L - e, rb), (L - e * .3, rb - e * .3), (L, rb - e), (L, 0)] if e else [(0, 0), (0, r), (L, rb), (L, 0)]
    return lathe(a, b, prof, seg, sq, up)

def torus(c, R, r, seg=24, rseg=8, rot=None, sq=(1, 1)):
    """Ring in the XZ plane (a belt or cuff around a vertical part). R may be (rx, rz); sq scales the tube (radial, vertical)."""
    rx, rz = (R, R) if isinstance(R, (int, float)) else R; bm = bmesh.new(); loops = []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        loops.append([bm.verts.new(((rx + r * math.cos(s) * sq[0]) * math.cos(t), r * math.sin(s) * sq[1], (rz + r * math.cos(s) * sq[0]) * math.sin(t)))
                      for s in (2 * math.pi * j / rseg for j in range(rseg))])
    for i in range(seg):
        a, b = loops[i], loops[(i + 1) % seg]
        for j in range(rseg): bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bmesh.ops.transform(bm, matrix=Matrix.Translation(v3(c)) @ rot4(rot), verts=bm.verts)
    return bm

def _frames(pts, up):
    pts = [v3(p) for p in pts]; n = len(pts)
    T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    side = T[0].cross(v3(up)); side = side.normalized() if side.length > 1e-5 else T[0].orthogonal().normalized(); F = []
    for i in range(n):
        if i: side = (T[i - 1].rotation_difference(T[i]) @ side).normalized()
        F.append((pts[i], side, side.cross(T[i]).normalized()))
    return F, T

def sweep(pts, section, up=(0, 0, 1), round_ends=(False, False)):
    """Sweep a 2D loop along a polyline. section(i, t) returns [(side, normal)] offsets."""
    F, T = _frames(pts, up); rings = [[o + s * a + nm * b for a, b in section(i, i / max(1, len(F) - 1))] for i, (o, s, nm) in enumerate(F)]
    for end in (0, 1):
        if not round_ends[end]: continue
        o, t = F[-end][0], T[-end] * (1 if end else -1); ring = rings[-end]; r = max((p - o).length for p in ring)
        cap = [[o + t * r * math.sin(a) + (p - o) * math.cos(a) for p in ring] for a in (.75, 1.2)] + [[o + t * r]]
        rings = rings + cap if end else cap[::-1] + rings
    return _skin(rings, not round_ends[0], not round_ends[1])

def tube(pts, radii, seg=10, up=(0, 0, 1), ends=(True, True), sq=(1, 1)):
    """Round tube along pts (radii scalar or per point). ends=True rounds that end."""
    radii = radii if isinstance(radii, (list, tuple)) else [radii] * len(pts)
    return sweep(pts, lambda i, t: [(math.cos(a) * radii[i] * sq[0], math.sin(a) * radii[i] * sq[1]) for a in (2 * math.pi * k / seg for k in range(seg))], up, ends)

def spike(a, b, c, r, sq=(1, .62), up=(0, 1, 0), n=8, power=.85, seg=9):
    """Curved cone from a through control b to a sharp tip at c (hair clump, horn, claw, ear)."""
    return tube(bez(a, b, c, n), [max(.002, r * (1 - k / (n - 1)) ** power) for k in range(n)], seg, up, ends=(True, False), sq=sq)

def strand(pts, r0, r1=.002, sq=(1, 1), up=(0, 0, 1), n=12, seg=10):
    """Tapered smooth tube through control points (Catmull-Rom): locks of hair, tails, antennae, piping."""
    P = spline(pts, n); return tube(P, [r0 + (r1 - r0) * (k / (n - 1)) ** 1.2 for k in range(n)], seg, up, (True, True), sq)

def ribbon(pts, widths, thick, normal=(0, 0, -1), seg=14, round_=.35):
    """Flat strip along pts; width lies along the side vector, thickness along the normal hint (scarves, straps)."""
    widths = widths if isinstance(widths, (list, tuple)) else [widths] * len(pts)
    thick = thick if isinstance(thick, (list, tuple)) else [thick] * len(pts)
    def sec(i, t):
        return [(math.copysign(abs(math.cos(a)) ** round_, math.cos(a)) * widths[i] / 2, math.copysign(abs(math.sin(a)) ** round_, math.sin(a)) * thick[i] / 2)
                for a in (2 * math.pi * k / seg for k in range(seg))]
    return sweep(pts, sec, normal)

def sheet(fn, nu=12, nv=10, thick=.012, closed_u=False):
    """Thin solid from a parametric surface fn(u, v) -> point, u across and v along [0, 1] (capes, skirts, brims, ears)."""
    bm = bmesh.new(); cols = nu if closed_u else nu + 1
    grid = [[bm.verts.new(v3(fn(i / nu, j / nv))) for i in range(cols)] for j in range(nv + 1)]
    for j in range(nv):
        for i in range(nu):
            i2 = (i + 1) % cols if closed_u else i + 1; bm.faces.new((grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]))
    bm.normal_update(); bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=thick)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); return bm

def _fill2d(loops, spacing):
    """Constrained Delaunay fill of 2D loops (outer + holes by parity) with interior points every `spacing`."""
    pts, edges, faces = [], [], []
    for loop in loops:
        ring = []
        for a, b in zip(loop, loop[1:] + loop[:1]):
            n = max(1, int(math.dist(a, b) / spacing))
            ring += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
        base = len(pts); pts += ring; idx = list(range(base, len(pts)))
        edges += [(idx[k], idx[(k + 1) % len(idx)]) for k in range(len(idx))]; faces.append(idx)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    for x in np.arange(min(xs) + spacing / 2, max(xs), spacing):
        for y in np.arange(min(ys) + spacing / 2, max(ys), spacing * .866):
            q = (x + (spacing / 2 if int((y - min(ys)) / spacing / .866) % 2 else 0), y)
            if sum(_in_poly(q, l) for l in loops) % 2 == 1 and min(math.dist(q, p) for p in pts) > spacing * .45: pts.append(q)
    V, E, F, *_ = geometry.delaunay_2d_cdt([Vector(p) for p in pts], edges, faces, 3, 1e-6)
    return [tuple(v) for v in V], F

def _in_poly(q, loop):
    x, y = q; c = False
    for (x1, y1), (x2, y2) in zip(loop, loop[1:] + loop[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def _solid2d(V, F, place, bottom=True):
    """Top/side (and bottom) solid from a 2D triangulation; place(uv, top) -> 3D point."""
    bm = bmesh.new(); top = [bm.verts.new(place(v, True)) for v in V]; bot = [bm.verts.new(place(v, False)) for v in V]
    count = {}
    for f in F:
        bm.faces.new([top[i] for i in f])
        if bottom: bm.faces.new([bot[i] for i in f[::-1]])
        for a, b in zip(f, f[1:] + f[:1]): count[(min(a, b), max(a, b))] = count.get((min(a, b), max(a, b)), 0) + 1
    for (a, b), k in count.items():
        if k == 1: bm.faces.new((top[a], top[b], bot[b], bot[a]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); return bm

def slab(loops, depth, M=None, spacing=None, bevel=0.0):
    """Extrude flat 2D outlines (list of [(u, v)] loops; holes by nesting) into a slab of `depth` centered on the
    uv plane, then place it with matrix M. For Game & Watch, emblems, blades and flat props. bevel rounds the rim."""
    xs = [p[0] for l in loops for p in l]; ys = [p[1] for l in loops for p in l]
    V, F = _fill2d(loops, spacing or max(max(xs) - min(xs), max(ys) - min(ys)) / 10)
    bm = _solid2d(V, F, lambda uv, top: Vector((uv[0], uv[1], depth / 2 if top else -depth / 2)))
    if bevel: bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.calc_face_angle(0) > 1.0], offset=bevel, segments=2, profile=.6, affect='EDGES')
    if M: bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm

def ellipse(rx, ry, n=28, c=(0, 0), rot=0):
    r = math.radians(rot); return [(c[0] + rx * math.cos(t) * math.cos(r) - ry * math.sin(t) * math.sin(r), c[1] + rx * math.cos(t) * math.sin(r) + ry * math.sin(t) * math.cos(r))
                                   for t in (2 * math.pi * i / n for i in range(n))]

MB_T = .6
def _mbk(stiff): return math.sqrt(1 - (MB_T / stiff) ** (1 / 3))
def blob(elems, res=None, tris=None, relax=0):
    """Metaball union converted to a mesh: smooth organic blends (heads, torsos, paws, muscles).
    Elements: ('ball', c, r) | ('ell', c, (rx, ry, rz)[, rot]) | ('cap', a, b, r) | ('box', c, (hx, hy, hz), round[, rot]),
    optional trailing dict {'neg': True, 'stiff': 3}. Radii are the visible radii. Higher stiff = tighter blend (2 soft, 3 default, 8 crisp).
    res defaults to a fifth of the smallest radius; tris decimates to a budget; relax smooths the result (iterations)."""
    name = f'mb{blob.n}'; blob.n += 1; radii = []
    mb = bpy.data.metaballs.new(name); mb.threshold = MB_T
    ob = bpy.data.objects.new(name, mb); bpy.context.scene.collection.objects.link(ob)
    for e in elems:
        opt = e[-1] if isinstance(e[-1], dict) else {}; e = e[:-1] if opt else e; kind = e[0]; s = opt.get('stiff', 3.0); k = _mbk(s)
        el = mb.elements.new(type={'ball': 'BALL', 'ell': 'ELLIPSOID', 'cap': 'CAPSULE', 'box': 'CUBE'}[kind]); el.stiffness = s; el.use_negative = opt.get('neg', False)
        if kind == 'ball': el.co = C @ v3(e[1]); el.radius = e[2] / k; radii.append(e[2])
        elif kind == 'ell':
            rr = Vector(e[2]); m = min(rr); el.co = C @ v3(e[1]); el.radius = m / k; el.size_x, el.size_y, el.size_z = rr[0] / m, rr[2] / m, rr[1] / m
            el.rotation = (C3 @ rot3(e[3] if len(e) > 3 else None) @ CI3).to_quaternion(); radii.append(m)
        elif kind == 'box':
            hh, rd = Vector(e[2]), e[3]; el.co = C @ v3(e[1]); el.radius = rd / k
            el.size_x, el.size_y, el.size_z = [max(1e-3, x - rd) for x in (hh[0], hh[2], hh[1])]
            el.rotation = (C3 @ rot3(e[4] if len(e) > 4 else None) @ CI3).to_quaternion(); radii.append(rd)
        else:
            a, b, r = v3(e[1]), v3(e[2]), e[3]; el.co = C @ ((a + b) / 2); el.radius = r / k; el.size_x = (b - a).length / 2
            el.rotation = Vector((1, 0, 0)).rotation_difference(C3 @ (b - a).normalized()); radii.append(r)
    mb.resolution = mb.render_resolution = res or max(.004, min(.03, min(radii) / 5))
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob); bpy.data.metaballs.remove(mb)
    bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.transform(bm, matrix=CI, verts=bm.verts); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if tris: decimate(bm, tris)
    if relax: smooth(bm, relax)
    return bm
blob.n = 0

def _via_object(bm, mods):
    me = bpy.data.meshes.new('tmp'); bm.to_mesh(me); ob = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(ob)
    for kind, props in mods:
        md = ob.modifiers.new(kind, kind)
        for k, v in props.items(): setattr(md, k, v)
    m2 = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bm.clear(); bm.from_mesh(m2); bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); bpy.data.meshes.remove(m2); return bm

def tri_count(bm): return sum(len(f.verts) - 2 for f in bm.faces)
def decimate(bm, target):
    t = tri_count(bm)
    return bm if t <= target else _via_object(bm, [('DECIMATE', {'ratio': target / t, 'use_collapse_triangulate': False})])
def subd(bm, levels=2):
    """Catmull-Clark subdivision: build a low-poly cage (rbox/lathe/sheet), then subdivide for perfectly smooth forms."""
    return _via_object(bm, [('SUBSURF', {'levels': levels, 'render_levels': levels})])
def wire(bm, thick=.012, tris=None):
    """Lattice of a mesh's edges as thin struts (the Wireframes): decimate a smooth body to `tris` triangles first
    (a few hundred reads as a wire figure), then every edge becomes a strut. Output is about 12x `tris` triangles."""
    if tris: decimate(bm, tris)
    return _via_object(bm, [('WIREFRAME', {'thickness': thick, 'use_even_offset': True, 'use_replace': True, 'use_boundary': True, 'use_relative_offset': False})])
def smooth(bm, iterations=2, factor=.5):
    """Relax vertices to even out metaball/decimation noise so toon bands stay clean. Closed meshes use a
    volume-preserving Laplacian; open meshes (garment shells) relax interior vertices only, keeping borders put."""
    border = {v for e in bm.edges if not e.is_manifold for v in e.verts}
    for _ in range(iterations):
        if border: bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v not in border], factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        else: bmesh.ops.smooth_laplacian_vert(bm, verts=bm.verts, lambda_factor=factor, lambda_border=0, use_x=True, use_y=True, use_z=True, preserve_volume=True)
    return bm

def cut(bm, co, no, keep='both'):
    """Bisect along a plane. keep='above' deletes the side opposite `no` and caps the hole; 'below' the other side."""
    res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=v3(co), plane_no=v3(no),
                                 clear_inner=keep == 'above', clear_outer=keep == 'below')
    if keep != 'both':
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_valid]
        if edges: bmesh.ops.holes_fill(bm, edges=edges, sides=0); bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def split_by(bm, f):
    """Cut the mesh along the zero set of the scalar field f(point), so painted zones get clean curved borders
    instead of triangle zig-zags. The mesh is triangulated first, so each crossed triangle is cut exactly once.
    Field values are kept in the 'zone' vertex layer for outside()."""
    bmesh.ops.triangulate(bm, faces=bm.faces[:]); lay = bm.verts.layers.float.get('zone') or bm.verts.layers.float.new('zone')
    for v in bm.verts: v[lay] = f(v.co)
    made = set()
    for e in [e for e in bm.edges if (e.verts[0][lay] < 0) != (e.verts[1][lay] < 0)]:
        a, b = e.verts; t = a[lay] / (a[lay] - b[lay]); pa, pb = a.co.copy(), b.co.copy()
        _, nv = bmesh.utils.edge_split(e, a, t); nv.co = pa.lerp(pb, t); nv[lay] = 0.0; made.add(nv)
    for face in {fc for v in made for fc in v.link_faces}:
        vs = [v for v in face.verts if v in made]
        if face.is_valid and len(vs) == 2 and not any(e.other_vert(vs[0]) == vs[1] for e in vs[0].link_edges): bmesh.ops.connect_verts(bm, verts=vs)
    return bm

def outside(face, bm):
    """True if a face lies on the negative side of the last split_by field."""
    lay = bm.verts.layers.float['zone']; return any(v[lay] < 0 for v in face.verts)

def layer(bm, keep, inflate=.012, thick=.014, relax=0, tris=None):
    """Garment shell: copy of bm pushed out by `inflate`, trimmed to keep(p) > 0 with a clean border, given thickness.
    Overalls on a torso, a jacket, a vest, sleeves, a skirt hem, armor plates."""
    g = bm.copy(); push(g, inflate)
    if tris: decimate(g, int(tris * len(g.faces) / max(1, sum(1 for fc in g.faces if keep(fc.calc_center_median()) > 0))))
    split_by(g, keep); bmesh.ops.delete(g, geom=[fc for fc in g.faces if outside(fc, g)], context='FACES')
    if relax: smooth(g, relax)
    g.normal_update(); bmesh.ops.solidify(g, geom=list(g.faces), thickness=thick); bmesh.ops.recalc_face_normals(g, faces=g.faces)
    return g

def trim(bm, covered, margin=.02):
    """Delete faces hidden under a garment layer: covered(p) > margin at the face center (same field as layer's keep)."""
    bmesh.ops.delete(bm, geom=[fc for fc in bm.faces if covered(fc.calc_center_median()) > margin], context='FACES'); return bm

def merge(*bms):
    out = bmesh.new()
    for b in bms: me = bpy.data.meshes.new('t'); b.to_mesh(me); out.from_mesh(me); bpy.data.meshes.remove(me)
    return out
def xform(bm, loc=(0, 0, 0), rot=None, scale=None, pivot=(0, 0, 0)):
    p = v3(pivot); S = Matrix.Diagonal((*(scale or (1, 1, 1)), 1))
    bmesh.ops.transform(bm, matrix=Matrix.Translation(v3(loc) + p) @ rot4(rot) @ S @ Matrix.Translation(-p), verts=bm.verts); return bm
def mirrored(bm):
    """Copy mirrored across X (the other side of a symmetric part)."""
    g = bm.copy(); bmesh.ops.transform(g, matrix=Matrix.Diagonal((-1, 1, 1, 1)), verts=g.verts); bmesh.ops.reverse_faces(g, faces=g.faces); return g
def push(bm, amount, pred=lambda p: True):
    """Inflate vertices along their normals where pred(position) holds (raised trims, cuffs, garment shells)."""
    bm.normal_update()
    for v in bm.verts:
        if pred(v.co): v.co += v.normal * (amount(v.co) if callable(amount) else amount)
    return bm
def bend(bm, fn):
    """Arbitrary displacement: fn(position) -> new position."""
    for v in bm.verts: v.co = v3(fn(v.co.copy()))
    return bm

# ── Surfaces: project features onto a sculpted part ─────────────────────────
class Surf:
    """Ray/nearest queries on a part, e.g. to seat eyes, brows, mouths and emblems on a head."""
    def __init__(self, bm): self.tree = BVHTree.FromBMesh(bm)
    def hit(self, p, d=(0, 0, -1)):
        """Point and normal where a ray along d, passing through p (from outside), first meets the surface."""
        d = v3(d).normalized(); loc, n, *_ = self.tree.ray_cast(v3(p) - d * 4, d)
        if loc is None: loc, n, *_ = self.tree.find_nearest(v3(p))
        return loc, n.normalized()
    def near(self, p): loc, n, *_ = self.tree.find_nearest(v3(p)); return loc, n.normalized()
    def onto(self, pts, lift=0.0, d=None):
        return [(lambda h: h[0] + h[1] * lift)(self.hit(p, d) if d else self.near(p)) for p in pts]

def frame_at(n, up=(0, 1, 0), spin=0.0):
    """Tangent frame (right, up, normal) at a surface normal, spun `spin` degrees about the normal."""
    n = v3(n).normalized(); u = (v3(up) - n * n.dot(v3(up))); u = u.normalized() if u.length > 1e-4 else n.orthogonal().normalized()
    r = u.cross(n); a = math.radians(spin); r, u = r * math.cos(a) + u * math.sin(a), u * math.cos(a) - r * math.sin(a); return r, u, n

def stamp(surf, c, loops, thick=.006, d=(0, 0, -1), up=(0, 1, 0), spin=0.0, lift=0.0, spacing=None, sink=.004, closed=False):
    """Raised inlay that hugs a curved surface: 2D outline loops (meters, u right / v up) centered where a ray along d
    through c hits `surf`. Emblems, blush, mouths, spots, badges. Its walls sink into the surface, so the hidden
    bottom is left open unless closed=True."""
    p0, n0 = surf.hit(c, d); r, u, n = frame_at(n0 if d is None else (n0 - v3(d)).normalized(), up, spin)
    xs = [p[0] for l in loops for p in l]; V, F = _fill2d(loops, spacing or max((max(xs) - min(xs)) / 7, .008))
    def place(uv, top):
        q = p0 + r * uv[0] + u * uv[1]; h, hn = surf.hit(q, -n)
        return h + hn * (lift + thick if top else -sink)
    return _solid2d(V, F, place, closed)

# ── Weights ──────────────────────────────────────────────────────────────────
def chain_weights(names, pts):
    """Smooth weights along a chain whose bone heads are pts[:-1] (pts[-1] is the tip). names[0] may be the parent bone."""
    pts = [v3(p) for p in pts]
    def w(p):
        best, s = 1e9, 0.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]; ab = b - a; t = max(0, min(1, (v3(p) - a).dot(ab) / ab.length_squared)); dd = (a + ab * t - v3(p)).length
            if dd < best: best, s = dd, i + t
        i = min(int(s), len(names) - 1); f = s - i
        if f < .5 and i > 0: return {names[i]: .5 + f, names[i - 1]: .5 - f}
        if f >= .5 and i + 1 < len(names): return {names[i]: 1.5 - f, names[i + 1]: f - .5}
        return {names[i]: 1.0}
    return w

def blend(*pairs):
    """Mix weight sources: blend((fnA, share(p)), (fnB, share(p))...) where share returns 0..1."""
    def w(p):
        out = {}
        for fn, share in pairs:
            k = share(p) if callable(share) else share
            if k <= 0: continue
            for b, x in (fn(p) if callable(fn) else ({fn: 1.0} if isinstance(fn, str) else fn)).items(): out[b] = out.get(b, 0) + x * k
        return out
    return w

# ── Materials ────────────────────────────────────────────────────────────────
def srgb(h):
    h = h.lstrip('#'); return [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))]
FINISH = {'metal': (.3, .85), 'eye': (.15, 0), 'eye-white': (.2, 0), 'dark': (.5, 0), 'emissive': (.4, 0), 'trim': (.45, 0)}  # (roughness, metallic)
def make_materials(colors, finish=None):
    mats = {}
    for name, hexc in colors.items():
        assert name in MATERIALS, f'unknown material {name}; use one of {MATERIALS}'
        m = bpy.data.materials.new(name); b = m.node_tree.nodes['Principled BSDF']; col = srgb(hexc)
        rough, metal = (finish or {}).get(name, FINISH.get(name, (.62, 0)))
        b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
        if name == 'emissive': b.inputs['Emission Color'].default_value = (*col, 1); b.inputs['Emission Strength'].default_value = 1
        m.diffuse_color = (*col, 1); mats[name] = m
    return mats

# ── Skeletons ────────────────────────────────────────────────────────────────
def skeleton(pos, parents=None):
    """Joint map {bone: (position, parent)} from explicit positions for every contract bone (any body plan:
    a hand, a flat figure, a ball). Missing bones raise. parents overrides PARENTS (e.g. {'prop': 'hand_L'})."""
    par = {**PARENTS, **(parents or {})}; missing = [b for b in BONES if b not in pos]
    assert not missing, f'skeleton missing {missing}'
    return {b: (tuple(v3(pos[b])), par[b]) for b in BONES}

def humanoid(hip, spine, chest, neck, head, arm_y, shoulder, arm, elbow, wrist, leg, leg_y, knee, ankle, clav_y=None, grip=None,
             arm_z=0.0, knee_z=0.0, ankle_z=0.0, parents=None):
    """Standard biped joints. Single numbers are Y heights (hip..head, leg_y, knee, ankle) or left-side X offsets
    (shoulder = clavicle bone, arm = shoulder ball, elbow, wrist, leg). grip is the prop point (default just past
    the right wrist). Arms lie along X at arm_y in the T-pose."""
    p = {'root': (0, 0, 0), 'hips': (0, hip, 0), 'spine': (0, spine, 0), 'chest': (0, chest, 0), 'neck': (0, neck, 0), 'head': (0, head, 0)}
    for s, S in ((1, 'L'), (-1, 'R')):
        p[f'shoulder_{S}'] = (s * shoulder, clav_y or arm_y, arm_z); p[f'upperarm_{S}'] = (s * arm, arm_y, arm_z)
        p[f'forearm_{S}'] = (s * elbow, arm_y, arm_z); p[f'hand_{S}'] = (s * wrist, arm_y, arm_z)
        p[f'thigh_{S}'] = (s * leg, leg_y, 0); p[f'shin_{S}'] = (s * leg, knee, knee_z); p[f'foot_{S}'] = (s * leg, ankle, ankle_z)
    side = -1 if (parents or {}).get('prop', 'hand_R') == 'hand_R' else 1
    p['prop'] = grip or (side * (wrist + (wrist - elbow) * .45), arm_y, arm_z)
    return skeleton(p, parents)

def P(J, b): return v3(J[b][0])

# ── Model assembly ───────────────────────────────────────────────────────────
class Model:
    """One fighter. colors: costume-0 palette {material: hex}; costumes: three more (name, {material: hex}) overrides
    after the default name. prop: 'always' (sword on the hand), 'move' (shown only by moves, e.g. Fox's blaster) or 'none'."""
    def __init__(self, kind, J, colors, costumes, default_name='Default', prop='none', finish=None):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        assert kind in ROSTER, f'{kind} is not in roster.ts'
        assert len(costumes) == 3, 'give exactly three alternates (four costumes including the default)'
        self.kind, self.info, self.J, self.parts, self.extras, self.stats, self.prop = kind, ROSTER[kind], dict(J), [], {}, [], prop
        self.costumes = [{'name': default_name, 'colors': dict(colors)}] + [{'name': n, 'colors': {**colors, **c}} for n, c in costumes]
        for c in self.costumes:
            assert set(c['colors']) == set(colors), f'costume {c["name"]} adds unknown materials'
            assert all(re.fullmatch(r'#[0-9a-fA-F]{6}', h) for h in c['colors'].values()), f'bad hex in {c["name"]}'
        self.mats = make_materials(colors, finish); self.xf = Matrix.Identity(4)

    @contextlib.contextmanager
    def transform(self, pivot=(0, 0, 0), scale=1.0, loc=(0, 0, 0), rot=None):
        """Parts and chain joints added inside `with m.transform(...)` are scaled/rotated about pivot, then moved:
        resize a finished head, tilt a hat, reuse a limb builder elsewhere. Nests."""
        k = scale if isinstance(scale, (tuple, list)) else (scale,) * 3; p = v3(pivot); old = self.xf
        self.xf = old @ Matrix.Translation(v3(loc) + p) @ rot4(rot) @ Matrix.Diagonal((*k, 1)) @ Matrix.Translation(-p)
        try: yield self
        finally: self.xf = old

    def chain(self, name, parent, pts):
        """Adds extra_<name>_<i> bones at pts[:-1] (pts[-1] is the tip) under `parent`; returns chain weights that
        include the parent for the root blend. The renderer springs these (hair, capes, tails, ears, scarves)."""
        pts = [self.xf @ v3(p) for p in pts]; names = [f'{EXTRA}{name}_{i}' for i in range(len(pts) - 1)]
        for i, n in enumerate(names): self.J[n] = (tuple(v3(pts[i])), names[i - 1] if i else parent)
        self.extras[name] = names; return chain_weights(names, pts)

    def seg(self, b):
        """Weight segment of bone b: head to the head of its natural child (hand/foot/head/prop extend sensibly)."""
        kids = {'hips': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head', 'root': 'hips'}
        for S in 'LR': kids.update({f'shoulder_{S}': f'upperarm_{S}', f'upperarm_{S}': f'forearm_{S}', f'forearm_{S}': f'hand_{S}', f'thigh_{S}': f'shin_{S}', f'shin_{S}': f'foot_{S}'})
        h = P(self.J, b)
        if b in kids: return h, P(self.J, kids[b])
        if b.startswith('foot'): return h, Vector((h.x, 0, h.z + max(.08, h.y * 1.2)))
        if b.startswith('hand'): par = P(self.J, self.J[b][1]); return h, h + (h - par).normalized() * .12
        if b == 'head': return h, h + Vector((0, .25, 0))
        kid = next((n for n, (_, p) in self.J.items() if p == b), None)
        return (h, P(self.J, kid)) if kid else (h, h + Vector((0, .05, 0)))

    def env(self, bones, soft=.05):
        """Envelope weights: nearest bone segment wins, blending across `soft` meters where segments are nearly
        equidistant (joints). Good for continuous skins (a torso into hips, a soft body, a tail)."""
        segs = [(b, *self.seg(b)) for b in bones]
        def w(p):
            p = v3(p); ds = []
            for b, a, c in segs:
                ab = c - a; t = max(0, min(1, (p - a).dot(ab) / max(ab.length_squared, 1e-9))); ds.append((b, (a + ab * t - p).length))
            dmin = min(d for _, d in ds); raw = {b: (1 - (d - dmin) / soft) ** 2 for b, d in ds if d - dmin < soft}
            top = dict(sorted(raw.items(), key=lambda kv: -kv[1])[:4]); s = sum(top.values()); return {b: x / s for b, x in top.items()}
        return w

    def spine(self, bones=('hips', 'spine', 'chest'), soft=1.0, axis=1, spans=None):
        """Smooth weights along a vertical chain (a torso, a soft body). Each joint's rotation fades in from the joint
        below it to the joint above it (soft scales that span), so a bend spreads over the body instead of creasing.
        spans: explicit [(lo, hi)] heights for bones[1:] (increasing), e.g. to spread a round body's head turn."""
        ys = [P(self.J, b)[axis] for b in bones]; n = len(ys)
        spans = spans or [(ys[j] - (ys[j] - ys[j - 1]) * soft, ys[j] + ((ys[j + 1] if j + 1 < n else 2 * ys[j] - ys[j - 1]) - ys[j]) * soft) for j in range(1, n)]
        def w(p):
            F = [1.0] + [smooth01((p[axis] - lo) / (hi - lo)) for lo, hi in spans] + [0.0]
            return {bones[j]: F[j] - F[j + 1] for j in range(n) if F[j] - F[j + 1] > 1e-4}
        return w

    def add(self, bm, mat, bone='root', rigid=False, sharp=None, over=False, tag=None, flat=False):
        """Add a part. mat: material name or painter fn(center, normal) -> name. bone: bone name, {bone: weight}, or
        weight fn(position) -> {bone: weight}; rigid=True evaluates a weight fn once at the part's center so a small
        attachment (button, badge) follows its surface as one piece. sharp: split normals above that angle (degrees).
        over=True excludes the part from the height fit (ears, hats, props, spikes above the head top)."""
        if self.xf != Matrix.Identity(4):
            bmesh.ops.transform(bm, matrix=self.xf, verts=bm.verts)
            if self.xf.determinant() < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
        centers = [(f.calc_center_median(), f.normal.copy()) for f in bm.faces]
        names = [mat] if isinstance(mat, str) else sorted({mat(c, n) for c, n in centers})
        for n in names: assert n in self.mats, f'material {n} has no color in this fighter\'s palette'
        for f, (c, n) in zip(bm.faces, centers): f.material_index = 0 if isinstance(mat, str) else names.index(mat(c, n)); f.smooth = not flat
        if sharp:
            for e in bm.edges:
                if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp): e.smooth = False
        if callable(bone) and rigid:
            ctr = sum((v.co for v in bm.verts), Vector()) / max(1, len(bm.verts)); fixed = bone(ctr); bone = fixed
        weights = [bone(v.co) if callable(bone) else ({bone: 1.0} if isinstance(bone, str) else bone) for v in bm.verts]
        self.stats.append((tri_count(bm), tag or (mat if isinstance(mat, str) else '+'.join(names))))
        self.parts.append((bm, names, weights, over))
        return bm

    def both(self, fn):
        """Call fn(s, S) for the left (+1, 'L') and right (-1, 'R') sides."""
        for s, S in ((1, 'L'), (-1, 'R')): fn(s, S)

    def finish(self, fit=True):
        """Fit to the roster height (head top of non-`over` parts), build the armature, join and skin."""
        H = self.info['height']; top = max(v.co.y for bm, _, _, over in self.parts if not over for v in bm.verts)
        k = H / top if fit else 1.0; self.scale, self.head_top = k, top * k
        S = Matrix.Diagonal((k, k, k, 1)); self.J = {n: (tuple(v3(p) * k), par) for n, (p, par) in self.J.items()}
        sc = bpy.context.scene; ad = bpy.data.armatures.new(self.kind); arm = bpy.data.objects.new(self.kind, ad); sc.collection.objects.link(arm)
        bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT'); eb = {}
        for n, (p, _) in self.J.items(): b = ad.edit_bones.new(n); h = C @ v3(p); b.head = h; b.tail = h + Vector((0, 0, .06)); b.roll = 0; eb[n] = b
        for n, (_, par) in self.J.items():
            if par: assert par in eb, f'{n} parent {par} missing'; eb[n].parent = eb[par]
        bpy.ops.object.mode_set(mode='OBJECT')
        objs = []
        for i, (bm, names, weights, _) in enumerate(self.parts):
            bmesh.ops.transform(bm, matrix=C @ S, verts=bm.verts); me = bpy.data.meshes.new(f'p{i}'); bm.to_mesh(me); bm.free()
            ob = bpy.data.objects.new(me.name, me); sc.collection.objects.link(ob); groups = {}
            for n in names: me.materials.append(self.mats[n])
            for vi, wd in enumerate(weights):
                tot = sum(x for x in wd.values() if x > 1e-4)
                for b, x in wd.items():
                    if x <= 1e-4: continue
                    assert b in self.J, f'unknown bone {b}'
                    g = groups.get(b) or ob.vertex_groups.new(name=b); groups[b] = g; g.add([vi], x / tot, 'REPLACE')
            objs.append(ob)
        for o in sc.objects: o.select_set(o in objs)
        bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join()
        body = objs[0]; body.name = body.data.name = f'{self.kind}_body'; body.parent = arm; body.modifiers.new('rig', 'ARMATURE').object = arm
        self.arm, self.body = arm, body; me = body.data
        self.tris = sum(len(p.vertices) - 2 for p in me.polygons); unweighted = sum(1 for v in me.vertices if not v.groups)
        agg = {}
        for t, tg in self.stats: agg[tg] = agg.get(tg, 0) + t
        print(f'[{self.kind}] {len(me.vertices)} verts, {self.tris} tris, scale x{k:.3f}, head top {self.head_top:.3f}/{H}, unweighted {unweighted}')
        print('  heaviest parts:', ', '.join(f'{a}={b}' for a, b in sorted(agg.items(), key=lambda x: -x[1])[:12]))
        assert unweighted == 0, 'unweighted vertices'
        assert self.tris <= 20000, f'{self.tris} triangles is over the 20k budget'
        return self

    def export(self):
        """Write assets/fighters/<kind>.glb, assets/costumes/<kind>.json, assets/models/<kind>.json and a debug .blend."""
        path = os.path.join(GAME, 'assets', 'fighters', f'{self.kind}.glb')
        for d in ('fighters', 'costumes', 'models'): os.makedirs(os.path.join(GAME, 'assets', d), exist_ok=True)
        for o in bpy.context.scene.objects: o.select_set(o in (self.arm, self.body))
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False, export_skins=True, export_morph=False,
                                  export_texcoords=False, export_normals=True, export_tangents=False, export_yup=True, export_apply=False, export_extras=False,
                                  export_lights=False, export_cameras=False, export_def_bones=False, export_leaf_bone=False, export_rest_position_armature=True,
                                  export_influence_nb=4, export_image_format='NONE', export_attributes=False, export_vertex_color='NONE')
        lo = [min(v.co[i] for v in self.body.data.vertices) for i in range(3)]; hi = [max(v.co[i] for v in self.body.data.vertices) for i in range(3)]
        lo, hi = CI @ Vector(lo), CI @ Vector(hi); lo, hi = [min(a, b) for a, b in zip(lo, hi)], [max(a, b) for a, b in zip(lo, hi)]
        meta = {'kind': self.kind, 'name': self.info['name'], 'generator': f'tools/blender/fighters/{self.kind}.py', 'height': self.info['height'],
                'headTop': round(self.head_top, 4), 'tris': self.tris, 'vertices': len(self.body.data.vertices), 'bytes': os.path.getsize(path),
                'size': [round(h - l, 4) for l, h in zip(lo, hi)], 'bounds': {'min': [round(x, 4) for x in lo], 'max': [round(x, 4) for x in hi]},
                'materials': [m.name for m in self.body.data.materials], 'bones': list(self.J), 'parents': {n: p for n, (_, p) in self.J.items()},
                'joints': {n: [round(x, 4) for x in p] for n, (p, _) in self.J.items()}, 'extras': self.extras,
                'prop': {'parent': self.J['prop'][1], 'visible': self.prop}}
        with open(os.path.join(GAME, 'assets', 'models', f'{self.kind}.json'), 'w') as f: json.dump(meta, f, indent=1)
        used = set(meta['materials'])
        with open(os.path.join(GAME, 'assets', 'costumes', f'{self.kind}.json'), 'w') as f:
            json.dump([{'name': c['name'], 'colors': {k: v.lower() for k, v in c['colors'].items() if k in used}} for c in self.costumes], f, indent=1)
        os.makedirs(os.path.join(OUT, 'blend'), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'blend', f'{self.kind}.blend'), check_existing=False)
        print(f'[{self.kind}] exported {path} ({meta["bytes"]} bytes)'); return path

# ── Face kit ─────────────────────────────────────────────────────────────────
def eye(m, surf, c, w, h, s=1, d=(0, 0, -1), tilt=0.0, depth=.55, sink=.5, iris=.64, pupil=.5, look=(0, 0), iris_mat='eye',
        lid=None, lid_mat='skin', lash=.16, lash_mat='dark', brow=None, bone='head', shine=True, sclera=True, iris_h=None):
    """Sculpted cartoon eye seated on surf where a ray along d through c lands. s: +1 fighter's left eye, -1 right.
    w, h: half width/height of the white. tilt: degrees, outer corner up. look: iris offset (-1..1, +x toward the
    fighter's left). lid=(cover 0..1, slant deg): upper lid shell lowered over the eye (slant>0 = angry toward the nose).
    lash: upper lash line thickness as a share of w (0 disables). brow=dict(lift, slant, thick, width, arch, mat, gap)."""
    p0, n0 = surf.hit(c, d); r, u, n = frame_at(n0, (0, 1, 0), s * tilt); dz = w * depth; ctr = p0 - n * dz * sink
    M = Matrix((r, u, n)).transposed(); eul = [math.degrees(a) for a in M.to_euler()]
    def at(x, y, z): return ctr + r * x + u * y + n * z
    def on_white(x, y, k=1.0):
        q = 1 - (x / w) ** 2 - (y / h) ** 2; return at(x, y, dz * math.sqrt(max(q, 0)) * k)
    if sclera: m.add(sphere(ctr, (w, h, dz), 16, 10, rot=eul), 'eye-white', bone, tag='eyes')
    ih = iris_h or iris; lx, ly = look[0] * w * .3, look[1] * h * .25; ic = on_white(lx, ly - h * .04, .96 if sclera else 1)
    m.add(sphere(ic, (w * iris, h * ih, dz * .22), 14, 9, rot=eul), iris_mat, bone, tag='eyes')
    m.add(sphere(ic + n * dz * .06, (w * iris * pupil, h * ih * pupil * 1.05, dz * .18), 12, 8, rot=eul), 'dark', bone, tag='eyes')
    if shine:
        m.add(sphere(ic + r * (-s * w * iris * .3) + u * h * ih * .4 + n * dz * .16, (w * iris * .3, h * ih * .28, dz * .08), 10, 6, rot=eul), 'eye-white', bone, tag='eyes')
        m.add(sphere(ic + r * (s * w * iris * .35) - u * h * ih * .45 + n * dz * .14, (w * iris * .13, h * ih * .12, dz * .06), 8, 5, rot=eul), 'eye-white', bone, tag='eyes')
    if lid:
        cover, slant = lid; g = sphere(ctr, (w * 1.1, h * 1.1, dz * 1.14), 16, 10, rot=eul)
        pn = (u * math.cos(math.radians(s * slant)) - r * math.sin(math.radians(s * slant)))
        cut(g, at(0, h * (1 - 2 * cover), 0), -pn, keep='below'); m.add(g, lid_mat, bone, tag='lids')
    if lash:
        if lid:
            y0, tn = h * (1 - 2 * lid[0]), math.tan(math.radians(s * lid[1])); pts = []
            for x in np.linspace(-w * 1.02, w * 1.02, 11):
                y = y0 + x * tn; q = 1 - (x / (w * 1.1)) ** 2 - (y / (h * 1.1)) ** 2; pts.append(at(x, y, dz * 1.14 * math.sqrt(max(q, 0))))
        else: pts = [(lambda x, y: on_white(x, y) if abs(x) < w * .99 else at(x, y, 0))(w * 1.02 * math.cos(t), h * 1.02 * math.sin(t))
                     for t in (np.linspace(math.pi + .25, -.25, 11) if s > 0 else np.linspace(-.25, math.pi + .25, 11))]
        rr = [w * lash * (.35 + .65 * smooth01(((p - ctr).dot(r) * s / w + 1) / 2)) for p in pts]
        m.add(tube(pts, rr, 8), lash_mat, bone, tag='lashes')
    if brow: eyebrow(m, surf, at, w, h, s, n, bone, **brow)

def eyebrow(m, surf, at, w, h, s, n, bone, lift=.35, slant=10.0, thick=.14, width=1.1, arch=.25, mat='hair', gap=.012, taper=.5):
    """Tapered brow tube hugging the head above an eye. slant>0 lowers the inner end (determined/angry)."""
    pts, rr = [], []
    for k, x in enumerate(np.linspace(-width, width, 9)):
        y = h * (1 + lift) + (1 - x * x) * h * arch - (x * -s) * h * math.tan(math.radians(slant)) * .9
        hp, hn = surf.near(at(x * w, y, 0)); pts.append(hp + hn * (gap + thick * w * .3)); rr.append(thick * w * (1 - taper * abs(x / width) ** 1.5 * (1 if x * s > 0 else .6)))
    m.add(tube(pts, rr, 10, up=tuple(n)), mat, bone, tag='brows')

def smile(m, surf, pts, r, d=(0, 0, -1), mat='dark', bone='head', lift=0.0):
    """Mouth line: control points (3D, roughly on the face) projected onto surf, as a tapered tube."""
    P = [surf.hit(p, d)[0] + surf.hit(p, d)[1] * lift for p in spline(pts, 12)]
    rr = [r * (.45 + .55 * math.sin(math.pi * k / (len(P) - 1))) for k in range(len(P))]
    m.add(tube(P, rr, 8), mat, bone, tag='mouth')

# ── Hands and feet ───────────────────────────────────────────────────────────
def hand(m, s, S, wrist, u, mat='skin', curl=.35, fingers=4, thumb=.9, spread=1.0, bone=None, fist=False, res=None, tris=620, cuff=None, cuff_mat=None):
    """Cartoon hand at `wrist` for side s (+1 left, palm down, fingers along s*X, thumb toward +Z).
    u = palm half-length (about 0.4x forearm length). curl 0 flat .. 1 wrapped; fist=True closes it.
    cuff=(length, radius) adds a flared glove cuff. Returns the grip point (where a held prop's handle sits)."""
    W = v3(wrist); X = Vector((s, 0, 0)); Y = Vector((0, 1, 0)); Z = Vector((0, 0, 1)); curl = 1.0 if fist else curl
    el = [('ell', W + X * u * .95, (u * .95, u * .42, u * .82), {'stiff': 3}), ('ell', W + X * u * .35 - Y * u * .04, (u * .55, u * .38, u * .6), {'stiff': 3})]
    fr = u * (.27 if fingers == 4 else .32)
    for i in range(fingers):
        z = (1 - 2 * i / max(1, fingers - 1)) * u * .56 * spread if fingers > 1 else 0; L = u * (.62, .72, .66, .5)[i % 4] * (1 if fingers == 4 else 1.1)
        p = W + X * u * 1.72 + Z * z; ang = 0.0
        for k in range(3):
            ang += math.radians((38, 48, 42)[k] * curl); dirv = X * math.cos(ang) - Y * math.sin(ang)
            q = p + dirv * L * (.55, .4, .33)[k] * 1.4; el.append(('cap', p, q, fr * (1, .95, .88)[k], {'stiff': 5})); p = q
    if thumb:
        tb = W + X * u * .55 + Z * u * .72 - Y * u * .05; tip = tb + (X * .55 + Z * .6 - Y * (.25 + .5 * curl)).normalized() * u * .8 * thumb
        el += [('cap', tb, tip, fr * 1.08, {'stiff': 5})]
    m.add(blob(el, res=res or fr / 3.2, tris=tris, relax=1), mat, bone or f'hand_{S}', tag='hands')
    if cuff:
        L, R = cuff; m.add(lathe(W - X * L * .55, W + X * L * .45, [(0, 0), (0, R * .8), (L * .2, R * .92), (L * .75, R), (L, R * 1.12), (L * 1.02, R * .9), (L * 1.03, 0)], 20),
                           cuff_mat or mat, bone or f'hand_{S}', tag='cuffs')
    return W + X * u * 1.25 - Y * u * .45

def shoe(m, s, S, ankle, L, wd, ht, mat, sole_mat='dark', sole=.035, toe=1.0, heel=.8, up=.0, bone=None, tris=800, flare=.01):
    """Rounded cartoon shoe/boot under an ankle joint: length L (toe forward, +Z), width wd, height ht.
    toe scales the toe bulb, up lifts the toe, sole is the painted sole band height (cut flat at y=0)."""
    a = v3(ankle); x = a.x; zb = a.z - L * .3; zt = a.z + L * .62
    el = [('ell', (x, ht * .45, zb + L * .12), (wd * .46 * heel, ht * .46, L * .26)), ('ell', (x, ht * .36 + up * .5, zt - L * .28 * toe), (wd * .52 * toe, ht * .36 * toe + up * .3, L * .4 * toe)),
          ('ell', (x, ht * .62, a.z + L * .02), (wd * .42, ht * .45, L * .3)), ('ell', (x, ht * .2, a.z + L * .15), (wd * .5, ht * .2, L * .5))]
    bm = cut(blob(el, tris=tris, relax=1), (0, 0, 0), (0, 1, 0), keep='above')
    split_by(bm, lambda p: p.y - sole); push(bm, flare, lambda p: p.y < sole * 1.01)
    m.add(bm, lambda c, n: sole_mat if c.y < sole else mat, bone or f'foot_{S}', tag='shoes')

# ── Posing (character-space Euler degrees, relative to the parent; identity rests make this exact) ──
def mirror_rot(r): return (r[0], -r[1], -r[2])
def pose_rotations(spec):
    """Expand {'sym': {'upperarm': r}, 'upperarm_L': r, 'root_loc': p} into per-bone rotations (sym mirrors onto _R)."""
    rots = {}
    for k, r in (spec.get('sym') or {}).items(): rots[f'{k}_L'] = tuple(r); rots[f'{k}_R'] = mirror_rot(r)
    rots.update({k: tuple(v) for k, v in spec.items() if k not in ('sym', 'root_loc', 'name')}); return rots

def apply_pose(arm, spec):
    """Pose any armature (freshly built or imported from the GLB) with a character-space pose spec."""
    rots, loc = pose_rotations(spec or {}), v3(spec.get('root_loc', (0, 0, 0)) if spec else (0, 0, 0))
    bones = arm.data.bones; rest = {b.name: b.matrix_local.copy() for b in bones}; head = {b.name: CI @ b.head_local for b in bones}
    world, pos, pm = {}, {}, {}
    order = [b for b in bones if b.parent is None]; q = list(order)
    while q:
        b = q.pop(0); q += list(b.children); R = rot3(rots.get(b.name)); par = b.parent
        if par is None: world[b.name] = R; pos[b.name] = head[b.name] + loc
        else: world[b.name] = world[par.name] @ R; pos[b.name] = pos[par.name] + world[par.name] @ (head[b.name] - head[par.name])
        Wb = (C3 @ world[b.name] @ CI3).to_4x4(); pm[b.name] = Matrix.Translation(C @ pos[b.name]) @ Wb @ Matrix.Translation(-(C @ head[b.name])) @ rest[b.name]
        pb = arm.pose.bones[b.name]; pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis = (rest[b.name].inverted() @ pm[b.name]) if par is None else ((rest[par.name].inverted() @ rest[b.name]).inverted() @ pm[par.name].inverted() @ pm[b.name])
    bpy.context.view_layer.update()

# Contact-sheet test poses: 60 degree rotations on every major joint.
TEST_ARMS = {'upperarm_L': (0, 0, -60), 'forearm_L': (0, -60, 0), 'hand_L': (0, 0, -40), 'upperarm_R': (0, 60, 0), 'forearm_R': (0, 0, -60), 'hand_R': (40, 0, 0),
             'shoulder_L': (0, 0, 15), 'head': (-15, -40, 0), 'neck': (0, -15, 0)}
TEST_LEGS = {'thigh_L': (-60, 0, 10), 'shin_L': (60, 0, 0), 'foot_L': (-25, 0, 0), 'thigh_R': (30, 0, -20), 'shin_R': (60, 0, 0), 'foot_R': (20, 0, 0),
             'spine': (0, 25, 0), 'chest': (20, 10, 0), 'hips': (0, -15, 0), 'upperarm_L': (0, 0, 60), 'upperarm_R': (0, 0, -30), 'head': (20, 30, 0)}
IDLE = {'sym': {'upperarm': (0, -10, -68), 'forearm': (0, -25, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 3), 'foot': (0, 0, -3)}, 'spine': (3, 0, 0), 'head': (-3, 0, 0)}

def main(g):
    """Bottom of every fighter script: main(globals()). Runs build() only when executed by Blender (not when
    render_sheet.py imports the module for its HERO/PORTRAIT poses)."""
    if g.get('__name__') != '__main__': return
    try: g['build']().finish().export()
    except Exception:
        import traceback; traceback.print_exc(); sys.exit(1)
