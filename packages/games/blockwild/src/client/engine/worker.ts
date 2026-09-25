/**
 * Chunk worker: generates terrain with the shared worldgen, applies edits, lights and meshes columns, and posts
 * transferable arrays back. Edits are handled before queued loads (though never twice in a row while loads wait, so a
 * redstone clock cannot starve streaming) and in two phases: the chunks whose cells changed are re-meshed and posted
 * first (so a placed block appears at once), then neighbours whose light changed.
 */
import { CHUNK_CELLS } from '../../shared/chunk';
import { CHUNK, CHUNKS, HEIGHT } from '../../shared/constants';
import { cellXYZ, chunkFromKey, chunkKey, localIndex } from '../../shared/coords';
import { generateChunk } from '../../shared/worldgen';
import { computeLight, extractCoreLight, extractVolume, fillRegion, newRegion, newVolume, type Volume } from './light';
import { joinLayers, Mesher } from './mesher';
import { EMIT, FILTER_CELL } from './tables';
import type { ColumnUpdate, FromWorker, Layers, ToWorker } from './types';

const SECTIONS = HEIGHT / CHUNK;
type Column = { sections: Layers[]; light: Uint8Array };

let seed = 0;
let mesher: Mesher | null = null;
let capacity = 400;
/** Chunk cells with edits applied (LRU by Map order). */
const cells = new Map<number, Uint16Array>();
/** A few pristine generated chunks, for reverting cells to their terrain value. */
const pristine = new Map<number, Uint16Array>();
/** Effective edits per chunk: localIndex → value. */
const edits = new Map<number, Map<number, number>>();
/** Columns the main thread holds meshes for. */
const columns = new Map<number, Column>();
const loads = new Set<number>();
let changes: Int32Array[] = [];
const region = newRegion(), volumePool: Volume[] = [], scratchLight = new Uint8Array(CHUNK_CELLS);

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

function chunkCells(cx: number, cz: number): Uint16Array | null {
  if (cx < 0 || cz < 0 || cx >= CHUNKS || cz >= CHUNKS) return null;
  const key = chunkKey(cx, cz);
  let chunk = cells.get(key);
  if (chunk) {
    cells.delete(key);
  } else {
    chunk = pristine.get(key)?.slice() ?? generateChunk(seed, cx, cz);
    for (const [local, value] of edits.get(key) ?? []) chunk[local] = value;
  }
  cells.set(key, chunk);
  if (cells.size > capacity) cells.delete(cells.keys().next().value!);
  return chunk;
}

function generatedCell(cx: number, cz: number, local: number) {
  const key = chunkKey(cx, cz);
  let chunk = pristine.get(key);
  if (!chunk) {
    pristine.set(key, chunk = generateChunk(seed, cx, cz));
    if (pristine.size > 8) pristine.delete(pristine.keys().next().value!);
  }
  return chunk[local]!;
}

/** Lights chunk `key` from its 3×3 region into a mesh volume; returns the fresh core light (scratch). */
function light(key: number, volume: Volume) {
  const [cx, cz] = chunkFromKey(key);
  fillRegion(region, cx, cz, chunkCells);
  computeLight(region);
  extractVolume(region, volume);
  return extractCoreLight(region, scratchLight);
}

function meshSections(key: number, volume: Volume, mask: number, sections: Layers[]) {
  const [cx, cz] = chunkFromKey(key);
  for (let sy = 0; sy < SECTIONS; sy++) if (mask & 1 << sy) sections[sy] = mesher!.section(volume, sy, cx * CHUNK, cz * CHUNK);
}
const joinColumn = (sections: Layers[]): Layers => [0, 1, 2].map(layer => joinLayers(sections.map(section => section[layer]!))) as Layers;
const transfers = (update: ColumnUpdate) => [update.cells, update.light, ...(update.layers ?? []).flatMap(mesh => mesh ? [mesh.pos, mesh.uvl, mesh.lt] : [])]
  .filter((array): array is NonNullable<typeof array> => !!array).map(array => array.buffer);

function load(key: number) {
  const volume = volumePool[0] ??= newVolume(), sections: Layers[] = [];
  const core = light(key, volume).slice();
  meshSections(key, volume, 255, sections);
  columns.set(key, { sections, light: core });
  const [cx, cz] = chunkFromKey(key);
  const update: ColumnUpdate = { key, cells: chunkCells(cx, cz)!.slice(), light: core.slice(), layers: joinColumn(sections) };
  post({ type: 'update', load: true, columns: [update] }, transfers(update));
}

