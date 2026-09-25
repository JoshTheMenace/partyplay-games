"""
Blockwild entity models: blocky, MC-proportioned rigs with procedurally painted pixel-art skins.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --python packages/games/blockwild/art/build_models.py
Out:  public/games/blockwild/models/<key>.glb  and  art/lineup.png

Conventions (glTF / three.js space):
  - meters; origin at the feet centre; +Y up.
  - FACING = '-Z': every model looks toward -Z, the same way the game camera looks at yaw 0, so the client can
    use `root.rotation.y = yaw` directly. Character left is -X (arm_l, leg_l, leg_fl ... sit at negative x).
  - Named pivot nodes sit exactly at the joints and have identity rest rotation, so code may set rotations
    absolutely: head, body, arm_l, arm_r, leg_l, leg_r (humanoids, chicken wings are arm_l/arm_r),
    leg_fl/leg_fr/leg_bl/leg_br (quadrupeds and creeper), leg_0..leg_7 (spider; 0-3 left, 4-7 right, front to
    back, each leg extends horizontally outward along -X / +X), wool (sheep coat, hide it when sheared).
  - Materials: the player's shirt uses a near-white texture on a material named 'shirt' (multiply by the player
    colour); 'skin', 'hair' and 'pants' are the other player materials. Textures use nearest filtering.
  - Expansion mobs (contract mirrored in src/client/art/models.ts):
      villager.glb (farmer) and villager_<librarian|armorer|toolsmith|cleric>.glb: head, body, leg_l, leg_r, plus
        'arms' (crossed, child of body, not animated), 'nose' (child of head) and profession extras ('hat').
      zombified_piglin.glb: humanoid pivots plus 'item' (gold sword, child of arm_r at the hand, blade along -Z).
      ghast.glb: 'body' (4 m cube, y 0..4) with tentacle_0..8 (children of body at its underside, hanging -Y) and
        'face_shoot' (open-eyed face panel just in front of the calm face; the client shows it only while shooting).
      tnt.glb: 'body' (0.98 m TNT cube, material 'tnt').
Models are authored in pixel units: x = character right, y up, front = -z; `scale` converts pixels to meters.
"""
import math
import os
import tempfile

import bpy

FACING = '-Z'  # switch to '+Z' to rotate every model 180 degrees
HERE = os.path.dirname(os.path.realpath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '../../../../public/games/blockwild/models'))
TMP = tempfile.mkdtemp(prefix='blockwild-art-')
FACES = ('front', 'back', 'left', 'right', 'top', 'bottom')
FI = {f: i for i, f in enumerate(FACES)}

# ---------------------------------------------------------------- pixel helpers


def hsh(x, y, seed):
    h = (x * 374761393 + y * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296


def vnoise(x, y, seed, cell=3.0):
    gx, gy = x / cell, y / cell
    x0, y0 = math.floor(gx), math.floor(gy)
    fx, fy = gx - x0, gy - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = hsh(x0, y0, seed), hsh(x0 + 1, y0, seed)
    c, d = hsh(x0, y0 + 1, seed), hsh(x0 + 1, y0 + 1, seed)
    top, bottom = a + (b - a) * fx, c + (d - c) * fx
    return top + (bottom - top) * fy


def hexc(v):
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255)


def pick(ramp, t):
    return hexc(ramp[max(0, min(len(ramp) - 1, int(t * len(ramp))))])


def shade(c, f):
    return tuple(max(0, min(255, round(ch * f))) for ch in c[:3])


def mixc(a, b, t):
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))


def grain(ramp, seed, base=0.55, fine=0.3, blotch=0.3, cell=3.0):
    """Per-face fabric/fur noise: fine per-pixel jitter plus soft blotches."""
    def color(f, u, v):
        s = seed + FI[f] * 101
        return pick(ramp, base + (hsh(u, v, s) - 0.5) * fine * 2 + (vnoise(u, v, s + 7, cell) - 0.5) * blotch * 2)
    return color


def side_back(f, u, w):
    """Distance from the front edge on a side face (0 = front column)."""
    return u if f == 'left' else w - 1 - u


# ---------------------------------------------------------------- palettes

SKIN = [0xA8694A, 0xB97A57, 0xC98B66, 0xD89C76, 0xE4AC86]
HAIR = [0x2E1C10, 0x3B2414, 0x4D2F1A, 0x5F3B22, 0x71482A]
SHIRT = [0xA4A4A4, 0xBEBEBE, 0xD2D2D2, 0xE4E4E4, 0xF2F2F2]
PANTS = [0x262F4D, 0x2F3A5E, 0x384670, 0x425283, 0x4D5E96]
SHOE = [0x221E1C, 0x2E2926, 0x3A3430, 0x4A423C]
ZSKIN = [0x2F5228, 0x3A6432, 0x46763C, 0x528846, 0x619A52]
ZSHIRT = [0x1B5E66, 0x22737D, 0x2A8792, 0x349AA5, 0x42ADB6]
ZPANTS = [0x252A5C, 0x2D336E, 0x363D80, 0x404892]
BONE = [0x8A8A86, 0xA4A4A0, 0xBEBEB9, 0xD4D4CF, 0xE8E8E3]
CREEP = [0x1D5418, 0x2A6E22, 0x3A8A2E, 0x4FA63E, 0x78C462, 0xB4E0A0]
SPIDER = [0x17120F, 0x211A16, 0x2B221D, 0x372C25, 0x46382E]
COW = [0x3A2415, 0x4A2F1B, 0x5A3A22, 0x6A4529, 0x7A5131]
CREAM = [0xCFC4B0, 0xDDD4C2, 0xE9E2D4, 0xF4F0E6]
PINK = [0xCC8282, 0xDB9494, 0xE6A4A2, 0xF0B4B0, 0xF7C4BF]
SNOUT = [0xB86A6C, 0xC87C7C, 0xD68C8A]
WOOL = [0xCBC6BA, 0xDAD6CB, 0xE6E3DA, 0xF0EEE7, 0xF9F8F3]
FLEECE = [0xB9A78F, 0xC7B69E, 0xD3C3AC, 0xDED0BA]
SHEEPFACE = [0x8E7C68, 0x9E8B75, 0xAD9A83, 0xBBA891]
FEATHER = [0xC6C6C2, 0xD8D8D4, 0xE8E8E4, 0xF4F4F0, 0xFDFDFB]
BEAK = [0xD48C18, 0xE8A424, 0xF6C040]
RED = [0x9E1818, 0xBC2424, 0xD83434]
WHITE, BLACK = (240, 240, 236), (22, 22, 24)
VSKIN = [0x8E5E40, 0x9E6C4C, 0xAE7A58, 0xBC8864, 0xC99670]
VPANTS = [0x2E241C, 0x3A2E24, 0x46382C, 0x524234]
STRAW = [0xB08A2C, 0xC49C38, 0xD6AE48, 0xE4C05C, 0xF0D478]
PIGLIN = [0xC07474, 0xD08684, 0xDE9894, 0xEAA8A2, 0xF4B8B0]
ROT = [0x4E6A32, 0x5E7C3C, 0x6E8E48]
GOLDC = [0xA8700C, 0xD8A418, 0xF2C83A, 0xFBE278, 0xFFF6C2]
GHAST = [0xBDBDBD, 0xCBCBCB, 0xD8D8D8, 0xE4E4E4, 0xEFEFEF, 0xF9F9F9]
TNT_RED = [0x7A1810, 0x9E2216, 0xBC2E1E, 0xD43C28, 0xE85A40]
# Villager professions: file suffix, robe ramp, trim, apron ramp (or None), extra ('straw' hat, 'glasses', 'patch', 'pendant').
PROFESSIONS = [
    ('', [0x4E3A26, 0x5E4630, 0x6E523A, 0x7E5E44, 0x8C6A4E], (150, 58, 36), None, 'straw'),
    ('_librarian', [0xB4AC9C, 0xC4BCAC, 0xD2CBBC, 0xDED8CA, 0xEAE5D8], (150, 36, 30), None, 'glasses'),
    ('_armorer', [0x3A3A40, 0x46464E, 0x52525A, 0x5E5E68, 0x6A6A74], (168, 174, 182), [0x1C1C20, 0x26262B, 0x303036], 'patch'),
    ('_toolsmith', [0x3E4A5A, 0x4A5668, 0x566276, 0x626E82, 0x6E7A8E], (196, 156, 96), [0x5A3A1E, 0x6A4626, 0x7A522E], ''),
    ('_cleric', [0x4A2A5E, 0x5A346E, 0x6A3E7E, 0x7A488E, 0x8A549E], (232, 192, 72), None, 'pendant'),
]

