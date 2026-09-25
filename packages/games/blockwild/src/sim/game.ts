/** Round lifecycle: creating (or loading) a world, the 20 Hz tick, chunk streaming around players and presence. */
import type { RoundContext } from '../../../../party-contract/src/index';
import { B, cellId } from '../shared/blocks';
import { VoxelWorld, type ChunkSource } from '../shared/chunk';
import { DAY_TICKS, START_TICK } from '../shared/constants';
import { cellXYZ, chunkKey, type Vec3 } from '../shared/coords';
import { createRng } from '../shared/noise';
import { bodyCollides } from '../shared/physics';
import { returnToInventory, type Containers } from '../shared/inventory';
import { IF, MOB, MOB_TYPES, neutralInput, MS, type Input, type Settings } from '../shared/protocol';
import { findSpawn, generateChunk } from '../shared/worldgen';
import { tickArrows } from './combat';
import { runCommands, updateHolds } from './commands';
import { closeScreen, tickFurnaces, validateScreens } from './containers';
import { tickItems } from './entities';
import { newFireState, tickBurning, tickFireBlocks } from './fire';
import { tickGrowth, trackCane } from './growth';
import { newMob, populateChunk, tickMobs } from './mobs';
import { newNetherState, tickFireballs } from './nether-mobs';
import { applyMovement, newPlayer, sleepTick, survivalTick, wake } from './players';
import { newPortalState, tickPortals } from './portals';
import { newRedstoneState, tickRedstone } from './redstone';
import type { ParsedSave, SaveSource } from './save';
import { activePlayers, isProtected, playerById, pruneFx, PROTECT_SECONDS, toast, type Player, type State } from './state';
import { newStructureState, onChunkGenerated, tickSpawners } from './structures';
import { newVillageState, restock } from './villagers';
import { blockChanged, indexCell, makeReader, standNear } from './world';

/** Chunk cache size: 10 players × 7×7 streamed chunks fit with room to spare (64 KiB each). */
const CHUNK_CAPACITY = 640;
/** Chunks kept loaded around each player (mob spawning reaches 48 blocks) and the per-tick generation time budget (ms). */
const LOAD_RADIUS = 3, GENERATE_MS = 2;
const CREATIVE_BREAKS_PER_SECOND = 5;

/** `source` and `spawn` override worldgen (tests use flat worlds). */
export type CreateOptions = { source?: ChunkSource; save?: ParsedSave; spawn?: Vec3 };

/** Seed 0 means a random world: derive the real seed (1..999999) from the round seed. */
const realSeed = (settings: Settings, ctx: RoundContext) => settings.seed || (ctx.seed >>> 0) % 999999 + 1;

