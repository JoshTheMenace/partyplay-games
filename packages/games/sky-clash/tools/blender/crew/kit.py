"""Sky Clash crew modelling kit (Blender 5.2, headless, CPU only). See ../../../PIPELINE.md.

A fighter script builds named Parts in character space (meters, +X the fighter's left, +Y up, +Z forward, feet at y = 0),
each with a material slot, UVs and rule-painted bone weights. The Build then packs UVs, bakes the paint and detail maps with
Cycles, rigs, exports the GLB plus assets/models/<id>.json and renders a review sheet.
"""
import bpy, bmesh, math, os, sys, json, time
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.realpath(__file__)); GAME = os.path.realpath(os.path.join(HERE, '..', '..', '..'))
ROOT = os.path.realpath(os.path.join(GAME, '..', '..', '..', '..')); OUT = os.path.join(ROOT, 'output', 'skyclash-pass', 'models')
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # character (Y up) -> Blender (Z up)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def flag(name, default=None):
    """--name value from the command line (after `--`), or a bare --name as True."""
    if f'--{name}' not in ARGS: return default
    i = ARGS.index(f'--{name}'); return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith('--') else True

# ── Math ─────────────────────────────────────────────────────────────────────
A = lambda *v: np.array(v[0] if len(v) == 1 else v, dtype=float)
def unit(v): v = A(v); n = np.linalg.norm(v); return v / n if n > 1e-12 else v
def lerp(a, b, t): return a + (b - a) * t
def smooth(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def cr(vals, t):
    """Catmull-Rom through `vals` (list of scalars or arrays) at t in [0, len - 1]."""
    n = len(vals); i = int(min(max(math.floor(t), 0), n - 2)); f = t - i
    p0, p1, p2, p3 = (np.asarray(vals[min(max(j, 0), n - 1)], dtype=float) for j in (i - 1, i, i + 1, i + 2))
    return .5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)
def rot(axis, deg):
    a = unit(axis); c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg)); x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s], [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s], [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])
def srgb(h): h = h.lstrip('#'); return tuple(((int(h[i:i + 2], 16) / 255 + .055) / 1.055) ** 2.4 if int(h[i:i + 2], 16) / 255 > .04045 else int(h[i:i + 2], 16) / 255 / 12.92 for i in (0, 2, 4))

# ── Parts ────────────────────────────────────────────────────────────────────
class Part:
    """Welded vertices, faces, per-corner UVs in the part's own 0..1 square (aspect = width / height of that square in meters)."""
    def __init__(self, verts, faces, uvs, name='part', slot='primary', aspect=1.0, density=1.0, area=None):
        self.v = np.asarray(verts, dtype=float).reshape(-1, 3); self.f = [tuple(f) for f in faces]; self.uv = [[tuple(u) for u in fu] for fu in uvs]
        self.name, self.slot, self.aspect, self.density, self.area = name, slot, aspect, density, area
        self.w = None; self.slots = None; self.smooth = True; self.tags = {}
    def copy(self):
        p = Part(self.v.copy(), self.f, self.uv, self.name, self.slot, self.aspect, self.density, self.area)
        p.w = None if self.w is None else [dict(d) for d in self.w]; p.slots = None if self.slots is None else list(self.slots); p.smooth = self.smooth; p.tags = dict(self.tags); return p
    def move(self, d): self.v += A(d); return self
    def scale(self, s, pivot=(0, 0, 0)): self.v = (self.v - A(pivot)) * A(s) + A(pivot); return self
    def turn(self, axis, deg, pivot=(0, 0, 0)): self.v = (self.v - A(pivot)) @ rot(axis, deg).T + A(pivot); return self
    def mirror(self, name=None):
        """The right-side twin: X negated, faces flipped, `_L` bone names swapped for `_R`."""
        p = self.copy(); p.v[:, 0] *= -1; p.f = [f[::-1] for f in p.f]; p.uv = [u[::-1] for u in p.uv]
        if p.slots: p.slots = list(p.slots)
        if p.w: p.w = [{swap(b): x for b, x in d.items()} for d in p.w]
        p.name = name or swap(self.name); return p
    def warp(self, fn): self.v = np.array([fn(A(p)) for p in self.v]); return self
    def paint(self, fn):
        """Weights by rule: fn(position) -> {bone: weight}."""
        self.w = [fn(p) for p in self.v]; return self
    def bone(self, name): self.w = [{name: 1.0}] * len(self.v); return self
    def face_slots(self, fn):
        """Per-face slot override: fn(centroid, face index) -> slot name or None."""
        self.slots = [fn(self.v[list(f)].mean(axis=0), i) or self.slot for i, f in enumerate(self.f)]; return self
def swap(name): return name[:-2] + ('_R' if name.endswith('_L') else '_L') if name.endswith(('_L', '_R')) else name
def join(parts, name=None, slot=None):
    """Concatenate parts that share one UV square layout (each keeps its own UVs; use before packing only for rigid clusters)."""
    v, f, uv, w, sl, o = [], [], [], [], [], 0
    for p in parts:
        v.append(p.v); f += [tuple(i + o for i in face) for face in p.f]; uv += p.uv; o += len(p.v)
        w += p.w if p.w else [{}] * len(p.v); sl += p.slots if p.slots else [p.slot] * len(p.f)
    out = Part(np.concatenate(v), f, uv, name or parts[0].name, slot or parts[0].slot, parts[0].aspect, parts[0].density)
    out.w = w; out.slots = sl; out.smooth = parts[0].smooth; return out

def ring_points(rx, rz, seg, sq=2.0, bumps=(), start=0.0):
    """Superellipse cross-section: angle 0 = +u (side), 90 = +w (front). bumps: (angle, amount, width) radial scales."""
    out = []
    for k in range(seg):
        a = math.radians(start) + 2 * math.pi * k / seg; c, s = math.cos(a), math.sin(a); e = 2.0 / sq
        x, z = rx * math.copysign(abs(c) ** e, c), rz * math.copysign(abs(s) ** e, s); g = 1.0
        for ang, amt, wid in bumps:
            d = (math.degrees(a) - ang + 180) % 360 - 180; g += amt * math.exp(-(d / wid) ** 2)
        out.append((x * g, z * g))
    return out

