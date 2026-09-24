"""Pichu (Melee): the tiny baby of the Pikachu line. An even bigger head on a small round body, huge ears with black
outer halves, pink cheeks, big glossy black eyes, a black collar marking at the neck and a short black tail that
flicks up. Built by pikachu.rodent(); costumes recolor by material only (Melee's alternates add accessories)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters.pikachu import rodent

COLORS = {'primary': '#f8e07a', 'accent': '#f48aa0', 'hair': '#22181a', 'trim': '#d8505a', 'dark': '#231a1c', 'eye': '#1d1618', 'eye-white': '#ffffff'}
COSTUMES = [('Red', {'primary': '#f6d05a', 'hair': '#8a1f24', 'accent': '#f25a64'}),
            ('Blue', {'primary': '#f7ea9c', 'hair': '#1f3576', 'accent': '#f59ab8'}),
            ('Green', {'primary': '#ecdf6a', 'hair': '#1f5a30', 'accent': '#f38a90'})]
J = humanoid(hip=.22, spine=.28, chest=.35, neck=.4, head=.45, arm_y=.36, shoulder=.05, arm=.14, elbow=.235, wrist=.33,
             leg=.09, leg_y=.2, knee=.12, ankle=.05, clav_y=.36)
IDLE = {'sym': {'upperarm': (0, -30, -48), 'forearm': (0, -50, 0), 'hand': (0, 0, -20), 'thigh': (0, 0, 4), 'foot': (0, 0, -4)}, 'spine': (4, 0, 0), 'head': (-8, 0, 0)}
HERO = {'root_loc': (0, .12, 0), 'hips': (0, -20, 0), 'spine': (-8, -6, 0), 'chest': (-6, -8, 0), 'head': (-8, -16, 8),
        'upperarm_L': (0, -20, 50), 'forearm_L': (0, -30, 20), 'hand_L': (0, 0, 20), 'upperarm_R': (0, 40, -20), 'forearm_R': (0, 40, 0),
        'thigh_L': (-50, 0, 14), 'shin_L': (60, 0, 0), 'foot_L': (-20, 0, 0), 'thigh_R': (30, 0, -14), 'shin_R': (40, 0, 0), 'foot_R': (30, 0, 0),
        'extra_tail_0': (-20, 0, 0), 'extra_earL_0': (0, 0, -8), 'extra_earR_0': (0, 0, 8)}
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -12, 4)}, 'shoulders': .05, 'fill': .9}

def extra(m, J, face, w):
    collar = [(-.13, .03), (-.06, .02), (0, -.035), (.06, .02), (.13, .03), (.12, -.005), (.05, -.02), (0, -.07), (-.05, -.02), (-.12, -.005)]
    m.add(stamp(face, (0, .45, 0), [collar], .006), 'hair', w, rigid=True, tag='collar')
    pts = [(0, .2, -.13), (0, .24, -.24), (0, .34, -.3), (0, .45, -.28)]; wt = m.chain('tail', 'hips', pts)
    m.add(strand(pts, .028, .012, sq=(1, .7), up=(1, 0, 0), n=12, seg=10), 'hair', wt, tag='tail')

CFG = dict(head=Vector((0, .665, .02)), head_r=(.26, .235, .22), jowl=(.08, -.09, .05, (.12, .09, .11)), tris=2800,
           body=[('ell', (0, .25, .02), (.175, .16, .16)), ('ell', (0, .35, 0), (.155, .1, .13)), ('ell', (0, .43, .0), (.17, .09, .145))],
           spans=[(.16, .3), (.24, .39), (.3, .52), (.36, .6)],
           eye=(.1, .03, .05, .06), cheek=(.17, -.07, .05), mouth=.26,
           ear=((.1, .84, -.02), (.25, .98, -.03), (.37, 1.07, -.05), .14, .55), arm=.044, leg=.068, foot=(.062, .16, .072), extra=extra)

def build():
    m = Model('pichu', J, COLORS, COSTUMES, prop='none'); rodent(m, J, CFG); return m

main(globals())
