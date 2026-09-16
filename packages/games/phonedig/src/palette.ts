import type { Palette } from './render';

/* The colour tokens, read off the document once.
 *
 * Its own module rather than a corner of view.ts because entities.ts needs the
 * DOM-free fallback: it is imported by the bestiary as well as by the field
 * renderer, and it must have a palette before anything has called setView().
 *
 * The palette itself lives in tokens.css, so that file stays the single place
 * this app is themed — canvas included. Read once; getComputedStyle is not
 * cheap and these never change at runtime.
 *
 * The custom property name and the fallback live together in one table so the
 * DOM-free default and the DOM-read palette can never drift apart. That default
 * is what P holds between module load and init(): the renderer must be
 * constructible without touching the document, because on the platform this
 * module is imported long before any canvas exists. */
const TOKENS = {
  sky: ['--sky', '#1d3a5c'],
  cave: ['--cave', '#0d0805'],
  wall: ['--wall', '#1a1008'],
  player: ['--player', '#f5f0e6'],
  playerAccent: ['--player-accent', '#e07a2f'],
  pooka: ['--pooka', '#ff6b4a'],
  pookaEye: ['--pooka-eye', '#f5ece0'],
  fygar: ['--fygar', '#46c85a'],
  fygarBelly: ['--fygar-belly', '#d8f0a0'],
  shark: ['--shark', '#6f8fa8'],
  sharkBelly: ['--shark-belly', '#cfe0e8'],
  mole: ['--mole', '#a37a56'],
  moleDark: ['--mole-dark', '#6b4e39'],
  moleRim: ['--mole-rim', '#c9a077'],
  moleNose: ['--mole-nose', '#e0a89a'],
  rock: ['--rock', '#8d8a86'],
  rockShade: ['--rock-shade', '#55524e'],
  harpoon: ['--harpoon', '#ffd88a'],
  fire: ['--fire', '#ff8c2b'],
  ore: ['--ore', '#7fe3ff'],
  air: ['--air', '#8fd4ff'],
  text: ['--color-text', '#f5ece0'],
  danger: ['--color-danger', '#ff5470'],
  accent: ['--color-accent-blue', '#e07a2f'],
  border: ['--color-border', '#3a2418'],
} as const satisfies Record<string, readonly [string, string]>;

const DIRT_TOKENS = [
  ['--dirt-1', '#9c6531'], ['--dirt-2', '#7a4b23'], ['--dirt-3', '#5c3619'],
  ['--dirt-4', '#412510'], ['--dirt-5', '#2a1a3a'],
] as const satisfies readonly (readonly [string, string])[];

/* 0.55 is topsoil's, and topsoil is what level 1 is cut through. Every real
 * palette overwrites this from the biome — see paletteFor. */
const BASE_AMBIENT = 0.55;

export function buildPalette(pick: (name: string, fallback: string) => string): Palette {
  const out: Record<string, unknown> = {
    dirt: DIRT_TOKENS.map(([name, fallback]) => pick(name, fallback)),
    ambient: BASE_AMBIENT,
  };
  for (const [key, [name, fallback]] of Object.entries(TOKENS)) {
    out[key] = pick(name, fallback);
  }
  return out as Palette;
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  return buildPalette((name, fallback) => cs.getPropertyValue(name).trim() || fallback);
}


/* The authored colours, with no document involved. What every consumer holds
 * until init() reads the real ones — and, for the bestiary, all it ever holds. */
export const FALLBACK_PALETTE: Palette = buildPalette((_name, fallback) => fallback);