# ---------------------------------------------------------------- painters (f, u, v, w, h) -> rgb | rgba | None


def player_head(f, u, v, w, h):
    skin, hair = grain(SKIN, 11, 0.6, 0.12, 0.1)(f, u, v), grain(HAIR, 12, 0.5, 0.3, 0.2)(f, u, v)
    if f == 'top':
        return hair
    if f == 'bottom':
        return shade(skin, 0.85)
    if f == 'back':
        return hair if v < 7 else skin
    if f in ('left', 'right'):
        back = side_back(f, u, w)
        if v < 2 or (back >= 3 and v < 3) or (back >= 5 and v < 6):
            return hair
        if back == 4 and v in (3, 4):
            return shade(skin, 0.86)  # ear shadow
        return skin
    if v < 2 or (v == 2 and u in (0, 1, 6, 7)):
        return hair
    if v == 3 and u in (1, 2, 5, 6):
        return pick(HAIR, 0.7)
    if v == 4:
        if u in (1, 6):
            return WHITE
        if u in (2, 5):
            return (58, 92, 168)
    if v == 5 and u in (3, 4):
        return shade(skin, 0.87)
    if v == 6 and u in (3, 4):
        return (140, 72, 58)
    if v == 6 and u in (2, 5):
        return shade(skin, 0.92)
    return skin


def player_hair(f, u, v, w, h):
    hair = grain(HAIR, 13, 0.55, 0.35, 0.25)(f, u, v)
    if f == 'top':
        return pick(HAIR, 0.9) if (u + v * 3) % 7 == 0 else hair
    if f == 'back':
        return hair if v < 6 or (v == 6 and u % 3) else None
    if f in ('left', 'right'):
        back = side_back(f, u, w)
        return hair if v < 2 or (back >= 4 and v < 5) or (back >= 6 and v < 6) else None
    if f == 'front':
        return hair if v == 0 or (v == 1 and u not in (2, 5)) else None
    return None


def player_shirt(f, u, v, w, h):
    c = grain(SHIRT, 21, 0.68, 0.12, 0.12)(f, u, v)
    if f == 'front':
        if (v == 0 and 2 <= u <= 5) or (v == 1 and u in (3, 4)):
            return shade(c, 0.72)
        if v == h - 1:
            return shade(c, 0.8)
        if u == 4 and 2 <= v < h - 1:
            return shade(c, 0.9)
        if v == 3 and u in (1, 2):
            return shade(c, 0.82)
    if f in ('back', 'left', 'right') and v == h - 1:
        return shade(c, 0.8)
    if f == 'top' and 2 <= u <= 5 and 1 <= v <= 2:
        return shade(c, 0.7)
    return c


def player_sleeve(f, u, v, w, h):
    c = grain(SHIRT, 22, 0.68, 0.12, 0.12)(f, u, v)
    if f == 'bottom' or (f not in ('top', 'bottom') and v == h - 1):
        return shade(c, 0.8)
    return c


def forearm(ramp, seed):
    def paint(f, u, v, w, h):
        c = grain(ramp, seed, 0.6, 0.12, 0.1)(f, u, v)
        if f == 'bottom' or (f not in ('top', 'bottom') and v >= h - 2):
            return shade(c, 0.9)
        return c
    return paint


def trousers(ramp, seed, torn=False):
    def paint(f, u, v, w, h):
        c = grain(ramp, seed, 0.55, 0.18, 0.2)(f, u, v)
        if f == 'top':
            return c
        if f == 'bottom':
            return hexc(SHOE[0])
        if v == 0 and not torn:
            return (59, 42, 28)
        if v >= h - 2:
            return hexc(SHOE[0]) if v == h - 1 else pick(SHOE, 0.4 + hsh(u, v, seed) * 0.6)
        if torn and v == h - 3 and hsh(u, FI[f], seed) < 0.5:
            return pick(ZSKIN, 0.5)
        if v in (6, 7) and f == 'front':
            return shade(c, 1.08)
        return c
    return paint


def zombie_head(f, u, v, w, h):
    skin = grain(ZSKIN, 31, 0.55, 0.22, 0.25)(f, u, v)
    hair = pick([0x223C1C, 0x2A4622, 0x33522A], hsh(u, v, 32 + FI[f]))
    if f == 'top':
        return hair if vnoise(u, v, 33) > 0.35 else skin
    if f == 'bottom':
        return shade(skin, 0.8)
    if f == 'back':
        return hair if v < 2 or (v < 4 and hsh(u, v, 34) < 0.5) else skin
    if f in ('left', 'right'):
        return hair if v < 1 or (v < 3 and side_back(f, u, w) > 4 and hsh(u, v, 35) < 0.6) else skin
    if v == 0 and hsh(u, 0, 36) < 0.6:
        return hair
    if v == 3 and 1 <= u <= 6:
        return shade(skin, 0.72)
    if v == 4 and u in (1, 2, 5, 6):
        return BLACK if u in (2, 5) else (36, 44, 34)
    if v == 5 and u in (3, 4):
        return shade(skin, 0.75)
    if v == 6 and 2 <= u <= 5:
        return (26, 38, 22) if (u + v) % 2 or u in (3, 4) else shade(skin, 0.7)
    return skin


def zombie_shirt(f, u, v, w, h):
    c = grain(ZSHIRT, 41, 0.55, 0.2, 0.25)(f, u, v)
    if f not in ('top', 'bottom') and v >= h - 2 and hsh(u, v + FI[f], 42) < 0.45:
        return pick(ZSKIN, 0.5)
    if f == 'front' and v == 0 and 2 <= u <= 5:
        return pick(ZSKIN, 0.4)
    return c


def zombie_sleeve(f, u, v, w, h):
    c = grain(ZSHIRT, 43, 0.55, 0.2, 0.25)(f, u, v)
    if f not in ('top', 'bottom') and v == h - 1 and hsh(u, FI[f], 44) < 0.5:
        return pick(ZSKIN, 0.5)
    return c


