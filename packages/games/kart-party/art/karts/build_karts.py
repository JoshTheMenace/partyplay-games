"""Kart Party 2 cast + karts -> public/models/karts.glb (+ previews, karts.blend).

Run from anywhere:  blender --background --python art/karts/build_karts.py [-- --no-render] [-- --qa]
Everything is procedural and original. Geometry is authored in GAME axes (x = driver-left, y = up,
z = forward, metres) and converted to Blender (x, -z, y) so the Y-up glTF export lands on +Z forward,
-X driver-right exactly as DESIGN.md section 7 requires. All pivots are empties/meshes whose origin sits
at the joint (axle centre, neck, shoulder, hips); only the steering-wheel pivot carries a rotation
(tilted about X so its local Z is the steering column).
"""
import bpy, bmesh, math, sys, json
from pathlib import Path
from mathutils import Vector as V, Matrix, Euler

GAME = Path(__file__).resolve().parents[2]
OUT, PREV = GAME / 'public/models', GAME / 'public/models/previews'
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QA = Path('/tmp/kartqa')
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- materials
def lin(h): return tuple((c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4) for c in (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)))
MATS = {}
def mat(name, hexc, metal=0., rough=.55, emit=0., coat=0.):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = (*lin(hexc), 1)
    m.diffuse_color = c
    bs.inputs['Base Color'].default_value = c
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    if emit: bs.inputs['Emission Color'].default_value = c; bs.inputs['Emission Strength'].default_value = emit
    if coat: bs.inputs['Coat Weight'].default_value = coat; bs.inputs['Coat Roughness'].default_value = .06
    MATS[name] = m
    return m

def shade(hexc, f):  # multiply an sRGB hex colour (f < 1 darker, > 1 toward white)
    c = [int(hexc[i:i + 2], 16) for i in (1, 3, 5)]
    c = [v * f if f <= 1 else v + (255 - v) * (f - 1) for v in c]
    return '#' + ''.join('%02x' % max(0, min(255, round(v))) for v in c)

PAINT = mat('kart_paint', '#e63b3b', .15, .32, coat=1)
TRIM = mat('kart_trim', '#2b303b', .2, .5)
CHROME = mat('kart_chrome', '#e3e9f0', 1, .18)
RUBBER = mat('kart_rubber', '#23242a', 0, .82)
SEAT = mat('kart_seat', '#3b3444', 0, .6)
WHITE = mat('kart_white', '#f6f4ee', 0, .35, coat=.6)
GLASS = mat('kart_glass', '#1f3b5c', .3, .08)
LAMP = mat('kart_lamp', '#fff4c8', 0, .2, emit=2.5)
TAIL = mat('kart_taillight', '#ff3b30', 0, .25, emit=2)
GOLD = mat('kart_gold', '#ffc23d', .6, .3)
EYE_W = mat('eye_white', '#ffffff', 0, .25)
EYE_D = mat('eye_dark', '#1a1430', 0, .15)
GLINT = mat('eye_glint', '#ffffff', 0, .1, emit=2)
NOSE = mat('nose_dark', '#2b1d24', 0, .3)
BLUSH = mat('blush', '#ff8fae', 0, .6)
PINK = mat('ear_pink', '#ffb0c4', 0, .6)
TOOTH = mat('tooth', '#fffaf0', 0, .3)
GLOVE = mat('glove', '#fbfbf7', 0, .5)
SCARF = mat('scarf_red', '#e8323c', 0, .6)
SPIKE = mat('spike_orange', '#ffb12e', 0, .45)
MOON = mat('moon_gold', '#ffd84a', .3, .3, emit=.4)
BEAK = mat('beak_orange', '#ff9f1c', 0, .4)

# ---------------------------------------------------------------- geometry toolkit (game axes)
def ang(n): return [2 * math.pi * i / n for i in range(n)]
def xf(pos=(0, 0, 0), rot=(0, 0, 0), s=(1, 1, 1)):
    s = s if hasattr(s, '__len__') else (s,) * 3
    return Matrix.Translation(V(pos)) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))
def frame(pos, z, up=(0, 1, 0), s=(1, 1, 1)):  # local +Z along z, local +Y toward up
    z = V(z).normalized(); x = V(up).cross(z)
    if x.length < 1e-6: x = V((1, 0, 0))
    x.normalize(); y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4(); m.translation = V(pos)
    return m @ Matrix.Diagonal((*s, 1))

def loft(rings, start=None, end=None, loop=False):
    N = len(rings[0]); verts = [V(p) for r in rings for p in r]; faces = []
    rs = len(rings) if loop else len(rings) - 1
    for j in range(rs):
        k = (j + 1) % len(rings)
        faces += [(j * N + i, j * N + (i + 1) % N, k * N + (i + 1) % N, k * N + i) for i in range(N)]
    if start is not None: verts.append(V(start)); c = len(verts) - 1; faces += [(c, (i + 1) % N, i) for i in range(N)]
    if end is not None:
        verts.append(V(end)); c = len(verts) - 1; o = (len(rings) - 1) * N
        faces += [(c, o + i, o + (i + 1) % N) for i in range(N)]
    return verts, faces

def sphere(seg=20, rings=10):
    return loft([[(math.sin(t) * math.sin(a), math.cos(t), math.sin(t) * math.cos(a)) for a in ang(seg)]
                 for t in (math.pi * k / rings for k in range(1, rings))], (0, 1, 0), (0, -1, 0))

def lathe(prof, seg=20):  # profile [(r, y)], r == 0 at an end makes a pole; axis +Y
    p = list(prof); start = end = None
    if p[0][0] <= 1e-6: start = (0, p[0][1], 0); p = p[1:]
    if p[-1][0] <= 1e-6: end = (0, p[-1][1], 0); p = p[:-1]
    return loft([[(r * math.sin(a), y, r * math.cos(a)) for a in ang(seg)] for r, y in p], start, end)

def revolve(loop_prof, seg=24):  # closed profile loop [(r, y)] swept around +Y (tyres, tori)
    return loft([[(r * math.sin(a), y, r * math.cos(a)) for r, y in loop_prof] for a in ang(seg)], loop=True)

def spline(ctrl, n=8):
    c = [V(p) for p in ctrl]; c = [c[0] * 2 - c[1]] + c + [c[-1] * 2 - c[-2]]; out = []
    for i in range(1, len(c) - 2):
        p0, p1, p2, p3 = c[i - 1], c[i], c[i + 1], c[i + 2]
        for k in range(n):
            t = k / n
            out.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out + [c[-2]]

def tube(pts, radius, sides=10, flat=1., up=None, caps=True):
    """Swept circle (optionally flattened along `up`) with rounded caps; radius = float | list | f(u)."""
    pts = [V(p) for p in pts]; n = len(pts)
    rad = [radius(i / (n - 1)) if callable(radius) else (radius[i] if hasattr(radius, '__len__') else radius) for i in range(n)]
    T = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    cap = min(flat, 1.)  # flattened tubes get proportionally shorter domes
    if caps:
        pts = [pts[0] - T[0] * rad[0] * .45 * cap] + pts + [pts[-1] + T[-1] * rad[-1] * .45 * cap]
        rad = [rad[0] * .82] + rad + [rad[-1] * .82]; T = [T[0]] + T + [T[-1]]
    ref = V(up) if up else (V((0, 1, 0)) if abs(T[0].y) < .9 else V((0, 0, 1)))
    nv = [(ref - T[0] * ref.dot(T[0])).normalized()]
    for t in T[1:]: q = nv[-1] - t * nv[-1].dot(t); nv.append(q.normalized())
    rings = [[p + a_n * math.cos(a) * r * flat + t.cross(a_n) * math.sin(a) * r for a in ang(sides)] for p, t, a_n, r in zip(pts, T, nv, rad)]
    return loft(rings, pts[0] - T[0] * rad[0] * .9 * cap if caps else pts[0], pts[-1] + T[-1] * rad[-1] * .9 * cap if caps else pts[-1])

