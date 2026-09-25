"""Sector backdrops, 1920×1080 JPEG. Dark overall, calm through the middle band where ships and text sit, detail at the edges.
Run: blender -b --factory-startup -P backdrops.py -- <public/games/starship-scramble> [name ...]"""
import bmesh, bpy, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

W, H, D = 1920, 1080, 1000.  # the sky plane sits D units ahead; its texture space spans 100 × 56.25 units

def camera():
    cam = bpy.data.cameras.new('cam'); cam.lens = 36; cam.sensor_width = 36; cam.clip_end = 2000
    ob = link(bpy.data.objects.new('cam', cam)); bpy.context.scene.camera = ob
    return ob

def sky(cfg):
    """Emission plane: base gradient + edge-weighted nebula layers + three star layers."""
    def build(n):
        p = n.coord('Object'); x, y, _ = n.xyz(p)
        ex, ey = n.math('DIVIDE', n.math('ABSOLUTE', x), 50), n.math('DIVIDE', n.math('ABSOLUTE', y), 28.1)
        edge = n.math('ADD', n.maprange(ey, cfg.get('band', .22), 1.0, 0, 1, interp='SMOOTHSTEP'), n.math('MULTIPLY', n.maprange(ex, .55, 1.05, 0, 1, interp='SMOOTHSTEP'), .6), True)
        weight = n.math('ADD', cfg.get('floor', .22), n.math('MULTIPLY', edge, 1 - cfg.get('floor', .22)))
        col = n.mix(cfg['base'][1], cfg['base'][0], n.maprange(y, -28, 28))
        for i, (color, scale, strength, lo, hi, distort) in enumerate(cfg['nebula']):
            f, _ = n.noise(p, scale, 9, .62, distort, w=cfg.get('seed', 0) + i * 7.3)
            g, _ = n.noise(p, scale * 3.1, 6, .5, 0, w=i * 3.1 + 1)
            v = n.math('MULTIPLY', n.maprange(f, lo, hi, 0, 1, interp='SMOOTHSTEP'), n.maprange(g, .3, .7, .45, 1))
            if cfg.get('mask'): v = n.math('MULTIPLY', v, cfg['mask'](n, p, x, y))
            col = n.add(col, n.rgb_scale(color, n.math('MULTIPLY', n.math('MULTIPLY', v, weight), strength)))
        for scale, density, radius, bright, tint in cfg.get('stars', STARS):
            d, c = n.voronoi(n.vmath('ADD', p, (scale * 13.7 + cfg.get('seed', 0) * 9.1, scale * 7.1 - cfg.get('seed', 0) * 4.3, 0)), scale)
            r, g, b = n.xyz(c)
            on = n.math('GREATER_THAN', r, 1 - density)
            core = n.math('POWER', n.maprange(d, 0, radius * scale, 1, 0), 2.2)
            k = n.math('MULTIPLY', n.math('MULTIPLY', on, core), n.math('MULTIPLY', n.math('ADD', n.math('MULTIPLY', g, .8), .2), bright))
            if bright > 1.5: k = n.math('ADD', k, n.math('MULTIPLY', on, n.math('MULTIPLY', n.math('POWER', n.maprange(d, 0, radius * scale * 5, 1, 0), 3), .12)))
            col = n.add(col, n.rgb_scale(n.mix((1, 1, 1), tint, b), k))
        return n.emission(col)
    bm = bmesh.new(); vs = [bm.verts.new((x, y, 0)) for x, y in ((-54, -31), (54, -31), (54, 31), (-54, 31))]; bm.faces.new(vs)
    ob = from_bm(bm, 'sky', node_material('sky', build)); ob.location = (0, 0, -D); ob.scale = (D / 100, D / 100, 1)
    return ob

STARS = [(1.2, .22, .07, .45, (.7, .8, 1)), (.45, .18, .1, .9, (1, .85, .7)), (.12, .22, .14, 2.2, (.75, .85, 1))]

