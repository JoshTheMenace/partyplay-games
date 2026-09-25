"""Night Job asset kit (DESIGN.md "Asset kit contract"). Original, generated from code; Blender 5.2.
Run: blender -b --factory-startup --python-exit-code 1 --python art/build-kit.py
Modelling frame: X right, Y up, Z front (south on the TV), 1 unit = 1 tile. Each asset becomes one top-level mesh
node with identity transform, one vertex-colour material and flat shading; the glTF exporter maps this frame 1:1.
"""
import bpy, bmesh, random
from math import pi, tau, sin, cos, radians
from mathutils import Matrix, Vector, Euler
from pathlib import Path

OUT = Path(__file__).resolve().parents[4] / 'public/games/night-job/models/night-job-kit.glb'
C = dict(
  walnut='#6e3b22', wood='#9a5b32', woodL='#c68650', woodD='#4a2616', oak='#b98a57', teak='#b8763f',
  velvet='#a3243b', velvetL='#c23a52', velvetD='#6a1526', brass='#dcaa45', brassD='#a8761f', gold='#f2c14e',
  cream='#f1e4c4', paper='#fbf6ea', marble='#e9e4da', marbleV='#b9b3aa', stone='#d8cdb6', stoneD='#a89c86',
  teal='#1f8a8a', tealL='#3fb6b8', tealD='#135c62', emerald='#1f7a4d', felt='#1f8050', feltD='#145a37', water='#3aaec2',
  grey='#8f98a6', greyL='#c3cad4', greyD='#4b5362', steel='#9aa7b3', char='#2a2e38', ink='#17191f', navy='#223a63',
  red='#d8403a', rose='#e8667a', orange='#e98a3a', leaf='#3f9a4a', leafL='#76c25a', leafD='#276b3a', soil='#4a3326',
  terra='#c4673f', glass='#2b4458', glow='#fff0b8', white='#f6f3ec', tint='#dadada', tintD='#a8a8a8',
  skin='#f0bf94', skinD='#d99a70', skinG='#c98d62', skinGD='#a86f4a', skinC='#9a6244', skinCD='#7c4a31', hair='#3a2519')

def lin(h):
  return tuple((v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4) for v in (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)))
def rgb(col): return lin(C.get(col, col)) if isinstance(col, str) else col
def circle(r, n, a0=0., rz=None): return [(r * cos(a0 + i * tau / n), (rz or r) * sin(a0 + i * tau / n)) for i in range(n)]
def star(r1, r2, n=5): return [((r1, r2)[i % 2] * sin(i * pi / n), -(r1, r2)[i % 2] * cos(i * pi / n)) for i in range(2 * n)]
T = lambda c: Matrix.Translation(Vector(c))
R = lambda rot: Euler([radians(a) for a in rot or (0, 0, 0)]).to_matrix().to_4x4()
def S(s):
  s = (s, s, s) if isinstance(s, (int, float)) else s
  return Matrix.Diagonal((*s, 1))
AXIS_UP = Matrix.Rotation(-pi / 2, 4, 'X')  # bmesh primitives are built along +Z; the modelling frame is Y-up

class Mesh:
  def __init__(s, name): s.name = name; s.bm = bmesh.new(); s.cl = s.bm.loops.layers.float_color.new('Color')
  def paint(s, faces, col, alpha=1.):
    c = (*rgb(col), alpha)
    for f in faces:
      for l in f.loops: l[s.cl] = c
  def put(s, verts, col, M, bevel=0, alpha=1.):
    s.paint({f for v in verts for f in v.link_faces}, col, alpha)
    for v in verts: v.co = M @ v.co
    if bevel:
      s.bm.normal_update()  # bevel offsets follow face normals, which are stale after moving verts bmesh.ops.bevel(s.bm, geom=list({e for v in verts for e in v.link_edges}), offset=bevel, segments=1, profile=.5, affect='EDGES', clamp_overlap=True)
  def box(s, c, size, col, b=0, rot=None, top=None, alpha=1.):
    """Box centred on c. top=(sx, sz, dx, dz) scales/shifts the upper face for tapers and slants."""
    vs = bmesh.ops.create_cube(s.bm, size=1)['verts']
    if top:
      for v in vs:
        if v.co.z > 0: v.co.x = v.co.x * top[0] + top[2] / size[0]; v.co.y = v.co.y * top[1] - top[3] / size[2]
    s.put(vs, col, T(c) @ R(rot) @ S(size) @ AXIS_UP, b, alpha)
  def cyl(s, c, r, h, col, n=12, r2=None, rot=None, b=0):
    """Cylinder or cone standing on c (bottom centre); r may be (rx, rz)."""
    rx, rz = (r, r) if isinstance(r, (int, float)) else r
    vs = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=n, radius1=1, radius2=(rx if r2 is None else r2) / rx, depth=1)['verts']
    s.put(vs, col, T(c) @ R(rot) @ S((rx, h, rz)) @ T((0, .5, 0)) @ AXIS_UP, b)
  def ball(s, c, r, col, n=10, v=6, rot=None):
    vs = bmesh.ops.create_uvsphere(s.bm, u_segments=n, v_segments=v, radius=1)['verts']
    s.put(vs, col, T(c) @ R(rot) @ S(r) @ AXIS_UP)
  def ico(s, c, r, col, sub=1, rot=None):
    if isinstance(r, (int, float)) and r < .031: return s.ball(c, r, col, 4, 2, rot)  # tiny beads/bulbs: an octahedron reads the same
    vs = bmesh.ops.create_icosphere(s.bm, subdivisions=sub, radius=1)['verts']
    s.put(vs, col, T(c) @ R(rot) @ S(r))
  def _solid(s, verts, faces, col, c, rot):
    bmesh.ops.recalc_face_normals(s.bm, faces=faces); s.paint(faces, col)
    for v in verts: v.co = T(c) @ R(rot) @ v.co
  def prism(s, pts, y0, y1, col, c=(0, 0, 0), rot=None):
    """Extrudes an (x, z) outline from y0 to y1."""
    bm, n = s.bm, len(pts)
    bot = [bm.verts.new((x, y0, z)) for x, z in pts]; top = [bm.verts.new((x, y1, z)) for x, z in pts]
    fs = [bm.faces.new(top), bm.faces.new(bot[::-1])] + [bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i])) for i in range(n)]
    s._solid(bot + top, fs, col, c, rot)
  def ring(s, outer, inner, y0, y1, col, c=(0, 0, 0), rot=None):
    """A band between two outlines with the same point count (rails, rims, basins)."""
    bm, n = s.bm, len(outer)
    ob, ot, ib, it = ([bm.verts.new((x, y, z)) for x, z in pts] for pts, y in ((outer, y0), (outer, y1), (inner, y0), (inner, y1)))
    fs = []
    for i in range(n):
      j = (i + 1) % n
      fs += [bm.faces.new(q) for q in ((ot[i], ot[j], it[j], it[i]), (ib[i], ib[j], ob[j], ob[i]), (ob[i], ob[j], ot[j], ot[i]), (it[i], it[j], ib[j], ib[i]))]
    s._solid(ob + ot + ib + it, fs, col, c, rot)
  def lathe(s, prof, cols, n=12, c=(0, 0, 0), rot=None, closed=False):
    """Revolves (radius, y) points around Y. cols is one colour or one per profile segment."""
    bm = s.bm
    rings = [[bm.verts.new((0, y, 0))] if r < 1e-6 else [bm.verts.new((r * cos(i * tau / n), y, r * sin(i * tau / n))) for i in range(n)] for r, y in prof]
    fs = []
    for j in range(len(prof) - (0 if closed else 1)):
      a, b, seg = rings[j], rings[(j + 1) % len(rings)], []
      for i in range(n):
        q = [a[i % len(a)], a[(i + 1) % len(a)], b[(i + 1) % len(b)], b[i % len(b)]]
        seg.append(bm.faces.new(list(dict.fromkeys(q))))
      s.paint(seg, cols[j] if isinstance(cols, list) else cols); fs += seg
    if not closed:
      for ring_, col in ((rings[0], cols[0] if isinstance(cols, list) else cols), (rings[-1], cols[-1] if isinstance(cols, list) else cols)):
        if len(ring_) > 1: f = bm.faces.new(ring_); s.paint([f], col); fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    for v in {v for r_ in rings for v in r_}: v.co = T(c) @ R(rot) @ v.co
  def tube(s, pts, r, col, n=6):
    for a, b in zip(pts, pts[1:]):
      a, b = Vector(a), Vector(b); d = b - a
      vs = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=n, radius1=1, radius2=1, depth=1)['verts']
      s.put(vs, col, T(a) @ Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4() @ S((r, d.length, r)) @ T((0, .5, 0)) @ AXIS_UP)
  def finish(s):
    me = bpy.data.meshes.new(s.name)
    s.bm.normal_update()  # the game camera is always above the kit, so downward faces are never seen: drop them for size
    bmesh.ops.delete(s.bm, geom=[f for f in s.bm.faces if f.normal.y < -.95], context='FACES_ONLY')
    bmesh.ops.transform(s.bm, matrix=Matrix.Rotation(pi / 2, 4, 'X'), verts=s.bm.verts)  # modelling frame -> Blender Z-up
    s.bm.to_mesh(me); s.bm.free()
    me.color_attributes.active_color_name = me.color_attributes.default_color_name = 'Color'; me.color_attributes.render_color_index = 0
    m = bpy.data.materials.new('M_' + s.name); m.use_nodes = True; m.use_backface_culling = True
    bsdf = m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = .82
    node = m.node_tree.nodes.new('ShaderNodeVertexColor'); node.layer_name = 'Color'
    m.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color']); me.materials.append(m)
    o = bpy.data.objects.new(s.name, me); bpy.context.scene.collection.objects.link(o)
    return o