def loft(keys, n=None, seg=16, caps=('round', 'round'), fwd=(0, 0, 1), name='loft', slot='primary', density=1.0, seam=270.0, lip=None, capn=3):
    """Skin a tube through key rings. Each key: dict(p=center, r=(rx, rz) or radius, sq=2, bumps=[], tw=degrees, cap=depth scale).
    `n` resamples the keys with Catmull-Rom to that many rings. caps: 'round' | 'flat' | 'open' per end; lip=(thickness, depth) turns open ends inward.
    UV u runs around from the seam angle, v along the length."""
    K = len(keys); n = n or K
    def key(i):
        t = i * (K - 1) / max(1, n - 1) if n != K else float(i); get = lambda name, d: [k.get(name, d) for k in keys]
        r = cr([A(k['r']) if np.ndim(k['r']) else A(k['r'], k['r']) for k in keys], t); j = min(int(round(t)), K - 1)
        return dict(p=cr([A(k['p']) for k in keys], t), r=np.maximum(r, 1e-4), sq=float(cr(get('sq', 2.0), t)), tw=float(cr(get('tw', 0.0), t)), bumps=keys[j].get('bumps', ()) if n == K else blend_bumps(keys, t))
    rings = [key(i) for i in range(n)]
    P = [r['p'] for r in rings]; T = [unit(P[min(i + 1, n - 1)] - P[max(i - 1, 0)]) for i in range(n)]
    w0 = unit(A(fwd) - np.dot(A(fwd), T[0]) * T[0]); frames = []
    for i in range(n):  # parallel transport of the forward axis
        w0 = unit(w0 - np.dot(w0, T[i]) * T[i]); frames.append((np.cross(T[i], w0), w0))
    verts, rows, vcoord, length = [], [], [], 0.0
    def add_ring(c, u, w, pts, tw, v):
        if tw: u, w = u * math.cos(math.radians(tw)) + w * math.sin(math.radians(tw)), w * math.cos(math.radians(tw)) - u * math.sin(math.radians(tw))
        rows.append(list(range(len(verts), len(verts) + seg))); vcoord.append(v)
        for x, z in pts: verts.append(c + u * x + w * z)
    def cap(end):
        kind = caps[end]; i = 0 if end == 0 else n - 1; r = rings[i]; u, w = frames[i]; sign = -1 if end == 0 else 1; depth = float(np.mean(r['r'])) * keys[0 if end == 0 else -1].get('cap', 1.0)
        out = []
        if kind == 'round':
            for j in range(1, capn + 1):
                a = j / (capn + 1) * math.pi / 2; out.append((P[i] + T[i] * sign * depth * math.sin(a), u, w, ring_points(r['r'][0] * math.cos(a), r['r'][1] * math.cos(a), seg, r['sq'], r['bumps'], seam), r['tw'], depth * math.sin(a)))
        elif kind == 'open' and lip:
            th, dp = lip; k = [max(.05, 1 - th / x) for x in r['r']]
            out.append((P[i], u, w, ring_points(r['r'][0] * k[0], r['r'][1] * k[1], seg, r['sq'], r['bumps'], seam), r['tw'], th))
            out.append((P[i] - T[i] * sign * dp, u, w, ring_points(r['r'][0] * k[0], r['r'][1] * k[1], seg, r['sq'], r['bumps'], seam), r['tw'], th + dp))
        return out
    start = cap(0)[::-1]; total0 = 0.0
    for c, u, w, pts, tw, d in start: add_ring(c, u, w, pts, tw, -d)
    for i in range(n):
        if i: length += float(np.linalg.norm(P[i] - P[i - 1]))
        u, w = frames[i]; add_ring(P[i], u, w, ring_points(rings[i]['r'][0], rings[i]['r'][1], seg, rings[i]['sq'], rings[i]['bumps'], seam), rings[i]['tw'], length)
    for c, u, w, pts, tw, d in cap(1): add_ring(c, u, w, pts, tw, length + d)
    v0, v1 = min(vcoord), max(vcoord); span = max(1e-6, v1 - v0); faces, uvs = [], []
    for a in range(len(rows) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg; faces.append((rows[a][k], rows[a][k2], rows[a + 1][k2], rows[a + 1][k]))
            ua, ub, va, vb = k / seg, (k + 1) / seg, (vcoord[a] - v0) / span, (vcoord[a + 1] - v0) / span
            uvs.append([(ua, va), (ub, va), (ub, vb), (ua, vb)])
    for end, row, vv in ((0, rows[0], 0.0), (1, rows[-1], 1.0)):
        kind = caps[end]
        if kind == 'open': continue
        i = 0 if end == 0 else n - 1; sign = -1 if end == 0 else 1; depth = float(np.mean(rings[i]['r'])) * keys[0 if end == 0 else -1].get('cap', 1.0) if kind == 'round' else 0.0
        verts.append(P[i] + T[i] * sign * depth); c = len(verts) - 1
        for k in range(seg):
            k2 = (k + 1) % seg; tri = (c, row[k2], row[k]) if end == 0 else (c, row[k], row[k2])
            faces.append(tri); uu = ((k + .5) / seg, vv); uvs.append([uu, ((k + 1) / seg, vv), (k / seg, vv)] if end == 0 else [uu, (k / seg, vv), ((k + 1) / seg, vv)])
    circ = float(np.mean([2 * math.pi * math.sqrt((r['r'][0] ** 2 + r['r'][1] ** 2) / 2) for r in rings]))
    return Part(verts, faces, uvs, name, slot, circ / span, density)
def blend_bumps(keys, t):
    i = int(min(max(math.floor(t), 0), len(keys) - 2)); f = t - i; a, b = keys[i].get('bumps', ()), keys[i + 1].get('bumps', ())
    if len(a) == len(b): return [(lerp(x[0], y[0], f), lerp(x[1], y[1], f), lerp(x[2], y[2], f)) for x, y in zip(a, b)]
    return [(x[0], x[1] * (1 - f), x[2]) for x in a] + [(y[0], y[1] * f, y[2]) for y in b]

def shell(fn, nu=12, nv=10, thick=.012, name='shell', slot='primary', density=1.0, close_u=False, grid=None):
    """A sheet with thickness from P(u, v) -> point, u and v in 0..1 (or a ready (nv + 1, cols, 3) grid). The inner side is offset by `thick` against dP/du x dP/dv."""
    cols = nu if close_u else nu + 1; grid = np.array([[A(fn(i / nu, j / nv)) for i in range(cols)] for j in range(nv + 1)]) if grid is None else np.asarray(grid, dtype=float)
    du = np.roll(grid, -1, axis=1) - np.roll(grid, 1, axis=1) if close_u else np.gradient(grid, axis=1); dv = np.gradient(grid, axis=0)
    nrm = np.cross(du, dv); nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-9)
    outer, inner = grid, grid - nrm * thick; verts = np.concatenate([outer.reshape(-1, 3), inner.reshape(-1, 3)]); N = cols * (nv + 1); faces, uvs = [], []
    idx = lambda i, j, side: side * N + j * cols + (i % cols)
    for j in range(nv):
        for i in range(nu):
            a, b, c, d = idx(i, j, 0), idx(i + 1, j, 0), idx(i + 1, j + 1, 0), idx(i, j + 1, 0); u0, u1, v0, v1 = i / nu * .5, (i + 1) / nu * .5, j / nv, (j + 1) / nv
            faces.append((a, b, c, d)); uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
            a, b, c, d = idx(i, j, 1), idx(i + 1, j, 1), idx(i + 1, j + 1, 1), idx(i, j + 1, 1)
            faces.append((d, c, b, a)); uvs.append([(.5 + u0, v1), (.5 + u1, v1), (.5 + u1, v0), (.5 + u0, v0)])
    def wall(a0, a1, b0, b1, u):  # border quad between the outer (a) and inner (b) edges
        faces.append((a0, b0, b1, a1)); uvs.append([(u, 0), (u, .02), (u + .01, .02), (u + .01, 0)])
    for i in range(nu): wall(idx(i + 1, 0, 0), idx(i, 0, 0), idx(i + 1, 0, 1), idx(i, 0, 1), i / nu * .5); wall(idx(i, nv, 0), idx(i + 1, nv, 0), idx(i, nv, 1), idx(i + 1, nv, 1), i / nu * .5)
    if not close_u:
        for j in range(nv): wall(idx(0, j, 0), idx(0, j + 1, 0), idx(0, j, 1), idx(0, j + 1, 1), 0); wall(idx(nu, j + 1, 0), idx(nu, j, 0), idx(nu, j + 1, 1), idx(nu, j, 1), .49)
    w = float(np.linalg.norm(np.diff(grid, axis=1), axis=2).sum(axis=1).mean()); h = float(np.linalg.norm(np.diff(grid, axis=0), axis=2).sum(axis=0).mean())
    return Part(verts, faces, uvs, name, slot, 2 * w / max(h, 1e-6), density)

