"""Kart Party 2 course props and item models -> public/models/props.glb (+ art/props/props.blend).

    blender --background --factory-startup --python art/props/build_props.py [-- --no-render | --only space,city | --detail a,b]

Authoring axes (Blender): +Z up, every prop faces -Y. The glTF exporter turns that into Y-up facing +Z.
Metres. Every root node sits at the origin with its origin at ground contact (items: bottom of the model).
Animatable parts are child nodes: item_box_mark, bomb_fuse (spark at the fuse tip), flag_pole_flag, windmill_rotor, drone_rotor_fl/fr/rl/rr,
star_bumper_star (the star on the pinball bumper, pivot at its centre). Exception: ring_gate's origin is the centre of its hoop.
Everything is procedural, flat PBR materials only (no image textures), one mesh per node.
After export the GLB is re-imported to assert names, then contact sheets are rendered to /tmp/kartqa.
"""
import bpy, bmesh, math, random, sys
from contextlib import contextmanager
from pathlib import Path
from mathutils import Vector, Matrix, Euler

GAME = Path(__file__).resolve().parents[2]
GLB = GAME / 'public/models/props.glb'
BLEND = GAME / 'art/props/props.blend'
QA = Path('/tmp/kartqa')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TAU, PI = math.tau, math.pi
V = Vector

THEMES = {
    'common': ['item_box', 'start_gantry', 'cone', 'tire_stack', 'barrier', 'arrow_sign', 'crowd_stand', 'balloon_arch', 'lamp_post', 'flag_pole'],
    'items': ['peel', 'bouncer_shell', 'seeker_shell', 'bomb', 'comet', 'drone'],
    'beach': ['palm_a', 'palm_b', 'umbrella', 'beach_hut', 'lifeguard_tower', 'rock_beach', 'boat'],
    'desert': ['cactus_a', 'cactus_b', 'rock_red_a', 'rock_red_b', 'mesa', 'water_tower', 'windmill'],
    'city': ['building_a', 'building_b', 'building_c', 'street_light', 'neon_sign', 'billboard', 'parked_car'],
    'snow': ['pine_a', 'pine_b', 'snow_rock', 'cabin', 'snowman', 'ice_crystal'],
    'space': ['planet_ringed', 'asteroid_a', 'asteroid_b', 'space_station', 'satellite', 'star_crystal', 'star_bumper', 'ring_gate', 'spring_pad'],
}
CHILDREN = {'item_box': ['item_box_mark'], 'bomb': ['bomb_fuse'], 'flag_pole': ['flag_pole_flag'], 'windmill': ['windmill_rotor'],
            'drone': ['drone_rotor_fl', 'drone_rotor_fr', 'drone_rotor_rl', 'drone_rotor_rr'], 'star_bumper': ['star_bumper_star']}