ASSETS = {}
def asset(fn): ASSETS[fn.__name__] = fn; return fn
def legs4(m, w, d, h, col, t=.06, inset=.06):
  for x in (-1, 1):
    for z in (-1, 1): m.box((x * (w / 2 - inset), h / 2, z * (d / 2 - inset)), (t, h, t), col)

# ─── characters: floor origin, front +Z. Legs pivot at the hip (HIP above the floor, x = ±LEG_X). ─────────────
HIP, LEG_X = .30, .085
@asset
def thief_leg(m):
  m.box((0, -.115, 0), (.12, .23, .13), '#2c3040', .02)
  m.box((0, -.265, .025), (.135, .07, .2), C['ink'], .02)
  m.box((0, -.297, .025), (.14, .012, .205), '#5b4a3e')
@asset
def thief_torso(m):
  m.box((0, .42, 0), (.38, .28, .26), 'tint', .05, top=(1.1, 1, 0, 0))
  for y in (.37, .45): m.box((0, y, 0), (.392, .035, .272), 'tintD')
  m.box((0, .30, 0), (.37, .045, .25), '#3a2a22', .01); m.box((0, .30, .126), (.07, .05, .01), 'brass')
  m.cyl((0, .54, 0), .1, .04, C['char'], 10)
  for x in (-1, 1):
    m.ball((x * .205, .53, 0), (.1, .075, .1), 'tint', 8, 5)
    m.box((x * .245, .45, 0), (.1, .15, .13), 'tint', .03)
    m.box((x * .252, .36, .012), (.09, .1, .1), 'tint', .02)
    m.ball((x * .255, .29, .02), .055, '#26262c', 8, 5)
    m.box((x * .1, .575, -.03), (.05, .02, .22), '#3a2a22')
  m.box((0, .44, -.17), (.26, .22, .09), '#5d3d2a', .03); m.box((0, .52, -.17), (.27, .05, .1), '#77513a', .015)
  m.box((0, .44, -.217), (.04, .09, .01), 'brass')
@asset
def thief_head(m):
  m.ball((0, .71, 0), (.175, .165, .165), 'skin', 14, 9)
  m.ball((0, .748, -.012), (.176, .13, .17), 'hair', 14, 7)
  m.cyl((0, .69, 0), (.182, .172), .058, '#1d1f29', 14)
  for x in (-1, 1):
    m.ball((x * .064, .72, .166), (.034, .028, .016), 'white', 8, 4); m.ball((x * .06, .72, .179), (.016, .016, .008), C['ink'], 6, 3)
    m.box((x * .04, .72, -.2), (.045, .03, .09), '#1d1f29', rot=(0, x * 28, 0))
    m.ball((x * .176, .7, 0), (.03, .045, .035), 'skinD', 6, 4)
  m.ball((0, .663, .168), (.034, .03, .03), 'skinD', 8, 5)
  m.box((0, .622, .152), (.05, .012, .02), '#7a3a30')
def hat(name):
  def wrap(fn): ASSETS['hat_' + name] = fn; return fn
  return wrap
@hat('cracker')
def _(m):  # knit beanie with pom-pom
  m.ball((0, .775, 0), (.186, .14, .186), '#27628f', 12, 7)
  m.cyl((0, .735, 0), .19, .065, '#1d4a6d', 14)
  for i in range(8): m.box((cos(i * tau / 8) * .19, .77, sin(i * tau / 8) * .19), (.02, .06, .02), '#1d4a6d', rot=(0, -i * 45, 0))
  m.ico((0, .925, 0), .06, 'cream', 1)
@hat('scout')
def _(m):  # leather strap with big brass goggles pushed up on the forehead
  m.cyl((0, .758, 0), (.184, .178), .045, '#6d3b28', 14)
  m.box((0, .745, .12), (.13, .025, .06), '#6d3b28', rot=(-35, 0, 0))
  for x in (-1, 1):
    m.cyl((x * .066, .79, .135), .058, .05, 'brass', 10, rot=(-38, 0, 0))
    m.cyl((x * .066, .793, .139), .044, .052, '#6fe0ff', 10, rot=(-38, 0, 0))
  m.box((0, .87, -.02), (.05, .04, .16), '#e0413a', .01)
@hat('magpie')
def _(m):  # flat cap with a long gold feather
  m.ball((0, .8, -.01), (.188, .085, .192), '#3b3f4d', 12, 6)
  m.prism([(x, .1 + .09 * (1 - (x / .14) ** 2)) for x in (.14, .09, .04, -.04, -.09, -.14)], .79, .81, '#2a2d38')
  m.ico((0, .885, -.01), .022, '#2a2d38', 1)
  m.box((.15, .91, -.1), (.03, .015, .26), 'gold', rot=(36, 0, 0))
  m.box((.15, .995, -.22), (.038, .017, .09), 'tealL', rot=(36, 0, 0))
@hat('ghost')
def _(m):  # deep hood with cowl and back peak
  m.ball((0, .735, -.05), (.205, .2, .19), '#4b3b63', 12, 8)
  m.cyl((0, .54, -.01), .23, .07, '#3e3054', 12, r2=.18)
  m.box((0, .82, -.2), (.1, .12, .12), '#4b3b63', rot=(40, 0, 0), top=(.3, .3, 0, -.03))
  m.cyl((0, .735, .1), (.19, .19), .02, '#6a5687', 14, rot=(90, 0, 0))
@hat('breacher')
def _(m):  # hard hat with ridge and lamp
  m.ball((0, .795, 0), (.195, .14, .205), '#f2b530', 12, 7)
  m.cyl((0, .775, .01), (.23, .25), .025, '#e2a01e', 16)
  m.box((0, .925, -.01), (.055, .035, .32), '#ffd35a', .01)
  m.cyl((0, .83, .185), .042, .05, C['char'], 10, rot=(90, 0, 0)); m.cyl((0, .83, .228), .032, .012, 'glow', 10, rot=(90, 0, 0))
@hat('impostor')
def _(m):  # bowler hat plus a fake moustache
  m.cyl((0, .8, 0), (.25, .26), .022, '#2b2d38', 16)
  m.lathe([(.16, .8), (.163, .86), (.15, .92), (.1, .96), (0, .97)], '#353846', 14)
  m.cyl((0, .815, 0), .166, .038, '#9b2335', 14)
  for x in (-1, 1): m.box((x * .04, .64, .17), (.075, .022, .03), '#3a2519', .006, rot=(0, 0, x * -14))
@hat('wire')
def _(m):  # headset: band, ear cups, mic boom
  m.tube([(-.19, .7, 0), (-.17, .82, 0), (-.09, .9, 0), (.09, .9, 0), (.17, .82, 0), (.19, .7, 0)], .018, C['char'], 6)
  for x in (-1, 1):
    m.cyl((x * .175, .7, 0), .07, .05, C['char'], 10, rot=(0, 0, -x * 90)); m.cyl((x * .225, .7, 0), .05, .012, '#7bd04a', 10, rot=(0, 0, -x * 90))
  m.tube([(-.2, .67, .03), (-.14, .64, .14), (-.05, .63, .18)], .01, C['char'], 5); m.ico((-.04, .63, .185), .022, '#7bd04a', 1)
  m.box((.23, .79, 0), (.012, .12, .012), C['char']); m.ico((.23, .855, 0), .015, 'red', 1)
@hat('face')
def _(m):  # beret with stem and pin
  m.cyl((0, .775, 0), .176, .04, '#8e2336', 14)
  m.ball((.03, .84, -.01), (.215, .055, .205), '#c2334a', 14, 6, rot=(0, 0, -10))
  m.cyl((.04, .88, -.01), .014, .04, '#8e2336', 6)
  m.ico((-.12, .81, .12), .03, 'gold', 1)