def rbox(hx, hy, hz, r, k=2, m=1):
    """Rounded box (flat faces, circular edges) centred on the origin; smooth shading reads as a bevel."""
    r = min(r, hx * .96, hy * .96, hz * .96); H = (hx, hy, hz); inner = [h - r for h in H]
    def axis(h):
        i = h - r; band = [i + r * math.sin(math.pi / 2 * j / k) for j in range(1, k + 1)]
        return [-b for b in reversed(band)] + [-i + 2 * i * j / m for j in range(m + 1)] + band
    ax = [axis(h) for h in H]; verts = []; idx = {}; faces = []
    def vid(p):
        key = tuple(round(c, 6) for c in p)
        if key not in idx:
            q = V([max(-inner[i], min(inner[i], p[i])) for i in range(3)]); d = V(p) - q
            idx[key] = len(verts); verts.append(q + d.normalized() * r if d.length > 1e-9 else V(p))
        return idx[key]
    for a in range(3):
        u, w = [b for b in range(3) if b != a]
        for s in (-1, 1):
            for i in range(len(ax[u]) - 1):
                for j in range(len(ax[w]) - 1):
                    quad = []
                    for (x, y) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                        p = [0, 0, 0]; p[a] = s * H[a]; p[u] = ax[u][x]; p[w] = ax[w][y]; quad.append(vid(p))
                    faces.append(tuple(quad))
    return verts, faces

def sring(z, y0, y1, w, n=3., tw=1., seg=28, x0=0.):
    """Superellipse cross-section at station z: bottom y0, top y1, half-width w (tw scales the top half)."""
    out = []
    for a in ang(seg):
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** (2 / n), c); y = math.copysign(abs(s) ** (2 / n), s)
        out.append((x0 + x * w * (1 + (tw - 1) * (y + 1) / 2), (y0 + y1) / 2 + y * (y1 - y0) / 2, z))
    return out
def body_loft(stations, seg=28, n=3., tw=1.):
    rings = [sring(*st[:4], n=st[4] if len(st) > 4 else n, tw=st[5] if len(st) > 5 else tw, seg=seg) for st in stations]
    c = lambda r, dz: (0, sum(p[1] for p in r) / len(r), r[0][2] + dz)
    return loft(rings, c(rings[0], -.02), c(rings[-1], .02))

def box(hx, hy, hz):  # hard-edged block (flat shaded via Geo.add(smooth=False))
    v = [(x * hx, y * hy, z * hz) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    return v, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]

class Geo:
    def __init__(s): s.v, s.f, s.m, s.mats, s.flat = [], [], [], [], set()
    def add(s, prim, material, M=Matrix.Identity(4), smooth=True):
        if not smooth: s.flat |= set(range(len(s.f), len(s.f) + len(prim[1])))
        verts, faces = prim; b = len(s.v)
        if material not in s.mats: s.mats.append(material)
        mi = s.mats.index(material)
        s.v += [M @ V(p) for p in verts]; s.f += [tuple(i + b for i in f) for f in faces]; s.m += [mi] * len(faces)
        return s
    def mirror(s, fn):  # run fn(sign) for both sides; sign +1 = driver-left (+X)
        for k in (1, -1): fn(k)
    def tris(s): return sum(len(f) - 2 for f in s.f)

def ell(g, material, c, r, rot=(0, 0, 0), seg=16, rings=8):
    return g.add(sphere(seg, rings), material, xf(c, rot, r))

def on_ell(c, R, yaw, pitch):  # surface point + normal of an ellipsoid; yaw from +Z toward +X, degrees
    y, p = math.radians(yaw), math.radians(pitch)
    d = V((math.cos(p) * math.sin(y), math.sin(p), math.cos(p) * math.cos(y)))
    pt = V(c) + V((d.x * R[0], d.y * R[1], d.z * R[2]))
    return pt, V((d.x / R[0], d.y / R[1], d.z / R[2])).normalized()

# ---------------------------------------------------------------- scene objects
PIV = {}
def link(ob, parent, pivot):
    bpy.context.scene.collection.objects.link(ob); ob.parent = parent
    pp = PIV[parent.name] if parent else V((0, 0, 0)); v = V(pivot) - pp
    ob.location = (v.x, -v.z, v.y); PIV[ob.name] = V(pivot)
    return ob
def empty(name, parent, pivot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None); ob.empty_display_size = .15
    return link(ob, parent, pivot)
TRI = {}
def mesh(name, g, parent, pivot=(0, 0, 0), tilt=0.):
    """Mesh node whose origin is the pivot. Geometry is in parent space (world for our trees) unless tilt
    != 0, in which case it is already local to a node rotated `tilt` degrees about X."""
    me = bpy.data.meshes.new(name); pv = V(pivot)
    me.from_pydata([(q.x, -q.z, q.y) for q in (p if tilt else p - pv for p in g.v)], [], g.f)
    for m_ in g.mats: me.materials.append(m_)
    for poly, mi in zip(me.polygons, g.m): poly.material_index = mi; poly.use_smooth = poly.index not in g.flat
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me), parent, pivot)
    if tilt: ob.rotation_euler = (math.radians(tilt), 0, 0)
    root = name.split('_')[0] + '_' + name.split('_')[1]
    TRI[root] = TRI.get(root, 0) + g.tris()
    return ob

# ---------------------------------------------------------------- characters
CHARS = [  # mirrors src/sim/stats.ts CHARACTERS (order, species, weight, colours)
    ('Mochi', 'hamster', 'light', '#ffb347', '#fff1d6'), ('Pepper', 'fox', 'medium', '#ff6a3d', '#fff4ea'),
    ('Bruno', 'bear', 'heavy', '#8a5a3c', '#f0d2a8'), ('Ribbit', 'frog', 'light', '#5fd35f', '#f4ffd6'),
    ('Luna', 'cat', 'medium', '#9b7bff', '#f3edff'), ('Waddles', 'penguin', 'medium', '#2f3d5c', '#ffffff'),
    ('Coco', 'bunny', 'light', '#ff8fc8', '#fff0f8'), ('Rex', 'dino', 'heavy', '#2fb89a', '#e8fff6')]
NECK = V((0, .62, 0)); SHOULDER = V((.26, .53, .02))
WHEEL = V((0, .40, .62)); WHEEL_R = .2; WHEEL_TILT = 50  # steering wheel centre relative to the hips (unscaled)
CS = 1.15  # characters are authored at 1.0 then scaled; the wheel offset scales with them
HAND = V((.2, WHEEL.y + .03, WHEEL.z - .05))

def eyes(g, c, R, yaw=25, pitch=6, size=1., look=(0, 0), lid=None):
    for k in (1, -1):
        p, n = on_ell(c, R, k * yaw, pitch)
        up = V((0, 1, 0))
        g.add(sphere(14, 8), EYE_W, frame(p - n * .01, n, up, (.092 * size, .118 * size, .05)))
        q, n2 = on_ell(c, R, k * yaw - k * 2 + look[0], pitch - 2 + look[1])
        g.add(sphere(12, 6), EYE_D, frame(q + n2 * .028, n2, up, (.066 * size, .088 * size, .03)))
        gp, gn = on_ell(c, R, k * yaw - k * 5 + look[0] + 4, pitch + 3 + look[1])
        g.add(sphere(6, 4), GLINT, frame(gp + gn * .05, gn, up, (.022 * size, .026 * size, .012)))
        if lid:  # brow: short arc above the eye
            pts = [on_ell(c, R, k * (yaw + d * 13), pitch + 14 * size - abs(d) * 3 + (k * d) * lid)[0] for d in (-1, -.5, 0, .5, 1)]
            nrm = [on_ell(c, R, k * (yaw + d * 13), pitch + 14 * size)[1] for d in (-1, -.5, 0, .5, 1)]
            g.add(tube([p_ + n_ * .012 for p_, n_ in zip(pts, nrm)], .016, 6), lid_mat[0])