def skull(f, u, v, w, h):
    c = grain(BONE, 51, 0.62, 0.15, 0.15)(f, u, v)
    if f != 'front':
        return shade(c, 0.85) if f == 'bottom' else c
    if v in (3, 4) and u in (1, 2, 5, 6):
        return BLACK if v == 4 or u in (2, 5) else (48, 48, 46)
    if v == 5 and u in (3, 4):
        return (40, 40, 38)
    if v == 6 and 1 <= u <= 6:
        return (30, 30, 28) if u % 2 else shade(c, 0.95)
    if v == 7 and 2 <= u <= 5:
        return shade(c, 0.8)
    return c


def ribcage(f, u, v, w, h):
    c = grain(BONE, 52, 0.62, 0.15, 0.12)(f, u, v)
    if f in ('top', 'bottom'):
        return c
    spine = f in ('front', 'back') and u in (3, 4)
    if v == 0 or spine:
        return shade(c, 0.88) if spine and v % 2 else c
    if v < 8:
        if v % 2 == 1 and (f in ('left', 'right') or 1 <= u <= 6):
            return c
        return None
    if v >= 9 and (f in ('left', 'right') or 1 <= u <= 6):
        return shade(c, 0.9) if v == 9 else c
    return None


def bone_limb(f, u, v, w, h):
    c = grain(BONE, 53, 0.6, 0.15, 0.1)(f, u, v)
    if f in ('top', 'bottom') or v in (0, h - 1) or v == h // 2:
        return shade(c, 1.08)
    return c


def creeper_skin(face_front):
    def paint(f, u, v, w, h):
        s = 61 + FI[f] * 13
        t = vnoise(u, v, s, 2.0) * 0.6 + hsh(u, v, s + 1) * 0.5
        c = pick(CREEP, t)
        if face_front and f == 'front':
            if v in (2, 3) and u in (1, 2, 5, 6):
                return (200, 230, 190) if (v == 2 and u in (1, 5)) else BLACK
            if v == 4 and u in (3, 4):
                return BLACK
            if v == 5 and 2 <= u <= 5:
                return BLACK
            if v == 6 and u in (2, 3, 4, 5):
                return BLACK if u in (2, 5) or hsh(u, v, 62) < 0.3 else (26, 50, 20)
        return c
    return paint


def creeper_foot(f, u, v, w, h):
    c = creeper_skin(False)(f, u, v, w, h)
    return shade(c, 0.7) if f == 'bottom' or v == h - 1 else c


def spider_body(f, u, v, w, h):
    c = pick(SPIDER, 0.45 + (hsh(u, v, 71 + FI[f]) - 0.5) * 0.9)
    if hsh(u, v, 72 + FI[f]) < 0.08:
        return (86, 70, 58)  # bristles
    if f == 'top':
        cx, cy = (w - 1) / 2, (h - 1) / 2
        dx, dy = abs(u - cx), abs(v - cy)
        if dx < 1.2 + dy * 0.35 and dy < h * 0.35 and (dy > 1 or dx < 0.8):
            return (112, 60, 36) if (u + v) % 3 else (138, 78, 44)
    return c


def spider_head(f, u, v, w, h):
    c = pick(SPIDER, 0.5 + (hsh(u, v, 73 + FI[f]) - 0.5) * 0.8)
    if f != 'front':
        return c
    if v == 3 and u in (1, 2, 5, 6):
        return (255, 110, 96) if u in (1, 5) else (208, 28, 28)
    if v == 4 and u in (1, 2, 5, 6):
        return (150, 16, 16)
    if v == 2 and u in (3, 4):
        return (190, 24, 24)
    if v == 5 and u in (0, 7):
        return (170, 20, 20)
    if v == 7 and u in (2, 5):
        return (70, 60, 50)  # fangs
    return c


def spider_leg(f, u, v, w, h):
    c = pick(SPIDER, 0.35 + hsh(u, v, 74 + FI[f]) * 0.5)
    if f in ('front', 'back', 'top', 'bottom') and u % 6 == 5:
        return (72, 56, 44)  # joint band along the leg
    return c


def cow_hide(seed, blaze=False):
    def paint(f, u, v, w, h):
        brown = grain(COW, seed, 0.55, 0.2, 0.2)(f, u, v)
        if vnoise(u, v, seed + FI[f] * 17, 3.5) > 0.62:
            return grain(CREAM, seed + 1, 0.6, 0.15, 0.1)(f, u, v)
        if blaze and f == 'front' and u in (3, 4) and v < 5:
            return pick(CREAM, 0.7)
        return brown
    return paint


def cow_head(f, u, v, w, h):
    c = cow_hide(81, True)(f, u, v, w, h)
    if f == 'front' and v == 3 and u in (1, 6):
        return BLACK
    if f == 'front' and v == 3 and u in (0, 7):
        return WHITE
    return c


def muzzle(ramp, seed, nostrils):
    def paint(f, u, v, w, h):
        c = grain(ramp, seed, 0.55, 0.15, 0.1)(f, u, v)
        if f == 'front' and (u, v) in nostrils:
            return (92, 48, 46)
        return c
    return paint


def horn(f, u, v, w, h):
    return pick(CREAM, 0.3) if f == 'top' or v == 0 else pick(CREAM, 0.7)


def hoofed(ramp, seed, hoof, sock=None):
    def paint(f, u, v, w, h):
        if f == 'bottom' or (f != 'top' and v >= h - 2):
            return hexc(hoof) if f == 'bottom' or v == h - 1 else shade(hexc(hoof), 1.3)
        if sock and f != 'top' and v >= h - 4:
            return pick(sock, 0.5 + hsh(u, v, seed) * 0.4)
        return grain(ramp, seed, 0.55, 0.2, 0.2)(f, u, v)
    return paint


def pig_body(f, u, v, w, h):
    c = grain(PINK, 91, 0.55, 0.15, 0.2)(f, u, v)
    if f == 'top' and vnoise(u, v, 92, 3) > 0.72:
        return shade(c, 0.9)
    return c


def pig_head(f, u, v, w, h):
    c = grain(PINK, 93, 0.58, 0.14, 0.15)(f, u, v)
    if f == 'front':
        if v == 3 and u in (1, 6):
            return WHITE
        if v == 3 and u in (2, 5):
            return BLACK
        if v == 2 and u in (1, 2, 5, 6):
            return shade(c, 0.88)
    return c


def wool_coat(f, u, v, w, h):
    t = vnoise(u, v, 101 + FI[f] * 9, 2.0) * 0.65 + hsh(u, v, 102 + FI[f]) * 0.4
    return pick(WOOL, t)


def sheep_skin(f, u, v, w, h):
    return grain(FLEECE, 103, 0.55, 0.2, 0.2)(f, u, v)


def sheep_head(f, u, v, w, h):
    face = grain(SHEEPFACE, 104, 0.55, 0.15, 0.15)(f, u, v)
    woolly = pick(WOOL, vnoise(u, v, 105 + FI[f], 2.0) * 0.6 + hsh(u, v, 106) * 0.4)
    if f in ('top', 'back'):
        return woolly
    if f in ('left', 'right'):
        return woolly if v < 2 or side_back(f, u, w) > 3 else face
    if f == 'front':
        if v == 0:
            return woolly
        if v == 2 and u in (0, 5):
            return WHITE
        if v == 2 and u in (1, 4):
            return BLACK
        if v == 4 and u in (2, 3):
            return shade(face, 0.72)
    return face


