"""Render HUD icons and QA preview sheets from kitchen-kit.blend (run build_kit.py first).

  blender --background art/kitchen-kit.blend --python-exit-code 1 --python art/render_kit.py -- [icons] [sheets]

Icons: public/games/kitchen-rush/icons/*.png (256×256, transparent, one shared 3/4 camera and light rig).
Sheets: <platform>/output/kitchen-rush/v2/art/*.png (stations, food, dishes/items, props, a game-camera kitchen).
"""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector

ART = Path(bpy.data.filepath).resolve().parent
PUBLIC = ART.parents[3] / 'public/games/kitchen-rush'
SHEETS = ART.parents[4] / 'output/kitchen-rush/v2/art'
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['icons', 'sheets']
scene = bpy.context.scene
ASSETS = {o.name: o for o in scene.objects if o.parent is None}
for root in ASSETS.values():
    for o in [root, *root.children_recursive]:
        o.hide_render = True
LIVE = []


def g2b(x, y, z):
    return Vector((x, -z, y))


def lin(h):
    h = h.lstrip('#')
    return tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)))


def inst(name, x=0, y=0, z=0, yaw=0, team=None, scale=1):
    """Duplicate an asset hierarchy (sharing mesh data) at game position (x, y, z)."""
    def copy(src, parent):
        dup = src.copy()
        scene.collection.objects.link(dup)
        dup.parent, dup.hide_render = parent, False
        if team and dup.type == 'MESH' and dup.data.materials[0].name == 'TeamColor':
            dup.data = dup.data.copy()
            mat = dup.data.materials[0].copy()
            base = mat.node_tree.nodes['Principled BSDF'].inputs['Base Color']
            for link in list(base.links):
                mat.node_tree.links.remove(link)
            base.default_value = (*lin(team), 1)
            dup.data.materials[0] = mat
        LIVE.append(dup)
        for kid in src.children:
            copy(kid, dup)
        return dup
    root = copy(ASSETS[name], None)
    root.location, root.rotation_euler.z, root.scale = g2b(x, y, z), math.radians(yaw), (scale,) * 3
    return root


def clear():
    for o in LIVE:
        bpy.data.objects.remove(o)
    LIVE.clear()


def bounds():
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in LIVE if o.type == 'MESH' and not o.name.startswith('Ground') for c in o.bound_box]
    return Vector(map(min, *pts)), Vector(map(max, *pts))


