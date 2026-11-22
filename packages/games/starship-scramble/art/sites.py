"""Beacon sites for the event and store screens, 640×640 transparent PNG: what the fleet finds at a beacon, in the icons' 3/4 view.
Run: blender -b --factory-startup -P sites.py -- <public/games/starship-scramble> [name ...]"""
import bmesh, bpy, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
from icons import ball, box, cyl, fit, glowball, shiny, torus

S = 640
SUN, SKY, LIME, CORAL, CREAM = (1, .82, .29), (.16, .78, .9), (.47, .85, .33), (1, .34, .28), (1, .96, .9)

def lights(points, color, r=.035, strength=6):
    for p in points: ball(p, r, glow('lamp', color, strength), 12)

def ring_points(R, n, z=0., phase=0.):
    return [(R * math.cos(phase + i * 2 * math.pi / n), R * math.sin(phase + i * 2 * math.pi / n), z) for i in range(n)]

def outpost():
    """Trading post: a hub with a habitat ring on spokes, docking arms, a mast and warm windows."""
    hull, dark, trim = plated('hull', (.62, .66, .74), plate=(.5, .25)), shiny('dark', (.12, .14, .22), .5, .3), shiny('trim', SUN, .35, .2)
    cyl((0, 0, -.55), (0, 0, .5), .42, .42, hull); cyl((0, 0, .5), (0, 0, .78), .42, .24, dark); cyl((0, 0, -.8), (0, 0, -.55), .22, .42, dark)
    cyl((0, 0, .78), (0, 0, 1.5), .035, .02, shiny('mast', (.8, .82, .9), .3, .8), 12); glowball((0, 0, 1.52), .05, CORAL, 4, 6)
    torus((0, 0, 0), 1.2, .17, hull); torus((0, 0, 0), 1.2, .19, trim).scale = (1, 1, .22)
    for x, y, _ in ring_points(1., 4, phase=math.pi / 4): cyl((x * .4, y * .4, 0), (x * 1.05, y * 1.05, 0), .07, .07, dark, 12)
    lights(ring_points(1.38, 28, .0), SUN, .03, 5); lights(ring_points(.43, 12, .2), (1, .9, .6), .025, 5); lights(ring_points(.43, 12, -.25, .26), SKY, .025, 4)
    for sgn in (1, -1):  # docking arms with a parked freighter block and a guide light
        box((0, sgn * 1.75, -.12), (.16, .75, .1), dark, .03); box((.02, sgn * 2.02, .02), (.42, .28, .2), plated('crate', (.85, .5, .3), plate=(.3, .15)), .04)
        glowball((0, sgn * 2.2, -.02), .04, LIME, 4, 6)

def drydock():
    """Drydock: an open gantry of trusses around a half-plated hull, cranes and work lights."""
    beam, hazard, plate, bare = shiny('beam', (.3, .33, .42), .5, .6), shiny('hazard', SUN, .4), plated('plate', (.6, .64, .72), plate=(.45, .22)), shiny('ribs', (.2, .22, .3), .6, .5)
    for y in (-.95, .95):
        for z in (-.5, .55): box((0, y, z), (3.3, .09, .09), beam, .02)
        for i in range(8): x = -1.55 + i * .443; box((x, y, .02), (.07, .07, 1.05), beam, .015); box((x + .22, y, .02), (.05, .05, 1.2), beam, .01, (0, math.radians(32 if i % 2 else -32), 0))
    for x in (-1.6, -.5, .6, 1.6): box((x, 0, .58), (.09, 1.95, .09), hazard, .02)
    box((-.45, 0, -.08), (1.5, .8, .42), plate, .1); box((.55, 0, -.1), (.55, .62, .34), plate, .08)
    for i in range(6): x = .95 + i * .16; box((x, 0, -.12), (.03, .62 - i * .07, .3 - i * .03), bare, .008)
    cyl((-1.3, 0, -.08), (-1.55, 0, -.08), .2, .26, shiny('nozzle', (.15, .16, .22), .35, .8), 20)
    for x, y in ((-.9, .5), (.3, -.5)): cyl((x, y, .58), (x, y * .35, .22), .03, .03, hazard, 10); glowball((x, y * .35, .2), .045, (.7, .9, 1), 5, 7)
    lights([(x, y, .66) for x in (-1.6, -.5, .6, 1.6) for y in (-.95, .95)], SUN, .04, 6)