function applyEdits() {
  const batches = changes, changed: number[] = [], echo: number[] = [];
  changes = [];
  // Dust power, levers and repeaters change no light: then only the edited columns need a new volume, not a 3×3 relight.
  let lighting = false;
  for (const batch of batches) for (let j = 0; j < batch.length; j += 2) {
    const index = batch[j]!, value = batch[j + 1]!, [x, y, z] = cellXYZ(index), cx = x >> 4, cz = z >> 4;
    const key = chunkKey(cx, cz), local = localIndex(x & 15, y, z & 15);
    let chunkEdits = edits.get(key), final = value;
    if (value < 0) {
      chunkEdits?.delete(local);
      if (chunkEdits && !chunkEdits.size) edits.delete(key);
      final = generatedCell(cx, cz, local);
    } else {
      if (!chunkEdits) edits.set(key, chunkEdits = new Map());
      chunkEdits.set(local, value);
    }
    echo.push(index, final);
    const chunk = cells.get(key), old = chunk?.[local];
    if (old === final) continue;
    lighting ||= old === undefined || FILTER_CELL[old] !== FILTER_CELL[final] || EMIT[old & 255] !== EMIT[final & 255];
    if (chunk) chunk[local] = final;
    changed.push(x, y, z);
  }
  if (echo.length) {
    const array = Int32Array.from(echo);
    post({ type: 'cells', changes: array }, [array.buffer]);
  }
  if (!changed.length) return;

  // Sections to re-mesh per column (bit per section), and the columns whose light may have changed (3×3 around edits).
  const dirty = new Map<number, number>(), around = new Set<number>();
  const mark = (x: number, y: number, z: number) => {
    const sy0 = Math.max(0, (y - 1) >> 4), sy1 = Math.min(SECTIONS - 1, (y + 1) >> 4), bits = ((2 << sy1) - 1) & ~((1 << sy0) - 1);
    for (let cz = (z - 1) >> 4; cz <= (z + 1) >> 4; cz++) for (let cx = (x - 1) >> 4; cx <= (x + 1) >> 4; cx++) {
      const key = chunkKey(cx, cz);
      if (columns.has(key)) dirty.set(key, (dirty.get(key) ?? 0) | bits);
    }
  };
  for (let j = 0; j < changed.length; j += 3) {
    const x = changed[j]!, y = changed[j + 1]!, z = changed[j + 2]!;
    mark(x, y, z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const key = chunkKey((x >> 4) + dx, (z >> 4) + dz);
      if (columns.has(key)) around.add(key);
    }
  }
  const volumes = new Map<number, Volume>(), relit = new Set<number>();
  const relight = (key: number) => {
    const volume = volumePool[volumes.size] ??= newVolume(), column = columns.get(key)!, fresh = light(key, volume), [cx, cz] = chunkFromKey(key);
    volumes.set(key, volume);
    let any = false;
    for (let i = 0; i < CHUNK_CELLS; i++) if (fresh[i] !== column.light[i]) {
      mark(cx * CHUNK + (i & 15), i >> 8, cz * CHUNK + (i >> 4 & 15));
      any = true;
    }
    if (any) {
      column.light.set(fresh);
      relit.add(key);
    }
  };
  // A column meshed from a volume lit after the edits is final: later relights of its neighbours cannot change it.
  const meshed = new Set<number>();
  const flush = (keys: Iterable<number>) => {
    const updates: ColumnUpdate[] = [];
    for (const key of keys) {
      const mask = dirty.get(key), column = columns.get(key);
      dirty.delete(key);
      if (!mask || !column || meshed.has(key)) continue;
      if (!volumes.has(key)) relight(key);
      meshSections(key, volumes.get(key)!, mask, column.sections);
      meshed.add(key);
      updates.push({ key, layers: joinColumn(column.sections), ...relit.has(key) ? { light: column.light.slice() } : {} });
    }
    if (updates.length) post({ type: 'update', load: false, columns: updates }, updates.flatMap(transfers));
  };
  const primary = [...dirty.keys()];
  for (const key of primary) relight(key);
  flush(primary);
  if (lighting) for (const key of around) if (!volumes.has(key)) relight(key);
  flush([...dirty.keys()]);
}

// Work runs in small tasks so new messages (edits especially) are read between jobs.
const channel = new MessageChannel();
let scheduled = false, editedLast = false;
const schedule = () => {
  if (scheduled || !mesher || !changes.length && !loads.size) return;
  scheduled = true;
  channel.port2.postMessage(0);
};
channel.port1.onmessage = () => {
  scheduled = false;
  try {
    editedLast = changes.length > 0 && !(editedLast && loads.size);
    if (editedLast) applyEdits();
    else {
      const key = loads.values().next().value;
      if (key !== undefined) {
        loads.delete(key);
        load(key);
      }
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
  schedule();
};
// Node (engine tests) only: an idle queue must not keep the process alive. Browsers have no unref.
(channel.port1 as { unref?: () => void }).unref?.();

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      seed = message.seed;
      capacity = message.capacity;
      const layers = message.layers;
      mesher = new Mesher(key => layers[key] ?? layers.missing ?? 0);
      break;
    }
    case 'load': for (const key of message.keys) loads.add(key); break;
    case 'cancel': for (const key of message.keys) loads.delete(key); break;
    case 'drop': for (const key of message.keys) { loads.delete(key); columns.delete(key); } break;
    case 'capacity': capacity = message.capacity; break;
    case 'edits': changes.push(message.changes); break;
  }
  schedule();
};
