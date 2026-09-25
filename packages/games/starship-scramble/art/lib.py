"""Shared Blender helpers for the Starship Scramble art scripts (scene, Cycles, materials, meshes, numpy image IO)."""
import bpy, bmesh, math, numpy as np
from mathutils import Matrix, Vector

# ---------- scene ----------
def reset(w, h, samples=96, denoise=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = d.type == 'METAL'
    c = scene.cycles; c.device = 'GPU'; c.samples = samples; c.use_denoising = denoise; c.use_adaptive_sampling = True; c.max_bounces = 6
    r = scene.render; r.resolution_x, r.resolution_y, r.resolution_percentage = w, h, 100; r.film_transparent = True
    r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'; r.image_settings.color_depth = '8'; r.image_settings.compression = 100
    scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
    return scene

def world(color, strength=1.):
    w = bpy.data.worlds.new('world'); bpy.context.scene.world = w
    nt = w.node_tree; bg = nt.nodes['Background']; bg.inputs[0].default_value = (*color, 1); bg.inputs[1].default_value = strength
    return w

def sun(direction, strength, color=(1, 1, 1), angle=.12):
    """direction: the way light travels (world coords)."""
    data = bpy.data.lights.new('sun', 'SUN'); data.energy = strength; data.color = color; data.angle = angle
    ob = bpy.data.objects.new('sun', data); bpy.context.collection.objects.link(ob)
    ob.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler()
    return ob

def ortho_camera(cx, cy, w, h, z=40):
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = max(w, h); cam.clip_end = 200
    ob = bpy.data.objects.new('cam', cam); bpy.context.collection.objects.link(ob); ob.location = (cx, cy, z)
    bpy.context.scene.camera = ob
    return ob

def render(path):
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)

# ---------- materials ----------
def _mat(name, build, **tags):
    m = bpy.data.materials.new(name)
    nt = m.node_tree if m.node_tree else (setattr(m, 'use_nodes', True) or m.node_tree)
    nt.nodes.clear(); out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(build(nt), out.inputs['Surface'])
    for k, v in tags.items(): m[k] = v
    return m

