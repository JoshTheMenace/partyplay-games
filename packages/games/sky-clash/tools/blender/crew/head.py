"""Sculpted heads for the crew: a distance-field face sampled on a grid, inset eyes under real lids, brows, an opening jaw and clumped hair.

Everything is authored in head units (head height = 1, origin at the head centre, +Y up, +Z out of the face) and mapped to character
space by Head.at(). Numbers here are a face recipe: a fighter script overrides entries of FACE to get a different person.
"""
from kit import *

FACE = dict(
    skull=((0, .12, -.03), (.36, .385, .43)), jaw=((0, -.13, .06), (.305, .36, .31)), chin=((0, -.41, .235), .075), jaw_corner=((.20, -.26, -.01), .085),
    cheek=((.20, -.08, .20), .11), brow=((.18, .10, .30), .055), muzzle=((0, -.26, .25), (.13, .09, .10)),
    nose_bridge=(0, .03, .335), nose_tip=(0, -.15, .425), nose_r=(.024, .034), nose_ball=.036, nostril=((.04, -.172, .368), .03),
    dish=((.155, .0, .40), .10, .05), eye=((.155, .0, .235), .10), eye_open=48, lid_up=22, lid_low=12, lid_tilt=5, iris=27, pupil=11,
    mouth_y=-.305, mouth_z=.338, mouth_half=.095, lip_up=(.085, .024, .03), lip_low=(.07, .028, .03), neck=((0, -.42, -.08), (0, -.80, -.13), .185),
    brow_in=(.05, .118, .372), brow_mid=(.16, .158, .352), brow_out=(.262, .125, .27), brow_w=.026, ear=((.362, -.02, -.02), (.022, .08, .045)),
)