def sheep_leg(f, u, v, w, h):
    if f != 'bottom' and v < 4 and f != 'top':
        return pick(WOOL, 0.3 + hsh(u, v, 107) * 0.6)
    return hoofed(SHEEPFACE, 108, 0x2E2620)(f, u, v, w, h)


def feathers(seed, wing=False):
    def paint(f, u, v, w, h):
        c = grain(FEATHER, seed, 0.62, 0.15, 0.15)(f, u, v)
        if wing and f in ('left', 'right') and (v + u) % 3 == 0 and v > 1:
            return shade(c, 0.88)
        if f == 'bottom':
            return shade(c, 0.88)
        return c
    return paint


def chicken_head(f, u, v, w, h):
    c = grain(FEATHER, 111, 0.65, 0.12, 0.1)(f, u, v)
    if f == 'front' and v == 1 and u in (0, 3):
        return BLACK
    if f in ('left', 'right') and v == 1 and side_back(f, u, w) == 0:
        return BLACK
    return c


def flat(ramp, seed):
    return lambda f, u, v, w, h: grain(ramp, seed, 0.55, 0.2, 0.1)(f, u, v)


def villager_head(extra):
    def paint(f, u, v, w, h):
        skin = grain(VSKIN, 131, 0.55, 0.12, 0.12)(f, u, v)
        if f == 'bottom':
            return shade(skin, 0.8)
        if extra == 'patch' and f != 'top' and v == 3:
            return (34, 30, 28)  # eye-patch strap
        if f != 'front':
            return skin
        if v == 3 and 1 <= u <= 6:
            return (58, 36, 22)  # unibrow
        if extra == 'patch' and v in (4, 5) and u in (5, 6):
            return BLACK
        if v == 4 and u in (1, 6):
            return WHITE
        if v == 4 and u in (2, 5):
            return (46, 120, 60)
        if extra == 'glasses' and ((v == 5 and u in (1, 2, 5, 6)) or (v == 4 and u in (0, 3, 4, 7))):
            return (196, 150, 58)
        if v == 8 and 2 <= u <= 5:
            return shade(skin, 0.72)
        return skin
    return paint


def robe(ramp, trim, apron, extra, part, seed):
    """Villager clothing: body (collar, belt, apron), skirt (hem), sleeves (cuffs, hands in the middle of the crossed arms)."""
    def paint(f, u, v, w, h):
        c = grain(ramp, seed, 0.55, 0.16, 0.2)(f, u, v)
        side = f not in ('top', 'bottom')
        if part == 'arms':
            if f in ('front', 'top', 'bottom') and w == 16 and 6 <= u <= 9:
                return grain(VSKIN, seed + 1, 0.6, 0.1, 0.1)(f, u, v)
            if f in ('front', 'top', 'bottom') and w == 16 and u in (5, 10):
                return trim
            return c
        on_apron = apron and f == 'front' and 1 <= u <= w - 2
        if part == 'body':
            if f == 'front' and v == 0 and 2 <= u <= w - 3:
                return trim
            if on_apron and v >= 4:
                return pick(apron, 0.5 + (hsh(u, v, seed + 2) - 0.5) * 0.6) if not (v == 4 and u in (1, w - 2)) else hexc(apron[0])
            if side and v == 9:
                return shade(trim, 0.8)
            if extra == 'pendant' and f == 'front' and u in (3, 4) and 2 <= v <= 4:
                return trim if v < 4 else shade(trim, 0.7)
        if part == 'skirt':
            if on_apron:
                return pick(apron, 0.5 + (hsh(u, v, seed + 3) - 0.5) * 0.6) if v < h - 1 else hexc(apron[0])
            if side and v == h - 1:
                return shade(c, 0.7)
            if f == 'front' and u in (3, 4) and v < h - 1:
                return shade(c, 0.85)  # robe split
        return c
    return paint


def piglin_skin(seed, rot=0.33):
    def paint(f, u, v, w, h):
        if vnoise(u, v, seed + FI[f] * 7, 2.5) < rot:
            return grain(ROT, seed + 1, 0.5, 0.25, 0.2)(f, u, v)
        return grain(PIGLIN, seed, 0.55, 0.16, 0.15)(f, u, v)
    return paint


def piglin_head(f, u, v, w, h):
    c = piglin_skin(141, 0.28)(f, u, v, w, h)
    if f != 'front':
        return c
    if v == 2 and 1 <= u <= 8:
        return shade(hexc(PIGLIN[0]), 0.8)  # heavy brow
    if v == 3 and u in (2, 7):
        return BLACK
    if v == 3 and u in (1, 6):
        return (236, 196, 64)  # gold iris
    if v == 3 and u in (3,):
        return (40, 30, 30)
    if u >= 6 and 4 <= v <= 6:
        return pick([0xB8B2A0, 0xD4CFBE, 0xE8E4D6], hsh(u, v, 142))  # skull showing through
    return c


def piglin_body(f, u, v, w, h):
    c = piglin_skin(143)(f, u, v, w, h)
    side = f not in ('top', 'bottom')
    if side and v == 7:
        return pick(GOLDC, 0.5 + hsh(u, FI[f], 144) * 0.4)  # gold belt
    if side and v >= 8:
        return pick([0x4A2E1A, 0x5A3820, 0x6A4428], hsh(u, v, 145) * 0.9 + (0.2 if v == 8 else 0))  # loincloth
    if f == 'front' and 1 <= u <= 3 and 2 <= v <= 5:
        return (232, 228, 214) if v % 2 == 0 else (58, 30, 30)  # exposed ribs
    return c


def piglin_leg(f, u, v, w, h):
    if f == 'bottom' or (f != 'top' and v >= h - 1):
        return (60, 40, 30)
    if f != 'top' and v < 5:
        return pick([0x4A2E1A, 0x5A3820, 0x6A4428], hsh(u, v, 146) * 0.9)
    return piglin_skin(147)(f, u, v, w, h)


def gold_sword(f, u, v, w, h):
    return pick(GOLDC, 0.45 + hsh(u, v, 148 + FI[f]) * 0.3 + (0.3 if f in ('top', 'left') else 0))


def ghast_skin(seed, face=''):
    def paint(f, u, v, w, h):
        c = pick(GHAST, 0.55 + (hsh(u, v, seed + FI[f]) - 0.5) * 0.35 + (vnoise(u, v, seed + 7, 4) - 0.5) * 0.3)
        if f != 'front' or not face:
            return shade(c, 0.9) if f == 'bottom' else c
        if face == 'calm':
            if v == 6 and (3 <= u <= 5 or 10 <= u <= 12):
                return (40, 40, 44)  # shut eyes
            if u in (4, 11) and 7 <= v <= 9 + (u == 11):
                return (150, 158, 170)  # tears
            if v == 12 and 6 <= u <= 9:
                return (40, 40, 44)
            return c
        if 4 <= v <= 7 and (2 <= u <= 5 or 10 <= u <= 13):
            return (200, 30, 30) if v in (5, 6) and u in (4, 11) else BLACK  # open eyes, red pupils
        if 10 <= v <= 13 and 5 <= u <= 10:
            return (120, 16, 16) if 11 <= v <= 12 and 6 <= u <= 9 else BLACK  # open mouth
        return c
    return paint


