"""UI icons, 128×128 transparent PNG: one studio rig, 3/4 top view, rendered at 2× then outlined and downsampled.
Run: blender -b --factory-startup -P icons.py -- <public/games/starship-scramble> [name ...]"""
import bmesh, bpy, math, os, random, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

S = 256
CORAL, SUN, SKY, LIME, GRAPE, CREAM = (1, .34, .28), (1, .82, .29), (.16, .78, .9), (.47, .85, .33), (.71, .54, 1), (1, .96, .9)

def shiny(name, color, rough=.28, metal=0., coat=.6): return plain(name, color, rough, metal, coat=coat)

def box(loc, size, mat, bevel=.06, rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); ob = from_bm(bm, 'box', mat, bevel=bevel, segs=3, angle=60)
    ob.location, ob.scale, ob.rotation_euler = loc, size, rot; return ob

def cyl(p0, p1, r0, r1, mat, segs=32):
    ob = cone(p0, p1, r0, r1, mat, 'cyl', segs); add_bevel(ob, min(r0, r1, .04) * .6 + .005, 2, 50); return ob

def ball(c, r, mat, segs=32): return ellipsoid(c, r if isinstance(r, tuple) else (r, r, r), mat, 'ball', segs)

def torus(c, R, r, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=64, minor_segments=16, location=c, rotation=rot)
    ob = bpy.context.active_object; ob.data.materials.append(mat); ob.data.shade_smooth(); return ob

def glowball(c, r, color, halo=2.4, strength=4):
    ball(c, r, glow('g', color, strength)); halo_card(c, r * halo, color)

def halo_card(c, r, color, strength=1.4):
    ob = card(Vector(c), r, r, halo_mat('h', color, strength, 2)); ob.rotation_euler = bpy.context.scene.camera.rotation_euler

def along(p0, p1):
    """Rotation that points local +Z from p0 to p1."""
    return (Vector(p1) - Vector(p0)).normalized().to_track_quat('Z', 'Y').to_euler()

# ---------- icons (object space roughly within the unit sphere) ----------
def laser():
    """A three-bolt burst: saturated coral capsules with hot cores, spaced along a diagonal."""
    bpy.context.view_layer.update(); m = bpy.context.scene.camera.matrix_world.to_3x3()
    d, side = (m.col[0] + m.col[1] * .75).normalized(), (m.col[0] - m.col[1] * 1.3).normalized()
    for off, s in ((0, 1), (-1, .8), (1, .8)):
        c = side * off * .42 - d * abs(off) * .3; rot = d.to_track_quat('X', 'Z').to_euler()
        for loc, r, mat in ((c, (.85, .16, .16), glow('bolt', CORAL, 1.25)), (c + d * .12 * s, (.55, .075, .075), glow('core', (1, .85, .78), 1.2))):
            e = ellipsoid((0, 0, 0), tuple(v * s for v in r), mat, 'bolt'); e.location, e.rotation_euler = loc, rot
        halo_card(c, .6 * s, CORAL, .9)

def missile():
    body, nose, fin = shiny('mbody', CREAM, .3), shiny('mnose', CORAL), shiny('mfin', (.2, .24, .45), .35)
    a, b = Vector((-.9, -.35, -.3)), Vector((.75, .3, .25)); d = (b - a).normalized()
    cyl(a, b, .24, .24, body); cone(b, b + d * .45, .24, .02, nose, 'nose', 32)
    cyl(a + d * .55, a + d * .62, .255, .255, nose)
    for k in range(4):
        q = d.to_track_quat('Z', 'Y').to_matrix(); side = q @ Vector((math.cos(k * math.pi / 2), math.sin(k * math.pi / 2), 0))
        f = box(a + d * .2 + side * .3, (.04, .28, .42), fin, .02); f.rotation_euler = (d.to_track_quat('Z', 'Y') @ Matrix.Rotation(k * math.pi / 2, 3, 'Z').to_quaternion()).to_euler()
    ball(a - d * .08, (.2, .2, .2), glow('flame', (1, .6, .2), 3)); halo_card(a - d * .2, .5, (1, .55, .2))

