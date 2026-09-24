"""Young Link (Melee, the Majora's Mask child): Link's outfit on a child build, about four heads tall. A big round head
with huge blue eyes, a button nose and a cheeky grin, shorter cap tail, stubby limbs; green tunic over the pale
undershirt and tights, brown belt, gauntlets and boots. The Kokiri Sword (short blade, blue guard) rides the prop bone
in his left fist and the Hero's Shield is strapped to his right forearm. Built from Link's builders under child transforms."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters._captain_falcon_helpers import *
import fighters.link as L

COLORS = {**L.COLORS, 'primary': '#48a83e', 'light': '#f3eedc', 'trim': '#8a5530', 'hair': '#f4ce5e', 'skin': '#fad4ae'}
COSTUMES = [('Red', {'primary': '#cf3a30'}), ('Blue', {'primary': '#3b6ad0'}), ('White', {'primary': '#f0eee8', 'light': '#d8d2c0', 'trim': '#6a4a2e'})]

# Child proportions: legs and torso are shortened and slimmed, the head keeps most of its adult size.
HIP = L.A['leg_y']; LEGS = (.7, .6, .7); BODY = (.74, .64, .74); NECK = L.A['neck']; HEAD = .9
TORSO_XF = dict(pivot=(0, HIP, 0), scale=BODY, loc=(0, HIP * LEGS[1] - HIP, 0))
NECK_Y = HIP * LEGS[1] + (NECK - HIP) * BODY[1]
HEAD_XF = dict(pivot=(0, NECK, 0), scale=HEAD, loc=(0, NECK_Y - NECK, 0))
LEG_BONES = {f'{b}_{S}' for b in ('thigh', 'shin', 'foot') for S in 'LR'}

def xf(p, pivot, scale, loc):
    p, c = v3(p), v3(pivot); k = scale if isinstance(scale, tuple) else (scale,) * 3
    return Vector(((p.x - c.x) * k[0] + c.x + loc[0], (p.y - c.y) * k[1] + c.y + loc[1], (p.z - c.z) * k[2] + c.z + loc[2]))
def place(b, p):
    if b in LEG_BONES: return Vector((p[0] * LEGS[0], p[1] * LEGS[1], p[2] * LEGS[2]))
    return xf(p, **(HEAD_XF if b == 'head' else TORSO_XF))
J = {b: (tuple(place(b, p)), par) for b, (p, par) in L.J.items()}

HERO = {**L.HERO, 'root_loc': (0, -.06, 0), 'extra_cap_0': (30, 10, 0), 'extra_cap_1': (15, 0, 0)}
PORTRAIT = {'pose': L.PORTRAIT['pose'], 'shoulders': .38, 'view': (.58, .06, 1)}  # faces the other way from Link, so the two tiles differ at a glance

def build():
    m = Model('young-link', J, COLORS, COSTUMES, prop='always')
    with m.transform(**TORSO_XF): L.torso(m)
    with m.transform(**HEAD_XF):
        L.head(m, L.HC, dict(x=.052, y=-.01, w=.041, h=.05, tilt=4, iris=.68, pupil=.5, look=(0, .05), lid=(.06, 4), lash=.17,
                              brow=dict(lift=.3, slant=4, thick=.3, width=1.0, arch=.2, mat='hair', gap=.006)),
               r=(.128, .14, .134), chin=.75, nose=(.015, .03), ear_len=.12, cap_len=.75,
               mouth=((-.03, -.1), (-.012, -.108), (.012, -.108), (.032, -.098)))
    def limbs(s, S):
        with m.transform(**TORSO_XF): arm(s, S)
        with m.transform(scale=LEGS): leg(s, S)
    def arm(s, S):  # Link's arm builders, split from his legs so each gets its own child transform
        sh, el, wr = P(L.J, f'upperarm_{S}'), P(L.J, f'forearm_{S}'), P(L.J, f'hand_{S}')
        m.add(capsule(lerp(sh, el, .3), el, .07, .062, 14), 'light', f'upperarm_{S}', tag='arms')
        m.add(lathe(sh - Vector((s * .05, 0, 0)), lerp(sh, el, .6), [(0, 0), (0, .05), (.02, .08), (.05, .09), (.16, .088), (.19, .078), (.191, 0)], 16), 'primary', f'upperarm_{S}', tag='sleeves')
        m.add(capsule(el, wr, .062, .054, 14), 'light', f'forearm_{S}', tag='arms')
        m.add(lathe(lerp(el, wr, .35), wr + Vector((s * .01, 0, 0)), [(0, 0), (0, .066), (.1, .068), (.14, .076), (.16, .08), (.165, 0)], 16), 'trim', f'forearm_{S}', tag='gauntlets')
        hand(m, s, S, wr + Vector((s * .01, 0, 0)), L.HU * 1.1, 'trim', fist=True, tris=460)
    def leg(s, S):
        hp, kn = P(L.J, f'thigh_{S}'), P(L.J, f'shin_{S}')
        m.add(capsule(lerp(hp, kn, .25), kn, .1, .09, 14), 'light', f'thigh_{S}', tag='legs')
        m.add(capsule(kn, kn + Vector((0, -.12, 0)), .088, .08, 14), 'light', f'shin_{S}', tag='legs')
        boot(m, s, S, L.J, .45, .1, .08, 'trim', 'dark', L=.34, wd=.18, ht=.16, cuff=.026, cuff_mat='trim', tris=460)
    m.both(limbs)
    with m.transform(**TORSO_XF):
        L.shield(m, lerp(P(L.J, 'forearm_R'), P(L.J, 'hand_R'), .45) + Vector((0, 0, .09)), w=.4, h=.5)
        sword(m, P(L.J, 'prop'), .5, .06, ('metal', 'secondary', 'trim', 'secondary'), guard_style='bar', grip_len=.16, guard=.17, tip=.09)  # Kokiri Sword
    return m

main(globals())
