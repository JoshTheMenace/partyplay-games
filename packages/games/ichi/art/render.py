# Ichi art: blender -b --python render.py [-- table portrait card]
import bpy, math, os, sys
import numpy as np

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../public/games/ichi'))
JOBS = (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []) or ['table', 'portrait', 'card']


def reset(w, h, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = w, h, 100
    s.cycles.samples, s.cycles.use_denoising = samples, True
    s.view_settings.view_transform = 'Standard'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    s.cycles.device = 'GPU'
    return s


def material(name):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    return m, nt, nt.nodes['Principled BSDF']


def out(x):
    return x if isinstance(x, bpy.types.NodeSocket) else next(o for o in x.outputs if o.enabled)


def sock(n, k):
    return next(i for i in n.inputs if i.enabled and k in (i.identifier, i.name))


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith('_'): setattr(n, k[1:], v)
    for k, v in inputs.items():
        if k.startswith('_'): continue
        if isinstance(v, (bpy.types.Node, bpy.types.NodeSocket)): nt.links.new(out(v), sock(n, k))
        else: sock(n, k).default_value = v
    return n


def link(nt, a, b): nt.links.new(out(a), b)


def mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], faces)
    me.shade_smooth()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def light(kind, loc, power, color, size=1.0, rot=(0, 0, 0)):
    d = bpy.data.lights.new(kind, kind)
    d.energy, d.color = power, color
    if kind == 'AREA': d.size = size
    else: d.shadow_soft_size = size
    if kind == 'SPOT': d.spot_size, d.spot_blend = math.radians(95), 1.0
    ob = bpy.data.objects.new(kind, d)
    ob.location, ob.rotation_euler = loc, rot
    bpy.context.collection.objects.link(ob)
    return ob


def camera(scale, z=20, rot_z=0.0):
    c = bpy.data.cameras.new('cam')
    c.type, c.ortho_scale, c.clip_end = 'ORTHO', scale, 100
    ob = bpy.data.objects.new('cam', c)
    ob.location, ob.rotation_euler = (0, 0, z), (0, 0, rot_z)
    bpy.context.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def render(s, name, quality, rgba=False):
    f = s.render.image_settings
    f.file_format, f.color_mode, f.quality = 'WEBP', 'RGBA' if rgba else 'RGB', quality
    s.render.film_transparent = rgba
    s.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)


# ---------- table ----------

A, B, N_EXP = 7.68, 4.05, 2.35  # oval semi-axes (1 unit = 100 px at 1920 wide) and superellipse exponent


def oval(n=1440):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    p = np.stack([A * np.sign(c) * np.abs(c) ** (2 / N_EXP), B * np.sign(s) * np.abs(s) ** (2 / N_EXP)], 1)
    tan = np.roll(p, -1, 0) - np.roll(p, 1, 0)
    nrm = np.stack([tan[:, 1], -tan[:, 0]], 1)
    return p, nrm / np.linalg.norm(nrm, axis=1, keepdims=True)


def loft(name, profile, mat):
    """Sweep a (offset, z) cross-section around the oval using parallel offsets so the rim width stays uniform."""
    p, n = oval()
    P, L = len(profile), len(p)
    verts = [(*(p[i] + n[i] * r), z) for i in range(L) for r, z in profile]
    faces = [(i * P + j, i * P + j + 1, ((i + 1) % L) * P + j + 1, ((i + 1) % L) * P + j) for i in range(L) for j in range(P - 1)]
    return mesh(name, verts, faces, mat)


def arc(cx, cz, r, a0, a1, k=10):
    return [(cx + r * math.cos(a), cz + r * math.sin(a)) for a in np.linspace(math.radians(a0), math.radians(a1), k)]


def rim_z(r): return 0.16 + 0.035 * math.sin(math.pi * (r + 0.64) / 0.54)


