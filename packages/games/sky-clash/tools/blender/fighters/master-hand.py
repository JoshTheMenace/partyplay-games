"""Master Hand (Melee): a giant floating white right glove with a flared cuff, soft padded fingers, stitched seams on
the back and a chunky thumb.

Body plan (style 'hand'): the renderer skips limb IK and curls every joint of the four limb chains about model X, so
the four chains are the fingers (index..pinky sorted by X: +X side gets the _L chains, as hand_L must sit at +X). The glove
is built upright, palm facing +Z and fingers up, then pitched forward: a curl about X always folds the fingers toward
the palm, and the renderer's forward flip (spin) lays the palm flat for the Palm Slam. The thumb is an extra_thumb
spring chain. The cuff bottom is the lowest point (y=0); the game floats the hand. Crazy Hand reuses glove() mirrored."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'light': '#f6f4f0', 'trim': '#d9d4dc', 'secondary': '#ebe7ee', 'dark': '#2a2430'}
COSTUMES = [('Gold', {'light': '#f5d77a', 'trim': '#d0a84a', 'secondary': '#f0cc62'}),
            ('Shadow', {'light': '#5a5666', 'trim': '#3c3846', 'secondary': '#4a4656'}),
            ('Rose', {'light': '#f7cfd8', 'trim': '#e0a4b4', 'secondary': '#f2bccb'})]
# Fingers: (x, knuckle y, length, radius, splay deg about Z, index->pinky). Authored for the right glove (thumb at +X).
FINGERS = [(.268, 1.05, .56, .1, -6), (.09, 1.08, .63, .104, -2), (-.09, 1.06, .58, .1, 2), (-.262, .99, .47, .092, 7)]
PHAL = (.44, .31, .25)

def pitched(p, pitch, side):
    return Vector((0, 0, 0)) + rot3((pitch, 0, 0)) @ Vector((p[0] * side, p[1], p[2]))

def layout(side=1, pitch=24, splay=1.0, fingers=FINGERS):
    """Joint map and finger polylines for a glove. side=+1 right glove (Master Hand), -1 left glove (Crazy Hand)."""
    pos = {'root': (0, 0, 0), 'hips': (0, .42, -.03), 'spine': (0, .6, -.05), 'chest': (0, .78, -.05), 'neck': (0, .92, -.06), 'head': (0, 1.0, -.06)}
    order = sorted(range(4), key=lambda i: -fingers[i][0] * side)  # +X first
    names = [('shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L'), ('hips', 'thigh_L', 'shin_L', 'foot_L'),
             ('hips', 'thigh_R', 'shin_R', 'foot_R'), ('shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R')]
    polys = {}
    for slot, i in enumerate(order):
        x, y, L, r, a = fingers[i]; a *= splay; d = Vector((-math.sin(math.radians(a)), math.cos(math.radians(a)), 0))
        k0 = Vector((x, y, 0)); pts = [k0]
        for f in PHAL: pts.append(pts[-1] + d * L * f)
        base, b1, b2, b3 = names[slot]
        if base != 'hips': pos[base] = tuple(k0 - d * .1)
        for b, p in zip((b1, b2, b3), pts): pos[b] = tuple(p)
        polys[i] = (pts, r, (b1, b2, b3))
    pos['prop'] = tuple(polys[order[3]][0][-1])
    P2 = {b: pitched(p, pitch, side) for b, p in pos.items()}
    return skeleton(P2), {i: ([pitched(p, pitch, side) for p in pts], r, bs) for i, (pts, r, bs) in polys.items()}

def glove(kind, colors, costumes, side=1, pitch=24, splay=1.0, fingers=FINGERS, thumb_bend=0.0):
    J, polys = layout(side, pitch, splay, fingers)
    m = Model(kind, J, colors, costumes, prop='none')
    with m.transform(rot=(pitch, 0, 0), scale=(side, 1, 1)):
        w = m.spine(('hips', 'spine', 'chest'))
        palm = blob([('box', (0, .76, 0), (.34, .3, .13), .15), ('ell', (0, .5, -.01), (.26, .13, .12)), ('ell', (.05, .98, .0), (.31, .1, .12), (0, 0, -8)),
                     ('ell', (0, .8, .06), (.24, .2, .07))], res=.02, tris=2600, relax=3)
        surf = Surf(palm)
        m.add(tube([(0, y, 0) for y in np.linspace(.86, .99, 3)], .02, 6), 'light', 'head', tag='core')  # hidden core: frames the portrait (head bone)
        m.add(palm, 'light', w, tag='palm')
        # Flared cuff with a rolled rim, open-looking thanks to a dark inner disc.
        cuff = lathe((0, 0, -.01), (0, .48, -.01), [(0, 0), (0, .3), (.03, .325), (.07, .318), (.14, .29), (.3, .262), (.42, .25), (.48, .24), (.481, 0)], 40, sq=(1, .6))
        m.add(cuff, 'secondary', 'hips', tag='cuff')
        m.add(torus((0, .035, -.01), (.315, .19), .03, 40, 8), 'light', 'hips', tag='cuff')
        m.add(torus((0, .44, -.01), (.25, .15), .018, 36, 6), 'trim', 'hips', tag='cuff')
        m.add(sphere((0, .005, -.01), (.27, .004, .16), 32, 4), 'dark', 'hips', tag='cuff')
        # Three stitched seams down the back of the glove.
        for x in (-.16, 0, .16):
            pts = [surf.hit((x, y, -1), (0, 0, 1))[0] for y in np.linspace(.56, .98, 10)]
            pts = [p + surf.near(p)[1] * .006 for p in pts]; m.add(tube(pts, .011, 8), 'trim', w, tag='seams')
        # Thumb: a thick two-joint digit on a spring chain from the palm's thumb side.
        tb = [Vector((.29, .56, .05)), Vector((.43, .72, .11)), Vector((.5 - thumb_bend * .06, .88, .15 + thumb_bend * .06)), Vector((.52 - thumb_bend * .1, 1.02, .17 + thumb_bend * .1))]
        wt = m.chain('thumb', 'spine', tb)
        m.add(blob([('cap', tb[0], tb[1], .105), ('cap', tb[1], tb[2], .098), ('cap', tb[2], tb[3], .09), ('ell', tb[0] + Vector((-.04, .04, 0)), (.1, .13, .1))], res=.02, tris=1500, relax=2), 'light', wt, tag='thumb')
    # Fingers: tapered padded capsules joint to joint (clean ball joints).
    for i, (pts, r, bs) in polys.items():
        for k, b in enumerate(bs):
            ra, rb = r * (1 - .05 * k), r * (1 - .05 * (k + 1)); a, c = pts[k], pts[k + 1]
            m.add(capsule(a, c, ra, rb, 18), 'light', b, tag='fingers')
    lift(m); return m

def lift(m):
    """Rest the lowest point on y=0 after the pitch (the game floats the hand)."""
    lo = min(v.co.y for bm, *_ in m.parts for v in bm.verts); d = Vector((0, -lo, 0))
    for bm, *_ in m.parts: bmesh.ops.translate(bm, vec=d, verts=bm.verts)
    m.J = {n: (tuple(v3(p) + d), par) for n, (p, par) in m.J.items()}

IDLE = {'sym': {'upperarm': (12, 0, 0), 'forearm': (14, 0, 0), 'hand': (10, 0, 0), 'thigh': (12, 0, 0), 'shin': (14, 0, 0), 'foot': (10, 0, 0)}}
CURL = {'sym': {'upperarm': (14, 0, 0), 'forearm': (18, 0, 0), 'hand': (12, 0, 0), 'thigh': (12, 0, 0), 'shin': (16, 0, 0), 'foot': (12, 0, 0)}}
HERO = {**CURL, 'root_loc': (0, .5, 0), 'hips': (58, 38, -12), 'extra_thumb_0': (0, 0, -12)}
HERO_VIEW = (-.5, .62, 1)  # hovering palm-down, fingers toward the foe
PORTRAIT = {'pose': {**CURL, 'hips': (64, 40, 0)}, 'shoulders': 6, 'fill': .82, 'view': (-.55, .85, 1)}

def build(): return glove('master-hand', COLORS, COSTUMES, side=1)

main(globals())
