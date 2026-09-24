"""Contact sheets, portraits, full-body renders and lineups, rendered from the shipped GLBs (what you inspect is what ships).

blender -b --factory-startup --python-exit-code 1 --python tools/blender/render_sheet.py -- mario [fox ...] [--only sheet,portrait,render]
blender -b --factory-startup --python-exit-code 1 --python tools/blender/render_sheet.py -- --lineup output/sky-clash-v2/models/lead-lineup.png mario fox kirby

Sheet (output/sky-clash-v2/models/<kind>-sheet.png): row 1 = front, left side, 3/4, back, arms at 60 degrees, legs/spine at 60 degrees;
row 2 = face front, face 3/4, face profile, then the four costumes. Portrait 512x512 and render 640x800 go to assets/ for every costume (<kind>.webp, then <kind>-1..3.webp).
Poses come from the fighter script (HERO, optional PORTRAIT); lighting and camera angles are shared by the whole roster.
"""
import os, sys, importlib.util
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from common import *

BG, SEP = (.63, .67, .75), .42
KEY, FILL, RIM = (-1.0, 1.35, .9), (1.0, .2, .7), (.6, .9, -1.0)   # light directions (toward the light), camera-relative yaw
VIEW_HERO, VIEW_PORTRAIT = (-.62, -.02, 1), (-.58, .06, 1)          # the fighter faces screen-right, slightly heroic low angle
VIEW_FLAT = (-1, .02, .06)                                          # flat fighters: side-on, like the game shows them
EYES = ('eye', 'eye-white')

def module(kind):
    path = os.path.join(HERE, 'fighters', f'{kind}.py'); spec = importlib.util.spec_from_file_location(f'fighter_{kind.replace("-", "_")}', path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

def meta(kind): return json.load(open(os.path.join(GAME, 'assets', 'models', f'{kind}.json')))
def hide_move_prop(kind, arm, hide=True):
    """Props shown only by moves (Fox's blaster, Kirby's hammer) are hidden like the game does: prop bone scaled to 0."""
    if meta(kind).get('prop', {}).get('visible') == 'move': arm.pose.bones['prop'].scale = (1e-4 if hide else 1,) * 3; bpy.context.view_layer.update()
def flat(kind): return ROSTER[kind]['style'] == 'flat'
def edge(kind): return '#f4ead2' if flat(kind) else '#1c1726'  # a cream edge keeps the LCD silhouette readable on dark cards
def game_look(kind, arm):
    """Match the in-game body treatment: flat fighters (Mr. Game & Watch) are squashed to 16% along X and seen side-on."""
    if flat(kind): arm.scale.x = .16; bpy.context.view_layer.update()

def costumes(kind): return json.load(open(os.path.join(GAME, 'assets', 'costumes', f'{kind}.json')))

def load(kind, x=0.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(GAME, 'assets', 'fighters', f'{kind}.glb'), disable_bone_shape=True)
    new = set(bpy.data.objects) - before; arm = next(o for o in new if o.type == 'ARMATURE'); mesh = next(o for o in new if o.type == 'MESH' and o.parent == arm)
    arm.location.x += x; bpy.context.view_layer.update(); return arm, mesh

# ── Toon look (render-only; the GLB keeps plain PBR materials) ───────────────
def toon_material(name, hexc):
    m = bpy.data.materials.new(f'toon-{name}'); nt = m.node_tree; N = nt.nodes; L = nt.links
    for n in list(N): N.remove(n)
    out = N.new('ShaderNodeOutputMaterial'); em = N.new('ShaderNodeEmission'); L.new(em.outputs[0], out.inputs[0]); col = (*srgb(hexc), 1)
    if name == 'emissive': em.inputs['Color'].default_value = col; em.inputs['Strength'].default_value = 1.35; return m
    def ramp(src, stops):
        r = N.new('ShaderNodeValToRGB'); r.color_ramp.interpolation = 'CONSTANT'; e = r.color_ramp.elements
        e[0].position, e[0].color = stops[0][0], stops[0][1]; e[1].position, e[1].color = stops[1][0], stops[1][1]
        for p, c in stops[2:]: x = e.new(p); x.color = c
        L.new(src, r.inputs[0]); return r
    def lum(shader):
        s = N.new('ShaderNodeShaderToRGB'); L.new(shader.outputs[0], s.inputs[0]); bw = N.new('ShaderNodeRGBToBW'); L.new(s.outputs[0], bw.inputs[0]); return bw.outputs[0]
    def mix(kind, a, b):
        x = N.new('ShaderNodeMix'); x.data_type = 'RGBA'; x.blend_type = kind; x.inputs['Factor'].default_value = 1
        for i, v in ((6, a), (7, b)):
            if isinstance(v, tuple): x.inputs[i].default_value = v
            else: L.new(v, x.inputs[i])
        return x.outputs[2]
    soft = name in EYES; metal = name == 'metal'
    sh, md = ((.86, .84, .92, 1), (.95, .94, .98, 1)) if soft else ((.5, .47, .66, 1), (.78, .76, .88, 1)) if not metal else ((.38, .38, .5, 1), (.72, .72, .84, 1))
    band = ramp(lum(N.new('ShaderNodeBsdfDiffuse')), [(0, sh), (.3, md), (.62, (1, 1, 1, 1))])
    c = mix('MULTIPLY', col, band.outputs[0])
    g = N.new('ShaderNodeBsdfGlossy'); g.inputs['Roughness'].default_value = .18 if name in EYES or metal else .32
    k = .55 if metal else .45 if name == 'eye' else .16 if name in ('dark', 'hair', 'trim', 'accent') else .1
    spec = ramp(lum(g), [(0, (0, 0, 0, 1)), (.55 if metal else .8, (k, k, k, 1))]); c = mix('ADD', c, spec.outputs[0])
    lw = N.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = .35
    rim = ramp(lw.outputs['Facing'], [(0, (0, 0, 0, 1)), (.72, (.09, .1, .13, 1))]); c = mix('ADD', c, rim.outputs[0])
    L.new(c, em.inputs['Color']); return m

def toon(mesh, colors):
    for slot in mesh.material_slots:
        name = slot.material.name.split('.')[0]; slot.material = toon_material(name, colors[name])

def outline(mesh, width, hexc='#1c1726'):
    """Inverted-hull outline like the game renderer's; eye materials get none."""
    ol = bpy.data.materials.new('outline'); ol.use_backface_culling = True; nt = ol.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    o = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*srgb(hexc), 1); nt.links.new(e.outputs[0], o.inputs[0])
    mesh.data.materials.append(ol); idx = len(mesh.data.materials) - 1
    eyes = {i for i, m in enumerate(mesh.data.materials) if m.name.split('.')[0].replace('toon-', '') in EYES}
    g = mesh.vertex_groups.new(name='outline-mask'); keep = set(range(len(mesh.data.vertices)))
    for p in mesh.data.polygons:
        if p.material_index in eyes: keep -= set(p.vertices)
    g.add(list(keep), 1.0, 'REPLACE')
    s = mesh.modifiers.new('outline', 'SOLIDIFY'); s.thickness = width; s.offset = 1; s.use_flip_normals = True; s.use_rim = False
    s.material_offset = idx; s.vertex_group = g.name; s.thickness_vertex_group = 0.0; s.use_even_offset = False; return s