export function createState(ctx: RoundContext, requested: Settings, options: CreateOptions = {}): State {
  const settings = { ...requested, seed: realSeed(requested, ctx) }, save = options.save, growables = new Set<number>();
  const generate = options.source ?? ((cx, cz) => generateChunk(settings.seed, cx, cz));
  // Worldgen sugar cane and spawners are not edits, so register them whenever their chunk is generated.
  const source: ChunkSource = (cx, cz) => {
    const cells = trackCane(growables, cx, cz, generate(cx, cz));
    onChunkGenerated(state, cx, cz, cells);
    return cells;
  };
  const world = new VoxelWorld(source, CHUNK_CAPACITY);
  const state: State = {
    settings, world, worldId: save?.worldId ?? `${settings.seed}-${Math.floor(ctx.nowMs).toString(36)}`,
    get: makeReader(world, false), getLoaded: makeReader(world, true), rand: createRng((settings.seed * 7919 + ctx.seed) | 0),
    clock: 0, time: save?.time ?? START_TICK, day: save?.day ?? 0, revision: 1, players: [], mobs: [], items: [], arrows: [], fx: [], nextId: 0, fxId: 0,
    chests: save?.chests ?? new Map(), furnaces: save?.furnaces ?? new Map(), lights: new Map(), growables, animalChunks: save?.populated ?? new Set(),
    spawn: [0, 0, 0], stats: save?.stats ?? { mined: 0, placed: 0, crafted: 0, mobs: 0, deaths: 0, days: 0 }, finished: false, ticks: 0,
    pathBudget: 0, editsCache: { revision: 0, list: [] }, source, absent: [],
    structures: newStructureState(), portals: newPortalState(), fire: newFireState(), nether: newNetherState(), redstone: newRedstoneState(), villages: newVillageState(),
  };
  // Chunk by chunk, so each generates once however many edits it holds (the saved y-first order thrashes the cache).
  const chunkOf = (index: number) => { const [x, , z] = cellXYZ(index); return chunkKey(x >> 4, z >> 4); };
  if (save) for (const [index, value] of [...save.edits].sort(([a], [b]) => chunkOf(a) - chunkOf(b))) {
    world.edits.set(index, value);
    const [x, y, z] = cellXYZ(index);
    indexCell(state, index, x, z, value);
    blockChanged(state, x, y, z, world.generated(x, y, z), value);
  }
  // Saved containers on unedited cells belong to worldgen chests and furnaces; drop any the terrain no longer has.
  const holds = (index: number, ...blocks: number[]) => blocks.includes(cellId(state.get(...cellXYZ(index))));
  for (const index of state.chests.keys()) if (!holds(index, B.chest)) state.chests.delete(index);
  for (const index of state.furnaces.keys()) if (!holds(index, B.furnace, B.furnace_lit)) state.furnaces.delete(index);
  // The shared worldgen search (the same one the scene preloads), settled onto the real, possibly edited, ground.
  const [spawnX, spawnY, spawnZ] = options.spawn ?? findSpawn(settings.seed);
  state.spawn = standNear(state, [spawnX + 0.5, spawnY, spawnZ + 0.5]);
  const names = new Map<string, number>(), matched = new Set<string>();
  for (const p of ctx.players) names.set(p.name, (names.get(p.name) ?? 0) + 1);
  ctx.players.forEach((p, i) => {
    const player = newPlayer(p.id, p.name, p.color, standNear(state, state.spawn, i));
    // Saved players match by exact, unique name.
    const saved = names.get(p.name) === 1 ? save?.players.filter(s => s.name === p.name) : undefined;
    if (saved?.length === 1) {
      matched.add(p.name);
      const s = saved[0]!, fits = !bodyCollides(state.get, { x: s.x, y: s.y, z: s.z, sneaking: false }, 0.05);
      Object.assign(player, { yaw: s.yaw, pitch: s.pitch, health: s.health, food: s.food, saturation: s.saturation, inv: s.inv, armor: s.armor, bed: s.bed, stats: s.stats, milestones: s.milestones });
      if (fits) Object.assign(player, { x: s.x, y: s.y, z: s.z, fallPeak: s.y, supportY: s.y, tp: { n: 1, x: s.x, y: s.y, z: s.z } });
    }
    state.players.push(player);
  });
  state.absent = save?.players.filter(saved => !matched.has(saved.name)) ?? [];
  for (const a of save?.animals ?? []) {
    const mob = newMob(state, a.t, a.x, a.y, a.z, (a.s & MS.BABY) !== 0);
    mob.sheared = (a.s & MS.SHEARED) !== 0;
    state.mobs.push(mob);
  }
  for (const v of save?.villagers ?? []) state.mobs.push(Object.assign(newMob(state, MOB.villager, v.x, v.y, v.z), { p: v.p, home: v.home, uses: [...v.uses], seed: v.seed }));
  return state;
}

/** A player as saved: the stacks on their cursor and crafting grid fold into a copy of the inventory (live state is untouched). */
function withHeld(player: Player): Player {
  const held: Containers = { inv: player.inv.map(slot => slot && { ...slot }), cursor: player.cursor, grid: [...player.grid], out: null, screen: null, screenKind: null };
  returnToInventory(held);
  return { ...player, inv: held.inv };
}

/** What the save module needs from the live state. */
export const saveSource = (state: State): SaveSource => ({
  settings: state.settings, worldId: state.worldId, time: state.time, day: state.day, edits: state.world.edits, players: [...state.players.map(withHeld), ...state.absent],
  chests: state.chests, furnaces: state.furnaces, populated: state.animalChunks, stats: state.stats,
  animals: state.mobs.filter(mob => MOB_TYPES[mob.t]!.kind === 'animal' && mob.health > 0).map(mob => ({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: (mob.sheared ? MS.SHEARED : 0) | (mob.baby > 0 ? MS.BABY : 0) })),
  villagers: state.mobs.filter(mob => mob.t === MOB.villager && mob.health > 0).map(mob => ({ x: mob.x, y: mob.y, z: mob.z, p: mob.p, home: mob.home, uses: mob.uses, seed: mob.seed })),
});

