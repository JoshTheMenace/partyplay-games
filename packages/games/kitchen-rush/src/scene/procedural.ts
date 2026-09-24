// Fallback art for every name in the DESIGN.md model contract. Used whenever kitchen-kit.glb lacks an object,
// so the kitchen always renders fully while the authored kit is missing, partial or being rebuilt.
import { Color } from 'three';
import { Shape } from './shapes';
import type { Palette } from './themes';

const PI = Math.PI;
export const shade = (hex: string, factor: number) => `#${new Color(hex).multiplyScalar(factor).getHexString()}`;
const STEEL = '#b7c1ca', DARK_STEEL = '#3d434b', WOOD = '#d39a5f', WOOD_DARK = '#a8703f', WHITE = '#f7f4ec';

function counter(s: Shape, p: Palette, top = p.top, body = p.counter) {
  s.box([.9, .08, .86], { at: [0, .04, 0], color: p.kick });
  s.box([.98, .78, .94], { at: [0, .47, 0], color: body, r: .035 });
  s.box([.8, .54, .02], { at: [0, .46, .472], color: shade(body, 1.14), r: .01 });
  s.box([.24, .035, .035], { at: [0, .66, .49], color: STEEL, finish: 'metal', r: .012 });
  return s.box([1, .08, 1], { at: [0, .86, 0], color: top, r: .025, finish: 'gloss' });
}
const leaf = (s: Shape, x: number, y: number, z: number, size: number, color: string, turn = 0) => s.box([size, .018, size * .8], { at: [x, y, z], rot: [.25, turn, .15], color, r: .008 });
const slice = (s: Shape, x: number, y: number, z: number, r: number, color: string, inner: string) => { s.cylinder(r, r, .028, { at: [x, y, z], color }); return s.cylinder(r * .78, r * .78, .004, { at: [x, y + .015, z], color: inner }); };
const bun = (s: Shape, y: number, top: boolean) => top
  ? s.sphere(.13, { at: [0, y, 0], scale: [1, .58, 1], color: '#e3a24f' }).sphere(.012, { at: [.04, y + .07, .02], color: WHITE }).sphere(.012, { at: [-.05, y + .065, -.02], color: WHITE }).sphere(.012, { at: [.0, y + .075, -.06], color: WHITE })
  : s.cylinder(.13, .12, .05, { at: [0, y + .025, 0], color: '#e8b168' });
const patty = (s: Shape, y: number, color = '#7b4a2d') => s.cylinder(.125, .125, .05, { at: [0, y + .025, 0], color }).box([.2, .006, .018], { at: [0, y + .052, -.04], color: shade(color, .55) }).box([.2, .006, .018], { at: [0, y + .052, .04], color: shade(color, .55) });
const bowl = (s: Shape, soup: string) => s.lathe([[.001, 0], [.1, 0], [.16, .05], [.19, .13], [.175, .13], [.14, .06], [.001, .04]], { color: WHITE, finish: 'gloss' }).cylinder(.172, .172, .01, { at: [0, .11, 0], color: soup });