# ── Scene, camera, framing ───────────────────────────────────────────────────
def setup(res):
    sc = bpy.context.scene; r = sc.render; r.engine = 'BLENDER_EEVEE'; r.film_transparent = True; r.resolution_x, r.resolution_y = res; r.resolution_percentage = 100
    sc.eevee.taa_render_samples = 24; sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    w = bpy.data.worlds.new('w'); sc.world = w; w.node_tree.nodes['Background'].inputs[0].default_value = (.42, .44, .52, 1); w.node_tree.nodes['Background'].inputs[1].default_value = .55
    rig = bpy.data.objects.new('lights', None); sc.collection.objects.link(rig)
    for name, d, e, shadow in (('key', KEY, 2.6, False), ('fill', FILL, .55, False), ('rim', RIM, 1.6, False)):
        l = bpy.data.lights.new(name, 'SUN'); l.energy = e; l.angle = math.radians(4); l.use_shadow = shadow
        o = bpy.data.objects.new(name, l); sc.collection.objects.link(o); o.parent = rig
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(C3 @ v3(d).normalized())
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    return cam, rig

def points(mesh, bones=None, stride=1):
    """Evaluated (posed) vertex positions in character space, optionally only vertices dominated by `bones`."""
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = ev.to_mesh(); M = CI @ mesh.matrix_world; out = []
    names = {g.index: g.name for g in mesh.vertex_groups}; src = mesh.data.vertices
    for i in range(0, min(len(me.vertices), len(src)), stride):
        if bones is not None:
            gs = [g for g in src[i].groups if names.get(g.group) not in (None, 'outline-mask')]
            if not gs or names[max(gs, key=lambda g: g.weight).group] not in bones: continue
        out.append(M @ me.vertices[i].co)
    ev.to_mesh_clear(); return out

def head_bones(arm):
    b = arm.data.bones['head']; out = {'head'}; q = list(b.children)
    while q: c = q.pop(); out.add(c.name); q += list(c.children)
    return out