TNT_LABEL = ['TTT.N..N.TTT', '.T..NN.N..T.', '.T..N.NN..T.', '.T..N..N..T.']


def tnt_skin(f, u, v, w, h):
    if f in ('top', 'bottom'):
        cx, cy = (u % 8) - 3.5, (v % 8) - 3.5
        d = math.hypot(cx, cy)
        if f == 'top' and 6 <= u <= 9 and 6 <= v <= 9:
            return (216, 204, 176) if 7 <= u <= 8 and 7 <= v <= 8 else (42, 34, 32)
        return hexc(TNT_RED[0]) if d > 3.6 else pick(TNT_RED, 0.8 - d / 5 + (hsh(u, v, 151) - 0.5) * 0.2 - (0.25 if f == 'bottom' else 0))
    if 6 <= v <= 9 and 2 <= u <= 13 and TNT_LABEL[v - 6][u - 2] != '.':
        return (30, 26, 26)
    if 4 <= v <= 11:
        return (184, 176, 164) if v in (4, 11) else pick([0xE0DAD0, 0xECE8E0, 0xF6F4EE], hsh(u, v, 152))
    return pick(TNT_RED, (0.1 if u % 4 == 3 else 0.75 if u % 4 == 0 else 0.5) + (hsh(u, v, 153) - 0.5) * 0.25)


# ---------------------------------------------------------------- model specs


class Box:
    def __init__(self, pivot, material, origin, size, paint, inflate=0.0):
        self.pivot, self.material, self.origin, self.size, self.paint, self.inflate = pivot, material, origin, size, paint, inflate


def humanoid(key, head, body, sleeve, forearm_paint, legs, materials, thin=False, hair=None):
    limb = 2 if thin else 4
    half = limb / 2
    arm_x = 5 if thin else 6
    pivots = [
        ('body', (0, 12, 0)), ('head', (0, 24, 0)),
        ('arm_l', (-arm_x, 22, 0)), ('arm_r', (arm_x, 22, 0)),
        ('leg_l', (-2, 12, 0)), ('leg_r', (2, 12, 0)),
    ]
    m = materials
    boxes = [
        Box('body', m['shirt'], (-4, 0, -2), (8, 12, 4), body),
        Box('head', m['skin'], (-4, 0, -4), (8, 8, 8), head),
        Box('leg_l', m['pants'], (-half, -12, -half), (limb, 12, limb), legs),
        Box('leg_r', m['pants'], (-half, -12, -half), (limb, 12, limb), legs),
    ]
    for arm in ('arm_l', 'arm_r'):
        if sleeve:
            boxes.append(Box(arm, m['shirt'], (-half, -2, -half), (limb, 4, limb), sleeve))
            boxes.append(Box(arm, m['skin'], (-half, -10, -half), (limb, 8, limb), forearm_paint))
        else:
            boxes.append(Box(arm, m['skin'], (-half, -10, -half), (limb, 12, limb), forearm_paint))
    if hair:
        boxes.append(Box('head', m['hair'], (-4, 0, -4), (8, 8, 8), hair, inflate=0.5))
    return dict(key=key, scale=1.8 / 32, pivots=pivots, boxes=boxes)


def quad_legs(x, z_front, z_back, top, size, paint, material):
    w, h, d = size
    return [Box(name, material, (-w / 2, -h, -d / 2), size, paint) for name in ('leg_fl', 'leg_fr', 'leg_bl', 'leg_br')], [
        ('leg_fl', (-x, top, z_front)), ('leg_fr', (x, top, z_front)), ('leg_bl', (-x, top, z_back)), ('leg_br', (x, top, z_back))]


