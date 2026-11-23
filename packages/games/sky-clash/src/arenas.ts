/**
 * The stages of the Reaches: Sky Clash's own arenas, authored here in meters. src/stages.ts lists them first and runs them through the
 * same collision machinery as the legacy stages. Layouts are genre staples only: a main floor with three platforms, and a long flat deck.
 * The art is modelled in Blender to these numbers (tools/blender/crew/<id>.py); tests/arenas.test.ts checks the two agree.
 */
import { UNIT } from './model';

export const ARENA_IDS = ['beacon-rock', 'bellyard'] as const;
export type ArenaId = typeof ARENA_IDS[number];
export const isArena = (id: string): id is ArenaId => (ARENA_IDS as readonly string[]).includes(id);
/** Meters to the unit the stage machinery is authored in. */
const u = (m: number) => m / UNIT, u4 = (a: number, b: number, c: number, d: number) => [u(a), u(b), u(c), u(d)] as const, pt = (x: number, y: number) => [u(x), u(y)] as const;
export const ARENAS = {
  'beacon-rock': {
    name: 'Beacon Rock', source: 'Original', family: 'reaches', blurb: 'Sola’s lighthouse isle at dusk: a broad terrace and three floating slabs under the turning beam.',
    palette: '#2c3a80 #f0a070 #b08a9a #a89a8c #c9963f #ff9a3c #ffd9a8',
    blast: u4(-15.5, 15.5, -8.5, 13.5), camera: u4(-12, 12, -5.5, 11),
    blocks: [{ id: 'main', l: u(-5.6), r: u(5.6), top: 0, bottom: u(-1.4) }, { id: 'under', l: u(-4.2), r: u(4.2), top: u(-1.4), bottom: u(-3.2), ledges: false as const }],
    platforms: [{ id: 'left', l: u(-3.9), r: u(-1.5), y: u(2.1) }, { id: 'right', l: u(1.5), r: u(3.9), y: u(2.1) }, { id: 'top', l: u(-1.2), r: u(1.2), y: u(4.1) }],
    spawns: [pt(-3.1, 0), pt(3.1, 0), pt(-1.1, 0), pt(1.1, 0)], respawns: [pt(-2.7, 6.2), pt(2.7, 6.2), pt(-.9, 6.6), pt(.9, 6.6)],
  },
  bellyard: {
    name: 'Bellyard', source: 'Original', family: 'reaches', blurb: 'Toll’s foundry deck in a storm: one long riveted deck under the great bells, and a cargo pallet swinging on its chains above the middle.',
    palette: '#0c1422 #b8683a #27344a #5d6470 #c9963f #ffb347 #cfe0ff',
    blast: u4(-16.5, 16.5, -8.5, 13), camera: u4(-13, 13, -5.5, 10.5),
    blocks: [{ id: 'main', l: u(-6.6), r: u(6.6), top: 0, bottom: u(-1.5) }, { id: 'under', l: u(-5.2), r: u(5.2), top: u(-1.5), bottom: u(-3.4), ledges: false as const }],
    platforms: [{ id: 'pallet', l: u(-1.7), r: u(1.7), y: u(2.4) }],
    spawns: [pt(-3.6, 0), pt(3.6, 0), pt(-1.3, 0), pt(1.3, 0)], respawns: [pt(-3.2, 6), pt(3.2, 6), pt(-1.1, 6.4), pt(1.1, 6.4)],
  },
};
