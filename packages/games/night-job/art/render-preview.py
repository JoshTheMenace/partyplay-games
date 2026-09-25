"""Labelled contact sheets of night-job-kit.glb (top-down and high 3/4) plus a game-scale tableau.
Run: blender -b --factory-startup --python-exit-code 1 --python art/render-preview.py  -> output/nj-rebuild/assets/*.png
"""
import bpy, math
from mathutils import Euler, Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
GLB = ROOT / 'public/games/night-job/models/night-job-kit.glb'
OUT = ROOT.parent / 'output/nj-rebuild/assets'
OUT.mkdir(parents=True, exist_ok=True)
HIP, LEG_X, DOG_LEG_Y, DOG_LEG = .30, .085, .22, (.075, .16)  # mirrors build-kit.py
HATS = ['cracker', 'scout', 'magpie', 'ghost', 'breacher', 'impostor', 'wire', 'face']
ROLE = {'cracker': '#53bcff', 'scout': '#ff675f', 'magpie': '#ffd65a', 'ghost': '#f888cd', 'breacher': '#b196ff', 'impostor': '#7be0ce', 'wire': '#99dc65', 'face': '#ffb16c'}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
src = {o.name: o for o in bpy.context.scene.objects if o.type == 'MESH'}
for o in src.values(): o.hide_render = True
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading; sh.light = 'STUDIO'; sh.color_type = 'VERTEX'; sh.show_shadows = True; sh.shadow_intensity = .25
sh.show_cavity = True; sh.cavity_type = 'WORLD'; sh.show_object_outline = False
scene.display.shadow_focus = .2; scene.display.light_direction = (-.35, .35, .87); scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('w'); scene.world.color = (.02, .025, .04)
bpy.context.preferences.view.show_splash = False

def lin(h): return tuple(((v / 255) / 12.92 if v / 255 < .04045 else (((v / 255) + .055) / 1.055) ** 2.4) for v in (int(h[i:i + 2], 16) for i in (1, 3, 5)))
def paint(o, hexcol, tint=None):
  """Solid colour for helper meshes; `tint` multiplies light-grey kit colours (the renderer's role tint)."""
  attr = o.data.color_attributes.get('Color') or o.data.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
  if tint:
    t = lin(tint)
    for d in attr.data:
      r, g, b, a = d.color
      if abs(r - g) < .02 and abs(g - b) < .02 and r > .3: d.color = (r * t[0], g * t[1], b * t[2], a)
  else:
    for d in attr.data: d.color = (*lin(hexcol), 1)
  o.data.color_attributes.active_color = attr
created = []
def place(name, x, z, y=0, rot=0, tint=None, label=None):
  """Instance a kit node at game position (x, y, z); rot is quarter turns clockwise seen from above."""
  o = src[name].copy(); o.data = src[name].data.copy() if tint else src[name].data
  o.hide_render = False; o.location = (x, -z, y); o.rotation_euler = (0, 0, -rot * math.pi / 2)
  scene.collection.objects.link(o); created.append(o)
  if tint: paint(o, None, tint)
  return o
def plate(x, z, w, d, col, y=-.01):
  bpy.ops.mesh.primitive_plane_add(size=1, location=(x, -z, y)); o = bpy.context.object; o.scale = (w, d, 1); paint(o, col); created.append(o); return o
def wall(x, z):
  bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, .8)); o = bpy.context.object; o.scale = (1, .2, 1.6); paint(o, '#6b7390'); created.append(o)
def label(text, x, z, size=.28):
  bpy.ops.object.text_add(location=(x, -z, .01)); t = bpy.context.object; t.data.body = text; t.data.align_x = 'CENTER'; t.data.size = size
  bpy.ops.object.convert(target='MESH'); paint(bpy.context.object, '#e8e2d0'); created.append(bpy.context.object)
def thief(x, z, role, facing=0):
  for part in ('thief_torso', 'thief_head', f'hat_{role}'): place(part, x, z, rot=facing, tint=ROLE[role] if part == 'thief_torso' else None)
  for s in (-1, 1):
    o = place('thief_leg', x, z, HIP, facing); o.location.x += s * LEG_X * (1 if facing % 2 == 0 else 0); o.rotation_euler.x = s * .25
def dog(x, z):
  place('dog_body', x, z)
  for sx in (-1, 1):
    for sz in (-1, 1): place('dog_leg', x + sx * DOG_LEG[0], z + sz * DOG_LEG[1], DOG_LEG_Y)
def camera(kind, cx, cz, w, d, px=1600):
  cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; o = bpy.data.objects.new('cam', cam); scene.collection.objects.link(o); scene.camera = o
  if kind == 'top': o.location = (cx, -cz, 30); o.rotation_euler = (0, 0, 0); cam.ortho_scale = max(w, d)
  else:
    o.rotation_euler = (math.radians(38), 0, 0)
    o.location = Vector((cx, -cz, .5)) - Euler(o.rotation_euler).to_matrix() @ Vector((0, 0, -40)); cam.ortho_scale = w
  scene.render.resolution_x = px; scene.render.resolution_y = int(px * (d if kind == 'top' else d * .79 + .6) / w); created.append(o)
