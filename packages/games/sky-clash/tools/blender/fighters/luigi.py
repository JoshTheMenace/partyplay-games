"""Luigi (Melee): Mario's taller, leaner brother. Tall green cap with the white L badge, a longer face with a broad
brush moustache and a slightly longer nose, green shirt under blue overalls with gold buttons, white gloves, long legs
and brown shoes. No prop (fireballs and the Cyclone are effects)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._sheik_helpers import plumber_head, plumber_cap, plane_fn, glove_arm

COLORS = {'primary': '#2fa843', 'secondary': '#2a4fb8', 'accent': '#ffd23a', 'light': '#f7f5f0', 'skin': '#f6c49a', 'hair': '#51301c',
          'trim': '#2fa843', 'dark': '#231a1c', 'eye': '#2f6fd8', 'eye-white': '#ffffff'}
COSTUMES = [('White', {'primary': '#f3f1ea', 'secondary': '#2f9a44', 'skin': '#e8b088'}),
            ('Blue', {'primary': '#3f8fe8', 'secondary': '#1f2f78', 'accent': '#e8e4d8', 'trim': '#3f8fe8'}),
            ('Pink', {'primary': '#f28ab8', 'secondary': '#35b7b0', 'accent': '#ffe08a', 'trim': '#e0609c'})]
J = humanoid(hip=.6, spine=.72, chest=.88, neck=1.1, head=1.17, arm_y=1.035, shoulder=.08, arm=.215, elbow=.45, wrist=.66,
             leg=.11, leg_y=.575, knee=.33, ankle=.11, clav_y=1.025)
HEAD = dict(pivot=(0, 1.0, 0), scale=(.88, .98, .9), loc=(0, .17, 0))  # Mario's head space -> Luigi's longer head

HERO = {'root_loc': (0, .14, 0), 'hips': (0, -16, 0), 'spine': (-4, -4, 0), 'chest': (-4, -8, 0), 'head': (-10, -12, 0),
        'upperarm_R': (0, 10, -148), 'forearm_R': (0, 0, -8), 'hand_R': (0, 0, 0),
        'upperarm_L': (0, 30, -48), 'forearm_L': (0, -40, 0), 'hand_L': (0, 0, -15),
        'thigh_L': (-72, 0, 6), 'shin_L': (92, 0, 0), 'foot_L': (-10, 0, 0), 'thigh_R': (18, 0, -4), 'shin_R': (40, 0, 0), 'foot_R': (25, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-4, -8, 0), 'chest': (0, -6, 0)}}

CAP = ((0, 1.37, 0), (0, 1, -.22))
L = [(-.036, .046), (-.012, .046), (-.012, -.021), (.036, -.021), (.036, -.046), (-.036, -.046)]

def head(m):
    under = plane_fn((0, 1.382, 0), CAP[1])
    lobes = [(0, 1.12, .262, .056), (.06, 1.116, .254, .058), (.118, 1.106, .23, .056), (.168, 1.096, .19, .048)]  # broader, flatter brush
    chin = [('ell', (0, 1.075, .08), (.15, .09, .13))]
    skull, _ = plumber_head(m, under, nose=((0, 1.185, .262), (.088, .092, .096)), lobes=lobes, chin=chin,
                            eye_kw=dict(w=.049, h=.072), brow=dict(lift=.3, slant=-8, thick=.34, width=1.1, arch=.3, mat='hair', gap=.006))
    dome, crown = ((0, 1.445, -.012), (.256, .245, .256)), ((0, 1.53, .04), (.195, .2, .185))
    plumber_cap(m, CAP, L, mark='trim', dome=dome, crown=crown)
    m.add(trim(skull, under, .04), 'skin', 'head', tag='skull')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .62, 0), (.185, .13, .16)), ('ell', (0, .76, .02), (.2, .16, .175)), ('ell', (0, .93, 0), (.195, .14, .16)),
                 ('cap', (-.165, 1.025, -.01), (.165, 1.025, -.01), .088), ('ell', (0, 1.04, 0), (.15, .07, .12))], tris=1500, relax=1)
    def overalls(p):
        ax = abs(p.x); bib = min(.125 - ax, .985 - p.y, p.z - .02); strap = min(.03 - abs(ax - .1), p.y - .7)
        return max(.8 - p.y, bib, strap)
    shell = layer(body, overalls, .012, .013, relax=1, tris=1200); trim(body, lambda p: min(overalls(p), .77 - p.y))
    m.add(body, 'primary', w, tag='shirt'); m.add(shell, 'secondary', w, tag='overalls'); surf = Surf(shell)
    for s in (1, -1):
        p, n = surf.hit((s * .1, .95, 0))
        m.add(sphere(p + n * .004, (.03, .03, .013), 14, 8, rot=[math.degrees(a) for a in aim(n).to_euler()]), 'accent', w, rigid=True, tag='buttons')
    m.add(capsule((0, 1.06, -.01), (0, 1.24, 0), .088, .085, 16), 'skin', 'neck', tag='neck')

def limbs(m, s, S):
    glove_arm(m, s, S, J, (.078, .068, .06), u=.074)
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .105, .09, 16), 'secondary', f'thigh_{S}', tag='legs')
    m.add(lathe(kn, (an.x, .1, 0), [(-.09, 0), (-.086, .04), (-.06, .077), (-.03, .09), (.08, .09), (.18, .098), (.215, .102), (.227, .09), (.23, 0)], 16),
          'secondary', f'shin_{S}', tag='legs')
    shoe(m, s, S, an + Vector((0, 0, .025)), .33, .18, .15, 'hair', 'dark', sole=.03, toe=1.05, heel=.85, up=.012, tris=640)

def build():
    m = Model('luigi', J, COLORS, COSTUMES, prop='none')
    with m.transform(**HEAD): head(m)
    torso(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
