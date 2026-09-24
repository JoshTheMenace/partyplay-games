"""Captain Falcon (Melee): tall, broad-chested racer in a dark blue bodysuit; red helmet with a black falcon-beak
visor and a gold falcon crest; square exposed chin with a confident smirk; gold scarf; red gloves with gold wrist
bands; red knee boots; white belt with the big gold falcon buckle. No prop (his moves are all fists and feet)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *

COLORS = {'primary': '#2c3f9e', 'secondary': '#c8222a', 'accent': '#f2b92a', 'light': '#eeeae2', 'skin': '#f0bf98', 'dark': '#1a1620', 'hair': '#3a2a22', 'trim': '#1f2a66'}
COSTUMES = [('Blood Falcon', {'primary': '#2a2830', 'secondary': '#b01c24', 'accent': '#d64040', 'trim': '#151418'}),
            ('Red', {'primary': '#c4262c', 'secondary': '#f2f0ec', 'accent': '#f2b92a', 'trim': '#7a141a'}),
            ('White', {'primary': '#eeeef2', 'secondary': '#e05a8c', 'accent': '#f2b92a', 'trim': '#a8a8b8'})]
J = humanoid(hip=1.04, spine=1.17, chest=1.36, neck=1.62, head=1.72, arm_y=1.56, shoulder=.08, arm=.26, elbow=.55, wrist=.81,
             leg=.125, leg_y=1.0, knee=.56, ankle=.1, clav_y=1.53)
HC = Vector((0, 1.86, .01))  # head center

HERO = {'root_loc': (0, -.1, 0), 'hips': (0, 10, 0), 'spine': (10, 12, 0), 'chest': (8, 16, 0), 'head': (-6, -24, 0),
        'upperarm_R': (0, 84, -8), 'forearm_R': (0, 6, 0), 'hand_R': (0, 0, 0),
        'upperarm_L': (0, 55, -55), 'forearm_L': (0, -95, 0), 'hand_L': (0, 0, 0),
        'thigh_L': (-62, 0, 8), 'shin_L': (58, 0, 0), 'foot_L': (0, 0, 0), 'thigh_R': (30, 0, -10), 'shin_R': (18, 0, 0), 'foot_R': (22, 0, 0),
        'extra_scarf_0': (30, 10, 0), 'extra_scarf_1': (10, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -10, 0)}, 'shoulders': .4}

def head(m):
    c = HC; o = lambda x, y, z: c + Vector((x, y, z))
    skull = blob([('ell', c, (.12, .145, .135)), ('box', o(0, -.105, .045), (.088, .06, .07), .05), ('ell', o(0, -.152, .082), (.058, .036, .04)),
                  ('ell', o(.058, -.045, .08), (.05, .04, .045)), ('ell', o(-.058, -.045, .08), (.05, .04, .045))], tris=1600, relax=3)
    face = Surf(skull)
    m.add(blob([('cap', o(0, -.02, .128), o(0, -.062, .152), .02), ('ell', o(0, -.068, .145), (.03, .019, .022))], tris=240, relax=1), 'skin', 'head', tag='nose')
    smile(m, face, [(-.04, c.y - .112, .2), (-.01, c.y - .116, .2), (.02, c.y - .113, .2), (.044, c.y - .101, .2)], .0034)
    m.add(stamp(face, o(0, -.16, 0), [ellipse(.016, .004, 10)], .002, d=(0, -.45, -1)), 'dark', 'head', tag='chin')
    # Helmet dome down to the nose, with a wraparound black visor band (slightly proud of the shell) over the eyes.
    hel = blob([('ell', o(0, .012, -.008), (.14, .163, .153)), ('ell', o(0, -.07, -.045), (.128, .1, .12)), ('ell', o(0, .0, .06), (.12, .11, .11))], tris=1900, relax=2)
    def keep(p): q = p - c; return min(max(.03 - q.z, q.y + .038 + .22 * abs(q.x)), q.y + .135)
    def visor(p): q = p - c; return min(q.z - .035, .048 - .1 * abs(q.x) - q.y, q.y + .026 + .22 * abs(q.x) - .03 * max(0, 1 - abs(q.x) / .03))
    m.add(layer(hel, keep, 0, .014, relax=1), 'secondary', 'head', tag='helmet')
    m.add(layer(hel, visor, .008, .01, relax=1), 'dark', 'head', tag='visor')
    trim(skull, keep, .015); m.add(skull, 'skin', 'head', tag='face')
    hs = Surf(hel)
    half = [(.016, .026), (.05, .036), (.1, .066), (.125, .07), (.1, .03), (.06, .0), (.022, -.018), (.012, -.05)]; wing = [(0, .05)] + half + [(0, -.035)] + [(-x, y) for x, y in half[::-1]]
    m.add(stamp(hs, o(0, .085, 0), [wing], .008, d=(0, -.2, -1)), 'accent', 'head', tag='crest')
    for s in (1, -1):  # ear pods
        m.add(cyl(o(s * .128, -.03, -.015), o(s * .162, -.03, -.015), .052, .044, seg=18, bevel=.012, up=(0, 1, 0)), 'secondary', 'head', tag='helmet')
        m.add(sphere(o(s * .165, -.03, -.015), (.012, .03, .03), 12, 8), 'accent', 'head', tag='helmet')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, 1.06, 0), (.155, .1, .11)), ('ell', (0, 1.2, 0), (.158, .12, .108)), ('box', (0, 1.4, .0), (.23, .15, .135), .1),
                 ('ell', (.1, 1.45, .07), (.13, .08, .07)), ('ell', (-.1, 1.45, .07), (.13, .08, .07)), ('ell', (.16, 1.36, -.03), (.1, .14, .1)), ('ell', (-.16, 1.36, -.03), (.1, .14, .1)),
                 ('cap', (-.25, 1.535, -.01), (.25, 1.535, -.01), .105), ('ell', (0, 1.58, -.035), (.16, .07, .1)), ('ell', (0, 1.25, .055), (.09, .1, .07))], tris=2200, relax=2)
    m.add(body, 'primary', w, tag='suit')
    m.add(capsule((0, 1.55, -.01), (0, 1.75, .0), .075, .07, 16), 'primary', 'neck', tag='neck')
    m.add(lathe((0, 1.54, -.01), (0, 1.67, 0), [(0, 0), (0, .11), (.03, .115), (.09, .095), (.13, .085), (.131, 0)], 20, sq=(1, .9)), 'primary', m.spine(('chest', 'neck')), tag='collar')
    m.add(torus((0, 1.675, .005), (.094, .088), .027, 22, 7, rot=(-8, 0, 0)), 'accent', 'neck', tag='scarf')
    pts = [(0, 1.66, -.08), (.02, 1.56, -.14), (.03, 1.44, -.17)]; ws = m.chain('scarf', 'neck', pts)
    m.add(ribbon(spline(pts, 8), [.07, .08, .085, .085, .08, .07, .06, .04], .014, normal=(0, 0, -1)), 'accent', ws, tag='scarf')
    m.add(torus((0, 1.075, 0), (.182, .128), .03, 26, 6, sq=(.55, 1.3)), 'light', w, tag='belt')
    bs = Surf(body); p, n = bs.hit((0, 1.075, 0))
    m.add(rbox((0, 1.075, .135), (.13, .085, .03), .018), 'accent', 'hips', tag='buckle')
    wing = [(0, .03), (.02, .012), (.055, .022), (.052, 0), (.018, -.012), (0, -.03), (-.018, -.012), (-.052, 0), (-.055, .022), (-.02, .012)]
    m.add(slab([wing], .008, Matrix.Translation((0, 1.078, .152))), 'trim', 'hips', tag='buckle')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(blob([('cap', sh, el, .09), ('ell', lerp(sh, el, .5) + Vector((0, 0, .025)), (.1, .07, .065))], tris=500, relax=2), 'primary', f'upperarm_{S}', tag='arms')
    m.add(blob([('cap', el, wr, .07), ('ell', lerp(el, wr, .3) + Vector((0, .01, 0)), (.1, .075, .07))], tris=420, relax=2), 'primary', f'forearm_{S}', tag='arms')
    m.add(capsule(el, el, .085), 'primary', f'forearm_{S}', tag='arms')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), .09, 'secondary', fist=True, cuff=(.13, .09))
    m.add(torus(wr - Vector((s * .03, 0, 0)), .088, .016, 20, 6, rot=(0, 0, 90)), 'accent', f'hand_{S}', tag='cuffs')
    hp, kn = P(J, f'thigh_{S}'), P(J, f'shin_{S}')
    m.add(blob([('cap', hp, kn, .1), ('ell', lerp(hp, kn, .32) + Vector((-s * .02, 0, .015)), (.1, .17, .11))], tris=520, relax=2), 'primary', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, kn + Vector((0, -.1, 0)), .088, .085, 16), 'primary', f'shin_{S}', tag='legs')
    boot(m, s, S, J, .5, .094, .07, 'secondary', 'dark', L=.3, wd=.16, ht=.14, cuff=.02, cuff_mat='accent')

def build():
    m = Model('captain-falcon', J, COLORS, COSTUMES, prop='none')
    with m.transform((0, 1.7, 0), 1.15): head(m)
    torso(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
