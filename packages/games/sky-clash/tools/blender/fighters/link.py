"""Link (Melee, the Ocarina of Time hero): long green cap with its floppy tail, blond centre-parted bangs and side locks,
long pointed ears with blue earrings, determined blue eyes; green tunic with a flared skirt over a white undershirt and
tights, brown belt and sheath strap, brown gauntlets and knee boots. Left-handed: the Master Sword (blue winged hilt)
rides the prop bone in the left fist; the Hylian Shield (blue face, silver rim, red bird and gold Triforce) is strapped
to the right forearm."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *

COLORS = {'primary': '#3f9a3c', 'light': '#f1ede2', 'trim': '#7a4b2a', 'hair': '#f2c85a', 'skin': '#f6cfa8', 'dark': '#231a1c', 'eye': '#3a78d8',
          'eye-white': '#ffffff', 'metal': '#c6ccd8', 'secondary': '#3450b8', 'accent': '#d23a2e'}
COSTUMES = [('Goron Red', {'primary': '#c8362c'}), ('Zora Blue', {'primary': '#3a64c8', 'light': '#e8ecf4'}),
            ('Dark', {'primary': '#3b3a46', 'light': '#8a8898', 'trim': '#2a2228', 'hair': '#e9e6ef'})]

A = dict(hip=1.0, spine=1.12, chest=1.29, neck=1.5, head=1.58, arm_y=1.44, shoulder=.07, arm=.215, elbow=.49, wrist=.74, leg=.105, leg_y=.96, knee=.53, ankle=.09, clav_y=1.42)
HU = .07  # hand size
def joints(a, hu):
    return humanoid(**a, grip=(a['wrist'] + hu * 1.25, a['arm_y'] - hu * .45, 0), parents={'prop': 'hand_L'})
J = joints(A, HU)
HC = Vector((0, 1.73, .01))

HERO = {'root_loc': (0, -.1, 0), 'hips': (0, -8, 0), 'spine': (6, -4, 0), 'chest': (4, -8, 0), 'head': (-4, 6, 0),
        'upperarm_L': (0, -20, 58), 'forearm_L': (0, -45, 0), 'hand_L': (0, 75, 20),
        'upperarm_R': (0, -12, 70), 'forearm_R': (0, -28, 0), 'hand_R': (0, 0, 0),
        'thigh_L': (-40, 0, 14), 'shin_L': (45, 0, 0), 'foot_L': (-5, 0, 0), 'thigh_R': (22, 0, -14), 'shin_R': (25, 0, 0), 'foot_R': (10, 0, -4),
        'extra_cap_0': (30, 10, 0), 'extra_cap_1': (15, 0, 0)}
PORTRAIT = {'pose': {**IDLE, 'sym': {'upperarm': (0, 0, -84), 'forearm': (0, -10, 0)}, 'head': (-4, -12, 0)}, 'shoulders': .32}

def local(m, fn):
    """Evaluate a weight function in authoring space while m.transform is active (Young Link reuses these builders)."""
    X = m.xf.inverted(); return lambda p: fn(X @ v3(p))

def head(m, c, eyes, r=(.122, .142, .132), chin=.9, nose=(.018, .038), ear_len=.13, hair=1.0, cap_len=1.0,
         mouth=((-.028, -.103), (-.01, -.108), (.012, -.108), (.03, -.102))):
    skull, face = human_head(m, c, r, jaw=.95, chin=chin, nose=nose, nose_y=-.05, ears='elf', ear_len=ear_len, tris=1450, mouth=list(mouth), eyes=eyes)
    o = lambda x, y, z: c + Vector((x, y, z))
    def under(p): q = p - c; return q.y - (.03 + .33 * q.z)  # the cap line, higher at the brow than at the nape
    m.add(layer(skull, under, .03, .012, relax=1, tris=520), 'primary', 'head', tag='cap')
    trim(skull, under, .06); m.add(skull, 'skin', 'head', tag='face')
    m.add(torus(o(0, .03, 0), (.145, .15), .014, 24, 5, rot=(-18, 0, 0)), 'primary', 'head', tag='cap')
    pts = [o(0, .1, -.04), o(0, .08, -.16), o(0, -.02, -.25), o(0, -.16, -.29), o(0, -.3 * cap_len, -.28)]; wc = m.chain('cap', 'head', pts)
    tail = tube(spline(pts, 12), [.105, .098, .086, .072, .06, .049, .04, .031, .023, .015, .008, .003], 12, up=(1, 0, 0), ends=(True, True))
    share = local(m, lambda p: smooth01((c.y + .06 - p.y) / .1 + .3)); m.add(tail, 'primary', blend((wc, share), ('head', lambda p: 1 - share(p))), tag='cap')
    # Hair: centre-parted bangs sweeping to the sides, long side locks in front of the ears, a tuft at the nape.
    for x, L, k in ((.022, .1, 1), (.06, .09, .9), (.095, .07, .8)):
        for s in (1, -1):
            a = o(s * x * .6, .085, .105); m.add(spike(a, o(s * (x + .02), .06, .15), o(s * (x + .045) * 1.1, .085 - L, .14 - x * .3), .036 * k * hair, sq=(1, .5), up=(0, 0, 1), n=7, seg=8), 'hair', 'head', tag='hair')
    for s in (1, -1):
        m.add(strand([o(s * .1, .04, .07), o(s * .118, -.04, .08), o(s * .112, -.12, .065)], .026 * hair, .006, sq=(1, .6), n=10, seg=8), 'hair', 'head', tag='hair')
        m.add(sphere(o(s * .128, -.055, .0), .012, 8, 5), 'secondary', 'head', tag='earrings')
    m.add(blob([('ell', o(0, -.05, -.1), (.1, .07, .055)), ('ell', o(0, -.11, -.08), (.06, .05, .04))], tris=300, relax=1), 'hair', 'head', tag='hair')

def torso(m):
    w = m.spine(('hips', 'spine', 'chest'))
    body = blob([('ell', (0, 1.0, 0), (.155, .1, .11)), ('ell', (0, 1.13, 0), (.145, .11, .1)), ('ell', (0, 1.29, .005), (.19, .14, .125)),
                 ('cap', (-.2, 1.42, -.01), (.2, 1.42, -.01), .082), ('ell', (0, 1.45, -.03), (.13, .06, .08))], tris=1300, relax=2)
    m.add(body, 'primary', w, tag='tunic'); surf = Surf(body)
    m.add(capsule((0, 1.42, -.01), (0, 1.62, 0), .058, .055, 14), 'skin', 'neck', tag='neck')
    m.add(lathe((0, 1.43, -.01), (0, 1.54, -.005), [(0, 0), (0, .1), (.02, .104), (.08, .07), (.11, .062), (.111, 0)], 18, sq=(1, .9)), 'light', m.spine(('chest', 'neck')), tag='collar')
    # Tunic skirt: flares from the belt to mid-thigh; the front follows the thighs.
    def skirt_w(p):
        t = smooth01((1.0 - p.y) / .3) * .55; side = smooth01((p.x + .16) / .32)
        return {'hips': 1 - t, 'thigh_L': t * side, 'thigh_R': t * (1 - side)}
    sk = lathe((0, 1.03, 0), (0, .7, 0), [(0, .158), (.08, .168), (.2, .205), (.3, .235), (.33, .232)], 26, sq=(1, .82), shape=lambda a: 1 + .035 * math.cos(a * 6))
    bmesh.ops.delete(sk, geom=[f for f in sk.faces if abs(f.normal.y) > .95], context='FACES'); bmesh.ops.solidify(sk, geom=list(sk.faces), thickness=.012)
    m.add(sk, 'primary', local(m, skirt_w), tag='skirt')
    m.add(torus((0, 1.02, 0), (.162, .118), .026, 22, 5, sq=(.5, 1.3)), 'trim', w, tag='belt')
    m.add(rbox((0, 1.02, .122), (.075, .06, .02), .012), 'metal', 'hips', tag='belt')
    surface_strap(m, surf, [(-.15, 1.44, .06), (-.05, 1.33, .13), (.07, 1.18, .12), (.15, 1.06, .06)], .04, .012, 'trim', w)
    surface_strap(m, surf, [(-.15, 1.44, -.06), (-.03, 1.3, -.13), (.1, 1.14, -.11), (.155, 1.06, -.05)], .04, .012, 'trim', w)
    m.add(capsule((-.17, 1.52, -.15), (.1, 1.08, -.16), .034, .026, 12), 'secondary', 'chest', tag='sheath')
    m.add(rbox((-.14, 1.47, -.15), (.06, .05, .05), .014, rot=(0, 0, 30)), 'hair', 'chest', tag='sheath')

def limbs(m, s, S, hu=HU):
    sh, el, wr = P(J, f'upperarm_{S}'), P(J, f'forearm_{S}'), P(J, f'hand_{S}')
    m.add(capsule(sh, el, .068, .058, 14), 'light', f'upperarm_{S}', tag='arms')
    m.add(lathe(sh - Vector((s * .05, 0, 0)), lerp(sh, el, .55), [(0, 0), (0, .05), (.02, .078), (.05, .088), (.15, .086), (.18, .076), (.181, 0)], 16), 'primary', f'upperarm_{S}', tag='sleeves')
    m.add(capsule(el, wr, .058, .048, 14), 'light', f'forearm_{S}', tag='arms')
    m.add(lathe(lerp(el, wr, .3), wr + Vector((s * .01, 0, 0)), [(0, 0), (0, .06), (.1, .062), (.16, .07), (.18, .074), (.185, 0)], 16), 'trim', f'forearm_{S}', tag='gauntlets')
    hand(m, s, S, wr + Vector((s * .01, 0, 0)), hu, 'trim', fist=True, tris=480)
    hp, kn = P(J, f'thigh_{S}'), P(J, f'shin_{S}')
    m.add(capsule(lerp(hp, kn, .22), kn, .088, .072, 14), 'light', f'thigh_{S}', tag='legs')
    m.add(capsule(kn, kn + Vector((0, -.12, 0)), .07, .064, 14), 'light', f'shin_{S}', tag='legs')
    boot(m, s, S, J, .45, .082, .062, 'trim', 'dark', L=.27, wd=.14, ht=.13, cuff=.022, cuff_mat='trim', tris=460)

def shield(m, c, w=.36, h=.5, bone='forearm_R'):
    """Hylian Shield strapped to the outside of the right forearm; long axis along the arm (the point toward the hand)."""
    c = v3(c); M = Matrix(((0, -1, 0), (1, 0, 0), (0, 0, 1))).transposed().to_4x4(); M.translation = c  # u -> -Y, v -> +X: the point toward the hand
    def curve(bm, k=1.4):
        for v in bm.verts: q = v.co - c; v.co.z -= k * (q.y * q.y) + .25 * (q.x * q.x)
        return bm
    rim = curve(slab([kite(w, h)], .03, M, spacing=w / 8)); m.add(rim, 'metal', bone, tag='shield')
    Mf = M.copy(); Mf.translation = c + Vector((0, 0, .014))
    face = curve(slab([[(x * .86, y * .86 - .004) for x, y in kite(w, h)]], .012, Mf, spacing=w / 10)); m.add(face, 'secondary', bone, tag='shield')
    def emblem(loop, at, mat, z=.021):  # flat inlay on the face, bent with the same curve
        Me = M.copy(); Me.translation = c + Vector((at[0], at[1], z)); m.add(curve(slab([loop], .008, Me, spacing=.02)), mat, bone, tag='crest')
    tri = [(0, .045), (-.04, -.024), (.04, -.024)]
    for du, dv in ((0, .06), (-.042, .014), (.042, .014)): emblem(tri, (h * .17 + dv - .03, -du), 'hair')
    bird = [(0, .03), (.03, .012), (.1, .035), (.13, .01), (.07, -.02), (.03, -.02), (.02, -.08), (0, -.1), (-.02, -.08), (-.03, -.02), (-.07, -.02), (-.13, .01), (-.1, .035), (-.03, .012)]
    emblem(bird, (-h * .08, 0), 'accent')

def sword_prop(m, grip):
    sword(m, grip, .78, .055, ('metal', 'secondary', 'secondary', 'secondary'), guard_style='wings', grip_len=.18, guard=.22, tip=.1)  # Master Sword
    m.add(sphere(v3(grip) + Vector((0, 0, .18 * .55)), (.016, .016, .01), 10, 6), 'hair', 'prop', tag='sword')

def build():
    m = Model('link', J, COLORS, COSTUMES, prop='always')
    head(m, HC, dict(x=.05, y=-.005, w=.033, h=.041, tilt=6, iris=.66, pupil=.5, look=(0, .05), lid=(.14, 8), lash=.16,
                     brow=dict(lift=.32, slant=10, thick=.3, width=1.05, arch=.15, mat='hair', gap=.006)))
    body(m); sword_prop(m, P(J, 'prop')); return m

def body(m):
    torso(m); m.both(lambda s, S: limbs(m, s, S)); shield(m, lerp(P(J, 'forearm_R'), P(J, 'hand_R'), .45) + Vector((0, 0, .085)))

main(globals())