@asset
def guard_torso(m):
  m.box((0, .44, 0), (.4, .3, .26), 'navy', .05, top=(1.1, 1, 0, 0))
  m.box((0, .52, .122), (.12, .12, .03), '#a9c4e6', rot=(0, 0, 45)); m.box((0, .5, .135), (.03, .1, .01), '#1a2440')
  m.box((0, .305, 0), (.41, .05, .27), C['ink'], .01); m.box((0, .305, .137), (.07, .04, .01), 'brass')
  m.box((.1, .5, .133), (.05, .06, .012), 'gold')
  m.box((-.12, .56, .03), (.08, .09, .05), C['ink'], .01); m.box((-.14, .64, .03), (.012, .08, .012), C['ink'])
  m.cyl((0, .575, 0), .1, .03, '#1a2440', 10)
  for x in (-1, 1):
    m.box((x * .245, .47, 0), (.11, .16, .14), 'navy', .03); m.box((x * .23, .555, 0), (.1, .025, .12), '#1d3154'); m.box((x * .275, .56, 0), (.012, .03, .12), 'gold')
    m.box((x * .252, .375, .012), (.1, .1, .11), 'navy', .02); m.ball((x * .255, .305, .02), .055, 'skinG', 8, 5)
  m.cyl((.255, .31, .0), .03, .26, '#3a3d46', 8, rot=(90, 0, 0)); m.cyl((.255, .31, .26), .042, .05, '#3a3d46', 8, rot=(90, 0, 0))
  m.cyl((.255, .31, .305), .034, .01, 'glow', 8, rot=(90, 0, 0))
@asset
def guard_head(m):
  m.ball((0, .735, 0), (.17, .16, .16), 'skinG', 14, 9)
  for x in (-1, 1):
    m.ball((x * .062, .745, .15), (.022, .026, .02), C['ink'], 6, 4); m.box((x * .065, .79, .155), (.06, .014, .02), '#3a2519', rot=(0, 0, x * 8))
    m.ball((x * .17, .725, 0), (.03, .045, .035), 'skinGD', 6, 4)
  m.ball((0, .69, .163), (.036, .032, .03), 'skinGD', 8, 5)
  m.box((0, .65, .15), (.07, .012, .02), '#6a3025')
  m.cyl((0, .78, 0), .178, .05, C['ink'], 14)
  m.cyl((0, .83, 0), .18, .07, 'navy', 14, r2=.205)
  m.cyl((0, .9, 0), .205, .018, '#35568f', 14); m.cyl((0, .918, 0), .12, .004, '#2d4a80', 12)
  m.prism([(x, .12 + .15 * (1 - (x / .16) ** 2) ** .5) for x in (.16, .12, .06, 0, -.06, -.12, -.16)], .79, .805, C['ink'], rot=(-8, 0, 0))
  m.box((0, .87, .2), (.06, .06, .02), 'gold', rot=(-18, 0, 45))
@asset
def civilian_torso(m):
  m.box((0, .42, 0), (.36, .28, .24), 'cream', .05, top=(1.06, 1, 0, 0))
  m.box((0, .49, .118), (.1, .12, .02), 'white', rot=(0, 0, 45))
  for x in (-1, 1): m.box((x * .06, .47, .122), (.035, .16, .015), '#c9b58c', rot=(0, 0, x * 18))
  m.box((0, .545, .13), (.05, .025, .02), 'velvet', .005); m.ico((0, .545, .14), .014, 'velvetD', 1)
  m.box((0, .3, 0), (.37, .045, .25), '#2a2230', .01)
  m.box((-.1, .45, .123), (.045, .03, .01), 'rose')
  m.cyl((0, .54, 0), .09, .04, 'skinC', 10)
  for x in (-1, 1):
    m.box((x * .225, .47, 0), (.1, .15, .13), 'cream', .03); m.box((x * .232, .375, .012), (.09, .1, .1), 'cream', .02)
    m.box((x * .232, .33, .012), (.092, .02, .102), 'white'); m.ball((x * .235, .3, .02), .05, 'skinC', 8, 5)
@asset
def civilian_head(m):
  m.ball((0, .71, 0), (.17, .165, .16), 'skinC', 14, 9)
  m.ball((0, .77, -.03), (.178, .12, .17), '#1c1414', 12, 7)
  m.ball((0, .9, -.07), (.085, .075, .085), '#1c1414', 10, 6)
  m.cyl((0, .87, -.07), .07, .03, 'velvetL', 10)
  for x in (-1, 1):
    m.ball((x * .06, .72, .15), (.02, .024, .018), C['ink'], 6, 4)
    m.cyl((x * .06, .705, .158), .045, .012, 'gold', 8, rot=(90, 0, 0))
    m.ball((x * .168, .69, 0), (.028, .042, .034), 'skinCD', 6, 4); m.ico((x * .172, .64, .01), .018, 'gold', 1)
  m.box((0, .723, .165), (.04, .01, .01), 'gold')
  m.ball((0, .675, .162), (.03, .028, .026), 'skinCD', 8, 5)
  m.box((0, .63, .148), (.05, .014, .02), '#b0303e')
DOG_LEG_Y, DOG_LEG = .22, (.075, .16)  # dog legs pivot at y=DOG_LEG_Y, x=±DOG_LEG[0], z=±DOG_LEG[1]
@asset
def dog_body(m):
  m.box((0, .31, -.02), (.2, .16, .44), '#2b221f', .05, top=(1.05, 1, 0, 0))
  m.box((0, .29, .12), (.16, .12, .14), '#b26a36', .03)
  m.box((0, .41, .25), (.16, .14, .16), '#2b221f', .04)
  m.box((0, .38, .36), (.09, .075, .12), '#b26a36', .02); m.ico((0, .4, .425), .022, C['ink'], 1)
  for x in (-1, 1):
    m.box((x * .055, .52, .22), (.045, .1, .03), '#2b221f', rot=(-10, 0, x * -12), top=(.3, 1, 0, 0))
    m.ico((x * .045, .44, .33), .016, '#f4e0a0', 1); m.box((x * .05, .4, .332), (.025, .02, .02), '#b26a36')
  m.cyl((0, .33, .2), (.09, .07), .04, 'red', 10, rot=(20, 0, 0)); m.ico((0, .32, .28), .02, 'gold', 1)
  m.box((0, .41, -.28), (.035, .035, .14), '#2b221f', rot=(-35, 0, 0))
@asset
def dog_leg(m):
  m.box((0, -.1, 0), (.06, .2, .07), '#2b221f', .015)
  m.box((0, -.205, .015), (.065, .035, .09), '#b26a36', .01)
@asset
def bird(m):
  m.ball((0, .09, 0), (.055, .05, .09), C['ink'], 8, 5)
  m.ball((0, .075, .01), (.045, .035, .06), 'white', 8, 4)
  m.ball((0, .12, .09), .045, C['ink'], 8, 5)
  m.cyl((0, .12, .125), .015, .04, '#3a3d46', 5, r2=.002, rot=(90, 0, 0))
  for x in (-1, 1):
    m.ico((x * .025, .135, .115), .008, 'gold', 1)
    m.prism([(x * px, z) for px, z in ((0, .04), (.16, .0), (.2, -.07), (.08, -.06), (0, -.04))], .1, .115, '#1c3f6e', c=(x * .03, 0, 0), rot=(0, 0, x * 8))
    m.prism([(x * px, z) for px, z in ((.03, .03), (.11, .0), (.08, -.03), (.03, -.02))], .116, .12, 'white', c=(x * .03, 0, 0), rot=(0, 0, x * 8))
  m.box((0, .1, -.15), (.04, .012, .16), 'tealD', top=(1.6, 1, 0, 0))

# ─── props: floor origin at the footprint centre, front +Z, canonical footprint noted per asset ──────────────
@asset
def prop_desk(m):  # 2x1
  m.box((0, .72, 0), (1.9, .06, .9), 'walnut', .02)
  for x in (-1, 1):
    m.box((x * .66, .35, 0), (.5, .7, .8), 'wood', .02)
    for y in (.2, .45): m.box((x * .66, y, .405), (.42, .18, .02), 'woodL'); m.box((x * .66, y, .42), (.1, .025, .02), 'brass')
  m.box((0, .45, -.36), (.84, .5, .04), 'woodD')
  m.box((.05, .756, .05), (.8, .012, .5), '#2f6b4a'); m.box((.05, .758, .05), (.72, .012, .44), '#3b7d57')
  m.box((-.05, .766, .08), (.24, .01, .3), 'paper', rot=(0, 12, 0)); m.box((.18, .77, .02), (.22, .01, .28), '#efe6cc', rot=(0, -8, 0))
  m.box((.2, .776, .12), (.14, .006, .006), C['ink'], rot=(0, 30, 0))
  m.cyl((-.66, .75, -.22), .08, .03, 'brass', 10); m.cyl((-.66, .75, -.22), .015, .2, 'brass', 6)
  m.cyl((-.49, .96, -.25), .075, .34, 'emerald', 8, rot=(0, 0, 90)); m.box((-.66, .955, -.25), (.32, .03, .11), '#2b9a63')
  m.box((.62, .78, -.22), (.2, .06, .16), C['char'], .015); m.box((.62, .83, -.22), (.22, .035, .05), C['ink'], .01)
  m.cyl((.45, .75, .22), .045, .1, 'cream', 8); m.cyl((.45, .835, .22), .035, .018, '#4a2616', 8)
