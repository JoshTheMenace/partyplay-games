"""Preview renders for the art bundles: a lineup on a neutral ground under the board's lights and
its 32-degree camera, plus a second row recoloured per seat. Blender coordinates (z up) here."""
import bpy, math
from mathutils import Vector
from common import COLORS, TILT, linear, material

SEATS = [('#d8352e', '#a3231e'), ('#2563d9', '#1a47a0'), ('#3fae47', '#2c7f33'), ('#8a4fe0', '#6334aa'),
         ('#ffd23a', '#c9a01c'), ('#ff7ac2', '#d04f93'), ('#1fc0ad', '#12887a'), ('#ff8a1f', '#c96410'),
         ('#e6ecff', '#aab6d9'), ('#c6dc2c', '#93a61a')]


def flat(name, hex_):
    COLORS[name] = hex_; return material(name)


def emblem_texture():
    """Stand-in for the runtime emblem atlas: an ink triangle on a clear square."""
    size = 64; img = bpy.data.images.new('emblem', size, size, alpha=True); px = []
    for y in range(size):
        for x in range(size):
            u, v = (x + 0.5) / size, (y + 0.5) / size
            inside = 0.12 < v < 0.86 and abs(u - 0.5) < (0.86 - v) * 0.58
            px += [0.0015, 0.002, 0.01, 0.7 if inside else 0]
    img.pixels = px
    m = material('decal'); nodes = m.node_tree.nodes; tex = nodes.new('ShaderNodeTexImage'); tex.image = img
    bsdf = nodes['Principled BSDF']
    m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    m.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])


def tree(o):
    return [o] + [d for c in o.children for d in tree(c)]


def recolour(root, seat):
    seat_mat = flat(f'seat{seat}', SEATS[seat][0]), flat(f'seat{seat}_dark', SEATS[seat][1])
    for o in tree(root):
        for slot in o.material_slots:
            if slot.material and slot.material.name in ('seat', 'seat_dark'):
                pick = seat_mat[slot.material.name == 'seat_dark']; slot.link = 'OBJECT'; slot.material = pick


def duplicate(o, parent=None):
    c = o.copy(); bpy.context.scene.collection.objects.link(c); c.parent = parent
    for k in o.children: duplicate(k, c)
    return c


def extent(o, axis):
    cs = [(o.matrix_world @ Vector(v.co))[axis] for d in tree(o) for v in d.data.vertices]
    return max(cs) - min(cs)


def preview(roots, path, rows=1, seats=True, gap=0.22, res=(1600, 900)):
    """Lay the roots out in `rows` rows; if `seats`, add a recoloured copy of each row below."""
    for o in bpy.data.objects:
        if o.name.endswith('_outline'):  # the runtime uses BackSide; flipped + culled is the same look
            o.data.flip_normals()
    emblem_texture()
    per = math.ceil(len(roots) / rows); lines = [roots[i:i + per] for i in range(0, len(roots), per)]
    if seats: lines += [[duplicate(o) for o in line] for line in lines]
    y, span = 0.0, 0.0
    for r, line in enumerate(lines):
        total = sum(extent(o, 0) for o in line) + gap * (len(line) - 1); x = -total / 2
        depth = max(extent(o, 1) for o in line); y -= depth / 2
        for i, o in enumerate(line):
            w = extent(o, 0); o.location = (x + w / 2, y, 0); x += w + gap
            if seats and r >= len(lines) // 2: recolour(o, (i % 9) + 1)
        span = max(span, total); y -= depth / 2 + gap * 1.6
    tall = (-y - gap * 1.6) * math.cos(TILT) + 0.4
    stage(path, (0, (y + gap * 1.6) / 2 + 0.1, 0.1), max(span + 0.5, (tall + 0.3) * res[0] / res[1]), res)


