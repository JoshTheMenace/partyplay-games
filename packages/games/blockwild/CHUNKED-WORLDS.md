# Chunk-streamed worlds

New worlds use generator version 7: 4,096 × 4,096 × 48 blocks, with horizontal coordinates −2,048 through 2,047. Terrain, caves, grassy areas, sand, snowy hills, trees and wild crops are generated from seed plus absolute coordinates. Returning to an unmodified area regenerates the same terrain. Diamonds occur at Y=1–5 only where every terrain column within four horizontal blocks provides at least ten blocks of cover. Underground height remains deliberately smaller than Minecraft's.

## Runtime

`chunk-world.ts` replaces the whole-world array with 16×16×48 byte chunks. Each grid caches at most 128 chunks (1.5 MiB of voxel bytes), with sparse edits stored separately. The server keeps independent base and edited grids, each bounded; collision generates missing terrain synchronously, so unloaded regions never become empty space. Ten explorers can occupy separate regions. Outside the map boundary, collision behaves as bedrock.

`chunk-renderer.ts` owns one Web Worker, one in-flight job and at most 49 rendered chunks around the viewer. `chunk-worker.ts` generates terrain and constructs solid and water geometry off the main thread, transferring typed-array buffers back. Nearest chunks load first. Old revisions and unloaded results are discarded; mesh eviction disposes GPU geometry. Edited borders rebuild adjacent meshes. Fog hides the edge of the rendered area. Input pauses with a loading message if nearby meshes are not ready, then resumes the current held input. The watching host follows one explorer or views the surrounding area.

The map displays a local 128×128 area around the player, with nearby explorers and recovery crates. Coordinates identify more distant homes and crates. Animals, crop growth, saplings and grass updates sleep more than 64 blocks from connected players; animals retain their location and absolute age/cooldown clocks. Furnace completion uses world time. Distant hostile mobs despawn before terrain or sight checks. Initial passive herds remain around the starting region; there is no unlimited wildlife population.

## Persistence and limits

The room remains authoritative. Saves contain the seed, generator version, edits and persistent gameplay state, not generated chunks. Old coordinate keys remain unchanged within the original island; signed outside coordinates have a separate canonical encoding. Versions 1–6 retain their original 128×128 terrain and save behavior. Loading a save starts fresh scene preparation with its own generator and seed.

New worlds allow 8,192 changed cells, preserving the platform's 256 KiB save envelope despite longer coordinate keys; old worlds retain their 16,384-cell limit. Unmodified exploration does not consume this budget. Changes restored to their generated value free journal entries. Existing chest, crop, animal and item capacities still apply. This is a large bounded world, not infinite terrain or unlimited building storage.

Terrain bytes are never sent over the network. The existing generic snapshot protocol sends the bounded sparse edit journal on initial connection/reconnect, then changed pairs. All players receive that journal and the bounded entity list; per-player network interest filtering is not implemented. This implementation needs no game-specific platform changes. Chunk files, IndexedDB caches and a larger export format are possible later extensions.

## Validation

See [verification](VERIFICATION.md) for the current immutable build, browser evidence and remaining limits. Rule tests cover signed indices, deterministic generation, deep diamonds, bounded caches, movement in ten distant regions, mining/placing, remote homes and stations, save roundtrips and the export envelope. Renderer tests cover stale jobs, one-job backpressure, returning to regions, geometry disposal and worker termination. Browser checks must additionally establish actual worker loading and movement. Emulated browsers do not establish physical phone frame rate, touch feel, battery life or thermal performance.
