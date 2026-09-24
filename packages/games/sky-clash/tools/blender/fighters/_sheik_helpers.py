"""Helpers shared by the sheik batch (Sheik, Zelda, Peach, Ness, Popo, Nana, Luigi, Dr. Mario, Pichu, Pikachu).
Authored in the same character space as common.py. Import after the sys.path line: from fighters._sheik_helpers import *"""
from common import *

# ── Plumbers (Luigi, Dr. Mario): Mario's face kit, parameterized. Authored at Mario's head height (head joint 1.0);
# wrap the call in m.transform to move and reshape it for each brother. ─────────────────────────────────────────
def plumber_head(m, under, nose=((0, 1.19, .262), (.1, .086, .09)), lobes=None, chin=(), eye_kw=None, brow=None, stache_tris=720, ear_y=1.225, back=True):
    """Skull, nose, moustache, mouth, ears, sideburns, back hair and eyes. `under(p) > 0` is the part covered by the
    cap or hair shell (trimmed away). lobes: [(x, y, z, r)] moustache lobes on the left (x=0 lobes are not mirrored)."""
    skull = blob([('ell', (0, 1.245, .0), (.235, .235, .228)), ('ell', (0, 1.12, .06), (.185, .115, .165)), ('ell', (0, 1.19, .12), (.17, .1, .12)), *chin],
                 tris=2100, relax=3)
    face = Surf(skull)
    m.add(sphere(nose[0], nose[1], 18, 12, rot=(-8, 0, 0)), 'skin', 'head', tag='nose')
    lobes = lobes or [(0, 1.118, .262, .058), (.066, 1.112, .25, .057), (.126, 1.098, .222, .05), (.172, 1.084, .18, .04)]
    m.add(blob([('ell', mx(p[:3], s), (p[3] * 1.15, p[3] * .8, p[3] * .8), (0, 0, s * -12 * i)) for i, p in enumerate(lobes) for s in ((1, -1) if p[0] else (1,))],
               tris=stache_tris, relax=1), 'hair', 'head', tag='moustache')
    smile(m, face, [(-.07, 1.05, .2), (-.03, 1.037, .2), (.03, 1.037, .2), (.07, 1.05, .2)], .0075)
    if back: m.add(trim(blob([('ell', (0, 1.26, -.1), (.228, .13, .15)), ('ell', (0, 1.18, -.13), (.18, .08, .1))], tris=700, relax=1), under, .03), 'hair', 'head', tag='hair')
    for s in (1, -1):
        m.add(stamp(face, (s * .2, 1.31, .085), [[(-.042, .085), (.032, .085), (.03, -.02), (.002, -.072), (-.038, -.035)]], .01, d=(-s, 0, -.25)), 'hair', 'head', tag='hair')
        ear = blob([('ell', (s * .232, ear_y, -.008), (.035, .078, .056), (0, s * -18, 0)), ('ell', (s * .24, ear_y - .025, .01), (.03, .04, .04))], tris=320, relax=2)
        m.add(ear, 'skin', 'head', tag='ears'); m.add(sphere((s * .262, ear_y + .005, 0), (.01, .045, .028), 8, 6, rot=(0, s * -18, 0)), 'skin', 'head', tag='ears')
        kw = dict(tilt=-4, iris=.66, pupil=.52, look=(-s * .15, .1), lid=(.1, -4), lash=.14); kw.update(eye_kw or {})
        eye(m, face, (s * .072, 1.28, 0), kw.pop('w', .047), kw.pop('h', .066), s, **kw,
            brow=brow or dict(lift=.2, slant=-2, thick=.36, width=1.1, arch=.25, mat='hair', gap=.006))
    return skull, face

def plumber_cap(m, plane, emblem, lift=.012, mark='primary', dome=((0, 1.435, -.012), (.262, .215, .262)), crown=((0, 1.49, .06), (.21, .16, .2)), brim=((0, 1.405, .19), (.215, .03, .17))):
    """Dome cut by `plane` (point, normal), a brim and a white badge with the emblem outline in primary."""
    d = blob([('ell', *dome), ('ell', *crown)], tris=1300, relax=1); cut(d, plane[0], plane[1], keep='above'); surf = Surf(d)
    with m.transform(loc=(0, lift, 0)):
        m.add(d, 'primary', 'head', tag='cap')
        b = sphere(*brim, 24, 10, rot=(-10, 0, 0)); cut(b, (0, 0, .03), (0, 0, 1), keep='above'); m.add(b, 'primary', 'head', tag='cap')
        c = (0, 1.535, 0); m.add(stamp(surf, c, [ellipse(.09, .082, 32)], .007, d=(0, -.3, -1)), 'light', 'head', tag='emblem')
        m.add(stamp(surf, c, [emblem], .006, d=(0, -.3, -1), lift=.007), mark, 'head', tag='emblem')

