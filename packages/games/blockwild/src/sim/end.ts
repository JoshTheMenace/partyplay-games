/**
 * The End on the server: the void, arriving on the obsidian platform, the exit portal home and the victory.
 * `state.end` holds the saved progress (save v10 `end` + `victory`); the fight itself lives in dragon.ts.
 */
import { B, cellId } from '../shared/blocks';
import { END_ARRIVAL, END_CENTER, inEnd, VOID_Y } from '../shared/constants';
import { EXIT_PORTAL, EXIT_Y, PERCH_Y } from '../shared/end';
import { bodyBox, regionTouches } from '../shared/physics';
import { MOB_TYPES, type Victory } from '../shared/protocol';
import { damagePlayer } from './combat';
import { respawnPoint, teleport } from './players';
import { freshEnd, type SavedEnd } from './save';
import { addFx, toast, type Player, type State } from './state';
import { writeCell, writeCells } from './world';

/** The End's progress, saved; the dragon's exact position is not (it resumes circling). */
export type EndState = SavedEnd & { victory: Victory | null };
export const newEndState = (saved = freshEnd(), victory: Victory | null = null): EndState => ({ ...saved, crystals: [...saved.crystals], victory });

/** Seconds of protection after arriving on the platform. */
export const ARRIVAL_PROTECTION = 3;
const VOID_DAMAGE = 4;

/**
 * Every tick: players below VOID_Y take 4 damage every 0.5 s (cause 'void': no armor, no protection; creative is immune);
 * mobs (but never the boss), items and projectiles down there are removed.
 */
export function tickVoid(state: State, _dt: number): void {
  if (state.ticks % 10 === 0) for (const player of state.players) {
    if (player.y < VOID_Y) damagePlayer(state, player, VOID_DAMAGE, 'fell out of the world', undefined, 'void');
  }
  for (const mob of state.mobs) if (mob.y < VOID_Y && MOB_TYPES[mob.t]!.kind !== 'boss') mob.health = 0;
  if (state.items.some(item => item.y < VOID_Y)) state.items = state.items.filter(item => item.y >= VOID_Y);
  for (const arrow of state.arrows) if (arrow.y < VOID_Y) arrow.age = Infinity;
}

/** The platform cells: 5×5 obsidian at END_ARRIVAL.y with 3 air above (the same cells generateEndChunk makes). */
function platformWrites(): [number, number, number, number][] {
  const writes: [number, number, number, number][] = [];
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 3; dy++) {
    writes.push([END_ARRIVAL.x + dx, END_ARRIVAL.y + dy, END_ARRIVAL.z + dz, dy ? B.air : B.obsidian]);
  }
  return writes;
}

/**
 * A player stepped into an end portal outside the End: rebuild the arrival platform and move them onto it, facing the
 * island centre (west), with a short protection. At the edit limit the generated platform still stands unless dug away.
 */
export function arriveInEnd(state: State, player: Player): void {
  writeCells(state, platformWrites());
  addFx(state, 'travel', player.x, player.y + 1, player.z);
  teleport(state, player, END_ARRIVAL.x + 0.5, END_ARRIVAL.y + 1, END_ARRIVAL.z + 0.5, Math.PI / 2);
  Object.assign(player, { portal: 0, mine: null, protectedUntil: Math.max(player.protectedUntil, state.clock + ARRIVAL_PROTECTION) });
  addFx(state, 'travel', player.x, player.y + 1, player.z);
  toast(player, 'Entering the End… climb the stairs and defeat the Ender Dragon.');
}

const isEndPortal = (cell: number) => cellId(cell) === B.end_portal;
/** Every tick: players touching an end portal inside the End (the exit portal, open once the dragon dies) go home. */
export function tickExitPortal(state: State, _dt: number): void {
  for (const player of state.players) {
    if (!player.connected || player.dead || !inEnd(player.x, player.z) || !regionTouches(state.get, ...bodyBox(player), isEndPortal)) continue;
    addFx(state, 'travel', player.x, player.y + 1, player.z);
    const [x, y, z] = respawnPoint(state, player);
    teleport(state, player, x, y, z);
    Object.assign(player, { portal: 0, portalLock: true, mine: null, protectedUntil: Math.max(player.protectedUntil, state.clock + ARRIVAL_PROTECTION) });
    addFx(state, 'travel', x, y + 1, z);
    toast(player, 'Returning home…');
  }
}

/**
 * The dragon's death sequence ended: open the exit portal (end_portal fills the bowl), put the dragon egg on the pillar
 * (the first time only), count the kill, record the victory once (`by`, or everyone in the End when nobody hit it lately)
 * and tell everyone.
 */
export function dragonSlain(state: State, by: readonly string[]): void {
  const { x, z } = END_CENTER, end = state.end;
  Object.assign(end, { dragon: 'dead', health: 0 });
  openExitPortal(state);
  if (!end.egg && writeCell(state, x, PERCH_Y, z, B.dragon_egg)) end.egg = true;
  state.stats.dragons++;
  if (!end.victory) {
    const names = by.length ? [...by] : state.players.filter(p => p.connected && inEnd(p.x, p.z)).map(p => p.name);
    end.victory = { day: state.day, tick: Math.floor(state.time), by: names };
  }
  addFx(state, 'portalOpen', x + 0.5, EXIT_Y + 0.5, z + 0.5);
  for (const player of state.players) toast(player, 'The Ender Dragon has been defeated! The exit portal is open.');
}

/** Fill the fountain bowl with end portal; `portalActive` records whether it worked (ensureDragon retries at the edit limit). */
export function openExitPortal(state: State): void {
  const { x, z } = END_CENTER;
  state.end.portalActive = writeCells(state, EXIT_PORTAL.map(([dx, dz]) => [x + dx, EXIT_Y, z + dz, B.end_portal] as const));
}

/** The public view's `victory` (omitted until the dragon first dies). */
export function victoryView(state: State): Victory | undefined {
  return state.end.victory ?? undefined;
}