def _principled(nt, color, rough, metal, emit=None, estr=0., coat=0.):
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    if isinstance(color, tuple): b.inputs['Base Color'].default_value = (*color, 1)
    else: nt.links.new(color, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit: b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = estr
    if coat: b.inputs['Coat Weight'].default_value = coat
    return b

def _mix(nt, a, b, fac, blend='MULTIPLY'):
    n = nt.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = blend
    n.inputs['Factor'].default_value = fac
    for sock, v in ((n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(v, tuple): sock.default_value = (*v, 1)
        else: nt.links.new(v, sock)
    return n.outputs[2]

def _ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB'); els = r.color_ramp.elements
    while len(els) > len(stops): els.remove(els[-1])
    while len(els) < len(stops): els.new(0)
    for e, (p, c) in zip(els, stops): e.position = p; e.color = (*c, 1) if len(c) == 3 else c
    nt.links.new(fac, r.inputs[0]); return r.outputs[0]

def plated(name, base, seam=.35, plate=(.9, .45), rough=.42, metal=.25, grime=.18, paint=False, bump=.35, variance=.12, ao=.55):
    """Armor plating: brick-tiled panels in world XY with per-panel value variance, dark seams, grime and seam bump."""
    def build(nt):
        pos = nt.nodes.new('ShaderNodeNewGeometry').outputs['Position']
        br = nt.nodes.new('ShaderNodeTexBrick'); br.offset = .5; br.offset_frequency = 2
        nt.links.new(pos, br.inputs['Vector'])
        br.inputs['Color1'].default_value = (*base, 1); br.inputs['Color2'].default_value = (*[c * (1 - variance) for c in base], 1)
        br.inputs['Mortar'].default_value = (*[c * seam for c in base], 1); br.inputs['Scale'].default_value = 1
        br.inputs['Mortar Size'].default_value = .018; br.inputs['Mortar Smooth'].default_value = .3; br.inputs['Bias'].default_value = 0
        br.inputs['Brick Width'].default_value = plate[0]; br.inputs['Row Height'].default_value = plate[1]
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3.5; nz.inputs['Detail'].default_value = 6
        nt.links.new(pos, nz.inputs['Vector'])
        g = _ramp(nt, nz.outputs['Fac'], [(.35, (1, 1, 1)), (.75, (1 - grime,) * 3)])
        col = _mix(nt, br.outputs['Color'], g, 1)
        if ao:
            occ = nt.nodes.new('ShaderNodeAmbientOcclusion'); occ.inputs['Distance'].default_value = .18; occ.samples = 8
            col = _mix(nt, col, _ramp(nt, occ.outputs['AO'], [(0, (1 - ao,) * 3), (1, (1, 1, 1))]), 1)
        b = _principled(nt, col, rough, metal)
        bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = bump; bp.inputs['Distance'].default_value = .02
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1
        nt.links.new(br.outputs['Fac'], inv.inputs[1]); nt.links.new(inv.outputs[0], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
        return b.outputs[0]
    return _mat(name, build, paint=paint)

def chitin(name, base, paint=False, scale=1.6, seam=.3, ao=.5):
    """Organic carapace: transverse rib segments (distorted bands) with dark sutures, broad plate breakup, mottling and a glossy coat."""
    def build(N):
        pos = N.node('ShaderNodeNewGeometry').outputs['Position']
        wave = N.node('ShaderNodeTexWave', [('Vector', pos), ('Scale', scale * .16), ('Distortion', 2.2), ('Detail', 2), ('Detail Scale', .6)], wave_type='BANDS', bands_direction='X', wave_profile='SAW').outputs['Fac']
        rib = N.ramp(wave, [(0, tuple(c * seam for c in base)), (.07, tuple(c * .8 for c in base)), (.6, base), (.97, tuple(min(1, c * 1.1) for c in base)), (1, tuple(c * seam for c in base))])
        vo = N.node('ShaderNodeTexVoronoi', [('Vector', pos), ('Scale', scale * .7)], feature='DISTANCE_TO_EDGE').outputs['Distance']
        col = N.mix(rib, N.ramp(vo, [(0, (.72,) * 3), (.05, (1, 1, 1))]), 1, 'MULTIPLY')
        col = N.mix(col, N.ramp(N.noise(pos, 5, 5)[0], [(.3, (1, 1, 1)), (.75, (.82,) * 3)]), 1, 'MULTIPLY')
        occ = N.node('ShaderNodeAmbientOcclusion', [('Distance', .18)], samples=8).outputs['AO']
        col = N.mix(col, N.ramp(occ, [(0, (1 - ao,) * 3), (1, (1, 1, 1))]), 1, 'MULTIPLY')
        nrm = N.node('ShaderNodeBump', [('Strength', .7), ('Distance', .05), ('Height', wave)]).outputs['Normal']
        nrm = N.node('ShaderNodeBump', [('Strength', .3), ('Distance', .02), ('Height', vo), ('Normal', nrm)]).outputs['Normal']
        return N.node('ShaderNodeBsdfPrincipled', [('Base Color', col), ('Roughness', .32), ('Metallic', .05), ('Coat Weight', .7), ('Coat Roughness', .2), ('Normal', nrm)]).outputs[0]
    return node_material(name, build, paint=paint)

def armor(name, base, img, box, paint=True, rough=.34, metal=.12, coat=.4, grime=.12, bump=.45, ao=.45):
    """Painted armor driven by a grid-space panel texture over world XY box (x0, y0, w, h): R seam height, G per-panel tone,
    B large-scale pillow height that rounds the armor into its edges. Grime noise, AO darkening and a glossy coat on top."""
    def build(N):
        pos = N.node('ShaderNodeNewGeometry').outputs['Position']; x, y, _ = N.xyz(pos)
        uv = N.vec(N.math('DIVIDE', N.math('SUBTRACT', x, box[0]), box[2]), N.math('DIVIDE', N.math('SUBTRACT', y, box[1]), box[3]), 0)
        h, tone, pillow = N.xyz(N.node('ShaderNodeTexImage', [(0, uv)], image=img, interpolation='Cubic', extension='EXTEND').outputs['Color'])
        col = N.rgb_scale(base, tone)
        col = N.mix(col, N.ramp(N.noise(pos, 3.5, 6)[0], [(.35, (1, 1, 1)), (.75, (1 - grime,) * 3)]), 1, 'MULTIPLY')
        occ = N.node('ShaderNodeAmbientOcclusion', [('Distance', .22)], samples=8).outputs['AO']
        col = N.mix(col, N.ramp(occ, [(0, (1 - ao,) * 3), (1, (1, 1, 1))]), 1, 'MULTIPLY')
        nrm = N.node('ShaderNodeBump', [('Strength', 1), ('Distance', .24), ('Height', pillow)]).outputs['Normal']
        nrm = N.node('ShaderNodeBump', [('Strength', bump), ('Distance', .02), ('Height', h), ('Normal', nrm)]).outputs['Normal']
        return N.node('ShaderNodeBsdfPrincipled', [('Base Color', col), ('Roughness', rough), ('Metallic', metal), ('Coat Weight', coat), ('Coat Roughness', .25), ('Normal', nrm)]).outputs[0]
    return node_material(name, build, paint=paint)

def plain(name, color, rough=.5, metal=0., emit=None, estr=0., coat=0.):
    return _mat(name, lambda nt: _principled(nt, color, rough, metal, emit, estr, coat).outputs[0])

def glow(name, color, strength=8.):
    def build(nt):
        e = nt.nodes.new('ShaderNodeEmission'); e.inputs[0].default_value = (*color, 1); e.inputs[1].default_value = strength; return e.outputs[0]
    return _mat(name, build)

def halo_mat(name, color, strength=3., power=2.2):
    """Soft additive-looking glow card: emission fading to transparent by radial distance (object space, unit disk)."""
    def build(nt):
        tc = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
        ln = nt.nodes.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; nt.links.new(tc, ln.inputs[0])
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'SUBTRACT'; f.inputs[0].default_value = 1; f.use_clamp = True; nt.links.new(ln.outputs['Value'], f.inputs[1])
        p = nt.nodes.new('ShaderNodeMath'); p.operation = 'POWER'; p.inputs[1].default_value = power; nt.links.new(f.outputs[0], p.inputs[0])
        e = nt.nodes.new('ShaderNodeEmission'); e.inputs[0].default_value = (*color, 1); e.inputs[1].default_value = strength
        t = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(p.outputs[0], mx.inputs[0]); nt.links.new(t.outputs[0], mx.inputs[1]); nt.links.new(e.outputs[0], mx.inputs[2])
        return mx.outputs[0]
    return _mat(name, build, fx=True)

def to_mask():
    """Switch every material to the paint-mask look: paint → pure white emission, everything else → holdout; fx cards hidden."""
    for m in bpy.data.materials:
        nt = m.node_tree; out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        for l in list(out.inputs['Surface'].links) + list(out.inputs['Displacement'].links): nt.links.remove(l)
        if m.get('paint'): n = nt.nodes.new('ShaderNodeEmission'); n.inputs[0].default_value = (1, 1, 1, 1); n.inputs[1].default_value = 1
        else: n = nt.nodes.new('ShaderNodeHoldout')
        nt.links.new(n.outputs[0], out.inputs['Surface'])
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and any(s.material and s.material.get('fx') for s in ob.material_slots): ob.hide_render = True
    c = bpy.context.scene.cycles; c.samples = 24; c.use_denoising = False

# ---------- meshes ----------
def link(ob): bpy.context.collection.objects.link(ob); return ob

def from_bm(bm, name, mat, smooth=False, bevel=0., segs=2, angle=40):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if smooth: me.shade_smooth()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    if bevel: add_bevel(ob, bevel, segs, angle)
    return ob

def add_bevel(ob, width, segs=2, angle=40):
    m = ob.modifiers.new('bevel', 'BEVEL'); m.width = width; m.segments = segs; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle); m.use_clamp_overlap = True
    m.harden_normals = False; return m

def area(pts): return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1])) / 2