def at(u, v, depth):
    """World point at normalized frame coords (u, v in -1..1) and distance depth from the camera."""
    return Vector((u * depth * .5, v * depth * .28125, -depth))

def rock(name, loc, r, seed, color=(.24, .16, .11), squash=(1, .8, .7)):
    """Lumpy cratered asteroid: three displacement octaves on a randomly rotated icosphere, mottled bumpy rock shader."""
    rnd = random.Random(seed); bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=6, radius=1)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(rnd.random() * 6, 3, 'X') @ Matrix.Rotation(rnd.random() * 6, 3, 'Y'))
    def mat(n):
        f, _ = n.noise(n.coord('Object'), 2.5, 8, .6, w=seed); g, _ = n.noise(n.coord('Object'), 14, 6, .7, w=seed + 3)
        col = n.mix(tuple(c * .45 for c in color), tuple(min(1, c * 1.35) for c in color), n.maprange(f, .35, .7))
        b = n.node('ShaderNodeBsdfPrincipled', [('Base Color', col), ('Roughness', .95)])
        n._in(b.inputs['Normal'], n.node('ShaderNodeBump', [('Strength', .55), ('Distance', .05), ('Height', n.math('ADD', g, n.math('MULTIPLY', f, .5)))]).outputs['Normal'])
        return b.outputs[0]
    ob = from_bm(bm, name, node_material('rock', mat), smooth=True)
    for kind, size, strength in (('CLOUDS', .9, .5), ('VORONOI', .3, -.24), ('CLOUDS', .1, .08)):
        tex = bpy.data.textures.new(name + kind, kind); tex.noise_scale = size
        m = ob.modifiers.new(kind, 'DISPLACE'); m.texture = tex; m.strength = strength; m.texture_coords = 'LOCAL'
    ob.location = loc; ob.scale = tuple(r * s for s in squash); ob.rotation_euler = (rnd.random() * 6, rnd.random() * 6, rnd.random() * 6)
    return ob

def glare(u, v, r, color, strength=1., power=2.5, depth=D - 5):
    """Soft glow on the sky at frame coords (u, v); r in sky texture units."""
    card(at(u, v, depth), r * depth / 100, r * depth / 100, halo_mat('glare', color, strength, power))

# ---------- scenes ----------
def rustbelt():
    sky(dict(base=((.014, .009, .007), (.008, .005, .004)), seed=3, band=.3, floor=.08, nebula=[((.4, .17, .06), .035, .32, .45, .78, .4), ((.22, .08, .03), .09, .22, .5, .82, .8), ((.5, .3, .15), .02, .06, .55, .72, 0)]))
    sun((1, -.7, -.25), 3.4, (1, .8, .6), .05); sun((-1, .3, -.2), .4, (.4, .5, .8), .1)
    rnd = random.Random(7)
    for i, (u, v, d, r) in enumerate(((-1.02, .92, 40, 6.5), (1.05, -.95, 45, 8), (.92, .98, 60, 3.2), (-.95, -1.0, 55, 4), (-.55, 1.05, 70, 2.2), (.4, -1.03, 70, 2.5), (-.25, .98, 90, 1.1), (.7, .86, 95, 1.2), (-.75, -.88, 90, 1.4), (.15, -.93, 110, 1.0))):
        rock(f'a{i}', at(u, v, d), r * .85, i, (.2 + rnd.random() * .06, .13, .09))
    for i in range(70):
        u, v = rnd.uniform(-1.1, 1.1), rnd.choice((-1, 1)) * rnd.uniform(.7, 1.05)
        rock(f'p{i}', at(u, v, rnd.uniform(120, 220)), rnd.uniform(.35, 1.1), 100 + i, (.22, .14, .09))

