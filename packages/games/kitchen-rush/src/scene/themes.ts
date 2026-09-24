import type { Theme } from '../model';

/** Colour script for one kitchen theme. Procedural art, lighting and edge props all read from here. */
export type Palette = {
  sky: string; ground: string; apron: string; floorA: string; floorB: string; slab: string; rim: string;
  wall: string; /** Multiplies the authored wall's own colours. */ wallTint: string; trim: string; counter: string; top: string; kick: string; accent: string; accent2: string;
  hemiSky: string; hemiGround: string; sun: string; sunIntensity: number; hemiIntensity: number;
  pit: 'water' | 'chasm'; pitColor: string; props: readonly string[]; night?: boolean;
};

export const THEMES: Record<Theme, Palette> = {
  diner: {
    sky: '#f5d9ae', ground: '#8cc270', apron: '#d9d2c3', floorA: '#f6eedc', floorB: '#9fd6c6', slab: '#c98d5d', rim: '#8a5a3c',
    wall: '#fbe4bd', wallTint: '#ffe4d6', trim: '#e2574c', counter: '#e2574c', top: '#f4f1e8', kick: '#8e3a33', accent: '#2fb3a4', accent2: '#ffc94a',
    hemiSky: '#fff4de', hemiGround: '#b98a6a', sun: '#ffe7c2', sunIntensity: 2.6, hemiIntensity: 1.25, pit: 'chasm', pitColor: '#3d2a24',
    props: ['prop_plant', 'prop_stool', 'prop_bench', 'prop_lamp', 'prop_topiary'],
  },
  harbor: {
    sky: '#bfe4f2', ground: '#3d93bf', apron: '#a67c52', floorA: '#d2a06a', floorB: '#bf8b56', slab: '#8a6440', rim: '#5d4029',
    wall: '#e6eef2', wallTint: '#d6e6ff', trim: '#2f6f9a', counter: '#2f6f9a', top: '#ece4d2', kick: '#1c4561', accent: '#f2b134', accent2: '#e8574a',
    hemiSky: '#effaff', hemiGround: '#6f8f9e', sun: '#fff1d6', sunIntensity: 2.7, hemiIntensity: 1.2, pit: 'water', pitColor: '#2e86b4',
    props: ['prop_barrel', 'prop_lifering', 'prop_post', 'prop_crates', 'prop_boat', 'prop_lantern'],
  },
  alpine: {
    sky: '#dce9f5', ground: '#f3f6fb', apron: '#e4ebf3', floorA: '#c99463', floorB: '#b78150', slab: '#7c5236', rim: '#553623',
    wall: '#8e5c3d', wallTint: '#ffffff', trim: '#cf4a3f', counter: '#8a5638', top: '#ede3d0', kick: '#4f2f1f', accent: '#cf4a3f', accent2: '#8fd2ef',
    hemiSky: '#f1f7ff', hemiGround: '#9aa9ba', sun: '#fff3e2', sunIntensity: 2.5, hemiIntensity: 1.35, pit: 'water', pitColor: '#5cabd0',
    props: ['prop_pine', 'prop_snowman', 'prop_logs', 'prop_pine', 'prop_rock', 'prop_lantern'],
  },
  canyon: {
    sky: '#f6cf9f', ground: '#d99a60', apron: '#e8b98a', floorA: '#e4a873', floorB: '#d2915c', slab: '#a3603a', rim: '#6f3c24',
    wall: '#eab784', wallTint: '#ffd8b8', trim: '#3f8a83', counter: '#3f8a83', top: '#f3e5c9', kick: '#285a55', accent: '#f0c14b', accent2: '#e0673f',
    hemiSky: '#fff0d8', hemiGround: '#b0714a', sun: '#ffe2b5', sunIntensity: 2.9, hemiIntensity: 1.15, pit: 'chasm', pitColor: '#4a2418',
    props: ['prop_cactus', 'prop_rock', 'prop_skull', 'prop_cactus', 'prop_barrel'],
  },
  market: {
    sky: '#35406a', ground: '#57597a', apron: '#6f6a84', floorA: '#d2c1a4', floorB: '#bfac8e', slab: '#6c5a4b', rim: '#463a31',
    wall: '#7a3f6b', wallTint: '#f1d2ff', trim: '#f2a93b', counter: '#8e3b6e', top: '#f1e4cb', kick: '#56203f', accent: '#ffb347', accent2: '#5fd0c1',
    hemiSky: '#c9c8ff', hemiGround: '#6a4f5a', sun: '#ffe0b8', sunIntensity: 2.2, hemiIntensity: 1.3, pit: 'chasm', pitColor: '#1f1a2e',
    props: ['prop_lantern', 'prop_stall', 'prop_basket', 'prop_crates', 'prop_plant'], night: true,
  },
  grand: {
    sky: '#3b2433', ground: '#6b2a3a', apron: '#8a2f3f', floorA: '#efe9df', floorB: '#4d5160', slab: '#2a2530', rim: '#d4a73a',
    wall: '#6e2d3d', wallTint: '#ffd2d8', trim: '#d4a73a', counter: '#26344a', top: '#ece6da', kick: '#151d2b', accent: '#d4a73a', accent2: '#e8e2d4',
    hemiSky: '#fff1e0', hemiGround: '#6a4450', sun: '#fff0d8', sunIntensity: 2.4, hemiIntensity: 1.3, pit: 'chasm', pitColor: '#140e14',
    props: ['prop_column', 'prop_plant', 'prop_rope', 'prop_topiary', 'prop_lamp'], night: true,
  },
};
export const paletteFor = (theme: Theme | undefined) => THEMES[theme ?? 'diner'] ?? THEMES.diner;