def prism(pts, z0, z1, mat, name='prism', bevel=.04, segs=2, angle=40, smooth=False):
    """Extrude a 2D world-space polygon between z0 and z1."""
    pts = list(pts)
    if area(pts) < 0: pts.reverse()
    bm = bmesh.new(); lo = [bm.verts.new((x, y, z0)) for x, y in pts]; hi = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(list(reversed(lo))); bm.faces.new(hi)
    n = len(pts)
    for i in range(n): bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    return from_bm(bm, name, mat, smooth, bevel, segs, angle)

def cone(p0, p1, r0, r1, mat, name='cone', segs=24, smooth=True):
    """Truncated cone from point p0 (radius r0) to p1 (radius r1)."""
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=d.length)
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((p0 + p1) / 2) @ rot, verts=bm.verts)
    return from_bm(bm, name, mat, smooth)

def ellipsoid(c, r, mat, name='ellipsoid', segs=24, rot=0.):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=1)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ Matrix.Rotation(rot, 4, 'Z') @ Matrix.Diagonal((*r, 1)), verts=bm.verts)
    return from_bm(bm, name, mat, True)

def card(c, rx, ry, mat, name='halo', rot=0.):
    """Flat unit-disk card (object space radius 1) scaled to rx × ry, facing +Z."""
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1)
    ob = from_bm(bm, name, mat); ob.location = c; ob.scale = (rx, ry, 1); ob.rotation_euler = (0, 0, rot)
    ob.visible_shadow = False
    return ob

