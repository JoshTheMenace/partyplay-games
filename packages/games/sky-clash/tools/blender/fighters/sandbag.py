"""Sandbag (Melee Home-Run Contest): a tall canvas sack with a domed top and a flat, heavy base, two small glossy black
eyes, a tiny open mouth, stitched side seams and a patched back. No real limbs: the arm bones drive soft side corners
and the leg bones drive the two bottom corners of the sack. Soft body weights like a stuffed toy."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#ece2c8', 'secondary': '#d9c9a2', 'trim': '#9c7f55', 'dark': '#1f1a1c', 'eye-white': '#ffffff', 'accent': '#c9564a'}
COSTUMES = [('Home-Run', {'primary': '#f6f4ee', 'secondary': '#e8e4da', 'trim': '#d8392f'}),
            ('Burlap', {'primary': '#c8a26a', 'secondary': '#a8834e', 'trim': '#5e4326'}),
            ('Denim', {'primary': '#9fb9dc', 'secondary': '#6f8fbf', 'trim': '#f2ead8'})]
J = skeleton({'root': (0, 0, 0), 'hips': (0, .4, 0), 'spine': (0, .62, 0), 'chest': (0, .86, 0), 'neck': (0, 1.08, 0), 'head': (0, 1.2, 0),
              'shoulder_L': (.12, .95, 0), 'upperarm_L': (.3, .95, 0), 'forearm_L': (.37, .94, 0), 'hand_L': (.43, .93, 0),
              'shoulder_R': (-.12, .95, 0), 'upperarm_R': (-.3, .95, 0), 'forearm_R': (-.37, .94, 0), 'hand_R': (-.43, .93, 0), 'prop': (-.48, .93, 0),
              'thigh_L': (.15, .32, 0), 'shin_L': (.18, .17, .03), 'foot_L': (.19, .06, .05),
              'thigh_R': (-.15, .32, 0), 'shin_R': (-.18, .17, .03), 'foot_R': (-.19, .06, .05)})
SQ = .78  # the sack is flatter front to back
PROF = [(0, 0), (0, .3), (.015, .345), (.05, .375), (.14, .4), (.4, .41), (.8, .4), (1.05, .38), (1.25, .345), (1.4, .29), (1.5, .215), (1.56, .14), (1.59, .07), (1.6, 0)]
IDLE = {'sym': {'upperarm': (0, -10, -30), 'forearm': (0, -10, -10)}, 'head': (-3, 0, 0)}
HERO = {'root_loc': (0, .08, 0), 'hips': (0, -24, 8), 'spine': (-4, 0, 6), 'chest': (-6, 0, 8), 'neck': (-4, 0, 4), 'head': (-6, -8, 6),
        'upperarm_L': (0, -20, 40), 'upperarm_R': (0, 20, -20), 'thigh_L': (-20, 0, 8), 'thigh_R': (15, 0, -6)}
PORTRAIT = {'shoulders': .9, 'fill': .88}

def r_at(y):
    for (d0, r0), (d1, r1) in zip(PROF, PROF[1:]):
        if d0 <= y <= d1 and d1 > d0: return r0 + (r1 - r0) * (y - d0) / (d1 - d0)
    return 0

def body(m):
    w = m.spine(('hips', 'spine', 'chest', 'neck', 'head'), spans=[(.25, .85), (.45, 1.1), (.7, 1.35), (.85, 1.6)])
    sack = lathe((0, 0, 0), (0, 1.6, 0), [(0, 0)] + [(max(0, min(1.6, p.x)), max(0, p.y)) for p in spline(PROF[1:-1], 60)] + [(1.6, 0)], 64, sq=(1, SQ))
    # Canvas folds: soft vertical creases that fade toward the stuffed middle, a slight pinch where the seams pull.
    def fold(p):
        a = math.atan2(p.z / SQ, p.x); k = .012 * math.sin(7 * a + .6) * (1 - smooth01((p.y - .1) / .5) * .6) + .008 * math.sin(11 * a) * smooth01((p.y - 1.1) / .4)
        rr = math.hypot(p.x, p.z / SQ) or 1; s = 1 + k / max(rr, .05) * (1 if p.y > .01 else 0)
        return Vector((p.x * s, p.y, p.z * s))
    bend(sack, fold); smooth(sack, 1); face = Surf(sack)
    m.add(sack, 'primary', w, tag='sack')
    for s in (1, -1):  # small glossy black eyes with a shine
        c = (s * .105, 1.28, 0); ew = w(Vector((s * .1, 1.28, .3)))
        m.add(stamp(face, c, [ellipse(.034, .06, 24)], .012, spin=s * -4), 'dark', ew, tag='eyes')
        m.add(stamp(face, c, [ellipse(.012, .018, 12, (-s * .008, .022))], .004, lift=.012, spin=s * -4), 'eye-white', ew, tag='eyes')
        m.add(stamp(face, (s * .19, 1.17, 0), [ellipse(.04, .02, 18)], .003, d=(-s * .3, 0, -1)), 'accent', w(Vector((s * .19, 1.17, .3))), tag='blush')
    mw = w(Vector((0, 1.16, .3)))
    m.add(stamp(face, (0, 1.155, 0), [ellipse(.028, .022, 20)], .008), 'dark', mw, tag='mouth')
    m.add(stamp(face, (0, 1.155, 0), [ellipse(.016, .009, 14, (0, -.007))], .003, lift=.008), 'accent', mw, tag='mouth')
    # Side seams from base to crown with cross stitches, a gathered crown seam and a stitched patch on the back.
    for s in (1, -1):
        ys = np.linspace(.03, 1.56, 30); seam = [face.near((s * (r_at(y) + .02), y, 0))[0] for y in ys]
        seam = [p + face.near(p)[1] * .004 for p in seam]
        m.add(tube(seam, .011, 8, up=(0, 0, 1)), 'trim', w, tag='seams')
        for y in np.linspace(.12, 1.44, 12):
            p, n = face.near((s * (r_at(y) + .02), y, 0)); t = n.cross(Vector((0, 1, 0))).normalized() if abs(n.y) < .9 else Vector((0, 0, 1))
            m.add(tube([p + n * .003 - t * .03 + Vector((0, .01, 0)), p + n * .01, p + n * .003 + t * .03 - Vector((0, .01, 0))], .007, 6, up=tuple(n)), 'trim', w, rigid=True, tag='stitches')
    patch = [(-.12, -.1), (.13, -.11), (.12, .12), (-.11, .11)]
    m.add(stamp(face, (.08, .62, 0), [patch], .006, d=(0, 0, 1), spin=6), 'secondary', w, tag='patch')
    pw = w(Vector((.08, .62, -.3)))
    for (u0, v0), (u1, v1) in zip(patch, patch[1:] + patch[:1]):
        for t in np.linspace(.12, .88, 5):
            u, v = u0 + (u1 - u0) * t, v0 + (v1 - v0) * t; q = Vector((.08 - u * .98, .62 + v * .98, -1))  # seen from behind
            p, n = face.hit(q, (0, 0, 1)); m.add(sphere(p + n * .006, (.012, .012, .006), 6, 4, rot=[math.degrees(a) for a in aim(n).to_euler()]), 'trim', pw, rigid=True, tag='stitches')

def corners(m, s, S):
    """Soft sack corners: the arm bones puff the sides, the leg bones the two bottom corners (stubby feet)."""
    arm = blob([('ell', (s * .36, .94, .01), (.09, .1, .08)), ('ell', (s * .43, .92, .02), (.062, .068, .06))], tris=500, relax=2)
    m.add(arm, 'primary', m.env([f'shoulder_{S}', f'upperarm_{S}', f'forearm_{S}', f'hand_{S}'], .06), tag='corners')
    foot = blob([('ell', (s * .19, .09, .14), (.13, .09, .16)), ('ell', (s * .18, .18, .02), (.12, .1, .12))], tris=600, relax=2)
    cut(foot, (0, 0, 0), (0, 1, 0), keep='above'); m.add(foot, 'primary', f'foot_{S}', tag='corners')

def build():
    m = Model('sandbag', J, COLORS, COSTUMES, prop='none')
    body(m); m.both(lambda s, S: corners(m, s, S)); return m

main(globals())
