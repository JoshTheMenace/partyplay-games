"""Giga Bowser (Melee): Bowser's monstrous transformation. The Bowser build pushed further: dark slate-green hide, a
near-black shell with oversized cream spikes, long curling horns, a bigger flaming mane, glowing yellow eyes, spiked
elbows, huge claws and a heavier tail spike. No prop. Reuses fighters/bowser.py with its own parameters and palette."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
import fighters.bowser as BW

COLORS = {'primary': '#4f6f4a', 'secondary': '#26292a', 'accent': '#c9a45a', 'light': '#eee2c0', 'hair': '#d9542a', 'dark': '#191417', 'metal': '#8e949e',
          'eye-white': '#f6e8c4', 'emissive': '#ffd23a', 'trim': '#8a6a34', 'eye': '#d83020'}
COSTUMES = [('Crimson', {'secondary': '#5a1a1c', 'hair': '#ffb040', 'emissive': '#ff8a3a'}),
            ('Shadow', {'primary': '#3a3650', 'secondary': '#17151f', 'hair': '#9a5aff', 'emissive': '#c07aff', 'accent': '#8a7aa8', 'trim': '#5a4a78'}),
            ('Frost', {'primary': '#6f8fa6', 'secondary': '#27385a', 'hair': '#e8f4ff', 'emissive': '#7af0ff', 'accent': '#d6e2ea', 'trim': '#8aa0b8'})]
J = BW.J
B = {**BW.B, 'horn': 1.55, 'spikes': 1.55, 'claws': 1.6, 'brow': 32, 'hair': 1.25, 'iris': 'emissive', 'elbow_spikes': True, 'tail': 1.5}
IDLE = {**BW.IDLE, 'spine': (14, 0, 0), 'chest': (10, 0, 0), 'head': (-16, 0, 0)}
HERO = {**BW.HERO, 'spine': (16, -8, 0), 'chest': (14, -10, 0), 'head': (-12, 20, 0), 'upperarm_L': (0, -30, -10), 'forearm_L': (0, -70, 0), 'upperarm_R': (0, 20, 30), 'forearm_R': (0, 70, 0)}
PORTRAIT = {'pose': {**IDLE, 'head': (-14, -14, 0)}, 'shoulders': .32}

def build(): return BW.build_bowser('giga-bowser', COLORS, COSTUMES, B)

main(globals())