def light(name, loc, energy, size, colour=(1, 1, 1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.size, data.color, data.shape = energy, size, colour, 'DISK'
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return obj


def aim(cam, target, direction, distance):
    cam.location = target + direction.normalized() * distance
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()


cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = 'CYCLES'
scene.cycles.device, scene.cycles.samples, scene.cycles.use_denoising = 'CPU', 48, True
scene.view_settings.view_transform, scene.view_settings.look = 'Standard', 'None'
world = scene.world or bpy.data.worlds.new('World')
scene.world = world
world.color = (.42, .4, .38)
if world.node_tree:
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.42, .4, .38, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
rig = [light('Key', (-3.5, -4, 6), 650, 4, (1, .96, .9)), light('Fill', (5, -3, 2.5), 180, 5, (.85, .9, 1)), light('Rim', (1, 5, 4), 380, 3)]

ICON_DIR = Vector((.62, -1.25, .95))  # the one 3/4 view for every icon: front-right, ~35° above
BUST_DIR = Vector((.4, -1.25, .32))


def fit_ortho(margin=1.1, bust=False):
    """Centre the ortho camera on the live objects' projected silhouette box and size it to fit.
    Characters use a lower, more frontal bust framing (head and shoulders) like a lobby portrait."""
    lo, hi = bounds()
    if bust:
        lo.z = lo.z + (hi.z - lo.z) * .42
    aim(cam, (lo + hi) / 2, BUST_DIR if bust else ICON_DIR, 20)
    bpy.context.view_layer.update()
    right, up = cam.matrix_world.col[0].xyz, cam.matrix_world.col[1].xyz
    pts = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    xs, ys = [p.dot(right) for p in pts], [p.dot(up) for p in pts]
    cam.location += right * ((max(xs) + min(xs)) / 2 - cam.location.dot(right)) + up * ((max(ys) + min(ys)) / 2 - cam.location.dot(up))
    cam.data.type, cam.data.ortho_scale = 'ORTHO', max(max(xs) - min(xs), max(ys) - min(ys)) * margin


def render_icon(name, parts, bust=False):
    clear()
    for part in parts:
        inst(*part) if isinstance(part, tuple) else inst(part)
    fit_ortho(bust=bust)
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.film_transparent = True
    scene.render.filepath = str(PUBLIC / 'icons' / f'{name}.png')
    bpy.ops.render.render(write_still=True)


FOOD = {'lettuce': ['raw', 'chopped'], 'tomato': ['raw', 'chopped', 'cooked'], 'onion': ['raw', 'chopped', 'cooked'],
        'patty': ['raw', 'chopped', 'cooked'], 'bun': ['raw'], 'dough': ['raw', 'cooked'], 'cheese': ['raw', 'chopped']}
RECIPES = ['side_salad', 'salad', 'tomato_soup', 'onion_soup', 'burger', 'cheeseburger', 'deluxe_burger', 'pizza']


def icons():
    for food, states in FOOD.items():
        for state in states:
            render_icon(f'food_{food}_{state}', [f'{food}_{state}'])
    # One charred model covers every burnt state; each ingredient keeps its own icon name.
    for food in ['burnt', *FOOD]:
        render_icon('food_burnt' if food == 'burnt' else f'food_{food}_burnt', ['burnt'])
    for recipe in RECIPES:
        render_icon(f'dish_{recipe}', ['plate', (f'dish_{recipe}', 0, .03, 0)])
    for item in ['plate', 'plate_dirty', 'pot', 'pan', 'extinguisher']:
        render_icon(f'item_{item}', [item])
    characters()


def characters():
    for chef in ['chef', 'chef_f']:
        render_icon(f'character_{chef}', [(chef, 0, 0, 0, 0, '#ff6b4a')], bust=True)
    animals()


def animals():
    """Contributor animal chefs (models/kitchen-rush.glb, Aaron Hendricks) in the same icon rig; colour part tinted."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(PUBLIC / 'models/kitchen-rush.glb'))
    parts = {o.name.split('.')[0]: o for o in set(bpy.data.objects) - before}
    for o in parts.values():
        o.hide_render = True
    tint = bpy.data.materials.new('AnimalTeam')
    nodes, links = tint.node_tree.nodes, tint.node_tree.links
    colour, mul = nodes.new('ShaderNodeVertexColor'), nodes.new('ShaderNodeMix')
    mul.data_type, mul.blend_type, mul.inputs['Factor'].default_value = 'RGBA', 'MULTIPLY', 1
    mul.inputs['B'].default_value = (*lin('#ff6b4a'), 1)
    links.new(colour.outputs['Color'], mul.inputs['A'])
    links.new(mul.outputs['Result'], nodes['Principled BSDF'].inputs['Base Color'])
    for animal in ['cat', 'dog', 'iguana', 'axolotl']:
        clear()
        for part in [f'{animal}_body', f'{animal}_color', f'{animal}_left_hand', f'{animal}_right_hand', 'chef_left_foot', 'chef_right_foot']:
            dup = parts[part].copy()
            scene.collection.objects.link(dup)
            dup.hide_render = False
            if part.endswith('_color'):
                dup.data = dup.data.copy()
                dup.data.materials.clear()
                dup.data.materials.append(tint)
            LIVE.append(dup)
        fit_ortho(bust=True)
        scene.render.filepath = str(PUBLIC / 'icons' / f'character_{animal}.png')
        bpy.ops.render.render(write_still=True)


def label(text, x, z, size=.16):
    bpy.ops.object.text_add(location=g2b(x, .005, z), rotation=(0, 0, 0))
    t = bpy.context.object
    t.data.body, t.data.align_x, t.data.size = text, 'CENTER', size
    mat = bpy.data.materials.get('LabelInk') or bpy.data.materials.new('LabelInk')
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.02, .02, .03, 1)
    t.data.materials.append(mat)
    LIVE.append(t)


def ground(colour=(.36, .42, .44)):
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -.001))
    g = bpy.context.object
    g.name = 'Ground'
    mat = bpy.data.materials.new('Ground')
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*colour, 1)
    g.data.materials.append(mat)
    LIVE.append(g)


def sheet(name, rows, spacing=1.35, row_gap=1.5, labels=True, res=(1600, 1000), elev=(.0, -1.5, 1.35), extra=None, lsize=.1):
    clear()
    ground()
    for r, row in enumerate(rows):
        for c, item in enumerate(row):
            x, z = (c - (len(row) - 1) / 2) * spacing, (r - (len(rows) - 1) / 2) * row_gap
            for part in item if isinstance(item, list) else [item]:
                n, *rest = part if isinstance(part, tuple) else (part,)
                inst(n, x + (rest[0] if rest else 0), rest[1] if len(rest) > 1 else 0, z + (rest[2] if len(rest) > 2 else 0), *rest[3:])
            if labels:
                first = item[0] if isinstance(item, list) else item
                label((first[0] if isinstance(first, tuple) else first).replace('dish_', '').replace('prop_', ''), x, z + min(row_gap * .42, .62), lsize)
    if extra:
        extra()
    lo, hi = bounds()
    centre = (lo + hi) / 2
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(hi.x - lo.x, (hi.y - lo.y) * res[0] / res[1] * .85) * 1.06
    aim(cam, centre, Vector(elev), 30)
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.render.filepath = str(SHEETS / f'{name}.png')
    bpy.ops.render.render(write_still=True)


KITCHEN = [  # a 14×8 mock level in the real map legend (maps are counters all round; the scene adds a back wall row)
    '#l#t#o##O#O#VH',
    'C............#',
    '#..@....@....R',
    'C...##>>##...#',
    '#...#E..##...W',
    'p..@.......@.D',
    'b............#',
    '##X#C#F#F##c##',
]
STATION = {'#': 'counter', 'E': 'counter', 'C': 'board', 'O': 'stove', 'F': 'stove', 'V': 'oven', 'W': 'sink', 'R': 'rack',
           'D': 'return', 'H': 'serve', 'X': 'bin', '>': 'belt'}
CRATES = {'l': 'lettuce', 't': 'tomato', 'o': 'onion', 'p': 'patty', 'b': 'bun', 'd': 'dough', 'c': 'cheese'}
# Item heights the scene uses (scene/layout.ts SURFACE_Y, itemAnchor) so the mock shows the real fit.
SURFACE = {'counter': .9, 'board': .94, 'stove': .93, 'sink': .78, 'belt': .92, 'rack': .9, 'return': .9}
FOV, TILT = 34, math.radians(58)


def fit_camera(half_x, half_z, aspect, hud_top=120 / 720, hud_bottom=.02, margin=.35):
    """Python port of scene/layout.ts fitCamera: distance and target z that fit the kitchen below the HUD band."""
    x, back, front = half_x + margin, -half_z - .5, half_z + .25
    pts = [p for sx in (-x, x) for p in ((sx, -.2, front), (sx, 1, front), (sx, 2.2, front - 1), (sx, 0, back), (sx, 2.1, back))]
    sin, cos, tan = math.sin(TILT), math.cos(TILT), math.tan(math.radians(FOV) / 2)
    top, bottom = 1 - 2 * hud_top, -1 + 2 * hud_bottom

    def extent(d, tz):
        out = []
        for px, py, pz in pts:
            ry, rz = py - sin * d, pz - tz - cos * d
            depth, up = -ry * sin - rz * cos, ry * cos - rz * sin
            out.append((px / (depth * tan * aspect), up / (depth * tan)))
        return min(y for _, y in out), max(y for _, y in out), max(abs(x) for x, _ in out)

    def centre(d):
        lo, hi = -half_z * 2 - 4, half_z * 2 + 4
        for _ in range(40):
            mid = (lo + hi) / 2
            y0, y1, _ = extent(d, mid)
            lo, hi = (lo, mid) if (y0 + y1) / 2 > (top + bottom) / 2 else (mid, hi)
        return (lo + hi) / 2

    lo, hi = 2, 400
    for _ in range(40):
        mid = (lo + hi) / 2
        y0, y1, mx = extent(mid, centre(mid))
        lo, hi = (lo, mid) if mx <= .98 and y1 <= top and y0 >= bottom else (mid, hi)
    return hi, centre(hi)


def kitchen(res=(1280, 720), out='kitchen-mock'):
    clear()
    rows, cols = len(KITCHEN), len(KITCHEN[0])
    at = lambda c, r: (c + .5 - cols / 2, r + .5 - rows / 2)
    for r, line in enumerate(KITCHEN):
        for c, ch in enumerate(line):
            x, z = at(c, r)
            yaw = 0 if r == rows - 1 or r == 0 or ch in '>' else (-90 if c == cols - 1 else 90 if c == 0 else 0)
            if ch in '.@':
                inst('floor_tile', x, 0, z)
            elif ch in CRATES:
                inst('crate', x, 0, z, yaw)
                for dx, dz, turn in ((-.2, -.18, 23), (.2, -.14, 120), (0, .18, 230), (-.22, .2, 57), (.23, .22, 300)):
                    inst(f'{CRATES[ch]}_raw', x + dx, .7, z + dz, turn)
            else:
                inst(STATION[ch], x, 0, z, yaw)
                if ch == 'E':
                    inst('extinguisher', x, H, z)
    for c in range(cols):
        inst('wall', c + .5 - cols / 2, 0, -rows / 2 - .5)
    ground((.55, .72, .45))
    top = lambda c, r, name, dy=0, yaw=0, kind='counter': inst(name, at(c, r)[0], SURFACE[kind] + dy, at(c, r)[1], yaw)
    top(8, 0, 'pot', kind='stove'); top(8, 0, 'soup_tomato', .13, kind='stove')
    top(10, 0, 'pot', kind='stove'); top(10, 0, 'soup_onion', .06, kind='stove')
    top(6, 7, 'pan', yaw=90, kind='stove'); top(6, 7, 'patty_cooked', .05, kind='stove')
    top(8, 7, 'pan', yaw=90, kind='stove'); top(8, 7, 'burnt', .05, kind='stove')
    top(0, 1, 'tomato_chopped', kind='board'); top(0, 3, 'lettuce_raw', kind='board'); top(4, 7, 'onion_chopped', kind='board')
    x, z = at(12, 0)  # oven: plate with pizza half inside the mouth (scene itemAnchor: y .5, z +.3, scale .78)
    inst('plate', x, .5, z + .3, 0, None, .78); inst('dish_pizza', x, .5 + .03 * .78, z + .3, 0, None, .78)
    x, z = at(13, 2)
    for i in range(5):
        inst('plate', x, .9 + i * .045, z)
    x, z = at(13, 5)
    for i in range(3):
        inst('plate_dirty', x, .9 + i * .04, z, i * 75)
    x, z = at(13, 4)
    inst('plate_dirty', x, .78, z)
    for c, r, dish in ((5, 3, 'dish_salad'), (8, 3, 'dish_cheeseburger'), (9, 4, 'dish_tomato_soup')):
        top(c, r, 'plate'); top(c, r, dish, .03)
    top(6, 3, 'onion_raw', kind='belt'); top(5, 4, 'cheese_chopped')
    top(12, 7, 'plate'); top(12, 7, 'dish_deluxe_burger', .03)
    chefs = [((3, 2.3), 200, '#ff5748', 'chef', 'pot'), ((8.3, 1.4), 150, '#3aa0ff', 'chef_f', 'plate'),
             ((2.6, 5.6), 90, '#ffc233', 'chef', None), ((10.6, 5.4), -30, '#4cd964', 'chef_f', 'tomato_raw'),
             ((6.5, 6.1), 180, '#b36bff', 'chef', 'extinguisher'), ((11.8, 2.4), 90, '#ff8fc8', 'chef_f', 'lettuce_chopped')]
    for (c, r), yaw, colour, kind, held in chefs:
        x, z = c + .5 - cols / 2, r + .5 - rows / 2
        root = inst(kind, x, 0, z, yaw, colour)
        if held:
            for o in root.children_recursive:
                if o.name.split('.')[0] in ('ArmL', 'ArmR'):
                    o.rotation_euler.x = math.radians(-75)  # Blender X = game X; negative raises the arm forward
            a = math.radians(yaw)
            inst(held, x + math.sin(a) * .42, .64 * 1.0, z + math.cos(a) * .42, yaw)
    hx, hz = cols / 2, rows / 2
    for name, x, z in (('prop_plant', -hx - 1.3, -2.8), ('prop_lamp', hx + 1.3, -2.8), ('prop_stool', -hx - 1.3, .6), ('prop_topiary', hx + 1.3, .6),
                       ('prop_plant', hx + 1.3, 3.2), ('prop_stool', -hx - 1.3, 3.2)):
        inst(name, x, 0, z, 90 if x < 0 else -90)
    d, tz = fit_camera(hx, hz, res[0] / res[1])
    cam.data.type, cam.data.sensor_fit, cam.data.angle_y = 'PERSP', 'VERTICAL', math.radians(FOV)
    aim(cam, g2b(0, 0, tz), g2b(0, math.sin(TILT), math.cos(TILT)), d)
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.render.filepath = str(SHEETS / f'{out}.png')
    bpy.ops.render.render(write_still=True)


def closeup():
    """Chef's-eye detail of the same mock (camera at a quarter of the fit distance)."""
    kitchen_only = scene.camera.location.copy()
    aim(cam, g2b(2.5, .8, -2.2), g2b(0, math.sin(TILT), math.cos(TILT)), 6)
    scene.render.filepath = str(SHEETS / 'kitchen-close.png')
    bpy.ops.render.render(write_still=True)
    cam.location = kitchen_only


H = .9
if 'icons' in ARGS:
    icons()
elif 'characters' in ARGS:
    characters()
if 'sheets' in ARGS:
    SHEETS.mkdir(parents=True, exist_ok=True)
    scene.cycles.samples = 32
    sheet('stations', [['counter', 'board', 'stove', 'oven', 'sink', 'rack'], ['return', 'serve', 'bin', 'crate', 'belt', 'wall'],
                       ['floor_tile', 'ice_tile', 'gate_plank', 'portal_pad']], spacing=1.45, row_gap=2.4, lsize=.14)
    sheet('food', [[f'{f}_raw' for f in FOOD], ['lettuce_chopped', 'tomato_chopped', 'onion_chopped', 'patty_chopped', 'cheese_chopped', 'burnt'],
                   ['tomato_cooked', 'onion_cooked', 'patty_cooked', 'dough_cooked', 'soup_tomato', 'soup_onion', 'soup_mixed']], spacing=.6, row_gap=.8, res=(1600, 900), elev=(0, -1.4, 1.5), lsize=.045)
    sheet('dishes', [[[(f'dish_{r}', 0, .03, 0), 'plate'] for r in RECIPES],
                     ['plate', 'plate_dirty', ['pot', ('soup_onion', 0, .12, 0)], ['pan', ('patty_cooked', 0, .05, 0)], 'extinguisher', 'pot', 'pan']], spacing=.65, row_gap=.95, res=(1600, 800), elev=(0, -1.4, 1.5), lsize=.05)
    sheet('props', [['prop_plant', 'prop_stool', 'prop_bench', 'prop_sign', 'prop_barrel', 'prop_buoy', 'prop_post', 'prop_crate_stack'],
                    ['prop_boat', 'prop_pine', 'prop_snowman', 'prop_logs', 'prop_cactus', 'prop_rock', 'prop_skull', 'prop_lantern'],
                    ['prop_awning', 'prop_basket', 'prop_column', 'prop_rope', 'prop_window', 'prop_lamp', 'prop_topiary'],
                    [('chef', 0, 0, 0, 0, '#ff5748'), ('chef_f', 0, 0, 0, 0, '#3aa0ff'), ('chef', 0, 0, 0, 180, '#ffc233'), ('chef_f', 0, 0, 0, 180, '#4cd964')]],
          spacing=1.25, row_gap=2.6, res=(1600, 1100), lsize=.1)
    scene.cycles.samples = 48
    kitchen()
    closeup()
if 'mock' in ARGS:
    SHEETS.mkdir(parents=True, exist_ok=True)
    kitchen()
    closeup()
