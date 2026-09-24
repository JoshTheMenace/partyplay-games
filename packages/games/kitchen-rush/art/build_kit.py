"""Kitchen Rush v2 kit: every station, food, dish, item, chef and prop, built procedurally.

Run from anywhere (Blender 5.2):
  blender --background --factory-startup --python-exit-code 1 --python build_kit.py
Writes art/kitchen-kit.blend, art/asset-manifest.json and public/games/kitchen-rush/models/kitchen-kit.glb.

All modelling below is written in GAME coordinates (metres, x right, y up, z toward the camera); vertices are
converted to Blender's Z-up frame only when meshes are created, so the exported GLB matches the contract exactly.
"""
import bpy, bmesh, json, math, random
from contextlib import contextmanager
from pathlib import Path
from mathutils import Euler, Matrix, Vector, noise

ART = Path(__file__).resolve().parent
PUBLIC = ART.parents[3] / 'public/games/kitchen-rush'
H = 0.9  # COUNTER_HEIGHT: every worktop top
rng = random.Random(7)

# ── Palette (sRGB hex) ─────────────────────────────────────────────────────
TOP, TOP_EDGE = '#f4e8cf', '#c9a878'
CAB, CAB_L, KICK = '#3f8f8a', '#56a79c', '#23484d'
BRASS, STEEL, STEEL_D, IRON, IRON_L = '#f2b33d', '#d5dde0', '#8e9ca4', '#33363f', '#4d525e'
WOOD, WOOD_L, WOOD_D = '#d38b45', '#f2c27f', '#8f5530'
RED, RED_D, CREAM, WHITE, DARK = '#e2483a', '#a8302a', '#fff4e2', '#fffdf8', '#2a2430'
BRICK, BRICK_D, STONE = '#cf6a41', '#a94f33', '#ecd6ad'
SKIN, SKIN_F, BLUSH = '#f6c9a0', '#e8b08a', '#ff9d8f'


def lin(h):
    h = h.lstrip('#')
    return tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)))


def mix(a, b, t):
    a, b = lin(a) if isinstance(a, str) else a, lin(b) if isinstance(b, str) else b
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def topside(top, side, cut=.7):
    """Colour by face normal: upward faces get `top`, the rest `side` (reads as a crisp outline from above)."""
    return lambda p, n: top if n.y > cut else side


# ── Materials: a handful shared by the whole kit, colours live in vertex colours ─────────────────
def material(name, rough=.62, metal=0., emit=None):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    tree = m.node_tree
    bsdf = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value, bsdf.inputs['Metallic'].default_value = rough, metal
    color = tree.nodes.new('ShaderNodeVertexColor')
    color.layer_name = 'Color'
    tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*lin(emit), 1)
        bsdf.inputs['Emission Strength'].default_value = 1.
    return m


PAINT = material('Paint')
GLOSS = material('Gloss', .28, .15)          # steel, ceramic, water, glaze
TEAM = material('TeamColor', .55)            # white vertex colours; the scene sets material.color per player
FLAME = material('Flame', .8, emit='#ff7a1f')  # stove_flame, oven embers, lantern glow
GLOW = material('PortalGlow', .5, emit='#7a5cff')
LABEL = material('CrateLabel', .6)           # near-white; the scene may tint it with the crate ingredient colour
FLOOR = material('Floor', .75)               # floor/wall pieces are separate so a theme can tint them
WALL = material('Wall', .7)

# ── Scene graph and primitive library ─────────────────────────────────────
ASSETS = []  # (root Node, kind)
FRAME = [Matrix()]


class Node:
    """A pivot/root. `at` is its position in asset space; geometry is authored in asset space too."""

    def __init__(self, name, parent=None, at=(0, 0, 0)):
        self.name, self.parent, self.at, self.kids, self.bufs = name, parent, Vector(at), [], {}
        if parent:
            parent.kids.append(self)


def asset(name, kind):
    node = Node(name)
    ASSETS.append((node, kind))
    return node


def place(at=(0, 0, 0), rot=(0, 0, 0), scale=1):
    s = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
    return Matrix.Translation(at) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))


@contextmanager
def frame(at=(0, 0, 0), rot=(0, 0, 0), scale=1):
    FRAME.append(FRAME[-1] @ place(at, rot, scale))
    yield
    FRAME.pop()


def emit(node, bm, col, mat=PAINT, at=(0, 0, 0), rot=(0, 0, 0), shade=(.84, 1), jitter=0, flat=False, smooth_col=False):
    """Append a finished primitive (local bmesh) to the node's buffer for `mat`, baking vertex colours.
    Colour functions are sampled at face centres (crisp bands) unless smooth_col asks for per-corner gradients."""
    bm.transform(FRAME[-1] @ place(at, rot))
    bm.normal_update()
    bm.verts.index_update()
    ys = [v.co.y for v in bm.verts]
    y0, y1 = min(ys), max(ys)
    buf = node.bufs.setdefault(mat, {'v': [], 'f': [], 'c': [], 's': []})
    base = len(buf['v'])
    buf['v'] += [v.co - node.at for v in bm.verts]
    for f in bm.faces:
        k = 1 + rng.uniform(-jitter, jitter)
        buf['f'].append([base + v.index for v in f.verts])
        buf['s'].append(not flat)
        centre = f.calc_center_median()
        for v in f.verts:
            c = col(v.co if smooth_col else centre, f.normal) if callable(col) else col
            c = lin(c) if isinstance(c, str) else c
            g = (shade[0] + (shade[1] - shade[0]) * (v.co.y - y0) / (y1 - y0)) if shade and y1 > y0 else 1
            buf['c'].append(tuple(min(1, ch * g * k) for ch in c))
    bm.free()


def bevel(bm, width, seg=2, angle=40):
    edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0) > math.radians(angle)]
    if width and edges:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type='OFFSET', segments=seg, profile=.5, affect='EDGES', clamp_overlap=True)


def to_y(bm):  # bmesh generators build along Z; our axis of revolution is Y
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'))


def box(n, size, at, col, bev=.03, seg=2, rot=(0, 0, 0), mat=PAINT, **kw):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bevel(bm, bev, seg)
    emit(n, bm, col, mat, at, rot, **kw)


def cyl(n, r, h, at, col, sides=16, r2=None, bev=.015, seg=1, rot=(0, 0, 0), mat=PAINT, **kw):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=h)
    to_y(bm)
    bevel(bm, bev, seg, 50)
    emit(n, bm, col, mat, at, rot, **kw)


def ball(n, r, at, col, u=12, v=8, rot=(0, 0, 0), mat=PAINT, lump=0, ico=0, **kw):
    bm = bmesh.new()
    if ico:
        bmesh.ops.create_icosphere(bm, subdivisions=ico, radius=1)
    else:
        bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1)
        to_y(bm)
    if lump:
        seed = Vector((rng.random(), rng.random(), rng.random())) * 50
        for vert in bm.verts:
            vert.co *= 1 + lump * noise.noise(vert.co * 2.2 + seed)
    bmesh.ops.scale(bm, vec=r if isinstance(r, (tuple, list)) else (r,) * 3, verts=bm.verts)
    emit(n, bm, col, mat, at, rot, **kw)


def lathe(n, profile, at, col, sides=16, arc=None, rot=(0, 0, 0), mat=PAINT, **kw):
    """Revolve [(radius, y)] around Y. Zero radii collapse to poles. arc=(a0, a1) degrees builds an open shell."""
    bm = bmesh.new()
    a0, a1 = (0, 360) if arc is None else arc
    full = arc is None
    count = sides if full else sides + 1
    rings = []
    for r, y in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, y, 0))])
        else:
            rings.append([bm.verts.new((r * math.cos(t), y, -r * math.sin(t))) for t in
                          (math.radians(a0 + (a1 - a0) * i / sides) for i in range(count))])
    for lo, hi in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % count
            quad = [lo[min(i, len(lo) - 1)], lo[min(j, len(lo) - 1)], hi[min(j, len(hi) - 1)], hi[min(i, len(hi) - 1)]]
            quad = list(dict.fromkeys(quad))
            if len(quad) >= 3:
                bm.faces.new(quad)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit(n, bm, col, mat, at, rot, **kw)


def tube(n, pts, r, col, sides=8, mat=PAINT, caps=True, **kw):
    """Sweep a circle along a polyline (parallel-transport frames). r may be a list per point."""
    bm, pts, rings, u = bmesh.new(), [Vector(p) for p in pts], [], None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u = t.cross(Vector((0, 1, 0)) if abs(t.y) < .9 else Vector((1, 0, 0))).normalized() if u is None else (u - t * u.dot(t)).normalized()
        w, rr = t.cross(u), r[i] if isinstance(r, (list, tuple)) else r
        rings.append([bm.verts.new(p + (u * math.cos(a) + w * math.sin(a)) * rr) for a in (math.tau * k / sides for k in range(sides))])
    for lo, hi in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new([lo[k], lo[(k + 1) % sides], hi[(k + 1) % sides], hi[k]])
    if caps:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit(n, bm, col, mat, **kw)