@asset
def prop_chair(m):
  legs4(m, .42, .42, .38, 'woodD', .045)
  m.box((0, .41, .02), (.46, .07, .44), 'walnut', .015); m.box((0, .465, .035), (.4, .05, .36), 'velvet', .02)
  m.box((0, .68, -.2), (.44, .46, .07), 'walnut', .015); m.box((0, .68, -.162), (.34, .34, .02), 'velvet', .01)
  m.box((0, .92, -.2), (.48, .05, .09), 'walnut', .015)
@asset
def prop_table(m):
  legs4(m, .8, .8, .68, 'woodD', .07, .1)
  m.box((0, .7, 0), (.88, .05, .88), 'walnut', .02); m.box((0, .727, 0), (.64, .01, .64), 'cream')
  m.box((0, .731, 0), (.5, .01, .5), 'velvetL', rot=(0, 45, 0))
  m.cyl((0, .73, 0), .09, .05, 'brass', 10, r2=.12); m.ico((0, .8, 0), .05, 'rose', 1)
  for x, z in ((-.24, .22), (.25, -.2)): m.cyl((x, .73, z), .055, .008, 'woodL', 8)
@asset
def prop_sofa(m):  # 2x1
  for x in (-1, 1):
    for z in (-1, 1): m.cyl((x * .82, 0, z * .33), .04, .08, 'brass', 6)
  m.box((0, .2, .02), (1.86, .24, .82), 'velvetD', .03)
  for x in (-1, 1): m.box((x * .39, .38, .08), (.76, .12, .6), 'velvetL', .04)
  m.box((0, .5, -.3), (1.86, .52, .22), 'velvet', .05)
  for x in (-.6, -.2, .2, .6): m.ico((x, .58, -.186), .018, 'brass', 1)
  for x in (-1, 1): m.box((x * .86, .4, .02), (.16, .3, .82), 'velvet', .06)
@asset
def prop_bed(m):  # 1x2
  m.box((0, .15, .02), (.9, .3, 1.84), 'wood', .02)
  m.box((0, .34, .02), (.84, .16, 1.78), 'paper', .03)
  m.box((0, .44, .28), (.88, .07, 1.26), 'teal', .02); m.box((0, .445, -.32), (.885, .075, .12), 'cream', .02)
  for z in (.1, .5): m.box((0, .476, z), (.886, .006, .04), 'tealD')
  m.box((0, .5, -.64), (.62, .1, .28), 'white', .05)
  m.box((0, .55, -.93), (.94, .9, .1), 'walnut', .02); m.box((0, .62, -.87), (.74, .5, .02), 'velvet', .01)
  m.box((0, .3, .93), (.94, .4, .08), 'walnut', .02)
  m.box((.2, .485, .5), (.18, .03, .24), 'velvet', .01, rot=(0, 20, 0))
def shelf_cell(m, seed):  # tileable 1x1
  rnd = random.Random(seed)
  for x in (-.44, .44):
    for z in (-.42, .14): m.box((x, .52, z), (.05, 1.04, .05), 'steel')
  for y in (.1, .52, .94): m.box((0, y, -.14), (.96, .04, .64), 'greyD')
  x = -.4
  while x < .34:
    w = rnd.uniform(.14, .26); kind = rnd.random(); y0 = rnd.choice((.12, .54, .96))
    if kind < .5: m.box((x + w / 2, y0 + .1, -.18), (w, .2, .34), rnd.choice(('#c49a62', '#b48852', '#d5ae70')), .01)
    else: m.cyl((x + w / 2, y0, -.12), .06, .22, rnd.choice(('teal', 'orange', 'rose', 'leafL')), 8)
    x += w + .04
  m.box((-.2, 1.06, -.16), (.36, .2, .4), '#c49a62', .01); m.box((-.2, 1.162, -.16), (.37, .006, .06), '#e6d2a0')
  m.cyl((.22, .96, -.1), .08, .16, 'tealL', 8); m.cyl((.22, 1.12, -.1), .085, .03, 'white', 8)
ASSETS['prop_shelf'] = lambda m: shelf_cell(m, 3)
@asset
def prop_bookcase(m):  # tileable 1x1
  rnd = random.Random(8)
  m.box((0, .67, -.2), (.96, 1.34, .04), 'woodD')
  for x in (-.46, .46): m.box((x, .67, -.05), (.04, 1.34, .6), 'walnut')
  for y in (.04, .46, .88): m.box((0, y, -.05), (.92, .04, .58), 'walnut')
  m.box((0, 1.36, -.04), (1.0, .06, .66), 'wood', .015)
  cols = ['velvet', 'emerald', 'navy', '#c9953a', 'tealD', '#7a3b58', 'cream', 'orange']
  for y in (.06, .48, .9):
    x = -.43
    while x < .4:
      w = rnd.uniform(.05, .09); h = rnd.uniform(.26, .36); m.box((x + w / 2, y + h / 2, .0), (w, h, .38), rnd.choice(cols)); x += w + .006
  for i, col in enumerate(('velvet', 'navy', 'cream')): m.box((-.2, 1.41 + i * .04, -.05), (.3 - i * .03, .04, .38), col, rot=(0, 8 * i, 0))
  m.cyl((.22, 1.39, -.08), .06, .03, 'brass', 8); m.ball((.22, 1.5, -.08), .09, 'tealL', 10, 6)
  m.box((.22, 1.5, -.08), (.2, .02, .02), 'brass', rot=(0, 0, 25))
@asset
def prop_crate(m):
  m.box((0, .38, 0), (.8, .76, .8), 'oak', .02)
  for a in range(4):
    sa, ca = sin(a * pi / 2), cos(a * pi / 2)
    for y in (.06, .7): m.box((sa * .405, y, ca * .405), (.82, .1, .02), 'wood', rot=(0, a * 90, 0))
    m.box((ca * .35 + sa * .405, .38, ca * .405 - sa * .35), (.1, .76, .02), 'wood', rot=(0, a * 90, 0))
  for x in (-.34, .34): m.box((x, .765, 0), (.1, .02, .8), 'wood')
  m.box((0, .765, 0), (.1, .02, 1.02), 'wood', rot=(0, 45, 0))
  m.box((-.12, .4, .417), (.2, .12, .005), '#3a2616')
@asset
def prop_barrel(m):
  m.lathe([(.29, 0), (.33, .12), (.35, .2), (.36, .4), (.35, .6), (.33, .68), (.3, .8), (.27, .8), (.27, .78), (0, .78)],
          ['#8b5a33', '#3a3d46', '#8b5a33', '#8b5a33', '#8b5a33', '#3a3d46', '#8b5a33', '#8b5a33', '#a8744a'], 12)
  for x in (-.1, .1): m.box((x, .785, 0), (.012, .005, .52), '#6e4526')
  m.cyl((.12, .78, .08), .035, .02, '#3a2616', 8)
@asset
def prop_plant(m):
  m.lathe([(.18, 0), (.22, .3), (.25, .31), (.25, .36), (.22, .36), (0, .34)], ['terra', 'terra', '#d9855a', '#d9855a', 'soil'], 10)
  for i in range(9):
    a = i * 40 + 12
    m.prism([(0, 0), (.07, .16), (0, .42), (-.07, .16)], 0, .02, ('leaf', 'leafL', 'leafD')[i % 3], c=(sin(radians(a)) * .05, .34, cos(radians(a)) * .05), rot=(-38 + (i % 2) * 16, a, 0))
  m.ico((0, .42, 0), .12, 'leafD', 1)
@asset
def prop_tree(m):
  m.cyl((0, 0, 0), .1, .9, '#6b4228', 8, r2=.07)
  for a in (0, 120, 240): m.box((sin(radians(a)) * .12, .04, cos(radians(a)) * .12), (.06, .08, .18), '#6b4228', rot=(0, a, 0))
  m.ico((0, 1.05, 0), (.5, .38, .5), 'leafD', 2)
  m.ico((-.12, 1.32, .08), (.36, .3, .36), 'leaf', 2, rot=(0, 30, 0))
  m.ico((.16, 1.28, -.1), (.3, .26, .3), 'leaf', 1, rot=(10, 0, 0))
  m.ico((.02, 1.55, .0), (.24, .2, .24), 'leafL', 1)
  for a in (40, 170, 290): m.ico((sin(radians(a)) * .35, 1.2, cos(radians(a)) * .35), .07, 'rose', 1)