/**
 * Keep chunks around connected players cached (refreshing their LRU slot) and generate missing ones nearest-first:
 * at least one per tick, more only within GENERATE_MS, so new terrain never stalls the tick. New chunks roll their animals.
 */
function streamChunks(state: State) {
  const cache = state.world.cache, refresh = state.ticks % 20 === 0, start = performance.now();
  let generated = 0;
  for (const player of state.players) {
    if (!player.connected) continue;
    const pcx = Math.floor(player.x) >> 4, pcz = Math.floor(player.z) >> 4;
    for (let r = 0; r <= LOAD_RADIUS; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const cx = pcx + dx, cz = pcz + dz;
      if (cx < 0 || cz < 0 || cx >= 256 || cz >= 256) continue;
      const loaded = cache.has(cx, cz);
      if (!loaded && generated > 0 && performance.now() - start > GENERATE_MS) continue;
      if (!loaded || refresh) cache.get(cx, cz);
      if (!loaded) generated++;
      if (!state.animalChunks.has(chunkKey(cx, cz)) && r >= 1) populateChunk(state, cx, cz);
    }
  }
}

/** Evening warnings, each day: [day tick, text, shown in peaceful]. */
const WARNINGS: readonly [number, string, boolean][] = [
  [11500, 'The sun is setting — find or build shelter', true],
  [13000, 'Night falls. Monsters roam in the dark.', false],
];

/**
 * One 20 Hz tick: time, players (movement, commands, survival), sleep, screens, then the world in a fixed order:
 * redstone → portals → burning → fire blocks → spawners → mobs → fireballs → arrows → items → furnaces → growth.
 */
export function tickState(state: State, inputs: ReadonlyMap<string, Input>, dt: number) {
  state.clock += dt;
  state.ticks++;
  const before = state.time, day = state.day;
  state.time += dt * 20;
  for (const [at, text, peaceful] of WARNINGS) {
    if (before >= at || state.time < at || state.settings.mode !== 'survival' || !peaceful && state.settings.difficulty === 'peaceful') continue;
    for (const player of activePlayers(state)) toast(player, text);
  }
  if (state.time >= DAY_TICKS) {
    state.time -= DAY_TICKS;
    state.day++;
    state.stats.days = state.day;
  }
  pruneFx(state);
  streamChunks(state);
  for (const player of state.players) {
    if (!player.connected) continue;
    const input = inputs.get(player.id) ?? neutralInput();
    // A client still loading its world sends no position; keep its spawn protection from running out meanwhile.
    if (inputs.has(player.id) && input.f & IF.NO_POS && !player.dead && isProtected(state, player)) player.protectedUntil = state.clock + PROTECT_SECONDS;
    applyMovement(state, player, input);
    runCommands(state, player, input);
    updateHolds(state, player, input);
    player.breakTokens = Math.min(CREATIVE_BREAKS_PER_SECOND, player.breakTokens + dt * CREATIVE_BREAKS_PER_SECOND);
    survivalTick(state, player, dt);
  }
  sleepTick(state);
  if (state.day !== day) restock(state);
  validateScreens(state);
  tickRedstone(state, dt);
  tickPortals(state, dt);
  tickBurning(state, dt);
  tickFireBlocks(state, dt);
  tickSpawners(state, dt);
  tickMobs(state, dt);
  tickFireballs(state, dt);
  tickArrows(state, dt);
  tickItems(state, dt);
  tickFurnaces(state, dt);
  tickGrowth(state);
}

/** Disconnected players freeze in place, stay invulnerable and are ignored by mobs; screens close and beds release. */
export function setPresence(state: State, playerId: string, connected: boolean) {
  const player = playerById(state, playerId);
  if (!player || player.connected === connected) return;
  if (!connected) {
    wake(state, player);
    closeScreen(state, player);
    player.mine = null;
    player.useStart = -1;
  }
  player.connected = connected;
  if (connected) player.protectedUntil = state.clock + PROTECT_SECONDS;
  // Positions resume from where the player froze; the envelope restarts so the first move after rejoining is fair.
  player.movedAt = state.clock;
}