lid_mat = [NOSE]

def mouth(g, c, R, pitch, width=22, curve=4, rad=.012, material=NOSE):
    pts = [on_ell(c, R, u * width, pitch - (1 - u * u) * curve) for u in (-1, -.6, -.2, .2, .6, 1)]
    g.add(tube([p + n * .006 for p, n in pts], rad, 6), material)

def ear_round(g, fur, inner, c, R, yaw, pitch, r=.12, tilt=18):
    for k in (1, -1):
        p, n = on_ell(c, R, k * yaw, pitch)
        d = V((k * math.sin(math.radians(tilt)), .25, 1)).normalized()
        g.add(sphere(16, 8), fur, frame(p + n * r * .45, d, (0, 1, 0), (r, r, r * .5)))
        g.add(sphere(12, 6), inner, frame(p + n * r * .45 + d * r * .28, d, (0, 1, 0), (r * .62, r * .62, r * .28)))

def ear_point(g, fur, inner, c, R, yaw, pitch, r=.13, h=.3, out=16, back=0, tip=None, flat=.42):
    for k in (1, -1):
        p, n = on_ell(c, R, k * yaw, pitch)
        ax = (V((0, 1, 0)) + V((k * math.sin(math.radians(out)), 0, -math.sin(math.radians(back))))).normalized()
        B = Matrix((V((0, 0, 1)).cross(ax).normalized(), ax, V((0, 0, 1)).cross(ax).normalized().cross(ax))).transposed().to_4x4()
        B.translation = p - ax * .04
        cone = lathe([(0, 0), (r, .02), (r * .85, h * .35), (r * .45, h * .72), (0, h)], 12)
        g.add(cone, fur, B @ xf(s=(1, 1, flat)))
        g.add(lathe([(0, .05), (r * .62, .07), (r * .5, h * .38), (r * .22, h * .7), (0, h * .86)], 10), inner, B @ xf((0, 0, -r * flat * .45), s=(1, 1, .35)))
        if tip: g.add(lathe([(0, h * .6), (r * .47, h * .62), (r * .3, h * .82), (0, h * 1.015)], 10), tip, B @ xf(s=(1.06, 1, flat * 1.08)))

def arms(parts, fur, weight, flipper=False):
    for k, key in ((1, 'arm_l'), (-1, 'arm_r')):
        g = parts[key]; s = V((k * SHOULDER.x, SHOULDER.y, SHOULDER.z)); h = V((k * HAND.x, HAND.y, HAND.z))
        mid = (s + h) / 2 + V((k * .07, -.09, -.02))
        r0 = .085 if weight == 'heavy' else .074
        if flipper:
            g.add(tube(spline([s, mid, h], 3), lambda u: .09 - .03 * u, 8, flat=.45, up=(k, 0, 0)), fur)
        else:
            g.add(tube(spline([s, mid, h], 3), lambda u: r0 - .012 * u, 8), fur)
            g.add(sphere(12, 7), GLOVE, xf(h + V((0, .01, .01)), (0, 0, 0), (.088, .08, .1)))
            g.add(tube([h - (h - mid).normalized() * .02, h - (h - mid).normalized() * .1], .07, 8), GLOVE)  # cuff

def legs(g, fur, foot, w):
    for k in (1, -1):
        hip, knee, ank = V((k * .13 * w, .04, .05)), V((k * .16 * w, .1, .36)), V((k * .17 * w, -.08, .52))
        g.add(tube(spline([hip, knee, ank], 2), .085, 6), fur)
        g.add(sphere(10, 5), foot, xf(ank + V((0, -.04, .07)), (0, 0, 0), (.1, .07, .14)))