def from_bmesh(bm, name, slot, density=1.0):
    """Hard-surface part from a bmesh, with a six-way box projection laid out in a 3 x 2 grid."""
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    v = np.array([vert.co[:] for vert in bm.verts]); lo, hi = v.min(axis=0), v.max(axis=0); size = np.maximum(hi - lo, 1e-6); faces, uvs = [], []
    for f in bm.faces:
        nrm = A(f.normal[:]); ax = int(np.argmax(np.abs(nrm))); cell = ax + (3 if nrm[ax] < 0 else 0); a, b = [(1, 2), (0, 2), (0, 1)][ax]
        faces.append(tuple(x.index for x in f.verts))
        uvs.append([((cell % 3 + .04 + .92 * (x.co[a] - lo[a]) / size[a]) / 3, (cell // 3 + .04 + .92 * (x.co[b] - lo[b]) / size[b]) / 2) for x in f.verts])
    bm.free(); s = sorted(size); return Part(v, faces, uvs, name, slot, 1.5, density, area=2 * (s[2] * s[1] + s[2] * s[0] + s[1] * s[0]) * 1.6)
def box(size, bevel=.01, seg=2, name='box', slot='metal', density=1.0, at=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * .45), segments=seg, profile=.5, affect='EDGES')
    p = from_bmesh(bm, name, slot, density); p.smooth = False; return p.move(at)
def disc(r, depth, seg=16, bevel=.003, name='disc', slot='metal', axis=(0, 0, 1), at=(0, 0, 0), density=1.0):
    """A short bevelled cylinder (button, rivet, lens) facing `axis`."""
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=depth)
    if bevel > 0: bmesh.ops.bevel(bm, geom=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6], offset=bevel, segments=2, profile=.5, affect='EDGES')
    p = from_bmesh(bm, name, slot, density); p.smooth = False; a = unit(axis); z = A(0, 0, 1)
    if abs(np.dot(a, z)) < .9999: p.turn(np.cross(z, a), math.degrees(math.acos(np.clip(np.dot(a, z), -1, 1))))
    elif a[2] < 0: p.turn((1, 0, 0), 180)
    return p.move(at)
def lathe(profile, seg=20, name='lathe', slot='metal', axis=(0, 1, 0), at=(0, 0, 0), density=1.0, sq=2.0, rz=1.0):
    """Revolve (radius, height) pairs about +Y, then aim +Y at `axis`. Closed top and bottom."""
    keys = [dict(p=(0, h, 0), r=(max(r, 1e-4), max(r, 1e-4) * rz), sq=sq) for r, h in profile]
    p = loft(keys, seg=seg, caps=('flat', 'flat'), name=name, slot=slot, density=density, fwd=(0, 0, 1)); a = unit(axis); y = A(0, 1, 0)
    if abs(np.dot(a, y)) < .9999: p.turn(np.cross(y, a), math.degrees(math.acos(np.clip(np.dot(a, y), -1, 1))))
    elif a[1] < 0: p.turn((1, 0, 0), 180)
    return p.move(at)

def torus(R, r, seg=28, rseg=10, rz=1.0, flat=1.0, sq=2.0, name='ring', slot='metal', axis=(0, 1, 0), at=(0, 0, 0), density=1.0):
    """A ring about +Y: major radius R (x) and R * rz (z), section radius r across and r * flat along the axis; then +Y is aimed at `axis`."""
    verts, faces, uvs = [], [], []; e = 2.0 / sq
    for i in range(seg):
        a = 2 * math.pi * i / seg; ca, sa = math.cos(a), math.sin(a); n = unit((ca / max(R, 1e-6), 0, sa / max(R * rz, 1e-6)))
        for j in range(rseg):
            t = 2 * math.pi * j / rseg; c, s = math.cos(t), math.sin(t); verts.append(A(R * ca, 0, R * rz * sa) + n * r * math.copysign(abs(c) ** e, c) + A(0, 1, 0) * r * flat * math.copysign(abs(s) ** e, s))
    for i in range(seg):
        for j in range(rseg):
            i2, j2 = (i + 1) % seg, (j + 1) % rseg; faces.append((i * rseg + j, i2 * rseg + j, i2 * rseg + j2, i * rseg + j2)); uvs.append([(i / seg, j / rseg), ((i + 1) / seg, j / rseg), ((i + 1) / seg, (j + 1) / rseg), (i / seg, (j + 1) / rseg)])
    p = Part(verts, faces, uvs, name, slot, (2 * math.pi * R) / (2 * math.pi * r), density); a = unit(axis); y = A(0, 1, 0)
    if abs(np.dot(a, y)) < .9999: p.turn(np.cross(y, a), math.degrees(math.acos(np.clip(np.dot(a, y), -1, 1))))
    elif a[1] < 0: p.turn((1, 0, 0), 180)
    return p.move(at)

# ── Sculpted heads: smooth-blended distance fields sampled on a face-weighted spherical grid ──────────────────────
class Field:
    """Signed distance field built from smooth unions and cuts (numpy, points as (n, 3))."""
    def __init__(self): self.ops = []
    def add(self, shape, k=.05): self.ops.append(('+', shape, k)); return self
    def cut(self, shape, k=.03): self.ops.append(('-', shape, k)); return self
    def both(self, make, k=.05, cut=False):
        for s in (1, -1): (self.cut if cut else self.add)(make(s), k)
        return self
    def __call__(self, p):
        d = None
        for op, shape, k in self.ops:
            s = shape(p)
            if d is None: d = s; continue
            if op == '+': h = np.clip(.5 + .5 * (s - d) / k, 0, 1); d = s * (1 - h) + d * h - k * h * (1 - h)
            else: h = np.clip(.5 - .5 * (d + s) / k, 0, 1); d = d * (1 - h) - s * h + k * h * (1 - h)
        return d
def ellipsoid(c, r):
    c, r = A(c), A(r)
    def f(p): q = (p - c) / r; n = np.linalg.norm(q, axis=1); return (n - 1) * r.min() * np.where(n > 1e-9, 1, 1)
    return f
def capsule(a, b, ra, rb=None):
    a, b = A(a), A(b); rb = ra if rb is None else rb; ab = b - a; L = float(np.dot(ab, ab))
    def f(p): t = np.clip(((p - a) @ ab) / L, 0, 1); return np.linalg.norm(p - (a + t[:, None] * ab), axis=1) - (ra + (rb - ra) * t)
    return f
def rbox(c, half, r=.02, turn=None):
    c, half = A(c), A(half); M = turn if turn is not None else np.eye(3)
    def f(p): q = np.abs((p - c) @ M) - half + r; return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(axis=1), 0) - r
    return f
