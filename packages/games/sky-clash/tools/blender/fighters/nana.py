"""Nana (Melee Ice Climbers): Popo's partner, the same puffy mountaineer in a pink parka with the white fur-ringed
hood, deeper rose mittens, brown boots and the wooden mallet; auburn hair with a side-swept fringe and a curl on
each cheek. Built by popo.climber()."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..'))
from common import *
from fighters.popo import J, IDLE, HERO, PORTRAIT, climber

COLORS = {'primary': '#f58cb8', 'light': '#f7f6f2', 'accent': '#d8386a', 'secondary': '#7a4a2a', 'trim': '#c08a52', 'metal': '#b9c0ca',
          'skin': '#fbd2b0', 'hair': '#b5602e', 'dark': '#231a1c', 'eye': '#2e2230', 'eye-white': '#ffffff'}
COSTUMES = [('Green', {'primary': '#9ccf52', 'accent': '#e8506e'}), ('Orange', {'primary': '#f5903a', 'accent': '#c8303a'}), ('Red', {'primary': '#a42c3e', 'accent': '#f59ab8'})]

def bangs(m, HC, face):
    for x, dx, L in ((-.09, -.03, .06), (-.04, .03, .07), (.02, .06, .07), (.08, .05, .05)):  # fringe swept to her left
        a = HC + Vector((x, .15, .1)); m.add(spike(a, a + Vector((dx * .6, .01, .05)), a + Vector((dx * 1.3, -L, .065)), .04, sq=(1, .5), up=(0, 0, 1), n=6, seg=7), 'hair', 'head', tag='hair')
    for s in (1, -1):  # a curl on each cheek, just inside the fur
        pts = [face.near(HC + Vector((s * x, y, .2)))[0] + face.near(HC + Vector((s * x, y, .2)))[1] * .012 for x, y in ((.12, .04), (.135, -.01), (.12, -.05), (.13, -.08))]
        m.add(strand(pts, .02, .01, n=8, seg=7), 'hair', 'head', tag='hair')

def build():
    m = Model('nana', J, COLORS, COSTUMES, prop='always'); climber(m, J, bangs, girl=True); return m

main(globals())