def character(i):
    name, sp, weight, col, acc = CHARS[i]
    fur, accm = mat(f'char{i}_fur', col, 0, .6), mat(f'char{i}_accent', acc, 0, .6)
    dark = mat(f'char{i}_dark', shade(col, .45), 0, .6)
    lid_mat[0] = dark
    P = {k: Geo() for k in ('body', 'head', 'arm_l', 'arm_r')}
    b, h = P['body'], P['head']
    w = {'light': .94, 'medium': 1., 'heavy': 1.13}[weight]
    HC, R = NECK + V((0, .33, .03)), (.40, .36, .36)
    # --- torso (shared silhouette: soft pear) + belly patch
    torso_c, torso_r = V((0, .27, -.01)), (.29 * w, .35, .265 * w)
    ell(b, fur, torso_c, torso_r, seg=20, rings=11)
    belly = lambda m=accm, s=1.: ell(b, m, (0, .24, .075 * w), (.205 * w * s, .25 * s, .2 * w), seg=16, rings=8)
    legs(b, fur, accm, w)
    arms(P, fur, weight, flipper=False)

    if sp == 'hamster':
        R = (.42, .37, .37); HC = NECK + V((0, .31, .03))
        ell(h, fur, HC, R, seg=24, rings=14)
        for k in (1, -1):  # chubby cheek pouches: widen the head so they read from behind too
            p, n = on_ell(HC, R, k * 62, -22); ell(h, accm, p - n * .06, (.19, .17, .19), seg=16, rings=8)
            p, n = on_ell(HC, R, k * 44, -12); ell(h, BLUSH, p + n * .06, (.06, .04, .02), rot=(0, k * 44, 0), seg=10, rings=5)
        p, n = on_ell(HC, R, 0, -18); ell(h, accm, p - n * .03, (.17, .12, .1), seg=16, rings=8)  # muzzle
        p, n = on_ell(HC, R, 0, -6); h.add(sphere(10, 6), PINK, frame(p + n * .07, n, (0, 1, 0), (.045, .033, .03)))
        p, n = on_ell(HC, R, 0, -30); h.add(rbox(.035, .04, .012, .01, 2), TOOTH, frame(p + n * .065 + V((0, -.01, 0)), n, (0, 1, 0)))
        mouth(h, HC, (R[0] + .06, R[1], R[2] + .08), -22, 12, 3)
        ear_round(h, fur, PINK, HC, R, 48, 52, .115, 26)
        for k, a in ((0, 0), (1, 16), (-1, -16)):  # hair tuft
            p, n = on_ell(HC, R, a * .5 - 8, 88 - abs(a)); h.add(lathe([(0, 0), (.045, .01), (0, .12)], 8), fur, frame(p - n * .02, n + V((k * .3, 0, .4)), (0, 0, 1)) @ xf(rot=(90, 0, 0)))
        belly()
        eyes(h, HC, R, 24, 8, 1.02, lid=4)
        strap = [on_ell(HC, (R[0] * 1.02, R[1] * 1.02, R[2] * 1.02), a, 36 - 22 * math.cos(math.radians(a))) for a in range(20, 341, 20)]
        h.add(tube([p for p, n in strap], .032, 6, flat=.45, up=(0, 1, 0)), NOSE)   # goggle strap reads from behind
        for k in (1, -1):
            p, n = on_ell(HC, R, k * 21, 48)
            h.add(lathe([(.075, -.02), (.085, .02), (.085, .05), (.072, .06), (0, .055)], 12), GOLD, frame(p - n * .01, n, (0, 1, 0)) @ xf(rot=(90, 0, 0)))
            h.add(sphere(12, 6), GLASS, frame(p + n * .055, n, (0, 1, 0), (.068, .068, .02)))
    elif sp == 'fox':
        R = (.38, .345, .34)
        ell(h, fur, HC, R, seg=24, rings=14)
        ell(h, accm, HC + V((0, -.13, .17)), (.28, .17, .22), seg=18, rings=9)   # white cheek mask
        h.add(lathe([(0, -.02), (.15, .0), (.13, .12), (.085, .22), (0, .31)], 14), fur, xf(HC + V((0, -.06, .22)), (90, 0, 0), (1, .9, .78)))  # snout
        h.add(lathe([(0, -.02), (.13, .0), (.11, .12), (.07, .2), (0, .28)], 12), accm, xf(HC + V((0, -.1, .22)), (84, 0, 0), (.96, .9, .62)))
        ell(h, NOSE, HC + V((0, -.02, .53)), (.055, .042, .045), seg=12, rings=6)
        mouth(h, HC + V((0, -.03, .02)), (R[0] + .02, R[1], R[2] + .14), -28, 14, 4)
        ear_point(h, fur, accm, HC, R, 36, 58, .15, .36, 18, 4, tip=NOSE)
        belly()
        eyes(h, HC, R, 30, 10, .98, lid=-5)
        tail = spline([(0, .2, -.2), (.04, .28, -.5), (.14, .6, -.72), (.26, 1.0, -.66), (.3, 1.2, -.46)], 6)
        cut = int(len(tail) * .72)
        prof = lambda u: .07 + .17 * math.sin(math.pi * min(1, u * 1.1)) ** .7
        b.add(tube(tail[:cut + 1], lambda u: prof(u * cut / (len(tail) - 1)), 12), fur)
        b.add(tube(tail[cut - 1:], lambda u: 1.04 * prof((cut - 1 + u * (len(tail) - cut)) / (len(tail) - 1)), 12), accm)
    elif sp == 'bear':
        R = (.43, .385, .375); HC = NECK + V((0, .33, .02))
        ell(h, fur, HC, R, seg=24, rings=14)
        ell(h, accm, HC + V((0, -.12, .28)), (.2, .15, .15), seg=16, rings=8)
        ell(h, NOSE, HC + V((0, -.05, .42)), (.08, .055, .05), seg=12, rings=6)
        mouth(h, HC + V((0, -.12, .28)), (.21, .15, .16), -30, 30, 5)
        ear_round(h, fur, accm, HC, R, 44, 48, .135, 16)
        for k in (1, -1):
            p, n = on_ell(HC, R, k * 44, -14); ell(h, BLUSH, p + n * .004, (.07, .045, .02), rot=(0, k * 44, 0), seg=10, rings=5)
        belly(s=1.05)
        eyes(h, HC, R, 25, 9, .95, lid=-3)
        cap = mat('cap_blue', '#2f6fe4', 0, .55)
        CR = (R[0] * 1.05, R[1] * 1.06, R[2] * 1.05)
        rings = [[on_ell((0, 0, 0), CR, a, pt)[0] for a in range(0, 360, 18)] for pt in (74, 56, 38, 24)]
        h.add(loft(rings, (0, CR[1], 0), (0, CR[1] * .3, 0)), cap, xf(HC + V((0, .01, -.02)), (-14, 0, 0)))  # backwards cap
        h.add(rbox(.2, .018, .16, .016, 1), cap, xf(HC + V((0, .1, -.44)), (-16, 0, 0)))             # brim over the neck
        ell(h, WHITE, HC + V((0, CR[1] + .005, -.08)), (.04, .025, .04), seg=8, rings=4)
    elif sp == 'frog':
        R = (.47, .31, .38); HC = NECK + V((0, .25, .04))
        ell(h, fur, HC, R, seg=28, rings=14)
        ell(h, accm, HC + V((0, -.12, .06)), (.43, .19, .33), seg=22, rings=10)  # pale jaw
        for k in (1, -1):  # periscope eyes: green domes with the eye on their face
            ec = HC + V((k * .2, .24, .12)); ER = (.15, .15, .15)
            ell(h, fur, ec, ER, seg=18, rings=10)
            p, n = on_ell(ec, ER, k * 12, 4)
            h.add(sphere(14, 8), EYE_W, frame(p - n * .02, n, (0, 1, 0), (.105, .115, .05)))
            q, n2 = on_ell(ec, ER, k * 8, 2); h.add(sphere(12, 6), EYE_D, frame(q + n2 * .015, n2, (0, 1, 0), (.07, .085, .03)))
            g_, gn = on_ell(ec, ER, k * 4 + 4, 12); h.add(sphere(8, 4), GLINT, frame(g_ + gn * .04, gn, (0, 1, 0), (.022, .026, .012)))
            p, n = on_ell(HC, R, k * 46, -8); ell(h, BLUSH, p + n * .004, (.075, .045, .02), rot=(0, k * 46, 0), seg=10, rings=5)
        mouth(h, HC, (R[0] + .004, R[1], R[2] + .004), -6, 40, 6, .016)
        belly(accm, 1.02)
    elif sp == 'cat':
        R = (.4, .35, .35)
        ell(h, fur, HC, R, seg=24, rings=14)
        for k in (1, -1): ell(h, accm, HC + V((k * .075, -.13, .28)), (.1, .08, .08), seg=12, rings=6)
        h.add(lathe([(0, 0), (.04, .0), (0, -.04)], 6), PINK, xf(HC + V((0, -.08, .355)), (0, 0, 0), (1, 1, .8)))
        ell(h, PINK, HC + V((0, -.085, .35)), (.04, .026, .025), seg=10, rings=5)
        for k in (1, -1):
            for dy, dz in ((.0, 0), (-.035, 6)):
                p0 = HC + V((k * .16, -.12 + dy, .27)); h.add(tube([p0, p0 + V((k * .15, .01 - dz * .006, -.03)), p0 + V((k * .28, 0 - dz * .012, -.07))], .007, 5), accm)
        ear_point(h, fur, PINK, HC, R, 40, 52, .16, .26, 20, 2)
        pts = [on_ell(HC, R, a, 50 + abs(a) * .1)[0] for a in (-18, -14, -8, 0, 8, 12)]
        crescent = [on_ell(HC, R, 13 * math.cos(t), 48 + 15 * math.sin(t)) for t in [math.radians(a) for a in range(-100, 101, 25)]]
        h.add(tube([p + n * .008 for p, n in crescent], lambda u: .012 + .03 * math.sin(math.pi * u), 8, flat=.35, up=(0, 0, 1)), MOON)
        belly()
        eyes(h, HC, R, 26, 7, 1.02, lid=5)
        mouth(h, HC + V((0, -.02, 0)), (R[0], R[1], R[2] + .03), -27, 12, 3)
        b.add(tube(spline([(0, .15, -.22), (-.04, .2, -.5), (-.08, .55, -.62), (-.02, .95, -.58), (.12, 1.1, -.48), (.18, 1.02, -.36)], 6), lambda u: .06 - .015 * u, 10), fur)
    elif sp == 'penguin':
        R = (.39, .37, .36); HC = NECK + V((0, .3, .02))
        ell(h, fur, HC, R, seg=24, rings=14)
        for k in (1, -1): ell(h, accm, HC + V((k * .12, -.03, .17)), (.19, .24, .22), seg=18, rings=10)   # heart face mask
        h.add(lathe([(0, 0), (.1, .01), (.08, .08), (0, .2)], 12), BEAK, xf(HC + V((0, -.08, .3)), (90, 0, 0), (1.25, 1, .7)))
        for a, s in ((-14, .19), (0, .24), (14, .17)):  # yellow crest feathers flicking back
            p, n = on_ell(HC, R, a, 62)
            h.add(tube(spline([p - n * .03, p + n * .1 + V((a * .004, .02, -.05)), p + n * s + V((a * .008, 0, -.16))], 4), lambda u: .035 * (1 - u) + .006, 7), GOLD)
        belly(accm, 1.12)
        eyes(h, HC, R, 23, 6, .95, lid=-2)
        for k in (1, -1): ell(h, BLUSH, HC + V((k * .24, -.13, .25)), (.055, .035, .02), rot=(0, k * 44, 0), seg=10, rings=5)
        b.add(revolve([(.27 + .05 * math.cos(a), .62 + .05 * math.sin(a)) for a in ang(8)], 24), SCARF)
        for k, lng in ((1, 1.), (-1, .8)):
            b.add(tube(spline([(k * .08, .6, -.22), (k * .15, .5, -.42), (k * .25, .5 * lng + .1, -.62 * lng)], 5), .065, 8, flat=.3, up=(0, 1, .4)), SCARF)
        P['arm_l'], P['arm_r'] = Geo(), Geo(); arms(P, fur, weight, flipper=True)
    elif sp == 'bunny':
        R = (.37, .34, .34)
        ell(h, fur, HC, R, seg=24, rings=14)
        ell(h, accm, HC + V((0, -.13, .24)), (.17, .12, .12), seg=16, rings=8)
        ell(h, PINK, HC + V((0, -.07, .345)), (.045, .032, .03), seg=10, rings=6)
        h.add(rbox(.04, .045, .012, .01, 2), TOOTH, xf(HC + V((0, -.215, .33)), (-10, 0, 0)))
        for k in (1, -1):
            p, n = on_ell(HC, R, k * 44, -14); ell(h, BLUSH, p + n * .004, (.065, .04, .02), rot=(0, k * 44, 0), seg=10, rings=5)
        for k, flop in ((1, 0.), (-1, 1.)):  # one tall ear, one flopped over at the tip
            base = HC + V((k * .14, .28, -.03))
            ctrl = [base, base + V((k * .05, .25, -.03)), base + V((k * .07, .46, -.06))] + \
                   ([base + V((k * .2, .56, -.08)), base + V((k * .32, .48, -.06))] if flop else [base + V((k * .08, .62, -.08))])
            path = spline(ctrl, 5)
            h.add(tube(path, lambda u: .09 * math.sin(math.pi * (.15 + .85 * u)) ** .5 + .012, 10, flat=.42, up=(0, 0, 1)), fur)
            h.add(tube([p + V((0, 0, .033)) for p in path[1:-1]], lambda u: .05 * math.sin(math.pi * (.1 + .8 * u)) ** .6 + .006, 8, flat=.25, up=(0, 0, 1)), PINK)
        belly()
        eyes(h, HC, R, 25, 8, 1.04, lid=3)
        mouth(h, HC + V((0, -.02, .0)), (R[0], R[1], R[2] + .03), -30, 10, 3)
        ell(b, accm, (0, .3, -.3), (.14, .14, .12), seg=12, rings=8)  # pom-pom tail peeking over the seat
    elif sp == 'dino':
        R = (.37, .35, .37); HC = NECK + V((0, .32, .0))
        ell(h, fur, HC, R, seg=24, rings=14)
        ell(h, fur, HC + V((0, -.08, .24)), (.3, .22, .28), seg=22, rings=11)  # big rounded snout
        ell(h, accm, HC + V((0, -.2, .22)), (.27, .1, .24), seg=18, rings=8)   # pale jaw
        for k in (1, -1):
            ell(h, dark, HC + V((k * .08, -.02, .51)), (.025, .018, .015), seg=8, rings=4)  # nostrils
            for j in range(3):
                x = k * (.07 + j * .075); h.add(lathe([(0, 0), (.022, .0), (0, -.05)], 6), TOOTH, xf(HC + V((x, -.12 - j * .005, .46 - j * .07))))
            p, n = on_ell(HC, R, k * 50, -8); ell(h, BLUSH, p + n * .004, (.06, .04, .02), rot=(0, k * 50, 0), seg=10, rings=5)
        mouth(h, HC + V((0, -.08, .24)), (.305, .225, .285), -26, 34, 3, .013)
        eyes(h, HC, R, 30, 16, .95, lid=-6)
        crest = [(HC, R, 0, 72, .15), (HC, R, 180, 88, .21), (HC, R, 180, 62, .24), (HC, R, 180, 36, .21), (HC, R, 180, 12, .16)]
        for c_, R_, yaw, pitch, s in crest:
            p, n = on_ell(c_, R_, yaw, pitch); h.add(lathe([(0, 0), (s * .55, .01), (s * .3, s * .7), (0, s * 1.2)], 8), SPIKE, frame(p - n * .03, n, (0, 0, 1)) @ xf(rot=(90, 0, 0), s=(.5, 1, 1)))
        for pitch, s in ((62, .2), (34, .2), (6, .16)):  # dorsal plates down the back
            p, n = on_ell(torso_c, torso_r, 180, pitch); b.add(lathe([(0, 0), (s * .55, .01), (s * .3, s * .7), (0, s * 1.2)], 8), SPIKE, frame(p - n * .03, n, (0, 0, 1)) @ xf(rot=(90, 0, 0), s=(.5, 1, 1)))
        tail = spline([(0, .12, -.15), (.02, .2, -.5), (.1, .48, -.78), (.24, .86, -.88)], 6)
        b.add(tube(tail, lambda u: .17 * (1 - u) + .03, 12), fur)
        for u in (.35, .6, .85):
            j = int(u * (len(tail) - 1)); p = tail[j]; t = (tail[j + 1] - tail[j - 1]).normalized(); n = V((0, 1, 0)) - t * t.y
            s = .13 * (1.1 - u); b.add(lathe([(0, 0), (s * .55, .01), (s * .3, s * .7), (0, s * 1.2)], 8), SPIKE, frame(p + n.normalized() * (.17 * (1 - u) + .01), n, (0, 0, 1)) @ xf(rot=(90, 0, 0), s=(.5, 1, 1)))
        belly(s=1.05)
    return P

