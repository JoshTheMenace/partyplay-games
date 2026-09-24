"""Dr. Mario (Melee): Mario's build in a knee-length white lab coat with lapels, a pale shirt and dark tie at the V,
metal buttons and a pocket, a stethoscope around the neck, a head mirror on a brown headband over bare, full brown
hair, dark trousers, white gloves and brown shoes. The Super Sheet rides the prop bone and is shown only by moves."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._sheik_helpers import plumber_head, plane_fn, glove_arm, skirt_weights

COLORS = {'primary': '#f4f5f7', 'secondary': '#2b2d3a', 'accent': '#27365e', 'light': '#fbfbf8', 'skin': '#f6c49a', 'hair': '#4a2a18',
          'trim': '#6a4428', 'metal': '#c4ccd6', 'dark': '#231a1c', 'eye': '#2f6fd8', 'eye-white': '#ffffff'}
COSTUMES = [('Red', {'primary': '#e8586a', 'accent': '#f4f0ea', 'secondary': '#50303a'}),
            ('Blue', {'primary': '#6fa6ec', 'accent': '#1f2f6a', 'secondary': '#27324f'}),
            ('Green', {'primary': '#7cc98a', 'accent': '#1f4a2a', 'secondary': '#2e3a30'})]
J = humanoid(hip=.5, spine=.6, chest=.74, neck=.93, head=1.0, arm_y=.875, shoulder=.08, arm=.235, elbow=.44, wrist=.62,
             leg=.12, leg_y=.47, knee=.28, ankle=.11, clav_y=.86)

HERO = {'root_loc': (0, .03, 0), 'hips': (0, -24, 0), 'spine': (6, -8, 0), 'chest': (4, -12, 0), 'head': (-6, 8, 0),
        'upperarm_R': (0, 70, 12), 'forearm_R': (0, 20, 0), 'hand_R': (0, 0, 10),
        'upperarm_L': (0, 50, -52), 'forearm_L': (0, -30, 0), 'hand_L': (0, 0, -15),
        'thigh_L': (-50, 0, 8), 'shin_L': (55, 0, 0), 'foot_L': (-5, 0, 0), 'thigh_R': (25, 0, -8), 'shin_R': (35, 0, 0), 'foot_R': (20, 0, 0)}
HERO_PROP = False
PORTRAIT = {'pose': {**IDLE, 'head': (-4, -8, 0), 'chest': (0, -6, 0)}}

HAIR = ((0, 1.345, .15), (0, 1, -.6))
def head(m):
    under = plane_fn(*HAIR)
    skull, face = plumber_head(m, under, back=False)
    hair = blob([('ell', (0, 1.34, -.03), (.252, .205, .252)), ('ell', (0, 1.44, .0), (.215, .13, .21)), ('ell', (.05, 1.445, .13), (.15, .075, .11), (0, 0, -8)),
                 ('ell', (-.13, 1.4, .12), (.09, .06, .08)), ('ell', (.16, 1.39, .1), (.09, .065, .09))], tris=1100, relax=2)
    cut(hair, *HAIR, keep='above'); m.add(hair, 'hair', 'head', tag='hair')
    for x, y, z, dx in ((.13, 1.42, .18, .08), (-.12, 1.41, .18, -.07)):  # front locks curling off the side part
        b = Vector((x, y, z)); m.add(spike(b, b + Vector((dx * .6, .01, .04)), b + Vector((dx, -.06, .05)), .045, sq=(1, .55), n=7), 'hair', 'head', tag='hair')
    band = torus((0, 1.405, .0), (.258, .262), .016, 36, 6, rot=(-24, 0, 0), sq=(.6, 1.4)); m.add(band, 'trim', 'head', tag='band')
    c = Vector((.05, 1.45, .262)); n = Vector((.12, .5, 1)).normalized();
    m.add(cyl(c - n * .012, c + n * .014, .085, seg=20, bevel=.006, up=(0, 1, 0)), 'metal', 'head', tag='mirror')
    m.add(torus(c + n * .016, .082, .008, 20, 5, rot=[math.degrees(a) for a in Vector((0, 1, 0)).rotation_difference(n).to_euler()]), 'metal', 'head', tag='mirror')
    m.add(cyl(c + n * .012, c + n * .02, .02, seg=16), 'dark', 'head', tag='mirror')
    m.add(cyl(c - n * .03, c - n * .005, .022, seg=10), 'trim', 'head', tag='mirror')
    m.add(trim(skull, under, .04), 'skin', 'head', tag='skull')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .54, 0), (.225, .13, .2)), ('ell', (0, .655, .03), (.25, .17, .222)), ('ell', (0, .79, 0), (.222, .13, .185)),
                 ('cap', (-.18, .865, -.01), (.18, .865, -.01), .1), ('ell', (0, .88, 0), (.165, .075, .135))], tris=1450, relax=1)
    def vee(p): return min(p.z - .02, p.y - .7, (p.y - .7) * .55 + .012 - abs(p.x))  # open V of the coat at the chest
    split_by(body, vee); m.add(body, lambda c, n: 'light' if vee(c) > 0 else 'primary', w, tag='coat')
    surf = Surf(body)
    m.add(stamp(surf, (0, .8, .2), [[(-.02, .085), (.02, .085), (.016, .06), (.026, -.07), (0, -.1), (-.026, -.07), (-.016, .06)]], .006), 'accent', w, tag='tie')
    for s in (1, -1):
        m.add(stamp(surf, (s * .04, .79, .2), [[(s * -.03, -.09), (s * .03, .1), (s * .075, .085), (s * .02, -.1)]], .01), 'primary', w, tag='lapels')
    for y in (.69, .6):
        p, nn = surf.hit((0, y, 0)); m.add(sphere(p + nn * .004, (.018, .018, .01), 12, 8, rot=[math.degrees(a) for a in aim(nn).to_euler()]), 'metal', w, rigid=True, tag='buttons')
    m.add(stamp(surf, (.12, .76, 0), [[(-.045, .035), (.045, .035), (.045, -.035), (-.045, -.035)]], .006, d=(-.2, 0, -1)), 'primary', w, tag='pocket')
    m.add(capsule((0, .9, -.01), (0, 1.07, 0), .095, .09, 16), 'skin', 'neck', tag='neck')
    # Coat skirt: open front, back vent, follows the thighs below the hips.
    def skirt(u, v):
        t = .22 + u * (2 * math.pi - .44); r = .245 + .06 * v ** 1.2; y = .56 - v * .3
        return (math.sin(t) * r * (1 + .02 * math.cos(6 * t)), y, math.cos(t) * r * .86 + .03)
    sw = skirt_weights(.52, .25, .5, .3, w)
    m.add(sheet(skirt, 28, 6, .014), 'primary', sw, tag='coat skirt')
    # Stethoscope: tube around the neck, both ends down the chest, chest piece on the fighter's right.
    def lead(s): return [(s * .02, .9, -.14), (s * .13, .93, -.05), (s * .15, .9, .1), (s * .09, .79, .215), (s * .07, .7, .23)]
    for s in (1, -1): m.add(strand(lead(s), .011, .011, n=12, seg=6), 'dark', w, tag='stethoscope')
    m.add(cyl((-.07, .69, .225), (-.07, .69, .255), .032, seg=16, bevel=.006), 'metal', w, rigid=True, tag='stethoscope')
    m.add(sphere((.07, .69, .235), .016, 10), 'metal', w, rigid=True, tag='stethoscope')

def limbs(m, s, S):
    glove_arm(m, s, S, J, (.09, .078, .068), u=.075, cuff=(.07, .082))
    el = P(J, f'forearm_{S}'); wr = P(J, f'hand_{S}')
    m.add(lathe(lerp(el, wr, .7), wr + Vector((s * .02, 0, 0)), [(0, .07), (.02, .084), (.07, .086), (.075, 0)], 18, up=(0, 1, 0)), 'primary', f'forearm_{S}', tag='cuffs')
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .115, .098, 16), 'secondary', f'thigh_{S}', tag='legs')
    m.add(lathe(kn, (an.x, .1, 0), [(-.1, 0), (-.095, .04), (-.07, .085), (-.03, .098), (.06, .098), (.13, .104), (.16, .108), (.172, .1), (.175, 0)], 16), 'secondary', f'shin_{S}', tag='legs')
    shoe(m, s, S, an + Vector((0, 0, .02)), .31, .19, .15, 'trim', 'dark', sole=.03, toe=1.1, heel=.85, up=.01, tris=560)

def sheet_prop(m):
    """Super Sheet gathered in the right fist, falling open below it."""
    g = P(J, 'prop')
    def surf(u, v):
        a = (u - .5) * 2; k = v ** .8
        return (g.x + a * (.035 + .24 * k), g.y - .03 - v * .52 * (1 - .14 * a * a), g.z + .03 - .14 * (1 - a * a) * k + .035 * math.sin(3.2 * math.pi * a) * k)
    m.add(sheet(surf, 16, 8, .012), 'light', 'prop', tag='sheet')

def build():
    m = Model('dr-mario', J, COLORS, COSTUMES, prop='move')
    head(m); torso(m); m.both(lambda s, S: limbs(m, s, S)); sheet_prop(m); return m

main(globals())