@asset
def prop_statue(m):  # a golden lucky cat on a marble plinth
  m.box((0, .06, 0), (.78, .12, .78), 'stoneD', .02); m.box((0, .36, 0), (.66, .5, .66), 'marble', .02)
  m.box((0, .62, 0), (.74, .06, .74), 'stone', .02); m.box((0, .36, .333), (.3, .1, .01), 'brass')
  m.ball((0, .84, -.02), (.19, .2, .16), 'gold', 12, 7)
  m.ball((0, 1.08, .01), (.17, .15, .15), 'gold', 12, 7)
  for x in (-1, 1):
    m.cyl((x * .09, 1.17, .01), .055, .1, 'gold', 4, r2=.005, rot=(0, 45, x * -12)); m.ball((x * .06, 1.1, .148), (.03, .012, .01), C['ink'], 6, 3)
    m.ball((x * .08, .67, .12), (.06, .04, .06), 'gold', 8, 4)
  m.box((.16, 1.08, .06), (.08, .22, .08), 'gold', .02, rot=(0, 0, -10)); m.ball((.18, 1.2, .07), .05, 'gold', 8, 5)
  m.ball((-.13, .86, .1), .06, 'gold', 8, 5)
  m.cyl((0, .94, .0), (.17, .15), .03, 'red', 12); m.ico((0, .92, .15), .03, '#ffd35a', 1)
  m.box((0, .86, .14), (.14, .09, .02), 'cream', .005)
@asset
def prop_rug(m):  # ≤ 0.02 tall, scaled to its placed footprint
  m.box((0, .004, 0), (.98, .008, .98), 'velvetD'); m.box((0, .006, 0), (.9, .012, .9), 'gold')
  m.box((0, .008, 0), (.84, .016, .84), 'velvet'); m.prism([(0, -.34), (.34, 0), (0, .34), (-.34, 0)], 0, .018, 'cream')
  m.prism([(0, -.24), (.24, 0), (0, .24), (-.24, 0)], 0, .019, 'velvetD'); m.prism(star(.14, .06, 4), 0, .02, 'gold')
  for x in (-1, 1):
    for z in (-1, 1): m.prism([(0, -.06), (.06, 0), (0, .06), (-.06, 0)], 0, .018, 'gold', c=(x * .33, 0, z * .33))
@asset
def prop_bar(m):  # tileable 1x1, customer side +Z
  m.box((0, .45, -.04), (1.0, .9, .64), 'walnut')
  for x in (-.25, .25): m.box((x, .47, .285), (.4, .62, .02), 'velvetD', .005)
  m.box((0, .93, .0), (1.0, .07, .76), '#3b2016', .015); m.box((0, .968, .3), (1.0, .01, .08), 'brass')
  m.cyl((-.5, .14, .33), .025, 1.0, 'brass', 8, rot=(0, 0, -90))
  for x in (-.3, .3): m.box((x, .11, .31), (.03, .06, .06), 'brassD')
  m.cyl((.22, .965, .08), .04, .012, 'glass', 8); m.cyl((.22, .977, .08), .006, .08, '#cfe6ee', 6)
  m.cyl((.22, 1.05, .08), .005, .06, '#cfe6ee', 8, r2=.05); m.cyl((.22, 1.085, .08), .04, .012, 'rose', 8)
  m.box((-.2, .968, -.05), (.3, .006, .22), 'cream', rot=(0, 10, 0))
@asset
def prop_piano(m):  # 2x1 baby grand: keyboard at -X, straight side at -Z, curved side +Z
  body = [(-.95, -.42), (.8, -.42), (.93, -.34), (.95, -.2), (.86, -.08), (.62, .02), (.32, .1), (.06, .22), (-.18, .36), (-.4, .43), (-.95, .43)]
  m.prism(body, .3, .7, C['ink']); m.prism([(x * .985, z * .96) for x, z in body], .29, .72, '#1f2129')
  m.prism([(x * .9 + .02, z * .85 - .01) for x, z in body], .72, .725, 'gold')
  m.prism([(x * .87 + .03, z * .8 - .02) for x, z in body], .72, .73, '#23252e')
  for x, z in ((-.82, -.32), (-.82, .32), (.72, -.3)): m.cyl((x, 0, z), .05, .3, C['ink'], 8, r2=.035)
  m.box((-1.0, .62, 0), (.14, .05, .82), C['ink'], .01); m.box((-1.02, .65, 0), (.1, .02, .78), 'white')
  for i in range(11): m.box((-1.0, .67, -.36 + i * .072 + (i % 3 == 0) * .012), (.06, .02, .035), C['ink'])
  m.box((-.8, .82, 0), (.04, .18, .5), C['ink'], rot=(0, 0, -15)); m.box((-.79, .8, 0), (.01, .12, .3), 'paper', rot=(0, 0, -15))
  m.cyl((.3, .73, -.18), .05, .14, 'cream', 8, r2=.03); m.ico((.3, .9, -.18), .04, 'velvetL', 1)
  m.box((-.93, .14, 0), (.04, .12, .12), 'brass')
@asset
def prop_slot(m):  # tileable 1x1, player side +Z
  m.box((0, .38, -.06), (.8, .76, .7), 'velvet', .02)
  m.box((0, .78, .2), (.78, .06, .3), '#2a2e38', .015); m.box((0, .81, .26), (.5, .02, .1), 'glow')
  m.box((0, 1.0, -.06), (.8, .44, .66), 'velvetD', .02, top=(1, .9, 0, -.02))
  m.box((0, 1.02, .24), (.66, .34, .03), 'gold', rot=(-12, 0, 0))
  for i, col in enumerate(('red', 'emerald', 'navy')):
    m.box((-.2 + i * .2, 1.03, .26), (.16, .24, .02), 'white', rot=(-12, 0, 0)); m.prism(star(.05, .022), 0, .012, col, c=(-.2 + i * .2, 1.03, .275), rot=(78, 0, 0))
  m.box((0, 1.32, -.06), (.82, .2, .58), 'gold', .02); m.box((0, 1.32, .23), (.66, .12, .01), 'velvetL')
  m.prism(star(.14, .06), 1.42, 1.44, 'red', c=(0, 0, -.06))
  for i in range(10): m.ico((-.36 + i * .08, 1.425, .2), .018, 'glow', 1); m.ico((-.36 + i * .08, 1.425, -.32), .018, 'glow', 1)
  m.cyl((.41, .7, 0), .04, .08, 'steel', 8, rot=(0, 0, -90)); m.cyl((.45, .7, 0), .014, .45, 'steel', 6); m.ico((.45, 1.16, 0), .05, 'red', 1)
  m.box((0, .45, .29), (.16, .06, .02), C['ink'])
@asset
def prop_roulette(m):  # 2x2, wheel at -X
  legs4(m, 1.7, 1.2, .64, 'woodD', .1, .1)
  m.box((0, .66, 0), (1.9, .08, 1.36), 'walnut', .02)
  m.ring([(x * .95, z * .68) for x, z in circle(1, 4, pi / 4, 1)], [(x * .86, z * .59) for x, z in circle(1, 4, pi / 4, 1)], .7, .78, '#5a2e1c')
  outer = [(.95, -.68), (.95, .68), (-.95, .68), (-.95, -.68)]; inner = [(.87, -.6), (.87, .6), (-.87, .6), (-.87, -.6)]
  m.ring(outer, inner, .68, .79, '#5a2e1c'); m.box((0, .72, 0), (1.76, .02, 1.22), 'felt')
  m.cyl((-.5, .7, 0), .5, .12, 'walnut', 20); m.cyl((-.5, .82, 0), .44, .015, 'woodL', 20)
  n = 19
  for i in range(n):
    a0, a1 = i * tau / n, (i + 1) * tau / n
    m.prism([(.38 * cos(a0), .38 * sin(a0)), (.38 * cos(a1), .38 * sin(a1)), (.25 * cos(a1), .25 * sin(a1)), (.25 * cos(a0), .25 * sin(a0))], .82, .845,
            'emerald' if i == 0 else ('red' if i % 2 else C['ink']), c=(-.5, 0, 0))
  m.cyl((-.5, .82, 0), .25, .03, 'wood', 12, r2=.12); m.cyl((-.5, .85, 0), .06, .09, 'brass', 8, r2=.02)
  for a in (0, 90): m.box((-.5, .93, 0), (.3, .02, .02), 'brass', rot=(0, a, 0))
  m.ico((-.5 + .31, .86, .12), .025, 'white', 1)
  for r in range(3):
    for c in range(6): m.box((.08 + c * .12, .735, -.3 + r * .2), (.11, .01, .18), 'red' if (r + c) % 2 else C['ink'])
  m.box((-.04, .735, -.1), (.1, .01, .58), 'emerald'); m.box((.44, .735, .32), (.7, .01, .12), 'cream')
  for x, z, col in ((.2, -.1, 'red'), (.44, .1, 'navy'), (.56, -.3, 'gold'), (.32, .32, 'white')): m.cyl((x, .735, z), .045, .06, col, 10)
