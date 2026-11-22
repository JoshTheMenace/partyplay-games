/** Round lifecycle: creating (or loading) a world, the 20 Hz tick, chunk streaming around players and presence. */
import type { RoundContext } from '../../../../party-contract/src/index';
import { B, cellId } from '../shared/blocks';
import { VoxelWorld, type ChunkSource } from '../shared/chunk';
import { DAY_TICKS, START_TICK } from '../shared/constants';
import { cellXYZ, chunkKey, type Vec3 } from '../shared/coords';
import { createRng } from '../shared/noise';
import { bodyCollides } from '../shared/physics';
import { returnToInventory, type Containers } from '../shared/inventory';
import { IF, MOB, MOB_TYPES, neutralInput, MS, terrainOf, type Input, type Settings } from '../shared/protocol';
import { reserveStructurePlans } from '../shared/structures/index';
import { findSpawn, generateChunk } from '../shared/worldgen';
import { newBlazeState } from './blaze';
import { cityRecord, hottestSeat, initCity, tickCity } from './city';
import { tickArrows } from './combat';
import { runCommands, updateHolds } from './commands';
import { closeScreen, tickFurnaces, validateScreens } from './containers';
import { ensureDragon, newDragonState } from './dragon';
import { newEndState, tickExitPortal, tickVoid } from './end';
import { newEyeState, tickEndPortalTravel } from './ender-eyes';
import { newEndermanState } from './enderman';
import { tickItems } from './entities';
import { FIRST_LIMIT, foldTail, measureJournal } from './journal';
import { newFireState, tickBurning, tickFireBlocks } from './fire';
import { tickGrowth, trackCane } from './growth';
import { newMob, populateChunk, tickMobs } from './mobs';
import { newNetherState, tickFireballs } from './nether-mobs';
import { newPearlState } from './pearls';
import { applyMovement, newPlayer, sleepTick, survivalTick, wake } from './players';
import { newPortalState, tickPortals } from './portals';
import { newRedstoneState, tickRedstone } from './redstone';
import type { ParsedSave, SaveSource } from './save';
import { activePlayers, isProtected, playerById, pruneFx, PROTECT_SECONDS, toast, type Player, type State } from './state';
import { newStructureState, onChunkGenerated, tickSpawners } from './structures';
import { newVillageState, restock } from './villagers';
import { blockChanged, indexCell, makeReader, standNear } from './world';

/**
 * Chunk cache size (64 KiB a chunk): every player's 7×7 streamed chunks with room to spare, so a room whose players
 * have all walked off in different directions never evicts terrain somebody is standing on.
 */
const chunkCapacity = (players: number) => Math.max(640, players * 56 + 128);
/** Chunks kept loaded around each player (mob spawning reaches 48 blocks) and the per-tick generation time budget (ms). */
const LOAD_RADIUS = 3, GENERATE_MS = 2;
/** A new city starts at 08:30, with the shops open and the streets busy. */
const CITY_START_TICK = 2500;
const CREATIVE_BREAKS_PER_SECOND = 5;

/** `source` and `spawn` override worldgen (tests use flat worlds). */
export type CreateOptions = { source?: ChunkSource; save?: ParsedSave; spawn?: Vec3 };

/** Seed 0 means a random world: derive the real seed (1..999999) from the round seed. */
const realSeed = (settings: Settings, ctx: RoundContext) => settings.seed || (ctx.seed >>> 0) % 999999 + 1;