def plane_fn(co, no):
    co, no = v3(co), v3(no).normalized(); return lambda p: (v3(p) - co).dot(no)

def glove_arm(m, s, S, J, r=(.08, .07, .062), mat='primary', u=.072, hand_mat='light', curl=.4, cuff=(.07, .08), dx=.02):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, r[0], r[1], 16), mat, f'upperarm_{S}', tag='arms')
    m.add(capsule(el, wr, r[1], r[2], 16), mat, f'forearm_{S}', tag='arms')
    return hand(m, s, S, wr + Vector((s * dx, 0, 0)), u, hand_mat, curl=curl, cuff=cuff)

def pleat_hem(n, amp, phase=0.0):
    """Wavy radial offset for skirts and dress hems: returns f(angle) -> scale."""
    return lambda t: 1 + amp * math.cos(n * t + phase)

def gown(center_x=0.0, top=.9, bottom=.02, r_top=.16, r_bot=.5, depth=.85, flare=1.6, folds=8, fold_amp=.035, seg=40, rings=14, back=0.0):
    """Bell or A-line skirt as a smooth surface of revolution around the vertical axis (open at the waist, closed hem
    rim). r(t) = r_top..r_bot with a `flare` curve, depth squashes front-back, soft folds near the hem, `back` pushes the
    back out (a bustle)."""
    def fn(u, v):
        t = u * 2 * math.pi; k = v ** flare; r = r_top + (r_bot - r_top) * k
        r *= 1 + fold_amp * k * math.cos(folds * t)
        x, z = math.sin(t) * r, math.cos(t) * r * depth
        if z < 0: z *= 1 + back * k
        return (center_x + x, top + (bottom - top) * v, z)
    return sheet(fn, seg, rings, .012, closed_u=True)

# ── Ladies (Peach, Zelda): soft oval face, big lashed eyes, small nose, lips ─────────────────────────────────────
def lady_face(m, HC, eye_w=.039, eye_h=.053, look=.12, brow=None, lips='trim', tris=1100, lid=None, eye_y=-.015, eye_x=.054, tilt=5):
    """Skull (cranium, cheeks, a small tapered chin) around head center HC, eyes with an outer lash flick, nose, lips."""
    skull = blob([('ell', HC + Vector((0, .02, -.01)), (.146, .148, .145)), ('ell', HC + Vector((0, -.04, .035)), (.114, .095, .108)),
                  ('ell', HC + Vector((0, -.1, .055)), (.062, .05, .06))], tris=tris, relax=3)
    face = Surf(skull); m.add(skull, 'skin', 'head', tag='skull')
    m.add(sphere(HC + Vector((0, -.066, .142)), (.017, .016, .018), 12, 8), 'skin', 'head', tag='nose')
    m.add(stamp(face, HC + Vector((0, -.1, 0)), [ellipse(.022, .008, 20)], .005), lips, 'head', tag='lips')
    m.add(stamp(face, HC + Vector((0, -.109, 0)), [ellipse(.015, .0055, 16)], .005), lips, 'head', tag='lips')
    for s in (1, -1):
        eye(m, face, HC + Vector((s * eye_x, eye_y, 0)), eye_w, eye_h, s, tilt=tilt, iris=.78, iris_h=.84, pupil=.45, look=(-s * .1, look), lash=.24, lid=lid,
            brow=brow or dict(lift=.32, slant=-8, thick=.2, width=1.0, arch=.4, mat='hair', gap=.004))
        p, n = face.hit(HC + Vector((s * (eye_x + .04), eye_y + .025, 0)))
        m.add(spike(p, p + Vector((s * .012, .006, .004)), p + Vector((s * .024, .01, -.002)), .005, n=5, seg=6), 'dark', 'head', tag='lashes')
    return face

def skirt_weights(top, span, kmax, xw, base='hips'):
    """Skirt/coat-tail weights: rigid to `base` (a bone or weight fn) at the waist; lower down each side follows its own
    thigh by up to kmax, fading to zero at the centre line (x=0) so front and back seams never tear between the legs."""
    def w(p):
        k = kmax * smooth01((top - p.y) / span) * smooth01(abs(p.x) / xw); b = base(p) if callable(base) else {base: 1.0}
        out = {n: x * (1 - k) for n, x in b.items()}; out['thigh_L' if p.x > 0 else 'thigh_R'] = k; return out
    return w
