/**
 * The edit journal: how it is packed into a save, how much of it a world may hold, and when its tail is folded.
 *
 * Packing: cell indices sorted and delta-encoded as varints, then the 16-bit values, deflated. Walls, floors and
 * tunnels are runs of neighbouring cells holding the same block, so real builds pack to about a byte an edit, while
 * the worst case (scattered single cells) costs seven. The limit therefore follows the measured size, not a count:
 * `world.limit` is the current size plus what the remaining bytes surely hold, and it is measured again only when
 * that allowance runs out. Any 16,384 edits always fit.
 *
 * Tail: clients keep the consolidated journal through the platform's snapshot cache, which re-reads the whole list
 * whenever its revision changes. So single edits do not change that revision; they ride in a short tail
 * (`world.recent`) that every snapshot repeats, and the tail is folded into the list once it is a second and a half
 * old or long enough to be worth one patch.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { BLOCKS, B, cellId } from '../shared/blocks';
import { EDIT_BYTES, EDIT_LIMIT } from '../shared/constants';
import { isCellIndex } from '../shared/coords';
import type { State } from './state';

/** Most raw bytes one more edit can add (a 5-byte index delta and its value), with a byte to spare for deflate. */
const WORST_EDIT = 8, MEASURE_SECONDS = 1;
/** Edits the first measurement can wait for: what EDIT_BYTES holds even at the worst rate. */
export const FIRST_LIMIT = Math.floor(EDIT_BYTES / WORST_EDIT);

export function packEdits(edits: ReadonlyMap<number, number>): Buffer {
  const indices = [...edits.keys()].sort((a, b) => a - b), raw = new Uint8Array(5 + indices.length * 7);
  let offset = 0;
  const varint = (value: number) => {
    while (value >= 128) { raw[offset++] = value % 128 | 128; value = Math.floor(value / 128); }
    raw[offset++] = value;
  };
  varint(indices.length);
  let previous = 0;
  for (const index of indices) { varint(index - previous); previous = index; }
  for (const index of indices) { const value = edits.get(index)!; raw[offset++] = value & 255; raw[offset++] = value >> 8; }
  return deflateRawSync(raw.subarray(0, offset));
}

/** The inverse of packEdits; throws on anything that is not a journal of at most EDIT_LIMIT valid cells. */
export function unpackEdits(packed: Uint8Array): Map<number, number> {
  const raw = inflateRawSync(packed, { maxOutputLength: 5 + EDIT_LIMIT * 7 }), edits = new Map<number, number>();
  let offset = 0;
  const varint = () => {
    let value = 0, scale = 1;
    for (;;) {
      const byte = raw[offset++];
      if (byte === undefined || scale > 2 ** 35) throw new Error('journal');
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
  };
  const count = varint();
  if (count > EDIT_LIMIT) throw new Error('journal');
  const indices: number[] = [];
  for (let i = 0, index = 0; i < count; i++) {
    const delta = varint();
    index += delta;
    if (!isCellIndex(index) || i > 0 && delta === 0) throw new Error('journal');
    indices.push(index);
  }
  if (raw.length !== offset + count * 2) throw new Error('journal');
  for (const index of indices) {
    const value = raw[offset]! | raw[offset + 1]! << 8, block = BLOCKS[cellId(value)];
    if (!block || block.id === B.barrier) throw new Error('journal');
    edits.set(index, value);
    offset += 2;
  }
  return edits;
}

/** Measure the packed journal and move the limit to what the remaining bytes surely hold. */
export function measureJournal(state: State) {
  const world = state.world, bytes = packEdits(world.edits).length;
  world.limit = Math.min(EDIT_LIMIT, world.edits.size + Math.max(0, Math.floor((EDIT_BYTES - bytes) / WORST_EDIT)));
  state.measureAt = state.clock + MEASURE_SECONDS;
}
/** Before a write of `cells` new cells: if the allowance is used up (and not just measured), measure again. */
export function ensureRoom(state: State, cells = 1) {
  const world = state.world;
  if (world.edits.size + cells > world.limit && world.limit < EDIT_LIMIT && state.clock >= state.measureAt) measureJournal(state);
}

/** Tail length worth a patch (longer for big journals, whose patches cost more to build), its age limit and hard cap. */
export const tailCap = (edits: number) => 24 + (edits >> 11);
const TAIL_SECONDS = 1.5, FOLD_GAP = 0.5, TAIL_HARD = 256;
/** Once a tick: fold the tail into the consolidated journal when it is old or long enough. */
export function foldTail(state: State) {
  const recent = state.world.recent, clock = state.clock;
  if (!recent.size) { state.tailSince = clock; return; }
  const long = recent.size >= tailCap(state.world.edits.size) && clock - state.foldedAt >= FOLD_GAP;
  if (clock - state.tailSince < TAIL_SECONDS && !long && recent.size < TAIL_HARD) return;
  recent.clear();
  state.revision++;
  state.foldedAt = state.tailSince = clock;
}