@asset
def prop_cards(m):  # 2x1 blackjack table, dealer at -Z
  arc = [(.95 * cos(a), -.4 + .84 * sin(a)) for a in (i * pi / 16 for i in range(17))]
  inner = [(.86 * cos(a), -.34 + .72 * sin(a)) for a in (i * pi / 16 for i in range(17))]
  m.prism([(.6 * x, .6 * (z + .4) - .4) for x, z in arc], 0, .68, 'woodD')
  m.prism(arc, .66, .72, 'walnut'); m.prism(inner, .7, .745, 'felt')
  m.ring(arc, inner, .7, .78, '#5a2e1c')
  m.box((0, .745, -.36), (1.76, .02, .1), 'felt')
  for i in range(5):
    a = pi * (i + .5) / 5; x, z = .62 * cos(a), -.34 + .5 * sin(a)
    m.box((x, .748, z), (.14, .005, .18), 'cream', rot=(0, 90 - a * 180 / pi, 0))
    if i % 2 == 0: m.box((x + .02, .755, z), (.1, .006, .14), 'white', rot=(0, 100 - a * 180 / pi, 0)); m.box((x + .02, .759, z), (.03, .002, .03), 'red', rot=(0, 100 - a * 180 / pi, 0))
  m.box((0, .76, -.3), (.6, .04, .14), '#3a2616', .01)
  for i, col in enumerate(('red', 'navy', 'emerald', 'gold', 'white', 'red', 'navy', 'emerald')): m.box((-.26 + i * .075, .78, -.3), (.06, .01, .1), col)
  m.box((.62, .78, -.26), (.16, .07, .1), 'velvet', .01); m.box((-.2, .758, .0), (.08, .006, .11), 'white', rot=(0, 20, 0))
@asset
def prop_counter(m):  # tileable 1x1, service side -Z, customer side +Z
  m.box((0, .06, .0), (.96, .12, .74), C['char'])
  m.box((0, .47, 0), (1.0, .7, .78), 'tealD')
  for x in (-.25, .25): m.box((x, .47, .392), (.42, .56, .01), 'teal')
  m.box((0, .85, .02), (1.0, .06, .86), 'marble', .01)
  m.box((0, .881, .34), (1.0, .003, .07), 'teal'); m.box((0, .881, -.34), (1.0, .003, .05), 'tealD')
  m.box((.05, .881, .02), (.7, .002, .012), 'marbleV', rot=(0, 20, 0)); m.box((-.1, .881, -.12), (.4, .002, .01), 'marbleV', rot=(0, -35, 0))
  m.box((0, .82, .452), (1.0, .02, .02), 'brass')
@asset
def prop_locker(m):  # tileable 1x1, doors +Z
  m.box((0, .7, -.14), (.92, 1.4, .62), '#5d7488', .01)
  for x in (-.225, .225):
    m.box((x, .72, .175), (.43, 1.3, .02), '#7a95ab')
    for y in (1.2, 1.26, 1.32): m.box((x, y, .187), (.24, .02, .006), '#34455a')
    m.box((x + (.16 if x < 0 else -.16), .75, .19), (.03, .12, .02), 'brass')
    m.box((x, 1.02, .187), (.1, .05, .004), 'cream')
  m.box((0, 1.41, -.14), (.94, .03, .64), '#4b5f73')
  m.box((-.15, 1.47, -.15), (.4, .1, .22), 'velvet', .03); m.box((.2, 1.43, -.15), (.26, .02, .22), 'white')
@asset
def prop_fountain(m):  # 2x2
  oct_o, oct_i = circle(.97, 8, pi / 8), circle(.8, 8, pi / 8)
  m.ring(oct_o, oct_i, 0, .42, 'stone'); m.ring(circle(1.0, 8, pi / 8), circle(.78, 8, pi / 8), .4, .46, 'cream')
  m.prism(oct_i, 0, .32, 'water'); m.ring(circle(.62, 16), circle(.54, 16), .3, .325, '#7ad7e0')
  for x, z in ((.4, .3), (-.35, .45), (.5, -.25), (-.5, -.2)): m.cyl((x, .322, z), .04, .01, 'gold', 8)
  m.cyl((0, .3, 0), .12, .5, 'stone', 8)
  m.lathe([(.08, .78), (.36, .9), (.4, .96), (.36, .96), (0, .92)], ['stone', 'cream', 'cream', 'water'], 12)
  m.cyl((0, .9, 0), .07, .3, 'stone', 8); m.ball((0, 1.24, 0), .09, 'stone', 8, 5)
  m.cyl((0, 1.3, 0), .05, .22, '#bdeef2', 6, r2=.01)
  for a in range(4): m.box((sin(a * pi / 2) * .9, .47, cos(a * pi / 2) * .9), (.14, .06, .14), 'stoneD', rot=(0, 22.5 + a * 90, 0))
def wheels(m, pts, r=.16, w=.12):
  for x, z in pts:
    s = 1 if z > 0 else -1
    m.cyl((x, r, z - s * w / 2), r, w, C['ink'], 10, rot=(s * 90, 0, 0)); m.cyl((x, r, z + s * w / 2 - s * .005), r * .5, .012, 'steel', 8, rot=(s * 90, 0, 0))
@asset
def prop_car(m):  # 2x1, nose +X
  wheels(m, [(x, z) for x in (-.6, .62) for z in (-.38, .38)])
  m.box((0, .34, 0), (1.9, .3, .86), 'teal', .06)
  m.box((.05, .46, 0), (1.86, .06, .87), 'cream')
  m.box((-.08, .64, 0), (1.0, .28, .8), 'glass', .03, top=(.72, .85, -.02, 0))
  m.box((-.1, .79, 0), (.68, .04, .66), 'cream', .02)
  m.box((.65, .5, 0), (.5, .02, .62), '#27797a'); m.box((-.8, .5, 0), (.3, .02, .62), '#27797a')
  for z in (-1, 1):
    m.ball((.94, .38, z * .3), (.03, .06, .08), 'glow', 8, 4); m.box((-.95, .38, z * .3), (.02, .05, .12), 'red')
  for x in (-.97, .97): m.box((x, .22, 0), (.06, .08, .88), 'steel', .02)
  m.box((.56, .52, .0), (.06, .02, .5), 'brass')
@asset
def prop_van(m):  # 2x2 getaway van, nose +X
  wheels(m, [(x, z) for x in (-.6, .6) for z in (-.62, .62)], .19, .14)
  m.box((-.1, .66, 0), (1.66, .94, 1.36), '#2f3544', .06)
  m.box((.74, .5, 0), (.36, .6, 1.34), '#2f3544', .05)
  m.box((.68, .92, 0), (.16, .3, 1.24), 'glass', .02, rot=(0, 0, -25))
  for z in (-1, 1):
    m.box((.66, .88, z * .68), (.3, .24, .01), 'glass'); m.box((-.1, .62, z * .685), (1.5, .14, .01), 'tealL')
    m.box((-.2, .78, z * .685), (.6, .06, .01), 'cream'); m.ball((.93, .46, z * .45), (.02, .06, .1), 'glow', 8, 4)
  m.box((-.1, 1.14, 0), (1.5, .03, 1.2), '#3a4254')
  for z in (-.45, .45): m.box((-.1, 1.2, z), (1.5, .04, .04), 'steel')
  for x in (-.75, -.35, .05, .45): m.box((x, 1.2, 0), (.04, .04, .94), 'steel')
  m.box((-.45, 1.23, .18), (.5, .03, .22), 'brass')
  for x in (-.66, -.58, -.5, -.42, -.34, -.26): m.box((x, 1.235, .18), (.015, .035, .22), 'brassD')
  m.box((.2, 1.2, -.2), (.3, .08, .3), 'greyD', .02); m.box((.94, .24, 0), (.06, .1, 1.3), 'steel', .02); m.box((-.95, .24, 0), (.04, .1, 1.3), 'steel')
@asset
def prop_boat(m):  # 3x2, bow +X
  hull = [(-1.42, -.62), (.5, -.66), (1.05, -.46), (1.46, 0), (1.05, .46), (.5, .66), (-1.42, .62)]
  m.prism([(x * .9, z * .8) for x, z in hull], 0, .2, 'navy'); m.prism(hull, .2, .46, 'white')
  m.prism([(x * 1.01, z * 1.03) for x, z in hull], .34, .4, 'velvet')
  m.prism([(x * .92, z * .86) for x, z in hull], .46, .48, 'teak')
  for i in range(7): m.box((-1.2 + i * .34, .483, 0), (.012, .004, 1.0), '#8a5530')
  m.box((-.15, .72, 0), (.8, .5, .84), 'white', .03)
  m.box((.3, .78, 0), (.14, .36, .78), 'glass', rot=(0, 0, -30)); m.box((-.15, 1.0, 0), (.9, .06, .9), 'navy', .02)
  m.box((-.15, .86, .425), (.6, .12, .01), 'glass'); m.box((-.15, .86, -.425), (.6, .12, .01), 'glass')
  m.box((-1.0, .6, 0), (.34, .24, .9), 'cream', .04)
  m.lathe([(.2, 1.03), (.25, 1.07), (.2, 1.11), (.15, 1.07)], ['red', 'white', 'red', 'white'], 12, c=(-.15, 0, 0), closed=True)
  m.cyl((.9, .48, .2), .12, .04, '#c9a36a', 10); m.cyl((.9, .52, .2), .07, .01, 'teak', 8)
  m.cyl((.25, 1.03, 0), .015, .3, 'steel', 6); m.ico((.25, 1.34, 0), .025, 'red', 1)