def veil():
    sky(dict(base=((.01, .007, .018), (.005, .007, .012)), seed=11, band=.3, floor=.07, nebula=[((.34, .09, .42), .03, .34, .45, .8, .7), ((.03, .26, .3), .045, .28, .5, .82, .9), ((.5, .2, .6), .08, .1, .58, .82, .3), ((.1, .45, .45), .02, .07, .55, .72, 0)]))
    glare(-.82, .82, 9, (.7, .5, 1), .35, 3); glare(.88, -.8, 6, (.4, .9, 1), .25, 3)

def meridian():
    """Steel-blue sector: a spoked ring station in the top-right corner and a banded gas giant low on the left."""
    sky(dict(base=((.012, .018, .03), (.006, .009, .016)), seed=21, floor=.12, nebula=[((.1, .18, .3), .03, .3, .45, .8, .6), ((.2, .3, .42), .08, .1, .55, .8, 0)]))
    sun((-.85, -.5, -.05), 4.5, (.85, .92, 1), .02); sun((.3, .2, -1), .35, (.5, .6, .8), .2)
    steel = plated('station', (.42, .45, .5), plate=(3, 1), seam=.35, metal=.5, rough=.35, ao=.3); dark = plain('stdark', (.08, .09, .1), .5, .6)
    lights = glow('stlight', (.6, .85, 1), 4); warm = glow('stwarm', (1, .8, .5), 3)
    st = link(bpy.data.objects.new('station', None)); st.location = at(.8, .84, 420); st.rotation_euler = (math.radians(58), math.radians(-18), math.radians(12))
    def part(ob): ob.parent = st; return ob
    R = 78
    for rad, depth, mat in ((R, 5, steel), (R - 1.2, 3.5, dark), (R + .8, 1.4, steel)):
        bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=False, segments=256, radius1=rad, radius2=rad, depth=depth); part(from_bm(bm, 'band', mat, smooth=True))
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=7, radius2=7, depth=9); part(from_bm(bm, 'hub', steel, smooth=True))
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=4, radius2=2, depth=16); part(from_bm(bm, 'spire', dark, smooth=True))
    for i in range(8):
        a = i / 8 * math.tau; c, sn = math.cos(a), math.sin(a)
        part(cone((c * 6.5, sn * 6.5, 0), (c * (R - 1.5), sn * (R - 1.5), 0), .9, .9, dark, 'spoke', 12))
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); o = part(from_bm(bm, 'pod', steel)); o.location = (c * (R + 1.2), sn * (R + 1.2), 0); o.rotation_euler = (0, 0, a); o.scale = (3, 6, 6.5)
    rnd = random.Random(4)
    for i in range(160):
        a = rnd.random() * math.tau; z = rnd.choice((-2.4, 2.4))
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=3, radius=.35); o = part(from_bm(bm, 'lt', lights if rnd.random() < .7 else warm)); o.location = (math.cos(a) * (R - .6), math.sin(a) * (R - .6), z)
    def giant(n):
        """Self-lit so it keeps a crisp terminator: bands × max(N·L) plus a thin atmosphere on the lit limb."""
        x, y, z = n.xyz(n.coord('Object'))
        f, _ = n.noise(n.vec(n.math('MULTIPLY', x, .6), n.math('MULTIPLY', y, .6), n.math('MULTIPLY', z, 9)), 1.2, 6, .6, 1.2)
        col = n.ramp(f, [(.3, (.09, .17, .26)), (.5, (.25, .38, .5)), (.62, (.16, .27, .38)), (.75, (.42, .55, .64))])
        lit = n.maprange(n.vmath('DOT_PRODUCT', n.node('ShaderNodeNewGeometry').outputs['Normal'], Vector((-.6, .5, .6)).normalized()), -.1, .8, .012, .62, interp='SMOOTHSTEP')
        fr = n.node('ShaderNodeLayerWeight', [(0, .2)]).outputs['Facing']
        return n.emission(n.add(n.rgb_scale(col, lit), n.rgb_scale((.35, .6, 1), n.math('MULTIPLY', n.math('POWER', fr, 6), n.math('MULTIPLY', lit, .9)))))
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=64, radius=1)
    planet = from_bm(bm, 'planet', node_material('giant', giant), smooth=True); planet.location = at(-1.05, -1.55, 500); planet.scale = (150,) * 3; planet.rotation_euler = (math.radians(75), math.radians(20), 0)

