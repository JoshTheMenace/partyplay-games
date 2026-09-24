"""Pikachu (Melee): a plump yellow mouse with a big round head, long ears with black tips, round red cheeks, glossy
black eyes, a tiny nose and a cat-like smile, stubby paws, big feet, two brown stripes on the back and the flat
lightning-bolt tail with a brown base. Built upright in the T-pose (the renderer poses it partly on all fours).
Melee's alternates are hats; costumes here recolor by material only, so they tint the fur and markings instead.
rodent() is shared with pichu.py."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *

COLORS = {'primary': '#f7d23c', 'secondary': '#8a5a2a', 'accent': '#e8453a', 'hair': '#22181a', 'trim': '#d8505a', 'dark': '#231a1c',
          'eye': '#1d1618', 'eye-white': '#ffffff'}
COSTUMES = [('Red', {'primary': '#f6c238', 'hair': '#7a1c1c', 'secondary': '#7a1c1c', 'accent': '#ff3a30'}),
            ('Blue', {'primary': '#f8e070', 'hair': '#1f2f72', 'secondary': '#1f2f72', 'accent': '#f06a70'}),
            ('Green', {'primary': '#e6dc56', 'hair': '#1f5a2e', 'secondary': '#1f5a2e', 'accent': '#f25a48'})]
J = humanoid(hip=.3, spine=.38, chest=.48, neck=.58, head=.64, arm_y=.52, shoulder=.07, arm=.19, elbow=.32, wrist=.44,
             leg=.12, leg_y=.28, knee=.16, ankle=.07, clav_y=.52)
IDLE = {'sym': {'upperarm': (0, -30, -50), 'forearm': (0, -50, 0), 'hand': (0, 0, -20), 'thigh': (0, 0, 4), 'foot': (0, 0, -4)}, 'spine': (6, 0, 0), 'head': (-6, 0, 0)}
HERO = {'root_loc': (0, .14, 0), 'hips': (0, -20, 0), 'spine': (-8, -6, 0), 'chest': (-6, -8, 0), 'head': (-4, -14, 6),
        'upperarm_L': (0, -30, 40), 'forearm_L': (0, -30, 20), 'hand_L': (0, 0, 20), 'upperarm_R': (0, 30, -40), 'forearm_R': (0, 30, -20), 'hand_R': (0, 0, -20),
        'thigh_L': (-60, 0, 14), 'shin_L': (70, 0, 0), 'foot_L': (-20, 0, 0), 'thigh_R': (30, 0, -14), 'shin_R': (40, 0, 0), 'foot_R': (30, 0, 0),
        'extra_tail_0': (-20, 0, 0), 'extra_tail_1': (-10, 0, 0), 'extra_earL_0': (0, 0, -10), 'extra_earR_0': (0, 0, 10)}
PORTRAIT = {'pose': {**IDLE, 'head': (-6, -12, 4)}, 'shoulders': .05, 'fill': .9}

def bolt_outline(pts, widths):
    """Offset a 2D zig-zag centerline into one closed outline (the lightning-bolt tail)."""
    P = [Vector(p) for p in pts]; L, R = [], []
    for i, p in enumerate(P):
        a, b = P[max(i - 1, 0)], P[min(i + 1, len(P) - 1)]; t = (b - a).normalized(); n = Vector((-t.y, t.x)) * widths[i] / 2
        L.append(tuple(p + n)); R.append(tuple(p - n))
    return L + R[::-1]

def rodent(m, J, c):
    """Head + body as one soft metaball form weighted along the spine like a plush, then eyes, cheeks, ears, paws,
    feet and tail from the config dict c (see CFG below)."""
    HC = c['head']; w = m.spine(('hips', 'spine', 'chest', 'neck', 'head'), spans=c['spans'])
    form = blob(c['body'] + [('ell', HC, c['head_r'])] + [('ell', HC + Vector((s * c['jowl'][0], c['jowl'][1], c['jowl'][2])), c['jowl'][3]) for s in (1, -1)], tris=c['tris'], relax=3)
    face = Surf(form); m.add(form, 'primary', w, tag='body')
    ex, ey, ew, eh = c['eye']
    for s in (1, -1):
        eye(m, face, HC + Vector((s * ex, ey, 0)), ew, eh, s, tilt=-4, iris=.98, iris_h=.98, pupil=.62, look=(-s * .05, .1), lash=0, sclera=False, depth=.45)
        m.add(stamp(face, HC + Vector((s * c['cheek'][0], c['cheek'][1], 0)), [ellipse(c['cheek'][2], c['cheek'][2] * .92, 28)], .007, d=(-s * .55, 0, -1)), 'accent', 'head', tag='cheeks')
    k = c['mouth']; m.add(sphere(face.hit(HC + Vector((0, -k * .05, 0)))[0], (k * .07, k * .045, k * .05), 10, 6), 'dark', 'head', tag='nose')
    for s in (1, -1): smile(m, face, [HC + Vector((0, -k * .1, .3)), HC + Vector((s * k * .1, -k * .2, .3)), HC + Vector((s * k * .2, -k * .14, .3))], k * .022)
    m.add(stamp(face, HC + Vector((0, -k * .22, 0)), [ellipse(k * .09, k * .06, 18)], .004), 'trim', 'head', tag='mouth')
    for s, S in ((1, 'L'), (-1, 'R')):
        base, mid, tip, r, frac = [v3(mx(p, s)) if isinstance(p, tuple) else p for p in c['ear']]
        wear = m.chain(f'ear{S}', 'head', [base, tip]); L = (tip - base).length; d = (tip - base).normalized()
        ear = spike(base, mid, tip, r, sq=(1, .42), up=(0, 0, 1), n=10, seg=12); split_by(ear, lambda p: (p - base).dot(d) - frac * L)
        m.add(ear, lambda q, n: 'hair' if (q - base).dot(d) > frac * L else 'primary', wear, over=True, tag='ears')
        sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}'); ar = c['arm']
        m.add(capsule(sh, el, ar, ar * .9, 14), 'primary', f'upperarm_{S}', tag='arms'); m.add(capsule(el, wr, ar * .9, ar * .8, 14), 'primary', f'forearm_{S}', tag='arms')
        hand(m, s, S, wr, ar * .95, 'primary', curl=.55, fingers=3, thumb=.6, tris=280)
        hp, kn, an = P(J, f'thigh_{S}'), P(J, f'shin_{S}'), P(J, f'foot_{S}'); lr = c['leg']
        m.add(capsule(hp, kn, lr, lr * .85, 14), 'primary', f'thigh_{S}', tag='legs'); m.add(capsule(kn, an, lr * .85, lr * .7, 14), 'primary', f'shin_{S}', tag='legs')
        fx, fl, fh = c['foot']
        foot = blob([('ell', an + Vector((s * .01, -an.y + fh * .5, fl * .28)), (fx, fh * .6, fl * .5), (0, s * -10, 0))] +
                    [('ell', an + Vector((s * .01 + t * fx * .6, -an.y + fh * .45, fl * .7)), (fx * .34, fh * .5, fx * .4)) for t in (-1, 0, 1)], tris=400, relax=2)
        cut(foot, (0, 0, 0), (0, 1, 0), keep='above'); m.add(foot, 'primary', f'foot_{S}', tag='feet')
    c['extra'](m, J, face, w)

def pikachu_extra(m, J, face, w):
    for y in (.52, .4): m.add(stamp(face, (0, y, 0), [[(-.12, .025), (.12, .025), (.1, -.02), (-.1, -.02)]], .006, d=(0, 0, 1), up=(0, 1, 0)), 'secondary', w, rigid=True, tag='stripes')
    pts = [(.1, .26), (.2, .3), (.36, .42), (.3, .5), (.56, .71), (.47, .8), (.8, 1.0)]; wd = [.06, .065, .08, .09, .12, .14, .24]
    M = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))  # outline u -> back (-Z), v -> up (+Y)
    tail = slab([bolt_outline(pts, wd)], .045, M, spacing=.03, bevel=.01); smooth(tail, 1, .3)
    wt = m.chain('tail', 'hips', [(0, .26, -.2), (0, .44, -.33), (0, .72, -.54), (0, 1.02, -.8)])
    split_by(tail, lambda p: .36 - p.y); m.add(tail, lambda q, n: 'secondary' if q.y < .36 else 'primary', wt, over=True, tag='tail')

CFG = dict(head=Vector((0, .88, .02)), head_r=(.3, .27, .26), jowl=(.1, -.1, .05, (.14, .11, .13)), tris=3200,
           body=[('ell', (0, .36, .02), (.235, .21, .205)), ('ell', (0, .52, 0), (.2, .13, .165)), ('ell', (0, .63, .0), (.215, .11, .18))],
           spans=[(.24, .42), (.36, .56), (.44, .7), (.52, .8)],
           eye=(.12, .92, .052, .062), cheek=(.21, .79, .064), mouth=.3,
           ear=((.12, 1.07, -.02), (.2, 1.32, -.04), (.27, 1.54, -.08), .092, .7), arm=.058, leg=.09, foot=(.085, .22, .1), extra=pikachu_extra)
CFG['eye'] = (.12, .04, .052, .062); CFG['cheek'] = (.2, -.08, .064)  # offsets from the head center

def build():
    m = Model('pikachu', J, COLORS, COSTUMES, prop='none'); rodent(m, J, CFG); return m

main(globals())