@asset
def prop_lamp(m):  # street / floor lamp: iron post, glowing globe
  m.cyl((0, 0, 0), .16, .06, C['char'], 10); m.cyl((0, .06, 0), .1, .1, C['char'], 8, r2=.06)
  m.lathe([(.04, .16), (.035, 1.2), (.06, 1.26), (.1, 1.3), (.1, 1.33)], [C['char'], C['char'], 'brass', 'brass'], 8)
  m.ball((0, 1.46, 0), .15, 'glow', 12, 7); m.cyl((0, 1.33, 0), .12, .04, 'brassD', 10)
  for a in range(4): m.box((sin(a * pi / 2) * .1, 1.3, cos(a * pi / 2) * .1), (.03, .03, .1), 'brass', rot=(0, a * 90, 0))
  m.ico((0, 1.62, 0), .025, 'brass', 1)
@asset
def prop_painting(m):  # origin on the floor at the wall face, hangs facing +Z
  m.box((0, 1.05, .03), (.8, .62, .06), '#c9953a', .015); m.box((0, 1.05, .062), (.66, .48, .01), '#152844')
  m.prism([(-.33, .0), (-.1, -.14), (.1, -.06), (.33, -.16), (.33, .24), (-.33, .24)], .062, .068, 'leafD', rot=(90, 0, 0), c=(0, 1.05, 0))
  m.prism([(-.33, .1), (-.05, .0), (.33, .05), (.33, .24), (-.33, .24)], .068, .072, 'teal', rot=(90, 0, 0), c=(0, 1.05, 0))
  m.cyl((.18, 1.17, .062), .06, .012, 'cream', 12, rot=(90, 0, 0))
  m.box((0, 1.4, .09), (.36, .03, .05), 'brass'); m.box((0, 1.38, .04), (.03, .04, .08), 'brass')
@asset
def prop_server(m):
  m.box((0, .66, 0), (.74, 1.32, .74), '#23262e', .02)
  for i in range(8):
    y = .2 + i * .13; m.box((0, y, .372), (.64, .1, .01), '#343945')
    for j in range(2): m.box((-.25 + j * .06, y, .38), (.025, .025, .01), ('#5ef0a0', 'tealL', '#ffb347', 'red')[(i + j * 3) % 4])
    m.box((.14, y, .379), (.28, .015, .004), '#161820')
  for i in range(5): m.box((-.2 + i * .1, 1.325, -.1), (.05, .01, .4), '#161820')
  for i, col in enumerate(('#3f7fd8', 'gold', 'red', 'leafL')): m.tube([(-.2 + i * .08, 1.3, .3), (-.2 + i * .08, 1.37, .2), (-.18 + i * .1, 1.37, -.2), (-.16 + i * .1, 1.3, -.37)], .016, col, 5)
  m.box((.22, 1.33, .22), (.16, .005, .12), '#ffd35a')
@asset
def prop_bench(m):  # 2x1 park bench, seat faces +Z
  for x in (-.8, 0, .8):
    m.box((x, .2, .12), (.06, .4, .06), '#27453a'); m.box((x, .2, -.18), (.06, .4, .06), '#27453a')
    m.box((x, .4, -.02), (.06, .05, .44), '#27453a'); m.box((x, .62, -.26), (.06, .5, .05), '#27453a', rot=(-12, 0, 0))
  for i in range(4): m.box((0, .44, -.14 + i * .1), (1.84, .04, .085), 'teak', .008)
  for i in range(3): m.box((0, .55 + i * .12, -.27 - i * .025), (1.84, .085, .035), 'teak', .008, rot=(-12, 0, 0))
  for x in (-1, 1): m.box((x * .86, .6, 0), (.06, .04, .34), '#27453a')
@asset
def prop_flowerbed(m):  # tileable 1x1
  rnd = random.Random(5)
  m.box((0, .15, 0), (.96, .3, .9), '#9b4a36', .02)
  m.ring([(.5, -.47), (.5, .47), (-.5, .47), (-.5, -.47)], [(.42, -.39), (.42, .39), (-.42, .39), (-.42, -.39)], .28, .34, 'cream')
  m.box((0, .3, 0), (.86, .02, .8), 'soil')
  for x, z in ((-.2, -.18), (.2, -.2), (-.18, .2), (.22, .18), (0, 0)): m.ico((x, .36, z), (.17, .12, .17), rnd.choice(('leaf', 'leafD')), 1, rot=(0, rnd.uniform(0, 90), 0))
  for i in range(11): m.ico((rnd.uniform(-.36, .36), .47 + rnd.uniform(0, .04), rnd.uniform(-.33, .33)), .04, ('rose', 'gold', 'white', '#b07ae0')[i % 4], 1)
@asset
def prop_container(m):  # 3x1, doors +X
  m.box((0, .64, 0), (2.9, 1.24, .92), '#b94f2e')
  for i in range(13):
    x = -1.3 + i * .2167
    for z in (-1, 1): m.box((x, .64, z * .47), (.09, 1.1, .03), '#a3432a')
    m.box((x, 1.265, 0), (.09, .02, .86), '#c65a36')
  for x in (-1.44, 1.44):
    for z in (-1, 1):
      for y in (.06, 1.22): m.box((x, y, z * .45), (.1, .12, .1), C['char'])
  for z in (-.3, -.1, .1, .3): m.cyl((1.46, .1, z), .018, 1.1, 'steel', 6)
  m.box((0, 1.28, 0), (1.2, .01, .5), 'cream'); m.box((-.2, 1.285, 0), (.6, .01, .16), 'velvetD'); m.prism(star(.14, .06), 1.28, 1.292, 'gold', c=(.35, 0, 0))

# ─── objects ───────────────────────────────────────────────────────────────────────────────────────────────
@asset
def obj_safe(m):
  for x in (-1, 1):
    for z in (-1, 1): m.box((x * .33, .03, z * .3), (.08, .06, .08), C['char'])
  m.box((0, .47, 0), (.8, .82, .74), '#2e5d57', .04)
  m.box((0, .47, .37), (.62, .64, .03), '#3b7068', .015)
  m.cyl((0, .55, .38), .11, .04, 'brass', 12, rot=(90, 0, 0)); m.cyl((0, .55, .42), .07, .03, 'gold', 12, rot=(90, 0, 0))
  m.box((0, .64, .425), (.015, .03, .01), C['ink'])
  for a in (0, 120, 240): m.box((sin(radians(a)) * .07, .3 + cos(radians(a)) * .07, .4), (.022, .14, .022), 'brassD', rot=(0, 0, a))
  for y in (.3, .64): m.box((-.33, y, .38), (.04, .1, .04), 'brassD')
  m.box((0, .885, .0), (.84, .02, .78), '#26504a'); m.box((0, .9, .2), (.3, .012, .1), 'brass'); m.box((0, .907, .2), (.2, .004, .02), '#6b4a1a')
@asset
def obj_terminal(m):
  legs4(m, .82, .6, .66, C['greyD'], .05)
  m.box((0, .68, 0), (.86, .05, .64), 'greyD', .01)
  m.box((0, .92, -.1), (.46, .4, .36), '#d9d2bf', .03); m.box((0, .88, -.3), (.34, .3, .1), '#c7bfa9', .02)
  m.box((0, .93, .082), (.38, .3, .01), '#123326', rot=(-8, 0, 0)); m.box((0, .93, .088), (.32, .24, .01), '#4ee39a', rot=(-8, 0, 0))
  for i in range(4): m.box((-.05, .98 - i * .05, .095), (.2 - i * .03, .018, .004), '#123326', rot=(-8, 0, 0))
  m.box((0, .72, .18), (.44, .03, .16), '#d9d2bf', .008)
  for r in range(3): m.box((0, .737, .13 + r * .045), (.38, .006, .03), '#8a8372')
  m.box((.3, .715, .16), (.08, .02, .1), '#d9d2bf', .005); m.box((.15, 1.13, -.02), (.06, .01, .08), 'red')
@asset
def obj_camera(m):  # origin at the wall face 1.3 above the floor; lens toward +Z
  m.box((0, 0, .015), (.14, .16, .03), 'greyD', .008); m.cyl((0, 0, .02), .025, .12, 'grey', 8, rot=(90, 0, 0))
  m.box((0, -.03, .26), (.13, .12, .26), '#e8e6de', .02, rot=(18, 0, 0))
  m.box((0, .02, .27), (.16, .02, .32), 'greyL', rot=(18, 0, 0))
  m.cyl((0, -.1, .38), .045, .04, C['ink'], 10, rot=(108, 0, 0)); m.cyl((0, -.11, .415), .03, .005, '#6fe0ff', 10, rot=(108, 0, 0))
  m.ico((.045, .03, .18), .012, 'red', 1)