# ---------- 2D helpers ----------
def fillet(pts, radii, n=1):
    """Round (n>1) or chamfer (n=1) each corner of a closed polygon; radii is a number or per-vertex list."""
    out, k = [], len(pts)
    for i, p in enumerate(pts):
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        a, b = Vector(pts[i - 1]), Vector(pts[(i + 1) % k]); p = Vector(p)
        if r <= 0: out.append(tuple(p)); continue
        r = min(r, (a - p).length * .45, (b - p).length * .45)
        s, e = p + (a - p).normalized() * r, p + (b - p).normalized() * r
        for j in range(n + 1): t = j / n; q = s * (1 - t) ** 2 + p * 2 * t * (1 - t) + e * t * t; out.append((q.x, q.y))
    return out

def corner_radii(pts, convex, concave):
    """Per-vertex radii depending on turn direction (for loops of either orientation)."""
    sign = 1 if area(pts) > 0 else -1
    res = []
    for i, p in enumerate(pts):
        a, b = pts[i - 1], pts[(i + 1) % len(pts)]
        cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])
        res.append(convex if cross * sign > 0 else concave)
    return res

def contour(mask, x0, y0, res):
    """Trace the largest boundary loop of a boolean raster (rows = +y) into polygon vertices."""
    h, w = mask.shape; m = np.pad(mask, 1); nxt = {}
    ys, xs = np.nonzero(m[1:-1, 1:-1])
    for i, j in zip(ys + 1, xs + 1):
        if not m[i - 1, j]: nxt[(j, i)] = (j + 1, i)
        if not m[i, j + 1]: nxt[(j + 1, i)] = (j + 1, i + 1)
        if not m[i + 1, j]: nxt[(j + 1, i + 1)] = (j, i + 1)
        if not m[i, j - 1]: nxt[(j, i + 1)] = (j, i)
    loops = []
    while nxt:
        start = next(iter(nxt)); loop = [start]; cur = nxt.pop(start)
        while cur != start: loop.append(cur); cur = nxt.pop(cur)
        loops.append(loop)
    loop = max(loops, key=len)
    pts = [p for k, p in enumerate(loop) if (p[0] - loop[k - 1][0], p[1] - loop[k - 1][1]) != (loop[(k + 1) % len(loop)][0] - p[0], loop[(k + 1) % len(loop)][1] - p[1])]
    return [(x0 + (x - 1) * res, y0 + (y - 1) * res) for x, y in pts]

def raster(pts, x0, y0, res, nx, ny):
    """Scanline even-odd fill of a closed polygon onto an (ny, nx) grid of pixel centers starting at (x0, y0), rows = +y."""
    p = np.asarray(pts, float)[:, :2]; a, b = p, np.roll(p, -1, 0); ys = y0 + (np.arange(ny) + .5) * res
    e, i = np.nonzero((a[:, 1:2] > ys) != (b[:, 1:2] > ys))
    xi = a[e, 0] + (ys[i] - a[e, 1]) * (b[e, 0] - a[e, 0]) / (b[e, 1] - a[e, 1])
    t = np.zeros((ny, nx + 1), np.int32); np.add.at(t, (i, np.clip(np.ceil((xi - x0) / res - .5), 0, nx).astype(int)), 1)
    return (np.cumsum(t, 1)[:, :nx] & 1).astype(bool)

def blur(a, r):
    """Two-pass separable box blur with radius r pixels (a soft tent)."""
    for _ in range(2):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in (0, 1)], mode='edge'), ax); n = a.shape[ax]
            a = (np.take(c, np.arange(2 * r + 1, n + 2 * r + 1), ax) - np.take(c, np.arange(n), ax)) / (2 * r + 1)
    return a

def dilate(mask, k):
    """Square (Chebyshev) morphological dilation by k pixels; negative k erodes."""
    if k <= 0: return mask if k == 0 else ~dilate(~mask, -k)
    h, w = mask.shape; p = np.pad(mask, k); rows = np.zeros((h + 2 * k, w), bool); out = np.zeros((h, w), bool)
    for s in range(2 * k + 1): rows |= p[:, s:s + w]
    for s in range(2 * k + 1): out |= rows[s:s + h]
    return out