class Head:
    def __init__(self, center, hh, face=None, nu=84, nv=64):
        self.c, self.hh, self.F = A(center), hh, {**FACE, **(face or {})}; F = self.F
        fld = Field().add(ellipsoid(*F['skull'])).add(ellipsoid(*F['jaw']), .10).add(lambda p: np.linalg.norm(p - A(F['chin'][0]), axis=1) - F['chin'][1], .08)
        sph = lambda c, r, s: (lambda p: np.linalg.norm(p - A(c[0] * s, c[1], c[2]), axis=1) - r)
        fld.both(lambda s: sph(*F['jaw_corner'], s), .10).both(lambda s: sph(*F['cheek'], s), .08).add(ellipsoid(*F['muzzle']), .07)
        b = F['brow']; fld.add(capsule((-b[0][0], b[0][1], b[0][2]), b[0], b[1]), .06)
        fld.add(capsule(F['nose_bridge'], F['nose_tip'], *F['nose_r']), .03).add(lambda p: np.linalg.norm(p - A(F['nose_tip']), axis=1) - F['nose_ball'], .025).both(lambda s: sph(*F['nostril'], s), .02)
        fld.add(capsule(*F['neck'][:2], F['neck'][2]), .08)
        my, mz = F['mouth_y'], F['mouth_z']; lu, ll = F['lip_up'], F['lip_low']
        fld.add(ellipsoid((0, my + lu[1] * .9, mz), lu), .02).add(ellipsoid((0, my - ll[1] * .95, mz - .006), ll), .02)
        fld.cut(ellipsoid((0, my, mz + .03), (F['mouth_half'] * 1.02, .0045, .03)), .008)
        dc, dr, dk = F['dish']; fld.both(lambda s: sph(dc, dr, s), dk, cut=True)   # a soft orbital hollow; the eyeball and lids sit in it
        self.field = fld; self.mouth_lat = math.degrees(math.atan2(my, mz))
        self.pts, self.lon, self.lat = sample_head(fld, nu, nv, focus=1.0); j = int(np.argmin(np.abs(self.lat - self.mouth_lat))); self.mouth_row = j
        # Put one grid row exactly on the mouth line, then resample that row.
        self.lat[j] = self.mouth_lat; lo = np.radians(self.lon); la = math.radians(self.mouth_lat); d = np.stack([math.cos(la) * np.sin(lo), np.full_like(lo, math.sin(la)), math.cos(la) * np.cos(lo)], axis=-1); t = np.full(len(d), 2.0)
        for _ in range(90): t -= np.clip(fld(d * t[:, None]), -.05, .05) * .9
        self.pts[j] = d * t[:, None]; self.mouth_half_deg = math.degrees(math.atan2(F['mouth_half'], mz))
    def at(self, p, side=1):
        """Head units -> character space (side -1 mirrors X)."""
        p = A(p); return self.c + A(p[0] * side, p[1], p[2]) * self.hh
    def surface(self, lon, lat, lift=0.0):
        """Point on the sculpt along a direction (degrees), pushed out by `lift` head units."""
        lo, la = math.radians(lon), math.radians(lat); d = A(math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo)); t = 2.0
        for _ in range(70): t -= float(np.clip(self.field((d * t)[None])[0], -.05, .05)) * .9
        return d * (t + lift)
    def surfaces(self, lon, lat, lift=0.0):
        """Batch of surface(): arrays of directions (degrees) -> (n, 3) points."""
        lo, la = np.radians(np.asarray(lon, dtype=float)), np.radians(np.asarray(lat, dtype=float)); d = np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], axis=-1); t = np.full(len(d), 2.0)
        for _ in range(70): t -= np.clip(self.field(d * t[:, None]), -.05, .05) * .9
        return d * (t + np.asarray(lift, dtype=float))[:, None]
    def project(self, p, lift):
        """Keep a head-unit point at least `lift` above the sculpt (hair and straps hug the skull without sinking in)."""
        p = A(p); s = float(self.field(p[None])[0])
        if s >= lift: return p
        e = 1e-3; g = A(*[(float(self.field((p + A(*[e if k == i else 0 for k in range(3)]))[None])[0]) - s) / e for i in range(3)]); return p + unit(g) * (lift - s)

    def skin(self, slot='skin', density=2.6, lip=None):
        F = self.F; p = head_part(self.pts, self.lon, self.lat, mouth=(self.mouth_row, self.mouth_half_deg), name='head', slot=slot, density=density)
        hu = p.v.copy(); low = p.tags['lower_lip']; half = self.mouth_half_deg; lat_m = self.mouth_lat; w = []
        for i, q in enumerate(hu):
            lon = math.degrees(math.atan2(q[0], q[2])); lat = math.degrees(math.atan2(q[1], math.hypot(q[0], q[2]))); front = float(smooth(78, 38, abs(lon))) * float(smooth(-86, -68, lat))
            if i in low: j = .55 + .45 * (1 - (abs(lon) / half) ** 2)
            elif lat < lat_m - .01: j = front * (1 if abs(lon) < half else float(smooth(lat_m, lat_m - 9, lat)))
            elif abs(lat - lat_m) <= .01: j = .5 * front if abs(lon) >= half else 0.0
            else: j = 0.0
            nk = float(smooth(-.40, -.62, q[1])) * (1 - j)   # the neck stub follows the neck bone
            w.append({'head': max(1e-4, 1 - j - nk), 'jaw': j, 'neck': nk})
        if lip:
            my, mz = F['mouth_y'], F['mouth_z']; lu, ll = F['lip_up'], F['lip_low']
            def inside(c):
                a = (c - A(0, my + lu[1] * .9, mz)) / (A(lu) * A(1.0, 1.05, 1.6)); b2 = (c - A(0, my - ll[1] * .95, mz - .006)) / (A(ll) * A(1.0, 1.05, 1.6)); return lip if min(float(a @ a), float(b2 @ b2)) < 1 and c[2] > mz - .03 else None
            p.face_slots(lambda c, i: inside(c))
        p.w = w; p.v = self.c + hu * self.hh; return p

    def eyes(self, white='white', iris='iris', pupil='dark', lid='skin', lash='dark', density=3.0):
        """Eyeballs (white, iris ring and pupil as geometry, so they stay crisp), upper and lower lid shells and a lash line. Returns parts for both sides."""
        F = self.F; (ex, ey, ez), er = F['eye']; out = []
        for s, n in ((1, 'L'), (-1, 'R')):
            c = A(ex * s, ey, ez); ang = [0, F['pupil'] * .5, F['pupil'], F['pupil'] + 1.5, (F['pupil'] + F['iris']) * .5, F['iris'], F['iris'] + 1.5, 44, 60, 78, 100, 130, 160]
            keys = [dict(p=c + A(0, 0, er * math.cos(math.radians(a))), r=max(er * math.sin(math.radians(a)), 1e-4)) for a in ang[1:]]
            ball = loft(keys, seg=20, caps=('flat', 'flat'), fwd=(0, 1, 0), name=f'eye_{n}', slot=white, density=density)
            def slot_of(cen, i, c=c):
                a = math.degrees(math.acos(np.clip((cen[2] - c[2]) / max(np.linalg.norm(cen - c), 1e-9), -1, 1))); return pupil if a < F['pupil'] + .8 else iris if a < F['iris'] + .8 else None
            ball.face_slots(slot_of); ball.v = self.c + ball.v * self.hh; ball.bone('head'); out.append(ball)
            R = er * 1.11; op, tilt = F['eye_open'], F['lid_tilt'] * s
            def edge(a, up):
                u = a / op; base = tilt * u - 2
                if abs(u) >= 1: return base
                return base + (F['lid_up'] * (1 - u * u) ** .75 if up else -F['lid_low'] * (1 - abs(u) ** 2.2))
            def on(a, e, r=R, c=c): a, e = math.radians(a), math.radians(e); return c + A(math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)) * r
            upper = shell(lambda u, v: on(lerp(-88, 88, u), lerp(edge(lerp(-88, 88, u), True), 128, v ** 1.4)), nu=22, nv=9, thick=er * .10, name=f'lid_{n}', slot=lid, density=density)
            lower = shell(lambda u, v: on(lerp(88, -88, u), lerp(edge(lerp(88, -88, u), False), -100, v ** 1.3)), nu=22, nv=7, thick=er * .07, name=f'lowlid_{n}', slot=lid, density=density)
            line = loft([dict(p=on(a, edge(a, True) + .5, R * 1.012), r=er * ((.07 if a * s > 0 else .055) if abs(a) < op * .85 else .035)) for a in np.linspace(-op * 1.05, op * 1.05, 11)], seg=6, caps=('round', 'round'), fwd=(0, 0, 1), name=f'lash_{n}', slot=lash, density=density)
            for part, bone in ((upper, f'lid_{n}'), (lower, 'head'), (line, f'lid_{n}')): part.v = self.c + part.v * self.hh; part.bone(bone); out.append(part)
        return out

    def brows(self, slot='hair'):
        F = self.F; out = []
        for s, n in ((1, 'L'), (-1, 'R')):
            pts = [A(F[k][0] * s, F[k][1], F[k][2]) for k in ('brow_in', 'brow_mid', 'brow_out')]; w = F['brow_w']
            keys = [dict(p=self.project(pts[0], .012), r=(w * .55, w * .30), sq=2.6), dict(p=self.project(lerp(pts[0], pts[1], .5) + A(0, .008, 0), .014), r=(w * .62, w * .30), sq=2.6), dict(p=self.project(pts[1], .014), r=(w * .52, w * .27), sq=2.6),
                    dict(p=self.project(lerp(pts[1], pts[2], .55), .012), r=(w * .38, w * .22), sq=2.4), dict(p=self.project(pts[2], .008), r=(w * .14, w * .10), cap=2.0)]
            b = loft(keys, n=9, seg=8, caps=('round', 'round'), fwd=(0, 0, 1), name=f'brow_{n}', slot=slot, density=2.4); b.v = self.c + b.v * self.hh; out.append(b.bone(f'brow_{n}'))
        return out

    def mouth(self, dark='dark', teeth='white'):
        """Mouth cavity and two rows of teeth, seen only when the jaw opens."""
        F = self.F; my, mz = F['mouth_y'], F['mouth_z']
        bag = loft([dict(p=(0, my + .012, mz - .22), r=(.05, .04)), dict(p=(0, my, mz - .13), r=(.105, .07)), dict(p=(0, my - .005, mz - .045), r=(.10, .055))], n=6, seg=12, caps=('round', 'open'), fwd=(0, 1, 0), name='mouthbag', slot=dark)
        def row(y0, y1, bone, name):
            p = shell(lambda u, v: A(math.sin(math.radians(lerp(-58, 58, u))) * .088, lerp(y0, y1, v), mz - .115 + math.cos(math.radians(lerp(-58, 58, u))) * .088), nu=10, nv=2, thick=.012, name=name, slot=teeth); p.v = self.c + p.v * self.hh; return p.bone(bone)
        bag.v = self.c + bag.v * self.hh; bag.paint(lambda p: {'head': .5, 'jaw': .5})
        return [bag, row(my + .002, my + .036, 'head', 'teeth_up'), row(my - .040, my - .004, 'jaw', 'teeth_low')]

    def ears(self, slot='skin'):
        (ex, ey, ez), (rx, ry, rz) = self.F['ear']; out = []
        for s, n in ((1, 'L'), (-1, 'R')):
            keys = [dict(p=(ex * s - .02 * s, ey - ry * .9, ez + .01), r=(rz * .35, rx * .8)), dict(p=(ex * s, ey - ry * .4, ez), r=(rz * .7, rx)), dict(p=(ex * s + .012 * s, ey + ry * .3, ez - .012), r=(rz, rx * 1.1)), dict(p=(ex * s + .006 * s, ey + ry * .85, ez - .008), r=(rz * .6, rx * .8), cap=1.6)]
            e = loft(keys, n=8, seg=10, caps=('round', 'round'), fwd=(0, 0, 1), name=f'ear_{n}', slot=slot, density=1.6); e.v = self.c + e.v * self.hh; out.append(e.bone('head'))
        return out

    def clump(self, lon, lat, heading, length, width=.09, thick=.035, lift=.02, droop=.6, flick=0.0, taper=.9, slot='hair', bone='head', name='hair', steps=7, chain_bones=None, twist=0.0):
        """One sculpted lock of hair: from a root on the scalp (lon, lat degrees) it flows along `heading` (degrees clockwise from 'up the skull', seen from outside),
        droops with gravity, flicks outward at the tip and stays `lift` above the head. Sizes in head units."""
        root = self.surface(lon, lat, lift); n = unit(root); up = A(0, 1, 0); east = unit(np.cross(up, n)) if abs(n[1]) < .98 else A(1, 0, 0); north = unit(np.cross(n, east))
        d = unit(north * math.cos(math.radians(heading)) + east * math.sin(math.radians(heading))); pts = [root]; ds = length / steps
        for i in range(steps):
            t = (i + 1) / steps; d = unit(d + A(0, -1, 0) * droop * ds * 3.2 + unit(pts[-1]) * flick * t * t * .9); q = self.project(pts[-1] + d * ds, lift * (1 + 1.6 * t * flick + .3 * t)); pts.append(q)
        keys = []
        for i, q in enumerate(pts):
            t = i / steps; k = (1 - t ** 2.2 * taper) * (.55 + .45 * min(1, t * 5)); keys.append(dict(p=q, r=(width * .5 * k, thick * .5 * k * (1 - .4 * t)), sq=2.5, tw=twist * t, cap=2.2 if i == steps else 1.0))
        nrm = unit(pts[0]); p = loft(keys, n=steps * 2, seg=8, caps=('round', 'round'), fwd=nrm, name=name, slot=slot, density=1.3)
        if chain_bones: p.w = None
        p.v = self.c + p.v * self.hh; p.tags['path'] = [self.c + q * self.hh for q in pts]
        return p if chain_bones else p.bone(bone)

    def cap(self, hairline, lift=.03, slot='hair', nu=56, nv=22, volume=None, grooves=(13, .16)):
        """The sculpted hair mass above hairline(lon degrees) -> lat degrees. volume(lon, lat01) adds lift (head units) away from the hairline;
        grooves=(count, depth) combs ridges into it so the mass reads as locks, not a helmet."""
        lons, lats, lifts = [], [], []
        for j in range(nv + 1):
            for i in range(nu):
                lon = -180 + 360 * i / nu; v = (j / nv) ** .9; hl = hairline(lon); lat = lerp(hl, 89.5, v); k = math.sin(math.pi * min(1, v * 1.15)) ** .6
                g = 1 + grooves[1] * math.sin(math.radians(lon * grooves[0] + lat * 5) + 1.6 * math.sin(math.radians(lon * 3 + 40))) * (.55 + .45 * math.sin(math.radians(lon * 5 + 70))) * min(1, v * 4) * (1 - v) ** .3
                lons.append(lon); lats.append(lat); lifts.append((lift * (.35 + .65 * min(1, v * 6)) + (volume(lon, v) if volume else 0) * k) * g)
        grid = self.surfaces(lons, lats, lifts).reshape(nv + 1, nu, 3)
        p = shell(None, nu=nu, nv=nv, thick=.025, name='haircap', slot=slot, density=1.3, close_u=True, grid=grid); p.v = self.c + p.v * self.hh; return p.bone('head')