@asset
def obj_laser(m):  # origin at the wall face 1.3 above the floor; beam toward +Z
  m.box((0, 0, .015), (.16, .2, .03), 'greyD', .008)
  m.box((0, 0, .08), (.11, .13, .1), C['char'], .015)
  m.cyl((0, 0, .13), .04, .02, 'brass', 10, rot=(90, 0, 0)); m.cyl((0, 0, .148), .025, .01, '#ff3a4a', 10, rot=(90, 0, 0))
  m.ico((0, .05, .12), .01, '#ff3a4a', 1)
@asset
def obj_vent(m):
  m.box((0, .012, 0), (.8, .024, .8), 'steel', .005); m.box((0, .014, 0), (.66, .024, .66), C['ink'])
  for i in range(6): m.box((0, .02, -.275 + i * .11), (.66, .024, .035), 'grey')
  for x in (-1, 1):
    for z in (-1, 1): m.cyl((x * .35, .02, z * .35), .018, .012, 'greyL', 6)
@asset
def obj_medkit(m):
  m.box((0, .11, 0), (.44, .2, .32), 'white', .03)
  m.box((0, .11, 0), (.45, .03, .33), '#d8d2c4')
  m.box((0, .213, 0), (.22, .012, .07), 'red'); m.box((0, .213, 0), (.07, .012, .22), 'red')
  m.box((0, .235, -.13), (.16, .04, .03), 'greyD', .008)
  for x in (-.12, .12): m.box((x, .15, .163), (.04, .05, .01), 'brass')
@asset
def obj_bush(m):
  for x, z, r, col in ((0, 0, .34, 'leaf'), (-.22, .14, .26, 'leafD'), (.22, .12, .25, 'leafL'), (.16, -.2, .24, 'leafD'), (-.18, -.18, .25, 'leaf')):
    m.ico((x, r * .8, z), (r, r * .85, r), col, 2 if r > .3 else 1, rot=(0, x * 200, 0))
  for x, z in ((.1, .3), (-.3, 0), (.28, -.1), (-.05, -.3), (0, .06)): m.ico((x, .62 + (x == 0) * .06, z), .035, 'white' if x > 0 else 'rose', 1)
@asset
def obj_closet(m):
  for x in (-1, 1): m.box((x * .38, .04, -.1), (.08, .08, .5), 'woodD')
  m.box((0, .82, -.1), (.9, 1.48, .6), 'walnut', .02)
  for x in (-.215, .215):
    m.box((x, .82, .205), (.41, 1.34, .02), 'wood', .006); m.box((x, .95, .22), (.3, .5, .01), '#a86a3c'); m.box((x, .45, .22), (.3, .3, .01), '#a86a3c')
  for x in (-.04, .04): m.ball((x, .8, .23), .022, 'brass', 6, 4)
  m.box((0, 1.59, -.1), (.98, .06, .66), 'woodD', .015)
  m.lathe([(.15, 1.62), (.15, 1.78), (.16, 1.78), (.16, 1.82), (0, 1.82)], ['teal', 'cream', 'cream', 'teal'], 12, c=(-.18, 0, -.08))
  m.box((.2, 1.68, -.1), (.36, .12, .26), 'velvet', .02); m.box((.2, 1.75, -.1), (.1, .02, .04), 'brass')
@asset
def obj_door(m):  # slab x -0.5..0.5, 0.12 thick, 1.45 tall; hinge side is the renderer's choice
  m.box((0, .725, 0), (1.0, 1.45, .12), 'wood', .012)
  for z in (-1, 1):
    for x in (-.22, .22):
      for y, h in ((.42, .56), (1.08, .56)): m.box((x, y, z * .062), (.34, h, .012), '#a86a3c', .004)
    m.ball((.38, .74, z * .08), .035, 'brass', 8, 5)
  m.box((0, 1.452, 0), (1.0, .01, .12), 'woodL')
@asset
def obj_window(m):  # frame and glass x -0.5..0.5; sill top at 0.58, head at 1.56; glass alpha 0.35 in COLOR_0
  m.box((0, .55, .02), (1.0, .06, .26), 'stone', .01)
  m.box((0, 1.52, 0), (1.0, .08, .2), 'wood', .01)
  for x in (-.46, .46): m.box((x, 1.03, 0), (.08, .94, .16), 'wood')
  m.box((0, 1.03, 0), (.04, .94, .06), 'woodL'); m.box((0, 1.05, 0), (.88, .04, .06), 'woodL')
  m.box((0, 1.03, 0), (.86, .92, .03), '#9fd8ec', alpha=.35)
@asset
def obj_pedestal(m):  # top surface at y = 0.75 for the objective
  m.box((0, .05, 0), (.64, .1, .64), 'walnut', .015)
  m.box((0, .4, 0), (.42, .6, .42), 'marble', .02)
  for y in (.14, .66): m.box((0, y, 0), (.46, .04, .46), 'brass')
  m.box((0, .71, 0), (.56, .08, .56), 'marble', .015); m.box((0, .7505, 0), (.44, .001, .44), 'velvet')
  posts = [(x * .42, z * .42) for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
  for x, z in posts: m.cyl((x, 0, z), .06, .03, 'brassD', 8); m.cyl((x, .03, z), .022, .55, 'brass', 6); m.ico((x, .6, z), .04, 'gold', 1)
  for (x0, z0), (x1, z1) in zip(posts, posts[1:] + posts[:1]):
    m.tube([(x0, .53, z0), ((x0 + x1) / 2, .4, (z0 + z1) / 2), (x1, .53, z1)], .02, 'velvetL', 5)
@asset
def obj_ledger(m):  # sits on the pedestal top: y from 0.75
  m.box((.005, .79, .0), (.33, .06, .25), 'paper')
  m.box((0, .76, 0), (.34, .02, .26), '#8e1f2c', .006); m.box((0, .822, 0), (.34, .02, .26), '#8e1f2c', .006)
  m.cyl((-.17, .79, -.13), .039, .26, '#6e1624', 8, rot=(90, 0, 0))
  for x in (-1, 1):
    for z in (-1, 1): m.box((x * .15, .833, z * .11), (.05, .006, .05), 'gold')
  m.prism(star(.06, .03, 4), .832, .836, 'gold'); m.box((.06, .8, .14), (.02, .004, .08), 'gold', rot=(-60, 0, 0))
@asset
def obj_jewel(m):  # prism jewel on a velvet cushion, from y 0.75
  m.box((0, .78, 0), (.32, .06, .32), 'velvet', .02)
  for x in (-1, 1):
    for z in (-1, 1): m.ico((x * .15, .78, z * .15), .02, 'gold', 1)
  m.lathe([(0, .8), (.13, .93), (.14, .95), (.1, .99), (0, .995)], ['#2fb8e8', '#6fe6ff', '#b8f6ff', '#e6fcff'], 8)
@asset
def obj_manifest(m):  # sealed shipping manifest folder, from y 0.75
  m.box((0, .77, 0), (.36, .04, .28), '#d9b36c', .006); m.box((.02, .785, -.01), (.33, .02, .27), 'paper', rot=(0, 3, 0))
  m.box((0, .795, 0), (.36, .01, .28), '#e3c07c', .004)
  m.box((0, .801, .0), (.36, .005, .06), 'red'); m.cyl((.1, .8, .07), .045, .012, 'velvetD', 10); m.prism(star(.03, .015), .812, .816, '#e05050', c=(.1, 0, .07))
  m.box((-.08, .801, .09), (.12, .003, .012), C['ink']); m.box((-.1, .801, .115), (.08, .003, .012), C['ink'])
@asset
def obj_coin(m):  # 0.22 wide, lying flat
  m.cyl((0, 0, 0), .11, .05, '#e0a526', 12); m.cyl((0, .05, 0), .09, .008, '#ffcf3d', 12)
  m.prism(star(.058, .025), .056, .062, '#fff1a8')

if __name__ == '__main__':
  bpy.ops.wm.read_factory_settings(use_empty=True)
  objs = []
  for name, fn in ASSETS.items(): mesh = Mesh(name); fn(mesh); objs.append(mesh.finish())
  bpy.ops.object.select_all(action='DESELECT')
  for o in objs: o.select_set(True)
  OUT.parent.mkdir(parents=True, exist_ok=True)
  bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_texcoords=False,
                            export_normals=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_animations=False, export_extras=False)
  for o in objs: o.data.calc_loop_triangles()
  tris = sum(len(o.data.loop_triangles) for o in objs)
  print(f'night-job kit: {len(objs)} meshes, {tris} triangles, {OUT.stat().st_size / 1024:.0f} KiB -> {OUT}')