# ---------------------------------------------------------------- materials
MATS = {}
def lin(c): return c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4
def mat(name, hexc, rough=.55, metal=0., emit=0., alpha=1., double=False):
    srgb = [int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    rgb = [lin(c) for c in srgb]
    m = bpy.data.materials.new(name)
    bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (*rgb, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if emit:
        bs.inputs['Emission Color'].default_value = (*rgb, 1)
        bs.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        bs.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    m.use_backface_culling = not double
    m.diffuse_color = (*srgb, alpha)
    MATS[name] = m

PALETTE = dict(
    # shared toy-world basics
    white=('#f6f3ec', .5), black=('#1d1f27', .6), rubber=('#2a2c33', .85), dark=('#30343f', .5),
    dark_metal=('#3d4452', .38, .6), metal=('#c3ccd6', .3, .8), gold=('#ffc53d', .3, .7),
    red=('#e63946', .45), yellow=('#ffcf33', .45), blue=('#2f6fe8', .45), green=('#3fbf5a', .5),
    orange=('#ff6a13', .5), wood=('#b8804f', .75), wood_dark=('#7a4b30', .8), wood_light=('#d9a066', .7),
    stone=('#8e8a86', .9), glass_dark=('#1f2c44', .15, .4),
    # course furniture
    gantry_blue=('#2446b8', .4, .15), check_black=('#1b1c22', .6), check_white=('#f4f4f2', .5),
    gantry_lamp=('#ff3b30', .3, 0, 3.0), tire_red=('#e8403a', .7), tire_white=('#e4e6ea', .7),
    barrier_red=('#e2383f', .5), sign_navy=('#1c2444', .45), sign_yellow=('#ffd21f', .4, 0, .5),
    stand_gray=('#c9cfd9', .8), stand_blue=('#2c5cc5', .5), stand_red=('#e2453c', .5),
    shirt_a=('#ff5a5f', .7), shirt_b=('#2f8cff', .7), shirt_c=('#ffd23f', .7), shirt_d=('#3ccf6e', .7),
    shirt_e=('#b26bff', .7), shirt_f=('#ff8fc7', .7), skin_a=('#f3c9a5', .7), skin_b=('#c98d62', .7), skin_c=('#8a5a3c', .7),
    balloon_red=('#ff3d57', .25), balloon_yellow=('#ffd23f', .25), balloon_green=('#39d98a', .25),
    balloon_blue=('#3b82ff', .25), balloon_pink=('#ff6bd6', .25),
    lamp_metal=('#26344a', .4, .5), lamp_glow=('#ffe3a3', .3, 0, 4.0),
    flag_teal=('#18b6a4', .6, 0, 0, 1, True), flag_white=('#f6f3ec', .6, 0, 0, 1, True), flag_coral=('#ff6b5b', .6, 0, 0, 1, True),
    pennant=('#ffcf33', .6, 0, 0, 1, True),
    # items
    item_glass=('#9fdcff', .06, 0, .35, .42), item_mark=('#fff1a8', .3, 0, 2.6),
    peel_yellow=('#ffd43b', .45), peel_inner=('#fff3c4', .6), peel_tip=('#5b3d24', .7),
    shell_green=('#1fb24a', .25), shell_green_dark=('#11813a', .3), shell_red=('#e5242f', .25), shell_red_dark=('#a8141d', .3),
    shell_cream=('#fff0d2', .5), seeker_eye=('#ffe14d', .2, 0, 3.0),
    bomb_body=('#252a3c', .3, .25), bomb_band=('#ffc23a', .4), fuse=('#d8b48a', .8), spark=('#ffb22e', .3, 0, 6.0),
    comet_core=('#fff4b8', .2, 0, 5.0), comet_spike=('#ff9b21', .3, 0, 3.0), comet_tail=('#ff6a2b', .3, 0, 2.5), comet_tail2=('#ff4fa8', .3, 0, 2.2),
    drone_yellow=('#ffc21a', .35), drone_light=('#bff4ff', .2, 0, 3.0), beacon_red=('#ff2d2d', .2, 0, 4.0), beacon_green=('#2dff7a', .2, 0, 4.0),
    # beach
    palm_trunk=('#c08b58', .8), palm_trunk_dark=('#8e6139', .85), palm_leaf=('#3fb04e', .6, 0, 0, 1, True), palm_leaf_dark=('#26894a', .6, 0, 0, 1, True),
    coconut=('#6b4424', .6), coral=('#ff6b5b', .5), teal=('#1fb5a8', .5), hut_mint=('#7ad9c3', .6), hut_door=('#ffc93d', .5),
    lifeguard_red=('#ec4436', .5), rock_sand=('#b9a790', .9), rock_sand_dark=('#968573', .9), boat_blue=('#2463eb', .4),
    # desert
    cactus=('#4f9d45', .65), cactus_light=('#7cc05a', .65), cactus_flower=('#ff5fa2', .5), fruit=('#e4386e', .5),
    rock_red=('#c24f2c', .9), rock_orange=('#e07a43', .9), rock_cream=('#f0c28c', .9), rock_top=('#b0442a', .9),
    tank_teal=('#3f8f99', .5, .3), roof_rust=('#a8452c', .6, .3), windmill_blade=('#aab4c0', .4, .3), windmill_red=('#d9412f', .5),
    # city (night)
    facade_navy=('#7a4552', .6), facade_plum=('#564273', .6), facade_steel=('#3e5470', .5, .2), trim=('#586277', .5),
    win_warm=('#ffcf7a', .3, 0, 2.6), win_cyan=('#78e6ff', .3, 0, 2.4), win_dim=('#26324c', .25, .2), win_shop=('#ffd98a', .3, 0, 1.6),
    neon_pink=('#ff3ea5', .3, 0, 5.0), neon_cyan=('#2de2ff', .3, 0, 5.0), neon_yellow=('#ffe23d', .3, 0, 5.0),
    street_glow=('#fff3d6', .3, 0, 5.0), sign_dark=('#171a28', .5), car_teal=('#18b3a6', .25, .2), headlight=('#fffbe8', .2, 0, 4.0),
    taillight=('#ff2b3a', .2, 0, 3.0), ad_purple=('#6a3df0', .6, 0, .8), ad_pink=('#ff4fa3', .6, 0, .8), ad_orange=('#ff9a3c', .6, 0, .8),
    ad_yellow=('#ffe066', .5, 0, 1.4), ad_dark=('#241a3d', .6, 0, .2), ad_white=('#ffffff', .5, 0, 1.2),
    # snow
    snow=('#f2f7ff', .85), pine=('#2f7d57', .75), pine_dark=('#1f5a40', .8), pine_trunk=('#6b4128', .85),
    roof_red=('#b8322f', .6), window_warm=('#ffc766', .3, 0, 3.0), scarf=('#e0303e', .7), carrot=('#ff7a1a', .6),
    rock_gray=('#8a93a3', .9), ice_glow=('#9ae8ff', .12, 0, 1.3), ice_deep=('#57b4ff', .12, 0, 1.0),
    # space (rainbow road)
    planet_violet=('#7b4dff', .6, 0, .35), planet_pink=('#ff6fd8', .6, 0, .35), planet_peach=('#ffb86b', .6, 0, .35), planet_teal=('#3fd9d0', .6, 0, .35),
    ring_a=('#ffe9a8', .4, 0, 1.2), ring_b=('#b58cff', .5, 0, .6), ring_c=('#9ef0ff', .4, 0, 1.0), moon=('#d9d2f0', .8, 0, .25),
    asteroid=('#8a7fb0', .85), asteroid_light=('#b3a8d6', .85), crystal_cyan=('#5ff6ff', .15, 0, 2.4), crystal_pink=('#ff5fd2', .15, 0, 2.4),
    crystal_gold=('#ffd35a', .15, 0, 2.2), station_white=('#e9edf5', .45), station_blue=('#3b6cff', .4), station_window=('#7ff3ff', .3, 0, 3.0),
    solar=('#2447b8', .25, .2, .25), solar_frame=('#c9d2e3', .4, .4), foil=('#ffb638', .35, .3), star_gold=('#ffd23d', .3, 0, 2.4),
    star_side=('#ff9a1f', .35, 0, 1.6), bumper_base=('#2a2350', .4, .3), bumper_rim=('#ff4fd8', .25, 0, 3.5), bumper_cap=('#6a3dff', .3, 0, .4),
    bumper_rubber=('#f6f3ec', .6, 0, .5), ring_glow=('#ffd23d', .2, 0, 2.2), ring_inner=('#5ff6ff', .2, 0, 2.6), spring_glow=('#4dffc3', .2, 0, 2.8),
    spring_arrow=('#ffffff', .3, 0, 3.0),
)

# ---------------------------------------------------------------- geometry helpers
def X(loc=(0, 0, 0), rot=(0, 0, 0), scale=1):
    sc = V(scale) if isinstance(scale, (tuple, list)) else V((scale,) * 3)
    return Matrix.LocRotScale(V(loc), Euler([math.radians(a) for a in rot]), sc)

def aim(a, b):
    """Matrix placing local +Z from a to b (local Z length = |b-a|, unscaled)."""
    a, b = V(a), V(b)
    return Matrix.Translation(a) @ (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()

class Part:
    """Accumulates primitives into one bmesh with per-face material indices."""
    def __init__(s): s.bm, s.mats, s.T = bmesh.new(), [], Matrix()
    def tag(s, faces, m):
        if m not in s.mats: s.mats.append(m)
        i = s.mats.index(m)
        for f in faces: f.material_index = i
        return faces
    @contextmanager
    def at(s, loc=(0, 0, 0), rot=(0, 0, 0), scale=1, m=None):
        old = s.T; s.T = old @ (m if m is not None else X(loc, rot, scale))
        try: yield
        finally: s.T = old
    def v(s, co): return s.bm.verts.new(s.T @ V(co))
    def face(s, verts, m):
        f = s.bm.faces.new(verts); s.tag([f], m); return f

def fix(p, faces):
    bmesh.ops.recalc_face_normals(p.bm, faces=list(faces))

def box(p, m, size, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0., seg=1):
    r = bmesh.ops.create_cube(p.bm, size=1.0, matrix=p.T @ X(loc, rot, size))
    vs = r['verts']
    faces = list({f for v in vs for f in v.link_faces})
    p.tag(faces, m)
    if bevel:
        edges = list({e for v in vs for e in v.link_edges})
        res = bmesh.ops.bevel(p.bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=seg, profile=.5,
                              affect='EDGES', clamp_overlap=True)
        p.tag(res['faces'], m)
    return faces

def lathe(p, prof, m, n=12, loc=(0, 0, 0), rot=(0, 0, 0), scale=1, sector=None, closed=False, caps=True, jag=None, twist=0.):
    """Revolve [(r, z)] around local Z. m: material or list per profile segment; sector: materials cycling by angle;
    jag: {profile index: amplitude} alternates that ring's radius (star skirts)."""
    faces = []
    with p.at(loc, rot, scale):
        rings = []
        for i, (r, z) in enumerate(prof):
            if r < 1e-6: rings.append([p.v((0, 0, z))]); continue
            ring = []
            for k in range(n):
                a = TAU * k / n + twist * i
                rr = r * (1 + (jag or {}).get(i, 0) * (1 if k % 2 == 0 else -1))
                ring.append(p.v((rr * math.cos(a), rr * math.sin(a), z)))
            rings.append(ring)
        segs = len(prof) if closed else len(prof) - 1
        for i in range(segs):
            a, b = rings[i], rings[(i + 1) % len(rings)]
            mm = m[i] if isinstance(m, list) else m
            for k in range(n):
                k2 = (k + 1) % n
                if len(a) == 1 and len(b) == 1: break
                vs = (a[0], b[k2], b[k]) if len(a) == 1 else (a[k], a[k2], b[0]) if len(b) == 1 else (a[k], a[k2], b[k2], b[k])
                f = p.face(vs, sector[k % len(sector)] if sector else mm); faces.append(f)
        if caps and not closed:
            for ring, mm in ((rings[0], m[0] if isinstance(m, list) else m), (rings[-1], m[-1] if isinstance(m, list) else m)):
                if len(ring) > 2: faces.append(p.face(ring, mm))
    fix(p, faces)
    return faces

def sphere(p, m, r, loc=(0, 0, 0), n=12, rings=6, scale=1, rot=(0, 0, 0), sector=None):
    prof = [(r * math.sin(PI * i / rings), -r * math.cos(PI * i / rings)) for i in range(rings + 1)]
    prof[0], prof[-1] = (0, -r), (0, r)
    return lathe(p, prof, m, n, loc, rot, scale, sector=sector)

def ring_profile(n, rx, ry=None, star=0., phase=0.):
    ry = rx if ry is None else ry
    return [(rx * math.cos(TAU * k / n + phase) * (1 - star * (k % 2)), ry * math.sin(TAU * k / n + phase) * (1 - star * (k % 2))) for k in range(n)]

def sweep(p, path, prof, m, radii=None, caps=True, closed=False, matf=None):
    """Sweep a closed 2D profile along a polyline with parallel-transport frames. radius 0 collapses to a tip.
    matf(segment, profile_edge) -> material overrides m."""
    path = [V(q) for q in path]; N = len(path); radii = radii or [1.0] * N
    tans = []
    for i in range(N):
        if closed: t = path[(i + 1) % N] - path[i - 1]
        else: t = path[min(i + 1, N - 1)] - path[max(i - 1, 0)]
        tans.append(t.normalized())
    ref = V((0, 0, 1)) if abs(tans[0].z) < .9 else V((1, 0, 0))
    nrm = tans[0].cross(ref).normalized(); frames = []
    for i in range(N):
        if i: nrm = tans[i - 1].rotation_difference(tans[i]) @ nrm
        frames.append((nrm.copy(), tans[i].cross(nrm).normalized()))
    rings = []
    for i in range(N):
        n_, b_ = frames[i]
        if radii[i] < 1e-6: rings.append([p.v(path[i])]); continue
        rings.append([p.v(path[i] + (n_ * u + b_ * w) * radii[i]) for u, w in prof])
    faces, P = [], len(prof)
    for i in range(N if closed else N - 1):
        a, b = rings[i], rings[(i + 1) % N]
        for j in range(P):
            j2 = (j + 1) % P
            if len(a) == 1 and len(b) == 1: break
            vs = (a[0], b[j2], b[j]) if len(a) == 1 else (a[j], a[j2], b[0]) if len(b) == 1 else (a[j], a[j2], b[j2], b[j])
            faces.append(p.face(vs, matf(i, j) if matf else m))
    if caps and not closed:
        for ring in (rings[0], rings[-1]):
            if len(ring) > 2: faces.append(p.face(ring, m))
    fix(p, faces)
    return faces

def extrude(p, poly, depth, m, loc=(0, 0, 0), rot=(0, 0, 0), side=None, bevel=0., scale=1):
    """Extrude a 2D polygon drawn in local XZ (u right, v up) through local Y (centred)."""
    with p.at(loc, rot, scale):
        fr = [p.v((u, -depth / 2, w)) for u, w in poly]
        bk = [p.v((u, depth / 2, w)) for u, w in poly]
    faces = [p.face(fr, m), p.face(list(reversed(bk)), m)]
    for i in range(len(poly)):
        j = (i + 1) % len(poly)
        faces.append(p.face((fr[i], bk[i], bk[j], fr[j]), side or m))
    fix(p, faces)
    if bevel:
        edges = list({e for f in faces for e in f.edges})
        res = bmesh.ops.bevel(p.bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=1, profile=.5, affect='EDGES', clamp_overlap=True)
        p.tag(res['faces'], side or m)
    return faces

def beam(p, m, a, b, t=.1, t2=None, n=0):
    """Square (or round if n) section member from a to b."""
    L = (V(b) - V(a)).length
    with p.at(m=aim(a, b)):
        if n: return lathe(p, [(t, 0), (t, L)], m, n)
        return box(p, m, (t, t2 or t, L), (0, 0, L / 2))

def quad(p, m, c, n, hw, hh, up=(0, 0, 1)):
    """Single outward-facing rectangle centred at c with normal n."""
    c, n, up = V(c), V(n).normalized(), V(up)
    t = up.cross(n).normalized(); u = n.cross(t)
    return p.face([p.v(c - t * hw - u * hh), p.v(c + t * hw - u * hh), p.v(c + t * hw + u * hh), p.v(c - t * hw + u * hh)], m)

def rock(p, m, loc, size, seed, subdiv=1, rough=.22, rot=(0, 0, 0), flat=.45, matf=None, cuts=()):
    rnd = random.Random(seed)
    r = bmesh.ops.create_icosphere(p.bm, subdivisions=subdiv + 1, radius=1.0, matrix=Matrix())
    vs = r['verts']; M = p.T @ X(loc, rot, size)
    for v in vs:
        v.co = v.co.normalized() * (1 + rough * (rnd.random() * 2 - 1))
        if v.co.z < -flat: v.co.z = -flat + (v.co.z + flat) * .15
        v.co = M @ v.co
    faces = list({f for v in vs for f in v.link_faces})
    fix(p, faces)
    for z in cuts:
        edges = list({e for f in faces for e in f.edges})
        bmesh.ops.bisect_plane(p.bm, geom=list(vs) + edges + faces, plane_co=(0, 0, z), plane_no=(0, 0, 1))
        vs = list({v for f in faces if f.is_valid for v in f.verts})
        faces = list({f for v in vs for f in v.link_faces})
    for f in faces:
        f.normal_update()
        p.tag([f], matf(f) if matf else m)
    return faces

def finish(p, name, parent=None, loc=(0, 0, 0), sharp=50):
    me = bpy.data.meshes.new(name)
    p.bm.to_mesh(me); p.bm.free()
    for m in p.mats: me.materials.append(MATS[m])
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(sharp))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent, ob.location = parent, loc
    mod = ob.modifiers.new('wn', 'WEIGHTED_NORMAL'); mod.keep_sharp = True
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob

# ---------------------------------------------------------------- common course furniture
def item_box():
    S = 1.5; p = Part()
    box(p, 'item_glass', (S, S, S), (0, 0, S / 2), bevel=.26, seg=3)
    root = finish(p, 'item_box')
    q = Part(); prof = ring_profile(8, .088, phase=PI / 8)
    arc = [(.24 * math.cos(math.radians(a)), 0, .17 + .24 * math.sin(math.radians(a))) for a in (168, 140, 112, 84, 56, 28, 0, -28, -56, -76)]
    sweep(q, arc + [(.035, 0, -.1), (0, 0, -.2)], prof, 'item_mark')
    box(q, 'item_mark', (.2, .2, .2), (0, 0, -.37), bevel=.06, seg=2)
    finish(q, 'item_box_mark', root, (0, 0, S / 2))

def start_gantry():
    p = Part(); X0 = 13.0
    for sx in (-1, 1):
        x = sx * X0
        box(p, 'gantry_blue', (1.6, 1.6, 9.2), (x, 0, 4.6), bevel=.14)
        box(p, 'dark', (2.3, 2.3, .6), (x, 0, .3), bevel=.1)
        for z in (1.15, 1.85): box(p, 'yellow', (1.68, 1.68, .34), (x, 0, z))
        box(p, 'red', (1.95, 1.95, .4), (x, 0, 9.4), bevel=.1)
        lathe(p, [(.05, 9.6), (.05, 11.9), (0, 12.0)], 'metal', 6, (x, 0, 0))
        extrude(p, [(0, 11.9), (1.5 * -sx, 11.55), (0, 11.2)], .02, 'pennant', (x, 0, 0))
    box(p, 'dark', (2 * X0 + 1.2, 1.0, 2.4), (0, 0, 8.2), bevel=.12)
    cols, sq = 26, .9
    for ny in (-1, 1):
        for r in range(2):
            for c in range(cols):
                quad(p, 'check_white' if (r + c) % 2 == 0 else 'check_black',
                     ((-cols / 2 + c + .5) * sq, ny * .515, 7.35 + (r + .5) * sq), (0, ny, 0), sq / 2, sq / 2)
    rail = [(x, 0, 9.4 + 2.2 * math.sin(PI * (x + X0) / (2 * X0))) for x in [-X0 + 2 * X0 * i / 14 for i in range(15)]]
    sweep(p, rail, ring_profile(8, .2), 'yellow')
    for i in range(1, 14, 2):
        x, _, z = rail[i]; beam(p, 'yellow', (x, 0, 9.35), (x, 0, z), .09, n=6)
    finish(p, 'start_gantry')

def cone():
    p = Part()
    box(p, 'orange', (.52, .52, .06), (0, 0, .03), bevel=.025)
    hs = [.06, .24, .36, .5, .6, .74]
    lathe(p, [(.21 - .245 * (h - .06), h) for h in hs] + [(.03, .76), (0, .76)],
          ['orange', 'white', 'orange', 'white', 'orange', 'orange', 'orange'], 14)
    finish(p, 'cone')

def tire_stack():
    p = Part(); rnd = random.Random(3)
    prof = [(.2, .02), (.44, .02), (.49, .08), (.49, .2), (.44, .26), (.2, .26), (.17, .2), (.17, .08)]
    for i, m in enumerate(['rubber', 'tire_red', 'rubber', 'tire_white']):
        lathe(p, prof, [m, m, m, m, m, 'rubber', 'rubber', 'rubber'], 14, (rnd.uniform(-.04, .04), rnd.uniform(-.04, .04), i * .27), (0, 0, rnd.uniform(0, 30)), closed=True)
    finish(p, 'tire_stack')

def barrier():
    """4 m Jersey barrier along X; 1 m painted blocks alternate so segments tile seamlessly."""
    p = Part()
    prof = [(-.36, 0), (.36, 0), (.36, .1), (.2, .32), (.12, 1.0), (-.12, 1.0), (-.2, .32), (-.36, .1)]
    for i in range(4):
        x = -1.5 + i
        extrude(p, prof, .985, 'barrier_red' if i % 2 == 0 else 'white', (x, 0, 0), (0, 0, 90), bevel=.03)
        for ny in (-1, 1): box(p, 'yellow', (.18, .04, .1), (x, ny * .145, .78))
    finish(p, 'barrier')

def arrow_sign():
    """Chevron board; the front (+Z glTF) arrows point to local +X (right of a viewer facing the front).
    The back shows the same arrows, i.e. pointing left, so yaw by pi to flip the turn direction."""
    p = Part()
    for x in (-.95, .95): lathe(p, [(.065, 0), (.065, 2.35), (0, 2.4)], 'dark_metal', 8, (x, .12, 0))
    box(p, 'white', (2.84, .1, 1.5), (0, 0, 1.62), bevel=.05)
    box(p, 'sign_navy', (2.66, .16, 1.32), (0, 0, 1.62), bevel=.04)
    chev = [(-.3, .47), (.02, .47), (.36, 0), (.02, -.47), (-.3, -.47), (.04, 0)]
    for ny in (-1, 1):
        for u in (-.8, 0, .8): extrude(p, chev, .03, 'sign_yellow', (u, ny * .09, 1.62))
    finish(p, 'arrow_sign')

def crowd_stand():
    p = Part(); rnd = random.Random(11); W, T, D, R = 10., 4, .9, .55
    for i in range(T):
        y0, zt = -1.8 + D * i, .5 + R * i
        box(p, 'stand_gray', (W, 1.8 - y0, zt), (0, (y0 + 1.8) / 2, zt / 2))
        box(p, 'stand_blue' if i % 2 == 0 else 'stand_red', (W, .32, .1), (0, y0 + .24, zt + .05))
    for sx in (-1, 1): box(p, 'stand_blue', (.3, 3.9, 2.7), (sx * (W / 2 + .15), -.05, 1.35))
    box(p, 'stand_blue', (W + .6, .3, 4.7), (0, 1.95, 2.35))
    box(p, 'stand_blue', (W, .22, .75), (0, -1.9, .375))
    for k in range(6):
        box(p, 'stand_red' if k % 2 == 0 else 'white', ((W + 1) / 6, 4.4, .14), (-(W + 1) / 2 + (k + .5) * (W + 1) / 6, -.1, 4.75), (-7, 0, 0))
    for x in (-5.2, 0, 5.2): beam(p, 'dark_metal', (x, -2.1, 2.7 if abs(x) > 1 else .75), (x, -2.1, 4.95), .09, n=5)
    shirts = ['shirt_a', 'shirt_b', 'shirt_c', 'shirt_d', 'shirt_e', 'shirt_f']; skins = ['skin_a', 'skin_b', 'skin_c']
    for i in range(T):
        for j in range(8):
            x, y, z = -4.3 + j * 1.23 + rnd.uniform(-.15, .15), -1.8 + D * i + .52, .5 + R * i + .1
            shirt = rnd.choice(shirts)
            box(p, shirt, (.5, .34, .6), (x, y, z + .3))
            box(p, rnd.choice(skins), (.36, .36, .36), (x, y - .02, z + .8), (0, 0, rnd.uniform(-15, 15)))
            r = rnd.random()
            if r < .4:
                for sx in (-1, 1): box(p, shirt, (.14, .14, .5), (x + sx * .3, y, z + .82), (0, sx * 18, 0))
            elif r < .55:
                beam(p, 'dark_metal', (x + .3, y - .1, z + .3), (x + .35, y - .1, z + 1.6), .03)
                extrude(p, [(0, 0), (.6, -.18), (0, -.36)], .02, rnd.choice(['flag_teal', 'flag_coral', 'pennant']), (x + .35, y - .1, z + 1.6))
            if rnd.random() < .08: box(p, rnd.choice(shirts), (.4, .4, .1), (x, y - .02, z + 1.02))
    finish(p, 'crowd_stand')

def balloon_arch():
    p = Part(); cols = ['balloon_red', 'balloon_yellow', 'balloon_green', 'balloon_blue', 'balloon_pink']
    N, A, B = 23, 10.4, 8.8
    for i in range(N):
        t = PI * i / (N - 1)
        x, z = A * math.cos(t), .8 + (B - .8) * math.sin(t)
        sphere(p, cols[i % 5], .78, (x, .34 if i % 2 else -.34, z), 8, 4, (1, 1, 1.12), (0, math.degrees(t) - 90, 0))
    for sx in (-1, 1): box(p, 'dark', (1.3, 1.3, .5), (sx * A, 0, .25), bevel=.12, seg=2)
    finish(p, 'balloon_arch', sharp=60)

def lamp_post():
    p = Part()
    lathe(p, [(.34, 0), (.34, .22), (.22, .32), (.13, .62), (.09, .75), (.075, 4.2), (.12, 4.3), (0, 4.34)], 'lamp_metal', 8)
    box(p, 'lamp_metal', (1.6, .1, .1), (0, 0, 4.12))
    sphere(p, 'gold', .1, (0, 0, 4.44), 8, 4)
    for sx in (-1, 1):
        x = sx * .72
        lathe(p, [(.03, 4.06), (.03, 3.95), (.28, 3.8), (.3, 3.74), (0, 3.74)], 'lamp_metal', 8, (x, 0, 0))
        lathe(p, [(.2, 3.74), (.24, 3.34), (.2, 3.28)], 'lamp_glow', 8, (x, 0, 0), caps=False)
        lathe(p, [(.2, 3.28), (.12, 3.2), (0, 3.16)], 'lamp_metal', 8, (x, 0, 0))
    finish(p, 'lamp_post')

def flag_pole():
    p = Part()
    lathe(p, [(.36, 0), (.36, .3), (.28, .36), (.08, .4), (.065, 8.0), (0, 8.02)], 'white', 10)
    sphere(p, 'gold', .14, (0, 0, 8.14), 10, 5)
    root = finish(p, 'flag_pole')
    f = Part(); C, W, H = 8, 2.6, 1.6
    wave = lambda x: .2 * math.sin(x * 2.3) * (x / W)
    for r, m in enumerate(['flag_teal', 'flag_white', 'flag_coral']):
        for c in range(C):
            x0, x1 = W * c / C, W * (c + 1) / C
            z0, z1 = -H * r / 3, -H * (r + 1) / 3
            f.face([f.v((x0, wave(x0), z1)), f.v((x1, wave(x1), z1)), f.v((x1, wave(x1), z0)), f.v((x0, wave(x0), z0))], m)
    finish(f, 'flag_pole_flag', root, (.07, 0, 7.9), sharp=80)

# ---------------------------------------------------------------- items
def peel():
    p = Part()
    lathe(p, [(0, 0), (.17, .03), (.2, .16), (.17, .34), (.1, .46), (0, .5)], ['peel_inner'] + ['peel_yellow'] * 4, 10)
    lens = ring_profile(8, .5, .15)
    for k in range(4):
        a = TAU * k / 4 + .35
        d, up = V((math.cos(a), math.sin(a), 0)), V((0, 0, 1))
        path = [d * .08 + up * .42, d * .28 + up * .36, d * .48 + up * .2, d * .64 + up * .06, d * .8 + up * .04, d * .93 + up * .12]
        sweep(p, path, lens, 'peel_yellow', radii=[.42, .6, .64, .58, .42, .1],
              matf=lambda i, j: 'peel_tip' if i >= 4 else 'peel_inner' if j < 4 else 'peel_yellow')
    sweep(p, [(0, 0, .46), (0, 0, .6), (.05, 0, .7), (.13, 0, .74)], ring_profile(6, .05), 'peel_tip', radii=[1.2, 1, .9, .8])
    finish(p, 'peel')

def shell_base(p, dome_sector, red):
    lathe(p, [(0, .64), (.2, .62), (.35, .54), (.45, .4), (.5, .24)], dome_sector[0], 12, sector=dome_sector, caps=False)
    lathe(p, [(.46, .13), (.55, .14), (.58, .2), (.55, .27), (.46, .28)], 'white', 16, closed=True)
    lathe(p, [(0, .03), (.42, .03), (.5, .16)], 'shell_cream', 12, caps=False)
    sphere(p, 'white' if not red else 'shell_red_dark', .09, (0, 0, .64), 8, 4)

def bouncer_shell():
    p = Part(); shell_base(p, ['shell_green', 'shell_green_dark'], False)
    finish(p, 'bouncer_shell')

def seeker_shell():
    p = Part(); shell_base(p, ['shell_red'], True)
    for sx in (-1, 1):
        for poly, m in (([(.44, .02), (.44, -.34), (.68, -.46), (.68, -.232)], 'white'), ([(.68, -.232), (.68, -.46), (.8, -.52), (.84, -.4)], 'shell_red_dark')):
            extrude(p, [(sx * u, v) for u, v in poly], .07, m, (0, 0, .21), (90, 0, 0), bevel=.015)
    extrude(p, [(.02, .62), (.38, .5), (.66, .84), (.5, .88)], .07, 'white', (0, 0, 0), (0, 0, 90), bevel=.02)
    lathe(p, [(0, 0), (.13, 0), (.13, .05), (0, .08)], 'seeker_eye', 12, (0, -.46, .36), (90, 0, 0))
    finish(p, 'seeker_shell')

def bomb():
    p = Part()
    sphere(p, 'bomb_body', .52, (0, 0, .54), 16, 8)
    lathe(p, [(.51, .46), (.555, .48), (.555, .6), (.51, .62)], 'bomb_band', 16, closed=True)
    lathe(p, [(.15, .96), (.19, .99), (.19, 1.08), (.16, 1.12), (0, 1.12)], 'metal', 10)
    sweep(p, [(0, 0, 1.08), (0, 0, 1.24), (.06, 0, 1.36), (.16, 0, 1.42), (.25, 0, 1.4)], ring_profile(6, .036), 'fuse')
    root = finish(p, 'bomb')
    q = Part(); c = V((0, 0, 0))
    sphere(q, 'spark', .07, c, 6, 3)
    for k in range(10):
        a, b = TAU * k / 10, (.5 if k % 2 else -.4)
        d = V((math.cos(a) * math.cos(b), math.sin(a) * math.cos(b), math.sin(b)))
        with q.at(m=aim(c, c + d)): lathe(q, [(.05, 0), (0, .2)], 'spark', 4)
    finish(q, 'bomb_fuse', root, (.28, 0, 1.4))

def comet():
    """Spiky glowing missile flying nose-first toward local +Z (glTF), flame tail behind. Core centre 1 m up, lowest spike on the ground."""
    p = Part(); c = V((0, 0, 1.0)); R = .6; f = V((0, -1, 0))
    sphere(p, 'comet_core', R, c, 14, 7, scale=(1, 1.12, 1))
    for th, n, L, ph in ((0, 1, .75, 0), (38, 6, .6, 0), (82, 8, .78, .4), (128, 6, .62, .1)):
        for k in range(n):
            a = TAU * k / n + ph; rad = V((math.cos(a), 0, math.sin(a)))
            d = (f * math.cos(math.radians(th)) + rad * math.sin(math.radians(th))).normalized()
            if d.z < 0: L2 = min(L, c.z / -d.z - R)
            else: L2 = L
            with p.at(m=aim(c + d * R * .75, c + d * (R + L2))): lathe(p, [(.17, 0), (0, R * .25 + L2)], 'comet_spike', 5)
    path = [c + V((0, R * .4 + 3.4 * t, .35 * t * t)) for t in (0, .15, .35, .55, .78, 1)]
    sweep(p, path, ring_profile(12, .66, star=.3), 'comet_tail', radii=[1, 1.02, .82, .56, .3, 0],
          matf=lambda i, j: 'comet_spike' if i == 0 else 'comet_tail' if i < 3 else 'comet_tail2')
    for sx in (-1, 1):
        path = [c + V((sx * (.42 + .2 * t), R * .3 + 2.6 * t, .12 + .5 * t * t)) for t in (0, .3, .6, 1)]
        sweep(p, path, ring_profile(6, .22), 'comet_tail2', radii=[1, .8, .45, 0])
    finish(p, 'comet')

def drone():
    """Rescue quadcopter. Origin at the hook tip (the point that grabs a kart); rotors spin about local Y."""
    p = Part()
    hook = [(0, 0, .6), (0, 0, .22)] + [(-.12 + .12 * math.cos(math.radians(a)), 0, .2 + .15 * math.sin(math.radians(a))) for a in (-20, -70, -120, -165)] + [(-.24, 0, .3)]
    sweep(p, hook, ring_profile(6, .035), 'metal')
    lathe(p, [(.022, .58), (.022, 1.48)], 'dark', 5)
    box(p, 'drone_yellow', (.92, .92, .36), (0, 0, 1.64), bevel=.13, seg=2)
    box(p, 'white', (.7, .7, .12), (0, 0, 1.86), bevel=.05)
    for s in ((.44, .12), (.12, .44)): box(p, 'red', (*s, .04), (0, 0, 1.93))
    sphere(p, 'glass_dark', .11, (0, -.47, 1.62), 8, 4)
    lathe(p, [(0, 1.44), (.16, 1.44), (.16, 1.47), (0, 1.47)], 'drone_light', 10)
    for sx in (-1, 1):
        for sy in (-1, 1):
            e = V((sx * .64, sy * .64, 1.74))
            beam(p, 'dark', (0, 0, 1.7), e, .1)
            lathe(p, [(.09, 1.64), (.09, 1.82), (0, 1.84)], 'dark', 8, (e.x, e.y, 0))
            lathe(p, [(.4, 1.72), (.46, 1.72), (.46, 1.8), (.4, 1.8)], 'white', 14, (e.x, e.y, 0), closed=True)
            beam(p, 'white', e + V((-sx * .2, -sy * .2, -.05)), e + V((sx * .28, sy * .28, -.05)), .04)
            if sy < 0: sphere(p, 'beacon_red' if sx > 0 else 'beacon_green', .06, (e.x, e.y - .1, 1.66), 6, 3)
    root = finish(p, 'drone')
    for nm, sx, sy in (('fl', 1, -1), ('fr', -1, -1), ('rl', 1, 1), ('rr', -1, 1)):
        r = Part()
        for a in (0, 90): box(r, 'dark', (.76, .07, .02), (0, 0, 0), (0, 8, a + 20))
        sphere(r, 'drone_yellow', .045, (0, 0, .01), 6, 3)
        finish(r, 'drone_rotor_' + nm, root, (sx * .64, sy * .64, 1.86))

# ---------------------------------------------------------------- beach
def palm(p, h, lean, fronds, seed, L=3.2):
    rnd = random.Random(seed); S = 10
    top = V((lean[0], lean[1], h)); ctrl = V((0, 0, h * .55))
    pts = [(1 - t) ** 2 * V((0, 0, -.2)) + 2 * (1 - t) * t * ctrl + t * t * top for t in [i / S for i in range(S + 1)]]
    for i in range(S):
        r = .36 - .13 * i / S
        with p.at(m=aim(pts[i], pts[i + 1])):
            lathe(p, [(r, 0), (r * 1.24, (pts[i + 1] - pts[i]).length * 1.08)], 'palm_trunk' if i % 2 else 'palm_trunk_dark', 7, caps=False)
    sphere(p, 'palm_trunk_dark', .34, top, 8, 4)
    for k in range(3):
        a = TAU * k / 3 + seed
        sphere(p, 'coconut', .17, top + V((math.cos(a) * .26, math.sin(a) * .26, -.28)), 6, 4)
    for k in range(fronds):
        a = TAU * k / fronds + rnd.uniform(-.2, .2); lift = rnd.uniform(-.4, .5); LL = L * rnd.uniform(.85, 1.1)
        d, side = V((math.cos(a), math.sin(a), 0)), V((-math.sin(a), math.cos(a), 0))
        spine, left, right = [], [], []
        for i in range(8):
            s = i / 7
            c = top + d * LL * s + V((0, 0, (1.1 + lift) * s - 2.2 * s * s + .1))
            w = .62 * math.sin(PI * min(1, s * 1.05 + .06)) * (1 if i % 2 == 0 else .72)
            spine.append(p.v(c)); left.append(p.v(c + side * w - V((0, 0, w * .45)))); right.append(p.v(c - side * w - V((0, 0, w * .45))))
        m = 'palm_leaf' if k % 2 else 'palm_leaf_dark'
        for i in range(7):
            p.face((left[i], left[i + 1], spine[i + 1], spine[i]), m)
            p.face((spine[i], spine[i + 1], right[i + 1], right[i]), m)

def palm_a():
    p = Part(); palm(p, 7.2, (1.1, .4), 8, 1); finish(p, 'palm_a')

def palm_b():
    p = Part(); palm(p, 5.6, (-1.5, .3), 7, 2, 2.8)
    with p.at((.8, .5, 0), (0, 0, 40)): palm(p, 4.0, (1.2, -.2), 6, 3, 2.4)
    finish(p, 'palm_b')

def umbrella():
    p = Part()
    with p.at((0, 0, 0), (6, 0, 0)):
        lathe(p, [(.045, -.2), (.04, 2.5)], 'white', 6)
        lathe(p, [(0, 2.6), (1.4, 2.18), (1.42, 2.1), (0, 2.42)], 'coral', 12, sector=['coral', 'white'])
        sphere(p, 'coral', .07, (0, 0, 2.64), 6, 3)
    for k, m in enumerate(['teal', 'white', 'teal', 'yellow']):
        box(p, m, (.24, 1.8, .02), (.85 + k * .24, .4, .01))
    finish(p, 'umbrella')

def beach_hut():
    p = Part(); Wd, Dp, H = 2.6, 2.4, 2.4
    box(p, 'wood', (3.4, 3.4, .3), (0, 0, .15), bevel=.04)
    box(p, 'wood', (1.1, .5, .15), (0, -1.95, .075), bevel=.03)
    for i in range(8):
        box(p, 'hut_mint' if i % 2 == 0 else 'white', (Wd / 8, .1, H), (-Wd / 2 + (i + .5) * Wd / 8, -Dp / 2, .3 + H / 2))
    for sx in (-1, 1):
        for i in range(7):
            box(p, 'hut_mint' if i % 2 == 0 else 'white', (.1, Dp / 7, H), (sx * Wd / 2, -Dp / 2 + (i + .5) * Dp / 7, .3 + H / 2))
    box(p, 'hut_mint', (Wd, .1, H), (0, Dp / 2, .3 + H / 2))
    for ny in (-1, 1): extrude(p, [(-1.35, 0), (1.35, 0), (0, 1.2)], .1, 'white', (0, ny * Dp / 2, .3 + H))
    ang = math.degrees(math.atan2(1.2, 1.35))
    for sx in (-1, 1):
        box(p, 'coral', (2.15, 3.0, .14), (sx * .68, 0, .3 + H + .6 + .1), (0, sx * ang, 0), bevel=.04)
    box(p, 'white', (.2, 3.05, .2), (0, 0, .3 + H + 1.25), bevel=.05)
    box(p, 'hut_door', (.9, .08, 1.75), (0, -Dp / 2 - .06, 1.2), bevel=.03)
    lathe(p, [(0, 0), (.2, 0), (.2, .06), (0, .06)], 'glass_dark', 10, (0, -Dp / 2 - .08, 1.65), (90, 0, 0))
    sphere(p, 'yellow', 1.0, (1.62, -.5, 1.05), 10, 5, (.26, .05, .95), (0, 12, 90))
    finish(p, 'beach_hut')

def lifeguard_tower():
    p = Part(); Z = 2.6
    for sx in (-1, 1):
        for sy in (-1, 1): beam(p, 'white', (sx * 1.1, sy * 1.1, -.2), (sx * .95, sy * .95, Z), .18)
    for (a, b) in (((-1, -1), (1, -1)), ((-1, 1), (1, 1)), ((-1, -1), (-1, 1)), ((1, -1), (1, 1))):
        beam(p, 'wood', (a[0] * 1.05, a[1] * 1.05, .3), (b[0] * 1.0, b[1] * 1.0, 2.3), .08)
        beam(p, 'wood', (b[0] * 1.05, b[1] * 1.05, .3), (a[0] * 1.0, a[1] * 1.0, 2.3), .08)
    box(p, 'wood', (2.7, 2.7, .18), (0, 0, Z + .09), bevel=.03)
    box(p, 'lifeguard_red', (2.0, 1.7, 1.5), (0, .25, Z + .93), bevel=.06)
    box(p, 'glass_dark', (1.5, .06, .6), (0, -.62, Z + 1.18))
    for sx in (-1, 1): box(p, 'glass_dark', (.06, 1.0, .6), (sx * 1.01, .25, Z + 1.18))
    lathe(p, [(1.72, Z + 1.66), (1.72, Z + 1.76), (0, Z + 2.4)], 'white', 4, rot=(0, 0, 45))
    for x in (-1.25, 0, 1.25): beam(p, 'white', (x, -1.25, Z + .15), (x, -1.25, Z + 1.0), .07)
    for sx in (-1, 1): beam(p, 'white', (sx * 1.25, -1.25, Z + .15), (sx * 1.25, .4, Z + 1.0), .07)
    beam(p, 'white', (-1.3, -1.25, Z + 1.0), (1.3, -1.25, Z + 1.0), .08)
    for sx in (-1, 1): beam(p, 'white', (sx * 1.25, -1.3, Z + 1.0), (sx * 1.25, 1.1, Z + 1.0), .08)
    lathe(p, [(.28, -.05), (.4, -.05), (.44, 0), (.4, .05), (.28, .05)], 'lifeguard_red', 16, (.6, -1.34, Z + .6), (90, 0, 0),
          sector=['lifeguard_red'] * 2 + ['white'] * 2, closed=True)
    box(p, 'wood', (1.0, 3.5, .12), (0, 2.4, Z / 2), (-math.degrees(math.atan2(Z, 2.4)) + 180 - 180, 0, 0))
    beam(p, 'white', (.8, .6, Z + 2.2), (.8, .6, Z + 3.4), .04, n=6)
    extrude(p, [(0, 0), (.8, -.22), (0, -.44)], .02, 'pennant', (.8, .6, Z + 3.4))
    finish(p, 'lifeguard_tower')

def rock_beach():
    p = Part(); f = lambda face: 'rock_sand_dark' if face.normal.z < .25 else 'rock_sand'
    rock(p, 'rock_sand', (0, 0, .42), (1.5, 1.2, 1.0), 5, 1, matf=f)
    rock(p, 'rock_sand', (1.4, .5, .25), (.8, .7, .6), 6, 1, matf=f)
    rock(p, 'rock_sand', (-1.1, .7, .3), (.6, .55, .5), 7, 1, matf=f)
    rock(p, 'rock_sand', (.4, -1.1, .18), (.35, .3, .3), 8, 1, matf=f)
    finish(p, 'rock_beach', sharp=28)

def boat():
    p = Part()
    st = [(-2.1, .04, .55, 1.08), (-1.75, .42, .26, .98), (-1.05, .7, .08, .88), (0, .78, 0, .84), (1.0, .74, .05, .86), (1.7, .64, .14, .9), (1.98, .6, .2, .92)]
    def sec(y, w, zb, zt, k=1., lift=0.):
        w *= k; zb += lift; d = zt - zb
        return [(-w, y, zt), (-w * .96, y, zb + d * .55), (-w * .72, y, zb + d * .15), (0, y, zb), (w * .72, y, zb + d * .15), (w * .96, y, zb + d * .55), (w, y, zt)]
    with p.at((0, 0, 0), (0, 5, 0)):
        outer = [[p.v(c) for c in sec(*s)] for s in st]
        inner = [[p.v(c) for c in sec(*s, k=.86, lift=.1)] for s in st]
        faces = []
        for i in range(len(st) - 1):
            for j in range(6):
                faces.append(p.face((outer[i][j], outer[i + 1][j], outer[i + 1][j + 1], outer[i][j + 1]), 'boat_blue' if j in (0, 5) else 'white'))
                faces.append(p.face((inner[i][j + 1], inner[i + 1][j + 1], inner[i + 1][j], inner[i][j]), 'wood'))
            for j in (0, 6): faces.append(p.face((outer[i][j], inner[i][j], inner[i + 1][j], outer[i + 1][j]), 'wood_dark'))
        for i in (0, len(st) - 1):
            for j in range(6): faces.append(p.face((outer[i][j], outer[i][j + 1], inner[i][j + 1], inner[i][j]), 'boat_blue'))
        fix(p, faces)
        for y in (-.7, .7): box(p, 'wood', (1.3, .32, .06), (0, y, .6))
        beam(p, 'wood_dark', (-.5, -1.4, .66), (.4, 1.5, .68), .05, n=5)
        box(p, 'wood_dark', (.18, .6, .03), (.45, 1.65, .68), (0, 0, 17))
    finish(p, 'boat')

# ---------------------------------------------------------------- desert
def cactus_arm(p, start, dirv, out, up, r):
    d = V(dirv).normalized(); s = V(start)
    path = [s, s + d * out * .6 + V((0, 0, .12)), s + d * out + V((0, 0, .45)), s + d * out + V((0, 0, up * .5)),
            s + d * out + V((0, 0, up * .85)), s + d * out + V((0, 0, up + .15)), s + d * out + V((0, 0, up + .3))]
    sweep(p, path, ring_profile(16, r, star=.16), 'cactus', radii=[1, 1, 1, .98, .92, .6, 0])

def cactus_a():
    p = Part(); prof = ring_profile(16, .5, star=.16)
    zs = [-.2, 1, 2, 3, 4, 4.6, 4.95, 5.15]
    sweep(p, [(0, 0, z) for z in zs], prof, 'cactus', radii=[1, 1, .98, .95, .9, .8, .56, 0])
    cactus_arm(p, (.25, 0, 1.7), (1, .15, 0), 1.0, 2.0, .31)
    cactus_arm(p, (-.25, 0, 2.5), (-1, .35, 0), .85, 1.6, .27)
    for k in range(3): sphere(p, 'cactus_flower', .11, (math.cos(k * 2.1) * .16, math.sin(k * 2.1) * .16, 5.05), 6, 3, (1, 1, .6))
    finish(p, 'cactus_a', sharp=62)

def cactus_b():
    p = Part()
    pads = [((0, 0, .62), (0, 0, 0)), ((.62, .35, .55), (0, 22, 60)), ((-.4, .05, 1.55), (0, -24, 0)), ((.4, -.05, 1.5), (0, 30, 30)),
            ((-.85, .1, 2.3), (0, -44, 0)), ((.15, 0, 2.45), (0, 6, 70)), ((.95, -.1, 2.25), (0, 50, 10))]
    for loc, rot in pads: sphere(p, 'cactus_light', 1.0, loc, 10, 5, (.55, .13, .66), rot)
    for loc in ((-1.15, .1, 2.85), (-.75, .1, 2.95), (.15, 0, 3.1), (1.3, -.1, 2.72), (.55, -.05, 1.95), (-.2, .05, 2.08)):
        sphere(p, 'fruit', .11, loc, 6, 3, (1, 1, 1.3))
    finish(p, 'cactus_b', sharp=60)

STRATA = ['rock_red', 'rock_orange', 'rock_red', 'rock_cream']
def strata(scale=1.1, phase=0.):
    return lambda f: STRATA[int((f.calc_center_median().z + phase) / scale) % 4]
def cuts(scale, top, phase=0.): return [k * scale - phase for k in range(1, int(top / scale) + 2)]

def rock_red_a():
    p = Part(); f = strata(.9); c = cuts(.9, 6)
    rock(p, 'rock_red', (0, 0, .62), (2.6, 2.2, 1.6), 21, 1, .16, matf=f, cuts=c)
    rock(p, 'rock_red', (.15, .05, 2.9), (1.55, 1.35, 1.6), 22, 1, .14, matf=f, cuts=c)
    rock(p, 'rock_red', (0, 0, 4.5), (1.0, .95, 1.1), 23, 1, .12, matf=f, cuts=c)
    rock(p, 'rock_red', (.05, 0, 5.45), (.72, .72, .6), 24, 1, .1, matf=f, cuts=c)
    rock(p, 'rock_top', (.25, .05, 6.2), (1.9, 1.6, .62), 25, 1, .12, rot=(0, 0, 20), flat=2)
    finish(p, 'rock_red_a', sharp=28)

def rock_red_b():
    p = Part(); f = strata(.7, .3); c = cuts(.7, 3, .3)
    rock(p, 'rock_red', (0, 0, .8), (3.3, 2.5, 1.8), 31, 1, .18, matf=f, cuts=c)
    rock(p, 'rock_red', (2.9, 1.0, .5), (1.4, 1.2, 1.0), 32, 1, matf=f, cuts=c)
    rock(p, 'rock_red', (-2.6, -.9, .35), (1.0, .9, .7), 33, 1, matf=f, cuts=c)
    finish(p, 'rock_red_b', sharp=28)

def mesa():
    """~40 x 28 m butte with stepped strata."""
    p = Part(); rnd = random.Random(41); n = 30
    base = [20 * (1 + .14 * math.sin(3 * TAU * k / n + 1) + .07 * math.sin(7 * TAU * k / n) + rnd.uniform(-.05, .05)) for k in range(n)]
    lv = [(-1.5, 1.1), (5.0, 1.0), (5.7, .92), (10.4, .89), (11.2, .82), (16.2, .8), (17.0, .74), (17.5, .7)]
    mats = ['rock_red', 'rock_cream', 'rock_orange', 'rock_cream', 'rock_red', 'rock_orange', 'rock_top']
    rings = []
    for z, s in lv:
        rings.append([p.v((base[k] * s * (1 + rnd.uniform(-.03, .03)) * math.cos(TAU * k / n), .7 * base[k] * s * (1 + rnd.uniform(-.03, .03)) * math.sin(TAU * k / n), z)) for k in range(n)])
    faces = []
    for i in range(len(rings) - 1):
        for k in range(n):
            faces.append(p.face((rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]), mats[i]))
    faces.append(p.face(list(reversed(rings[-1])), 'rock_top'))
    fix(p, faces)
    for k, (a, s) in enumerate(((.4, 3.2), (2.2, 2.4), (4.1, 2.8), (5.3, 1.8))):
        rock(p, 'rock_red', (22 * math.cos(a), 15.5 * math.sin(a), s * .4), (s, s * .85, s * .7), 42 + k, 0, matf=strata(.9), cuts=cuts(.9, 3))
    finish(p, 'mesa', sharp=35)

def water_tower():
    p = Part(); Z = 6.0
    for sx in (-1, 1):
        for sy in (-1, 1): beam(p, 'wood_dark', (sx * 1.6, sy * 1.6, -.2), (sx * 1.15, sy * 1.15, Z), .24)
    for z0, z1 in ((.4, 3.0), (3.0, 5.6)):
        for sx, sy, tx, ty in ((-1, -1, 1, -1), (1, -1, 1, 1), (1, 1, -1, 1), (-1, 1, -1, -1)):
            k0, k1 = 1.6 - .45 * z0 / Z, 1.6 - .45 * z1 / Z
            beam(p, 'wood', (sx * k0, sy * k0, z0), (tx * k1, ty * k1, z1), .1)
            beam(p, 'wood', (tx * k0, ty * k0, z0), (sx * k1, sy * k1, z1), .1)
    lathe(p, [(2.1, Z), (2.1, Z + .2)], 'wood_dark', 12)
    staves = ['wood', 'wood_light']
    lathe(p, [(1.85, Z + .2), (1.9, Z + 1.4), (1.85, Z + 2.8)], 'wood', 16, sector=staves)
    for z in (Z + .55, Z + 1.4, Z + 2.25): lathe(p, [(1.88, z - .06), (1.97, z - .06), (1.97, z + .06), (1.88, z + .06)], 'dark_metal', 16, closed=True)
    lathe(p, [(2.1, Z + 2.8), (2.1, Z + 2.9), (0, Z + 4.1)], 'roof_rust', 16)
    sphere(p, 'dark_metal', .12, (0, 0, Z + 4.12), 6, 3)
    for x in (-.25, .25): beam(p, 'dark_metal', (x, -2.12, 0), (x, -1.95, Z + 2.8), .05)
    for k in range(1, 22): beam(p, 'dark_metal', (-.25, -2.12 + .17 * k / 22, k * (Z + 2.8) / 22), (.25, -2.12 + .17 * k / 22, k * (Z + 2.8) / 22), .035)
    sweep(p, [(1.0, -1.4, Z + .3), (1.4, -2.0, Z - .1), (1.6, -2.4, Z - .8)], ring_profile(6, .1), 'dark_metal')
    finish(p, 'water_tower')

def windmill():
    """Farm windmill; child windmill_rotor faces +Z (glTF) and spins about its local Z (glTF) / -Y (Blender)."""
    p = Part(); H = 9.0
    k = lambda z: 1.25 - 1.0 * z / H
    for sx in (-1, 1):
        for sy in (-1, 1): beam(p, 'dark_metal', (sx * 1.3, sy * 1.3, -.2), (sx * .25, sy * .25, H), .13)
    for z in (1.0, 3.8, 6.4):
        c = [(sx * k(z), sy * k(z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for i in range(4): beam(p, 'metal', (*c[i], z), (*c[(i + 1) % 4], z), .05)
    for z0, z1 in ((1.0, 3.8), (3.8, 6.4)):
        for sx, sy, tx, ty in ((-1, -1, 1, -1), (1, -1, 1, 1), (1, 1, -1, 1), (-1, 1, -1, -1)):
            beam(p, 'metal', (sx * k(z0), sy * k(z0), z0), (tx * k(z1), ty * k(z1), z1), .035)
    box(p, 'dark_metal', (.8, .8, .2), (0, 0, H + .05), bevel=.03)
    box(p, 'windmill_red', (.42, .9, .42), (0, -.1, H + .4), bevel=.08)
    beam(p, 'dark_metal', (0, .3, H + .45), (0, 2.6, H + .5), .06)
    extrude(p, [(0, -.45), (1.5, -.7), (1.6, .8), (0, .45)], .04, 'windmill_red', (0, 2.2, H + .55), (0, 0, 90), bevel=.01)
    root = finish(p, 'windmill')
    r = Part()
    lathe(r, [(0, 0), (.22, 0), (.25, .22), (0, .38)], 'windmill_red', 10, rot=(90, 0, 0))
    lathe(r, [(1.78, -.03), (1.84, -.03), (1.84, .03), (1.78, .03)], 'dark_metal', 18, rot=(90, 0, 0), closed=True)
    for i in range(12):
        a = 360 * i / 12
        with r.at(rot=(0, a, 0)): box(r, 'windmill_red' if i % 3 == 0 else 'windmill_blade', (.46, .03, 1.5), (.08, 0, 1.1), (0, 18, 0))
    finish(r, 'windmill_rotor', root, (0, -.62, H + .4))

# ---------------------------------------------------------------- city
WIN = [('win_warm', .5), ('win_cyan', .72), ('win_dim', 1.0)]
def windows(p, rnd, w, d, z0, z1, floors, cols, dcols=None, shop=False):
    fh = (z1 - z0) / floors
    for n, fw, off, nc in (((0, -1, 0), w, d / 2, cols), ((0, 1, 0), w, d / 2, cols), ((1, 0, 0), d, w / 2, dcols or cols), ((-1, 0, 0), d, w / 2, dcols or cols)):
        n = V(n); t = V((0, 0, 1)).cross(n)
        for f in range(floors):
            for c in range(nc):
                r = rnd.random(); m = next(mm for mm, th in WIN if r < th)
                ctr = n * (off + .03) + t * (-fw / 2 + (c + .5) * fw / nc) + V((0, 0, z0 + (f + .52) * fh))
                quad(p, m, ctr, n, fw / nc * .3, fh * .3)
        if shop: quad(p, 'win_shop', n * (off + .03) + V((0, 0, 1.6)), n, fw * .4, 1.1)

def building_a():
    p = Part(); rnd = random.Random(51); W, D, H = 12, 12, 22
    box(p, 'facade_navy', (W, D, H + .5), (0, 0, H / 2 - .25), bevel=.15)
    box(p, 'trim', (W + .4, D + .4, .5), (0, 0, 3.5))
    box(p, 'trim', (W + .3, D + .3, .8), (0, 0, H + .2), bevel=.08)
    windows(p, rnd, W, D, 4.0, H - .4, 6, 4, shop=True)
    box(p, 'dark', (W + .2, 1.2, .2), (0, -D / 2 - .5, 3.1), (8, 0, 0))
    box(p, 'trim', (2.2, 1.6, 1.2), (-2.5, 2, H + 1.2), bevel=.08)
    box(p, 'trim', (1.6, 1.6, 1.0), (2.8, -1.5, H + 1.1), bevel=.08)
    lathe(p, [(1.1, H + .6), (1.1, H + 3.0), (0, H + 3.6)], 'wood_dark', 10, (2.4, 2.8, 0))
    box(p, 'neon_pink', (.3, 1.5, 7.0), (W / 2 - 1.0, -D / 2 - .85, 12.5))
    box(p, 'sign_dark', (.36, 1.2, 6.6), (W / 2 - 1.0, -D / 2 - .85, 12.5))
    for k in range(4):
        for sx in (-1, 1): box(p, 'neon_yellow', (.04, .7, .7), (W / 2 - 1.0 + sx * .19, -D / 2 - .85, 10.2 + k * 1.55))
    for sx in (-1, 1):
        for sy in (-1, 1): beam(p, 'dark_metal', (2.4 + sx * .8, 2.8 + sy * .8, H + .5), (2.4 + sx * .8, 2.8 + sy * .8, H + 1.2), .1)
    finish(p, 'building_a')

def building_b():
    p = Part(); rnd = random.Random(52)
    box(p, 'facade_plum', (12, 12, 26.5), (0, 0, 13 - .25), bevel=.15)
    windows(p, rnd, 12, 12, 3.8, 25.5, 7, 4, shop=True)
    for sy, sx, L, rot in ((-1, 0, 12.3, 0), (1, 0, 12.3, 0), (0, -1, 12.3, 90), (0, 1, 12.3, 90)):
        box(p, 'neon_pink', (L, .12, .22), (sx * 6.08, sy * 6.08, 26.1), (0, 0, rot))
    box(p, 'trim', (12.4, 12.4, .5), (0, 0, 26.3))
    box(p, 'facade_plum', (8.5, 8.5, 13), (0, 0, 33), bevel=.12)
    windows(p, rnd, 8.5, 8.5, 27.2, 38.8, 4, 3)
    box(p, 'trim', (8.9, 8.9, .6), (0, 0, 39.7), bevel=.08)
    for sx in (-1, 1):
        for sy in (-1, 1): box(p, 'neon_cyan', (.16, .16, 12.4), (sx * 4.3, sy * 4.3, 33))
    box(p, 'dark_metal', (3, 3, 1.4), (0, 0, 40.5), bevel=.1)
    beam(p, 'dark_metal', (1, 1, 41), (1, 1, 45), .08, n=5)
    sphere(p, 'beacon_red', .18, (1, 1, 45.1), 6, 3)
    finish(p, 'building_b')

def building_c():
    p = Part(); rnd = random.Random(53); H = 52
    box(p, 'facade_steel', (10, 10, H + .5), (0, 0, H / 2 - .25), bevel=.2)
    for sx in (-1, 1):
        for sy in (-1, 1): box(p, 'trim', (.5, .5, H), (sx * 4.9, sy * 4.9, H / 2))
    windows(p, rnd, 10, 10, 4.2, H - .6, 14, 3, shop=True)
    box(p, 'trim', (10.6, 10.6, .6), (0, 0, H + .3))
    box(p, 'facade_steel', (7.5, 7.5, 2.4), (0, 0, H + 1.8), bevel=.1)
    for n in ((0, -1, 0), (0, 1, 0), (1, 0, 0), (-1, 0, 0)):
        quad(p, 'neon_cyan', V(n) * 3.79 + V((0, 0, H + 1.9)), n, 3.4, .25)
    lathe(p, [(1.2, H + 3.0), (.9, H + 4.2), (.14, H + 5.0), (.05, H + 9.0), (0, H + 9.1)], 'metal', 8)
    sphere(p, 'beacon_red', .2, (0, 0, H + 9.1), 6, 3)
    finish(p, 'building_c')

def street_light():
    """Arm reaches toward the front (+Z glTF) so it overhangs the road when the post faces the track."""
    p = Part()
    lathe(p, [(.22, -.3), (.22, .45), (.13, .6), (.11, 1.0), (.075, 7.6), (0, 7.7)], 'dark_metal', 8)
    sweep(p, [(0, 0, 7.1), (0, -.35, 7.7), (0, -1.1, 8.0), (0, -2.4, 8.08)], ring_profile(6, .085), 'dark_metal')
    box(p, 'dark_metal', (.68, 1.5, .28), (0, -2.85, 8.06), bevel=.08)
    box(p, 'street_glow', (.54, 1.3, .06), (0, -2.85, 7.9), bevel=.02)
    finish(p, 'street_light')

def neon_sign():
    p = Part(); zc = 5.6
    for x in (-1.6, 1.6): lathe(p, [(.13, -.2), (.11, 4.3)], 'dark_metal', 8, (x, 0, 0))
    box(p, 'sign_dark', (5.2, .36, 2.8), (0, 0, zc), bevel=.08)
    tube = ring_profile(5, .06)
    def rrect(w, h, r, y):
        pts = []
        for cx, cz, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
            pts += [(cx + r * math.cos(math.radians(a0 + 30 * i)), y, zc + cz + r * math.sin(math.radians(a0 + 30 * i))) for i in range(4)]
        return pts
    for y in (-.23, .23): sweep(p, rrect(4.8, 2.4, .3, y), tube, 'neon_pink', closed=True)
    y = -.23; R = .5; cz = zc + .2
    g = [(-.8 + R * math.cos(math.radians(a)), y, cz + R * math.sin(math.radians(a))) for a in range(40, 330, 32)]
    sweep(p, g + [(-.8 + R * .95, y, cz - R * .25), (-.8 + R * .95, y, cz - .02), (-.8 + .12, y, cz - .02)], tube, 'neon_yellow')
    sweep(p, [(.55 + R * math.cos(TAU * k / 14), y, cz + R * math.sin(TAU * k / 14)) for k in range(14)], tube, 'neon_yellow', closed=True)
    sweep(p, [(-1.7, y, zc - .75), (1.45, y, zc - .75)], tube, 'neon_cyan')
    sweep(p, [(1.15, y, zc - .5), (1.55, y, zc - .75), (1.15, y, zc - 1.0)], tube, 'neon_cyan')
    finish(p, 'neon_sign')

def billboard():
    p = Part(); zc, W, H = 8.2, 10, 4.5
    for x in (-3, 3): beam(p, 'dark_metal', (x, .2, -.3), (x, .2, zc - H / 2), .34)
    beam(p, 'dark_metal', (-3, .2, 1.5), (3, .2, 4.8), .12); beam(p, 'dark_metal', (3, .2, 1.5), (-3, .2, 4.8), .12)
    box(p, 'dark_metal', (W + .4, .4, H + .4), (0, 0, zc), bevel=.1)
    y = -.215
    for i, m in enumerate(['ad_orange', 'ad_pink', 'ad_purple']):
        quad(p, m, (0, y, zc - H / 2 + (i + .5) * H / 3), (0, -1, 0), W / 2, H / 6)
    lathe(p, [(0, 0), (1.15, 0), (1.15, .02), (0, .02)], 'ad_yellow', 16, (2.6, y - .01, zc + .2), (90, 0, 0))
    for poly in ([(-5, -2.25), (-1.5, .6), (1.2, -2.25)], [(-.5, -2.25), (2.6, -.2), (5, -1.3), (5, -2.25)]):
        extrude(p, poly, .02, 'ad_dark', (0, y - .03, zc))
    for i in range(3): extrude(p, [(0, 0), (1.9, 0), (1.4, .38), (-.5, .38)], .02, 'ad_white', (-4.3 + i * .35, y - .05, zc + .7 + i * .55))
    box(p, 'dark_metal', (W, .9, .08), (0, -.6, zc - H / 2 - .2))
    beam(p, 'dark_metal', (-W / 2, -1.02, zc - H / 2 + .4), (W / 2, -1.02, zc - H / 2 + .4), .05)
    for x in (-3.3, 0, 3.3):
        beam(p, 'dark_metal', (x, -.1, zc + H / 2 + .2), (x, -1.2, zc + H / 2 + .5), .07)
        box(p, 'dark_metal', (.5, .4, .3), (x, -1.3, zc + H / 2 + .45), (-30, 0, 0), bevel=.05)
        box(p, 'street_glow', (.4, .05, .22), (x, -1.2, zc + H / 2 + .3), (60, 0, 0))
    finish(p, 'billboard')

def parked_car():
    p = Part()
    box(p, 'car_teal', (1.9, 4.2, .62), (0, 0, .66), bevel=.18, seg=2)
    box(p, 'glass_dark', (1.62, 2.1, .6), (0, .25, 1.18), bevel=.16, seg=2)
    box(p, 'car_teal', (1.66, 1.7, .1), (0, .3, 1.47), bevel=.05)
    for sx in (-1, 1):
        for y, lean in ((-.72, -24), (1.2, 20)): box(p, 'car_teal', (.1, .14, .62), (sx * .78, y, 1.18), (lean, 0, 0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            lathe(p, [(0, -.14), (.36, -.14), (.38, 0), (.36, .14), (0, .14)], 'rubber', 12, (sx * .82, sy * 1.35, .38), (0, 90, 0))
            lathe(p, [(0, 0), (.2, 0), (0, .02)], 'metal', 8, (sx * .97, sy * 1.35, .38), (0, 90 * sx, 0))
        box(p, 'headlight', (.42, .06, .16), (sx * .6, -2.11, .78), bevel=.02)
        box(p, 'taillight', (.4, .06, .14), (sx * .62, 2.11, .8), bevel=.02)
    for sy in (-1, 1): box(p, 'dark', (1.94, .2, .22), (0, sy * 2.1, .44), bevel=.06)
    finish(p, 'parked_car')

# ---------------------------------------------------------------- snow
def pine(p, h, R, tiers, rnd, loc=(0, 0, 0)):
    with p.at(loc):
        lathe(p, [(.22, -.2), (.18, h * .2)], 'pine_trunk', 7)
        for i in range(tiers):
            t = i / tiers; z = h * (.12 + .78 * t); r = R * (1 - .72 * t); th = h * .36
            top = i == tiers - 1
            lathe(p, [(0, z + th * .12), (r, z), (r * .8, z + th * .14), (r * .6, z + th * .3), (r * .3, z + th * .62), (0, z + th)],
                  ['pine_dark', 'snow', 'pine', 'pine', 'snow' if top else 'pine'], 12, rot=(0, 0, rnd.uniform(0, 60)), jag={1: .12, 2: .08})

def pine_a():
    p = Part(); pine(p, 8.0, 2.4, 4, random.Random(61)); finish(p, 'pine_a', sharp=40)

def pine_b():
    p = Part(); rnd = random.Random(62)
    pine(p, 5.8, 2.3, 3, rnd); pine(p, 3.4, 1.4, 3, rnd, (2.1, 1.0, 0))
    lathe(p, [(3.2, -.2), (2.6, .2), (1.2, .38), (0, .42)], 'snow', 14)
    finish(p, 'pine_b', sharp=40)

def snow_rock():
    p = Part(); f = lambda face: 'snow' if face.normal.z > .55 else 'rock_gray'
    rock(p, 'rock_gray', (0, 0, .55), (1.7, 1.4, 1.3), 71, 2, .16, matf=f)
    rock(p, 'rock_gray', (1.6, .6, .28), (.8, .7, .7), 72, 1, matf=f)
    finish(p, 'snow_rock', sharp=28)

def cabin():
    p = Part(); W, D, n = 5.0, 4.0, 7
    for i in range(n):
        z = .22 + i * .36
        for ny in (-1, 1): lathe(p, [(.19, -W / 2 - .25), (.19, W / 2 + .25)], 'wood' if i % 2 else 'wood_dark', 6, (0, ny * D / 2, z), (0, 90, 0))
        for sx in (-1, 1): lathe(p, [(.19, -D / 2 - .25), (.19, D / 2 + .25)], 'wood_dark' if i % 2 else 'wood', 6, (sx * W / 2, 0, z + .18), (90, 0, 0))
    Z = .22 + n * .36
    for ny in (-1, 1): extrude(p, [(-2.7, 0), (2.7, 0), (0, 1.75)], .2, 'wood_dark', (0, ny * D / 2, Z - .1))
    ang = math.degrees(math.atan2(1.95, 3.1))
    for sx in (-1, 1):
        box(p, 'roof_red', (3.9, D + 1.0, .16), (sx * 1.55, 0, Z + .95), (0, sx * ang, 0), bevel=.04)
        box(p, 'snow', (3.85, D + 1.05, .3), (sx * 1.47, 0, Z + 1.18), (0, sx * ang, 0), bevel=.12, seg=2)
    box(p, 'stone', (.75, .75, 2.6), (1.6, .9, Z + 1.4), bevel=.05)
    box(p, 'snow', (.85, .85, .22), (1.6, .9, Z + 2.75), bevel=.08, seg=2)
    box(p, 'wood_dark', (1.0, .14, 1.9), (0, -D / 2 - .2, 1.0), bevel=.03)
    for x in (-1.6, 1.6):
        box(p, 'white', (.95, .1, .85), (x, -D / 2 - .2, 1.45), bevel=.03)
        box(p, 'window_warm', (.78, .12, .68), (x, -D / 2 - .21, 1.45))
    for sx in (-1, 1): box(p, 'window_warm', (.12, .7, .6), (sx * (W / 2 + .21), 0, 1.5))
    sphere(p, 'window_warm', .12, (.7, -D / 2 - .3, 2.1), 6, 3)
    finish(p, 'cabin')

def snowman():
    p = Part()
    for r, z in ((.72, .64), (.52, 1.6), (.38, 2.3)): sphere(p, 'snow', r, (0, 0, z), 12, 7)
    lathe(p, [(.07, 0), (0, .42)], 'carrot', 6, (0, -.34, 2.3), (90, 0, 0))
    for x in (-.13, .13): sphere(p, 'black', .045, (x, -.33, 2.42), 5, 3)
    for a in (-40, -20, 0, 20, 40): sphere(p, 'black', .03, (.2 * math.sin(math.radians(a)), -.33 + .03 * abs(a) / 40, 2.18 + .04 * abs(a) / 40), 5, 3)
    for z in (1.45, 1.65, 1.85): sphere(p, 'black', .05, (0, -.5 + abs(z - 1.65) * .35, z), 5, 3)
    for sx in (-1, 1):
        a, b = V((sx * .42, 0, 1.75)), V((sx * 1.15, -.1, 2.15))
        sweep(p, [a, (a + b) / 2, b], ring_profile(5, .03), 'wood_dark')
        sweep(p, [(a + b) * .5 + V((sx * .1, 0, .03)), (a + b) * .5 + V((sx * .25, -.05, .3))], ring_profile(4, .02), 'wood_dark')
    lathe(p, [(.28, -.07), (.4, -.08), (.42, 0), (.4, .08), (.28, .07)], 'scarf', 12, (0, 0, 2.0), closed=True)
    box(p, 'scarf', (.18, .08, .5), (.18, -.36, 1.8), (10, 0, -12))
    lathe(p, [(.35, 2.52), (.36, 2.62), (.3, 2.78), (.16, 2.86), (0, 2.88)], 'scarf', 12)
    lathe(p, [(.32, -.05), (.4, -.05), (.4, .05), (.32, .05)], 'white', 12, (0, 0, 2.56), closed=True)
    sphere(p, 'white', .11, (0, 0, 2.94), 8, 4)
    finish(p, 'snowman')

def ice_crystal():
    p = Part()
    for (x, y, rx, ry, r, h, m) in ((0, 0, 0, 0, .45, 3.2, 'ice_glow'), (.55, .2, 0, 28, .3, 2.1, 'ice_deep'), (-.5, .15, 0, -30, .28, 1.7, 'ice_deep'),
                                     (.1, .55, -30, 8, .32, 2.3, 'ice_glow'), (-.15, -.5, 26, -10, .22, 1.3, 'ice_glow')):
        lathe(p, [(r * .8, -.4), (r, h * .15), (r, h * .72), (0, h)], m, 6, (x, y, 0), (rx, ry, 0))
    lathe(p, [(1.4, -.1), (1.1, .2), (.55, .36), (0, .4)], 'snow', 12)
    finish(p, 'ice_crystal', sharp=25)

# ---------------------------------------------------------------- space (rainbow road)
def ground(p):
    """Drop the whole part so its lowest point sits on the origin (floating props keep the ground-contact convention)."""
    z = min(v.co.z for v in p.bm.verts)
    for v in p.bm.verts: v.co.z -= z

def star_pts(R, r, n=5):
    return [((R, r)[k % 2] * math.cos(PI / 2 + PI * k / n), (R, r)[k % 2] * math.sin(PI / 2 + PI * k / n)) for k in range(2 * n)]

def star3d(p, m, R, r, d, t=.08, side=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Faceted puffy star drawn in local XZ (point up), facing -Y: apexes d in front of / behind a 2t-thick rim."""
    with p.at(loc, rot):
        pts = star_pts(R, r)
        fr, bk = [p.v((u, -t, w)) for u, w in pts], [p.v((u, t, w)) for u, w in pts]
        af, ab = p.v((0, -t - d, 0)), p.v((0, t + d, 0))
    faces = []
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        faces += [p.face((af, fr[j], fr[i]), m), p.face((ab, bk[i], bk[j]), m), p.face((fr[i], fr[j], bk[j], bk[i]), side or m)]
    fix(p, faces)

def crystal(p, m, base, tip, r):
    h = (V(tip) - V(base)).length
    with p.at(m=aim(base, tip)): lathe(p, [(r * .7, -r), (r, h * .2), (r, h * .72), (0, h)], m, 6)

def planet_ringed():
    """Sky landmark: ~60 m banded planet with a tilted, three-band ring (~125 m across) and a little moon."""
    p = Part(); R = 30.
    bands = ['planet_violet', 'planet_violet', 'planet_pink', 'planet_peach', 'planet_pink', 'planet_violet', 'planet_teal', 'planet_violet',
             'planet_violet', 'planet_pink', 'planet_peach', 'planet_peach', 'planet_pink', 'planet_violet', 'planet_teal', 'planet_teal']
    sphere(p, bands, R, n=32, rings=16)
    r0, r1, r2, r3, t = 1.38 * R, 1.62 * R, 1.7 * R, 2.08 * R, .5
    lathe(p, [(r0, t), (r1, t), (r2, t), (r3, t), (r3, -t), (r2, -t), (r1, -t), (r0, -t)],
          ['ring_a', 'ring_b', 'ring_c', 'ring_c', 'ring_c', 'ring_b', 'ring_a', 'ring_a'], 48, rot=(18, -20, 0), closed=True)
    sphere(p, 'moon', 4.5, (-58, -10, 38), 12, 6)
    ground(p); finish(p, 'planet_ringed', sharp=60)

def asteroid_crystals(p, c, dirs):
    for d, m, r, h in dirs:
        d = V(d).normalized(); crystal(p, m, c + d * .2, c + d * h, r)

def asteroid_a():
    p = Part(); f = lambda face: 'asteroid_light' if face.normal.z > .35 else 'asteroid'
    rock(p, 'asteroid', (0, 0, 0), (3.4, 2.8, 2.5), 81, 2, .26, flat=2, matf=f)
    rock(p, 'asteroid', (2.9, .6, -1.2), (1.2, 1.0, .9), 82, 1, .3, flat=2, matf=f)
    asteroid_crystals(p, V((0, 0, 0)), [((.3, -.2, 1), 'crystal_cyan', .55, 5.0), ((-.7, -.6, .8), 'crystal_cyan', .42, 4.6),
                                        ((.9, -.7, .3), 'crystal_pink', .4, 4.8), ((-.4, .7, .7), 'crystal_cyan', .34, 4.2), ((-1, -.3, -.2), 'crystal_pink', .36, 4.8)])
    ground(p); finish(p, 'asteroid_a', sharp=28)

def asteroid_b():
    p = Part(); f = lambda face: 'asteroid_light' if face.normal.z > .35 else 'asteroid'
    rock(p, 'asteroid', (0, 0, 0), (2.4, 1.5, 1.4), 83, 1, .3, rot=(0, 15, 25), flat=2, matf=f)
    rock(p, 'asteroid', (-1.9, .5, .5), (1.3, 1.2, 1.1), 84, 1, .3, flat=2, matf=f)
    asteroid_crystals(p, V((.3, 0, 0)), [((.2, -.3, 1), 'crystal_pink', .4, 3.0), ((.9, -.6, .5), 'crystal_gold', .32, 3.1), ((.5, .5, .8), 'crystal_pink', .28, 2.6)])
    asteroid_crystals(p, V((-1.9, .5, .5)), [((-.5, -.6, .7), 'crystal_gold', .3, 2.4)])
    ground(p); finish(p, 'asteroid_b', sharp=28)

def space_station():
    """Toy station ~52 m wide: a wheel facing the viewer with glowing window bands, hub, docking nose and four solar wings."""
    p = Part(); H, RW, T = 12.6, 11., 1.6
    oct_ = [(RW + T * math.cos(TAU * k / 8 + PI / 8), T * math.sin(TAU * k / 8 + PI / 8)) for k in range(8)]
    wheel = ['station_white'] * 8; wheel[7] = wheel[3] = 'station_blue'
    lathe(p, oct_, wheel, 32, (0, 0, H), (90, 0, 0), closed=True)
    zf = T * math.cos(PI / 8) + .02
    for z in (zf, -zf): lathe(p, [(RW - .45, z), (RW + .45, z)], 'station_window', 32, (0, 0, H), (90, 0, 0), caps=False, sector=['station_window', 'station_white'])
    for k in range(4):
        a = TAU * k / 4 + PI / 4; d = V((math.cos(a), 0, math.sin(a)))
        beam(p, 'station_white', V((0, 0, H)) + d * 3.2, V((0, 0, H)) + d * (RW - 1.2), .7)
    sphere(p, 'station_white', 3.6, (0, 0, H), 16, 8, rot=(90, 0, 0), sector=['station_white', 'station_blue'])
    lathe(p, [(3.75, -.45), (3.75, .45)], 'station_window', 16, (0, 0, H), (0, 0, 0), caps=False, sector=['station_window', 'station_white'])
    lathe(p, [(1.3, -6.5), (1.3, 3), (1.9, 3.4), (1.9, 6.2), (1.2, 7.2), (.7, 7.4), (0, 7.4)],
          ['station_white', 'station_blue', 'station_white', 'station_blue', 'station_window', 'station_window'], 10, (0, 0, H), (90, 0, 0))
    for sx in (-1, 1): sphere(p, 'beacon_green' if sx > 0 else 'beacon_red', .35, (sx * 2.0, -6.8, H), 6, 3)
    box(p, 'solar_frame', (54, .6, .6), (0, 5.2, H))
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx, cz = sx * 20, H + sz * 3.1
            box(p, 'solar_frame', (11.4, .16, 4.8), (cx, 5.2, cz))
            beam(p, 'solar_frame', (cx, 5.2, H), (cx, 5.2, cz), .3)
            for i in range(4):
                for j in range(2):
                    for ny in (-1, 1): quad(p, 'solar', (cx - 4.2 + 2.8 * i, 5.2 + ny * .1, cz - 1.1 + 2.2 * j), (0, ny, 0), 1.3, 1.0)
    beam(p, 'solar_frame', (0, 0, H + 3.4), (0, 0, H + RW + T + 3.5), .14, n=6)
    sphere(p, 'beacon_red', .5, (0, 0, H + RW + T + 3.8), 8, 4)
    ground(p); finish(p, 'space_station')

def satellite():
    """~7 m comms satellite: foil body, white dish facing the viewer, two solar wings, antenna with a beacon."""
    p = Part(); Z = 1.6
    box(p, 'foil', (1.3, 1.3, 1.5), (0, 0, Z), bevel=.1, seg=2)
    box(p, 'station_white', (1.4, 1.4, .18), (0, 0, Z + .82), bevel=.05)
    lathe(p, [(0, 0), (.45, .04), (.85, .15), (1.2, .34), (1.26, .3), (.85, .06), (.35, -.1), (0, -.14)],
          ['station_white'] * 4 + ['station_blue'] * 3, 16, (0, -.8, Z), (90, 0, 0))
    for a in (0, 120, 240):
        rr = V((math.cos(math.radians(a)), 0, math.sin(math.radians(a)))) * 1.05
        beam(p, 'solar_frame', V((0, -.8 - .3, Z)) + rr, (0, -1.9, Z), .04, n=4)
    sphere(p, 'crystal_gold', .14, (0, -1.95, Z), 6, 3)
    for sx in (-1, 1):
        beam(p, 'solar_frame', (sx * .6, 0, Z), (sx * 1.2, 0, Z), .12)
        box(p, 'solar_frame', (2.6, .1, 1.2), (sx * 2.5, 0, Z))
        for i in range(3):
            for ny in (-1, 1): quad(p, 'solar', (sx * (1.66 + .84 * i), ny * .06, Z), (0, ny, 0), .37, .52)
    beam(p, 'solar_frame', (.3, .3, Z + .9), (.3, .3, Z + 2.6), .03, n=4)
    sphere(p, 'beacon_red', .1, (.3, .3, Z + 2.66), 6, 3)
    ground(p); finish(p, 'satellite')

def star_crystal():
    """Glowing crystal cluster (~4 m) on a small rock, a gold star caught at the tip of the tallest spire."""
    p = Part(); f = lambda face: 'asteroid_light' if face.normal.z > .5 else 'asteroid'
    rock(p, 'asteroid', (0, 0, .35), (1.7, 1.4, .8), 85, 1, .2, matf=f)
    for (x, y, tx, ty, h, r, m) in ((0, 0, .1, 0, 3.4, .42, 'crystal_cyan'), (.55, .15, .9, -.3, 2.3, .3, 'crystal_pink'), (-.55, .1, -1.1, -.2, 2.0, .3, 'crystal_pink'),
                                    (.15, .5, .5, 1, 2.4, .3, 'crystal_gold'), (-.2, -.5, -.4, -1, 1.7, .26, 'crystal_cyan'), (.6, -.45, 1.2, -1, 1.4, .22, 'crystal_gold'),
                                    (-.7, .5, -1.3, .9, 1.5, .22, 'crystal_cyan')):
        crystal(p, m, (x, y, .45), (x + tx, y + ty, .45 + h), r)
    star3d(p, 'star_gold', .55, .24, .14, .05, 'star_side', (.1, -.2, 4.0))
    finish(p, 'star_crystal', sharp=30)

def star_bumper():
    """Pinball bumper for sliding movers: 3.2 m round base with a glowing rim, rubber ring and cap; the star is a child pivot."""
    p = Part()
    lathe(p, [(1.45, 0), (1.6, .1), (1.6, .26), (1.6, .46), (1.52, .56), (1.1, .6), (0, .6)],
          ['bumper_base', 'bumper_base', 'bumper_rim', 'bumper_base', 'bumper_base', 'bumper_base'], 24)
    lathe(p, [(1.36 + .2 * math.cos(TAU * k / 6), .82 + .2 * math.sin(TAU * k / 6)) for k in range(6)], 'bumper_rubber', 24, closed=True)
    lathe(p, [(1.16, .6), (1.18, 1.0), (.95, 1.22), (.5, 1.34), (0, 1.36)], 'bumper_cap', 16, sector=['bumper_cap', 'bumper_rim'])
    lathe(p, [(.18, 1.3), (.12, 2.25)], 'bumper_base', 8)
    root = finish(p, 'star_bumper')
    q = Part(); star3d(q, 'star_gold', 1.35, .6, .3, .12, 'star_side')
    finish(q, 'star_bumper_star', root, (0, 0, 2.75), sharp=20)

def ring_gate():
    """Star ring hoop, origin at its centre, facing +Z (glTF): 6.4 m glowing torus, inner cyan band, a symmetric crown of six stars."""
    p = Part(); R = 3.2
    lathe(p, [(R + .26 * math.cos(TAU * k / 10), .26 * math.sin(TAU * k / 10)) for k in range(10)], 'ring_glow', 36, rot=(90, 0, 0), closed=True)
    lathe(p, [(R - .3 + .09 * math.cos(TAU * k / 5), .09 * math.sin(TAU * k / 5)) for k in range(5)], 'ring_inner', 30, rot=(90, 0, 0), closed=True)
    for k in range(6):
        a = PI / 2 + TAU * k / 6
        star3d(p, 'star_gold' if k % 3 == 0 else 'spring_arrow', .55, .24, .16, .08, 'star_side', ((R + .45) * math.cos(a), 0, (R + .45) * math.sin(a)), (0, 90 - math.degrees(a), 0))
    finish(p, 'ring_gate', sharp=40)

def spring_pad():
    """Star-shaped bounce pad, ~5.4 m, flush (0.17 m): nested glowing star outlines (a coil seen from above), chevron pointing +Z (glTF)."""
    p = Part()
    for i, (R, m) in enumerate(((2.7, 'bumper_base'), (2.45, 'spring_glow'), (2.0, 'bumper_base'), (1.6, 'spring_glow'), (1.15, 'bumper_base'))):
        extrude(p, star_pts(R, R * .46), .06, m, (0, 0, .03 + .025 * i), (90, 0, 0))
    extrude(p, [(-.6, -.2), (0, .5), (.6, -.2), (.6, -.5), (0, .18), (-.6, -.5)], .04, 'spring_arrow', (0, 0, .15), (90, 0, 0))
    finish(p, 'spring_pad', sharp=40)

BUILDERS = dict(item_box=item_box, start_gantry=start_gantry, cone=cone, tire_stack=tire_stack, barrier=barrier, arrow_sign=arrow_sign,
                crowd_stand=crowd_stand, balloon_arch=balloon_arch, lamp_post=lamp_post, flag_pole=flag_pole, peel=peel,
                bouncer_shell=bouncer_shell, seeker_shell=seeker_shell, bomb=bomb, comet=comet, drone=drone, palm_a=palm_a, palm_b=palm_b,
                umbrella=umbrella, beach_hut=beach_hut, lifeguard_tower=lifeguard_tower, rock_beach=rock_beach, boat=boat,
                cactus_a=cactus_a, cactus_b=cactus_b, rock_red_a=rock_red_a, rock_red_b=rock_red_b, mesa=mesa, water_tower=water_tower,
                windmill=windmill, building_a=building_a, building_b=building_b, building_c=building_c, street_light=street_light,
                neon_sign=neon_sign, billboard=billboard, parked_car=parked_car, pine_a=pine_a, pine_b=pine_b, snow_rock=snow_rock,
                cabin=cabin, snowman=snowman, ice_crystal=ice_crystal, planet_ringed=planet_ringed, asteroid_a=asteroid_a, asteroid_b=asteroid_b,
                space_station=space_station, satellite=satellite, star_crystal=star_crystal, star_bumper=star_bumper, ring_gate=ring_gate, spring_pad=spring_pad)

# ---------------------------------------------------------------- build, export, verify
def tris(ob):
    return sum(len(p.vertices) - 2 for o in [ob, *ob.children_recursive] if o.type == 'MESH' for p in o.data.polygons)

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, spec in PALETTE.items(): mat(name, *spec)
    for names in THEMES.values():
        for n in names: BUILDERS[n]()
    roots = {n: bpy.data.objects[n] for names in THEMES.values() for n in names}
    counts = {n: tris(o) for n, o in roots.items()}
    for n, c in counts.items(): print(f'  {n:16s} {c:5d} tris')
    print('TOTAL TRIS', sum(counts.values()))
    GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', export_cameras=False, export_lights=False, export_texcoords=False,
                              export_normals=True, export_vertex_color='NONE', export_extras=False, export_yup=True, export_apply=True,
                              export_animations=False, export_copyright='Kart Party original artwork')
    print('GLB bytes', GLB.stat().st_size)
    return counts

def verify():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    need = [n for names in THEMES.values() for n in names] + [c for cs in CHILDREN.values() for c in cs]
    missing = [n for n in need if n not in bpy.data.objects]
    assert not missing, f'missing nodes after re-import: {missing}'
    for parent, kids in CHILDREN.items():
        for k in kids: assert bpy.data.objects[k].parent == bpy.data.objects[parent], f'{k} not under {parent}'
    assert not bpy.data.cameras and not bpy.data.lights and not bpy.data.images, 'unexpected cameras/lights/images'
    print('VERIFY OK', len(need), 'nodes')

# ---------------------------------------------------------------- QA renders (after verify: scene holds the re-imported GLB)
def hierarchy_bounds(ob):
    pts = [o.matrix_world @ V(c) for o in [ob, *ob.children_recursive] if o.type == 'MESH' for c in o.bound_box]
    return V([min(q[i] for q in pts) for i in range(3)]), V([max(q[i] for q in pts) for i in range(3)])

def setup_render(w, h, night=False):
    s = bpy.context.scene
    s.render.engine = 'BLENDER_EEVEE'; s.render.resolution_x, s.render.resolution_y = w, h
    s.view_settings.view_transform = 'Standard'; s.render.film_transparent = False
    world = bpy.data.worlds.get('qa') or bpy.data.worlds.new('qa'); s.world = world
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (.02, .025, .06, 1) if night else (.55, .7, .9, 1)
    bg.inputs[1].default_value = .35 if night else 1.0
    for o in [o for o in bpy.data.objects if o.type in ('LIGHT', 'CAMERA')]: bpy.data.objects.remove(o)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); s.collection.objects.link(sun)
    sun.data.energy = .6 if night else 3.2; sun.data.angle = .2; sun.rotation_euler = Euler((math.radians(50), math.radians(12), math.radians(-35)))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); s.collection.objects.link(cam); s.camera = cam
    return s, cam

def render_sheets(counts, themes):
    roots = {n: bpy.data.objects[n] for names in THEMES.values() for n in names}
    home = {n: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for n, o in roots.items()}
    lbl = bpy.data.materials.new('qa_label'); lbl.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.02, .02, .03, 1)
    lbl_n = bpy.data.materials.new('qa_label_n'); lbl_n.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (1, 1, 1, 1)
    lbl_n.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = .6
    GROUND = dict(detail=(.55, .6, .55), common=(.55, .6, .55), items=(.6, .62, .66), beach=(.93, .8, .55), desert=(.85, .6, .38), city=(.12, .13, .17), snow=(.9, .94, 1), space=(.1, .07, .18))
    def ground_mat(theme):
        g = bpy.data.materials.new('qa_ground'); bs = g.node_tree.nodes['Principled BSDF']
        bs.inputs['Base Color'].default_value = (*[lin(c) for c in GROUND[theme]], 1); bs.inputs['Roughness'].default_value = 1
        return g
    for o in roots.values(): o.rotation_mode = 'XYZ'
    def show(names):
        for n, o in roots.items():
            for c in [o, *o.children_recursive]: c.hide_render = n not in names
    for theme, names in themes.items():
        s, cam = setup_render(1800, 1100, theme in ('city', 'space')); ground = ground_mat(theme); show(names)
        cols = 4 if len(names) > 6 else 3; cell = 8.0; tmp = []
        for i, n in enumerate(names):
            o = roots[n]
            lo, hi = hierarchy_bounds(o); size = max(hi - lo); k = cell * .62 / size
            cx, cz = (i % cols - (cols - 1) / 2) * cell, -(i // cols) * cell * 1.05
            o.scale = (k, k, k); o.rotation_euler = Euler((0, 0, math.radians(28)))
            bpy.context.view_layer.update(); lo2, hi2 = hierarchy_bounds(o)
            o.location = V((cx, 0, cz)) - V(((lo2.x + hi2.x) / 2, (lo2.y + hi2.y) / 2, lo2.z))
            bpy.ops.mesh.primitive_cylinder_add(radius=cell * .42, depth=.1, location=(cx, 0, cz - .05)); d = bpy.context.object
            d.data.materials.append(ground); tmp.append(d)
            cu = bpy.data.curves.new('lbl', 'FONT'); cu.body = f'{n}  {counts[n]} tris  {size:.1f} m'; cu.size = .45; cu.align_x = 'CENTER'
            t = bpy.data.objects.new('lbl', cu); s.collection.objects.link(t); t.location = (cx, -cell * .45, cz - .9); t.rotation_euler = (math.radians(90), 0, 0)
            t.data.materials.append(lbl_n if theme in ('city', 'space') else lbl); tmp.append(t)
        rows = (len(names) + cols - 1) // cols
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(cols * cell, rows * cell * 1.05 * 1800 / 1100) * 1.02
        cam.rotation_euler = Euler((math.radians(80), 0, 0)); cam.location = (0, -60, -(rows - 1) * cell * .525 + cell * .3 + 60 * math.tan(math.radians(10)))
        s.render.filepath = str(QA / f'props-{theme}.png'); bpy.ops.render.render(write_still=True)
        for o in tmp: bpy.data.objects.remove(o)
        for n, o in roots.items(): o.location, o.rotation_euler, o.scale = home[n]
    # distance readability: true scale along a road, kart-height chase camera
    road = bpy.data.materials.new('qa_road'); road.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.05, .05, .06, 1)
    for theme, names in themes.items():
        if theme == 'detail': continue
        s, cam = setup_render(1280, 720, theme in ('city', 'space')); ground = ground_mat(theme); show(names)
        items = theme == 'items'; order = sorted(names, key=lambda n: max(hierarchy_bounds(roots[n])[1] - hierarchy_bounds(roots[n])[0]))
        for i, n in enumerate(order):
            o = roots[n]; lo, hi = hierarchy_bounds(o); side = 1 if i % 2 else -1
            if items: o.location = ((i % 3 - 1) * 3.5 - (lo.x + hi.x) / 2, 7 + 4 * i, 0); o.rotation_euler = Euler((0, 0, math.radians(200)))
            else:
                o.location = (side * (11 + (hi.x - lo.x) / 2) - (lo.x + hi.x) / 2, 12 + 10 * i + (hi.y - lo.y) / 2, 0)
                o.rotation_euler = Euler((0, 0, math.radians(-side * 35)))
        bpy.ops.mesh.primitive_plane_add(size=900, location=(0, 300, 0)); pl = bpy.context.object; pl.data.materials.append(ground)
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 300, .02)); rd = bpy.context.object; rd.scale = (16, 700, 1); rd.data.materials.append(road)
        cam.data.type = 'PERSP'; cam.data.sensor_fit = 'VERTICAL'; cam.data.angle = math.radians(68)
        cam.location = (0, -6.5, 2.6); cam.rotation_euler = Euler((math.radians(86), 0, 0))
        s.render.filepath = str(QA / f'props-{theme}-far.png'); bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(pl); bpy.data.objects.remove(rd)
        for n, o in roots.items(): o.location, o.rotation_euler, o.scale = home[n]

def layout():
    """Spread the exported roots into one labelled row per theme so the saved .blend is browsable."""
    for row, names in enumerate(THEMES.values()):
        x = 0.
        for n in names:
            o = bpy.data.objects[n]; lo, hi = hierarchy_bounds(o)
            o.location = (x - lo.x, row * 70., 0); x += hi.x - lo.x + 4

counts = build()
layout(); BLEND.unlink(missing_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
verify()
if '--detail' in ARGS: render_sheets(counts, {'detail': ARGS[ARGS.index('--detail') + 1].split(',')})
elif '--only' in ARGS: render_sheets(counts, {t: THEMES[t] for t in ARGS[ARGS.index('--only') + 1].split(',')})
elif '--no-render' not in ARGS: render_sheets(counts, THEMES)
