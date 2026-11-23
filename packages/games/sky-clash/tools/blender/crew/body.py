"""Reusable humanoid builders for the crew: skeleton layouts, torso, boots, hands, heads, eyes, brows and hair. All in character space (see kit.py)."""
from kit import *

def humanoid(hips, spine, chest, neck, head, clav, shoulder, elbow, wrist, hip, knee, ankle, prop):
    """Contract skeleton from left-side joints (mirrored to the right). Returns {bone: (position, parent)}."""
    J = {'root': ((0, 0, 0), None), 'hips': (tuple(hips), 'root'), 'spine': (tuple(spine), 'hips'), 'chest': (tuple(chest), 'spine'), 'neck': (tuple(neck), 'chest'), 'head': (tuple(head), 'neck')}
    for s, n in ((1, 'L'), (-1, 'R')):
        m = lambda p: (p[0] * s, p[1], p[2])
        J[f'shoulder_{n}'] = (m(clav), 'chest'); J[f'upperarm_{n}'] = (m(shoulder), f'shoulder_{n}'); J[f'forearm_{n}'] = (m(elbow), f'upperarm_{n}'); J[f'hand_{n}'] = (m(wrist), f'forearm_{n}')
        J[f'thigh_{n}'] = (m(hip), 'hips'); J[f'shin_{n}'] = (m(knee), f'thigh_{n}'); J[f'foot_{n}'] = (m(ankle), f'shin_{n}')
    J['prop'] = (tuple(prop), 'hand_R'); return J
def face_joints(center, hh, eye, brow, jaw):
    """Face bones from head-unit offsets (head height = 1): jaw hinge, upper lids at the eye centres, brows."""
    c = A(center); at = lambda p, s=1: tuple(c + A(p[0] * s, p[1], p[2]) * hh); J = {'jaw': (at(jaw), 'head')}
    for s, n in ((1, 'L'), (-1, 'R')): J[f'lid_{n}'] = (at(eye, s), 'head'); J[f'brow_{n}'] = (at(brow, s), 'head')
    return J
def hand_axes(arm):
    """Left-hand frame in the rest pose: fingers along the arm, thumb toward +Z, palm normal toward the body."""
    along = unit(arm); thumb = A(0, 0, 1.0); palm = unit(np.cross(along, thumb)); return along, thumb, palm
def hand_joints(wrist, arm, k=1.0):
    along, thumb, palm = hand_axes(arm); w = A(wrist); J = {}
    for s, n in ((1, 'L'), (-1, 'R')):
        m = lambda p: (p[0] * s, p[1], p[2])
        J[f'fingers1_{n}'] = (m(w + along * .098 * k), f'hand_{n}'); J[f'fingers2_{n}'] = (m(w + along * .136 * k + palm * .006 * k), f'fingers1_{n}'); J[f'thumb_{n}'] = (m(w + along * .03 * k + thumb * .034 * k), f'hand_{n}')
    return J

def torso(rings, J, slot='primary', name='torso', seg=24, n=20, top='open', lip=(.01, .03)):
    """Loft up the spine through dict(y, r=(half width, half depth), z, bumps, sq) rings; angle 90 is the chest, 270 the back."""
    keys = [dict(p=(0, r['y'], r.get('z', 0)), r=r['r'], sq=r.get('sq', 2.3), bumps=r.get('bumps', ())) for r in rings]
    p = loft(keys, n=n, seg=seg, caps=('round', top), lip=lip, name=name, slot=slot, fwd=(0, 0, 1), seam=270)
    hy, sy, cy = J['hips'][0][1], J['spine'][0][1], J['chest'][0][1]
    return p.paint(by_height([(hy - .02, 'hips'), (hy + .02, 'hips'), (sy + .02, 'spine'), (cy + .03, 'chest'), (cy + .5, 'chest')]))

def torso_point(rings, y, ang, lift=0.0, sq=2.3):
    """A point on a torso built from `rings` at height y and angle (0 = the fighter's left, 90 = front, 270 = back), pushed out by `lift`: where to hang belts, straps, buttons and skirts."""
    i = max(0, min(len(rings) - 2, next((k for k in range(len(rings) - 1) if rings[k + 1]['y'] >= y), len(rings) - 2))); a, c = rings[i], rings[i + 1]; t = float(np.clip((y - a['y']) / (c['y'] - a['y']), 0, 1))
    rx, rz, z0 = lerp(a['r'][0], c['r'][0], t), lerp(a['r'][1], c['r'][1], t), lerp(a.get('z', 0), c.get('z', 0), t); q = math.radians(ang); e = 2 / sq
    x, z = math.copysign(abs(math.cos(q)) ** e, math.cos(q)), math.copysign(abs(math.sin(q)) ** e, math.sin(q)); n = unit((x / rx, 0, z / rz)); return A(rx * x, y, z0 + rz * z) + n * lift
