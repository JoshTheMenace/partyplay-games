"""Roy (Melee): young lord with wild spiky red hair under a white headband whose tails stream behind, fierce blue
eyes; bright blue tunic and skirt, silver breastplate with a gold hem, one big pauldron on the left shoulder, white cape
with a blue lining, brown gloves, belt and boots over pale tights. The Sword of Seals (broad flame-edged blade with a
glowing core, gold hilt) rides the prop bone in his right hand. Built with Marth's lord builders."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *
from fighters.marth import scalp, lord_torso, lord_limbs

COLORS = {'primary': '#2f52b8', 'secondary': '#f1eee6', 'light': '#e4e0d6', 'trim': '#6e452e', 'metal': '#c8ceda', 'accent': '#eab83a', 'hair': '#d9432b',
          'skin': '#f6cfaa', 'dark': '#221a22', 'eye': '#2f6fd0', 'eye-white': '#ffffff', 'emissive': '#ff6a2a'}
COSTUMES = [('Red', {'primary': '#b3302c', 'secondary': '#f2e4c2'}), ('Green', {'primary': '#2e7a40', 'secondary': '#eee8d0'}),
            ('Gold', {'primary': '#d6a52e', 'secondary': '#ffffff', 'trim': '#8a5a2a'})]
HU = .066
J = humanoid(hip=1.0, spine=1.12, chest=1.3, neck=1.51, head=1.59, arm_y=1.45, shoulder=.07, arm=.2, elbow=.46, wrist=.69,
             leg=.1, leg_y=.96, knee=.53, ankle=.09, clav_y=1.43, grip=(-.69 - HU * 1.25, 1.45 - HU * .45, 0))
HC = Vector((0, 1.715, .015))
T = dict(hip=1.0, chest=1.28, arm_y=1.45, w=.16, d=.108, sh=.19, plate=1.2, hem=.7, hu=HU, boot=.44, glove='trim', belt='trim', collar='light')

HERO = {'root_loc': (0, -.12, 0), 'hips': (0, -24, 0), 'spine': (10, -10, 0), 'chest': (6, -12, 0), 'head': (-6, 20, 0),
        'upperarm_R': (0, 40, 38), 'forearm_R': (0, 22, 0), 'hand_R': (-62, 0, 0),
        'upperarm_L': (0, 35, -55), 'forearm_L': (0, -35, 0), 'hand_L': (0, 0, 0),
        'thigh_L': (-60, 0, 14), 'shin_L': (65, 0, 0), 'foot_L': (-5, 0, 0), 'thigh_R': (30, 0, -16), 'shin_R': (30, 0, 0), 'foot_R': (18, 0, 0),
        'extra_cape_0': (30, 0, 10), 'extra_cape_1': (15, 0, 5), 'extra_cape_2': (10, 0, 0), 'extra_bandL_0': (40, 0, 0), 'extra_bandR_0': (35, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, 0, -82), 'forearm': (0, -10, 0)}, 'head': (-4, -14, 0)}, 'shoulders': .34}

def head(m):
    c = HC; o = lambda x, y, z: c + Vector((x, y, z))
    skull, face = human_head(m, c, (.118, .135, .127), jaw=.92, chin=.85, nose=(.017, .035), nose_y=-.05, ears='round', tris=1400,
                             mouth=[(-.03, -.096), (-.01, -.102), (.012, -.102), (.032, -.094)],
                             eyes=dict(x=.048, y=-.008, w=.032, h=.036, tilt=8, iris=.64, pupil=.48, look=(0, .05), lid=(.22, 12), lash=.18,
                                       brow=dict(lift=.3, slant=16, thick=.36, width=1.08, arch=.05, mat='hair', gap=.006)))
    keep = scalp(m, skull, c, .07, -.1, .03, tris=420); trim(skull, keep, .05); m.add(skull, 'skin', 'head', tag='face')
    # Wild spikes: a crown sweeping up and back, spiky bangs forward over the headband, and flicks at the sides.
    tips = [((0, .2, -.02), .06), ((.07, .19, -.05), .052), ((-.07, .19, -.05), .052), ((.11, .12, -.1), .046), ((-.11, .12, -.1), .046),
            ((0, .15, -.13), .05), ((.06, .06, -.17), .045), ((-.06, .06, -.17), .045), ((0, -.02, -.17), .04), ((.14, .05, -.04), .04), ((-.14, .05, -.04), .04)]
    for (x, y, z), r in tips:
        base = o(x * .45, .07 + y * .25, z * .35); m.add(spike(base, lerp(base, o(x, y, z), .55) + Vector((0, .02, 0)), o(x * 1.05, y + .02, z * 1.1), r, sq=(1, .75), n=6, seg=7), 'hair', 'head', tag='hair')
    for x, dy in ((0, .07), (.045, .06), (-.045, .06), (.085, .05), (-.085, .05)):
        a = o(x * .8, .1, .085); m.add(spike(a, o(x * 1.1, .085, .15), o(x * 1.35, .085 - dy, .15), .032, sq=(1, .55), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='hair')
    for s in (1, -1):
        m.add(spike(o(s * .1, .04, .05), o(s * .13, -.02, .06), o(s * .125, -.09, .04), .03, sq=(1, .5), up=(1, 0, 0), n=6, seg=7), 'hair', 'head', tag='hair')
    # Headband with two streaming tails.
    m.add(torus(o(0, .055, -.01), (.138, .145), .016, 24, 5, rot=(-14, 0, 0), sq=(.7, 1.3)), 'secondary', 'head', tag='headband')
    for s, S in ((1, 'L'), (-1, 'R')):
        pts = [o(s * .03, .03, -.148), o(s * .08, -.06, -.2), o(s * .1, -.16, -.23)]; w = m.chain(f'band{S}', 'head', pts)
        m.add(ribbon(spline(pts, 8), [.05, .054, .052, .048, .042, .036, .028, .018], .009, normal=(0, 0, -1), seg=6), 'secondary', w, tag='headband')

def pauldron(m):
    c = Vector((T['sh'] + .02, T['arm_y'] + .015, 0)); R = (.105, .06, .11)
    for k, (dy, sc) in enumerate(((0, 1.0), (-.045, .92))):
        g = sphere(c + Vector((.01 * k, dy, 0)), (R[0] * sc, R[1] * sc, R[2] * sc), 16, 9, rot=(0, 0, -22 - 10 * k)); cut(g, c + Vector((0, dy - R[1] * .1, 0)), (.35, 1, 0), keep='above')
        bmesh.ops.solidify(g, geom=list(g.faces), thickness=.012); m.add(g, 'metal', 'shoulder_L', tag='pauldron')
    m.add(sphere(c + Vector((.02, .045, .06)), .016, 10, 6), 'accent', 'shoulder_L', tag='pauldron')

def build():
    m = Model('roy', J, COLORS, COSTUMES, prop='always')
    head(m); lord_torso(m, T); pauldron(m); m.both(lambda s, S: lord_limbs(m, J, s, S, T))
    cape(m, 'cape', 'chest', T['arm_y'] - .01, -.12, .38, .78, ('secondary', 'primary'), n=3, flare=1.45, back=-.13, curve=.1)
    for s in (1, -1): m.add(sphere((s * .14, T['arm_y'] - .02, .085), .022, 10, 6), 'accent', 'chest', tag='clasps')
    sword(m, P(J, 'prop'), .8, .07, ('metal', 'accent', 'trim', 'accent'), guard_style='wings', grip_len=.17, guard=.2, tip=.12,
          flare=lambda t: 1 + .35 * math.sin(math.pi * min(1, t * 1.2)) - .15 * t, glow='emissive')  # Sword of Seals
    return m

main(globals())
