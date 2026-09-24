"""Crazy Hand (Melee): Master Hand's twitchy twin, a giant white LEFT glove (thumb at -X) with the same cuff and seams but
restless, splayed fingers. Built with master-hand.glove() mirrored; see that file for the 'hand' body plan."""
import os, sys, importlib.util; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
_spec = importlib.util.spec_from_file_location('master_hand', os.path.join(os.path.dirname(os.path.realpath(__file__)), 'master-hand.py'))
MH = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(MH)

COLORS = dict(MH.COLORS)
COSTUMES = [('Violet', {'light': '#cdb8f2', 'trim': '#a58ad8', 'secondary': '#bca4ea'}),
            ('Crimson', {'light': '#e86a6a', 'trim': '#b8424a', 'secondary': '#d65a5e'}),
            ('Ink', {'light': '#3c3a48', 'trim': '#26242e', 'secondary': '#312f3c'})]
FINGERS = [(.268, 1.05, .57, .1, -12), (.09, 1.08, .63, .104, -4), (-.09, 1.06, .6, .1, 5), (-.262, .99, .49, .092, 14)]
IDLE = {'sym': {'upperarm': (20, 0, 0), 'forearm': (8, 0, 0), 'hand': (22, 0, 0), 'thigh': (6, 0, 0), 'shin': (26, 0, 0), 'foot': (4, 0, 0)}}
TWITCH = {'upperarm_L': (30, 0, 0), 'forearm_L': (40, 0, 0), 'hand_L': (20, 0, 0), 'thigh_L': (-8, 0, 0), 'shin_L': (10, 0, 0),
          'thigh_R': (40, 0, 0), 'shin_R': (50, 0, 0), 'foot_R': (30, 0, 0), 'upperarm_R': (5, 0, 0), 'forearm_R': (25, 0, 0), 'hand_R': (5, 0, 0)}
HERO = {**TWITCH, 'root_loc': (0, .5, 0), 'hips': (58, -38, 12), 'extra_thumb_0': (0, 0, 14)}  # crawling spider-hand, fingertips down
HERO_VIEW = (-.5, .62, 1)
PORTRAIT = {'pose': {**TWITCH, 'hips': (64, -40, 0)}, 'shoulders': 6, 'fill': .82, 'view': (-.55, .85, 1)}

def build(): return MH.glove('crazy-hand', COLORS, COSTUMES, side=-1, pitch=24, splay=1.0, fingers=FINGERS, thumb_bend=.6)

main(globals())