def sample_head(field, nu=72, nv=56, focus=1.0, center=(0, 0, 0)):
    """Radial samples of a star-shaped field around `center`. Longitude 0 = +Z (face); samples crowd toward the face by `focus`.
    Returns (points (nv+1, nu, 3), lon degrees (nu), lat degrees (nv+1))."""
    lon = np.array([warp(-180 + 360 * i / nu, focus) for i in range(nu)]); lat = np.array([-90 + 180 * j / nv for j in range(nv + 1)])
    lat = np.sign(lat) * 90 * (np.abs(lat) / 90) ** (1 + .25 * focus)
    lo, la = np.meshgrid(np.radians(lon), np.radians(lat)); d = np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], axis=-1).reshape(-1, 3)
    t = np.full(len(d), 2.0); c = A(center)
    for _ in range(90):
        s = field(c + d * t[:, None]); t -= np.clip(s, -.05, .05) * .9
    return (c + d * t[:, None]).reshape(nv + 1, nu, 3), lon, lat
def warp(deg, focus):
    """Squeeze longitudes toward 0 (the face) so the front gets more columns than the back of the head."""
    x = deg / 180.0; return 180.0 * math.copysign(abs(x) ** (1 + .7 * focus), x)
def head_part(points, lon, lat, mouth=None, name='head', slot='skin', density=2.5):
    """Grid mesh from sample_head. mouth=(row, half-width degrees) splits that row so the jaw can open; returns (part, lower-lip vertex set)."""
    nv1, nu, _ = points.shape; verts = [points[0, 0]]; index = np.zeros((nv1, nu), dtype=int)
    for j in range(1, nv1 - 1):
        for i in range(nu): index[j, i] = len(verts); verts.append(points[j, i])
    top = len(verts); verts.append(points[-1, 0]); index[0, :] = 0; index[-1, :] = top; lower = {}
    if mouth:
        row, half = mouth
        for i in range(nu):
            if abs(lon[i]) < half: lower[i] = len(verts); verts.append(points[row, i].copy())
    faces, uvs = [], []; U = lambda i: i / nu; V = lambda j: j / (nv1 - 1)
    for j in range(nv1 - 1):
        for i in range(nu):
            i2 = (i + 1) % nu; a, b, c, d = index[j, i], index[j, i2], index[j + 1, i2], index[j + 1, i]
            if mouth and j + 1 == mouth[0]: c, d = lower.get(i2, c), lower.get(i, d)  # faces below the mouth row hang from the duplicated lower lip
            quad = [(a, (U(i), V(j))), (b, (U(i + 1), V(j))), (c, (U(i + 1), V(j + 1))), (d, (U(i), V(j + 1)))]
            seen, face = set(), []
            for vi, uv in quad:
                if vi not in seen: seen.add(vi); face.append((vi, uv))
            if len(face) >= 3: faces.append(tuple(v for v, _ in face)); uvs.append([u for _, u in face])
    p = Part(verts, faces, uvs, name, slot, 1.6, density); p.tags['lower_lip'] = set(lower.values()); return p

# ── Weights ──────────────────────────────────────────────────────────────────
def chain(bones, pts, soft=.06):
    """Weights along a bone chain: `pts` are the joints (one more than bones). Blends across each joint over `soft` meters."""
    pts = [A(p) for p in pts]
    def w(p):
        best, bt = 0, 0.0; bd = 1e9
        for i in range(len(bones)):
            a, b = pts[i], pts[i + 1]; ab = b - a; t = float(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-9)); d = float(np.linalg.norm(p - (a + np.clip(t, 0, 1) * ab)))
            if d < bd - 1e-9: bd, best, bt = d, i, t
        a, b = pts[best], pts[best + 1]; L = float(np.linalg.norm(b - a)); s = bt * L; out = {bones[best]: 1.0}
        if best > 0 and s < soft: k = .5 + .5 * s / soft; out = {bones[best]: k, bones[best - 1]: 1 - k}
        elif best + 1 < len(bones) and L - s < soft: k = .5 + .5 * (L - s) / soft; out = {bones[best]: k, bones[best + 1]: 1 - k}
        return out
    return w
def by_height(stops, axis=1):
    """Weights from (coordinate, bone) stops along an axis, smoothly blended between neighbours."""
    stops = sorted(stops)
    def w(p):
        x = p[axis]
        if x <= stops[0][0]: return {stops[0][1]: 1.0}
        if x >= stops[-1][0]: return {stops[-1][1]: 1.0}
        for (a, ba), (b, bb) in zip(stops, stops[1:]):
            if a <= x <= b: t = float(smooth(a, b, x)); return {ba: 1 - t, bb: t} if ba != bb else {ba: 1.0}
    return w
def mix(wa, wb, t):
    """Blend two weight rules by t(position) in 0..1."""
    def w(p):
        k = float(np.clip(t(p), 0, 1)); out = {}
        for b, x in wa(p).items(): out[b] = out.get(b, 0) + x * (1 - k)
        for b, x in wb(p).items(): out[b] = out.get(b, 0) + x * k
        return out
    return w

def mask_ellipsoids(specs):
    """Pattern-mask builder for a slot: soft ellipsoids in character space, [(center, radii, strength, softness)], combined by maximum."""
    def make(N, L):
        geo = N.new('ShaderNodeNewGeometry'); out = None
        for c, r, strength, soft in specs:
            sub = N.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; L.new(geo.outputs['Position'], sub.inputs[0]); sub.inputs[1].default_value = (c[0], -c[2], c[1])
            div = N.new('ShaderNodeVectorMath'); div.operation = 'DIVIDE'; L.new(sub.outputs[0], div.inputs[0]); div.inputs[1].default_value = (r[0], r[2], r[1])
            ln = N.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; L.new(div.outputs[0], ln.inputs[0])
            mr = N.new('ShaderNodeMapRange'); mr.interpolation_type = 'SMOOTHSTEP'; mr.inputs['From Min'].default_value = 1 - soft; mr.inputs['From Max'].default_value = 1 + soft; mr.inputs['To Min'].default_value = strength; mr.inputs['To Max'].default_value = 0; L.new(ln.outputs['Value'], mr.inputs['Value'])
            if out is None: out = mr.outputs[0]
            else: mx = N.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'; L.new(out, mx.inputs[0]); L.new(mr.outputs[0], mx.inputs[1]); out = mx.outputs[0]
        return out
    return make

def mask_noise(scale, lo, hi, detail=3.0):
    """Pattern-mask builder: blotches of the slot's pattern colour (patina, wear, stains) from object-space noise between `lo` and `hi`."""
    def make(N, L):
        tc = N.new('ShaderNodeTexCoord'); n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; L.new(tc.outputs['Object'], n.inputs['Vector'])
        mr = N.new('ShaderNodeMapRange'); mr.interpolation_type = 'SMOOTHSTEP'; mr.inputs['From Min'].default_value = lo; mr.inputs['From Max'].default_value = hi; L.new(n.outputs['Fac'], mr.inputs['Value']); return mr.outputs[0]
    return make

# ── Build: UV pack, bake, rig, export ────────────────────────────────────────
BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
         'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'prop']
