"""Shared builders for the models-a fighters (Captain Falcon, DK, Bowser, Giga Bowser, Link, Young Link, Marth, Roy,
Ganondorf, Samus). Not a fighter: fighter scripts import it with `from fighters._captain_falcon_helpers import *`."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from common import _skin

def euler_of(*cols): return [math.degrees(a) for a in Matrix(cols).transposed().to_euler()]

def boot(m, s, S, J, top, r_top, r_ank, mat, sole='dark', L=.3, wd=.17, ht=.15, cuff=None, cuff_mat=None, tris=640, toe=1.0, flare=1.18):
    """Knee boot: a flared shaft from `top` (height) down to the ankle on the shin bone, plus a rounded foot."""
    an = P(J, f'foot_{S}'); x = an.x; d = top - an.y
    prof = [(0, 0), (0, r_top * flare * .95), (.012, r_top * flare), (.03, r_top * 1.02), (d * .45, r_top * .9), (d * .8, r_ank * 1.02), (d, r_ank), (d + r_ank * .5, r_ank * .6), (d + r_ank * .62, 0)]
    m.add(lathe((x, top, 0), (x, an.y - .02, 0), prof, 16), mat, f'shin_{S}', tag='boots')
    if cuff: m.add(torus((x, top - .006, 0), r_top * flare * .96, cuff, 20, 6, sq=(.8, 1.4)), cuff_mat or mat, f'shin_{S}', tag='boots')
    shoe(m, s, S, an + Vector((0, 0, .02)), L, wd, ht, mat, sole, sole=.026, toe=toe, heel=.9, up=.012, tris=tris)

def human_head(m, c, r=(.125, .145, .135), jaw=1.0, chin=1.0, eyes=None, nose=(.02, .042), nose_y=-.045, mouth=None, ears='round', ear_len=.13,
               skin='skin', tris=1700, cheeks=.9, bone='head'):
    """Stylized human head centered at c (the cranium center). eyes: dict for common.eye plus x, y (offsets from c).
    ears: 'round' or 'elf' (long Hylian ears, ear_len). mouth: list of (x, y) offsets from c. Returns (skull bm, Surf)."""
    c = v3(c); o = lambda x, y, z: c + Vector((x, y, z)); rx, ry, rz = r
    skull = blob([('ell', c, r), ('ell', o(0, -ry * .55, rz * .26), (rx * .8 * jaw, ry * .6, rz * .72)), ('ell', o(0, -ry * .95, rz * .5), (rx * .36 * chin, ry * .2, rz * .3)),
                  ('ell', o(rx * .45, -ry * .3, rz * .55), (rx * .4 * cheeks, ry * .28, rz * .35)), ('ell', o(-rx * .45, -ry * .3, rz * .55), (rx * .4 * cheeks, ry * .28, rz * .35))], tris=tris, relax=3)
    face = Surf(skull)
    if nose:
        top, tip = face.hit(o(0, nose_y + nose[1] * .6, 0))[0], face.hit(o(0, nose_y, 0))[0] + Vector((0, 0, nose[0] * 1.1))
        m.add(blob([('cap', top, tip, nose[0] * .55), ('ell', tip - Vector((0, 0, nose[0] * .35)), (nose[0] * .9, nose[0] * .6, nose[0] * .7))], tris=260, relax=1), skin, bone, tag='nose')
    if mouth: smile(m, face, [o(x, y, rz) for x, y in mouth], .0045)
    if eyes:
        e = dict(eyes); ex, ey = e.pop('x'), e.pop('y'); w, h = e.pop('w'), e.pop('h')
        for s in (1, -1): eye(m, face, o(s * ex, ey, 0), w, h, s, **e, bone=bone)
    for s in (1, -1):
        if ears == 'elf':
            b = o(s * rx * .92, -ry * .12, -rz * .05); t = o(s * (rx + ear_len * .82), ry * .5, -rz * .55)
            el = [('cap', b, lerp(b, t, .55), max(.028, ear_len * .2), {'stiff': 3}), ('cap', lerp(b, t, .5), t, max(.013, ear_len * .09), {'stiff': 4}), ('ell', b + Vector((0, -.02, .0)), (.02, .045, .03))]
            m.add(blob(el, tris=340, relax=2), skin, bone, tag='ears')
        elif ears:
            m.add(blob([('ell', o(s * rx * .95, -ry * .18, -rz * .08), (.026, .055, .04), (0, s * -15, 0))], tris=180, relax=2), skin, bone, tag='ears')
    return skull, face

def sword(m, grip, L, w, mats, D=(0, 0, 1), W=(0, 1, 0), bone='prop', grip_len=.2, guard=.22, thick=.02, tip=.14, pommel=.032,
          guard_style='bar', flare=None, fuller=None, glow=None):
    """Sword with its grip centered on `grip`, blade along D (the business end is the far tip), edge along W.
    mats = (blade, guard, grip, pommel). guard_style 'wings' (Master Sword), 'bar', 'disc' or 'hilt' (Falchion hand-guard).
    flare(t) scales the blade half width along its length; fuller=material of a centre groove inlay; glow=material of a core."""
    g, D, W = v3(grip), v3(D).normalized(), v3(W).normalized(); N = D.cross(W).normalized(); base = g + D * grip_len * .55
    hw = w / 2; body = L - tip
    def half(t): return hw * (flare(t) if flare else 1)
    def ring(o, h, th, bev=.42): return [o + W * h, o + W * h * bev + N * th, o - W * h * bev + N * th, o - W * h, o - W * h * bev - N * th, o + W * h * bev - N * th]
    rings = [ring(base + D * body * t, half(t), thick / 2) for t in np.linspace(0, 1, 9)]
    rings += [ring(base + D * (body + tip * k), half(1) * (1 - k) ** .8, thick / 2 * (1 - k * .7)) for k in (.35, .7)] + [[base + D * L]]
    m.add(_skin(rings, True, False), mats[0], bone, tag='sword', sharp=25)
    if fuller or glow:
        core = [ring(base + D * (.03 + (body * .92) * t), half(t) * .3, thick * .62, .5) for t in np.linspace(0, 1, 7)] + [[base + D * (body * .95 + tip * .4)]]
        m.add(_skin(core, True, False), glow or fuller, bone, tag='sword')
    E = euler_of(W, N, D)
    if guard_style == 'wings':
        m.add(rbox(base, (guard * .34, .05, thick * 2.4), .014, rot=euler_of(W, D, N)), mats[1], bone, tag='sword')
        for s in (1, -1):
            a = base + W * s * guard * .12; m.add(spike(a, a + W * s * guard * .32 - D * .01, a + W * s * guard * .5 + D * .07, .03, sq=(1, .55), up=tuple(N), n=8), mats[1], bone, tag='sword')
    elif guard_style == 'disc':
        m.add(cyl(base - D * .012, base + D * .012, guard / 2, seg=18, bevel=.006, up=tuple(W)), mats[1], bone, tag='sword')
    elif guard_style == 'hilt':
        m.add(rbox(base, (guard, .04, thick * 2.6), .016, rot=euler_of(W, D, N)), mats[1], bone, tag='sword')
        for s in (1, -1): m.add(sphere(base + W * s * guard * .52, .024, 12, 8), mats[1], bone, tag='sword')
    else:
        m.add(rbox(base, (guard, .04, thick * 2.2), .014, rot=euler_of(W, D, N)), mats[1], bone, tag='sword')
    m.add(cyl(base, base - D * grip_len, .019, .021, seg=12, bevel=.004), mats[2], bone, tag='sword')
    for k in (.35, .75): m.add(torus(base - D * grip_len * k, .021, .004, 10, 4, rot=euler_of(W, D, N)), mats[1], bone, tag='sword')
    m.add(sphere(base - D * (grip_len + pommel * .7), pommel, 12, 8), mats[3], bone, tag='sword')
    return base, E

def cape(m, name, parent, y0, z0, width, length, mats, n=4, flare=1.5, back=-.16, curve=.1, thick=.012, nu=18, nv=12, wave=.018, hang=.12):
    """Cape hanging from the shoulders on an extra chain (y0, z0 = top line). mats = (outer, lining). The top `hang`
    share stays on the parent so the collar never peels off the shoulders."""
    pts = [(0, y0 - length * i / n, z0 + back * (i / n) ** 1.3) for i in range(n + 1)]; w = m.chain(name, parent, pts)
    def surf(u, v):
        a = (u - .5) * 2; hw = width / 2 * (1 + (flare - 1) * v)
        return (a * hw, y0 - length * v, z0 + back * v ** 1.3 + curve * (a * a - .4) * (1 - .5 * v) + wave * math.sin(a * math.pi * 3) * v)
    bm = sheet(surf, nu, nv, thick); share = lambda p: smooth01((y0 - p.y) / (length * hang))
    m.add(bm, lambda c, nn: mats[0] if nn.z < 0 else mats[1], blend((w, share), (parent, lambda p: 1 - share(p))), tag='cape')
    return w

def surface_strap(m, surf, pts, width, thick, mat, bone, n=12, lift=.004, d=None, tag='strap'):
    """A strap or sash laid on a sculpted surface through control points (sheath belts, sashes)."""
    P = [surf.near(p) for p in spline(pts, n)]; C = [p + nn * (lift + thick / 2) for p, nn in P]
    m.add(ribbon(C, width, thick, normal=tuple(P[len(P) // 2][1]), seg=6), mat, bone, tag=tag)

def kite(w, h, n=12):
    """Kite shield outline (u across, v along): a gently arched top at v=+h/2 and a point at v=-h/2."""
    top = [(w / 2 * math.cos(a), h * .42 + h * .08 * math.sin(a)) for a in np.linspace(0, math.pi, n)]
    side = [(-w / 2 * (1 - t ** 1.8), h * .42 - h * .92 * t) for t in np.linspace(0, 1, n)[1:]]
    return top + side + [(-x, y) for x, y in side[::-1][1:]]