export function createState(ctx: RoundContext, requested: Settings, options: CreateOptions = {}): State {
  const city = requested.mode === 'city';
  // The city keeps what you carry when you are knocked out, whatever the survival setting was.
  const settings = { ...requested, seed: realSeed(requested, ctx), ...city ? { keepInventory: true } : {} }, save = options.save, growables = new Set<number>();
  const terrain = terrainOf(settings.mode), generate = options.source ?? ((cx, cz) => generateChunk(settings.seed, cx, cz, terrain));
  // Worldgen sugar cane and spawners are not edits, so register them whenever their chunk is generated.
  const source: ChunkSource = (cx, cz) => {
    const cells = trackCane(growables, cx, cz, generate(cx, cz));
    onChunkGenerated(state, cx, cz, cells);
    return cells;
  };
  // Structure plans for everyone's surroundings at once (20 grid cells a player covers the 17 a player touches).
  reserveStructurePlans(ctx.players.length * 20);
  const world = new VoxelWorld(source, chunkCapacity(ctx.players.length));
  const state: State = {
    settings, world, worldId: save?.worldId ?? `${settings.seed}-${Math.floor(ctx.nowMs).toString(36)}`,
    get: makeReader(world, false), getLoaded: makeReader(world, true), rand: createRng((settings.seed * 7919 + ctx.seed) | 0),
    clock: 0, time: save?.time ?? (city ? CITY_START_TICK : START_TICK), day: save?.day ?? 0, revision: 1, editRev: 1, tailSince: 0, foldedAt: 0, measureAt: 0, focus: -1, focusUntil: 0, frame: null,
    players: [], mobs: [], items: [], arrows: [], fx: [], nextId: 0, fxId: 0,
    chests: save?.chests ?? new Map(), furnaces: save?.furnaces ?? new Map(), lights: new Map(), growables, animalChunks: save?.populated ?? new Set(),
    spawn: [0, 0, 0], stats: save?.stats ?? { mined: 0, placed: 0, crafted: 0, mobs: 0, deaths: 0, days: 0, dragons: 0 }, finished: false, ticks: 0,
    pathBudget: 0, editsCache: { revision: 0, list: [] }, source, absent: [],
    structures: newStructureState(), portals: newPortalState(), fire: newFireState(), nether: newNetherState(), redstone: newRedstoneState(), villages: newVillageState(),
    blaze: newBlazeState(), eyes: newEyeState(), dragon: newDragonState(), endermen: newEndermanState(), pearls: newPearlState(),
    end: newEndState(save?.end, save?.victory), pearlPity: save?.pearlPity ?? 0, city: null,
  };
  // Chunk by chunk, so each generates once however many edits it holds (the saved y-first order thrashes the cache).
  const chunkOf = (index: number) => { const [x, , z] = cellXYZ(index); return chunkKey(x >> 4, z >> 4); };
  if (save) for (const [index, value] of [...save.edits].sort(([a], [b]) => chunkOf(a) - chunkOf(b))) {
    world.edits.set(index, value);
    const [x, y, z] = cellXYZ(index);
    indexCell(state, index, x, z, value);
    blockChanged(state, x, y, z, world.generated(x, y, z), value);
  }
  // A loaded journal is measured at once; a new world gets the allowance every journal fits.
  world.limit = FIRST_LIMIT;
  if (save) measureJournal(state);
  // Saved containers on unedited cells belong to worldgen chests and furnaces; drop any the terrain no longer has.
  const holds = (index: number, ...blocks: number[]) => blocks.includes(cellId(state.get(...cellXYZ(index))));
  for (const index of state.chests.keys()) if (!holds(index, B.chest)) state.chests.delete(index);
  for (const index of state.furnaces.keys()) if (!holds(index, B.furnace, B.furnace_lit)) state.furnaces.delete(index);
  // The shared worldgen search (the same one the scene preloads), settled onto the real, possibly edited, ground.
  const [spawnX, spawnY, spawnZ] = options.spawn ?? findSpawn(settings.seed, terrain);
  state.spawn = standNear(state, [spawnX + 0.5, spawnY, spawnZ + 0.5]);
  const names = new Map<string, number>(), matched = new Set<string>();
  for (const p of ctx.players) names.set(p.name, (names.get(p.name) ?? 0) + 1);
  ctx.players.forEach((p, i) => {
    const player = Object.assign(newPlayer(p.id, p.name, p.color, standNear(state, state.spawn, i)), { seat: i });
    // Saved players match by exact, unique name.
    const saved = names.get(p.name) === 1 ? save?.players.filter(s => s.name === p.name) : undefined;
    if (saved?.length === 1) {
      matched.add(p.name);
      const s = saved[0]!, fits = s.y >= 0 && !bodyCollides(state.get, { x: s.x, y: s.y, z: s.z, sneaking: false }, 0.05);
      Object.assign(player, { yaw: s.yaw, pitch: s.pitch, health: s.health, food: s.food, saturation: s.saturation, inv: s.inv, armor: s.armor, bed: s.bed, stats: s.stats, milestones: s.milestones });
      if (fits) Object.assign(player, { x: s.x, y: s.y, z: s.z, fallPeak: s.y, supportY: s.y, tp: { n: 1, x: s.x, y: s.y, z: s.z } });
    }
    state.players.push(player);
  });
  state.absent = save?.players.filter(saved => !matched.has(saved.name)) ?? [];
  if (city) initCity(state, state.players.map(player => matched.has(player.name) ? save?.players.find(saved => saved.name === player.name)?.city : undefined));
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
  settings: state.settings, worldId: state.worldId, time: state.time, day: state.day, edits: state.world.edits,
  players: [...state.players.map(withHeld).map(player => state.city ? { ...player, city: cityRecord(state, player) } : player), ...state.absent],
  chests: state.chests, furnaces: state.furnaces, populated: state.animalChunks, stats: state.stats, end: state.end, victory: state.end.victory, pearlPity: state.pearlPity,
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
  // Ring by ring across everyone: the chunk each player stands in comes before anybody's far ring, so the budget never
  // leaves a player's own ground to be generated in the middle of a tick.
  for (let r = 0; r <= LOAD_RADIUS; r++) for (const player of state.players) {
    if (!player.connected) continue;
    const pcx = Math.floor(player.x) >> 4, pcz = Math.floor(player.z) >> 4;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const cx = pcx + dx, cz = pcz + dz;
      if (cx < 0 || cz < 0 || cx >= 256 || cz >= 256) continue;
      const loaded = cache.has(cx, cz);
      if (!loaded && r > 0 && generated > 0 && performance.now() - start > GENERATE_MS) continue;
      if (!loaded || refresh) cache.get(cx, cz);
      if (!loaded) generated++;
      if (!state.city && !state.animalChunks.has(chunkKey(cx, cz)) && r >= 1) populateChunk(state, cx, cz);
    }
  }
}

