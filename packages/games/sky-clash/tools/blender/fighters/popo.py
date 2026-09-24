"""Popo (Melee Ice Climbers): a chunky little mountaineer in a puffy one-piece blue parka whose big round hood frames
the face with a ring of white fur. Round face with big dark eyes, rosy cheeks, a button nose and brown bangs; pink
mittens, brown boots with fur cuffs. The wooden mallet is always in his right mitten (renderer grip 'hammer').
climber() is shared with nana.py."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#3f7fe0', 'light': '#f7f6f2', 'accent': '#ee5f8e', 'secondary': '#7a4a2a', 'trim': '#c08a52', 'metal': '#b9c0ca',
          'skin': '#fbd2b0', 'hair': '#6a3e22', 'dark': '#231a1c', 'eye': '#2e2230', 'eye-white': '#ffffff'}
COSTUMES = [('Green', {'primary': '#3fae4a'}), ('Orange', {'primary': '#f29a3a', 'accent': '#e04a4a'}), ('Red', {'primary': '#d8343c', 'accent': '#f6a0c0'})]
J = humanoid(hip=.33, spine=.42, chest=.52, neck=.62, head=.68, arm_y=.585, shoulder=.07, arm=.19, elbow=.33, wrist=.46,
             leg=.1, leg_y=.31, knee=.18, ankle=.065, clav_y=.58)
IDLE = {'sym': {'upperarm': (0, -14, -60), 'forearm': (0, -40, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 4), 'foot': (0, 0, -4)}, 'head': (-3, 0, 0)}
HERO = {'root_loc': (0, .1, 0), 'hips': (0, -18, 0), 'spine': (-6, -4, 0), 'chest': (-6, -6, 0), 'head': (-8, -8, 0),
        'upperarm_R': (0, 45, 0), 'forearm_R': (0, 30, 0), 'hand_R': (-60, 0, 0),
        'upperarm_L': (0, 20, -40), 'forearm_L': (0, -50, 0), 'hand_L': (0, 0, -10),
        'thigh_L': (-60, 0, 8), 'shin_L': (70, 0, 0), 'foot_L': (-10, 0, 0), 'thigh_R': (20, 0, -8), 'shin_R': (40, 0, 0), 'foot_R': (20, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -10, 0), 'upperarm_R': (0, -35, 72), 'forearm_R': (0, 0, 0)}, 'shoulders': .3, 'fill': .88}

HC = Vector((0, .9, .04))  # face center inside the hood
OPEN = (HC + Vector((0, -.01, 0)), .158, .18)  # face opening: center, half width, half height

def mitten(m, s, S, wrist, u):
    """Puffy mitten: palm, a closed finger block curling down, a thumb toward +Z. Returns the grip point."""
    W = v3(wrist); X = Vector((s, 0, 0)); Y = Vector((0, 1, 0)); Z = Vector((0, 0, 1))
    m.add(blob([('ell', W + X * u * .9, (u * .95, u * .62, u * .85)), ('ell', W + X * u * 1.75 - Y * u * .35, (u * .6, u * .62, u * .78)),
                ('cap', W + X * u * .7 + Z * u * .55, W + X * u * 1.2 + Z * u * 1.05 - Y * u * .25, u * .32)], tris=520, relax=2), 'accent', f'hand_{S}', tag='mittens')
    m.add(torus(W + X * u * .05, u * .72, u * .2, 18, 6, rot=(0, 0, 90)), 'accent', f'hand_{S}', tag='mittens')
    return W + X * u * 1.25 - Y * u * .35

def fluff(ring, r, tris, bone='head'):
    """Soft fur: a ring or line of overlapping balls blended by metaballs."""
    return blob([('ball', p, r * (1 + .18 * math.sin(i * 2.7))) for i, p in enumerate(ring)], tris=tris, relax=2)

def climber(m, J, bangs, girl=False):
    """The shared Ice Climber: hood, face, parka, mittens, boots and mallet. bangs(m, HC) adds the hair."""
    c, hw, hh = OPEN
    def opening(p): return 1 - ((p.x - c.x) / hw) ** 2 - ((p.y - c.y) / hh) ** 2
    skull = blob([('ell', HC, (.19, .19, .17)), ('ell', HC + Vector((0, -.06, .04)), (.15, .1, .12))], tris=1300, relax=3); face = Surf(skull)
    m.add(skull, 'skin', 'head', tag='face')
    m.add(sphere(HC + Vector((0, -.035, .19)), (.03, .026, .026), 14, 8), 'skin', 'head', tag='nose')
    smile(m, face, [HC + Vector((-.045, -.1, .2)), HC + Vector((-.02, -.115, .2)), HC + Vector((.02, -.115, .2)), HC + Vector((.045, -.1, .2))], .007)
    for s in (1, -1):
        eye(m, face, HC + Vector((s * .062, .02, 0)), .036, .052, s, iris=.84, iris_h=.86, pupil=.6, look=(-s * .08, .08), lash=.12, sclera=True,
            brow=dict(lift=.35, slant=-8, thick=.3, width=.8, arch=.35, mat='hair', gap=.004))
        m.add(stamp(face, HC + Vector((s * .11, -.06, 0)), [ellipse(.034, .02, 20)], .004, d=(-s * .4, 0, -1)), 'accent', 'head', tag='blush')
        if girl:
            p, n = face.hit(HC + Vector((s * .094, .058, 0))); m.add(spike(p, p + Vector((s * .014, .01, .004)), p + Vector((s * .03, .014, -.004)), .008, n=5, seg=6), 'dark', 'head', tag='lashes')
    bangs(m, HC, face)
    hood = blob([('ell', HC + Vector((0, .02, -.05)), (.265, .27, .255)), ('ell', HC + Vector((0, -.1, -.06)), (.22, .15, .2))], tris=1500, relax=2)
    split_by(hood, lambda p: opening(p) if p.z > HC.z else -1); bmesh.ops.delete(hood, geom=[f for f in hood.faces if f.calc_center_median().z > HC.z and opening(f.calc_center_median()) > 0], context='FACES')
    hood.normal_update(); bmesh.ops.solidify(hood, geom=list(hood.faces), thickness=.02); m.add(hood, 'primary', 'head', tag='hood')
    ring = [c + Vector((hw * 1.08 * math.sin(t), hh * 1.07 * math.cos(t), 0)) for t in np.linspace(0, 2 * math.pi, 23)[:-1]]
    hs = Surf(hood); ring = [hs.near(p + Vector((0, 0, .2)))[0] for p in ring]
    m.add(fluff(ring, .042, 1300), 'light', 'head', tag='fur')
    # Puffy parka body, a quilted hem roll, and the neck hidden by the hood.
    w = m.spine(('hips', 'spine', 'chest'))
    m.add(blob([('ell', (0, .4, 0), (.205, .16, .17)), ('ell', (0, .52, .0), (.2, .12, .16)), ('cap', (-.16, .585, -.01), (.16, .585, -.01), .085)], tris=1300, relax=2), 'primary', w, tag='parka')
    m.add(torus((0, .31, 0), (.2, .165), .03, 30, 8), 'primary', w, tag='parka')
    m.add(capsule((0, .6, -.01), (0, .78, 0), .09, .09, 14), 'primary', 'neck', tag='parka')
    def limbs(s, S):
        sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
        m.add(capsule(sh, el, .08, .072, 16), 'primary', f'upperarm_{S}', tag='arms'); m.add(capsule(el, wr, .072, .065, 16), 'primary', f'forearm_{S}', tag='arms')
        mitten(m, s, S, wr + Vector((s * .01, 0, 0)), .06)
        hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
        m.add(capsule(hp, kn, .09, .082, 16), 'primary', f'thigh_{S}', tag='legs'); m.add(capsule(kn, an + Vector((0, .06, 0)), .082, .075, 16), 'primary', f'shin_{S}', tag='legs')
        shoe(m, s, S, an + Vector((0, 0, .02)), .21, .15, .14, 'secondary', 'dark', sole=.03, toe=1.1, heel=.9, up=.01, tris=520)
        m.add(fluff([an + Vector((.075 * math.sin(t), .12, .07 * math.cos(t) + .01)) for t in np.linspace(0, 2 * math.pi, 13)[:-1]], .03, 400), 'light', f'shin_{S}', tag='fur')
    m.both(limbs)
    # Wooden mallet: the handle runs through the fist, tilted so it stands upright when the arm hangs; the head is the far end.
    g = P(J, 'prop'); D = Vector((.34, .46, .82)).normalized(); X = Vector((1, 0, 0)); A = (X - D * D.dot(X)).normalized()
    m.add(cyl(g - D * .08, g + D * .4, .022, seg=12, bevel=.008), 'trim', 'prop', tag='hammer')
    hd = g + D * .46; R = [math.degrees(x) for x in Vector((0, 1, 0)).rotation_difference(A).to_euler()]
    m.add(cyl(hd - A * .11, hd + A * .11, .07, seg=18, bevel=.02, up=tuple(D)), 'trim', 'prop', tag='hammer')
    for k in (-.08, .08): m.add(torus(hd + A * k, .072, .011, 18, 5, rot=R), 'metal', 'prop', tag='hammer')

def popo_bangs(m, HC, face):
    for x, dx, L in ((-.08, -.03, .07), (-.03, -.01, .08), (.02, .01, .08), (.07, .03, .07)):
        a = HC + Vector((x, .15, .1)); m.add(spike(a, a + Vector((dx * .5, 0, .05)), a + Vector((dx, -L, .07)), .042, sq=(1, .5), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='hair')

def build():
    m = Model('popo', J, COLORS, COSTUMES, prop='always'); climber(m, J, popo_bangs); return m

main(globals())
