"""Procedural ship sprites from hulls.json.
Run: blender -b --factory-startup -P ships.py -- <public/games/starship-scramble> [hullId ...]
Grid coords (x right, y down, 1 unit = 1 cell) map to world (x, -y); see src/defs/geometry.ts for the sprite convention.
Each design draws a sculpted outer envelope around the whole room grid (Ship.body), which recesses a dark deck with a thin
metal lip under the rooms, then adds secondary masses (nacelles, wings, fins, sponsons). A grid-space panel texture gives the
painted armor its seams and two-tone panels. Paint-tagged materials become the white paint mask."""
import bmesh, bpy, json, math, os, random, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

PPC, MX, MY, RES, TEX = 64, 2, 1.5, .025, 1 / 128
HERE = os.path.dirname(os.path.abspath(__file__))

def inset(pts, d):
    """Offset a simple polygon inward by d (miter joins)."""
    s = 1 if area(pts) > 0 else -1; out = []
    for i, p in enumerate(pts):
        a, b, p = Vector(pts[i - 1][:2]), Vector(pts[(i + 1) % len(pts)][:2]), Vector(p[:2])
        n1, n2 = (p - a).normalized(), (b - p).normalized(); n1, n2 = Vector((-n1.y, n1.x)) * s, Vector((-n2.y, n2.x)) * s
        m = n1 + n2; out.append(tuple(p + m / max(m.dot(n1), .3) * d))
    return out

def edge_dist(pts, x0, y0, res, nx, ny):
    """Distance from every pixel center of a grid to the nearest edge of a closed polygon."""
    px, py = np.meshgrid(x0 + (np.arange(nx) + .5) * res, y0 + (np.arange(ny) + .5) * res); d = np.full(px.shape, 1e9)
    for a, b in zip(pts, pts[1:] + pts[:1]):
        ex, ey = b[0] - a[0], b[1] - a[1]; t = np.clip(((px - a[0]) * ex + (py - a[1]) * ey) / max(ex * ex + ey * ey, 1e-12), 0, 1)
        d = np.minimum(d, np.hypot(px - a[0] - t * ex, py - a[1] - t * ey))
    return d

def simplify(pts, tol):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); v = b - a; n = np.hypot(*v) or 1
    d = [abs(v[0] * (p[1] - a[1]) - v[1] * (p[0] - a[0])) / n for p in pts[1:-1]]; i = int(np.argmax(d)) + 1
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol) if d[i - 1] > tol else [pts[0], pts[-1]]

def offset(pts, d, grid):
    """Robust inward offset of a polygon by d on a raster grid (x0, y0, res, nx, ny): the eroded region traced and smoothed."""
    m = raster(pts, *grid) & (edge_dist(pts, *grid) > d); loop = contour(m, *grid[:3])
    dense = []
    for a, b in zip(loop, loop[1:] + loop[:1]):
        k = max(1, round(math.hypot(b[0] - a[0], b[1] - a[1]) / grid[2])); dense += [(a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k) for j in range(k)]
    p = np.array(dense)
    for _ in range(3): p = (np.roll(p, 1, 0) + 2 * p + np.roll(p, -1, 0)) / 4
    p = [tuple(map(float, q)) for q in p]; k = int(np.argmax([math.dist(p[0], q) for q in p]))
    return simplify(p[:k + 1], grid[2] * .12)[:-1] + simplify(p[k:] + p[:1], grid[2] * .12)[:-1]

def mirror(pts, cy): return [(p[0], 2 * cy - p[1], *p[2:]) for p in reversed(pts)]
def smooth(pts, r=.25, n=6):
    """Polygon with per-vertex corner radii: points are (x, y) or (x, y, r)."""
    return fillet([p[:2] for p in pts], [p[2] if len(p) > 2 else r for p in pts], n)
def sym(half, cy, r=.25, n=6):
    """Closed outline from its upper half (stern to nose tip on the centerline), mirrored about cy."""
    full = half + mirror(half, cy)[1:]
    return smooth(full[:-1] if abs(half[0][1] - cy) < 1e-6 else full, r, n)
def wpts(pts): return [(p[0], -p[1]) for p in pts]
def ellipse(cx, cy, rx, ry, n=40, t0=0, t1=2 * math.pi): return [(cx + rx * math.cos(t0 + (t1 - t0) * i / n), cy + ry * math.sin(t0 + (t1 - t0) * i / n)) for i in range(n)]
def quad(cx, cy, w, h, a=0.):
    c, s = math.cos(a), math.sin(a)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
def rect(x0, y0, x1, y1): return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
def oval(cx, cy, rx, ry, p=2., n=72, x0=-99.):
    """Superellipse (p > 2 is boxier), optionally cut flat at x0."""
    f = lambda t: math.copysign(abs(t) ** (2 / p), t)
    return [(max(x0, cx + rx * f(math.cos(2 * math.pi * i / n))), cy + ry * f(math.sin(2 * math.pi * i / n))) for i in range(n)]
def strip(pts, w):
    """Polygon of width w along a polyline."""
    v = [Vector(p[:2]) for p in pts]; n = len(v); side = []
    for i, p in enumerate(v):
        d = (v[min(i + 1, n - 1)] - v[max(i - 1, 0)]).normalized(); side.append(Vector((-d.y, d.x)) * w / 2)
    return [tuple(p + o) for p, o in zip(v, side)] + [tuple(p - o) for p, o in zip(v[::-1], side[::-1])]
def mounts(hull):
    """Turret mounts exactly as render/scene.ts mountPoint places them: (x, y) in grid cells."""
    room = next((r for r in hull['rooms'] if r['system'] == 'weapons'), hull['rooms'][0]); out = []
    for i in range(hull['weaponSlots']):
        cx = room['x'] + room['w'] * [.72, .28, .5, .9, .1][(i >> 1) % 5]; col = min(hull['gridW'] - 1, math.floor(cx))
        cover = [r for r in hull['rooms'] if r['x'] <= col < r['x'] + r['w']]
        out.append((cx, max(r['y'] + r['h'] for r in cover) + .24 if i % 2 else min(r['y'] for r in cover) - .24))
    return out
def hashed(v): return (np.sin(v * 12.9898 + 4.1) * 43758.5453) % 1

