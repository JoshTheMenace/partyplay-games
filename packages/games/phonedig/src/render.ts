/* Shared types for the drawing layer.
 *
 * The renderer was written against the single-player game's own state object.
 * It still is: rather than rewrite eight files to read a network projection,
 * the client assembles something state-SHAPED out of the snapshot and hands it
 * over. That keeps the drawing code recognisably the same as upstream, which
 * matters because it is the part most likely to need fixing against the
 * original when something looks wrong.
 */

import type {
  Dir, LaneNode, Particle, Popup,
} from './model';

export type Ctx = CanvasRenderingContext2D;

/** What view.resize() measures, and what every draw call is placed against. */
export type ViewBox = {
  /** Where the VIEWPORT starts on screen. Fixed; the chrome anchors to it. */
  vx: number;
  /** Where world x=0 and y=0 fall. The camera moves these. */
  ox: number; oy: number;
  /** CSS pixels per fine cell. */
  scale: number;
  /** The topmost fine row on screen. */
  top: number;
  dpr: number;
  /** Whole-number pixel scale; every cell is a rectangle. */
  k: number;
  cssW: number; cssH: number;
  visRows: number;
  /** Fine cells across the viewport — not across the shaft. */
  visCols: number;
  /** Seconds, for effects that shimmer. Injected so a screenshot can pin it. */
  t?: number;
};

/* A resolved palette: the CSS tokens, with the ground colours overridden by
 * whichever biome the shaft is currently cut through.
 *
 * Every field is a colour string except `dirt` (the five band colours, dark to
 * light) and `ambient`. The index signature is what lets the drawing layer look
 * an accent up by name; the named fields are what stop those lookups being
 * `unknown` at the call sites that actually exist. */
export type Palette = {
  /** The five strata band colours, shallow to deep. */
  dirt: string[];
  /** 0..1 — how much of the field is lit with no lamp. Set by the biome. */
  ambient: number;
  sky: string; cave: string; wall: string;
  player: string; playerAccent: string;
  pooka: string; pookaEye: string;
  fygar: string; fygarBelly: string;
  shark: string; sharkBelly: string;
  mole: string; moleDark: string; moleRim: string; moleNose: string;
  rock: string; rockShade: string;
  harpoon: string; fire: string; ore: string; air: string;
  text: string; danger: string; accent: string; border: string;
  [accent: string]: unknown;
};

/** What the entity layer is handed each frame: where the world sits on screen. */
export type EntityView = Pick<ViewBox, 'ox' | 'oy' | 'scale' | 'top'>;

/* ── what the drawing layer reads ─────────────────────────────────────────
 *
 * These are DELIBERATELY not the simulation's own Player/Monster/Rock types.
 * The renderer runs on a client, which has a projection of the world rather
 * than the world: no MonsterKind table, no lane graph, no pathing sets. Typing
 * the draw calls against the simulation would compile — the sim types are
 * supersets — and then fail at runtime the first time a client handed over a
 * snapshot, because the field it wanted was never sent.
 *
 * So the types below are exactly the fields the drawing code touches, and the
 * wire is obliged to carry every one of them. A field added to a draw call
 * turns into a compile error in the adapter, which is where it should be.
 *
 * `px`/`py` are the previous authoritative position. The client interpolates
 * before it draws, so its adapter sets them equal to x/y and the lerps inside
 * the renderer become no-ops; upstream they are the real thing. Both are
 * correct, and neither has to know which it is.
 */

export type ViewHarpoon = {
  active: boolean;
  dir: Dir;
  len: number;
  state: 'idle' | 'out' | 'hit' | 'back';
};

export type ViewPlayer = {
  id: number;
  x: number; y: number; px: number; py: number;
  dir: Dir;
  digging: boolean; moving: boolean;
  dying: boolean; dyingT: number;
  invuln: number;
  /** The cosmetic. Null until they have picked one; anim falls back. */
  suit: string | null;
  harpoon: ViewHarpoon;
  /** Lamp reach in fine cells. Each digger lights their own ground. */
  lightRadius: number;
  downed: boolean;
  /** Seconds left to reach them, and banked revive pumps as 0..1. The first
   *  times the going-down clip; the second IS the inflate clip's frame. */
  downT: number;
  reviveProgress: number;
};

export type ViewMonster = {
  id: number;
  kind: string;
  variant: string | null;
  /** A variant's body colour, for the procedural silhouettes only. */
  tint: string | null;
  x: number; y: number; px: number; py: number;
  dir: Dir;
  mode: string;
  hunting: boolean;
  /** Countdown on the hunter ring's arrival pulse. */
  markT: number;
  /** Pumps landed, and how many burst it — the swell is their ratio. */
  pump: number; stages: number;
  alpha: number;
  telegraph: number;
  dying: boolean;
};

export type ViewRock = {
  id: number;
  x: number; y: number; px: number; py: number;
  state: 'idle' | 'wobble' | 'falling' | 'breaking';
  t: number;
};

export type ViewFire = {
  x: number; y: number; w: number; h: number;
  dir: Dir;
  t: number;
  blast?: boolean;
  /** The mouth a jet grew from, and how far into that growth it is. */
  ox?: number; oy?: number; growT?: number;
  /** Monster id: whose breath this is, so its own clip knows it is breathing. */
  owner: number | null;
};

export type ViewWheel = {
  id: number;
  x: number; y: number; px: number; py: number;
  dir: Dir;
  /** Cells rolled, and the previous frame's, so the spin lerps with the slide. */
  travel: number; pTravel: number;
};

export type ViewBonus = { active: boolean; x: number; y: number; value: number };

/* The fields the drawing layer reads. A superset of what any one module wants,
 * because upstream passes the whole state around and so do we. */
export type RenderState = {
  phase: string;
  theme: string;
  levelSerial: number;
  /** Identity of the generated world, run and level together. A change is a cut. */
  worldKey: string;
  level: number;
  skyRows: number;
  shake: number;
  depth: number;
  deepest: number;

  dirt: Uint8Array;
  ore: Uint8Array;
  pocketHint: Uint8Array;
  dirtRev: number;
  rowRev: Int32Array;
  activeGW: number;
  activeLanes: number;

  lightRadius: number;
  air: number;
  airMax: number;
  relics: string[];

  /** The digger this screen belongs to, and the whole crew. */
  player: ViewPlayer;
  players: ViewPlayer[];
  monsters: ViewMonster[];
  rocks: ViewRock[];
  fire: ViewFire[];
  wheels: ViewWheel[];
  bonus: ViewBonus | null;
  pockets: LaneNode[];
  particles: Particle[];
  popups: Popup[];

  /* The two buried pickups, drawn on the floor where they lie. Null once taken
   * — the projection drops them rather than flagging them, so there is one
   * thing to test rather than two that can disagree.
   *
   * `relicSite.pool` is read at draw time so the disc shows the relic the
   * engine would actually hand over. See drawBuried. */
  relicSite: { x: number; y: number; pool: string[] } | null;
  crystalAt: (LaneNode & { id: string }) | null;
};