def beam():
    gold, dark = shiny('gold', SUN, .25, .6), shiny('dark', (.12, .14, .3), .35)
    cyl((0, 0, -.75), (0, 0, -.45), .7, .62, dark)
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=.42, radius2=.3, depth=.9)
    from_bm(bm, 'crystal', gold, bevel=.05, segs=2).location = (0, 0, -.05)
    tip = bmesh.new(); bmesh.ops.create_cone(tip, cap_ends=True, segments=6, radius1=.3, radius2=0, depth=.4); t = from_bm(tip, 'tip', gold, bevel=.03); t.location = (0, 0, .6)
    cyl((0, 0, .7), (0, 0, 1.6), .13, .2, glow('beam', (1, .78, .25), 1.2)); cyl((0, 0, .72), (0, 0, 1.58), .06, .1, glow('beamcore', (1, .95, .75), 1.1)); halo_card((0, 0, 1.0), .6, SUN, 1)

def ion():
    glowball((0, 0, 0), .5, SKY, 2.2, 2.5)
    ball((0, 0, 0), .3, glow('ioncore', (.8, .97, 1), 3))
    for rot in ((1.2, 0, .3), (1.2, 0, 2.4), (.2, 1.1, 1.2)): torus((0, 0, 0), .78, .045, shiny('ring', (.5, .92, 1), .2, .2), rot)

def flak():
    shell, band = shiny('shell', (1, .6, .2), .3, .3), shiny('band', (.2, .24, .45), .35)
    cyl((-.1, 0, -.8), (-.1, 0, .15), .32, .32, shell); cone((-.1, 0, .15), (-.1, 0, .6), .32, .05, shell, 'cap', 32); cyl((-.1, 0, -.55), (-.1, 0, -.45), .335, .335, band)
    rnd = random.Random(3)
    for i in range(7):
        a = i / 7 * math.tau; p = Vector((math.cos(a) * .85, math.sin(a) * .85, .45 + rnd.uniform(-.3, .4)))
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=.13 + rnd.random() * .05)
        o = from_bm(bm, 'frag', shiny('frag', (1, .75, .3), .35, .4)); o.location = p; o.rotation_euler = (rnd.random() * 3, rnd.random() * 3, 0)
    halo_card((-.1, 0, .7), .7, (1, .6, .2), 1.1)

def support():
    g = shiny('lime', LIME, .25)
    box((0, 0, 0), (1.3, .42, .42), g, .1); box((0, 0, 0), (.42, 1.3, .42), g, .1)
    torus((0, 0, 0), .92, .08, glow('ring', (.45, .95, .3), 1.1), (0, 0, 0)); halo_card((0, 0, 0), 1.25, LIME, .5)

def augment():
    pcb, gold, chip = shiny('pcb', GRAPE, .35), shiny('pins', SUN, .25, .8), shiny('chip', (.14, .12, .3), .3)
    box((0, 0, 0), (1.4, 1.4, .14), pcb, .05); box((0, 0, .14), (.8, .8, .16), chip, .04)
    for i in range(5):
        t = -.48 + i * .24
        for x, y, sx, sy in ((t, .8, .09, .3), (t, -.8, .09, .3), (.8, t, .3, .09), (-.8, t, .3, .09)): box((x, y, 0), (sx, sy, .06), gold, .015)
    ball((.2, .2, .24), (.12, .12, .03), glow('led', (1, .6, 1), 3)); halo_card((.2, .2, .3), .3, GRAPE)

def scrap():
    bronze, steel, rust = shiny('bronze', (.85, .55, .25), .35, .8), shiny('steel', (.62, .66, .74), .3, .8), shiny('rust', (.7, .32, .18), .6, .3)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=.62, depth=.2, location=(-.15, .1, .05)); gear = bpy.context.active_object; gear.data.materials.append(bronze)
    for k in range(12):
        a = k / 12 * math.tau; box((-.15 + math.cos(a) * .7, .1 + math.sin(a) * .7, .05), (.18, .16, .2), bronze, .02, (0, 0, a))
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=.2, depth=.26, location=(-.15, .1, .06)); h = bpy.context.active_object; h.data.materials.append(steel)
    box((.55, -.45, .15), (.7, .35, .08), rust, .03, (.3, .2, .7)); box((.35, .65, .25), (.5, .22, .1), steel, .03, (-.2, .1, -.4))
    cyl((.3, -.2, .35), (.9, .2, .45), .06, .06, steel); cyl((.9, .2, .45), (.98, .25, .47), .12, .12, steel, 6)