def models():
    player = humanoid('player', player_head, player_shirt, player_sleeve, forearm(SKIN, 23), trousers(PANTS, 24),
                      dict(skin='skin', shirt='shirt', pants='pants', hair='hair'), hair=player_hair)
    zombie = humanoid('zombie', zombie_head, zombie_shirt, zombie_sleeve, forearm(ZSKIN, 45), trousers(ZPANTS, 46, torn=True),
                      dict(skin='zombie', shirt='zombie', pants='zombie'))
    skeleton = humanoid('skeleton', skull, ribcage, None, bone_limb, bone_limb, dict(skin='bone', shirt='bone', pants='bone'), thin=True)

    creeper_legs, creeper_pivots = quad_legs(2, -4, 4, 6, (4, 6, 4), creeper_foot, 'creeper')
    creeper = dict(key='creeper', scale=1.7 / 26, pivots=[('body', (0, 6, 0)), ('head', (0, 18, 0))] + creeper_pivots, boxes=[
        Box('body', 'creeper', (-4, 0, -2), (8, 12, 4), creeper_skin(False)),
        Box('head', 'creeper', (-4, 0, -4), (8, 8, 8), creeper_skin(True)),
    ] + creeper_legs)

    spider_pivots = [('body', (0, 9, 1)), ('head', (0, 9, -2))]
    spider_boxes = [
        Box('body', 'spider', (-3, -3, -3), (6, 6, 6), spider_body),
        Box('body', 'spider', (-5, -4, 3), (10, 8, 12), spider_body),
        Box('head', 'spider', (-4, -4, -8), (8, 8, 8), spider_head),
    ]
    for i in range(8):
        side = -1 if i < 4 else 1
        z = (-1.5, 0.5, 2.5, 4.5)[i % 4] - 1
        spider_pivots.append((f'leg_{i}', (side * 3, 9, z)))
        spider_boxes.append(Box(f'leg_{i}', 'spider', (-16 if side < 0 else 0, -1, -1), (16, 2, 2), spider_leg))
    spider = dict(key='spider', scale=0.9 / 13, pivots=spider_pivots, boxes=spider_boxes)

    cow_legs, cow_leg_pivots = quad_legs(3, -6, 7, 12, (4, 12, 4), hoofed(COW, 82, 0x241C18, CREAM), 'cow')
    cow = dict(key='cow', scale=1.4 / 23.5, pivots=[('body', (0, 12, 0)), ('head', (0, 19, -9))] + cow_leg_pivots, boxes=[
        Box('body', 'cow', (-6, 0, -9), (12, 10, 18), cow_hide(83)),
        Box('body', 'cow', (-2, -2, 3), (4, 2, 5), muzzle(PINK, 84, ())),
        Box('head', 'cow', (-4, -4, -6), (8, 8, 6), cow_head),
        Box('head', 'cow', (-2, -4, -7), (4, 3, 1), muzzle(PINK, 85, {(0, 1), (3, 1)})),
        Box('head', 'cow', (-5, 3, -4), (1, 3, 1), horn),
        Box('head', 'cow', (4, 3, -4), (1, 3, 1), horn),
    ] + cow_legs)

    pig_legs, pig_leg_pivots = quad_legs(3, -5, 5, 6, (4, 6, 4), hoofed(PINK, 94, 0x7A4A48), 'pig')
    pig = dict(key='pig', scale=0.9 / 15, pivots=[('body', (0, 6, 0)), ('head', (0, 12, -7))] + pig_leg_pivots, boxes=[
        Box('body', 'pig', (-5, 0, -8), (10, 8, 16), pig_body),
        Box('head', 'pig', (-4, -4, -8), (8, 8, 8), pig_head),
        Box('head', 'pig', (-2, -3, -9), (4, 3, 1), muzzle(SNOUT, 95, {(1, 1), (2, 1)})),
    ] + pig_legs)

    sheep_legs, sheep_leg_pivots = quad_legs(2, -5, 5, 12, (4, 12, 4), sheep_leg, 'sheep')
    sheep = dict(key='sheep', scale=1.3 / 21, pivots=[('body', (0, 12, 0)), ('wool', (0, 12, 0), 'body'), ('head', (0, 18, -8))] + sheep_leg_pivots, boxes=[
        Box('body', 'sheep', (-4, 0, -8), (8, 6, 16), sheep_skin),
        Box('wool', 'sheep', (-4, 0, -8), (8, 6, 16), wool_coat, inflate=1.75),
        Box('head', 'sheep', (-3, -3, -8), (6, 6, 8), sheep_head),
    ] + sheep_legs)

    chicken = dict(key='chicken', scale=0.048, pivots=[
        ('body', (0, 5, 0)), ('head', (0, 9, -3)), ('arm_l', (-3, 11, 0)), ('arm_r', (3, 11, 0)), ('leg_l', (-1.5, 5, 1)), ('leg_r', (1.5, 5, 1)),
    ], boxes=[
        Box('body', 'chicken', (-3, 0, -4), (6, 6, 8), feathers(112)),
        Box('head', 'chicken', (-2, 0, -3), (4, 6, 3), chicken_head),
        Box('head', 'chicken', (-2, 2, -5), (4, 2, 2), flat(BEAK, 113)),
        Box('head', 'chicken', (-1, 0, -4), (2, 2, 1), flat(RED, 114)),
        Box('head', 'chicken', (-0.5, 6, -3), (1, 1, 3), flat(RED, 115)),
        Box('arm_l', 'chicken', (-1, -4, -3), (1, 4, 6), feathers(116, True)),
        Box('arm_r', 'chicken', (0, -4, -3), (1, 4, 6), feathers(117, True)),
        Box('leg_l', 'chicken', (-0.5, -5, -0.5), (1, 5, 1), flat(BEAK, 118)),
        Box('leg_r', 'chicken', (-0.5, -5, -0.5), (1, 5, 1), flat(BEAK, 119)),
        Box('leg_l', 'chicken', (-1.5, -5, -2), (3, 1, 3), flat(BEAK, 120)),
        Box('leg_r', 'chicken', (-1.5, -5, -2), (3, 1, 3), flat(BEAK, 121)),
    ])
    villagers = [villager(*profession) for profession in PROFESSIONS]

    piglin = humanoid('zombified_piglin', piglin_head, piglin_body, None, piglin_skin(149), piglin_leg,
                      dict(skin='zombified_piglin', shirt='zombified_piglin', pants='zombified_piglin'))
    piglin['scale'] = 1.95 / 32
    piglin['boxes'][1] = Box('head', 'zombified_piglin', (-5, 0, -4), (10, 8, 8), piglin_head)
    piglin['pivots'].append(('item', (6, 13, 0), 'arm_r'))
    piglin['boxes'] += [
        Box('head', 'zombified_piglin', (-2, 1, -5), (4, 3, 1), muzzle(PIGLIN, 150, {(1, 1), (2, 1)})),
        Box('head', 'zombified_piglin', (-3, 0, -5), (1, 2, 1), flat(CREAM, 151)),
        Box('head', 'zombified_piglin', (2, 0, -5), (1, 2, 1), flat(CREAM, 152)),
        Box('head', 'zombified_piglin', (-6, 2, -2), (1, 5, 3), piglin_skin(153, 0.2)),
        Box('head', 'zombified_piglin', (5, 2, -2), (1, 5, 3), piglin_skin(154, 0.2)),
        Box('item', 'gold_sword', (-0.5, -1, -14), (1, 2, 10), gold_sword),
        Box('item', 'gold_sword', (-0.5, -2, -4), (1, 4, 1), gold_sword),
        Box('item', 'gold_sword', (-0.5, -0.5, -3), (1, 1, 3), flat([0x4A2E1A, 0x5A3820, 0x6A4428], 155)),
    ]

    ghast_pivots, ghast_boxes = [('body', (0, 8, 0)), ('face_shoot', (0, 8, 0), 'body')], [
        Box('body', 'ghast', (-8, -8, -8), (16, 16, 16), ghast_skin(161, 'calm')),
        Box('face_shoot', 'ghast', (-8, -8, -8.12), (16, 16, 0.1), ghast_skin(161, 'shoot')),
    ]
    for i, length in enumerate((9, 12, 8, 13, 10, 11, 8, 12, 9)):
        x, z = ((i % 3) - 1) * 5.5 + (hsh(i, 1, 162) - 0.5) * 1.5, (i // 3 - 1) * 5 + (hsh(i, 2, 162) - 0.5) * 1.5
        ghast_pivots.append((f'tentacle_{i}', (round(x * 2) / 2, 0, round(z * 2) / 2), 'body'))
        ghast_boxes.append(Box(f'tentacle_{i}', 'ghast', (-1, -length, -1), (2, length, 2), ghast_skin(163 + i)))
    ghast = dict(key='ghast', scale=4 / 16, pivots=ghast_pivots, boxes=ghast_boxes)

    tnt = dict(key='tnt', scale=0.98 / 16, pivots=[('body', (0, 8, 0))], boxes=[Box('body', 'tnt', (-8, -8, -8), (16, 16, 16), tnt_skin)])
    return [player, zombie, skeleton, creeper, spider, cow, pig, sheep, chicken, *villagers, piglin, ghast, tnt]


def villager(suffix, ramp, trim, apron, extra):
    """MC-proportioned villager: tall head with a big nose, a robe over short legs and crossed arms."""
    m, seed = 'villager', 170 + len(suffix)
    pivots = [('body', (0, 12, 0)), ('head', (0, 24, 0)), ('nose', (0, 27, -4), 'head'), ('arms', (0, 21, -1), 'body'),
              ('leg_l', (-2, 12, 0)), ('leg_r', (2, 12, 0))]
    boxes = [
        Box('body', m, (-4, 0, -3), (8, 12, 6), robe(ramp, trim, apron, extra, 'body', seed)),
        Box('body', m, (-4, -6, -3), (8, 6, 6), robe(ramp, trim, apron, extra, 'skirt', seed + 1), inflate=0.5),
        Box('head', m, (-4, 0, -4), (8, 10, 8), villager_head(extra)),
        Box('nose', m, (-1, -2, -2), (2, 4, 2), flat(VSKIN, seed + 2)),
        Box('arms', m, (-8, -5, -2), (4, 6, 4), robe(ramp, trim, apron, extra, 'arms', seed + 3)),
        Box('arms', m, (4, -5, -2), (4, 6, 4), robe(ramp, trim, apron, extra, 'arms', seed + 4)),
        Box('arms', m, (-8, -5, -6), (16, 4, 4), robe(ramp, trim, apron, extra, 'arms', seed + 5)),
        Box('leg_l', m, (-2, -12, -2), (4, 12, 4), trousers(VPANTS, seed + 6)),
        Box('leg_r', m, (-2, -12, -2), (4, 12, 4), trousers(VPANTS, seed + 7)),
    ]
    if extra == 'straw':
        pivots.append(('hat', (0, 32, 0), 'head'))
        boxes += [Box('hat', m, (-6, 0, -6), (12, 1, 12), flat(STRAW, seed + 8)),
                  Box('hat', m, (-4, 1, -4), (8, 2, 8), lambda f, u, v, w, h: (150, 40, 32) if f not in ('top', 'bottom') and v == h - 1 else pick(STRAW, 0.6 + hsh(u, v, 179) * 0.3), inflate=0.25)]
    return dict(key='villager' + suffix, scale=1.95 / 34, pivots=pivots, boxes=boxes)


MATERIALS = {'hair': dict(alpha=True), 'bone': dict(alpha=True, double=True)}

# ---------------------------------------------------------------- texture packing and painting


def face_sizes(size):
    w, h, d = (max(1, round(s)) for s in size)
    return {'front': (w, h), 'back': (w, h), 'left': (d, h), 'right': (d, h), 'top': (w, d), 'bottom': (w, d)}, (w, h, d)


def box_layout(size):
    """MC-style unwrap: row 0 = [ d | top w | bottom w ], row 1 = [ left d | front w | right d | back w ]."""
    _, (w, h, d) = face_sizes(size)
    rects = {'top': (d, 0, w, d), 'bottom': (d + w, 0, w, d), 'left': (0, d, d, h), 'front': (d, d, w, h), 'right': (d + w, d, d, h), 'back': (2 * d + w, d, w, h)}
    return rects, (2 * (d + w), d + h)


def pack(blocks, width):
    """Shelf-pack (w, h) blocks; returns offsets and the used height."""
    order = sorted(range(len(blocks)), key=lambda i: -blocks[i][1])
    offsets, x, y, row = [None] * len(blocks), 0, 0, 0
    for i in order:
        w, h = blocks[i]
        if x + w > width:
            x, y, row = 0, y + row, 0
        offsets[i] = (x, y)
        x, row = x + w, max(row, h)
    return offsets, y + row


def pow2(n):
    p = 16
    while p < n:
        p *= 2
    return p


def build_texture(name, boxes):
    layouts = [box_layout(b.size) for b in boxes]
    widest = max(size[0] for _, size in layouts)
    width = pow2(max(widest, 32))
    offsets, used = pack([size for _, size in layouts], width)
    while used > width * 2 and width < 256:
        width *= 2
        offsets, used = pack([size for _, size in layouts], width)
    height = pow2(used)
    pixels = [0.0] * (width * height * 4)
    uv_rects = []
    for box, (rects, _), (ox, oy) in zip(boxes, layouts, offsets):
        sizes, _ = face_sizes(box.size)
        placed = {}
        for face, (rx, ry, rw, rh) in rects.items():
            placed[face] = (ox + rx, oy + ry, rw, rh)
            for v in range(rh):
                for u in range(rw):
                    c = box.paint(face, u, v, rw, rh)
                    if c is None:
                        continue
                    a = c[3] if len(c) > 3 else 255
                    px, py = ox + rx + u, oy + ry + v
                    i = ((height - 1 - py) * width + px) * 4
                    pixels[i:i + 4] = [c[0] / 255, c[1] / 255, c[2] / 255, a / 255]
        uv_rects.append(placed)
    image = bpy.data.images.new(name, width, height, alpha=True)
    image.pixels[:] = pixels
    path = os.path.join(TMP, f'{name}.png')
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    return image, uv_rects, (width, height)


def make_material(kind, image, name=None):
    opts = MATERIALS.get(kind, {})
    mat = bpy.data.materials.new(name or kind)
    if hasattr(mat, 'use_nodes') and not mat.use_nodes:
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nodes.new('ShaderNodeTexImage')
    tex.image, tex.interpolation = image, 'Closest'
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    for socket in ('Specular IOR Level', 'Specular'):
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = 0.1
    if opts.get('alpha'):
        clip = nodes.new('ShaderNodeMath')
        clip.operation = 'ROUND'
        links.new(tex.outputs['Alpha'], clip.inputs[0])
        links.new(clip.outputs[0], bsdf.inputs['Alpha'])
    mat.use_backface_culling = not opts.get('double', False)
    return mat

# ---------------------------------------------------------------- geometry


def to_blender(p, s):
    x, y, z = p
    if FACING == '+Z':
        x, z = -x, -z
    return (x * s, -z * s, y * s)


def box_quads(origin, size, inflate):
    x0, y0, z0 = (origin[i] - inflate for i in range(3))
    x1, y1, z1 = (origin[i] + size[i] + inflate for i in range(3))
    # Corners per face as seen from outside: top-left, bottom-left, bottom-right, top-right (counter-clockwise).
    return {
        'front': [(x1, y1, z0), (x1, y0, z0), (x0, y0, z0), (x0, y1, z0)],
        'back': [(x0, y1, z1), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1)],
        'right': [(x1, y1, z1), (x1, y0, z1), (x1, y0, z0), (x1, y1, z0)],
        'left': [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
        'top': [(x1, y1, z1), (x1, y1, z0), (x0, y1, z0), (x0, y1, z1)],
        'bottom': [(x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y0, z0)],
    }


def clear_scene():
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.lights, bpy.data.cameras):
        for block in list(collection):
            collection.remove(block)