# ---------- image IO ----------
def load_rgba(path):
    img = bpy.data.images.load(path, check_existing=False); w, h = img.size
    a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a); bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()

def float_image(name, w, h):
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True); img.colorspace_settings.name = 'Non-Color'; return img

def fill_image(img, a):
    """Write an (h, w, 4) array whose first row is the top into an image."""
    img.pixels.foreach_set(np.ascontiguousarray(a[::-1], np.float32).ravel()); img.update()

def save_rgba(a, path):
    h, w = a.shape[:2]; img = bpy.data.images.new('out', w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(a[::-1], np.float32).ravel()); img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)

# ---------- terse node graphs (backdrops, icons) ----------
class Nodes:
    """Tiny builder: every method returns an output socket; numbers become default values."""
    def __init__(s, nt): s.nt = nt
    def _in(s, sock, v):
        if v is None: return
        if isinstance(v, bpy.types.NodeSocket): s.nt.links.new(v, sock)
        elif isinstance(v, (tuple, list)): sock.default_value = tuple(v) + ((1,) if len(v) == 3 and len(sock.default_value) == 4 else ())
        else: sock.default_value = v
    def node(s, kind, inputs=(), **props):
        n = s.nt.nodes.new(kind)
        for k, v in props.items(): setattr(n, k, v)
        for i, v in inputs: s._in(n.inputs[i], v)
        return n
    def coord(s, kind='Object'): return s.node('ShaderNodeTexCoord').outputs[kind]
    def math(s, op, a, b=None, clamp=False): return s.node('ShaderNodeMath', [(0, a), (1, b)], operation=op, use_clamp=clamp).outputs[0]
    def vmath(s, op, a, b=None, scale=None):
        n = s.node('ShaderNodeVectorMath', [(0, a), (1, b)], operation=op)
        if scale is not None: s._in(n.inputs['Scale'], scale)
        return n.outputs['Value' if op in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else 'Vector']
    def xyz(s, v): n = s.node('ShaderNodeSeparateXYZ', [(0, v)]); return n.outputs[0], n.outputs[1], n.outputs[2]
    def vec(s, x, y, z): return s.node('ShaderNodeCombineXYZ', [(0, x), (1, y), (2, z)]).outputs[0]
    def noise(s, v, scale, detail=6, rough=.55, distort=0., w=0., lac=2.):
        n = s.node('ShaderNodeTexNoise', [('Vector', v), ('Scale', scale), ('Detail', detail), ('Roughness', rough), ('Distortion', distort), ('W', w), ('Lacunarity', lac)], noise_dimensions='4D')
        return n.outputs['Fac'], n.outputs['Color']
    def voronoi(s, v, scale, feature='F1', rand=1.):
        n = s.node('ShaderNodeTexVoronoi', [('Vector', v), ('Scale', scale), ('Randomness', rand)], voronoi_dimensions='2D', feature=feature)
        return n.outputs['Distance'], n.outputs['Color']
    def ramp(s, fac, stops): return _ramp(s.nt, fac, stops)
    def mix(s, a, b, fac, blend='MIX'):
        n = s.node('ShaderNodeMix', [('Factor', fac)], data_type='RGBA', blend_type=blend); s._in(n.inputs[6], a); s._in(n.inputs[7], b); return n.outputs[2]
    def maprange(s, v, a, b, c=0., d=1., clamp=True, interp='LINEAR'):
        return s.node('ShaderNodeMapRange', [(0, v), (1, a), (2, b), (3, c), (4, d)], clamp=clamp, interpolation_type=interp).outputs[0]
    def rgb_scale(s, col, k): return s.mix(col, (k, k, k) if not isinstance(k, bpy.types.NodeSocket) else s.node('ShaderNodeCombineColor', [(0, k), (1, k), (2, k)]).outputs[0], 1, 'MULTIPLY')
    def add(s, a, b): return s.mix(a, b, 1, 'ADD')
    def emission(s, col, strength=1.): return s.node('ShaderNodeEmission', [(0, col), (1, strength)]).outputs[0]

def node_material(name, build, **tags):
    """Material whose surface is build(Nodes) → shader socket."""
    return _mat(name, lambda nt: build(Nodes(nt)), **tags)