# ---------------------------------------------------------------- karts
def tyre(g, r, w, knobs=0, seg=20, rim=CHROME, hub=PAINT, rim_frac=.62, side=1):
    """Wheel built around the X axis at the origin: rounded tyre, dished rim, painted hub cap. r includes tread knobs."""
    r -= .04 if knobs else 0
    ri, c = r * rim_frac, min(w * .32, r * .3)
    q = c * (1 - math.sqrt(.5))
    prof = [(ri, -w / 2 + .01), (r - c, -w / 2), (r - q, -w / 2 + q), (r, -w / 2 + c), (r, w / 2 - c), (r - q, w / 2 - q), (r - c, w / 2), (ri, w / 2 - .01)]
    R = xf(rot=(0, 0, 90))  # lathe axis Y -> X
    g.add(revolve(prof, seg), RUBBER, R)
    seg = 16
    face = side * w / 2
    g.add(lathe([(0, face * .1), (ri * .98, face * .2), (ri * 1.02, face * .78), (ri * .8, face * .9), (ri * .5, face * .74), (0, face * .8)], seg), rim, R)
    g.add(lathe([(ri * .38, face * .7), (ri * .34, face * .98), (ri * .18, face * 1.07), (0, face * 1.09)], 12), hub, R)
    for j in range(knobs):
        a = 2 * math.pi * j / knobs
        g.add(box(w * .36, .04, .075), RUBBER, xf((0, math.cos(a) * r, math.sin(a) * r), (-math.degrees(a), 0, 0)) @ xf((((j % 2) - .5) * w * .22, 0, 0)), smooth=False)