def strip(points, width, thick=.004, name='strip', slot='leather', fwd=(0, 1, 0), n=None, sq=3.5):
    """A flat band (strap, ribbon, sash tail) through points; `width` and `thick` are half sizes."""
    return loft([dict(p=p, r=(thick, width), sq=sq) for p in points], n=n or len(points) * 2, seg=8, caps=('flat', 'flat'), fwd=fwd, name=name, slot=slot)

def boot(knee, ankle, side='L', top=.75, cuff=.08, sole=.03, length=.26, width=.10, slot='leather', sole_slot='dark', toe_slot=None, calf=.10, heel=.065):
    """Tall boot: shaft with a calf, fold-over cuff, foot, welted sole and an optional toe cap. Built for the left leg."""
    K, Ak = A(knee), A(ankle); start = lerp(Ak, K, top); shin, foot = f'shin_{side}', f'foot_{side}'; floor = sole
    shaft = loft([dict(p=start, r=(.066, .072)), dict(p=lerp(Ak, K, top * .72), r=(.064, .074), bumps=[(270, calf * 1.4, 55)]), dict(p=lerp(Ak, K, top * .40), r=(.054, .062), bumps=[(270, calf * .6, 55)]),
                  dict(p=Ak + A(0, .035, 0), r=(.046, .054)), dict(p=Ak + A(0, -.01, .004), r=(.046, .058)), dict(p=A(Ak[0], floor + .035, Ak[2] + .012), r=(.048, .066))],
                 n=14, seg=16, caps=('open', 'round'), lip=(.008, .04), name=f'boot_{side}', slot=slot).paint(chain([shin, foot], [K, Ak, A(Ak[0], 0, Ak[2])], .05))
    fold = loft([dict(p=start + A(0, .012, 0), r=(.071, .077)), dict(p=start + A(0, -cuff * .5, 0), r=(.075, .082)), dict(p=start + A(0, -cuff, 0), r=(.070, .078))], seg=16, caps=('open', 'open'), lip=(.008, .02), name=f'bootcuff_{side}', slot=slot).bone(shin)
    z0, z1 = Ak[2] - heel, Ak[2] - heel + length; x = Ak[0] + .004; zt = lambda t: lerp(z0, z1, t)
    upper = loft([dict(p=(x, floor + .040, zt(0)), r=(width * .34, .034), sq=2.6), dict(p=(x, floor + .048, zt(.16)), r=(width * .46, .046), sq=2.6), dict(p=(x, floor + .050, zt(.42)), r=(width * .50, .050), sq=2.5),
                  dict(p=(x + .003, floor + .036, zt(.70)), r=(width * .53, .037), sq=2.5), dict(p=(x + .004, floor + .028, zt(.90)), r=(width * .47, .029), sq=2.4), dict(p=(x + .004, floor + .022, zt(.985)), r=(width * .32, .021), sq=2.3)],
                 n=12, seg=14, caps=('round', 'round'), fwd=(0, 1, 0), name=f'foot_{side}', slot=slot).bone(foot)
    if toe_slot: upper.face_slots(lambda c, i: toe_slot if c[2] > zt(.84) else None)
    welt = loft([dict(p=(x, floor * .5, zt(-.02)), r=(width * .40, floor * .52), sq=5), dict(p=(x, floor * .5, zt(.2)), r=(width * .53, floor * .52), sq=5), dict(p=(x + .003, floor * .5, zt(.68)), r=(width * .54, floor * .52), sq=5),
                 dict(p=(x + .004, floor * .5, zt(.93)), r=(width * .52, floor * .5), sq=5), dict(p=(x + .004, floor * .5, zt(1.01)), r=(width * .36, floor * .46), sq=5)],
                n=10, seg=14, caps=('flat', 'flat'), fwd=(0, 1, 0), name=f'sole_{side}', slot=sole_slot).bone(foot)
    out = join([shaft, fold, upper, welt], name=f'boot_{side}', slot=slot); out.aspect = 1.4; return out