def sheet(name, items, cols, cw, cd):
  rows = math.ceil(len(items) / cols)
  for i, (label_, draw) in enumerate(items):
    x, z = (i % cols + .5) * cw, (i // cols + .5) * cd
    plate(x, z - .15, cw - .15, cd - .15, '#23304a'); draw(x, z - .15); label(label_, x, z + cd / 2 - .42)
  for kind in ('top', '34'):
    camera(kind, cols * cw / 2, rows * cd / 2, cols * cw, rows * cd, 2400)
    scene.render.filepath = str(OUT / f'{name}-{kind}.png'); bpy.ops.render.render(write_still=True)
  for o in created: bpy.data.objects.remove(o)
  created.clear()

props = sorted(n for n in src if n.startswith('prop_'))
foot = {'car': (2, 1), 'van': (2, 2), 'boat': (3, 2), 'bed': (1, 2), 'sofa': (2, 1), 'bench': (2, 1), 'piano': (2, 1), 'roulette': (2, 2), 'cards': (2, 1), 'fountain': (2, 2), 'container': (3, 1), 'desk': (2, 1)}
def prop_draw(n):
  def draw(x, z):
    w, d = foot.get(n[5:], (1, 1))
    for i in range(w):
      for j in range(d): plate(x - w / 2 + i + .5, z - d / 2 + j + .5, .96, .96, '#3a4966', -.005)
    if n == 'prop_painting': wall(x, z - .6); place(n, x, z - .5)
    else: place(n, x, z)
  return draw
sheet('props', [(n[5:], prop_draw(n)) for n in props], 6, 3.6, 3.0)
objs = sorted(n for n in src if n.startswith('obj_'))
def obj_draw(n):
  def draw(x, z):
    plate(x, z, .96, .96, '#3a4966', -.005)
    if n in ('obj_camera', 'obj_laser'): wall(x, z - .6); place(n, x, z - .5, 1.3)
    elif n in ('obj_ledger', 'obj_jewel', 'obj_manifest'): place('obj_pedestal', x, z); place(n, x, z)
    else: place(n, x, z)
  return draw
sheet('objects', [(n[4:], obj_draw(n)) for n in objs], 5, 2.2, 2.4)
chars = [(r, lambda x, z, r=r: thief(x, z, r)) for r in HATS] + [
  ('guard', lambda x, z: [place(p, x, z) for p in ('guard_torso', 'guard_head')] + [place('thief_leg', x + s * LEG_X, z, HIP) for s in (-1, 1)]),
  ('civilian', lambda x, z: [place(p, x, z) for p in ('civilian_torso', 'civilian_head')] + [place('thief_leg', x + s * LEG_X, z, HIP) for s in (-1, 1)]),
  ('dog', dog), ('bird', lambda x, z: place('bird', x, z, .4))]
sheet('characters', chars, 6, 1.3, 1.5)

# Game-scale tableau: the TV frames ~14 tiles tall at 1080p, so ~77 px per tile.
T = [('prop_roulette', 1, 1, 0), ('prop_cards', 5, 1.5, 0), ('prop_slot', 8.5, .5, 0), ('prop_slot', 9.5, .5, 0), ('prop_slot', 10.5, .5, 0), ('prop_bar', 12.5, .5, 0), ('prop_bar', 13.5, .5, 0),
     ('prop_rug', 3, 4.5, 0), ('prop_table', 8.5, 3.5, 0), ('prop_chair', 8.5, 4.5, 2), ('prop_sofa', 12, 3.5, 0), ('prop_plant', 14.5, 3.5, 0), ('prop_desk', 2, 7.5, 0),
     ('prop_statue', 5.5, 7.5, 0), ('obj_safe', 7.5, 7.5, 0), ('obj_terminal', 9.5, 7.5, 0), ('prop_bookcase', 11.5, 6.5, 0), ('prop_bookcase', 12.5, 6.5, 0), ('obj_closet', 14.5, 6.5, 0),
     ('prop_car', 2, 10.5, 0), ('prop_van', 6, 10, 0), ('prop_tree', 9.5, 10.5, 0), ('obj_bush', 11.5, 10.5, 0), ('prop_fountain', 14, 10, 0), ('obj_pedestal', 3.5, 4.5, 0), ('obj_ledger', 3.5, 4.5, 0),
     ('obj_coin', 7.5, 5.5, 0), ('obj_coin', 8, 5.8, 0), ('obj_medkit', 10.5, 4.5, 0), ('obj_vent', 13.5, 8.5, 0), ('prop_lamp', 4.5, 9.5, 0)]
plate(8, 6, 16, 12, '#6e2a35')
for n, x, z, r in T: place(n, x, z, rot=r)
for i, role in enumerate(['cracker', 'magpie', 'breacher', 'face']): thief(5 + i * .9, 5.2, role)
for i, role in enumerate(['scout', 'ghost', 'impostor', 'wire']): thief(5 + i * .9, 6.2, role, 2)
for p in ('guard_torso', 'guard_head'): place(p, 11.8, 5.3)
for s in (-1, 1): place('thief_leg', 11.8 + s * LEG_X, 5.3, HIP)
dog(13, 5.3)
cam = bpy.data.cameras.new('c'); o = bpy.data.objects.new('cam', cam); scene.collection.objects.link(o); scene.camera = o
cam.lens = 50; o.location = (8, -6 - 3.6, 21); o.rotation_euler = (math.radians(10), 0, 0)
scene.render.resolution_x, scene.render.resolution_y = 1232, 924
scene.render.filepath = str(OUT / 'tableau-game-scale.png'); bpy.ops.render.render(write_still=True)
