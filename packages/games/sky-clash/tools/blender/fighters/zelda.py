"""Princess Zelda (Melee, Ocarina of Time adult look): slender, a floor-length lilac-pink gown with a long purple
tabard carrying the gold Triforce and the red Hylian crest, a gold belt and collar, rounded gold pauldrons over puffed
sleeves, long white gloves with gold armbands. Light-brown hair with a centre part, two long side tresses sheathed in
cream wraps, a long back fall, a gold circlet with a red forehead jewel, pointed Hylian ears with blue earrings and
calm almond eyes. No prop (her specials are magic)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._sheik_helpers import gown, lady_face, skirt_weights

COLORS = {'primary': '#eab4d6', 'secondary': '#7c3f98', 'accent': '#3f8fe0', 'trim': '#d8313f', 'metal': '#e9b949', 'light': '#fbf6ee',
          'skin': '#fbd9c2', 'hair': '#b98449', 'dark': '#2a1f2a', 'eye': '#3f73c8', 'eye-white': '#ffffff'}
COSTUMES = [('Red', {'primary': '#ef8a86', 'secondary': '#8e1f2c', 'accent': '#e8c13f'}),
            ('Blue', {'primary': '#9dbcef', 'secondary': '#27408e', 'trim': '#e8c13f'}),
            ('Green', {'primary': '#a9d8a0', 'secondary': '#2d6a3c', 'accent': '#e8c13f'})]
J = humanoid(hip=.95, spine=1.05, chest=1.17, neck=1.34, head=1.44, arm_y=1.31, shoulder=.06, arm=.15, elbow=.41, wrist=.63,
             leg=.075, leg_y=.9, knee=.5, ankle=.08, clav_y=1.3)
IDLE = {'sym': {'upperarm': (0, -16, -66), 'forearm': (0, -40, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 2)}, 'spine': (2, 0, 0), 'head': (-4, 0, 0)}
HERO = {'root_loc': (0, .06, 0), 'hips': (0, -20, 0), 'spine': (-2, -6, 4), 'chest': (-4, -10, 4), 'head': (-6, -14, 4),
        'upperarm_L': (0, -50, 28), 'forearm_L': (0, -25, 0), 'hand_L': (0, 0, 30), 'upperarm_R': (0, 45, -22), 'forearm_R': (0, 25, 0), 'hand_R': (0, 0, -30),
        'thigh_L': (-12, 0, 3), 'thigh_R': (10, 0, -3), 'extra_hair_0': (14, 0, 0), 'extra_hair_1': (10, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, -4, -82), 'forearm': (0, -10, 0)}, 'head': (-6, -10, 3)}, 'shoulders': -.4}

HC = Vector((0, 1.565, 0))
def head(m):
    face = lady_face(m, HC, eye_w=.038, eye_h=.043, look=.05, lid=(.16, -2), tilt=8,
                     brow=dict(lift=.45, slant=-4, thick=.2, width=1.0, arch=.35, mat='hair', gap=.004))
    for s in (1, -1):  # pointed Hylian ears and blue drop earrings
        b = HC + Vector((s * .13, -.01, -.01))
        m.add(spike(b, b + Vector((s * .05, .02, -.02)), b + Vector((s * .115, .06, -.05)), .04, sq=(1, .38), up=(0, 0, 1), n=8, seg=9), 'skin', 'head', tag='ears')
        m.add(cyl(b + Vector((s * .012, -.03, 0)), b + Vector((s * .012, -.05, 0)), .004, seg=6), 'metal', 'head', tag='earrings')
        m.add(sphere(b + Vector((s * .012, -.064, 0)), (.012, .018, .012), 12), 'accent', 'head', tag='earrings')

def hair(m):
    capb = blob([('ell', HC + Vector((0, .03, -.02)), (.152, .152, .155)), ('ell', HC + Vector((0, -.04, -.07)), (.15, .12, .11))], tris=1000, relax=2)
    cut(capb, HC + Vector((0, .06, .12)), (0, 1, -.9), keep='above'); m.add(capb, 'hair', 'head', tag='hair')
    for s in (1, -1):
        for i, (x0, dx, dy) in enumerate(((.01, .11, -.06), (.05, .09, -.1))):  # bangs parted in the middle
            a = HC + Vector((s * x0, .15, .06)); m.add(spike(a, a + Vector((s * dx * .5, -.02, .09)), a + Vector((s * dx, dy, .07 - i * .02)), .05 - i * .006, sq=(1, .45), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='bangs')
        # Side tress down the front of the shoulder, sheathed in a cream wrap with gold bands.
        pts = [HC + Vector((s * .12, .0, .05)), HC + Vector((s * .125, -.15, .08)), Vector((s * .1, 1.29, .145)), Vector((s * .085, 1.13, .15))]
        w = m.chain(f'tress{"L" if s > 0 else "R"}', 'head', pts)
        tr = strand(pts, .038, .026, sq=(1, .8), up=(0, 0, 1), n=12, seg=8); split_by(tr, lambda p: 1.33 - p.y)
        m.add(tr, lambda c, n: 'light' if c.y < 1.33 else 'hair', w, tag='tresses')
        for y in (1.32, 1.16):
            q = spline(pts, 40); c = min(q, key=lambda p: abs(p.y - y)); m.add(torus(c, .04, .009, 16, 5), 'metal', w, tag='tresses')
        m.add(sphere(pts[-1] + Vector((0, -.01, 0)), (.03, .04, .03), 10), 'hair', w, tag='tresses')
    pts = [HC + Vector((0, -.02, -.1)), Vector((0, 1.36, -.19)), Vector((0, 1.16, -.2)), Vector((0, .98, -.18))]
    w = m.chain('hair', 'head', pts)
    back = blob([('ell', HC + Vector((0, -.04, -.08)), (.165, .15, .12)), ('ell', (0, 1.42, -.15), (.17, .14, .08)), ('ell', (0, 1.25, -.17), (.15, .13, .06)),
                 ('ell', (0, 1.08, -.17), (.11, .1, .05))], tris=1100, relax=3)
    m.add(back, 'hair', w, tag='back hair')

def circlet(m):
    c = HC + Vector((0, .09, 0))
    m.add(torus(c, (.152, .158), .008, 32, 5, rot=(-14, 0, 0)), 'metal', 'head', tag='circlet')
    f = HC + Vector((0, .085, .158)); d = Vector((0, 0, 1))
    m.add(slab([[(-.03, .016), (.03, .016), (0, -.042)]], .01, Matrix.Translation(f) @ rot4((-14, 0, 0)), bevel=.002), 'metal', 'head', tag='circlet')
    m.add(sphere(f + Vector((0, -.004, .008)), (.011, .014, .007), 12), 'trim', 'head', tag='circlet')

def crest_loops():
    """The gold Triforce (three triangles) above a stylized red Hylian bird, in tabard (u, v) meters."""
    def tri(cx, cy, r): return [(cx - r, cy - r * .87), (cx + r, cy - r * .87), (cx, cy + r * .87)]
    r = .026; tf = [tri(-r, 0, r * .96), tri(r, 0, r * .96), tri(0, r * 1.74, r * .96)]
    bird = [(0, .03), (.018, .0), (.1, .035), (.085, -.005), (.05, -.02), (.022, -.03), (0, -.08), (-.022, -.03), (-.05, -.02), (-.085, -.005), (-.1, .035), (-.018, .0)]
    return tf, [bird]

def body(m):
    w = m.spine(('hips', 'spine', 'chest'))
    torso = blob([('ell', (0, 1.0, 0), (.11, .08, .088)), ('ell', (0, 1.1, 0), (.1, .09, .082)), ('ell', (0, 1.2, .005), (.125, .085, .092)),
                  ('ell', (.05, 1.2, .045), (.056, .05, .05)), ('ell', (-.05, 1.2, .045), (.056, .05, .05)), ('cap', (-.12, 1.29, -.01), (.12, 1.29, -.01), .06)], tris=900, relax=2)
    def neck_line(p): return p.y - (1.285 + 2.2 * p.x * p.x - .06 * min(0, p.z))
    split_by(torso, neck_line); m.add(torso, lambda c, n: 'skin' if neck_line(c) > 0 and c.z > -.02 else 'primary', w, tag='bodice')
    m.add(capsule((0, 1.27, -.01), (0, 1.48, -.01), .045, .043, 14), 'skin', m.spine(('chest', 'neck', 'head')), tag='neck')
    m.add(torus((0, 1.285, .0), (.1, .085), .012, 28, 6, rot=(-12, 0, 0)), 'metal', 'chest', tag='collar')
    m.add(sphere((0, 1.25, .1), (.018, .022, .01), 12), 'trim', 'chest', tag='collar')
    m.add(torus((0, .99, .0), (.116, .092), .016, 28, 6), 'metal', 'hips', tag='belt')
    m.add(rbox((0, .99, .098), (.05, .045, .02), .008), 'metal', 'hips', tag='belt')
    sw = skirt_weights(.85, .7, .25, .4)
    G = dict(top=1.0, bottom=.035, r_top=.115, r_bot=.4, depth=.86, flare=1.15, fold_amp=.045)
    m.add(gown(**G, folds=10, seg=44, rings=10, back=.06), 'primary', sw, tag='skirt')
    # Long tabard over the front of the skirt: sits just outside the skirt's front line, with the crest near the top.
    def front(y):
        v = (G['top'] - y) / (G['top'] - G['bottom']); k = v ** G['flare']; return (G['r_top'] + (G['r_bot'] - G['r_top']) * k) * (1 + G['fold_amp'] * k) * G['depth']
    def tab(u, v):
        y = .985 - v * .9; wd = .085 + .05 * v; x = (u - .5) * 2 * wd; return (x, y, front(y) + .016 - .8 * x * x)
    tb = sheet(tab, 8, 12, .012); split_by(tb, lambda p: p.y - .14); m.add(tb, lambda c, n: 'metal' if c.y < .14 else 'secondary', sw, tag='tabard'); surf = Surf(tb)
    tf, bird = crest_loops()
    m.add(stamp(surf, (0, .86, .4), tf, .004, spacing=.008), 'metal', sw, rigid=True, tag='crest')
    m.add(stamp(surf, (0, .72, .4), bird, .004, spacing=.01), 'trim', sw, rigid=True, tag='crest')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    pa = sphere(sh + Vector((s * .02, .01, 0)), (.1, .085, .085), 20, 12); cut(pa, sh + Vector((0, -.02, 0)), (0, 1, 0), keep='above')
    m.add(pa, 'metal', f'upperarm_{S}', tag='pauldrons')
    m.add(torus(sh + Vector((s * .02, -.018, 0)), (.098, .083), .01, 24, 5), 'metal', f'upperarm_{S}', tag='pauldrons')
    m.add(blob([('ell', sh + Vector((s * .05, -.01, 0)), (.07, .06, .062))], tris=200, relax=2), 'primary', f'upperarm_{S}', tag='sleeves')
    m.add(capsule(sh, el, .04, .036, 12), 'light', f'upperarm_{S}', tag='gloves')
    m.add(torus(lerp(sh, el, .55), .042, .008, 16, 5, rot=(0, 0, 90)), 'metal', f'upperarm_{S}', tag='armbands')
    m.add(capsule(el, wr, .037, .03, 12), 'light', f'forearm_{S}', tag='gloves')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .055, 'light', curl=.3, tris=380)
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .07, .05, 10), 'skin', f'thigh_{S}', tag='legs'); m.add(capsule(kn, an, .05, .035, 10), 'skin', f'shin_{S}', tag='legs')
    shoe(m, s, S, an + Vector((0, 0, .03)), .19, .085, .09, 'secondary', 'secondary', sole=.02, toe=.8, heel=.9, up=.01, tris=200)

def build():
    m = Model('zelda', J, COLORS, COSTUMES, prop='none')
    head(m); hair(m); circlet(m); body(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
