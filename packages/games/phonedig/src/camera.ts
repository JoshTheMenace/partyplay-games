/* The camera, on both axes now.
 *
 * Lives entirely on the view side and NEVER feeds back into the simulation.
 * engine.ts does not know the viewport exists — see the header there for the
 * four temptations that would break that, all of which start here.
 *
 * The field is 160 fine rows deep and about 45 of them fit on a phone, so the
 * vertical axis is what turns a board you survey into a shaft you descend. The
 * horizontal axis is newer and exists for the same reason in the other
 * direction: the shaft widens with the crew, up to seventy-three lanes, while a
 * screen still shows twenty cells across.
 *
 * A FACTORY rather than a module singleton, because several diggers each want
 * their own view of the same shaft and module state would give them one.
 */

import { GRID } from './worldgen';

/* Where the digger sits in the visible band, as a fraction from the top.
 *
 * Not centred: you are almost always going DOWN, and the thing you need to see
 * is the ground you are about to cut, not the tunnel you just left. Climbing
 * flips it, because then the interesting direction is up. */
const LOOK_DOWN = 0.40;
const LOOK_UP = 0.55;

/* Exponential smoothing rate. At 8, the camera covers ~63% of the remaining
 * gap every 125 ms — quick enough not to lag a sprint down a clear shaft, slow
 * enough that a knockback does not snap. */
const K = 8;

/* Fine cells of slack around the target before the camera moves at all.
 * Without it, a digger oscillating either side of a lane boundary shivers the
 * entire world. Wider sideways: crossing a lane boundary while cutting downward
 * is constant, and it must not rock the shaft left and right. */
const DEAD_Y = 2;
const DEAD_X = 3;

export type Camera = ReturnType<typeof create>;

export function create() {
  let camX = 0, camY = 0;
  let serial = -1;
  let lastWorld: string | null = null;
  let lastDir = 1;

  function follow(
    state: { levelSerial: number; activeGW: number; worldKey: string },
    playerX: number, playerY: number,
    visCols: number, visRows: number,
    dt: number, snapUnit: number,
  ) {
    const maxY = Math.max(0, GRID.GH - visRows);
    const maxX = Math.max(0, state.activeGW - visCols);

    /* A new level is a cut, not a pan. Without this the camera lerps the whole
     * shaft and you watch a two-second elevator ride into the next chamber.
     *
     * The WORLD KEY is checked as well as the serial, and it has to be:
     * levelSerial counts from zero inside one state, so a brand-new run is also
     * serial 1, and keying on the number alone parks the camera where the last
     * run ended. It is a key rather than the state's identity because the party
     * adapter builds a fresh state object every frame, which cut every frame. */
    if (state.worldKey !== lastWorld || state.levelSerial !== serial) {
      lastWorld = state.worldKey;
      serial = state.levelSerial;
      lastDir = 1;
      camY = clamp(playerY - visRows * LOOK_DOWN, 0, maxY);
      camX = clamp(playerX + 1 - visCols / 2, 0, maxX);
      return snapped(snapUnit);
    }

    const dir = playerY > camY + visRows * 0.5 ? 1
      : playerY < camY + visRows * 0.4 ? -1 : lastDir;
    lastDir = dir;
    const look = dir >= 0 ? LOOK_DOWN : LOOK_UP;

    let targetY = clamp(playerY - visRows * look, 0, maxY);
    if (Math.abs(targetY - camY) < DEAD_Y) targetY = camY;

    /* Centred sideways, with no look-ahead. Down is the direction of travel and
     * the vertical bias earns its keep; sideways you are as likely to turn back
     * as go on, and a lead bias would swing the world on every turn. */
    let targetX = clamp(playerX + 1 - visCols / 2, 0, maxX);
    if (Math.abs(targetX - camX) < DEAD_X) targetX = camX;

    // Frame-rate independent exponential approach. dt here is REAL elapsed
    // time, not the fixed simulation step — the camera is presentation.
    const k = 1 - Math.exp(-K * Math.max(0, dt));
    camY = clamp(camY + (targetY - camY) * k, 0, maxY);
    camX = clamp(camX + (targetX - camX) * k, 0, maxX);
    return snapped(snapUnit);
  }

  /* Quantised to one device pixel in world cells, because every hard dirt edge
   * in the game is a rectangle and a camera on a fractional pixel makes all of
   * them crawl. It shows worse sideways than vertically: the strata are
   * horizontal bands, so a sub-pixel horizontal pan shimmers every one of them
   * at once. Same reason view.resize() snaps the cell size and the origin. */
  const snapped = (unit: number) => ({
    x: quantise(camX, unit),
    y: quantise(camY, unit),
  });

  return {
    follow,
    reset(x = 0, y = 0) { camX = x; camY = y; serial = -1; lastWorld = null; },
    /** Where the camera is right now, unquantised. For off-screen indicators. */
    at() { return { x: camX, y: camY }; },
  };
}

function quantise(v: number, unit: number) {
  return unit > 0 ? Math.round(v / unit) * unit : v;
}

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