def derelict():
    """Derelict: a hull broken in two, cold and listing, with spilled plating and one failing lamp."""
    random.seed(7)
    hull, guts, scorch = plated('hull', (.36, .38, .42), plate=(.5, .24), grime=.5), shiny('guts', (.07, .08, .1), .8), shiny('scorch', (.14, .1, .09), .9)
    stern = box((-.95, .1, 0), (1.35, .8, .5), hull, .12, (math.radians(8), math.radians(-6), math.radians(9)))
    bow = box((.95, -.22, .1), (1.15, .66, .42), hull, .12, (math.radians(-14), math.radians(10), math.radians(-17)))
    box((-.22, .02, .0), (.2, .7, .44), guts, .01, stern.rotation_euler); box((.33, -.12, .08), (.2, .58, .38), guts, .01, bow.rotation_euler)
    cyl((-1.6, .0, 0), (-1.95, -.06, .02), .2, .27, scorch, 18); cyl((-1.6, .32, .02), (-1.9, .28, .04), .12, .16, scorch, 14)
    cyl((1.5, -.38, .18), (2.0, -.52, .3), .2, .03, hull, 16)
    for _ in range(26):
        p = (random.uniform(-.5, .6), random.uniform(-.9, .9), random.uniform(-.5, .6)); s = random.uniform(.03, .13)
        box(p, (s * 1.8, s, s * .5), hull if random.random() < .7 else scorch, .01, tuple(random.uniform(0, 3) for _ in range(3)))
    glowball((-.72, -.33, .3), .035, CORAL, 5, 3)

def beacon():
    """Distress buoy: a ringed pod on a long antenna with a hard coral strobe and two drifting lifepods."""
    shell, band, panel = shiny('shell', CREAM, .35), shiny('band', CORAL, .4), shiny('panel', (.08, .16, .4), .2, .3, 1)
    ball((0, 0, 0), (.55, .55, .5), shell, 40); torus((0, 0, 0), .56, .07, band); torus((0, 0, .32), .4, .04, band)
    cyl((0, 0, .45), (0, 0, 1.55), .03, .015, shiny('mast', (.8, .82, .9), .3, .8), 10); glowball((0, 0, 1.6), .1, CORAL, 5, 10)
    for sgn in (1, -1):
        box((sgn * .62, 0, 0), (.18, .05, .05), band, .01); box((sgn * 1.12, 0, 0), (.75, .5, .03), panel, .01, (math.radians(18), 0, 0))
    for (x, y, z), r in (((1.25, -.95, -.45), 22), ((-1.4, .8, .35), -30)):
        cyl((x - .22, y, z), (x + .22, y + .1, z + .04), .15, .15, shell, 20).rotation_euler.z += math.radians(r); ball((x + .26, y + .12, z + .05), (.14, .14, .14), band, 16)
        glowball((x - .25, y - .01, z), .03, SUN, 4, 6)

SITES = dict(outpost=outpost, drydock=drydock, derelict=derelict, beacon=beacon)

def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    out = os.path.join(args[0], 'sites'); os.makedirs(out, exist_ok=True)
    for name, fn in SITES.items():
        if args[1:] and name not in args[1:]: continue
        reset(S, S, int(os.environ.get('SS_SAMPLES', 96))); world((.3, .36, .55), .5)
        cam = ortho_camera(0, 0, 3, 3); cam.location = Vector((2.2, -6, 5.2)); cam.rotation_euler = Vector((-2.2, 6, -5.2)).to_track_quat('-Z', 'Y').to_euler()
        sun((1, 1.2, -1.6), 3.4, (1, .96, .9), .3); sun((-1.2, -.3, .6), 1.6, (.55, .72, 1), .2)
        fn(); fit(1.06)
        path = os.path.join(out, name + '.png'); render(path); print('Saved', path)

if __name__ == '__main__': main()