PARENTS = {'root': None, 'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'shoulder_L': 'chest', 'upperarm_L': 'shoulder_L', 'forearm_L': 'upperarm_L', 'hand_L': 'forearm_L',
           'shoulder_R': 'chest', 'upperarm_R': 'shoulder_R', 'forearm_R': 'upperarm_R', 'hand_R': 'forearm_R', 'thigh_L': 'hips', 'shin_L': 'thigh_L', 'foot_L': 'shin_L', 'thigh_R': 'hips', 'shin_R': 'thigh_R', 'foot_R': 'shin_R', 'prop': 'hand_R'}
# Surface recipes for the bake: paint (value gradient, wear, variation) and bump (micro relief). `finish` is what the game shader gets per slot.
SURFACES = {
    'cloth':   dict(bump='weave', bump_scale=150, bump_amt=.16, wear=.25, vary=.10, rough=.88, metal=0, spec=.25),
    'wool':    dict(bump='knit', bump_scale=70, bump_amt=.45, wear=.12, vary=.12, rough=.95, metal=0, spec=.15),
    'leather': dict(bump='grain', bump_scale=110, bump_amt=.3, wear=.55, vary=.16, rough=.6, metal=0, spec=.5),
    'skin':    dict(bump='none', bump_scale=1, bump_amt=0, wear=0, vary=.04, rough=.62, metal=0, spec=.35),
    'hair':    dict(bump='strands', bump_scale=60, bump_amt=.5, wear=.3, vary=.16, rough=.7, metal=0, spec=.4),
    'metal':   dict(bump='scratch', bump_scale=90, bump_amt=.22, wear=.8, vary=.12, rough=.34, metal=1, spec=1),
    'iron':    dict(bump='pitted', bump_scale=70, bump_amt=.5, wear=.6, vary=.2, rough=.6, metal=1, spec=1),
    'bronze':  dict(bump='pitted', bump_scale=34, bump_amt=.4, wear=.9, vary=.2, rough=.46, metal=1, spec=1),
    'wood':    dict(bump='woodgrain', bump_scale=40, bump_amt=.5, wear=.4, vary=.18, rough=.7, metal=0, spec=.3),
    'glass':   dict(bump='none', bump_scale=1, bump_amt=0, wear=0, vary=.03, rough=.12, metal=0, spec=1),
    'eye':     dict(bump='none', bump_scale=1, bump_amt=0, wear=0, vary=0, rough=.08, metal=0, spec=1),
    'glow':    dict(bump='none', bump_scale=1, bump_amt=0, wear=0, vary=.05, rough=.4, metal=0, spec=.2),
    'flat':    dict(bump='none', bump_scale=1, bump_amt=0, wear=0, vary=0, rough=.9, metal=0, spec=.1),
    # Stage surfaces: `kind` picks the tiling pattern the arena shader draws over the bake (1 stone courses, 2 planks, 3 plates, 4 rock strata).
    'stone':   dict(bump='pitted', bump_scale=9, bump_amt=.5, wear=.7, vary=.2, rough=.86, metal=0, spec=.2, kind=1),
    'rock':    dict(bump='grain', bump_scale=5, bump_amt=.8, wear=.8, vary=.3, rough=.92, metal=0, spec=.15, kind=4),
    'planks':  dict(bump='woodgrain', bump_scale=8, bump_amt=.6, wear=.5, vary=.25, rough=.75, metal=0, spec=.25, kind=2),
    'plate':   dict(bump='scratch', bump_scale=20, bump_amt=.3, wear=.9, vary=.18, rough=.42, metal=1, spec=1, kind=3),
    'grate':   dict(bump='scratch', bump_scale=20, bump_amt=.3, wear=.9, vary=.18, rough=.68, metal=.3, spec=.6, kind=3),
    'moss':    dict(bump='grain', bump_scale=30, bump_amt=.6, wear=.1, vary=.3, rough=.95, metal=0, spec=.1, kind=0),
}