def crew():
    shell, visor, trim = shiny('helm', CREAM, .3), shiny('visor', (.05, .1, .2), .08, 0, 1), shiny('trim', SKY, .3)
    ball((0, 0, 0), (.78, .78, .8), shell, 48)
    ellipsoid((0, -.36, .05), (.55, .5, .38), visor, 'visor', 48)
    ellipsoid((.18, -.72, .22), (.12, .05, .08), glow('glint', (.8, .95, 1), 2), 'glint')
    torus((0, 0, -.55), .66, .12, trim); box((.62, -.2, .05), (.2, .3, .35), trim, .06)

def repair():
    steel, grip, slot = shiny('steel', (.78, .8, .86), .25, .9), shiny('grip', SUN, .35), shiny('slot', (.1, .12, .25), .4)
    rot = (0, 0, math.radians(40))
    box((0, 0, 0), (1.25, .38, .2), grip, .08, rot)
    for sgn in (1, -1):
        c = Vector((math.cos(rot[2]), math.sin(rot[2]), 0)) * .85 * sgn
        bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=.42, depth=.22, location=c); j = bpy.context.active_object; j.data.materials.append(steel)
        box(c + Vector((math.cos(rot[2]), math.sin(rot[2]), 0)) * .26 * sgn, (.36, .3, .4), slot, .01, rot)

def ammo():
    brass, tip, strap = shiny('brass', (.95, .7, .3), .25, .85), shiny('tip', CORAL, .3), shiny('strap', (.2, .24, .45), .4)
    for x, y in ((-.36, .1), (.0, -.12), (.36, .1)):
        cyl((x, y, -.75), (x, y, .3), .19, .19, brass); cone((x, y, .3), (x, y, .75), .19, .03, tip, 'tip', 32)
    box((0, 0, -.3), (1.2, .7, .14), strap, .05)

ICONS = dict(laser=laser, missile=missile, beam=beam, ion=ion, flak=flak, support=support, augment=augment, scrap=scrap, crew=crew, repair=repair, ammo=ammo)

def fit(margin=1.12):
    """Center the ortho camera on everything visible and scale to fit."""
    bpy.context.view_layer.update(); cam = bpy.context.scene.camera; m = cam.matrix_world.to_3x3(); right, up = m.col[0], m.col[1]; dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or any(sl.material and sl.material.get('fx') for sl in ob.material_slots): continue
        ev = ob.evaluated_get(dg); pts += [ev.matrix_world @ v.co for v in ev.to_mesh().vertices]; ev.to_mesh_clear()
    xs, ys = [p.dot(right) for p in pts], [p.dot(up) for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    cam.location += right * (cx - cam.location.dot(right)) + up * (cy - cam.location.dot(up)); cam.data.ortho_scale = max(max(xs) - min(xs), max(ys) - min(ys)) * margin

def finish(path, outline_px=5, color=(.043, .063, .19)):
    """Dark rounded outline (party-ui navy) at 2×, then premultiplied 2× downsample to 128."""
    a = load_rgba(path); al = a[..., 3]; k = outline_px; ring = np.zeros_like(al); pad = np.pad(np.clip((al - .45) * 4, 0, 1), k)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            dd = math.hypot(dx, dy)
            if dd <= k: ring = np.maximum(ring, pad[k + dy:k + dy + S, k + dx:k + dx + S] * min(1, k + .5 - dd))
    oa = al + ring * (1 - al); pre = a[..., :3] * al[..., None] + np.array(color) * (ring * (1 - al))[..., None]
    pre = np.dstack([pre, oa]).reshape(S // 2, 2, S // 2, 2, 4).mean((1, 3))
    rgb = pre[..., :3] / np.maximum(pre[..., 3:], 1e-6)
    save_rgba(np.dstack([rgb, pre[..., 3]]), path)

def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    out = os.path.join(args[0], 'icons'); os.makedirs(out, exist_ok=True)
    for name, fn in ICONS.items():
        if args[1:] and name not in args[1:]: continue
        reset(S, S, 96); world((.35, .4, .55), .6)
        cam = ortho_camera(0, 0, 3, 3); cam.location = Vector((2.2, -6, 5.2)); cam.rotation_euler = Vector((-2.2, 6, -5.2)).to_track_quat('-Z', 'Y').to_euler()
        sun((1, 1.2, -1.6), 3.2, (1, .97, .92), .3); sun((-1.2, -.3, .6), 2, (.6, .75, 1), .2)
        fn(); fit()
        path = os.path.join(out, name + '.png'); render(path); finish(path)

if __name__ == '__main__': main()