def torus(n, R, r, at, col, seg=16, sides=6, rot=(0, 0, 0), mat=PAINT, **kw):
    bm = bmesh.new()
    grid = [[bm.verts.new(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a)))
             for b in (math.tau * j / sides for j in range(sides))] for a in (math.tau * i / seg for i in range(seg))]
    for i in range(seg):
        for j in range(sides):
            a, b = grid[i], grid[(i + 1) % seg]
            bm.faces.new([a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit(n, bm, col, mat, at, rot, **kw)


def prism(n, outline, y0, y1, col, bev=.02, seg=2, at=(0, 0, 0), rot=(0, 0, 0), mat=PAINT, **kw):
    """Extrude a convex XZ outline between y0 and y1, then round its edges."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y0, z)) for x, z in outline]
    hi = [bm.verts.new((x, y1, z)) for x, z in outline]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    for i in range(len(outline)):
        j = (i + 1) % len(outline)
        bm.faces.new([lo[i], lo[j], hi[j], hi[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bevel(bm, bev, seg)
    emit(n, bm, col, mat, at, rot, **kw)


def ring_pts(count, radius, y=0, phase=0):
    return [(radius * math.cos(phase + math.tau * i / count), y, radius * math.sin(phase + math.tau * i / count)) for i in range(count)]


def yaw_to(x, z):  # degrees of rotation about Y that aim local +X outward toward (x, z)
    return -math.degrees(math.atan2(z, x))


# ── Stations (1×1 m, worktop top at y = 0.9) ───────────────────────────────
def cabinet(n, body=CAB, panel=CAB_L, top=TOP, edge=TOP_EDGE, top_mat=PAINT, sides=4, worktop=True, handle=BRASS):
    box(n, (.9, .1, .9), (0, .05, 0), KICK, bev=.02, seg=1)
    box(n, (.92, .74, .92), (0, .46, 0), body, bev=.035, shade=(.72, 1))
    if worktop:
        box(n, (1, .08, 1), (0, H - .04, 0), topside(top, edge, .8), bev=.032, mat=top_mat, shade=None)
    for i in range(sides):
        with frame(rot=(0, 90 * i, 0)):
            box(n, (.78, .56, .03), (0, .47, .465), panel, bev=.012, seg=1, shade=(.8, 1))
            if i % 2 == 0:
                box(n, (.34, .035, .03), (0, .7, .49), handle, bev=.01, seg=1, mat=GLOSS, shade=None)


def counter():
    cabinet(asset('counter', 'station'))


def board():
    n = asset('board', 'station')
    cabinet(n)
    box(n, (.76, .045, .56), (-.03, H + .0225, .02), topside('#e3a35b', WOOD_D), bev=.018, shade=None)
    for z in (-.2, .24):  # juice grooves
        box(n, (.62, .006, .02), (-.05, H + .046, z), '#c07f3c', bev=.002, seg=1, shade=None)
    with frame((.22, H + .05, .06), (0, -28, 0)):  # chef's knife resting at the right edge
        prism(n, [(-.03, -.045), (.24, -.045), (.26, -.02), (.2, .035), (-.03, .035)], -.006, .006, topside('#f2f6f7', '#aab7bd'), bev=.004, seg=1, mat=GLOSS, shade=None)
        box(n, (.15, .035, .05), (-.1, .004, -.005), RED_D, bev=.014, shade=None)
        for x in (-.14, -.07):
            cyl(n, .008, .04, (x, .004, -.005), BRASS, sides=6, bev=0, shade=None)


def stove():
    n = asset('stove', 'station')
    cabinet(n, body='#dc5540', panel='#ea7359', top=IRON, edge=IRON_L, handle=STEEL, sides=2)
    box(n, (.62, .26, .03), (0, .5, .48), IRON, bev=.02, seg=1, shade=None)  # oven window
    box(n, (.54, .18, .01), (0, .5, .495), '#5a4a58', bev=.01, seg=1, shade=None)
    for x in (-.28, 0, .28):  # knobs
        cyl(n, .045, .03, (x, .78, .485), CREAM, sides=8, rot=(90, 0, 0), bev=0, shade=None)
        box(n, (.012, .04, .012), (x, .79, .5), RED_D, bev=0, shade=None)
    torus(n, .29, .02, (0, H - .025, 0), STEEL, seg=16, sides=4, mat=GLOSS, shade=None)
    cyl(n, .25, .015, (0, H - .035, 0), '#232630', sides=20, bev=.004, shade=None)
    cyl(n, .1, .03, (0, H - .025, 0), IRON_L, sides=12, bev=.008, shade=None)
    cyl(n, .065, .02, (0, H - .004, 0), '#6b7280', sides=12, bev=.006, shade=None)
    for i in range(4):  # cast-iron grate arms
        with frame(rot=(0, 45 + 90 * i, 0)):
            box(n, (.2, .03, .035), (.19, H + .015, 0), '#1c1e25', bev=.008, seg=1, shade=None)  # trivet top at 0.93
    fl = Node('stove_flame', n, (0, H - .03, 0))
    for i in range(8):
        a = math.tau * i / 8
        with frame((math.cos(a) * .12, H - .03, math.sin(a) * .12), (0, yaw_to(math.cos(a), math.sin(a)), 0)):
            cyl(fl, .032, .09 + .02 * (i % 2), (0, .04, 0), lambda p, nn: mix('#ff6a1a', '#ffe14a', min(1, max(0, (p.y - H + .03) / .1))), smooth_col=True, sides=6, r2=.004, bev=0, rot=(0, 0, -18), mat=FLAME, shade=None)


OVEN_HEARTH = .5  # the scene bakes plates at (0, 0.5, 0.3): half inside the mouth, half on the stone lip


def oven():
    """Wood-fired dome oven: brick plinth, stone hearth at y 0.5, a big brick dome whose arched mouth faces +Z."""
    n, y0 = asset('oven', 'station'), OVEN_HEARTH
    box(n, (.9, .1, .9), (0, .05, 0), '#5a3326', bev=.02, seg=1)
    box(n, (.96, y0 - .12, .96), (0, (y0 - .02) / 2 + .04, 0), BRICK, bev=.035, shade=(.7, 1), jitter=.05)
    box(n, (1, .07, 1), (0, y0 - .035, 0), topside(STONE, '#c9ab7e'), bev=.022, shade=None)  # hearth slab
    box(n, (.62, .26, .04), (0, .23, .47), '#2b1712', bev=.03, seg=1, shade=None)  # log store under the hearth
    for x, y in ((-.16, .15), (0, .15), (.16, .15), (-.08, .26), (.08, .26)):
        cyl(n, .06, .06, (x, y, .48), lambda p, nn: '#eab77a' if nn.z > .7 else '#6b4228', sides=8, rot=(90, 0, 0), bev=.01, shade=None)
    cz, rx, ry, rz = -.08, .46, .58, .38  # dome: ellipsoid centred behind the mouth, front at z ≈ 0.3
    prof = [(rx * math.cos(t), ry * math.sin(t)) for t in (math.pi / 2 * k / 6 for k in range(7))]
    bands = lambda p, nn: [BRICK, '#bf5b38', '#dd7d4d'][int((p.y - y0) * 12) % 3]
    with frame((0, y0, cz), scale=(1, 1, rz / rx)):
        lathe(n, prof, (0, 0, 0), bands, sides=14, jitter=.06, shade=(.8, 1.05))
    bm, steps = bmesh.new(), 10  # stone arch framing the mouth, extruded forward out of the dome
    ts = [math.pi * k / steps for k in range(steps + 1)]
    loops = [[bm.verts.new((r * math.cos(t), y0 + h * math.sin(t), z)) for t in ts] for r, h, z in
             ((.25, .3, .33), (.37, .42, .33), (.37, .42, .12), (.25, .3, .12))]
    for lo, hi in zip(loops, loops[1:] + loops[:1]):
        for k in range(steps):
            bm.faces.new([lo[k], lo[k + 1], hi[k + 1], hi[k]])
    bm.faces.new([loops[0][0], loops[3][0], loops[2][0], loops[1][0]])
    bm.faces.new([loops[0][-1], loops[1][-1], loops[2][-1], loops[3][-1]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    emit(n, bm, lambda p, nn: ('#f4e2bf' if int(math.degrees(math.atan2(p.y - y0, p.x)) / 20) % 2 else STONE) if nn.z > .5 else '#b89a70', shade=(.85, 1))
    bm = bmesh.new()  # the dark mouth: a half-disc just inside the arch, glowing embers at its foot
    rim = [bm.verts.new((.25 * math.cos(t), y0 + .3 * math.sin(t), .2)) for t in ts]
    bm.faces.new([bm.verts.new((0, y0, .2)), *rim[::-1]])
    emit(n, bm, lambda p, nn: mix('#ff8a2a', '#1e0f0b', min(1, (p.y - y0) / .12)), smooth_col=True, mat=FLAME, shade=None)
    for i, (x, z) in enumerate(((-.16, .23), (-.1, .21), (.12, .22), (.18, .235))):
        ball(n, (.045, .03, .035), (x, y0 + .02, z), '#ffd35a' if i % 2 else '#ff7a2a', ico=1, mat=FLAME, shade=None)
    box(n, (.1, .11, .1), (0, y0 + .38, .3), '#fff1d0', bev=.02, seg=1, shade=None)  # keystone
    cyl(n, .075, .34, (.2, y0 + .62, -.22), '#5b4a48', sides=8, bev=.01)  # chimney
    cyl(n, .1, .05, (.2, y0 + .79, -.22), IRON, sides=8, bev=.012, shade=None)


def sink():
    n = asset('sink', 'station')
    cabinet(n, body='#3d86a6', panel='#58a1bf', worktop=False)
    top = topside('#e6edef', STEEL_D)
    for x in (-.405, .405):
        box(n, (.19, .075, 1), (x, H - .0375, 0), top, bev=.02, mat=GLOSS, shade=None)
    for z in (-.375, .375):
        box(n, (.64, .075, .25), (0, H - .0375, z), top, bev=.02, mat=GLOSS, shade=None)
    box(n, (.64, .06, .52), (0, H - .09, 0), '#9fb2ba', bev=.01, mat=GLOSS, shade=None)
    box(n, (.62, .02, .5), (0, H - .045, 0), lambda p, nn: '#46b8ec' if nn.y > .7 else '#2a8fc6', bev=.008, seg=1, mat=GLOSS, shade=None)
    for x, z, r in ((-.2, -.12, .035), (-.15, -.16, .025), (.18, .14, .03), (-.22, .15, .02)):
        ball(n, (r, r * .6, r), (x, H - .033, z), '#f4fdff', ico=1, mat=GLOSS, shade=None)
    box(n, (.13, .05, .08), (.17, H - .025, -.08), lambda p, nn: '#ffd64a' if p.y > H - .02 else '#5cc36a', bev=.015, rot=(0, 20, 0), shade=None)
    tube(n, [(0, H, -.4), (0, H + .22, -.4), (0, H + .3, -.34), (0, H + .3, -.24), (0, H + .24, -.2)], .026, STEEL, mat=GLOSS, shade=None)
    cyl(n, .05, .04, (0, H + .02, -.4), STEEL_D, sides=10, mat=GLOSS, shade=None)
    for x, c in ((-.13, '#4aa4e8'), (.13, '#ef5a48')):
        cyl(n, .035, .05, (x, H + .025, -.4), c, sides=8, bev=.01, shade=None)


def rack():
    n = asset('rack', 'station')
    cabinet(n)
    box(n, (.7, .006, .66), (0, H + .001, 0), topside('#b9e4d4', '#7fb9a6'), bev=.002, seg=1, shade=None)
    for z, h in ((-.3, .26), (.3, .12)):  # tall dowels behind, short ones in front
        for i in range(5):
            cyl(n, .016, h, (-.26 + .13 * i, H + h / 2, z), WOOD_L, sides=6, bev=0, shade=None)
        box(n, (.64, .03, .03), (0, H + h, z), WOOD, bev=.01, seg=1, shade=None)
    stripes = lambda p, nn: WHITE if int((p.x + 1) * 28) % 3 == 0 else '#e95a4a'
    box(n, (.24, .03, .12), (.33, H + .04, .4), stripes, bev=.01, rot=(0, -8, 0), shade=None)  # folded tea towel


def ret():
    n = asset('return', 'station')
    cabinet(n, body='#56779a', panel='#6e90b3')
    box(n, (.96, .44, .16), (0, H + .22, -.42), topside(STEEL_D, STEEL), bev=.03, mat=GLOSS, shade=(.8, 1))
    box(n, (.62, .28, .02), (0, H + .18, -.335), '#1c1d24', bev=.015, seg=1, shade=None)
    for i in range(6):  # rubber strip curtain
        box(n, (.095, .25, .012), (-.26 + .104 * i, H + .185, -.32), '#454b5a', bev=.004, seg=1, shade=(.6, 1))
    cyl(n, .06, .06, (0, H + .47, -.42), '#ffb02e', sides=10, bev=.02, shade=None)
    ball(n, (.05, .05, .05), (0, H + .51, -.42), '#ffd46a', u=8, v=5, mat=GLOSS, shade=None)
    for z in (-.29, .38):
        box(n, (.66, .05, .03), (0, H + .01, z), IRON_L, bev=.01, seg=1, shade=None)
    for x in (-.33, .33):
        box(n, (.03, .05, .68), (x, H + .01, .045), IRON_L, bev=.01, seg=1, shade=None)
    for i in range(6):
        cyl(n, .022, .62, (0, H - .02, -.22 + .11 * i), STEEL, sides=8, rot=(0, 0, 90), bev=0, mat=GLOSS, shade=None)


def serve():
    """Serving pass: brass tray under a low striped awning with a warm heat lamp, a cloche sign and a bell.
    Kept under 1.5 m so a hatch on the front row never hides the chef standing behind it."""
    n = asset('serve', 'station')
    cabinet(n, body='#b8683c', panel='#d0864f', top='#eef3f4', edge=BRASS, top_mat=GLOSS, sides=2)
    box(n, (.84, .012, .6), (0, H + .006, .02), lambda p, nn: '#ffe7a3' if nn.y > .7 else BRASS, bev=.004, seg=1, mat=GLOSS, shade=None)  # pass tray
    for x in (-.44, .44):
        cyl(n, .03, .56, (x, H + .28, -.42), BRASS, sides=6, mat=GLOSS, shade=None)
    for i in range(6):  # scalloped striped awning sloping toward the front
        x = -.4 + .16 * i
        c = RED if i % 2 == 0 else CREAM
        box(n, (.16, .025, .4), (x, H + .5, -.26), c, bev=0, rot=(20, 0, 0), shade=None)
        cyl(n, .08, .02, (x, H + .43, -.07), c, sides=7, rot=(20, 0, 0), bev=0, shade=None)
    box(n, (.94, .05, .05), (0, H + .57, -.43), BRASS, bev=.018, seg=1, mat=GLOSS, shade=None)
    box(n, (.74, .03, .04), (0, H + .4, -.12), IRON, bev=.01, seg=1, shade=None)  # heat lamp bar
    box(n, (.68, .012, .03), (0, H + .383, -.12), '#ffcf6a', bev=.004, seg=1, mat=FLAME, shade=None)
    with frame((0, H + .52, -.36), (-62, 0, 0)):  # round sign lying back toward the camera: a gold cloche on red
        cyl(n, .14, .03, (0, 0, 0), RED_D, sides=12, rot=(90, 0, 0), bev=.01, shade=None)
        torus(n, .14, .014, (0, 0, 0), BRASS, seg=12, sides=4, rot=(90, 0, 0), mat=GLOSS, shade=None)
        lathe(n, [(.07, 0), (.066, .028), (.05, .054), (.024, .068), (0, .072)], (0, -.04, .015), BRASS, sides=8, rot=(90, 0, 0), mat=GLOSS, shade=None)
        box(n, (.18, .014, .014), (0, -.045, .02), BRASS, bev=0, shade=None)
    with frame((.3, H, .24)):  # service bell
        cyl(n, .07, .018, (0, .009, 0), '#3a2b2b', sides=10, bev=.006, shade=None)
        lathe(n, [(.065, .018), (.062, .04), (.045, .07), (.02, .085), (0, .088)], (0, 0, 0), '#ffc94a', sides=10, mat=GLOSS, shade=None)
        cyl(n, .012, .03, (0, .1, 0), '#ffe28a', sides=6, bev=0, mat=GLOSS, shade=None)


def bin_():
    n = asset('bin', 'station')
    body = lambda p, nn: '#2f6b4f' if abs(p.y - .14) < .03 or abs(p.y - .68) < .03 else '#3f8a63'
    lathe(n, [(0, .0), (.28, .0), (.3, .02), (.34, .72), (.33, .78), (0, .78)], (0, 0, 0), body, sides=16, shade=(.72, 1))
    torus(n, .335, .025, (0, .78, 0), STEEL_D, seg=16, mat=GLOSS, shade=None)
    torus(n, .31, .03, (0, .79, 0), '#23262c', seg=14, shade=None)  # bin bag folded over the rim
    cyl(n, .3, .02, (0, .775, 0), '#1b1d22', sides=14, bev=0, shade=None)
    box(n, (.16, .04, .1), (0, .03, .33), STEEL_D, bev=.015, mat=GLOSS, shade=None)
    with frame((0, .79, .06), (-12, 18, 0)):  # a fish skeleton poking out: unmistakably a bin
        box(n, (.26, .018, .018), (0, .02, 0), '#f1efe6', bev=.006, seg=1, rot=(0, 0, 38), shade=None)
        for i in range(4):
            box(n, (.012, .06, .012), (-.06 + .04 * i, .045 + .025 * i, 0), '#f1efe6', bev=.004, seg=1, rot=(0, 0, 38), shade=None)
        prism(n, [(0, -.03), (.07, 0), (0, .03)], -.01, .01, '#f1efe6', bev=.006, seg=1, at=(.11, .1, 0), rot=(90, 0, 38), shade=None)
    lid = Node('bin_lid', n, (0, .8, -.34))
    with frame((0, .8, -.34), (-14, 0, 0)):
        lathe(lid, [(0, -.005), (.36, -.005), (.36, .025), (.3, .07), (.15, .1), (0, .105)], (0, 0, .34), lambda p, nn: '#5bb07f' if p.y > .82 else '#3f8a63', sides=16, shade=(.85, 1))
        box(lid, (.14, .03, .04), (0, .115, .34), '#2f6b4f', bev=.012, shade=None)


def crate():
    n = asset('crate', 'station')

    def shell(y0, y1, slats, dark):
        for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            box(n, (.09, y1 - y0, .09), (.44 * sx, (y0 + y1) / 2, .44 * sz), WOOD_D, bev=.02, seg=1)
        h = (y1 - y0) / slats
        for i in range(slats):
            y = y0 + h * (i + .5)
            c = WOOD if (i + dark) % 2 == 0 else '#c47c3c'
            for rot in (0, 90, 180, 270):
                with frame(rot=(0, rot, 0)):
                    box(n, (.84, h * .78, .04), (0, y, .46), c, bev=.012, seg=1)

    shell(0, .44, 2, 1)
    box(n, (.9, .02, .9), (0, .45, 0), WOOD_D, bev=0)
    shell(.46, H, 2, 0)
    box(n, (.84, .02, .84), (0, .69, 0), '#6e4124', bev=0, shade=None)  # produce floor at 0.7
    box(n, (.4, .15, .03), (0, H - .11, .485), '#fbf6ec', bev=.02, seg=2, mat=LABEL, shade=None)


def belt():
    n = asset('belt', 'station')
    box(n, (.9, .1, .9), (0, .05, 0), KICK, bev=.02, seg=1)
    box(n, (.98, .7, .9), (0, .45, 0), '#7c8a96', bev=.03, shade=(.7, 1))
    for z in (-.44, .44):
        box(n, (1, .1, .08), (0, H - .01, z), topside('#f6c445', STEEL_D), bev=.02, seg=1, mat=GLOSS, shade=None)
        for x in (-.3, .3):
            box(n, (.1, .06, .02), (x, .5, z * 1.07), IRON_L, bev=.01, seg=1, shade=None)
    box(n, (1, .05, .8), (0, H - .01, 0), '#2d3038', bev=.01, seg=1, shade=None)  # running surface top at 0.915
    for x in (-.47, .47):
        cyl(n, .035, .8, (x, H - .01, 0), STEEL_D, sides=8, rot=(90, 0, 0), bev=0, mat=GLOSS, shade=None)
    surf = Node('belt_surface', n, (0, H, 0))  # chevrons repeat every 0.25 m; slide along +X modulo that period
    for i in range(4):
        x = -.375 + .25 * i
        for s in (1, -1):
            box(surf, (.17, .008, .04), (x - .035, H + .017, .06 * s), '#ffd34d', bev=.004, seg=1, rot=(0, 38 * s, 0), shade=None)


# ── Environment ──────────────────────────────────────────────────────────
def environment():
    n = asset('floor_tile', 'env')
    for i, (x, z) in enumerate(((-.25, -.25), (.25, -.25), (.25, .25), (-.25, .25))):
        box(n, (.5, .06, .5), (x, -.03, z), topside(('#e8ece8', '#c6d1d0')[i % 2], '#a9b6b6'), bev=.012, seg=1, mat=FLOOR, shade=None)
    n = asset('ice_tile', 'env')
    box(n, (1, .06, 1), (0, -.03, 0), topside('#9fdcf2', '#5fb2d6'), bev=.025, mat=GLOSS, shade=None)
    for (x, z, a, l) in ((-.2, -.15, 30, .34), (.02, -.05, -40, .22), (.2, .2, 60, .28), (-.25, .28, -10, .18), (.28, -.3, -25, .2)):
        box(n, (l, .006, .02), (x, .001, z), '#f4fdff', bev=0, rot=(0, a, 0), mat=GLOSS, shade=None)
    n = asset('gate_plank', 'env')
    for i in range(5):
        box(n, (.19, .08, 1), (-.4 + .2 * i, -.04, 0), topside((WOOD, '#c47c3c', WOOD_L)[i % 3], WOOD_D), bev=.02, seg=1, shade=None)
    for z in (-.32, .32):
        box(n, (1, .014, .07), (0, .004, z), IRON, bev=.004, seg=1, shade=None)
        for i in range(5):
            cyl(n, .014, .012, (-.4 + .2 * i, .012, z), STEEL_D, sides=6, bev=0, shade=None)
    n = asset('portal_pad', 'env')
    lathe(n, [(0, .02), (.44, .02), (.46, .0), (.44, -.02), (0, -.02)], (0, 0, 0), '#4b3f78', sides=20, shade=None)
    torus(n, .4, .03, (0, .025, 0), '#8c7ad8', seg=20, shade=None)
    lathe(n, [(0, .032), (.35, .03), (.35, .02)], (0, 0, 0), lambda p, nn: mix('#b9a8ff', '#5a3fff', min(1, math.hypot(p.x, p.z) / .35)), sides=20, mat=GLOW, shade=None, smooth_col=True)
    for i in range(4):
        with frame(rot=(0, 45 + 90 * i, 0)):
            box(n, (.06, .03, .06), (.4, .03, 0), BRASS, bev=.01, seg=1, rot=(0, 45, 0), shade=None)
    for i in range(3):  # swirl arms
        tube(n, [(math.cos(t) * r, .036, math.sin(t) * r) for t, r in ((i * 2.09 + k * .45, .06 + k * .06) for k in range(5))], .012, '#f2ecff', sides=5, mat=GLOW, shade=None)
    n = asset('wall', 'env')  # painted dado, subway-tile backsplash facing the kitchen (+Z), rounded wooden cap
    box(n, (1, .5, 1), (0, .25, 0), '#76a898', bev=.02, seg=1, mat=WALL, shade=(.8, 1))
    box(n, (.98, .72, .98), (0, .86, 0), '#f3e4c6', bev=.02, seg=1, mat=WALL, shade=(.9, 1))
    box(n, (1, .05, 1), (0, .52, 0), '#5d8a7c', bev=.012, seg=1, mat=WALL, shade=None)
    for row in range(5):  # staggered subway tiles, each a bevelled chip so grout lines catch the light
        y, off = .6 + row * .115, (row % 2) * .125
        for i in range(-2, 3):
            x = i * .25 + off - .125
            if abs(x) > .44:
                continue
            box(n, (.23 if abs(x) < .38 else .23 - (abs(x) - .38) * 2, .1, .02), (x, y, .495),
                ('#fbf6ec', '#f1e9d8', '#e9f2ee')[(row + i) % 3], bev=.012, seg=1, mat=WALL, shade=None)
    box(n, (1, .07, 1.02), (0, 1.235, 0), topside('#a8714c', '#7a4f36'), bev=.03, seg=2, mat=WALL, shade=None)


# ── Items (base at y = 0) ─────────────────────────────────────────────────
PLATE_R = .25
FOOD_SCALE = 1.3  # loose food reads ~30% larger than life at game scale


def plate_shape(n, dirty=False):
    white, band = ('#ded3be', '#8fb4ae') if dirty else (WHITE, '#44a6a0')
    col = lambda p, nn: band if .205 < math.hypot(p.x, p.z) < .23 and nn.y > .3 else white
    lathe(n, [(0, .03), (.15, .03), (.2, .038), (.215, .044), (.245, .054), (.255, .052), (.25, .042), (.19, .02), (.12, 0), (0, .006)], (0, 0, 0), col, sides=20, mat=GLOSS, shade=(.8, 1))


def items():
    plate_shape(asset('plate', 'item'))
    n = asset('plate_dirty', 'item')
    plate_shape(n, True)
    for x, z, r, c in ((.06, .04, .09, '#b8743e'), (-.08, -.05, .06, '#9c5a2d'), (-.1, .11, .035, '#6e8c3a')):
        ball(n, (r, .01, r * .8), (x, .034, z), c, ico=1, lump=.2, shade=None)
    n = asset('pot', 'item')  # cobalt enamel stock pot; interior floor y = 0.04, rim y = 0.25
    enamel = lambda p, nn: '#dfe7ea' if p.y > .035 and (nn.x * p.x + nn.z * p.z < 0 or nn.y > .9) else ('#f4f7f8' if .18 < p.y < .21 else '#3d76c9' if p.y > .045 else '#2a4f8a')
    lathe(n, [(0, .0), (.2, .0), (.225, .02), (.23, .18), (.232, .21), (.24, .245), (.225, .255), (.205, .24), (.2, .05), (.18, .04), (0, .04)], (0, 0, 0), enamel, sides=18, mat=GLOSS, shade=(.75, 1))
    for s in (1, -1):
        tube(n, [(.22 * s, .19, -.06), (.3 * s, .2, -.05), (.3 * s, .2, .05), (.22 * s, .19, .06)], .02, '#23242b', sides=6, shade=None)
    n = asset('pan', 'item')  # black iron skillet; cooking floor y = 0.025, wooden handle along +X
    lathe(n, [(0, 0), (.17, 0), (.2, .025), (.215, .095), (.2, .095), (.18, .05), (.16, .045), (0, .045)], (0, 0, 0), lambda p, nn: '#3a3f4a' if nn.y > .5 and p.y < .05 else IRON, sides=20, mat=GLOSS, shade=(.8, 1))
    tube(n, [(.2, .075, 0), (.28, .09, 0)], .018, STEEL_D, sides=8, mat=GLOSS, shade=None)
    tube(n, [(.28, .09, 0), (.46, .115, 0)], [.026, .03], '#d0452f', sides=8, shade=None)
    n = asset('extinguisher', 'item')
    lathe(n, [(0, 0), (.085, 0), (.095, .02), (.095, .2), (.095, .26), (.095, .34), (.07, .39), (.03, .41), (0, .41)], (0, 0, 0), lambda p, nn: CREAM if .2 < p.y < .26 and nn.z > -.2 else RED, sides=14, mat=GLOSS, shade=(.75, 1))
    cyl(n, .03, .06, (0, .43, 0), '#2b2c33', sides=8, bev=.008, shade=None)
    box(n, (.13, .025, .04), (.03, .47, 0), IRON_L, bev=.01, rot=(0, 0, 10), shade=None)
    tube(n, [(0, .44, .02), (.05, .44, .09), (.1, .36, .11), (.11, .18, .1)], .015, '#23242b', sides=6, shade=None)
    cyl(n, .022, .06, (.11, .15, .1), '#23242b', sides=6, r2=.012, bev=0, shade=None)


def soups():
    specs = {'soup_tomato': ('#c92a17', '#e8452a', [('#fff2dc', .06), ('#3f8a32', .03)]),
             'soup_onion': ('#a8641a', '#cf8a2c', [('#e7c3ef', .04), ('#e7c3ef', .04), ('#ffe7a8', .03)]),
             'soup_mixed': ('#c8541c', '#e8772e', [('#b3261a', .04), ('#b86bc9', .04), ('#3f8a32', .025)])}
    for name, (base, light, bits) in specs.items():
        n = asset(name, 'soup')  # liquid disc: radius fits the pot interior; base at y = 0
        lathe(n, [(0, .022), (.12, .021), (.185, .016), (.185, 0), (0, 0)], (0, 0, 0), lambda p, nn, b=base, l=light: mix(l, b, min(1, math.hypot(p.x, p.z) / .18)), sides=18, mat=GLOSS, shade=None, smooth_col=True)
        for i, (c, r) in enumerate(bits):
            a = i * 2.4 + .5
            if name == 'soup_onion' and i < 2:
                torus(n, r, .012, (math.cos(a) * .08, .024, math.sin(a) * .08), c, seg=8, sides=4, shade=None)
            else:
                ball(n, (r, r * .35, r * .8), (math.cos(a) * .09, .024, math.sin(a) * .09), c, ico=1, shade=None)


# ── Food (base at y = 0; roughly 0.2–0.32 m across so it reads at game scale) ──────────────
def leaf(n, at, size, c, yaw=0, tilt=0, **kw):
    ball(n, size, at, c, u=7, v=4, rot=(tilt, yaw, 0), lump=.18, **kw)


def lettuce_pile(n, count=7, spread=.1, scale=1, y=0):
    for i in range(count):
        a, r = i * 2.4, spread * math.sqrt((i + .5) / count)
        leaf(n, (math.cos(a) * r, y + .03 * scale + .012 * (i % 3), math.sin(a) * r), (.075 * scale, .022 * scale, .05 * scale),
             ('#7ccf3a', '#4fae2e', '#a6e04f')[i % 3], yaw=math.degrees(a) * 1.3, tilt=(i % 3 - 1) * 14)


def tomato_slice(n, at, r=.09, h=.03, rot=(0, 0, 0)):
    col = lambda p, nn: '#e23a26' if nn.y < .5 else ('#ff9a7c' if (Vector(p) - Vector(at)).xz.length < r * .4 else '#f04a33')
    lathe(n, [(0, h), (r * .55, h), (r * .92, h * .95), (r, h * .5), (r * .85, 0), (0, 0)], at, col, sides=10, rot=rot, shade=None)


def onion_rings(n, colours, count=3, y=0):
    for i in range(count):
        a = i * 2.3
        R = .085 - .012 * i
        torus(n, R, .022, (math.cos(a) * .05, y + .022 + .03 * i, math.sin(a) * .05), colours[i % len(colours)], seg=12, sides=5, rot=((i - 1) * 8, 0, (i - 1) * 6), shade=(.85, 1))


def patty_disc(n, top, side, y=0, r=.13, h=.06, marks=None, sides=14):
    lathe(n, [(0, y + h), (r * .8, y + h), (r, y + h * .7), (r * .95, y + h * .15), (r * .85, y), (0, y)], (0, 0, 0), lambda p, nn: top if nn.y > .6 else side, sides=sides, jitter=.05, shade=(.85, 1))
    for i in range(3 if marks else 0):
        box(n, (r * 1.5, .008, .018), (0, y + h + .002, -.05 + .05 * i), marks, bev=.003, seg=1, rot=(0, 30, 0), shade=None)


def bun_half(n, y0, y1, r, top=True, seeds=6, sides=14):
    crust = lambda p, nn: '#f5d59a' if (not top and nn.y > .8) else ('#e79d47' if p.y > y0 + (y1 - y0) * .35 else '#f0bd73')
    if top:
        lathe(n, [(0, y0), (r * .95, y0), (r, y0 + .02), (r * .88, y0 + (y1 - y0) * .62), (r * .5, y0 + (y1 - y0) * .95), (0, y1)], (0, 0, 0), crust, sides=sides, shade=None)
        for i in range(seeds):
            a, rr = i * 2.4, r * .6 * math.sqrt((i + .5) / seeds)
            y = y0 + (y1 - y0) * (1 - (rr / r) ** 2 * .75)
            box(n, (.035, .012, .02), (math.cos(a) * rr, y, math.sin(a) * rr), '#fff5dc', bev=0, rot=(0, math.degrees(a), 0), shade=None)
    else:
        lathe(n, [(0, y0), (r * .9, y0), (r, y0 + (y1 - y0) * .5), (r * .97, y1), (0, y1)], (0, 0, 0), crust, sides=sides, shade=None)


def cheese_wedge(n, at=(0, 0, 0), s=1):
    col = lambda p, nn: '#ffd84a' if nn.y > .6 else '#f6c02b'
    prism(n, [(-.14 * s, -.1 * s), (.14 * s, -.02 * s), (-.14 * s, .1 * s)], 0, .12 * s, col, bev=.018, seg=2, at=at)
    for x, z, r in ((-.07, -.01, .026), (.03, -.03, .018), (-.1, .05, .02), (-.02, .035, .012)):
        ball(n, (r * s, .006, r * s), (at[0] + x * s, at[1] + .12 * s, at[2] + z * s), '#dca01d', u=8, v=4, shade=None)


def food():
    n = asset('lettuce_raw', 'food')
    ball(n, (.12, .11, .12), (0, .12, 0), '#b7e57a', u=10, v=6, lump=.12)
    for i in range(6):
        a = math.tau * i / 6
        leaf(n, (math.cos(a) * .085, .11, math.sin(a) * .085), (.1, .11, .045), ('#4f9f3a', '#6dbd48')[i % 2], yaw=yaw_to(math.cos(a), math.sin(a)) + 90, tilt=-14)
    n = asset('lettuce_chopped', 'food')
    lettuce_pile(n, 8, .1)
    n = asset('tomato_raw', 'food')
    ball(n, (.14, .115, .14), (0, .115, 0), '#ee4631', u=14, v=9, shade=(.7, 1.05))
    ball(n, (.035, .015, .03), (-.05, .19, .06), '#ff9c86', ico=1, shade=None)  # glossy highlight
    for i in range(5):
        a = math.tau * i / 5
        box(n, (.07, .012, .025), (math.cos(a) * .035, .228, math.sin(a) * .035), '#3f8a32', bev=.006, seg=1, rot=(0, yaw_to(math.cos(a), math.sin(a)), 8), shade=None)
    tube(n, [(0, .225, 0), (.01, .27, .005)], .012, '#4e7a2e', sides=6, shade=None)
    n = asset('tomato_chopped', 'food')
    for i, (x, z, a) in enumerate(((-.06, -.03, -8), (.03, .03, 6), (.08, -.05, 12))):
        tomato_slice(n, (x, .03 * i, z), rot=(a, 0, a * .5))
    n = asset('tomato_cooked', 'food')
    ball(n, (.12, .07, .11), (0, .065, 0), '#b52a1c', u=12, v=7, lump=.18, mat=GLOSS)
    ball(n, (.05, .025, .04), (.02, .12, .01), '#e0553a', ico=1, lump=.2, mat=GLOSS, shade=None)
    n = asset('onion_raw', 'food')
    stripes = lambda p, nn: mix('#8e3fae', '#d9a0e8', min(1, p.y / .26)) if int((math.atan2(p.z, p.x) + 4) * 2.55) % 2 else mix('#7a2f98', '#c98ada', min(1, p.y / .26))
    lathe(n, [(0, .0), (.06, .005), (.12, .05), (.135, .1), (.11, .17), (.05, .23), (.02, .27), (0, .3)], (0, 0, 0), stripes, sides=16, shade=None)
    for i in range(4):
        tube(n, [(0, .006, 0), ((i - 1.5) * .02, -.0, .03)], .006, '#d9c08a', sides=4, shade=None)
    n = asset('onion_chopped', 'food')
    onion_rings(n, [lambda p, nn: '#d9a0e8' if nn.y > .3 else '#8e3fae'])
    for x, z in ((.09, .06), (-.08, .07)):
        box(n, (.04, .035, .04), (x, .018, z), topside('#efd6f4', '#a85cc0'), bev=.008, seg=1, rot=(0, x * 300, 0), shade=None)
    n = asset('onion_cooked', 'food')
    onion_rings(n, ['#c98a2e', '#e0a64c', '#b8741f'])
    n = asset('patty_raw', 'food')  # cartoon joint of beef: marbled lump, fat rim, knobbly bone
    ball(n, (.115, .07, .11), (-.04, .07, 0), lambda p, nn: '#e0404c' if nn.y > .2 else '#b8323e', u=10, v=6, lump=.08)
    torus(n, .1, .022, (-.04, .065, 0), '#ffe2d6', seg=12, sides=4, shade=None)  # fat rim
    for x, z, a, l in ((-.06, -.03, 25, .1), (-.02, .035, -15, .08)):  # marbling
        box(n, (l, .008, .014), (x, .138, z), '#ffc9c2', bev=.003, seg=1, rot=(0, a, 0), shade=None)
    cyl(n, .024, .1, (.1, .065, 0), '#f6efdc', sides=8, rot=(0, 0, 90), bev=.008, shade=(.9, 1))
    for z in (-.026, .026):
        ball(n, .029, (.15, .065, z), '#fbf6ea', u=6, v=5, shade=None)
    n = asset('patty_chopped', 'food')  # minced and shaped, still raw pink
    patty_disc(n, '#ee7b82', '#d45a66')
    for i in range(6):
        a = i * 2.4
        ball(n, .014, (math.cos(a) * .07 * (i % 3 + 1) / 2, .061, math.sin(a) * .07 * (i % 3 + 1) / 2), '#ffb3b3', ico=1, shade=None)
    n = asset('patty_cooked', 'food')
    patty_disc(n, '#8a4a28', '#6a3419', marks='#3a1d12')
    n = asset('bun_raw', 'food')
    bun_half(n, 0, .045, .13, top=False)
    bun_half(n, .05, .14, .135)
    n = asset('dough_raw', 'food')
    ball(n, (.14, .08, .13), (0, .075, 0), lambda p, nn: mix('#e9c07a', '#fbe6bd', min(1, max(0, (p.y - .03) / .12))), u=12, v=8, lump=.1, shade=(.8, 1), smooth_col=True)
    for i, (x, z) in enumerate(((-.04, .03), (.05, -.02), (.0, -.06))):  # flour dusting
        ball(n, (.03, .006, .025), (x, .148 - abs(x) * .3, z), '#fffaf0', ico=1, rot=(0, i * 60, 0), shade=None)
    n = asset('dough_cooked', 'food')  # baked base
    lathe(n, [(0, .028), (.15, .026), (.17, .03), (.2, .045), (.215, .03), (.205, .008), (.18, 0), (0, 0)], (0, 0, 0), lambda p, nn: '#f6d58c' if math.hypot(p.x, p.z) < .16 else '#e19a3f', sides=20, jitter=.04, shade=None)
    for i in range(5):
        a = i * 2.4 + .3
        ball(n, (.02, .004, .015), (math.cos(a) * .1, .029, math.sin(a) * .1), '#c47a33', ico=1, shade=None)
    n = asset('cheese_raw', 'food')
    cheese_wedge(n)
    n = asset('cheese_chopped', 'food')  # grated heap
    ball(n, (.11, .045, .1), (0, .02, 0), '#f3bf2a', u=10, v=5, lump=.2)
    for i in range(20):
        a, r = i * 2.4, .11 * math.sqrt((i + .5) / 20)
        box(n, (.085, .016, .018), (math.cos(a) * r, .05 + .008 * (i % 4) - r * .3, math.sin(a) * r), ('#ffd84a', '#fff08a', '#f6b81f')[i % 3], bev=0, rot=(0, math.degrees(a) * 1.7, (i % 3 - 1) * 18), shade=None)
    n = asset('burnt', 'food')
    ball(n, (.12, .07, .11), (0, .06, 0), '#2f2724', ico=2, lump=.35, flat=True, jitter=.15)
    for x, z in ((.05, .03), (-.04, -.05), (.0, .06)):
        ball(n, .018, (x, .1, z), '#ff7a2a', ico=1, mat=FLAME, shade=None)
    ball(n, (.05, .03, .05), (-.03, .12, .0), '#1c1716', ico=1, lump=.3, flat=True)


def dishes():
    n = asset('dish_side_salad', 'dish')
    lettuce_pile(n, 7, .07, .9)
    n = asset('dish_salad', 'dish')
    lettuce_pile(n, 6, .1)
    for i in range(3):
        a = math.tau * i / 3 + .4
        tomato_slice(n, (math.cos(a) * .07, .045, math.sin(a) * .07), r=.055, h=.022, rot=(12, 0, 0))

    def bowl(n, colour, soup, light, y=.1):
        lathe(n, [(0, 0), (.09, 0), (.1, .012), (.17, .07), (.18, .1), (.165, .104), (.15, .075), (0, .06)], (0, 0, 0), colour, sides=18, mat=GLOSS, shade=(.75, 1))
        lathe(n, [(0, y - .012), (.16, y - .016), (.16, y - .026), (0, y - .026)], (0, 0, 0), lambda p, nn: mix(light, soup, min(1, math.hypot(p.x, p.z) / .15)), sides=18, mat=GLOSS, shade=None, smooth_col=True)

    n = asset('dish_tomato_soup', 'dish')
    bowl(n, lambda p, nn: WHITE if p.y > .03 else '#e7e0d2', '#c92a17', '#e8452a')
    torus(n, .045, .008, (.01, .09, .01), '#fff4e2', seg=10, sides=4, shade=None)
    leaf(n, (-.05, .092, -.04), (.035, .008, .02), '#4f9a3a', yaw=30, shade=None)
    n = asset('dish_onion_soup', 'dish')
    bowl(n, lambda p, nn: '#9a5b35' if p.y < .085 else '#f3e6cf', '#a8641a', '#cf8a2c')
    box(n, (.09, .04, .08), (.02, .095, .0), topside('#f6d36a', '#e0a24a'), bev=.015, seg=1, rot=(0, 20, 0), shade=None)
    for i in range(2):
        torus(n, .03, .007, (-.07 + .04 * i, .09, .06 - .1 * i), '#f0dcf2', seg=8, sides=4, shade=None)

    def burger(n, cheese=False, deluxe=False):
        bun_half(n, 0, .045, .13, top=False, sides=12)
        y = .045
        patty_disc(n, '#8a4a28', '#6a3419', y=y, r=.15, h=.05, sides=12)  # wider than the bun so it shows from above
        y += .05
        if cheese:  # draped square slice: raised centre, drooping corners
            bm = bmesh.new()
            grid = [[bm.verts.new(((i - 1) * .135, .012 if i == j == 1 else (-.035 if i != 1 and j != 1 else 0), (j - 1) * .135)) for j in range(3)] for i in range(3)]
            for i in range(2):
                for j in range(2):
                    bm.faces.new([grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]])
            bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=.012)
            emit(n, bm, '#ffcc33', at=(0, y + .004, 0), rot=(0, 45, 0), shade=None)
            y += .016
        if deluxe:
            bm = bmesh.new()  # frilly lettuce ring: a torus with a wavy radius
            grid = [[bm.verts.new(((.115 + .02 * math.sin(a * 5) + .018 * math.cos(b)) * math.cos(a), .012 * math.sin(b) + .008 * math.sin(a * 5), (.115 + .02 * math.sin(a * 5) + .018 * math.cos(b)) * math.sin(a)))
                     for b in (math.tau * j / 4 for j in range(4))] for a in (math.tau * i / 12 for i in range(12))]
            for i in range(12):
                for j in range(4):
                    bm.faces.new([grid[i][j], grid[(i + 1) % 12][j], grid[(i + 1) % 12][(j + 1) % 4], grid[i][(j + 1) % 4]])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            emit(n, bm, '#86cf4f', at=(0, y + .008, 0), shade=None, jitter=.08)
            y += .014
            tomato_slice(n, (0, y, 0), r=.11, h=.02)
            y += .02
        bun_half(n, y + .003, y + .1, .13, seeds=3 if deluxe else 6, sides=12)
        if deluxe:  # cocktail pick with a flag
            cyl(n, .005, .12, (.02, y + .12, .01), '#f1e0b8', sides=4, bev=0, shade=None)
            box(n, (.06, .035, .004), (.05, y + .165, .01), RED, bev=0, shade=None)

    burger(asset('dish_burger', 'dish'))
    burger(asset('dish_cheeseburger', 'dish'), cheese=True)
    burger(asset('dish_deluxe_burger', 'dish'), deluxe=True)
    n = asset('dish_pizza', 'dish')
    lathe(n, [(0, .026), (.17, .026), (.19, .03), (.215, .042), (.23, .03), (.21, .004), (0, 0)], (0, 0, 0), lambda p, nn: '#d8412a' if math.hypot(p.x, p.z) < .18 and p.y > .02 else '#e3a044', sides=18, jitter=.03, shade=None)
    for i in range(7):
        a, r = i * 2.4, (.03 + .11 * math.sqrt(i / 7)) if i else 0
        ball(n, (.042, .008, .036), (math.cos(a) * r, .03, math.sin(a) * r), '#fff0c4', ico=1, lump=.3, rot=(0, i * 40, 0), shade=None)
    for i in range(4):
        a = i * 1.7 + .6
        leaf(n, (math.cos(a) * .09, .037, math.sin(a) * .09), (.03, .006, .018), '#3f8a32', yaw=i * 50, shade=None)


# ── Chefs: rigid pivots Body (hips) › Head, ArmL, ArmR; LegL, LegR from the root. Character left = +X. ──
CHEF_SCALE = {'chef': 1.26, 'chef_f': 1.177}  # both 1.6 m tall (scene CHEF_HEIGHT); her toque is taller, so she is a touch smaller


def chef(name, female=False):
    root = asset(name, 'chef')
    k = CHEF_SCALE[name]
    with frame(scale=k):
        chef_parts(root, female, lambda *at: tuple(c * k for c in at))


def chef_parts(root, female, at):
    """Jacket and sleeves are TeamColor so a chef's colour reads from the high camera; apron and hat stay white."""
    skin, hair = (SKIN_F, '#7a3b22') if female else (SKIN, '#5a3a26')
    body = Node('Body', root, at(0, .2, 0))
    lathe(body, [(0, .17), (.19, .17), (.215, .26), (.21, .44), (.18, .56), (.1, .62), (0, .63)], (0, 0, 0), WHITE, sides=16, mat=TEAM, shade=(.8, 1))  # jacket
    lathe(body, [(.207, .15), (.225, .27), (.217, .42), (.217, .43)], (0, 0, 0), CREAM, sides=10, arc=(-165, -15), shade=(.85, 1))  # apron skirt
    box(body, (.2, .13, .022), (0, .48, .197), CREAM, bev=.01, seg=1, rot=(-12, 0, 0), shade=None)  # bib
    box(body, (.09, .05, .012), (0, .31, .222), '#e9dcc4', bev=.006, seg=1, shade=None)  # pocket
    torus(body, .212, .017, (0, .27, 0), CREAM, seg=16, sides=4, shade=None)  # apron tie
    for s in (1, -1):  # straps over the shoulders crossing on the back, bow at the waist
        box(body, (.045, .3, .014), (.07 * s, .43, -.205), CREAM, bev=.005, seg=1, rot=(12, 0, 24 * s), shade=None)
        ball(body, (.06, .04, .022), (.05 * s, .28, -.23), CREAM, u=8, v=5, rot=(0, 0, 20 * s), shade=None)
    cyl(body, .075, .1, (0, .64, 0), skin, sides=10, bev=0, shade=None)  # neck
    torus(body, .105, .04, (0, .6, 0), WHITE, seg=12, sides=5, shade=None)  # neckerchief
    prism(body, [(-.045, 0), (.045, 0), (0, .08)], -.012, .012, WHITE, bev=.006, seg=1, at=(0, .58, .12), rot=(-90, 0, 180), shade=None)
    for x in (-.075, .075):  # double-breasted buttons peeking beside the bib
        for y in (.52, .42):
            ball(body, .017, (x * 1.5, y, .19 if y > .45 else .205), '#fff4e2', ico=1, shade=None)
    head = Node('Head', body, at(0, .63, 0))
    ball(head, (.21, .195, .2), (0, .84, 0), skin, u=16, v=10, shade=(.9, 1))
    for s in (1, -1):
        ball(head, (.045, .055, .035), (.2 * s, .83, 0), skin, u=8, v=5, shade=None)  # ears
        ball(head, (.03, .045, .014), (.072 * s, .865, .186), DARK, u=8, v=5, shade=None)  # eyes
        ball(head, .011, (.064 * s, .882, .199), WHITE, ico=1, shade=None)
        ball(head, (.042, .022, .012), (.12 * s, .8, .165), BLUSH, u=8, v=4, shade=None)
    ball(head, (.034, .03, .028), (0, .82, .2), mix(skin, '#e08a6a', .35), u=8, v=5, shade=None)
    if female:
        tube(head, [(-.035, .77, .192), (0, .76, .198), (.035, .77, .192)], .009, '#b8403a', sides=5, shade=None)
        ball(head, (.225, .2, .215), (0, .87, -.035), hair, u=12, v=8, shade=(.8, 1))  # hair shell behind the face
        for s in (1, -1):
            ball(head, (.07, .13, .08), (.17 * s, .78, -.02), hair, u=7, v=5, shade=(.8, 1))  # side locks
            box(head, (.022, .008, .008), (.1 * s, .9, .18), DARK, bev=.003, seg=1, rot=(0, 0, 25 * s), shade=None)  # lashes
        ball(head, (.16, .05, .06), (-.03, .98, .14), hair, u=10, v=5, rot=(0, 0, -8), shade=None)  # fringe
        ball(head, .085, (0, .9, -.22), hair, u=10, v=7, shade=None)  # bun
    else:
        for s in (1, -1):
            ball(head, (.058, .026, .024), (.045 * s, .785, .2), hair, u=8, v=5, rot=(0, 0, -18 * s), shade=None)  # moustache
            ball(head, (.03, .07, .05), (.19 * s, .9, -.02), hair, u=6, v=5, shade=None)  # sideburns
        ball(head, (.2, .12, .17), (0, .9, -.07), hair, u=12, v=7, shade=(.8, 1))
        tube(head, [(-.03, .755, .19), (0, .748, .195), (.03, .755, .19)], .008, '#9c3a32', sides=5, shade=None)
    band_y, puff_y = (.99, 1.2) if female else (.98, 1.11)
    cyl(head, .172, .1, (0, band_y + .005, 0), WHITE, sides=16, bev=.02, seg=2, mat=TEAM, shade=None)  # team hat band
    if female:
        cyl(head, .15, .16, (0, band_y + .11, 0), WHITE, sides=16, r2=.17, bev=.02, shade=(.85, 1))
    for i in range(6):
        a = math.tau * i / 6
        ball(head, .1, (math.cos(a) * .1, puff_y, math.sin(a) * .1), WHITE, u=7, v=5, shade=(.82, 1))
    ball(head, .12, (0, puff_y + .04, 0), WHITE, u=10, v=7, shade=(.85, 1))
    for s, side in ((1, 'L'), (-1, 'R')):
        arm = Node('Arm' + side, body, at(.2 * s, .55, 0))
        tube(arm, [(.2 * s, .56, 0), (.25 * s, .44, .01), (.265 * s, .36, .02)], [.064, .06, .054], WHITE, sides=8, mat=TEAM, shade=(.85, 1))
        torus(arm, .052, .016, (.265 * s, .36, .02), WHITE, seg=10, sides=4, rot=(0, 0, 8 * s), shade=None)  # cuff
        ball(arm, .062, (.27 * s, .31, .025), skin, u=10, v=7, shade=None)
        leg = Node('Leg' + side, root, at(.09 * s, .2, 0))
        cyl(leg, .065, .15, (.09 * s, .13, 0), '#3d4458', sides=10, bev=.01, shade=None)
        box(leg, (.12, .07, .19), (.095 * s, .035, .03), lambda p, nn: '#f4efe6' if p.y < .012 else '#3b2a24', bev=.03, seg=2, shade=None)


# ── Theme props (edge decoration; base at y = 0, names match the scene's theme palettes) ──────
def props():
    n = asset('prop_plant', 'prop')  # diner, market, grand
    lathe(n, [(0, 0), (.16, 0), (.22, .36), (.24, .38), (.24, .43), (0, .43)], (0, 0, 0), lambda p, nn: '#e07b4c' if p.y < .35 else '#c9613a', sides=12)
    for i in range(10):
        a = i * 2.4
        leaf(n, (math.cos(a) * .14, .56 + .11 * (i % 3), math.sin(a) * .14), (.19, .06, .09), ('#3f8f4f', '#5fae5a', '#7fc467')[i % 3], yaw=math.degrees(a), tilt=-30 + 10 * (i % 3))
    n = asset('prop_stool', 'prop')  # diner
    cyl(n, .18, .03, (0, .015, 0), STEEL_D, sides=12, mat=GLOSS)
    cyl(n, .03, .56, (0, .3, 0), STEEL, sides=8, bev=0, mat=GLOSS)
    torus(n, .14, .012, (0, .26, 0), STEEL, seg=12, sides=4, mat=GLOSS)
    cyl(n, .21, .09, (0, .62, 0), lambda p, nn: '#ee5345' if p.y > .585 else STEEL, sides=14, bev=.03, seg=2)
    n = asset('prop_bench', 'prop')  # diner booth: 1.6 m wide, seat faces +Z
    box(n, (1.6, .1, .6), (0, .05, 0), '#6e2f2a', bev=.03, seg=1)
    box(n, (1.56, .3, .56), (0, .25, .02), '#c9443a', bev=.08, seg=2)
    box(n, (1.56, .62, .2), (0, .62, -.2), '#c9443a', bev=.08, seg=2)
    for x in (-.52, 0, .52):
        box(n, (.02, .5, .02), (x, .64, -.09), '#a8332c', bev=0, shade=None)  # tufted seams
    box(n, (1.6, .06, .24), (0, .96, -.22), WOOD, bev=.02, seg=1)
    n = asset('prop_sign', 'prop')  # diner: chalkboard menu easel facing +Z
    with frame((0, 0, 0), (-10, 0, 0)):
        box(n, (.6, .8, .05), (0, .55, 0), WOOD, bev=.03, seg=1)
        box(n, (.5, .66, .02), (0, .56, .03), '#2f4a3f', bev=.01, seg=1, shade=None)
        for i, (w, c) in enumerate(((.34, WHITE), (.26, '#ffd24a'), (.3, WHITE), (.2, '#ff8a7a'))):
            box(n, (w, .03, .005), (0, .78 - .1 * i, .042), c, bev=0, shade=None)
    for x in (-.25, .25):
        box(n, (.05, .9, .05), (x, .45, -.2), WOOD_D, bev=.015, seg=1, rot=(22, 0, 0))
    n = asset('prop_barrel', 'prop')  # harbor, canyon
    lathe(n, [(0, 0), (.26, 0), (.31, .33), (.26, .66), (0, .66)], (0, 0, 0), lambda p, nn: '#e0a869' if nn.y > .7 else ('#b06a34' if int(math.atan2(p.z, p.x) * 3) % 2 else '#c47c3c'), sides=14)
    for y, r in ((.12, .282), (.54, .282)):
        torus(n, r, .016, (0, y, 0), IRON, seg=14, sides=4)
    n = asset('prop_buoy', 'prop')  # harbor: life ring on a post
    cyl(n, .05, 1, (0, .5, 0), WOOD_D, sides=8)
    torus(n, .22, .065, (0, .78, .07), lambda p, nn: RED if int((math.atan2(p.y - .78, p.x) + 4) * 1.27) % 2 else WHITE, seg=16, sides=8, rot=(90, 0, 0))
    n = asset('prop_post', 'prop')  # harbor: mooring bollard with rope
    lathe(n, [(0, 0), (.15, 0), (.13, .12), (.11, .6), (.16, .66), (.15, .74), (0, .76)], (0, 0, 0), lambda p, nn: '#3a3f4a' if p.y > .1 else '#2a2d35', sides=12, mat=GLOSS)
    torus(n, .13, .03, (0, .42, 0), '#e0c48e', seg=12, sides=5)
    torus(n, .13, .03, (0, .48, 0), '#d2b37a', seg=12, sides=5, rot=(6, 0, 0))
    n = asset('prop_crate_stack', 'prop')  # harbor, market
    for (x, y, z, a, s) in ((0, .25, 0, 0, .5), (.05, .71, .03, 18, .42)):
        with frame((x, y, z), (0, a, 0)):
            box(n, (s, s, s), (0, 0, 0), WOOD, bev=.02, seg=1)
            for rot in (0, 90, 180, 270):
                with frame(rot=(0, rot, 0)):
                    box(n, (s * .96, .05, .02), (0, 0, s / 2), WOOD_D, bev=.008, seg=1, rot=(0, 0, 40))
    n = asset('prop_boat', 'prop')  # harbor: little rowing boat, 1.8 m long along X
    lathe(n, [(0, .0), (.3, .02), (.42, .16), (.44, .3), (.4, .3), (.36, .18), (.24, .1), (0, .1)], (0, 0, 0), lambda p, nn: WOOD_L if p.y > .27 else (RED if p.y > .12 else WHITE), sides=16, rot=(0, 0, 0))
    for x in (-.25, .25):
        box(n, (.14, .03, .7), (x, .24, 0), WOOD, bev=.01, seg=1)
    n.bufs[PAINT]['v'] = [Vector((v.x * 2.05, v.y, v.z * .95)) for v in n.bufs[PAINT]['v']]  # stretch the hull
    n = asset('prop_pine', 'prop')  # alpine: tiered pine with snow caps
    cyl(n, .08, .35, (0, .175, 0), '#7a4a2a', sides=8)
    for i, (y, r, h) in enumerate(((.3, .56, .65), (.72, .44, .58), (1.1, .31, .5), (1.45, .18, .38))):
        cyl(n, r, h, (0, y + h / 2, 0), '#2f7a4f' if i % 2 == 0 else '#3b8c5a', sides=10, r2=.02, bev=.02, flat=True)
        cyl(n, r * .5, h * .26, (0, y + h * .87, 0), '#f6fbff', sides=10, r2=.01, bev=.01, flat=True)
    n = asset('prop_snowman', 'prop')  # alpine
    ball(n, .3, (0, .28, 0), '#f6fbff', u=12, v=8, shade=(.8, 1))
    ball(n, .22, (0, .72, 0), '#f6fbff', u=12, v=8, shade=(.85, 1))
    torus(n, .16, .045, (0, .88, 0), RED, seg=12, sides=5, shade=None)
    box(n, (.08, .22, .03), (.1, .78, .17), RED, bev=.01, seg=1, rot=(-10, 0, 8), shade=None)
    ball(n, .16, (0, 1.06, 0), '#f6fbff', u=12, v=8, shade=(.9, 1))
    cyl(n, .025, .16, (0, 1.06, .21), '#ff8a2a', sides=6, r2=.002, rot=(90, 0, 0), bev=0, shade=None)
    for s in (1, -1):
        ball(n, .02, (.06 * s, 1.1, .14), DARK, ico=1, shade=None)
        tube(n, [(.2 * s, .75, 0), (.36 * s, .88, 0), (.42 * s, .98, .02)], .014, '#6b4228', sides=4, shade=None)
    for y in (.62, .74):
        ball(n, .022, (0, y, .215), DARK, ico=1, shade=None)
    cyl(n, .12, .16, (0, 1.26, 0), DARK, sides=12, bev=.01, shade=None)
    cyl(n, .19, .025, (0, 1.19, 0), DARK, sides=12, bev=.005, shade=None)
    n = asset('prop_logs', 'prop')  # alpine: stacked firewood
    for x, y, z in ((0, .13, -.14), (0, .13, .14), (0, .36, 0)):
        cyl(n, .13, .9, (x, y, z), lambda p, nn: '#e8b77a' if abs(nn.x) > .7 else '#7a4c30', sides=10, rot=(0, 0, 90), bev=.015, jitter=.06)
    n = asset('prop_cactus', 'prop')  # canyon
    green = lambda p, nn: '#4f9a4a' if int((math.atan2(p.z, p.x) + 4) * 2.5) % 2 else '#62b25a'
    tube(n, [(0, 0, 0), (0, .95, 0), (0, 1.02, 0)], [.14, .14, .08], green, sides=10)
    for s, y in ((1, .4), (-1, .58)):
        tube(n, [(0, y, 0), (.24 * s, y, 0), (.26 * s, y + .28, 0), (.26 * s, y + .34, 0)], [.07, .07, .07, .04], green, sides=8)
    ball(n, .05, (0, 1.05, 0), '#ff78a8', ico=1, shade=None)
    n = asset('prop_rock', 'prop')  # canyon, alpine
    ball(n, (.42, .28, .34), (0, .18, 0), '#c7875a', ico=2, lump=.3, flat=True, jitter=.08, shade=(.75, 1))
    ball(n, (.2, .16, .18), (.34, .1, .18), '#d69868', ico=1, lump=.3, flat=True, jitter=.08, shade=(.75, 1))
    n = asset('prop_skull', 'prop')  # canyon: sun-bleached cattle skull
    ball(n, (.16, .12, .22), (0, .12, 0), '#f1e6cf', u=10, v=7, lump=.08)
    ball(n, (.1, .08, .1), (0, .08, .2), '#e6d8bb', u=8, v=6)
    for s in (1, -1):
        ball(n, (.04, .03, .02), (.07 * s, .16, .17), '#3a2a24', u=6, v=4, shade=None)
        tube(n, [(.12 * s, .16, -.05), (.3 * s, .2, -.08), (.42 * s, .34, -.04), (.44 * s, .42, 0)], [.05, .04, .03, .012], '#e9dcc0', sides=6)
    n = asset('prop_lantern', 'prop')  # market, alpine, harbor
    cyl(n, .035, 1.5, (0, .75, 0), '#3b2b2b', sides=6, bev=0)
    tube(n, [(0, 1.46, 0), (.2, 1.5, 0), (.3, 1.44, 0)], .018, '#3b2b2b', sides=5)
    ball(n, (.13, .16, .13), (.3, 1.26, 0), '#ffc56a', u=10, v=7, mat=FLAME, shade=None)
    for y in (1.1, 1.42):
        cyl(n, .07, .04, (.3, y, 0), '#3b2b2b', sides=8, bev=.008)
    n = asset('prop_awning', 'prop')  # market: striped stall canopy over a produce table
    box(n, (.9, .06, .6), (0, .7, 0), WOOD, bev=.02)
    for x in (-.4, .4):
        for z in (-.25, .25):
            cyl(n, .025, 1.5 if z < 0 else .7, (x, .75 if z < 0 else .35, z), WOOD_D, sides=6, bev=0)
    for i in range(6):
        box(n, (.16, .025, .7), (-.4 + .16 * i, 1.45, .0), '#2f9a8a' if i % 2 == 0 else CREAM, bev=.008, seg=1, rot=(18, 0, 0))
    for i, c in enumerate(('#ee4631', '#f6a13a', '#7fc467', '#ee4631', '#ffd24a')):
        ball(n, .07, (-.3 + .15 * i, .8, .05 * (i % 2)), c, u=8, v=6)
    n = asset('prop_basket', 'prop')  # market
    lathe(n, [(0, 0), (.2, 0), (.27, .22), (.28, .25), (.25, .25), (0, .05)], (0, 0, 0), lambda p, nn: '#c98d4c' if int(p.y * 40) % 2 else '#a86f35', sides=14)
    for i in range(6):
        a = i * 2.4
        ball(n, .08, (math.cos(a) * .11 * (i > 0), .23 + .03 * (i == 0), math.sin(a) * .11 * (i > 0)), ('#ee4631', '#f6a13a', '#9fd24a')[i % 3], u=8, v=6)
    n = asset('prop_column', 'prop')  # grand: marble column with a gold capital
    box(n, (.56, .14, .56), (0, .07, 0), BRASS, bev=.03, mat=GLOSS)
    cyl(n, .22, 2.3, (0, 1.29, 0), lambda p, nn: '#f6f2ea' if int((math.atan2(p.z, p.x) + 4) * 2.5) % 2 else '#e3dccf', sides=16, bev=0, mat=GLOSS)
    box(n, (.56, .14, .56), (0, 2.5, 0), BRASS, bev=.03, mat=GLOSS)
    n = asset('prop_rope', 'prop')  # grand: velvet rope between brass posts (1.2 m apart)
    for x in (-.6, .6):
        cyl(n, .12, .04, (x, .02, 0), BRASS, sides=10, mat=GLOSS)
        cyl(n, .035, .8, (x, .42, 0), BRASS, sides=8, bev=0, mat=GLOSS)
        ball(n, .06, (x, .84, 0), BRASS, u=8, v=6, mat=GLOSS)
    tube(n, [(-.6, .76, 0), (-.3, .6, 0), (0, .56, 0), (.3, .6, 0), (.6, .76, 0)], .03, '#a1263a', sides=6)
    n = asset('prop_window', 'prop')  # wall dressing: glass centred at y 1.0, front at z 0.52 of a wall tile
    box(n, (.72, .62, .06), (0, 1.0, .5), WHITE, bev=.02)
    for x in (-.16, .16):
        for y in (.86, 1.14):
            box(n, (.28, .23, .02), (x, y, .53), lambda p, nn: mix('#bfeaf7', '#7fcbe7', (1.2 - p.y) * 2), bev=.01, seg=1, mat=GLOSS, shade=None)
    box(n, (.8, .05, .14), (0, .68, .56), WOOD, bev=.015)
    box(n, (.62, .1, .12), (0, .74, .57), '#6e8c5a', bev=.02)
    for i in range(5):
        ball(n, .035, (-.24 + .12 * i, .8, .58), ('#ff6f6f', '#ffd24a', '#f6f0ff')[i % 3], ico=1, shade=None)
    n = asset('prop_lamp', 'prop')  # grand, diner: brass lamp post with warm globes
    cyl(n, .16, .06, (0, .03, 0), IRON, sides=12)
    cyl(n, .035, 1.5, (0, .8, 0), IRON_L, sides=8, bev=0)
    for s in (1, -1):
        tube(n, [(0, 1.4, 0), (.12 * s, 1.5, 0), (.22 * s, 1.44, 0)], .015, BRASS, sides=5, mat=GLOSS)
        ball(n, .08, (.22 * s, 1.37, 0), '#fff1c2', u=10, v=7, mat=FLAME, shade=None)
    ball(n, .05, (0, 1.58, 0), BRASS, u=8, v=6, mat=GLOSS)
    n = asset('prop_topiary', 'prop')  # grand
    lathe(n, [(0, 0), (.12, 0), (.1, .08), (.18, .3), (.2, .34), (0, .34)], (0, 0, 0), '#f3efe6', sides=14, mat=GLOSS)
    cyl(n, .025, .2, (0, .42, 0), '#6b4228', sides=6, bev=0)
    ball(n, .24, (0, .7, 0), '#3f8f4f', ico=2, lump=.12, flat=True, jitter=.1)


PROP_THEMES = {
    'diner': ['prop_plant', 'prop_stool', 'prop_topiary', 'prop_lamp', 'prop_bench', 'prop_sign', 'prop_window'],
    'harbor': ['prop_barrel', 'prop_buoy', 'prop_crate_stack', 'prop_lamp', 'prop_post', 'prop_boat', 'prop_lantern'],
    'alpine': ['prop_pine', 'prop_snowman', 'prop_logs', 'prop_rock', 'prop_lantern', 'prop_window'],
    'canyon': ['prop_cactus', 'prop_rock', 'prop_skull', 'prop_barrel'],
    'market': ['prop_lantern', 'prop_basket', 'prop_crate_stack', 'prop_awning', 'prop_plant'],
    'grand': ['prop_column', 'prop_plant', 'prop_rope', 'prop_topiary', 'prop_lamp'],
}


# ── Blender objects, export and manifest ─────────────────────────────────
def g2b(v):
    return (v[0], -v[2], v[1])


def realise(node, parent=None, prefix=''):
    empty = bpy.data.objects.new(node.name, None)
    bpy.context.collection.objects.link(empty)
    empty.parent = parent
    empty.location = g2b(node.at - (node.parent.at if node.parent else Vector()))
    label = f'{prefix}_{node.name}' if prefix else node.name
    for mat, buf in node.bufs.items():
        me = bpy.data.meshes.new(f'{label}_{mat.name}')
        me.from_pydata([g2b(v) for v in buf['v']], [], buf['f'])
        attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
        attr.data.foreach_set('color', [ch for c in buf['c'] for ch in (*c, 1.)])
        me.polygons.foreach_set('use_smooth', buf['s'])
        me.set_sharp_from_angle(angle=math.radians(50))
        me.materials.append(mat)
        obj = bpy.data.objects.new(f'{label}_{mat.name}', me)
        bpy.context.collection.objects.link(obj)
        obj.parent = empty
        mod = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    for kid in node.kids:
        realise(kid, empty, label)
    return empty


def main():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for build in (counter, board, stove, oven, sink, rack, ret, serve, bin_, crate, belt, environment, items, soups, food, dishes, props):
        build()
    chef('chef')
    chef('chef_f', female=True)
    for node, kind in ASSETS:  # carried things rest exactly on y = 0 (lumpy noise can dip below it)
        if kind == 'food' and node.name != 'dough_cooked':  # loose food reads ~20% larger than life at game scale
            for buf in node.bufs.values():
                buf['v'] = [v * FOOD_SCALE for v in buf['v']]
        if kind in ('food', 'item', 'dish', 'soup'):
            low = min(v.y for buf in node.bufs.values() for v in buf['v'])
            for buf in node.bufs.values():
                buf['v'] = [v - Vector((0, low, 0)) for v in buf['v']]
    roots = [(realise(node), kind) for node, kind in ASSETS]
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    report = {}
    for root, kind in roots:
        tris, mats, lo, hi = 0, set(), Vector((1e9,) * 3), Vector((-1e9,) * 3)
        for obj in root.children_recursive:
            if obj.type != 'MESH':
                continue
            ev = obj.evaluated_get(depsgraph)
            mesh = ev.to_mesh()
            mesh.calc_loop_triangles()
            tris += len(mesh.loop_triangles)
            mats |= {m.name for m in obj.data.materials}
            for v in mesh.vertices:
                w = obj.matrix_world @ v.co
                g = Vector((w.x, w.z, -w.y))
                lo, hi = Vector(map(min, lo, g)), Vector(map(max, hi, g))
            ev.to_mesh_clear()
        report[root.name] = {'kind': kind, 'triangles': tris, 'materials': sorted(mats),
                             'min': [round(c, 3) for c in lo], 'max': [round(c, 3) for c in hi]}
    out = PUBLIC / 'models/kitchen-kit.glb'
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for root, _ in roots:
        for obj in [root, *root.children_recursive]:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_animations=False, export_cameras=False, export_lights=False, export_vertex_color='MATERIAL',
                              export_extras=False)
    manifest = {
        'source': 'Original procedural Blender kit (art/build_kit.py). No external meshes or textures.',
        'units': 'metres', 'up': 'Y', 'front': '+Z', 'counterHeight': H,
        'anchors': {'boardSurface': .945, 'potFloor': .04, 'potRim': .25, 'panFloor': .045, 'plateSurface': .03, 'plateRadius': PLATE_R,
                    'crateFloor': .7, 'stoveTrivet': .93, 'beltSurface': .915, 'ovenHearth': OVEN_HEARTH, 'beltRibPeriod': .25, 'ovenMouthZ': .3, 'chefHeight': round(report['chef']['max'][1], 3)},
        'chefRig': 'Body (hips) > Head, ArmL, ArmR; LegL, LegR are siblings of Body. Character left = +X. Material TeamColor is white.',
        'animatedChildren': {'stove': 'stove_flame', 'belt': 'belt_surface', 'bin': 'bin_lid'},
        'tintable': {'TeamColor': 'player colour', 'CrateLabel': 'ingredient colour', 'Floor': 'theme floor', 'Wall': 'theme wall'},
        'themes': PROP_THEMES, 'bytes': out.stat().st_size, 'assets': report,
    }
    (ART / 'asset-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    bpy.context.preferences.filepaths.save_version = 0  # no kitchen-kit.blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'kitchen-kit.blend'))
    print('KITCHEN_KIT', out, out.stat().st_size, 'bytes', len(roots), 'assets')


main()