class Build:
    def __init__(self, kind, name, joints, slots, costumes, extras=None, anchors=None, height=None, tex=1024, swatch=None):
        """joints: {bone: (position, parent)} in character space. slots: {slot: dict(surface=<SURFACES key>, color='#hex', pattern='#hex', glow=0..)} in palette order.
        costumes: [{name, colors: {slot: hex}, patterns: {slot: hex}}] (costume 0 repeats the slot colours)."""
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.kind, self.name, self.J, self.slots, self.costumes, self.extras, self.anchors, self.height, self.tex = kind, name, dict(joints), slots, costumes, extras or {}, anchors or {}, height, int(flag('tex', tex))
        self.parts = []; self.t0 = time.time(); os.makedirs(OUT, exist_ok=True); self.ao = .16   # ambient-occlusion reach in meters (stages use more)
        self.swatch = swatch or list(slots)[:3]   # the three slots that stand for a costume in the menus
    def P(self, bone): return A(self.J[bone][0])
    def add(self, *parts):
        for p in parts:
            assert p.w is not None and len(p.w) == len(p.v), f'{p.name}: no weights'
            self.parts.append(p)
        return parts[0] if len(parts) == 1 else parts
    def both(self, part):
        """Add a left-side part and its mirrored right twin."""
        self.add(part, part.mirror()); return part

    # UVs: every part gets a rectangle sized by its surface area times its density, shelf-packed into the unit square.
    def pack(self, pad=.004):
        def area(p):
            if p.area: return p.area
            tot = 0.0
            for f in p.f:
                q = p.v[list(f)]
                for i in range(1, len(q) - 1): tot += .5 * float(np.linalg.norm(np.cross(q[i] - q[0], q[i + 1] - q[0])))
            return tot
        rects = []
        for p in self.parts:
            a = max(area(p), 1e-6) * p.density ** 2; h = math.sqrt(a / max(p.aspect, .05)); w = a / h
            if w > 3.2 * h: w, h = math.sqrt(a * 3.2), math.sqrt(a / 3.2)   # keep long strips packable
            if h > 3.2 * w: w, h = math.sqrt(a / 3.2), math.sqrt(a * 3.2)
            rects.append([p, w, h])
        lo, hi = 1e-4, 6.0   # stages are tens of square meters, fighters about one
        for _ in range(40):  # largest scale whose shelves fit the square
            s = (lo + hi) / 2; x = y = shelf = 0.0; ok = True
            for p, w, h in sorted(rects, key=lambda r: -r[2]):
                W, H = w * s + pad, h * s + pad
                if W > 1: ok = False; break
                if x + W > 1: x = 0; y += shelf; shelf = 0
                shelf = max(shelf, H); x += W
                if y + shelf > 1: ok = False; break
            lo, hi = (s, hi) if ok else (lo, s)
        s = lo; x = y = shelf = 0.0
        for p, w, h in sorted(rects, key=lambda r: -r[2]):
            W, H = w * s + pad, h * s + pad
            if x + W > 1: x = 0; y += shelf; shelf = 0
            p.rect = (x + pad / 2, y + pad / 2, w * s, h * s); shelf = max(shelf, H); x += W
        self.uv_scale = s; return s

    def mesh(self):
        """One Blender mesh object from every part (materials by slot, packed UVs, weights as vertex groups, sharp edges on hard parts)."""
        self.pack(); names = list(self.slots); verts, faces, loops, mats, weights, smooth_face, part_of = [], [], [], [], [], [], []
        for pi, p in enumerate(self.parts):
            o = len(verts); verts += [tuple(C @ Vector(v)) for v in p.v]; weights += p.w; x0, y0, w, h = p.rect
            for fi, f in enumerate(p.f):
                faces.append(tuple(i + o for i in f)); loops.append([(x0 + u * w, y0 + v * h) for u, v in p.uv[fi]])
                mats.append(names.index(p.slots[fi] if p.slots else p.slot)); smooth_face.append(p.smooth); part_of.append(pi)
        me = bpy.data.meshes.new(self.kind); me.from_pydata(verts, [], faces); me.update()
        uv = me.uv_layers.new(name='UVMap'); k = 0
        for poly, fl in zip(me.polygons, loops):
            for li, u in zip(poly.loop_indices, fl): uv.data[li].uv = u
        for n in names: me.materials.append(bpy.data.materials.new(n))
        me.polygons.foreach_set('material_index', mats); me.polygons.foreach_set('use_smooth', [True] * len(faces))
        ob = bpy.data.objects.new(self.kind, me); bpy.context.scene.collection.objects.link(ob)
        bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
        # Hard parts keep their bevel planes: edges sharper than 38 degrees are split there; organic parts stay smooth.
        hard = np.array([not s for s in smooth_face]); me.update()
        if hard.any():
            bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
            for e in bm.edges:
                fs = e.link_faces
                if len(fs) == 2 and (hard[fs[0].index] or hard[fs[1].index]) and fs[0].normal.angle(fs[1].normal, 0) > math.radians(38): e.smooth = False
            bm.to_mesh(me); bm.free()
        groups = {}
        for vi, wd in enumerate(weights):
            tot = sum(x for x in wd.values() if x > 1e-4); assert tot > 0, f'unweighted vertex in {self.parts[0].name}'
            top = sorted(((x, b) for b, x in wd.items() if x > 1e-4), reverse=True)[:4]; tot = sum(x for x, _ in top)
            for x, b in top:
                assert b in self.J, f'unknown bone {b}'
                g = groups.get(b) or ob.vertex_groups.new(name=b); groups[b] = g; g.add([vi], x / tot, 'REPLACE')
        self.ob, self.me = ob, me; self.tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print(f'[{self.kind}] mesh: {len(me.vertices)} verts, {self.tris} tris, {len(self.parts)} parts, uv scale {self.uv_scale:.2f}, {time.time() - self.t0:.1f}s'); return ob

    def rig(self):
        if len(self.J) <= 1: self.arm = None; return None   # a static prop or stage has no skeleton
        sc = bpy.context.scene; ad = bpy.data.armatures.new(self.kind + '-rig'); arm = bpy.data.objects.new(self.kind + '-rig', ad); sc.collection.objects.link(arm)
        bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT'); eb = {}
        for n, (p, _) in self.J.items(): b = ad.edit_bones.new(n); h = C @ Vector(p); b.head = h; b.tail = h + Vector((0, 0, .05)); b.roll = 0; eb[n] = b
        for n, (_, par) in self.J.items():
            if par: eb[n].parent = eb[par]
        bpy.ops.object.mode_set(mode='OBJECT'); self.ob.parent = arm; self.ob.modifiers.new('rig', 'ARMATURE').object = arm; self.arm = arm; return arm

    # ── Bake ──
    def _nodes(self, mat):
        mat.use_nodes = True; nt = mat.node_tree
        for n in list(nt.nodes): nt.nodes.remove(n)
        return nt, nt.nodes, nt.links
    def _target(self, N, img):
        t = N.new('ShaderNodeTexImage'); t.image = img; N.active = t; t.select = True; return t
    def _bump_height(self, N, L, s, slot):
        """Procedural height for a surface recipe, in generated object space so it never shows UV seams."""
        tc = N.new('ShaderNodeTexCoord'); kind = s['bump']; sc = s['bump_scale']
        def noise(scale, detail=2.0, rough=.5, vec=None):
            n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough; L.new(vec or tc.outputs['Object'], n.inputs['Vector']); return n.outputs['Fac']
        def wave(scale, axis, vec=None, distortion=0.0):
            w = N.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = axis; w.inputs['Scale'].default_value = scale; w.inputs['Distortion'].default_value = distortion; L.new(vec or tc.outputs['Object'], w.inputs['Vector']); return w.outputs['Fac']
        def math_(op, a, b=None, c=None):
            m = N.new('ShaderNodeMath'); m.operation = op
            for i, v in enumerate((a, b, c)):
                if v is None: continue
                if isinstance(v, (int, float)): m.inputs[i].default_value = v
                else: L.new(v, m.inputs[i])
            return m.outputs[0]
        def stretched(sx, sy, sz):
            mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (sx, sy, sz); L.new(tc.outputs['UV'], mp.inputs['Vector']); return mp.outputs[0]
        if kind == 'weave': return math_('MULTIPLY', math_('ADD', wave(sc, 'X'), wave(sc, 'Z')), .5)
        if kind == 'knit': return math_('MULTIPLY', math_('ADD', wave(sc, 'Y', distortion=2.0), noise(sc * 2)), .5)
        if kind == 'grain': return math_('ADD', math_('MULTIPLY', noise(sc, 3.0, .6), .7), math_('MULTIPLY', noise(sc * .2, 2.0), .5))
        if kind == 'scratch': return math_('ADD', math_('MULTIPLY', noise(sc, 4.0, .7, stretched(1, 14, 1)), .6), math_('MULTIPLY', noise(sc * .3), .4))
        if kind == 'pitted':
            v = N.new('ShaderNodeTexVoronoi'); v.inputs['Scale'].default_value = sc; L.new(tc.outputs['Object'], v.inputs['Vector']); return math_('ADD', math_('MULTIPLY', v.outputs['Distance'], .8), math_('MULTIPLY', noise(sc * 2, 3.0), .4))
        if kind == 'woodgrain': return math_('ADD', math_('MULTIPLY', noise(sc, 3.0, .6, stretched(30, 1.5, 1)), .8), math_('MULTIPLY', noise(sc * 4), .2))
        if kind == 'strands': return math_('ADD', math_('MULTIPLY', noise(sc, 2.0, .5, stretched(46, 1.2, 1)), .8), math_('MULTIPLY', noise(sc * .25, 2.0, .5, stretched(9, .6, 1)), .5))
        return None
    def _paint(self, mat, slot, img):
        """Emission = ambient occlusion x value gradient x curvature wear x variation, tinted cool in the dark and warm in the light. 0.5 is neutral."""
        s = SURFACES[self.slots[slot]['surface']]; nt, N, L = self._nodes(mat); out = N.new('ShaderNodeOutputMaterial'); em = N.new('ShaderNodeEmission'); L.new(em.outputs[0], out.inputs[0])
        def math_(op, a, b=None, clamp=False):
            m = N.new('ShaderNodeMath'); m.operation = op; m.use_clamp = clamp
            for i, v in enumerate((a, b)):
                if v is None: continue
                if isinstance(v, (int, float)): m.inputs[i].default_value = v
                else: L.new(v, m.inputs[i])
            return m.outputs[0]
        def ramp(src, stops):
            r = N.new('ShaderNodeValToRGB'); e = r.color_ramp.elements; e[0].position, e[0].color = stops[0][0], (*[stops[0][1]] * 3, 1); e[1].position, e[1].color = stops[-1][0], (*[stops[-1][1]] * 3, 1)
            for pos, val in stops[1:-1]: x = e.new(pos); x.color = (val, val, val, 1)
            L.new(src, r.inputs[0]); return r.outputs[0]
        ao = N.new('ShaderNodeAmbientOcclusion'); ao.samples = 24; ao.inputs['Distance'].default_value = self.ao
        occl = ramp(ao.outputs['AO'], [(0, .34), (.55, .78), (1, 1)])
        geo = N.new('ShaderNodeNewGeometry'); tc = N.new('ShaderNodeTexCoord'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Position'], sep.inputs[0])
        grad = ramp(math_('DIVIDE', sep.outputs['Z'], self.height or 1.8), [(0, .78), (.5, .96), (1, 1.1)])       # lighter toward the head
        up = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Normal'], up.inputs[0]); sky = ramp(math_('ADD', math_('MULTIPLY', up.outputs['Z'], .5), .5), [(0, .84), (.5, .97), (1, 1.1)])   # top planes catch the sky
        wear = ramp(geo.outputs['Pointiness'], [(.42, 1 - s['wear'] * .45), (.5, 1), (.58, 1 + s['wear'] * .55)])        # dark creases, bright worn edges
        n1 = N.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 7; n1.inputs['Detail'].default_value = 3; L.new(tc.outputs['Object'], n1.inputs['Vector'])
        vary = ramp(n1.outputs['Fac'], [(.25, 1 - s['vary']), (.75, 1 + s['vary'])])
        val = math_('MULTIPLY', math_('MULTIPLY', occl, grad), math_('MULTIPLY', math_('MULTIPLY', sky, wear), vary))
        h = self._bump_height(N, L, s, slot)
        if h is not None: val = math_('MULTIPLY', val, ramp(h, [(.2, 1 - s['bump_amt'] * .16), (.8, 1 + s['bump_amt'] * .1)]))
        half = math_('MULTIPLY', val, .46, clamp=True)
        tint = N.new('ShaderNodeValToRGB'); e = tint.color_ramp.elements; e[0].position, e[0].color = .12, (.80, .86, 1.12, 1); e[1].position, e[1].color = .62, (1.05, 1.0, .93, 1); L.new(half, tint.inputs[0])
        mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1; L.new(half, mul.inputs[6]); L.new(tint.outputs[0], mul.inputs[7])
        L.new(mul.outputs[2], em.inputs['Color']); self._target(N, img)
    def _relief(self, mat, slot, img):
        s = SURFACES[self.slots[slot]['surface']]; nt, N, L = self._nodes(mat); out = N.new('ShaderNodeOutputMaterial'); bsdf = N.new('ShaderNodeBsdfDiffuse'); L.new(bsdf.outputs[0], out.inputs[0])
        h = self._bump_height(N, L, s, slot)
        if h is not None: b = N.new('ShaderNodeBump'); b.inputs['Strength'].default_value = s['bump_amt']; b.inputs['Distance'].default_value = .004; L.new(h, b.inputs['Height']); L.new(b.outputs[0], bsdf.inputs['Normal'])
        self._target(N, img)
    def _mask(self, mat, slot, img):
        """Emission = the slot's pattern mask (fighter scripts set slots[slot]['mask'] to a node builder returning a 0..1 socket)."""
        nt, N, L = self._nodes(mat); out = N.new('ShaderNodeOutputMaterial'); em = N.new('ShaderNodeEmission'); L.new(em.outputs[0], out.inputs[0]); make = self.slots[slot].get('mask')
        if make: L.new(make(N, L), em.inputs['Color'])
        else: em.inputs['Color'].default_value = (0, 0, 0, 1)
        self._target(N, img)
    def bake(self, samples=None):
        """Paint map (RGB, 0.5 neutral) and detail map (tangent normal XY + pattern mask in B), written under output/ and packed for export."""
        sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = int(flag('samples', samples or 12)); sc.cycles.use_denoising = False
        sc.render.bake.margin = 6; sc.render.bake.use_clear = True; T = self.tex
        for o in sc.objects: o.select_set(o is self.ob)
        bpy.context.view_layer.objects.active = self.ob; arm = self.ob.modifiers.get('rig'); show = arm.show_viewport if arm else None
        def run(build, kind, name, colorspace):
            img = bpy.data.images.new(f'{self.kind}-{name}', T, T, alpha=False, float_buffer=True); img.colorspace_settings.name = colorspace
            for i, slot in enumerate(self.slots): build(self.me.materials[i], slot, img)
            t = time.time(); bpy.ops.object.bake(type=kind, **({'normal_space': 'TANGENT'} if kind == 'NORMAL' else {})); print(f'[{self.kind}] baked {name} {T}px in {time.time() - t:.1f}s')
            px = np.empty(T * T * 4, dtype=np.float32); img.pixels.foreach_get(px); bpy.data.images.remove(img); return px.reshape(T, T, 4)
        paint = run(self._paint, 'EMIT', 'paint', 'Non-Color'); normal = run(self._relief, 'NORMAL', 'normal', 'Non-Color'); mask = run(self._mask, 'EMIT', 'mask', 'Non-Color')
        detail = normal.copy(); detail[..., 2] = np.clip(mask[..., 0], 0, 1); paint[..., 3] = detail[..., 3] = 1
        self.images = {}
        for name, px, space in (('paint', np.clip(paint, 0, 1), 'sRGB'), ('detail', np.clip(detail, 0, 1), 'Non-Color')):
            img = bpy.data.images.new(f'{self.kind}-{name}', T, T, alpha=False); img.colorspace_settings.name = 'Non-Color'
            # paint is stored sRGB-encoded so a glTF base-colour sampler decodes it back to these linear values
            out = px.copy()
            if name == 'paint': c = out[..., :3]; out[..., :3] = np.where(c <= .0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-9), 1 / 2.4) - .055)
            img.pixels.foreach_set(out.ravel()); img.filepath_raw = os.path.join(OUT, f'{self.kind}-{name}.png'); img.file_format = 'PNG'; img.save(); img.colorspace_settings.name = space; self.images[name] = img
        return self.images

    def materials(self, baked=True):
        """Export materials: one per slot (the game merges them by name into palette slots), all sharing the two baked maps."""
        for i, slot in enumerate(self.slots):
            mat = self.me.materials[i]; nt, N, L = self._nodes(mat); out = N.new('ShaderNodeOutputMaterial'); b = N.new('ShaderNodeBsdfPrincipled'); L.new(b.outputs[0], out.inputs[0])
            spec = self.slots[slot]; s = SURFACES[spec['surface']]; col = (*srgb(spec['color']), 1); b.inputs['Roughness'].default_value = s['rough']; b.inputs['Metallic'].default_value = s['metal']
            if spec.get('glow'): b.inputs['Emission Color'].default_value = col; b.inputs['Emission Strength'].default_value = spec['glow']
            if not baked: b.inputs['Base Color'].default_value = col; continue
            t = N.new('ShaderNodeTexImage'); t.image = self.images['paint']; m = N.new('ShaderNodeMix'); m.data_type = 'RGBA'; m.blend_type = 'MULTIPLY'; m.inputs['Factor'].default_value = 1
            # Preview only: palette x paint x 2. The exporter reads the image feeding Base Color; the game applies the palette itself.
            L.new(t.outputs['Color'], b.inputs['Base Color'])
            n = N.new('ShaderNodeTexImage'); n.image = self.images['detail']; n.image.colorspace_settings.name = 'Non-Color'; nm = N.new('ShaderNodeNormalMap'); L.new(n.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs[0], b.inputs['Normal'])

    def export(self, folder='fighters'):
        path = os.path.join(GAME, 'assets', folder, f'{self.kind}.glb'); os.makedirs(os.path.dirname(path), exist_ok=True)
        for o in bpy.context.scene.objects: o.select_set(o in (self.arm, self.ob))
        if not self.arm: self.ob.vertex_groups.clear()
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False, export_skins=bool(self.arm), export_morph=False, export_texcoords=True, export_normals=True,
                                  export_tangents=False, export_yup=True, export_apply=False, export_extras=False, export_lights=False, export_cameras=False, export_def_bones=False, export_leaf_bone=False,
                                  export_rest_position_armature=True, export_influence_nb=4, export_image_format='WEBP', export_image_quality=int(flag('quality', 88)), export_attributes=False, export_vertex_color='NONE')
        self.write_meta(os.path.getsize(path)); print(f'[{self.kind}] exported {path}: {os.path.getsize(path)} bytes, {self.tris} tris, {time.time() - self.t0:.1f}s'); return path
    def write_meta(self, nbytes=0):
        """assets/models/<id>.json (review and validation), assets/costumes/<id>.json and src/crew/<id>/rig.ts (what the animation solver reads)."""
        v = np.array([p for part in self.parts for p in part.v]); lo, hi = v.min(axis=0), v.max(axis=0); r4 = lambda p: [round(float(x), 4) for x in p]
        chains = {}
        for b in self.J:
            if b.startswith('extra_'): base, _, i = b.rpartition('_'); chains.setdefault(base[6:], []).append(b)
        meta = {'kind': self.kind, 'name': self.name, 'generator': f'tools/blender/crew/{self.kind}.py', 'height': self.height, 'tris': self.tris, 'vertices': len(self.me.vertices), 'bytes': nbytes, 'texture': self.tex,
                'bounds': {'min': r4(lo), 'max': r4(hi)},
                'slots': [{'name': n, 'surface': s['surface'], **{k: SURFACES[s['surface']][k] for k in ('rough', 'metal', 'spec')}, 'glow': s.get('glow', 0), 'kind': SURFACES[s['surface']].get('kind', 0), 'color': s['color'], 'pattern': s['pattern']} for n, s in self.slots.items()],
                'bones': list(self.J), 'parents': {n: p for n, (_, p) in self.J.items()}, 'joints': {n: r4(p) for n, (p, _) in self.J.items()},
                'chains': chains, 'extras': self.extras, 'anchors': self.anchors}
        os.makedirs(os.path.join(GAME, 'assets', 'models'), exist_ok=True)
        with open(os.path.join(GAME, 'assets', 'models', f'{self.kind}.json'), 'w') as f: json.dump(meta, f, indent=1)
        if not self.arm: return meta
        os.makedirs(os.path.join(GAME, 'assets', 'costumes'), exist_ok=True); os.makedirs(os.path.join(GAME, 'src', 'crew', self.kind), exist_ok=True)
        with open(os.path.join(GAME, 'assets', 'costumes', f'{self.kind}.json'), 'w') as f: json.dump([{**c, 'swatch': [c['colors'][s] for s in self.swatch]} for c in self.costumes], f, indent=1)
        rig = {'bones': meta['bones'], 'parents': meta['parents'], 'joints': meta['joints'], 'chains': chains, 'anchors': self.anchors, 'hand': self.extras.get('hand', {'along': [1, 0, 0], 'thumb': [0, 0, 1], 'palm': [0, -1, 0]}), 'fist': bool(self.extras.get('fist'))}
        with open(os.path.join(GAME, 'src', 'crew', self.kind, 'rig.ts'), 'w') as f:
            f.write(f"// Generated by tools/blender/crew/{self.kind}.py with the model. Do not edit by hand.\nimport type {{ Rig }} from '../../anim/core';\nexport const RIG: Rig = {json.dumps(rig, separators=(',', ':'))};\n")
        return meta

    # ── Review renders (Cycles, CPU) ──
    def pose(self, spec):
        """Rotate bones for a review render: {bone: (x, y, z) degrees in character axes}."""
        for b, r in spec.items():
            pb = self.arm.pose.bones[b]; pb.rotation_mode = 'QUATERNION'
            M = rot((0, 0, 1), r[2]) @ rot((0, 1, 0), r[1]) @ rot((1, 0, 0), r[0]); Cm = np.array(C.to_3x3()); Mb = Cm @ M @ Cm.T
            rest = np.array(pb.bone.matrix_local.to_3x3()); pb.rotation_quaternion = Matrix((rest.T @ Mb @ rest).tolist()).to_quaternion()
        bpy.context.view_layer.update()
    def render(self, shots, path, size=(640, 800), samples=24, bg=(.09, .10, .14), clay=False):
        """shots: [(yaw degrees, target (x, y, z), distance, lens mm)] laid out left to right into one sheet."""
        sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = int(flag('rsamples', samples)); sc.cycles.use_denoising = False; sc.render.film_transparent = False
        sc.view_settings.view_transform = 'Standard'; world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True; world.node_tree.nodes['Background'].inputs[0].default_value = (*bg, 1); world.node_tree.nodes['Background'].inputs[1].default_value = .9
        def sun(name, dirv, energy, color, angle=.2):
            d = bpy.data.lights.new(name, 'SUN'); d.energy = energy; d.color = color; d.angle = angle; o = bpy.data.objects.new(name, d); sc.collection.objects.link(o)
            o.rotation_euler = (C.to_3x3() @ Vector(dirv)).to_track_quat('Z', 'Y').to_euler(); return o
        lights = [sun('key', (-.5, .75, .65), 4.2, (1, .95, .86)), sun('fill', (.8, .2, .5), 1.1, (.6, .75, 1)), sun('rim', (.35, .5, -1), 5.0, (.75, .88, 1), .1)]
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = size
        if clay:
            clay_m = bpy.data.materials.new('clay'); clay_m.use_nodes = True; clay_m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.55, .55, .58, 1); keep = list(self.me.materials)
            for i in range(len(keep)): self.me.materials[i] = clay_m
        files = []
        for i, (yaw, target, dist, lens) in enumerate(shots):
            a = math.radians(yaw); t = A(target); pos = t + A(math.sin(a), .12, math.cos(a)) * dist; cam.data.lens = lens
            cam.location = C @ Vector(pos); cam.rotation_euler = (C.to_3x3() @ Vector(pos - t)).to_track_quat('Z', 'Y').to_euler()
            for l, d in zip(lights, ((-.5, .75, .65), (.8, .2, .5), (.35, .5, -1))):   # lights ride with the camera so every view is lit the same
                v = rot((0, 1, 0), yaw) @ A(d); l.rotation_euler = (C.to_3x3() @ Vector(v)).to_track_quat('Z', 'Y').to_euler()
            f = f'{path}-{i}.png'; sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
        if clay:
            for i, m in enumerate(keep): self.me.materials[i] = m
        os.system(f"convert {' '.join(files)} +append {path}.png && rm {' '.join(files)}"); print(f'[{self.kind}] sheet {path}.png, {time.time() - self.t0:.1f}s'); return path + '.png'