def felt_material():
    m, nt, bsdf = material('felt')
    co = node(nt, 'ShaderNodeTexCoord')
    fine = node(nt, 'ShaderNodeTexNoise', Vector=co.outputs['Object'], Scale=45.0, Detail=10.0, Roughness=0.75)
    fibre = node(nt, 'ShaderNodeTexNoise', Vector=node(nt, 'ShaderNodeMapping', Vector=co.outputs['Object'], Scale=(1, 7, 1)), Scale=30.0, Detail=4.0)
    mottle = node(nt, 'ShaderNodeTexNoise', Vector=co.outputs['Object'], Scale=0.35, Detail=3.0)
    ramp = node(nt, 'ShaderNodeValToRGB', Fac=mottle.outputs['Fac'])
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.3, 0.75
    ramp.color_ramp.elements[0].color = (0.003, 0.022, 0.085, 1)
    ramp.color_ramp.elements[1].color = (0.004, 0.034, 0.092, 1)
    grain = node(nt, 'ShaderNodeMix', _data_type='RGBA', _blend_type='MULTIPLY', Factor=1.0)
    speck = node(nt, 'ShaderNodeMapRange', Value=fine.outputs['Fac'], **{'From Min': 0.3, 'From Max': 0.7, 'To Min': 0.72, 'To Max': 1.12})
    link(nt, ramp, sock(grain, 'A')); link(nt, speck, sock(grain, 'B'))
    link(nt, grain, bsdf.inputs['Base Color'])
    h = node(nt, 'ShaderNodeMath', _operation='ADD', Value=fine.outputs['Fac'])
    link(nt, fibre.outputs['Fac'], h.inputs[1])
    link(nt, node(nt, 'ShaderNodeBump', Height=h, Strength=0.3, Distance=0.01), bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.2
    bsdf.inputs['Sheen Weight'].default_value = 0.35
    bsdf.inputs['Sheen Tint'].default_value = (0.1, 0.5, 0.8, 1)
    return m


def wood_material():
    m, nt, bsdf = material('lacquer')
    co = node(nt, 'ShaderNodeTexCoord')
    wave = node(nt, 'ShaderNodeTexWave', Vector=node(nt, 'ShaderNodeMapping', Vector=co.outputs['Object'], Scale=(0.1, 1.0, 1)),
                _bands_direction='Y', Scale=2.5, Distortion=5.0, Detail=6.0, **{'Detail Scale': 1.2})
    ramp = node(nt, 'ShaderNodeValToRGB', Fac=wave.outputs['Fac'])
    ramp.color_ramp.elements[0].color = (0.009, 0.002, 0.0015, 1)
    ramp.color_ramp.elements[1].color = (0.050, 0.012, 0.006, 1)
    link(nt, ramp, bsdf.inputs['Base Color'])
    link(nt, node(nt, 'ShaderNodeBump', Height=wave.outputs['Fac'], Strength=0.04), bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Coat Weight'].default_value = 1.0
    bsdf.inputs['Coat Roughness'].default_value = 0.06
    return m


def gold_material():
    m, nt, bsdf = material('gold')
    bsdf.inputs['Base Color'].default_value = (1.0, 0.66, 0.26, 1)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.28
    return m


def vignette(w, h, z, inner, outer, amount):
    """Camera-only plane darkening the frame edges toward ink."""
    m = bpy.data.materials.new('vignette')
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    co = node(nt, 'ShaderNodeTexCoord')
    centred = node(nt, 'ShaderNodeVectorMath', _operation='SUBTRACT', Vector=co.outputs['Generated'])
    centred.inputs[1].default_value = (0.5, 0.5, 0.5)
    scaled = node(nt, 'ShaderNodeVectorMath', _operation='MULTIPLY', Vector=centred)
    scaled.inputs[1].default_value = (2, 2, 0)
    d = node(nt, 'ShaderNodeVectorMath', _operation='LENGTH', Vector=scaled)
    fac = node(nt, 'ShaderNodeMapRange', Value=d.outputs['Value'], **{'From Min': inner, 'From Max': outer, 'To Max': amount}, _interpolation_type='SMOOTHSTEP')
    mix = node(nt, 'ShaderNodeMixShader', Fac=fac)
    link(nt, node(nt, 'ShaderNodeBsdfTransparent'), mix.inputs[1])
    link(nt, node(nt, 'ShaderNodeEmission', Color=(0.0015, 0.002, 0.008, 1), Strength=1.0), mix.inputs[2])
    link(nt, mix, nt.nodes['Material Output'].inputs['Surface'])
    ob = mesh('vignette', [(-w / 2, -h / 2, z), (w / 2, -h / 2, z), (w / 2, h / 2, z), (-w / 2, h / 2, z)], [(0, 1, 2, 3)], m)
    for k in ('diffuse', 'glossy', 'transmission', 'volume_scatter', 'shadow'): setattr(ob, 'visible_' + k, False)


def table_scene(portrait=False):
    s = reset(1080, 1920, 96) if portrait else reset(1920, 1080, 128)
    s.cycles.transparent_max_bounces = 8
    world = bpy.data.worlds.new('w'); s.world = world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.005, 0.014, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0

    felt = felt_material()
    p, n = oval()
    inner = p + n * -0.72
    mesh('felt', [(0, 0, 0)] + [(x, y, 0) for x, y in inner], [(0, i + 1, (i + 1) % len(inner) + 1) for i in range(len(inner))], felt)
    top = [(r, rim_z(r)) for r in np.linspace(-0.64, -0.10, 28)]
    profile = [(-0.72, 0.0)] + arc(-0.64, 0.08, 0.08, 180, 90) + top[1:] + arc(-0.10, rim_z(-0.10) - 0.10, 0.10, 90, 0)[1:] + [(0.0, -0.9), (-0.05, -0.95)]
    loft('rim', profile, wood_material())
    ri = -0.53
    loft('inlay', [(ri + 0.022 * math.cos(a), rim_z(ri) - 0.012 + 0.022 * math.sin(a)) for a in np.linspace(math.pi, 0, 8)], gold_material())

    fm, nt, bsdf = material('floor')
    co = node(nt, 'ShaderNodeTexCoord')
    ramp = node(nt, 'ShaderNodeValToRGB', Fac=node(nt, 'ShaderNodeTexNoise', Vector=co.outputs['Object'], Scale=2.0, Detail=6.0))
    ramp.color_ramp.elements[0].color = (0.004, 0.004, 0.010, 1)
    ramp.color_ramp.elements[1].color = (0.012, 0.009, 0.014, 1)
    link(nt, ramp, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.6
    mesh('floor', [(-30, -30, -1.4), (30, -30, -1.4), (30, 30, -1.4), (-30, 30, -1.4)], [(0, 1, 2, 3)], fm)

    light('SPOT', (-6.0, 3.6, 6.5), 7000, (1.0, 0.62, 0.32), size=1.6, rot=(math.radians(-22), math.radians(-38), 0))   # paper lantern, upper-left
    light('AREA', (3, -4, 9), 220, (0.7, 0.85, 1.0), size=3.5, rot=(math.radians(25), math.radians(15), 0))  # soft fill, off-axis so the lacquer stays dark
    light('AREA', (8, -5, 4), 120, (0.35, 0.75, 1.0), size=4, rot=(0.9, 0, 0.9))  # faint cool bounce, lower-right
    if portrait:
        camera(12.5, rot_z=math.pi / 2)
        ng = s.compositing_node_group = bpy.data.node_groups.new('soften', 'CompositorNodeTree')
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        blur = node(ng, 'CompositorNodeBlur', Image=ng.nodes.new('CompositorNodeRLayers').outputs['Image'], Size=(22, 22))
        link(ng, blur, ng.nodes.new('NodeGroupOutput').inputs[0])
        vignette(12.5, 7.1, 19, 0.3, 1.2, 0.9)  # long side is world X = screen vertical
        s.view_settings.exposure = -0.9
    else:
        camera(19.2)
        vignette(19.2, 10.8, 19, 0.7, 1.3, 0.96)
    return s


# ---------- card back ----------

CW, CH, CR = 5.0, 7.0, 0.34  # card size in units (100 px each) and corner radius


def sd_round_rect(x, y, hw, hh, r):
    qx, qy = np.abs(x) - hw + r, np.abs(y) - hh + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def band(v, c, w, aa):
    return np.clip((w / 2 - np.abs(v - c)) / aa + 0.5, 0, 1)


def seigaiha(x, y, R):
    """Ring distance (0..1) of the top-most overlapping wave scale at each point."""
    best = np.full(x.shape, 2.0)
    row0 = np.floor(y / (R / 2))
    for k in range(-1, 4):  # lower rows are drawn later and cover earlier ones
        j = row0 - k
        cy = j * R / 2
        off = np.where(j % 2 == 0, 0.0, R)
        cx = np.round((x - off) / (2 * R)) * 2 * R + off
        d = np.hypot(x - cx, y - cy) / R
        inside = (d < 1) & (best == 2.0)
        best = np.where(inside, d, best)
    return best


def asanoha(x, y, s):
    """Distance to the hemp-leaf lattice with triangle side s."""
    h = s * math.sqrt(3) / 2
    f = [(nx * x + ny * y) / h for nx, ny in ((0, 1), (-math.sqrt(3) / 2, -0.5), (math.sqrt(3) / 2, -0.5))]
    fr = [v - np.floor(v) for v in f]
    up = (fr[0] + fr[1] + fr[2]) < 1.5
    l = [np.where(up, v, 1 - v) for v in fr]
    d = np.minimum.reduce([v * h for v in l])
    for i in range(3):
        a, b = l[(i + 1) % 3], l[(i + 2) % 3]
        d = np.minimum(d, np.where(l[i] >= 1 / 3, np.abs(a - b) * h / math.sqrt(3), 1e3))
    return d


def card_masks(res=3):
    W, H = int(CW * 100 * res), int(CH * 100 * res)
    x, y = np.meshgrid((np.arange(W) + 0.5) / W * CW - CW / 2, (np.arange(H) + 0.5) / H * CH - CH / 2)
    e = -sd_round_rect(x, y, CW / 2, CH / 2, CR)  # distance inside the card edge
    aa = 1.2 / (100 * res)
    rings = seigaiha(x + 0.1, y, 0.2)
    wave = np.maximum.reduce([band(rings, c, 0.13, aa / 0.2) for c in (0.93, 0.62, 0.31)] + [np.clip((0.1 - rings) / (aa / 0.2) + 0.5, 0, 1)])
    in_band = np.clip((e - 0.285) / aa, 0, 1) * np.clip((0.655 - e) / aa, 0, 1)
    gold = np.maximum.reduce([band(e, 0.19, 0.035, aa), band(e, 0.26, 0.018, aa), wave * in_band, band(e, 0.68, 0.018, aa), band(e, 0.75, 0.035, aa)])
    r = np.hypot(x, y * 0.8)
    leaf = band(asanoha(x, y, 0.42), 0, 0.022, aa) * (e > 0.8) * np.clip((r - 0.9) / 1.2, 0, 1)
    glow = np.clip(1 - r / 2.4, 0, 1) ** 1.5
    img = bpy.data.images.new('masks', W, H, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.stack([gold, leaf, glow, np.ones_like(gold)], -1).astype(np.float32).ravel())
    return img


def round_rect_curve(name, hw, hh, r, extrude, bevel, mat, z=0.0):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions, cu.fill_mode, cu.extrude, cu.bevel_depth, cu.bevel_resolution = '2D', 'BOTH', extrude, bevel, 4
    pts = []
    for cx, cy, a0 in ((hw - r, hh - r, 0), (-hw + r, hh - r, 90), (-hw + r, -hh + r, 180), (hw - r, -hh + r, 270)):
        pts += [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in np.linspace(a0, a0 + 90, 16)]
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1); sp.use_cyclic_u = True
    for pt, (px, py) in zip(sp.points, pts): pt.co = (px, py, 0, 1)
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu); ob.location.z = z
    bpy.context.collection.objects.link(ob)
    return ob


# Brush outline of the "一" stroke: pressed diagonal entry at left, a slightly waisted body, then a tail that
# lifts off to a soft point, so it reads as ink rather than a bar with two knobs. 'v' = sharp corner.
STROKE = [(-1.92, 0.28, 'v'), (-1.62, 0.46), (-1.20, 0.42), (-0.50, 0.33), (0.30, 0.30), (1.00, 0.28), (1.50, 0.22),
          (1.86, 0.10), (2.00, -0.02), (1.80, -0.12), (1.30, -0.16), (0.60, -0.18), (-0.30, -0.22), (-1.10, -0.28),
          (-1.50, -0.32), (-1.76, -0.20)]


def smooth_outline(pts, k=24):
    """Closed Catmull-Rom through the points; 'v' points stay sharp corners."""
    P = np.array([p[:2] for p in pts]); n = len(P); out = []
    for i in range(n):
        p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % n], P[(i + 2) % n]
        if len(pts[i]) > 2: p0 = p1
        if len(pts[(i + 1) % n]) > 2: p3 = p2
        for t in np.linspace(0, 1, k, endpoint=False):
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    return out


