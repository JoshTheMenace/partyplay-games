"""Princess Peach (Melee, Super Mario 64 look): tall and slender, a floor-length pink ballgown with a fitted bodice,
darker pink panniers over the hips, a hem band, puffed sleeves, long white opera gloves, a blue brooch in a gold
setting and blue earrings. Long golden hair with swept bangs, side locks and a flowing back mass that flips out at the
ends; a gold crown with red and blue jewels. Big blue lashed eyes and pink lips. Her Parasol rides the prop bone."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._sheik_helpers import gown, lady_face, skirt_weights

COLORS = {'primary': '#f7a1c4', 'secondary': '#e2568f', 'accent': '#3f7fe6', 'trim': '#d8344e', 'metal': '#f2c14a', 'light': '#fbf8f4',
          'skin': '#fbd6bd', 'hair': '#f6d36a', 'dark': '#2a1f2a', 'eye': '#3e7fe0', 'eye-white': '#ffffff'}
COSTUMES = [('Daisy', {'primary': '#f7cf45', 'secondary': '#ee8a2a', 'accent': '#3fb86a', 'hair': '#e89a4a'}),
            ('White', {'primary': '#f6f3ee', 'secondary': '#c9d6ef', 'accent': '#6fb2ff'}),
            ('Blue', {'primary': '#8fb8f2', 'secondary': '#3f63c8', 'accent': '#f2a0c4'})]
J = humanoid(hip=.95, spine=1.05, chest=1.17, neck=1.34, head=1.44, arm_y=1.31, shoulder=.06, arm=.15, elbow=.41, wrist=.63,
             leg=.075, leg_y=.9, knee=.5, ankle=.08, clav_y=1.3)

IDLE = {'sym': {'upperarm': (0, -14, -66), 'forearm': (0, -34, 0), 'hand': (0, 0, -12), 'thigh': (0, 0, 2)}, 'spine': (2, 0, 0), 'head': (-4, 0, 3)}
HERO = {'root_loc': (0, .16, 0), 'hips': (0, -16, 0), 'spine': (-4, -6, 2), 'chest': (-4, -8, 0), 'head': (-8, -14, 8),
        'upperarm_L': (0, -10, 38), 'forearm_L': (0, -40, 18), 'hand_L': (0, 0, 20),
        'upperarm_R': (0, 30, -40), 'forearm_R': (0, 70, 0), 'hand_R': (0, 0, 20),
        'thigh_L': (-26, 0, 4), 'shin_L': (40, 0, 0), 'thigh_R': (12, 0, -4), 'shin_R': (30, 0, 0), 'extra_hair_0': (18, 0, 0), 'extra_hair_1': (14, 0, 0)}
HERO_PROP = False
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, -4, -82), 'forearm': (0, -10, 0)}, 'head': (-6, -10, 4)}, 'shoulders': -.28}

HC = Vector((0, 1.565, 0))  # head center
def head(m):
    face = lady_face(m, HC)
    for s in (1, -1):
        m.add(blob([('ell', HC + Vector((s * .136, -.01, -.005)), (.022, .04, .03))], tris=160, relax=1), 'skin', 'head', tag='ears')
        m.add(sphere(HC + Vector((s * .14, -.065, .0)), .016, 12), 'accent', 'head', tag='earrings')
        m.add(sphere(HC + Vector((s * .14, -.045, .0)), .007, 8), 'metal', 'head', tag='earrings')

def hair(m):
    # Cap of hair over the skull with a soft centre part, bangs swept to both sides.
    capb = blob([('ell', HC + Vector((0, .03, -.02)), (.152, .152, .155)), ('ell', HC + Vector((0, -.04, -.07)), (.15, .12, .11))], tris=1100, relax=2)
    cut(capb, HC + Vector((0, .055, .12)), (0, 1, -.9), keep='above'); m.add(capb, 'hair', 'head', tag='hair')
    for s in (1, -1):
        for i, (x0, dx, dy) in enumerate(((.01, .1, -.07), (.05, .085, -.1), (.09, .06, -.13))):  # bangs sweeping out from the part
            a = HC + Vector((s * x0, .15, .06)); m.add(spike(a, a + Vector((s * dx * .5, -.02, .09)), a + Vector((s * dx, dy, .075 - i * .02)), .05 - i * .006, sq=(1, .45), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='bangs')
        side = [HC + Vector((s * .13, .02, .03)), HC + Vector((s * .16, -.1, .02)), HC + Vector((s * .15, -.22, .03)), HC + Vector((s * .19, -.3, .02))]
        m.add(strand(side, .05, .018, sq=(1, .6), up=(0, 0, 1), n=12, seg=10), 'hair', 'head', tag='locks')
    # Long back mass on a spring chain, flipping out at the ends.
    pts = [HC + Vector((0, -.02, -.1)), Vector((0, 1.36, -.2)), Vector((0, 1.18, -.22)), Vector((0, 1.02, -.2))]
    w = m.chain('hair', 'head', pts)
    back = blob([('ell', HC + Vector((0, -.04, -.08)), (.17, .15, .12)), ('ell', (0, 1.42, -.15), (.2, .14, .09)), ('ell', (0, 1.27, -.17), (.21, .12, .07)),
                 ('ell', (0, 1.13, -.17), (.2, .07, .06)), ('ell', (.15, 1.08, -.13), (.08, .05, .06), (0, 0, 30)), ('ell', (-.15, 1.08, -.13), (.08, .05, .06), (0, 0, -30))],
                tris=1300, relax=3)
    m.add(back, 'hair', w, tag='back hair')

def crown(m):
    c = HC + Vector((0, .175, .02)); R = .062
    def fn(u, v):
        t = u * 2 * math.pi; h = .024 + .05 * (.5 + .5 * math.cos(5 * t)) ** 5; r = R * (1 + .18 * v)
        return c + Vector((math.sin(t) * r, v * h, math.cos(t) * r))
    with m.transform(c, 1.0, (0, 0, 0), (-12, 0, 0)):
        m.add(sheet(fn, 40, 2, .008, closed_u=True), 'metal', 'head', tag='crown')
        m.add(torus(c, R * 1.01, .006, 30, 5), 'metal', 'head', tag='crown')
        for k in range(5):
            t = 2 * math.pi * k / 5; m.add(sphere(c + Vector((math.sin(t) * R * 1.18, .077, math.cos(t) * R * 1.18)), .009, 8), 'metal', 'head', tag='crown')
            t2 = t + math.pi / 5; m.add(sphere(c + Vector((math.sin(t2) * R * 1.08, .015, math.cos(t2) * R * 1.08)), (.009, .009, .009), 8), 'trim', 'head', tag='jewels')
        m.add(sphere(c + Vector((0, .026, R * 1.1)), (.013, .016, .008), 12), 'accent', 'head', tag='jewels')

def body(m):
    w = m.spine(('hips', 'spine', 'chest'))
    torso = blob([('ell', (0, 1.0, 0), (.115, .08, .09)), ('ell', (0, 1.1, 0), (.105, .09, .085)), ('ell', (0, 1.2, .005), (.13, .085, .095)),
                  ('ell', (.052, 1.2, .05), (.06, .055, .055)), ('ell', (-.052, 1.2, .05), (.06, .055, .055)), ('cap', (-.12, 1.29, -.01), (.12, 1.29, -.01), .06)], tris=900, relax=2)
    def neck_line(p): return p.y - (1.275 + 2.2 * p.x * p.x - .06 * min(0, p.z))
    split_by(torso, neck_line); m.add(torso, lambda c, n: 'skin' if neck_line(c) > 0 and c.z > -.02 else 'primary', w, tag='bodice')
    m.add(capsule((0, 1.27, -.01), (0, 1.48, -.01), .046, .044, 14), 'skin', m.spine(('chest', 'neck', 'head')), tag='neck')
    surf = Surf(torso)  # brooch: gold setting and a blue gem
    m.add(stamp(surf, (0, 1.2, 0), [ellipse(.034, .04, 24)], .008), 'metal', 'chest', tag='brooch')
    m.add(stamp(surf, (0, 1.2, 0), [ellipse(.024, .029, 20)], .008, lift=.007), 'accent', 'chest', tag='brooch')
    m.add(torus((0, .985, .0), (.118, .094), .014, 28, 6), 'secondary', 'hips', tag='waist')
    # Skirt: fitted at the waist, flaring to a floor-length bell; the lower half follows the thighs a little.
    sw = skirt_weights(.85, .7, .25, .45)
    sk = gown(top=1.0, bottom=.035, r_top=.118, r_bot=.5, depth=.86, flare=1.35, folds=9, fold_amp=.05, seg=44, rings=10, back=.12); split_by(sk, lambda p: p.y - .1)
    m.add(sk, lambda c, n: 'secondary' if c.y < .1 else 'primary', sw, tag='skirt')
    # Panniers: a darker overskirt over the hips and back, open at the front, scalloped hem.
    def over(u, v):
        t = .55 + u * (2 * math.pi - 1.1); drop = .3 + .08 * math.cos(t) ** 2 + .035 * math.cos(7 * t)
        r = .14 + (.3 - .16 * (1 - v)) * v ** .8 + .05 * math.sin(math.pi * v)
        return (math.sin(t) * r, .99 - v * drop, math.cos(t) * r * .92 * (1 + .12 * (math.cos(t) < 0)))
    m.add(sheet(over, 30, 5, .014), 'secondary', sw, tag='panniers')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(blob([('ell', sh + Vector((s * .03, .005, 0)), (.085, .07, .07)), ('ell', sh + Vector((s * .075, 0, 0)), (.055, .055, .055))], tris=240, relax=2), 'primary', f'upperarm_{S}', tag='sleeves')
    m.add(torus(sh + Vector((s * .115, 0, 0)), .05, .01, 16, 5, rot=(0, 0, 90)), 'secondary', f'upperarm_{S}', tag='sleeves')
    m.add(capsule(sh, el, .042, .036, 12), 'skin', f'upperarm_{S}', tag='arms')
    top = lerp(sh, el, .55)
    m.add(lathe(top, el, [(0, 0), (0, .045), (.02, .046), (.06, .04), ((el - top).length, .038)], 16, up=(0, 1, 0)), 'light', f'upperarm_{S}', tag='gloves')
    m.add(capsule(el, wr, .038, .031, 12), 'light', f'forearm_{S}', tag='gloves')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .055, 'light', curl=.3, tris=380)
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .07, .05, 10), 'skin', f'thigh_{S}', tag='legs'); m.add(capsule(kn, an, .05, .035, 10), 'skin', f'shin_{S}', tag='legs')
    shoe(m, s, S, an + Vector((0, 0, .03)), .19, .085, .09, 'secondary', 'secondary', sole=.02, toe=.8, heel=.9, up=.01, tris=200)

def parasol(m):
    """Closed parasol: crook handle in the fist, canopy furled along the shaft, the point is the far end."""
    g = P(J, 'prop'); d = Vector((-1, 0, 0)); tip = g + d * .78
    m.add(strand([g + Vector((.02, -.06, 0)), g + Vector((.06, -.03, 0)), g + Vector((.06, .02, 0)), g], .013, .013, n=8, seg=8), 'secondary', 'prop', tag='parasol')
    m.add(cyl(g, tip, .01, seg=8), 'light', 'prop', tag='parasol')
    m.add(lathe(g + d * .2, tip - d * .04, [(0, .012), (.05, .04), (.3, .05), (.46, .03), (.54, .012)], 16, sq=(1, 1), up=(0, 1, 0), shape=lambda t: 1 + .12 * math.cos(8 * t)), 'primary', 'prop', tag='parasol')
    m.add(torus(g + d * .5, .052, .012, 20, 6, rot=(0, 0, 90)), 'light', 'prop', tag='parasol')

def build():
    m = Model('peach', J, COLORS, COSTUMES, prop='move')
    head(m); hair(m); crown(m); body(m); m.both(lambda s, S: limbs(m, s, S)); parasol(m); return m

main(globals())