def armada_reach():
    sky(dict(base=((.02, .004, .007), (.009, .003, .005)), seed=31, floor=.16, nebula=[((.42, .03, .05), .03, .6, .42, .78, 1.0), ((.18, .01, .03), .07, .45, .45, .8, 1.8), ((.6, .15, .08), .02, .12, .55, .72, 0)],
        stars=[(1.2, .18, .07, .35, (1, .6, .5)), (.45, .15, .1, .8, (1, .7, .6)), (.12, .18, .14, 2, (1, .75, .7))]))
    glare(.92, .9, 16, (1, .22, .1), .5, 2.2); glare(.92, .9, 2.2, (1, .6, .4), 2.5, 2, D - 6)
    sun((-1, -.4, -.5), 2.5, (1, .45, .35), .05)
    hullm = plain('armada', (.05, .03, .035), .45, .6); lamp = glow('red', (1, .15, .1), 4)
    rnd = random.Random(5)
    for i in range(14):
        u, v, d = rnd.uniform(-1.05, -.2), rnd.uniform(.72, 1.0), rnd.uniform(160, 320)
        L = rnd.uniform(3, 7); bm = bmesh.new()
        pts = [(L, 0), (L * .1, L * .12), (-L * .25, L * .38), (-L * .6, L * .3), (-L * .45, 0), (-L * .6, -L * .3), (-L * .25, -L * .38), (L * .1, -L * .12)]
        lo = [bm.verts.new((x, y, 0)) for x, y in pts]; hi = [bm.verts.new((x * .8, y * .6, L * .12)) for x, y in pts]
        bm.faces.new(lo[::-1]); bm.faces.new(hi)
        for k in range(len(pts)): bm.faces.new((lo[k], lo[(k + 1) % len(pts)], hi[(k + 1) % len(pts)], hi[k]))
        o = from_bm(bm, 'ship', hullm); o.location = at(u, v, d); o.rotation_euler = (math.radians(70), 0, math.radians(rnd.uniform(-15, 5)))
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=4, radius=L * .07)
        e = from_bm(bm, 'eng', lamp); e.parent = o; e.location = (-L * .5, 0, .2)