def stroke(mat, z, k=1.0):
    pts = [(k * x, k * (1.15 * y + 0.04 * x + 0.06 * (1 - (x / 1.68) ** 2)), 0) for x, y in np.array(smooth_outline(STROKE)) * (0.86, 1)]  # rises right, gently arched
    ob = mesh("ichi", pts, [tuple(range(len(pts)))[::-1]], mat)  # outline is clockwise; reverse so the face points up
    ob.location.z = z
    sol = ob.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness, sol.offset = 0.08 * k, 1.0
    bev = ob.modifiers.new('bevel', 'BEVEL')
    bev.width, bev.segments, bev.limit_method, bev.angle_limit, bev.harden_normals = 0.06 * k, 6, 'ANGLE', math.radians(50), True
    bev.use_clamp_overlap = False
    return ob


def card_scene():
    s = reset(500, 700, 256)
    world = bpy.data.worlds.new('w'); s.world = world
    nt = world.node_tree
    # Soft warm "softbox" up and to the upper-left, dark navy elsewhere: this is what the gold and lacquer reflect.
    dot = node(nt, 'ShaderNodeVectorMath', _operation='DOT_PRODUCT', Vector=node(nt, 'ShaderNodeTexCoord').outputs['Generated'])
    dot.inputs[1].default_value = (-0.34, 0.4, 0.85)
    ramp = node(nt, 'ShaderNodeValToRGB', Fac=dot.outputs['Value'])
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.55, (0.004, 0.006, 0.02, 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 1.0, (1.4, 1.1, 0.8, 1)
    link(nt, ramp, nt.nodes['Background'].inputs['Color'])

    masks = card_masks()
    m, nt, bsdf = material('card')
    co = node(nt, 'ShaderNodeTexCoord')
    uv = node(nt, 'ShaderNodeMapping', Vector=co.outputs['Object'], Location=(0.5, 0.5, 0), Scale=(1 / CW, 1 / CH, 1))
    tex = node(nt, 'ShaderNodeTexImage', Vector=uv, _image=masks, _interpolation='Cubic')
    sep = node(nt, 'ShaderNodeSeparateColor', Color=tex)
    lacq = node(nt, 'ShaderNodeMix', _data_type='RGBA', Factor=sep.outputs['Green'], A=(0.004, 0.005, 0.034, 1), B=(0.018, 0.022, 0.120, 1))
    halo = node(nt, 'ShaderNodeMix', _data_type='RGBA', Factor=sep.outputs['Blue'], A=lacq, B=(0.022, 0.028, 0.150, 1))
    col = node(nt, 'ShaderNodeMix', _data_type='RGBA', Factor=sep.outputs['Red'], A=halo, B=(1.0, 0.68, 0.26, 1))
    link(nt, col, bsdf.inputs['Base Color'])
    link(nt, sep.outputs['Red'], bsdf.inputs['Metallic'])
    link(nt, node(nt, 'ShaderNodeMapRange', Value=sep.outputs['Red'], **{'To Min': 0.2, 'To Max': 0.3}), bsdf.inputs['Roughness'])
    link(nt, node(nt, 'ShaderNodeMapRange', Value=sep.outputs['Red'], **{'To Min': 0.1, 'To Max': 0.5}), bsdf.inputs['Specular IOR Level'])
    link(nt, node(nt, 'ShaderNodeMapRange', Value=sep.outputs['Red'], **{'To Min': 0.12, 'To Max': 0.0}), bsdf.inputs['Coat Weight'])
    h = node(nt, 'ShaderNodeMath', _operation='MULTIPLY_ADD', Value=sep.outputs['Green'], Value_001=0.3, Value_002=sep.outputs['Red'])
    link(nt, node(nt, 'ShaderNodeBump', Height=h, Strength=0.5, Distance=0.004), bsdf.inputs['Normal'])
    bsdf.inputs['Coat Roughness'].default_value = 0.08
    round_rect_curve('card', CW / 2 - 0.02 - 0.006, CH / 2 - 0.02 - 0.006, CR - 0.02, 0.01, 0.02, m)

    g, nt, bsdf = material('stroke-gold')
    streak = node(nt, 'ShaderNodeTexNoise', Vector=node(nt, 'ShaderNodeMapping', Vector=node(nt, 'ShaderNodeTexCoord').outputs['Object'], Scale=(0.5, 34, 1)), Scale=3.0, Detail=8.0, Roughness=0.6)
    # dry-brush gaps (kasure) toward the tail let the lacquer show through
    dry = node(nt, 'ShaderNodeMapRange', Value=streak.outputs['Fac'], **{'From Min': 0.52, 'From Max': 0.56})
    tail = node(nt, 'ShaderNodeMapRange', Value=node(nt, 'ShaderNodeSeparateXYZ', Vector=node(nt, 'ShaderNodeTexCoord').outputs['Object']).outputs['X'], **{'From Min': 0.1, 'From Max': 1.6})
    kasure = node(nt, 'ShaderNodeMath', _operation='MULTIPLY', Value=dry, Value_001=tail)
    bsdf.inputs['Base Color'].default_value = (1.0, 0.72, 0.28, 1)
    link(nt, node(nt, 'ShaderNodeMath', _operation='SUBTRACT', Value=1.0, Value_001=kasure), bsdf.inputs['Alpha'])
    bsdf.inputs['Metallic'].default_value = 1.0
    link(nt, node(nt, 'ShaderNodeMapRange', Value=streak.outputs['Fac'], **{'To Min': 0.16, 'To Max': 0.34}), bsdf.inputs['Roughness'])
    link(nt, node(nt, 'ShaderNodeBump', Height=streak.outputs['Fac'], Strength=0.35, Distance=0.02), bsdf.inputs['Normal'])
    # A square vermilion seal (hanko), stamped slightly askew, carries the stroke: from across a room it reads
    # as a stamp, not a shape. (A round red seal with a bar read as a no-entry sign.)
    red, nt, bsdf = material('seal')
    bsdf.inputs['Base Color'].default_value = (0.42, 0.018, 0.012, 1)
    bsdf.inputs['Roughness'].default_value = 0.4
    bsdf.inputs['Coat Weight'].default_value = 0.3
    ring = round_rect_curve('seal-ring', 1.0, 1.0, 0.1, 0.0, 0.0, g, z=0.08)
    ring.data.fill_mode, ring.data.bevel_depth = 'NONE', 0.032
    for ob in (round_rect_curve('seal', 1.18, 1.18, 0.16, 0.03, 0.03, red, z=0.02), ring, stroke(g, 0.08, k=0.56)):
        ob.rotation_euler.z = math.radians(-5)

    light('AREA', (-3, 4, 8), 600, (1.0, 0.9, 0.78), size=5, rot=(math.radians(-25), math.radians(-20), 0))
    camera(CH)
    return s


if 'table' in JOBS: render(table_scene(), 'table.webp', 90)
if 'portrait' in JOBS: render(table_scene(portrait=True), 'table-portrait.webp', 72)
if 'card' in JOBS: render(card_scene(), 'card-back.webp', 90, rgba=True)
