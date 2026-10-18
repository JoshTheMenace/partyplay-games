/** World size in blocks along X and Z (coordinates 0..WORLD-1). */
export const WORLD = 4096;
/** World height in blocks (y 0..HEIGHT-1). Above is air, below is bedrock (air in the End). */
export const HEIGHT = 128;
/** Chunk edge length in blocks; chunks are full-height 16×16×128 columns. */
export const CHUNK = 16;
/** Chunks per world edge. */
export const CHUNKS = WORLD / CHUNK;
export const SEA_LEVEL = 62;
/** Worlds whose worldgen state (seeds, trees, structure plans) stays cached: the room hub runs up to 32 rooms at once. */
export const SEED_CACHE = 32;
/** Nominal world spawn column; the server searches outward for dry land. */
export const SPAWN_X = 2048;
export const SPAWN_Z = 2048;
/** The Nether: a sealed 512×512 corner region of the same world storage (x ∈ [3584, 4096), z ∈ [0, 512)). */
export const NETHER = { x0: 3584, z0: 0, size: 512 } as const;
/** True for columns inside the Nether region; "dimension" is always derived from position. */
export const inNether = (x: number, z: number) => x >= NETHER.x0 && x < NETHER.x0 + NETHER.size && z >= NETHER.z0 && z < NETHER.z0 + NETHER.size;
/** The End: another sealed corner (x, z ∈ [3584, 4096)), an island over the void. Below y = 0 is air here, not bedrock. */
export const END = { x0: 3584, z0: 3584, size: 512 } as const;
export const inEnd = (x: number, z: number) => x >= END.x0 && x < END.x0 + END.size && z >= END.z0 && z < END.z0 + END.size;
export type Dimension = 'overworld' | 'nether' | 'end';
export const dimensionAt = (x: number, z: number): Dimension => inNether(x, z) ? 'nether' : inEnd(x, z) ? 'end' : 'overworld';
/** Centre of the End's main island (the exit portal) and the player arrival platform's centre cell (floor at y 48). */
export const END_CENTER = { x: 3840, z: 3840 } as const;
export const END_ARRIVAL = { x: 3940, y: 48, z: 3840 } as const;
/** Bodies below this height are out of the world: players take void damage, everything else is removed. */
export const VOID_Y = -64;

/** Server simulation rate and day length (20 minutes). 0 sunrise, 6000 noon, 12000 sunset, 13000–23000 night. */
export const TICK_HZ = 20;
export const DAY_TICKS = 24000;
export const START_TICK = 1000;

/** Maximum distinct edited cells per world. */
export const EDIT_LIMIT = 16384;
export const EDIT_LIMIT_TOAST = 'This world has reached its building limit.';
/** Reach from the eye to the nearest point of a block or mob. */
export const REACH = { survival: 4.5, creative: 5 } as const;

export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
export const MAX_AIR = 300;
export const INVENTORY_SIZE = 36;
export const HOTBAR_SIZE = 9;
export const CHEST_SIZE = 27;
/** Maximum queued commands per input message. */
export const MAX_CMDS = 32;

/** Player physics (metres, seconds). */
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const SNEAK_HEIGHT = 1.5;
export const EYE_HEIGHT = 1.62;
export const SNEAK_EYE_HEIGHT = 1.27;
export const GRAVITY = 32;
export const JUMP_VELOCITY = 9;
export const TERMINAL_VELOCITY = 78;
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 5.6;
export const SNEAK_SPEED = 1.3;
export const SWIM_SPEED = 2;
export const FLY_SPEED = 10.9;
export const FLY_VERTICAL = 7.5;
export const LADDER_SPEED = 2.35;
/** Auto step-up height: slabs and half blocks only; full blocks need a jump. */
export const STEP_HEIGHT = 0.6;
/** Largest physics sub-step. */
export const MAX_SUBSTEP = 1 / 60;
