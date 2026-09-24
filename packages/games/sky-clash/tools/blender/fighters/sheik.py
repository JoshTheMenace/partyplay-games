"""Sheik (Melee, Ocarina of Time look): a tall, lean Sheikah ninja. Indigo bodysuit, a cream head wrap with wound
bands and a loose tail, the indigo cowl pulled up over the nose, blond bangs falling over the right eye, sharp red
eyes, a cream chest panel with the red Sheikah eye and tear, a dark sash, bandage wraps on forearms, hands, shins
and feet. No prop (needles and the chain are effects)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#3d4a8f', 'secondary': '#262a4a', 'light': '#efe6d2', 'trim': '#d42f3a', 'skin': '#f4cfb2', 'hair': '#f1cf6a',
          'dark': '#1d1a26', 'eye': '#d0303a', 'eye-white': '#ffffff'}
COSTUMES = [('Red', {'primary': '#a8323c', 'secondary': '#3e1c22', 'trim': '#2a2a2a'}),
            ('Blue', {'primary': '#3f86d8', 'secondary': '#1d3050'}),
            ('Green', {'primary': '#3f8a4a', 'secondary': '#1f3a26'})]
J = humanoid(hip=.98, spine=1.08, chest=1.22, neck=1.42, head=1.5, arm_y=1.38, shoulder=.06, arm=.16, elbow=.43, wrist=.66,
             leg=.09, leg_y=.93, knee=.52, ankle=.09, clav_y=1.37)
IDLE = {'sym': {'upperarm': (0, -14, -64), 'forearm': (0, -40, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 4), 'foot': (0, 0, -4)}, 'spine': (4, 0, 0), 'head': (-2, 0, 0)}
HERO = {'root_loc': (0, -.26, 0), 'hips': (0, -25, 0), 'spine': (24, 0, 0), 'chest': (8, -10, 0), 'head': (-26, -6, 0),
        'upperarm_L': (0, -65, -18), 'forearm_L': (0, -15, 0), 'hand_L': (0, 0, -10), 'upperarm_R': (0, -50, 22), 'forearm_R': (0, 35, 0), 'hand_R': (0, 0, 15),
        'thigh_L': (-78, 0, 12), 'shin_L': (96, 0, 0), 'foot_L': (-18, 0, 0), 'thigh_R': (5, 0, -22), 'shin_R': (88, 0, 0), 'foot_R': (-10, 0, 0),
        'extra_wrap_0': (40, 0, 10), 'extra_wrap_1': (20, 0, 0), 'extra_wrap_2': (15, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, -4, -82), 'forearm': (0, -10, 0)}, 'head': (-6, -12, 0)}, 'shoulders': -.2}

HC = Vector((0, 1.665, 0))
def head(m):
    skull = blob([('ell', HC + Vector((0, .02, -.01)), (.132, .14, .135)), ('ell', HC + Vector((0, -.05, .03)), (.1, .085, .1)), ('ell', HC + Vector((0, -.03, .085)), (.05, .04, .05))],
                 tris=1400, relax=3)
    face = Surf(skull); top, low = HC.y + .03, HC.y - .045
    split_by(skull, lambda p: p.y - top); split_by(skull, lambda p: low - p.y)
    m.add(skull, lambda c, n: 'light' if c.y > top else 'primary' if c.y < low else ('skin' if c.z > .02 else 'light'), 'head', tag='head')
    for s in (1, -1):
        eye(m, face, HC + Vector((s * .05, -.01, 0)), .037, .03, s, tilt=12, iris=.74, pupil=.42, look=(-s * .15, 0), lid=(.16, 12), lash=.22, sink=.55)
    # Wound bands of the head wrap, a knot at the back and a loose tail on a spring chain.
    for dy, tilt, ph in ((.035, -14, 0), (.085, -26, 1.3), (.125, -40, 2.4)):  # wound bands hugging the skull
        R = rot3((tilt, 0, 0)); ring = [face.near(HC + Vector((0, dy, 0)) + R @ Vector((math.sin(t) * .3, 0, math.cos(t) * .3))) for t in np.linspace(0, 2 * math.pi, 33)[:-1]]
        pts = [p + n * .004 for p, n in ring]; pts.append(pts[0])
        m.add(tube(pts, [.012 + .004 * math.sin(3 * k / 32 * 2 * math.pi + ph) for k in range(33)], 6, sq=(1, .55), ends=(False, False)), 'light', 'head', tag='wrap')
    m.add(sphere(HC + Vector((0, .01, -.145)), (.045, .04, .03), 12), 'light', 'head', tag='wrap')
    pts = [HC + Vector((.0, .0, -.15)), HC + Vector((.02, -.13, -.2)), HC + Vector((.03, -.27, -.2)), HC + Vector((.035, -.4, -.19))]
    w = m.chain('wrap', 'head', pts); m.add(ribbon(spline(pts, 10), [.07, .08, .085, .088, .088, .085, .08, .072, .06, .04], .012, normal=(0, 0, 1)), 'light', w, tag='wrap')
    for x0, dx, dz, r in ((-.035, -.015, .03, .04), (-.075, -.02, .02, .042), (-.11, -.01, .0, .036), (.02, .025, .02, .028)):  # bangs over the right eye
        a = HC + Vector((x0, .05, .12)); m.add(spike(a, a + Vector((dx, -.03, dz + .03)), a + Vector((dx * 2, -.13 + abs(x0) * .3, dz + .02)), r, sq=(1, .5), up=(0, 0, 1), n=7, seg=8), 'hair', 'head', tag='bangs')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, 1.0, 0), (.155, .11, .11)), ('ell', (0, 1.12, 0), (.12, .1, .09)), ('ell', (0, 1.26, .01), (.15, .105, .105)),
                 ('ell', (0, 1.3, .04), (.1, .06, .07)), ('cap', (-.14, 1.37, -.01), (.14, 1.37, -.01), .07)], tris=1300, relax=2)
    def panel(p): return min(p.z - .02, 1.345 - p.y, p.y - 1.07, .1 - abs(p.x) + (p.y - 1.07) * .15)
    shell = layer(body, panel, .008, .01, relax=1, tris=900); m.add(body, 'primary', w, tag='suit'); m.add(shell, 'light', w, tag='panel')
    surf = Surf(body); L = .02  # the Sheikah eye: lashes above, the eye, a tear below
    eyeo = [(-.05, 0), (-.025, .022), (0, .028), (.025, .022), (.05, 0), (.025, -.02), (0, -.026), (-.025, -.02)]
    m.add(stamp(surf, (0, 1.215, .2), [eyeo, ellipse(.017, .017, 16)], .004, lift=L, spacing=.006), 'trim', w, rigid=True, tag='emblem')
    m.add(stamp(surf, (0, 1.215, .2), [ellipse(.009, .009, 12)], .004, lift=L + .002), 'trim', w, rigid=True, tag='emblem')
    for x in (-.03, 0, .03): m.add(stamp(surf, (x, 1.26, .2), [[(-.005, -.008), (.005, -.008), (x * .3 + .003, .018), (x * .3 - .003, .018)]], .004, lift=L), 'trim', w, rigid=True, tag='emblem')
    m.add(stamp(surf, (0, 1.165, .2), [[(-.008, .012), (.008, .012), (0, -.035)]], .004, lift=L), 'trim', w, rigid=True, tag='emblem')
    m.add(torus((0, 1.02, .0), (.16, .118), .02, 28, 6, sq=(.6, 1.3)), 'secondary', 'hips', tag='sash')
    m.add(ribbon([(.06, 1.01, .1), (.07, .92, .11), (.075, .82, .1)], [.04, .045, .04], .01, normal=(0, 0, 1)), 'secondary', 'hips', tag='sash')
    # Cowl: a thick indigo collar up to the chin.
    m.add(lathe((0, 1.47, -.01), (0, 1.33, -.01), [(0, .07), (.03, .085), (.07, .15), (.1, .19), (.125, .205), (.135, .195), (.14, 0)], 24, sq=(1, .72), up=(0, 0, 1)), 'primary', 'chest', tag='yoke')
    m.add(lathe((0, 1.34, -.01), (0, 1.56, .01), [(0, 0), (0, .1), (.03, .105), (.07, .075), (.13, .054), (.2, .05), (.21, 0)], 20, sq=(1, .95)), 'primary', m.spine(('chest', 'neck', 'head')), tag='cowl')

def wraps(m, a, b, r0, r1, bone, n=5):
    """Bandage wrap: a sleeve with raised, slightly tilted winding bands."""
    m.add(capsule(a, b, r0, r1, 14), 'light', bone, tag='wraps'); d = (v3(b) - v3(a)); L = d.length; u = d.normalized()
    for k in range(n):
        t = (k + .5) / n; c = lerp(a, b, t); r = r0 + (r1 - r0) * t
        m.add(torus(c, r * 1.02, .0065, 16, 4, rot=[math.degrees(x) for x in Vector((0, 1, 0)).rotation_difference(u).to_euler()], sq=(1, 1.4)), 'light', bone, tag='wraps')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, .058, .046, 14), 'primary', f'upperarm_{S}', tag='arms')
    m.add(capsule(el, lerp(el, wr, .35), .046, .043, 14), 'primary', f'forearm_{S}', tag='arms')
    wraps(m, lerp(el, wr, .3), wr, .046, .038, f'forearm_{S}', 4)
    hand(m, s, S, wr + Vector((s * .008, 0, 0)), .056, 'light', curl=.45, tris=440)
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(capsule(hp, kn, .09, .062, 14), 'primary', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, lerp(kn, an, .3), .062, .056, 14), 'primary', f'shin_{S}', tag='legs')
    wraps(m, lerp(kn, an, .28), an + Vector((0, .02, 0)), .057, .042, f'shin_{S}', 5)
    shoe(m, s, S, an + Vector((0, 0, .025)), .22, .1, .1, 'light', 'secondary', sole=.022, toe=.85, heel=.9, up=.01, tris=380)

def build():
    m = Model('sheik', J, COLORS, COSTUMES, prop='none')
    head(m); torso(m); m.both(lambda s, S: limbs(m, s, S)); return m

main(globals())