def shoot(cam, rig, dirn, pts, res, fill=.9, ortho=True, lens=50, pad=(0, 0)):
    """Aim along -dirn at the points' center and fit them to `fill` of the frame (orthographic or perspective)."""
    d = v3(dirn).normalized(); R = aim(d, (0, 1, 0)); X, Y = R.col[0], R.col[1]
    xs, ys = [p.dot(X) for p in pts], [p.dot(Y) for p in pts]; cx, cy = (min(xs) + max(xs)) / 2 + pad[0], (min(ys) + max(ys)) / 2 + pad[1]
    zc = sum(p.dot(d) for p in pts) / len(pts); ctr = X * cx + Y * cy + d * zc; asp = res[0] / res[1]
    w, h = max(xs) - min(xs), max(ys) - min(ys); cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24
    if ortho:
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(h, w / asp) / fill; dist = 20
    else:
        cam.data.type = 'PERSP'; cam.data.lens = lens; t = 12 / lens * fill; dist = 0
        for p in pts:
            q = p - ctr; dist = max(dist, q.dot(d) + abs(q.dot(Y)) / t, q.dot(d) + abs(q.dot(X)) / (t * asp))
    loc = ctr + d * dist; cam.location = C @ loc; cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (C3 @ R).to_quaternion(); cam.data.clip_start = .02; cam.data.clip_end = 200
    rig.rotation_euler = (0, 0, math.atan2(d.x, d.z)); bpy.context.view_layer.update()
    return max(h, w / asp) / fill

def render(path, res):
    sc = bpy.context.scene; sc.render.resolution_x, sc.render.resolution_y = res; f = sc.render.image_settings
    f.file_format = 'WEBP' if path.endswith('.webp') else 'PNG'; f.color_mode = 'RGBA'; f.quality = 92
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)

def compose(rows, path):
    grid = []
    for row in rows:
        imgs = []
        for p in row:
            im = bpy.data.images.load(p); a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a)
            imgs.append(a.reshape(im.size[1], im.size[0], 4)); bpy.data.images.remove(im)
        grid.append(imgs)
    W = max(sum(i.shape[1] for i in r) for r in grid); H = sum(max(i.shape[0] for i in r) for r in grid)
    out = np.zeros((H, W, 4), np.float32); out[..., :3] = BG; out[..., 3] = 1; y = H
    for r in grid:
        h = max(i.shape[0] for i in r); y -= h; x = 0
        for i in r:
            a = i[..., 3:4]; blk = out[y:y + i.shape[0], x:x + i.shape[1], :3]; out[y:y + i.shape[0], x:x + i.shape[1], :3] = i[..., :3] * a + blk * (1 - a)
            out[y:y + h, x:x + 2, :3] = SEP; x += i.shape[1]
        out[y:y + 2, :, :3] = SEP
    im = bpy.data.images.new('sheet', W, H, alpha=False); im.pixels.foreach_set(out.ravel()); im.filepath_raw = path; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)

# ── Products ────────────────────────────────────────────────────────────────
def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def prepare(kind, costume=0, x=0.0):
    arm, mesh = load(kind, x); toon(mesh, costumes(kind)[costume]['colors']); return arm, mesh