def steering_wheel(g):  # local to the tilted pivot: wheel in the XY plane, column along +Z
    g.add(revolve([(WHEEL_R + .028 * math.cos(a), .028 * math.sin(a)) for a in ang(6)], 16), TRIM, xf(rot=(90, 0, 0)))
    for a in (90, 210, 330):
        d = V((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        g.add(tube([d * .04, d * (WHEEL_R - .01)], .018, 6, caps=False), TRIM)
    g.add(lathe([(0, .03), (.06, .025), (.065, -.02), (0, -.03)], 10), PAINT, xf(rot=(90, 0, 0)))
    g.add(box(.014, .03, .014), GOLD, xf((0, WHEEL_R, 0)), smooth=False)  # top-dead-centre marker

KARTS = {
    'zoomer': dict(front=(.86, .38, .32, .98), rear=(.88, .46, .42, -.92), seat=(0, .50, -.2)),
    'bolt': dict(front=(.89, .37, .30, 1.0), rear=(.9, .42, .36, -.95), seat=(0, .44, -.24)),
    'tank': dict(front=(.84, .50, .48, .95), rear=(.84, .52, .50, -.92), seat=(0, .64, -.14)),
}

def kart_zoomer(g, seat):
    g.add(body_loft([(-1.22, .22, .6, .4), (-.95, .18, .66, .5), (-.5, .16, .6, .55), (.1, .16, .56, .54),
                     (.6, .17, .6, .46), (1.05, .19, .5, .38), (1.34, .23, .41, .28), (1.47, .27, .36, .14)], 24, 3.2, .82), PAINT)
    for dx in (.1, -.1): g.add(body_loft([(.3, .54, .597, .022), (.6, .56, .618, .022), (1.05, .46, .517, .022), (1.34, .37, .427, .02), (1.44, .32, .39, .015)], 6, 4), WHITE, xf((dx * (1 if dx > 0 else 1), 0, 0)))
    ell(g, PAINT, (0, .64, .6), (.36, .17, .34), seg=14, rings=7)            # dash hump
    for k in (1, -1):
        g.add(rbox(.16, .14, .5, .1, 1), PAINT, xf((k * .66, .34, .08), (0, k * -3, 0)))       # side pods
        g.add(rbox(.17, .05, .52, .04, 1), TRIM, xf((k * .67, .2, .08)))
        g.add(tube([(k * .3, .36, .98), (k * .74, .38, .98)], .045, 6), TRIM)                # front axle arms
        g.add(tube([(k * .2, .44, -.92), (k * .74, .46, -.92)], .05, 6), TRIM)
        g.add(tube([(k * .17, .62, -1.08), (k * .22, .6, -1.28), (k * .23, .6, -1.44)], .055, 8), CHROME)  # exhausts
        g.add(tube([(k * .3, .7, -1.12), (k * .32, .86, -1.3)], .03, 6), TRIM)             # wing struts
        g.add(rbox(.025, .13, .19, .02, 1), TRIM, xf((k * .79, .9, -1.34)))                  # end plates
        ell(g, TAIL, (k * .3, .5, -1.22), (.06, .04, .02), seg=8, rings=4)
    g.add(tube(spline([(.78, .24, 1.2), (.55, .22, 1.5), (0, .22, 1.56), (-.55, .22, 1.5), (-.78, .24, 1.2)], 3), .055, 6), TRIM)
    g.add(tube(spline([(.9, .3, -1.18), (.75, .28, -1.46), (0, .28, -1.5), (-.75, .28, -1.46), (-.9, .3, -1.18)], 3), .055, 6), TRIM)
    g.add(rbox(.26, .16, .18, .08, 1), TRIM, xf((0, .64, -1.08)))                            # engine
    for j in range(2): g.add(rbox(.27, .012, .15, .01, 1), CHROME, xf((0, .74 + j * .05, -1.08)))
    g.add(rbox(.78, .032, .18, .028, 2), PAINT, xf((0, .9, -1.34), (-8, 0, 0)))                # spoiler
    g.add(rbox(.78, .01, .045, .008, 1), WHITE, xf((0, .934, -1.27), (-8, 0, 0)))
    seat_back(g, seat)
    column(g, seat, (0, .7, .62))

def seat_back(g, seat, h=.52):
    s = V(seat)
    g.add(rbox(.34, h / 2, .07, .065, 2), SEAT, xf(s + V((0, h / 2 + .02, -.4)), (-12, 0, 0)))
    for k in (1, -1): ell(g, SEAT, s + V((k * .33, h * .3, -.3)), (.06, h * .3, .15), (-12, 0, 0), 8, 5)  # bucket bolsters
    g.add(rbox(.3, .06, .22, .05, 1), SEAT, xf(s + V((0, -.04, -.12))))

def column(g, seat, dash):
    wc = V(seat) + WHEEL * CS; d = V((0, -math.sin(math.radians(WHEEL_TILT)), math.cos(math.radians(WHEEL_TILT))))
    g.add(tube([wc + d * .03, wc + d * (V(dash) - wc).length], .028, 8), TRIM)

def kart_bolt(g, seat):
    g.add(body_loft([(-1.36, .22, .6, .36), (-1.0, .16, .64, .5), (-.5, .13, .56, .56), (0, .12, .5, .56), (.45, .12, .45, .5),
                     (.9, .13, .36, .38), (1.3, .14, .27, .25), (1.55, .16, .21, .13), (1.64, .17, .19, .04)], 24, 3.2, .7), PAINT)
    ell(g, PAINT, (0, .5, .66), (.27, .11, .38), (-6, 0, 0), 14, 7)                          # aero cowl
    ell(g, TRIM, (0, .56, .9), (.1, .03, .12), (-14, 0, 0), 8, 4)                              # cowl vent
    g.add(rbox(.78, .022, .13, .02, 1), PAINT, xf((0, .2, 1.46), (-4, 0, 0)))                  # front wing
    g.add(rbox(.76, .03, .19, .025, 2), PAINT, xf((0, .98, -1.28), (-10, 0, 0)))                # rear wing
    g.add(rbox(.77, .01, .045, .008, 1), WHITE, xf((0, 1.013, -1.19), (-10, 0, 0)))
    g.add(rbox(.05, .2, .09, .04, 1), TRIM, xf((0, .78, -1.22)))                                # wing pylon
    g.add(body_loft([(-1.0, .5, .72, .19), (-.8, .52, .82, .19), (-.6, .52, .74, .15), (-.46, .5, .6, .07)], 12, 2.5), PAINT)  # headrest fin
    for dx in (.12, -.12): g.add(body_loft([(-.3, .42, .47, .025), (.6, .4, .455, .025), (1.3, .23, .285, .02), (1.58, .17, .23, .015)], 6, 4), WHITE, xf((dx, 0, 0)))
    for k in (1, -1):
        g.add(rbox(.02, .08, .16, .018, 1), TRIM, xf((k * .79, .24, 1.46)))                     # front wing plates
        g.add(body_loft([(-.62, .16, .32, .1), (-.4, .15, .46, .17), (.2, .15, .44, .17), (.55, .17, .34, .12), (.72, .2, .28, .03)], 12, 3), PAINT, xf((k * .6, 0, 0)))  # sidepods
        ell(g, TRIM, (k * .6, .33, .66), (.1, .06, .03), seg=10, rings=5)                         # intakes
        zig = [(-.42, .44), (-.02, .35), (-.1, .31), (.34, .21), (-.03, .27), (.04, .31)]         # lightning-bolt decal
        g.add(tube([(k * .775, y - .02, z) for z, y in zig], .022, 4, flat=.45, up=(1, 0, 0)), WHITE)
        g.add(tube([(k * .12, .42, -1.22), (k * .13, .42, -1.46)], .06, 8), CHROME)              # twin exhausts
        g.add(rbox(.02, .16, .22, .02, 1), PAINT, xf((k * .74, .9, -1.28), (-6, 0, 0)))           # wing plates
        ell(g, TAIL, (k * .28, .44, -1.33), (.12, .03, .02), seg=8, rings=4)
        g.add(tube([(k * .45, .4, .98), (k * .76, .37, 1.0)], .035, 6), TRIM)                    # suspension arms
        g.add(tube([(k * .45, .4, -.95), (k * .76, .42, -.95)], .04, 6), TRIM)
    seat_back(g, seat, .44)
    column(g, seat, (0, .56, .66))

def kart_tank(g, seat):
    g.add(body_loft([(-1.3, .4, .9, .5), (-.85, .36, .92, .56), (-.55, .34, .78, .58), (.1, .34, .76, .58), (.45, .36, .88, .56),
                     (1.1, .38, .86, .52), (1.38, .42, .78, .45), (1.48, .48, .72, .32)], 24, 5, .9), PAINT)
    g.add(box(.6, .08, 1.3), TRIM, xf((0, .34, .05)), smooth=False)                            # skid chassis
    g.add(rbox(.3, .05, .28, .04, 1), TRIM, xf((0, .9, .86), (4, 0, 0)))                        # hood scoop
    g.add(rbox(.5, .03, .06, .02, 1), WHITE, xf((0, .9, -1.29)))                                # tail stripe
    g.add(rbox(.3, .06, .05, .03, 1), TRIM, xf((0, 1.7, -.69)))                                 # light bar
    g.add(box(.2, .09, .03), TRIM, xf((0, .6, 1.475)), smooth=False)                           # grille
    g.add(tube(spline([(.5, .78, -.64), (.46, 1.45, -.68), (.3, 1.64, -.7), (-.3, 1.64, -.7), (-.46, 1.45, -.68), (-.5, .78, -.64)], 2), .055, 8), TRIM)  # roll hoop
    g.add(tube(spline([(.42, .44, 1.34), (.44, .46, 1.6), (.44, .84, 1.62), (-.44, .84, 1.62), (-.44, .46, 1.6), (-.42, .44, 1.34)], 2), .045, 6), CHROME)  # bull bar
    g.add(tube([(.44, .62, 1.61), (-.44, .62, 1.61)], .035, 6), CHROME)
    for k in (1, -1):
        ell(g, LAMP, (k * .3, .72, 1.47), (.1, .1, .045), seg=10, rings=5)                        # headlights
        ell(g, LAMP, (k * .17, 1.7, -.64), (.07, .06, .03), seg=8, rings=4)                        # light-bar lamps
        g.add(rbox(.1, .16, .36, .06, 1), PAINT, xf((k * .6, .64, 0)))                              # door panels
        for z in (.95, -.92):  # wide painted mudguards over the fat tyres
            arc = [V((k * .84, .5 + .62 * math.sin(t), z + .62 * math.cos(t))) for t in (math.radians(x) for x in range(28, 153, 20))]
            g.add(tube(arc, .25, 8, flat=.24, up=(0, math.sin(math.radians(20)), math.cos(math.radians(20)))), PAINT)
        g.add(tube([(k * .44, 1.45, -.68), (k * .38, .92, -1.25)], .04, 6), TRIM)                # braces
        g.add(tube([(k * .45, .98, -1.1), (k * .48, 1.34, -1.14), (k * .48, 1.38, -1.32)], .06, 8), CHROME)  # stacks
        ell(g, TAIL, (k * .36, .72, -1.31), (.09, .05, .02), seg=8, rings=4)
        for z in (.95, -.92): g.add(tube([(k * .2, .5, z), (k * .7, .5, z)], .06, 6, caps=False), TRIM)  # axles
    seat_back(g, seat, .56)
    column(g, seat, (0, .82, .62))

def kart(kid):
    spec = KARTS[kid]; seat = V(spec['seat'])
    root = empty(f'kart_{kid}', None)
    body = Geo(); {'zoomer': kart_zoomer, 'bolt': kart_bolt, 'tank': kart_tank}[kid](body, seat)
    mesh(f'kart_{kid}_body', body, root)
    for tag, (x, r, w, z) in (('f', spec['front']), ('r', spec['rear'])):
        for k, side in ((1, 'l'), (-1, 'r')):
            c = V((k * x, r, z)); g = Geo()
            tyre(g, r, w, knobs=10 if kid == 'tank' else 0, seg=18 if kid == 'tank' else 20, rim=CHROME if kid != 'bolt' else TRIM, rim_frac=.72 if kid == 'bolt' else .6, side=k)
            g.v = [p + c for p in g.v]
            parent = empty(f'kart_{kid}_steer_{tag}{side}', root, c) if tag == 'f' else root
            mesh(f'kart_{kid}_wheel_{tag}{side}', g, parent, c)
    sw = Geo(); steering_wheel(sw); sw.v = [p * CS for p in sw.v]
    mesh(f'kart_{kid}_steering', sw, root, seat + WHEEL * CS, tilt=WHEEL_TILT)
    empty(f'kart_{kid}_seat', root, seat)
    ex = {'zoomer': (.23, .6, -1.5), 'bolt': (.125, .42, -1.53), 'tank': (.48, 1.38, -1.4)}[kid]
    for k, side in ((1, 'l'), (-1, 'r')): empty(f'kart_{kid}_exhaust_{side}', root, (k * ex[0], ex[1], ex[2]))
    return root

def char_node(i):
    root = empty(f'char_{i}', None); P = character(i)
    for g in P.values(): g.v = [p * CS for p in g.v]
    mesh(f'char_{i}_body', P['body'], root)
    mesh(f'char_{i}_head', P['head'], root, NECK * CS)
    mesh(f'char_{i}_arm_l', P['arm_l'], root, SHOULDER * CS)
    mesh(f'char_{i}_arm_r', P['arm_r'], root, V((-SHOULDER.x, SHOULDER.y, SHOULDER.z)) * CS)
    return root

# ---------------------------------------------------------------- build, save, export, verify
roots = [kart(k) for k in KARTS] + [char_node(i) for i in range(8)]
print('TRIS', json.dumps(TRI))
over = {k: v for k, v in TRI.items() if v > 6000}
assert not over, f'triangle budget exceeded: {over}'
(GAME / 'art/karts').mkdir(parents=True, exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(GAME / 'art/karts/karts.blend'))
OUT.mkdir(parents=True, exist_ok=True)
glb = OUT / 'karts.glb'
bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', export_yup=True, export_apply=True, export_cameras=False,
                          export_lights=False, export_texcoords=False, export_normals=True, export_materials='EXPORT', export_animations=False)
size = glb.stat().st_size
assert size <= 5 * 1024 * 1024, f'karts.glb too large: {size}'

bpy.ops.wm.read_factory_settings(use_empty=True)   # prove the shipped file, not the scene
bpy.ops.import_scene.gltf(filepath=str(glb))
need = []
for k in KARTS:
    need += [f'kart_{k}', f'kart_{k}_body', f'kart_{k}_steering', f'kart_{k}_seat', f'kart_{k}_exhaust_l', f'kart_{k}_exhaust_r']
    need += [f'kart_{k}_steer_f{s}' for s in 'lr'] + [f'kart_{k}_wheel_{w}' for w in ('fl', 'fr', 'rl', 'rr')]
for i in range(8): need += [f'char_{i}', f'char_{i}_body', f'char_{i}_head', f'char_{i}_arm_l', f'char_{i}_arm_r']
missing = [n for n in need if n not in bpy.data.objects]
assert not missing, f'missing nodes after reimport: {missing}'
assert 'kart_paint' in bpy.data.materials, 'kart_paint material missing'
for k in KARTS:
    for s in 'lr': assert bpy.data.objects[f'kart_{k}_wheel_f{s}'].parent.name == f'kart_{k}_steer_f{s}'
print('ASSET_REPORT nodes ok', len(need), 'bytes', size)
if '--no-render' in ARGS: sys.exit(0)

# ---------------------------------------------------------------- previews (rendered from the re-imported GLB)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e: print('GPU unavailable, CPU render', e)
scene.cycles.samples = 64; scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX'
for look in ('AgX - Punchy', 'Punchy'):
    try: scene.view_settings.look = look; break
    except Exception: pass
world = bpy.data.worlds.new('studio'); scene.world = world
try: world.use_nodes = True
except Exception: pass
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = (.62, .68, .8, 1); bg.inputs[1].default_value = .55

def G(p): return V((p[0], -p[2], p[1]))
def aim(ob, target): ob.rotation_euler = (G(target) - ob.location).to_track_quat('-Z', 'Y').to_euler()
for pos, energy, size_, col in (((3.5, 5, 4.5), 700, 4, (1, .96, .9)), ((-5, 3, 2.5), 280, 5, (.85, .92, 1)), ((-1.5, 4, -5), 500, 3, (1, 1, 1))):
    ld = bpy.data.lights.new('l', 'AREA'); ld.energy = energy; ld.size = size_; ld.color = col
    lo = bpy.data.objects.new('light', ld); scene.collection.objects.link(lo); lo.location = G(pos); aim(lo, (0, .8, 0))
bpy.ops.mesh.primitive_plane_add(size=30); floor = bpy.context.object; floor.is_shadow_catcher = True
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 50

roots = {o.name: o for o in bpy.data.objects if o.parent is None and (o.name.startswith('kart_') or o.name.startswith('char_'))}
def show(*names):
    keep = set()
    for n in names: keep |= {roots[n]} | set(roots[n].children_recursive)
    for o in bpy.data.objects:
        if o.type == 'MESH' and o is not floor: o.hide_render = o not in keep
def seat_on(kart_name, char_name, offset=(0, 0, 0)):
    roots[kart_name].location = G(offset)
    bpy.context.view_layer.update()
    roots[char_name].location = bpy.data.objects[kart_name + '_seat'].matrix_world.translation
paint = next(n for n in bpy.data.materials['kart_paint'].node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color']
def shot(path, res=(256, 256), cam_pos=(3.9, 2.7, 5.0), target=(0, .75, 0), lens=50):
    scene.render.resolution_x, scene.render.resolution_y = res; cam.location = G(cam_pos); aim(cam, target); cam.data.lens = lens
    scene.render.filepath = str(path); bpy.ops.render.render(write_still=True)

PREV.mkdir(parents=True, exist_ok=True)
CHAR_CAM, CHAR_TGT, KART_CAM, KART_TGT = (2.5, 2.25, 3.6), (0, 1.18, .12), (3.3, 2.2, 4.1), (.12, .4, .3)
KART_PREVIEW = {'zoomer': '#e63b3b', 'bolt': '#2f7dff', 'tank': '#ffb020'}
for i in range(8):
    paint.default_value = (*lin(shade(CHARS[i][3], .95) if CHARS[i][1] != 'penguin' else '#4a8cff'), 1)
    seat_on('kart_zoomer', f'char_{i}'); show('kart_zoomer', f'char_{i}')
    shot(PREV / f'char-{i}.png', cam_pos=CHAR_CAM, target=CHAR_TGT, lens=50)
for k, c in KART_PREVIEW.items():
    paint.default_value = (*lin(c), 1); roots[f'kart_{k}'].location = (0, 0, 0); show(f'kart_{k}')
    shot(PREV / f"kart-{k}.png", cam_pos=KART_CAM, target=KART_TGT, lens=54)

def sheet(files, cols, out, cell=256):
    import numpy as np
    rows = (len(files) + cols - 1) // cols; W, H = cols * cell, rows * cell
    canvas = np.zeros((H, W, 4), np.float32); canvas[...] = (.16, .18, .23, 1)
    for n, f in enumerate(files):
        img = bpy.data.images.load(str(f)); px = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)
        r, c = n // cols, n % cols; y0 = H - (r + 1) * cell; a = px[..., 3:4]
        cellv = canvas[y0:y0 + cell, c * cell:(c + 1) * cell]; cellv[..., :3] = px[..., :3] * a + cellv[..., :3] * (1 - a)
    out_img = bpy.data.images.new('sheet', W, H, alpha=True); out_img.pixels = canvas.ravel().tolist()
    out_img.filepath_raw = str(out); out_img.file_format = 'PNG'; out_img.save()
QA.mkdir(exist_ok=True)
sheet([PREV / f'char-{i}.png' for i in range(8)] + [PREV / f'kart-{k}.png' for k in KARTS], 4, QA / 'karts-sheet.png')

if '--qa' in ARGS:  # chase-camera readability line-ups (not shipped)
    scene.cycles.samples = 32
    names = []
    for i in range(8):
        seat_on('kart_zoomer', f'char_{i}'); show('kart_zoomer', f'char_{i}')
        paint.default_value = (*lin(CHARS[i][3]), 1)
        shot(QA / f'back-{i}.png', (256, 256), (1.4, 3.2, -6.8), (0, 1.0, 0), 50); names.append(QA / f'back-{i}.png')
    for k in KARTS:
        seat_on(f'kart_{k}', 'char_1'); show(f'kart_{k}', 'char_1'); paint.default_value = (*lin(KART_PREVIEW[k]), 1)
        shot(QA / f'side-{k}.png', (256, 256), (5.2, 1.6, .4), (0, .8, 0), 50); names.append(QA / f'side-{k}.png')
        shot(QA / f'back-{k}.png', (256, 256), (1.4, 3.2, -6.8), (0, 1.0, 0), 50); names.append(QA / f'back-{k}.png')
    sheet(names, 7, QA / 'karts-qa.png')
    hero = []
    for i in range(8):
        seat_on('kart_zoomer', f'char_{i}'); show('kart_zoomer', f'char_{i}'); paint.default_value = (*lin(shade(CHARS[i][3], .95) if CHARS[i][1] != 'penguin' else '#4a8cff'), 1)
        shot(QA / f'hero-{i}.png', (384, 384), CHAR_CAM, CHAR_TGT, 50); hero.append(QA / f'hero-{i}.png')
    sheet(hero, 4, QA / 'karts-hero.png', 384)
    hk = []
    for k, c in KART_PREVIEW.items():
        paint.default_value = (*lin(c), 1); show(f'kart_{k}'); shot(QA / f'hero-{k}.png', (512, 512), KART_CAM, KART_TGT, 50); hk.append(QA / f'hero-{k}.png')
    sheet(hk, 3, QA / 'karts-hero-karts.png', 512)
    cheer = []  # finish pose: arms -2.05 rad about X, splayed 0.8 rad outward (glTF Z == Blender -Y); 0.4 clips the big heads
    for i in range(8):
        for side, k in (('l', 1), ('r', -1)): o = bpy.data.objects[f'char_{i}_arm_{side}']; o.rotation_mode = 'XYZ'; o.rotation_euler = (-2.05, k * .8, 0)
        seat_on('kart_zoomer', f'char_{i}'); show('kart_zoomer', f'char_{i}'); paint.default_value = (*lin(CHARS[i][3]), 1)
        shot(QA / f'cheer-{i}.png', (256, 256), (0.6, 2.0, 4.6), (0, 1.3, 0), 50); cheer.append(QA / f'cheer-{i}.png')
        for side in 'lr': bpy.data.objects[f'char_{i}_arm_{side}'].rotation_euler = (0, 0, 0)
    sheet(cheer, 8, QA / 'karts-cheer.png')
print('PREVIEWS_DONE')