/** One procedural asset, or undefined when the name is not part of the contract. */
export function proceduralShape(name: string, p: Palette): Shape | undefined {
  const s = new Shape();
  switch (name) {
    case 'counter': return counter(s, p);
    case 'board': return counter(s, p).box([.64, .045, .48], { at: [0, .922, -.02], color: WOOD, r: .02 }).box([.26, .012, .055], { at: [.14, .952, .17], rot: [0, .35, 0], color: STEEL, finish: 'metal', r: .004 }).box([.11, .026, .034], { at: [-.03, .955, .24], rot: [0, .35, 0], color: '#3b2a22', r: .01 });
    case 'stove': return counter(s, p, DARK_STEEL).torus(.19, .022, { at: [0, .91, 0], rot: [PI / 2, 0, 0], color: '#23262b', finish: 'metal' }).cylinder(.07, .07, .02, { at: [0, .905, 0], color: '#1b1d21' })
      .box([.44, .02, .03], { at: [0, .925, 0], color: '#1f2226', finish: 'metal' }).box([.03, .02, .44], { at: [0, .925, 0], color: '#1f2226', finish: 'metal' })
      .cylinder(.045, .045, .05, { at: [-.28, .72, .49], rot: [PI / 2, 0, 0], color: p.accent2 }).cylinder(.045, .045, .05, { at: [.28, .72, .49], rot: [PI / 2, 0, 0], color: p.accent2 });
    case 'stove_flame': for (let i = 0; i < 10; i++) s.cone(.028, .07, { at: [Math.cos(i / 10 * PI * 2) * .16, .93, Math.sin(i / 10 * PI * 2) * .16], color: i % 2 ? '#5ab4ff' : '#8fd0ff', finish: 'glow', segments: 6 }); return s;
    case 'oven': return s.box([.98, .5, .94], { at: [0, .25, 0], color: '#b95c43', r: .04 }).box([1, .05, 1], { at: [0, .5, 0], color: p.top, r: .02 })
      .sphere(.46, { at: [0, .52, -.04], scale: [1, .82, .95], color: '#d77a55', segments: 20 }).box([.5, .3, .12], { at: [0, .66, .38], color: '#2a1a14', r: .1 })
      .torus(.25, .035, { at: [0, .66, .43], arc: PI, color: '#f1c27b' }).box([.62, .04, .24], { at: [0, .49, .4], color: shade(p.top, .9), r: .015 })
      .cylinder(.075, .085, .34, { at: [.2, 1.02, -.2], color: '#6b6d74', finish: 'metal' }).box([.9, .05, .02], { at: [0, .16, .48], color: '#8d3f2e' });
    case 'sink': return counter(s, p).box([.66, .012, .54], { at: [0, .904, .02], color: '#8e99a4', finish: 'metal', r: .01 }).box([.56, .004, .44], { at: [0, .911, .02], color: '#8fd0ea', finish: 'gloss' })
      .cylinder(.03, .03, .28, { at: [0, 1.04, -.38], color: STEEL, finish: 'metal' }).torus(.08, .026, { at: [0, 1.18, -.3], rot: [0, PI / 2, 0], arc: PI, color: STEEL, finish: 'metal' })
      .sphere(.04, { at: [-.13, .96, -.39], color: '#5fb7e8' }).sphere(.04, { at: [.13, .96, -.39], color: '#e8574a' });
    case 'rack': {
      counter(s, p);
      for (const x of [-.36, -.18, 0, .18, .36]) s.cylinder(.016, .016, .38, { at: [x, 1.09, -.4], color: WOOD_DARK });
      return s.box([.86, .04, .08], { at: [0, .92, -.4], color: WOOD, r: .015 }).box([.86, .03, .05], { at: [0, 1.27, -.4], color: WOOD, r: .012 });
    }
    case 'return': return counter(s, p).box([.72, .03, .62], { at: [0, .915, .06], color: STEEL, finish: 'metal', r: .01 }).box([.72, .34, .04], { at: [0, 1.07, -.43], color: p.accent, r: .015 })
      .cylinder(.1, .1, .02, { at: [0, 1.08, -.405], rot: [PI / 2, 0, 0], color: '#e3dccb' }).sphere(.03, { at: [.03, 1.1, -.39], scale: [1, 1, .3], color: '#8a6b4a' });
    case 'serve': return counter(s, p, STEEL, p.accent).box([.08, .86, .08], { at: [-.44, 1.32, -.3], color: p.trim, r: .02 }).box([.08, .86, .08], { at: [.44, 1.32, -.3], color: p.trim, r: .02 })
      .box([1.02, .24, .12], { at: [0, 1.76, -.3], color: p.trim, r: .03 }).box([.8, .1, .02], { at: [0, 1.76, -.235], color: '#fff1b8', finish: 'glow' })
      .sphere(.07, { at: [.3, .93, .3], scale: [1, .75, 1], color: '#f2c14e', finish: 'metal' }).cylinder(.012, .012, .05, { at: [.3, .99, .3], color: '#f2c14e', finish: 'metal' })
      .box([.7, .012, .5], { at: [0, .908, 0], color: '#ffe9a6', finish: 'glow' });
    case 'bin': return s.box([.86, .06, .86], { at: [0, .03, 0], color: p.kick, r: .02 }).lathe([[.001, .06], [.3, .06], [.33, .12], [.34, .74], [.001, .74]], { color: '#5f6b77', finish: 'metal' })
      .cylinder(.36, .35, .06, { at: [0, .78, 0], color: '#7e8a96', finish: 'metal' }).sphere(.06, { at: [0, .82, 0], scale: [1.4, .5, 1.4], color: '#9aa5ae', finish: 'metal' })
      .box([.2, .04, .1], { at: [0, .08, .34], color: DARK_STEEL }).box([.18, .18, .01], { at: [0, .45, .335], color: '#d6dde3', r: .02 });
    case 'crate': {
      s.box([.9, .08, .86], { at: [0, .04, 0], color: p.kick });
      for (const [x, z, w, d] of [[0, .44, .94, .06], [0, -.44, .94, .06], [.44, 0, .06, .94], [-.44, 0, .06, .94]]) for (const y of [.25, .5, .75]) s.box([w, .2, d], { at: [x, y, z], color: y === .5 ? WOOD_DARK : WOOD, r: .015 });
      for (const [x, z] of [[.44, .44], [-.44, .44], [.44, -.44], [-.44, -.44]]) s.box([.09, .84, .09], { at: [x, .5, z], color: WOOD_DARK, r: .02 });
      return s.box([.84, .02, .84], { at: [0, .7, 0], color: '#5a3b22' });
    }
    case 'belt': return counter(s, p, DARK_STEEL).box([1, .05, .1], { at: [0, .93, .44], color: '#8a939c', finish: 'metal', r: .015 }).box([1, .05, .1], { at: [0, .93, -.44], color: '#8a939c', finish: 'metal', r: .015 })
      .cylinder(.045, .045, .8, { at: [.47, .88, 0], rot: [PI / 2, 0, 0], color: '#c9d1d8', finish: 'metal' }).cylinder(.045, .045, .8, { at: [-.47, .88, 0], rot: [PI / 2, 0, 0], color: '#c9d1d8', finish: 'metal' });
    case 'wall': return s.box([1, 1.26, 1], { at: [0, .63, 0], color: p.wall }).box([1, .16, 1.02], { at: [0, .08, 0], color: p.trim }).box([1.02, .07, 1.04], { at: [0, 1.28, 0], color: p.trim, r: .02 }).box([1, .04, 1.01], { at: [0, .6, 0], color: shade(p.wall, .82) });
    case 'floor_tile': return s.box([.97, .06, .97], { at: [0, -.03, 0], color: '#ffffff', r: .018 });
    case 'floor_flat': return s.box([.97, .06, .97], { at: [0, -.03, 0], color: '#ffffff' });
    case 'ice_tile': return s.box([.99, .06, .99], { at: [0, -.03, 0], color: '#cdeefa', r: .012, finish: 'gloss' }).box([.5, .004, .02], { at: [-.12, .002, .1], rot: [0, .6, 0], color: '#f4fcff' }).box([.3, .004, .02], { at: [.2, .002, -.18], rot: [0, -.4, 0], color: '#f4fcff' });
    case 'gate_plank': {
      [-.33, 0, .33].forEach((z, i) => s.box([.98, .08, .3], { at: [0, -.04, z], color: i === 1 ? WOOD_DARK : WOOD, r: .015 }));
      return s.box([.06, .02, .98], { at: [-.35, .005, 0], color: '#4d545c', finish: 'metal' }).box([.06, .02, .98], { at: [.35, .005, 0], color: '#4d545c', finish: 'metal' });
    }
    case 'portal_pad': return s.cylinder(.47, .49, .05, { at: [0, .025, 0], color: '#7d7897', segments: 28 }).torus(.42, .03, { at: [0, .055, 0], rot: [PI / 2, 0, 0], color: '#d8c6ff', finish: 'glow' });
    // ── Items (base at y = 0) ──
    case 'pot': return s.cylinder(.21, .19, .2, { at: [0, .1, 0], color: STEEL, finish: 'metal', segments: 22 }).torus(.205, .016, { at: [0, .2, 0], rot: [PI / 2, 0, 0], color: '#d9e0e6', finish: 'metal' })
      .cylinder(.19, .19, .004, { at: [0, .196, 0], color: '#3b4148' }).box([.08, .03, .05], { at: [.25, .16, 0], color: '#2d2f35', r: .012 }).box([.08, .03, .05], { at: [-.25, .16, 0], color: '#2d2f35', r: .012 });
    case 'pan': return s.cylinder(.22, .18, .06, { at: [0, .03, 0], color: '#2e3035', finish: 'metal', segments: 22 }).cylinder(.2, .2, .004, { at: [0, .058, 0], color: '#4a4e56' }).box([.3, .035, .06], { at: [.36, .05, 0], color: '#3a2a22', r: .015 });
    case 'plate': return s.cylinder(.19, .14, .03, { at: [0, .015, 0], color: WHITE, finish: 'gloss', segments: 22 }).torus(.18, .012, { at: [0, .03, 0], rot: [PI / 2, 0, 0], color: '#ffffff', finish: 'gloss' });
    case 'plate_dirty': return s.cylinder(.19, .14, .03, { at: [0, .015, 0], color: '#ddd4c1', segments: 22 }).torus(.18, .012, { at: [0, .03, 0], rot: [PI / 2, 0, 0], color: '#e6dfcf' })
      .sphere(.05, { at: [.05, .03, .03], scale: [1, .15, .8], color: '#8a6b4a' }).sphere(.035, { at: [-.07, .03, -.04], scale: [1, .15, 1], color: '#a0522d' });
    case 'extinguisher': return s.cylinder(.09, .09, .36, { at: [0, .18, 0], color: '#e0322b', finish: 'gloss' }).sphere(.09, { at: [0, .36, 0], scale: [1, .6, 1], color: '#e0322b', finish: 'gloss' })
      .cylinder(.03, .03, .07, { at: [0, .44, 0], color: '#2b2b2b' }).box([.14, .025, .04], { at: [.04, .48, 0], color: '#c7ccd1', finish: 'metal' }).torus(.08, .014, { at: [.08, .38, 0], rot: [0, 0, PI / 2], arc: PI, color: '#222' })
      .box([.12, .06, .004], { at: [0, .2, .09], color: WHITE });
    case 'soup_tomato': return s.cylinder(.188, .188, .02, { at: [0, .01, 0], color: '#d9412f', finish: 'gloss' });
    case 'soup_onion': return s.cylinder(.188, .188, .02, { at: [0, .01, 0], color: '#dcaa4f', finish: 'gloss' });
    case 'soup_mixed': return s.cylinder(.188, .188, .02, { at: [0, .01, 0], color: '#e0763a', finish: 'gloss' });
    // ── Food ──
    case 'lettuce_raw': case 'lettuce_cooked':
      s.sphere(.13, { at: [0, .11, 0], scale: [1, .82, 1], color: '#6fbf45' });
      for (let i = 0; i < 6; i++) s.sphere(.075, { at: [Math.cos(i) * .09, .1 + (i % 2) * .04, Math.sin(i) * .09], scale: [1, .7, 1], color: i % 2 ? '#8fd660' : '#5aa83a' });
      return s;
    case 'lettuce_chopped': for (let i = 0; i < 7; i++) leaf(s, Math.cos(i * 2.3) * .07, .015 + (i % 3) * .018, Math.sin(i * 2.3) * .06, .09, i % 2 ? '#8fd660' : '#5fb13c', i); return s;
    case 'tomato_raw': return s.sphere(.12, { at: [0, .11, 0], scale: [1, .88, 1], color: '#e9503c', finish: 'gloss' }).cylinder(.012, .012, .05, { at: [0, .22, 0], color: '#3f7a2a' })
      .box([.1, .012, .025], { at: [0, .205, 0], rot: [0, 0, 0], color: '#4f9a34' }).box([.1, .012, .025], { at: [0, .205, 0], rot: [0, PI / 3, 0], color: '#4f9a34' }).box([.1, .012, .025], { at: [0, .205, 0], rot: [0, -PI / 3, 0], color: '#4f9a34' });
    case 'tomato_chopped': slice(s, -.05, .014, .02, .07, '#e9503c', '#ff8a6a'); slice(s, .05, .03, -.01, .07, '#e9503c', '#ff8a6a'); return slice(s, 0, .046, .04, .065, '#e9503c', '#ff8a6a');
    case 'tomato_cooked': return s.sphere(.11, { at: [0, .06, 0], scale: [1, .55, 1], color: '#c7372a', finish: 'gloss' }).sphere(.04, { at: [.03, .1, .02], scale: [1, .4, 1], color: '#e5604a' });
    case 'onion_raw': return s.sphere(.11, { at: [0, .1, 0], scale: [1, .95, 1], color: '#c99bd6' }).cone(.05, .09, { at: [0, .23, 0], color: '#b07cc0' }).cylinder(.03, .02, .02, { at: [0, .005, 0], color: '#d9c9a3' });
    case 'onion_chopped': return s.torus(.06, .018, { at: [-.04, .018, 0], rot: [PI / 2, 0, 0], color: '#efe0f4' }).torus(.05, .016, { at: [.05, .018, .03], rot: [PI / 2, 0, 0], color: '#dcc2e6' }).torus(.045, .016, { at: [0, .05, -.01], rot: [PI / 2 + .2, 0, 0], color: '#efe0f4' });
    case 'onion_cooked': return s.torus(.06, .02, { at: [-.03, .02, 0], rot: [PI / 2, 0, 0], color: '#e2b86a' }).torus(.05, .018, { at: [.05, .02, .03], rot: [PI / 2, 0, 0], color: '#d9a24f' });
    case 'patty_raw': return s.box([.24, .1, .18], { at: [0, .05, 0], color: '#d4545a', r: .04 }).sphere(.02, { at: [.05, .1, .02], scale: [1.6, .3, 1], color: '#f5d6d6' }).sphere(.018, { at: [-.06, .1, -.03], scale: [1.6, .3, 1], color: '#f5d6d6' });
    case 'patty_chopped': return s.cylinder(.12, .12, .05, { at: [0, .025, 0], color: '#d9606a' }).sphere(.02, { at: [.03, .05, .02], scale: [1, .2, 1], color: '#f2b8b8' });
    case 'patty_cooked': return patty(s, 0);
    case 'bun_raw': case 'bun_chopped': case 'bun_cooked': bun(s, 0, false); return bun(s, .06, true);
    case 'dough_raw': case 'dough_chopped': return s.sphere(.13, { at: [0, .07, 0], scale: [1, .58, 1], color: '#f1d49b' });
    case 'dough_cooked': return s.cylinder(.17, .17, .03, { at: [0, .015, 0], color: '#f0c67c' }).torus(.165, .024, { at: [0, .03, 0], rot: [PI / 2, 0, 0], color: '#d99a4e' });
    case 'cheese_raw': case 'cheese_cooked': return s.cylinder(.15, .15, .1, { at: [0, .05, 0], rot: [0, .3, 0], color: '#f7c948', segments: 3 }).sphere(.02, { at: [.03, .1, .02], scale: [1, .2, 1], color: '#e0a92a' });
    case 'cheese_chopped': return s.box([.15, .02, .15], { at: [0, .01, 0], rot: [0, .3, 0], color: '#f7c948', r: .005 }).box([.15, .02, .15], { at: [.02, .03, .01], rot: [0, -.2, 0], color: '#ffd65c', r: .005 });
    case 'burnt': return s.sphere(.1, { at: [0, .06, 0], scale: [1, .6, 1], color: '#2a211d' }).sphere(.06, { at: [.06, .08, .03], color: '#1c1614' }).sphere(.05, { at: [-.05, .09, -.03], color: '#3a2c25' });
    // ── Dishes (sit on the plate) ──
    case 'dish_side_salad': for (let i = 0; i < 12; i++) leaf(s, Math.cos(i * 2.4) * .08 * (i % 3 + 1) / 3, .015 + (2 - i % 3) * .022, Math.sin(i * 2.4) * .08 * (i % 3 + 1) / 3, .1, i % 2 ? '#8fd660' : '#5fb13c', i); return s;
    case 'dish_salad': for (let i = 0; i < 10; i++) leaf(s, Math.cos(i * 2.4) * .09 * (i % 3 + 1) / 3, .015 + (2 - i % 3) * .02, Math.sin(i * 2.4) * .09 * (i % 3 + 1) / 3, .1, i % 2 ? '#8fd660' : '#5fb13c', i);
      slice(s, .05, .07, .02, .045, '#e9503c', '#ff8a6a'); return slice(s, -.04, .075, -.03, .045, '#e9503c', '#ff8a6a');
    case 'dish_tomato_soup': return bowl(s, '#d9412f').sphere(.02, { at: [.05, .115, .02], scale: [1, .3, 1], color: '#ffffff' });
    case 'dish_onion_soup': return bowl(s, '#dcaa4f').box([.04, .03, .04], { at: [.04, .12, .03], color: '#e3b56a', r: .008 }).box([.04, .03, .04], { at: [-.05, .12, -.02], color: '#e3b56a', r: .008 });
    case 'dish_burger': bun(s, 0, false); patty(s, .05); return bun(s, .13, true);
    case 'dish_cheeseburger': bun(s, 0, false); patty(s, .05); s.box([.22, .014, .22], { at: [0, .107, 0], rot: [0, .5, 0], color: '#f7c948' }); return bun(s, .15, true);
    case 'dish_deluxe_burger': bun(s, 0, false); patty(s, .05); s.torus(.12, .02, { at: [0, .11, 0], rot: [PI / 2, 0, 0], color: '#6fbf45' }); slice(s, 0, .13, 0, .095, '#e9503c', '#ff8a6a'); return bun(s, .19, true);
    case 'dish_pizza': s.cylinder(.17, .17, .03, { at: [0, .015, 0], color: '#f0c67c' }).torus(.165, .024, { at: [0, .03, 0], rot: [PI / 2, 0, 0], color: '#d99a4e' }).cylinder(.145, .145, .006, { at: [0, .033, 0], color: '#d23d2a' });
      for (let i = 0; i < 6; i++) s.sphere(.035, { at: [Math.cos(i) * .08, .036, Math.sin(i) * .08], scale: [1, .25, 1], color: '#fbe7a1' });
      return s.box([.03, .005, .02], { at: [.02, .04, -.03], color: '#3f8f35' }).box([.03, .005, .02], { at: [-.06, .04, .05], color: '#3f8f35' });
    // ── Theme props (outside the kitchen) ──
    case 'prop_plant': return s.cylinder(.22, .16, .34, { at: [0, .17, 0], color: '#c9673f' }).sphere(.3, { at: [0, .6, 0], color: '#4f9f45' }).sphere(.2, { at: [.17, .74, .05], color: '#63b556' }).sphere(.18, { at: [-.15, .78, -.05], color: '#3f8a3a' });
    case 'prop_topiary': return s.box([.46, .4, .46], { at: [0, .2, 0], color: '#f3efe6', r: .04 }).cylinder(.04, .05, .5, { at: [0, .6, 0], color: '#6d4a33' }).sphere(.34, { at: [0, 1.05, 0], color: '#4f9f45', segments: 18 });
    case 'prop_lamp': return s.cylinder(.16, .2, .1, { at: [0, .05, 0], color: '#2f3338', finish: 'metal' }).cylinder(.04, .05, 1.8, { at: [0, .95, 0], color: '#2f3338', finish: 'metal' }).sphere(.16, { at: [0, 1.9, 0], color: '#fff1c4', finish: 'glow' }).cone(.2, .12, { at: [0, 2.06, 0], color: '#2f3338', finish: 'metal' });
    case 'prop_stool': return s.cylinder(.03, .03, .6, { at: [0, .3, 0], color: STEEL, finish: 'metal' }).cylinder(.2, .2, .03, { at: [0, .02, 0], color: STEEL, finish: 'metal' }).cylinder(.22, .22, .1, { at: [0, .64, 0], color: p.trim });
    case 'prop_bench': return s.box([1.5, .08, .5], { at: [0, .45, 0], color: WOOD, r: .03 }).box([1.5, .4, .06], { at: [0, .75, -.22], rot: [-.15, 0, 0], color: WOOD, r: .03 })
      .box([.08, .45, .42], { at: [-.65, .22, 0], color: DARK_STEEL, finish: 'metal' }).box([.08, .45, .42], { at: [.65, .22, 0], color: DARK_STEEL, finish: 'metal' });
    case 'prop_post': return s.cylinder(.13, .15, .7, { at: [0, .35, 0], color: '#3d3b3a', finish: 'metal' }).cylinder(.16, .16, .08, { at: [0, .72, 0], color: '#3d3b3a', finish: 'metal' }).torus(.15, .03, { at: [0, .45, 0], rot: [PI / 2, 0, 0], color: '#c9a36a' });
    case 'prop_boat': return s.box([1.7, .26, .76], { at: [0, .13, 0], color: '#e8574a', r: .12 }).box([1.5, .08, .6], { at: [0, .24, 0], color: WOOD, r: .03 }).box([.12, .06, .62], { at: [0, .3, 0], color: WOOD_DARK });
    case 'prop_logs': return s.cylinder(.13, .13, .9, { at: [0, .13, -.14], rot: [0, 0, PI / 2], color: WOOD_DARK }).cylinder(.13, .13, .9, { at: [0, .13, .14], rot: [0, 0, PI / 2], color: WOOD_DARK }).cylinder(.13, .13, .9, { at: [0, .36, 0], rot: [0, 0, PI / 2], color: WOOD });
    case 'prop_rope': return s.cylinder(.04, .05, .9, { at: [-.66, .45, 0], color: p.accent, finish: 'metal' }).cylinder(.04, .05, .9, { at: [.66, .45, 0], color: p.accent, finish: 'metal' })
      .torus(.66, .03, { at: [0, .82, 0], rot: [0, 0, PI], arc: PI, scale: [1, .35, 1], color: '#b3263a' });
    case 'prop_barrel': return s.cylinder(.26, .26, .66, { at: [0, .33, 0], color: '#a86a3a' }).torus(.265, .02, { at: [0, .15, 0], rot: [PI / 2, 0, 0], color: '#555', finish: 'metal' }).torus(.265, .02, { at: [0, .52, 0], rot: [PI / 2, 0, 0], color: '#555', finish: 'metal' });
    case 'prop_buoy': case 'prop_lifering': return s.cylinder(.05, .05, 1, { at: [0, .5, 0], color: WOOD_DARK }).torus(.22, .06, { at: [0, .8, .07], color: '#f4f1ea' }).torus(.22, .062, { at: [0, .8, .07], arc: PI / 2, color: '#e8574a' }).torus(.22, .062, { at: [0, .8, .07], rot: [0, 0, PI], arc: PI / 2, color: '#e8574a' });
    case 'prop_crate_stack': case 'prop_crates': return s.box([.6, .5, .6], { at: [0, .25, 0], color: WOOD, r: .03 }).box([.5, .42, .5], { at: [.1, .71, .05], rot: [0, .4, 0], color: WOOD_DARK, r: .03 });
    case 'prop_pine': return s.cylinder(.08, .1, .4, { at: [0, .2, 0], color: '#6d4a33' }).cone(.55, .8, { at: [0, .75, 0], color: '#2f6e4a' }).cone(.42, .7, { at: [0, 1.15, 0], color: '#3a8058' }).cone(.28, .55, { at: [0, 1.5, 0], color: '#448a60' }).cone(.16, .25, { at: [0, 1.75, 0], color: '#f5f8fc' });
    case 'prop_snowman': return s.sphere(.32, { at: [0, .3, 0], color: '#fbfdff' }).sphere(.23, { at: [0, .75, 0], color: '#fbfdff' }).sphere(.16, { at: [0, 1.08, 0], color: '#fbfdff' }).cone(.03, .16, { at: [0, 1.08, .2], rot: [PI / 2, 0, 0], color: '#f08a2c' }).cylinder(.12, .12, .2, { at: [0, 1.28, 0], color: '#2b2b33' }).cylinder(.18, .18, .02, { at: [0, 1.19, 0], color: '#2b2b33' }).torus(.17, .04, { at: [0, .92, 0], rot: [PI / 2, 0, 0], color: p.accent });
    case 'prop_cactus': return s.capsule(.16, .9, { at: [0, .6, 0], color: '#4f9a4a' }).capsule(.09, .3, { at: [.26, .75, 0], color: '#5aa853' }).capsule(.08, .3, { at: [-.24, .9, 0], color: '#5aa853' }).box([.2, .05, .06], { at: [.17, .62, 0], color: '#4f9a4a', r: .02 }).box([.2, .05, .06], { at: [-.16, .78, 0], color: '#4f9a4a', r: .02 });
    case 'prop_rock': case 'prop_skull': return s.sphere(.4, { at: [0, .15, 0], scale: [1.2, .6, 1], color: '#b56a45' }).sphere(.25, { at: [.35, .1, .1], scale: [1, .7, 1], color: '#c97b52' });
    case 'prop_lantern': return s.cylinder(.03, .03, 1.5, { at: [0, .75, 0], color: '#3b2b2b' }).box([.35, .03, .03], { at: [.15, 1.48, 0], color: '#3b2b2b' }).sphere(.14, { at: [.3, 1.3, 0], scale: [1, 1.2, 1], color: '#ffb347', finish: 'glow' }).cylinder(.05, .05, .04, { at: [.3, 1.46, 0], color: '#3b2b2b' });
    case 'prop_awning': case 'prop_stall': {
      s.box([1.4, .8, .7], { at: [0, .4, 0], color: WOOD, r: .03 }).box([.06, 1.6, .06], { at: [-.66, .8, .3], color: WOOD_DARK }).box([.06, 1.6, .06], { at: [.66, .8, .3], color: WOOD_DARK });
      for (let i = 0; i < 6; i++) s.box([.24, .05, .9], { at: [-.6 + i * .24, 1.62, .1], rot: [.35, 0, 0], color: i % 2 ? '#fff4e0' : p.accent });
      return s.sphere(.1, { at: [-.3, .86, 0], color: '#e9503c' }).sphere(.1, { at: [0, .86, .05], color: '#f7c948' }).sphere(.1, { at: [.3, .86, -.02], color: '#6fbf45' });
    }
    case 'prop_basket': return s.cylinder(.3, .24, .3, { at: [0, .15, 0], color: '#c9994f' }).sphere(.1, { at: [.08, .32, 0], color: '#e9503c' }).sphere(.1, { at: [-.1, .32, .05], color: '#f2a93b' }).sphere(.09, { at: [0, .34, -.1], color: '#8fd660' });
    case 'prop_column': return s.cylinder(.3, .3, .12, { at: [0, .06, 0], color: p.accent, finish: 'metal' }).cylinder(.22, .22, 2.4, { at: [0, 1.3, 0], color: '#efe9df', segments: 16 }).box([.6, .14, .6], { at: [0, 2.55, 0], color: p.accent, finish: 'metal' });
  }
  return undefined;
}
