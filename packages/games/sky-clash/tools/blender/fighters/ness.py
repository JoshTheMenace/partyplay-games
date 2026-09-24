"""Ness (Melee, EarthBound): a small kid with a big head. Red baseball cap with a blue bill and top button, dark
hair tufting out underneath, big dark eyes and a grin, a yellow-and-blue striped short-sleeved shirt, blue shorts,
white socks, red sneakers and a red backpack with shoulder straps. His baseball bat (Forward Smash) rides the prop
bone and is shown only by moves."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#e2333a', 'secondary': '#2f55b8', 'accent': '#f7e27a', 'light': '#f6f4ee', 'trim': '#b8323c', 'skin': '#f7c9a2',
          'hair': '#2c1e1a', 'dark': '#231a1c', 'metal': '#c9ced8', 'eye': '#3a2a26', 'eye-white': '#ffffff'}
COSTUMES = [('Yellow', {'primary': '#f2c81c', 'secondary': '#262428', 'accent': '#f6f3ea', 'trim': '#e8b81a'}),
            ('Blue', {'primary': '#3a7ee0', 'secondary': '#223672', 'accent': '#9cc8f6', 'trim': '#2f62b8'}),
            ('Green', {'primary': '#3fae4a', 'secondary': '#2a4a86', 'accent': '#a8dc92', 'trim': '#2f8a3c'})]
J = humanoid(hip=.5, spine=.58, chest=.69, neck=.8, head=.86, arm_y=.765, shoulder=.06, arm=.165, elbow=.33, wrist=.48,
             leg=.085, leg_y=.48, knee=.27, ankle=.075, clav_y=.76)
IDLE = {'sym': {'upperarm': (0, -10, -66), 'forearm': (0, -30, 0), 'hand': (0, 0, -10), 'thigh': (0, 0, 4), 'foot': (0, 0, -4)}, 'spine': (2, 0, 0), 'head': (-4, 0, 0)}
HERO = {'root_loc': (0, .1, 0), 'hips': (0, -20, 0), 'spine': (6, -6, 0), 'chest': (4, -12, 0), 'head': (-10, 2, 0),
        'upperarm_L': (0, -80, -8), 'forearm_L': (0, -10, 0), 'hand_L': (0, 0, 20),
        'upperarm_R': (0, 40, -50), 'forearm_R': (0, 50, 0), 'hand_R': (0, 0, -10),
        'thigh_L': (-70, 0, 8), 'shin_L': (90, 0, 0), 'foot_L': (-10, 0, 0), 'thigh_R': (20, 0, -8), 'shin_R': (55, 0, 0), 'foot_R': (25, 0, 0)}
HERO_PROP = False
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -10, 0)}, 'shoulders': .4}

HC = Vector((0, 1.07, .0))
CAP = (HC + Vector((0, .07, 0)), Vector((0, 1, -.28)).normalized())
def under_cap(p): return (v3(p) - CAP[0]).dot(CAP[1])

def head(m):
    skull = blob([('ell', HC, (.205, .2, .195)), ('ell', HC + Vector((0, -.08, .05)), (.165, .12, .15)), ('ell', HC + Vector((0, -.05, .1)), (.14, .08, .1))], tris=1800, relax=3)
    face = Surf(skull)
    m.add(sphere(HC + Vector((0, -.055, .2)), (.028, .024, .024), 12, 8), 'skin', 'head', tag='nose')
    smile(m, face, [HC + Vector((-.07, -.105, .2)), HC + Vector((-.03, -.128, .2)), HC + Vector((.03, -.128, .2)), HC + Vector((.07, -.105, .2))], .0085)
    m.add(stamp(face, HC + Vector((0, -.126, 0)), [[(-.032, .004), (.032, .004), (.02, -.014), (0, -.02), (-.02, -.014)]], .004), 'dark', 'head', tag='mouth')
    for s in (1, -1):
        eye(m, face, HC + Vector((s * .068, .0, 0)), .042, .056, s, tilt=-2, iris=.74, pupil=.55, look=(-s * .1, .05), lash=.12,
            brow=dict(lift=.28, slant=-6, thick=.3, width=.95, arch=.3, mat='hair', gap=.005))
        m.add(blob([('ell', HC + Vector((s * .2, -.04, -.01)), (.03, .05, .04))], tris=200, relax=1), 'skin', 'head', tag='ears')
        for k, (y, z, L) in enumerate(((.02, -.1, .07), (-.03, -.15, .06), (-.06, -.06, .05))):  # hair tufts poking out under the cap
            a = HC + Vector((s * .18, y, z)); m.add(spike(a, a + Vector((s * .04, -.02, -.02)), a + Vector((s * L, -.05, -.04)), .04, sq=(1, .5), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='hair')
    m.add(trim(blob([('ell', HC + Vector((0, .0, -.05)), (.212, .19, .18))], tris=500, relax=1), under_cap, .02), 'hair', 'head', tag='hair')
    for x, dx in ((-.06, -.03), (.0, .02), (.06, .04)):  # bangs
        a = HC + Vector((x, .1, .15)); m.add(spike(a, a + Vector((dx * .5, .0, .05)), a + Vector((dx, -.07, .06)), .04, sq=(1, .5), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='hair')
    m.add(trim(skull, under_cap, .03), 'skin', 'head', tag='skull')

def cap(m):
    dome = blob([('ell', HC + Vector((0, .07, -.01)), (.225, .205, .22)), ('ell', HC + Vector((0, .13, .03)), (.18, .13, .17))], tris=1200, relax=1)
    cut(dome, CAP[0] - Vector((0, .008, 0)), CAP[1], keep='above'); m.add(dome, 'primary', 'head', tag='cap')
    brim = sphere(HC + Vector((0, .09, .2)), (.19, .026, .16), 24, 10, rot=(-12, 0, 0)); cut(brim, HC + Vector((0, 0, .06)), (0, 0, 1), keep='above')
    m.add(brim, 'secondary', 'head', tag='cap')
    m.add(sphere(HC + Vector((0, .282, .01)), (.028, .016, .028), 12, 6), 'secondary', 'head', tag='cap')

STRIPE = .05
def stripes(bm, lo=-1.0):
    split_by(bm, lambda p: math.sin((p.y - .02) / STRIPE * math.pi)); return lambda c, n: 'secondary' if math.sin((c.y - .02) / STRIPE * math.pi) > 0 and c.y > lo else 'accent'

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, .52, 0), (.155, .09, .12)), ('ell', (0, .61, .01), (.165, .1, .13)), ('ell', (0, .7, 0), (.16, .085, .12)),
                 ('cap', (-.13, .765, -.01), (.13, .765, -.01), .07), ('ell', (0, .78, 0), (.11, .05, .09))], tris=520, relax=2); body = subd(body, 1)
    split_by(body, lambda p: p.y - .555); paint = stripes(body, .555)
    m.add(body, lambda c, n: 'secondary' if c.y < .555 else paint(c, n), w, tag='shirt')
    m.add(torus((0, .558, 0), (.17, .135), .014, 28, 6), 'secondary', w, tag='shorts')
    m.add(capsule((0, .78, -.01), (0, .92, 0), .062, .06, 14), 'skin', 'neck', tag='neck')
    m.add(torus((0, .8, 0), (.075, .07), .016, 20, 6), 'secondary', 'chest', tag='collar')
    # Backpack with a flap and straps over the shoulders.
    m.add(rbox((0, .66, -.2), (.26, .27, .13), .05, seg=3), 'trim', 'chest', tag='backpack')
    m.add(rbox((0, .755, -.195), (.265, .09, .145), .035, seg=3), 'trim', 'chest', tag='backpack')
    m.add(rbox((0, .7, -.27), (.012, .06, .012), .005), 'metal', 'chest', tag='backpack')
    for s in (1, -1):
        pts = [(s * .09, .72, -.14), (s * .1, .8, -.08), (s * .1, .805, .05), (s * .095, .72, .125), (s * .1, .6, .13)]
        m.add(ribbon(spline(pts, 10), .035, .012, normal=(0, 1, 0)), 'trim', w, tag='straps')

def limbs(m, s, S):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    sl = lathe(sh - Vector((s * .04, 0, 0)), lerp(sh, el, .6), [(0, .07), (.02, .074), (.12, .068), (.14, .066), (.15, 0)], 18, up=(0, 1, 0))
    m.add(sl, 'accent', f'upperarm_{S}', tag='sleeves')
    m.add(capsule(sh, el, .048, .042, 14), 'skin', f'upperarm_{S}', tag='arms'); m.add(capsule(el, wr, .042, .038, 14), 'skin', f'forearm_{S}', tag='arms')
    hand(m, s, S, wr + Vector((s * .008, 0, 0)), .052, 'skin', curl=.45, tris=440)
    hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}')
    m.add(lathe(hp + Vector((0, .07, 0)), lerp(hp, kn, .55), [(0, .09), (.05, .092), (.14, .09), (.155, .088), (.16, 0)], 18), 'secondary', f'thigh_{S}', tag='shorts')
    m.add(capsule(hp, kn, .058, .05, 14), 'skin', f'thigh_{S}', tag='legs'); m.add(capsule(kn, an, .05, .044, 14), 'skin', f'shin_{S}', tag='legs')
    m.add(lathe(an + Vector((0, .1, 0)), an - Vector((0, .02, 0)), [(0, 0), (0, .05), (.01, .054), (.1, .05), (.12, 0)], 16), 'light', f'shin_{S}', tag='socks')
    shoe(m, s, S, an + Vector((0, 0, .02)), .21, .12, .11, 'primary', 'light', sole=.03, toe=1.05, heel=.9, up=.015, tris=440)

def bat(m):
    g = P(J, 'prop'); d = Vector((-1, 0, 0))  # aluminium bat along the arm; the fat barrel is the far end
    m.add(lathe(g - d * .06, g + d * .6, [(0, 0), (0, .024), (.01, .02), (.12, .018), (.3, .026), (.5, .036), (.64, .038), (.655, .03), (.66, 0)], 14, up=(0, 1, 0)), 'metal', 'prop', tag='bat')
    m.add(lathe(g - d * .05, g + d * .1, [(0, .021), (.15, .021)], 12, up=(0, 1, 0)), 'dark', 'prop', tag='bat')

def build():
    m = Model('ness', J, COLORS, COSTUMES, prop='move')
    head(m); cap(m); torso(m); m.both(lambda s, S: limbs(m, s, S)); bat(m); return m

main(globals())
