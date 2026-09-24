"""Male Fighting Wire Frame (Melee): a faceless, Captain Falcon-built training dummy made of glowing polygon wire over a
dark translucent core. Broad V torso, heavy shoulders and arms, strong legs, an egg head with a hard jaw.

Every body part is a regular low-poly cage (lathes and capsules, so the struts form clean quad rings like a real
wireframe model), turned into emissive struts with common.wire() over a smooth, slightly smaller 'dark' core. The
renderer draws the wire style translucent with a cyan rim. Limb parts are rigid capsules centered on the joints (ball
joints); the torso shares spine weights. female-wireframe.py reuses figure()."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'emissive': '#c77dff', 'dark': '#2a1640', 'light': '#e9d4ff'}
COSTUMES = [('Cyan', {'emissive': '#5fe3ff', 'dark': '#10303e', 'light': '#d4f6ff'}),
            ('Lime', {'emissive': '#9dff5c', 'dark': '#1b3614', 'light': '#e4ffd0'}),
            ('Gold', {'emissive': '#ffc34d', 'dark': '#3e2a0e', 'light': '#fff0cc'})]
J = humanoid(hip=.98, spine=1.12, chest=1.3, neck=1.56, head=1.64, arm_y=1.5, shoulder=.1, arm=.27, elbow=.58, wrist=.86,
             leg=.12, leg_y=.93, knee=.5, ankle=.1, clav_y=1.49)
BODY = dict(torso=[(0, .13), (.03, .165), (.13, .17), (.26, .14), (.4, .195), (.52, .255), (.6, .245), (.66, .14), (.67, 0)], sq=.7,
            head=(.1, .122, .115), chin=.035, arm=(.086, .07, .068, .056), leg=(.118, .086, .078, .06), hand=(.088, .04, .06), foot=(.07, .054, .135),
            deltoid=.1, neck=.064)
HERO = {'root_loc': (0, -.04, 0), 'hips': (0, -24, 0), 'spine': (6, -8, 0), 'chest': (6, -10, 0), 'head': (-6, -8, 0),
        'upperarm_R': (0, 30, 50), 'forearm_R': (0, 100, 0), 'hand_R': (0, 0, 20), 'upperarm_L': (0, -40, -20), 'forearm_L': (0, -90, 0), 'hand_L': (0, 0, 10),
        'thigh_L': (-40, 0, 12), 'shin_L': (60, 0, 0), 'foot_L': (-15, 0, 0), 'thigh_R': (24, 0, -12), 'shin_R': (40, 0, 0), 'foot_R': (18, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-4, -12, 0)}, 'shoulders': .5}

def part(m, cage, bone, thick=.011, core=.012, tag='wire', rigid=False):
    """One wire part: the cage's edges become emissive struts over a smooth dark core just inside them."""
    body = subd(cage.copy(), 1); push(body, -core); smooth(body, 1)
    m.add(body, 'dark', bone, rigid=rigid, tag='core')
    m.add(wire(cage, thick), 'emissive', bone, rigid=rigid, tag=tag)

def figure(m, J, B, hair=None):
    w = m.spine(('hips', 'spine', 'chest'))
    hy, ny = P(J, 'hips').y, P(J, 'neck').y; L = ny - hy + .12
    part(m, lathe((0, hy - .07, 0), (0, hy - .07 + L, 0), [(d * L / .67, r) for d, r in B['torso']], 12, sq=(1, B['sq'])), w, tag='torso')
    hd = P(J, 'head'); c = hd + Vector((0, B['head'][1] * .95, .01))
    hb = sphere(c, B['head'], 10, 9, rot=(-8, 0, 0)); k = B['chin']; h = B['head'][1]  # egg head with a hard jaw pushed forward
    part(m, bend(hb, lambda p: p + Vector((0, 0, k * smooth01((c.y - p.y) / h + .2) * max(0, p.z - c.z + .05) / .15))), 'head', tag='head')
    part(m, capsule(P(J, 'chest') + Vector((0, .2, -.01)), hd + Vector((0, .06, 0)), B['neck'], B['neck'] * .9, 8, caps=2), 'neck', tag='neck')
    if hair: hair(m, c)
    for s, S in ((1, 'L'), (-1, 'R')):
        sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}'); a0, a1, f0, f1 = B['arm']
        if B['deltoid']: part(m, sphere(sh + Vector((s * .01, .01, 0)), B['deltoid'], 8, 6), f'upperarm_{S}', tag='arms')
        part(m, capsule(sh, el, a0, a1, 8, caps=2), f'upperarm_{S}', tag='arms')
        part(m, capsule(el, wr, f0, f1, 8, caps=2), f'forearm_{S}', tag='arms')
        part(m, sphere(wr + Vector((s * B['hand'][0] * .9, -.01, .005)), B['hand'], B.get('hseg', 8), 6), f'hand_{S}', tag='hands')
        hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}'); t0, t1, s0, s1 = B['leg']
        part(m, capsule(hp, kn, t0, t1, 8, caps=2), f'thigh_{S}', tag='legs')
        part(m, capsule(kn, an + Vector((0, .03, 0)), s0, s1, 8, caps=2), f'shin_{S}', tag='legs')
        fx, fy, fz = B['foot']; foot = cut(sphere((an.x, fy * .8, an.z + fz * .45), (fx, fy, fz), 8, 6), (0, 0, 0), (0, 1, 0), keep='above')
        part(m, foot, f'foot_{S}', tag='feet')

def build():
    m = Model('male-wireframe', J, COLORS, COSTUMES, prop='none')
    figure(m, J, BODY); return m

main(globals())