def stage(path, centre, ortho, res):
    """Neutral ground, the board's lights (no shadow maps) and its 32-degree orthographic camera."""
    ground = bpy.data.meshes.new('ground'); s = 40
    ground.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ground.materials.append(flat('ground', '#a9b0a3'))
    bpy.context.scene.collection.objects.link(bpy.data.objects.new('ground', ground))
    light('key', (-12, -14, 24), '#fff1d6', 3.2); light('fill', (16, 12, 10), '#9fd6ff', 0.8)
    world = bpy.data.worlds.new('sky'); bpy.context.scene.world = world
    world.color = linear('#9fb7cc')[:3]
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    cam.rotation_euler = (TILT, 0, 0)
    cam.location = Vector(centre) + Vector((0, -math.sin(TILT), math.cos(TILT))) * 20
    scene = bpy.context.scene; scene.camera = cam; scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = 'Standard'; scene.eevee.taa_render_samples = 32
    scene.render.dither_intensity = 0; scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 100
    scene.render.filepath = str(path); path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def light(name, direction, hex_, energy):
    sun = bpy.data.lights.new(name, 'SUN'); sun.color = linear(hex_)[:3]
    sun.energy = energy; sun.use_shadow = False
    o = bpy.data.objects.new(name, sun); bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = Vector(direction).to_track_quat('Z', 'Y').to_euler()


def vignette(path, px_per_wu=80):
    """TV-scale check: pieces on three land hexes and one sea hex at the board's 80 px/wu."""
    from common import Part
    for o in list(bpy.data.objects):
        if o.name in ('ground', 'key', 'fill', 'cam'): bpy.data.objects.remove(o)
        else: o.hide_render = True
    tiles = {(0, 0): '#3f7d4e', (1, 0): '#d4a843', (0, 1): '#b8633f', (1, -1): '#2b86b8'}
    for (q, r), top in tiles.items():
        x, z = math.sqrt(3) * (q + r / 2), 1.5 * r; sea = top == '#2b86b8'
        hexagon = [(x + 0.985 * math.cos(a), z + 0.985 * math.sin(a))
                   for a in (math.radians(90 + 60 * k) for k in range(6))]
        flat(f'tile{q}{r}', top); flat('token', '#fff6e5')
        p = Part().extrude(hexagon, 0, 0.02 if sea else 0.30, f'tile{q}{r}', outline=False)
        if not sea: p.lathe([(0.29, 0.30), (0.29, 0.335)], 'token', n=24, at=(x, 0, z), outline=False)
        p.build(f'tile{q}{r}')
    corner = lambda x, z, k: (x + math.cos(math.radians(90 + 60 * k)), z + math.sin(math.radians(90 + 60 * k)))
    def edge(x, z, k):
        (ax, az), (bx, bz) = corner(x, z, k), corner(x, z, k + 1)
        return ((ax + bx) / 2, (az + bz) / 2), math.degrees(math.atan2(-(bz - az), bx - ax))
    rob = (0.5 * math.cos(math.radians(-120)), 0.5 * math.sin(math.radians(-120)))
    place = [('settlement', corner(0, 0, 4), 0, 0.30, 0), ('city', corner(0, 0, 0), 0, 0.30, 1),
             ('road', *edge(0, 0, 4), 0.30, 0), ('road', *edge(0, 0, 5), 0.30, 1), ('robber', rob, 0, 0.30, 0),
             ('ship', (0.433 + 0.1, -0.75 - 0.17), -30, 0.02, 4),  # nudged seaward to stay visible
             ('settlement', corner(1.732, 0, 4), 0, 0.30, 5)]
    for name, (x, z), yaw, y, seat in place:
        o = duplicate(bpy.data.objects[name])
        o.location, o.rotation_euler = (x, -z, y), (0, 0, math.radians(yaw))
        for d in tree(o): d.hide_render = False
        if seat: recolour(o, seat)
    stage(path, (0.85, 0.3, 0.3), 640 / px_per_wu, (640, 400))