def cut(ob, polys, z0, z1, mat, name='cut'):
    """Boolean-subtract extruded polygons (grid coords) from ob; new faces take mat."""
    bm = bmesh.new()
    for pts in polys:
        pts = wpts(pts); pts = pts if area(pts) > 0 else pts[::-1]
        lo = [bm.verts.new((x, y, z0)) for x, y in pts]; hi = [bm.verts.new((x, y, z1)) for x, y in pts]
        bm.faces.new(lo[::-1]); bm.faces.new(hi)
        for i in range(len(pts)): bm.faces.new((lo[i], lo[(i + 1) % len(pts)], hi[(i + 1) % len(pts)], hi[i]))
    c = from_bm(bm, name, mat); c.hide_render = True
    m = ob.modifiers.new(name, 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'; m.material_mode = 'TRANSFER'

class Ship:
    def __init__(s, hull, pal, seed=1):
        s.hull, s.pal, s.rng = hull, pal, random.Random(seed)
        s.W, s.H = hull['gridW'], hull['gridH']; s.cy = s.H / 2
        s.g, s.t = ((-MX, -MY, r, round((s.W + 2 * MX) / r), round((s.H + 2 * MY) / r)) for r in (RES, TEX))
        s.px, s.py = np.meshgrid(-MX + (np.arange(s.g[3]) + .5) * RES, -MY + (np.arange(s.g[4]) + .5) * RES)
        s.tex = float_image('panels', s.t[3], s.t[4]); box = (-MX, -s.H - MY, s.W + 2 * MX, s.H + 2 * MY)
        org, base, grime = pal.get('organic'), pal['paint'], pal.get('grime', .12)
        s.m = dict(
            armor=chitin('armor', base, True) if org else armor('armor', base, s.tex, box, grime=grime),
            armor2=chitin('armor2', tuple(c * .58 for c in base), True, scale=2.4) if org else None,
            frame=plated('frame', pal['frame'], plate=(1.3, .42), metal=.6, rough=.3, seam=.45, variance=.07, grime=.06, ao=.4),
            metal=plated('metal', pal['metal'], plate=(.5, .25), metal=.55, rough=.38, seam=.45, variance=.18, grime=grime),
            dark=plain('dark', pal['dark'], .55, .4), trim=plain('trim', pal['trim'], .3, .75),
            deck=plated('deck', pal['deck'], plate=(1, 1), seam=.55, bump=.05, variance=.05, grime=.04, metal=.1, rough=.8, ao=.3),
            glass=plain('glass', (.012, .03, .055), .06, 0, emit=pal['glass'], estr=.45, coat=1),
            crimson=plain('crimson', (.8, .07, .08), .4), glow=glow('glow', pal['glow'], 1.2), core=glow('core', tuple(.25 + .75 * c for c in pal['glow']), 1.5), halo=halo_mat('halo', pal['glow'], 1.1))
        for name, col in (('red', (1, .15, .1)), ('green', (.2, 1, .35)), ('white', (1, .95, .85)), ('lamp', pal.get('lamp', pal['glow']))):
            s.m[name] = glow(name, col, 3); s.m['halo_' + name] = halo_mat('halo_' + name, col, 1.3)
        s.rm = np.zeros(s.px.shape, bool)
        for r in hull['rooms']: s.rm |= (s.px > r['x']) & (s.px < r['x'] + r['w']) & (s.py > r['y']) & (s.py < r['y'] + r['h'])
        s.mounts = mounts(hull); s.clean = np.zeros_like(s.rm)
        for x, y in s.mounts: s.clean |= (s.px > x - .32) & (s.px < x + .7) & (abs(s.py - y) < .26)
        s.zmap = np.zeros(s.rm.shape, np.float32); s.decor = np.zeros_like(s.rm); s.parts, s.accents = [], []

    def mask(s, pts): return raster(pts, *s.g)
    def inside(s, mask, p):
        i, j = s.idx(*p); return bool(mask[i, j])

    def mark(s, pts, z1, decor=False):
        m = s.mask(pts)
        if z1 > .13 and (m & s.rm & dilate(s.rm, -2)).any(): raise ValueError(f'{s.hull["id"]}: part over a room near {pts[0]}')
        if any(not (-MX + .06 < p[0] < s.W + MX - .06 and -MY + .06 < p[1] < s.H + MY - .06) for p in pts): raise ValueError(f'{s.hull["id"]}: part leaves the sprite near {pts[0]}')
        s.zmap[m] = np.maximum(s.zmap[m], z1)
        if decor: s.decor |= m

    # ----- hull masses -----
    def body(s, outline, z=.34, step=.13, edge=.12, band=.15, gap=1.2, lip=.08, tone=(.5, 1.), mats=('armor', 'armor')):
        """Sculpted main hull: a darker painted lower tier along the outline and an inset upper plate deck split by gaps.
        The outline must hold every room with margin; rooms become a dark deck recess ringed by a thin metal lip."""
        miss = dilate(s.rm, round(.16 / RES)) & ~s.mask(outline)
        if miss.any(): i, j = np.argwhere(miss)[0]; raise ValueError(f'{s.hull["id"]}: body misses rooms near ({s.px[i, j]:.2f}, {s.py[i, j]:.2f})')
        off = [p for p in s.mounts if not s.inside(s.mask(inset(outline, .15)), p)]
        if off: raise ValueError(f'{s.hull["id"]}: turret mount {off[0]} is off the hull')
        s.outline, s.z, upper = outline, z, offset(outline, step, s.g)
        lo, hi = min(p[0] for p in upper), max(p[0] for p in upper); n = max(1, round((hi - lo) / gap))
        xs = [lo + (hi - lo) * (j + s.rng.uniform(.35, .65)) / n for j in range(n)][:-1] if n > 1 else []
        low = prism(wpts(outline), 0, z - .1, s.m[mats[0]], 'hull', bevel=edge, segs=4, angle=30)
        top = prism(wpts(upper), .06, z, s.m[mats[1]], 'deck', bevel=.035, segs=2, angle=30)
        cut(top, [rect(x - .025, -MY - 1, x + .025, s.H + MY + 1) for x in xs], z - .08, z + 1, s.m['armor'])
        ring, deck = dilate(s.rm, round(lip / RES)), dilate(s.rm, 1)
        for ob in (low, top): cut(ob, [contour(ring, -MX, -MY, RES)], z - .045, z + 1, s.m['frame']); cut(ob, [contour(deck, -MX, -MY, RES)], .1, z + 1, s.m['deck'])
        for ob in (low, top):  # an exact boolean returns nothing if the bevel self-intersects at tight concave corners: shrink it until it holds
            while not len(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons) and ob.modifiers['bevel'].width > .005: ob.modifiers['bevel'].width *= .6
        m = s.mask(outline); s.zmap[m] = np.maximum(s.zmap[m], z - .1); m = s.mask(upper); s.zmap[m] = z
        for x in xs: s.zmap[m & (abs(s.px - x) < .04)] = z - .08
        s.zmap[ring] = z - .045; s.zmap[deck] = .1
        s.parts += [dict(pts=outline, z=z - .1, band=0, seams=None, tone=tone[0]), dict(pts=upper, z=z, band=band, seams=xs, tone=tone[1], body=True)]

    def part(s, pts, z0, z1, mat='armor', edge=.05, r=0., n=4, band=.1, seams=None, tone=1., decor=False, segs=3):
        """Beveled extruded mass; armor parts join the panel texture (edge band, seams every `seams` cells, tone)."""
        if r: pts = smooth(pts, r, n)
        if hasattr(s, 'z') and min(abs(z1 - s.z), abs(z1 - s.z + .1)) < .006: z1 += .012  # never coplanar with a hull tier (z-fighting speckles)
        s.mark(pts, z1, decor)
        if mat == 'armor': s.parts.append(dict(pts=pts, z=z1, band=band, seams=seams, tone=tone))
        return prism(wpts(pts), z0, z1, s.m[mat], 'part', bevel=edge, segs=segs)

    def both(s, pts, *a, **k):
        """Part and its mirror about the ship's centerline."""
        s.part(pts, *a, **k); s.part(mirror(pts, s.cy), *a, **k)

    def accent(s, pts, tone=.6):
        """Darker painted panel (still tinted by the captain color) with a seam around it."""
        s.accents.append((pts, tone))

    def nacelle(s, x0, x1, y, r, z0=.04, z1=.3, tone=.9, band=.08, seams=.7, cap='metal', nozzle=True):
        """Engine pod: rounded painted capsule, a metal intake cap at the front and a glowing nozzle at the stern."""
        pts = smooth([(x0, y - r * .82, r * .3), (x1 - r * 1.6, y - r, r * 1.4), (x1, y, r * .5), (x1 - r * 1.6, y + r, r * 1.4), (x0, y + r * .82, r * .3)], n=6)
        s.part(pts, z0, z1, 'armor', min(r * .55, (z1 - z0) * .48), band=band, seams=seams, tone=tone, decor=True, segs=4)
        if cap: s.part(smooth([(x1 - r * 1.05, y - r * .72, .05), (x1 - r * .55, y - r * .5, r * .3), (x1 - r * .1, y, r * .25), (x1 - r * .55, y + r * .5, r * .3), (x1 - r * 1.05, y + r * .72, .05)]), z1 - .06, z1 + .01, cap, .02, decor=True)
        s.part(rect(x0 + .06, y - r * .74, x0 + .16, y + r * .74), z1 - .06, z1 + .012, 'frame', .01, decor=True)
        if nozzle: s.nozzle(x0 + .08, y, r * .72, .22, (z0 + z1) / 2, 1.1, .8)

    def box(s, x, y, w, h, z0, z1, mat='metal', bevel=.015, decor=False):
        return s.part(rect(x, y, x + w, y + h), z0, z1, mat, bevel, decor=decor)

    def rod(s, a, b, r, z, mat='metal', r2=None, segs=16):
        d = Vector(b) - Vector(a); s.mark(quad(*((Vector(a) + Vector(b)) / 2), d.length, 2 * max(r, r2 or 0), math.atan2(d.y, d.x)), z + max(r, r2 or 0))
        return cone((a[0], -a[1], z), (b[0], -b[1], z), r, r if r2 is None else r2, s.m[mat], 'rod', segs)

    def pipe(s, pts, r, z, mat='metal'):
        for a, b in zip(pts, pts[1:]): s.rod(a, b, r, z, mat, segs=10)
        for p in pts[1:-1]: ellipsoid((p[0], -p[1], z), (r, r, r), s.m[mat], 'joint', 10)

    def card(s, x, y, z, rx, ry, mat):
        """Glow card clamped so its falloff ends inside the sprite."""
        e = .08; rx = min(rx, x + MX - e, s.W + MX - e - x); ry = min(ry, y + MY - e, s.H + MY - e - y)
        card((x, -y, z), rx, ry, s.m[mat])

    def nozzle(s, x, y, r, L, z=.2, flare=1.25, plume=1.):
        """Engine bell from x (attach) back to x-L, with an emissive core and a compact glow at the exit."""
        s.rod((x + .05, y), (x - L * .45, y), r * .8, z, 'dark')
        s.rod((x - L * .45, y), (x - L, y), r * .85, z, 'metal', r * flare)
        ex = x - L; ellipsoid((ex - .02, -y, z), (.06 + r * .35 * plume, r * .95, r * .4), s.m['glow'], 'plume')
        ellipsoid((ex - .01, -y, z + .05), (.03 + r * .2 * plume, r * .55, r * .3), s.m['core'], 'core')
        s.card(ex - .12 * plume, y, z + .5, (.28 + r * .9) * plume, r * 1.9, 'halo')

    def slit(s, x, y, w, h, z, color='glow', halo=1.6):
        """Flat emissive strip (ion thrusters, light bars) with a soft halo."""
        s.box(x, y, w, h, z - .02, z, color, .005)
        s.card(x + w / 2, y + h / 2, z + .4, w / 2 + .12 * halo, h / 2 + .12 * halo, 'halo' if color == 'glow' else 'halo_' + color)

    def canopy(s, x, y, lx, ly, z=None, rot=0.):
        z = s.z if z is None else z
        ellipsoid((x, -y, z), (lx + .05, ly + .05, .06), s.m['frame'], 'frame', rot=rot)
        ellipsoid((x, -y, z + .02), (lx, ly, .13), s.m['glass'], 'glass', rot=rot)
        c, sn = math.cos(rot), math.sin(rot)
        s.rod((x - lx * .55 * c, y + lx * .55 * sn), (x + lx * .75 * c, y - lx * .75 * sn), .016, z + .14, 'frame', segs=8)
        s.mark(ellipse(x, y, lx + .1, ly + .1, 16), z + .15, True)

    def visor(s, pts, z=None, r=.1):
        """Polygon canopy: glossy glass in a dark frame."""
        z = s.z if z is None else z; pts = smooth(pts, r) if r else pts
        s.part(inset(pts, -.045), z - .04, z + .03, 'frame', .02, decor=True); s.part(pts, z - .02, z + .08, 'glass', .05, segs=3, decor=True)

    def trim(s, pts, w=.05, z=None, mat='trim'):
        """Thin flat strip along a polyline, resting on the surface beneath."""
        q = strip(pts, w)
        if z is None: _, _, (i0, i1, j0, j1) = s.footprint(s.zmap > 0, q); z = float(s.zmap[i0:i1 + 1, j0:j1 + 1].max())
        s.part(q, z - .01, z + .012, mat, .006, decor=True)

    def light(s, x, y, color='red', r=.045, z=None, halo=4.):
        z = (float(s.zmap[s.idx(x, y)]) if z is None else z) + .02
        ellipsoid((x, -y, z), (r, r, r), s.m[color], 'lamp'); s.card(x, y, z + .3, r * halo, r * halo, 'halo_' + color)

    def radiator(s, x, y, w, h, z0, z1, fins=None, vertical=None):
        """Dark recessed block with metal cooling fins."""
        s.box(x, y, w, h, z0, z1, 'dark', .012, True); vertical = w > h if vertical is None else vertical
        n = fins or max(3, int((w if vertical else h) / .09))
        for j in range(n):
            t = (j + .5) / n
            if vertical: s.box(x + t * w - .015, y + .03, .03, h - .06, z1 - .01, z1 + .025, 'metal', .008)
            else: s.box(x + .03, y + t * h - .015, w - .06, .03, z1 - .01, z1 + .025, 'metal', .008)

    def hazard(s, x, y, w, h, z, step=.2):
        """Yellow/black warning chevrons on a dark strip."""
        s.box(x, y, w, h, z - .01, z + .01, 'dark', .005, True); t = x + .04
        while t + h * .6 + .1 < x + w - .02:
            s.part([(t, y + h - .03), (t + .09, y + h - .03), (t + .09 + h * .6, y + .03), (t + h * .6, y + .03)], z, z + .018, 'trim', .004); t += step

    def idx(s, x, y): return min(s.zmap.shape[0] - 1, max(0, int((y + MY) / RES))), min(s.zmap.shape[1] - 1, max(0, int((x + MX) / RES)))

    def region(s, margin=.1):
        """Flat hull surface for surface detail: off the rooms, silhouette edge, weapon edges and decor."""
        k = round(margin / RES); cover = s.zmap > 0
        return cover & ~dilate(s.rm, round(.16 / RES)) & dilate(cover, -k) & ~dilate(s.clean, k) & ~dilate(s.decor, 2)

    def footprint(s, reg, pts):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]; (i0, j0), (i1, j1) = s.idx(min(xs), min(ys)), s.idx(max(xs), max(ys))
        sub = raster(pts, -MX + j0 * RES, -MY + i0 * RES, RES, j1 - j0 + 1, i1 - i0 + 1); z = s.zmap[i0:i1 + 1, j0:j1 + 1][sub]
        ok = sub.any() and reg[i0:i1 + 1, j0:j1 + 1][sub].all() and z.max() - z.min() < .004
        return ok, (float(z.max()) if ok else 0), (i0, i1, j0, j1)

    def scatter(s, count, make, size, reg=None, tries=40):
        """Place `count` items whose footprint is flat, free hull surface; make(cx, cy, w, h, angle, z)."""
        reg = s.region() if reg is None else reg; ys, xs = np.nonzero(reg)
        for _ in range(count * tries if len(xs) else 0):
            if count <= 0: break
            i = s.rng.randrange(len(xs)); cx, cy = float(s.px[ys[i], xs[i]]), float(s.py[ys[i], xs[i]])
            w, h, a = size()
            ok, z, (i0, i1, j0, j1) = s.footprint(reg, quad(cx, cy, w + .04, h + .04, a))
            if not ok: continue
            reg[max(0, i0 - 2):i1 + 3, max(0, j0 - 2):j1 + 3] = False; count -= 1; make(cx, cy, w, h, a, z)

    def greebles(s, count, kinds=('box', 'vent', 'dome', 'hatch')):
        def make(cx, cy, w, h, a, z):
            kind = s.rng.choice(kinds)
            if kind == 'box': s.box(cx - w / 2, cy - h / 2, w, h, z - .02, z + s.rng.uniform(.02, .045), s.rng.choice(('metal', 'frame')))
            elif kind == 'vent': s.radiator(cx - w / 2, cy - h / 2, w, h, z - .02, z + .01, 4)
            elif kind == 'dome': ellipsoid((cx, -cy, z), (min(w, h) / 2, min(w, h) / 2, .03), s.m['metal'], 'dome')
            else: s.box(cx - w / 2, cy - h / 2, w, h, z - .02, z + .008, 'frame', .01)
        def size():
            w, h = s.rng.uniform(.12, .26), s.rng.uniform(.08, .14)
            return (w, h, 0) if s.rng.random() < .5 else (h, w, 0)
        s.scatter(count, make, size)

    def patch(s, cx, cy, w, h, a, mat, z=None):
        """Welded-on repair plate with corner rivets, resting on the highest surface beneath it."""
        q = quad(cx, cy, w, h, a)
        if z is None: _, _, (i0, i1, j0, j1) = s.footprint(s.zmap > 0, q); z = float(s.zmap[i0:i1 + 1, j0:j1 + 1].max())
        s.part(q, z - .01, z + .022, mat, .012)
        for p in inset(q, .045): ellipsoid((p[0], -p[1], z + .022), (.018, .018, .012), s.m['metal'], 'rivet', 8)

    def patches(s, count, mats=('armor', 'metal', 'armor'), size=(.25, .55), tilt=.25):
        s.scatter(count, lambda cx, cy, w, h, a, z: s.patch(cx, cy, w, h, a, s.rng.choice(mats), z), lambda: (s.rng.uniform(*size), s.rng.uniform(size[0], size[1] * .7), s.rng.uniform(-tilt, tilt)))

    # ----- panel texture -----
    def panels(s, w=.03):
        """Bake the armor texture: per-part edge bands and transverse seams, a frame seam around the rooms, scattered hatches,
        per-panel tone, accents and the pillow height."""
        x0, y0, res, nx, ny = s.t; R = lambda pts: raster(pts, *s.t); k = max(1, round(w / res))
        tx = x0 + (np.arange(nx) + .5) * res; below = (y0 + (np.arange(ny) + .5) * res > s.cy)[:, None]
        seam = np.zeros((ny, nx), bool); tone = np.ones((ny, nx), np.float32); top = np.full((ny, nx), -1)
        parts = sorted(s.parts, key=lambda p: p['z']); masks = [R(p['pts']) for p in parts]
        for i, m in enumerate(masks): top[m] = i
        for i, p in enumerate(parts):
            own = top == i
            inner = R(inset(p['pts'], p['band'])) if p['band'] else masks[i]
            if p['band']: seam |= own & inner & ~R(inset(p['pts'], p['band'] + w))
            xs = []
            if isinstance(p['seams'], list): xs = p['seams']
            elif p['seams']:
                lo, hi = min(q[0] for q in p['pts']), max(q[0] for q in p['pts']); n = max(1, int((hi - lo) / p['seams']))
                xs = [lo + (hi - lo) * (j + .5 + s.rng.uniform(-.2, .2)) / n for j in range(n)]
                seam |= own & inner & (np.min([abs(tx - x) for x in xs], 0) < w / 2)[None, :]
            panel = np.digitize(tx, xs)[None, :] + 40 * inner + 80 * below + 160 * i
            tone = np.where(own, p['tone'] * (1 - .09 * hashed(panel)), tone)
            if p.get('body'):
                rt = raster(contour(s.rm, -MX, -MY, RES), *s.t); d = round(.3 / res)
                seam |= own & dilate(rt, d) & ~dilate(rt, d - k)
        for pts, t in s.accents:
            a = R(pts) & (top >= 0); tone[a] *= t; seam |= a & ~dilate(a, -k)
        rt = raster(contour(dilate(s.rm, round(.08 / RES)), -MX, -MY, RES), *s.t); free = (top >= 0) & ~rt
        hatch = dilate(free, -round(.12 / res)) & ~dilate(rt, round(.34 / res)) & ~seam
        for _ in range(int(hatch.sum() * res * res * 90)):
            j, i = s.rng.randrange(nx), s.rng.randrange(ny)
            if not hatch[i, j]: continue
            a, b = round(s.rng.uniform(.2, .5) / res / 2), round(s.rng.uniform(.12, .26) / res / 2); a, b = (a, b) if s.rng.random() < .6 else (b, a)
            win = (slice(max(0, i - b), i + b), slice(max(0, j - a), j + a))
            if not hatch[win].all(): continue
            seam[win] = True; seam[max(0, i - b) + 2:i + b - 2, max(0, j - a) + 2:j + a - 2] = False; tone[win] *= 1 + s.rng.uniform(-.1, .05); hatch[win] = False
        h = (~seam).astype(np.float32)
        for _ in range(2): h = (h + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 5
        pillow = np.zeros_like(h)
        for i in range(len(parts)): own = (top == i) & ~rt; pillow += own * blur(own.astype(np.float32), round(.16 / res))
        tone *= (.3 + .7 * h) * (.5 + .5 * pillow)
        fill_image(s.tex, np.dstack([h, tone ** 2.2, pillow, np.ones_like(h)]))  # tones are authored in display (sRGB-like) terms

    def finish(s):
        if not s.pal.get('organic'): s.panels()
        (i, j), rx, ry = np.nonzero(s.zmap > 0), (s.W + 2 * MX) * .485, (s.H + 2 * MY) * .47
        out = ((s.px[i, j] - s.W / 2) / rx) ** 2 + ((s.py[i, j] - s.cy) / ry) ** 2
        if out.max() > 1.25: print(f'WARNING {s.hull["id"]}: hull reaches {out.max() ** .5:.2f}× the shield ellipse')

# ---------- palettes ----------
BASE = dict(paint=(.86, .87, .88), dark=(.05, .055, .065), deck=(.008, .009, .011))
PAL = {k: {**BASE, **v} for k, v in {
    'wayfarer': dict(frame=(.13, .14, .16), metal=(.26, .27, .3), trim=(.98, .62, .16), glow=(.3, .72, 1), glass=(.2, .6, 1)),
    'lancer': dict(frame=(.11, .12, .14), metal=(.24, .25, .28), trim=(.82, .93, 1), glow=(.35, .85, 1), glass=(.3, .8, 1)),
    'bulwark': dict(frame=(.16, .16, .15), metal=(.3, .3, .29), trim=(.98, .72, .1), glow=(.45, .8, 1), glass=(.3, .9, .7)),
    'corsair': dict(frame=(.1, .09, .12), metal=(.22, .2, .25), trim=(.95, .72, .3), glow=(1, .35, .85), glass=(.9, .3, 1)),
    'halcyon': dict(frame=(.3, .32, .34), metal=(.45, .47, .5), trim=(.95, .95, .93), glow=(.35, 1, .85), glass=(.3, 1, .9), grime=.06),
    'lifeboat': dict(frame=(.2, .17, .14), metal=(.36, .3, .25), trim=(1, .5, .1), glow=(1, .7, .3), glass=(.4, .7, 1), lamp=(1, .5, .1), grime=.3),
    'raiders': dict(frame=(.16, .11, .08), metal=(.34, .2, .12), trim=(.95, .7, .1), glow=(1, .55, .2), glass=(1, .6, .2), lamp=(1, .45, .1), grime=.3),
    'vesk': dict(paint=(.82, .84, .76), frame=(.1, .12, .06), metal=(.14, .17, .08), trim=(.6, .9, .2), glow=(.55, 1, .25), glass=(.6, 1, .2), lamp=(.6, 1, .2), organic=True),
    'warden': dict(frame=(.2, .22, .26), metal=(.32, .34, .38), trim=(.55, .6, .68), glow=(.3, .65, 1), glass=(.3, .6, 1), lamp=(.35, .7, 1), grime=.05),
    'armada': dict(frame=(.022, .02, .024), metal=(.1, .09, .1), trim=(.95, .7, .28), glow=(1, .42, .14), glass=(1, .2, .15), lamp=(1, .2, .15), grime=.06),
}.items()}

# ---------- designs (grid coords; the room grid spans 0..W × 0..H) ----------
def wayfarer(s):
    """Balanced explorer: an arrowhead hull, big swept wings with wingtip rails and twin stern nacelles."""
    cy, H = s.cy, s.H
    s.body(sym([(-.55, .85, .15), (.3, .5, .45), (1.6, -.42, .5), (6.6, -.45, 1.), (8.3, .3, 1.), (9.6, .8, .6), (10.75, cy, .15)], cy))
    wing = [(6.7, -.3, .15), (2.9, -1.34, .1), (1.2, -1.36, .08), (1.05, -1.1, .1), (1.9, -.3, .1)]
    for f in (1, -1):
        y = lambda v: cy - f * (cy - v); m = (lambda q: q) if f > 0 else (lambda q: mirror(q, cy))
        s.part(m(wing), .02, .2, 'armor', .05, r=.2, band=.09, seams=.6, tone=.72)
        s.accent(m([(5.0, -.5), (2.35, -1.45), (1.85, -1.45), (4.3, -.5)]), .5)
        s.part(m(strip([(6.55, -.36), (2.9, -1.26)], .11)), .1, .23, 'dark', .03, decor=True)
        s.rod((.7, y(-1.22)), (3.3, y(-1.22)), .085, .22, 'metal', .06); s.rod((.45, y(-1.22)), (.75, y(-1.22)), .05, .22, 'dark', .085)
        s.trim(m([(1.8, -1.13), (3.9, -1.13)]), .035)
        s.radiator(2.2, y(-.58) - .1, 1.1, .2, s.z - .1, s.z - .06)
        s.part(rect(.7, y(.3) - .1, 1.5, y(.3) + .1), .2, .36, 'frame', .03, decor=True); s.nacelle(-1.0, 1.85, y(.3), .34, .2, .46)
        s.part(m([(7.9, .15), (9.0, .55), (9.7, 1.0), (8.9, 1.0), (7.9, .55)]), s.z - .02, s.z + .07, 'dark', .03, r=.08, decor=True)
    s.part(smooth([(-.95, .95, .1), (-.2, .95, .1), (-.2, 3.05, .1), (-.95, 3.05, .1)]), .04, .27, 'frame', .06, decor=True)
    for y in (1.5, 2.5): s.nozzle(-.55, y, .3, .68)
    s.accent(rect(9.35, -1, 11, 5), .62)
    for y0, y1 in ((-1, .6), (3.4, 5)): s.accent(rect(6.25, y0, 6.55, y1), .6)
    s.visor([(9.4, 1.55), (10.05, 1.7), (10.4, cy), (10.05, 2.3), (9.4, 2.45)])
    s.light(1.2, -1.25, 'red'); s.light(1.2, H + 1.25, 'green'); s.light(10.65, cy, 'white', .035)
    s.greebles(14)

def lancer(s):
    """Glass cannon: a needle hull flanked by long forward prongs, swept tail fins and one big engine."""
    cy, H = s.cy, s.H
    s.body(sym([(-.5, .72, .12), (.3, .42, .3), (.8, -.42, .15), (8.0, -.42, .5), (9.6, .35, .9), (10.9, .95, .5), (11.75, cy, .05)], cy), gap=1.4)
    prong = [(6.6, -.2, .1), (8.6, -.62, .3), (10.4, -.55, .4), (11.88, -.1, .02), (11.3, .05, .1), (9.8, .06, .2), (8.4, .08, .1)]
    fin = [(3.3, -.25, .1), (1.5, -1.3, .1), (.55, -1.38, .06), (.75, -1.1, .1), (1.2, -.25, .1)]
    for f in (1, -1):
        y = lambda v: cy - f * (cy - v); m = (lambda q: q) if f > 0 else (lambda q: mirror(q, cy))
        s.part(smooth(m(prong)), .02, .24, 'armor', .05, band=.07, seams=.7, tone=.78)
        s.part(m(strip([(8.2, -.25), (10.3, -.36), (11.4, -.1)], .12)), .18, .27, 'dark', .02, decor=True)
        s.part(smooth(m(fin)), .02, .18, 'armor', .05, band=.07, tone=.72)
        s.accent(m([(2.1, -1.5), (1.55, -1.5), (.5, -.6), (1.05, -.6)]), .5)
        s.trim(m([(1.45, -1.18), (3.0, -.3)]), .035)
        s.radiator(1.35, y(-.2) - .09, 1.4, .18, s.z - .1, s.z - .06)
        s.nacelle(-.95, .8, y(.3), .22, .1, .3, seams=None)
    s.part(smooth([(-.8, .92, .1), (-.1, .92, .1), (-.1, 2.08, .1), (-.8, 2.08, .1)]), .04, .27, 'frame', .06, decor=True)
    s.nozzle(-.35, cy, .42, .85)
    for y0, y1 in ((-1, -.2), (3.2, 4.4)): s.accent(rect(4.0, y0, 8.6, y1), .56)
    s.accent(rect(10.9, -1, 12, 4.4), .52)
    s.visor([(10.1, 1.25), (10.9, 1.36), (11.35, cy), (10.9, 1.64), (10.1, 1.75)], r=.08)
    s.light(.6, -1.25, 'red'); s.light(.6, H + 1.25, 'green'); s.light(11.8, -.1, 'white', .03); s.light(11.8, H + .1, 'white', .03)
    s.greebles(10)

def bulwark(s):
    """Shield wall: a chamfered armored slab behind thick bolted skirt plates, a stepped armored prow and a triple engine bank."""
    cy, H = s.cy, s.H
    s.body(sym([(-.6, .72, .1), (.55, .72, .15), (1.3, -.45, .2), (6.5, -.45, .2), (8.2, .35, .25), (9.0, 1.3, .15), (9.0, cy, 0)], cy), z=.36, step=.16, gap=1.)
    for f in (1, -1):
        y = lambda v: cy - f * (cy - v); m = (lambda q: q) if f > 0 else (lambda q: mirror(q, cy))
        for x0, x1 in ((1.45, 3.05), (3.2, 4.8), (4.95, 6.55)):
            s.part(m([(x0 + .25, -1.3), (x1 - .15, -1.3), (x1 + .1, -.35), (x0, -.35)]), .03, .42, 'armor', .09, r=.08, tone=.8, band=.09, seams=None)
            for x in (x0 + .3, x1 - .2): ellipsoid((x, -y(-1.12), .42), (.05, .05, .03), s.m['metal'], 'bolt', 10)
        s.hazard(1.75, y(-1.12) - .08, 4.5, .16, .43, .3)
        s.part(m([(6.7, -.3), (7.7, -.3), (9.0, .9), (9.45, 1.5), (9.0, 1.5), (7.9, .45)]), .04, .44, 'armor', .07, r=.1, tone=.72, band=.07, decor=True)
        s.accent(m(rect(1.2, -1.5, 6.8, -.75)), .7)
    s.part(smooth([(8.25, .95), (8.9, 1.25), (9.5, 1.8), (9.5, 3.2), (8.9, 3.75), (8.25, 4.05)], .15), .06, .46, 'armor', .08, band=.08, tone=.85, decor=True)
    s.part(rect(9.18, 1.8, 9.36, 3.2), .44, .49, 'glass', .02, decor=True)
    s.part(smooth([(-1.0, .8, .1), (-.2, .8, .1), (-.2, 4.2, .1), (-1.0, 4.2, .1)]), .04, .3, 'frame', .07, decor=True)
    for y in (1.5, 2.5, 3.5): s.nozzle(-.6, y, .32, .62)
    for y in (.98, 4.02): s.nozzle(-.6, y, .14, .42, .24)
    s.accent(rect(8.2, -1, 10, 1.05), .6); s.accent(rect(8.2, 3.95, 10, 6), .6)
    s.light(1.5, -1.36, 'red'); s.light(1.5, H + 1.36, 'green'); s.light(9.45, cy, 'white', .035)
    s.greebles(12, ('box', 'vent', 'hatch'))

def corsair(s):
    """Boarder: a raptor hull whose brow sweeps into a hooked beak, scythe wings and boarding clamps over the teleporter."""
    cy, H = s.cy, s.H
    s.body(smooth([(-.55, .8, .12), (.55, .45, .35), (1.55, -.42, .45), (6.4, -.42, .8), (8.6, -.05, .9), (10.2, .7, .7), (10.9, 1.9, .4), (10.8, 3.3, .04),
                   (10.2, 2.85, .2), (9.3, 3.3, .45), (7.4, 3.5, .5), (6.4, 4.42, .5), (3.6, 4.42, .6), (2.6, 3.5, .5), (.6, 3.55, .35), (-.55, 3.2, .12)], n=8))
    s.part(smooth([(5.6, -.3), (3.8, -.9, .5), (1.2, -1.38, .05), (1.9, -.9, .3), (2.6, -.3)]), .02, .18, 'armor', .05, band=.07, seams=.55, tone=.74)
    s.part(smooth([(8.3, 3.4), (5.6, 4.9, .5), (2.1, 5.4, .05), (3.3, 4.75, .4), (4.3, 4.35), (6.4, 4.3)]), .02, .18, 'armor', .05, band=.07, seams=.55, tone=.74)
    s.accent([(4.6, -1.5), (2.0, -1.5), (2.4, -.6), (4.6, -.6)], .5); s.accent([(6.0, 4.5), (6.0, 5.6), (2.8, 5.6), (3.4, 4.5)], .5)
    for x in (4.3, 5.0, 5.7): s.part([(x - .16, -.3), (x - .1, -.72), (x + .14, -.8), (x + .02, -.62), (x + .1, -.3)], .2, .42, 'frame', .02)
    s.part(smooth([(8.7, .0), (10.1, .65, .6), (10.85, 1.8, .4), (10.9, 3.38, .02), (10.45, 2.9, .15), (10.2, 2.2, .2), (9.6, 1.2, .3), (8.7, .55)]), .06, .46, 'armor', .07, band=.06, tone=.6, decor=True)
    s.part(strip([(9.3, 3.28), (10.2, 3.05), (10.55, 3.25)], .1), .08, .3, 'dark', .02, decor=True)
    s.part(smooth([(-.95, .9, .1), (-.2, .9, .1), (-.2, 3.1, .1), (-.95, 3.1, .1)]), .04, .27, 'frame', .06, decor=True)
    for y in (1.5, 2.5): s.nozzle(-.55, y, .3, .68)
    s.trim([(8.9, .2), (10.0, .8), (10.62, 1.85), (10.7, 3.0)], .05)
    s.visor([(9.2, 1.45), (9.75, 1.55), (10.05, 1.95), (9.75, 2.35), (9.2, 2.4)])
    s.trim([(1.5, -1.25), (3.8, -.8), (5.2, -.32)], .04); s.trim([(2.5, 5.28), (5.3, 4.82), (8.0, 3.5)], .04)
    s.light(1.25, -1.3, 'red'); s.light(2.2, 5.33, 'green'); s.light(10.86, 3.3, 'white', .03)
    s.greebles(14)

def halcyon(s):
    """Fleet medic: a smooth egg hull, swept pylons carrying teardrop outrigger pods, medical roundels and a big bubble canopy."""
    cy, H = s.cy, s.H
    s.body(smooth(oval(4.5, cy, 5.9, 2.5, 2.2, 72, -.6), 0), step=.14, gap=1.6, edge=.16)
    for f, lamp in ((1, 'red'), (-1, 'green')):
        py = cy - f * 2.78; m = (lambda q: q) if f > 0 else (lambda q: mirror(q, cy))
        s.part(smooth(m([(4.6, -.3, .3), (3.4, -.95, .2), (2.2, -.95, .2), (2.6, -.3, .3)])), .1, .26, 'armor', .05, band=.06, tone=.8, decor=True)
        s.part(smooth([(.95, py - .2, .12), (3.2, py - .3, .6), (4.75, py, .28), (3.2, py + .3, .6), (.95, py + .2, .12)], n=6), .12, .42, 'armor', .12, band=.07, seams=.9, tone=.92, decor=True, segs=4)
        s.nozzle(1.0, py, .17, .3, .27, 1.1, .8)
        ellipsoid((3.45, -py, .43), (.19, .19, .025), s.m['trim'], 'disc'); s.mark(ellipse(3.45, py, .23, .23, 16), .46, True)
        for w, h in ((.24, .08), (.08, .24)): s.box(3.45 - w / 2, py - h / 2, w, h, .44, .47, 'crimson', .006, True)
        s.slit(1.6, py - .025, 1.2, .05, .43, 'lamp', .8)
        s.light(4.7, py, lamp)
        ex = 7.25; ey = cy - f * 1.62
        ellipsoid((ex, -ey, s.z + .005), (.25, .25, .02), s.m['trim'], 'disc'); s.mark(ellipse(ex, ey, .28, .28, 16), s.z + .03, True)
        for w, h in ((.3, .1), (.1, .3)): s.box(ex - w / 2, ey - h / 2, w, h, s.z + .01, s.z + .035, 'crimson', .006, True)
    s.accent(smooth([(8.9, -1), (11, -1), (11, 5), (8.9, 5)], 0), .7)
    for x in (.7, 8.35): s.accent(rect(x, -1, x + .22, 5), .68)
    s.canopy(9.75, cy, .5, .46, s.z)
    s.part(smooth(oval(-.55, cy, .4, 1.35, 2.4, 40), 0), .04, .27, 'frame', .05, decor=True)
    for y in (1.5, 2.5): s.nozzle(-.55, y, .28, .66)
    s.light(10.35, cy, 'white', .035)
    s.greebles(8, ('dome', 'dome', 'vent', 'hatch'))

def lifeboat(s):
    """Salvage: a stubby escape pod with welded scrap plates, a strapped fuel tank and one big thruster."""
    cy, H = s.cy, s.H
    s.body(smooth([(-.5, .25, .15), (1.0, -.45, .45), (3.3, -.4, .5), (5.9, .1, .9), (7.1, cy, .5), (5.9, 2.9, .9), (3.3, 3.4, .5), (1.0, 3.45, .45), (-.5, 2.75, .15)]), gap=1.5)
    s.part([(3.5, 3.2), (5.6, 3.0), (5.1, 3.6), (3.9, 3.8)], .02, .2, 'armor', .03, tone=.62, band=.06)
    s.part(ellipse(6.55, cy, .6, .72, 32), .06, .44, 'armor', .08, tone=.8, band=.08, decor=True)
    s.canopy(6.6, cy, .3, .3, .44)
    s.part(smooth([(-.95, .9, .1), (-.2, .9, .1), (-.2, 2.1, .1), (-.95, 2.1, .1)]), .04, .27, 'frame', .06, decor=True)
    s.nozzle(-.5, cy, .34, .72)
    s.rod((-1.0, .15), (.85, .15), .16, .3, 'metal', .12); s.nozzle(-.95, .15, .11, .26, .3)
    for x in (-.4, .5): s.box(x, .0, .08, .3, .28, .48, 'dark', .005, True)
    for x, y, w, h, a, mat in ((4.1, .15, .5, .24, .15, 'trim'), (5.2, 2.75, .42, .26, -.2, 'armor'), (2.0, -.25, .5, .2, .08, 'metal'), (1.55, 3.22, .5, .2, -.1, 'metal'), (4.6, 3.35, .45, .22, .25, 'trim')): s.patch(x, y, w, h, a, mat)
    s.patches(5); s.hazard(3.7, .12, 1.1, .14, s.z)
    s.pipe([(3.6, 2.95), (4.4, 3.3), (5.2, 3.25)], .03, s.z + .02)
    s.rod((5.7, .45), (5.2, -.35), .018, .44, 'metal'); s.light(5.2, -.35, 'lamp', .04, .44)
    s.greebles(6)

def welds(s, pts, z, n=None):
    """Rivet row along a polyline (weld seams on scrap plates)."""
    for a, b in zip(pts, pts[1:]):
        k = n or max(2, int(math.dist(a, b) / .16))
        for j in range(k + 1): t = j / k; ellipsoid((a[0] + (b[0] - a[0]) * t, -(a[1] + (b[1] - a[1]) * t), z), (.022, .022, .014), s.m['metal'], 'rivet', 8)

def skiff(s):
    """Raider scout: a faceted dart, one big welded blade fin underneath, a spiked top plate and a ram spike."""
    cy, H = s.cy, s.H
    s.body(smooth([(-.5, .55, .05), (.6, -.42, .05), (3.2, -.42, .05), (6.1, .7, .05), (7.55, 1.45, .02), (6.3, 2.2, .05), (3.4, 3.42, .05), (.6, 3.42, .05), (-.5, 2.45, .05)]), gap=1.1, edge=.06)
    s.part([(.9, 3.25), (3.6, 3.25), (6.4, 2.3), (4.4, 4.0), (1.6, 4.35), (.7, 3.9)], .02, .18, 'armor', .04, band=.07, seams=.55, tone=.66)
    s.accent([(2.2, 3.5), (3.4, 3.5), (2.6, 4.4), (1.9, 4.4)], .5); welds(s, [(1.0, 3.4), (3.5, 3.4), (5.6, 2.75)], .19)
    s.part([(3.5, -.3), (4.3, -.85), (6.3, -.1), (6.9, .65), (5.6, .55), (4.6, .0)], .1, .3, 'armor', .03, tone=.58, band=0)
    welds(s, [(4.3, -.7), (6.2, -.05), (6.6, .5)], .31)
    for x in (4.6, 5.2, 5.8): s.part([(x, -.15 + (x - 4.6) * .35), (x + .1, -.75 + (x - 4.6) * .35), (x + .25, -.12 + (x - 4.6) * .35)], .2, .36, 'metal', .015)
    s.part([(6.9, 1.28), (7.9, cy), (6.9, 1.72)], .1, .38, 'metal', .03, decor=True)
    s.part(rect(-.95, .75, -.2, 2.25), .04, .27, 'frame', .05, decor=True)
    s.nozzle(-.5, cy, .3, .72); s.nozzle(-.4, .82, .14, .5, .22)
    s.hazard(1.4, 3.75, 1.9, .16, .19); s.patches(5); s.trim([(3.6, -.22), (6.0, .78)], .04)
    s.rod((.3, .1), (-.4, -.9), .018, .32, 'metal'); s.light(-.4, -.9, 'lamp', .035, .32)
    s.visor([(6.2, 1.25), (6.85, 1.4), (7.0, cy), (6.85, 1.6), (6.2, 1.75)], r=.04)
    s.greebles(6)

def raider(s):
    """Raider brawler: a faceted wedge, a big bolted slab welded on one flank, dorsal spikes, a crooked ram and a salvaged third engine."""
    cy, H = s.cy, s.H
    s.body(smooth([(-.55, .7, .05), (1.7, -.45, .05), (4.5, -.45, .05), (7.5, .8, .05), (8.75, 1.85, .02), (8.5, 2.35, .03), (7.4, 3.3, .05), (4.5, 4.45, .05), (1.7, 4.45, .05), (-.55, 3.3, .05)]), gap=1.1, edge=.07)
    s.part([(1.0, 4.25), (4.7, 4.25), (7.3, 3.2), (7.9, 3.5), (5.9, 4.8), (2.2, 5.3), (.4, 4.9)], .02, .2, 'armor', .04, band=.07, seams=.6, tone=.66)
    s.accent([(3.0, 4.4), (4.4, 4.4), (3.8, 5.5), (2.6, 5.5)], .5); welds(s, [(1.1, 4.4), (4.7, 4.4), (7.2, 3.4)], .21)
    s.part([(4.6, -.3), (5.4, -.95), (7.9, .15), (8.3, .95), (7.3, .95)], .1, .36, 'armor', .03, tone=.58, band=0)
    welds(s, [(5.4, -.8), (7.8, .25)], .37)
    for x in (1.9, 2.7, 3.5): s.part([(x, -.3), (x + .15, -.85), (x + .35, -.3)], .02, .2, 'metal', .02)
    s.part([(7.4, 1.35), (8.9, 1.8), (7.5, 2.3)], .1, .38, 'metal', .03, decor=True)
    s.part(rect(-1.0, .6, -.2, 3.4), .04, .27, 'frame', .05, decor=True)
    for y, r in ((1.5, .3), (2.5, .3), (3.15, .18)): s.nozzle(-.55, y, r, .7)
    s.rod((.3, 4.75), (2.0, 4.75), .13, .24, 'metal', .11); s.nozzle(.35, 4.75, .11, .3, .24)
    s.hazard(2.4, 4.9, 2.2, .18, .21); s.patches(8)
    s.pipe([(5.0, 3.85), (5.8, 4.3), (6.6, 4.0)], .035, .22)
    s.rod((.3, .2), (-.6, -.85), .018, .32, 'metal'); s.light(-.6, -.85, 'lamp', .035, .32)
    s.visor([(7.3, 1.6), (7.95, 1.85), (7.85, 2.15), (7.2, 2.35)], r=.04)
    s.greebles(8)

def gunship(s):
    """Raider artillery: a broad faceted hull, a gun-battery slab slung under one flank, forward prongs and three engines."""
    cy, H = s.cy, s.H
    s.body(smooth([(-.55, .7, .05), (1.7, -.5, .05), (6.3, -.5, .05), (8.6, .7, .05), (9.8, 1.55, .04), (9.8, 2.45, .04), (8.6, 3.3, .05), (4.5, 4.5, .05), (1.7, 4.5, .05), (-.55, 3.3, .05)]), gap=1.2, edge=.08)
    s.part([(4.6, 4.3), (8.6, 3.15), (9.4, 3.7), (8.2, 4.9), (4.6, 5.1)], .02, .22, 'armor', .05, band=.07, seams=.6, tone=.66)
    for y in (4.35, 4.7): s.rod((5.0, y), (8.2, y), .065, .26, 'dark', .045, 10)
    welds(s, [(4.8, 4.2), (8.5, 3.2)], .23)
    s.part([(6.2, -.35), (6.8, -.95), (9.0, -.6), (9.9, .35), (8.9, .6)], .02, .2, 'armor', .04, band=.07, seams=.5, tone=.62)
    s.accent([(7.4, -1.5), (8.4, -1.5), (9.2, .7), (8.4, .7)], .5)
    s.part(smooth([(8.4, .85), (9.3, 1.25), (9.9, 2.0), (9.3, 2.75), (8.4, 3.15)], .1), .05, .44, 'armor', .05, band=.06, tone=.8, decor=True)
    s.part([(9.35, 1.7), (9.62, 1.85), (9.62, 2.15), (9.35, 2.3)], .42, .47, 'glass', .02, decor=True)
    s.part(rect(-1.05, .6, -.2, 3.4), .04, .27, 'frame', .05, decor=True)
    for y, r in ((1.5, .32), (2.5, .32), (.85, .16)): s.nozzle(-.55, y, r, .7)
    s.hazard(5.0, 4.88, 2.4, .16, .23); s.patches(7)
    s.radiator(4.35, -.38, 1.5, .22, s.z - .02, s.z + .01)
    s.light(8.8, -.6, 'lamp'); s.light(8.2, 4.8, 'lamp')
    s.greebles(10)

def drone(s):
    """Warden drone: a hard-edged faceted monolith with stacked blade vanes, blue light bars, ion slits and a sensor eye (no cockpit)."""
    cy, H = s.cy, s.H
    s.body(sym([(-.7, .45, .03), (.9, -.45, .03), (4.7, -.45, .03), (6.5, .35, .03), (7.55, 1.05, .03), (7.55, cy, 0)], cy), gap=.75, edge=.05, step=.1)
    for f in (1, -1):
        y = lambda v: cy - f * (cy - v); m = (lambda q: q) if f > 0 else (lambda q: mirror(q, cy))
        s.part(m([(1.3, -.3), (1.75, -1.36), (4.3, -1.36), (4.9, -.3)]), .02, .24, 'armor', .03, band=.07, seams=.45, tone=.74)
        s.part(m([(1.95, -.95), (2.15, -1.22), (4.05, -1.22), (4.2, -.95)]), .24, .28, 'frame', .01, decor=True)
        s.slit(2.2, y(-1.1) - .03, 1.8, .06, .29, 'lamp')
        s.part(m([(5.1, -.2), (5.5, -.72), (6.9, -.2), (6.95, .45), (6.3, .45)]), .02, .2, 'armor', .03, band=.06, tone=.66)
        s.slit(5.0, y(.1) - .025, 1.6, .05, s.z + .005, 'lamp', 1)
        s.slit(.7, y(-.12) - .025, 1.0, .05, s.z + .005, 'lamp', 1)
    s.part(smooth([(6.3, .95), (7.1, 1.1), (7.45, cy), (7.1, 1.9), (6.3, 2.05)], .06), .05, .42, 'metal', .03, decor=True)
    ellipsoid((6.95, -cy, .42), (.2, .2, .05), s.m['dark'], 'eye-ring'); ellipsoid((6.95, -cy, .44), (.12, .12, .07), s.m['lamp'], 'eye'); s.card(6.95, cy, .8, .5, .5, 'halo_lamp')
    s.part(rect(-1.15, .5, -.2, 2.5), .04, .28, 'frame', .04, decor=True)
    for y in (.8, 1.25, 1.75, 2.2): s.slit(-1.25, y - .09, .12, .18, .2)
    s.greebles(8, ('box', 'vent', 'hatch'))

def hive(s):
    """Vesk hive: a bulbous chitin abdomen, pinched waist and armored head; overlapping rib plates, legs, mandibles, a glowing maw and brood sacs."""
    cy, H = s.cy, s.H
    s.body(smooth([(-.6, 1.0, .5), (.4, -.25, .7), (2.0, -.62, .8), (4.2, -.55, .7), (5.0, .3, .4), (6.2, .45, .5), (8.2, .45, .7), (9.7, 1.3, .6), (9.7, 2.7, .6), (8.2, 3.55, .7),
                   (6.2, 3.55, .5), (5.0, 3.7, .4), (4.3, 4.55, .7), (2.0, 4.62, .8), (.4, 4.25, .7), (-.6, 3.0, .5)], n=10), gap=99, edge=.2, mats=('armor2', 'armor'))
    for f in (1, -1):
        y = lambda v: cy - f * (cy - v)
        for i, x in enumerate((.9, 1.75, 2.6, 3.45)):
            ys = -.35 if i else -.1
            s.part([(x - .45, y(ys + .05)), (x - .3, y(-.7 - .08 * (i % 2))), (x + .3, y(-.86)), (x + .55, y(ys + .08)), (x + .2, y(-.3))] if f > 0 else
                   mirror([(x - .45, ys + .05), (x - .3, -.7 - .08 * (i % 2)), (x + .3, -.86), (x + .55, ys + .08), (x + .2, -.3)], cy), .05, .3, 'armor2', .06, r=.12, decor=True)
            s.rod((x + .1, y(-.5)), (x - .45, y(-1.3 + i * .03)), .08, .16, 'armor2', .02)
        s.both([(8.3, .5), (9.1, .6), (9.65, 1.15), (9.9, 1.9), (9.45, 1.65), (8.9, 1.35), (8.3, 1.35)], .03, .24, 'armor', .05, r=.12, decor=True) if f > 0 else None
    ellipsoid((9.3, -cy, .12), (.3, .26, .06), s.m['glow'], 'maw'); s.card(9.35, cy, .5, .6, .55, 'halo')
    for y in (1.3, 2.7):
        ellipsoid((-.55, -y, .15), (.55, .38, .2), s.m['armor2'], 'sac'); ellipsoid((-.95, -y, .15), (.22, .22, .12), s.m['glow'], 'sac-glow'); s.card(-1.2, y, .5, .55, .45, 'halo')
    for x, y in ((5.1, .25), (5.1, 3.75), (7.4, .55), (7.4, 3.45)): s.light(x, y, 'lamp', .05)
    s.scatter(16, lambda cx, cy_, w, h, a, z: ellipsoid((cx, -cy_, z), (w / 2, h / 2, .05), s.m[s.rng.choice(('armor2', 'metal'))], 'nodule'), lambda: (s.rng.uniform(.1, .24),) * 2 + (0,))

def dreadnought(s):
    """Armada hunter: a crimson dagger on a black keel, forward-swept blade wings, raked tail fins and gold edge trim."""
    cy, H = s.cy, s.H
    s.body(sym([(-.6, .75, .06), (.9, .4, .1), (1.6, -.45, .08), (7.6, -.45, .1), (9.6, .45, .1), (11.9, cy, .02)], cy), gap=1.3, edge=.08)
    for f in (1, -1):
        y = lambda v: cy - f * (cy - v); m = (lambda q: q) if f > 0 else (lambda q: mirror(q, cy))
        s.part(m([(1.4, -.3), (2.4, -.9), (8.2, -.9), (10.3, .2), (9.4, .3), (7.8, -.3)]), .02, .15, 'frame', .04, decor=True)
        s.part(m([(5.6, -.4), (8.9, -1.4), (10.6, -1.0), (8.2, -.4)]), .02, .2, 'armor', .03, band=.07, seams=.5, tone=.72)
        s.accent(m([(8.3, -1.5), (9.3, -1.5), (8.1, -.3), (7.4, -.3)]), .45)
        s.part(m([(3.2, -.4), (1.4, -1.36), (.4, -1.38), (.9, -.4)]), .02, .2, 'armor', .03, band=.07, tone=.7)
        s.trim(m([(8.95, -1.33), (10.45, -1.0)]), .04)
        s.trim(m([(1.45, -1.28), (3.1, -.46)]), .04); s.trim(m([(2.5, -.86), (8.15, -.86), (10.2, .18)]), .035)
        s.light(10.5, y(-1.02), 'lamp', .04); s.light(.5, y(-1.3), 'lamp', .04)
    s.part(rect(-1.0, .6, -.2, 3.4), .04, .28, 'frame', .05, decor=True)
    for y, r in ((1.5, .3), (2.5, .3), (.85, .15), (3.15, .15)): s.nozzle(-.55, y, r, .7)
    s.accent(rect(10.4, -1, 12, 5), .55)
    s.visor([(10.2, 1.62), (10.95, 1.78), (11.3, cy), (10.95, 2.22), (10.2, 2.38)], r=.05)
    s.greebles(12)

def flagship(s):
    """Armada flagship: a huge layered arrowhead on a serrated black keel, crown batteries, mandible prongs, a stepped prow and a five-engine bank."""
    cy, H = s.cy, s.H
    s.body(sym([(-.6, .7, .06), (1.2, .4, .15), (2.6, -.55, .1), (9.6, -.55, .15), (11.4, .3, .2), (12.6, .8, .15), (13.92, cy, .02)], cy), gap=1.4, step=.15)
    for f in (1, -1):
        y = lambda v: cy - f * (cy - v); m = (lambda q: q) if f > 0 else (lambda q: mirror(q, cy))
        teeth = [(1.0, -.3), (2.2, -1.1)] + [p for x in (3.0, 4.6, 6.2, 7.8) for p in ((x, -1.1), (x + .35, -1.4), (x + 1.15, -1.4), (x + 1.5, -1.1))] + [(10.2, -1.1), (12.0, .1), (11.2, .2), (9.8, -.3)]
        s.part(m(teeth), .02, .22, 'frame', .04, decor=True)
        s.trim(m([(2.25, -1.02), (10.1, -1.02), (11.9, .1)]), .04)
        s.part(m([(2.4, -.4), (3.1, -1.0), (9.3, -1.0), (10.3, -.4)]), .1, .3, 'armor', .05, band=.08, seams=.8, tone=.68)
        s.trim(m([(3.15, -.94), (9.25, -.94), (10.2, -.42)]), .035)
        for x0 in (3.3, 4.9, 6.5):
            s.part(m([(x0, -.62), (x0 + 1.25, -.62), (x0 + 1.12, -.9), (x0 + .13, -.9)]), .3, .44, 'armor', .03, band=.04, tone=.86)
            ellipsoid((x0 + .63, -y(-.76), .45), (.1, .1, .04), s.m['frame'], 'dome')
        s.part(m([(10.4, -.35), (12.4, -.15), (13.85, .55), (12.6, .6), (11.5, .15)]), .02, .25, 'frame', .03, decor=True)
        s.trim(m([(12.4, -.08), (13.7, .5)]), .035)
        s.part(m([(2.0, -1.0), (.9, -1.25), (-.6, -1.2), (.1, -.85), (1.3, -.3)]), .03, .2, 'armor', .04, band=.06, tone=.6)
        s.light(-.5, y(-1.15), 'lamp', .045); s.light(13.75, y(.5), 'lamp', .04)
    s.part(smooth([(12.2, .8), (13.2, 1.3), (13.75, cy), (13.2, 2.7), (12.2, 3.2)], .15), .06, .46, 'armor', .07, band=.07, tone=.82, decor=True)
    s.visor([(12.5, 1.65), (13.2, 1.8), (13.45, cy), (13.2, 2.2), (12.5, 2.35)], .46, .05)
    s.part(rect(-1.1, .55, -.2, 3.45), .04, .3, 'frame', .06, decor=True)
    for y in (1.05, 1.68, 2.32, 2.95): s.nozzle(-.6, y, .27, .6)
    for f in (1, -1): s.slit(12.3, cy - f * .72 - .03, .7, .06, .47, 'lamp', 1.2)
    s.accent(rect(11.4, -1, 14, 5), .6)
    s.greebles(18)

DESIGNS = {'wayfarer': ('wayfarer', wayfarer), 'lancer': ('lancer', lancer), 'bulwark': ('bulwark', bulwark), 'corsair': ('corsair', corsair), 'halcyon': ('halcyon', halcyon),
    'lifeboat': ('lifeboat', lifeboat), 'skiff': ('raiders', skiff), 'raider': ('raiders', raider), 'gunship': ('raiders', gunship), 'drone': ('warden', drone),
    'hive': ('vesk', hive), 'dreadnought': ('armada', dreadnought), 'flagship': ('armada', flagship)}

# ---------- build / render ----------
def outline(path, color=(.02, .025, .05), px=2.2, strength=.9):
    """Soft dark outline behind the sprite so hulls stay crisp on busy backdrops."""
    a = load_rgba(path); al = a[..., 3]; k = math.ceil(px); ring = np.zeros_like(al); pad = np.pad(al, k)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            d = math.hypot(dx, dy)
            if d <= px: ring = np.maximum(ring, pad[k + dy:k + dy + al.shape[0], k + dx:k + dx + al.shape[1]] * min(1, px + .5 - d))
    ring *= strength; out_a = al + ring * (1 - al)
    rgb = (a[..., :3] * al[..., None] + np.array(color) * (ring * (1 - al))[..., None]) / np.maximum(out_a, 1e-6)[..., None]
    save_rgba(np.dstack([rgb, out_a]), path)

def build(hull):
    pal, fn = DESIGNS[hull['id']]
    W, H = round((hull['gridW'] + 2 * MX) * PPC), round((hull['gridH'] + 2 * MY) * PPC)
    reset(W, H, int(os.environ.get('SAMPLES', 128)))
    world((.035, .04, .055), 1)
    sun((1, -1, -1.1), 4.2, (1, .95, .88), .12)
    sun((-1, .9, -.5), .6, (.55, .7, 1), .3)
    sun((-.9, 1, -.16), 1.8, (.6, .78, 1), .08)
    ortho_camera(hull['gridW'] / 2, -hull['gridH'] / 2, hull['gridW'] + 2 * MX, hull['gridH'] + 2 * MY)
    s = Ship(hull, PAL[pal], sum(map(ord, hull['id']))); fn(s); s.finish()
    return s

def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = os.path.join(args[0], 'ships'); os.makedirs(out, exist_ok=True)
    for hull in json.load(open(os.path.join(HERE, 'hulls.json'))):
        if args[1:] and hull['id'] not in args[1:] or hull['id'] not in DESIGNS: continue
        build(hull)
        path = os.path.join(out, hull['id'] + '.png'); render(path); outline(path); to_mask(); render(os.path.join(out, hull['id'] + '-paint.png'))
        a = load_rgba(path)[..., 3]; edge = max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max())
        if edge > .02: print(f'WARNING {hull["id"]}: sprite touches the image border (alpha {edge:.2f})')

if __name__ == '__main__': main()