def hangar():
    """Space dock: a lit gantry across the top, the docking deck along the bottom, pillars at the sides, open space between."""
    sky(dict(base=((.01, .012, .018), (.006, .007, .012)), seed=41, floor=.1, nebula=[((.08, .12, .2), .03, .22, .5, .8, .5)]))
    sun((.4, -.7, -1), 1.2, (.8, .85, 1), .1)
    steel = plated('steel', (.2, .21, .23), plate=(3, 1.2), seam=.4, metal=.6, rough=.4, ao=.4)
    dark = plain('darksteel', (.05, .055, .06), .5, .6); yellow = plain('hazard', (.9, .6, .08), .4, .2)
    flood, amber = glow('flood', (1, .93, .8), 5), glow('amber', (1, .55, .15), 4)
    def shaft(n):
        u, v, _ = n.xyz(n.coord('Object')); t = n.math('MULTIPLY', n.math('SUBTRACT', 1, v), .5)
        wide = n.math('ADD', .18, n.math('MULTIPLY', t, .82))
        k = n.math('MULTIPLY', n.math('POWER', n.math('SUBTRACT', 1, n.math('DIVIDE', n.math('ABSOLUTE', u), wide), True), 2), n.math('POWER', n.math('SUBTRACT', 1, t, True), 3))
        return n.node('ShaderNodeMixShader', [(0, n.math('MULTIPLY', k, .13)), (1, n.node('ShaderNodeBsdfTransparent').outputs[0]), (2, n.emission((1, .9, .75), 1))]).outputs[0]
    shafts = node_material('shaft', shaft)
    def box(loc, scale, mat, name='box'):
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1); o = from_bm(bm, name, mat); o.location = loc; o.scale = scale; return o
    def ball(loc, r, mat):
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=5, radius=r); o = from_bm(bm, 'ball', mat); o.location = loc
    d = 30; hy = d * .28125
    box((0, hy - .5, -d - 1), (34, 1.8, 1.6), steel, 'gantry')
    for y in (hy - 1.55, hy - 2.05): cone((-17, y, -d), (17, y, -d), .12, .12, dark, 'chord', 10)
    for i in range(-21, 22):
        x = i * .8; cone((x, hy - 1.55, -d), (x + .4, hy - 2.05, -d), .05, .05, dark, 'lace', 6)
    for i in range(-3, 4):
        x = i * 4.6
        box((x, hy - 2.35, -d + .2), (1.3, .45, .7), dark, 'housing'); box((x, hy - 2.6, -d + .45), (1.0, .06, .5), flood, 'lens')
        card(Vector((x, hy - 2.62, -d + .8)), 1.1, .35, halo_mat('lensglow', (1, .9, .75), 1.4, 2))
        sh = card(Vector((x, hy - 2.6 - 7.5, -d + .7)), 3.6, 7.5, shafts); sh.visible_shadow = False
    box((0, -hy + .7, -d - 1.5), (34, 2.2, 3), steel, 'deck')
    for i in range(-40, 41): box((i * .4, -hy + 1.82, -d - .2), (.2, .06, .1), yellow if i % 2 else dark, 'stripe')
    for i in range(-8, 9): ball((i * 2.0, -hy + 1.95, -d + .1), .09, amber)
    for x, w, h in ((-11, 1.4, .9), (-9.4, .9, .6), (8.5, 1.6, 1.1), (10.4, 1.0, .7), (12, .8, .5)): box((x, -hy + 1.8 + h / 2, -d - .8), (w, h, 1), steel, 'crate')
    for u in (-1, 1):
        box((u * 15.3, 0, -d - 2), (1.6, 2 * hy + 2, 2), steel, 'pillar')
        for k in range(-3, 4): ball((u * 14.45, k * 2.2, -d - .9), .08, amber)

def galaxy_mask(n, p, x, y):
    """Soft diagonal band for the Milky-Way-like galaxy on the map."""
    d = n.math('ABSOLUTE', n.math('ADD', n.math('MULTIPLY', y, 1), n.math('MULTIPLY', x, -.32)))
    return n.math('POWER', n.maprange(d, 0, 16, 1, 0, interp='SMOOTHSTEP'), 1.5)

def starmap():
    sky(dict(base=((.008, .01, .02), (.004, .005, .012)), seed=51, band=0, floor=1, mask=galaxy_mask,
        nebula=[((.12, .1, .22), .05, .4, .35, .75, .8), ((.2, .16, .28), .12, .25, .45, .78, 0), ((.05, .1, .18), .025, .22, .4, .75, 1.4)],
        stars=[(1.4, .25, .065, .4, (.7, .8, 1)), (.5, .18, .09, .8, (1, .88, .75)), (.14, .2, .13, 1.8, (.75, .85, 1))]))
    glare(.55, .42, 10, (.55, .45, .8), .3, 2.5)

SCENES = {'rustbelt': rustbelt, 'veil': veil, 'meridian': meridian, 'armada-reach': armada_reach, 'hangar': hangar, 'map': starmap}

def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    out = os.path.join(args[0], 'backdrops'); os.makedirs(out, exist_ok=True)
    for name, fn in SCENES.items():
        if args[1:] and name not in args[1:]: continue
        scene = reset(W, H, 96, denoise=False); scene.render.film_transparent = False
        scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.color_mode = 'RGB'; scene.render.image_settings.quality = 80
        world((0, 0, 0), 0); camera(); fn()
        render(os.path.join(out, name + '.jpg'))

if __name__ == '__main__': main()