/** Seconds the watching display stays with one player. */
const FOCUS_SECONDS = 18;
/**
 * The player the watching display follows. It moves on every FOCUS_SECONDS, or at once when its player leaves or dies,
 * to the next seat that has done something lately (swung, been hurt, walked), so the TV is drawn to the action.
 */
function pickFocus(state: State) {
  const players = state.players, current = players[state.focus], ok = (player?: Player) => !!player && player.connected && !player.dead;
  // In the city the camera goes to whoever the Watch wants most.
  const hot = state.city ? hottestSeat(state) : -1;
  if (hot >= 0 && hot !== state.focus) { state.focus = hot; state.focusUntil = state.clock + FOCUS_SECONDS; return; }
  if (ok(current) && state.clock < state.focusUntil) return;
  const busy = (player: Player) => state.clock - Math.max(player.swingAt, player.movedAt) < 6;
  let next = -1;
  for (let k = 1; k <= players.length && next < 0; k++) { const seat = (Math.max(0, state.focus) + k) % players.length; if (ok(players[seat]) && busy(players[seat]!)) next = seat; }
  for (let k = 1; k <= players.length && next < 0; k++) { const seat = (Math.max(0, state.focus) + k) % players.length; if (ok(players[seat])) next = seat; }
  state.focus = next;
  state.focusUntil = state.clock + FOCUS_SECONDS;
}

/** Evening warnings, each day: [day tick, text, shown in peaceful]. */
const WARNINGS: readonly [number, string, boolean][] = [
  [11500, 'The sun is setting — find or build shelter', true],
  [13000, 'Night falls. Monsters roam in the dark.', false],
];

/**
 * One 20 Hz tick: time, players (movement, commands, survival), sleep, screens, then the world in a fixed order:
 * redstone → portals (nether, End entry, End exit) → burning → fire blocks → spawners → dragon → mobs → fireballs →
 * arrows (and the other projectiles) → items → void → furnaces → growth.
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
    player.bagAck = input.bag ?? 0;
    player.parkedAsk = (input.f & IF.PARKED) !== 0;
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
  if (state.city) {
    // The city has its own inhabitants and no monsters, portals or redstone: its tick, then what lies on the ground.
    tickCity(state, dt);
    tickItems(state, dt);
    tickGrowth(state);
    foldTail(state);
    pickFocus(state);
    return;
  }
  tickRedstone(state, dt);
  tickPortals(state, dt);
  tickEndPortalTravel(state, dt);
  tickExitPortal(state, dt);
  tickBurning(state, dt);
  tickFireBlocks(state, dt);
  tickSpawners(state, dt);
  ensureDragon(state);
  tickMobs(state, dt);
  tickFireballs(state, dt);
  tickArrows(state, dt);
  tickItems(state, dt);
  tickVoid(state, dt);
  tickFurnaces(state, dt);
  tickGrowth(state);
  foldTail(state);
  pickFocus(state);
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