def sheet(kind, mod):
    fresh(); tmp = os.path.join(OUT, 'tmp', kind); os.makedirs(tmp, exist_ok=True); res = (380, 470); cam, rig = setup(res)
    arm, mesh = prepare(kind); ol = outline(mesh, .01); H = ROSTER[kind]['height']; row1, row2 = [], []
    apply_pose(arm, {}); hide_move_prop(kind, arm); rest = points(mesh, stride=3)
    for i, (d, pose) in enumerate((((0, 0, 1), {}), ((1, 0, 0), {}), ((-.8, .25, .75), {}), ((0, .05, -1), {}), ((.75, .2, .8), TEST_ARMS), ((-.8, .15, .7), TEST_LEGS))):
        apply_pose(arm, pose); hide_move_prop(kind, arm, i != 2); span = shoot(cam, rig, d, points(mesh, stride=3) if pose or i == 2 else rest, res, .92); ol.thickness = span * .0042
        p = os.path.join(tmp, f'a{i}.png'); render(p, res); row1.append(p)
    apply_pose(arm, {}); hide_move_prop(kind, arm); face = points(mesh, head_bones(arm), 1)
    for i, d in enumerate(((0, 0, 1), (-.75, .1, .8), (-1, 0, 0))):
        span = shoot(cam, rig, d, face, res, .78); ol.thickness = span * .0042; p = os.path.join(tmp, f'b{i}.png'); render(p, res); row2.append(p)
    for c, cos in enumerate(costumes(kind)):
        for slot in mesh.material_slots:
            n = slot.material.name.replace('toon-', '').split('.')[0]
            if n in cos['colors']: slot.material = toon_material(n, cos['colors'][n])
        apply_pose(arm, getattr(mod, 'IDLE', IDLE)); hide_move_prop(kind, arm); span = shoot(cam, rig, VIEW_HERO, points(mesh, stride=3), (res[0] * 3 // 4, res[1]), .9)
        ol.thickness = span * .0042; p = os.path.join(tmp, f'c{c}.png'); render(p, (res[0] * 3 // 4, res[1])); row2.append(p)
    out = os.path.join(OUT, f'{kind}-sheet.png'); compose([row1, row2], out); print('sheet', out)

def art_name(kind, costume): return f'{kind}.webp' if not costume else f'{kind}-{costume}.webp'  # costume 0 keeps the plain name

def portrait(kind, mod, costume=0):
    fresh(); res = (512, 512); cam, rig = setup(res); arm, mesh = prepare(kind, costume); ol = outline(mesh, .01, edge(kind)); game_look(kind, arm)
    spec = getattr(mod, 'PORTRAIT', None) or {}; apply_pose(arm, spec.get('pose', getattr(mod, 'IDLE', IDLE))); hide_move_prop(kind, arm)
    face = points(mesh, head_bones(arm)); top = max(p.y for p in face); bot = min(p.y for p in face)
    lo = bot - (top - bot) * spec.get('shoulders', .45); pts = [p for p in points(mesh, stride=2) if lo <= p.y <= top + .01]
    span = shoot(cam, rig, spec.get('view', VIEW_FLAT if flat(kind) else VIEW_PORTRAIT), pts, res, spec.get('fill', .9), ortho=False, lens=85, pad=spec.get('pad', (0, 0)))
    ol.thickness = span * .004; render(os.path.join(GAME, 'assets', 'portraits', art_name(kind, costume)), res)

def hero(kind, mod, costume=0):
    fresh(); res = (640, 800); cam, rig = setup(res); arm, mesh = prepare(kind, costume); ol = outline(mesh, .01, edge(kind)); game_look(kind, arm)
    apply_pose(arm, getattr(mod, 'HERO', IDLE))
    if not getattr(mod, 'HERO_PROP', True): hide_move_prop(kind, arm)
    span = shoot(cam, rig, getattr(mod, 'HERO_VIEW', VIEW_FLAT if flat(kind) else VIEW_HERO), points(mesh, stride=2), res, .9, ortho=False, lens=45)
    ol.thickness = span * .0042; render(os.path.join(GAME, 'assets', 'renders', art_name(kind, costume)), res)

def lineup(kinds, path):
    """All kinds side by side at true relative scale (orthographic, idle pose)."""
    fresh(); res = (560 * len(kinds), 900); cam, rig = setup(res); x, allp, ols = 0.0, [], []
    for k in kinds:
        arm, mesh = prepare(k, 0, 0); game_look(k, arm); apply_pose(arm, getattr(module(k), 'IDLE', IDLE)); hide_move_prop(k, arm); ps = points(mesh, stride=3)
        w = max(p.x for p in ps) - min(p.x for p in ps); x += w / 2 + (.15 if allp else 0); arm.location.x = x - (max(p.x for p in ps) + min(p.x for p in ps)) / 2
        bpy.context.view_layer.update(); ps = points(mesh, stride=3); allp += ps; x += w / 2; ols.append(outline(mesh, .01))
    span = shoot(cam, rig, (-.3, .06, 1), allp + [Vector((0, 0, 0))], res, .9)
    for o in ols: o.thickness = span * .0035
    tmp = os.path.join(OUT, 'tmp', f'lineup-{os.path.basename(path)}'); os.makedirs(os.path.dirname(tmp), exist_ok=True); render(tmp, res); compose([[tmp]], path); print('lineup', path)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = {'sheet', 'portrait', 'render'}
    if '--only' in argv: i = argv.index('--only'); only = set(argv[i + 1].split(',')); del argv[i:i + 2]
    try:
        if '--lineup' in argv: i = argv.index('--lineup'); path = argv[i + 1]; del argv[i:i + 2]; lineup(argv, os.path.abspath(path))
        else:
            for kind in argv:
                mod = module(kind)
                if 'sheet' in only: sheet(kind, mod)
                for c in range(len(costumes(kind))):  # one portrait and render per costume, so every menu and HUD card matches the model
                    if 'portrait' in only: portrait(kind, mod, c)
                    if 'render' in only: hero(kind, mod, c)
    except Exception:
        import traceback; traceback.print_exc(); sys.exit(1)