def build(spec, offset=(0.0, 0.0, 0.0), suffix=''):
    s = spec['scale']
    root = bpy.data.objects.new(spec['key'] + suffix, None)
    bpy.context.scene.collection.objects.link(root)
    root.location = offset
    by_material = {}
    for box in spec['boxes']:
        by_material.setdefault(box.material, []).append(box)
    materials, uvs = {}, {}
    for name, boxes in by_material.items():
        image, rects, dims = build_texture(f"{spec['key']}_{name}{suffix}", boxes)
        materials[name] = make_material(name, image, name + suffix)
        for box, rect in zip(boxes, rects):
            uvs[id(box)] = (rect, dims)
    positions, pivots = {}, {}
    for entry in spec['pivots']:
        name, pos = entry[0], entry[1]
        parent = entry[2] if len(entry) > 2 else None
        empty = bpy.data.objects.new(name + suffix, None)
        empty.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(empty)
        empty.parent = pivots[parent] if parent else root
        base = positions[parent] if parent else (0, 0, 0)
        empty.location = to_blender(tuple(pos[i] - base[i] for i in range(3)), s)
        positions[name], pivots[name] = pos, empty
    for name, empty in pivots.items():
        boxes = [b for b in spec['boxes'] if b.pivot == name]
        if not boxes:
            continue
        verts, faces, face_uvs, face_mats, slots = [], [], [], [], []
        for box in boxes:
            if box.material not in slots:
                slots.append(box.material)
            rect, (tw, th) = uvs[id(box)]
            for face, corners in box_quads(box.origin, box.size, box.inflate).items():
                rx, ry, rw, rh = rect[face]
                start = len(verts)
                verts.extend(to_blender(c, s) for c in corners)
                faces.append((start, start + 1, start + 2, start + 3))
                u0, u1, v0, v1 = rx / tw, (rx + rw) / tw, 1 - ry / th, 1 - (ry + rh) / th
                face_uvs.append([(u0, v0), (u0, v1), (u1, v1), (u1, v0)])
                face_mats.append(slots.index(box.material))
        mesh = bpy.data.meshes.new(f'{name}_geo{suffix}')
        mesh.from_pydata(verts, [], faces)
        uv_layer = mesh.uv_layers.new(name='UVMap')
        for poly, corner_uvs, mat_index in zip(mesh.polygons, face_uvs, face_mats):
            poly.material_index = mat_index
            for loop_index, uv in zip(poly.loop_indices, corner_uvs):
                uv_layer.data[loop_index].uv = uv
        for slot in slots:
            mesh.materials.append(materials[slot])
        mesh.update()
        obj = bpy.data.objects.new(f'{name}_geo{suffix}', mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = empty
    return root, pivots, materials


def export(spec):
    clear_scene()
    build(spec)
    path = os.path.join(OUT, f"{spec['key']}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_animations=False,
                              export_cameras=False, export_lights=False)
    return path, os.path.getsize(path)

# ---------------------------------------------------------------- lineup render


def pose(key, pivots, variant):
    def rot(name, x=0.0, yaw=0.0, roll=0.0):
        # Game-space rotations: x about +X, yaw about +Y (Blender Z), roll about +Z (Blender -Y).
        if name in pivots:
            pivots[name].rotation_euler = (x, -roll, yaw)
    if key.startswith('villager'):
        rot('leg_l', 0.2)
        rot('leg_r', -0.2)
        rot('head', 0, -0.3)
    elif key == 'ghast':
        for i in range(9):
            rot(f'tentacle_{i}', (hsh(i, 3, 164) - 0.5) * 0.5, 0, (hsh(i, 4, 164) - 0.5) * 0.4)
        pivots['face_shoot'].hide_render = variant != 'shoot'
        for child in pivots['face_shoot'].children_recursive:
            child.hide_render = variant != 'shoot'
    elif key == 'tnt':
        pass
    elif key in ('player', 'zombie', 'skeleton', 'zombified_piglin'):
        rot('leg_l', 0.35)
        rot('leg_r', -0.35)
        rot('head', 0, 0.25)
        if key == 'zombie':
            rot('arm_l', math.pi / 2 - 0.1)
            rot('arm_r', math.pi / 2 + 0.1)
        elif key == 'zombified_piglin':
            rot('arm_l', -0.3)
            rot('arm_r', 0.6)
        else:
            rot('arm_l', -0.35)
            rot('arm_r', 0.35 if key == 'player' else math.pi / 2)
    elif key == 'spider':
        for i in range(8):
            side = -1 if i < 4 else 1
            fan = (-0.55, -0.18, 0.18, 0.55)[i % 4] * -side
            pivots[f'leg_{i}'].rotation_euler = (0, 0, 0)
            rot(f'leg_{i}', 0, fan, -side * 0.6)
    elif key == 'chicken':
        rot('arm_l', 0, 0, -0.5)
        rot('arm_r', 0, 0, 0.5)
    else:
        rot('leg_fl', 0.3)
        rot('leg_br', 0.3)
        rot('leg_fr', -0.3)
        rot('leg_bl', -0.3)
        rot('head', 0.15 if key != 'creeper' else 0, 0.2)
    if variant == 'sheared' and 'wool' in pivots:
        for child in pivots['wool'].children_recursive:
            child.hide_render = True


def render_lineup(specs):
    clear_scene()
    scene = bpy.context.scene
    by_key = {spec['key']: spec for spec in specs}
    row = ['player', 'zombie', 'skeleton', 'creeper', 'spider', 'cow', 'pig', 'sheep', 'sheep', 'chicken',
           'villager', 'villager_librarian', 'villager_armorer', 'villager_toolsmith', 'villager_cleric', 'zombified_piglin', 'tnt']
    widths = {'player': 1.0, 'zombie': 1.0, 'skeleton': 0.9, 'creeper': 0.9, 'spider': 2.1, 'cow': 1.4, 'pig': 1.2, 'sheep': 1.3, 'chicken': 0.7, 'tnt': 1.0, 'zombified_piglin': 1.2}
    x = 0.0
    for i, key in enumerate(row):
        x += widths.get(key, 1.0) / 2
        root, pivots, materials = build(by_key[key], (-x, 0, 0), f'.{i}')  # camera looks down -Y, so +X reads right-to-left
        root.rotation_euler = (0, 0, math.radians(-28))
        pose(key, pivots, 'sheared' if key == 'sheep' and row[:i].count('sheep') else '')
        if key == 'player':
            tint = materials['shirt'].node_tree
            bsdf = next(n for n in tint.nodes if n.type == 'BSDF_PRINCIPLED')
            tex = next(n for n in tint.nodes if n.type == 'TEX_IMAGE')
            mul = tint.nodes.new('ShaderNodeMix')
            mul.data_type, mul.blend_type = 'RGBA', 'MULTIPLY'
            mul.inputs[0].default_value = 1.0
            tint.links.new(tex.outputs['Color'], mul.inputs[6])
            mul.inputs[7].default_value = (0.9, 0.25, 0.18, 1)
            tint.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
        x += widths.get(key, 1.0) / 2 + 0.45
    width = x - 0.45
    for i, (variant, gx) in enumerate((('', 0.3), ('shoot', 0.7))):  # two ghasts float behind the row: calm and shooting
        root, pivots, _ = build(by_key['ghast'], (-width * gx, -7, 3.2), f'.g{i}')
        root.rotation_euler = (0, 0, math.radians(-15 if i else 15))
        pose('ghast', pivots, variant)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(-width / 2, 0, 0))
    ground = bpy.context.active_object
    gmat = bpy.data.materials.new('ground')
    gbsdf = next(n for n in gmat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    gbsdf.inputs['Base Color'].default_value = (0.09, 0.2, 0.05, 1)
    gbsdf.inputs['Roughness'].default_value = 1
    ground.data.materials.append(gmat)

    cam_data = bpy.data.cameras.new('camera')
    cam_data.lens = 30
    cam = bpy.data.objects.new('camera', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (-width / 2, 24, 5.2)
    target = (-width / 2, 0, 2.6)
    direction = tuple(target[i] - cam.location[i] for i in range(3))
    from mathutils import Vector
    cam.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = 0.2
    sun.rotation_euler = (math.radians(50), math.radians(-18), math.radians(-35))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 0.8
    fill.rotation_euler = (math.radians(70), math.radians(30), math.radians(160))
    scene.collection.objects.link(fill)

    world = bpy.data.worlds.new('sky') if not scene.world else scene.world
    scene.world = world
    if hasattr(world, 'use_nodes') and not world.use_nodes:
        world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.52, 0.7, 0.95, 1)
    bg.inputs['Strength'].default_value = 0.9

    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    if scene.render.engine == 'CYCLES':
        scene.cycles.samples = 48
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x, scene.render.resolution_y = 2800, 1000
    scene.render.filepath = os.path.join(HERE, 'lineup.png')
    bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    specs = models()
    for spec in specs:
        path, size = export(spec)
        print(f'[blockwild] {os.path.basename(path)} {size} bytes')
    render_lineup(specs)
    print('[blockwild] lineup', os.path.join(HERE, 'lineup.png'))


main()
