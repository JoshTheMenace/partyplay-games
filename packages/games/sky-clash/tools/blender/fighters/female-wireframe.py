"""Female Fighting Wire Frame (Melee): the slender, Zelda-proportioned wire dummy. Narrow shoulders, small waist, flared
hips, long legs, a small faceless head with a wire hair cap and a long tapering ponytail on a spring chain. Built with
male-wireframe.figure()."""
import os, sys, importlib.util; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
_spec = importlib.util.spec_from_file_location('male_wireframe', os.path.join(os.path.dirname(os.path.realpath(__file__)), 'male-wireframe.py'))
MW = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(MW)

COLORS = {'emissive': '#ff8fd0', 'dark': '#3a1430'}
COSTUMES = [('Violet', {'emissive': '#b98cff', 'dark': '#24163e'}),
            ('Aqua', {'emissive': '#62f0e0', 'dark': '#0f3634'}),
            ('Amber', {'emissive': '#ffb24a', 'dark': '#3c220c'})]
J = humanoid(hip=.97, spine=1.08, chest=1.25, neck=1.49, head=1.56, arm_y=1.43, shoulder=.08, arm=.21, elbow=.47, wrist=.72,
             leg=.1, leg_y=.92, knee=.5, ankle=.09, clav_y=1.42)
BODY = dict(torso=[(0, .11), (.03, .15), (.12, .165), (.24, .11), (.34, .105), (.46, .15), (.56, .16), (.63, .1), (.67, 0)], sq=.68,
            head=(.088, .112, .102), chin=.012, arm=(.06, .05, .048, .04), leg=(.1, .07, .062, .046), hand=(.07, .032, .05), foot=(.055, .05, .12),
            deltoid=None, neck=.046, hseg=6)
HERO = {'root_loc': (0, .02, 0), 'hips': (0, -20, 6), 'spine': (-2, -6, 0), 'chest': (-4, -8, -4), 'head': (-6, -10, 6),
        'upperarm_R': (0, 60, -10), 'forearm_R': (0, 20, 0), 'hand_R': (0, 0, -30), 'upperarm_L': (0, 10, -30), 'forearm_L': (0, -20, 0), 'hand_L': (0, 0, 10),
        'thigh_L': (-20, 0, 6), 'shin_L': (30, 0, 0), 'foot_L': (-10, 0, 0), 'thigh_R': (12, 0, -4), 'shin_R': (8, 0, 0), 'foot_R': (10, 0, 0),
        'extra_hair_0': (18, 0, 0), 'extra_hair_1': (12, 10, 0), 'extra_hair_2': (10, 10, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-4, -12, 0)}, 'shoulders': .3}

def hair(m, c):
    cap = sphere(c + Vector((0, .01, -.012)), (.1, .112, .125), 10, 9, rot=(82, 0, 0))  # poles front/back so the cut leaves no spike
    cut(cap, c + Vector((0, 0, .04)), (0, -.35, -1), keep='above'); MW.part(m, cap, 'head', core=.006, tag='hair')
    pts = [c + Vector((0, .02, -.1)), c + Vector((0, -.12, -.16)), c + Vector((0, -.3, -.17)), c + Vector((0, -.5, -.14))]; wh = m.chain('hair', 'head', pts)
    MW.part(m, lathe(pts[0], pts[-1], [(0, 0), (.02, .05), (.1, .06), (.25, .055), (.4, .04), (.5, .02), (.52, 0)], 8, sq=(1, .7), up=(1, 0, 0)), wh, core=.006, tag='hair')

def build():
    m = Model('female-wireframe', J, COLORS, COSTUMES, prop='none')
    MW.figure(m, J, BODY, hair); return m

main(globals())