FINGERS = [(.031, .074), (.010, .082), (-.011, .077), (-.031, .061)]   # (offset along the thumb axis, length) for index..little
def hand(wrist, arm, side='L', slot='skin', k=1.0, thick=1.0, curl=14, gauntlet=None, gauntlet_slot=None, fist=False):
    """A hand in the rest frame of hand_axes(): palm, four jointed fingers and a thumb, optionally under a flared gauntlet cuff.
    Returns a list of parts for the left side. `fist` curls the fingers round a grip (weapon hands)."""
    along, thumb, palm = hand_axes(arm); W = A(wrist); f1, f2, hb, tb = f'fingers1_{side}', f'fingers2_{side}', f'hand_{side}', f'thumb_{side}'; parts = []
    kn = W + along * .098 * k
    body = loft([dict(p=W - along * .012 * k, r=(.020 * k * thick, .030 * k), sq=2.6), dict(p=W + along * .03 * k, r=(.019 * k * thick, .041 * k), sq=2.8), dict(p=W + along * .072 * k, r=(.018 * k * thick, .046 * k), sq=3.0), dict(p=kn + along * .004 * k, r=(.0155 * k * thick, .045 * k), sq=3.2)],
                n=8, seg=14, caps=('round', 'round'), fwd=thumb, name=f'palm_{side}', slot=slot, density=1.6)
    body.paint(lambda p: {hb: 1.0}); parts.append(body)
    step = (78, 96, 70) if fist else (curl, curl * 1.25, curl)
    for i, (off, ln) in enumerate(FINGERS):
        base = kn + thumb * off * k - along * .006 * k; r = (.0118 if i < 3 else .0105) * k * thick; seg = [ln * .46 * k, ln * .30 * k, ln * .26 * k]; pts = [base]; a = 0.0
        for j, L in enumerate(seg): a += math.radians(step[j]); pts.append(pts[-1] + (along * math.cos(a) + palm * math.sin(a)) * L)
        keys = [dict(p=pts[0], r=r * 1.06), dict(p=lerp(pts[0], pts[1], .6), r=r), dict(p=pts[1], r=r * 1.04), dict(p=lerp(pts[1], pts[2], .55), r=r * .95), dict(p=pts[2], r=r * .97), dict(p=lerp(pts[2], pts[3], .7), r=r * .88, cap=1.3)]
        fg = loft(keys, seg=8, caps=('round', 'round'), fwd=thumb, name=f'finger{i}_{side}', slot=slot, density=1.6)
        pip = pts[1]; fg.paint(lambda p, pip=pip, base=base: (lambda t: {f1: 1 - t, f2: t})(float(smooth(-.008 * k, .008 * k, np.dot(p - pip, unit(pip - base)))))); parts.append(fg)
    tbase = W + along * .028 * k + thumb * .030 * k - palm * .004 * k; td = unit(along * (.45 if fist else .62) + thumb * .72 + palm * (.5 if fist else .22)); tr = .0135 * k * thick
    th = loft([dict(p=tbase - td * .012 * k, r=tr * 1.25), dict(p=tbase + td * .028 * k, r=tr * 1.05), dict(p=tbase + td * .05 * k + palm * .004 * k, r=tr), dict(p=tbase + td * .068 * k + palm * .010 * k, r=tr * .86, cap=1.3)],
              n=7, seg=8, caps=('round', 'round'), fwd=palm, name=f'thumbmesh_{side}', slot=slot, density=1.6)
    th.paint(lambda p: (lambda t: {hb: 1 - t, tb: t})(float(smooth(-.004, .012, np.dot(p - tbase, td))))); parts.append(th)
    if gauntlet:
        start, r = A(gauntlet[0]), gauntlet[1]
        g = loft([dict(p=start, r=(r * 1.16, r * 1.2)), dict(p=lerp(start, W, .45), r=(r * 1.02, r * 1.06)), dict(p=W - along * .02 * k, r=(r * .74, r * .86)), dict(p=W + along * .004 * k, r=(.024 * k * thick, .036 * k), sq=2.5)],
                 n=8, seg=14, caps=('open', 'open'), lip=(.007, .025), fwd=thumb, name=f'gauntlet_{side}', slot=gauntlet_slot or slot)
        g.paint(mix(lambda p: {f'forearm_{side}': 1.0}, lambda p: {hb: 1.0}, lambda p: smooth(-.03, .0, np.dot(p - W, along)))); parts.append(g)
    return parts
